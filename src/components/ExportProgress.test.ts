import {
    readFileSync
} from 'node:fs';
import {
    fileURLToPath
} from 'node:url';
import {
    compile
} from 'svelte/compiler';
import {
    render
} from 'svelte/server';
import {
    describe, expect, it, vi
} from 'vitest';

import type {
    ExportProgressState
} from '../lib/render';

import ExportProgress from './ExportProgress.svelte';

const current = vi.hoisted(() => ({value: null as ExportProgressState | null}));
vi.mock('../lib/render', () => ({
    exportProgress: {subscribe: (run: (value: ExportProgressState | null) => void) => {
        run(current.value);
        return () => {};
    }},
    cancelExport: vi.fn(), dismissExportError: vi.fn(), exportWav: vi.fn()
}));

function markup(state: ExportProgressState): string {
    current.value = state;
    return render(ExportProgress).body;
}

describe('export progress modal', () => {
    it('compiles the native modal without accessibility warnings', () => {
        const source = readFileSync(fileURLToPath(new URL('./ExportProgress.svelte', import.meta.url)), 'utf8');
        const result = compile(source, {filename: 'ExportProgress.svelte', generate: 'client'});
        expect(result.js.code.length).toBeGreaterThan(0);
        expect(result.warnings.filter(warning => warning.code.startsWith('a11y'))).toEqual([]);
    });

    it.each([null, 0, 0.45, 1])('explains non-suspendable cancellation at progress %s', progress => {
        const state: ExportProgressState = {stage: 'rendering', progress, cancelling: false, canSuspend: false};
        const active = markup(state);
        expect(active).toContain('Cancellation waits for rendering to finish.');
        expect(active).not.toContain('cannot pause rendering or report');
        const cancelled = markup({...state, cancelling: true});
        expect(cancelled).toContain('Cancelling — waiting for this browser to finish rendering…');
        expect(cancelled).toContain('No file is downloaded after cancellation.');
    });

    it.each([true, undefined])('does not infer suspension support from null progress (%s)', canSuspend => {
        const html = markup({stage: 'rendering', progress: null, cancelling: true, canSuspend});
        expect(html).toContain('Cancelling — waiting for audio to stop…');
        expect(html).not.toContain('Cancellation waits for rendering to finish.');
    });

    it('distinguishes waiting for telemetry from graph initialization', () => {
        expect(markup({stage: 'rendering', progress: null, cancelling: false, canSuspend: false}))
            .toContain('Waiting for audio progress…');
        expect(markup({stage: 'preparing', progress: null, cancelling: false}))
            .toContain('Initializing the audio graph…');
    });

    it('labels the ETA as approximate and stage-local and hides it during cancellation or errors', () => {
        const state: ExportProgressState = {stage: 'rendering', progress: 0.45, cancelling: false, etaSeconds: 125};
        const html = markup(state);
        expect(html).toContain('45% of this stage');
        expect(html).toContain('Approx. 2 min left in this stage');
        expect(markup({...state, cancelling: true})).not.toContain('left in this stage');
        expect(markup({...state, stage: 'error', error: 'Render failed'})).not.toContain('left in this stage');
        expect(markup({...state, etaSeconds: null})).not.toContain('left in this stage');
    });
});