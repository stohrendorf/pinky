import type {
    ArrangementClip, AutomationLane, AutomationPoint, CurveShape, Instrument, InstrumentParams, Note, Pattern, Project, Track
} from './types';

import {
    DEFAULT_PARAMS, ensurePartials
} from './instruments';
import {
    noteByName, transposePitch
} from './notes';
import {
    PROJECT_FORMAT_VERSION
} from './types';

/* ---- Bronze Monsoon ----
 * An original score for a bronze temple in the rain: Balinese gamelan
 * (interlocking gendér kotekan over the jublag's pokok, kendang, ceng-ceng,
 * gong ageng with its slow "ombak" beat), Japanese taiko and shakuhachi, an
 * Armenian duduk and a Mongolian khoomei drone whose overtone melody is not
 * sung by notes at all — it is one held D with the singer's second formant
 * automated from harmonic to harmonic (and the jaw, F1, following it). The
 * middle section is in 7/8 (28-step patterns) and moves up a fourth by clip
 * transposition — the drone goes with it and sings the harmonics of G; the
 * storm opens the pentatonic In scale (D Eb G A Bb) into D minor over a
 * Bb–C–Dm ground that the sub *slides* through as one portamento line.
 *
 * The arranger is pushed as far as it goes: clips longer than their pattern
 * make polymeter (a 24-step singing-bowl drift under 32-step rain; the
 * taiko in 3/4 against the storm's 4/4, resolving after exactly 96 steps),
 * the storm kotekan is doubled an octave down by the *same* pattern placed
 * again with transpose −12 (the pemade under the kantilan), and the lanes
 * drive things a mixer cannot: the gendér's damping, the gong's beat rate,
 * the shakuhachi's breath, the wind's pitch and position, a duduk vowel
 * closing on its final note, the two gendér players trading sides.
 *
 * Every pitched patch here was tuned with timbre-analysis.ts so that it
 * measures as a pitch on the note and length it actually plays. Registers
 * follow notes.ts (middle C = C5). */

type NoteSpec = [pitch: string, start: number, len?: number, vel?: number];
type TrackNotes = Record<string, NoteSpec[]>;

const BPM = 88;
const FOUR = 32;  // two bars of 4/4 in sixteenths
const SEVEN = 28; // two bars of 7/8 in sixteenths
const THREE = 12; // one bar of 3/4 — cycles eight times inside three 4/4 sections
const BOWL = 24;  // the singing bowl's own cycle: four of them fill three sections
// the khoomei drone: every overtone of the melody is a multiple of this
const DRONE = 'D3';
const UP = 5; // the Seven Rains modulate a fourth up, to G
// the deterministic project IDs of this demo (see isProjectId)
const uuid = (group: number, index: number): string => `4e6b7a10-${String(group).padStart(4, '0')}-4d2c-9a1f-${String(index).padStart(12, '0')}`;

const ID = {
    odaiko: uuid(1, 1),
    shime: uuid(1, 2),
    kendang: uuid(1, 3),
    ceng: uuid(1, 4),
    gong: uuid(1, 5),
    polos: uuid(1, 6),
    sangsih: uuid(1, 7),
    handpan: uuid(1, 8),
    shakuhachi: uuid(1, 9),
    duduk: uuid(1, 10),
    khoomei: uuid(1, 11),
    kora: uuid(1, 12),
    sub: uuid(1, 13),
    rain: uuid(1, 14),
    thunder: uuid(1, 15),
    jublag: uuid(1, 16),
    bowl: uuid(1, 17),
    wind: uuid(1, 18),
    riser: uuid(1, 19)
} as const;

const COLOR = {
    odaiko: '#ee5253', shime: '#ff6b6b', kendang: '#ff9f43', ceng: '#f9ca24', gong: '#c8a951',
    polos: '#48dbfb', sangsih: '#0abde3', handpan: '#53d8fb', shakuhachi: '#a29bfe', duduk: '#e056fd',
    khoomei: '#5f27cd', kora: '#10ac84', sub: '#576574', rain: '#8395a7', thunder: '#222f3e',
    jublag: '#1dd1a1', bowl: '#feca57', wind: '#c8d6e5', riser: '#ff9ff3'
};

const TRACK = {
    weather: 0, taiko: 1, ground: 2, gender: 3, pemade: 4, jublag: 5, shakuhachi: 6, duduk: 7, khoomei: 8, strings: 9, bowl: 10
} as const;
const TRACK_NAMES = [
    'Weather', 'Taiko & Kendang', 'Gong & Sub', 'Gendér', 'Gendér Pemade', 'Jublag', 'Shakuhachi', 'Duduk', 'Khoomei', 'Kora & Handpan', 'Singing Bowl'
];
const TRACK_COLORS = ['#8395a7', '#ee5253', '#c8a951', '#48dbfb', '#0abde3', '#1dd1a1', '#a29bfe', '#e056fd', '#5f27cd', '#10ac84', '#feca57'];

const notes = (...items: NoteSpec[]): Note[] => items.map(([pitch, start, len = 1, vel = 0.8]) => ({pitch, start, len, vel}));
const pattern = (id: string, name: string, steps: number, color: string, tracks: TrackNotes): Pattern => ({
    id,
    name,
    steps,
    color,
    tracks: Object.fromEntries(Object.entries(tracks).map(([instrument, part]) => [instrument, notes(...part)]))
});
const instrument = (id: string, name: string, color: string, params: Partial<InstrumentParams>): Instrument =>
    ({id, name, color, params: ensurePartials({...DEFAULT_PARAMS, ...params})});
const hits = (pitch: string, steps: number[], vel: (step: number, index: number) => number, len = 1): NoteSpec[] =>
    steps.map((step, index) => [pitch, step, len, vel(step, index)]);
// a crescendo roll: velocity rises linearly from `from` to `to` over the hits
const roll = (pitch: string, steps: number[], from: number, to: number): NoteSpec[] =>
    steps.map((step, index) => [pitch, step, 1, from + (to - from) * index / Math.max(1, steps.length - 1)]);
const accents = (pitch: string, velocities: readonly (readonly [step: number, vel: number])[]): NoteSpec[] =>
    velocities.map(([step, vel]) => [pitch, step, 1, vel]);
const legato = (patterns: Pattern[], patternId: string, instrumentId: string, from: number, to: number, curve: CurveShape): void => {
    const part = patterns.find(value => value.id === patternId)?.tracks[instrumentId];
    const source = part?.find(value => value.start === from);
    const target = part?.find(value => value.start === to);
    if (!source || !target || target.start < source.start + source.len) {
        throw new Error(`Invalid legato link in ${patternId}/${instrumentId}: ${from} -> ${to}`);
    }
    source.legatoTo = {pitch: target.pitch, start: target.start, curve};
};

/* Kotekan: one sixteenth-note stream split between two players. The polos
 * takes the on-beats, the sangsih the off-beats, and both strike together on
 * the stressed first note of each half — heard as one line, panned wide. */
