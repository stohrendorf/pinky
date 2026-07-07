import {
    afterEach, describe, expect, it, vi
} from 'vitest';

import {
    NodePool
} from './node-pool';

class FakeParam {
    value: number;
    readonly cancelScheduledValues = vi.fn();

    constructor(value = 0) {
        this.value = value;
    }
}

class FakeNode {
    readonly connections: unknown[] = [];

    constructor(readonly context: BaseAudioContext) {
    }

    connect(destination: unknown): this {
        this.connections.push(destination);
        return this;
    }

    disconnect(destination?: unknown): void {
        if (destination === undefined) {this.connections.length = 0;}
        else {this.connections.splice(this.connections.indexOf(destination), 1);}
    }
}

class FakeGainNode extends FakeNode {
    readonly gain: FakeParam;

    constructor(context: BaseAudioContext, options: { gain?: number } = {}) {
        super(context);
        this.gain = new FakeParam(options.gain);
    }
}

class FakeBiquadFilterNode extends FakeNode {
    type = 'lowpass';
    readonly frequency = new FakeParam();
    readonly Q = new FakeParam();
    readonly gain = new FakeParam();
    readonly detune = new FakeParam();

    constructor(context: BaseAudioContext, options: { frequency?: number; Q?: number; gain?: number } = {}) {
        super(context);
        this.frequency.value = options.frequency ?? 0;
        this.Q.value = options.Q ?? 0;
        this.gain.value = options.gain ?? 0;
    }
}

class FakePannerNode extends FakeNode {
    readonly pan = new FakeParam();

    constructor(context: BaseAudioContext, options: { pan?: number } = {}) {
        super(context);
        this.pan.value = options.pan ?? 0;
    }
}

afterEach(() => vi.unstubAllGlobals());

describe('NodePool', () => {
    it('reuses gains and resets their scheduled value', () => {
        vi.stubGlobal('GainNode', FakeGainNode);
        const context = {} as BaseAudioContext;
        const pool = new NodePool({capacity: 2});
        pool.attach(context, new FakeGainNode(context) as unknown as GainNode, () => 0);

        const first = pool.takeGain(0.2, context);
        pool.give(first);
        const reused = pool.takeGain(0.8, context) as unknown as FakeGainNode;

        expect(reused).toBe(first);
        expect(reused.gain.value).toBe(0.8);
        expect(reused.gain.cancelScheduledValues).toHaveBeenCalledWith(0);
    });

    it('keeps the configured number of reusable nodes', () => {
        vi.stubGlobal('GainNode', FakeGainNode);
        const context = {} as BaseAudioContext;
        const pool = new NodePool({capacity: 1});
        pool.attach(context, new FakeGainNode(context) as unknown as GainNode, () => 0);

        pool.give(pool.takeGain(0.2, context));
        pool.give(new FakeGainNode(context) as unknown as GainNode);

        expect(pool.size).toBe(1);
    });

    it('keeps filters in cooling until their state can be safely reused', () => {
        vi.stubGlobal('GainNode', FakeGainNode);
        vi.stubGlobal('BiquadFilterNode', FakeBiquadFilterNode);
        vi.stubGlobal('StereoPannerNode', FakePannerNode);
        const context = {} as BaseAudioContext;
        let now = 0;
        const pool = new NodePool({capacity: 2, coolTime: 0.2});
        pool.attach(context, new FakeGainNode(context) as unknown as GainNode, () => now);

        const first = pool.takeBiquad(440, 3, 12, context);
        pool.give(first);
        expect(pool.coolingCount).toBe(1);
        expect(pool.takeBiquad(880, 4, 6, context)).not.toBe(first);

        now = 0.19;
        pool.sweep(now);
        expect(pool.coolingCount).toBe(1);

        now = 0.2;
        pool.sweep(now);
        const reused = pool.takeBiquad(880, 4, 6, context) as unknown as FakeBiquadFilterNode;
        expect(reused).toBe(first);
        expect(reused.frequency.value).toBe(880);
        expect(reused.Q.value).toBe(4);
        expect(reused.gain.value).toBe(6);
        expect(reused.detune.value).toBe(0);
    });
});