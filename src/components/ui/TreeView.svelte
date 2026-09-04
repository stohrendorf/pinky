<script lang="ts">
    import type {
        Snippet
    } from 'svelte';

    import {
        flattenNameTree, type NamedTreeItem
    } from '../../lib/name-tree';
    import ContextMenu from './ContextMenu.svelte';

    interface Props {
        emptyLabel?: string;
        folderActions?: { id: string; label: string; icon?: string }[];
        headerActions?: Snippet;
        itemActions?: { id: string; label: string; icon?: string; disabled?: boolean }[];
        items?: NamedTreeItem[];
        onaction?: (action: string, item: NamedTreeItem) => void;
        onfolderaction?: (action: string, path: string) => void;
        onmute?: (item: NamedTreeItem) => void;
        onselect?: (id: string) => void;
        onsolo?: (item: NamedTreeItem) => void;
        selectedId?: string | null;
        showMuteSolo?: boolean;
        title?: string;
    }

    const {
        emptyLabel = 'No items',
        folderActions = [],
        headerActions,
        itemActions = [],
        items = [],
        onaction = () => {},
        onfolderaction = () => {},
        onmute = () => {},
        onselect = () => {},
        onsolo = () => {},
        selectedId = null,
        showMuteSolo = false,
        title = 'Items'
    }: Props = $props();

    let collapsedFolders = $state(new Set<string>());
    let openMenu: string | null = $state(null);
    let menuAnchor: HTMLElement | null = $state(null);

    const entries = $derived(flattenNameTree(items));
    const visibleEntries = $derived(entries.filter(entry => entry.ancestors.every(path => !collapsedFolders.has(path))));

    function toggleFolder(path: string) {
        const next = new Set(collapsedFolders);
        next.has(path) ? next.delete(path) : next.add(path);
        collapsedFolders = next;
    }

    function select(item: NamedTreeItem) {
        onselect(item.id);
        closeMenu();
    }

    function action(actionId: string, item: NamedTreeItem) {
        onaction(actionId, item);
        closeMenu();
    }

    function folderAction(actionId: string, path: string) {
        onfolderaction(actionId, path);
        closeMenu();
    }

    function closeMenu() {
        openMenu = null;
        menuAnchor = null;
    }

    function toggleMenu(id: string, event: MouseEvent) {
        if (openMenu === id) {
            closeMenu();
            return;
        }
        openMenu = id;
        menuAnchor = event.currentTarget as HTMLElement;
    }
</script>

