import { describe, expect, it } from "vitest";

import type { AutomationLane } from "./types";

import { setAutomationPointValue } from "./automation";

const lane = (): AutomationLane => ({
  id: "tone",
  target: "instrument",
  param: "tone",
  points: [
    { step: 8, value: 0.25 },
    { step: 0, value: 0.5 },
  ],
});

describe("setAutomationPointValue", () => {
  it("quantizes a typed automation value and keeps points ordered", () => {
    const next = lane();
    const point = next.points[0];

    expect(setAutomationPointValue(next, point, "0.537")).toBe(true);
    expect(point.value).toBe(0.54);
    expect(next.points.map(({ step }) => step)).toEqual([0, 8]);
  });

  it("clamps a typed automation value to its control range", () => {
    const next = lane();
    const point = next.points[0];

    setAutomationPointValue(next, point, "4");

    expect(point.value).toBe(1);
    expect(next.points.map(({ step }) => step)).toEqual([0, 8]);
  });

  it("leaves the point unchanged for an invalid typed value", () => {
    const next = lane();
    const point = next.points[0];

    expect(setAutomationPointValue(next, point, "not a number")).toBe(false);
    expect(point.value).toBe(0.25);
  });
});
