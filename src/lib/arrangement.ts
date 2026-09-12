import type { ArrangementClip, Note, Pattern, Track } from "./types";

import { rowOfNote } from "./notes";

const TRACK_COLORS = [
  "#53d8fb",
  "#ff9f43",
  "#ee5253",
  "#10ac84",
  "#a29bfe",
  "#f9ca24",
  "#ff6b6b",
  "#48dbfb",
];

function newArrangementTrack(index: number): Track {
  return {
    name: `Track ${index + 1}`,
    color: TRACK_COLORS[index % TRACK_COLORS.length],
  };
}

export interface PreviewNote extends Note {
  y: number;
}

// Clip previews are an overview, not a second piano roll. Keeping their detail
// bounded prevents long repeating clips from creating tens of thousands of DOM nodes.
export const MAX_CLIP_PREVIEW_NOTES = 96;

export function shouldPlacePattern(
  hasSelectedClips: boolean,
  shiftKey: boolean,
): boolean {
  return shiftKey || !hasSelectedClips;
}

export function shouldEditAutomation(hasSelectedClips: boolean): boolean {
  return !hasSelectedClips;
}

export function addArrangementTrack(tracks: Track[]): Track[] {
  return [...tracks, newArrangementTrack(tracks.length)];
}

export function insertArrangementTrack(
  tracks: Track[],
  arrangement: ArrangementClip[],
  index: number,
): {
  tracks: Track[];
  arrangement: ArrangementClip[];
} {
  const insertionIndex = Math.max(0, Math.min(index, tracks.length));
  return {
    tracks: [
      ...tracks.slice(0, insertionIndex),
      newArrangementTrack(insertionIndex),
      ...tracks.slice(insertionIndex),
    ],
    arrangement: arrangement.map((clip) =>
      clip.track >= insertionIndex ? { ...clip, track: clip.track + 1 } : clip,
    ),
  };
}

export function moveArrangementTrack(
  tracks: Track[],
  arrangement: ArrangementClip[],
  from: number,
  to: number,
): {
  tracks: Track[];
  arrangement: ArrangementClip[];
} {
  if (
    from < 0 ||
    from >= tracks.length ||
    to < 0 ||
    to > tracks.length ||
    to === from ||
    to === from + 1
  ) {
    return { tracks, arrangement };
  }

  const destination = to > from ? to - 1 : to;
  const reorderedTracks = [...tracks];
  const [track] = reorderedTracks.splice(from, 1);
  reorderedTracks.splice(destination, 0, track);

  return {
    tracks: reorderedTracks,
    arrangement: arrangement.map((clip) => {
      if (clip.track === from) {
        return { ...clip, track: destination };
      }
      if (
        from < destination &&
        clip.track > from &&
        clip.track <= destination
      ) {
        return {
          ...clip,
          track: clip.track - 1,
        };
      }
      if (
        destination < from &&
        clip.track >= destination &&
        clip.track < from
      ) {
        return {
          ...clip,
          track: clip.track + 1,
        };
      }
      return clip;
    }),
  };
}

export function removeArrangementTrack(
  tracks: Track[],
  arrangement: ArrangementClip[],
  index: number,
): {
  tracks: Track[];
  arrangement: ArrangementClip[];
} {
  if (tracks.length <= 1 || index < 0 || index >= tracks.length) {
    return { tracks, arrangement };
  }

  return {
    tracks: tracks.filter((_, trackIndex) => trackIndex !== index),
    arrangement: arrangement
      .filter((clip) => clip.track !== index)
      .map((clip) =>
        clip.track > index ? { ...clip, track: clip.track - 1 } : clip,
      ),
  };
}

/**
 * Creates the notes shown inside an arrangement clip preview.
 *
 * Pattern notes repeat until the end of the clip, while the final repetition
 * is clipped so the preview never draws outside its clip boundary. The y
 * coordinate is normalized to the pitch range used by the preview renderer.
 */
export function getPatternPreview(
  pattern: Pattern | undefined,
  clipLen: number,
  maxNotes = MAX_CLIP_PREVIEW_NOTES,
): PreviewNote[] {
  if (!pattern) {
    return [];
  }

  const patternSteps = pattern.steps || 32;
  const allNotes: Note[] = Object.values(pattern.tracks).flat();
  if (allNotes.length === 0) {
    return [];
  }

  const minPitch = Math.min(...allNotes.map((note) => rowOfNote[note.pitch]));
  const maxPitch = Math.max(...allNotes.map((note) => rowOfNote[note.pitch]));
  const range = Math.max(1, maxPitch - minPitch);
  const preview: PreviewNote[] = [];
  const notesPerCycle = Math.min(allNotes.length, maxNotes);
  const repeatCount = Math.ceil(clipLen / patternSteps);
  const visibleCycles = Math.min(
    repeatCount,
    Math.max(1, Math.floor(maxNotes / notesPerCycle)),
  );

  for (let cycleIndex = 0; cycleIndex < visibleCycles; cycleIndex++) {
    const cycle =
      visibleCycles === 1
        ? 0
        : Math.round((cycleIndex * (repeatCount - 1)) / (visibleCycles - 1));
    const offset = cycle * patternSteps;
    allNotes.slice(0, notesPerCycle).forEach((note) => {
      const start = note.start + offset;
      if (start < clipLen) {
        preview.push({
          ...note,
          start,
          len: Math.min(note.len, clipLen - start),
          y: (rowOfNote[note.pitch] - minPitch) / range,
        });
      }
    });
  }

  return preview;
}
