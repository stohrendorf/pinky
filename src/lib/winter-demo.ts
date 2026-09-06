import type {
    ArrangementClip, AutomationLane, AutomationPoint, CurveShape, Instrument, InstrumentParams, Note, Pattern, Project, Track
} from './types';

import {
    mixDemo
} from './demo-mixer';
import {
    DEFAULT_PARAMS, ensurePartials
} from './instruments';
import {
    idxOfNote, NOTES
} from './notes';
import {
    PROJECT_FORMAT_VERSION
} from './types';
import {
    WINTER_ALPHABET, WINTER_PITCH_BASE, WINTER_SCORE, type WinterMovementData, type WinterPart
} from './winter-score';

/* ---- Vivaldi: L'Inverno (Winter), Op. 8 No. 4, RV 297 ----
 * The whole concerto, note for note, from the Mutopia Project's engraving of
 * the 1725 print (score/winter — CC BY-SA, typeset by John Williams; the
 * music itself is public domain). All three movements — the shivering
 * Allegro non molto, the Largo with its pizzicato rain, the Allegro on the
 * ice — for a period band: solo violin, violins I/II, violas, cellos with a
 * violone an octave below, and a harpsichord continuo.
 *
 * This score predates the conductor lane and retains its expanded grid to
 * preserve the performance: at 160 BPM one step is a 32nd in the Allegros
 * (quarter = 0.75 s, dotted-quarter bar = 1.125 s) and a 64th in the Largo
 * (quarter = 1.5 s). Everything the print says and the MIDI cannot is done
 * here: the solo's trills are written out as 32nd alternations, "Lento" is a
 * stretched section and so are the two fermatas, "Piano"/"Forte"/"Tutti"/
 * "Solo" become velocities, the violins play pizzicato in the Largo, and the
 * continuo doubles the bass line and the tutti chords (no chords over the
 * "Tasto solo" bars, where the upper strings are silent anyway).
 *
 * And a little of what only this engine can do, all of it from the sonnet
 * the concerto illustrates: the winds it names ("orrido Vento", "Sirocco,
 * Borea e tutti i Venti in guerra") blow as two noise-only voices under the
 * passages that paint them; in the Largo the soloist *sings* — fixed vocal
 * formants on the violin, a vowel that opens over the movement, portamento
 * between the long notes — while the rain drifts across the stage. Every
 * pitched patch measures as a pitch at the register and note length it
 * plays (timbre-analysis.ts); registers follow notes.ts, where a MIDI number
 * is the index into the note table. */

export const WINTER_BPM = 160;
/** the silence between movements, in steps (2.25 s) */
const GAP = 24;

const uuid = (group: number, index: number): string => `9f2a4c60-${String(group).padStart(4, '0')}-4e1b-8b7d-${String(index).padStart(12, '0')}`;

export type WinterVoice = 'solo' | 'vn1' | 'vn2' | 'vla' | 'vc' | 'violone' | 'pizz1' | 'pizz2' | 'hpsd' | 'borea' | 'sirocco';
export type WinterWind = 'borea' | 'sirocco';

export const WINTER_ID: Record<WinterVoice, string> = {
    solo: uuid(1, 1), vn1: uuid(1, 2), vn2: uuid(1, 3), vla: uuid(1, 4), vc: uuid(1, 5),
    violone: uuid(1, 6), pizz1: uuid(1, 7), pizz2: uuid(1, 8), hpsd: uuid(1, 9), borea: uuid(1, 10), sirocco: uuid(1, 11)
};

const COLOR: Record<WinterVoice, string> = {
    solo: '#f9ca24', vn1: '#ff9f43', vn2: '#ff6b6b', vla: '#e056fd', vc: '#a29bfe',
    violone: '#5f27cd', pizz1: '#feca57', pizz2: '#ff7f50', hpsd: '#48dbfb', borea: '#c8d6e5', sirocco: '#e17055'
};

/* The stage: firsts left, seconds inside them, violas right of centre, the
 * bass group right, the harpsichord behind the soloist. The north wind blows
 * in from the left, the Sirocco from the right. */
const PAN: Record<WinterVoice, number> = {
    solo: -0.08, vn1: -0.5, vn2: -0.22, vla: 0.28, vc: 0.5, violone: 0.6, pizz1: -0.5, pizz2: -0.22, hpsd: 0.12,
    borea: -0.7, sirocco: 0.7
};