const kotekan = (stream: (string | null)[]): {polos: NoteSpec[]; sangsih: NoteSpec[]} => {
    const polos: NoteSpec[] = [], sangsih: NoteSpec[] = [];
    stream.forEach((pitch, step) => {
        if (!pitch) {return;}
        const stressed = step % 16 === 0;
        const vel = stressed ? 0.92 : step % 4 === 0 ? 0.78 : 0.58;
        if (step % 2 === 0 || stressed) {polos.push([pitch, step, 1, vel]);}
        if (step % 2 === 1 || stressed) {sangsih.push([pitch, step, 1, stressed ? 0.8 : vel]);}
    });
    return {polos, sangsih};
};
/* Pokok: the skeletal melody a kotekan elaborates — the note on every beat
 * of the stream, an octave down, held until the next beat. */
const pokok = (stream: (string | null)[], every: number): NoteSpec[] =>
    stream.flatMap((pitch, step): NoteSpec[] => pitch && step % every === 0
        ? [[transposePitch(pitch, -12)!, step, every, step % (every * 4) === 0 ? 0.85 : 0.68]]
        : []);
const run = (pitches: string[], vel: (step: number) => number): NoteSpec[] => pitches.map((pitch, step) => [pitch, step, 1, vel(step)]);

const STREAM_ONE = [
    'D6', 'D#6', 'D6', 'G6', 'G6', 'A6', 'G6', 'A6', 'A6', 'A#6', 'A6', 'G6', 'G6', 'A6', 'G6', 'D#6',
    'A#6', 'A6', 'A#6', 'D7', 'A6', 'A#6', 'A6', 'G6', 'G6', 'A6', 'G6', 'D#6', 'D6', 'D#6', 'D6', null
];
const STREAM_TWO = [
    'D6', 'G6', 'A6', 'G6', 'D6', 'G6', 'A6', 'A#6', 'A6', 'G6', 'A6', 'A#6', 'D7', 'A#6', 'A6', 'G6',
    'A6', 'G6', 'D#6', 'D6', 'D#6', 'G6', 'A6', 'G6', 'D6', 'D#6', 'D6', 'D#6', 'D6', 'G6', 'A6', 'D7'
];
const STREAM_SEVEN = [
    'D6', 'D#6', 'D6', 'G6', 'A6', 'G6', 'A6', 'A#6', 'A6', 'G6', 'A6', 'G6', 'D#6', 'D6',
    'G6', 'A6', 'A#6', 'A6', 'D7', 'A#6', 'A6', 'G6', 'A6', 'G6', 'D#6', 'D6', 'D#6', 'D6'
];
const STREAM_STORM = [
    'D6', 'F6', 'A#6', 'F6', 'D6', 'F6', 'A#6', 'D7', 'C6', 'E6', 'G6', 'E6', 'C6', 'E6', 'G6', 'C7',
    'D6', 'F6', 'A6', 'F6', 'D6', 'F6', 'A6', 'D7', 'A6', 'F6', 'D6', 'F6', 'A6', 'D7', 'A6', 'F6'
];
const KORA_SEVEN = [
    'D5', 'G5', 'A5', 'D6', 'A5', 'G5', 'D5', 'A#5', 'A5', 'G5', 'A5', 'A#5', 'D6', 'A5',
    'G5', 'A5', 'A#5', 'D6', 'D#6', 'D6', 'A#5', 'A5', 'G5', 'A5', 'D6', 'A5', 'G5', 'D5'
];
const KORA_STORM = [
    'A#5', 'D6', 'F6', 'A#6', 'F6', 'D6', 'A#5', 'D6', 'C6', 'E6', 'G6', 'C7', 'G6', 'E6', 'C6', 'E6',
    'D6', 'F6', 'A6', 'D7', 'A6', 'F6', 'D6', 'F6', 'A6', 'D7', 'A6', 'F6', 'D6', 'F6', 'A6', 'F6'
];

const odd = (count: number): number[] => Array.from({length: count / 2}, (_, index) => index * 2 + 1);
const even = (count: number): number[] => Array.from({length: count / 2}, (_, index) => index * 2);
const range = (from: number, to: number): number[] => Array.from({length: to - from}, (_, index) => from + index);

