import {
    describe, expect, it
} from 'vitest';

import {
    componentMarkup, componentSource, components, hasAttribute, textContent
} from '../test/svelte-semantics';

const toolbar = componentSource(new URL('./TopBar.svelte', import.meta.url));

describe('TopBar demo selection', () => {
    it('offers every bundled demo from the shared library registry', () => {
        expect(toolbar).toContain('DEMO_LIBRARY');
    });

    it('renders the loaded demo with a persistent visual and accessible selected state', () => {
        expect(toolbar).toContain("variant={$activeDemo === d.id ? 'primary' : 'secondary'}");
        expect(toolbar).toContain('pressed={$activeDemo === d.id}');
    });

    it('keeps instrument editing out of the global toolbar', () => {
        expect(toolbar).not.toContain('export let onEditInstrument');
        expect(toolbar).not.toContain('instrument-editor-button');
    });

    it('groups session controls separately from utility controls', () => {
        expect(toolbar).toMatch(/<div class="session-group">[\s\S]*class="transport-controls"/);
        expect(toolbar).toMatch(/class="utility-sidebar"[\s\S]*class="sidebar-column"[\s\S]*class="master-controls"[\s\S]*aria-label="Timing controls"/);
        expect(toolbar).toContain('aria-label="Application utilities"');
    });

    it('links subtly to the source repository from the persistent header', () => {
        expect(toolbar).toMatch(/<a[\s\S]*class="repo-link"[\s\S]*href="https:\/\/github\.com\/stohrendorf\/pinky"/);
        expect(toolbar).toContain('target="_blank"');
        expect(toolbar).toContain('rel="noopener noreferrer"');
        expect(toolbar).toContain('aria-label="View Pinky on GitHub"');
    });

    it('keeps the top bar groups shrinkable within the viewport', () => {
        expect(toolbar).toMatch(/\.topbar-main\s*\{[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;/s);
        expect(toolbar).toMatch(/\.session-group\s*\{[\s\S]*flex:\s*1 1 auto;/s);
        expect(toolbar).toContain('aria-controls="topbar-utilities"');
    });

    it('keeps save confirmation persistent while placing the save action in project utilities', () => {
        const saveAction = components(componentMarkup(toolbar), 'Button').find(button => textContent(button) === 'Save');

        expect(toolbar).toMatch(/<span class="song-label">\{\$songLabel\}<\/span>\s*<span class="saved-flash" aria-live="polite">\{saved\}<\/span>/);
        expect(saveAction).toBeDefined();
        expect(hasAttribute(saveAction!, 'variant', 'secondary')).toBe(true);
        expect(toolbar).not.toContain('Save<span class="saved-flash">');
    });

    it('keeps the save checkmark and label on one line', () => {
        expect(toolbar).toMatch(/\.saved-flash\s*\{[\s\S]*white-space:\s*nowrap;/);
    });

    it('opens one accessible sidebar without utility sub-navigation', () => {
        expect(toolbar).toContain('let utilityExpanded = $state(false)');
        expect(toolbar).toContain('function toggleUtilities');
        expect(toolbar).toContain('id="topbar-utilities" class="utility-sidebar"');
        expect(toolbar).not.toContain('activeMenu');
        expect(toolbar).not.toContain('class="menu-bar"');
        expect(toolbar).not.toContain('class="topbar-menu"');
        expect(toolbar).toMatch(/\.utility-sidebar\s*\{[\s\S]*max-height:\s*calc\(100dvh - 56px\);/s);
    });

    it('uses the Pinky brand as the accessible application-menu button', () => {
        expect(toolbar).toMatch(/<button[\s\S]*class="brand"[\s\S]*aria-controls="topbar-utilities"[\s\S]*aria-expanded=\{utilityExpanded\}/);
        expect(toolbar).toContain('aria-label="Pinky application menu"');
        expect(toolbar).toContain("'Open Pinky application menu'");
        expect(toolbar).not.toContain('<span>Studio</span>');
        expect(toolbar).not.toContain('className="utility-toggle"');
        expect(toolbar).toContain('fa-caret-down');
        expect(toolbar).toMatch(/\.brand\s*\{[\s\S]*border:\s*1px solid var\(--border\);[\s\S]*background:\s*var\(--color-surface-raised\);/s);
        expect(toolbar).toMatch(/\.brand:hover[\s\S]*border-color:\s*var\(--accent\);/s);
    });

    it('uses one desktop layout without mobile-only breakpoints', () => {
        expect(toolbar).not.toContain('@media (max-width:');
    });

    it('uses a distinct equalizer-style icon for the Mixer', () => {
        expect(toolbar).toMatch(/className="mixer-toggle"[\s\S]*fa-chart-simple[\s\S]*Mixer/);
        expect(toolbar).not.toMatch(/className="mixer-toggle"[\s\S]*fa-sliders[\s\S]*Mixer/);
    });

    it('dismisses the application menu cleanly while preserving control interactions', () => {
        expect(toolbar).toContain("document.addEventListener('pointerdown', handleOutsidePointer)");
        expect(toolbar).toContain("document.addEventListener('click', handleOutsidePointer)");
        expect(toolbar).toContain("document.addEventListener('keydown', handleMenuKeydown)");
        expect(toolbar).toContain("document.removeEventListener('pointerdown', handleOutsidePointer)");
        expect(toolbar).toContain("document.removeEventListener('click', handleOutsidePointer)");
        expect(toolbar).toContain("document.removeEventListener('keydown', handleMenuKeydown)");
        expect(toolbar).toContain('utilityMenu?.contains(target)');
        expect(toolbar).toContain("event.key !== 'Escape'");
        expect(toolbar).toContain('closeUtilities(true)');
        expect(toolbar).toContain('runUtilityAction(saveProject)');
        expect(toolbar).toContain('runUtilityAction(() => demo(d.id))');
    });

    it('keeps the sidebar compact and orders sections by relevance', () => {
        expect(toolbar).toMatch(/<IconButton[\s\S]*icon="fa-question-circle"/);
        expect(toolbar).toContain('title="Keyboard shortcuts (?)"');
        expect(toolbar).not.toContain('<span class="menu-heading">Help</span>');
        expect(toolbar).toMatch(/<span class="menu-heading">Project<\/span>[\s\S]*<span class="menu-heading">Render<\/span>/);
        expect(toolbar).toMatch(/<span class="menu-heading">Render<\/span>[\s\S]*<span class="menu-heading">Mix<\/span>[\s\S]*<span class="menu-heading">Timing<\/span>/);
        expect(toolbar).toMatch(/Demo songs[\s\S]*<span class="menu-heading">Performance<\/span>/);
        expect(toolbar).toContain('<span class="menu-heading">Mix</span>');
        expect(toolbar).toContain('<div class="master-controls" aria-label="Master controls">');
        expect(toolbar).toContain('<div class="sidebar-section timing-section" aria-label="Timing controls">');
        expect(toolbar).toContain('<span class="menu-heading">Timing</span>');
        expect(toolbar).not.toContain('<span class="menu-heading">Edit</span>');
        expect(toolbar).toMatch(/\.master-controls\s*\{[\s\S]*flex-direction:\s*column;/s);
        expect(toolbar).toContain('<span class="menu-heading">Performance</span>');
        expect(toolbar).toContain('class="node-budget-control"');
        expect(toolbar).toMatch(/\.sidebar-column\s*\{[\s\S]*flex-direction:\s*column;/s);
        expect(toolbar).not.toContain('grid-column: 1 / -1');
    });
});