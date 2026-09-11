import { afterEach, describe, expect, it, vi } from "vitest";

import type { MarkerDraft } from "./conductor-markers";
import type {
  ConductorData,
  MeterMarker,
  SectionMarker,
  TempoMarker,
} from "./timing";

import {
  markerPoints,
  moveMarkerAt,
  removeMarkerAt,
  updateMarkerAt,
} from "./conductor-markers";
import { isConductorData } from "./timing";
import * as types from "./types";

const empty = (): ConductorData => ({ tempos: [], meters: [], sections: [] });
const draft = (fields: Partial<MarkerDraft> = {}): MarkerDraft => ({
  name: "",
  bpm: undefined,
  curve: "hold",
  signature: "",
  ...fields,
});
const tempo = (step: number, bpm = 120): TempoMarker => ({
  id: types.createId(),
  step,
  bpm,
  curve: "hold",
});
const meter = (step: number): MeterMarker => ({
  id: types.createId(),
  step,
  numerator: 7,
  denominator: 8,
});
const section = (step: number): SectionMarker => ({
  id: types.createId(),
  step,
  name: "Verse",
});
const kinds = ["tempos", "meters", "sections"] as const;
const group = (step = 16): ConductorData => ({
  tempos: [tempo(step)],
  meters: [meter(step)],
  sections: [section(step)],
});
const checked = (data: ConductorData): ConductorData => {
  expect(isConductorData(data)).toBe(true);
  return data;
};
const frozen = (data: ConductorData): ConductorData => {
  for (const kind of kinds) {
    for (const marker of data[kind]) {
      Object.freeze(marker);
    }
    Object.freeze(data[kind]);
  }
  Object.freeze(data);
  return checked(data);
};
const full = (length = 512): ConductorData => ({
  tempos: Array.from({ length }, (_, step) => tempo(step)),
  meters: Array.from({ length }, (_, step) => meter(step)),
  sections: Array.from({ length }, (_, step) => section(step)),
});
const invalidSteps = [-1, 0.5, NaN, Infinity, -Infinity, 1_000_001];
const signatureError =
  "Use a time signature such as 7/8 (1–32 beats; unit 1, 2, 4, 8 or 16).";

afterEach(() => vi.restoreAllMocks());

describe("markerPoints", () => {
  it("returns no points for empty conductor data", () => {
    expect(markerPoints(frozen(empty()))).toEqual([]);
  });

  it("groups all kinds, preserving every ID and marker reference with title ID priority", () => {
    const data = frozen(group());
    const points = markerPoints(data);
    expect(points).toEqual([
      {
        id: data.sections[0].id,
        step: 16,
        tempo: data.tempos[0],
        meter: data.meters[0],
        section: data.sections[0],
      },
    ]);
    expect(points[0].tempo).toBe(data.tempos[0]);
    expect(points[0].meter).toBe(data.meters[0]);
    expect(points[0].section).toBe(data.sections[0]);
    expect(markerPoints(data)[0]).not.toBe(points[0]);
  });

  it("sorts partial groups across the entire range with tempo then meter ID fallback", () => {
    const data = frozen({
      tempos: [tempo(16), tempo(64)],
      meters: [meter(0), meter(16)],
      sections: [section(1_000_000)],
    });
    expect(markerPoints(data)).toEqual([
      { id: data.meters[0].id, step: 0, meter: data.meters[0] },
      {
        id: data.tempos[0].id,
        step: 16,
        tempo: data.tempos[0],
        meter: data.meters[1],
      },
      { id: data.tempos[1].id, step: 64, tempo: data.tempos[1] },
      { id: data.sections[0].id, step: 1_000_000, section: data.sections[0] },
    ]);
  });
});

