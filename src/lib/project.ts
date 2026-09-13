// Project model — instruments, pattern bank, song arrangement + persistence
import type { Writable } from "svelte/store";

import { get, writable } from "svelte/store";

import type { Instrument, Note, Pattern, Project, Track } from "./types";

import axelFSongJson from "../../pinky-axelf.json";
import divaSongJson from "../../pinky-diva.json";
import noiseSongJson from "../../pinky-noise.json";
import toccataSongJson from "../../pinky-toccata.json";
import {
  createInstrument,
  DEFAULT_PARAMS,
  ensurePartials,
  PRESETS,
} from "./instruments";
import { createMixer, defaultChannel, isMixerState } from "./mixer";
import { buildBronzeMonsoon } from "./monsoon-demo";
import { STEPS } from "./notes";
import { buildBitHorizon, buildPocketTheory } from "./original-demos";
import { buildPromoDemo } from "./promo-demo";
import { isConductorData } from "./timing";
import { createId, isProjectId, PROJECT_FORMAT_VERSION } from "./types";
import { buildWinterDemo } from "./winter-demo";

export function createPattern(name: string, steps = STEPS): Pattern {
  const colors = [
    "#53d8fb",
    "#ff9f43",
    "#ee5253",
    "#10ac84",
    "#5f27cd",
    "#0abde3",
    "#ff6b6b",
    "#48dbfb",
  ];
  const color = colors[Math.floor(Math.random() * colors.length)];
  return { id: createId(), name, steps, color, tracks: {} };
}

export function trackNotes(pattern: Pattern, instId: string): Note[] {
  // lazily created per instrument
  if (!pattern.tracks[instId]) {
    pattern.tracks[instId] = [];
  }
  return pattern.tracks[instId];
}

/* ---- stores ---- */
export const project: Writable<Project | null> = writable(null);
export const selInstId: Writable<string | null> = writable(null);
export const selPatId: Writable<string | null> = writable(null);
export const lastPlayedPitch: Writable<string> = writable("C4");
export const playing: Writable<boolean> = writable(false);
export const playMode: Writable<string> = writable(""); // '' | 'pattern' | 'song'
export const curStep: Writable<number> = writable(-1);
export const songPos: Writable<number> = writable(-1);
export const songLabel: Writable<string> = writable("");
export const songCursor: Writable<number> = writable(0); // where song playback starts (set by clicking the playlist timeline)
export const savedAt: Writable<number> = writable(0); // timestamp of the last save (drives the toolbar feedback)

export const touch = () => project.update((p) => p);

export function renameInstrument(id: string, name: string): void {
  if (!name) {
    return;
  }
  project.update((current) => {
    if (!current?.instruments.some((instrument) => instrument.id === id)) {
      return current;
    }
    return {
      ...current,
      instruments: current.instruments.map((instrument) =>
        instrument.id === id ? { ...instrument, name } : instrument,
      ),
    };
  });
}

export function cloneInstrument(id: string): void {
  let clonedId: string | null = null;
  project.update((current) => {
    const source = current?.instruments.find(
      (instrument) => instrument.id === id,
    );
    if (!current || !source) {
      return current;
    }
    const clone = createInstrument(
      `${source.name} copy`,
      structuredClone(source.params),
    );
    clonedId = clone.id;
    return {
      ...current,
      instruments: [...current.instruments, clone],
    };
  });
  if (clonedId) {
    selInstId.set(clonedId);
  }
}

export function renamePattern(id: string, name: string): void {
  if (!name) {
    return;
  }
  project.update((current) => {
    if (!current?.patterns.some((pattern) => pattern.id === id)) {
      return current;
    }
    return {
      ...current,
      patterns: current.patterns.map((pattern) =>
        pattern.id === id ? { ...pattern, name } : pattern,
      ),
    };
  });
}

export function defaultZoom(): NonNullable<Project["zoom"]> {
  return {
    seq: { width: 24, height: 14 },
    arr: { width: 24, height: 32 },
  };
}

export function selectedInstrument(): Instrument {
  const p = get(project);
  if (!p) {
    throw new Error("Project not initialized");
  }
  return p.instruments.find((i) => i.id === get(selInstId)) || p.instruments[0];
}

