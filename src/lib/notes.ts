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

function noteName(midi: number): string {
  const octave = Math.floor(midi / NOTE_NAMES.length);
  return `${NOTE_NAMES[((midi % NOTE_NAMES.length) + NOTE_NAMES.length) % NOTE_NAMES.length]}${octave}`;
}

/** Resolves any representable sharp note name, including transposed playback notes outside the piano roll. */
export function noteInfoByName(name: string): NoteInfo | undefined {
  const known = noteByName[name];
  if (known) {
    return known;
  }
  const match = /^([A-G]#?)(-?\d+)$/.exec(name);
  if (!match) {
    return undefined;
  }
  const semitone = NOTE_NAMES.indexOf(match[1]);
  const octave = Number(match[2]);
  if (semitone < 0 || !Number.isSafeInteger(octave)) {
    return undefined;
  }
  const midi = octave * NOTE_NAMES.length + semitone;
  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  return Number.isFinite(freq) && freq > 0
    ? { name, freq, black: match[1].includes("#") }
    : undefined;
}

// Shift a note name by semitones. The editor shows C0..B9, but playback may
// legitimately transpose a clip beyond that visible range.
export function transposePitch(name: string, semis: number): string | null {
  if (!semis) {
    return name;
  }
  const note = noteInfoByName(name);
  if (!note || !Number.isSafeInteger(semis)) {
    return null;
  }
  const match = /^([A-G]#?)(-?\d+)$/.exec(note.name)!;
  const midi =
    Number(match[2]) * NOTE_NAMES.length + NOTE_NAMES.indexOf(match[1]);
  const target = midi + semis;
  return Number.isSafeInteger(target) && noteInfoByName(noteName(target))
    ? noteName(target)
    : null;
}

// row 0 = highest note (sequencer orientation)
export const ROW_NOTES: NoteInfo[] = [...NOTES].reverse();
export const rowOfNote: Record<string, number> = Object.fromEntries(
  ROW_NOTES.map((n, r) => [n.name, r]),
);

export const STEPS = 32;
