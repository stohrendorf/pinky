import { describe, expect, it } from "vitest";

import type { AutomationLane } from "./types";

import {
  laneOverrideAt,
  laneValueAt,
  segmentProgress,
  setAutomationPointCurve,
} from "./automation";

const lane = (
  curve: NonNullable<AutomationLane["points"][number]["curve"]>,
): AutomationLane => ({
  id: "tone",
  target: "instrument",
  param: "tone",
  points: [
    { step: 0, value: 0, curve },
    { step: 8, value: 1 },
  ],
});

describe("automation curve presets", () => {
  it("keeps unconfigured segments linear by default", () => {
    expect(
      laneValueAt(
        {
          ...lane("linear"),
          points: [
            { step: 0, value: 0 },
            { step: 8, value: 1 },
          ],
        },
        2,
      ),
    ).toBe(0.25);
  });

  it("evaluates hold and easing curves from the outgoing point", () => {
    expect(laneValueAt(lane("hold"), 4)).toBe(0);
    expect(laneValueAt(lane("ease-in"), 2)).toBe(0.0625);
    expect(laneValueAt(lane("ease-out"), 2)).toBe(0.4375);
    expect(laneValueAt(lane("smooth"), 2)).toBeCloseTo(0.15625);
    expect(segmentProgress("smooth", 0.5)).toBe(0.5);
  });

  it("uses None interpolation to leave the target unmodified until the next point", () => {
    const gap: AutomationLane = {
      ...lane("none"),
      points: [
        { step: 0, value: 0.2, curve: "linear" },
        { step: 4, value: 0.8, curve: "none" },
        { step: 8, value: 0.4 },
      ],
    };

    expect(laneOverrideAt(gap, 4)).toBe(0.8);
    expect(laneOverrideAt(gap, 6)).toBeNull();
    expect(laneOverrideAt(gap, 8)).toBe(0.4);
  });

  it("replaces a control point when changing its outgoing curve", () => {
    const next = lane("linear");
    const original = next.points[0];

    const updated = setAutomationPointCurve(next, original, "smooth");

    expect(updated).toEqual({ step: 0, value: 0, curve: "smooth" });
    expect(updated).not.toBe(original);
    expect(next.points[0]).toBe(updated);
    expect(original.curve).toBe("linear");
  });
});
