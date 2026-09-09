import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const treeView = readFileSync(fileURLToPath(new URL('./TreeView.svelte', import.meta.url)), 'utf8');
const contextMenu = readFileSync(
    fileURLToPath(new URL('./ContextMenu.svelte', import.meta.url)),
    'utf8',
);

describe('TreeView contextual menus and folders', () => {
    it('dismisses menus globally and keeps one menu state per tree view', () => {
        expect(treeView).toContain("import ContextMenu from './ContextMenu.svelte';");
        expect(treeView).toMatch(/let openMenu: string \| null = \$state\(null\);/);
        expect(treeView).toContain('menuAnchor');
        expect(contextMenu).toMatch(/position:\s*fixed/);
        expect(contextMenu).toContain('onclickcapture={handleWindowClick}');
    });

    it('renders folder state and recursive item counts', () => {
        expect(treeView).toContain('let collapsedFolders = $state(new Set<string>());');
        expect(treeView).toContain('const next = new Set(collapsedFolders);');
        expect(treeView).toMatch(
            /class="folder-chevron"[\s\S]*class:collapsed=\{collapsedFolders\.has\(entry\.path\)\}/,
        );
        expect(treeView).toContain('.folder-chevron.collapsed');
        expect(treeView).toContain('aria-expanded={!collapsedFolders.has(entry.path)}');
        expect(treeView).not.toContain('collapsedPaths');
        expect(treeView).toContain('entry.itemCount');
        expect(treeView).toContain('class="folder-count"');
    });
});
