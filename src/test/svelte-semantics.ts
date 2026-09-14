import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { parse } from "svelte/compiler";
import { ScriptTarget, transpileModule } from "typescript";

interface Node {
  alternate?: Fragment | null;
  attributes?: Attribute[];
  body?: Fragment | null;
  catch?: Fragment | null;
  children?: Node[];
  consequent?: Fragment | null;
  fallback?: Fragment | null;
  fragment?: Fragment | null;
  name?: string;
  pending?: Fragment | null;
  test?: unknown;
  then?: Fragment | null;
  type: string;
}

interface Fragment {
  nodes?: Node[];
}

interface Attribute {
  name: string;
  type: string;
  value?:
    | { data?: string; expression?: unknown; type: string }[]
    | { data?: string; expression?: unknown; type: string }
    | true;
}

export function componentSource(url: URL): string {
  return readFileSync(fileURLToPath(url), "utf8");
}

export function componentMarkup(source: string): Node[] {
  return parse(source, { modern: true }).fragment.nodes as Node[];
}

export function elements(nodes: Node[], name: string): Node[] {
  return walk(nodes).filter(
    (node) => node.type === "RegularElement" && node.name === name,
  );
}

export function components(nodes: Node[], name: string): Node[] {
  return walk(nodes).filter(
    (node) => node.type === "Component" && node.name === name,
  );
}

export function eachBlocks(nodes: Node[]): Node[] {
  return walk(nodes).filter((node) => node.type === "EachBlock");
}

export function hasAttribute(
  node: Node,
  name: string,
  value?: string,
): boolean {
  const attribute = node.attributes?.find(
    (candidate) => candidate.type === "Attribute" && candidate.name === name,
  );
  if (!attribute) {
    return false;
  }
  if (value === undefined) {
    return true;
  }
  const parts =
    attribute.value === true || attribute.value === undefined
      ? []
      : Array.isArray(attribute.value)
        ? attribute.value
        : [attribute.value];
  return parts.some((part) => part.type === "Text" && part.data === value);
}

export function textContent(node: Node): string {
  return walk([node])
    .flatMap((current) => (current.type === "Text" ? [current] : []))
    .map((text) => (text as { data?: string }).data ?? "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function styleRules(source: string): Map<string, Map<string, string>> {
  const stylesheet = parse(source, { modern: true }).css;
  const rules = new Map<string, Map<string, string>>();
  for (const child of stylesheet?.children ?? []) {
    if (child.type !== "Rule") {
      continue;
    }
    const declarations = new Map<string, string>();
    for (const declaration of child.block.children) {
      if (declaration.type === "Declaration") {
        declarations.set(declaration.property, declaration.value);
      }
    }
    rules.set(
      source.slice(child.prelude.start, child.prelude.end),
      declarations,
    );
  }
  return rules;
}

export function functionHasAssignment(
  source: string,
  functionName: string,
  identifier: string,
): boolean {
  const script = parse(source, { modern: true }).instance?.content;
  const declaration = astNodes(script).find(
    (node) =>
      node.type === "FunctionDeclaration" &&
      isAstNode(node.id) &&
      node.id.name === functionName,
  );

  return astNodes(declaration).some(
    (node) =>
      node.type === "AssignmentExpression" &&
      isAstNode(node.left) &&
      node.left.type === "Identifier" &&
      node.left.name === identifier,
  );
}

export function functionHasCall(
  source: string,
  functionName: string,
  calleeName: string,
): boolean {
  const script = parse(source, { modern: true }).instance?.content;
  const declaration = astNodes(script).find(
    (node) =>
      node.type === "FunctionDeclaration" &&
      isAstNode(node.id) &&
      node.id.name === functionName,
  );

  return astNodes(declaration).some(
    (node) =>
      node.type === "CallExpression" &&
      isAstNode(node.callee) &&
      node.callee.type === "Identifier" &&
      node.callee.name === calleeName,
  );
}

export function componentFunction<T>(
  source: string,
  functionName: string,
  scope: object,
): T {
  const script = parse(source, { modern: true }).instance?.content;
  const declaration = astNodes(script).find(
    (node) =>
      node.type === "FunctionDeclaration" &&
      isAstNode(node.id) &&
      node.id.name === functionName,
  );
  if (
    !declaration ||
    typeof declaration.start !== "number" ||
    typeof declaration.end !== "number"
  ) {
    throw new Error(`No function named ${functionName} was found`);
  }
  const js = transpileModule(source.slice(declaration.start, declaration.end), {
    compilerOptions: { target: ScriptTarget.ES2022 },
  }).outputText;
  return runInNewContext(`${js}\n${functionName}`, scope) as T;
}

export function ifConditionForElement(
  source: string,
  name: string,
  className: string,
): { identifiers: string[]; strings: string[] } | null {
  const conditional = walk(componentMarkup(source)).find(
    (node) =>
      node.type === "IfBlock" &&
      elements(node.consequent?.nodes ?? [], name).some((element) =>
        hasAttribute(element, "class", className),
      ),
  );
  if (!conditional || !isAstNode(conditional.test)) {
    return null;
  }
  const expressions = astNodes(conditional.test);
  return {
    identifiers: expressions
      .filter((node) => node.type === "Identifier")
      .map((node) => node.name)
      .filter((name): name is string => typeof name === "string"),
    strings: expressions
      .filter((node) => node.type === "Literal")
      .map((node) => node.value)
      .filter((value): value is string => typeof value === "string"),
  };
}

function walk(nodes: Node[]): Node[] {
  return nodes.flatMap((node) => [node, ...walk(childNodes(node))]);
}

function childNodes(node: Node): Node[] {
  return [
    ...(node.children ?? []),
    ...(node.fragment?.nodes ?? []),
    ...(node.body?.nodes ?? []),
    ...(node.consequent?.nodes ?? []),
    ...(node.alternate?.nodes ?? []),
    ...(node.fallback?.nodes ?? []),
    ...(node.pending?.nodes ?? []),
    ...(node.then?.nodes ?? []),
    ...(node.catch?.nodes ?? []),
  ];
}

interface AstNode {
  [key: string]: unknown;

  end?: number;
  start?: number;
  type?: string;
}

function astNodes(value: unknown): AstNode[] {
  if (Array.isArray(value)) {
    return value.flatMap(astNodes);
  }
  if (!isAstNode(value)) {
    return [];
  }
  return [value, ...Object.values(value).flatMap(astNodes)];
}

function isAstNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null;
}