describe("updateMarkerAt", () => {
  it("inserts all fields at new steps, keeping each kind sorted including both bounds", () => {
    let data = frozen(empty());
    for (const step of [1_000_000, 16, 0, 512]) {
      data = checked(
        updateMarkerAt(
          frozen(data),
          step,
          draft({
            name: "Chorus",
            bpm: 132,
            curve: "linear",
            signature: "3/4",
          }),
        ),
      );
    }
    for (const kind of kinds) {
      expect(data[kind].map((marker) => marker.step)).toEqual([
        0, 16, 512, 1_000_000,
      ]);
    }
    expect(data.tempos[0]).toMatchObject({ bpm: 132, curve: "linear" });
    expect(data.meters[0]).toMatchObject({ numerator: 3, denominator: 4 });
    expect(data.sections[0].name).toBe("Chorus");
  });

  it("accepts tempo bounds and fractional BPM with both curves", () => {
    for (const bpm of [30, 120.5, 300]) {
      for (const curve of ["hold", "linear"] as const) {
        const result = checked(
          updateMarkerAt(frozen(empty()), 0, draft({ bpm, curve })),
        );
        expect(result.tempos[0]).toMatchObject({ bpm, curve });
        expect(result.sections).toEqual([]);
      }
    }
  });

  it("parses whitespace, leading zeros, numerator bounds and every allowed signature unit", () => {
    for (const denominator of [1, 2, 4, 8, 16]) {
      for (const numerator of [1, 7, 32]) {
        const result = checked(
          updateMarkerAt(
            frozen(empty()),
            0,
            draft({ signature: ` \t0${numerator} \t/ 0${denominator}\n ` }),
          ),
        );
        expect(result.meters[0]).toMatchObject({ numerator, denominator });
        expect(result.tempos).toEqual([]);
        expect(result.sections).toEqual([]);
      }
    }
  });

  it("trims titles before checking the 80-character limit and preserves interior spaces", () => {
    for (const name of ["  First  Verse \n", ` \t${"x".repeat(80)}  `]) {
      const result = checked(
        updateMarkerAt(frozen(empty()), 0, draft({ name })),
      );
      expect(result.sections[0].name).toBe(name.trim());
      expect(result.tempos).toEqual([]);
      expect(result.meters).toEqual([]);
    }
  });

  it("persists and re-edits a generic title for all-blank fields, preserving an existing title ID", () => {
    const generic = checked(
      updateMarkerAt(
        frozen(empty()),
        16,
        draft({ name: " \t", signature: "\n " }),
      ),
    );
    expect(generic.sections[0].name).toBe("Marker");
    const repeated = checked(updateMarkerAt(frozen(generic), 16, draft()));
    expect(repeated).toEqual(generic);
    expect(repeated.sections[0]).not.toBe(generic.sections[0]);
    const data = frozen(group());
    const result = checked(updateMarkerAt(data, 16, draft()));
    expect(result).toEqual({
      ...empty(),
      sections: [{ ...data.sections[0], name: "Marker" }],
    });
  });

  it("omits a blank title whenever tempo or signature remains", () => {
    for (const fields of [
      { bpm: 120 },
      { signature: "7/8" },
      { bpm: 120, signature: "7/8" },
    ]) {
      const result = checked(
        updateMarkerAt(frozen(group()), 16, draft({ name: " \n ", ...fields })),
      );
      expect(result.sections).toEqual([]);
      expect(result.tempos).toHaveLength("bpm" in fields ? 1 : 0);
      expect(result.meters).toHaveLength("signature" in fields ? 1 : 0);
    }
  });

  it("atomically edits every kind with stable IDs, fresh changed objects and untouched neighbors", () => {
    const data = group();
    data.tempos.unshift(tempo(0));
    data.meters.push(meter(64));
    data.sections.push(section(96));
    const before = structuredClone(data);
    const fields = Object.freeze(
      draft({ name: " Bridge ", bpm: 90, curve: "linear", signature: "5/16" }),
    );
    const result = checked(updateMarkerAt(frozen(data), 16, fields));
    expect(data).toEqual(before);
    expect(result).not.toBe(data);
    expect(result.tempos[0]).toBe(data.tempos[0]);
    expect(result.meters[1]).toBe(data.meters[1]);
    expect(result.sections[1]).toBe(data.sections[1]);
    for (const kind of kinds) {
      expect(result[kind]).not.toBe(data[kind]);
      const old = data[kind].find((marker) => marker.step === 16);
      const updated = result[kind].find((marker) => marker.step === 16);
      expect(updated?.id).toBe(old?.id);
      expect(updated).not.toBe(old);
    }
    expect(result.tempos[1]).toMatchObject({ bpm: 90, curve: "linear" });
    expect(result.meters[0]).toMatchObject({ numerator: 5, denominator: 16 });
    expect(result.sections[0].name).toBe("Bridge");
  });

  it("removes unspecified kinds together without affecting entries at other steps", () => {
    const data = frozen({
      tempos: [tempo(0), tempo(16)],
      meters: [meter(16), meter(32)],
      sections: [section(16), section(64)],
    });
    for (const fields of [
      { name: "Title" },
      { bpm: 150 },
      { signature: "4/4" },
    ]) {
      const result = checked(updateMarkerAt(data, 16, draft(fields)));
      expect(result.tempos.filter((marker) => marker.step !== 16)).toEqual([
        data.tempos[0],
      ]);
      expect(result.meters.filter((marker) => marker.step !== 16)).toEqual([
        data.meters[1],
      ]);
      expect(result.sections.filter((marker) => marker.step !== 16)).toEqual([
        data.sections[1],
      ]);
      expect(result.tempos.some((marker) => marker.step === 16)).toBe(
        "bpm" in fields,
      );
      expect(result.meters.some((marker) => marker.step === 16)).toBe(
        "signature" in fields,
      );
      expect(result.sections.some((marker) => marker.step === 16)).toBe(
        "name" in fields,
      );
    }
  });

  it("extends any partial group while retaining its existing per-kind ID", () => {
    const original = group();
    for (const kind of kinds) {
      const data = frozen({ ...empty(), [kind]: original[kind] });
      const result = checked(
        updateMarkerAt(
          data,
          16,
          draft({ name: "Full", bpm: 140, signature: "3/8" }),
        ),
      );
      expect(result[kind][0].id).toBe(data[kind][0].id);
      for (const outputKind of kinds) {
        expect(result[outputKind]).toHaveLength(1);
      }
    }
  });

  it("rejects invalid tempos without changing any part of the group", () => {
    const data = frozen(group());
    const before = structuredClone(data);
    for (const bpm of [0, 29.99, 300.01, NaN, Infinity, -Infinity]) {
      expect(() =>
        updateMarkerAt(
          data,
          16,
          draft({ name: "Changed", bpm, signature: "4/4" }),
        ),
      ).toThrow(new Error("Tempo must be from 30 to 300 BPM."));
    }
    expect(data).toEqual(before);
  });

  it("rejects malformed and out-of-range signatures atomically", () => {
    const data = frozen(group());
    const before = structuredClone(data);
    for (const signature of [
      "7",
      "7/",
      "/8",
      "7:8",
      "7/8/4",
      "7.5/8",
      "7/8.0",
      "+7/8",
      "-7/8",
      "1e1/8",
      "0/4",
      "33/4",
      "7/0",
      "7/3",
      "7/32",
      "7/-8",
      "7/8x",
      "1 2/4",
      `${"9".repeat(400)}/4`,
    ]) {
      expect(() =>
        updateMarkerAt(
          data,
          16,
          draft({
            name: "Changed",
            bpm: 150,
            signature,
          }),
        ),
      ).toThrow(new Error(signatureError));
    }
    expect(data).toEqual(before);
  });

  it("rejects overlong titles without modifying existing data", () => {
    const data = frozen(group());
    const before = structuredClone(data);
    expect(() =>
      updateMarkerAt(data, 16, draft({ name: ` ${"x".repeat(81)} ` })),
    ).toThrow(new Error("Title must be at most 80 characters."));
    expect(data).toEqual(before);
  });

  it("validates the curve even when no tempo is requested", () => {
    const data = frozen(group());
    for (const bpm of [undefined, 120]) {
      expect(() =>
        updateMarkerAt(
          data,
          16,
          draft({ bpm, curve: "smooth" as MarkerDraft["curve"] }),
        ),
      ).toThrow(new Error("Tempo curve must be hold or linear."));
    }
  });

  it("rejects invalid edit positions", () => {
    const data = frozen(group());
    for (const step of invalidSteps) {
      expect(() => updateMarkerAt(data, step, draft())).toThrow(/whole step/);
    }
  });

  it("retries UUID collisions across all existing kinds and IDs allocated during this edit", () => {
    const data = frozen(group());
    const fresh = [types.createId(), types.createId(), types.createId()];
    const createId = vi
      .spyOn(types, "createId")
      .mockReturnValueOnce(data.tempos[0].id)
      .mockReturnValueOnce(data.meters[0].id)
      .mockReturnValueOnce(data.sections[0].id)
      .mockReturnValueOnce(fresh[0])
      .mockReturnValueOnce(fresh[0])
      .mockReturnValueOnce(fresh[1])
      .mockReturnValueOnce(fresh[1])
      .mockReturnValueOnce(fresh[2]);
    const result = checked(
      updateMarkerAt(
        data,
        32,
        draft({ name: "New", bpm: 120, signature: "7/8" }),
      ),
    );
    const ids = kinds.map((kind) => result[kind][1].id);
    expect(new Set(ids)).toEqual(new Set(fresh));
    expect(ids.every(types.isProjectId)).toBe(true);
    expect(createId).toHaveBeenCalledTimes(8);
  });

  it("does not reuse the ID of a kind removed in the same edit", () => {
    const data = frozen({ ...empty(), sections: [section(16)] });
    const id = types.createId();
    vi.spyOn(types, "createId")
      .mockReturnValueOnce(data.sections[0].id)
      .mockReturnValueOnce(id);
    const result = checked(updateMarkerAt(data, 16, draft({ bpm: 120 })));
    expect(result.tempos[0].id).toBe(id);
    expect(result.sections).toEqual([]);
  });

  it("validates all draft fields before allocating any UUIDs", () => {
    const data = frozen(empty());
    const createId = vi.spyOn(types, "createId");
    for (const fields of [
      { name: "x".repeat(81) },
      { bpm: NaN },
      {
        bpm: 120,
        signature: "invalid",
      },
      { curve: "smooth" as MarkerDraft["curve"] },
    ]) {
      expect(() => updateMarkerAt(data, 16, draft(fields))).toThrow(Error);
    }
    expect(createId).not.toHaveBeenCalled();
  });

  it.each(kinds)(
    "rejects a 513th %s entry before creating IDs or applying other fields",
    (kind) => {
      const all = full();
      const data = frozen({ ...empty(), [kind]: all[kind] });
      const before = structuredClone(data);
      const createId = vi.spyOn(types, "createId");
      expect(() =>
        updateMarkerAt(
          data,
          1000,
          draft({
            name: "New",
            bpm: 120,
            signature: "7/8",
          }),
        ),
      ).toThrow(/at most 512/);
      expect(createId).not.toHaveBeenCalled();
      expect(data).toEqual(before);
    },
  );

  it("allows exactly 512 entries in each kind and edits or removes fields at capacity", () => {
    const data = checked(
      updateMarkerAt(
        frozen(full(511)),
        511,
        draft({ name: "Last", bpm: 120, signature: "7/8" }),
      ),
    );
    for (const kind of kinds) {
      expect(data[kind]).toHaveLength(512);
    }
    const createId = vi.spyOn(types, "createId");
    const edited = checked(
      updateMarkerAt(
        frozen(data),
        256,
        draft({ name: "Changed", bpm: 150, signature: "3/4" }),
      ),
    );
    for (const kind of kinds) {
      expect(edited[kind]).toHaveLength(512);
      expect(edited[kind][256].id).toBe(data[kind][256].id);
    }
    const reduced = checked(updateMarkerAt(frozen(edited), 256, draft()));
    expect(reduced.tempos).toHaveLength(511);
    expect(reduced.meters).toHaveLength(511);
    expect(reduced.sections).toHaveLength(512);
    expect(createId).not.toHaveBeenCalled();
  });

  it("counts generic titles against the cap but not blank titles with timing", () => {
    const data = frozen({ ...empty(), sections: full().sections });
    expect(() => updateMarkerAt(data, 1000, draft())).toThrow(
      /at most 512 titles/,
    );
    const result = checked(updateMarkerAt(data, 1000, draft({ bpm: 120 })));
    expect(result.sections).toEqual(data.sections);
    expect(result.tempos).toHaveLength(1);
  });
});

