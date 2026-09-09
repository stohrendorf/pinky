import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const automationLane = readFileSync(
    fileURLToPath(new URL('./AutomationLane.svelte', import.meta.url)),
    'utf8',
);

describe('AutomationLane selection workflow', () => {
    it('clears the arranger-wide selected point before adding another point', () => {
        expect(automationLane).toContain('hasSelectedPoint?: boolean');
        expect(automationLane).toContain('if (hasSelectedPoint) {');
        expect(automationLane).toContain('onselect(null);');
        expect(automationLane.indexOf('if (hasSelectedPoint) {')).toBeLessThan(
            automationLane.indexOf('const pt: AutomationPoint'),
        );
    });
});