function buildInstruments(): Instrument[] {
    return [
        // Taiko: a skin's inharmonic modes (1 : 1.59 : 2.3) around a 55 Hz
        // fundamental, a short drop and the slap of the bachi as a low noise band
        instrument(ID.odaiko, 'Drums/Taiko/Odaiko', COLOR.odaiko, {
            tone: 1, q: 6, partials: [{ratio: 1, level: 1}, {ratio: 1.59, level: 0.4}, {ratio: 2.3, level: 0.2}],
            noise: 0.25, noiseFreq: 700, pitchDrop: 5, pitchTime: 0.12,
            att: 0.002, dec: 0.7, sus: 0, rel: 0.6, gain: 0.8
        }),
        instrument(ID.shime, 'Drums/Taiko/Shime-daiko', COLOR.shime, {
            tone: 0.8, q: 5, partials: [{ratio: 1, level: 1}, {ratio: 1.6, level: 0.5}],
            noise: 0.6, noiseFreq: 2400, pitchDrop: 8, pitchTime: 0.04,
            att: 0.002, dec: 0.09, sus: 0, rel: 0.08, gain: 0.5, pan: 0.3
        }),
        // the hand drum's "dung" slides *up* into its note (negative bend)
        instrument(ID.kendang, 'Drums/Kendang', COLOR.kendang, {
            tone: 1, q: 7, partials: [{ratio: 1, level: 1}, {ratio: 1.5, level: 0.35}, {ratio: 2.2, level: 0.15}],
            noise: 0.3, noiseFreq: 1500, pitchDrop: -6, pitchTime: 0.09,
            att: 0.002, dec: 0.22, sus: 0, rel: 0.15, gain: 0.6, pan: -0.25
        }),
        instrument(ID.ceng, 'Percussion/Ceng-ceng', COLOR.ceng, {
            tone: 0.35, q: 12, partials: [{ratio: 1, level: 1}, {ratio: 1.41, level: 0.8}, {ratio: 2.24, level: 0.7}, {ratio: 2.83, level: 0.6}],
            noise: 1, noiseFreq: 6500, att: 0.002, dec: 0.12, sus: 0, rel: 0.15, gain: 0.2, pan: 0.2
        }),
        // Gong ageng: two ranks 30 cents apart beat at ~1.3 Hz — the ombak. q 12
        // so that the 73 Hz fundamental blooms in half a second, not in three.
        // (A lane widens the detune towards the storm: the beat speeds up.)
        instrument(ID.gong, 'Percussion/Tuned/Gong Ageng', COLOR.gong, {
            tone: 1, q: 12,
            partials: [{ratio: 1, level: 1}, {ratio: 2.02, level: 0.55}, {ratio: 2.94, level: 0.3}, {ratio: 4.1, level: 0.15}, {ratio: 5.6, level: 0.08}],
            voices: 2, detune: 30, att: 0.01, dec: 3, sus: 0.35, rel: 3.5, gain: 0.6
        }),
        // Gendér: free-bar modes 1 : 2.76 : 5.4, paired tuning as a slight
        // unison shimmer; polos and sangsih are the same instrument panned apart.
        // Their decay is a lane — the players damp the bars in the fast sections.
        instrument(ID.polos, 'Percussion/Tuned/Gendér Polos', COLOR.polos, {
            tone: 1, q: 45, partials: [{ratio: 1, level: 1}, {ratio: 2.76, level: 0.45}, {ratio: 5.4, level: 0.15}],
            voices: 2, detune: 14, att: 0.002, dec: 1, sus: 0.12, rel: 0.7, gain: 0.6, pan: -0.55
        }),
        instrument(ID.sangsih, 'Percussion/Tuned/Gendér Sangsih', COLOR.sangsih, {
            tone: 1, q: 45, partials: [{ratio: 1, level: 1}, {ratio: 2.76, level: 0.45}, {ratio: 5.4, level: 0.15}],
            voices: 2, detune: 14, att: 0.002, dec: 1, sus: 0.12, rel: 0.7, gain: 0.6, pan: 0.55
        }),
        // Jublag: the mid-low gendér that carries the pokok under the kotekan —
        // the same bar modes an octave and a half down, ringing a whole beat
        instrument(ID.jublag, 'Percussion/Tuned/Jublag', COLOR.jublag, {
            tone: 1, q: 20, partials: [{ratio: 1, level: 1}, {ratio: 2.76, level: 0.4}, {ratio: 5.4, level: 0.12}],
            voices: 2, detune: 10, att: 0.004, dec: 1.8, sus: 0.25, rel: 1.4, gain: 0.55, pan: -0.1
        }),
        // a handpan's tone field is tuned harmonically (fundamental, octave, fifth above)
        instrument(ID.handpan, 'Percussion/Tuned/Handpan', COLOR.handpan, {
            tone: 1, q: 40, partials: [{ratio: 1, level: 1}, {ratio: 2, level: 0.7}, {ratio: 3, level: 0.4}],
            att: 0.003, dec: 1.4, sus: 0.08, rel: 1.2, gain: 0.7, pan: -0.15
        }),
        // Singing bowl, bowed: the note swells in over a second and three ranks
        // a few cents apart give the slow wobble of the rim. It is never struck —
        // legato links *slide* it from note to note, which no real bowl can do.
        instrument(ID.bowl, 'Percussion/Tuned/Singing Bowl', COLOR.bowl, {
            tone: 1, q: 80, partials: [{ratio: 1, level: 1}, {ratio: 2.71, level: 0.5}, {ratio: 5.1, level: 0.2}],
            voices: 3, detune: 9, att: 1.2, dec: 1.5, sus: 0.9, rel: 2.5, gain: 0.3, pan: -0.3
        }),
        // Shakuhachi: breath as a wide band, an upward scoop into every note,
        // late wide vibrato and a loose mouth resonance around the tube
        instrument(ID.shakuhachi, 'Winds/Shakuhachi', COLOR.shakuhachi, {
            tone: 1, q: 22, partials: [{ratio: 1, level: 1}, {ratio: 2, level: 0.35}, {ratio: 3, level: 0.2}, {ratio: 4, level: 0.08}],
            noise: 0.2, noiseFreq: 3000, formant: 0.35, f1: 800, f2: 1700, f3: 3300, formantQ: 2,
            vib: 22, vibRate: 4.6, vibDelay: 0.5, pitchDrop: -2, pitchTime: 0.14,
            att: 0.09, dec: 0.4, sus: 0.8, rel: 0.4, gain: 0.6, pan: 0.2
        }),
        // Duduk: a reed's full harmonic series under a dark, nasal formant set
        instrument(ID.duduk, 'Winds/Duduk', COLOR.duduk, {
            tone: 1, q: 30,
            partials: [{ratio: 1, level: 1}, {ratio: 2, level: 0.8}, {ratio: 3, level: 0.65}, {ratio: 4, level: 0.5}, {ratio: 5, level: 0.4}, {ratio: 6, level: 0.3}, {ratio: 7, level: 0.22}, {ratio: 8, level: 0.16}],
            formant: 0.7, f1: 850, f2: 1350, f3: 2700, formantQ: 3.5, vib: 14, vibRate: 5, vibDelay: 0.45,
            att: 0.07, dec: 0.5, sus: 0.85, rel: 0.35, gain: 0.6
        }),
        // Khoomei: twelve even harmonics of one low D, a chest resonance (F1)
        // and the narrowest possible F2 — the automation lane on f2 picks the
        // harmonic that whistles above the drone, which *is* the melody; a lane
        // on f1 moves the jaw between lower harmonics along with it
        instrument(ID.khoomei, 'Vocals/Khoomei Drone', COLOR.khoomei, {
            tone: 1, q: 26,
            partials: [1, 0.9, 0.85, 0.8, 0.8, 0.78, 0.76, 0.74, 0.72, 0.7, 0.66, 0.62].map((level, index) => ({ratio: index + 1, level})),
            formant: 1, f1: overtone(3), f2: overtone(8), f3: 2600, formantQ: 16, vib: 6, vibRate: 5.2, vibDelay: 1.2,
            att: 0.35, dec: 0.6, sus: 1, rel: 0.9, gain: 0.45
        }),
        // Kora: a harp-lute — bright plucked harmonics plus the faint buzz of its bridge
        instrument(ID.kora, 'Strings/Kora', COLOR.kora, {
            tone: 1, q: 55,
            partials: [{ratio: 1, level: 1}, {ratio: 2, level: 0.75}, {ratio: 3, level: 0.5}, {ratio: 4, level: 0.35}, {ratio: 5, level: 0.22}, {ratio: 6, level: 0.12}],
            noise: 0.06, noiseFreq: 5000, att: 0.002, dec: 0.5, sus: 0.04, rel: 0.35, gain: 0.75, pan: 0.3
        }),
        instrument(ID.sub, 'Bass/Bronze Sub', COLOR.sub, {
            tone: 1, q: 12, partials: [{ratio: 1, level: 1}, {ratio: 2, level: 0.45}],
            att: 0.05, dec: 0.4, sus: 1, rel: 0.5, gain: 0.4
        }),
        instrument(ID.rain, 'FX/Monsoon Rain', COLOR.rain, {
            tone: 0, noise: 1, noiseFreq: 3800, att: 3, dec: 1, sus: 1, rel: 4, gain: 0.035
        }),
        // Wind: one noise band held for a whole section while lanes move its
        // centre frequency and its position — gusts crossing the courtyard
        instrument(ID.wind, 'FX/Monsoon Wind', COLOR.wind, {
            tone: 0, noise: 1, noiseFreq: 700, att: 2, dec: 1, sus: 1, rel: 3, gain: 0.04
        }),
        // a low noise band that falls an octave over 1.4 s: thunder rolling away
        instrument(ID.thunder, 'FX/Thunder', COLOR.thunder, {
            tone: 0.6, q: 3, partials: [{ratio: 1, level: 1}], noise: 0.9, noiseFreq: 140,
            pitchDrop: 14, pitchTime: 1.4, noiseBend: 1, att: 0.05, dec: 1.8, sus: 0, rel: 1.5, gain: 0.35
        }),
        // Riser: starts two octaves under its note and climbs for the whole eye
        // of the storm (5.4 s = one section); the noise band climbs with it
        instrument(ID.riser, 'FX/Storm Riser', COLOR.riser, {
            tone: 1, q: 20, partials: [{ratio: 1, level: 1}, {ratio: 2, level: 0.5}, {ratio: 3, level: 0.25}],
            noise: 0.4, noiseFreq: 2400, noiseBend: 1, pitchDrop: -24, pitchTime: 5.4,
            att: 0.5, dec: 1, sus: 1, rel: 0.8, gain: 0.25
        })
    ];
}

