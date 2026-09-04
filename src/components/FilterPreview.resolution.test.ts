import {
    readFileSync
} from 'node:fs';
import {
    fileURLToPath
} from 'node:url';
import {
    describe, expect, it
} from 'vitest';

const preview = readFileSync(fileURLToPath(new URL('./FilterPreview.svelte', import.meta.url)), 'utf8');

describe('FilterPreview', () => {
    it('uses a dense response curve so narrow resonances remain visible', () => {
        expect(preview).toContain('const RESPONSE_POINTS = 360;');
        expect(preview).toContain('audioSampleRate');
        expect(preview).toContain('filterResponseCurve(params, note, RESPONSE_POINTS, audioSampleRate())');
        expect(preview).toContain('const frequencyRange = $derived(Math.max(1, Math.log(maxFrequency / minFrequency)));');
        expect(preview).toContain('Math.log(frequency / minFrequency) / frequencyRange');
        expect(preview).toContain('const x = frequencyX(point.frequency);');
    });

    it('keeps the preview focused on the curve without a redundant caption', () => {
        expect(preview).not.toContain('filter-caption');
        expect(preview).not.toContain('pink-source spectrum');
    });

    it('scales the plotted response to its measured range instead of clipping quiet values', () => {
        expect(preview).toContain('const responseDb = $derived(response.map(point => db(point.magnitude)));');
        expect(preview).toContain('const minDb = $derived(Math.min(...responseDb));');
        expect(preview).toContain('const maxDb = $derived(Math.max(...responseDb));');
        expect(preview).toContain('const y = yForDb(db(point.magnitude));');
    });

    it('keeps the moved curve tall enough to read its response shape', () => {
        expect(preview).toMatch(/svg\s*\{[\s\S]*height: 104px;/);
    });

    it('keeps its input props reactive so parameter changes redraw the curve immediately', () => {
        expect(preview).toContain("let { params, note = 'C4' }: Props = $props();");
    });
});