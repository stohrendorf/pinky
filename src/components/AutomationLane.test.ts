import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AutoParamDef } from "../lib/automation";
import type { AutomationLane, AutomationPoint } from "../lib/types";

import AutomationLaneEditor from "./AutomationLane.svelte";

afterEach(cleanup);

const def: AutoParamDef = {
  param: "gain",
  label: "Gain",
  min: 0,
  max: 1,
  step: 0.1,
};

function lane(): AutomationLane {
  return {
    id: "lead-gain",
    target: "lead",
    param: def.param,
    points: [
      { step: 2, value: 0.4 },
      { step: 8, value: 0.8 },
    ],
  };
}

function renderLane(
  automationLane = lane(),
  selectedPoint: AutomationPoint | null = null,
  options: {
    canEdit?: boolean;
    onblocked?: () => void;
    onselect?: (point: AutomationPoint | null) => void;
  } = {},
) {
  return render(AutomationLaneEditor, {
    lane: automationLane,
    def,
    color: "#53d8fb",
    cellWidth: 10,
    width: 120,
    height: 100,
    selectedPoint,
    editorKey: "automation:lead:gain",
    contextualEditor: null,
    canEdit: options.canEdit,
    onblocked: options.onblocked,
    onselect: options.onselect,
  });
}

describe("AutomationLane contextual node editing", () => {
  it("selects a point from the rendered curve", async () => {
    const automationLane = lane();
    const onselect = vi.fn();
    renderLane(automationLane, null, { onselect });
    const editor = screen.getByRole("grid", { name: "Gain automation editor" });
    Object.defineProperty(editor, "getBoundingClientRect", {
      value: () => new DOMRect(0, 0, 120, 100),
    });

    await fireEvent.mouseDown(editor, { button: 0, clientX: 20, clientY: 59 });
    await fireEvent.mouseUp(window);

    expect(onselect).toHaveBeenCalledWith(automationLane.points[0]);
  });

  it("edits a selected point directly through its numeric input", async () => {
    const automationLane = lane();
    const onselect = vi.fn();
    renderLane(automationLane, automationLane.points[0], { onselect });

    const input = screen.getByRole("spinbutton", { name: "Set Gain value" });
    expect(input.getAttribute("min")).toBe("0");
    expect(input.getAttribute("max")).toBe("1");
    expect(input.getAttribute("step")).toBe("0.1");
    await fireEvent.input(input, { target: { value: "0.7" } });

    expect(automationLane.points[0].value).toBe(0.7);
    expect(onselect).toHaveBeenCalledWith(automationLane.points[0]);
  });

  it("changes the selected point's outgoing curve", async () => {
    const automationLane = lane();
    const onselect = vi.fn();
    renderLane(automationLane, automationLane.points[0], { onselect });

    await fireEvent.change(
      screen.getByRole("combobox", { name: "Curve to next point" }),
      {
        target: { value: "hold" },
      },
    );

    expect(automationLane.points[0].curve).toBe("hold");
    expect(onselect).toHaveBeenCalledWith(automationLane.points[0]);
  });

  it("supports keyboard value adjustments and context deletion", async () => {
    const automationLane = lane();
    const onselect = vi.fn();
    renderLane(automationLane, automationLane.points[0], { onselect });

    await fireEvent.keyDown(
      screen.getByRole("button", { name: "Gain: 0.4 at step 2" }),
      { key: "ArrowUp" },
    );
    expect(automationLane.points[0].value).toBe(0.5);
    expect(onselect).toHaveBeenLastCalledWith(automationLane.points[0]);

    const editor = screen.getByRole("grid", { name: "Gain automation editor" });
    Object.defineProperty(editor, "getBoundingClientRect", {
      value: () => new DOMRect(0, 0, 120, 100),
    });
    await fireEvent.contextMenu(editor, { clientX: 20, clientY: 50 });
    expect(automationLane.points).toEqual([{ step: 8, value: 0.8 }]);
  });

  it("reports an attempted point edit while editing is blocked", async () => {
    const onblocked = vi.fn();
    renderLane(lane(), null, { canEdit: false, onblocked });
    const editor = screen.getByRole("grid", { name: "Gain automation editor" });
    Object.defineProperty(editor, "getBoundingClientRect", {
      value: () => new DOMRect(0, 0, 120, 100),
    });

    await fireEvent.mouseDown(editor, { button: 0, clientX: 20, clientY: 59 });

    expect(onblocked).toHaveBeenCalledOnce();
  });
});
