import { describe, expect, it, vi } from "vitest";

import {
  MasterControls,
  type MasterTargets,
  type MasterValues,
} from "./master-controls";

function param(value = 0): AudioParam {
  return { value } as AudioParam;
}

function controls(
  targets: MasterTargets | null = {
    volume: param(0.7),
    reverb: param(0.2),
    tiltLow: param(-1),
    tiltHigh: param(1),
  },
) {
  const values: MasterValues = { vol: 0.8, rev: 0.18, tilt: 0 };
  const rampTo = vi.fn();
  const instance = new MasterControls({
    values,
    targets: () => targets,
    currentTime: () => 4,
    rampTo,
  });
  return { instance, values, rampTo };
}

describe("MasterControls", () => {
  it("routes slider values to the corresponding injected parameters", () => {
    const { instance, values, rampTo } = controls();

    instance.apply("tilt", 3);

    expect(values.tilt).toBe(3);
    expect(rampTo).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      -3,
      4,
      0.02,
      undefined,
    );
    expect(rampTo).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      3,
      4,
      0.02,
      undefined,
    );
  });

  it("schedules every master automation change and enforces a minimum ramp", () => {
    const { instance, rampTo } = controls();

    instance.automate("vol", 0.5, 10, 0.001);
    instance.automate("vol", 0.502, 11, 0.1);
    instance.automate("vol", 0.51, 12, 0.1);

    expect(rampTo).toHaveBeenCalledTimes(3);
    expect(rampTo).toHaveBeenLastCalledWith(
      expect.anything(),
      0.51,
      12,
      0.1,
      0.502,
    );
  });

  it("continues offline automation from the prior scheduled value", () => {
    const { instance, rampTo } = controls();

    instance.automate("vol", 0.6, 10, 0.05);
    instance.automate("vol", 0.5, 11, 0.05);

    expect(rampTo).toHaveBeenLastCalledWith(
      expect.anything(),
      0.5,
      11,
      0.05,
      0.6,
    );
  });

  it("reports the scheduled master endpoint instead of the static AudioParam value", () => {
    const { instance } = controls();

    instance.automate("vol", 0.05, 10, 0.05);
    expect(instance.state().vol).toBe(0.05);

    instance.automate("vol", 0.8, 11, 0.05);
    expect(instance.state().vol).toBe(0.8);
  });

  it("keeps value state and command calls isolated when targets are absent", () => {
    const { instance, values, rampTo } = controls(null);

    instance.apply("rev", 0.4);
    instance.reset();

    expect(values.rev).toBe(0.4);
    expect(instance.state()).toEqual({ vol: 0.8, tilt: 0 });
    expect(rampTo).not.toHaveBeenCalled();
  });
});
