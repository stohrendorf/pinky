import { get } from "svelte/store";
import { afterEach, describe, expect, it } from "vitest";

import type { Note, Project } from "./types";

import { initHistory, undo } from "./history";
import {
  copySelectedNotes,
  createLegatoBetweenSelected,
  deleteNotes,
  deleteSelectedNotes,
  editStep,
  pasteNotes,
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

  it("connects every selected note only when they form a non-overlapping sequence", () => {
    const notes: Note[] = [
      { pitch: "C4", start: 0, len: 4, selected: true },
      { pitch: "E4", start: 4, len: 4, selected: true },
      { pitch: "G4", start: 8, len: 4, selected: true },
    ];
    selectNotes(notes);

    expect(createLegatoBetweenSelected()).toBe(true);
    expect(notes[0].legatoTo).toEqual({ pitch: "E4", start: 4 });
    expect(notes[1].legatoTo).toEqual({ pitch: "G4", start: 8 });

    notes[1].start = 3;
    expect(createLegatoBetweenSelected()).toBe(false);
  });

  it("fills only missing selected joins with the requested curve", () => {
    const notes: Note[] = [
      {
        pitch: "C4",
        start: 0,
        len: 4,
        selected: true,
        legatoTo: { pitch: "E4", start: 4, curve: "smooth" },
      },
      { pitch: "E4", start: 4, len: 4, selected: true },
      { pitch: "G4", start: 8, len: 4, selected: true },
    ];
    selectNotes(notes);

    expect(createLegatoBetweenSelected("ease-out")).toBe(true);
    expect(notes[0].legatoTo).toEqual({
      pitch: "E4",
      start: 4,
      curve: "smooth",
    });
    expect(notes[1].legatoTo).toEqual({
      pitch: "G4",
      start: 8,
      curve: "ease-out",
    });
  });
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

describe("note copy and paste", () => {
  function selectNotes(notes: Note[]): void {
    project.set({
      formatVersion: 1,
      bpm: 120,
      instruments: [],
      patterns: [
        {
          id: "pattern",
          name: "Pattern",
          steps: 32,
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

  it("copies selected internal legato links at the pasted positions", () => {
    const source: Note = {
      pitch: "C4",
      start: 4,
      len: 4,
      selected: true,
      legatoTo: { pitch: "E4", start: 8, curve: "smooth" },
    };
    const target: Note = { pitch: "E4", start: 8, len: 4, selected: true };
    const track = [source, target];
    selectNotes(track);
    editStep.set(16);

    expect(copySelectedNotes()).toBe(2);
    pasteNotes();

    const pasted = get(project)!.patterns[0].tracks.lead.slice(2);
    expect(get(project)!.patterns[0].tracks.lead).not.toBe(track);
    expect(pasted).toEqual([
      {
        pitch: "C4",
        start: 16,
        len: 4,
        selected: true,
        legatoTo: { pitch: "E4", start: 20, curve: "smooth" },
      },
      { pitch: "E4", start: 20, len: 4, selected: true },
    ]);
  });
});
