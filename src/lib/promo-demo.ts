import type {
    Instrument, InstrumentParams, Note, PartialSpec, Pattern, Project
} from './types';

import {
    DEFAULT_PARAMS, ensurePartials, genPartials
} from './instruments';
import {
    createMixer
} from './mixer';

/* ---- Pinky Promo ----
 * The soundtrack of promo/out/pinky-promo.mp4, note for note: a trailer-shaped
 * piece in D minor at 100 BPM. Bars are 2.4 s and the picture cuts on the bar
 * lines, so the arrangement below *is* the video's timeline:
 *
 *     bar  0- 1  hiss + sub drone          "every sound in this video is pink noise"
 *     bar  2- 3  choir pad, booms          the spectrum gets carved
 *     bar  4- 5  TITLE HIT, riser          "pinky"
 *     bar  6-13  groove                    feature sequence (4 x 2 bars)
 *     bar 14-15  break, snare roll         "no samples / no oscillators / just EQ"
 *     bar 16-18  climax with the soprano   full-screen scope
 *     bar 19-20  final hit, ring-out       logo + link
 *
 * The score used to live in promo/promo/score.py next to a NumPy re-creation
 * of the engine; now the video is bounced from *this* project through the real
 * engine (promo/bounce.mjs -> promo-bounce.ts), and score.py only reads what
 * promoScore() writes out. The Python score named notes with middle C = C4;
 * notes.ts has middle C = C5, so everything here sits one octave name higher
 * and sounds at the same frequency (the Python 'D2' sub is the 73 Hz 'D3'). */

export const BPM = 100;
const BAR = 16; // steps

/** The instrument keys the video renderer knows the parts by. */
export type PromoPart = 'air' | 'sub' | 'boom' | 'kick' | 'snare' | 'clap' | 'hat' | 'ohat' | 'bass' | 'pad'
    | 'strings' | 'pluck' | 'lead' | 'voice' | 'bell' | 'impact' | 'riser';

export const PROMO_ID: Record<PromoPart, string> = {
    air: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c001',
    sub: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c002',
    boom: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c003',
    kick: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c004',
    snare: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c005',
    clap: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c006',
    hat: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c007',
    ohat: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c008',
    bass: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c009',
    pad: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c010',
    strings: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c011',
    pluck: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c012',
    lead: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c013',
    voice: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c014',
    bell: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c015',
    impact: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c016',
    riser: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c017'
};
export const PROMO_PART_OF: Record<string, PromoPart> = Object.fromEntries(
    Object.entries(PROMO_ID).map(([part, id]) => [id, part as PromoPart]));

const COLOR: Record<PromoPart, string> = {
    air: '#85828a', sub: '#53d8fb', boom: '#ff9f43', kick: '#ff9f43', snare: '#ee5253', clap: '#ff6b6b',
    hat: '#f9ca24', ohat: '#f9ca24', bass: '#10ac84', pad: '#a29bfe', strings: '#0abde3', pluck: '#badc58',
    lead: '#e056fd', voice: '#f06f73', bell: '#48dbfb', impact: '#7ed6df', riser: '#aaa7ac'
};

/* ---- the presets (score.py INSTRUMENTS) ----
 * Same parameters as the Python score. The Python renderer normalised every
 * instrument's bus to a target level afterwards (level_db: impact −7, kick and
 * boom −9, sub, bass and soprano −13/−14 … air −27 dBFS). Here the `gain`
 * values *are* those faders: each part was rendered solo through the real
 * engine (`node promo/bounce.mjs --measure`) and its gain set so that the same
 * 99th-percentile 50 ms RMS lands on the same target. */
const harmonic = (count: number, falloff: number): PartialSpec[] => genPartials({shape: 'Harmonic', count, falloff, stretch: 0});
const CHOIR: PartialSpec[] = [1, 0.5, 0.33, 0.24, 0.18, 0.13].map((level, index) => ({ratio: index + 1, level}));
const SOPRANO: PartialSpec[] = [1, 0.6, 0.42, 0.3, 0.22, 0.16, 0.12, 0.09].map((level, index) => ({ratio: index + 1, level}));

