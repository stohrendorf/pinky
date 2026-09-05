import type {
    Instrument, InstrumentParams, Note, Pattern, Project
} from './types';

import {
    DEFAULT_PARAMS, ensurePartials
} from './instruments';

/** The editable 100 BPM trailer arrangement used by the Pinky promo. */

type NoteSpec = [pitch: string, start: number, len?: number, vel?: number];

const ID = {
    air: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c001',
    sub: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c002',
    boom: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c003',
    kick: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c004',
    snare: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c005',
    clap: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c006',
    hat: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c007',
    openHat: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c008',
    bass: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c009',
    choir: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c010',
    strings: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c011',
    pluck: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c012',
    lead: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c013',
    soprano: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c014',
    bell: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c015',
    impact: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c016',
    riser: '7ad4a5b1-89d0-4ad0-8f43-4ce61bd1c017'
} as const;

const color = {
    air: '#85828a', sub: '#53d8fb', boom: '#ff9f43', kick: '#ff9f43', snare: '#ee5253', clap: '#ff6b6b',
    hat: '#f9ca24', openHat: '#f9ca24', bass: '#10ac84', choir: '#a29bfe', strings: '#0abde3', pluck: '#badc58',
    lead: '#e056fd', soprano: '#f06f73', bell: '#48dbfb', impact: '#7ed6df', riser: '#aaa7ac'
};

const notes = (...items: NoteSpec[]): Note[] => items.map(([pitch, start, len = 1, vel = 0.8]) => ({pitch, start, len, vel}));
const pattern = (id: string, name: string, tracks: Record<string, Note[]>, steps = 32): Pattern =>
    ({id, name, steps, color: '#e056fd', tracks});
const instrument = (id: string, name: string, c: string, params: Partial<InstrumentParams>): Instrument =>
    ({id, name, color: c, params: ensurePartials({...DEFAULT_PARAMS, ...params})});

const chord = (pitches: string[], start: number, len: number, vel: number): NoteSpec[] =>
    pitches.map(pitch => [pitch, start, len, vel] as NoteSpec);
const repeated = (pitches: string[], starts: number[], len: number, vel: (step: number) => number): NoteSpec[] =>
    starts.flatMap(start => pitches.map(pitch => [pitch, start, len, vel(start)] as NoteSpec));

const CHORDS = {
    dm: ['D3', 'F3', 'A3', 'D4'],
    bb: ['A#2', 'D3', 'F3', 'A#3'],
    f: ['C3', 'F3', 'A3', 'C4'],
    c: ['C3', 'E3', 'G3', 'C4']
};
const ARPS = {
    dm: ['D4', 'A4', 'D5', 'F5', 'A4', 'D5', 'F5', 'A5'],
    bb: ['A#3', 'F4', 'A#4', 'D5', 'F4', 'A#4', 'D5', 'F5'],
    f: ['F4', 'C5', 'F5', 'A5', 'C5', 'F5', 'A5', 'C6'],
    c: ['C4', 'G4', 'C5', 'E5', 'G4', 'C5', 'E5', 'G5']
};

