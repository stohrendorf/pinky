import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { functionHasAssignment } from "../test/svelte-semantics";

const lane = readFileSync(
  fileURLToPath(new URL("./AutomationLane.svelte", import.meta.url)),
  "utf8",
);

describe("AutomationLane contextual node editing", () => {
  it("keeps node controls in the lane instead of opening a modal", () => {
    expect(lane).toContain('class="auto-lane-wrap"');
    expect(lane).toContain('class="point-readout"');
    expect(lane).toContain("aria-label={`Set ${def.label} value`}");
    expect(lane).not.toContain("import Prompt from './ui/Prompt.svelte'");
  });

  it("makes selected node values direct editable inputs", () => {
    expect(lane).toContain('class="point-readout"');
    expect(lane).toContain('aria-live="polite"');
    expect(lane).toMatch(
      /<input\b(?=[^>]*\bmax=\{def\.max\})(?=[^>]*\bmin=\{def\.min\})(?=[^>]*\bstep=\{def\.step\})(?=[^>]*\btype="number")[^>]*>/,
    );
    expect(lane).toContain("aria-label={`Set ${def.label} value`}");
    expect(lane).toMatch(
      /oninput=\{\(?event\)?\s*=>\s*updatePointValue\(selectedPoint, event\.currentTarget\.value\)}/,
    );
    expect(lane).toContain("onkeydown={stopPropagation()}");
    expect(lane).not.toContain("svelte/legacy");
    expect(lane).not.toContain(
      "ondblclick={stopPropagation(() => openPointEditor(p))}",
    );
    expect(lane).toContain("onkeydown={e => onPointKeydown(e, activePoint)}");
    expect(lane).toContain('role="button"');
    expect(lane).toContain('tabindex="0"');
    expect(lane).toMatch(/e\.key === 'ArrowUp'[\s\S]*setAutomationPointValue/);
    expect(lane).not.toMatch(/e\.key === 'Enter'[\s\S]*openPointEditor/);
  });

  it("keeps only the arranger-selected node active and closes for another popup", () => {
    expect(lane).toContain("selectedPoint?: AutomationPoint | null");
    expect(lane).toMatch(
      /selectedPoint === activePoint \|\| editingPoint === activePoint/,
    );
    expect(lane).toMatch(/contextualEditor !== editorKey && editingPoint/);
    expect(functionHasAssignment(lane, "onDown", "contextualEditor")).toBe(
      true,
    );
    expect(lane).toContain("onselect(point)");
  });

  it("does not edit points while an arranger clip selection must be cleared", () => {
    expect(lane).toContain("canEdit?: boolean");
    expect(lane).toContain("onblocked?: () => void");
    expect(lane).toMatch(
      /if \(!canEdit\) \{[\s\S]*onblocked\(\);[\s\S]*return;/,
    );
  });

  it("lets the selected point choose its outgoing curve shape", () => {
    expect(lane).toContain("CURVE_SHAPES");
    expect(lane).toContain("function setPointCurve");
    expect(lane).toContain('aria-label="Curve to next point"');
    expect(lane).toContain("const path = $derived(curvePath(pts));");
  });

  it("renders the curve as a softly filled area with outlined nodes", () => {
    expect(lane).toContain('class="curve-fill"');
    expect(lane).toContain("const fillPath = $derived");
    expect(lane).toContain('class="curve-node"');
  });

  it("draws hold segments as a true step at the destination point", () => {
    expect(lane).toContain("if (start.curve === 'hold')");
    expect(lane).toContain(
      "segments.push(`L ${end.step * cellWidth} ${valToY(start.value)}`);",
    );
    expect(lane).toContain(
      "segments.push(`L ${end.step * cellWidth} ${valToY(end.value)}`);",
    );
    expect(lane).not.toContain("segmentProgress(from.curve, 1)");
  });

  it("centers controls above the curve without increasing the automation row height", () => {
    expect(lane).toContain("function pointControlPosition");
    expect(lane).toContain("point.step * cellWidth - editorWidth / 2");
    expect(lane).toContain(
      'style="left: {pointControlPosition(editingPoint)}px;"',
    );
    expect(lane).toContain("selectedPoint && !editingPoint");
    expect(lane).toMatch(/\.auto-lane-wrap\s*\{[^}]*position:\s*relative;/s);
    expect(lane).not.toMatch(/\.auto-lane-wrap\s*\{[^}]*padding-top:/s);
    expect(lane).toMatch(
      /\.point-readout,[\s\S]*?\.point-editor\s*\{[^}]*bottom:\s*calc\(100% \+ 4px\);/s,
    );
  });

  it("keeps clipboard shortcuts inside the value editor", () => {
    expect(lane).toMatch(
      /function onPointEditorKeydown\(e: KeyboardEvent\) \{\s*e\.stopPropagation\(\);/,
    );
    expect(lane).toMatch(/e\.key === 'Escape'\) \{\s*e\.preventDefault\(\);/);
  });
});