describe("removeMarkerAt", () => {
  it("removes the whole group atomically and retains other markers and their references", () => {
    const data = frozen({
      tempos: [tempo(0), tempo(16)],
      meters: [meter(16), meter(32)],
      sections: [section(16), section(1_000_000)],
    });
    const before = structuredClone(data);
    const result = checked(removeMarkerAt(data, 16));
    expect(result).toEqual({
      tempos: [data.tempos[0]],
      meters: [data.meters[1]],
      sections: [data.sections[1]],
    });
    expect(result.tempos[0]).toBe(data.tempos[0]);
    expect(result.meters[0]).toBe(data.meters[1]);
    expect(result.sections[0]).toBe(data.sections[1]);
    expect(data).toEqual(before);
    for (const kind of kinds) {
      expect(result[kind]).not.toBe(data[kind]);
    }
  });

  it("removes any partial group, including markers at both bounds", () => {
    for (const step of [0, 1_000_000]) {
      const all = group(step);
      for (const kind of kinds) {
        const data = frozen({ ...empty(), [kind]: all[kind] });
        expect(checked(removeMarkerAt(data, step))).toEqual(empty());
      }
    }
  });

  it("leaves missing steps and empty data intact without sharing returned arrays", () => {
    for (const data of [frozen(empty()), frozen(group())]) {
      const result = checked(removeMarkerAt(data, 32));
      expect(result).toEqual(data);
      expect(result).not.toBe(data);
      for (const kind of kinds) {
        expect(result[kind]).not.toBe(data[kind]);
      }
    }
  });

  it("rejects invalid removal positions", () => {
    const data = frozen(group());
    for (const step of invalidSteps) {
      expect(() => removeMarkerAt(data, step)).toThrow(/whole step/);
    }
  });
});

