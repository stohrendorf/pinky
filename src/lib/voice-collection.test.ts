import {
    describe, expect, it, vi
} from 'vitest';

import {
    type ManagedVoice, VoiceCollection
} from './voice-collection';

function voice(cost: number, level: number): ManagedVoice {
    return {
        cost,
        stopAt: Infinity,
        dead: false,
        loudness: () => level,
        stop: vi.fn(),
        glide: vi.fn(),
        setParams: vi.fn()
    };
}

function collection(maxNodes = 100): VoiceCollection {
    return new VoiceCollection({maxNodes: () => maxNodes, isOffline: () => false});
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


    it('keeps active and live state isolated between collection instances', () => {
        const first = collection();
        const second = collection();
        first.register('one', 'one:C4', 0, voice(1, 1), 1);

        expect(first.active).toHaveProperty('size', 1);
        expect(second.active).toHaveProperty('size', 0);
        first.reset();
        expect(first.active).toHaveProperty('size', 0);
    });
});