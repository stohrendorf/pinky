import { get } from "svelte/store";
import { afterEach, describe, expect, it } from "vitest";

import type { Note, Project } from "./types";

import { initHistory, undo } from "./history";
import {
  deleteNotes,
  deleteSelectedNotes,
  removeInvalidLegatoLinks,
  shouldPlaceNote,
  updateLegatoTargets,
} from "./noteops";
import { project, selInstId, selPatId } from "./project";

const originalProject = get(project);
const originalInstrumentId = get(selInstId);
const originalPatternId = get(selPatId);

afterEach(() => {
  project.set(originalProject);
  selInstId.set(originalInstrumentId);
  selPatId.set(originalPatternId);
});

describe("shouldPlaceNote", () => {
  it("uses the first plain click to clear an existing note selection", () => {
    expect(shouldPlaceNote(true, false)).toBe(false);
  });

  it("places a note without a selection or with shift held", () => {
    expect(shouldPlaceNote(false, false)).toBe(true);
    expect(shouldPlaceNote(true, true)).toBe(true);
  });
});

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

describe("note deletion", () => {
  function selectNotes(notes: Note[]): void {
    project.set({
      formatVersion: 1,
      bpm: 120,
      instruments: [],
      patterns: [
        {
          id: "pattern",
          name: "Pattern",
          steps: 16,
          color: "#fff",
          tracks: { lead: notes },
        },
      ],
      arrangement: [],
      tracks: [],
      zoom: {
        seq: { width: 24, height: 14 },
        arr: { width: 24, height: 32 },
      },
    } satisfies Project);
    selPatId.set("pattern");
    selInstId.set("lead");
  }

  it("replaces the current track when deleting selected notes", () => {
    const deleted: Note = { pitch: "C4", start: 0, len: 1, selected: true };
    const kept: Note = { pitch: "D4", start: 1, len: 1 };
    const track = [deleted, kept];
    selectNotes(track);
    const currentProject = get(project);

    deleteSelectedNotes();

    expect(get(project)?.patterns[0].tracks.lead).toEqual([kept]);
    expect(get(project)?.patterns[0].tracks.lead).not.toBe(track);
    expect(get(project)).toBe(currentProject);
  });

  it("replaces the current track when removing a note by drag", () => {
    const deleted: Note = { pitch: "C4", start: 0, len: 1, selected: true };
    const kept: Note = { pitch: "D4", start: 1, len: 1 };
    const track = [deleted, kept];
    selectNotes(track);
    const currentProject = get(project);

    deleteNotes([deleted]);

    expect(get(project)?.patterns[0].tracks.lead).toEqual([kept]);
    expect(get(project)?.patterns[0].tracks.lead).not.toBe(track);
    expect(get(project)).toBe(currentProject);
  });

  it("restores deleted notes through undo", () => {
    const deleted: Note = { pitch: "C4", start: 0, len: 1, selected: true };
    const kept: Note = { pitch: "D4", start: 1, len: 1 };
    selectNotes([deleted, kept]);
    initHistory();

    deleteSelectedNotes();
    undo();

    expect(get(project)?.patterns[0].tracks.lead).toEqual([
      { pitch: "C4", start: 0, len: 1 },
      kept,
    ]);
  });
});