const VIOLIN_PARTIALS = [1, 0.7, 0.55, 0.42, 0.33, 0.26, 0.2, 0.15].map((level, index) => ({ratio: index + 1, level}));
// the sections are two ranks each, so they get one partial less than the soloist — the
// finale runs at ~350 filter nodes as it is
const SECTION_PARTIALS = [1, 0.65, 0.5, 0.38, 0.28, 0.2].map((level, index) => ({ratio: index + 1, level}));
const VIOLA_PARTIALS = [1, 0.75, 0.55, 0.36, 0.24].map((level, index) => ({ratio: index + 1, level}));
const CELLO_PARTIALS = [1, 0.8, 0.6, 0.45, 0.32, 0.22].map((level, index) => ({ratio: index + 1, level}));
// the violone's fundamental sits at 33..87 Hz; its octave carries the pitch
const VIOLONE_PARTIALS = [0.9, 1, 0.7, 0.5, 0.32, 0.2].map((level, index) => ({ratio: index + 1, level}));
const PIZZ_PARTIALS = [1, 0.6, 0.4, 0.25, 0.15].map((level, index) => ({ratio: index + 1, level}));
// a plucked brass string: bright, the 2nd partial louder than the fundamental
const HARPSICHORD_PARTIALS = [0.8, 1, 0.85, 0.7, 0.6, 0.5].map((level, index) => ({ratio: index + 1, level}));

const instrument = (voice: WinterVoice, name: string, params: Partial<InstrumentParams>): Instrument =>
    ({id: WINTER_ID[voice], name, color: COLOR[voice], params: ensurePartials({...DEFAULT_PARAMS, pan: PAN[voice], ...params})});

function buildInstruments(): Instrument[] {
    const bowed = {tone: 1, att: 0.05, dec: 0.3, sus: 0.85, rel: 0.15};
    return [
        // The soloist: one instrument, so no unison — a touch of bow noise, a
        // vibrato that sets in late enough to leave the 32nds straight. The
        // vocal tract is fitted but shut (`formant` 0): a lane opens it in the
        // Largo, where the fiddle turns into a voice — an "oh" (F1 600, F2 1000)
        // whose F2 a second lane moves over the movement.
        instrument('solo', 'Orchestra/Strings/Solo Violin', {
            ...bowed, q: 32, partials: VIOLIN_PARTIALS, noise: 0.04, noiseFreq: 3200,
            vib: 16, vibRate: 5.8, vibDelay: 0.18, att: 0.03, rel: 0.12, gain: 0.5,
            formant: 0, f1: 600, f2: 1000, f3: 2600, formantQ: 3
        }),
        // the sections: two detuned ranks each, a slower and shallower vibrato
        instrument('vn1', 'Orchestra/Strings/Violins I', {
            ...bowed, q: 30, partials: SECTION_PARTIALS, voices: 2, detune: 12, vib: 8, vibRate: 5.2, vibDelay: 0.3, gain: 0.3
        }),
        instrument('vn2', 'Orchestra/Strings/Violins II', {
            ...bowed, q: 30, partials: SECTION_PARTIALS, voices: 2, detune: 10, vib: 8, vibRate: 5, vibDelay: 0.3, gain: 0.3
        }),
        instrument('vla', 'Orchestra/Strings/Violas', {
            ...bowed, q: 26, partials: VIOLA_PARTIALS, voices: 2, detune: 10, vib: 8, vibRate: 5, vibDelay: 0.3, gain: 0.28
        }),
        instrument('vc', 'Orchestra/Strings/Violoncelli', {
            ...bowed, q: 18, partials: CELLO_PARTIALS, voices: 2, detune: 9, vib: 7, vibRate: 4.8, vibDelay: 0.3, gain: 0.3
        }),
        // the 16' of the band: the bass line an octave down, wide bands so the
        // low notes speak inside an eighth
        instrument('violone', 'Orchestra/Strings/Violone', {
            ...bowed, q: 9, partials: VIOLONE_PARTIALS, att: 0.04, gain: 0.22
        }),
        // "Largo e pizzicati forte": the rain
        instrument('pizz1', 'Orchestra/Strings/Violins I pizz.', {
            tone: 1, q: 30, partials: PIZZ_PARTIALS, att: 0.002, dec: 0.22, sus: 0, rel: 0.15, gain: 0.7
        }),
        instrument('pizz2', 'Orchestra/Strings/Violins II pizz.', {
            tone: 1, q: 30, partials: PIZZ_PARTIALS, att: 0.002, dec: 0.22, sus: 0, rel: 0.15, gain: 0.7
        }),
        instrument('hpsd', 'Orchestra/Continuo/Harpsichord', {
            tone: 1, q: 45, partials: HARPSICHORD_PARTIALS, att: 0.002, dec: 0.7, sus: 0.12, rel: 0.08, gain: 0.6
        }),
        // ---- the winds of the sonnet ----
        // The concerto is about wind, and this engine is made of the stuff: a
        // voice with Tone Level 0 is nothing but its wide noise band. A gust is
        // one note whose band starts below its resting height and climbs there
        // (a rising bend the noise follows), so it swells, whooshes up and dies
        // on its own; a note's velocity is the gust's strength. Borea, the north
        // wind, is high and cold; the Sirocco is low and warm and slower. Both
        // stay weather, not a voice: at full strength under the last tutti they
        // bounce ~12 dB below the band (peak -14 dBFS against -2.5 at gain 0.07/0.05).
        instrument('borea', 'Orchestra/Venti/Borea', {
            tone: 0, noise: 1, noiseFreq: 2400, pitchDrop: -10, pitchTime: 1.6, noiseBend: 1,
            att: 0.9, dec: 1.2, sus: 0.7, rel: 1.8, gain: 0.09
        }),
        instrument('sirocco', 'Orchestra/Venti/Sirocco', {
            tone: 0, noise: 1, noiseFreq: 420, pitchDrop: -5, pitchTime: 2.4, noiseBend: 1,
            att: 1.6, dec: 2, sus: 0.8, rel: 2.5, gain: 0.07
        })
    ];
}

