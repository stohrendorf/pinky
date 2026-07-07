import type {
    AutomationLane, CurveShape, Instrument, InstrumentParams, Note, Pattern, Project, Track
} from './types';

import {
    DEFAULT_PARAMS, ensurePartials
} from './instruments';
import {
    createId, PROJECT_FORMAT_VERSION
} from './types';

type NoteSpec = [pitch: string, start: number, len?: number, vel?: number];
type TrackNotes = Record<string, NoteSpec[]>;

const COLORS = ['#53d8fb', '#ff9f43', '#ee5253', '#10ac84', '#a29bfe', '#f9ca24', '#ff6b6b', '#48dbfb', '#e056fd'];

const note = ([pitch, start, len = 1, vel = 0.8]: NoteSpec): Note => ({pitch, start, len, vel});
const notes = (...items: NoteSpec[]): Note[] => items.map(note);
const pattern = (id: string, name: string, steps: number, color: string, tracks: TrackNotes): Pattern => ({
    id,
    name,
    steps,
    color,
    tracks: Object.fromEntries(Object.entries(tracks).map(([instrument, part]) => [instrument, notes(...part)]))
});
const instrument = (id: string, name: string, color: string, params: Partial<InstrumentParams>): Instrument => ({
    id,
    name,
    color,
    params: ensurePartials({...DEFAULT_PARAMS, ...params})
});
const tracks = (names: string[]): Track[] => names.map((name, index) => ({name, color: COLORS[index % COLORS.length]}));
const clip = (id: string, patternId: string, track: number, start: number, len: number, transpose?: number) =>
    ({id, patternId, track, start, len, ...(transpose ? {transpose} : {})});
type ArrangementSection = readonly (readonly [patternId: string, track: number])[];
const arrangeSong = (prefix: string, sections: ArrangementSection[]): Project['arrangement'] => sections.flatMap((section, sectionIndex) =>
    section.map(([patternId, track], layerIndex) => clip(`${prefix}${sectionIndex + 1}-${layerIndex + 1}`, patternId, track, sectionIndex * 32, 32))
);
const project = (instruments: Instrument[], patterns: Pattern[], arrangement: Project['arrangement'], laneNames: string[], bpm: number, automation: AutomationLane[], swing = 0): Project => {
    const instrumentIds = new Map(instruments.map(instrument => [instrument.id, createId()]));
    const patternIds = new Map(patterns.map(pattern => [pattern.id, createId()]));
    const automationIds = new Map(automation.map(lane => [lane.id, createId()]));
    const remapInstrumentId = (id: string): string => instrumentIds.get(id) || id;
    const remapPatternId = (id: string): string => patternIds.get(id) || id;

    return {
        formatVersion: PROJECT_FORMAT_VERSION,
        instruments: instruments.map(instrument => ({...instrument, id: remapInstrumentId(instrument.id)})),
        patterns: patterns.map(pattern => ({
            ...pattern,
            id: remapPatternId(pattern.id),
            tracks: Object.fromEntries(Object.entries(pattern.tracks).map(([id, notes]) => [remapInstrumentId(id), notes]))
        })),
        arrangement: arrangement.map(clip => ({...clip, id: createId(), patternId: remapPatternId(clip.patternId)})),
        tracks: tracks(laneNames),
        bpm,
        swing,
        automation: automation.map(lane => ({
            ...lane,
            id: automationIds.get(lane.id)!,
            target: lane.target === 'master' ? lane.target : remapInstrumentId(lane.target)
        })),
        automationOrder: automation.map(lane => automationIds.get(lane.id)!),
        automationPositions: {},
        zoom: {seq: {width: 24, height: 14}, arr: {width: 24, height: 32}}
    };
};
const connect = (patterns: Pattern[], patternId: string, instrumentId: string, from: number, to: number, curve: CurveShape) => {
    const part = patterns.find(value => value.id === patternId)?.tracks[instrumentId];
    const source = part?.find(value => value.start === from);
    const target = part?.find(value => value.start === to);
    if (!source || !target || target.start < source.start + source.len) {
        throw new Error(`Invalid legato link in ${patternId}/${instrumentId}: ${from} -> ${to}`);
    }
    source.legatoTo = {pitch: target.pitch, start: target.start, curve};
};

/* These are original compositions. They borrow only broad production traits from
 * cinematic science-fiction and funk: no existing melody, lyric, or arrangement
 * is quoted. Keeping them here as editable project data means every choice can be
 * inspected and reshaped in Pinky after the demo is loaded. */

export function buildRelayDawn(): Project {
    const instruments = [
        instrument('r1', 'Drums/Pulse Kick', COLORS[0], {
            tone: 0.9,
            q: 6,
            noise: 0.12,
            noiseFreq: 2600,
            pitchDrop: 19,
            pitchTime: 0.07,
            att: 0.002,
            dec: 0.16,
            sus: 0,
            rel: 0.1,
            gain: 0.75
        }),
        instrument('r2', 'Drums/Dust Snare', COLORS[1], {
            tone: 0.32,
            q: 8,
            noise: 0.9,
            noiseFreq: 3400,
            pitchDrop: 6,
            att: 0.002,
            dec: 0.16,
            sus: 0,
            rel: 0.18,
            gain: 0.56
        }),
        instrument('r3', 'Drums/Star Hat', COLORS[3], {
            tone: 0,
            q: 32,
            noise: 1,
            noiseFreq: 9800,
            att: 0.002,
            dec: 0.035,
            sus: 0,
            rel: 0.05,
            gain: 0.34,
            pan: 0.28
        }),
        instrument('r4', 'Bass/Sub Anchor', COLORS[4], {
            tone: 1,
            q: 28,
            harm: 2,
            falloff: 0.32,
            att: 0.02,
            dec: 0.14,
            sus: 0.72,
            rel: 0.2,
            gain: 0.62
        }),
        instrument('r5', 'Synth/Nebula Pad', COLORS[5], {
            tone: 0.7,
            q: 17,
            harm: 6,
            falloff: 0.72,
            noise: 0.08,
            noiseFreq: 2600,
            voices: 4,
            detune: 32,
            att: 0.65,
            dec: 0.3,
            sus: 0.78,
            rel: 1.2,
            gain: 0.42,
            pan: -0.12
        }),
        instrument('r6', 'Synth/Relay Pluck', COLORS[6], {
            tone: 1,
            q: 34,
            harm: 6,
            falloff: 0.58,
            partials: [{ratio: 1, level: 1}, {ratio: 2, level: 0.62}, {ratio: 3, level: 0.28}, {
                ratio: 5,
                level: 0.16
            }, {ratio: 7, level: 0.08}],
            att: 0.002,
            dec: 0.16,
            sus: 0.04,
            rel: 0.14,
            gain: 0.48,
            pan: 0.16
        }),
        instrument('r7', 'Vocals/Distant Choir', COLORS[7], {
            tone: 0.58,
            q: 15,
            harm: 4,
            falloff: 0.72,
            formant: 0.36,
            f1: 520,
            f2: 1120,
            f3: 2460,
            formantQ: 5,
            voices: 5,
            detune: 40,
            att: 0.8,
            dec: 0.3,
            sus: 0.85,
            rel: 1.4,
            gain: 0.34
        }),
        instrument('r8', 'Synth/Signal Lead', COLORS[8], {
            tone: 1,
            q: 36,
            harm: 5,
            falloff: 0.62,
            vib: 12,
            vibRate: 5.3,
            vibDelay: 0.28,
            att: 0.01,
            dec: 0.18,
            sus: 0.56,
            rel: 0.35,
            gain: 0.48,
            pan: -0.08,
            legatoCurve: 'smooth'
        }),
        instrument('r9', 'Percussion/Tuned/Orbit Bell', '#7ed6df', {
            tone: 0.86,
            q: 38,
            harm: 7,
            falloff: 0.65,
            stretch: 0.1,
            att: 0.002,
            dec: 0.5,
            sus: 0.08,
            rel: 1.1,
            gain: 0.29,
            pan: 0.3
        })
    ];
    const patterns = [
        pattern('rp1', '01 Intro/Quiet arrival', 32, '#394d70', {
            r5: [['E3', 0, 8, 0.45], ['B3', 0, 8, 0.35], ['F#4', 0, 8, 0.32], ['C#4', 8, 8, 0.42], ['G#3', 8, 8, 0.3], ['F#4', 8, 8, 0.3], ['A3', 16, 8, 0.42], ['E4', 16, 8, 0.32], ['B4', 16, 8, 0.26], ['B2', 24, 8, 0.4], ['F#3', 24, 8, 0.32], ['A4', 24, 8, 0.28]],
            r7: [['B3', 0, 16, 0.2], ['C#4', 16, 16, 0.23]],
            r9: [['B5', 6, 2, 0.35], ['F#6', 22, 2, 0.3]]
        }),
        pattern('rp2', '02 Main/Relay pulse', 16, '#4b668e', {
            r1: [['E1', 0, 1, 0.9], ['E1', 6, 1, 0.65], ['E1', 8, 1, 0.84], ['E1', 12, 1, 0.7]],
            r2: [['E2', 4, 1, 0.72], ['E2', 12, 1, 0.78]],
            r3: [['E4', 2, 1, 0.36], ['E4', 6, 1, 0.3], ['E4', 10, 1, 0.42], ['E4', 14, 1, 0.32]],
            r4: [['E2', 0, 3, 0.8], ['D2', 4, 2, 0.58], ['C2', 8, 3, 0.72], ['B1', 12, 2, 0.6]],
            r6: [['E5', 1, 1, 0.54], ['G5', 4, 1, 0.46], ['B5', 7, 1, 0.52], ['F#5', 10, 1, 0.48], ['E5', 13, 1, 0.44]]
        }),
        pattern('rp3', '02 Main/Wide horizon', 32, '#6387b5', {
            r5: [['E3', 0, 16, 0.46], ['B3', 0, 16, 0.34], ['F#4', 0, 16, 0.3], ['A3', 16, 16, 0.46], ['E4', 16, 16, 0.36], ['B4', 16, 16, 0.26]],
            r7: [['F#4', 0, 16, 0.25], ['E4', 16, 16, 0.26]],
            r9: [['E6', 12, 2, 0.32], ['B5', 28, 2, 0.34]]
        }),
        pattern('rp4', '02 Main/Signal answer', 32, '#8da8ca', {
            r8: [['E5', 0, 3, 0.66], ['G5', 4, 2, 0.72], ['B5', 7, 4, 0.78], ['F#5', 12, 3, 0.6], ['E5', 16, 2, 0.58], ['A5', 19, 3, 0.72], ['C6', 23, 3, 0.76], ['B5', 28, 4, 0.64]],
            r9: [['B5', 2, 1, 0.25], ['E6', 18, 1, 0.28]]
        }),
        pattern('rp5', '03 Development/Drift break', 32, '#58759c', {
            r4: [['E2', 0, 7, 0.56], ['D2', 8, 7, 0.5], ['C2', 16, 7, 0.54], ['B1', 24, 7, 0.5]],
            r6: [['E5', 0, 3, 0.38], ['G5', 6, 3, 0.34], ['B5', 12, 5, 0.4], ['F#5', 21, 4, 0.34], ['E5', 28, 4, 0.36]],
            r9: [['E6', 0, 2, 0.24], ['C#6', 16, 2, 0.25]]
        }),
        pattern('rp6', '05 Outro/Dawn return', 32, '#9ab6d3', {
            r1: [['E1', 0, 1, 0.92], ['E1', 4, 1, 0.62], ['E1', 8, 1, 0.82], ['E1', 14, 1, 0.68], ['E1', 16, 1, 0.9], ['E1', 22, 1, 0.65], ['E1', 24, 1, 0.86], ['E1', 28, 1, 0.72]],
            r2: [['E2', 4, 1, 0.72], ['E2', 12, 1, 0.8], ['E2', 20, 1, 0.74], ['E2', 28, 1, 0.82]],
            r3: [['E4', 2, 1, 0.42], ['E4', 6, 1, 0.34], ['E4', 10, 1, 0.42], ['E4', 14, 1, 0.36], ['E4', 18, 1, 0.44], ['E4', 22, 1, 0.36], ['E4', 26, 1, 0.42], ['E4', 30, 1, 0.38]],
            r4: [['E2', 0, 3, 0.84], ['B1', 4, 2, 0.58], ['D2', 8, 3, 0.74], ['A1', 12, 2, 0.57], ['C2', 16, 3, 0.76], ['G1', 20, 2, 0.6], ['B1', 24, 3, 0.8], ['F#1', 28, 2, 0.58]],
            r6: [['E5', 1, 1, 0.54], ['G5', 3, 1, 0.46], ['B5', 6, 1, 0.52], ['F#5', 8, 1, 0.48], ['E5', 11, 1, 0.46], ['G5', 14, 1, 0.5], ['B5', 17, 1, 0.54], ['F#5', 19, 1, 0.48], ['E5', 22, 1, 0.48], ['A5', 25, 1, 0.52], ['C6', 28, 1, 0.56], ['B5', 30, 1, 0.52]],
            r7: [['E4', 0, 4, 0.25], ['G4', 4, 3, 0.27], ['B4', 8, 6, 0.3], ['F#4', 15, 4, 0.26], ['E4', 20, 3, 0.25], ['A4', 23, 3, 0.28], ['C5', 26, 3, 0.3], ['B4', 29, 3, 0.28]],
            r8: [['E6', 0, 3, 0.62], ['G6', 4, 2, 0.68], ['B6', 7, 4, 0.74], ['F#6', 12, 3, 0.58], ['E6', 16, 2, 0.56], ['A6', 19, 3, 0.68], ['C7', 23, 3, 0.72], ['B6', 28, 4, 0.62]]
        }),
        pattern('rp7', '02 Main/Alien signal seed', 32, '#708cae', {
            r4: [['E2', 0, 15, 0.34], ['D2', 16, 15, 0.3]],
            r6: [['E5', 0, 1, 0.46], ['G5', 3, 1, 0.42], ['B5', 6, 1, 0.5], ['F#5', 8, 1, 0.4], ['E5', 11, 1, 0.44], ['B4', 14, 1, 0.34], ['E5', 16, 1, 0.48], ['G5', 19, 1, 0.44], ['C6', 22, 1, 0.52], ['B5', 24, 1, 0.42], ['F#5', 27, 1, 0.43], ['E5', 30, 1, 0.48]],
            r9: [['E6', 1, 2, 0.22], ['B5', 9, 2, 0.2], ['F6', 17, 2, 0.24], ['C#6', 25, 2, 0.22]]
        }),
        pattern('rp8', '02 Main/Phase march', 32, '#45617f', {
            r1: [['E1', 0, 1, 0.82], ['E1', 7, 1, 0.5], ['E1', 8, 1, 0.72], ['E1', 14, 1, 0.48], ['E1', 16, 1, 0.84], ['E1', 23, 1, 0.52], ['E1', 24, 1, 0.76], ['E1', 30, 1, 0.5]],
            r2: [['E2', 4, 1, 0.66], ['E2', 12, 1, 0.72], ['E2', 20, 1, 0.68], ['E2', 28, 1, 0.74]],
            r3: [['E4', 2, 1, 0.28], ['E4', 6, 1, 0.32], ['E4', 10, 1, 0.3], ['E4', 14, 1, 0.34], ['E4', 18, 1, 0.31], ['E4', 22, 1, 0.35], ['E4', 26, 1, 0.32], ['E4', 30, 1, 0.36]],
            r4: [['E2', 0, 3, 0.7], ['B1', 4, 2, 0.5], ['D2', 8, 3, 0.64], ['A1', 12, 2, 0.52], ['C2', 16, 3, 0.68], ['G1', 20, 2, 0.5], ['B1', 24, 3, 0.66], ['F#1', 28, 2, 0.52]]
        }),
        pattern('rp9', '02 Main/Distant coordinates', 32, '#607da2', {
            r5: [['E3', 0, 16, 0.38], ['B3', 0, 16, 0.28], ['F5', 0, 16, 0.18], ['C#4', 16, 16, 0.4], ['G#3', 16, 16, 0.28], ['E5', 16, 16, 0.2]],
            r7: [['B3', 0, 16, 0.22], ['F#4', 0, 16, 0.17], ['C#4', 16, 16, 0.24], ['G#4', 16, 16, 0.18]]
        }),
        pattern('rp10', '02 Main/Redshift reply', 32, '#9db9d8', {
            r8: [['G5', 0, 2, 0.56], ['B5', 3, 2, 0.64], ['D6', 6, 3, 0.68], ['A5', 10, 3, 0.58], ['F5', 16, 2, 0.52], ['A5', 19, 2, 0.6], ['C6', 22, 3, 0.7], ['B5', 27, 4, 0.58]],
            r9: [['E6', 12, 1, 0.25], ['B5', 30, 1, 0.23]]
        }),
        pattern('rp11', '05 Outro/Transmission return', 32, '#bdcee1', {
            r6: [['E5', 0, 1, 0.46], ['G5', 3, 1, 0.42], ['B5', 6, 1, 0.52], ['F#5', 8, 1, 0.44], ['E5', 11, 1, 0.46], ['B4', 14, 1, 0.36], ['E5', 16, 1, 0.48], ['G5', 19, 1, 0.44], ['C6', 22, 1, 0.54], ['B5', 24, 1, 0.46], ['F#5', 27, 1, 0.45], ['E5', 30, 1, 0.5]],
            r7: [['E4', 0, 4, 0.26], ['G4', 4, 3, 0.28], ['B4', 8, 6, 0.31], ['F#4', 15, 4, 0.27], ['E4', 20, 3, 0.26], ['A4', 23, 3, 0.29], ['C5', 26, 3, 0.31], ['B4', 29, 3, 0.29]],
            r8: [['E5', 0, 3, 0.64], ['G5', 4, 2, 0.7], ['B5', 7, 4, 0.76], ['F#5', 12, 3, 0.6], ['E5', 16, 2, 0.58], ['A5', 19, 3, 0.7], ['C6', 23, 3, 0.74], ['B5', 28, 4, 0.64]]
        }),
        pattern('rp12', '02 Main/Signal lock', 32, '#d4e1ec', {
            r5: [['E3', 0, 16, 0.4], ['B3', 0, 16, 0.3], ['C4', 16, 8, 0.34], ['B3', 24, 8, 0.32], ['E4', 24, 8, 0.28]],
            r7: [['B3', 0, 12, 0.24], ['C4', 16, 6, 0.24], ['B3', 24, 4, 0.23], ['E4', 28, 4, 0.3]],
            r8: [['E5', 0, 3, 0.58], ['G5', 5, 2, 0.62], ['B5', 9, 4, 0.68], ['F#5', 16, 3, 0.54], ['G5', 21, 2, 0.58], ['E5', 26, 6, 0.72]],
            r9: [['B5', 4, 2, 0.24], ['E6', 27, 4, 0.3]]
        })
    ];
    connect(patterns, 'rp4', 'r8', 0, 4, 'ease-in');
    connect(patterns, 'rp4', 'r8', 12, 16, 'smooth');
    connect(patterns, 'rp4', 'r8', 19, 23, 'ease-out');
    return project(instruments, patterns, arrangeSong('rc', [
        [['rp9', 2], ['rp7', 3]], [['rp9', 2], ['rp7', 3]], [['rp1', 2], ['rp7', 3]], [['rp1', 2], ['rp7', 3]],
        [['rp1', 2], ['rp2', 0]], [['rp3', 2], ['rp2', 0]], [['rp3', 2], ['rp2', 0]], [['rp3', 2], ['rp8', 0]],
        [['rp3', 2], ['rp8', 0]], [['rp4', 4], ['rp8', 0]], [['rp4', 4], ['rp8', 0]], [['rp4', 4], ['rp2', 0]],
        [['rp3', 2], ['rp2', 0]], [['rp4', 4], ['rp2', 0]], [['rp4', 4], ['rp8', 0]], [['rp10', 4], ['rp8', 0]],
        [['rp10', 4], ['rp2', 0]], [['rp10', 4], ['rp2', 0]], [['rp3', 2], ['rp2', 0]], [['rp3', 2], ['rp7', 3]],
        [['rp5', 1], ['rp7', 3]], [['rp5', 1], ['rp7', 3]], [['rp5', 1], ['rp9', 2]], [['rp5', 1], ['rp9', 2]],
        [['rp9', 2], ['rp7', 3]], [['rp9', 2], ['rp7', 3]], [['rp3', 2], ['rp7', 3]], [['rp3', 2], ['rp2', 0]],
        [['rp4', 4], ['rp2', 0]], [['rp4', 4], ['rp8', 0]], [['rp10', 4], ['rp8', 0]], [['rp10', 4], ['rp6', 0]],
        [['rp6', 0], ['rp3', 2]], [['rp6', 0], ['rp3', 2]], [['rp6', 0], ['rp11', 3]], [['rp6', 0], ['rp11', 3]],
        [['rp6', 0], ['rp11', 3]], [['rp6', 0], ['rp11', 3]], [['rp12', 4], ['rp11', 3]], [['rp12', 4], ['rp9', 2]]
    ]), ['Kick', 'Sub', 'Pad', 'Pluck', 'Lead'], 94, [
        {
            id: 'ra1',
            target: 'master',
            param: 'rev',
            points: [{step: 0, value: 0.78, curve: 'ease-out'}, {step: 128, value: 0.58, curve: 'smooth'}, {
                step: 384,
                value: 0.44,
                curve: 'ease-in'
            }, {step: 576, value: 0.7, curve: 'smooth'}, {step: 896, value: 0.48, curve: 'ease-in'}, {
                step: 1152,
                value: 0.76,
                curve: 'ease-out'
            }, {step: 1280, value: 0.62}]
        },
        {
            id: 'ra2',
            target: 'r5',
            param: 'tone',
            points: [{step: 0, value: 0.28, curve: 'smooth'}, {step: 128, value: 0.48, curve: 'ease-in'}, {
                step: 384,
                value: 0.74,
                curve: 'ease-out'
            }, {step: 640, value: 0.42, curve: 'smooth'}, {step: 960, value: 0.9, curve: 'ease-in'}, {
                step: 1280,
                value: 0.32
            }]
        },
        {
            id: 'ra3',
            target: 'master',
            param: 'vol',
            points: [{step: 0, value: 0.54, curve: 'ease-out'}, {step: 128, value: 0.8, curve: 'smooth'}, {
                step: 384,
                value: 0.91,
                curve: 'ease-in'
            }, {step: 640, value: 0.72, curve: 'smooth'}, {step: 960, value: 0.96, curve: 'ease-out'}, {
                step: 1280,
                value: 0.58
            }]
        }
    ]);
}

