import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dialog = readFileSync(fileURLToPath(new URL('./Dialog.svelte', import.meta.url)), 'utf8');

describe('Dialog accessibility', () => {
    it('uses semantic dialog markup, supports keyboard dismissal, and restores focus', () => {
        expect(dialog).toContain('role="dialog"');
        expect(dialog).toContain('aria-modal="true"');
        expect(dialog).toContain('tabindex="-1"');
        expect(dialog).toContain('onkeydown={handleKey}');
        expect(dialog).toMatch(/if \(e\.key === 'Escape'\)\s*\{?\s*close\(\);?/);
        expect(dialog).toContain('opener?.focus()');
        expect(dialog).not.toContain('svelte-ignore a11y');
    });

    it('tracks the conditionally rendered dialog element reactively', () => {
        expect(dialog).toContain('let dialogEl: HTMLDivElement | undefined = $state()');
        expect(dialog).toContain('bind:this={dialogEl}');
    });
});