/* ---- the score ---- */
export interface ScoreNote {
    start: number;
    len: number;
    midi: number;
}

/** Unpack one part of winter-score.ts: (delta start, length, MIDI − 30) per note, see score/winter/build.mjs. */
export function decodeWinterPart(packed: string): ScoreNote[] {
    const notes: ScoreNote[] = [];
    let pos = 0, last = 0;
    const read = (): number => {
        const value = WINTER_ALPHABET.indexOf(packed[pos++]);
        if (value < 0) {throw new Error(`bad character in score at ${pos - 1}`);}
        if (value < 63) {return value;}
        return WINTER_ALPHABET.indexOf(packed[pos++]) * 64 + WINTER_ALPHABET.indexOf(packed[pos++]);
    };
    while (pos < packed.length) {
        const delta = read(), len = read(), pitch = read();
        last += delta;
        notes.push({start: last, len, midi: pitch + WINTER_PITCH_BASE});
    }
    return notes;
}

/* ---- the performance ----
 * What the print says beyond the notes, bar by bar (bars count from 1). */
export interface Dynamic {
    from: number;
    to: number;
    solo: number;
    tutti: number;
    bass: number;
}

export interface Section {
    name: string;
    from: number;
    to: number;
    /** time stretch of this section (the "Lento" in III, the fermatas) */
    stretch?: number;
}

/** One gust of the sonnet's winds: which wind, from which bar, for how many bars, how strong. */
export interface Gust {
    wind: WinterWind;
    bar: number;
    bars: number;
    vel: number;
}

export interface Movement {
    data: WinterMovementData;
    /** steps per beat: the quarter in 4/4, the eighth in 3/8 */
    beat: number;
    sections: Section[];
    dynamics: Dynamic[];
    /** violins play pizzicato */
    pizzicato?: boolean;
    /** the soloist sings: portamento between the long notes (see `slur`) */
    sings?: boolean;
    /** the violone doubles the bass line an octave below */
    violone?: boolean;
    /** the harpsichord doubles the tutti chords */
    chords?: boolean;
    /** the winds the sonnet names in this movement */
    winds?: Gust[];
}