const instrument = (part: PromoPart, name: string, params: Partial<InstrumentParams>): Instrument =>
    ({id: PROMO_ID[part], name, color: COLOR[part], params: ensurePartials({...DEFAULT_PARAMS, ...params})});

function buildInstruments(): Instrument[] {
    return [
        instrument('air', 'FX/Air', {tone: 0, noise: 1, noiseFreq: 2200, att: 2.6, dec: 0.5, sus: 1, rel: 2, gain: 0.03}),
        instrument('sub', 'Bass/Sub', {q: 30, harm: 2, falloff: 0.5, partials: harmonic(2, 0.5), att: 1.2, dec: 0.3, sus: 1, rel: 0.6, gain: 0.82}),
        instrument('boom', 'Percussion/Boom', {
            q: 8, harm: 1, partials: harmonic(1, 1), pitchDrop: 26, pitchTime: 0.09, noise: 0.12, noiseFreq: 3200,
            att: 0.002, dec: 0.55, sus: 0, rel: 0.5, gain: 0.56
        }),
        instrument('kick', 'Drums/Kick', {
            q: 8, harm: 1, partials: harmonic(1, 1), pitchDrop: 26, pitchTime: 0.07, noise: 0.12, noiseFreq: 4000,
            att: 0.002, dec: 0.16, sus: 0, rel: 0.12, gain: 0.73
        }),
        instrument('snare', 'Drums/Snare', {
            tone: 0.5, q: 6, harm: 2, falloff: 0.5, partials: harmonic(2, 0.5), pitchDrop: 7, pitchTime: 0.05,
            noise: 0.9, noiseFreq: 4500, att: 0.002, dec: 0.16, sus: 0, rel: 0.14, gain: 0.27
        }),
        instrument('clap', 'Drums/Clap', {
            tone: 0.15, q: 5, harm: 1, partials: harmonic(1, 1), noise: 1, noiseFreq: 1800,
            att: 0.004, dec: 0.12, sus: 0, rel: 0.15, gain: 0.16
        }),
        instrument('hat', 'Drums/Hi-Hat', {tone: 0, noise: 1, noiseFreq: 9500, att: 0.002, dec: 0.05, sus: 0, rel: 0.05, gain: 0.11}),
        instrument('ohat', 'Drums/Open Hat', {tone: 0, noise: 1, noiseFreq: 8500, att: 0.002, dec: 0.3, sus: 0, rel: 0.3, gain: 0.06}),
        instrument('bass', 'Bass/Pulse', {q: 25, harm: 3, falloff: 0.5, partials: harmonic(3, 0.5), att: 0.005, dec: 0.25, sus: 0.6, rel: 0.15, gain: 0.55}),
        instrument('pad', 'Vocals/Choir (oo)', {
            tone: 0.82, q: 36, harm: 6, falloff: 0.6, partials: CHOIR, formant: 0.85, f1: 350, f2: 800, f3: 2600, formantQ: 2.8,
            vib: 12, vibRate: 4.6, vibDelay: 0.6, voices: 4, detune: 18, att: 0.45, dec: 0.6, sus: 0.9, rel: 1.1, gain: 0.22
        }),
        instrument('strings', 'Orchestra/Strings', {
            q: 35, harm: 8, falloff: 0.75, partials: harmonic(8, 0.75), voices: 5, detune: 26,
            att: 0.25, dec: 0.8, sus: 0.9, rel: 1.2, gain: 0.07
        }),
        instrument('pluck', 'Synth/Pluck', {q: 60, harm: 5, falloff: 0.55, partials: harmonic(5, 0.55), att: 0.003, dec: 0.28, sus: 0.12, rel: 0.35, gain: 0.47}),
        instrument('lead', 'Synth/Lead (saw)', {
            q: 45, harmShape: 'Saw / Reed', harm: 6, falloff: 1, partials: genPartials({shape: 'Saw / Reed', count: 6, falloff: 1, stretch: 0}),
            voices: 3, detune: 14, att: 0.02, dec: 0.3, sus: 0.7, rel: 0.3, gain: 0.4
        }),
        instrument('voice', 'Vocals/Soprano (ah)', {
            tone: 0.95, q: 42, harm: 8, falloff: 0.7, partials: SOPRANO, formant: 0.9, f1: 800, f2: 1150, f3: 2900, formantQ: 3.2,
            vib: 34, vibRate: 5.6, vibDelay: 0.4, noise: 0.03, noiseFreq: 3800, voices: 2, detune: 9,
            att: 0.09, dec: 0.3, sus: 0.85, rel: 0.45, gain: 0.48
        }),
        instrument('bell', 'Percussion/Bell', {
            q: 80, harmShape: 'Bell partials', harm: 8, falloff: 1, partials: genPartials({shape: 'Bell partials', count: 8, falloff: 1, stretch: 0}),
            att: 0.002, dec: 1.4, sus: 0, rel: 1.6, gain: 0.8
        }),
        instrument('impact', 'FX/Impact', {
            q: 6, harm: 1, partials: harmonic(1, 1), pitchDrop: 30, pitchTime: 0.28, noise: 0.5, noiseFreq: 1500, noiseBend: 1,
            att: 0.002, dec: 1.1, sus: 0, rel: 1.6, gain: 0.84
        }),
        instrument('riser', 'FX/Riser', {
            q: 30, harm: 1, partials: harmonic(1, 1), noise: 0.35, noiseFreq: 3500, pitchDrop: -24, pitchTime: 4.6, noiseBend: 1,
            att: 0.6, dec: 0.3, sus: 1, rel: 0.4, gain: 0.11
        })
    ];
}

