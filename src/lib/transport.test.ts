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
