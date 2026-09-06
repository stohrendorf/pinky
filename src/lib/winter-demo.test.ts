import {
    describe, expect, it
} from 'vitest';

import {
    isLegatoTarget
} from './legato';
import {
    idxOfNote, noteByName
} from './notes';
import {
    buildDemoProject
} from './project';
import {
    isPitched, measureNote
} from './timbre-analysis';
import {
    decodeWinterPart, performMovement, placeSections, WINTER_BPM, WINTER_ID, WINTER_MOVEMENTS
} from './winter-demo';
import {
    WINTER_SCORE
} from './winter-score';

const demo = buildDemoProject('winter');
const instrument = (name: string) => demo.instruments.find(candidate => candidate.name === name)!;
const notesOf = (id: string) => demo.arrangement.flatMap(clip => {
    const pattern = demo.patterns.find(candidate => candidate.id === clip.patternId)!;
    return (pattern.tracks[id] || []).map(note => ({...note, at: clip.start + note.start}));
});
const songEnd = Math.max(...demo.arrangement.map(clip => clip.start + clip.len));
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/* The Mutopia edition, as the analysis of its MIDI files reports it: notes per
 * part and movement, the bar counts and the pitch ranges of every part. */
const EDITION = [
    {bars: 63, notes: {solo: 1027, vn1: 649, vn2: 633, vla: 469, vc: 477}},
    {bars: 18, notes: {solo: 151, vn1: 273, vn2: 273, vla: 17, vc: 137}},
    {bars: 153, notes: {solo: 982, vn1: 532, vn2: 508, vla: 400, vc: 274}}
] as const;
// MIDI numbers: solo and violins from the open G string (G3) to G6/C6, violas G3..D5, bass C2..F4
const RANGE = {solo: [55, 91], vn1: [55, 84], vn2: [55, 84], vla: [48, 74], vc: [36, 65]} as const;