/** Frequency (Hz) of the n-th harmonic of the khoomei drone (or of another root). */
function overtone(harmonic: number, root: string = DRONE): number {
    return Math.round(noteByName[root].freq * harmonic);
}

const P = {
    rain: uuid(2, 1), prayer: uuid(2, 2), ground: uuid(2, 3), thunder: uuid(2, 4), turn: uuid(2, 5), drone: uuid(2, 6),
    squall: uuid(2, 7), bowlDrift: uuid(2, 8),
    kotekanOne: uuid(3, 1), kotekanTwo: uuid(3, 2), kendang: uuid(3, 3), call: uuid(3, 4), answer: uuid(3, 5),
    pulse: uuid(3, 6), kendangBreak: uuid(3, 7), odaikoRoll: uuid(3, 8), pokokOne: uuid(3, 9), pokokTwo: uuid(3, 10),
    taikoSeven: uuid(4, 1), genderSeven: uuid(4, 2), cascade: uuid(4, 3), groundSeven: uuid(4, 4), lament: uuid(4, 5),
    droneSeven: uuid(4, 6), shakuhachiSeven: uuid(4, 7), fillSeven: uuid(4, 8), pokokSeven: uuid(4, 9),
    stormTaiko: uuid(5, 1), stormKora: uuid(5, 2), stormKotekan: uuid(5, 3), stormGround: uuid(5, 4), theme: uuid(5, 5),
    stormShakuhachi: uuid(5, 6), climb: uuid(5, 7), eye: uuid(5, 8), stormDrone: uuid(5, 9), finalHit: uuid(5, 10), hold: uuid(5, 11),
    pokokStorm: uuid(5, 12), hemiola: uuid(5, 13), eyeSquall: uuid(5, 14)
} as const;

