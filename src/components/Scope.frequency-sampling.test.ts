import {
    readFileSync
} from 'node:fs';
import {
    fileURLToPath
} from 'node:url';
import {
    describe, expect, it
} from 'vitest';

const scope = readFileSync(fileURLToPath(new URL('./Scope.svelte', import.meta.url)), 'utf8');
const engine = readFileSync(fileURLToPath(new URL('../lib/engine.ts', import.meta.url)), 'utf8');

describe('Scope frequency sampling', () => {
    it('retains live narrow-band centers and renders the nearest FFT bin', () => {
        expect(scope).toContain('quadraticFrequencySamples(CURVE_PTS, nyq * 0.5, 1, anchors)');
        expect(scope).toContain('Math.round(Math.pow(i / bars, 2) * fft.length * 0.5)');
    });

    it('uses an FFT resolution that can distinguish low resonances', () => {
        expect(engine).toContain('export const SCOPE_FFT_SIZE = 8192;');
        expect(engine).toContain('fftSize: SCOPE_FFT_SIZE');
        expect(engine).toContain('smoothingTimeConstant: 0');
    });

    it('uses the engine pink-noise source response instead of an idealized 1/f approximation', () => {
        expect(scope).toContain('pinkNoisePower(f, fs)');
        expect(scope).not.toContain('1000 / Math.max(20, f)');
    });

    it('adds each stereo-spread rank as power and reuses that calculation for the dots', () => {
        expect(scope).toContain('let power = 0;');
        expect(scope).toContain('power += level * level * (response[0] * response[0] + response[1] * response[1]);');
        expect(scope).toContain('const spectrumPower = (cw: number, sw: number, c2w: number, s2w: number): number =>');
        expect(scope).toContain('const pow = spectrumPower(cw, sw, c2w, s2w) * pinkNoisePower(f, fs) * gMaster');
    });

    it('evaluates each filter before chaining it so very low notes cannot underflow', () => {
        expect(scope).toContain('const filterReal = (br * ar + bi * ai) / denominator;');
        expect(scope).toContain('real -= 1;');
    });
});