import {
    readFileSync
} from 'node:fs';
import {
    fileURLToPath
} from 'node:url';
import {
    describe, expect, it
} from 'vitest';

const app = readFileSync(fileURLToPath(new URL('./App.svelte', import.meta.url)), 'utf8');

describe('workspace controls', () => {
    it('leaves the global top bar free of editor-specific controls', () => {
        expect(app).toContain('<TopBar/>');
        expect(app).not.toContain('class="workspace-heading"');
        expect(app).not.toContain('<h1>Arranger</h1>');
        expect(app).not.toContain('class="instrument-button"');
    });

    it('keeps pattern selection and editing commands inside the pattern editor', () => {
        const topBar = app.indexOf('<TopBar');
        const workspace = app.indexOf('class="workspace-main"');

        expect(topBar).toBeGreaterThan(-1);
        expect(workspace).toBeGreaterThan(topBar);
        expect(app).toMatch(/<PatternBar\s*\/>[\s\S]*<Playlist\b/);
    });

    it('places the compact preset controls in the instrument editor title bar', () => {
        expect(app).toContain("import InstrumentPresetBar from './components/InstrumentPresetBar.svelte'");
        expect(app).toMatch(/<Dialog[^>]*title="Instrument editor"[\s\S]*\{#snippet headerActions\(\)\}[\s\S]*<InstrumentPresetBar\/>/);
    });

    it('keeps the entire instrument editor in one viewport without internal scrolling', () => {
        expect(app).toContain('bodyClass="instrument-editor-body"');
        expect(app).toContain('class="instrument-editor-layout"');
        expect(app).toMatch(/\.instrument-editor-layout\s*\{[\s\S]*grid-template-rows: minmax\(0, 1fr\) 72px;/);
        expect(app).toMatch(/:global\(\.modal-body\.instrument-editor-body\)\s*\{[\s\S]*overflow: hidden;/);
        expect(app).toMatch(/:global\(\.modal-body\.instrument-editor-body\)\s*\{[\s\S]*height: 100%;/);
    });

    it('shares contextual editor ownership between the arranger and piano roll', () => {
        expect(app).toContain('let contextualEditor: string | null = $state(null)');
        expect(app).toContain('<Playlist bind:contextualEditor/>');
        expect(app).toContain('bind:contextualEditor');
        expect(app).toContain('onEditInstrument={() => showInstrumentEditor = true}');
    });

    it('allows the arranger and pattern editor panels to shrink with the viewport', () => {
        expect(app).toMatch(/\.workspace-main\s*\{[\s\S]*min-width:\s*0;/);
        expect(app).toMatch(/\.arranger-panel,\s*\.piano-roll-panel\s*\{[\s\S]*min-width:\s*0;/);
    });

    it('provides a movable divider between the arranger and pattern editor', () => {
        expect(app).toContain('class="split-divider"');
        expect(app).not.toContain('class="split-divider" type="range"');
        expect(app).toContain('role="separator"');
        expect(app).toContain('onpointerdown={startDividerDrag}');
        expect(app).toContain('onpointermove={handleDividerPointerMove}');
        expect(app).toContain('setPointerCapture(event.pointerId)');
        expect(app).toContain('touch-action: none;');
        expect(app).toContain('onkeydown={handleDividerKeydown}');
        expect(app).toContain('style="--arranger-fr: {splitRatio}fr; --editor-fr: {1 - splitRatio}fr;"');
        expect(app).toContain('grid-template-rows: minmax(0, var(--arranger-fr)) 8px minmax(0, var(--editor-fr));');
    });

    it('maps divider pointer positions to all available grid space', () => {
        expect(app).toContain('return Math.max(0, rect.height - verticalPadding * 2 - panelGap * 2 - dividerHeight);');
        expect(app).toContain('const arrangerHeight = dividerCenter - verticalPadding - panelGap - dividerHeight / 2;');
        expect(app).toContain('const clampedArrangerHeight = Math.max(0, Math.min(flexibleHeight, arrangerHeight));');
        expect(app).toContain('splitRatio = clampedArrangerHeight / flexibleHeight;');
        expect(app).toContain('--arranger-fr');
    });

    it('lets the full available grid range bound divider movement', () => {
        expect(app).toContain('splitRatio = Math.max(0, Math.min(1, value / 100));');
        expect(app).toMatch(/aria-valuemax="100"[\s\S]*aria-valuemin="0"/);
        expect(app).toContain('setSplit(0);');
        expect(app).toContain('setSplit(100);');
    });
});