/* ---- the score (score.py compose()) ---- */
const CHORDS = {
    Dm: ['D4', 'F4', 'A4', 'D5'],
    Bb: ['A#3', 'D4', 'F4', 'A#4'],
    F: ['C4', 'F4', 'A4', 'C5'],
    C: ['C4', 'E4', 'G4', 'C5']
};
const ROOTS = {Dm: 'D3', Bb: 'A#2', F: 'F3', C: 'C3'};
const ARPS = {
    Dm: ['D5', 'A5', 'D6', 'F6', 'A5', 'D6', 'F6', 'A6'],
    Bb: ['A#4', 'F5', 'A#5', 'D6', 'F5', 'A#5', 'D6', 'F6'],
    F: ['F5', 'C6', 'F6', 'A6', 'C6', 'F6', 'A6', 'C7'],
    C: ['C5', 'G5', 'C6', 'E6', 'G5', 'C6', 'E6', 'G6']
};
type ChordName = keyof typeof CHORDS;

const up = (pitch: string, octaves: number): string => `${pitch.slice(0, -1)}${Number(pitch.at(-1)) + octaves}`;

/** The sections of the video: one source pattern each, cut on bar lines. */
interface Section {
    name: string;
    start: number;
    len: number;
}

const SECTIONS: Section[] = [
    {name: '01 Intro/noise swell', start: 0, len: 2 * BAR},
    {name: '02 Arrival/spectrum carve', start: 2 * BAR, len: 2 * BAR},
    {name: '03 Title/pinky hit', start: 4 * BAR, len: 2 * BAR},
    {name: '04 Groove/d minor pulse', start: 6 * BAR, len: BAR},
    {name: '05 Groove/d minor turn', start: 7 * BAR, len: BAR},
    {name: '06 Groove/b flat pulse', start: 8 * BAR, len: BAR},
    {name: '07 Groove/b flat turn', start: 9 * BAR, len: BAR},
    {name: '08 Groove/f major signal', start: 10 * BAR, len: BAR},
    {name: '09 Groove/f major turn', start: 11 * BAR, len: BAR},
    {name: '10 Groove/c major answer', start: 12 * BAR, len: BAR},
    {name: '11 Groove/c major turn', start: 13 * BAR, len: BAR},
    {name: '12 Break/floor drops', start: 14 * BAR, len: 2 * BAR},
    {name: '13 Climax/d minor lift', start: 16 * BAR, len: BAR},
    {name: '14 Climax/b flat rise', start: 17 * BAR, len: BAR},
    {name: '15 Climax/f major release', start: 18 * BAR, len: BAR},
    {name: '16 Outro/final hit', start: 19 * BAR, len: 2 * BAR}
];
export const PROMO_LENGTH_STEPS = 21 * BAR; // 50.4 s — the last two bars are the ring-out