export function buildFarHorizon(): Project {
    const instruments = [
        instrument('f1', 'Drums/March Kick', COLORS[0], {
            tone: 0.85,
            q: 7,
            noise: 0.15,
            noiseFreq: 2200,
            pitchDrop: 17,
            pitchTime: 0.08,
            att: 0.002,
            dec: 0.17,
            sus: 0,
            rel: 0.12,
            gain: 0.76
        }),
        instrument('f2', 'Drums/Field Snare', COLORS[1], {
            tone: 0.42,
            q: 10,
            noise: 0.84,
            noiseFreq: 3700,
            pitchDrop: 5,
            att: 0.002,
            dec: 0.17,
            sus: 0,
            rel: 0.18,
            gain: 0.58
        }),
        instrument('f3', 'Drums/Armor Hat', COLORS[3], {
            tone: 0,
            q: 35,
            noise: 1,
            noiseFreq: 9300,
            att: 0.002,
            dec: 0.03,
            sus: 0,
            rel: 0.04,
            gain: 0.3,
            pan: -0.25
        }),
        instrument('f4', 'Orchestra/Brass/Low Brass', COLORS[4], {
            tone: 0.94,
            q: 28,
            harm: 5,
            falloff: 0.67,
            noise: 0.08,
            noiseFreq: 1500,
            voices: 3,
            detune: 18,
            att: 0.05,
            dec: 0.16,
            sus: 0.7,
            rel: 0.34,
            gain: 0.5,
            pan: -0.12
        }),
        instrument('f5', 'Orchestra/Strings/Sky Strings', COLORS[5], {
            tone: 0.66,
            q: 20,
            harm: 6,
            falloff: 0.72,
            voices: 5,
            detune: 38,
            att: 0.36,
            dec: 0.22,
            sus: 0.82,
            rel: 0.85,
            gain: 0.36,
            pan: 0.12
        }),
        instrument('f6', 'Vocals/Beacon Choir', COLORS[6], {
            tone: 0.52,
            q: 15,
            harm: 4,
            falloff: 0.72,
            formant: 0.4,
            f1: 600,
            f2: 1020,
            f3: 2400,
            formantQ: 5,
            voices: 6,
            detune: 45,
            att: 0.7,
            dec: 0.35,
            sus: 0.82,
            rel: 1.2,
            gain: 0.31
        }),
        instrument('f7', 'Bass/Ranger Bass', COLORS[7], {
            tone: 1,
            q: 26,
            harm: 3,
            falloff: 0.38,
            att: 0.01,
            dec: 0.14,
            sus: 0.63,
            rel: 0.18,
            gain: 0.62
        }),
        instrument('f8', 'Synth/Scout Lead', COLORS[8], {
            tone: 1,
            q: 38,
            harm: 5,
            falloff: 0.58,
            vib: 8,
            vibRate: 6,
            vibDelay: 0.35,
            att: 0.01,
            dec: 0.16,
            sus: 0.58,
            rel: 0.28,
            gain: 0.44,
            pan: 0.16,
            legatoCurve: 'ease-out'
        }),
        instrument('f9', 'Percussion/Tuned/Signal Chime', '#7ed6df', {
            tone: 0.72,
            q: 42,
            harm: 6,
            falloff: 0.65,
            stretch: 0.12,
            att: 0.002,
            dec: 0.45,
            sus: 0.04,
            rel: 1.3,
            gain: 0.25,
            pan: 0.28
        })
    ];
    const patterns = [
        pattern('fp1', '01 Intro/First light', 32, '#51647c', {
            f5: [['A2', 0, 16, 0.42], ['E3', 0, 16, 0.32], ['B3', 0, 16, 0.26], ['F#3', 16, 16, 0.4], ['C#4', 16, 16, 0.3], ['E4', 16, 16, 0.25]],
            f6: [['E4', 0, 16, 0.2], ['C#4', 16, 16, 0.22]],
            f9: [['E6', 12, 2, 0.3], ['C#6', 29, 2, 0.27]]
        }),
        pattern('fp2', '02 Main/Forward march', 16, '#657d99', {
            f1: [['A1', 0, 1, 0.9], ['A1', 4, 1, 0.7], ['A1', 8, 1, 0.85], ['A1', 12, 1, 0.7]],
            f2: [['A2', 4, 1, 0.76], ['A2', 12, 1, 0.8]],
            f3: [['A4', 2, 1, 0.3], ['A4', 6, 1, 0.32], ['A4', 10, 1, 0.36], ['A4', 14, 1, 0.34]],
            f7: [['A1', 0, 3, 0.78], ['G1', 4, 2, 0.54], ['D2', 8, 3, 0.72], ['A1', 12, 2, 0.58]],
            f4: [['A2', 0, 3, 0.46], ['G2', 4, 2, 0.36], ['D3', 8, 3, 0.44], ['A2', 12, 2, 0.38]]
        }),
        pattern('fp3', '02 Main/Beacon call', 32, '#819bb8', {
            f8: [['A5', 0, 4, 0.64], ['C6', 5, 3, 0.7], ['D6', 9, 4, 0.74], ['E6', 14, 5, 0.78], ['D6', 20, 3, 0.66], ['B5', 24, 2, 0.58], ['C6', 27, 2, 0.62], ['A5', 30, 2, 0.68]],
            f9: [['A5', 2, 1, 0.24], ['E6', 18, 1, 0.28]]
        }),
        pattern('fp4', '03 Development/Broken orbit', 32, '#475b75', {
            f1: [['A1', 0, 1, 0.85], ['A1', 7, 1, 0.65], ['F#1', 16, 1, 0.8], ['F#1', 23, 1, 0.64]],
            f2: [['A2', 12, 1, 0.6], ['F#2', 28, 1, 0.62]],
            f7: [['A1', 0, 6, 0.65], ['G1', 8, 5, 0.58], ['F#1', 16, 6, 0.64], ['E1', 24, 5, 0.55]],
            f5: [['A3', 0, 8, 0.33], ['G3', 8, 8, 0.31], ['F#3', 16, 8, 0.34], ['E3', 24, 8, 0.3]],
            f6: [['C#4', 0, 16, 0.2], ['B3', 16, 16, 0.2]]
        }),
        pattern('fp5', '02 Main/Open sky', 32, '#9eb2c9', {
            f5: [['D3', 0, 16, 0.43], ['A3', 0, 16, 0.32], ['E4', 0, 16, 0.26], ['A2', 16, 16, 0.44], ['E3', 16, 16, 0.32], ['B3', 16, 16, 0.28]],
            f6: [['F#4', 0, 16, 0.24], ['E4', 16, 16, 0.24]],
            f9: [['F#6', 10, 2, 0.29], ['E6', 26, 2, 0.3]]
        }),
        pattern('fp6', '05 Outro/Horizon return', 32, '#b2c8db', {
            f1: [['A1', 0, 1, 0.9], ['A1', 4, 1, 0.68], ['A1', 8, 1, 0.86], ['A1', 12, 1, 0.7], ['A1', 16, 1, 0.9], ['A1', 20, 1, 0.7], ['A1', 24, 1, 0.88], ['A1', 28, 1, 0.72]],
            f2: [['A2', 4, 1, 0.77], ['A2', 12, 1, 0.8], ['A2', 20, 1, 0.78], ['A2', 28, 1, 0.82]],
            f3: [['A4', 2, 1, 0.35], ['A4', 6, 1, 0.34], ['A4', 10, 1, 0.38], ['A4', 14, 1, 0.36], ['A4', 18, 1, 0.38], ['A4', 22, 1, 0.35], ['A4', 26, 1, 0.4], ['A4', 30, 1, 0.36]],
            f7: [['A1', 0, 3, 0.8], ['G1', 4, 2, 0.56], ['D2', 8, 3, 0.74], ['A1', 12, 2, 0.58], ['A1', 16, 3, 0.82], ['G1', 20, 2, 0.58], ['D2', 24, 3, 0.78], ['A1', 28, 2, 0.6]],
            f4: [['A2', 0, 3, 0.48], ['G2', 4, 2, 0.38], ['D3', 8, 3, 0.46], ['A2', 12, 2, 0.38], ['A2', 16, 3, 0.5], ['G2', 20, 2, 0.4], ['D3', 24, 3, 0.48], ['A2', 28, 2, 0.4]],
            f6: [['A3', 0, 4, 0.28], ['C4', 5, 3, 0.32], ['D4', 9, 4, 0.36], ['E4', 14, 5, 0.4], ['D4', 20, 3, 0.34], ['B3', 24, 2, 0.29], ['C4', 27, 2, 0.31], ['A3', 30, 2, 0.36]],
            f8: [['A5', 0, 4, 0.6], ['C6', 5, 3, 0.66], ['D6', 9, 4, 0.7], ['E6', 14, 5, 0.74], ['D6', 20, 3, 0.64], ['B5', 24, 2, 0.56], ['C6', 27, 2, 0.6], ['A5', 30, 2, 0.66]]
        }),
        pattern('fp7', '02 Main/Cantus beacon', 32, '#7490ae', {
            f5: [['A2', 0, 32, 0.24], ['E3', 0, 32, 0.2]],
            f6: [['A3', 0, 4, 0.28], ['C4', 5, 3, 0.32], ['D4', 9, 4, 0.36], ['E4', 14, 5, 0.4], ['D4', 20, 3, 0.34], ['B3', 24, 2, 0.29], ['C4', 27, 2, 0.31], ['A3', 30, 2, 0.36]],
            f9: [['A5', 14, 2, 0.2], ['E6', 30, 2, 0.22]]
        }),
        pattern('fp8', '02 Main/Ceremonial march', 32, '#58718d', {
            f1: [['A1', 0, 1, 0.86], ['A1', 6, 1, 0.54], ['A1', 8, 1, 0.76], ['A1', 15, 1, 0.52], ['A1', 16, 1, 0.88], ['A1', 22, 1, 0.56], ['A1', 24, 1, 0.8], ['A1', 30, 1, 0.58]],
            f2: [['A2', 4, 1, 0.72], ['A2', 12, 1, 0.76], ['A2', 20, 1, 0.74], ['A2', 28, 1, 0.8]],
            f3: [['A4', 2, 1, 0.26], ['A4', 6, 1, 0.3], ['A4', 10, 1, 0.28], ['A4', 14, 1, 0.32], ['A4', 18, 1, 0.29], ['A4', 22, 1, 0.33], ['A4', 26, 1, 0.3], ['A4', 30, 1, 0.34]],
            f4: [['A2', 0, 3, 0.44], ['G2', 4, 2, 0.34], ['D3', 8, 3, 0.42], ['A2', 12, 2, 0.36], ['A2', 16, 3, 0.46], ['G2', 20, 2, 0.36], ['D3', 24, 3, 0.44], ['A2', 28, 2, 0.38]],
            f7: [['A1', 0, 3, 0.76], ['G1', 4, 2, 0.5], ['D2', 8, 3, 0.7], ['A1', 12, 2, 0.52], ['A1', 16, 3, 0.78], ['G1', 20, 2, 0.52], ['D2', 24, 3, 0.74], ['A1', 28, 2, 0.54]]
        }),
        pattern('fp9', '02 Main/Choir response', 32, '#869fba', {
            f5: [['A2', 0, 16, 0.36], ['E3', 0, 16, 0.28], ['F#3', 0, 16, 0.22], ['D3', 16, 16, 0.38], ['A3', 16, 16, 0.28], ['E4', 16, 16, 0.22]],
            f6: [['A3', 0, 16, 0.22], ['C#4', 0, 16, 0.2], ['E4', 0, 16, 0.18], ['D4', 16, 16, 0.24], ['F#4', 16, 16, 0.21], ['A4', 16, 16, 0.18]]
        }),
        pattern('fp10', '04 Climax/Command ascent', 32, '#a9bed1', {
            f4: [['D3', 0, 3, 0.44], ['G2', 4, 2, 0.34], ['A2', 8, 3, 0.4], ['D3', 16, 3, 0.46], ['G3', 20, 2, 0.36], ['A3', 24, 3, 0.42]],
            f7: [['D2', 0, 3, 0.7], ['G1', 4, 2, 0.48], ['A1', 8, 3, 0.64], ['D2', 16, 3, 0.72], ['G2', 20, 2, 0.5], ['A2', 24, 3, 0.66]],
            f8: [['D5', 0, 3, 0.5], ['F#5', 4, 2, 0.58], ['G5', 7, 3, 0.64], ['A5', 11, 4, 0.7], ['G5', 17, 2, 0.54], ['E5', 20, 2, 0.52], ['F#5', 24, 2, 0.58], ['D6', 28, 4, 0.72]]
        }),
        pattern('fp11', '04 Climax/Final oath', 32, '#c5d6e3', {
            f1: [['B1', 0, 1, 0.94], ['B1', 4, 1, 0.68], ['B1', 8, 1, 0.86], ['B1', 12, 1, 0.7], ['B1', 16, 1, 0.96], ['B1', 20, 1, 0.7], ['B1', 24, 1, 0.88], ['B1', 28, 1, 0.72]],
            f2: [['B2', 4, 1, 0.82], ['B2', 12, 1, 0.86], ['B2', 20, 1, 0.84], ['B2', 28, 1, 0.88]],
            f3: [['B4', 2, 1, 0.34], ['B4', 6, 1, 0.36], ['B4', 10, 1, 0.38], ['B4', 14, 1, 0.4], ['B4', 18, 1, 0.38], ['B4', 22, 1, 0.4], ['B4', 26, 1, 0.42], ['B4', 30, 1, 0.44]],
            f4: [['B2', 0, 3, 0.52], ['A2', 4, 2, 0.4], ['E3', 8, 3, 0.48], ['B2', 12, 2, 0.4], ['B2', 16, 3, 0.54], ['A2', 20, 2, 0.42], ['E3', 24, 3, 0.52], ['B2', 28, 2, 0.42]],
            f5: [['B3', 0, 8, 0.34], ['F#4', 0, 8, 0.28], ['A3', 8, 8, 0.32], ['E4', 8, 8, 0.27], ['E3', 16, 8, 0.34], ['B3', 16, 8, 0.28], ['B3', 24, 8, 0.38], ['F#4', 24, 8, 0.31]],
            f6: [['B3', 0, 4, 0.32], ['D4', 5, 3, 0.36], ['E4', 9, 4, 0.4], ['F#4', 14, 5, 0.45], ['E4', 20, 3, 0.38], ['C#4', 24, 2, 0.33], ['D4', 27, 2, 0.35], ['B3', 30, 2, 0.42]],
            f7: [['B1', 0, 3, 0.84], ['A1', 4, 2, 0.58], ['E2', 8, 3, 0.78], ['B1', 12, 2, 0.6], ['B1', 16, 3, 0.86], ['A1', 20, 2, 0.6], ['E2', 24, 3, 0.84], ['B1', 28, 2, 0.62]],
            f8: [['F#5', 1, 2, 0.58], ['B5', 4, 3, 0.68], ['D6', 8, 3, 0.64], ['C#6', 12, 3, 0.6], ['A5', 17, 2, 0.56], ['B5', 20, 3, 0.7], ['F#6', 24, 4, 0.8], ['D6', 29, 3, 0.66]],
            f9: [['B5', 14, 2, 0.26], ['F#6', 30, 2, 0.3]]
        }),
        pattern('fp12', '05 Outro/Oath cadence', 32, '#dce6ed', {
            f4: [['B2', 0, 8, 0.42], ['E3', 8, 8, 0.38], ['F#3', 16, 8, 0.4], ['B2', 24, 8, 0.5]],
            f5: [['B3', 0, 16, 0.3], ['F#4', 0, 16, 0.24], ['E4', 16, 8, 0.28], ['F#4', 24, 4, 0.3], ['B4', 28, 4, 0.38]],
            f6: [['E4', 0, 6, 0.3], ['D4', 8, 4, 0.28], ['C#4', 16, 4, 0.28], ['B3', 24, 8, 0.42]],
            f8: [['F#5', 2, 3, 0.54], ['E5', 8, 3, 0.52], ['D5', 14, 3, 0.5], ['C#5', 20, 3, 0.52], ['B4', 26, 6, 0.68]],
            f9: [['B5', 28, 4, 0.3]]
        })
    ];
    connect(patterns, 'fp3', 'f8', 0, 5, 'ease-in');
    connect(patterns, 'fp3', 'f8', 9, 14, 'smooth');
    connect(patterns, 'fp3', 'f8', 20, 24, 'ease-out');
    connect(patterns, 'fp3', 'f8', 27, 30, 'smooth');
    return project(instruments, patterns, arrangeSong('fc', [
        [['fp1', 2], ['fp7', 3]], [['fp1', 2], ['fp7', 3]], [['fp1', 2], ['fp7', 3]], [['fp1', 2], ['fp7', 3]],
        [['fp1', 2], ['fp2', 0]], [['fp5', 2], ['fp2', 0]], [['fp5', 2], ['fp8', 0]], [['fp5', 2], ['fp8', 0]],
        [['fp3', 3], ['fp8', 0]], [['fp3', 3], ['fp8', 0]], [['fp3', 3], ['fp2', 0]], [['fp5', 2], ['fp2', 0]],
        [['fp5', 2], ['fp8', 0]], [['fp4', 0], ['fp8', 0]], [['fp4', 0], ['fp3', 3]], [['fp4', 0], ['fp3', 3]],
        [['fp4', 0], ['fp9', 2]], [['fp9', 2], ['fp10', 1]], [['fp9', 2], ['fp10', 1]], [['fp5', 2], ['fp10', 1]],
        [['fp5', 2], ['fp7', 3]], [['fp5', 2], ['fp7', 3]], [['fp9', 2], ['fp7', 3]], [['fp9', 2], ['fp10', 1]],
        [['fp10', 1], ['fp2', 0]], [['fp6', 0], ['fp2', 0]], [['fp6', 0], ['fp8', 0]], [['fp6', 0], ['fp8', 0]],
        [['fp6', 0], ['fp9', 2]], [['fp6', 0], ['fp10', 1]], [['fp11', 0], ['fp10', 1]], [['fp11', 0], ['fp9', 2]],
        [['fp11', 0], ['fp9', 2]], [['fp11', 0], ['fp9', 2]], [['fp11', 0], ['fp6', 2]], [['fp11', 0], ['fp6', 2]],
        [['fp11', 0], ['fp9', 2]], [['fp11', 0], ['fp9', 2]], [['fp12', 3], ['fp11', 0]], [['fp12', 3], ['fp9', 2]]
    ]), ['Kick', 'Brass', 'Strings', 'Lead'], 102, [
        {
            id: 'fa1',
            target: 'master',
            param: 'rev',
            points: [{step: 0, value: 0.8, curve: 'ease-out'}, {step: 128, value: 0.5, curve: 'smooth'}, {
                step: 384,
                value: 0.42,
                curve: 'ease-in'
            }, {step: 576, value: 0.66, curve: 'smooth'}, {step: 896, value: 0.46, curve: 'ease-in'}, {
                step: 1152,
                value: 0.72,
                curve: 'ease-out'
            }, {step: 1280, value: 0.58}]
        },
        {
            id: 'fa2',
            target: 'f5',
            param: 'tone',
            points: [{step: 0, value: 0.35, curve: 'smooth'}, {step: 128, value: 0.62, curve: 'ease-in'}, {
                step: 384,
                value: 0.82,
                curve: 'ease-out'
            }, {step: 640, value: 0.4, curve: 'smooth'}, {step: 960, value: 0.92, curve: 'ease-in'}, {
                step: 1280,
                value: 0.38
            }]
        },
        {
            id: 'fa3',
            target: 'master',
            param: 'vol',
            points: [{step: 0, value: 0.5, curve: 'ease-out'}, {step: 128, value: 0.78, curve: 'smooth'}, {
                step: 384,
                value: 0.92,
                curve: 'ease-in'
            }, {step: 640, value: 0.7, curve: 'smooth'}, {step: 960, value: 0.97, curve: 'ease-out'}, {
                step: 1280,
                value: 0.56
            }]
        }
    ]);
}

