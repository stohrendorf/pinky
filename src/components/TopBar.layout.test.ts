import {
    readFileSync
} from 'node:fs';
import {
    fileURLToPath
} from 'node:url';
import {
    describe, expect, it
} from 'vitest';

const toolbar = readFileSync(fileURLToPath(new URL('./TopBar.svelte', import.meta.url)), 'utf8');

describe('TopBar demo selection', () => {
    it('offers Amber Hours in the bundled demo library', () => {
        expect(toolbar).toContain('DEMO_LIBRARY');
    });

    it('offers Prism Circuit as the expressive showcase demo', () => {
        expect(toolbar).toContain('DEMO_LIBRARY');
    });

    it('offers Bit Horizon as the chiptune showcase demo', () => {
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
        expect(toolbar).toContain('ariaControls="topbar-utilities"');
    });

    it('shows save confirmation in the persistent top bar rather than the Studio sidebar', () => {
        expect(toolbar).toMatch(/<span class="song-label">\{\$songLabel\}<\/span>\s*<span class="saved-flash" aria-live="polite">\{saved\}<\/span>/);
        expect(toolbar).toContain('<Button variant="secondary" on:click={saveProject}><i class="fa fa-save"></i> Save</Button>');
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