/* ---- demo songs ---- */
// Demo metadata lives beside the loader registry so the picker and supported
// project IDs cannot drift apart. JSON demos can be updated by exporting them.
// Every demo earns its place with something the others do not do: the two
// covers, the noise concept piece, the vocal formant showcase, a funk groove,
// a chiptune, the trailer score, the gamelan/taiko/khoomei piece — and the
// concerto, a whole baroque string band playing from the print.
export const DEMO_LIBRARY = [
  {
    id: "axelf",
    label: "Axel F",
    icon: "fa-headphones",
    title: "Axel F (Pinky Mix) — F minor synth-funk",
  },
  {
    id: "toccata",
    label: "Toccata",
    icon: "fa-landmark",
    title: "Toccata & Fugue (Pinky Mix) — BWV 565 goes rock",
  },
  {
    id: "winter",
    label: "Winter",
    icon: "fa-snowflake",
    title:
      "Vivaldi: Winter (RV 297) — the whole concerto note for note: solo violin, strings, violone and harpsichord",
  },
  {
    id: "monsoon",
    label: "Bronze Monsoon",
    icon: "fa-cloud-showers-heavy",
    title:
      "Bronze Monsoon — gamelan kotekan, taiko in 3 against 4, shakuhachi, duduk, a bowed singing bowl and a khoomei overtone drone in a temple in the rain",
  },
  {
    id: "noise",
    label: "Out of Noise",
    icon: "fa-wind",
    title: "Out of Noise — music emerging from filtered noise",
  },
  {
    id: "diva",
    label: "Diva Machina",
    icon: "fa-microphone-lines",
    title:
      "Diva Machina — an operatic aria that turns into something no human could sing",
  },
  {
    id: "pocket",
    label: "Pocket Theory",
    icon: "fa-record-vinyl",
    title: "Pocket Theory — an original syncopated funk piece",
  },
  {
    id: "chip",
    label: "Bit Horizon",
    icon: "fa-gamepad",
    title: "Bit Horizon — an original chiptune adventure",
  },
  {
    id: "promo",
    label: "Pinky Promo",
    icon: "fa-film",
    title: "Pinky Promo — the editable trailer soundtrack",
  },
] as const;
export type DemoSong = (typeof DEMO_LIBRARY)[number]["id"];
export const activeDemo: Writable<DemoSong | null> = writable(null);

const CURRENT_PARAM_KEYS = [
  "tone",
  "q",
  "harm",
  "falloff",
  "stretch",
  "noise",
  "noiseFreq",
  "formant",
  "f1",
  "f2",
  "f3",
  "formantQ",
  "vib",
  "vibRate",
  "vibDelay",
  "pitchDrop",
  "pitchTime",
  "noiseBend",
  "voices",
  "detune",
  "att",
  "dec",
  "sus",
  "rel",
  "gain",
  "pan",
] as const;

const projectJson = (value: unknown): Project => {
  if (!isProject(value)) {
    throw new Error("Bundled demo does not match the current project format");
  }
  return value;
};

const DEMO_SONGS: Record<DemoSong, Project> = {
  axelf: projectJson(axelFSongJson),
  toccata: projectJson(toccataSongJson),
  winter: buildWinterDemo(),
  monsoon: buildBronzeMonsoon(),
  noise: projectJson(noiseSongJson),
  diva: projectJson(divaSongJson),
  pocket: buildPocketTheory(),
  chip: buildBitHorizon(),
  promo: buildPromoDemo(),
};

export function isProject(value: unknown): value is Project {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<Project>;
  return (
    candidate.formatVersion === PROJECT_FORMAT_VERSION &&
    Array.isArray(candidate.instruments) &&
    Array.isArray(candidate.patterns) &&
    Array.isArray(candidate.arrangement) &&
    Array.isArray(candidate.tracks) &&
    typeof candidate.bpm === "number" &&
    !!candidate.zoom &&
    candidate.instruments.every((instrument) => isProjectId(instrument?.id)) &&
    candidate.patterns.every((pattern) => isProjectId(pattern?.id)) &&
    candidate.arrangement.every(
      (clip) => isProjectId(clip?.id) && isProjectId(clip.patternId),
    ) &&
    (candidate.automation?.every((lane) => isProjectId(lane?.id)) ?? true) &&
    (candidate.mixer === undefined || isMixerState(candidate.mixer)) &&
    (candidate.conductor === undefined ||
      isConductorData(candidate.conductor)) &&
    candidate.instruments.every((instrument) => {
      const params = instrument?.params;
      return (
        !!params &&
        typeof params === "object" &&
        CURRENT_PARAM_KEYS.every((key) => typeof params[key] === "number") &&
        typeof params.legatoCurve === "string" &&
        Array.isArray(params.partials) &&
        params.partials.length > 0
      );
    })
  );
}

export function buildDemoProject(song: DemoSong = "axelf"): Project {
  return JSON.parse(JSON.stringify(DEMO_SONGS[song])) as Project;
}

