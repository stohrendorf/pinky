import type {
  AutomationLane,
  AutomationPoint,
  CurveShape,
  InstrumentParams,
  Project,
} from "./types";

/* Automation — parameter curves over the song timeline.
 * A lane owns a list of points (step -> value); the value between two points is
 * shaped by its outgoing point, before the first / after the last point it is held.
 * The scheduler reads every lane once per 16th step: instrument lanes produce a
 * patched copy of the instrument's params for the notes starting on that step,
 * master lanes are ramped straight onto the master AudioParams. */
import { INSTRUMENT_PANELS, MASTER_SLIDERS } from "./instruments";

export const MASTER_TARGET = "master";
const MIXER_TARGET_PREFIX = "mixer|";

export type MixerTargetKind = "channel" | "bus";

export interface ParsedMixerTarget {
  kind: MixerTargetKind;
  id: string;
}

export function mixerTarget(kind: MixerTargetKind, id: string): string {
  return `${MIXER_TARGET_PREFIX}${kind}|${encodeURIComponent(id)}`;
}

export function parseMixerTarget(target: string): ParsedMixerTarget | null {
  const match = /^mixer\|(channel|bus)\|(.+)$/.exec(target);
  if (!match) {
    return null;
  }
  try {
    const id = decodeURIComponent(match[2]);
    return id && mixerTarget(match[1] as MixerTargetKind, id) === target
      ? { kind: match[1] as MixerTargetKind, id }
      : null;
  } catch {
    return null;
  }
}

export const CURVE_SHAPES: { id: CurveShape; label: string }[] = [
  { id: "hold", label: "Hold" },
  { id: "linear", label: "Linear" },
  { id: "ease-in", label: "Ease in" },
  { id: "ease-out", label: "Ease out" },
  { id: "smooth", label: "Smooth" },
];

export function segmentProgress(
  curve: CurveShape | undefined,
  progress: number,
): number {
  const t = Math.max(0, Math.min(1, progress));
  switch (curve || "linear") {
    case "hold":
      return t < 1 ? 0 : 1;
    case "ease-in":
      return t * t;
    case "ease-out":
      return 1 - (1 - t) * (1 - t);
    case "smooth":
      return t * t * (3 - 2 * t);
    default:
      return t;
  }
}

