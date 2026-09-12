import { describe, expect, it } from "vitest";

import { type BandRecord, VoiceBandRegistry } from "./voice-band-registry";

function record(end: number, start = 0): BandRecord {
  return {
    inst: "lead",
    bands: [{ from: 200, target: 800, q: 2, gain: 10 }],
    level: 0.8,
    start,
    end,
    release: Infinity,
    bendStart: start,
    pitchTime: 1,
    att: 1,
    dec: 1,
    sus: 0.5,
    rel: 1,
  };
}

describe("VoiceBandRegistry", () => {
  it("renders the current envelope and bent band frequency", () => {
    const registry = new VoiceBandRegistry();
    registry.add(record(Infinity), 0);

    const snapshot = registry.snapshot(0.5);
    expect(snapshot[0].env).toBe(0.5);
    expect(snapshot[0].bands[0].freq).toBe(400);
  });

  it("keeps scheduled changes out of the overlay until their audio time", () => {
    const registry = new VoiceBandRegistry();
    const scheduled = {
      ...record(Infinity),
      bands: [{ from: 200, target: 200, q: 2, gain: 10 }],
      pitchTime: 0,
    };
    registry.add(scheduled, 0);
    scheduled.bands[0].from = 800;
    scheduled.bands[0].target = 1600;
    registry.schedule(
      scheduled,
      [{ from: 800, target: 1600, q: 4, gain: 20 }],
      0.4,
      1,
      0.2,
      "ease-in",
      true,
    );

    expect(registry.snapshot(0.9)[0].bands[0].freq).toBeCloseTo(200);
    expect(registry.snapshot(1.1)[0].bands[0].freq).toBeGreaterThan(200);
    expect(registry.snapshot(1.1)[0].bands[0].freq).toBeLessThan(1600);
    expect(registry.snapshot(1.2)[0].bands[0].freq).toBeCloseTo(1600);
    expect(registry.snapshot(1.2)[0].level).toBeCloseTo(0.4);
  });

  it("rebases later transitions when an earlier event is scheduled afterwards", () => {
    const registry = new VoiceBandRegistry();
    const scheduled = {
      ...record(Infinity),
      bands: [{ from: 200, target: 200, q: 2, gain: 10 }],
      pitchTime: 0,
    };
    registry.add(scheduled, 0);

    registry.schedule(
      scheduled,
      [{ from: 800, target: 800, q: 2, gain: 10 }],
      0.8,
      2,
      1,
      "linear",
      true,
    );
    registry.schedule(
      scheduled,
      [{ from: 200, target: 400, q: 2, gain: 10 }],
      0.8,
      1,
      1,
      "linear",
      true,
    );

    expect(registry.snapshot(2)[0].bands[0].freq).toBeCloseTo(400);
    expect(registry.snapshot(2.5)[0].bands[0].freq).toBeCloseTo(
      Math.sqrt(400 * 800),
    );
  });

  it("does not interrupt a pitch bend when only a band level changes", () => {
    const registry = new VoiceBandRegistry();
    const scheduled = record(Infinity);
    registry.add(scheduled, 0);

    registry.schedule(
      scheduled,
      [{ from: 200, target: 800, q: 2, gain: 20 }],
      0.4,
      0.4,
      0.04,
    );

    expect(registry.snapshot(0.42)[0].bands[0].freq).toBeCloseTo(
      200 * Math.pow(4, 0.42),
    );
    expect(registry.snapshot(0.8)[0].bands[0].freq).toBeCloseTo(
      200 * Math.pow(4, 0.8),
    );
  });

  it("removes expired records and retains held records when full", () => {
    const registry = new VoiceBandRegistry(2);
    registry.add(record(1), 0);
    registry.add(record(Infinity), 0);
    registry.add(record(Infinity, 2), 2);

    const snapshot = registry.snapshot(2);
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].bands[0].freq).toBe(800);
  });
});