export function newEmptyProject(): Project {
  const lead = createInstrument("Pluck", PRESETS["Pluck"]);
  const pat = createPattern("pattern 1");
  const tracks: Track[] = [{ name: "Track 1", color: "#53d8fb" }];
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    mixer: createMixer([lead.id]),
    instruments: [lead],
    patterns: [pat],
    arrangement: [
      { id: createId(), patternId: pat.id, track: 0, start: 0, len: 32 },
    ],
    tracks,
    bpm: 112,
    zoom: defaultZoom(),
  };
}

/* ---- persistence ---- */
const LS_KEY = "pinky-project-v1";

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

function projectFormatIssue(value: unknown): string {
  if (!record(value)) {
    return "the file does not contain a project object";
  }
  if (value.formatVersion !== PROJECT_FORMAT_VERSION) {
    return `it uses project format ${String(value.formatVersion)}, but this version requires ${PROJECT_FORMAT_VERSION}`;
  }
  for (const key of [
    "instruments",
    "patterns",
    "arrangement",
    "tracks",
  ] as const) {
    if (!Array.isArray(value[key])) {
      return `it is missing the ${key} list`;
    }
  }
  return "it is incomplete or contains unsupported project data";
}

function logProjectFailure(
  action: string,
  reason: string,
  error?: unknown,
): void {
  const message = `[Pinky] Could not ${action}: ${reason}.`;
  if (error) {
    // eslint-disable-next-line no-console
    console.warn(message, error);
  } else {
    // eslint-disable-next-line no-console
    console.warn(message);
  }
}

function upgradeStoredMixer(
  value: unknown,
  instrumentIds: string[],
): Project["mixer"] {
  if (!record(value)) {
    return undefined;
  }
  const fallback = createMixer(instrumentIds, false);
  const rawBuses = Array.isArray(value.buses) ? value.buses : [];
  const buses = rawBuses.filter(
    (bus): bus is Record<string, unknown> => record(bus) && isProjectId(bus.id),
  );
  const busIds = new Set(buses.map((bus) => bus.id as string));
  const channel = (source: unknown) => {
    const defaults = defaultChannel();
    if (!record(source)) {
      return defaults;
    }
    const output =
      source.output === "master" ||
      (typeof source.output === "string" && busIds.has(source.output))
        ? source.output
        : "master";
    return {
      ...defaults,
      ...source,
      output,
      compressor: record(source.compressor)
        ? { ...defaults.compressor, ...source.compressor }
        : defaults.compressor,
      sends: Array.isArray(source.sends) ? source.sends : [],
    };
  };
  const rawChannels = record(value.channels) ? value.channels : {};
  const mixer = {
    channels: Object.fromEntries(
      instrumentIds.map((id) => [id, channel(rawChannels[id])]),
    ),
    buses: buses.map((bus) => ({
      ...channel(bus),
      id: bus.id as string,
      name: typeof bus.name === "string" ? bus.name : "Bus",
      effect: bus.effect === "delay" ? "delay" : "none",
      delayTime: typeof bus.delayTime === "number" ? bus.delayTime : 0.25,
      feedback: typeof bus.feedback === "number" ? bus.feedback : 0.35,
    })),
    master: record(value.master)
      ? { ...fallback.master, ...value.master }
      : fallback.master,
  };
  return isMixerState(mixer) ? mixer : undefined;
}

function upgradeStoredProject(value: unknown): Project | null {
  if (isProject(value)) {
    return value;
  }
  if (!record(value) || value.formatVersion !== PROJECT_FORMAT_VERSION) {
    return null;
  }
  if (
    !Array.isArray(value.instruments) ||
    !Array.isArray(value.patterns) ||
    !Array.isArray(value.arrangement) ||
    !Array.isArray(value.tracks)
  ) {
    return null;
  }
  const candidate = JSON.parse(JSON.stringify(value)) as Project;
  candidate.instruments = candidate.instruments.map((instrument) => ({
    ...instrument,
    params: ensurePartials({
      ...DEFAULT_PARAMS,
      ...(record(instrument.params) ? instrument.params : {}),
    }),
  }));
  candidate.arrangement = candidate.arrangement.map((clip) => ({
    ...clip,
    // Clip IDs are internal selection keys and were not always UUIDs.
    id: isProjectId(clip.id) ? clip.id : createId(),
  }));
  const automationIds = new Map<string, string>();
  candidate.automation = candidate.automation?.map((lane) => {
    const id = isProjectId(lane.id) ? lane.id : createId();
    automationIds.set(lane.id, id);
    return { ...lane, id };
  });
  if (automationIds.size) {
    candidate.automationOrder = candidate.automationOrder?.map(
      (id) => automationIds.get(id) ?? id,
    );
    candidate.automationPositions = candidate.automationPositions
      ? Object.fromEntries(
          Object.entries(candidate.automationPositions).map(
            ([id, position]) => [automationIds.get(id) ?? id, position],
          ),
        )
      : undefined;
  }
  if (candidate.mixer !== undefined) {
    candidate.mixer = upgradeStoredMixer(
      candidate.mixer,
      candidate.instruments.map((instrument) => instrument.id),
    );
  }
  return isProject(candidate) ? candidate : null;
}

