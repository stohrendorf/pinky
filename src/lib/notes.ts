import type { NoteInfo } from "./types";

// FL Studio convention: MIDI 60 is C5, MIDI 0 is C0. 128 notes (0-127)
const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

export const NOTES: NoteInfo[] = [];
for (let oct = 0; oct < 10; oct++) {
  for (let i = 0; i < 12; i++) {
    const midi = oct * 12 + i;
    const nn = NOTE_NAMES[i];
    NOTES.push({
      name: nn + oct,
      freq: 440 * Math.pow(2, (midi - 69) / 12),
      black: nn.includes("#"),
    });
  }
}

export const noteByName: Record<string, NoteInfo> = Object.fromEntries(
  NOTES.map((n) => [n.name, n]),
);
export const idxOfNote: Record<string, number> = Object.fromEntries(
  NOTES.map((n, i) => [n.name, i]),
);

// Shift a note name by semitones — null when it would leave the C0..B9 range
export function transposePitch(name: string, semis: number): string | null {
  if (!semis) {
    return name;
  }
  const i = idxOfNote[name];
  if (i === undefined) {
    return null;
  }
  const j = i + semis;
  return j >= 0 && j < NOTES.length ? NOTES[j].name : null;
}

// row 0 = highest note (sequencer orientation)
export const ROW_NOTES: NoteInfo[] = [...NOTES].reverse();
export const rowOfNote: Record<string, number> = Object.fromEntries(
  ROW_NOTES.map((n, r) => [n.name, r]),
);

export const STEPS = 32;
