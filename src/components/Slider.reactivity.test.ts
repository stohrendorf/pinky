import {
    readFileSync
} from 'node:fs';
import {
    fileURLToPath
} from 'node:url';
import {
    describe, expect, it
} from 'vitest';

const slider = readFileSync(fileURLToPath(new URL('./Slider.svelte', import.meta.url)), 'utf8');

describe('Slider', () => {
    it('keeps its value prop reactive for external updates', () => {
        expect(slider).toContain('let {');
        expect(slider).toContain('value,');
        expect(slider).not.toContain('const {\n        label,');
        expect(slider).not.toContain('$state(value)');
    });
});