/** Where the video's chapters start and end, in steps (score.py sections). */
export const PROMO_CHAPTERS: Record<string, [number, number]> = {
    noise: [0, 2 * BAR], carve: [2 * BAR, 4 * BAR], title: [4 * BAR, 6 * BAR], features: [6 * BAR, 14 * BAR],
    break: [14 * BAR, 16 * BAR], climax: [16 * BAR, 19 * BAR], outro: [19 * BAR, PROMO_LENGTH_STEPS]
};

/* Notes are written in absolute song steps, the way score.py places them
 * (bar, step), and land in the source pattern of the section they start in. */
class Score {
    readonly tracks = new Map<Section, Partial<Record<PromoPart, Note[]>>>();

    n(part: PromoPart, pitch: string, bar: number, step: number, len: number, vel = 1): void {
        const at = bar * BAR + step;
        const section = SECTIONS.find(s => at >= s.start && at < s.start + s.len);
        if (!section) {throw new Error(`promo: step ${at} is outside of the song`);}
        const notes = this.tracks.get(section) || {};
        (notes[part] ||= []).push({pitch, start: at - section.start, len, vel});
        this.tracks.set(section, notes);
    }

    chord(part: PromoPart, name: ChordName, bar: number, step: number, len: number, vel = 1, octave = 0): void {
        for (const pitch of CHORDS[name]) {this.n(part, up(pitch, octave), bar, step, len, vel);}
    }

    kick(bar: number, step: number, vel = 1): void {
        this.n('kick', 'A2', bar, step, 1, vel);
    }

    boom(bar: number, step: number, vel = 1): void {
        this.n('boom', 'G2', bar, step, 2, vel);
    }

    snare(bar: number, step: number, vel = 1): void {
        this.n('snare', 'D4', bar, step, 1, vel);
        this.n('clap', 'D4', bar, step, 1, vel * 0.8);
    }

    impact(bar: number, step: number, strength = 1): void {
        this.n('impact', 'G2', bar, step, 4, strength);
        this.n('boom', 'D2', bar, step, 3, strength);
        this.n('bell', 'D5', bar, step, 6, strength * 0.8);
        this.n('bell', 'A5', bar, step, 6, strength * 0.5);
    }
}

