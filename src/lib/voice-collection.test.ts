import {
    describe, expect, it, vi
} from 'vitest';

import {
    type ManagedVoice, VoiceCollection
} from './voice-collection';

function voice(cost: number, level: number): ManagedVoice {
    const result: ManagedVoice = {
        cost,
        stopAt: Infinity,
        dead: false,
        loudness: () => level,
        stop: vi.fn((at: number) => {result.stopAt = Math.min(result.stopAt, at);}),
        glide: vi.fn(),
        setParams: vi.fn()
    };
    return result;
}

function collection(maxNodes = 100, maxVoices = 96): VoiceCollection {
    return new VoiceCollection({maxNodes: () => maxNodes, maxVoices: () => maxVoices});
}

describe('VoiceCollection', () => {
    it('steals the quietest held voice when the node budget is exceeded', () => {
        const voices = collection(5);
        const quiet = voice(3, 0.1);
        const loud = voice(3, 0.8);
        voices.register('a', 'a:C4', 0, quiet, 1);
        voices.register('b', 'b:E4', 0, loud, 1);

        expect(voices.prepare(1)).toBe(3);
        expect(quiet.stop).toHaveBeenCalledWith(1);
        expect(loud.stop).not.toHaveBeenCalled();
    });

    it('enforces a configured voice cap as well as its node cap', () => {
        const voices = collection(10, 2);
        const first = voice(1, 0.1);
        const second = voice(1, 0.8);
        const third = voice(1, 0.5);
        voices.register('first', 'first:C4', 0, first, 1);
        voices.register('second', 'second:E4', 0, second, 1);
        voices.register('third', 'third:G4', 0, third, 1);

        expect(voices.prepare(1)).toBe(1);
        expect(first.stop).toHaveBeenCalledWith(1);
        expect(second.stop).not.toHaveBeenCalled();
        expect(third.stop).toHaveBeenCalledWith(1);
    });


    it('keeps active and live state isolated between collection instances', () => {
        const first = collection();
        const second = collection();
        first.register('one', 'one:C4', 0, voice(1, 1), 1);

        expect(first.active).toHaveProperty('size', 1);
        expect(second.active).toHaveProperty('size', 0);
        first.reset();
        expect(first.active).toHaveProperty('size', 0);
    });

    it('retunes the same held voice through consecutive pitch keys', () => {
        const voices = collection();
        const held = voice(1, 1);
        voices.register('preview', 'preview:C4', 0, held, 1);

        expect(voices.glide('preview', 'preview:C4', 'preview:C#4', 1, 277.18, 0.015)).toBe(true);
        expect(voices.glide('preview', 'preview:C#4', 'preview:D4', 1.1, 293.66, 0.015)).toBe(true);

        expect(held.glide).toHaveBeenNthCalledWith(1, 277.18, 1, 0.015, 'linear');
        expect(held.glide).toHaveBeenNthCalledWith(2, 293.66, 1.1, 0.015, 'linear');
        expect(voices.active).toEqual(new Map([['preview:D4', held]]));
    });
});