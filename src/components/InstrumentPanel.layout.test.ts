import {
    describe, expect, it
} from 'vitest';

import {
    componentMarkup, componentSource, eachBlocks, elements, hasAttribute
} from '../test/svelte-semantics';

const panel = componentSource(new URL('./InstrumentPanel.svelte', import.meta.url));
const slider = componentSource(new URL('./Slider.svelte', import.meta.url));

describe('InstrumentPanel guided editing', () => {
    it('keeps slider value labels reactive after an instrument parameter changes', () => {
        const range = elements(componentMarkup(slider), 'input').find(input => hasAttribute(input, 'type', 'range'));

        expect(range).toBeDefined();
        expect(hasAttribute(range!, 'value')).toBe(true);
        expect(slider).toContain('onchange(parseFloat((event.target as HTMLInputElement).value));');
        expect(slider).toContain('{value}{unit}');
        expect(slider).toContain('{value}>');
        expect(panel).toContain('function setParam(id: NumericParam, v: number)');
        expect(panel).toContain('project.update(current => current ? {');
        expect(panel).toContain('instruments: current.instruments.map(instrument => instrument.id === instrumentId ? {');
        expect(panel).toContain('params: {...instrument.params, [id]: v}');
    });
    it('keeps starter controls together and organizes specialist controls into named editor tabs', () => {
        expect(panel).toMatch(/const STARTER_PANEL_TITLES = \['EQ Voice', 'Envelope', 'Mix'\]/);
        expect(panel).toMatch(/const ADVANCED_PANEL_TITLES = \['Percussion', 'Formants \(vowel\)', 'Vibrato', 'Unison', 'Legato'\]/);
        expect(panel).toMatch(/const EDITOR_TABS = \[/);
        expect(panel).toContain('class="editor-tabs"');
        expect(panel).toContain('role="tablist"');
        expect(panel).toMatch(/activeTab === 'voice'/);
        expect(panel).toMatch(/activeTab === 'advanced'/);
        expect(panel).toMatch(/activeTab === 'harmonics'/);
        expect(panel).toMatch(/<HarmonicsEditor\b(?=[^>]*\bparams=\{inst\.params\})(?=[^>]*\bonchange=\{touch\})[^>]*\/>/);
    });

    it('places focused help beside control headers instead of hiding it in the general help dialog', () => {
        expect(panel).toContain('const CONTROL_HELP');
        expect(panel).toContain("'Formants (vowel)'");
        expect(panel).toContain("'Percussion'");
        expect(panel).toContain('class="group-heading"');
        expect(panel).toContain('class="control-help"');
        expect(panel).toContain('aria-label={`Learn about ${panel.title}`}');
        expect(panel).toContain('aria-label="Learn about Harmonics"');
        expect(panel).toContain('title={CONTROL_HELP[contextualHelp].title}');
    });

    it('keeps every focused help topic concise while offering an optional deeper explanation', () => {
        const deepDive = elements(componentMarkup(panel), 'details').find(element => hasAttribute(element, 'class', 'contextual-deep-dive'));

        expect(panel).toContain('class="contextual-deep-dive"');
        expect(panel).toContain('{CONTROL_HELP[contextualHelp].deepTitle}');
        expect(deepDive).toBeDefined();
        expect(eachBlocks([deepDive!]).flatMap(block => elements(block.body?.nodes ?? [], 'p'))).toHaveLength(1);
        expect(panel).toContain('Go deeper: how a filter can suggest a voice');
        expect(panel).toContain('Go deeper: noise, impact, and pitch motion');
        expect(panel).toContain('Go deeper: why the same sound can feel like a different instrument');
        expect(panel).toContain('Go deeper: movement needs a reason');
        expect(panel).toContain('Go deeper: shaping a slide in time');
        expect(panel).toContain('Go deeper: why instruments sound different');
        expect(panel).toContain('The ear uses the balance of those partials');
        expect(panel).toContain('A clarinet-like sound emphasizes odd partials');
        expect(panel).toContain('organ does not need a vibrating string or tube');
    });

    it('selects instruments with the shared hierarchical picker instead of a permanent flat list', () => {
        expect(panel).toContain("import HierarchicalSelect from './ui/HierarchicalSelect.svelte'");
        expect(panel).toContain('items={$project?.instruments ?? []}');
        expect(panel).toContain('minimal');
        expect(panel).toContain('selectedId={inst?.id}');
        expect(panel).not.toContain('class="inst-list"');
    });

    it('keeps instrument identity commands separate from title-bar preset controls', () => {
        expect(panel).toMatch(/class="instrument-actions"/);
        expect(panel).toContain('ariaLabel="Rename Instrument"');
        expect(panel).toContain('ariaLabel="Delete Instrument"');
        expect(panel).not.toContain('class="preset-toolbar"');
    });

    it('uses shared compact button variants for mute and solo controls', () => {
        expect(panel).toContain("variant={inst.mute ? 'danger' : 'secondary'}");
        expect(panel).toContain("variant={inst.solo ? 'primary' : 'secondary'}");
        expect(panel).toContain('fa fa-volume-xmark');
        expect(panel).toContain('fa fa-headphones');
        expect(panel).not.toContain(':global(.ms)');
    });

    it('uses the keyboard rather than a dedicated preview button to audition the last note', () => {
        expect(panel).not.toContain('Preview</Button>');
        expect(panel).not.toContain("const PREVIEW_NOTE = 'C5'");
    });

    it('keeps the filter response visible beside every editor tab', () => {
        expect(panel).toContain("import FilterPreview from './FilterPreview.svelte'");
        expect(panel).toMatch(/<div class="tab-content">[\s\S]*<div class="tab-controls">[\s\S]*<aside class="sound-overview">/);
        expect(panel).toMatch(/<FilterPreview\b(?=[^>]*\bnote=\{\$lastPlayedPitch\})(?=[^>]*\bparams=\{inst\.params\})[^>]*\/>/);
        expect(panel).toMatch(/\.tab-content\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(240px, 32%\);/);
    });

    it('keeps output mix controls separate from the ADSR envelope', () => {
        expect(panel).toMatch(/const STARTER_PANEL_TITLES = \['EQ Voice', 'Envelope', 'Mix'\]/);
    });

    it('provides a reusable instrument-level legato transition default in Motion', () => {
        expect(panel).toContain('aria-label="Default legato curve"');
        expect(panel).toContain('function setLegatoCurve');
        expect(panel).toContain("panel.title === 'Legato'");
    });

    it('reserves a fixed tab-header row so tab content cannot move it', () => {
        expect(panel).toContain('class="tab-content"');
        expect(panel).toMatch(/\.inst-panel\s*\{[\s\S]*grid-template-rows: auto auto 42px minmax\(0, 1fr\);/);
        expect(panel).toMatch(/\.inst-panel\s*\{[\s\S]*height: 100%;/);
        expect(panel).toMatch(/\.tab-content\s*\{[\s\S]*overflow: visible;/);
        expect(panel).toMatch(/\.editor-tabbar\s*\{[\s\S]*height: 42px;/);
        expect(panel).toMatch(/\.starter-controls\s*\{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
    });
});