describe('Vivaldi Winter demo', () => {
    it('carries every note of the edition, movement by movement', () => {
        WINTER_SCORE.forEach((movement, index) => {
            const edition = EDITION[index];
            expect(movement.bars).toBe(edition.bars);
            for (const [part, expected] of Object.entries(edition.notes)) {
                const notes = decodeWinterPart(movement.parts[part as keyof typeof movement.parts]);
                expect(notes.length, `${movement.title} ${part}`).toBe(expected);
                // in playing order, every note inside the movement
                expect(notes.every((note, i) => !i || note.start >= notes[i - 1].start)).toBe(true);
                // ... and filling it: every part plays into the final bar (the Largo
                // once sat on a 16th grid under a 64th layout and fell silent after
                // a quarter of its length)
                const end = Math.max(...notes.map(note => note.start + note.len));
                expect(end, `${movement.title} ${part}`).toBeLessThanOrEqual(movement.bars * movement.stepsPerBar);
                expect(end, `${movement.title} ${part}`).toBeGreaterThan((movement.bars - 1) * movement.stepsPerBar);
                expect(notes.every(note => note.len >= 1)).toBe(true);
            }
        });
        // the Largo's grid is the 64th: its opening eighth (Eb, MIDI 75) is 8 steps, its quarter 16
        const largoSolo = decodeWinterPart(WINTER_SCORE[1].parts.solo);
        expect(largoSolo[0]).toEqual({start: 0, len: 8, midi: 75});
        expect(median(largoSolo.map(note => note.len))).toBe(4);
        // the whole concerto's compass per part
        for (const [part, [low, high]] of Object.entries(RANGE)) {
            const midi = WINTER_SCORE.flatMap(movement => decodeWinterPart(movement.parts[part as keyof typeof movement.parts])).map(note => note.midi);
            expect([Math.min(...midi), Math.max(...midi)], part).toEqual([low, high]);
        }
    });

    it('is the whole concerto: three movements in their own metres, with silences between them', () => {
        const sections = placeSections();
        const [first, second, third] = [0, 1, 2].map(movement => sections.filter(section => section.movement === movement));
        // I: 63 bars of 4/4 in 32nds; II: 18 bars of 4/4 in 64ths; III: 153 bars of 3/8 in 32nds with the Lento at half speed
        expect(first.reduce((sum, section) => sum + section.span, 0)).toBe(63 * 32);
        expect(second.reduce((sum, section) => sum + section.span, 0)).toBe(18 * 64);
        expect(second.reduce((sum, section) => sum + section.len, 0)).toBe(18 * 64);
        expect(third.reduce((sum, section) => sum + section.span, 0)).toBe(153 * 12);
        const lento = third.find(section => section.name.includes('Lento'))!;
        expect(lento.stretch).toBe(2);
        expect(lento.len).toBe(lento.span * 2);
        // the fermatas: the last bar of I and of III is held longer than written
        expect(first.at(-1)!).toMatchObject({name: 'D fermata', span: 32, len: 48});
        expect(third.at(-1)!).toMatchObject({name: 'N fermata', span: 12, len: 24});
        expect(first.reduce((sum, section) => sum + section.len, 0)).toBe(63 * 32 + 16);
        expect(second[0].start - (first.at(-1)!.start + first.at(-1)!.len)).toBe(24);
        expect(third[0].start - (second.at(-1)!.start + second.at(-1)!.len)).toBe(24);
        expect(songEnd).toBe(third.at(-1)!.start + third.at(-1)!.len);
        // sections cover their movements without gaps or overlaps
        for (const movement of [first, second, third]) {
            movement.slice(1).forEach((section, i) => expect(section.start).toBe(movement[i].start + movement[i].len));
            movement.slice(1).forEach((section, i) => expect(section.from).toBe(movement[i].from + movement[i].span));
        }
        const seconds = songEnd * 60 / WINTER_BPM / 4;
        expect(seconds).toBeGreaterThan(480);
        expect(seconds).toBeLessThan(540);
    });

    it('resolves every clip, track and lane, and never stacks clips on one lane', () => {
        expect(demo.instruments.length).toBe(11);
        expect(demo.tracks.length).toBe(7);
        expect(demo.arrangement.every(clip => demo.patterns.some(pattern => pattern.id === clip.patternId))).toBe(true);
        expect(demo.arrangement.every(clip => clip.track >= 0 && clip.track < demo.tracks.length)).toBe(true);
        expect(demo.automation!.every(candidate => candidate.target === 'master' || demo.instruments.some(({id}) => id === candidate.target))).toBe(true);
        expect(demo.automationOrder).toEqual(demo.automation!.map(candidate => candidate.id));
        expect(new Set([...demo.instruments, ...demo.patterns, ...demo.arrangement, ...demo.automation!].map(({id}) => id)).size)
            .toBe(demo.instruments.length + demo.patterns.length + demo.arrangement.length + demo.automation!.length);
        for (const clip of demo.arrangement) {
            const pattern = demo.patterns.find(candidate => candidate.id === clip.patternId)!;
            expect(pattern.steps).toBe(clip.len);
            const overlapping = demo.arrangement.filter(other => other !== clip && other.track === clip.track
                && other.start < clip.start + clip.len && clip.start < other.start + other.len);
            expect(overlapping, `${pattern.name} on track ${clip.track}`).toEqual([]);
            for (const notes of Object.values(pattern.tracks)) {
                expect(notes.every(note => note.start >= 0 && note.start + note.len <= pattern.steps && noteByName[note.pitch])).toBe(true);
            }
        }
    });

    it('puts every note of every part into the arrangement at its pitch', () => {
        // the solo violin plays its part (the trills add notes, so at least); the sections play theirs exactly
        const performed = WINTER_MOVEMENTS.map(performMovement);
        const total = (voice: string) => performed.reduce((sum, notes) => sum + notes.filter(note => note.voice === voice).length, 0);
        expect(notesOf(WINTER_ID.solo).length).toBe(total('solo'));
        expect(total('solo')).toBeGreaterThan(1027 + 151 + 982);
        expect(notesOf(WINTER_ID.vn1).length + notesOf(WINTER_ID.pizz1).length).toBe(649 + 273 + 532);
        expect(notesOf(WINTER_ID.vn2).length + notesOf(WINTER_ID.pizz2).length).toBe(633 + 273 + 508);
        expect(notesOf(WINTER_ID.vla).length).toBe(469 + 17 + 400);
        expect(notesOf(WINTER_ID.vc).length).toBe(477 + 137 + 274);
        // the violone doubles the bass an octave down in the Allegros only, the harpsichord plays throughout
        expect(notesOf(WINTER_ID.violone).length).toBe(477 + 274);
        expect(notesOf(WINTER_ID.violone).every(note => idxOfNote[note.pitch] >= idxOfNote['C1'])).toBe(true);
        expect(notesOf(WINTER_ID.hpsd).length).toBeGreaterThan(477 + 137 + 274);
        // the first note of the concerto: the bass on f (175 Hz), the violone an octave under it
        const opening = notesOf(WINTER_ID.vc).filter(note => note.at === 0);
        expect(opening.map(note => note.pitch)).toEqual(['F4']);
        expect(noteByName['F4'].freq).toBeCloseTo(174.6, 0);
        expect(notesOf(WINTER_ID.violone).filter(note => note.at === 0).map(note => note.pitch)).toEqual(['F3']);
        // the ranges land in the DAW's registers (notes.ts: middle C = C5)
        const solo = notesOf(WINTER_ID.solo).map(note => noteByName[note.pitch].freq);
        expect(Math.min(...solo)).toBeCloseTo(noteByName['G4'].freq, 0);
        expect(Math.max(...solo)).toBeCloseTo(noteByName['G7'].freq, 0);
    });

    it('performs what the print says beyond the notes', () => {
        // the shiver: the solo's eighths in bars 4-11 of I are trilled in 32nds
        const first = performMovement(WINTER_MOVEMENTS[0]);
        const bar4 = first.filter(note => note.voice === 'solo' && note.start >= 3 * 32 && note.start < 4 * 32);
        expect(bar4.length).toBeGreaterThanOrEqual(16);
        expect(bar4.every(note => note.len === 1)).toBe(true);
        const alternation = bar4.slice(0, 4).map(note => note.midi);
        expect(alternation[0]).not.toBe(alternation[1]);
        expect(alternation[0]).toBe(alternation[2]);
        expect(Math.abs(alternation[1] - alternation[0])).toBeLessThanOrEqual(2);
        // the rain: violins pizzicato in II, violas bowed but "pianissimo"
        const second = performMovement(WINTER_MOVEMENTS[1]);
        expect(second.some(note => note.voice === 'vn1' || note.voice === 'vn2')).toBe(false);
        expect(second.filter(note => note.voice === 'pizz1').length).toBe(273);
        expect(second.filter(note => note.voice === 'vla').every(note => note.vel <= 0.4)).toBe(true);
        expect(second.some(note => note.voice === 'violone')).toBe(false);
        // dynamics: "Piano" for the batter li denti, "Forte" for the close
        const tutti = (from: number, to: number) => median(first.filter(note => note.voice === 'vn1' && note.start >= (from - 1) * 32 && note.start < to * 32).map(note => note.vel));
        expect(tutti(47, 55)).toBeLessThan(tutti(56, 63) - 0.3);
        // the harpsichord's right hand strikes the tutti chords, never in the bars the upper strings rest
        const bass = new Set(first.filter(note => note.voice === 'vc').map(note => `${note.start}/${note.midi}`));
        const chords = first.filter(note => note.voice === 'hpsd' && !bass.has(`${note.start}/${note.midi}`));
        expect(chords.length).toBeGreaterThan(200);
        for (const chord of chords) {
            expect(first.some(note => note.voice === 'vn1' && note.start === chord.start), `chord at ${chord.start}`).toBe(true);
            expect(first.some(note => note.voice === 'vla' && note.start === chord.start), `chord at ${chord.start}`).toBe(true);
        }
        // the Lento is stretched: its clips are twice their bar count
        const lento = demo.patterns.filter(pattern => pattern.name.includes('Lento'));
        expect(lento.length).toBeGreaterThan(0);
        expect(lento.every(pattern => pattern.steps === 19 * 12 * 2)).toBe(true);
        // the fermatas hold one chord: the final F minor of I for 4.5 s, of III for 2.25 s
        for (const [name, steps] of [['D fermata', 48], ['N fermata', 24]] as const) {
            const chord = demo.patterns.filter(pattern => pattern.name.includes(name) && !pattern.name.includes('Venti'));
            expect(chord.length).toBe(6);
            expect(chord.every(pattern => pattern.steps === steps)).toBe(true);
            expect(chord.flatMap(pattern => Object.values(pattern.tracks).flat()).every(note => note.start === 0)).toBe(true);
            // the strings hold it through; the harpsichord's chord is struck on the beat as everywhere
            const strings = chord.filter(pattern => !pattern.name.includes('Harpsichord')).flatMap(pattern => Object.values(pattern.tracks).flat());
            expect(strings.length).toBeGreaterThanOrEqual(6);
            expect(strings.every(note => note.len === steps)).toBe(true);
        }
    });

    it('lets the winds of the sonnet blow under the bars that paint them', () => {
        const borea = instrument('Orchestra/Venti/Borea'), sirocco = instrument('Orchestra/Venti/Sirocco');
        // noise-only voices: no harmonic bands at all, a wide band that climbs into place with every gust
        for (const wind of [borea, sirocco]) {
            expect(wind.params.tone).toBe(0);
            expect(wind.params.noise).toBe(1);
            expect(wind.params.pitchDrop).toBeLessThan(0);
            expect(wind.params.noiseBend).toBe(1);
            expect(isPitched(wind.params)).toBe(false);
        }
        expect(borea.params.noiseFreq).toBeGreaterThan(sirocco.params.noiseFreq * 4);
        expect(borea.params.pan).toBeLessThan(-0.5);
        expect(sirocco.params.pan).toBeGreaterThan(0.5);
        // where they blow: I — "orrido Vento" (12-18), the "venti" (27-38), "batter li denti" (47-55); nothing in the rain;
        // III — the Sirocco through the Lento (101-119), Borea from 120, both in the last tutti (137-152)
        const barsOf = (movement: number, voice: string) => performMovement(WINTER_MOVEMENTS[movement])
            .filter(note => note.voice === voice)
            .map(note => [Math.floor(note.start / WINTER_MOVEMENTS[movement].data.stepsPerBar) + 1, Math.ceil((note.start + note.len) / WINTER_MOVEMENTS[movement].data.stepsPerBar)]);
        const inside = (ranges: number[][], windows: [number, number][]) => ranges.every(([from, to]) => windows.some(([a, b]) => from >= a && to <= b));
        expect(barsOf(0, 'borea').length).toBeGreaterThan(5);
        expect(inside(barsOf(0, 'borea'), [[12, 18], [27, 38], [47, 55]])).toBe(true);
        expect(barsOf(0, 'sirocco')).toEqual([]);
        expect(barsOf(1, 'borea').concat(barsOf(1, 'sirocco'))).toEqual([]);
        expect(inside(barsOf(2, 'sirocco'), [[101, 119], [137, 152]])).toBe(true);
        expect(inside(barsOf(2, 'borea'), [[120, 152]])).toBe(true);
        expect(barsOf(2, 'sirocco').some(([from]) => from >= 137)).toBe(true);
        expect(barsOf(2, 'borea').some(([from]) => from >= 137)).toBe(true);
        // the gusts grow into the storm and every one of them is a whole note on its own lane
        const velocities = performMovement(WINTER_MOVEMENTS[2]).filter(note => note.voice === 'borea').map(note => note.vel);
        expect(Math.max(...velocities)).toBe(1);
        expect(velocities[0]).toBeLessThan(velocities.at(-1)!);
        const venti = demo.tracks.findIndex(track => track.name === 'Venti');
        expect(venti).toBe(6);
        for (const clip of demo.arrangement.filter(candidate => candidate.track === venti)) {
            const pattern = demo.patterns.find(candidate => candidate.id === clip.patternId)!;
            expect(Object.keys(pattern.tracks).every(id => id === WINTER_ID.borea || id === WINTER_ID.sirocco)).toBe(true);
        }
        // "tutti i Venti in guerra": the two winds change sides through the last tutti
        const pan = (id: string) => demo.automation!.find(lane => lane.target === id && lane.param === 'pan')!;
        const war = placeSections().find(section => section.name === 'N tutti li venti')!;
        expect(pan(WINTER_ID.borea).points.filter(point => point.step <= war.start).at(-1)!.value).toBeLessThan(0);
        expect(pan(WINTER_ID.borea).points.at(-1)!.value).toBeGreaterThan(0.5);
        expect(pan(WINTER_ID.sirocco).points.filter(point => point.step <= war.start).at(-1)!.value).toBeGreaterThan(0);
        expect(pan(WINTER_ID.sirocco).points.at(-1)!.value).toBeLessThan(-0.5);
    });

    it('makes the soloist sing in the Largo: vocal formants, a moving vowel and portamento', () => {
        const solo = instrument('Orchestra/Strings/Solo Violin');
        const laneOf = (param: string) => demo.automation!.find(lane => lane.target === WINTER_ID.solo && lane.param === param)!;
        const [largo, lento, borea] = ['E la pioggia', 'M il vento Sirocco (Lento)', 'N il vento Borea'].map(name => placeSections().find(section => section.name === name)!);
        // the tract is fitted but shut, and opened by the lane in the Largo (and half way for the Sirocco) only
        expect(solo.params.formant).toBe(0);
        expect(solo.params.f1).toBeGreaterThan(0);
        const formant = laneOf('formant');
        const valueAt = (lane: typeof formant, step: number) => lane.points.filter(point => point.step <= step).at(-1)!.value;
        expect(valueAt(formant, 0)).toBe(0);
        expect(valueAt(formant, largo.start)).toBeGreaterThanOrEqual(0.3);
        expect(valueAt(formant, largo.start + largo.len * 2)).toBeGreaterThanOrEqual(0.3);
        expect(valueAt(formant, lento.start - 1)).toBe(0);
        expect(valueAt(formant, lento.start)).toBeGreaterThan(0);
        expect(valueAt(formant, borea.start)).toBe(0);
        // the vowel moves: F2 changes over the movement and stays a vowel (500..3500 Hz, the slider's range)
        const f2 = laneOf('f2');
        expect(new Set(f2.points.map(point => point.value)).size).toBeGreaterThanOrEqual(3);
        expect(f2.points.every(point => point.value >= 500 && point.value <= 3500)).toBe(true);
        // the emphasis trim is given back
        expect(valueAt(laneOf('gain'), largo.start)).toBeGreaterThan(solo.params.gain);
        // the voice still measures as a clean pitch with the tract open
        const singing = {...solo.params, formant: 0.35, vib: 26, att: 0.09, gain: 0.6};
        for (const pitch of ['A#5', 'D#6', 'A#6']) {
            const measured = measureNote(singing, pitch, 8, demo.bpm);
            expect(measured.clarity, pitch).toBeGreaterThanOrEqual(0.85);
            expect(measured.peakDb, pitch).toBeGreaterThan(-20);
        }
        // portamento: long notes of the Largo slide into their neighbours, and nowhere else
        const linked = (movement: number) => demo.arrangement
            .filter(clip => placeSections().some(section => section.movement === movement && section.start === clip.start))
            .flatMap(clip => (demo.patterns.find(candidate => candidate.id === clip.patternId)!.tracks[WINTER_ID.solo] || [])
                .filter(note => note.legatoTo).map(note => ({note, clip})));
        expect(linked(0)).toEqual([]);
        expect(linked(2)).toEqual([]);
        const slides = linked(1);
        expect(slides.length).toBeGreaterThan(10);
        expect(slides.length).toBeLessThan(60);
        for (const {note, clip} of slides) {
            const part = demo.patterns.find(candidate => candidate.id === clip.patternId)!.tracks[WINTER_ID.solo];
            const target = part.find(candidate => candidate.start === note.legatoTo!.start && candidate.pitch === note.legatoTo!.pitch);
            expect(target, `${note.pitch}@${note.start}`).toBeDefined();
            expect(isLegatoTarget(note, target!.start)).toBe(true);
            expect(target!.start - (note.start + note.len)).toBe(2);
            expect(Math.abs(idxOfNote[target!.pitch] - idxOfNote[note.pitch])).toBeLessThanOrEqual(5);
            expect(note.len).toBeGreaterThanOrEqual(6);
        }
        // the rain drifts: both pizzicato sections have a pan lane that moves
        for (const id of [WINTER_ID.pizz1, WINTER_ID.pizz2]) {
            const pan = demo.automation!.find(lane => lane.target === id && lane.param === 'pan')!;
            expect(new Set(pan.points.map(point => point.value)).size).toBeGreaterThanOrEqual(3);
            expect(pan.points.every(point => Math.abs(point.value) <= 0.7)).toBe(true);
        }
    });

    it('voices a period string band the other demos do not have', () => {
        const names = demo.instruments.map(({name}) => name);
        expect(names).toEqual([
            'Orchestra/Strings/Solo Violin', 'Orchestra/Strings/Violins I', 'Orchestra/Strings/Violins II', 'Orchestra/Strings/Violas',
            'Orchestra/Strings/Violoncelli', 'Orchestra/Strings/Violone', 'Orchestra/Strings/Violins I pizz.', 'Orchestra/Strings/Violins II pizz.',
            'Orchestra/Continuo/Harpsichord', 'Orchestra/Venti/Borea', 'Orchestra/Venti/Sirocco'
        ]);
        for (const song of ['axelf', 'toccata', 'monsoon', 'noise', 'diva', 'pocket', 'chip', 'promo'] as const) {
            const other = buildDemoProject(song).instruments.map(({name}) => name);
            expect(names.filter(name => other.includes(name))).toEqual([]);
        }
        // the soloist is one player, the sections are two ranks; the violone has no vibrato
        expect(instrument('Orchestra/Strings/Solo Violin').params.voices).toBe(1);
        expect(instrument('Orchestra/Strings/Solo Violin').params.vib).toBeGreaterThan(10);
        for (const section of ['Violins I', 'Violins II', 'Violas', 'Violoncelli']) {
            expect(instrument(`Orchestra/Strings/${section}`).params.voices).toBe(2);
        }
        expect(instrument('Orchestra/Strings/Violone').params.vib).toBe(0);
        expect(instrument('Orchestra/Strings/Violins I pizz.').params.sus).toBe(0);
        // the stage: firsts left, bassi right
        expect(instrument('Orchestra/Strings/Violins I').params.pan).toBeLessThan(-0.3);
        expect(instrument('Orchestra/Strings/Violoncelli').params.pan).toBeGreaterThan(0.3);
    });

    it('renders every instrument as a pitch at the register and note length it plays', () => {
        for (const inst of demo.instruments) {
            const notes = notesOf(inst.id);
            expect(notes.length, inst.name).toBeGreaterThan(0);
            if (inst.name.startsWith('Orchestra/Venti/')) {continue;} // the winds are noise by design
            expect(isPitched(inst.params), inst.name).toBe(true);
            const sorted = [...notes].sort((a, b) => noteByName[a.pitch].freq - noteByName[b.pitch].freq);
            const len = median(notes.map(note => note.len));
            for (const pitch of [sorted[0].pitch, sorted[Math.floor(sorted.length / 2)].pitch, sorted.at(-1)!.pitch]) {
                const measured = measureNote(inst.params, pitch, len, demo.bpm);
                expect(measured.clarity, `${inst.name} on ${pitch} for ${len} steps`).toBeGreaterThanOrEqual(0.65);
                expect(measured.peakDb, `${inst.name} on ${pitch}`).toBeGreaterThan(-30);
            }
        }
    });

    it('keeps the automation inside the song and the master under the engine\'s headroom', () => {
        for (const lane of demo.automation!) {
            expect(lane.points.length).toBeGreaterThanOrEqual(2);
            expect(lane.points.every((point, i) => !i || point.step >= lane.points[i - 1].step), lane.param).toBe(true);
            expect(lane.points.every(point => point.step >= 0 && point.step <= songEnd), lane.param).toBe(true);
        }
        const master = demo.automation!.find(lane => lane.target === 'master' && lane.param === 'vol')!;
        // the fullest tutti (the close of I) clipped with the fader at 0.5 and peaks at -1.5 dBFS at 0.28 — see the value's comment
        expect(Math.max(...master.points.map(point => point.value))).toBeLessThanOrEqual(0.3);
        const rev = demo.automation!.find(lane => lane.target === 'master' && lane.param === 'rev')!;
        const largo = placeSections().find(section => section.movement === 1)!;
        const wetAtLargo = rev.points.filter(point => point.step <= largo.start).at(-1)!.value;
        expect(wetAtLargo).toBeGreaterThan(rev.points[0].value);
    });
});