export function buildPocketTheory(): Project {
    const instruments = [
        instrument('p1', 'Drums/Pocket Kick', COLORS[0], {
            tone: 0.96,
            q: 4,
            noise: 0.025,
            noiseFreq: 1200,
            pitchDrop: 22,
            pitchTime: 0.045,
            att: 0.002,
            dec: 0.11,
            sus: 0,
            rel: 0.06,
            gain: 0.68
        }),
        instrument('p2', 'Drums/Pocket Snare', COLORS[1], {
            tone: 0.12,
            q: 3,
            noise: 0.52,
            noiseFreq: 2100,
            pitchDrop: -7,
            pitchTime: 0.035,
            att: 0.002,
            dec: 0.085,
            sus: 0,
            rel: 0.09,
            gain: 0.36
        }),
        instrument('p3', 'Drums/Sixteenth Hat', COLORS[3], {
            tone: 0,
            q: 8,
            noise: 0.62,
            noiseFreq: 9600,
            att: 0.002,
            dec: 0.018,
            sus: 0,
            rel: 0.025,
            gain: 0.13,
            pan: 0.24
        }),
        instrument('p4', 'Bass/Chrome Tongue', COLORS[4], {
            tone: 1,
            q: 34,
            harmShape: 'Fifths (quint)',
            harm: 6,
            falloff: 0.72,
            noise: 0.12,
            noiseFreq: 680,
            pitchDrop: -9,
            pitchTime: 0.06,
            noiseBend: 0.75,
            partials: [{ratio: 0.5, level: 0.32}, {ratio: 1, level: 1}, {ratio: 1.5, level: 0.46}, {
                ratio: 2,
                level: 0.64
            }, {ratio: 3, level: 0.2}],
            att: 0.002,
            dec: 0.075,
            sus: 0.38,
            rel: 0.06,
            gain: 0.82
        }),
        instrument('p5', 'Keys/Glass Circuit', COLORS[5], {
            tone: 0.94,
            q: 58,
            harmShape: 'Bell partials',
            harm: 6,
            falloff: 0.8,
            stretch: 0.08,
            noise: 0.06,
            noiseFreq: 4100,
            pitchDrop: 12,
            pitchTime: 0.025,
            noiseBend: 0.3,
            partials: [{ratio: 1, level: 1}, {ratio: 1.19, level: 0.52}, {ratio: 1.5, level: 0.36}, {
                ratio: 2.24,
                level: 0.48
            }, {ratio: 3.61, level: 0.18}],
            att: 0.002,
            dec: 0.16,
            sus: 0,
            rel: 0.18,
            gain: 0.26,
            pan: -0.24
        }),
        instrument('p6', 'Pads/Choir Voltage', COLORS[6], {
            tone: 0.7,
            q: 22,
            harmShape: 'Organ drawbars',
            harm: 6,
            falloff: 0.82,
            partials: [{ratio: 1, level: 0.52}, {ratio: 2, level: 0.7}, {ratio: 3, level: 0.46}, {
                ratio: 4,
                level: 0.32
            }, {ratio: 6, level: 0.2}],
            formant: 0.66,
            f1: 360,
            f2: 1380,
            f3: 3060,
            formantQ: 5,
            voices: 3,
            detune: 34,
            att: 0.22,
            dec: 0.42,
            sus: 0.44,
            rel: 0.72,
            gain: 0.18,
            pan: 0.18
        }),
        instrument('p7', 'Synth/Radio Animal', COLORS[7], {
            tone: 1,
            q: 44,
            harmShape: 'Odd (hollow)',
            harm: 6,
            falloff: 0.78,
            partials: [{ratio: 1, level: 1}, {ratio: 3, level: 0.72}, {ratio: 5, level: 0.42}, {
                ratio: 7,
                level: 0.2
            }],
            formant: 0.82,
            f1: 520,
            f2: 1740,
            f3: 3260,
            formantQ: 7,
            vib: 22,
            vibRate: 6.4,
            vibDelay: 0.1,
            voices: 2,
            detune: 13,
            att: 0.015,
            dec: 0.14,
            sus: 0.48,
            rel: 0.24,
            gain: 0.27,
            legatoCurve: 'ease-in'
        }),
        instrument('p8', 'Drums/Hand Clap', COLORS[8], {
            tone: 0.08,
            q: 2,
            noise: 0.42,
            noiseFreq: 1650,
            att: 0.003,
            dec: 0.055,
            sus: 0,
            rel: 0.07,
            gain: 0.11,
            pan: 0.12
        }),
        instrument('p9', 'Synth/Neon Chordbite', '#7ed6df', {
            tone: 1,
            q: 38,
            harmShape: 'Fifths (quint)',
            harm: 6,
            falloff: 0.76,
            partials: [{ratio: 1, level: 0.82}, {ratio: 1.5, level: 0.68}, {ratio: 2, level: 0.54}, {
                ratio: 3,
                level: 0.32
            }, {ratio: 4, level: 0.16}],
            pitchDrop: -4,
            pitchTime: 0.08,
            att: 0.015,
            dec: 0.16,
            sus: 0.08,
            rel: 0.14,
            gain: 0.2,
            pan: 0.25
        }),
        instrument('p10', 'Percussion/Shard Guitar', '#f6d365', {
            tone: 0.88,
            q: 64,
            harmShape: 'Metal / clang',
            harm: 6,
            falloff: 0.82,
            partials: [{ratio: 1, level: 1}, {ratio: 1.41, level: 0.4}, {ratio: 2.24, level: 0.3}, {
                ratio: 2.83,
                level: 0.18
            }, {ratio: 4.47, level: 0.08}],
            noise: 0.08,
            noiseFreq: 5200,
            pitchDrop: 7,
            pitchTime: 0.03,
            noiseBend: 0.4,
            att: 0.002,
            dec: 0.11,
            sus: 0,
            rel: 0.16,
            gain: 0.16,
            pan: 0.34
        })
    ];
    const patterns = [
        pattern('pp1', '01 Intro/Pocket grid', 16, '#995b65', {
            p1: [['D1', 0, 1, 0.94], ['D1', 6, 1, 0.58], ['D1', 8, 1, 0.82], ['D1', 11, 1, 0.5], ['D1', 14, 1, 0.64]],
            p2: [['D2', 4, 1, 0.74], ['D2', 12, 1, 0.82]],
            p3: [['D4', 1, 1, 0.23], ['D4', 3, 1, 0.31], ['D4', 5, 1, 0.26], ['D4', 7, 1, 0.36], ['D4', 9, 1, 0.25], ['D4', 11, 1, 0.34], ['D4', 13, 1, 0.26], ['D4', 15, 1, 0.38]],
            p8: [['D3', 4, 1, 0.34], ['D3', 12, 1, 0.38]]
        }),
        pattern('pp2', '02 Main/Bass conversation', 16, '#b36b75', {
            p4: [['D2', 0, 2, 0.82], ['A1', 3, 1, 0.56], ['C2', 5, 2, 0.68], ['D2', 8, 1, 0.76], ['F2', 10, 2, 0.7], ['E2', 13, 1, 0.58], ['C2', 15, 1, 0.52]]
        }),
        pattern('pp3', '02 Main/Chord stabs', 16, '#d3827d', {
            p5: [['D4', 2, 1, 0.55], ['F4', 2, 1, 0.46], ['A4', 2, 1, 0.42], ['C5', 2, 1, 0.38], ['G3', 6, 1, 0.5], ['B3', 6, 1, 0.43], ['D4', 6, 1, 0.38], ['F4', 6, 1, 0.34], ['A3', 10, 1, 0.52], ['C4', 10, 1, 0.44], ['E4', 10, 1, 0.4], ['G4', 10, 1, 0.35], ['D4', 14, 1, 0.58], ['F4', 14, 1, 0.48], ['A4', 14, 1, 0.42], ['C5', 14, 1, 0.37]],
            p6: [['D3', 0, 3, 0.32], ['F3', 0, 3, 0.28], ['A3', 0, 3, 0.26], ['C4', 0, 3, 0.22], ['G2', 8, 3, 0.3], ['B2', 8, 3, 0.27], ['D3', 8, 3, 0.24], ['F3', 8, 3, 0.2]]
        }),
        pattern('pp4', '02 Chorus/Hook question', 32, '#ef9f82', {
            p7: [['A4', 0, 2, 0.58], ['C5', 3, 2, 0.68], ['D5', 6, 2, 0.56], ['F5', 9, 3, 0.72], ['E5', 14, 2, 0.54], ['D5', 18, 2, 0.62], ['A4', 21, 2, 0.5], ['C5', 24, 2, 0.58], ['E5', 27, 2, 0.66], ['D5', 30, 2, 0.64]],
            p9: [['D4', 12, 3, 0.34], ['G4', 28, 3, 0.32]]
        }),
        pattern('pp5', '03 Development/Breakdown answer', 32, '#c86d74', {
            p4: [['D2', 0, 3, 0.64], ['C2', 6, 2, 0.5], ['A1', 10, 3, 0.58], ['G1', 16, 3, 0.55], ['A1', 22, 2, 0.48], ['C2', 26, 2, 0.52]],
            p5: [['D4', 4, 1, 0.36], ['A4', 7, 1, 0.32], ['C5', 12, 1, 0.38], ['F4', 20, 1, 0.34], ['E4', 28, 1, 0.36]],
            p7: [['A4', 2, 3, 0.48], ['C5', 10, 2, 0.55], ['D5', 18, 3, 0.6], ['F5', 26, 3, 0.62]]
        }),
        pattern('pp6', '04 Climax/Pocket finale', 32, '#f6b38d', {
            p1: [['D1', 0, 1, 0.94], ['D1', 6, 1, 0.58], ['D1', 8, 1, 0.84], ['D1', 11, 1, 0.5], ['D1', 14, 1, 0.65], ['D1', 16, 1, 0.9], ['D1', 22, 1, 0.62], ['D1', 24, 1, 0.84], ['D1', 27, 1, 0.54], ['D1', 30, 1, 0.7]],
            p2: [['D2', 4, 1, 0.76], ['D2', 12, 1, 0.82], ['D2', 20, 1, 0.78], ['D2', 28, 1, 0.84]],
            p3: [['D4', 1, 1, 0.24], ['D4', 3, 1, 0.32], ['D4', 5, 1, 0.27], ['D4', 7, 1, 0.36], ['D4', 9, 1, 0.26], ['D4', 11, 1, 0.35], ['D4', 13, 1, 0.27], ['D4', 15, 1, 0.39], ['D4', 17, 1, 0.26], ['D4', 19, 1, 0.34], ['D4', 21, 1, 0.28], ['D4', 23, 1, 0.37], ['D4', 25, 1, 0.28], ['D4', 27, 1, 0.36], ['D4', 29, 1, 0.3], ['D4', 31, 1, 0.4]],
            p4: [['D2', 0, 2, 0.82], ['A1', 3, 1, 0.56], ['C2', 5, 2, 0.68], ['D2', 8, 1, 0.76], ['F2', 10, 2, 0.7], ['E2', 13, 1, 0.58], ['C2', 15, 1, 0.52], ['D2', 16, 2, 0.82], ['A1', 19, 1, 0.58], ['C2', 21, 2, 0.7], ['D2', 24, 1, 0.78], ['F2', 26, 2, 0.72], ['E2', 29, 1, 0.6], ['C2', 31, 1, 0.55]],
            p5: [['D4', 2, 1, 0.55], ['F4', 2, 1, 0.46], ['A4', 2, 1, 0.42], ['C5', 2, 1, 0.38], ['G3', 6, 1, 0.5], ['B3', 6, 1, 0.43], ['D4', 6, 1, 0.38], ['F4', 6, 1, 0.34], ['A3', 10, 1, 0.52], ['C4', 10, 1, 0.44], ['E4', 10, 1, 0.4], ['G4', 10, 1, 0.35], ['D4', 14, 1, 0.58], ['F4', 14, 1, 0.48], ['A4', 14, 1, 0.42], ['C5', 14, 1, 0.37], ['D4', 18, 1, 0.58], ['F4', 18, 1, 0.48], ['A4', 18, 1, 0.42], ['C5', 18, 1, 0.37], ['G3', 22, 1, 0.5], ['B3', 22, 1, 0.43], ['D4', 22, 1, 0.38], ['F4', 22, 1, 0.34], ['A3', 26, 1, 0.52], ['C4', 26, 1, 0.44], ['E4', 26, 1, 0.4], ['G4', 26, 1, 0.35], ['D4', 30, 1, 0.6], ['F4', 30, 1, 0.5], ['A4', 30, 1, 0.44], ['C5', 30, 1, 0.38]],
            p7: [['A4', 0, 2, 0.58], ['C5', 3, 2, 0.68], ['D5', 6, 2, 0.56], ['F5', 9, 3, 0.72], ['E5', 14, 2, 0.54], ['D5', 18, 2, 0.62], ['A4', 21, 2, 0.5], ['C5', 24, 2, 0.58], ['E5', 27, 2, 0.66], ['D5', 30, 2, 0.64]]
        }),
        pattern('pp7', '02 Main/Ghost pocket', 32, '#b35d69', {
            p1: [['D1', 0, 1, 0.88], ['D1', 5, 1, 0.38], ['D1', 8, 1, 0.74], ['D1', 11, 1, 0.42], ['D1', 14, 1, 0.58], ['D1', 16, 1, 0.86], ['D1', 21, 1, 0.4], ['D1', 24, 1, 0.76], ['D1', 27, 1, 0.44], ['D1', 30, 1, 0.62]],
            p2: [['D2', 4, 1, 0.68], ['D2', 7, 1, 0.22], ['D2', 12, 1, 0.78], ['D2', 20, 1, 0.7], ['D2', 23, 1, 0.24], ['D2', 28, 1, 0.8]],
            p3: [['D4', 1, 1, 0.2], ['D4', 3, 1, 0.28], ['D4', 5, 1, 0.22], ['D4', 7, 1, 0.34], ['D4', 9, 1, 0.24], ['D4', 11, 1, 0.32], ['D4', 13, 1, 0.26], ['D4', 15, 1, 0.36], ['D4', 17, 1, 0.23], ['D4', 19, 1, 0.31], ['D4', 21, 1, 0.25], ['D4', 23, 1, 0.35], ['D4', 25, 1, 0.27], ['D4', 27, 1, 0.34], ['D4', 29, 1, 0.29], ['D4', 31, 1, 0.38]],
            p8: [['D3', 4, 1, 0.3], ['D3', 12, 1, 0.34], ['D3', 20, 1, 0.32], ['D3', 28, 1, 0.38]]
        }),
        pattern('pp8', '02 Main/Bass answer', 32, '#cf7780', {
            p4: [['D2', 0, 2, 0.8], ['A1', 3, 1, 0.48], ['C2', 6, 1, 0.58], ['D2', 8, 2, 0.74], ['F2', 11, 1, 0.54], ['E2', 14, 1, 0.46], ['C2', 15, 1, 0.5], ['D2', 16, 2, 0.82], ['A1', 19, 1, 0.5], ['C2', 22, 1, 0.6], ['F2', 24, 2, 0.76], ['E2', 27, 1, 0.52], ['D2', 30, 2, 0.7]]
        }),
        pattern('pp9', '02 Main/Clav reply', 32, '#e19285', {
            p5: [['D4', 2, 1, 0.54], ['F4', 2, 1, 0.44], ['A4', 2, 1, 0.4], ['C5', 2, 1, 0.34], ['G3', 7, 1, 0.46], ['B3', 7, 1, 0.4], ['D4', 7, 1, 0.34], ['F4', 7, 1, 0.3], ['A3', 13, 1, 0.5], ['C4', 13, 1, 0.42], ['E4', 13, 1, 0.36], ['G4', 13, 1, 0.32], ['D4', 18, 1, 0.56], ['F4', 18, 1, 0.46], ['A4', 18, 1, 0.4], ['C5', 18, 1, 0.34], ['G3', 23, 1, 0.48], ['B3', 23, 1, 0.42], ['D4', 23, 1, 0.36], ['F4', 23, 1, 0.32], ['A3', 29, 1, 0.52], ['C4', 29, 1, 0.44], ['E4', 29, 1, 0.38], ['G4', 29, 1, 0.34]],
            p6: [['D3', 0, 3, 0.28], ['F3', 0, 3, 0.24], ['A3', 0, 3, 0.22], ['C4', 0, 3, 0.18], ['G2', 16, 3, 0.28], ['B2', 16, 3, 0.24], ['D3', 16, 3, 0.22], ['F3', 16, 3, 0.18]],
            p10: [['D4', 4, 1, 0.42], ['F4', 4, 1, 0.34], ['A4', 4, 1, 0.28], ['C4', 10, 1, 0.4], ['E4', 10, 1, 0.32], ['G4', 10, 1, 0.27], ['D4', 20, 1, 0.44], ['F4', 20, 1, 0.35], ['A4', 20, 1, 0.29], ['G3', 26, 1, 0.42], ['B3', 26, 1, 0.34], ['D4', 26, 1, 0.28]]
        }),
        pattern('pp10', '02 Main/Horn answer', 32, '#edaa88', {
            p7: [['A4', 1, 2, 0.48], ['C5', 5, 2, 0.58], ['D5', 9, 2, 0.52], ['F5', 13, 3, 0.64], ['E5', 20, 2, 0.5], ['D5', 24, 2, 0.58], ['A4', 28, 2, 0.46]],
            p9: [['D4', 3, 2, 0.3], ['F4', 3, 2, 0.24], ['A4', 3, 2, 0.2], ['G4', 15, 2, 0.32], ['B4', 15, 2, 0.26], ['D5', 15, 2, 0.22], ['A4', 27, 2, 0.34], ['C5', 27, 2, 0.28], ['E5', 27, 2, 0.24]]
        }),
        pattern('pp11', '05 Outro/Turnaround push', 32, '#c76c76', {
            p4: [['D2', 0, 2, 0.74], ['C2', 4, 1, 0.48], ['A1', 7, 2, 0.54], ['G1', 11, 1, 0.46], ['A1', 16, 2, 0.7], ['C2', 20, 1, 0.5], ['D2', 23, 2, 0.76], ['F2', 28, 2, 0.62]],
            p5: [['D4', 3, 1, 0.42], ['A4', 8, 1, 0.38], ['C5', 13, 1, 0.44], ['F4', 19, 1, 0.4], ['E4', 24, 1, 0.42], ['A4', 30, 1, 0.46]],
            p8: [['D3', 4, 1, 0.3], ['D3', 12, 1, 0.34], ['D3', 20, 1, 0.32], ['D3', 28, 1, 0.38]]
        }),
        pattern('pp12', '05 Outro/Bright turnaround', 32, '#f5bf96', {
            p6: [['D3', 0, 4, 0.26], ['F3', 0, 4, 0.22], ['A3', 0, 4, 0.2], ['C4', 0, 4, 0.16], ['G2', 16, 4, 0.26], ['B2', 16, 4, 0.22], ['D3', 16, 4, 0.2], ['F3', 16, 4, 0.16]],
            p8: [['D3', 4, 1, 0.28], ['D3', 12, 1, 0.32], ['D3', 20, 1, 0.3], ['D3', 28, 1, 0.36]],
            p9: [['D4', 6, 2, 0.28], ['F4', 6, 2, 0.22], ['A4', 6, 2, 0.18], ['G4', 22, 2, 0.3], ['B4', 22, 2, 0.24], ['D5', 22, 2, 0.2]]
        })
    ];
    connect(patterns, 'pp4', 'p7', 0, 3, 'ease-in');
    connect(patterns, 'pp4', 'p7', 6, 9, 'smooth');
    connect(patterns, 'pp4', 'p7', 18, 21, 'ease-out');
    connect(patterns, 'pp4', 'p7', 24, 27, 'smooth');
    return project(instruments, patterns, arrangeSong('pc', [
        [['pp1', 0], ['pp2', 1]], [['pp1', 0], ['pp2', 1]], [['pp7', 0], ['pp8', 1]], [['pp1', 0], ['pp9', 2]],
        [['pp3', 2], ['pp4', 4]], [['pp7', 0], ['pp9', 2]], [['pp1', 0], ['pp2', 1]], [['pp3', 2], ['pp10', 4]],
        [['pp11', 1], ['pp10', 4]], [['pp1', 0], ['pp9', 2]], [['pp3', 2], ['pp4', 4]], [['pp7', 0], ['pp8', 1]],
        [['pp1', 0], ['pp2', 1]], [['pp3', 2], ['pp10', 4]], [['pp5', 1], ['pp12', 3]], [['pp5', 1], ['pp12', 3]],
        [['pp7', 0], ['pp9', 2]], [['pp11', 1], ['pp10', 4]], [['pp1', 0], ['pp2', 1]], [['pp3', 2], ['pp4', 4]],
        [['pp7', 0], ['pp8', 1]], [['pp3', 2], ['pp10', 4]], [['pp5', 1], ['pp12', 3]], [['pp5', 1], ['pp12', 3]],
        [['pp1', 0], ['pp9', 2]], [['pp7', 0], ['pp8', 1]], [['pp3', 2], ['pp4', 4]], [['pp11', 1], ['pp10', 4]],
        [['pp6', 0], ['pp12', 3]], [['pp6', 0], ['pp12', 3]], [['pp1', 0], ['pp2', 1]], [['pp3', 2], ['pp10', 4]],
        [['pp6', 0], ['pp12', 3]], [['pp11', 1], ['pp10', 4]], [['pp6', 0], ['pp12', 3]], [['pp6', 0], ['pp12', 3]],
        [['pp1', 0], ['pp9', 2]], [['pp7', 0], ['pp8', 1]], [['pp1', 0], ['pp2', 1]], [['pp3', 2], ['pp10', 4]]
    ]), ['Kick', 'Bass', 'Clav', 'Keys', 'Lead'], 108, [
        {
            id: 'pa1',
            target: 'master',
            param: 'rev',
            points: [{step: 0, value: 0.18, curve: 'ease-out'}, {step: 128, value: 0.14, curve: 'smooth'}, {
                step: 384,
                value: 0.22,
                curve: 'ease-in'
            }, {step: 576, value: 0.3, curve: 'ease-out'}, {step: 768, value: 0.18, curve: 'smooth'}, {
                step: 960,
                value: 0.24,
                curve: 'ease-in'
            }, {step: 1280, value: 0.14}]
        },
        {
            id: 'pa2',
            target: 'p7',
            param: 'gain',
            points: [{step: 0, value: 0.22, curve: 'hold'}, {step: 128, value: 0.28, curve: 'ease-in'}, {
                step: 384,
                value: 0.36,
                curve: 'smooth'
            }, {step: 640, value: 0.26, curve: 'ease-out'}, {step: 960, value: 0.38, curve: 'smooth'}, {
                step: 1280,
                value: 0.25
            }]
        },
        {
            id: 'pa3',
            target: 'master',
            param: 'vol',
            points: [{step: 0, value: 0.58, curve: 'ease-out'}, {step: 128, value: 0.76, curve: 'smooth'}, {
                step: 384,
                value: 0.84,
                curve: 'ease-in'
            }, {step: 640, value: 0.68, curve: 'smooth'}, {step: 960, value: 0.9, curve: 'ease-out'}, {
                step: 1280,
                value: 0.62
            }]
        },
        {
            id: 'pa4',
            target: 'p6',
            param: 'gain',
            points: [{step: 0, value: 0.18, curve: 'hold'}, {step: 128, value: 0.24, curve: 'ease-in'}, {
                step: 384,
                value: 0.28,
                curve: 'smooth'
            }, {step: 640, value: 0.2, curve: 'ease-out'}, {step: 960, value: 0.3, curve: 'smooth'}, {
                step: 1280,
                value: 0.18
            }]
        }
    ], 0.16);
}