export interface AutoParamDef {
  param: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export interface AutoParamGroup {
  title: string;
  params: AutoParamDef[];
}

// Preserve the instrument editor's logical panels in the automation chooser.
export const INSTRUMENT_AUTO_GROUPS: AutoParamGroup[] = INSTRUMENT_PANELS.map(
  (group) => ({
    title: group.title,
    params: group.sliders.map((s) => ({
      param: s.id,
      label: s.label,
      min: s.min,
      max: s.max,
      step: s.step,
      unit: s.unit,
    })),
  }),
);
export const INSTRUMENT_AUTO_PARAMS: AutoParamDef[] =
  INSTRUMENT_AUTO_GROUPS.flatMap((group) => group.params);

export const MASTER_AUTO_PARAMS: AutoParamDef[] = MASTER_SLIDERS.map((s) => ({
  param: s.id,
  label: s.label,
  min: s.min,
  max: s.max,
  step: s.step,
  unit: s.unit,
}));

export const MIXER_CHANNEL_AUTO_PARAMS: AutoParamDef[] = [
  { param: "volume", label: "Volume", min: 0, max: 2, step: 0.01 },
  { param: "pan", label: "Pan", min: -1, max: 1, step: 0.01 },
  { param: "reverb", label: "Reverb Send", min: 0, max: 1, step: 0.01 },
  {
    param: "highpass",
    label: "High-pass",
    min: 20,
    max: 1000,
    step: 1,
    unit: "Hz",
  },
  { param: "tilt", label: "Tilt", min: -12, max: 12, step: 0.1, unit: "dB" },
];

export const MIXER_BUS_AUTO_PARAMS: AutoParamDef[] = [
  ...MIXER_CHANNEL_AUTO_PARAMS,
  {
    param: "delayTime",
    label: "Delay Time",
    min: 0.02,
    max: 2,
    step: 0.01,
    unit: "s",
  },
  { param: "feedback", label: "Delay Feedback", min: 0, max: 0.8, step: 0.01 },
];

type NumericInstrumentParam = {
  [K in keyof InstrumentParams]: InstrumentParams[K] extends number ? K : never;
}[keyof InstrumentParams] &
  string;

function isNumericInstrumentParam(
  param: string,
): param is NumericInstrumentParam {
  return (
    param in
    {
      tone: true,
      q: true,
      harm: true,
      falloff: true,
      stretch: true,
      noise: true,
      noiseFreq: true,
      formant: true,
      f1: true,
      f2: true,
      f3: true,
      formantQ: true,
      vib: true,
      vibRate: true,
      vibDelay: true,
      pitchDrop: true,
      pitchTime: true,
      noiseBend: true,
      voices: true,
      detune: true,
      att: true,
      dec: true,
      sus: true,
      rel: true,
      gain: true,
      pan: true,
    }
  );
}

export function autoParams(target: string): AutoParamDef[] {
  if (target === MASTER_TARGET) {
    return MASTER_AUTO_PARAMS;
  }
  const mixer = parseMixerTarget(target);
  if (mixer?.kind === "channel") {
    return MIXER_CHANNEL_AUTO_PARAMS;
  }
  if (mixer?.kind === "bus") {
    return MIXER_BUS_AUTO_PARAMS;
  }
  return target.startsWith(MIXER_TARGET_PREFIX) ? [] : INSTRUMENT_AUTO_PARAMS;
}

export function autoParamDef(lane: AutomationLane): AutoParamDef | null {
  return autoParams(lane.target).find((d) => d.param === lane.param) || null;
}

let nextLaneId = 1;

export function newLane(
  target: string,
  param: string,
  value: number,
): AutomationLane {
  return {
    id: "a" + nextLaneId++ + "-" + Math.random().toString(36).slice(2, 6),
    target,
    param,
    points: [{ step: 0, value }],
  };
}

// Value of the lane at (fractional) `step`
export function laneValueAt(lane: AutomationLane, step: number): number {
  const pts = lane.points;
  if (!pts.length) {
    return 0;
  }
  if (step <= pts[0].step) {
    return pts[0].value;
  }
  const last = pts[pts.length - 1];
  if (step >= last.step) {
    return last.value;
  }
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i];
    if (step <= b.step) {
      const a = pts[i - 1];
      const span = b.step - a.step;
      return span <= 0
        ? b.value
        : a.value +
            (b.value - a.value) *
              segmentProgress(a.curve, (step - a.step) / span);
    }
  }
  return last.value;
}

export function sortPoints(lane: AutomationLane): void {
  lane.points.sort((a, b) => a.step - b.step);
}

const clampTo = (d: AutoParamDef, v: number): number => {
  const q = Math.round(v / d.step) * d.step;
  return Math.max(d.min, Math.min(d.max, Math.round(q * 1e6) / 1e6));
};

export function clampPoint(lane: AutomationLane, pt: AutomationPoint): void {
  const d = autoParamDef(lane);
  pt.step = Math.max(0, Math.round(pt.step));
  if (d) {
    pt.value = clampTo(d, pt.value);
  }
}

export function setAutomationPointValue(
  lane: AutomationLane,
  pt: AutomationPoint,
  value: string | number,
): boolean {
  const next = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(next)) {
    return false;
  }
  pt.value = next;
  clampPoint(lane, pt);
  sortPoints(lane);
  return true;
}

// Human-readable "Bass · Pitch Bend"
export function laneTargetTitle(p: Project, lane: AutomationLane): string {
  const mixer = parseMixerTarget(lane.target);
  if (lane.target === MASTER_TARGET) {
    return "Master";
  } else if (mixer?.kind === "channel") {
    return `${p.instruments.find((i) => i.id === mixer.id)?.name || "Unknown"} channel`;
  } else if (mixer?.kind === "bus") {
    return `${p.mixer?.buses.find((bus) => bus.id === mixer.id)?.name || "Unknown"} bus`;
  }
  return p.instruments.find((i) => i.id === lane.target)?.name || "?";
}

