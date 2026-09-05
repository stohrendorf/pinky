import {
    describe, expect, it
} from 'vitest';

import type {
    DemoSong
} from './project';
import type {
    InstrumentParams, Project
} from './types';

import {
    noteByName
} from './notes';
import {
    buildDemoProject, DEMO_LIBRARY
} from './project';
import {
    analyzeNote, isPitched, measureNote, renderNote, ringTime
} from './timbre-analysis';

/* Every demo instrument that is meant to carry a pitch has to *sound* like
 * one when rendered the way the engine renders it: on the note it actually
 * plays most, for as long as it actually plays it. This is what "the bass
 * line is nice but it is so noisy" looks like as a number. */

// Share of the audible energy that has to sit on the partials. Axel F's leads
// and Toccata's organ — the demos that read as "clear instruments" — measure
// 0.75..0.95; below ~0.5 a note is mostly its noise band or its own chirp.
const MIN_CLARITY = 0.55;
// Loudest 50 ms of a note, dBFS. A harmony part 25 dB under the drums is not a
// mix decision any more, it is inaudible.
const MIN_PEAK_DB = -40;
// Below this the fundamental is felt rather than heard. A *held* sub (an organ
// 32' or a trailer drone) belongs there by design, and a 16' pedal gets away
// with it because its octave partial carries the pitch; a bass *line* of
// 16ths with nothing above the fundamental does not — at 30 Hz a resonant
// band needs seconds to become a pitch, so every short note is only its noise
// band. notes.ts puts middle C at C5: a bass written as "D2" is 37 Hz, not
// the 73 Hz the name suggests elsewhere.
const SUB_HZ = 40;
const DRONE_STEPS = 8;
const OCTAVE_CARRIER_LEVEL = 0.6;

interface Played {
    median: string;
    steps: number;
}

function playedNotes(project: Project, instrumentId: string): Played | null {
    const notes = project.patterns.flatMap(pattern => pattern.tracks[instrumentId] || []);
    if (!notes.length) {return null;}
    const byPitch = [...notes].sort((a, b) => noteByName[a.pitch].freq - noteByName[b.pitch].freq);
    const byLength = notes.map(note => note.len).sort((a, b) => a - b);
    return {median: byPitch[Math.floor(byPitch.length / 2)].pitch, steps: byLength[Math.floor(byLength.length / 2)]};
}

const pitchedParts = (song: DemoSong) => {
    const project = buildDemoProject(song);
    return project.instruments.flatMap(instrument => {
        const played = playedNotes(project, instrument.id);
        if (!played || !isPitched(instrument.params)) {return [];}
        return [{name: instrument.name, params: instrument.params, played, bpm: project.bpm}];
    });
};

const isSubDrone = ({median, steps}: Played) => noteByName[median].freq < SUB_HZ && steps >= DRONE_STEPS;
const carriesOctave = (params: InstrumentParams) =>
    (params.partials ?? []).some(partial => Math.abs(partial.ratio - 2) < 0.05 && partial.level >= OCTAVE_CARRIER_LEVEL);

describe('demo instrument tonality', () => {
    it.each(DEMO_LIBRARY.map(demo => demo.id))('renders every pitched part of %s as a pitch, not as noise', song => {
        const parts = pitchedParts(song);
        expect(parts.length).toBeGreaterThan(0);
        const subsonic = parts.filter(({params, played}) => noteByName[played.median].freq < SUB_HZ && !isSubDrone(played) && !carriesOctave(params))
            .map(({name, played}) => `${name} @${played.median}: ${noteByName[played.median].freq.toFixed(0)} Hz`);
        const report = parts.filter(({played}) => !isSubDrone(played))
            .map(({name, params, played, bpm}) => ({name, ...measureNote(params, played.median, played.steps, bpm)}));
        const noisy = report.filter(row => row.clarity < MIN_CLARITY).map(row => `${row.name} @${row.pitch}: ${row.clarity.toFixed(2)}`);
        const buried = report.filter(row => row.peakDb < MIN_PEAK_DB).map(row => `${row.name} @${row.pitch}: ${row.peakDb.toFixed(0)} dB`);

        expect(subsonic, 'bass lines written below the audible register').toEqual([]);
        expect(noisy, 'parts that render mostly as noise').toEqual([]);
        expect(buried, 'parts too quiet to be heard').toEqual([]);
    });
});

describe('timbre analysis model', () => {
    const pluck: InstrumentParams = {
        tone: 1, q: 40, harm: 3, falloff: 0.6, stretch: 0, noise: 0, noiseFreq: 6000,
        formant: 0, f1: 700, f2: 1150, f3: 2800, formantQ: 6, vib: 0, vibRate: 5.5, vibDelay: 0.35,
        pitchDrop: 0, pitchTime: 0.08, noiseBend: 0, voices: 1, detune: 12,
        att: 0.005, dec: 0.3, sus: 0.5, rel: 0.2, gain: 0.8, pan: 0, legatoCurve: 'linear',
        partials: [{ratio: 1, level: 1}, {ratio: 2, level: 0.6}, {ratio: 3, level: 0.36}]
    };

    it('explains why a sub-register bass never becomes a pitch', () => {
        // the residual behind a 40 dB band is a resonator with 10 × q: at 37 Hz
        // and q 34 it needs seconds to ring up, at 73 Hz and q 9 a fraction of one
        expect(ringTime(37, 34, 40)).toBeGreaterThan(2.5);
        expect(ringTime(73, 9, 40)).toBeLessThan(0.45);
    });

    it('hears a narrow-band note as a pitch and a wide noise burst as noise', () => {
        const note = analyzeNote(renderNote(pluck, 440, 0.5));
        const hiss = analyzeNote(renderNote({...pluck, tone: 0, noise: 1, noiseFreq: 4000, partials: [{ratio: 1, level: 1}]}, 440, 0.5));

        expect(note.clarity).toBeGreaterThan(0.8);
        expect(hiss.clarity).toBeLessThan(0.2);
    });

    it('scores a hissy sub-register bass below a clean mid-register one', () => {
        const subBass = {...pluck, q: 34, noise: 0.12, noiseFreq: 680, att: 0.002, dec: 0.075, sus: 0.38, rel: 0.06};
        const bass = {...pluck, q: 9, att: 0.003, dec: 0.2, sus: 0.5, rel: 0.12};

        expect(measureNote(subBass, 'D2', 2, 108).clarity).toBeLessThan(measureNote(bass, 'D3', 2, 108).clarity - 0.2);
    });

    it('does not judge drums, clicks and risers as pitched instruments', () => {
        expect(isPitched({...pluck, tone: 0, noise: 1})).toBe(false);
        expect(isPitched({...pluck, q: 5, noise: 0.15, pitchDrop: 21})).toBe(false);
        expect(isPitched({...pluck, pitchDrop: -24, pitchTime: 3})).toBe(false);
        expect(isPitched({...pluck, sus: 0, dec: 0.05})).toBe(false);
        expect(isPitched(pluck)).toBe(true);
    });
});