const groove = (id: string, name: string, chordName: keyof typeof CHORDS, root: string, kickTurn = false, lead: NoteSpec[] = [], strings = false): Pattern => {
    const chordNotes = chord(CHORDS[chordName], 0, 16, 0.9);
    const bass = [0, 3, 6, 8, 11, 14]
        .map(start => [root, start, start % 8 === 0 ? 2 : 1.5, start % 8 === 0 ? 1 : 0.75] as NoteSpec);
    const pluck = ARPS[chordName]
        .map((pitch, index) => [pitch, index * 2, 1.5, index % 2 === 0 ? 1 : 0.8] as NoteSpec);
    const hats = repeated(['A5'], Array.from({length: 8}, (_, index) => index * 2), 1,
        step => step % 4 === 0 ? 0.85 : 0.5);
    // notes.ts puts middle C at C5, so a kick that thumps at 55 Hz is A2 and
    // a snare body around 150 Hz is D4 (an octave lower they were subsonic)
    const snare = [4, 12].map(start => ['D4', start, 1, start === 12 ? 1 : 0.9] as NoteSpec);
    const kicks: NoteSpec[] = kickTurn
        ? [['A2', 0, 1, 1], ['A2', 8, 1, 1], ['A2', 10, 1, 0.85]]
        : [['A2', 0, 1, 1], ['A2', 6, 1, 0.85], ['A2', 8, 1, 1]];
    const trackNotes: Record<string, Note[]> = {
        [ID.choir]: notes(...chordNotes),
        [ID.bass]: notes(...bass),
        [ID.pluck]: notes(...pluck),
        [ID.kick]: notes(...kicks),
        [ID.snare]: notes(...snare),
        [ID.clap]: notes(...snare.map(([pitch, start, len, vel]) => [pitch, start, len, (vel || 1) * 0.8] as NoteSpec)),
        [ID.hat]: notes(...hats),
        [ID.openHat]: notes(['A5', 14, 2, 0.8])
    };
    if (strings) {
        trackNotes[ID.strings] = notes(...chord(CHORDS[chordName].map(pitch => {
            const octave = Number(pitch.at(-1));
            return `${pitch.slice(0, -1)}${octave + 1}`;
        }), 0, 16, 0.8));
    }
    if (lead.length) {
        trackNotes[ID.lead] = notes(...lead);
    }
    return pattern(id, name, trackNotes, 16);
};