// "Allegro non molto": bars 1-11 the shivering entrances (the solo joins in bar
// 4 with trilled eighths), 12-18 the "Orrido Vento" runs, 19-26 tutti and
// "Correre e batter li piedi", 27-38 the solo's gusts over the bass, 39-46 the
// alternation, 47-55 "Piano — Batter li denti", 56-63 "Forte" to the fermata.
// The north wind gusts under the "orrido Vento" runs and the "venti", and
// whispers behind the chattering teeth.
const FIRST: Movement = {
    data: WINTER_SCORE[0],
    beat: 8,
    sections: [
        {name: 'A shivering', from: 1, to: 11},
        {name: 'B orrido vento', from: 12, to: 18},
        {name: 'B batter li piedi', from: 19, to: 26},
        {name: 'C venti', from: 27, to: 38},
        {name: 'C solo e tutti', from: 39, to: 46},
        {name: 'D batter li denti', from: 47, to: 55},
        {name: 'D forte', from: 56, to: 62},
        {name: 'D fermata', from: 63, to: 63, stretch: 1.5}
    ],
    dynamics: [
        {from: 1, to: 11, solo: 0.85, tutti: 0.72, bass: 0.72},
        {from: 12, to: 18, solo: 1, tutti: 0.6, bass: 0.62},
        {from: 19, to: 26, solo: 1, tutti: 1, bass: 1},
        {from: 27, to: 38, solo: 1, tutti: 0.6, bass: 0.7},
        {from: 39, to: 46, solo: 1, tutti: 0.85, bass: 0.85},
        {from: 47, to: 55, solo: 0.6, tutti: 0.5, bass: 0.5},
        {from: 56, to: 63, solo: 1, tutti: 1, bass: 1}
    ],
    violone: true,
    chords: true,
    winds: [
        {wind: 'borea', bar: 12, bars: 2, vel: 0.45}, {wind: 'borea', bar: 14, bars: 2, vel: 0.6}, {wind: 'borea', bar: 16, bars: 3, vel: 0.75},
        {wind: 'borea', bar: 27, bars: 2, vel: 0.4}, {wind: 'borea', bar: 30, bars: 2, vel: 0.5},
        {wind: 'borea', bar: 33, bars: 2, vel: 0.45}, {wind: 'borea', bar: 36, bars: 3, vel: 0.55},
        {wind: 'borea', bar: 47, bars: 4, vel: 0.3}, {wind: 'borea', bar: 52, bars: 4, vel: 0.35}
    ]
};

// "Largo e pizzicati forte — La Pioggia": the violins are the rain, the violas
// "pianissimo con l'arco", the bass "sempre piano", the solo sings.
const SECOND: Movement = {
    data: WINTER_SCORE[1],
    beat: 16,
    sections: [
        {name: 'E la pioggia', from: 1, to: 6},
        {name: 'E la pioggia (2)', from: 7, to: 12},
        {name: 'E la pioggia (3)', from: 13, to: 18}
    ],
    dynamics: [{from: 1, to: 18, solo: 1, tutti: 0.85, bass: 0.6}],
    pizzicato: true,
    sings: true
};

// "Allegro": 1-24 the solo walks on the ice over "Arcate lunghe e Tasto solo",
// 25-39 "Caminar piano", 40-50 "Cader à terra", 51-88 "Correr forte", 89-100,
// 101-119 "Lento — Il Vento Sirocco" (played at half speed), 120-136 "Il Vento
// Borea e tutti li Venti", 137-153 the tutti to the fermata. The Sirocco
// swells through the Lento, Borea gusts through its own bars, and in the last
// tutti both blow at once — "tutti i Venti in guerra" — crossing the stage.
const THIRD: Movement = {
    data: WINTER_SCORE[2],
    beat: 4,
    sections: [
        {name: 'F caminar sul ghiaccio', from: 1, to: 24},
        {name: 'G caminar piano', from: 25, to: 39},
        {name: 'H cader à terra', from: 40, to: 50},
        {name: 'I correr forte', from: 51, to: 88},
        {name: 'L', from: 89, to: 100},
        {name: 'M il vento Sirocco (Lento)', from: 101, to: 119, stretch: 2},
        {name: 'N il vento Borea', from: 120, to: 136},
        {name: 'N tutti li venti', from: 137, to: 152},
        {name: 'N fermata', from: 153, to: 153, stretch: 2}
    ],
    dynamics: [
        {from: 1, to: 24, solo: 1, tutti: 0.7, bass: 0.7},
        {from: 25, to: 39, solo: 0.7, tutti: 0.65, bass: 0.65},
        {from: 40, to: 50, solo: 1, tutti: 0.9, bass: 0.9},
        {from: 51, to: 61, solo: 1, tutti: 0.65, bass: 0.7},
        {from: 62, to: 88, solo: 1, tutti: 0.8, bass: 0.8},
        {from: 89, to: 100, solo: 0.9, tutti: 0.9, bass: 0.9},
        {from: 101, to: 119, solo: 0.7, tutti: 0.6, bass: 0.6},
        {from: 120, to: 136, solo: 1, tutti: 0.8, bass: 0.85},
        {from: 137, to: 153, solo: 1, tutti: 1, bass: 1}
    ],
    violone: true,
    chords: true,
    winds: [
        {wind: 'sirocco', bar: 101, bars: 6, vel: 0.5}, {wind: 'sirocco', bar: 108, bars: 6, vel: 0.65}, {wind: 'sirocco', bar: 115, bars: 5, vel: 0.55},
        {wind: 'borea', bar: 120, bars: 4, vel: 0.6}, {wind: 'borea', bar: 125, bars: 4, vel: 0.7},
        {wind: 'borea', bar: 130, bars: 4, vel: 0.8}, {wind: 'borea', bar: 134, bars: 3, vel: 0.9},
        {wind: 'borea', bar: 137, bars: 4, vel: 0.9}, {wind: 'sirocco', bar: 141, bars: 4, vel: 0.8},
        {wind: 'borea', bar: 145, bars: 4, vel: 1}, {wind: 'sirocco', bar: 149, bars: 3, vel: 0.85}, {wind: 'borea', bar: 151, bars: 2, vel: 0.9}
    ]
};