export function buildPrismCircuit(): Project {
    const instruments = [
        instrument('s1', 'Drums/Prism Kick', COLORS[0], {
            tone: 0.9,
            q: 7,
            noise: 0.12,
            noiseFreq: 1700,
            pitchDrop: 22,
            pitchTime: 0.07,
            noiseBend: 0.35,
            att: 0.002,
            dec: 0.15,
            sus: 0,
            rel: 0.09,
            gain: 0.78
        }),
        instrument('s2', 'Drums/Velvet Snare', COLORS[1], {
            tone: 0.3,
            q: 9,
            noise: 0.92,
            noiseFreq: 3300,
            pitchDrop: 4,
            pitchTime: 0.05,
            noiseBend: 0.2,
            att: 0.002,
            dec: 0.17,
            sus: 0,
            rel: 0.15,
            gain: 0.5
        }),
        instrument('s3', 'Drums/Opal Hats', COLORS[3], {
            tone: 0.08,
            q: 30,
            noise: 1,
            noiseFreq: 10800,
            pitchDrop: -5,
            pitchTime: 0.03,
            noiseBend: 0.16,
            att: 0.002,
            dec: 0.035,
            sus: 0,
            rel: 0.045,
            gain: 0.23,
            pan: 0.34
        }),
        instrument('s4', 'Percussion/Glass Toms', COLORS[8], {
            tone: 0.92,
            q: 42,
            harmShape: 'Bell partials',
            harm: 8,
            falloff: 0.82,
            stretch: 0.08,
            partials: [{ratio: 0.5, level: 0.42}, {ratio: 1, level: 1}, {ratio: 1.19, level: 0.65}, {
                ratio: 1.5,
                level: 0.38
            }, {ratio: 2.03, level: 0.5}, {ratio: 3.36, level: 0.23}],
            noise: 0.08,
            noiseFreq: 5200,
            pitchDrop: 5,
            pitchTime: 0.09,
            noiseBend: 0.7,
            att: 0.002,
            dec: 0.32,
            sus: 0.04,
            rel: 0.48,
            gain: 0.3,
            pan: -0.28
        }),
        instrument('s5', 'Bass/Carbon Current', COLORS[4], {
            tone: 1,
            q: 28,
            harmShape: 'Saw / Reed',
            harm: 6,
            falloff: 0.66,
            partials: [{ratio: 1, level: 1}, {ratio: 2, level: 0.42}, {ratio: 3, level: 0.22}, {ratio: 4, level: 0.1}],
            att: 0.008,
            dec: 0.14,
            sus: 0.7,
            rel: 0.17,
            gain: 0.6,
            legatoCurve: 'ease-out'
        }),
        instrument('s6', 'Keys/Felt Circuit', COLORS[5], {
            tone: 0.78,
            q: 25,
            harmShape: 'Odd (hollow)',
            harm: 6,
            falloff: 0.82,
            partials: [{ratio: 1, level: 1}, {ratio: 3, level: 0.36}, {ratio: 5, level: 0.18}, {ratio: 7, level: 0.08}],
            noise: 0.035,
            noiseFreq: 2900,
            voices: 2,
            detune: 10,
            att: 0.012,
            dec: 0.24,
            sus: 0.42,
            rel: 0.55,
            gain: 0.34,
            pan: -0.2
        }),
        instrument('s7', 'Synth/Aurora Pad', COLORS[7], {
            tone: 0.64,
            q: 18,
            harmShape: 'Harmonic',
            harm: 7,
            falloff: 0.76,
            noise: 0.07,
            noiseFreq: 4400,
            voices: 5,
            detune: 38,
            att: 0.72,
            dec: 0.4,
            sus: 0.82,
            rel: 1.6,
            gain: 0.31,
            pan: 0.12
        }),
        instrument('s8', 'Synth/Facet Lead', COLORS[6], {
            tone: 0.96,
            q: 39,
            harmShape: 'Saw / Reed',
            harm: 7,
            falloff: 0.68,
            vib: 15,
            vibRate: 5.4,
            vibDelay: 0.24,
            voices: 2,
            detune: 9,
            att: 0.008,
            dec: 0.15,
            sus: 0.62,
            rel: 0.3,
            gain: 0.43,
            pan: -0.08,
            legatoCurve: 'smooth'
        }),
        instrument('s9', 'Vocals/Prismatic Voice', '#7ed6df', {
            tone: 0.7,
            q: 22,
            harmShape: 'Saw / Reed',
            harm: 6,
            falloff: 0.7,
            formant: 0.48,
            f1: 520,
            f2: 1580,
            f3: 2920,
            formantQ: 7,
            vib: 11,
            vibRate: 5.1,
            vibDelay: 0.38,
            voices: 3,
            detune: 18,
            att: 0.06,
            dec: 0.22,
            sus: 0.72,
            rel: 0.58,
            gain: 0.32,
            pan: 0.16
        }),
        instrument('s10', 'Mallets/Spectral Bell', '#f6d365', {
            tone: 0.88,
            q: 50,
            harmShape: 'Metal / clang',
            harm: 6,
            falloff: 0.84,
            stretch: 0.12,
            partials: [{ratio: 1, level: 1}, {ratio: 1.41, level: 0.62}, {ratio: 2.24, level: 0.48}, {
                ratio: 2.83,
                level: 0.31
            }, {ratio: 3.61, level: 0.2}],
            att: 0.002,
            dec: 0.48,
            sus: 0.06,
            rel: 1.2,
            gain: 0.24,
            pan: 0.3
        }),
        instrument('s11', 'Synth/Photon Arp', '#badc58', {
            tone: 1,
            q: 44,
            harmShape: 'Fifths (quint)',
            harm: 6,
            falloff: 0.7,
            partials: [{ratio: 1, level: 1}, {ratio: 1.5, level: 0.38}, {ratio: 2, level: 0.58}, {
                ratio: 3,
                level: 0.22
            }, {ratio: 4, level: 0.18}],
            att: 0.002,
            dec: 0.1,
            sus: 0.03,
            rel: 0.12,
            gain: 0.27,
            pan: -0.34
        }),
        instrument('s12', 'FX/Chromatic Lift', '#c7ecee', {
            tone: 0.64,
            q: 16,
            harm: 5,
            falloff: 0.72,
            noise: 0.84,
            noiseFreq: 4800,
            pitchDrop: -36,
            pitchTime: 2.4,
            noiseBend: 1,
            voices: 4,
            detune: 30,
            att: 0.05,
            dec: 0.4,
            sus: 0.65,
            rel: 1.5,
            gain: 0.18,
            pan: 0.25
        }),
        instrument('s13', 'Keys/Neon Grand', '#ffbe76', {
            tone: 0.86,
            q: 30,
            harmShape: 'Harmonic',
            harm: 8,
            falloff: 0.68,
            partials: [{ratio: 1, level: 1}, {ratio: 2, level: 0.62}, {ratio: 3, level: 0.4}, {
                ratio: 4,
                level: 0.25
            }, {ratio: 5, level: 0.16}, {ratio: 6, level: 0.1}],
            voices: 3,
            detune: 14,
            att: 0.006,
            dec: 0.32,
            sus: 0.36,
            rel: 0.72,
            gain: 0.3,
            pan: 0.08
        })
    ];
    const patterns = [
        pattern('sp1', '01 Refraction/First light', 32, '#40506e', {
            s7: [['A2', 0, 16, 0.3], ['E3', 0, 16, 0.24], ['B3', 0, 16, 0.2], ['F#2', 16, 16, 0.31], ['C#3', 16, 16, 0.24], ['A3', 16, 16, 0.2]],
            s10: [['E5', 3, 2, 0.2], ['B5', 11, 2, 0.26], ['C#6', 19, 2, 0.22], ['A5', 27, 3, 0.28]]
        }),
        pattern('sp2', '02 Pulse/Broken symmetry', 32, '#496a82', {
            s1: [['A1', 0, 1, 0.92], ['A1', 7, 1, 0.48], ['A1', 10, 1, 0.72], ['A1', 16, 1, 0.88], ['A1', 22, 1, 0.55], ['A1', 27, 1, 0.75]],
            s2: [['D2', 4, 1, 0.68], ['D2', 12, 1, 0.78], ['D2', 20, 1, 0.7], ['D2', 28, 1, 0.82], ['D2', 30, 1, 0.24]],
            s3: [['F#4', 2, 1, 0.18], ['F#4', 6, 1, 0.27], ['F#4', 9, 1, 0.2], ['F#4', 14, 1, 0.32], ['F#4', 18, 1, 0.19], ['F#4', 23, 1, 0.29], ['F#4', 26, 1, 0.22], ['F#4', 31, 1, 0.36]],
            s4: [['A2', 15, 1, 0.35], ['E3', 31, 1, 0.42]]
        }),
        pattern('sp3', '02 Pulse/Carbon bass', 32, '#584c82', {
            s5: [['A1', 0, 3, 0.8], ['E2', 4, 2, 0.52], ['G1', 8, 3, 0.72], ['D2', 12, 2, 0.48], ['F1', 16, 3, 0.76], ['C2', 20, 2, 0.5], ['E1', 24, 3, 0.78], ['B1', 28, 2, 0.54], ['G#1', 30, 2, 0.62]]
        }),
        pattern('sp4', '02 Pulse/Velvet chords', 32, '#76547c', {
            s6: [['A3', 2, 4, 0.42], ['C4', 2, 4, 0.35], ['E4', 2, 4, 0.31], ['B4', 2, 4, 0.24], ['G3', 10, 4, 0.4], ['B3', 10, 4, 0.34], ['D4', 10, 4, 0.3], ['E4', 10, 4, 0.23], ['F3', 18, 4, 0.43], ['A3', 18, 4, 0.36], ['C4', 18, 4, 0.31], ['E4', 18, 4, 0.24], ['E3', 26, 4, 0.44], ['G#3', 26, 4, 0.36], ['B3', 26, 4, 0.32], ['D4', 26, 4, 0.25]],
            s13: [['A2', 0, 5, 0.26], ['G2', 8, 5, 0.23], ['F2', 16, 5, 0.24], ['E2', 24, 6, 0.28]]
        }),
        pattern('sp5', '03 Bloom/Facet theme', 32, '#9a5d7d', {
            s8: [['E5', 0, 3, 0.58], ['G5', 4, 3, 0.66], ['A5', 8, 4, 0.72], ['C6', 12, 3, 0.78], ['B5', 16, 3, 0.64], ['E6', 20, 4, 0.76], ['D6', 24, 3, 0.68], ['C6', 28, 4, 0.74]]
        }),
        pattern('sp6', '03 Bloom/Glass motion', 32, '#b56b72', {
            s4: [['A3', 1, 1, 0.3], ['E4', 5, 1, 0.26], ['C5', 9, 1, 0.34], ['B4', 13, 1, 0.28], ['D5', 17, 1, 0.35], ['A4', 21, 1, 0.27], ['E5', 25, 1, 0.38], ['G5', 29, 2, 0.31]],
            s10: [['A5', 7, 2, 0.24], ['E6', 15, 2, 0.28], ['C6', 23, 2, 0.25], ['B5', 31, 1, 0.3]]
        }),
        pattern('sp7', '03 Bloom/Prismatic answer', 32, '#cb7970', {
            s9: [['A4', 0, 4, 0.42], ['C5', 5, 3, 0.5], ['E5', 9, 5, 0.57], ['D5', 16, 3, 0.46], ['C5', 20, 3, 0.48], ['A4', 24, 7, 0.54]]
        }),
        pattern('sp8', '04 Weightless/Half time', 32, '#656889', {
            s1: [['A1', 0, 1, 0.72], ['A1', 14, 1, 0.42], ['A1', 16, 1, 0.7], ['A1', 29, 1, 0.46]],
            s2: [['D2', 8, 1, 0.62], ['D2', 24, 1, 0.66]],
            s7: [['F2', 0, 16, 0.27], ['C3', 0, 16, 0.2], ['G2', 16, 16, 0.28], ['D3', 16, 16, 0.21]],
            s13: [['A4', 3, 2, 0.22], ['E5', 11, 2, 0.2], ['G4', 19, 2, 0.21], ['D5', 27, 3, 0.24]]
        }),
        pattern('sp9', '04 Weightless/Photon lattice', 32, '#4b7a8e', {
            s11: [['A4', 0, 1, 0.28], ['E5', 2, 1, 0.34], ['C5', 4, 1, 0.3], ['G5', 6, 1, 0.38], ['B4', 8, 1, 0.29], ['F#5', 10, 1, 0.35], ['D5', 12, 1, 0.31], ['A5', 14, 1, 0.4], ['C5', 16, 1, 0.3], ['G5', 18, 1, 0.36], ['E5', 20, 1, 0.32], ['B5', 22, 1, 0.42], ['D5', 24, 1, 0.31], ['A5', 26, 1, 0.38], ['F#5', 28, 1, 0.34], ['C6', 30, 1, 0.44]]
        }),
        pattern('sp10', '05 Spectrum/Rising current', 32, '#527f79', {
            s1: [['A1', 0, 1, 0.84], ['A1', 6, 1, 0.46], ['A1', 8, 1, 0.76], ['A1', 14, 1, 0.52], ['A1', 16, 1, 0.88], ['A1', 21, 1, 0.5], ['A1', 24, 1, 0.8], ['A1', 28, 1, 0.6], ['A1', 30, 1, 0.68]],
            s2: [['D2', 4, 1, 0.74], ['D2', 12, 1, 0.8], ['D2', 20, 1, 0.76], ['D2', 28, 1, 0.84]],
            s3: [['F#4', 1, 1, 0.2], ['F#4', 3, 1, 0.24], ['F#4', 5, 1, 0.22], ['F#4', 7, 1, 0.28], ['F#4', 9, 1, 0.23], ['F#4', 11, 1, 0.3], ['F#4', 13, 1, 0.25], ['F#4', 15, 1, 0.34], ['F#4', 17, 1, 0.24], ['F#4', 19, 1, 0.3], ['F#4', 21, 1, 0.26], ['F#4', 23, 1, 0.35], ['F#4', 25, 1, 0.27], ['F#4', 27, 1, 0.33], ['F#4', 29, 1, 0.29], ['F#4', 31, 1, 0.4]],
            s12: [['A2', 16, 16, 0.22]]
        }),
        pattern('sp11', '06 White Light/Full spectrum', 32, '#d08b68', {
            s1: [['A1', 0, 1, 0.94], ['A1', 6, 1, 0.58], ['A1', 8, 1, 0.82], ['A1', 14, 1, 0.6], ['A1', 16, 1, 0.92], ['A1', 22, 1, 0.6], ['A1', 24, 1, 0.84], ['A1', 28, 1, 0.66], ['A1', 30, 1, 0.72]],
            s2: [['D2', 4, 1, 0.78], ['D2', 12, 1, 0.86], ['D2', 20, 1, 0.8], ['D2', 28, 1, 0.9]],
            s3: [['F#4', 2, 1, 0.26], ['F#4', 6, 1, 0.32], ['F#4', 10, 1, 0.28], ['F#4', 14, 1, 0.38], ['F#4', 18, 1, 0.28], ['F#4', 22, 1, 0.34], ['F#4', 26, 1, 0.3], ['F#4', 30, 1, 0.42]],
            s5: [['A1', 0, 3, 0.84], ['E2', 4, 2, 0.58], ['G1', 8, 3, 0.78], ['D2', 12, 2, 0.54], ['F1', 16, 3, 0.82], ['C2', 20, 2, 0.56], ['E1', 24, 3, 0.86], ['B1', 28, 2, 0.6], ['G#1', 30, 2, 0.68]],
            s6: [['A3', 2, 4, 0.5], ['C4', 2, 4, 0.42], ['E4', 2, 4, 0.37], ['B4', 2, 4, 0.29], ['G3', 10, 4, 0.48], ['B3', 10, 4, 0.4], ['D4', 10, 4, 0.35], ['E4', 10, 4, 0.27], ['F3', 18, 4, 0.5], ['A3', 18, 4, 0.42], ['C4', 18, 4, 0.37], ['E4', 18, 4, 0.29], ['E3', 26, 4, 0.52], ['G#3', 26, 4, 0.44], ['B3', 26, 4, 0.38], ['D4', 26, 4, 0.3]]
        }),
        pattern('sp12', '06 White Light/Counter prism', 32, '#e7a568', {
            s8: [['C6', 0, 4, 0.66], ['B5', 4, 5, 0.6], ['A5', 8, 6, 0.7], ['E6', 13, 5, 0.78], ['D6', 17, 4, 0.68], ['C6', 21, 5, 0.64], ['A5', 25, 7, 0.74]],
            s9: [['A4', 0, 8, 0.4], ['E5', 8, 8, 0.46], ['G5', 16, 8, 0.44], ['A5', 24, 8, 0.52]],
            s10: [['A5', 3, 2, 0.28], ['C6', 11, 2, 0.3], ['E6', 19, 2, 0.34], ['A6', 27, 3, 0.38]]
        }),
        pattern('sp13', '04 Weightless/Voice in glass', 32, '#73739a', {
            s7: [['D3', 0, 16, 0.24], ['A3', 0, 16, 0.18], ['E3', 16, 16, 0.25], ['B3', 16, 16, 0.19]],
            s9: [['F4', 2, 5, 0.3], ['A4', 9, 4, 0.36], ['C5', 16, 6, 0.4], ['B4', 25, 6, 0.34]],
            s4: [['D4', 7, 1, 0.2], ['A4', 15, 1, 0.24], ['E5', 23, 1, 0.22], ['B4', 31, 1, 0.26]]
        }),
        pattern('sp14', '07 Afterimage/Last refraction', 32, '#b9a9a1', {
            s7: [['A2', 0, 16, 0.3], ['E3', 0, 16, 0.22], ['C3', 16, 8, 0.25], ['G3', 16, 8, 0.19], ['A2', 24, 8, 0.32], ['E3', 24, 8, 0.24]],
            s13: [['E4', 0, 4, 0.28], ['C4', 8, 4, 0.24], ['B3', 16, 4, 0.22], ['A3', 24, 8, 0.3]],
            s10: [['E6', 4, 2, 0.22], ['C6', 12, 2, 0.2], ['B5', 20, 2, 0.18], ['A5', 28, 4, 0.24]]
        })
    ];
    connect(patterns, 'sp5', 's8', 0, 4, 'ease-in');
    connect(patterns, 'sp5', 's8', 8, 12, 'smooth');
    connect(patterns, 'sp5', 's8', 16, 20, 'ease-out');
    connect(patterns, 'sp5', 's8', 24, 28, 'smooth');
    connect(patterns, 'sp12', 's8', 0, 4, 'smooth');
    connect(patterns, 'sp12', 's8', 17, 21, 'ease-out');

    const sections: ArrangementSection[] = [
        [['sp1', 2]], [['sp1', 2], ['sp9', 6]], [['sp1', 2], ['sp13', 5]], [['sp13', 5], ['sp9', 6]],
        [['sp2', 0], ['sp3', 1]], [['sp2', 0], ['sp3', 1], ['sp4', 2]], [['sp2', 0], ['sp3', 1], ['sp9', 6]], [['sp2', 0], ['sp3', 1], ['sp4', 2], ['sp6', 3]],
        [['sp2', 0], ['sp3', 1], ['sp5', 4]], [['sp2', 0], ['sp3', 1], ['sp4', 2], ['sp5', 4]], [['sp2', 0], ['sp3', 1], ['sp6', 3], ['sp7', 5]], [['sp2', 0], ['sp3', 1], ['sp4', 2], ['sp5', 4], ['sp7', 5]],
        [['sp2', 0], ['sp3', 1], ['sp9', 6]], [['sp2', 0], ['sp3', 1], ['sp4', 2]], [['sp10', 0], ['sp3', 1], ['sp5', 4]], [['sp10', 0], ['sp3', 1], ['sp4', 2], ['sp6', 3]],
        [['sp8', 0], ['sp13', 5]], [['sp8', 0], ['sp9', 6]], [['sp13', 5], ['sp9', 6]], [['sp8', 0], ['sp13', 5], ['sp14', 7]],
        [['sp2', 0], ['sp3', 1], ['sp9', 6]], [['sp2', 0], ['sp3', 1], ['sp4', 2], ['sp9', 6]], [['sp10', 0], ['sp3', 1], ['sp6', 3]], [['sp10', 0], ['sp3', 1], ['sp4', 2], ['sp5', 4]],
        [['sp10', 0], ['sp3', 1], ['sp9', 6], ['sp12', 4]], [['sp10', 0], ['sp3', 1], ['sp4', 2], ['sp7', 5]], [['sp10', 0], ['sp3', 1], ['sp6', 3], ['sp12', 4]], [['sp10', 0], ['sp3', 1], ['sp4', 2], ['sp5', 4], ['sp7', 5]],
        [['sp11', 0], ['sp4', 2], ['sp5', 4]], [['sp11', 0], ['sp6', 3], ['sp7', 5], ['sp9', 6]], [['sp11', 0], ['sp4', 2], ['sp12', 4]], [['sp11', 0], ['sp6', 3], ['sp5', 4], ['sp7', 5]],
        [['sp11', 0], ['sp4', 2], ['sp9', 6], ['sp12', 4]], [['sp11', 0], ['sp6', 3], ['sp7', 5], ['sp12', 4]], [['sp11', 0], ['sp4', 2], ['sp5', 4], ['sp7', 5], ['sp9', 6]], [['sp11', 0], ['sp6', 3], ['sp12', 4], ['sp14', 7]],
        [['sp2', 0], ['sp3', 1], ['sp5', 4]], [['sp2', 0], ['sp3', 1], ['sp4', 2], ['sp7', 5]], [['sp8', 0], ['sp13', 5], ['sp9', 6]], [['sp13', 5], ['sp14', 7]],
        [['sp1', 2], ['sp14', 7]], [['sp14', 7]]
    ];
    const arrangement = arrangeSong('sc', sections).map(value => {
        if (value.patternId !== 'sp9') {return value;}
        const section = value.start / 32;
        if (section >= 16 && section < 20) {return {...value, transpose: -12};}
        if (section >= 28 && section < 36) {return {...value, transpose: 12};}
        return value;
    });
    return project(instruments, patterns, arrangement, ['Drums', 'Bass', 'Harmony', 'Percussion', 'Lead', 'Voice', 'Details', 'Afterimage'], 116, [
        {
            id: 'sa1',
            target: 'master',
            param: 'vol',
            points: [{step: 0, value: 0.48, curve: 'ease-out'}, {step: 128, value: 0.76, curve: 'linear'}, {
                step: 512,
                value: 0.88,
                curve: 'smooth'
            }, {step: 1024, value: 0.96, curve: 'ease-in'}, {step: 1280, value: 0.62, curve: 'hold'}, {
                step: 1344,
                value: 0.28,
                curve: 'linear'
            }]
        },
        {
            id: 'sa2',
            target: 'master',
            param: 'rev',
            points: [{step: 0, value: 0.72, curve: 'smooth'}, {step: 128, value: 0.28, curve: 'ease-out'}, {
                step: 512,
                value: 0.38,
                curve: 'linear'
            }, {step: 768, value: 0.56, curve: 'ease-in'}, {step: 1024, value: 0.3, curve: 'hold'}, {
                step: 1280,
                value: 0.68,
                curve: 'smooth'
            }]
        },
        {
            id: 'sa3',
            target: 'master',
            param: 'tilt',
            points: [{step: 0, value: -0.24, curve: 'ease-in'}, {step: 256, value: 0.05, curve: 'linear'}, {
                step: 640,
                value: -0.08,
                curve: 'smooth'
            }, {step: 960, value: 0.22, curve: 'ease-out'}, {step: 1216, value: 0.04, curve: 'hold'}, {
                step: 1344,
                value: -0.18,
                curve: 'linear'
            }]
        },
        {
            id: 'sa4',
            target: 's7',
            param: 'tone',
            points: [{step: 0, value: 0.34, curve: 'smooth'}, {step: 192, value: 0.64, curve: 'ease-out'}, {
                step: 544,
                value: 0.48,
                curve: 'linear'
            }, {step: 896, value: 0.82, curve: 'ease-in'}, {step: 1216, value: 0.4, curve: 'smooth'}]
        },
        {
            id: 'sa5',
            target: 's9',
            param: 'formant',
            points: [{step: 0, value: 0.18, curve: 'hold'}, {step: 256, value: 0.42, curve: 'ease-in'}, {
                step: 608,
                value: 0.6,
                curve: 'smooth'
            }, {step: 960, value: 0.36, curve: 'ease-out'}, {step: 1184, value: 0.54, curve: 'linear'}]
        },
        {
            id: 'sa6',
            target: 's8',
            param: 'pan',
            points: [{step: 0, value: -0.12, curve: 'linear'}, {step: 384, value: 0.18, curve: 'smooth'}, {
                step: 704,
                value: -0.22,
                curve: 'ease-in'
            }, {step: 1024, value: 0.2, curve: 'ease-out'}, {step: 1280, value: 0, curve: 'linear'}]
        },
        {
            id: 'sa7',
            target: 's12',
            param: 'noise',
            points: [{step: 0, value: 0.28, curve: 'hold'}, {step: 704, value: 0.32, curve: 'ease-in'}, {
                step: 896,
                value: 0.9,
                curve: 'ease-out'
            }, {step: 1024, value: 0.4, curve: 'linear'}]
        }
    ], 0.11);
}

