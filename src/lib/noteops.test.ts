import { describe, expect, it } from "vitest";

import type { Note } from "./types";

import { removeInvalidLegatoLinks, updateLegatoTargets } from "./noteops";

describe("legato note edits", () => {
  it("keeps a portamento link attached when its selected notes move together", () => {
    const source: Note = {
      pitch: "C4",
      start: 0,
      len: 4,
      selected: true,
      legatoTo: { pitch: "E4", start: 4, curve: "smooth" },
    };
    const target: Note = { pitch: "E4", start: 4, len: 4, selected: true };
    const notes = [source, target];
    const originalPositions = new Map<Note, Pick<Note, "pitch" | "start">>([
      [source, { pitch: source.pitch, start: source.start }],
      [target, { pitch: target.pitch, start: target.start }],
    ]);
    const originalLegatoTargets = new Map([
      [
        source,
        { pitch: source.legatoTo!.pitch, start: source.legatoTo!.start },
      ],
    ]);

    source.pitch = "D4";
    source.start = 2;
    target.pitch = "F4";
    target.start = 6;
    updateLegatoTargets(notes, originalPositions, originalLegatoTargets);

    expect(source.legatoTo).toEqual({ pitch: "F4", start: 6, curve: "smooth" });

    source.pitch = "E4";
    source.start = 4;
    target.pitch = "G4";
    target.start = 8;
    updateLegatoTargets(notes, originalPositions, originalLegatoTargets);

    expect(source.legatoTo).toEqual({ pitch: "G4", start: 8, curve: "smooth" });
  });

  it("removes a link when its target is moved into the source note", () => {
    const source: Note = {
      pitch: "C4",
      start: 0,
      len: 4,
      legatoTo: { pitch: "E4", start: 4 },
    };
    const target: Note = { pitch: "E4", start: 3, len: 4 };

    removeInvalidLegatoLinks([source, target]);

    expect(source.legatoTo).toBeUndefined();
  });
});
