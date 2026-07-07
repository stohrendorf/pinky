import {
    describe, expect, it
} from 'vitest';

import type {
    InstrumentParams
} from './types';

import {
    buildDemoProject
} from './project';

const expectTonalBody = (params: InstrumentParams) => {

    expect(params.noise).toBeLessThan(0.8);
    expect(params.partials?.filter(partial => partial.level > 0).length).toBeGreaterThanOrEqual(3);
    expect(params.voices).toBeGreaterThan(1);
    expect(params.detune).toBeGreaterThan(0);
};

describe('bundled demo timbres', () => {
    it('replaces the sustained noise body in Iron Garden’s breath pad', () => {
        const params = buildDemoProject('iron').instruments.find(value => value.params.formant > 0)!.params;

        expectTonalBody(params);
        expect(params.noise).toBeLessThanOrEqual(0.25);
        expect(params.formant).toBeGreaterThan(0);
    });

    it('keeps the jazz rain recognizable without leaving it as full noise', () => {
        const rain = buildDemoProject('jazz').instruments.find(value => value.params.formant > 0)!.params;
        const brushSnare = buildDemoProject('jazz').instruments.find(value => value.name.includes('Snare'))!.params;

        expectTonalBody(rain);
        expect(rain.gain).toBeLessThanOrEqual(0.18);
        expect(rain.formant).toBeGreaterThan(0);
        expect(brushSnare.noise).toBeGreaterThanOrEqual(0.8);
    });

    it('preserves Out of Noise’s concept while giving its wind resonant detail', () => {
        const wind = buildDemoProject('noise').instruments.find(value => value.params.noiseBend === 1)!.params;

        expectTonalBody(wind);
        expect(wind.noise).toBeGreaterThanOrEqual(0.7);
        expect(wind.formant).toBeGreaterThan(0);
        expect(wind.noiseBend).toBe(1);
    });

    it('turns Axel F’s long effects into pitched sweeps instead of noise washes', () => {
        for (const params of buildDemoProject('axelf').instruments.filter(value => value.params.noiseBend > 0).map(value => value.params)) {
            expectTonalBody(params);
            expect(params.noise).toBeLessThanOrEqual(0.25);
            expect(params.noiseBend).toBeGreaterThan(0);
        }
    });
});