function needsCompatibilityUpgrade(value: unknown): boolean {
  if (
    !record(value) ||
    value.formatVersion !== PROJECT_FORMAT_VERSION ||
    !Array.isArray(value.instruments) ||
    !Array.isArray(value.arrangement)
  ) {
    return false;
  }
  return (
    value.instruments.some(
      (instrument) =>
        record(instrument) &&
        record(instrument.params) &&
        (typeof instrument.params.noiseBend !== "number" ||
          !Array.isArray(instrument.params.partials)),
    ) ||
    value.arrangement.some((clip) => record(clip) && !isProjectId(clip.id)) ||
    (Array.isArray(value.automation) &&
      value.automation.some((lane) => record(lane) && !isProjectId(lane.id)))
  );
}

export function saveProject(): boolean {
  const cur = get(project);
  if (!cur) {
    logProjectFailure("save the project", "there is no active project");
    return false;
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(cur);
  } catch (error) {
    logProjectFailure("save the project", "it could not be serialized", error);
    return false;
  }
  try {
    localStorage.setItem(LS_KEY, serialized);
  } catch (error) {
    logProjectFailure(
      "save the project",
      "browser storage is unavailable",
      error,
    );
    return false;
  }
  savedAt.set(Date.now());
  return true;
}

export function loadSavedProject(): Project | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(LS_KEY);
  } catch (error) {
    logProjectFailure(
      "read the browser save",
      "browser storage is unavailable",
      error,
    );
    return null;
  }
  if (!raw) {
    return null;
  }

  let saved: unknown;
  try {
    saved = JSON.parse(raw) as unknown;
  } catch (error) {
    logProjectFailure("load the browser save", "its JSON is invalid", error);
    return null;
  }
  const upgraded = upgradeStoredProject(saved);
  if (!upgraded) {
    logProjectFailure("load the browser save", projectFormatIssue(saved));
    return null;
  }
  if (!isProject(saved)) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(upgraded));
    } catch (error) {
      logProjectFailure(
        "update the compatible browser save",
        "browser storage is unavailable",
        error,
      );
    }
  }
  return upgraded;
}

export function restoreSavedProject(): boolean {
  const saved = loadSavedProject();
  if (!saved) {
    return false;
  }
  activeDemo.set(null);
  project.set(saved);
  selInstId.set(saved.instruments[0].id);
  selPatId.set(saved.patterns[0].id);
  lastPlayedPitch.set("C4");
  songCursor.set(0);
  return true;
}

/* ---- import / export ---- */
export function exportProject(): void {
  const cur = get(project);
  if (!cur) {
    return;
  }
  const blob = new Blob([JSON.stringify(cur, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pinky-song.json";
  a.click();
  URL.revokeObjectURL(url);
}

export function importProject(json: string): boolean {
  // returns true on success
  let p: unknown;
  try {
    p = JSON.parse(json) as unknown;
  } catch (error) {
    logProjectFailure("import the song", "its JSON is invalid", error);
    return false;
  }
  const imported = isProject(p)
    ? p
    : needsCompatibilityUpgrade(p)
      ? upgradeStoredProject(p)
      : null;
  if (!imported) {
    logProjectFailure("import the song", projectFormatIssue(p));
    return false;
  }
  activeDemo.set(null);
  project.set(imported);
  selInstId.set(imported.instruments[0].id);
  selPatId.set(imported.patterns[0].id);
  lastPlayedPitch.set("C4");
  songCursor.set(0); // a stale cursor from the previous song may sit past the new song's end
  return true;
}

/* ---- init ---- */
export function initProject(): void {
  const saved = loadSavedProject();
  const p = saved || buildDemoProject();
  activeDemo.set(saved ? null : "axelf");
  project.set(p);
  selInstId.set(p.instruments[0].id);
  selPatId.set(p.patterns[0].id);
  lastPlayedPitch.set("C4");
}

export function loadDemoProject(song: DemoSong = "axelf"): void {
  const p = buildDemoProject(song);
  activeDemo.set(song);
  project.set(p);
  selInstId.set(p.instruments[0].id);
  selPatId.set(p.patterns[0].id);
  lastPlayedPitch.set("C4");
  songCursor.set(0);
}
