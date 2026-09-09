import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const confirm = readFileSync(fileURLToPath(new URL('./Confirm.svelte', import.meta.url)), 'utf8');

describe('Confirm', () => {
    it('makes destructive confirmations visually distinct and keeps cancellation secondary', () => {
        expect(confirm).toContain('destructive = false');
        expect(confirm).toContain('fa-triangle-exclamation');
        expect(confirm).toMatch(/<Button[^>]*onclick=\{cancel}[^>]*>Cancel<\/Button>/);
        expect(confirm).toContain("variant={destructive ? 'danger' : 'primary'}");
    });

    it('uses a caller-supplied action label instead of a generic confirmation', () => {
        expect(confirm).toContain("confirmLabel = 'Confirm'");
        expect(confirm).toMatch(/\{confirmLabel}\s*<\/Button\s*>/);
        expect(confirm).not.toContain('>Yes</Button>');
    });
});
