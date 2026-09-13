import { describe, expect, it } from "vitest";

import type { Project } from "./types";

import {
  automationCurrentValue,
  autoParamDef,
  autoParams,
  instrumentOverrides,
  laneColor,
  laneOverrideAt,
  laneTitle,
  masterAutomation,
  mixerAutomation,
  mixerTarget,
  newLane,
  parseMixerTarget,
  withNoteOverrides,
} from "./automation";
import { DEFAULT_PARAMS } from "./instruments";
import { createMixer } from "./mixer";
import { isProjectId } from "./types";

const project = (): Project => {
  const mixer = createMixer(["lead/one"]);
  mixer.channels["lead/one"].volume = 0.42;
  mixer.channels["lead/one"].pan = -0.3;
  mixer.buses = [
    {
      ...mixer.channels["lead/one"],
      id: "echo|bus",
      name: "Echo",
      effect: "delay",
      delayTime: 0.35,
      feedback: 0.6,
    },
  ];
  return {
    formatVersion: 1,
    mixer,
    instruments: [
      {
        id: "lead/one",
        name: "Keys/Lead",
        color: "#123456",
        params: { ...DEFAULT_PARAMS },
      },
    ],
    patterns: [],
    arrangement: [],
    tracks: [],
    bpm: 120,
    zoom: { seq: { width: 1, height: 1 }, arr: { width: 1, height: 1 } },
  };
};

describe("mixer automation targets", () => {
  it("creates automation lanes with valid project IDs", () => {
    expect(isProjectId(newLane("lead/one", "tone", 0.5).id)).toBe(true);
  });

  it("returns no override before, during, and after explicit lane gaps", () => {
    const lane = {
      id: "gap",
      target: "lead/one",
      param: "tone",
      points: [
        { step: 4, value: 0.2 },
        { step: 8, value: 0.8, active: false },
        { step: 12, value: 0.6 },
      ],
    };

    expect(laneOverrideAt(lane, 0)).toBeNull();
    expect(laneOverrideAt(lane, 6)).toBe(0.5);
    expect(laneOverrideAt(lane, 8)).toBeNull();
    expect(laneOverrideAt(lane, 12)).toBe(0.6);
  });

  it("restores persisted instrument, mixer, and master values inside a gap", () => {
    const p = project();
    p.automation = [
      {
        id: "instrument-gap",
        target: "lead/one",
        param: "tone",
        points: [{ step: 4, value: 0.2, active: false }],
      },
      {
        id: "master-gap",
        target: "master",
        param: "vol",
        points: [{ step: 4, value: 0.2, active: false }],
      },
      {
        id: "mixer-gap",
        target: mixerTarget("channel", "lead/one"),
        param: "pan",
        points: [{ step: 4, value: 0.2, active: false }],
      },
    ];

    expect(instrumentOverrides(p, 4)?.get("lead/one")?.tone).toBe(
      DEFAULT_PARAMS.tone,
    );
    expect(masterAutomation(p, 4)).toEqual([{ param: "vol", value: 0.8 }]);
    expect(mixerAutomation(p, 4)).toEqual([
      {
        target: { kind: "channel", id: "lead/one" },
        param: "pan",
        value: -0.3,
      },
    ]);
  });

  it("merges only finite numeric note overrides over the automation baseline", () => {
    expect(
      withNoteOverrides(
        { ...DEFAULT_PARAMS, tone: 0.25, q: 45 },
        { tone: 0.8, q: Number.NaN },
      ),
    ).toMatchObject({ tone: 0.8, q: 45 });
  });
  it("round-trips collision-prone channel and bus ids without treating them as instruments", () => {
    for (const [kind, id] of [
      ["channel", "lead/one"],
      ["bus", "echo|bus"],
    ] as const) {
      const target = mixerTarget(kind, id);
      expect(parseMixerTarget(target)).toEqual({ kind, id });
      expect(target).not.toBe(id);
    }
    expect(parseMixerTarget("mixer|channel|%not-encoded")).toBeNull();
    expect(parseMixerTarget("lead/one")).toBeNull();
  });

  it("provides only useful continuous controls for channels and buses", () => {
    const channel = autoParams(mixerTarget("channel", "lead/one")).map(
      (def) => def.param,
    );
    const bus = autoParams(mixerTarget("bus", "echo|bus")).map(
      (def) => def.param,
    );
    expect(channel).toEqual(["volume", "pan", "reverb", "highpass", "tilt"]);
    expect(bus).toEqual([...channel, "delayTime", "feedback"]);
    expect([...channel, ...bus]).not.toContain("mute");
    expect([...channel, ...bus]).not.toContain("solo");
    expect([...channel, ...bus]).not.toContain("output");
  });

  it("resolves definitions, titles, colors, and current persisted values for every target kind", () => {
    const p = project();
    const channelLane = {
      id: "c",
      target: mixerTarget("channel", "lead/one"),
      param: "volume",
      points: [],
    };
    const busLane = {
      id: "b",
      target: mixerTarget("bus", "echo|bus"),
      param: "delayTime",
      points: [],
    };
    expect(autoParamDef(channelLane)?.label).toBe("Volume");
    expect(laneTitle(p, channelLane)).toBe("Keys/Lead channel · Volume");
    expect(laneColor(p, channelLane)).toBe("#123456");
    expect(
      automationCurrentValue(p, channelLane.target, channelLane.param),
    ).toBe(0.42);
    expect(laneTitle(p, busLane)).toBe("Echo bus · Delay Time");
    expect(automationCurrentValue(p, busLane.target, busLane.param)).toBe(0.35);
    expect(automationCurrentValue(p, "master", "vol")).toBe(0.8);
    expect(automationCurrentValue(p, "lead/one", "pan")).toBe(0);
  });

  it("extracts clamped scheduling values and ignores removed or malformed targets", () => {
    const p = project();
    p.automation = [
      {
        id: "volume",
        target: mixerTarget("channel", "lead/one"),
        param: "volume",
        points: [{ step: 0, value: 4 }],
      },
      {
        id: "feedback",
        target: mixerTarget("bus", "echo|bus"),
        param: "feedback",
        points: [{ step: 0, value: 0.55 }],
      },
      {
        id: "removed",
        target: mixerTarget("bus", "gone"),
        param: "volume",
        points: [{ step: 0, value: 1 }],
      },
      {
        id: "bad",
        target: "mixer|bus|%broken",
        param: "volume",
        points: [{ step: 0, value: 1 }],
      },
    ];
    expect(mixerAutomation(p, 0)).toEqual([
      {
        target: { kind: "channel", id: "lead/one" },
        param: "volume",
        value: 2,
      },
      {
        target: { kind: "bus", id: "echo|bus" },
        param: "feedback",
        value: 0.55,
      },
    ]);
  });
});
