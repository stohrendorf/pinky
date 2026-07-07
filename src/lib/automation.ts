import type {
    AutomationLane, AutomationPoint, CurveShape, InstrumentParams, Project
} from './types';

/* Automation — parameter curves over the song timeline.
 * A lane owns a list of points (step -> value); the value between two points is
 * shaped by its outgoing point, before the first / after the last point it is held.
 * The scheduler reads every lane once per 16th step: instrument lanes produce a
 * patched copy of the instrument's params for the notes starting on that step,
 * master lanes are ramped straight onto the master AudioParams. */
import {
    INSTRUMENT_PANELS, MASTER_SLIDERS
} from './instruments';

export const MASTER_TARGET = 'master';

export const CURVE_SHAPES: { id: CurveShape; label: string }[] = [
    {id: 'hold', label: 'Hold'},
    {id: 'linear', label: 'Linear'},
    {id: 'ease-in', label: 'Ease in'},
    {id: 'ease-out', label: 'Ease out'},
    {id: 'smooth', label: 'Smooth'}
];

export function segmentProgress(curve: CurveShape | undefined, progress: number): number {
    const t = Math.max(0, Math.min(1, progress));
    switch (curve || 'linear') {
    case 'hold':
        return t < 1 ? 0 : 1;
    case 'ease-in':
        return t * t;
    case 'ease-out':
        return 1 - (1 - t) * (1 - t);
    case 'smooth':
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

// Everything the instrument panel exposes as a slider can be automated
export const INSTRUMENT_AUTO_PARAMS: AutoParamDef[] = INSTRUMENT_PANELS.flatMap(g =>
    g.sliders.map(s => ({param: s.id, label: s.label, min: s.min, max: s.max, step: s.step, unit: s.unit})));

export const MASTER_AUTO_PARAMS: AutoParamDef[] = MASTER_SLIDERS.map(s =>
    ({param: s.id, label: s.label, min: s.min, max: s.max, step: s.step, unit: s.unit}));

type NumericInstrumentParam = {
    [K in keyof InstrumentParams]: InstrumentParams[K] extends number ? K : never
}[keyof InstrumentParams] & string;

function isNumericInstrumentParam(param: string): param is NumericInstrumentParam {
    return param in {
        tone: true, q: true, harm: true, falloff: true, stretch: true, noise: true,
        noiseFreq: true, formant: true, f1: true, f2: true, f3: true, formantQ: true,
        vib: true, vibRate: true, vibDelay: true, pitchDrop: true, pitchTime: true,
        noiseBend: true, voices: true, detune: true, att: true, dec: true,
        sus: true, rel: true, gain: true, pan: true
    };
}

export function autoParams(target: string): AutoParamDef[] {
    return target === MASTER_TARGET ? MASTER_AUTO_PARAMS : INSTRUMENT_AUTO_PARAMS;
}

export function autoParamDef(lane: AutomationLane): AutoParamDef | null {
    return autoParams(lane.target).find(d => d.param === lane.param) || null;
}

let nextLaneId = 1;

export function newLane(target: string, param: string, value: number): AutomationLane {
    return {
        id: 'a' + (nextLaneId++) + '-' + Math.random().toString(36).slice(2, 6),
        target,
        param,
        points: [{step: 0, value}]
    };
}

// Value of the lane at (fractional) `step`
export function laneValueAt(lane: AutomationLane, step: number): number {
    const pts = lane.points;
    if (!pts.length) {return 0;}
    if (step <= pts[0].step) {return pts[0].value;}
    const last = pts[pts.length - 1];
    if (step >= last.step) {return last.value;}
    for (let i = 1; i < pts.length; i++) {
        const b = pts[i];
        if (step <= b.step) {
            const a = pts[i - 1];
            const span = b.step - a.step;
            return span <= 0 ? b.value : a.value + (b.value - a.value) * segmentProgress(a.curve, (step - a.step) / span);
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
    if (d) {pt.value = clampTo(d, pt.value);}
}

export function setAutomationPointValue(lane: AutomationLane, pt: AutomationPoint, value: string | number): boolean {
    const next = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(next)) {return false;}
    pt.value = next;
    clampPoint(lane, pt);
    sortPoints(lane);
    return true;
}

// Human-readable "Bass · Pitch Bend"
export function laneTitle(p: Project, lane: AutomationLane): string {
    const who = lane.target === MASTER_TARGET
        ? 'Master'
        : (p.instruments.find(i => i.id === lane.target)?.name || '?');
    return who + ' · ' + (autoParamDef(lane)?.label || lane.param);
}

export function laneColor(p: Project, lane: AutomationLane): string {
    if (lane.target === MASTER_TARGET) {return '#ffd166';}
    return p.instruments.find(i => i.id === lane.target)?.color || '#53d8fb';
}

const activeLanes = (p: Project): AutomationLane[] => (p.automation || []).filter(l => l.points.length > 0);

/* Params the notes of this step have to be played with: a shallow copy of the
 * instrument's params per automated instrument (undefined = nothing automated,
 * so the scheduler keeps using the instrument objects untouched). */
export function instrumentOverrides(p: Project, step: number): Map<string, InstrumentParams> | null {
    let out: Map<string, InstrumentParams> | null = null;
    for (const lane of activeLanes(p)) {
        if (lane.target === MASTER_TARGET) {continue;}
        const d = autoParamDef(lane);
        if (!d) {continue;}
        const inst = p.instruments.find(i => i.id === lane.target);
        if (!inst) {continue;}
        if (!out) {out = new Map();}
        const cur = out.get(inst.id) || {...inst.params};
        if (isNumericInstrumentParam(lane.param)) {cur[lane.param] = clampTo(d, laneValueAt(lane, step));}
        out.set(inst.id, cur);
    }
    return out;
}

export function masterAutomation(p: Project, step: number): { param: string; value: number }[] {
    const out: { param: string; value: number }[] = [];
    for (const lane of activeLanes(p)) {
        if (lane.target !== MASTER_TARGET) {continue;}
        const d = autoParamDef(lane);
        if (d) {out.push({param: lane.param, value: clampTo(d, laneValueAt(lane, step))});}
    }
    return out;
}

export const hasAutomation = (p: Project | null): boolean => !!p && activeLanes(p).length > 0;