export const WINTER_MOVEMENTS: Movement[] = [FIRST, SECOND, THIRD];

/* The solo's trills in the first movement: the eighths of bars 4-11 (the
 * shiver) and the long notes of bars 13-17 that end the "Orrido Vento" runs.
 * Written out as 32nds, upper auxiliary first, ending on the main note; the
 * auxiliary is a whole tone up except over D natural (Eb, the key's tone). */
const TRILL_BARS = [{from: 4, to: 11, len: 4}, {from: 13, to: 17, len: 8}];

const isTrilled = (note: ScoreNote, bar: number): boolean =>
    TRILL_BARS.some(range => bar >= range.from && bar <= range.to && note.len >= range.len);

function trill(note: ScoreNote): ScoreNote[] {
    const upper = note.midi + (note.midi % 12 === 2 ? 1 : 2);
    return Array.from({length: note.len}, (_, index) => ({
        start: note.start + index, len: 1, midi: (note.len - 1 - index) % 2 === 0 ? note.midi : upper
    }));
}

export interface Performed extends ScoreNote {
    voice: WinterVoice;
    vel: number;
}

/** the "note" a wind plays — a noise-only voice ignores its pitch, but a note needs one */
const WIND_NOTE = 69;

const barOf = (movement: Movement, step: number): number => Math.floor(step / movement.data.stepsPerBar) + 1;

const dynamic = (movement: Movement, bar: number): Dynamic =>
    movement.dynamics.find(d => bar >= d.from && bar <= d.to) ?? {from: 1, to: 1, solo: 0.85, tutti: 0.8, bass: 0.8};

/** The performed notes of one movement, in the movement's own (unstretched) steps. */
export function performMovement(movement: Movement): Performed[] {
    const parts = Object.fromEntries((Object.keys(movement.data.parts) as WinterPart[])
        .map(part => [part, decodeWinterPart(movement.data.parts[part])])) as Record<WinterPart, ScoreNote[]>;
    const out: Performed[] = [];
    // an accent on the beat, so that repeated notes ("batter li piedi") phrase
    const accent = (step: number): number => step % movement.beat === 0 ? 1 : 0.92;
    const add = (voice: WinterVoice, note: ScoreNote, level: number, midiShift = 0): void => {
        out.push({...note, midi: note.midi + midiShift, voice, vel: Math.round(level * accent(note.start) * 100) / 100});
    };

    for (const note of parts.solo) {
        const bar = barOf(movement, note.start);
        const level = dynamic(movement, bar).solo;
        if (movement === FIRST && isTrilled(note, bar)) {
            for (const step of trill(note)) {add('solo', step, level);}
        } else {
            add('solo', note, level);
        }
    }
    for (const note of parts.vn1) {add(movement.pizzicato ? 'pizz1' : 'vn1', note, dynamic(movement, barOf(movement, note.start)).tutti);}
    for (const note of parts.vn2) {add(movement.pizzicato ? 'pizz2' : 'vn2', note, dynamic(movement, barOf(movement, note.start)).tutti);}
    // "Pianissimo con l'arco" — the violas under the rain
    for (const note of parts.vla) {add('vla', note, movement.pizzicato ? 0.4 : dynamic(movement, barOf(movement, note.start)).tutti);}
    for (const note of parts.vc) {
        const level = dynamic(movement, barOf(movement, note.start)).bass;
        add('vc', note, level);
        if (movement.violone) {add('violone', note, level, -12);}
        // the continuo's left hand: the bass line, a little under the strings
        add('hpsd', note, level * (movement.pizzicato ? 0.7 : 0.85));
    }
    if (movement.chords) {
        // the right hand: on every beat where the whole tutti strikes, the
        // upper strings' chord, held for the beat at most
        const onBeat = (notes: ScoreNote[], step: number): ScoreNote[] => notes.filter(n => n.start === step);
        const total = movement.data.bars * movement.data.stepsPerBar;
        for (let step = 0; step < total; step += movement.beat) {
            const voices = [onBeat(parts.vn1, step), onBeat(parts.vn2, step), onBeat(parts.vla, step)];
            if (voices.some(v => !v.length)) {continue;}
            const level = dynamic(movement, barOf(movement, step)).tutti * 0.8;
            const seen = new Set<number>();
            for (const note of voices.flat()) {
                if (seen.has(note.midi)) {continue;}
                seen.add(note.midi);
                add('hpsd', {...note, len: Math.min(note.len, movement.beat)}, level);
            }
        }
    }
    for (const gust of movement.winds ?? []) {
        const {stepsPerBar} = movement.data;
        out.push({voice: gust.wind, start: (gust.bar - 1) * stepsPerBar, len: gust.bars * stepsPerBar, midi: WIND_NOTE, vel: gust.vel});
    }
    return out;
}