describe("moveMarkerAt", () => {
  it("moves all kinds together in either direction with stable IDs, values and untouched neighbors", () => {
    const data = group();
    data.tempos[0].curve = "linear";
    data.tempos.unshift(tempo(8));
    data.meters.push(meter(32));
    data.sections.push(section(64));
    const before = structuredClone(data);
    frozen(data);
    for (const to of [0, 1_000_000]) {
      const result = checked(moveMarkerAt(data, 16, to));
      expect(markerPoints(result).some((point) => point.step === 16)).toBe(
        false,
      );
      for (const kind of kinds) {
        expect(result[kind]).not.toBe(data[kind]);
        for (const original of data[kind]) {
          const moved = result[kind].find(
            (marker) => marker.id === original.id,
          );
          expect(moved).toEqual({
            ...original,
            step: original.step === 16 ? to : original.step,
          });
          if (original.step === 16) {
            expect(moved).not.toBe(original);
          } else {
            expect(moved).toBe(original);
          }
        }
      }
      expect(data).toEqual(before);
    }
  });

  it("returns the exact input for an existing same-step move", () => {
    const data = frozen(group());
    expect(checked(moveMarkerAt(data, 16, 16))).toBe(data);
  });

  it("merges every disjoint combination without losing source or destination entries", () => {
    for (let mask = 1; mask < 7; mask++) {
      const all = group();
      const data = frozen({
        tempos: [{ ...all.tempos[0], step: mask & 1 ? 16 : 32 }],
        meters: [{ ...all.meters[0], step: mask & 2 ? 16 : 32 }],
        sections: [{ ...all.sections[0], step: mask & 4 ? 16 : 32 }],
      });
      const before = structuredClone(data);
      const result = checked(moveMarkerAt(data, 16, 32));
      expect(markerPoints(result)).toHaveLength(1);
      for (const kind of kinds) {
        expect(result[kind]).toEqual([{ ...data[kind][0], step: 32 }]);
        if (data[kind][0].step === 32) {
          expect(result[kind][0]).toBe(data[kind][0]);
        }
      }
      expect(data).toEqual(before);
    }
  });

  it.each([
    ["tempos", "tempo"],
    ["meters", "time-signature"],
    ["sections", "title"],
  ] as const)(
    "rejects a %s collision even for equal values without moving other kinds",
    (kind, label) => {
      const all = group();
      const data = frozen({
        ...all,
        [kind]: [
          all[kind][0],
          { ...all[kind][0], id: types.createId(), step: 32 },
        ],
      });
      const before = structuredClone(data);
      expect(() => moveMarkerAt(data, 16, 32)).toThrow(
        new Error(
          `There is already a ${label} change here. Drop beside it instead.`,
        ),
      );
      expect(data).toEqual(before);
    },
  );

  it("rejects a missing source even if the destination or same-step target exists only elsewhere", () => {
    for (const data of [frozen(empty()), frozen(group())]) {
      for (const to of [16, 32]) {
        expect(() => moveMarkerAt(data, 32, to)).toThrow(
          new Error("This marker no longer exists."),
        );
      }
    }
  });

  it("validates both positions, including invalid same-step moves", () => {
    const data = frozen(group());
    for (const step of invalidSteps) {
      expect(() => moveMarkerAt(data, 16, step)).toThrow(/whole step/);
      expect(() => moveMarkerAt(data, step, 16)).toThrow(/whole step/);
      expect(() => moveMarkerAt(data, step, step)).toThrow(/whole step/);
    }
  });

  it("moves a group at capacity without allocating IDs or changing counts", () => {
    const data = frozen(full());
    const createId = vi.spyOn(types, "createId");
    const result = checked(moveMarkerAt(data, 0, 1_000_000));
    for (const kind of kinds) {
      expect(result[kind]).toHaveLength(512);
      expect(result[kind][511]).toEqual({ ...data[kind][0], step: 1_000_000 });
    }
    expect(createId).not.toHaveBeenCalled();
  });
});
