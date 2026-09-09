import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const prompt = readFileSync(fileURLToPath(new URL('./Prompt.svelte', import.meta.url)), 'utf8');

describe('Prompt', () => {
    it('focuses and selects the initial value when it opens', () => {
        expect(prompt).toMatch(
            /function selectOnMount[\s\S]*node\.focus\(\)[\s\S]*node\.select\(\)/,
        );
        expect(prompt).toContain('use:selectOnMount');
    });
});
