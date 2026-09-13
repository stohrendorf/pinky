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

  it("renders every dense automation point without adding a DOM node per point", () => {
    expect(automationLane).toContain("function pointMarkerPath");
    expect(automationLane).toContain("const pointPath = $derived");
    expect(automationLane).toContain("const inactivePointPath = $derived");
    expect(automationLane).toContain("const path = $derived(curvePath(pts));");
    expect(automationLane).toContain(
      '<path style="stroke: {color}" class="curve-nodes" d={pointPath} />',
    );
    expect(automationLane).not.toContain("MAX_VISIBLE_POINT_HANDLES");
  });

  it("lets a point end an automation section and renders the following gap", () => {
    expect(automationLane).toContain("function setPointActive");
    expect(automationLane).toContain(
      'aria-label="Automation active from this point"',
    );
    expect(automationLane).toContain(
      "point.active = active ? undefined : false;",
    );
    expect(automationLane).toContain(
      "class:inactive={activePoint.active === false}",
    );
  });
});