<div class="tree-view" aria-label={title}>
    <div class="tree-heading">
        <span>{title} <span class="tree-count">{items.length}</span></span>
        <div class="header-actions">
            {@render headerActions?.()}
        </div>
    </div>
    {#if visibleEntries.length}
        <div class="tree-list" role="tree">
            {#each visibleEntries as entry (entry.kind === 'folder' ? `folder-${entry.path}` : entry.item.id)}
                {#if entry.kind === 'folder'}
                    <div
style="--indent: {entry.depth * 16}px"
class="tree-row folder-row"
aria-expanded={!collapsedFolders.has(entry.path)}
                         aria-level={entry.depth + 1}
role="treeitem">
                        <button class="row-main" type="button" on:click={() => toggleFolder(entry.path)}>
                            <span
class="folder-chevron"
class:collapsed={collapsedFolders.has(entry.path)}
                                  aria-hidden="true"></span><i class="fa fa-folder"></i><span>{entry.label}</span><span
class="folder-count"
                                                                                         aria-label={`${entry.itemCount} items`}>{entry.itemCount}</span>
                        </button>
                        {#if folderActions.length}
                            <button
class="dots"
aria-label="Folder actions"
type="button"
                                    on:click={(event) => toggleMenu(`folder:${entry.path}`, event)}><i class="fa fa-ellipsis-vertical"></i></button>
                        {/if}
                    </div>
                {:else}
                    <div
style="--indent: {entry.depth * 16}px"
class="tree-row item-row"
class:selected={entry.item.id === selectedId}
                         aria-level={entry.depth + 1}
aria-selected={entry.item.id === selectedId}
                         role="treeitem">
                        <button class="row-main" type="button" on:click={() => select(entry.item)}>
                            {#if entry.item.color}<span
style="background: {entry.item.color}"
                                                        class="color-tag"></span>{:else}<span class="item-icon"><i class="fa fa-music"></i></span>{/if}<span>{entry.label}</span>
                        </button>
                        {#if showMuteSolo}
                            <button
class="toggle"
class:active={entry.item.mute}
aria-label="{entry.label} mute"
                                    aria-pressed={entry.item.mute}
type="button"
                                    on:click={() => onmute(entry.item)}><i class="fa fa-volume-xmark"></i></button>
                            <button
class="toggle"
class:active={entry.item.solo}
aria-label="{entry.label} solo"
                                    aria-pressed={entry.item.solo}
type="button"
                                    on:click={() => onsolo(entry.item)}><i class="fa fa-headphones"></i></button>
                        {/if}
                        {#if itemActions.length}
                            <button
class="dots"
aria-label="{entry.label} actions"
type="button"
                                    on:click={(event) => toggleMenu(entry.item.id, event)}><i class="fa fa-ellipsis-vertical"></i></button>
                        {/if}
                    </div>
                {/if}
            {/each}
        </div>
    {:else}
        <div class="empty">{emptyLabel}</div>
    {/if}
</div>

<ContextMenu
actions={openMenu?.startsWith('folder:') ? folderActions : itemActions}
anchor={menuAnchor}
             onclose={closeMenu}
onselect={(actionId) => {
    if (openMenu?.startsWith('folder:')) {folderAction(actionId, openMenu.slice('folder:'.length));}
    else {
        const item = items.find(candidate => candidate.id === openMenu);
        if (item) {action(actionId, item);}
    }
}}
open={openMenu !== null}/>

<style>
    .tree-view {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        height: 100%;
        background: var(--color-surface);
        border: 1px solid var(--border);
        border-radius: 2px;
        overflow: hidden;
    }

    .tree-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 7px 8px;
        color: var(--color-text-muted);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: .08em;
        border-bottom: 1px solid var(--border);
    }

    .tree-count {
        color: var(--secondary-text);
    }

    .header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .tree-list {
        overflow: auto;
        padding: 4px;
    }

    .tree-row {
        position: relative;
        display: flex;
        align-items: center;
        min-height: 30px;
        padding-left: var(--indent);
        border-radius: 1px;
    }

    .tree-row:hover {
        background: var(--color-surface-hover);
    }

    .tree-row.selected {
        background: var(--color-accent-soft);
        box-shadow: inset 2px 0 var(--accent);
    }

    .row-main {
        display: flex;
        align-items: center;
        gap: 7px;
        flex: 1;
        min-width: 0;
        padding: 6px 4px;
        overflow: hidden;
        background: transparent;
        border: 0;
        color: var(--primary-text);
        font: inherit;
        font-size: 12px;
        text-align: left;
        cursor: pointer;
    }

    .row-main span:not(.color-tag):not(.item-icon) {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .folder-row {
        color: var(--accent2);
        font-weight: 700;
    }

    .folder-chevron {
        flex: 0 0 6px;
        width: 6px;
        height: 6px;
        margin: 0 2px 2px 1px;
        border-right: 1px solid currentColor;
        border-bottom: 1px solid currentColor;
        color: var(--secondary-text);
        transform: rotate(45deg);
        transition: transform 100ms ease;
    }

    .folder-chevron.collapsed {
        margin-bottom: 0;
        transform: rotate(-45deg);
    }

    .folder-row .row-main i {
        color: var(--secondary-text);
    }

    .folder-count {
        flex: 0 0 auto;
        min-width: 16px;
        padding: 1px 5px;
        border: 1px solid var(--border);
        border-radius: 999px;
        color: var(--secondary-text);
        font-size: 10px;
        font-weight: 600;
        line-height: 14px;
        text-align: center;
    }

    .color-tag {
        flex: 0 0 auto;
        width: 9px;
        height: 9px;
        border-radius: 1px;
    }

    .item-icon {
        width: 9px;
        color: var(--secondary-text);
        font-size: 10px;
    }

    .dots {
        flex: 0 0 28px;
        padding: 4px;
        background: transparent;
        border: 0;
        color: var(--secondary-text);
        cursor: pointer;
    }

    .dots:hover {
        color: var(--accent);
    }

    .toggle {
        flex: 0 0 24px;
        padding: 4px 2px;
        background: transparent;
        border: 0;
        color: var(--secondary-text);
        cursor: pointer;
    }

    .toggle:hover, .toggle.active {
        color: var(--accent);
    }

    .empty {
        padding: 14px 10px;
        color: var(--secondary-text);
        font-size: 11px;
    }
</style>