function buildPatterns(): Pattern[] {
    const one = kotekan(STREAM_ONE), two = kotekan(STREAM_TWO), seven = kotekan(STREAM_SEVEN), storm = kotekan(STREAM_STORM);
    const patterns = [
        pattern(P.rain, '01 Rain/rain wash', FOUR, COLOR.rain, {[ID.rain]: [['A5', 0, FOUR, 0.8]]}),
        pattern(P.squall, '01 Rain/squall', FOUR, COLOR.wind, {[ID.rain]: [['A5', 0, FOUR, 0.8]], [ID.wind]: [['A4', 0, FOUR, 0.9]]}),
        pattern(P.prayer, '01 Rain/handpan prayer', FOUR, COLOR.handpan, {
            [ID.handpan]: [['D5', 0, 4, 0.9], ['A5', 4, 4, 0.7], ['A#5', 8, 3, 0.75], ['A5', 11, 1, 0.5], ['G5', 12, 4, 0.7],
                ['D5', 16, 4, 0.85], ['G5', 20, 4, 0.65], ['A5', 24, 8, 0.75], ['D6', 26, 6, 0.45]]
        }),
        // three notes bowed as one line: a 24-step cycle that drifts against
        // the 32-step rain and meets it again every three sections
        pattern(P.bowlDrift, '01 Rain/bowl drift', BOWL, COLOR.bowl, {
            [ID.bowl]: [['D6', 0, 8, 0.7], ['A5', 10, 6, 0.6], ['G5', 18, 6, 0.6]]
        }),
        pattern(P.ground, '01 Rain/gong and ground', FOUR, COLOR.gong, {
            [ID.gong]: [[DRONE, 0, FOUR, 1]], [ID.sub]: [[DRONE, 0, FOUR, 0.75]]
        }),
        pattern(P.thunder, '01 Rain/thunder', FOUR, COLOR.thunder, {[ID.thunder]: [['A2', 24, 4, 0.9]]}),
        pattern(P.turn, '01 Rain/handpan turn', FOUR, COLOR.handpan, {
            [ID.handpan]: [['D5', 0, 4, 0.85], ['G5', 4, 2, 0.6], ['A5', 6, 2, 0.65], ['A#5', 8, 4, 0.75], ['D6', 12, 4, 0.6],
                ['A5', 16, 6, 0.7], ['G5', 22, 2, 0.5], ['D#5', 24, 4, 0.6], ['D5', 28, 4, 0.8]]
        }),
        pattern(P.drone, '01 Rain/khoomei drone', FOUR, COLOR.khoomei, {[ID.khoomei]: [[DRONE, 0, FOUR, 0.9]]}),

        pattern(P.kotekanOne, '02 Bronze/kotekan one', FOUR, COLOR.polos, {[ID.polos]: one.polos, [ID.sangsih]: one.sangsih}),
        pattern(P.kotekanTwo, '02 Bronze/kotekan two', FOUR, COLOR.sangsih, {[ID.polos]: two.polos, [ID.sangsih]: two.sangsih}),
        pattern(P.pokokOne, '02 Bronze/pokok one', FOUR, COLOR.jublag, {[ID.jublag]: pokok(STREAM_ONE, 4)}),
        pattern(P.pokokTwo, '02 Bronze/pokok two', FOUR, COLOR.jublag, {[ID.jublag]: pokok(STREAM_TWO, 4)}),
        pattern(P.kendang, '02 Bronze/kendang groove', FOUR, COLOR.kendang, {
            [ID.kendang]: [['G4', 0, 1, 0.85], ['D5', 3, 1, 0.5], ['G4', 6, 1, 0.7], ['D5', 8, 1, 0.55], ['D5', 10, 1, 0.45], ['G4', 12, 1, 0.8], ['D5', 14, 1, 0.5], ['D5', 15, 1, 0.35],
                ['G4', 16, 1, 0.85], ['D5', 19, 1, 0.5], ['G4', 22, 1, 0.7], ['D5', 24, 1, 0.55], ['G4', 26, 1, 0.75], ['D5', 28, 1, 0.5], ['D5', 30, 1, 0.4], ['D5', 31, 1, 0.3]],
            [ID.shime]: hits('E5', [4, 12, 20, 27, 28], step => step === 27 ? 0.4 : 0.55),
            [ID.ceng]: hits('A6', odd(FOUR), step => step % 8 === 7 ? 0.65 : 0.45)
        }),
        pattern(P.call, '02 Bronze/shakuhachi call', FOUR, COLOR.shakuhachi, {
            [ID.shakuhachi]: [['D#6', 0, 3, 0.6], ['D6', 3, 9, 0.85], ['G6', 14, 6, 0.7], ['A6', 20, 4, 0.75], ['A#6', 24, 2, 0.7], ['A6', 26, 6, 0.8]]
        }),
        pattern(P.answer, '02 Bronze/shakuhachi answer', FOUR, COLOR.shakuhachi, {
            [ID.shakuhachi]: [['D7', 0, 4, 0.8], ['A#6', 4, 4, 0.75], ['A6', 8, 6, 0.7], ['G6', 16, 3, 0.65], ['D#6', 19, 3, 0.6], ['D6', 22, 10, 0.85]]
        }),
        pattern(P.pulse, '02 Bronze/gong pulse', FOUR, COLOR.gong, {
            [ID.gong]: [[DRONE, 0, 24, 0.95]],
            [ID.sub]: [[DRONE, 0, 6, 0.8], [DRONE, 8, 6, 0.7], [DRONE, 16, 6, 0.8], [DRONE, 24, 6, 0.7]]
        }),
        pattern(P.kendangBreak, '02 Bronze/kendang break', FOUR, COLOR.odaiko, {
            [ID.odaiko]: [['A2', 0, 1, 1], ['A2', 16, 1, 0.9]],
            [ID.kendang]: [['G4', 8, 1, 0.7], ['D5', 11, 1, 0.45], ['G4', 24, 1, 0.7], ['D5', 27, 1, 0.45], ['D5', 29, 1, 0.35]],
            [ID.ceng]: hits('A6', [4, 12, 20, 28], () => 0.4)
        }),
        pattern(P.odaikoRoll, '02 Bronze/odaiko roll', FOUR, COLOR.odaiko, {
            [ID.odaiko]: [['A2', 0, 1, 1], ['A2', 8, 1, 0.7], ...roll('A2', [16, 18, 20, 22, 24, 25, 26, 27, 28, 29, 30, 31], 0.5, 1)],
            [ID.shime]: roll('E5', range(24, FOUR), 0.4, 0.7),
            [ID.thunder]: [['A2', 28, 4, 0.9]]
        }),

        pattern(P.taikoSeven, '03 Seven Rains/taiko seven', SEVEN, COLOR.odaiko, {
            [ID.odaiko]: hits('A2', [0, 6, 10, 14, 20, 24], step => step % 14 === 0 ? 1 : step % 14 === 6 ? 0.75 : 0.85),
            [ID.shime]: hits('E5', [2, 4, 8, 12, 13, 16, 18, 22, 26, 27], step => [12, 26].includes(step) ? 0.7 : [13, 27].includes(step) ? 0.45 : 0.52),
            [ID.ceng]: hits('A6', odd(SEVEN), step => [5, 9, 19, 23].includes(step) ? 0.6 : 0.4)
        }),
        pattern(P.genderSeven, '03 Seven Rains/gendér seven', SEVEN, COLOR.polos, {[ID.polos]: seven.polos, [ID.sangsih]: seven.sangsih}),
        pattern(P.pokokSeven, '03 Seven Rains/pokok seven', SEVEN, COLOR.jublag, {[ID.jublag]: pokok(STREAM_SEVEN, 7)}),
        pattern(P.cascade, '03 Seven Rains/kora cascade', SEVEN, COLOR.kora, {
            [ID.kora]: run(KORA_SEVEN, step => step % 7 === 0 ? 0.8 : step % 2 === 0 ? 0.55 : 0.48)
        }),
        pattern(P.groundSeven, '03 Seven Rains/seven ground', SEVEN, COLOR.gong, {
            [ID.gong]: [[DRONE, 0, SEVEN, 0.9]],
            [ID.sub]: [[DRONE, 0, 5, 0.8], [DRONE, 6, 4, 0.7], [DRONE, 10, 4, 0.7], [DRONE, 14, 5, 0.8], [DRONE, 20, 4, 0.7], [DRONE, 24, 4, 0.7]]
        }),
        pattern(P.lament, '03 Seven Rains/duduk lament', SEVEN, COLOR.duduk, {
            [ID.duduk]: [['D5', 0, 6, 0.7], ['D#5', 6, 4, 0.6], ['D5', 10, 4, 0.7], ['G5', 14, 6, 0.75], ['A5', 20, 4, 0.7], ['G5', 24, 4, 0.65]]
        }),
        pattern(P.droneSeven, '03 Seven Rains/khoomei seven', SEVEN, COLOR.khoomei, {[ID.khoomei]: [[DRONE, 0, SEVEN, 0.9]]}),
        pattern(P.shakuhachiSeven, '03 Seven Rains/shakuhachi seven', SEVEN, COLOR.shakuhachi, {
            [ID.shakuhachi]: [['D7', 0, 6, 0.8], ['A#6', 6, 4, 0.7], ['A6', 10, 4, 0.8], ['G6', 14, 6, 0.7], ['A6', 20, 8, 0.75]]
        }),
        pattern(P.fillSeven, '03 Seven Rains/seven fill', SEVEN, COLOR.odaiko, {
            [ID.odaiko]: [['A2', 0, 1, 1], ['A2', 6, 1, 0.75], ['A2', 10, 1, 0.85], ['A2', 14, 1, 1], ...roll('A2', [18, 20, 22, 24, 25, 26, 27], 0.6, 1)],
            [ID.shime]: roll('E5', range(14, SEVEN), 0.35, 0.8),
            [ID.thunder]: [['A2', 24, 4, 1]]
        }),

        pattern(P.stormTaiko, '04 Storm/storm taiko', FOUR, COLOR.odaiko, {
            [ID.odaiko]: accents('A2', [[0, 1], [6, 0.6], [8, 0.8], [12, 0.7], [16, 1], [22, 0.6], [24, 0.85], [28, 0.65], [30, 0.75]]),
            [ID.shime]: hits('E5', [2, 6, 10, 14, 15, 18, 22, 26, 29, 31], step => step === 15 ? 0.8 : step === 31 ? 0.85 : 0.5),
            [ID.kendang]: [['G4', 4, 1, 0.75], ['D5', 7, 1, 0.45], ['G4', 12, 1, 0.7], ['D5', 15, 1, 0.5], ['G4', 20, 1, 0.75], ['D5', 23, 1, 0.45], ['G4', 28, 1, 0.7], ['D5', 31, 1, 0.5]],
            [ID.ceng]: hits('A6', even(FOUR), step => step % 4 === 0 ? 0.6 : 0.35)
        }),
        // the taiko in three against everything else in four: a 12-step bar
        // that only lands on the downbeat again after eight cycles
        pattern(P.hemiola, '04 Storm/taiko in three', THREE, COLOR.odaiko, {
            [ID.odaiko]: [['A2', 0, 1, 1], ['A2', 6, 1, 0.8]],
            [ID.shime]: [['E5', 3, 1, 0.55], ['E5', 9, 1, 0.55], ['E5', 11, 1, 0.4]],
            [ID.kendang]: [['G4', 4, 1, 0.7], ['D5', 10, 1, 0.5]],
            [ID.ceng]: hits('A6', odd(THREE), step => step % 6 === 5 ? 0.6 : 0.4)
        }),
        pattern(P.stormKora, '04 Storm/storm kora', FOUR, COLOR.kora, {
            [ID.kora]: run(KORA_STORM, step => step % 8 === 0 ? 0.8 : step % 2 === 0 ? 0.62 : 0.55)
        }),
        pattern(P.stormKotekan, '04 Storm/storm kotekan', FOUR, COLOR.polos, {[ID.polos]: storm.polos, [ID.sangsih]: storm.sangsih}),
        pattern(P.pokokStorm, '04 Storm/pokok storm', FOUR, COLOR.jublag, {[ID.jublag]: pokok(STREAM_STORM, 8)}),
        // the ground is one sliding line: Bb glides into C, C into D
        pattern(P.stormGround, '04 Storm/storm ground', FOUR, COLOR.gong, {
            [ID.sub]: [['A#2', 0, 6, 0.85], ['C3', 8, 6, 0.85], [DRONE, 16, 16, 0.9]],
            [ID.gong]: [[DRONE, 16, 16, 0.9]]
        }),
        pattern(P.theme, '04 Storm/duduk theme', FOUR, COLOR.duduk, {
            [ID.duduk]: [['F5', 0, 6, 0.75], ['G5', 6, 2, 0.6], ['A5', 8, 6, 0.8], ['G5', 14, 2, 0.6], ['F5', 16, 4, 0.75], ['E5', 20, 4, 0.7], ['D5', 24, 8, 0.85]]
        }),
        pattern(P.stormShakuhachi, '04 Storm/shakuhachi storm', FOUR, COLOR.shakuhachi, {
            [ID.shakuhachi]: [['A6', 6, 2, 0.55], ['A#6', 8, 6, 0.7], ['D7', 20, 4, 0.75], ['C7', 24, 2, 0.6], ['A6', 26, 6, 0.7]]
        }),
        pattern(P.climb, '04 Storm/duduk climb', FOUR, COLOR.duduk, {
            [ID.duduk]: [['F5', 0, 4, 0.75], ['A5', 4, 4, 0.8], ['C6', 8, 6, 0.85], ['A#5', 14, 2, 0.7], ['A5', 16, 4, 0.8], ['G5', 20, 2, 0.65], ['F5', 22, 2, 0.6], ['E5', 24, 3, 0.65], ['D5', 27, 5, 0.8]]
        }),
        pattern(P.eye, '04 Storm/eye of the storm', FOUR, COLOR.gong, {
            [ID.gong]: [[DRONE, 0, FOUR, 1]], [ID.sub]: [[DRONE, 0, FOUR, 0.55]]
        }),
        // rain, a gust swept across the field by its lanes, and the riser
        // climbing two octaves under all of it
        pattern(P.eyeSquall, '04 Storm/eye squall', FOUR, COLOR.riser, {
            [ID.rain]: [['A5', 0, FOUR, 0.8]], [ID.wind]: [['A4', 0, FOUR, 1]], [ID.riser]: [['D6', 0, FOUR, 1]]
        }),
        pattern(P.stormDrone, '04 Storm/khoomei storm', FOUR, COLOR.khoomei, {[ID.khoomei]: [[DRONE, 0, FOUR, 0.95]]}),
        pattern(P.finalHit, '04 Storm/final hit', FOUR, COLOR.odaiko, {
            [ID.odaiko]: [['A2', 0, 1, 1]], [ID.shime]: [['E5', 0, 1, 0.8]], [ID.thunder]: [['A2', 0, 6, 1]]
        }),
        pattern(P.hold, '04 Storm/duduk hold', FOUR, COLOR.duduk, {
            [ID.duduk]: [['D5', 0, 24, 0.85], ['A5', 0, 24, 0.45]]
        })
    ];
    // the shakuhachi's meri slides and the duduk's falling cadences
    legato(patterns, P.call, ID.shakuhachi, 0, 3, 'ease-out');
    legato(patterns, P.call, ID.shakuhachi, 24, 26, 'ease-out');
    legato(patterns, P.answer, ID.shakuhachi, 0, 4, 'smooth');
    legato(patterns, P.answer, ID.shakuhachi, 19, 22, 'ease-out');
    legato(patterns, P.shakuhachiSeven, ID.shakuhachi, 6, 10, 'ease-out');
    legato(patterns, P.stormShakuhachi, ID.shakuhachi, 6, 8, 'ease-in');
    legato(patterns, P.stormShakuhachi, ID.shakuhachi, 24, 26, 'ease-out');
    legato(patterns, P.lament, ID.duduk, 6, 10, 'ease-out');
    legato(patterns, P.theme, ID.duduk, 20, 24, 'ease-out');
    legato(patterns, P.climb, ID.duduk, 24, 27, 'smooth');
    // the bowl is bowed through its three notes, the sub through its three roots
    legato(patterns, P.bowlDrift, ID.bowl, 0, 10, 'smooth');
    legato(patterns, P.bowlDrift, ID.bowl, 10, 18, 'ease-out');
    legato(patterns, P.stormGround, ID.sub, 0, 8, 'ease-in');
    legato(patterns, P.stormGround, ID.sub, 8, 16, 'ease-in');
    return patterns;
}

