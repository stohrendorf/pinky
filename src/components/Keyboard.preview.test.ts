import {
    readFileSync
} from 'node:fs';
import {
    fileURLToPath
} from 'node:url';
import {
    describe, expect, it
} from 'vitest';

const keyboard = readFileSync(fileURLToPath(new URL('./Keyboard.svelte', import.meta.url)), 'utf8');

describe('Keyboard editor preview', () => {
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
        expect(keyboard).toMatch(/function releaseLastNote\(\)[\s\S]*release\(replayName\)/);
        expect(keyboard).toMatch(/onDestroy\(\(\) => \{[\s\S]*releaseLastNote\(\)/);
    });
});