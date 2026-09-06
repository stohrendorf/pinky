import {
    describe, expect, it
} from 'vitest';

import type {
    ConductorData
} from './timing';

import {
    importProject, isProject, newEmptyProject
} from './project';
import {
    barAt, barsInRange, createTimingMap, ensureConductor, isConductorData, snapToBeat
} from './timing';
import {
    createId
} from './types';

const tempo = (step: number, bpm: number, curve: 'hold' | 'linear' = 'hold') => ({id: createId(), step, bpm, curve});
const meter = (step: number, numerator: number, denominator: 4 | 8 | 16) => ({id: createId(), step, numerator, denominator});
const empty = (): ConductorData => ({tempos: [], meters: [], sections: []});

describe('conductor timing map', () => {
    it('preserves legacy constant timing and never mutates the project', () => {
        const p = {bpm: 120};
        const map = createTimingMap(p);
        expect(map.secondsAt(32)).toBe(4);
        expect(map.secondsBetween(8, 16)).toBe(1);
        expect(map.stepAt(4)).toBe(32);
        expect(map.bpmAt(1000)).toBe(120);
        expect(map.secondsAt(-4)).toBe(0);
        expect(p).toEqual({bpm: 120});
    });

    it('holds the base before the first marker and uses the new tempo exactly at boundaries', () => {
        const p = {bpm: 120, conductor: {...empty(), tempos: [tempo(8, 60), tempo(16, 180)]}};
        const map = createTimingMap(p);
        expect(map.secondsAt(8)).toBe(1);
        expect(map.secondsAt(16)).toBe(3);
        expect(map.secondsAt(28)).toBe(4);
        expect(map.bpmAt(7.99)).toBe(120);
        expect(map.bpmAt(8)).toBe(60);
        expect(map.secondsBetween(4, 20)).toBeCloseTo(17 / 6);
    });

    it.each([[60, 180], [180, 60], [120, 120], [120, 120.0000001]])('integrates a %s→%s ramp and inverts fractional positions', (a, b) => {
        const p = {bpm: 112, conductor: {...empty(), tempos: [tempo(0, a, 'linear'), tempo(48, b)]}};
        const map = createTimingMap(p);
        expect(map.bpmAt(24)).toBeCloseTo((a + b) / 2);
        const expected = a === b ? 48 * 15 / a : 48 * 15 * Math.log(b / a) / (b - a);
        expect(map.secondsAt(48)).toBeCloseTo(expected, 5);
        for (const step of [0, 0.5, 12.73, 24, 47.999, 48, 64, 10000]) {
            expect(map.stepAt(map.secondsAt(step))).toBeCloseTo(step, 8);
        }
        const summed = Array.from({length: 96}, (_, i) => map.secondsBetween(i / 2, (i + 1) / 2)).reduce((a, b) => a + b, 0);
        expect(summed).toBeCloseTo(map.secondsAt(48), 10);
    });

    it('does not extrapolate a ramp past its final tempo marker', () => {
        const p = {bpm: 112, conductor: {...empty(), tempos: [tempo(0, 90, 'linear')]}};
        expect(createTimingMap(p).secondsAt(60)).toBe(10);
    });
});

describe('meter-aware bars', () => {
    it('snaps loop edges to local beats, including a short bar and eighth-note bar endings', () => {
        const p = {bpm: 120, conductor: {...empty(), meters: [meter(10, 7, 8), meter(38, 3, 4)]}};
        expect(snapToBeat({bpm: 120}, 14)).toBe(16);
        expect(snapToBeat(p, -5)).toBe(0);
        expect(snapToBeat(p, 9.9)).toBe(10);
        expect(snapToBeat(p, 23.8)).toBe(24);
        expect(snapToBeat(p, 37.9)).toBe(38);
        expect(snapToBeat(p, 41.4)).toBe(42);
    });

    it('uses 4/4 by default, and real eighth-note beats in 7/8 and 3/8', () => {
        const p = {bpm: 120, conductor: {...empty(), meters: [meter(32, 7, 8), meter(60, 3, 8)]}};
        expect(barAt(p, 31)).toMatchObject({bar: 2, start: 16, end: 32, beat: 4});
        expect(barAt(p, 44)).toMatchObject({bar: 3, start: 32, end: 46, beat: 7, numerator: 7, denominator: 8});
        expect(barAt(p, 60)).toMatchObject({bar: 5, start: 60, end: 66, beat: 1});
        expect(barsInRange(p, 30, 67).map(bar => [bar.bar, bar.start, bar.end])).toEqual([
            [2, 16, 32], [3, 32, 46], [4, 46, 60], [5, 60, 66], [6, 66, 72]
        ]);
        expect(createTimingMap(p).secondsAt(64)).toBe(8);
    });

    it('shortens an existing bar without moving notes when a marker lands inside it', () => {
        const p = {bpm: 120, conductor: {...empty(), meters: [meter(10, 5, 16)]}};
        expect(barAt(p, 9)).toMatchObject({bar: 1, start: 0, end: 10});
        expect(barAt(p, 10)).toMatchObject({bar: 2, start: 10, end: 15});
        expect(barAt(p, 14)).toMatchObject({beat: 5});
        expect(barsInRange(p, 15, 15)).toEqual([]);
    });
});

describe('conductor persistence and validation', () => {
    it('round-trips markers without making legacy projects opt in', () => {
        const p = newEmptyProject();
        expect(p.conductor).toBeUndefined();
        const data = ensureConductor(p);
        data.tempos.push(tempo(0, 120, 'linear'), tempo(32, 132));
        data.meters.push(meter(0, 7, 8));
        data.sections.push({id: createId(), step: 0, name: 'Rain'});
        expect(isProject(p)).toBe(true);
        expect(importProject(JSON.stringify(p))).toBe(true);
        expect(ensureConductor(p)).toBe(data);
    });

    it('rejects malformed, duplicate, unordered and excessive marker data', () => {
        const data = {...empty(), tempos: [tempo(0, 120), tempo(32, 140)]};
        const invalid: unknown[] = [
            null, {}, {...data, tempos: null}, {...data, tempos: [tempo(-1, 120)]},
            {...data, tempos: [tempo(0.5, 120)]}, {...data, tempos: [tempo(Infinity, 120)]},
            {...data, tempos: [tempo(0, NaN)]}, {...data, tempos: [tempo(0, 0)]},
            {...data, tempos: [{...tempo(0, 120), curve: 'smooth'}]},
            {...data, tempos: [tempo(32, 120), tempo(0, 140)]},
            {...data, tempos: [tempo(0, 120), tempo(0, 140)]},
            {...data, tempos: [data.tempos[0], {...data.tempos[1], id: data.tempos[0].id}]},
            {...data, meters: [{...meter(0, 7, 8), denominator: 3}]},
            {...data, meters: [meter(0, 0, 4)]}, {...data, meters: [meter(0, 2.5, 4)]},
            {...data, sections: [{id: createId(), step: 0, name: '  '}]},
            {...data, sections: [{id: data.tempos[0].id, step: 0, name: 'Duplicate ID'}]},
            {...data, tempos: Array.from({length: 513}, (_, i) => tempo(i, 120))}
        ];
        for (const value of invalid) {
            expect(isConductorData(value), JSON.stringify(value)).toBe(false);
            expect(isProject({...newEmptyProject(), conductor: value})).toBe(false);
        }
    });
});
