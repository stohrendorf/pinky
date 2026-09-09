import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const bar = readFileSync(
    fileURLToPath(new URL('./InstrumentPresetBar.svelte', import.meta.url)),
    'utf8',
);

describe('InstrumentPresetBar', () => {
    it('keeps the preset picker and its commands compact enough for the editor title bar', () => {
        expect(bar).toContain('class="preset-title-controls"');
        expect(bar).toMatch(
            /<select[\s\S]*aria-label="Select preset"[\s\S]*bind:value=\{presetName\}/,
        );
        expect(bar).toContain('ariaLabel="Apply selected preset"');
        expect(bar).toContain('ariaLabel="Save selected instrument as a preset"');
        expect(bar).toContain('ariaLabel="Create an instrument from this preset"');
    });

    it('only exposes the destructive preset control for a saved user preset', () => {
        expect(bar).toMatch(/\{#if isUserPreset\}[\s\S]*ariaLabel="Delete selected preset"/);
    });
});
