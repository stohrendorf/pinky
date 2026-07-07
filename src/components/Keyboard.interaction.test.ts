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

describe('Keyboard live preview', () => {
    it('keeps Space auditioning active from range sliders while text entry retains keyboard ownership', () => {
        expect(keyboard).toContain("target instanceof HTMLInputElement && target.type !== 'range'");
        expect(keyboard).toContain("if (e.key === ' ' && !isTextEntry(e))");
    });
});