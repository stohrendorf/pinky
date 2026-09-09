import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const editor = readFileSync(
    fileURLToPath(new URL('./HarmonicsEditor.svelte', import.meta.url)),
    'utf8',
);

describe('HarmonicsEditor', () => {
    it('provides an accessible numeric field for every partial level', () => {
        expect(editor).toMatch(
            /class="level-input"[\s\S]*max="1"[\s\S]*min="0"[\s\S]*step="0\.01"[\s\S]*type="number"/,
        );
        expect(editor).toMatch(/onchange=\{e => setLevel\(i, parseFloat/);
    });

    it('renders partial levels as capped drawbars', () => {
        expect(editor).toContain('class="drawbar-track"');
        expect(editor).toContain('class="drawbar-fill"');
        expect(editor).toContain('class="drawbar-cap"');
    });
});