export function buildVelvetSpurs(): Project {
    const instruments = [
        instrument('v1', 'Drums/Boot Kick', COLORS[0], {
            tone: 0.9,
            q: 7,
            noise: 0.14,
            noiseFreq: 900,
            pitchDrop: 17,
            pitchTime: 0.07,
            att: 0.002,
            dec: 0.18,
            sus: 0,
            rel: 0.12,
            gain: 0.72
        }),
        instrument('v2', 'Drums/Velvet Snare', COLORS[1], {
            tone: 0.24,
            q: 6,
            noise: 0.88,
            noiseFreq: 2800,
            pitchDrop: 5,
            att: 0.003,
            dec: 0.2,
            sus: 0,
            rel: 0.18,
            gain: 0.52
        }),
        instrument('v3', 'Percussion/Castanet Sparks', COLORS[2], {
            tone: 0.08,
            q: 20,
            noise: 0.76,
            noiseFreq: 5800,
            pitchDrop: 9,
            pitchTime: 0.025,
            att: 0.001,
            dec: 0.045,
            sus: 0,
            rel: 0.055,
            gain: 0.28,
            pan: 0.28
        }),
        instrument('v4', 'Bass/Upright Shadow', COLORS[3], {
            tone: 1,
            q: 16,
            harmShape: 'Warm acoustic',
            harm: 7,
            falloff: 0.7,
            partials: [{ratio: 1, level: 1}, {ratio: 2, level: 0.48}, {ratio: 3, level: 0.26}, {ratio: 4, level: 0.13}, {ratio: 5, level: 0.07}],
            noise: 0.05,
            noiseFreq: 900,
            att: 0.006,
            dec: 0.2,
            sus: 0.7,
            rel: 0.22,
            gain: 0.58,
            pan: -0.05
        }),
        instrument('v5', 'Guitars/Nylon Switchblade', COLORS[4], {
            tone: 1,
            q: 38,
            harmShape: 'Plucked nylon',
            harm: 8,
            falloff: 0.64,
            partials: [{ratio: 1, level: 1}, {ratio: 2, level: 0.56}, {ratio: 3, level: 0.34}, {ratio: 4, level: 0.19}, {ratio: 5, level: 0.1}, {ratio: 6, level: 0.06}],
            noise: 0.08,
            noiseFreq: 3600,
            att: 0.002,
            dec: 0.18,
            sus: 0.12,
            rel: 0.28,
            gain: 0.38,
            pan: -0.24
        }),
        instrument('v6', 'Keys/Midnight Organ', COLORS[5], {
            tone: 0.92,
            q: 24,
            harmShape: 'Drawbars',
            harm: 8,
            falloff: 0.55,
            partials: [{ratio: 1, level: 1}, {ratio: 2, level: 0.64}, {ratio: 3, level: 0.28}, {ratio: 4, level: 0.42}, {ratio: 5, level: 0.16}, {ratio: 6, level: 0.21}, {ratio: 8, level: 0.13}],
            voices: 3,
            detune: 11,
            att: 0.025,
            dec: 0.12,
            sus: 0.82,
            rel: 0.38,
            gain: 0.3,
            pan: 0.17
        }),
        instrument('v7', 'Brass/Brass Bandit', COLORS[6], {
            tone: 0.9,
            q: 28,
            harm: 7,
            falloff: 0.58,
            formant: 0.2,
            f1: 620,
            f2: 1250,
            f3: 2450,
            formantQ: 10,
            vib: 7,
            vibRate: 5.2,
            vibDelay: 0.24,
            att: 0.025,
            dec: 0.15,
            sus: 0.68,
            rel: 0.34,
            gain: 0.32,
            pan: 0.22
        }),
        instrument('v8', 'Vocals/Smoke Cry', COLORS[7], {
            tone: 0.76,
            q: 34,
            harm: 9,
            falloff: 0.68,
            formant: 0.52,
            f1: 720,
            f2: 1180,
            f3: 2750,
            formantQ: 8,
            vib: 18,
            vibRate: 5.7,
            vibDelay: 0.3,
            voices: 2,
            detune: 7,
            att: 0.045,
            dec: 0.14,
            sus: 0.74,
            rel: 0.48,
            gain: 0.3,
            pan: -0.12
        }),
        instrument('v9', 'Percussion/Church Claps', COLORS[8], {
            tone: 0.04,
            q: 5,
            noise: 0.96,
            noiseFreq: 4200,
            pitchDrop: 3,
            att: 0.001,
            dec: 0.1,
            sus: 0,
            rel: 0.11,
            gain: 0.3,
            pan: -0.2
        }),
        instrument('v10', 'Orchestra/Strings/Dust Strings', '#c7ecee', {
            tone: 0.7,
            q: 40,
            harm: 7,
            falloff: 0.72,
            voices: 5,
            detune: 22,
            att: 0.22,
            dec: 0.2,
            sus: 0.76,
            rel: 0.9,
            gain: 0.2,
            pan: 0.1
        })
    ];
    const patterns = [
        pattern('vp1', '01 Prologue/lantern guitar', 32, '#4b3b52', {
            v5: [['D4', 0, 2, 0.4], ['A4', 3, 2, 0.34], ['D5', 6, 2, 0.46], ['F5', 9, 2, 0.38], ['E5', 12, 2, 0.34], ['D5', 15, 2, 0.44], ['C5', 18, 2, 0.38], ['A4', 21, 2, 0.35], ['A#4', 24, 2, 0.4], ['C#5', 27, 2, 0.42], ['D5', 30, 2, 0.5]],
            v10: [['D3', 0, 16, 0.2], ['A3', 0, 16, 0.16], ['C3', 16, 8, 0.19], ['G3', 16, 8, 0.15], ['A#2', 24, 4, 0.18], ['F3', 24, 4, 0.14], ['A2', 28, 4, 0.2], ['E3', 28, 4, 0.15]]
        }),
        pattern('vp2', '02 Back Alley/shuffle pocket', 32, '#684452', {
            v1: [['D1', 0, 1, 0.9], ['D1', 6, 1, 0.42], ['D1', 8, 1, 0.74], ['D1', 16, 1, 0.88], ['D1', 22, 1, 0.48], ['D1', 24, 1, 0.76], ['D1', 30, 1, 0.55]],
            v2: [['D2', 4, 1, 0.56], ['D2', 12, 1, 0.72], ['D2', 20, 1, 0.58], ['D2', 28, 1, 0.78]],
            v3: [['F#5', 2, 1, 0.18], ['F#5', 5, 1, 0.24], ['F#5', 10, 1, 0.2], ['F#5', 13, 1, 0.28], ['F#5', 18, 1, 0.19], ['F#5', 21, 1, 0.25], ['F#5', 26, 1, 0.21], ['F#5', 29, 1, 0.31]],
            v4: [['D2', 0, 3, 0.72], ['A2', 4, 2, 0.48], ['C3', 8, 3, 0.62], ['B2', 12, 2, 0.46], ['A#2', 16, 3, 0.65], ['A2', 20, 2, 0.48], ['G2', 24, 2, 0.58], ['G#2', 27, 1, 0.54], ['A2', 28, 4, 0.68]]
        }),
        pattern('vp3', '02 Back Alley/nylon strut', 32, '#875057', {
            v5: [['D4', 2, 2, 0.42], ['F4', 2, 2, 0.34], ['A4', 2, 2, 0.3], ['D4', 6, 1, 0.28], ['F4', 10, 2, 0.38], ['A4', 10, 2, 0.31], ['C5', 10, 2, 0.27], ['G4', 14, 1, 0.3], ['G4', 18, 2, 0.4], ['A#4', 18, 2, 0.33], ['D5', 18, 2, 0.29], ['A4', 22, 1, 0.31], ['A3', 26, 2, 0.43], ['C#4', 26, 2, 0.35], ['E4', 26, 2, 0.3], ['G4', 30, 1, 0.36]]
        }),
        pattern('vp4', '02 Back Alley/organ smoke', 32, '#9a605e', {
            v6: [['D3', 1, 6, 0.32], ['F3', 1, 6, 0.27], ['A3', 1, 6, 0.23], ['C4', 1, 6, 0.19], ['C3', 9, 6, 0.3], ['E3', 9, 6, 0.25], ['G3', 9, 6, 0.21], ['A#3', 9, 6, 0.17], ['A#2', 17, 6, 0.31], ['D3', 17, 6, 0.26], ['F3', 17, 6, 0.22], ['A3', 17, 6, 0.18], ['A2', 25, 7, 0.34], ['C#3', 25, 7, 0.28], ['E3', 25, 7, 0.23], ['G3', 25, 7, 0.2]]
        }),
        pattern('vp5', '03 Velvet Room/smoke cry', 32, '#aa6e66', {
            v8: [['D4', 0, 3, 0.54], ['F4', 4, 3, 0.62], ['G4', 8, 4, 0.68], ['G#4', 13, 2, 0.72], ['A4', 16, 5, 0.76], ['F4', 22, 3, 0.62], ['D4', 26, 6, 0.7]]
        }),
        pattern('vp6', '03 Velvet Room/brass reply', 32, '#bd7a68', {
            v7: [['A4', 2, 2, 0.44], ['C5', 6, 2, 0.5], ['D5', 10, 4, 0.58], ['F5', 17, 2, 0.52], ['E5', 21, 2, 0.46], ['D5', 25, 5, 0.56]],
            v9: [['C5', 4, 1, 0.3], ['C5', 12, 1, 0.38], ['C5', 20, 1, 0.32], ['C5', 28, 1, 0.42]]
        }),
        pattern('vp7', '04 Rooftop/castanet chase', 32, '#bd7255', {
            v1: [['D1', 0, 1, 0.84], ['D1', 5, 1, 0.45], ['D1', 8, 1, 0.7], ['D1', 14, 1, 0.5], ['D1', 16, 1, 0.86], ['D1', 21, 1, 0.48], ['D1', 24, 1, 0.74], ['D1', 30, 1, 0.58]],
            v2: [['D2', 4, 1, 0.62], ['D2', 12, 1, 0.74], ['D2', 20, 1, 0.64], ['D2', 28, 1, 0.8]],
            v3: [['F#5', 1, 1, 0.24], ['F#5', 3, 1, 0.32], ['F#5', 5, 1, 0.25], ['F#5', 7, 1, 0.38], ['F#5', 9, 1, 0.26], ['F#5', 11, 1, 0.34], ['F#5', 13, 1, 0.28], ['F#5', 15, 1, 0.42], ['F#5', 17, 1, 0.25], ['F#5', 19, 1, 0.35], ['F#5', 21, 1, 0.27], ['F#5', 23, 1, 0.4], ['F#5', 25, 1, 0.28], ['F#5', 27, 1, 0.37], ['F#5', 29, 1, 0.3], ['F#5', 31, 1, 0.46]],
            v4: [['D2', 0, 2, 0.7], ['F2', 4, 2, 0.52], ['G2', 8, 2, 0.62], ['G#2', 12, 2, 0.55], ['A2', 16, 3, 0.74], ['C3', 20, 2, 0.56], ['A2', 24, 2, 0.66], ['C#3', 28, 2, 0.58], ['D3', 30, 2, 0.72]]
        }),
        pattern('vp8', '04 Rooftop/knife dance', 32, '#ae684b', {
            v5: [['D5', 0, 1, 0.48], ['F5', 2, 1, 0.54], ['G5', 4, 1, 0.58], ['G#5', 6, 1, 0.62], ['A5', 8, 2, 0.7], ['G5', 11, 1, 0.55], ['F5', 13, 1, 0.52], ['D5', 15, 1, 0.58], ['C5', 16, 1, 0.46], ['D5', 18, 1, 0.53], ['F5', 20, 1, 0.59], ['G5', 22, 1, 0.64], ['A5', 24, 2, 0.72], ['C#6', 27, 1, 0.62], ['D6', 29, 3, 0.76]],
            v7: [['D4', 8, 2, 0.34], ['F4', 16, 2, 0.38], ['A4', 24, 2, 0.42]]
        }),
        pattern('vp9', '05 Testimony/stop time', 32, '#80505a', {
            v1: [['D1', 0, 1, 0.94], ['D1', 8, 1, 0.88], ['D1', 16, 1, 0.92], ['D1', 24, 1, 0.96], ['D1', 30, 1, 0.64]],
            v2: [['D2', 0, 1, 0.8], ['D2', 8, 1, 0.74], ['D2', 16, 1, 0.78], ['D2', 24, 1, 0.84], ['D2', 30, 1, 0.68]],
            v4: [['D2', 0, 5, 0.74], ['F2', 8, 5, 0.66], ['G2', 16, 5, 0.7], ['A2', 24, 6, 0.76]],
            v9: [['C5', 4, 1, 0.38], ['C5', 12, 1, 0.42], ['C5', 20, 1, 0.4], ['C5', 28, 1, 0.48]]
        }),
        pattern('vp10', '05 Testimony/gospel lift', 32, '#90636e', {
            v6: [['G3', 0, 8, 0.38], ['A#3', 0, 8, 0.31], ['D4', 0, 8, 0.27], ['A#3', 8, 8, 0.4], ['D4', 8, 8, 0.32], ['F4', 8, 8, 0.28], ['C4', 16, 8, 0.42], ['E4', 16, 8, 0.34], ['G4', 16, 8, 0.29], ['A3', 24, 8, 0.43], ['C#4', 24, 8, 0.35], ['E4', 24, 8, 0.3]],
            v10: [['G2', 0, 8, 0.25], ['D3', 0, 8, 0.2], ['A#2', 8, 8, 0.26], ['F3', 8, 8, 0.21], ['C3', 16, 8, 0.27], ['G3', 16, 8, 0.22], ['A2', 24, 8, 0.28], ['E3', 24, 8, 0.22]],
            v9: [['C5', 4, 1, 0.36], ['C5', 12, 1, 0.43], ['C5', 20, 1, 0.4], ['C5', 28, 1, 0.48]]
        }),
        pattern('vp11', '06 Duel/voice and horn', 32, '#9f545e', {
            v8: [['D4', 0, 3, 0.64], ['F4', 4, 3, 0.7], ['G4', 8, 3, 0.74], ['A4', 12, 4, 0.8], ['C5', 17, 3, 0.76], ['A4', 21, 3, 0.7], ['G4', 25, 2, 0.68], ['D4', 28, 4, 0.74]],
            v7: [['A4', 2, 2, 0.5], ['C5', 6, 2, 0.56], ['D5', 10, 2, 0.62], ['F5', 14, 2, 0.68], ['E5', 19, 2, 0.6], ['D5', 23, 2, 0.58], ['A4', 27, 3, 0.62]]
        }),
        pattern('vp12', '07 Last Stand/full swagger', 32, '#b44b4f', {
            v1: [['D1', 0, 1, 0.96], ['D1', 6, 1, 0.54], ['D1', 8, 1, 0.82], ['D1', 14, 1, 0.6], ['D1', 16, 1, 0.94], ['D1', 22, 1, 0.58], ['D1', 24, 1, 0.86], ['D1', 30, 1, 0.68]],
            v2: [['D2', 4, 1, 0.72], ['D2', 12, 1, 0.86], ['D2', 20, 1, 0.76], ['D2', 28, 1, 0.9]],
            v3: [['F#5', 2, 1, 0.28], ['F#5', 6, 1, 0.36], ['F#5', 10, 1, 0.31], ['F#5', 14, 1, 0.42], ['F#5', 18, 1, 0.3], ['F#5', 22, 1, 0.39], ['F#5', 26, 1, 0.34], ['F#5', 30, 1, 0.48]],
            v4: [['D2', 0, 3, 0.8], ['A2', 4, 2, 0.58], ['C3', 8, 3, 0.72], ['B2', 12, 2, 0.54], ['A#2', 16, 3, 0.75], ['A2', 20, 2, 0.56], ['G2', 24, 2, 0.68], ['G#2', 27, 1, 0.62], ['A2', 28, 4, 0.78]],
            v9: [['C5', 4, 1, 0.42], ['C5', 12, 1, 0.5], ['C5', 20, 1, 0.46], ['C5', 28, 1, 0.56]]
        }),
        pattern('vp13', '07 Last Stand/burning chorus', 32, '#c85c54', {
            v5: [['D4', 2, 2, 0.5], ['F4', 2, 2, 0.42], ['A4', 2, 2, 0.38], ['C5', 2, 2, 0.31], ['C4', 10, 2, 0.47], ['E4', 10, 2, 0.4], ['G4', 10, 2, 0.35], ['A#4', 10, 2, 0.29], ['A#3', 18, 2, 0.49], ['D4', 18, 2, 0.41], ['F4', 18, 2, 0.36], ['A4', 18, 2, 0.3], ['A3', 26, 2, 0.52], ['C#4', 26, 2, 0.44], ['E4', 26, 2, 0.38], ['G4', 26, 2, 0.32]],
            v6: [['D3', 0, 8, 0.38], ['F3', 0, 8, 0.3], ['C3', 8, 8, 0.36], ['E3', 8, 8, 0.29], ['A#2', 16, 8, 0.38], ['D3', 16, 8, 0.3], ['A2', 24, 8, 0.42], ['C#3', 24, 8, 0.34]],
            v10: [['D3', 0, 16, 0.25], ['A3', 0, 16, 0.2], ['A#2', 16, 8, 0.26], ['F3', 16, 8, 0.21], ['A2', 24, 8, 0.28], ['E3', 24, 8, 0.22]]
        }),
        pattern('vp14', '08 Sunrise/final bow', 32, '#d48b68', {
            v5: [['D4', 0, 2, 0.36], ['A4', 4, 2, 0.32], ['D5', 8, 3, 0.42], ['F5', 12, 3, 0.4], ['E5', 16, 2, 0.34], ['C#5', 20, 2, 0.38], ['D5', 24, 8, 0.46]],
            v8: [['A4', 0, 4, 0.44], ['G4', 5, 3, 0.4], ['F4', 9, 3, 0.42], ['D4', 13, 7, 0.5], ['C#4', 21, 3, 0.42], ['D4', 25, 7, 0.56]],
            v10: [['D3', 0, 32, 0.25], ['A3', 0, 32, 0.19]]
        })
    ];
    connect(patterns, 'vp5', 'v8', 0, 4, 'ease-in');
    connect(patterns, 'vp5', 'v8', 16, 22, 'smooth');
    connect(patterns, 'vp11', 'v8', 12, 17, 'ease-out');
    connect(patterns, 'vp14', 'v8', 21, 25, 'smooth');
    const sections: ArrangementSection[] = [
        [['vp1', 1]], [['vp1', 1], ['vp4', 2]], [['vp1', 1], ['vp4', 2]], [['vp2', 0], ['vp1', 1]],
        [['vp2', 0], ['vp3', 1], ['vp4', 2]], [['vp2', 0], ['vp3', 1], ['vp5', 4]], [['vp2', 0], ['vp3', 1], ['vp6', 3]], [['vp2', 0], ['vp4', 2], ['vp5', 4]],
        [['vp2', 0], ['vp3', 1], ['vp4', 2]], [['vp2', 0], ['vp3', 1], ['vp6', 3]], [['vp2', 0], ['vp4', 2], ['vp5', 4]], [['vp9', 0], ['vp6', 3]],
        [['vp7', 0], ['vp8', 1]], [['vp7', 0], ['vp8', 1], ['vp4', 2]], [['vp7', 0], ['vp8', 1], ['vp6', 3]], [['vp7', 0], ['vp8', 1], ['vp5', 4]],
        [['vp7', 0], ['vp3', 1], ['vp4', 2]], [['vp7', 0], ['vp8', 1], ['vp6', 3]], [['vp7', 0], ['vp8', 1], ['vp11', 4]], [['vp9', 0], ['vp8', 1], ['vp6', 3]],
        [['vp1', 1], ['vp5', 4]], [['vp9', 0], ['vp5', 4]], [['vp9', 0], ['vp10', 2]], [['vp2', 0], ['vp10', 2], ['vp6', 3]],
        [['vp2', 0], ['vp3', 1], ['vp10', 2]], [['vp2', 0], ['vp10', 2], ['vp5', 4]], [['vp7', 0], ['vp3', 1], ['vp10', 2], ['vp6', 3]], [['vp7', 0], ['vp10', 2], ['vp11', 4]],
        [['vp12', 0], ['vp3', 1], ['vp10', 2]], [['vp12', 0], ['vp10', 2], ['vp6', 3]], [['vp12', 0], ['vp8', 1], ['vp11', 4]], [['vp9', 0], ['vp10', 2], ['vp11', 4]],
        [['vp12', 0], ['vp13', 1], ['vp6', 3]], [['vp12', 0], ['vp13', 1], ['vp11', 4]], [['vp12', 0], ['vp13', 1], ['vp10', 2], ['vp6', 3]], [['vp12', 0], ['vp13', 1], ['vp10', 2], ['vp11', 4]],
        [['vp12', 0], ['vp13', 1], ['vp6', 3]], [['vp12', 0], ['vp13', 1], ['vp11', 4]], [['vp1', 1], ['vp14', 4]], [['vp14', 4]]
    ];
    return project(instruments, patterns, arrangeSong('vc', sections), ['Rhythm', 'Guitars', 'Keys', 'Brass', 'Voice'], 104, [
        {
            id: 'va1',
            target: 'master',
            param: 'rev',
            points: [{step: 0, value: 0.42, curve: 'ease-out'}, {step: 128, value: 0.2, curve: 'smooth'}, {step: 640, value: 0.28}, {step: 1024, value: 0.38, curve: 'ease-in'}, {step: 1216, value: 0.55}]
        },
        {
            id: 'va2',
            target: 'v8',
            param: 'formant',
            points: [{step: 128, value: 0.38, curve: 'smooth'}, {step: 512, value: 0.56}, {step: 768, value: 0.64, curve: 'ease-out'}, {step: 1152, value: 0.48}]
        },
        {
            id: 'va3',
            target: 'v7',
            param: 'gain',
            points: [{step: 160, value: 0.24}, {step: 384, value: 0.34, curve: 'ease-in'}, {step: 1024, value: 0.4}, {step: 1216, value: 0.26}]
        },
        {
            id: 'va4',
            target: 'master',
            param: 'vol',
            points: [{step: 0, value: 0.72, curve: 'ease-in'}, {step: 96, value: 0.9}, {step: 1184, value: 0.92, curve: 'ease-out'}, {step: 1276, value: 0.28}]
        }
    ], 0.64);
}