function compose(): Score {
    const s = new Score();

    // bars 0-1: hiss swells in, the sub drone appears underneath (and holds
    // right up to the title hit — the note is longer than its pattern)
    s.n('air', 'A5', 0, 0, 30, 0.9);
    s.n('sub', 'D3', 0, 4, 60, 0.9);

    // bars 2-3: choir pad, cinematic booms
    s.chord('pad', 'Dm', 2, 0, 32, 0.9);
    s.boom(2, 0, 1);
    s.boom(3, 0, 0.9);
    s.boom(3, 10, 0.7);
    s.boom(3, 13, 0.8);

    // bar 4: the title hit — then the riser pulls into the groove
    s.impact(4, 0, 1);
    s.chord('pad', 'Dm', 4, 0, 32, 1);
    s.n('riser', 'D4', 4, 2, 30, 0.9);
    s.n('sub', 'D3', 4, 0, 32, 1);
    for (let st = 0; st < 16; st += 2) {s.n('hat', 'A6', 5, st, 1, st % 4 === 0 ? 0.85 : 0.55);}
    s.kick(5, 8, 0.7);
    s.kick(5, 14, 0.8);

    // bars 6-13: the groove — Dm | Bb | F | C, two bars each
    const progression: ChordName[] = ['Dm', 'Dm', 'Bb', 'Bb', 'F', 'F', 'C', 'C'];
    progression.forEach((ch, i) => {
        const bar = 6 + i;
        s.chord('pad', ch, bar, 0, 16, 0.9);
        if (i >= 4) {s.chord('strings', ch, bar, 0, 16, 0.8, 1);}
        for (const st of [0, 3, 6, 8, 11, 14]) {
            s.n('bass', ROOTS[ch], bar, st, st % 8 === 0 ? 2 : 1.5, st % 8 === 0 ? 1 : 0.75);
        }
        ARPS[ch].forEach((pitch, k) => s.n('pluck', pitch, bar, k * 2, 1.5, k % 2 === 0 ? 1 : 0.8));
        for (const st of i % 2 === 0 ? [0, 6, 8] : [0, 8, 10]) {s.kick(bar, st, st % 8 === 0 ? 1 : 0.85);}
        s.snare(bar, 4, 0.9);
        s.snare(bar, 12, 1);
        for (let st = 0; st < 16; st += 2) {s.n('hat', 'A6', bar, st, 1, st % 4 === 0 ? 0.85 : 0.5);}
        s.n('ohat', 'A6', bar, 14, 2, 0.8);
    });
    // a lead motif over the second half of the groove
    const motif: [number, number, string, number][] = [
        [10, 0, 'D6', 3], [10, 4, 'F6', 2], [10, 6, 'E6', 2], [10, 8, 'D6', 6],
        [11, 0, 'C6', 4], [11, 4, 'A5', 3], [11, 8, 'D6', 8],
        [12, 0, 'F6', 3], [12, 4, 'G6', 2], [12, 6, 'A6', 2], [12, 8, 'G6', 6],
        [13, 0, 'F6', 4], [13, 4, 'E6', 3], [13, 8, 'D6', 8]
    ];
    for (const [bar, st, pitch, len] of motif) {s.n('lead', pitch, bar, st, len, 0.9);}

    // bars 14-15: the break — the floor drops away, then the roll and the riser
    s.boom(14, 0, 1);
    s.chord('pad', 'Dm', 14, 0, 32, 1);
    s.n('sub', 'D3', 14, 0, 32, 1);
    s.n('riser', 'D4', 14, 2, 30, 1);
    for (let st = 0; st < 16; st += 2) {s.n('hat', 'A6', 14, st, 1, 0.5);}
    for (let st = 0; st < 8; st += 2) {s.n('snare', 'D4', 15, st, 1, 0.55 + st * 0.04);}
    for (let st = 8; st < 16; st++) {s.n('snare', 'D4', 15, st, 1, 0.7 + (st - 8) * 0.04);}
    s.n('lead', 'D6', 14, 0, 8, 0.8);
    s.n('lead', 'A5', 14, 8, 8, 0.7);

    // bars 16-18: the climax — everything, plus the soprano
    (['Dm', 'Bb', 'F'] as ChordName[]).forEach((ch, i) => {
        const bar = 16 + i;
        s.chord('pad', ch, bar, 0, 16, 1);
        s.chord('strings', ch, bar, 0, 16, 1, 1);
        for (let st = 0; st < 16; st += 2) {s.n('bass', ROOTS[ch], bar, st, 1.5, st % 4 === 0 ? 1 : 0.8);}
        ARPS[ch].forEach((pitch, k) => {
            s.n('pluck', pitch, bar, k * 2, 1.5, 0.9);
            s.n('pluck', pitch, bar, k * 2 + 1, 1, 0.5);
        });
        for (const st of [0, 4, 8, 12]) {s.kick(bar, st, 1);}
        s.kick(bar, 14, 0.8);
        s.snare(bar, 4, 1);
        s.snare(bar, 12, 1);
        for (let st = 0; st < 16; st++) {s.n('hat', 'A6', bar, st, 1, 0.45 + (st % 4 === 0 ? 0.4 : 0) + (st % 2 === 0 ? 0.15 : 0));}
        s.n('ohat', 'A6', bar, 14, 2, 0.9);
    });
    const aria: [number, number, string, number][] = [
        [16, 0, 'A5', 4], [16, 4, 'D6', 4], [16, 8, 'F6', 8],
        [17, 0, 'E6', 4], [17, 4, 'D6', 4], [17, 8, 'C6', 4], [17, 12, 'D6', 4],
        [18, 0, 'F6', 6], [18, 6, 'E6', 2], [18, 8, 'D6', 8]
    ];
    for (const [bar, st, pitch, len] of aria) {s.n('voice', pitch, bar, st, len, 1);}

    // bar 19: the last hit, ringing out
    s.impact(19, 0, 1);
    s.chord('pad', 'Dm', 19, 0, 24, 1);
    s.chord('strings', 'Dm', 19, 0, 20, 0.9, 1);
    s.n('sub', 'D3', 19, 0, 20, 1);
    s.n('voice', 'D6', 19, 0, 16, 1);
    return s;
}

