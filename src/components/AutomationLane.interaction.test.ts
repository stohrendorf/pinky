import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const automationLane = readFileSync(
  fileURLToPath(new URL("./AutomationLane.svelte", import.meta.url)),
  "utf8",
);

describe("AutomationLane selection workflow", () => {
  it("clears the arranger-wide selected point before adding another point", () => {
    expect(automationLane).toContain("hasSelectedPoint?: boolean");
    expect(automationLane).toContain("if (hasSelectedPoint) {");
    expect(automationLane).toContain("onselect(null);");
    expect(automationLane.indexOf("if (hasSelectedPoint) {")).toBeLessThan(
      automationLane.indexOf("const pt: AutomationPoint"),
    );
  });

  it("samples dense automation point handles while preserving the full curve", () => {
    expect(automationLane).toContain("const MAX_VISIBLE_POINT_HANDLES = 160;");
    expect(automationLane).toContain("const visiblePoints = $derived.by");
    expect(automationLane).toContain("const path = $derived(curvePath(pts));");
    expect(automationLane).toContain("{#each visiblePoints as p}");
    expect(automationLane).toContain(
      "const activePoint = editingPoint ?? selectedPoint;",
    );
  });
});
