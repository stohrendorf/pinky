import type { MixerState } from "./mixer";
import type { ConductorData } from "./timing";

export interface NoteInfo {
  name: string;
  freq: number;
  black: boolean;
}

/** Increment only when a project-file change intentionally breaks compatibility. */
export const PROJECT_FORMAT_VERSION = 1;

export const createId = (): string => crypto.randomUUID();

export const isProjectId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

export interface Note {
  pitch: string;
  start: number;
  len: number;
  vel?: number; // 0..1 loudness of this hit (undefined = 1, i.e. full)
  // Optional instrument values for this note only. They win over the
  // instrument's arranged automation while this voice is active.
  overrides?: NoteParamOverrides;
  selected?: boolean;
  legatoTo?: LegatoLink;
}

export type CurveShape = "hold" | "linear" | "ease-in" | "ease-out" | "smooth";

export type AutomationCurveShape = "none" | CurveShape;

export interface LegatoLink {
  pitch: string;
  start: number;
  curve?: CurveShape;
}

export interface Pattern {
  id: string;
  name: string;
  steps: number;
  color: string;
  tracks: Record<string, Note[]>;
}

export interface Track {
  name: string;
  color: string;
  mute?: boolean; // arranger lane: skip all clips on it
  solo?: boolean; // any soloed lane silences the others
}

export interface ArrangementClip {
  id: string;
  patternId: string;
  track: number;
  start: number;
  len: number;
  transpose?: number; // semitones this clip shifts its pattern by (0/undefined = as written)
  partial?: number; // optional exact harmonic multiplier (1/undefined = no multiplier)
  gain?: number; // 0..1 level multiplier for this clip (undefined = 1, i.e. full)
  selected?: boolean;
}

/* ---- automation ----
 * A lane draws one numeric parameter over the song timeline. Existing plain
 * instrument ids and the `master` target remain valid; mixer channel and bus
 * targets use the collision-safe encoding from automation.ts. */
export interface AutomationPoint {
  step: number; // position on the arranger timeline (steps)
  value: number; // parameter value in its own unit
  curve?: AutomationCurveShape; // interpolation to the following point (undefined = linear)
  // Legacy gap marker. New gaps use `curve: "none"` on the preceding point.
  active?: boolean;
}

export interface AutomationLane {
  id: string;
  target: string; // instrument id, 'master', or encoded mixer channel/bus target
  param: string; // numeric parameter valid for that target
  points: AutomationPoint[];
}

// One partial of the harmonics profile: a peaking band at
// `ratio` × fundamental with `level` (0..1) of the Tone Level gain.
export interface PartialSpec {
  ratio: number;
  level: number;
}

export interface InstrumentParams {
  tone: number;
  q: number;
  // remembered inputs of the harmonics generator (not played directly)
  harm: number;
  falloff: number;
  stretch: number;
  harmShape?: string;
  noise: number;
  noiseFreq: number;
  /* ---- formants: resonances that do NOT follow the note ----
   * Everything else in an instrument is pitch-relative (band = ratio ×
   * fundamental), so the whole spectral shape slides with the melody — the
   * signature of a pipe, not of a throat. A vocal tract has fixed
   * resonances instead: F1/F2 stay put and the harmonics move *through*
   * them. `formant` 0 = off (every instrument written before this existed). */
  formant: number; // level of the fixed bands (0 = no formants at all)
  f1: number; // Hz — first formant (jaw / vowel openness)
  f2: number; // Hz — second formant (tongue: ah/eh/ee)
  f3: number; // Hz — third formant (the "singer's" brightness)
  formantQ: number; // width of the three bands (low = broad vowel, high = nasal)
  // Vibrato: one shared LFO detunes the whole chain (cents), after a delay
  vib: number; // depth in cents (0 = off)
  vibRate: number; // Hz
  vibDelay: number; // s until the vibrato has faded in
  pitchDrop: number;
  pitchTime: number;
  noiseBend: number;
  // Unison: several slightly detuned copies of the whole chain (rank chorus —
  // organ shimmer, lush strings, supersaw)
  voices: number;
  detune: number; // full spread in cents between the outermost ranks
  att: number;
  dec: number;
  sus: number;
  rel: number;
  gain: number;
  pan: number;
  legatoCurve: CurveShape;
  // The harmonic profile that is actually played — generated from the values
  // above, then freely hand-editable (drawbars, odd-only, bell partials ...).
  partials?: PartialSpec[];
}

export type InstrumentParamKey = Extract<
  {
    [K in keyof InstrumentParams]: InstrumentParams[K] extends number
      ? K
      : never;
  }[keyof InstrumentParams],
  string
>;

export type NoteParamOverrides = Record<string, number | undefined>;

export interface Instrument {
  id: string;
  name: string;
  color: string; // identifies the instrument in the scope overlay & UI
  mute?: boolean; // not scheduled while muted
  solo?: boolean; // any soloed instrument silences the others
  params: InstrumentParams;
}

export interface Project {
  formatVersion: number;
  mixer?: MixerState;
  conductor?: ConductorData;
  instruments: Instrument[];
  patterns: Pattern[];
  arrangement: ArrangementClip[];
  tracks: Track[];
  automationPositions?: Record<string, number>;
  automationOrder?: string[];
  bpm: number;
  swing?: number; // 0..1 groove: how far every 2nd 16th is pushed (1 = triplet shuffle)
  loop?: { start: number; end: number } | null; // arranger loop region (steps)
  automation?: AutomationLane[]; // parameter curves drawn under the arranger tracks
  zoom: {
    seq: { width: number; height: number };
    arr: { width: number; height: number };
  };
}
