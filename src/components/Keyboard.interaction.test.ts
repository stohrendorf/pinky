import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const keyboard = readFileSync(fileURLToPath(new URL('./Keyboard.svelte', import.meta.url)), 'utf8');

describe('Keyboard live preview', () => {
    it('keeps Space auditioning active from range sliders while text entry retains keyboard ownership', () => {
        expect(keyboard).toContain("target instanceof HTMLInputElement && target.type !== 'range'");
        expect(keyboard).toContain("if (e.key === ' ' && !isTextEntry(e))");
    });

    it('uses physical positions for pitch and learns the active layout labels from Firefox events', () => {
        expect(keyboard).toContain('bindingForCode(e.code, octave)');
        expect(keyboard).toContain('learnKeyboardLabel(computerLabels, e.code, e.key)');
        expect(keyboard).toContain('computerKeySource(e.key, e.code)');
        expect(keyboard).toContain('loadKeyboardLayout');
        expect(keyboard).not.toContain('bindingForCharacter(e.key');
    });

    it('releases every held source on range changes, blur, and teardown', () => {
        expect(keyboard).toMatch(/function changeOctave[\s\S]*releaseAll\(\)/);
        expect(keyboard).toContain('onblur={releaseAll}');
        expect(keyboard).toContain('onDestroy(releaseAll)');
    });

    it('tracks character key-up by source so octave changes cannot release the wrong note', () => {
        expect(keyboard).toContain('releaseSource(computerKeySource(e.key, e.code))');
        expect(keyboard).toContain('press(POINTER_SOURCE, name)');
    });
});
