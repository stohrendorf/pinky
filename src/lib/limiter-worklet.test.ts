import {
    afterEach, describe, expect, it, vi
} from 'vitest';

interface Processor {
    port: {postMessage: ReturnType<typeof vi.fn>; onmessage: (event: {data: unknown}) => void};
    process(input: Float32Array[][], output: Float32Array[][]): boolean;
}

async function processor(metering: boolean) {
    vi.resetModules();
    let Constructor!: new (options: unknown) => Processor;
    vi.stubGlobal('sampleRate', 48000);
    vi.stubGlobal('AudioWorkletProcessor', class {
        port = {postMessage: vi.fn(), onmessage: null};
    });
    vi.stubGlobal('registerProcessor', (name: string, constructor: typeof Constructor) => {
        expect(name).toBe('pinky-mixer-limiter');
        Constructor = constructor;
    });
    await import('./limiter-worklet.js');
    return new Constructor({processorOptions: {metering, settings: {enabled: true, ceilingDb: -6, driveDb: 18}}});
}

afterEach(() => {vi.unstubAllGlobals();});

describe('limiter worklet actual DSP wiring', () => {
    it('limits stereo at the output and sends bounded-rate output meters live', async () => {
        const node = await processor(true);
        const input = [new Float32Array(128).fill(20), new Float32Array(128).fill(-5)];
        const output = [new Float32Array(128), new Float32Array(128)];
        for (let block = 0; block < 375; block++) {
            expect(node.process([input], [output])).toBe(true);
            expect(output[0].every(value => Math.abs(value) <= Math.pow(10, -6 / 20))).toBe(true);
        }
        expect(node.port.postMessage.mock.calls.length).toBeLessThanOrEqual(20);
        expect(node.port.postMessage.mock.calls.length).toBeGreaterThanOrEqual(19);
        const meter = node.port.postMessage.mock.lastCall?.[0] as {peak: number[]; rms: number[]; reduction: number};
        expect(meter.reduction).toBeGreaterThan(40);
        expect(meter.peak[1] / meter.peak[0]).toBeCloseTo(0.25);
        expect(meter.rms[0]).toBeCloseTo(meter.peak[0]);
    });

    it('does not send a single meter message offline and still protects every sample', async () => {
        const node = await processor(false);
        const input = [new Float32Array(128).fill(100)];
        const output = [new Float32Array(128), new Float32Array(128)];
        for (let block = 0; block < 400; block++) {
            node.process([input], [output]);
            expect(output[0].every(value => Math.abs(value) <= Math.pow(10, -6 / 20))).toBe(true);
            expect(output[1]).toEqual(output[0]);
        }
        expect(node.port.postMessage).not.toHaveBeenCalled();
    });

    it('applies bypass configuration without removing the delay buffer', async () => {
        const node = await processor(false);
        node.port.onmessage({data: {type: 'configure', settings: {enabled: false, driveDb: 18}}});
        const input = [new Float32Array(128).fill(2), new Float32Array(128).fill(-1)];
        const output = [new Float32Array(128), new Float32Array(128)];
        node.process([input], [output]);
        expect(output[0].every(value => value === 0)).toBe(true);
        node.process([input], [output]);
        expect(output[0][111]).toBe(0);
        expect(output[0][112]).toBe(2);
        expect(output[1][112]).toBe(-1);
    });
});