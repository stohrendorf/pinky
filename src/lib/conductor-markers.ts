import type { ConductorData, MeterMarker, SectionMarker, TempoMarker } from './timing';

import { createId } from './types';

export interface MarkerDraft {
    name: string;
    bpm: number | undefined;
    curve: 'hold' | 'linear';
    signature: string;
}

export interface MarkerPoint {
    id: string;
    step: number;
    section?: SectionMarker;
    tempo?: TempoMarker;
    meter?: MeterMarker;
}

const byStep = (a: { step: number }, b: { step: number }) => a.step - b.step;

function validateStep(step: number): void {
    if (!Number.isInteger(step) || step < 0 || step > 1_000_000) {
        throw new Error('Marker position must be a whole step from 0 to 1000000.');
    }
}

function parseSignature(
    signature: string,
): Pick<MeterMarker, 'numerator' | 'denominator'> | undefined {
    const text = signature.trim();
    if (!text) {
        return undefined;
    }
    const match = /^(\d+)\s*\/\s*(\d+)$/.exec(text);
    const numerator = Number(match?.[1]),
        denominator = Number(match?.[2]);
    if (
        !match ||
        !Number.isInteger(numerator) ||
        numerator < 1 ||
        numerator > 32 ||
        ![1, 2, 4, 8, 16].includes(denominator)
    ) {
        throw new Error('Use a time signature such as 7/8 (1–32 beats; unit 1, 2, 4, 8 or 16).');
    }
    return { numerator, denominator: denominator as MeterMarker['denominator'] };
}

export function markerPoints(data: ConductorData): MarkerPoint[] {
    const points = new Map<number, MarkerPoint>();
    for (const meter of data.meters) {
        points.set(meter.step, { id: meter.id, step: meter.step, meter });
    }
    for (const tempo of data.tempos) {
        points.set(tempo.step, {
            ...points.get(tempo.step),
            id: tempo.id,
            step: tempo.step,
            tempo,
        });
    }
    for (const section of data.sections) {
        points.set(section.step, {
            ...points.get(section.step),
            id: section.id,
            step: section.step,
            section,
        });
    }
    return [...points.values()].sort(byStep);
}

export function updateMarkerAt(
    data: ConductorData,
    step: number,
    draft: MarkerDraft,
): ConductorData {
    validateStep(step);
    const title = draft.name.trim();
    if (title.length > 80) {
        throw new Error('Title must be at most 80 characters.');
    }
    if (
        draft.bpm !== undefined &&
        (!Number.isFinite(draft.bpm) || draft.bpm < 30 || draft.bpm > 300)
    ) {
        throw new Error('Tempo must be from 30 to 300 BPM.');
    }
    if (draft.curve !== 'hold' && draft.curve !== 'linear') {
        throw new Error('Tempo curve must be hold or linear.');
    }
    const signature = parseSignature(draft.signature);
    const name = title || (draft.bpm === undefined && !signature ? 'Marker' : '');
    const tempos = data.tempos.filter(marker => marker.step !== step);
    const meters = data.meters.filter(marker => marker.step !== step);
    const sections = data.sections.filter(marker => marker.step !== step);
    if (tempos.length + Number(draft.bpm !== undefined) > 512) {
        throw new Error('There can be at most 512 tempo changes.');
    }
    if (meters.length + Number(!!signature) > 512) {
        throw new Error('There can be at most 512 time-signature changes.');
    }
    if (sections.length + Number(!!name) > 512) {
        throw new Error('There can be at most 512 titles.');
    }
    const ids = new Set(
        [...data.tempos, ...data.meters, ...data.sections].map(marker => marker.id),
    );
    const nextId = (): string => {
        let id = createId();
        while (ids.has(id)) {
            id = createId();
        }
        ids.add(id);
        return id;
    };
    if (draft.bpm !== undefined) {
        tempos.push({
            id: data.tempos.find(marker => marker.step === step)?.id ?? nextId(),
            step,
            bpm: draft.bpm,
            curve: draft.curve,
        });
    }
    if (signature) {
        meters.push({
            id: data.meters.find(marker => marker.step === step)?.id ?? nextId(),
            step,
            ...signature,
        });
    }
    if (name) {
        sections.push({
            id: data.sections.find(marker => marker.step === step)?.id ?? nextId(),
            step,
            name,
        });
    }
    return {
        ...data,
        tempos: tempos.sort(byStep),
        meters: meters.sort(byStep),
        sections: sections.sort(byStep),
    };
}

export function removeMarkerAt(data: ConductorData, step: number): ConductorData {
    validateStep(step);
    return {
        ...data,
        tempos: data.tempos.filter(marker => marker.step !== step),
        meters: data.meters.filter(marker => marker.step !== step),
        sections: data.sections.filter(marker => marker.step !== step),
    };
}

export function moveMarkerAt(data: ConductorData, from: number, to: number): ConductorData {
    validateStep(from);
    validateStep(to);
    const kinds = ['tempos', 'meters', 'sections'] as const;
    if (!kinds.some(kind => data[kind].some(marker => marker.step === from))) {
        throw new Error('This marker no longer exists.');
    }
    if (from === to) {
        return data;
    }
    const labels = { tempos: 'tempo', meters: 'time-signature', sections: 'title' };
    for (const kind of kinds) {
        if (
            data[kind].some(marker => marker.step === from) &&
            data[kind].some(marker => marker.step === to)
        ) {
            throw new Error(
                `There is already a ${labels[kind]} change here. Drop beside it instead.`,
            );
        }
    }
    const move = <T extends { step: number }>(markers: T[]): T[] =>
        markers
            .map(marker => (marker.step === from ? { ...marker, step: to } : marker))
            .sort(byStep);
    return {
        ...data,
        tempos: move(data.tempos),
        meters: move(data.meters),
        sections: move(data.sections),
    };
}