/* ---- arrangement ----
 * Sections are two bars each; the Seven Rains sections are 28 steps long, so
 * clip positions are accumulated rather than multiplied. A layer with `span`
 * covers that many sections with one clip — longer than its pattern, so the
 * pattern cycles inside it: that is how the 24- and 12-step patterns run
 * against the 32-step grid. */
type Layer = readonly [patternId: string, track: number, transpose?: number, span?: number];
interface Section {
    len: number;
    layers: readonly Layer[];
}

const {weather: W, taiko: T, ground: G, gender: D, pemade: M, jublag: J, shakuhachi: S, duduk: U, khoomei: K, strings: R, bowl: B} = TRACK;
const four = (...layers: Layer[]): Section => ({len: FOUR, layers});
const seven = (...layers: Layer[]): Section => ({len: SEVEN, layers});
// the sections whose drone is transposed to G along with everything else
const UP_SECTIONS = [16, 17, 18];

const SECTIONS: Section[] = [
    // 01 Rain
    four([P.rain, W]),
    four([P.rain, W], [P.prayer, R], [P.bowlDrift, B, 0, 3]),
    four([P.rain, W], [P.prayer, R], [P.ground, G], [P.drone, K]),
    four([P.squall, W], [P.thunder, T], [P.turn, R], [P.ground, G], [P.drone, K]),
    // 02 Bronze
    four([P.rain, W], [P.kotekanOne, D], [P.pokokOne, J], [P.ground, G], [P.drone, K]),
    four([P.kotekanOne, D], [P.pokokOne, J], [P.kendang, T], [P.pulse, G]),
    four([P.kotekanOne, D], [P.pokokOne, J], [P.kendang, T], [P.pulse, G], [P.call, S]),
    four([P.kotekanTwo, D], [P.pokokTwo, J], [P.kendang, T], [P.pulse, G], [P.answer, S]),
    four([P.kotekanOne, D], [P.pokokOne, J], [P.kendang, T], [P.pulse, G], [P.call, S], [P.prayer, R]),
    four([P.kotekanTwo, D], [P.pokokTwo, J], [P.kendang, T], [P.pulse, G], [P.answer, S], [P.turn, R]),
    four([P.kotekanOne, D], [P.pokokOne, J], [P.kendangBreak, T], [P.pulse, G], [P.drone, K]),
    four([P.kotekanTwo, D], [P.pokokTwo, J], [P.odaikoRoll, T], [P.ground, G], [P.drone, K]),
    // 03 Seven Rains
    seven([P.taikoSeven, T], [P.groundSeven, G], [P.droneSeven, K]),
    seven([P.taikoSeven, T], [P.genderSeven, D], [P.pokokSeven, J], [P.groundSeven, G], [P.droneSeven, K]),
    seven([P.taikoSeven, T], [P.genderSeven, D], [P.pokokSeven, J], [P.cascade, R], [P.groundSeven, G], [P.droneSeven, K]),
    seven([P.taikoSeven, T], [P.genderSeven, D], [P.pokokSeven, J], [P.cascade, R], [P.groundSeven, G], [P.lament, U]),
    seven([P.taikoSeven, T], [P.genderSeven, D, UP], [P.pokokSeven, J, UP], [P.cascade, R, UP], [P.groundSeven, G, UP], [P.droneSeven, K, UP]),
    seven([P.taikoSeven, T], [P.genderSeven, D, UP], [P.pokokSeven, J, UP], [P.cascade, R, UP], [P.groundSeven, G, UP], [P.lament, U, UP], [P.droneSeven, K, UP]),
    seven([P.taikoSeven, T], [P.genderSeven, D, UP], [P.pokokSeven, J, UP], [P.cascade, R, UP], [P.groundSeven, G, UP], [P.shakuhachiSeven, S, UP], [P.droneSeven, K, UP]),
    seven([P.fillSeven, T], [P.groundSeven, G], [P.cascade, R]),
    // 04 Storm
    four([P.stormTaiko, T], [P.stormKora, R], [P.stormKotekan, D], [P.pokokStorm, J], [P.stormGround, G]),
    four([P.stormTaiko, T], [P.stormKora, R], [P.stormKotekan, D], [P.pokokStorm, J], [P.stormGround, G], [P.theme, U]),
    four([P.stormTaiko, T], [P.stormKora, R], [P.stormKotekan, D], [P.pokokStorm, J], [P.stormGround, G], [P.theme, U], [P.stormShakuhachi, S]),
    four([P.stormTaiko, T], [P.stormKora, R], [P.stormKotekan, D], [P.pokokStorm, J], [P.stormGround, G], [P.climb, U], [P.stormShakuhachi, S]),
    four([P.eyeSquall, W], [P.eye, G], [P.drone, K], [P.prayer, R]),
    four([P.stormTaiko, T], [P.stormKora, R], [P.stormKotekan, D], [P.pokokStorm, J], [P.stormGround, G], [P.theme, U], [P.stormDrone, K]),
    // the last three storm sections: taiko in three, the kotekan doubled an octave down
    four([P.hemiola, T, 0, 3], [P.stormKora, R], [P.stormKotekan, D], [P.stormKotekan, M, -12], [P.stormGround, G], [P.climb, U], [P.stormShakuhachi, S], [P.stormDrone, K]),
    four([P.stormKora, R], [P.stormKotekan, D], [P.stormKotekan, M, -12], [P.stormGround, G], [P.theme, U], [P.stormShakuhachi, S], [P.stormDrone, K]),
    four([P.stormKora, R], [P.stormKotekan, D], [P.stormKotekan, M, -12], [P.stormGround, G], [P.climb, U], [P.stormShakuhachi, S], [P.stormDrone, K]),
    four([P.rain, W], [P.finalHit, T], [P.ground, G], [P.hold, U]),
    // 05 After
    four([P.squall, W], [P.ground, G], [P.drone, K], [P.prayer, R], [P.bowlDrift, B, 0, 3]),
    four([P.squall, W], [P.ground, G], [P.drone, K], [P.turn, R]),
    four([P.rain, W], [P.ground, G]),
    four([P.rain, W])
];

