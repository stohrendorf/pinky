import {
    describe, expect, it
} from 'vitest';

import {
    bindingForCode, COMPUTER_KEY_BINDINGS, computerKeySource, HeldNoteSources, learnKeyboardLabel, MAX_PREVIEW_OCTAVE, MIN_PREVIEW_OCTAVE
} from './computer-keyboard';

describe('computer keyboard preview mapping', () => {
    it('keeps notes on physical piano positions when Y and Z are swapped', () => {
        expect(bindingForCode('KeyZ', 5)).toEqual({code: 'KeyZ', character: 'z', note: 'C5'});
        expect(bindingForCode('KeyY', 5)).toEqual({code: 'KeyY', character: 'y', note: 'A6'});
        expect(bindingForCode('z', 5)).toBeNull();
        expect(bindingForCode('Space', 5)).toBeNull();
    });

    it('learns Firefox event labels and swaps the paired on-screen labels', () => {
        const labels = new Map(COMPUTER_KEY_BINDINGS.map(binding => [binding.code, binding.character]));
        learnKeyboardLabel(labels, 'KeyZ', 'y');
        expect(labels.get('KeyZ')).toBe('y');
        expect(labels.get('KeyY')).toBe('z');
    });

    it('pairs key-up with key-down even if a layout modifier changes the reported character', () => {
        expect(computerKeySource('2', 'Digit2')).toBe(computerKeySource('é', 'Digit2'));
        expect(computerKeySource('z', '')).toBe('key:z');
    });

    it('provides displayable characters for both mapped octaves', () => {
        const labels: Record<string, string> = {};
        for (const binding of COMPUTER_KEY_BINDINGS) {
            const mapped = bindingForCode(binding.code, 5);
            if (mapped) {labels[mapped.note] = binding.character;}
        }
        expect(labels.C5).toBe('z');
        expect(labels['C#5']).toBe('s');
        expect(labels.C6).toBe('q');
        expect(labels.B6).toBe('u');
    });

    it('keeps a three-octave preview inside C2 through B8', () => {
        expect(MIN_PREVIEW_OCTAVE).toBe(3);
        expect(MAX_PREVIEW_OCTAVE).toBe(7);
        expect([MIN_PREVIEW_OCTAVE - 1, MAX_PREVIEW_OCTAVE + 1]).toEqual([2, 8]);
    });
});

describe('held preview note sources', () => {
    it('ignores duplicate source presses and starts a shared voice only once', () => {
        const held = new HeldNoteSources();
        const voice = {instrumentId: 'bass', note: 'C5'};

        expect(held.hold('key:z', voice)).toBe(true);
        expect(held.hold('key:z', voice)).toBe(false);
        expect(held.hold('pointer', voice)).toBe(false);
        expect(held.release('key:z')).toBeNull();
        expect(held.release('pointer')).toEqual(voice);
    });

    it('releases the instrument that started each voice and drains each voice once', () => {
        const held = new HeldNoteSources();
        held.hold('key:z', {instrumentId: 'first', note: 'C5'});
        held.hold('key:x', {instrumentId: 'second', note: 'D5'});
        held.hold('pointer', {instrumentId: 'first', note: 'C5'});

        expect(held.drain()).toEqual([
            {instrumentId: 'first', note: 'C5'},
            {instrumentId: 'second', note: 'D5'}
        ]);
        expect(held.activeNotes()).toEqual([]);
    });
});