/* The soloist sings: a note of an eighth or longer that moves on within a
 * fourth slides into the next one — the bow stays on the string and the
 * finger shifts. The engine glides a note into its legato target over the gap
 * between them, so the sliding note gives up its last two steps (0.19 s in the
 * Largo) to the portamento. The 16ths stay articulated. */
const SLIDE = 2;

export function slur(notes: Note[], beat: number): void {
    notes.sort((a, b) => a.start - b.start);
    for (let i = 1; i < notes.length; i++) {
        const from = notes[i - 1], to = notes[i];
        const interval = Math.abs(idxOfNote[to.pitch] - idxOfNote[from.pitch]);
        if (from.start + from.len !== to.start || from.len < beat / 2 || !interval || interval > 5) {continue;}
        from.len -= SLIDE;
        from.legatoTo = {pitch: to.pitch, start: to.start, curve: 'smooth'};
    }
}

/* ---- the arrangement ----
 * Every section is one clip per lane, cut on bar lines; a stretched section
 * (the Lento) is longer than its bars. */
const LANES: {label: string; color: string; voices: WinterVoice[]}[] = [
    {label: 'Solo Violin', color: COLOR.solo, voices: ['solo']},
    {label: 'Violins I', color: COLOR.vn1, voices: ['vn1', 'pizz1']},
    {label: 'Violins II', color: COLOR.vn2, voices: ['vn2', 'pizz2']},
    {label: 'Violas', color: COLOR.vla, voices: ['vla']},
    {label: 'Bassi', color: COLOR.vc, voices: ['vc', 'violone']},
    {label: 'Harpsichord', color: COLOR.hpsd, voices: ['hpsd']},
    {label: 'Venti', color: COLOR.borea, voices: ['borea', 'sirocco']}
];

export interface PlacedSection {
    movement: number;
    name: string;
    /** timeline step the section starts on */
    start: number;
    /** steps on the timeline */
    len: number;
    /** first movement step (unstretched) */
    from: number;
    /** movement steps covered */
    span: number;
    stretch: number;
}

/** Where every section of the concerto sits on the arranger's timeline. */
export function placeSections(): PlacedSection[] {
    const placed: PlacedSection[] = [];
    let cursor = 0;
    WINTER_MOVEMENTS.forEach((movement, index) => {
        if (index) {cursor += GAP;}
        for (const section of movement.sections) {
            const from = (section.from - 1) * movement.data.stepsPerBar;
            const span = (section.to - section.from + 1) * movement.data.stepsPerBar;
            const stretch = section.stretch ?? 1;
            placed.push({movement: index, name: section.name, start: cursor, len: span * stretch, from, span, stretch});
            cursor += span * stretch;
        }
    });
    return placed;
}

const pitchName = (midi: number): string => NOTES[midi].name;

function buildPatterns(): {patterns: Pattern[]; arrangement: ArrangementClip[]} {
    const patterns: Pattern[] = [];
    const arrangement: ArrangementClip[] = [];
    const performed = WINTER_MOVEMENTS.map(performMovement);
    placeSections().forEach((section, order) => {
        const movement = WINTER_MOVEMENTS[section.movement];
        const notes = performed[section.movement].filter(n => n.start >= section.from && n.start < section.from + section.span);
        const name = `${String(order + 1).padStart(2, '0')} ${movement.data.title}/${section.name}`;
        LANES.forEach((lane, track) => {
            const tracks: Record<string, Note[]> = {};
            for (const voice of lane.voices) {
                const part = notes.filter(n => n.voice === voice).map((n): Note => ({
                    pitch: pitchName(n.midi),
                    start: (n.start - section.from) * section.stretch,
                    // a note running into the next section is cut at the bar line
                    len: Math.min(n.len, section.from + section.span - n.start) * section.stretch,
                    vel: n.vel
                }));
                if (voice === 'solo' && movement.sings) {slur(part, movement.beat * section.stretch);}
                if (part.length) {tracks[WINTER_ID[voice]] = part;}
            }
            if (!Object.keys(tracks).length) {return;}
            const pattern: Pattern = {id: uuid(2, patterns.length + 1), name: `${name} — ${lane.label}`, steps: section.len, color: lane.color, tracks};
            patterns.push(pattern);
            arrangement.push({id: uuid(3, arrangement.length + 1), patternId: pattern.id, track, start: section.start, len: section.len});
        });
    });
    return {patterns, arrangement};
}