const sectionStarts = (sections: Section[]): number[] => sections.reduce<number[]>((starts, section, index) => {
    starts.push(index === 0 ? 0 : starts[index - 1] + sections[index - 1].len);
    return starts;
}, []);

function buildArrangement(sections: Section[], starts: number[]): ArrangementClip[] {
    return sections.flatMap((section, index) => section.layers.map(([patternId, track, transpose, span = 1], layer) => ({
        id: uuid(6, index * 16 + layer + 1),
        patternId,
        track,
        start: starts[index],
        len: sections.slice(index, index + span).reduce((sum, part) => sum + part.len, 0),
        ...(transpose ? {transpose} : {})
    })));
}

/* ---- automation ----
 * `at(section, offset)` addresses the timeline by section so that the lanes
 * survive the mixed 32/28-step grid. */
type Point = [section: number, offset: number, value: number, curve?: CurveShape];
type Melody = readonly (readonly [harmonic: number, steps: number])[];

function buildAutomation(starts: number[], end: number): AutomationLane[] {
    const at = (section: number, offset = 0): number => section < starts.length ? starts[section] + offset : end;
    const lane = (id: string, target: string, param: string, points: Point[]): AutomationLane => ({
        id, target, param,
        points: points.map(([section, offset, value, curve]) => ({step: at(section, offset), value, ...(curve ? {curve} : {})}))
    });
    /* The overtone melody: the singer holds one D (a G where the clip is
     * transposed) and moves the F2 resonance from harmonic to harmonic —
     * stepwise ("hold") like a real sygyt line. The same phrases drive F1,
     * which stays on a *lower* harmonic (3rd .. 5th) and opens with the tune. */
    const droneRoot = (section: number): string => UP_SECTIONS.includes(section) ? transposePitch(DRONE, UP)! : DRONE;
    const sing = (phrases: Record<number, Melody>, value: (harmonic: number, root: string) => number, rest: number): AutomationPoint[] => {
        const points: AutomationPoint[] = [];
        for (const [key, melody] of Object.entries(phrases)) {
            const section = Number(key);
            let offset = 0;
            for (const [harmonic, steps] of melody) {
                points.push({step: at(section, offset), value: value(harmonic, droneRoot(section)), curve: 'hold'});
                offset += steps;
            }
        }
        points.push({step: end, value: rest});
        return points;
    };
    const jaw = (harmonic: number, root: string): number => root === DRONE
        ? overtone(harmonic <= 8 ? 3 : harmonic <= 10 ? 4 : 5)
        : overtone(harmonic <= 9 ? 2 : 3, root);
    const rise: Melody = [[8, 8], [9, 8], [10, 8], [9, 8]];
    const fall: Melody = [[12, 8], [10, 8], [9, 8], [8, 8]];
    const stormRun: Melody = [[8, 4], [9, 4], [10, 4], [12, 4], [10, 4], [9, 4], [8, 4], [7, 4]];
    const phrases: Record<number, Melody> = {
        2: rise, 3: fall, 4: [[8, 16], [9, 8], [8, 8]],
        10: [[10, 8], [12, 8], [9, 8], [8, 8]], 11: [[8, 8], [9, 8], [10, 8], [12, 8]],
        12: [[8, 7], [9, 7], [10, 7], [9, 7]], 13: [[8, 7], [10, 7], [12, 7], [9, 7]], 14: [[10, 7], [9, 7], [8, 7], [7, 7]],
        // over G: its 6th, 9th and 12th harmonics are the D drone's 8th, 12th and 16th
        16: [[8, 7], [9, 7], [10, 7], [9, 7]], 17: [[6, 7], [8, 7], [9, 7], [12, 7]], 18: [[10, 7], [9, 7], [8, 7], [6, 7]],
        24: [[8, 8], [9, 8], [10, 8], [12, 8]],
        25: stormRun, 26: [[12, 4], [10, 4], [9, 4], [8, 4], [9, 4], [10, 4], [12, 4], [10, 4]],
        27: [[8, 4], [9, 4], [10, 4], [12, 4], [10, 4], [9, 4], [8, 8]], 28: [[9, 4], [10, 4], [12, 4], [10, 4], [12, 4], [10, 4], [9, 4], [8, 4]],
        30: [[12, 16], [10, 16]], 31: [[9, 16], [8, 16]]
    };
    // the two gendér players trade sides during the doubled storm kotekan
    const swap = (side: number): Point[] => [[0, 0, side, 'hold'], [26, 0, side, 'smooth'], [27, 16, -side, 'smooth'], [29, 0, side]];
    // damping: the gendér bars ring in the slow sections and are choked in the fast ones
    const damping: Point[] = [[0, 0, 1, 'hold'], [12, 0, 0.45, 'hold'], [20, 0, 0.7, 'hold'], [26, 0, 0.45, 'hold'], [29, 0, 1.4]];
    const choke: Point[] = [[0, 0, 0.7, 'hold'], [12, 0, 0.35, 'hold'], [20, 0, 0.5, 'hold'], [26, 0, 0.35, 'hold'], [29, 0, 1.2]];

    return [
        lane(uuid(7, 1), 'master', 'vol', [
            [0, 0, 0.6, 'ease-in'], [4, 0, 0.72, 'smooth'], [12, 0, 0.78, 'ease-in'], [20, 0, 0.88, 'hold'], [24, 0, 0.68, 'ease-in'],
            [25, 0, 0.9, 'hold'], [26, 0, 0.94, 'hold'], [29, 0, 0.86, 'ease-out'], [30, 0, 0.7, 'smooth'], [34, 0, 0.45]
        ]),
        lane(uuid(7, 2), 'master', 'rev', [
            [0, 0, 0.4, 'smooth'], [5, 0, 0.24, 'linear'], [12, 0, 0.2, 'ease-in'], [20, 0, 0.28, 'hold'], [24, 0, 0.45, 'hold'],
            [25, 0, 0.3, 'hold'], [26, 0, 0.26, 'hold'], [29, 0, 0.45, 'smooth'], [34, 0, 0.5]
        ]),
        lane(uuid(7, 3), 'master', 'tilt', [
            [0, 0, -3, 'smooth'], [5, 0, 0, 'linear'], [20, 0, 1, 'hold'], [24, 0, -2, 'ease-in'], [25, 0, 1, 'hold'], [26, 0, 2, 'hold'], [29, 0, -2]
        ]),
        lane(uuid(7, 4), ID.rain, 'gain', [
            [0, 0, 0, 'ease-in'], [1, 0, 0.035, 'linear'], [3, 0, 0.04, 'ease-out'], [5, 0, 0, 'hold'],
            [24, 0, 0.02, 'hold'], [25, 0, 0, 'hold'], [29, 0, 0.03, 'linear'], [30, 0, 0.04, 'hold'], [33, 0, 0.03, 'ease-out'], [34, 0, 0]
        ]),
        {id: uuid(7, 5), target: ID.khoomei, param: 'f2', points: sing(phrases, overtone, overtone(8))},
        lane(uuid(7, 6), ID.duduk, 'gain', [
            [15, 0, 0.45, 'ease-in'], [21, 0, 0.55, 'smooth'], [25, 0, 0.66, 'hold'], [29, 0, 0.6]
        ]),
        lane(uuid(7, 7), ID.kora, 'gain', [
            [14, 0, 0.6, 'ease-in'], [20, 0, 0.75, 'smooth'], [28, 0, 0.82]
        ]),
        lane(uuid(7, 8), ID.gong, 'gain', [
            [0, 0, 0.5, 'linear'], [20, 0, 0.6, 'hold'], [29, 0, 0.72, 'linear'], [34, 0, 0.55]
        ]),
        {id: uuid(7, 9), target: ID.khoomei, param: 'f1', points: sing(phrases, jaw, overtone(3))},
        lane(uuid(7, 10), ID.khoomei, 'vib', [[0, 0, 6, 'hold'], [24, 0, 6, 'linear'], [25, 0, 12, 'hold'], [29, 0, 6]]),
        // the rain drifts across the field; the wind's gusts are drawn as pitch and position
        lane(uuid(7, 11), ID.rain, 'pan', [
            [0, 0, -0.3, 'smooth'], [2, 0, 0.3, 'smooth'], [4, 0, -0.2, 'hold'], [24, 0, 0.5, 'smooth'], [25, 0, 0, 'hold'],
            [29, 0, -0.4, 'smooth'], [31, 0, 0.4, 'smooth'], [34, 0, 0]
        ]),
        lane(uuid(7, 12), ID.wind, 'gain', [
            [3, 0, 0, 'ease-in'], [3, 16, 0.05, 'ease-out'], [4, 0, 0, 'hold'], [24, 0, 0.01, 'ease-in'], [25, 0, 0.08, 'hold'],
            [26, 0, 0, 'hold'], [30, 0, 0.04, 'ease-out'], [32, 0, 0]
        ]),
        lane(uuid(7, 13), ID.wind, 'noiseFreq', [
            [3, 0, 600, 'smooth'], [3, 16, 1800, 'smooth'], [4, 0, 600, 'hold'], [24, 0, 500, 'ease-in'], [25, 0, 3000, 'hold'],
            [30, 0, 900, 'smooth'], [32, 0, 400]
        ]),
        lane(uuid(7, 14), ID.wind, 'pan', [
            [3, 0, -0.8, 'smooth'], [4, 0, 0.8, 'hold'], [24, 0, -0.9, 'linear'], [25, 0, 0.9, 'hold'], [30, 0, 0.6, 'smooth'], [32, 0, -0.6]
        ]),
        lane(uuid(7, 15), ID.riser, 'gain', [[24, 0, 0, 'ease-in'], [25, 0, 0.28]]),
        // the ombak: the gong's two ranks drift further apart, so the beat quickens into the storm
        lane(uuid(7, 16), ID.gong, 'detune', [[0, 0, 30, 'hold'], [20, 0, 34, 'linear'], [25, 0, 44, 'hold'], [29, 0, 48, 'hold'], [30, 0, 24]]),
        lane(uuid(7, 17), ID.polos, 'dec', damping),
        lane(uuid(7, 18), ID.sangsih, 'dec', damping),
        lane(uuid(7, 19), ID.polos, 'pan', swap(-0.55)),
        lane(uuid(7, 20), ID.sangsih, 'pan', swap(0.55)),
        lane(uuid(7, 24), ID.polos, 'rel', choke),
        lane(uuid(7, 25), ID.sangsih, 'rel', choke),
        lane(uuid(7, 21), ID.shakuhachi, 'noise', [[0, 0, 0.2, 'hold'], [20, 0, 0.3, 'linear'], [25, 0, 0.4, 'hold'], [29, 0, 0.15]]),
        // the duduk's last note closes from "ah" to "oo" while it is still sounding
        lane(uuid(7, 22), ID.duduk, 'f2', [[0, 0, 1350, 'hold'], [29, 0, 1350, 'smooth'], [29, 24, 900]]),
        lane(uuid(7, 23), ID.bowl, 'pan', [[1, 0, -0.5, 'smooth'], [4, 0, 0.5, 'hold'], [30, 0, 0.5, 'smooth'], [33, 0, -0.5]])
    ];
}

export function buildBronzeMonsoon(): Project {
    const starts = sectionStarts(SECTIONS);
    const end = starts[starts.length - 1] + SECTIONS[SECTIONS.length - 1].len;
    const automation = buildAutomation(starts, end);
    const tracks: Track[] = TRACK_NAMES.map((name, index) => ({name, color: TRACK_COLORS[index]}));
    return {
        formatVersion: PROJECT_FORMAT_VERSION,
        instruments: buildInstruments(),
        patterns: buildPatterns(),
        arrangement: buildArrangement(SECTIONS, starts),
        tracks,
        bpm: BPM,
        swing: 0,
        automation,
        automationOrder: automation.map(lane => lane.id),
        automationPositions: {},
        zoom: {seq: {width: 24, height: 14}, arr: {width: 24, height: 32}}
    };
}
