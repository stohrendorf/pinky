import type {
    InstrumentParams, Project
} from './types';

import {
    idxOfNote, STEPS, transposePitch
} from './notes';
import {
    PROMO_CHAPTERS, PROMO_PART_OF, type PromoPart
} from './promo-demo';

/* What the video renderer (promo/promo/score.py) knows about the music: every
 * note in seconds with a MIDI number, the hits the picture flashes and pulses
 * on, the chapter boundaries and the instrument patches for the predicted
 * spectrum overlay. Written next to the WAV by promo/bounce.mjs. */

export interface ScoreNote {
    inst: PromoPart;
    /** MIDI note number, 69 = 440 Hz (the Python side's `hz()` convention) */
    midi: number;
    t: number;
    dur: number;
    vel: number;
}

export interface ScoreEvent {
    t: number;
    kind: 'kick' | 'snare' | 'boom' | 'hit';
    strength: number;
}

export interface ScoreInstrument {
    name: string;
    color: string;
    params: InstrumentParams;
    /** the level one voice of it plays at (the engine's 0.9·gain), for the scope overlay */
    voiceGain: number;
}

export interface PromoScore {
    bpm: number;
    /** the song in seconds */
    length: number;
    notes: ScoreNote[];
    events: ScoreEvent[];
    sections: Record<string, [number, number]>;
    instruments: Partial<Record<PromoPart, ScoreInstrument>>;
}

/* notes.ts numbers its notes 0..119 from C0, and the DAW's names run one octave
 * ahead of the usual MIDI names (middle C = C5), so that index *is* the MIDI
 * number of the frequency being played. */
const midiOf = (pitch: string): number => idxOfNote[pitch];

export function promoScore(p: Project): PromoScore {
    const step = 60 / p.bpm / 4;
    const lengthSteps = Math.max(0, ...p.arrangement.map(c => c.start + c.len));
    const notes: ScoreNote[] = [];
    for (const clip of p.arrangement) {
        const pat = p.patterns.find(x => x.id === clip.patternId);
        if (!pat) {continue;}
        const patSteps = pat.steps || STEPS;
        for (const [instId, list] of Object.entries(pat.tracks)) {
            const inst = PROMO_PART_OF[instId];
            if (!inst) {continue;}
            for (const note of list) {
                const pitch = clip.transpose ? transposePitch(note.pitch, clip.transpose) : note.pitch;
                if (!pitch) {continue;}
                for (let rel = note.start; rel < clip.len; rel += patSteps) {
                    notes.push({inst, midi: midiOf(pitch), t: (clip.start + rel) * step, dur: note.len * step, vel: note.vel ?? 1});
                }
            }
        }
    }
    notes.sort((a, b) => a.t - b.t || a.inst.localeCompare(b.inst) || a.midi - b.midi);

    // The hits, as score.py raised them: a kick is a kick, an impact is the
    // "hit" (its boom and bells are part of it), a boom on its own is a boom,
    // and a snare only counts when the clap doubles it — the roll does not.
    const at = (inst: PromoPart) => new Set(notes.filter(n => n.inst === inst).map(n => n.t));
    const impacts = at('impact'), claps = at('clap');
    const events: ScoreEvent[] = [];
    for (const n of notes) {
        if (n.inst === 'kick') {events.push({t: n.t, kind: 'kick', strength: n.vel});}
        else if (n.inst === 'impact') {events.push({t: n.t, kind: 'hit', strength: n.vel});}
        else if (n.inst === 'boom' && !impacts.has(n.t)) {events.push({t: n.t, kind: 'boom', strength: n.vel});}
        else if (n.inst === 'snare' && claps.has(n.t)) {events.push({t: n.t, kind: 'snare', strength: n.vel});}
    }

    const instruments: PromoScore['instruments'] = {};
    for (const inst of p.instruments) {
        const part = PROMO_PART_OF[inst.id];
        if (part) {instruments[part] = {name: inst.name, color: inst.color, params: inst.params, voiceGain: 0.9 * inst.params.gain};}
    }
    const sections = Object.fromEntries(Object.entries(PROMO_CHAPTERS)
        .map(([name, [from, to]]) => [name, [from * step, to * step] as [number, number]]));
    return {bpm: p.bpm, length: lengthSteps * step, notes, events, sections, instruments};
}