export function laneTitle(p: Project, lane: AutomationLane): string {
  return (
    laneTargetTitle(p, lane) + " · " + (autoParamDef(lane)?.label || lane.param)
  );
}

export function laneColor(p: Project, lane: AutomationLane): string {
  if (lane.target === MASTER_TARGET) {
    return "#ffd166";
  }
  const mixer = parseMixerTarget(lane.target);
  if (mixer?.kind === "channel") {
    return p.instruments.find((i) => i.id === mixer.id)?.color || "#53d8fb";
  }
  if (mixer?.kind === "bus") {
    return "#a29bfe";
  }
  return p.instruments.find((i) => i.id === lane.target)?.color || "#53d8fb";
}

export function automationCurrentValue(
  p: Project,
  target: string,
  param: string,
  fallbackMaster?: Record<string, number>,
): number | null {
  let values: object | undefined;
  const mixer = parseMixerTarget(target);
  if (target === MASTER_TARGET) {
    values = p.mixer?.master ?? fallbackMaster;
  } else if (mixer?.kind === "channel") {
    values = p.mixer?.channels[mixer.id];
  } else if (mixer?.kind === "bus") {
    values = p.mixer?.buses.find((bus) => bus.id === mixer.id);
  } else if (!target.startsWith(MIXER_TARGET_PREFIX)) {
    values = p.instruments.find((i) => i.id === target)?.params;
  }
  const value = values && (values as Record<string, unknown>)[param];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const activeLanes = (p: Project): AutomationLane[] =>
  (p.automation || []).filter((l) => l.points.length > 0);

/* Params the notes of this step have to be played with: a shallow copy of the
 * instrument's params per automated instrument (undefined = nothing automated,
 * so the scheduler keeps using the instrument objects untouched). */
export function instrumentOverrides(
  p: Project,
  step: number,
): Map<string, InstrumentParams> | null {
  let out: Map<string, InstrumentParams> | null = null;
  for (const lane of activeLanes(p)) {
    if (
      lane.target === MASTER_TARGET ||
      parseMixerTarget(lane.target) ||
      lane.target.startsWith(MIXER_TARGET_PREFIX)
    ) {
      continue;
    }
    const d = autoParamDef(lane);
    if (!d) {
      continue;
    }
    const inst = p.instruments.find((i) => i.id === lane.target);
    if (!inst) {
      continue;
    }
    if (!out) {
      out = new Map();
    }
    const cur = out.get(inst.id) || { ...inst.params };
    if (isNumericInstrumentParam(lane.param)) {
      cur[lane.param] = clampTo(d, laneValueAt(lane, step));
    }
    out.set(inst.id, cur);
  }
  return out;
}

export function masterAutomation(
  p: Project,
  step: number,
): { param: string; value: number }[] {
  const out: { param: string; value: number }[] = [];
  for (const lane of activeLanes(p)) {
    if (lane.target !== MASTER_TARGET) {
      continue;
    }
    const d = autoParamDef(lane);
    if (d) {
      out.push({
        param: lane.param,
        value: clampTo(d, laneValueAt(lane, step)),
      });
    }
  }
  return out;
}

export interface MixerAutomationValue {
  target: ParsedMixerTarget;
  param: string;
  value: number;
}

export function mixerAutomation(
  p: Project,
  step: number,
): MixerAutomationValue[] {
  const out: MixerAutomationValue[] = [];
  for (const lane of activeLanes(p)) {
    const target = parseMixerTarget(lane.target);
    if (!target) {
      continue;
    }
    const exists =
      target.kind === "channel"
        ? !!p.mixer?.channels[target.id]
        : !!p.mixer?.buses.find((bus) => bus.id === target.id);
    const d = autoParamDef(lane);
    if (exists && d) {
      out.push({
        target,
        param: lane.param,
        value: clampTo(d, laneValueAt(lane, step)),
      });
    }
  }
  return out;
}
