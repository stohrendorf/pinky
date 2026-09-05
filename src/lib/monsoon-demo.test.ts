import {
    describe, expect, it
} from 'vitest';

import {
    noteByName
} from './notes';
import {
    buildDemoProject
} from './project';
import {
    isPitched, measureNote
} from './timbre-analysis';

const demo = buildDemoProject('monsoon');
const instrument = (name: string) => demo.instruments.find(candidate => candidate.name === name)!;
const part = (name: string, patternName?: string) => {
    const {id} = instrument(name);
    return demo.patterns.filter(pattern => !patternName || pattern.name === patternName).flatMap(pattern => pattern.tracks[id] || []);
};
const lane = (targetName: string, param: string) => {
    const target = targetName === 'master' ? 'master' : instrument(targetName).id;
    return demo.automation!.find(candidate => candidate.target === target && candidate.param === param)!;
};
const songEnd = Math.max(...demo.arrangement.map(clip => clip.start + clip.len));
const patternOf = (clip: {patternId: string}) => demo.patterns.find(pattern => pattern.id === clip.patternId)!;
const clipsOf = (patternName: string) => demo.arrangement.filter(clip => patternOf(clip).name === patternName);

describe('Bronze Monsoon demo', () => {
    it('is a full-length project whose clips, tracks and lanes all resolve', () => {
        expect(songEnd * 60 / demo.bpm / 4).toBeGreaterThanOrEqual(170);
        expect(demo.instruments.length).toBe(19);
        expect(demo.patterns.length).toBeGreaterThanOrEqual(38);
        expect(demo.arrangement.every(clip => demo.patterns.some(pattern => pattern.id === clip.patternId))).toBe(true);
        expect(demo.arrangement.every(clip => clip.track >= 0 && clip.track < demo.tracks.length)).toBe(true);
        expect(demo.automation!.every(candidate => candidate.target === 'master' || demo.instruments.some(({id}) => id === candidate.target))).toBe(true);
        expect(demo.automationOrder).toEqual(demo.automation!.map(candidate => candidate.id));
        expect(new Set([...demo.instruments, ...demo.patterns, ...demo.arrangement, ...demo.automation!].map(({id}) => id)).size)
            .toBe(demo.instruments.length + demo.patterns.length + demo.arrangement.length + demo.automation!.length);
    });

    it('never stacks two clips on one arranger lane', () => {
        for (const clip of demo.arrangement) {
            const overlapping = demo.arrangement.filter(other => other !== clip && other.track === clip.track
                && other.start < clip.start + clip.len && clip.start < other.start + other.len);
            expect(overlapping, `${clip.patternId} on track ${clip.track} at ${clip.start}`).toEqual([]);
        }
    });

    it('uses a palette the other demos do not have', () => {
        const families = demo.instruments.map(({name}) => name);
        expect(families).toEqual(expect.arrayContaining([
            'Drums/Taiko/Odaiko', 'Drums/Kendang', 'Percussion/Tuned/Gong Ageng', 'Percussion/Tuned/Gendér Polos',
            'Percussion/Tuned/Handpan', 'Winds/Shakuhachi', 'Winds/Duduk', 'Vocals/Khoomei Drone', 'Strings/Kora',
            'Percussion/Tuned/Jublag', 'Percussion/Tuned/Singing Bowl', 'FX/Monsoon Wind', 'FX/Storm Riser'
        ]));
        for (const song of ['axelf', 'toccata', 'noise', 'diva', 'pocket', 'chip', 'promo'] as const) {
            const other = buildDemoProject(song).instruments.map(({name}) => name);
            expect(families.filter(name => other.includes(name))).toEqual([]);
        }
    });

    it('interlocks the gendér kotekan into one continuous sixteenth line', () => {
        const polos = part('Percussion/Tuned/Gendér Polos', '02 Bronze/kotekan one');
        const sangsih = part('Percussion/Tuned/Gendér Sangsih', '02 Bronze/kotekan one');
        const steps = new Set([...polos, ...sangsih].map(note => note.start));

        expect(polos.every(note => note.start % 2 === 0)).toBe(true);
        expect(sangsih.filter(note => note.start % 2 === 1).length).toBeGreaterThanOrEqual(14);
        expect(steps.size).toBe(31);
        expect(instrument('Percussion/Tuned/Gendér Polos').params.pan).toBeLessThan(-0.4);
        expect(instrument('Percussion/Tuned/Gendér Sangsih').params.pan).toBeGreaterThan(0.4);
        // bar modes, not a harmonic series
        expect(instrument('Percussion/Tuned/Gendér Polos').params.partials!.map(partial => partial.ratio)).toEqual([1, 2.76, 5.4]);
    });

    it('sings the khoomei overtone melody as F2 automation over one held drone', () => {
        const drone = instrument('Vocals/Khoomei Drone');
        const overtones = lane('Vocals/Khoomei Drone', 'f2');
        const jaw = lane('Vocals/Khoomei Drone', 'f1');
        const roots = {D3: noteByName['D3'].freq, G3: noteByName['G3'].freq};
        // the drone is written on D and only ever moved to G by the transposed Seven Rains clips
        const transposed = clipsOf('03 Seven Rains/khoomei seven').filter(clip => clip.transpose === 5);
        const harmonicOf = (hz: number, root: number) => {
            const harmonic = hz / root;
            return Math.abs(harmonic - Math.round(harmonic)) < 0.01 ? Math.round(harmonic) : null;
        };
        const rootAt = (step: number) => transposed.some(clip => step >= clip.start && step < clip.start + clip.len) ? roots.G3 : roots.D3;

        expect(part('Vocals/Khoomei Drone').every(note => note.pitch === 'D3' && note.len >= 28)).toBe(true);
        expect(transposed.length).toBe(3);
        expect(drone.params.formantQ).toBe(16);
        expect(drone.params.partials!.length).toBe(12);
        expect(overtones.points.length).toBeGreaterThanOrEqual(60);
        // every step of the melody sits on a harmonic (6th .. 12th) of whatever the drone is singing there,
        // and the jaw (F1) sits on one of its low harmonics (2nd .. 5th) at the same moment
        for (const point of overtones.points) {
            const harmonic = harmonicOf(point.value, rootAt(point.step));
            expect(harmonic, `F2 ${point.value} Hz at ${point.step}`).not.toBeNull();
            expect(harmonic!).toBeGreaterThanOrEqual(6);
            expect(harmonic!).toBeLessThanOrEqual(12);
        }
        for (const point of jaw.points) {
            const harmonic = harmonicOf(point.value, rootAt(point.step));
            expect(harmonic, `F1 ${point.value} Hz at ${point.step}`).not.toBeNull();
            expect(harmonic!).toBeGreaterThanOrEqual(2);
            expect(harmonic!).toBeLessThanOrEqual(5);
        }
        expect(jaw.points.map(point => point.step)).toEqual(overtones.points.map(point => point.step));
        expect(overtones.points.slice(0, -1).every(point => point.curve === 'hold')).toBe(true);
        expect(new Set(overtones.points.map(point => point.value)).size).toBeGreaterThanOrEqual(8);
        expect(overtones.points.filter(point => rootAt(point.step) === roots.G3).length).toBeGreaterThanOrEqual(10);
    });

    it('lays the pokok under every kotekan on the jublag', () => {
        const stream = [...part('Percussion/Tuned/Gendér Polos', '02 Bronze/kotekan one'), ...part('Percussion/Tuned/Gendér Sangsih', '02 Bronze/kotekan one')];
        const pokok = part('Percussion/Tuned/Jublag', '02 Bronze/pokok one');

        expect(pokok.map(note => note.start)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
        expect(pokok.every(note => note.len === 4)).toBe(true);
        // each pokok note is the stressed kotekan note of its beat, an octave down
        for (const note of pokok) {
            const beat = stream.find(candidate => candidate.start === note.start)!;
            expect(noteByName[beat.pitch].freq / noteByName[note.pitch].freq).toBeCloseTo(2, 5);
        }
        expect(part('Percussion/Tuned/Jublag', '03 Seven Rains/pokok seven').every(note => note.len === 7)).toBe(true);
        expect(part('Percussion/Tuned/Jublag', '04 Storm/pokok storm').map(note => note.pitch)).toEqual(['D5', 'C5', 'D5', 'A5']);
        // the kotekan is doubled an octave down instead, when the storm is at its densest
        const doubled = clipsOf('04 Storm/storm kotekan').filter(clip => clip.transpose === -12);
        expect(doubled.length).toBe(3);
        expect(new Set(doubled.map(clip => clip.track)).size).toBe(1);
        expect(doubled.every(clip => clipsOf('04 Storm/storm kotekan').some(other => other.start === clip.start && !other.transpose))).toBe(true);
        expect(clipsOf('04 Storm/pokok storm').some(clip => doubled.some(other => other.start === clip.start))).toBe(false);
    });

    it('runs 24- and 12-step patterns as polymeter inside longer clips', () => {
        const bowl = demo.patterns.find(pattern => pattern.name === '01 Rain/bowl drift')!;
        const hemiola = demo.patterns.find(pattern => pattern.name === '04 Storm/taiko in three')!;
        const bowlClips = clipsOf('01 Rain/bowl drift');
        const hemiolaClips = clipsOf('04 Storm/taiko in three');

        expect(bowl.steps).toBe(24);
        expect(hemiola.steps).toBe(12);
        expect(bowlClips.length).toBe(2);
        expect(hemiolaClips.length).toBe(1);
        // both clips are whole multiples of their pattern and of the 32-step grid: they drift and land again
        for (const clip of [...bowlClips, ...hemiolaClips]) {
            const pattern = patternOf(clip);
            expect(clip.len % pattern.steps).toBe(0);
            expect(clip.len % 32).toBe(0);
            expect(clip.len).toBeGreaterThan(pattern.steps);
        }
        // the taiko's dotted pulse (every 6 steps) against the kotekan's 4/4, in the same sections
        expect(part('Drums/Taiko/Odaiko', '04 Storm/taiko in three').map(note => note.start)).toEqual([0, 6]);
        const [three] = hemiolaClips;
        expect(clipsOf('04 Storm/storm kotekan').filter(clip => clip.start >= three.start && clip.start < three.start + three.len).length).toBeGreaterThanOrEqual(3);
    });

    it('bows the singing bowl and slides the sub through the storm ground as portamento chains', () => {
        const bowl = part('Percussion/Tuned/Singing Bowl', '01 Rain/bowl drift');
        const ground = part('Bass/Bronze Sub', '04 Storm/storm ground');

        expect(bowl.map(note => note.pitch)).toEqual(['D6', 'A5', 'G5']);
        expect(bowl[0].legatoTo).toEqual({pitch: 'A5', start: 10, curve: 'smooth'});
        expect(bowl[1].legatoTo).toEqual({pitch: 'G5', start: 18, curve: 'ease-out'});
        expect(instrument('Percussion/Tuned/Singing Bowl').params.att).toBeGreaterThanOrEqual(1);
        expect(instrument('Percussion/Tuned/Singing Bowl').params.voices).toBeGreaterThanOrEqual(3);
        expect(ground.map(note => note.pitch)).toEqual(['A#2', 'C3', 'D3']);
        expect(ground[0].legatoTo).toEqual({pitch: 'C3', start: 8, curve: 'ease-in'});
        expect(ground[1].legatoTo).toEqual({pitch: 'D3', start: 16, curve: 'ease-in'});
    });

    it('drives timbre with lanes that a mixer has no knob for', () => {
        const values = (targetName: string, param: string) => lane(targetName, param).points.map(point => point.value);
        const stormStart = clipsOf('04 Storm/storm taiko')[0].start;
        const holdClip = clipsOf('04 Storm/duduk hold')[0];

        // the gendér is damped in the fast sections and rings out at the end
        expect(Math.min(...values('Percussion/Tuned/Gendér Polos', 'dec'))).toBeLessThan(0.5);
        expect(values('Percussion/Tuned/Gendér Polos', 'dec').at(-1)).toBeGreaterThan(1.2);
        expect(lane('Percussion/Tuned/Gendér Sangsih', 'dec').points).toEqual(lane('Percussion/Tuned/Gendér Polos', 'dec').points);
        // the two players trade sides: mirrored pan lanes
        const polosPan = lane('Percussion/Tuned/Gendér Polos', 'pan').points;
        const sangsihPan = lane('Percussion/Tuned/Gendér Sangsih', 'pan').points;
        expect(sangsihPan.map(point => point.value)).toEqual(polosPan.map(point => -point.value));
        expect(Math.max(...polosPan.map(point => point.value))).toBeGreaterThan(0.4);
        // the gong's ombak quickens into the storm and calms afterwards
        const ombak = lane('Percussion/Tuned/Gong Ageng', 'detune').points;
        expect(Math.max(...ombak.filter(point => point.step >= stormStart).map(point => point.value))).toBeGreaterThan(40);
        expect(ombak.at(-1)!.value).toBeLessThan(30);
        // the wind is *drawn*: its band sweeps up more than two octaves and crosses the whole field
        expect(Math.max(...values('FX/Monsoon Wind', 'noiseFreq')) / Math.min(...values('FX/Monsoon Wind', 'noiseFreq'))).toBeGreaterThan(4);
        expect(Math.min(...values('FX/Monsoon Wind', 'pan'))).toBeLessThan(-0.7);
        expect(Math.max(...values('FX/Monsoon Wind', 'pan'))).toBeGreaterThan(0.7);
        // the duduk's vowel closes over its final held note, while the note is sounding
        const vowel = lane('Winds/Duduk', 'f2').points;
        expect(vowel.at(-1)!.step).toBe(holdClip.start + 24);
        expect(vowel.at(-1)!.value).toBeLessThan(vowel[0].value - 300);
        expect(vowel.at(-2)!.curve).toBe('smooth');
        // breath and vibrato rise with the storm
        expect(Math.max(...values('Winds/Shakuhachi', 'noise'))).toBeGreaterThan(instrument('Winds/Shakuhachi').params.noise);
        expect(Math.max(...values('Vocals/Khoomei Drone', 'vib'))).toBeGreaterThan(instrument('Vocals/Khoomei Drone').params.vib);
        // the riser is not a pitched part and only ever plays under the eye of the storm
        expect(isPitched(instrument('FX/Storm Riser').params)).toBe(false);
        expect(clipsOf('04 Storm/eye squall').length).toBe(1);
        expect(part('FX/Storm Riser').every(note => note.len === 32)).toBe(true);
    });

    it('puts the middle section in 7/8 and lifts it a fourth', () => {
        const seven = demo.patterns.filter(pattern => pattern.name.startsWith('03 Seven Rains/'));
        const sevenClips = demo.arrangement.filter(clip => seven.some(pattern => pattern.id === clip.patternId));

        expect(seven.length).toBeGreaterThanOrEqual(7);
        expect(seven.every(pattern => pattern.steps === 28)).toBe(true);
        expect(sevenClips.every(clip => clip.len === 28)).toBe(true);
        expect(sevenClips.filter(clip => clip.transpose === 5).length).toBeGreaterThanOrEqual(12);
        expect(part('Drums/Taiko/Odaiko', '03 Seven Rains/taiko seven').map(note => note.start)).toEqual([0, 6, 10, 14, 20, 24]);
    });

    it('opens the pentatonic In scale into D minor for the storm', () => {
        const pitchClasses = (names: string[]) => new Set(names.map(pitch => pitch.replace(/\d+$/, '')));
        const bronze = pitchClasses([
            ...part('Percussion/Tuned/Gendér Polos', '02 Bronze/kotekan one'), ...part('Percussion/Tuned/Gendér Sangsih', '02 Bronze/kotekan one')
        ].map(note => note.pitch));
        const storm = pitchClasses(part('Strings/Kora', '04 Storm/storm kora').map(note => note.pitch));
        const ground = part('Bass/Bronze Sub', '04 Storm/storm ground').map(note => note.pitch);

        expect([...bronze].sort()).toEqual(['A', 'A#', 'D', 'D#', 'G']);
        expect(storm.has('F')).toBe(true);
        expect(storm.has('D#')).toBe(false);
        expect(ground).toEqual(['A#2', 'C3', 'D3']);
    });

    it('slides the shakuhachi and duduk with shaped portamento only', () => {
        const links = demo.patterns.flatMap(pattern => Object.values(pattern.tracks).flat()).flatMap(note => note.legatoTo ? [note] : []);

        expect(links.length).toBeGreaterThanOrEqual(12);
        expect(links.every(note => note.legatoTo!.curve !== 'linear' && note.legatoTo!.start >= note.start + note.len)).toBe(true);
        expect(instrument('Winds/Shakuhachi').params.pitchDrop).toBeLessThan(0); // scoops *up* into the note
        expect(instrument('Winds/Duduk').params.formant).toBeGreaterThan(0.5);
    });

    it('measures every pitched part as a clear pitch at a mix level that can be heard', () => {
        for (const {name, params, id} of demo.instruments) {
            if (!isPitched(params)) {continue;}
            const notes = demo.patterns.flatMap(pattern => pattern.tracks[id] || []);
            const byPitch = [...notes].sort((a, b) => noteByName[a.pitch].freq - noteByName[b.pitch].freq);
            const shortest = Math.min(...notes.map(note => note.len));
            const lowest = measureNote(params, byPitch[0].pitch, shortest, demo.bpm);

            expect(lowest.clarity, `${name} @${byPitch[0].pitch} × ${shortest}`).toBeGreaterThanOrEqual(0.6);
            expect(lowest.peakDb, name).toBeGreaterThanOrEqual(-30);
        }
    });

    it('shapes the whole arc with master and instrument automation', () => {
        const curves = new Set(demo.automation!.flatMap(candidate => candidate.points.map(point => point.curve).filter(Boolean)));

        expect(demo.automation!.length).toBeGreaterThanOrEqual(20);
        expect(new Set(demo.automation!.map(candidate => candidate.param))).toEqual(new Set([
            'vol', 'rev', 'tilt', 'gain', 'pan', 'f1', 'f2', 'vib', 'noise', 'noiseFreq', 'detune', 'dec', 'rel'
        ]));
        expect(lane('master', 'vol').points.length).toBeGreaterThanOrEqual(6);
        expect(lane('master', 'rev').points.length).toBeGreaterThanOrEqual(6);
        expect(lane('master', 'tilt').points.every(point => point.value >= -4 && point.value <= 2)).toBe(true);
        expect(Math.max(...lane('FX/Monsoon Rain', 'gain').points.map(point => point.value))).toBeLessThanOrEqual(0.05);
        expect(curves).toEqual(new Set(['hold', 'linear', 'ease-in', 'ease-out', 'smooth']));
        expect(demo.automation!.every(candidate => candidate.points.every(point => point.step >= 0 && point.step <= songEnd))).toBe(true);
    });
});