export function buildPromoDemo(): Project {
    const instruments = [
        instrument(ID.air, 'FX/Air', color.air, {tone: 0, noise: 1, noiseFreq: 2200, att: 2.6, dec: 0.5, sus: 1, rel: 2, gain: 0.1}),
        instrument(ID.sub, 'Bass/Sub', color.sub, {q: 14, harm: 2, falloff: 0.5, att: 1.2, dec: 0.3, sus: 1, rel: 0.6, gain: 0.45}),
        instrument(ID.boom, 'Percussion/Boom', color.boom, {q: 8, harm: 1, pitchDrop: 26, pitchTime: 0.09, noise: 0.12, noiseFreq: 3200, att: 0.002, dec: 0.55, sus: 0, rel: 0.5, gain: 0.72}),
        instrument(ID.kick, 'Drums/Kick', color.kick, {q: 8, harm: 1, pitchDrop: 26, pitchTime: 0.07, noise: 0.12, noiseFreq: 4000, att: 0.002, dec: 0.16, sus: 0, rel: 0.12, gain: 0.72}),
        instrument(ID.snare, 'Drums/Snare', color.snare, {tone: 0.5, q: 6, harm: 2, falloff: 0.5, pitchDrop: 7, pitchTime: 0.05, noise: 0.9, noiseFreq: 4500, att: 0.002, dec: 0.16, sus: 0, rel: 0.14, gain: 0.42}),
        instrument(ID.clap, 'Drums/Clap', color.clap, {tone: 0.15, q: 5, harm: 1, noise: 1, noiseFreq: 1800, att: 0.004, dec: 0.12, sus: 0, rel: 0.15, gain: 0.27}),
        instrument(ID.hat, 'Drums/Hi-Hat', color.hat, {tone: 0, noise: 1, noiseFreq: 9500, att: 0.002, dec: 0.05, sus: 0, rel: 0.05, gain: 0.14}),
        instrument(ID.openHat, 'Drums/Open Hat', color.openHat, {tone: 0, noise: 1, noiseFreq: 8500, att: 0.002, dec: 0.3, sus: 0, rel: 0.3, gain: 0.11}),
        // q 10: at 60..90 Hz a 40 dB band rings up in q·10/(π·f) s, and these
        // are 16th-note pulses (see timbre-analysis.ts)
        instrument(ID.bass, 'Bass/Pulse', color.bass, {q: 10, harm: 3, falloff: 0.6, att: 0.005, dec: 0.25, sus: 0.6, rel: 0.15, gain: 0.6}),
        instrument(ID.choir, 'Vocals/Choir (oo)', color.choir, {tone: 0.82, q: 36, harm: 6, falloff: 0.6, formant: 0.85, f1: 350, f2: 800, f3: 2600, formantQ: 2.8, vib: 12, vibRate: 4.6, vibDelay: 0.6, voices: 4, detune: 18, att: 0.45, dec: 0.6, sus: 0.9, rel: 1.1, gain: 0.2}),
        instrument(ID.strings, 'Orchestra/Strings', color.strings, {q: 35, harm: 8, falloff: 0.75, voices: 5, detune: 26, att: 0.25, dec: 0.8, sus: 0.9, rel: 1.2, gain: 0.16}),
        instrument(ID.pluck, 'Synth/Pluck', color.pluck, {q: 60, harm: 5, falloff: 0.55, att: 0.003, dec: 0.28, sus: 0.12, rel: 0.35, gain: 0.88}),
        instrument(ID.lead, 'Synth/Lead (saw)', color.lead, {q: 45, harm: 6, falloff: 0.4, voices: 3, detune: 14, att: 0.02, dec: 0.3, sus: 0.7, rel: 0.3, gain: 0.84}),
        instrument(ID.soprano, 'Vocals/Soprano (ah)', color.soprano, {tone: 0.95, q: 42, harm: 8, falloff: 0.7, formant: 0.9, f1: 800, f2: 1150, f3: 2900, formantQ: 3.2, vib: 34, vibRate: 5.6, vibDelay: 0.4, noise: 0.03, noiseFreq: 3800, voices: 2, detune: 9, att: 0.09, dec: 0.3, sus: 0.85, rel: 0.45, gain: 0.42}),
        instrument(ID.bell, 'Percussion/Bell', color.bell, {q: 80, harm: 8, falloff: 0.75, stretch: 0.12, att: 0.002, dec: 1.4, sus: 0, rel: 1.6, gain: 0.34}),
        instrument(ID.impact, 'FX/Impact', color.impact, {q: 6, harm: 1, pitchDrop: 30, pitchTime: 0.28, noise: 0.5, noiseFreq: 1500, noiseBend: 1, att: 0.001, dec: 1.1, sus: 0, rel: 1.6, gain: 0.9}),
        instrument(ID.riser, 'FX/Riser', color.riser, {q: 30, harm: 1, noise: 0.35, noiseFreq: 3500, pitchDrop: -24, pitchTime: 4.6, noiseBend: 1, att: 0.6, dec: 0.3, sus: 1, rel: 0.4, gain: 0.2})
    ];

    const sourcePatterns = [
        pattern('1c02ba01-71ab-435d-9337-1450f2571001', '01 Intro/noise swell', {
            [ID.air]: notes(['A4', 0, 30, 0.9]), [ID.sub]: notes(['D2', 4, 28, 0.9])
        }),
        pattern('1c02ba01-71ab-435d-9337-1450f2571002', '02 Arrival/spectrum carve', {
            [ID.choir]: notes(...chord(CHORDS.dm, 0, 32, 0.9)),
            [ID.boom]: notes(['G2', 0, 2, 1], ['G2', 16, 2, 0.9], ['G2', 26, 2, 0.7], ['G2', 29, 2, 0.8])
        }),
        pattern('1c02ba01-71ab-435d-9337-1450f2571003', '03 Title/pinky hit', {
            [ID.impact]: notes(['G2', 0, 4, 1]), [ID.boom]: notes(['D2', 0, 3, 1]),
            [ID.bell]: notes(['D4', 0, 6, 0.8], ['A4', 0, 6, 0.5]), [ID.choir]: notes(...chord(CHORDS.dm, 0, 32, 1)),
            [ID.sub]: notes(['D2', 0, 32, 1]), [ID.riser]: notes(['D3', 2, 30, 0.9]),
            [ID.hat]: notes(...repeated(['A5'], [16, 18, 20, 22, 24, 26, 28, 30], 1, step => step % 4 === 0 ? 0.85 : 0.55)),
            [ID.kick]: notes(['A2', 24, 1, 0.7], ['A2', 30, 1, 0.8])
        }),
        groove('1c02ba01-71ab-435d-9337-1450f2571004', '04 Groove/d minor pulse', 'dm', 'D3'),
        groove('1c02ba01-71ab-435d-9337-1450f2571005', '05 Groove/d minor turn', 'dm', 'D3', true),
        groove('1c02ba01-71ab-435d-9337-1450f2571006', '06 Groove/b flat pulse', 'bb', 'A#2'),
        groove('1c02ba01-71ab-435d-9337-1450f2571007', '07 Groove/b flat turn', 'bb', 'A#2', true),
        groove('1c02ba01-71ab-435d-9337-1450f2571008', '08 Groove/f major signal', 'f', 'F3', false, [
            ['D5', 0, 3, 0.9], ['F5', 4, 2, 0.9], ['E5', 6, 2, 0.9], ['D5', 8, 6, 0.9]
        ], true),
        groove('1c02ba01-71ab-435d-9337-1450f2571009', '09 Groove/f major turn', 'f', 'F3', true, [
            ['C5', 0, 4, 0.9], ['A4', 4, 3, 0.9], ['D5', 8, 8, 0.9]
        ], true),
        groove('1c02ba01-71ab-435d-9337-1450f2571010', '10 Groove/c major answer', 'c', 'C3', false, [
            ['F5', 0, 3, 0.9], ['G5', 4, 2, 0.9], ['A5', 6, 2, 0.9], ['G5', 8, 6, 0.9]
        ], true),
        groove('1c02ba01-71ab-435d-9337-1450f2571011', '11 Groove/c major turn', 'c', 'C3', true, [
            ['F5', 0, 4, 0.9], ['E5', 4, 3, 0.9], ['D5', 8, 8, 0.9]
        ], true),
        pattern('1c02ba01-71ab-435d-9337-1450f2571012', '12 Break/floor drops', {
            [ID.boom]: notes(['G2', 0, 2, 1]), [ID.choir]: notes(...chord(CHORDS.dm, 0, 32, 1)),
            [ID.sub]: notes(['D2', 0, 32, 1]), [ID.riser]: notes(['D3', 2, 30, 1]),
            [ID.lead]: notes(['D5', 0, 8, 0.8], ['A4', 8, 8, 0.7]),
            [ID.hat]: notes(...repeated(['A5'], [0, 2, 4, 6, 8, 10, 12, 14], 1, () => 0.5)),
            [ID.snare]: notes(...[0, 2, 4, 6, 8, 9, 10, 11, 12, 13, 14, 15].map((start, index) => ['D4', 16 + start, 1, 0.55 + index * 0.04] as NoteSpec))
        }),
        pattern('1c02ba01-71ab-435d-9337-1450f2571013', '13 Climax/d minor lift', {
            [ID.choir]: notes(...chord(CHORDS.dm, 0, 16, 1)), [ID.strings]: notes(...chord(['D4', 'F4', 'A4', 'D5'], 0, 16, 1)),
            [ID.bass]: notes(...repeated(['D3'], [0, 2, 4, 6, 8, 10, 12, 14], 1.5, step => step % 4 === 0 ? 1 : 0.8)),
            [ID.pluck]: notes(...ARPS.dm.flatMap((pitch, index) => [[pitch, index * 2, 1.5, 0.9] as NoteSpec, [pitch, index * 2 + 1, 1, 0.5] as NoteSpec])),
            [ID.kick]: notes(...[0, 4, 8, 12, 14].map(step => ['A2', step, 1, step === 14 ? 0.8 : 1] as NoteSpec)),
            [ID.snare]: notes(['D4', 4, 1, 1], ['D4', 12, 1, 1]), [ID.clap]: notes(['D3', 4, 1, 0.8], ['D3', 12, 1, 0.8]),
            [ID.hat]: notes(...repeated(['A5'], Array.from({length: 16}, (_, index) => index), 1, step => 0.45 + (step % 4 === 0 ? 0.4 : step % 2 === 0 ? 0.15 : 0))),
            [ID.openHat]: notes(['A5', 14, 2, 0.9]), [ID.soprano]: notes(['A4', 0, 4, 1], ['D5', 4, 4, 1], ['F5', 8, 8, 1])
        }),
        pattern('1c02ba01-71ab-435d-9337-1450f2571014', '14 Climax/b flat rise', {
            [ID.choir]: notes(...chord(CHORDS.bb, 0, 16, 1)), [ID.strings]: notes(...chord(['A#3', 'D4', 'F4', 'A#4'], 0, 16, 1)),
            [ID.bass]: notes(...repeated(['A#2'], [0, 2, 4, 6, 8, 10, 12, 14], 1.5, step => step % 4 === 0 ? 1 : 0.8)),
            [ID.pluck]: notes(...ARPS.bb.flatMap((pitch, index) => [[pitch, index * 2, 1.5, 0.9] as NoteSpec, [pitch, index * 2 + 1, 1, 0.5] as NoteSpec])),
            [ID.kick]: notes(...[0, 4, 8, 12, 14].map(step => ['A2', step, 1, step === 14 ? 0.8 : 1] as NoteSpec)),
            [ID.snare]: notes(['D4', 4, 1, 1], ['D4', 12, 1, 1]), [ID.clap]: notes(['D3', 4, 1, 0.8], ['D3', 12, 1, 0.8]),
            [ID.hat]: notes(...repeated(['A5'], Array.from({length: 16}, (_, index) => index), 1, step => 0.45 + (step % 4 === 0 ? 0.4 : step % 2 === 0 ? 0.15 : 0))),
            [ID.openHat]: notes(['A5', 14, 2, 0.9]), [ID.soprano]: notes(['E5', 0, 4, 1], ['D5', 4, 4, 1], ['C5', 8, 4, 1], ['D5', 12, 4, 1])
        }),
        pattern('1c02ba01-71ab-435d-9337-1450f2571015', '15 Climax/f major release', {
            [ID.choir]: notes(...chord(CHORDS.f, 0, 16, 1)), [ID.strings]: notes(...chord(['C4', 'F4', 'A4', 'C5'], 0, 16, 1)),
            [ID.bass]: notes(...repeated(['F3'], [0, 2, 4, 6, 8, 10, 12, 14], 1.5, step => step % 4 === 0 ? 1 : 0.8)),
            [ID.pluck]: notes(...ARPS.f.flatMap((pitch, index) => [[pitch, index * 2, 1.5, 0.9] as NoteSpec, [pitch, index * 2 + 1, 1, 0.5] as NoteSpec])),
            [ID.kick]: notes(...[0, 4, 8, 12, 14].map(step => ['A2', step, 1, step === 14 ? 0.8 : 1] as NoteSpec)),
            [ID.snare]: notes(['D4', 4, 1, 1], ['D4', 12, 1, 1]), [ID.clap]: notes(['D3', 4, 1, 0.8], ['D3', 12, 1, 0.8]),
            [ID.hat]: notes(...repeated(['A5'], Array.from({length: 16}, (_, index) => index), 1, step => 0.45 + (step % 4 === 0 ? 0.4 : step % 2 === 0 ? 0.15 : 0))),
            [ID.openHat]: notes(['A5', 14, 2, 0.9]), [ID.soprano]: notes(['F5', 0, 6, 1], ['E5', 6, 2, 1], ['D5', 8, 8, 1])
        }),
        pattern('1c02ba01-71ab-435d-9337-1450f2571016', '16 Outro/final hit', {
            [ID.impact]: notes(['G2', 0, 4, 1]), [ID.boom]: notes(['D2', 0, 3, 1]), [ID.bell]: notes(['D4', 0, 6, 0.8], ['A4', 0, 6, 0.5]),
            [ID.choir]: notes(...chord(CHORDS.dm, 0, 24, 1)), [ID.strings]: notes(...chord(['D4', 'F4', 'A4', 'D5'], 0, 20, 0.9)),
            [ID.sub]: notes(['D2', 0, 20, 1]), [ID.soprano]: notes(['D5', 0, 16, 1])
        })
    ];
    const lanes: {name: string; label: string; color: string; instruments: string[]}[] = [
        {name: '01 FX & Impacts', label: 'FX & Impacts', color: '#7ed6df', instruments: [ID.air, ID.boom, ID.bell, ID.impact, ID.riser]},
        {name: '02 Drums', label: 'Drums', color: '#ff9f43', instruments: [ID.kick, ID.snare, ID.clap, ID.hat, ID.openHat]},
        {name: '03 Low End', label: 'Low End', color: '#10ac84', instruments: [ID.sub, ID.bass]},
        {name: '04 Harmony', label: 'Harmony', color: '#a29bfe', instruments: [ID.choir, ID.strings]},
        {name: '05 Arpeggio', label: 'Arpeggio', color: '#badc58', instruments: [ID.pluck]},
        {name: '06 Lead', label: 'Lead', color: '#e056fd', instruments: [ID.lead]},
        {name: '07 Soprano', label: 'Soprano', color: '#f06f73', instruments: [ID.soprano]}
    ];
    const starts = [0, 32, 64, 96, 112, 128, 144, 160, 176, 192, 208, 224, 256, 272, 288, 304];
    const lengths = [32, 32, 32, 16, 16, 16, 16, 16, 16, 16, 16, 32, 16, 16, 16, 32];
    const patterns: Pattern[] = [];
    const arrangement = sourcePatterns.flatMap((source, sectionIndex) => lanes.flatMap((lane, track) => {
        const groupedNotes = Object.fromEntries(Object.entries(source.tracks)
            .filter(([instrumentId]) => lane.instruments.includes(instrumentId)));
        if (!Object.keys(groupedNotes).length) {return [];}
        const groupedPattern = pattern(
            `1c02ba01-71ab-435d-9337-1450f257${(4001 + patterns.length).toString().padStart(4, '0')}`,
            `${source.name} — ${lane.label}`,
            groupedNotes,
            source.steps
        );
        patterns.push(groupedPattern);
        return [{
            id: `4c02ba01-71ab-435d-9337-1450f257${(5001 + patterns.length).toString().padStart(4, '0')}`,
            patternId: groupedPattern.id,
            track,
            start: starts[sectionIndex],
            len: lengths[sectionIndex]
        }];
    }));

    return {
        formatVersion: 1,
        instruments,
        patterns,
        arrangement,
        tracks: lanes.map(({name, color}) => ({name, color})),
        bpm: 100,
        loop: {start: 0, end: 336},
        automation: [
            {id: '5c02ba01-71ab-435d-9337-1450f2573001', target: 'master', param: 'vol', points: [
                {step: 0, value: 0.28, curve: 'hold'}, {step: 32, value: 0.5, curve: 'ease-in'},
                {step: 63, value: 0.71, curve: 'hold'}, {step: 64, value: 1},
                {step: 224, value: 1, curve: 'ease-out'}, {step: 226, value: 0.71, curve: 'hold'},
                {step: 255, value: 0.71, curve: 'hold'}, {step: 256, value: 1}
            ]}
        ],
        automationOrder: ['5c02ba01-71ab-435d-9337-1450f2573001'],
        automationPositions: {},
        zoom: {seq: {width: 24, height: 14}, arr: {width: 24, height: 32}}
    };
}