export function buildBitHorizon(): Project {
    const instruments = [
        instrument('c1', 'Drums/Bit Kick', COLORS[0], {
            tone: 0.92,
            q: 8,
            harmShape: 'Flute (pure)',
            harm: 3,
            falloff: 0.6,
            noise: 0.08,
            noiseFreq: 900,
            pitchDrop: 24,
            pitchTime: 0.06,
            noiseBend: 0.35,
            att: 0.002,
            dec: 0.08,
            sus: 0,
            rel: 0.06,
            gain: 0.72
        }),
        instrument('c2', 'Drums/Bit Snare', COLORS[1], {
            tone: 0.2,
            q: 12,
            harmShape: 'Odd (hollow)',
            harm: 3,
            falloff: 0.8,
            noise: 0.94,
            noiseFreq: 4200,
            pitchDrop: 5,
            pitchTime: 0.04,
            noiseBend: 0.2,
            att: 0.002,
            dec: 0.07,
            sus: 0,
            rel: 0.08,
            gain: 0.42
        }),
        instrument('c3', 'Drums/Bit Hat', COLORS[3], {
            tone: 0,
            q: 28,
            harm: 2,
            falloff: 0.7,
            noise: 1,
            noiseFreq: 9800,
            pitchDrop: -3,
            pitchTime: 0.025,
            noiseBend: 0.1,
            att: 0.002,
            dec: 0.028,
            sus: 0,
            rel: 0.035,
            gain: 0.22,
            pan: 0.2
        }),
        instrument('c4', 'Bass/Pixel Pulse', COLORS[4], {
            tone: 1,
            q: 42,
            harmShape: 'Odd (hollow)',
            harm: 4,
            falloff: 0.88,
            partials: [{ratio: 1, level: 1}, {ratio: 3, level: 0.48}, {ratio: 5, level: 0.2}, {ratio: 7, level: 0.08}],
            att: 0.002,
            dec: 0.07,
            sus: 0.65,
            rel: 0.06,
            gain: 0.5
        }),
        instrument('c5', 'Keys/Power Chord', COLORS[5], {
            tone: 0.86,
            q: 30,
            harmShape: 'Fifths (quint)',
            harm: 5,
            falloff: 0.82,
            partials: [{ratio: 1, level: 1}, {ratio: 1.5, level: 0.56}, {ratio: 2, level: 0.68}, {
                ratio: 3,
                level: 0.32
            }],
            att: 0.002,
            dec: 0.1,
            sus: 0.18,
            rel: 0.1,
            gain: 0.24,
            pan: -0.18
        }),
        instrument('c6', 'Lead/Star Runner', COLORS[6], {
            tone: 0.9,
            q: 38,
            harmShape: 'Saw / Reed',
            harm: 5,
            falloff: 0.72,
            partials: [{ratio: 1, level: 1}, {ratio: 2, level: 0.44}, {ratio: 3, level: 0.24}, {ratio: 4, level: 0.12}],
            vib: 4,
            vibRate: 6,
            vibDelay: 0.35,
            att: 0.002,
            dec: 0.08,
            sus: 0.48,
            rel: 0.09,
            gain: 0.32,
            pan: 0.12,
            legatoCurve: 'ease-out'
        }),
        instrument('c7', 'Arp/Crystal Ladder', COLORS[7], {
            tone: 0.72,
            q: 34,
            harmShape: 'Odd (hollow)',
            harm: 4,
            falloff: 0.78,
            partials: [{ratio: 1, level: 1}, {ratio: 3, level: 0.34}, {ratio: 5, level: 0.13}],
            att: 0.002,
            dec: 0.055,
            sus: 0.02,
            rel: 0.06,
            gain: 0.16,
            pan: -0.32
        }),
        instrument('c8', 'FX/Level Warp', COLORS[8], {
            tone: 0.3,
            q: 14,
            harmShape: 'Saw / Reed',
            harm: 4,
            falloff: 0.7,
            noise: 0.52,
            noiseFreq: 5000,
            pitchDrop: -24,
            pitchTime: 1.7,
            noiseBend: 1,
            att: 0.015,
            dec: 0.15,
            sus: 0.42,
            rel: 0.48,
            gain: 0.1,
            pan: 0.25
        }),
        instrument('c9', 'Pad/Console Memory', '#85a7bb', {
            tone: 0.38,
            q: 20,
            harmShape: 'Flute (pure)',
            harm: 3,
            falloff: 0.76,
            partials: [{ratio: 1, level: 1}, {ratio: 2, level: 0.18}, {ratio: 3, level: 0.06}],
            vib: 3,
            vibRate: 4.2,
            vibDelay: 0.5,
            att: 0.12,
            dec: 0.22,
            sus: 0.55,
            rel: 0.38,
            gain: 0.16,
            pan: 0.28
        }),
        instrument('c10', 'FX/Save Point', '#d6c27a', {
            tone: 0.7,
            q: 26,
            harmShape: 'Bell partials',
            harm: 5,
            falloff: 0.75,
            partials: [{ratio: 0.5, level: 0.45}, {ratio: 1, level: 1}, {ratio: 1.5, level: 0.35}, {
                ratio: 2,
                level: 0.52
            }, {ratio: 3.36, level: 0.16}],
            att: 0.002,
            dec: 0.28,
            sus: 0.05,
            rel: 0.45,
            gain: 0.18,
            pan: 0.36
        })
    ];
    const patterns = [
        pattern('cp1', '01 Boot/Signal awake', 32, '#3d5b78', {c7: [['E5', 0, 1, 0.28], ['B5', 4, 1, 0.3], ['G5', 8, 1, 0.32], ['B5', 12, 1, 0.28], ['D6', 16, 1, 0.34], ['B5', 20, 1, 0.3], ['G5', 24, 1, 0.28], ['B5', 28, 1, 0.32]]}),
        pattern('cp2', '02 Run/Bit rhythm', 32, '#4c7186', {
            c1: [['E1', 0, 1, 0.9], ['E1', 8, 1, 0.72], ['E1', 16, 1, 0.86], ['E1', 24, 1, 0.76]],
            c2: [['E2', 8, 1, 0.68], ['E2', 24, 1, 0.74]],
            c3: [['E4', 2, 1, 0.24], ['E4', 6, 1, 0.2], ['E4', 10, 1, 0.28], ['E4', 14, 1, 0.22], ['E4', 18, 1, 0.26], ['E4', 22, 1, 0.22], ['E4', 26, 1, 0.3], ['E4', 30, 1, 0.24]]
        }),
        pattern('cp3', '02 Run/Pixel bass', 32, '#5e5085', {c4: [['E2', 0, 3, 0.82], ['B1', 4, 2, 0.58], ['D2', 8, 3, 0.74], ['A1', 12, 2, 0.56], ['C2', 16, 3, 0.8], ['G1', 20, 2, 0.58], ['D2', 24, 3, 0.76], ['B1', 28, 3, 0.62]]}),
        pattern('cp4', '02 Run/Power grid', 32, '#765683', {c5: [['E3', 0, 3, 0.4], ['B3', 0, 3, 0.3], ['D3', 8, 3, 0.38], ['A3', 8, 3, 0.28], ['C3', 16, 3, 0.42], ['G3', 16, 3, 0.31], ['D3', 24, 3, 0.4], ['A3', 24, 3, 0.3]]}),
        pattern('cp5', '03 Flight/Star runner', 32, '#a85d78', {c6: [['E5', 0, 3, 0.58], ['G5', 4, 3, 0.66], ['B5', 8, 3, 0.72], ['D6', 12, 4, 0.78], ['B5', 16, 3, 0.64], ['A5', 20, 3, 0.68], ['G5', 24, 3, 0.62], ['E6', 28, 4, 0.8]]}),
        pattern('cp6', '03 Flight/Crystal ladder', 32, '#c76c6d', {c7: [['E5', 0, 1, 0.28], ['G5', 2, 1, 0.31], ['B5', 4, 1, 0.35], ['E6', 6, 1, 0.38], ['D5', 8, 1, 0.27], ['F#5', 10, 1, 0.3], ['A5', 12, 1, 0.34], ['D6', 14, 1, 0.37], ['C5', 16, 1, 0.28], ['E5', 18, 1, 0.31], ['G5', 20, 1, 0.35], ['C6', 22, 1, 0.38], ['D5', 24, 1, 0.3], ['F#5', 26, 1, 0.33], ['A5', 28, 1, 0.37], ['D6', 30, 1, 0.4]]}),
        pattern('cp7', '04 Cave/Low battery', 32, '#616687', {
            c1: [['E1', 0, 1, 0.72], ['E1', 16, 1, 0.68]],
            c2: [['E2', 8, 1, 0.58], ['E2', 24, 1, 0.62]],
            c4: [['C2', 0, 7, 0.62], ['G1', 8, 7, 0.56], ['D2', 16, 7, 0.64], ['A1', 24, 7, 0.58]],
            c5: [['C3', 2, 5, 0.3], ['G3', 10, 5, 0.28], ['D3', 18, 5, 0.31], ['A2', 26, 5, 0.27]]
        }),
        pattern('cp8', '05 Boss/Red alert', 32, '#9b555f', {
            c1: [['E1', 0, 1, 0.94], ['E1', 6, 1, 0.64], ['E1', 8, 1, 0.82], ['E1', 14, 1, 0.66], ['E1', 16, 1, 0.9], ['E1', 22, 1, 0.68], ['E1', 24, 1, 0.86], ['E1', 30, 1, 0.7]],
            c2: [['E2', 4, 1, 0.78], ['E2', 12, 1, 0.84], ['E2', 20, 1, 0.8], ['E2', 28, 1, 0.88]],
            c3: [['E4', 1, 1, 0.25], ['E4', 3, 1, 0.28], ['E4', 5, 1, 0.26], ['E4', 7, 1, 0.32], ['E4', 9, 1, 0.28], ['E4', 11, 1, 0.34], ['E4', 13, 1, 0.3], ['E4', 15, 1, 0.36], ['E4', 17, 1, 0.28], ['E4', 19, 1, 0.34], ['E4', 21, 1, 0.3], ['E4', 23, 1, 0.36], ['E4', 25, 1, 0.32], ['E4', 27, 1, 0.38], ['E4', 29, 1, 0.34], ['E4', 31, 1, 0.4]]
        }),
        pattern('cp9', '05 Boss/Level warp', 32, '#c4655f', {
            c8: [['E3', 0, 16, 0.22]],
            c6: [['B5', 0, 3, 0.72], ['D6', 4, 3, 0.78], ['E6', 8, 4, 0.84], ['G6', 12, 4, 0.8], ['E6', 16, 3, 0.76], ['D6', 20, 3, 0.72], ['B5', 24, 3, 0.7], ['E6', 28, 4, 0.86]]
        }),
        pattern('cp10', '06 Clear/High score', 32, '#d2a665', {
            c5: [['E3', 0, 4, 0.32], ['B3', 0, 4, 0.25], ['C3', 8, 4, 0.3], ['G3', 8, 4, 0.22], ['D3', 16, 4, 0.34], ['A3', 16, 4, 0.26], ['E3', 24, 8, 0.36], ['B3', 24, 8, 0.28]],
            c6: [['E6', 0, 4, 0.64], ['G6', 5, 3, 0.68], ['B6', 9, 4, 0.74], ['D7', 14, 4, 0.78], ['B6', 19, 3, 0.66], ['G6', 23, 3, 0.62], ['E6', 27, 5, 0.72]]
        }),
        pattern('cp11', '04 Horizon/Second signal', 32, '#7981b2', {c6: [['B4', 0, 3, 0.54], ['D5', 4, 3, 0.62], ['F#5', 8, 4, 0.68], ['A5', 13, 3, 0.72], ['G5', 17, 3, 0.62], ['F#5', 21, 3, 0.58], ['D5', 25, 3, 0.54], ['B4', 29, 3, 0.6]]}),
        pattern('cp12', '04 Horizon/Answer bass', 32, '#66709f', {c4: [['B1', 0, 3, 0.7], ['F#2', 4, 2, 0.48], ['A1', 8, 3, 0.66], ['E2', 12, 2, 0.46], ['G1', 16, 3, 0.68], ['D2', 20, 2, 0.48], ['F#1', 24, 3, 0.7], ['C#2', 28, 3, 0.5]]}),
        pattern('cp13', '04 Horizon/Off-grid rhythm', 32, '#55768e', {
            c1: [['E1', 0, 1, 0.82], ['E1', 7, 1, 0.5], ['E1', 12, 1, 0.7], ['E1', 16, 1, 0.84], ['E1', 23, 1, 0.54], ['E1', 28, 1, 0.76]],
            c2: [['E2', 4, 1, 0.62], ['E2', 14, 1, 0.54], ['E2', 20, 1, 0.66], ['E2', 30, 1, 0.58]],
            c3: [['E4', 3, 1, 0.18], ['E4', 9, 1, 0.22], ['E4', 13, 1, 0.2], ['E4', 19, 1, 0.24], ['E4', 25, 1, 0.22], ['E4', 29, 1, 0.26]]
        }),
        pattern('cp14', '05 Drift/Console memory', 32, '#60748d', {
            c4: [['C2', 0, 7, 0.5], ['G1', 8, 7, 0.44], ['A1', 16, 7, 0.48], ['E1', 24, 7, 0.42]],
            c9: [['C4', 0, 8, 0.2], ['E4', 0, 8, 0.15], ['G4', 0, 8, 0.12], ['A3', 16, 8, 0.21], ['C4', 16, 8, 0.16], ['E4', 16, 8, 0.13]],
            c10: [['E6', 7, 2, 0.28], ['D6', 15, 2, 0.25], ['C6', 23, 2, 0.26], ['B5', 30, 2, 0.3]]
        }),
        pattern('cp15', '06 Return/Counter spark', 32, '#bd7a72', {c7: [['B5', 0, 1, 0.24], ['D6', 2, 1, 0.28], ['F#6', 4, 1, 0.32], ['B6', 6, 1, 0.34], ['A5', 8, 1, 0.24], ['C6', 10, 1, 0.28], ['E6', 12, 1, 0.32], ['A6', 14, 1, 0.34], ['G5', 16, 1, 0.25], ['B5', 18, 1, 0.28], ['D6', 20, 1, 0.32], ['G6', 22, 1, 0.35], ['F#5', 24, 1, 0.26], ['A5', 26, 1, 0.3], ['C#6', 28, 1, 0.34], ['F#6', 30, 1, 0.36]]}),
        pattern('cp16', '07 Exit/Final transmission', 32, '#d8b06a', {
            c1: [['E1', 0, 1, 0.86], ['E1', 8, 1, 0.72], ['E1', 16, 1, 0.82]],
            c2: [['E2', 8, 1, 0.7], ['E2', 24, 1, 0.56]],
            c4: [['E2', 0, 4, 0.7], ['B1', 8, 4, 0.56], ['C2', 16, 4, 0.62], ['E2', 24, 8, 0.74]],
            c5: [['E3', 0, 6, 0.28], ['B3', 0, 6, 0.22], ['C3', 16, 6, 0.26], ['G3', 16, 6, 0.2]],
            c6: [['E6', 0, 4, 0.64], ['B5', 6, 3, 0.56], ['G5', 11, 3, 0.52], ['E6', 16, 4, 0.68], ['D6', 22, 3, 0.58], ['E6', 27, 5, 0.7]],
            c10: [['E7', 28, 4, 0.34]]
        })
    ];
    connect(patterns, 'cp5', 'c6', 0, 4, 'ease-out');
    connect(patterns, 'cp5', 'c6', 8, 12, 'smooth');
    connect(patterns, 'cp5', 'c6', 20, 24, 'ease-in');
    connect(patterns, 'cp11', 'c6', 4, 8, 'smooth');
    connect(patterns, 'cp11', 'c6', 17, 21, 'ease-out');
    const sections: ArrangementSection[] = [
        [['cp1', 3]], [['cp1', 3], ['cp14', 2]], [['cp1', 3], ['cp14', 2]], [['cp1', 3], ['cp10', 3]],
        [['cp2', 0], ['cp3', 1]], [['cp2', 0], ['cp3', 1], ['cp4', 2]], [['cp13', 0], ['cp3', 1], ['cp4', 2]], [['cp2', 0], ['cp3', 1], ['cp6', 3]],
        [['cp2', 0], ['cp3', 1], ['cp5', 4]], [['cp13', 0], ['cp3', 1], ['cp4', 2], ['cp5', 4]], [['cp2', 0], ['cp3', 1], ['cp6', 3]], [['cp13', 0], ['cp3', 1], ['cp5', 4], ['cp6', 3]],
        [['cp13', 0], ['cp12', 1]], [['cp13', 0], ['cp12', 1], ['cp11', 4]], [['cp13', 0], ['cp12', 1], ['cp15', 3]], [['cp13', 0], ['cp12', 1], ['cp11', 4], ['cp15', 3]],
        [['cp7', 1], ['cp14', 2]], [['cp14', 2]], [['cp14', 2], ['cp1', 3]], [['cp7', 1], ['cp10', 3]],
        [['cp2', 0], ['cp3', 1], ['cp5', 4]], [['cp13', 0], ['cp12', 1], ['cp11', 4]], [['cp2', 0], ['cp3', 1], ['cp4', 2], ['cp6', 3]], [['cp13', 0], ['cp12', 1], ['cp15', 3]],
        [['cp8', 0], ['cp3', 1], ['cp9', 4]], [['cp8', 0], ['cp3', 1], ['cp4', 2], ['cp9', 4]], [['cp8', 0], ['cp12', 1], ['cp11', 4]], [['cp8', 0], ['cp12', 1], ['cp9', 4], ['cp15', 3]],
        [['cp8', 0], ['cp3', 1], ['cp4', 2], ['cp9', 4]], [['cp8', 0], ['cp12', 1], ['cp11', 4], ['cp15', 3]], [['cp8', 0], ['cp3', 1], ['cp9', 4], ['cp6', 3]], [['cp8', 0], ['cp12', 1], ['cp4', 2], ['cp11', 4]],
        [['cp7', 1], ['cp14', 2]], [['cp14', 2], ['cp10', 3]], [['cp7', 1], ['cp1', 3]], [['cp14', 2]],
        [['cp13', 0], ['cp3', 1], ['cp5', 4], ['cp15', 3]], [['cp2', 0], ['cp12', 1], ['cp11', 4]], [['cp13', 0], ['cp3', 1], ['cp4', 2], ['cp5', 4]], [['cp2', 0], ['cp12', 1], ['cp11', 4], ['cp15', 3]],
        [['cp8', 0], ['cp3', 1], ['cp9', 4], ['cp15', 3]], [['cp8', 0], ['cp12', 1], ['cp4', 2], ['cp11', 4]], [['cp8', 0], ['cp3', 1], ['cp4', 2], ['cp9', 4], ['cp15', 3]], [['cp8', 0], ['cp12', 1], ['cp11', 4], ['cp9', 4]],
        [['cp16', 0], ['cp15', 3]], [['cp16', 0], ['cp6', 3]], [['cp16', 0], ['cp11', 4]], [['cp16', 0], ['cp15', 3]],
        [['cp10', 2], ['cp14', 1]], [['cp16', 0], ['cp10', 2]], [['cp14', 2], ['cp1', 3]], [['cp16', 0]],
        [['cp10', 2]], [['cp14', 2]], [['cp16', 0]], [['cp10', 2]]
    ];
    return project(instruments, patterns, arrangeSong('bc', sections), ['Rhythm', 'Bass', 'Harmony', 'Arpeggio', 'Lead'], 150, [
        {
            id: 'ca1',
            target: 'master',
            param: 'vol',
            points: [{step: 0, value: 0.38, curve: 'ease-out'}, {step: 256, value: 0.68, curve: 'linear'}, {
                step: 640,
                value: 0.76,
                curve: 'ease-in'
            }, {step: 1024, value: 0.86, curve: 'smooth'}, {step: 1408, value: 0.78, curve: 'hold'}, {
                step: 1728,
                value: 0.3,
                curve: 'ease-out'
            }]
        },
        {
            id: 'ca2',
            target: 'master',
            param: 'rev',
            points: [{step: 0, value: 0.28, curve: 'hold'}, {step: 384, value: 0.18, curve: 'linear'}, {
                step: 576,
                value: 0.38,
                curve: 'ease-out'
            }, {step: 1024, value: 0.24, curve: 'smooth'}, {step: 1536, value: 0.42, curve: 'ease-in'}, {
                step: 1728,
                value: 0.56,
                curve: 'linear'
            }]
        },
        {
            id: 'ca3',
            target: 'c7',
            param: 'tone',
            points: [{step: 0, value: 0.34, curve: 'hold'}, {step: 320, value: 0.68, curve: 'ease-in'}, {
                step: 640,
                value: 0.42,
                curve: 'smooth'
            }, {step: 1024, value: 0.72, curve: 'ease-out'}, {step: 1440, value: 0.28, curve: 'linear'}]
        },
        {
            id: 'ca4',
            target: 'c8',
            param: 'gain',
            points: [{step: 0, value: 0, curve: 'hold'}, {step: 768, value: 0.1, curve: 'ease-in'}, {
                step: 1024,
                value: 0,
                curve: 'ease-out'
            }, {step: 1280, value: 0.08, curve: 'smooth'}, {step: 1472, value: 0, curve: 'linear'}]
        },
        {
            id: 'ca5',
            target: 'c9',
            param: 'gain',
            points: [{step: 0, value: 0.14, curve: 'hold'}, {step: 512, value: 0.22, curve: 'ease-in'}, {
                step: 768,
                value: 0.1,
                curve: 'ease-out'
            }, {step: 1536, value: 0.2, curve: 'smooth'}]
        },
        {
            id: 'ca6',
            target: 'c6',
            param: 'tone',
            points: [{step: 0, value: 0.58, curve: 'hold'}, {step: 512, value: 0.82, curve: 'ease-in'}, {
                step: 960,
                value: 0.68,
                curve: 'smooth'
            }, {step: 1280, value: 0.9, curve: 'ease-out'}, {step: 1600, value: 0.46, curve: 'linear'}]
        }
    ]);
}
