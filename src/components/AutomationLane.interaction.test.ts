import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const automationLane = readFileSync(
  fileURLToPath(new URL("./AutomationLane.svelte", import.meta.url)),
  "utf8",
);
const playlist = readFileSync(
  fileURLToPath(new URL("./Playlist.svelte", import.meta.url)),
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
    expect(automationLane).toContain("const path = $derived(curvePath(pts));");
    expect(automationLane).toContain(
      '<path style="stroke: {color}" class="curve-nodes" d={pointPath} />',
    );
    expect(automationLane).not.toContain("MAX_VISIBLE_POINT_HANDLES");
  });

  it("uses None interpolation to create a visible automation gap", () => {
    expect(automationLane).toContain("if (start.curve === 'none'");
    expect(automationLane).toContain("function curveFillPath");
    expect(automationLane).toContain("closeSegment(start);");
    expect(automationLane).toContain(
      "const fillPath = $derived(curveFillPath(pts));",
    );
    expect(automationLane).not.toContain("Automation active from this point");
  });

  it("deletes a control point with a dedicated right-click handler", () => {
    expect(automationLane).toContain("function onContextMenu");
    expect(automationLane).toContain("if (e.button === 2)");
    expect(automationLane).toContain("deletedWithRightButton = true;");
    expect(automationLane).toContain("e.preventDefault();");
    expect(automationLane).toContain("deletePoint(hit);");
    expect(automationLane).toContain("oncontextmenu={onContextMenu}");
  });

  it("invalidates the point-derived render state after every point edit", () => {
    expect(automationLane).toContain("let pointRevision = $state(0);");
    expect(automationLane).toContain("function refreshPoints()");
    expect(automationLane).toContain("pointRevision++;");
    expect(automationLane).toContain("void pointRevision;");
    expect(automationLane).toContain("refreshPoints();");
  });

  it("keeps the parent selection current when a curve changes or its point is removed", () => {
    expect(automationLane).toMatch(
      /function setPointCurve[\s\S]*setAutomationPointCurve\(\s*lane,\s*point,[\s\S]*onselect\(updated\);[\s\S]*refreshPoints\(\);/,
    );
    expect(automationLane).toContain("pointsMatch(selectedPoint, point)");
    expect(automationLane).toContain("function pointsMatch");
  });

  it("expects the arranger selection to preserve the lane point identity", () => {
    expect(playlist).toContain("selectedAutomationPoint");
    expect(playlist).toContain("$state.raw(null)");
  });
});
