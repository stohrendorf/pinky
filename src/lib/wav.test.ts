import {
    describe, expect, it
} from 'vitest';

import {
    encodeWav, encodeWavAsync, type PcmSource
} from './wav';

function pcm(length: number): PcmSource {
    const data = new Float32Array(length);
    data.set([-2, -1, -0.5, 0, 0.5, 1, 2].slice(0, length));
    return {numberOfChannels: 2, length, sampleRate: 44100, getChannelData: () => data};
}

describe('yielding WAV encoder', () => {
    it('preserves the original PCM bytes, interleaving and header across chunk boundaries', async () => {
        const source = pcm(70000);
        const progress: number[] = [];
        const actual = await encodeWavAsync(source, {onProgress: value => progress.push(value)});
        expect(await actual.arrayBuffer()).toEqual(await encodeWav(source).arrayBuffer());
        expect(progress).toEqual([0, 32768 / 70000, 65536 / 70000, 1]);
    });

    it('rejects a non-finite rendered sample instead of silently encoding it as silence', () => {
        const source = pcm(3);
        source.getChannelData(0)[1] = Number.NaN;

        expect(() => encodeWav(source)).toThrow('non-finite audio sample');
    });

    it('rejects an early abort before accessing channel samples', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(encodeWavAsync(pcm(8), {signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'});
    });

    it.each([32768 / 70000, 1])('discards encoding cancelled at progress %s', async threshold => {
        const controller = new AbortController();
        const progress: number[] = [];
        await expect(encodeWavAsync(pcm(70000), {
            signal: controller.signal,
            onProgress: value => {
                progress.push(value);
                if (value >= threshold) {
                    controller.abort();
                }
            }
        })).rejects.toMatchObject({name: 'AbortError'});
        expect(progress.at(-1)).toBe(threshold);
        expect(await encodeWavAsync(pcm(8))).toBeInstanceOf(Blob);
    });
});
