import type {
    CurveShape, Note
} from './types';

export interface LegatoTransition {
    time: number;
    curve: CurveShape;
}

export function isLegatoTarget(source: Note, targetStart: number): boolean {
    return targetStart >= source.start + source.len;
}

export function legatoTransition(source: Note, targetStart: number, stepDuration: number, defaultCurve: CurveShape = 'linear'): LegatoTransition {
    const link = source.legatoTo;
    return {
        time: Math.max(0.005, (targetStart - (source.start + source.len)) * stepDuration),
        curve: link?.curve || defaultCurve
    };
}

export function portamentoReleasePitch(sourcePitch: string, targetPitch?: string): string {
    return targetPitch || sourcePitch;
}