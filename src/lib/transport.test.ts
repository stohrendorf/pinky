import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Instrument, Pattern } from "./types";

import * as engine from "./engine";
import { DEFAULT_PARAMS } from "./instruments";
import { schedulePatternNotes } from "./transport";

vi.mock("./engine", () => ({
  glideAt: vi.fn(),
  noteOffAt: vi.fn(),
  noteOnAt: vi.fn(),
}));

const lead: Instrument = {
  id: "lead",
  name: "Lead",
  color: "#fff",
  params: { ...DEFAULT_PARAMS },
};

const chainedPattern: Pattern = {
  id: "chain",
  name: "Chain",
  steps: 32,
  color: "#fff",
  tracks: {
    lead: [
      { pitch: "C4", start: 0, len: 4, legatoTo: { pitch: "D4", start: 8 } },
      { pitch: "D4", start: 8, len: 4, legatoTo: { pitch: "E4", start: 16 } },
      { pitch: "E4", start: 16, len: 4 },
    ],
  },
};

describe("pattern note scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("multiplies a clip instance's level by its note velocity", () => {
    const pattern: Pattern = {
      ...chainedPattern,
      tracks: { lead: [{ pitch: "C4", start: 0, len: 4, vel: 0.8 }] },
    };

    schedulePatternNotes(
      pattern,
      0,
      1,
      0.1,
      [lead],
      0,
      null,
      undefined,
      null,
      0.5,
    );

    expect(engine.noteOnAt).toHaveBeenCalledWith(
      "lead",
      "C4",
      1,
      lead.params,
      0.4,
    );
  });

  it("plays a transposed legato chain beyond the visible piano range", () => {
    const pattern: Pattern = {
      ...chainedPattern,
      tracks: {
        lead: [
          {
            pitch: "G8",
            start: 0,
            len: 4,
            legatoTo: { pitch: "G5", start: 8 },
          },
          { pitch: "G5", start: 8, len: 4 },
        ],
      },
    };

    schedulePatternNotes(pattern, 0, 1, 0.1, [lead], 19);

    expect(engine.noteOnAt).toHaveBeenCalledExactlyOnceWith(
      "lead",
      "D10",
      1,
      lead.params,
      1,
    );
    expect(engine.glideAt).toHaveBeenCalledWith(
      "lead",
      "D10",
      "D7",
      1.4,
      0.4,
      "linear",
    );
  });

  it("keeps exact partial ratios through transposed note-on and legato glide", () => {
    schedulePatternNotes(
      chainedPattern,
      0,
      1,
      0.1,
      [lead],
      19,
      null,
      undefined,
      "partial-3:0",
      1,
      Infinity,
      3,
    );

    expect(engine.noteOnAt).toHaveBeenCalledExactlyOnceWith(
      "lead",
      "G5",
      1,
      lead.params,
      1,
      "partial-3:0",
      3,
    );
    expect(engine.glideAt).toHaveBeenCalledWith(
      "lead",
      "G5",
      "A5",
      1.4,
      0.4,
      "linear",
      "partial-3:0",
      3,
    );
  });

  it("keeps one voice alive by scheduling each portamento transition at its source note", () => {
    schedulePatternNotes(chainedPattern, 0, 1, 0.1, [lead]);

    expect(engine.noteOnAt).toHaveBeenCalledExactlyOnceWith(
      "lead",
      "C4",
      1,
      lead.params,
      1,
    );
    expect(engine.glideAt).toHaveBeenNthCalledWith(
      1,
      "lead",
      "C4",
      "D4",
      1.4,
      0.4,
      "linear",
    );
    expect(engine.glideAt).toHaveBeenCalledTimes(1);
    expect(engine.noteOffAt).not.toHaveBeenCalled();

    schedulePatternNotes(chainedPattern, 8, 1.8, 0.1, [lead]);

    expect(engine.noteOnAt).toHaveBeenCalledTimes(1);
    expect(engine.glideAt).toHaveBeenNthCalledWith(
      2,
      "lead",
      "D4",
      "E4",
      2.2,
      0.4,
      "linear",
    );
    expect(engine.noteOffAt).not.toHaveBeenCalled();

    schedulePatternNotes(chainedPattern, 16, 2.6, 0.1, [lead]);

    expect(engine.noteOffAt).toHaveBeenCalledExactlyOnceWith("lead", "E4", 3);
  });
});
