import { describe, expect, it, vi } from "vitest";

import {
  componentFunction,
  componentMarkup,
  componentSource,
  elements,
  hasAttribute,
} from "../../test/svelte-semantics";

const source = componentSource(new URL("./TreeView.svelte", import.meta.url));

function fixture() {
  return {
    entries: [
      { kind: "folder", path: "02 Main" },
      { kind: "folder", path: "02 Main/Drums" },
      { kind: "folder", path: "03 Outro" },
      {
        kind: "item",
        item: { id: "beat" },
        ancestors: ["02 Main", "02 Main/Drums"],
      },
    ],
    collapsedFolders: new Set<string>(),
    closeMenu: vi.fn(),
  };
}

describe("TreeView folder navigation", () => {
  it("collapses and expands all folders without changing the selected item", () => {
    const scope = fixture();
    const collapse = componentFunction<() => void>(
      source,
      "collapseAll",
      scope,
    );
    const expand = componentFunction<() => void>(source, "expandAll", scope);
    collapse();
    expect([...scope.collapsedFolders]).toEqual([
      "02 Main",
      "02 Main/Drums",
      "03 Outro",
    ]);
    expand();
    expect(scope.collapsedFolders.size).toBe(0);
    expect(scope.closeMenu).toHaveBeenCalled();
  });

  it("reveals only the selected item’s ancestors, leaving unrelated groups collapsed", () => {
    const scope = fixture();
    scope.collapsedFolders = new Set(["02 Main", "02 Main/Drums", "03 Outro"]);
    const reveal = componentFunction<(id: string | null) => void>(
      source,
      "revealSelected",
      scope,
    );
    reveal("beat");
    expect([...scope.collapsedFolders]).toEqual(["03 Outro"]);
    reveal(null);
    reveal("missing");
    expect([...scope.collapsedFolders]).toEqual(["03 Outro"]);
  });

  it("provides full paths for truncated rows", () => {
    const markup = componentMarkup(source);
    const tree = elements(markup, "div").find((node) =>
      hasAttribute(node, "role", "tree"),
    )!;
    expect(hasAttribute(tree, "aria-label")).toBe(true);
    const buttons = elements(markup, "button");
    const rows = buttons.filter((node) =>
      hasAttribute(node, "class", "row-main"),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((node) => hasAttribute(node, "title"))).toBe(true);
  });
});