/* ---- automation ---- */
type Point = [step: number, value: number, curve?: CurveShape];
const lane = (id: string, target: string, param: string, points: Point[]): AutomationLane => ({
    id, target, param, points: points.map(([step, value, curve]): AutomationPoint => curve ? {step, value, curve} : {step, value})
});

function buildAutomation(sections: PlacedSection[]): AutomationLane[] {
    const movementStart = (index: number): number => sections.find(s => s.movement === index)!.start;
    const movementEnd = (index: number): number => {
        const last = sections.filter(s => s.movement === index).pop()!;
        return last.start + last.len;
    };
    const at = (name: string): PlacedSection => sections.find(s => s.name === name)!;
    const [i0, i1, i2] = [0, 1, 2].map(movementStart);
    const [e0, e1, e2] = [0, 1, 2].map(movementEnd);
    const denti = at('D batter li denti');
    const forte = at('D forte');
    const rain2 = at('E la pioggia (2)');
    const rain3 = at('E la pioggia (3)');
    const lento = at('M il vento Sirocco (Lento)');
    const borea = at('N il vento Borea');
    const war = at('N tutti li venti');
    const fermata = at('N fermata');
    // Keep the measured pre-limiter headroom of the fullest tutti (the
    // "Forte" close of I, bars 56-63): protection is a safety net, not a
    // reason to flatten the concerto's dynamics.
    const MASTER = 0.28;
    return [
        lane(uuid(7, 1), 'master', 'vol', [
            [0, MASTER * 0.9, 'hold'], [i0 + 96, MASTER, 'hold'], [e0 - 8, MASTER, 'ease-out'], [e0 + 8, MASTER * 0.6, 'hold'],
            [i1, MASTER * 0.8, 'hold'], [e1 - 8, MASTER * 0.8, 'ease-out'], [e1 + 8, MASTER * 0.6, 'hold'],
            [i2, MASTER * 0.9, 'hold'], [lento.start, MASTER * 0.8, 'hold'], [borea.start, MASTER, 'hold'], [e2, MASTER]
        ]),
        // the hall: dry enough for the 32nds, wetter for the rain and the Sirocco
        lane(uuid(7, 2), 'master', 'rev', [
            [0, 0.32, 'hold'], [e0, 0.32, 'linear'], [i1, 0.5, 'hold'], [e1, 0.5, 'linear'],
            [i2, 0.3, 'hold'], [lento.start, 0.45, 'hold'], [borea.start, 0.3, 'hold'], [e2, 0.3]
        ]),
        lane(uuid(7, 3), 'master', 'tilt', [
            [0, 0, 'hold'], [i1, -1, 'hold'], [i2, 0.5, 'hold'], [lento.start, -0.5, 'hold'], [borea.start, 0.5]
        ]),
        // the soloist sings in the Largo: a wider, slower vibrato, a softer bow
        lane(uuid(7, 4), WINTER_ID.solo, 'vib', [
            [0, 16, 'hold'], [i1, 26, 'hold'], [i2, 16, 'hold'], [lento.start, 22, 'hold'], [borea.start, 14]
        ]),
        lane(uuid(7, 5), WINTER_ID.solo, 'vibRate', [[0, 5.8, 'hold'], [i1, 5.2, 'hold'], [i2, 5.8]]),
        lane(uuid(7, 6), WINTER_ID.solo, 'att', [[0, 0.03, 'hold'], [i1, 0.09, 'hold'], [i2, 0.03, 'hold'], [lento.start, 0.06, 'hold'], [borea.start, 0.025]]),
        // ... and scrapes in "Batter li denti": chattering teeth are more bow hair than string
        lane(uuid(7, 7), WINTER_ID.solo, 'noise', [
            [0, 0.04, 'hold'], [denti.start, 0.09, 'hold'], [forte.start, 0.04, 'hold'], [i1, 0.02, 'hold'], [i2, 0.04]
        ]),
        // the sections' bows: short in the Allegros, long ("Arcate lunghe") under the Lento
        lane(uuid(7, 8), WINTER_ID.vc, 'rel', [[0, 0.15, 'hold'], [i1, 0.3, 'hold'], [i2, 0.15, 'hold'], [lento.start, 0.3, 'hold'], [borea.start, 0.15]]),
        lane(uuid(7, 9), WINTER_ID.vla, 'att', [[0, 0.05, 'hold'], [i1, 0.25, 'hold'], [i2, 0.05, 'hold'], [lento.start, 0.12, 'hold'], [borea.start, 0.05]]),
        /* The voice: the soloist's vocal tract opens for the Largo (and half
         * way for the Sirocco), and its F2 moves over the movement — "oh"
         * opening towards "ah" through the middle bars and closing again. The
         * formants are an emphasis, not a volume: the engine trims the voice by
         * half the F1 boost, which the gain lane gives back. */
        lane(uuid(7, 10), WINTER_ID.solo, 'formant', [
            [0, 0, 'hold'], [i1, 0.35, 'hold'], [i2, 0, 'hold'], [lento.start, 0.2, 'hold'], [borea.start, 0]
        ]),
        lane(uuid(7, 11), WINTER_ID.solo, 'f2', [[i1, 1000, 'smooth'], [rain2.start, 1350, 'smooth'], [rain3.start, 900, 'smooth'], [e1, 1050]]),
        lane(uuid(7, 12), WINTER_ID.solo, 'gain', [[0, 0.5, 'hold'], [i1, 0.6, 'hold'], [i2, 0.5]]),
        // the rain: the two pizzicato sections drift across the stage and the
        // drops ring longer as the shower thickens through the middle bars
        lane(uuid(7, 13), WINTER_ID.pizz1, 'pan', [[i1, -0.5, 'smooth'], [rain2.start, -0.1, 'smooth'], [rain3.start, -0.65, 'smooth'], [e1, -0.3]]),
        lane(uuid(7, 14), WINTER_ID.pizz2, 'pan', [[i1, -0.22, 'smooth'], [rain2.start, 0.3, 'smooth'], [rain3.start, -0.05, 'smooth'], [e1, 0.15]]),
        lane(uuid(7, 15), WINTER_ID.pizz1, 'dec', [[i1, 0.2, 'smooth'], [rain2.start, 0.32, 'smooth'], [e1, 0.18]]),
        lane(uuid(7, 16), WINTER_ID.pizz2, 'dec', [[i1, 0.2, 'smooth'], [rain2.start, 0.32, 'smooth'], [e1, 0.18]]),
        // "tutti i Venti in guerra": through the last tutti the two winds
        // change sides — the north wind crosses to the right, the Sirocco to
        // the left — and the fermata leaves them where they met
        lane(uuid(7, 17), WINTER_ID.borea, 'pan', [
            [0, -0.7, 'hold'], [war.start, -0.7, 'smooth'], [war.start + war.len / 2, 0.2, 'smooth'], [fermata.start, 0.7, 'hold'], [e2, 0.7]
        ]),
        lane(uuid(7, 18), WINTER_ID.sirocco, 'pan', [
            [0, 0.7, 'hold'], [war.start, 0.7, 'smooth'], [war.start + war.len / 2, -0.2, 'smooth'], [fermata.start, -0.7, 'hold'], [e2, -0.7]
        ])
    ];
}

export function buildWinterDemo(): Project {
    const sections = placeSections();
    const {patterns, arrangement} = buildPatterns();
    const automation = buildAutomation(sections);
    const tracks: Track[] = LANES.map(({label, color}) => ({name: label, color}));
    return mixDemo({
        formatVersion: PROJECT_FORMAT_VERSION,
        instruments: buildInstruments(),
        patterns,
        arrangement,
        tracks,
        bpm: WINTER_BPM,
        swing: 0,
        // Navigation without re-quantising the edition's 32nd/64th-note grid.
        conductor: {
            tempos: [], meters: [],
            sections: sections.map((section, index) => ({
                id: uuid(8, index + 1), step: section.start,
                name: `${WINTER_MOVEMENTS[section.movement].data.title} · ${section.name}`
            }))
        },
        automation,
        automationOrder: automation.map(l => l.id),
        automationPositions: {},
        zoom: {seq: {width: 12, height: 14}, arr: {width: 6, height: 32}}
    }, 'winter');
}