/* ---- the arrangement ----
 * Every section is split over the production lanes below, so that each part
 * of the mix is its own editable clip in the arranger. */
const LANES: {name: string; label: string; color: string; parts: PromoPart[]}[] = [
    {name: '01 FX & Impacts', label: 'FX & Impacts', color: '#7ed6df', parts: ['air', 'boom', 'bell', 'impact', 'riser']},
    {name: '02 Drums', label: 'Drums', color: '#ff9f43', parts: ['kick', 'snare', 'clap', 'hat', 'ohat']},
    {name: '03 Low End', label: 'Low End', color: '#10ac84', parts: ['sub', 'bass']},
    {name: '04 Harmony', label: 'Harmony', color: '#a29bfe', parts: ['pad', 'strings']},
    {name: '05 Arpeggio', label: 'Arpeggio', color: '#badc58', parts: ['pluck']},
    {name: '06 Lead', label: 'Lead', color: '#e056fd', parts: ['lead']},
    {name: '07 Soprano', label: 'Soprano', color: '#f06f73', parts: ['voice']}
];

const MASTER_VOL_LANE = '5c02ba01-71ab-435d-9337-1450f2573001';
const MASTER_REV_LANE = '5c02ba01-71ab-435d-9337-1450f2573002';
// the master at the hits and the climax; its mixer limiter protects transient peaks
const FULL = 0.34;
const dB = (base: number, delta: number): number => Math.round(base * 10 ** (delta / 20) * 1000) / 1000;

export function buildPromoDemo(): Project {
    const score = compose();
    const instruments = buildInstruments();
    const mixer = createMixer(instruments.map(instrument => instrument.id));
    mixer.master.vol = dB(FULL, -11);
    mixer.master.rev = 0.74;
    const patterns: Pattern[] = [];
    const arrangement = SECTIONS.flatMap(section => LANES.flatMap((lane, track) => {
        const notes = score.tracks.get(section) || {};
        const tracks = Object.fromEntries(lane.parts.filter(part => notes[part]?.length).map(part => [PROMO_ID[part], notes[part]!]));
        if (!Object.keys(tracks).length) {return [];}
        const pat: Pattern = {
            id: `1c02ba01-71ab-435d-9337-1450f257${(4001 + patterns.length).toString().padStart(4, '0')}`,
            name: `${section.name} — ${lane.label}`,
            steps: section.len,
            color: lane.color,
            tracks
        };
        patterns.push(pat);
        return [{
            id: `4c02ba01-71ab-435d-9337-1450f257${(5001 + patterns.length).toString().padStart(4, '0')}`,
            patternId: pat.id,
            track,
            start: section.start,
            len: section.len
        }];
    }));

    return {
        formatVersion: 1,
        instruments,
        patterns,
        arrangement,
        tracks: LANES.map(({name, color}) => ({name, color})),
        bpm: BPM,
        loop: {start: 0, end: PROMO_LENGTH_STEPS},
        mixer,
        automation: [
            // the trailer arc: whisper (-11 dB), swell (-6), and the title hit opens
            // the master up; the break drops it 3 dB until the climax hits. FULL is
            // where the master limiter catches the climax at its -1 dBFS ceiling.
            {id: MASTER_VOL_LANE, target: 'master', param: 'vol', points: [
                {step: 0, value: dB(FULL, -11), curve: 'hold'}, {step: 32, value: dB(FULL, -6), curve: 'ease-in'},
                {step: 63, value: dB(FULL, -3), curve: 'hold'}, {step: 64, value: FULL},
                {step: 224, value: FULL, curve: 'ease-out'}, {step: 226, value: dB(FULL, -3), curve: 'hold'},
                {step: 255, value: dB(FULL, -3), curve: 'hold'}, {step: 256, value: FULL}
            ]},
            // the video's reverb: a 28 % wet mix of the engine's 2.2 s burst
            {id: MASTER_REV_LANE, target: 'master', param: 'rev', points: [{step: 0, value: 0.74, curve: 'hold'}]}
        ],
        automationOrder: [MASTER_VOL_LANE, MASTER_REV_LANE],
        automationPositions: {},
        zoom: {seq: {width: 24, height: 14}, arr: {width: 24, height: 32}}
    };
}
