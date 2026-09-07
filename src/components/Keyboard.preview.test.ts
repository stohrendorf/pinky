import {
    readFileSync
} from 'node:fs';
import {
    fileURLToPath
} from 'node:url';
import {
    compile
} from 'svelte/compiler';
import {
    describe, expect, it
} from 'vitest';

const keyboard = readFileSync(fileURLToPath(new URL('./Keyboard.svelte', import.meta.url)), 'utf8');

describe('Keyboard editor preview', () => {
    it('compiles without accessibility diagnostics', () => {
        const result = compile(keyboard, {filename: 'Keyboard.svelte', generate: 'client'});
        expect(result.warnings.filter(warning => warning.code.startsWith('a11y'))).toEqual([]);
    });

    it('renders a bounded octave-centered range with discoverable controls and key labels', () => {
        expect(keyboard).toContain('MIN_PREVIEW_OCTAVE');
        expect(keyboard).toContain('MAX_PREVIEW_OCTAVE');
        expect(keyboard).toContain('aria-label="Octave down"');
        expect(keyboard).toContain('aria-label="Octave up"');
        expect(keyboard).toContain('Range C{octave - 1}–B{octave + 1}');
        expect(keyboard).toContain('computer-key');
        expect(keyboard).not.toContain('NOTES.map');
    });
    it('holds the replayed note for the Space key press without leaking to transport', () => {
        expect(keyboard).toMatch(/function replayLastNote\(\)[\s\S]*get\(lastPlayedPitch\)/);
        expect(keyboard).toMatch(/if \(e\.key === ' ' && !isTextEntry\(e\)\) \{[\s\S]*e\.preventDefault\(\)[\s\S]*e\.stopPropagation\(\)[\s\S]*if \(!e\.repeat\) \{[\s\S]*spaceHeld = true;[\s\S]*replayLastNote\(\)/);
        expect(keyboard).toMatch(/function onKeyup[\s\S]*e\.key === ' '[\s\S]*releaseLastNote\(\)/);
        expect(keyboard).toContain('onkeydowncapture={onKeydown}');
    });

    it('leaves Space available only when a text-entry control has focus', () => {
        expect(keyboard).toMatch(/function isTextEntry[\s\S]*target instanceof HTMLInputElement && target\.type !== 'range'[\s\S]*target\.isContentEditable/);
    });

    it('releases the replayed note when Space is released and when the editor closes', () => {
        expect(keyboard).toMatch(/function releaseLastNote\(\)[\s\S]*releaseSource\(SPACE_SOURCE\)/);
        expect(keyboard).toMatch(/onDestroy\(releaseAll\)/);
    });
});