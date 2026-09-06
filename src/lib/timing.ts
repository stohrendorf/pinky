import type {
    Project
} from './types';

import {
    isProjectId
} from './types';

export interface TempoMarker {
    id: string;
    step: number;
    bpm: number;
    curve: 'hold' | 'linear';
}

export interface MeterMarker {
    id: string;
    step: number;
    numerator: number;
    denominator: 1 | 2 | 4 | 8 | 16;
}

export interface SectionMarker {
    id: string;
    step: number;
    name: string;
}

export interface ConductorData {
    tempos: TempoMarker[];
    meters: MeterMarker[];
    sections: SectionMarker[];
}

type TimingProject = Pick<Project, 'bpm' | 'conductor'>;

export function ensureConductor(p: Project): ConductorData {
    return p.conductor ??= {tempos: [], meters: [], sections: []};
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown, min: number, max: number): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export function isConductorData(value: unknown): value is ConductorData {
    if (!object(value)) {return false;}
    const ids = new Set<string>();
    for (const kind of ['tempos', 'meters', 'sections'] as const) {
        const markers = value[kind];
        if (!Array.isArray(markers) || markers.length > 512) {return false;}
        let previous = -1;
        for (const marker of markers as unknown[]) {
            if (!object(marker) || !isProjectId(marker.id) || ids.has(marker.id)
                || !finite(marker.step, 0, 1_000_000) || !Number.isInteger(marker.step) || marker.step <= previous) {return false;}
            ids.add(marker.id);
            previous = marker.step;
            if (kind === 'tempos' && (!finite(marker.bpm, 30, 300) || !['hold', 'linear'].includes(String(marker.curve)))) {return false;}
            if (kind === 'meters' && (!finite(marker.numerator, 1, 32) || !Number.isInteger(marker.numerator)
                || ![1, 2, 4, 8, 16].includes(marker.denominator as number))) {return false;}
            if (kind === 'sections' && (typeof marker.name !== 'string' || !marker.name.trim() || marker.name.length > 80)) {return false;}
        }
    }
    return true;
}

// Last boundary at or before the query. The implicit boundary at zero always exists.
function boundary<T>(items: T[], value: number, key: (item: T) => number): number {
    let lo = 0, hi = items.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (key(items[mid]) <= value) {lo = mid + 1;} else {hi = mid;}
    }
    return Math.max(0, lo - 1);
}

/** One step is always a sixteenth note. Ramps are linear in musical position,
 * not seconds: integrate 15 / BPM exactly so long notes and export agree. */
export function createTimingMap(p: TimingProject) {
    const base = Number.isFinite(p.bpm) && p.bpm > 0 ? p.bpm : 112;
    const markers = p.conductor?.tempos ?? [];
    const points = markers[0]?.step === 0 ? markers : [{step: 0, bpm: base, curve: 'hold' as const}, ...markers];
    const segments = points.map((point, i) => ({
        step: point.step, bpm: point.bpm, seconds: 0,
        slope: point.curve === 'linear' && points[i + 1]
            ? (points[i + 1].bpm - point.bpm) / (points[i + 1].step - point.step) : 0
    }));
    const integral = (bpm: number, slope: number, steps: number) => Math.abs(slope) < 1e-10
        ? 15 * steps / bpm : 15 * Math.log1p(slope * steps / bpm) / slope;
    for (let i = 1; i < segments.length; i++) {
        const prev = segments[i - 1];
        segments[i].seconds = prev.seconds + integral(prev.bpm, prev.slope, segments[i].step - prev.step);
    }
    const secondsAt = (step: number): number => {
        step = Math.max(0, step);
        const seg = segments[boundary(segments, step, item => item.step)];
        return seg.seconds + integral(seg.bpm, seg.slope, step - seg.step);
    };
    return {
        secondsAt,
        secondsBetween(from: number, to: number): number {return secondsAt(to) - secondsAt(from);},
        bpmAt(step: number): number {
            step = Math.max(0, step);
            const seg = segments[boundary(segments, step, item => item.step)];
            return seg.bpm + seg.slope * (step - seg.step);
        },
        stepAt(seconds: number): number {
            seconds = Math.max(0, seconds);
            const seg = segments[boundary(segments, seconds, item => item.seconds)];
            const elapsed = seconds - seg.seconds;
            return seg.step + (Math.abs(seg.slope) < 1e-10 ? elapsed * seg.bpm / 15
                : seg.bpm * Math.expm1(elapsed * seg.slope / 15) / seg.slope);
        }
    };
}

export type TimingMap = ReturnType<typeof createTimingMap>;

export interface BarPosition {
    bar: number;
    start: number;
    end: number;
    beat: number;
    numerator: number;
    denominator: number;
}

function meterSegments(p: TimingProject) {
    const markers = p.conductor?.meters ?? [];
    const points = markers[0]?.step === 0 ? markers : [{step: 0, numerator: 4, denominator: 4}, ...markers];
    const segments = points.map(point => ({...point, bar: 1, length: point.numerator * 16 / point.denominator}));
    for (let i = 1; i < segments.length; i++) {
        const prev = segments[i - 1];
        segments[i].bar = prev.bar + Math.ceil((segments[i].step - prev.step) / prev.length);
    }
    return segments;
}

/** A meter marker starts a new bar; a mid-bar marker deliberately shortens
 * the preceding bar. Neither operation moves or stretches any music. */
export function barAt(p: TimingProject, step: number): BarPosition {
    step = Math.max(0, step);
    const segments = meterSegments(p);
    const i = boundary(segments, step, item => item.step), seg = segments[i];
    const offset = Math.floor((step - seg.step) / seg.length);
    const start = seg.step + offset * seg.length;
    return {
        bar: seg.bar + offset, start, end: Math.min(start + seg.length, segments[i + 1]?.step ?? Infinity),
        beat: Math.floor((step - start) / (16 / seg.denominator)) + 1,
        numerator: seg.numerator, denominator: seg.denominator
    };
}

export function barsInRange(p: TimingProject, from: number, to: number): BarPosition[] {
    const bars: BarPosition[] = [];
    if (to <= from) {return bars;}
    let bar = barAt(p, from);
    while (bar.start < to) {
        bars.push(bar);
        bar = barAt(p, bar.end);
    }
    return bars;
}

export function snapToBeat(p: TimingProject, step: number): number {
    const bar = barAt(p, step), beat = 16 / bar.denominator;
    const snapped = Math.max(bar.start, Math.min(bar.end, bar.start + Math.round((step - bar.start) / beat) * beat));
    return Math.abs(step - bar.end) <= Math.abs(step - snapped) ? bar.end : snapped;
}
