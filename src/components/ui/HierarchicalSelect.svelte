<script lang="ts">
    import { flattenNameTree, type NamedTreeItem } from '../../lib/name-tree';

    interface Props {
        items?: NamedTreeItem[];
        selectedId?: string | null;
        ariaLabel?: string;
        emptyLabel?: string;
        minimal?: boolean;
        onselect?: (id: string) => void;
    }

    const {
        items = [],
        selectedId = null,
        ariaLabel = 'Select item',
        emptyLabel = 'No items',
        minimal = false,
        onselect = () => {},
    }: Props = $props();

    let open = $state(false);
    let collapsedPaths = $state(new Set<string>());

    const entries = $derived(flattenNameTree(items));
    const selected = $derived(items.find(item => item.id === selectedId) || items[0]);
    const visibleEntries = $derived(
        entries.filter(entry => entry.ancestors.every(path => !collapsedPaths.has(path))),
    );

    function choose(id: string) {
        onselect(id);
        open = false;
    }

    function toggleFolder(path: string) {
        const next = new Set(collapsedPaths);
        next.has(path) ? next.delete(path) : next.add(path);
        collapsedPaths = next;
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            open = false;
        }
    }
</script>

<div class="tree-select" class:minimal class:open>
    <button
        class="tree-trigger"
        aria-expanded={open}
        aria-haspopup="tree"
        aria-label={ariaLabel}
        onclick={() => (open = !open)}
        type="button"
    >
        {#if selected?.color}
            <span style="background: {selected.color}" class="color-tag"></span>
        {/if}
        <span class="selected-name">{selected?.name || emptyLabel}</span>
        <i class="fa fa-chevron-{open ? 'up' : 'down'}"></i>
    </button>

    {#if open}
        <div
            class="tree-menu"
            aria-label={ariaLabel}
            onkeydown={handleKeydown}
            role="tree"
            tabindex="-1"
        >
            {#each visibleEntries as entry (entry.kind === 'folder' ? `folder-${entry.path}` : entry.item.id)}
                {#if entry.kind === 'folder'}
                    <button
                        style="--indent: {entry.depth * 18}px"
                        class="tree-row folder-row"
                        aria-expanded={!collapsedPaths.has(entry.path)}
                        aria-level={entry.depth + 1}
                        aria-selected="false"
                        onclick={() => toggleFolder(entry.path)}
                        role="treeitem"
                        type="button"
                    >
                        <i class="fa fa-chevron-{collapsedPaths.has(entry.path) ? 'right' : 'down'}"
                        ></i>
                        <i class="fa fa-folder"></i>
                        <span>{entry.label}</span>
                    </button>
                {:else}
                    <button
                        style="--indent: {entry.depth * 18}px"
                        class="tree-row item-row"
                        class:selected={entry.item.id === selected?.id}
                        aria-level={entry.depth + 1}
                        aria-selected={entry.item.id === selected?.id}
                        onclick={() => choose(entry.item.id)}
                        role="treeitem"
                        type="button"
                    >
                        {#if entry.item.color}
                            <span style="background: {entry.item.color}" class="color-tag"></span>
                        {/if}
                        <span>{entry.label}</span>
                    </button>
                {/if}
            {/each}
        </div>
    {/if}
</div>

<style>
    .tree-select {
        position: relative;
        min-width: 0;
    }

    .tree-trigger,
    .tree-row {
        border: 1px solid var(--border);
        color: var(--primary-text);
        font: inherit;
        cursor: pointer;
    }

    .tree-trigger {
        display: flex;
        align-items: center;
        gap: 7px;
        width: 100%;
        min-width: 0;
        padding: 6px 8px;
        background: var(--color-surface-raised);
        border-radius: 4px;
        text-align: left;
    }

    .tree-trigger:hover,
    .tree-select.open .tree-trigger {
        border-color: var(--accent);
        background: var(--color-surface-hover);
    }

    .tree-select.minimal .tree-trigger {
        padding: 5px 2px;
        background: transparent;
        border-color: transparent;
    }

    .tree-select.minimal .tree-trigger:hover,
    .tree-select.minimal.open .tree-trigger {
        border-color: transparent;
        background: transparent;
        color: var(--accent);
    }

    .selected-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .tree-trigger > i {
        margin-left: auto;
        color: var(--secondary-text);
        font-size: 10px;
    }

    .tree-menu {
        position: absolute;
        z-index: 100;
        top: calc(100% + 4px);
        left: 0;
        width: max-content;
        min-width: max(100%, 220px);
        max-width: min(360px, calc(100vw - 24px));
        max-height: min(320px, 50dvh);
        overflow: auto;
        padding: 4px;
        background: var(--color-surface);
        border: 1px solid var(--border);
        border-radius: 5px;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
    }

    .tree-row {
        display: flex;
        align-items: center;
        gap: 7px;
        width: 100%;
        min-width: 200px;
        padding: 6px 8px 6px calc(8px + var(--indent));
        background: transparent;
        border-color: transparent;
        border-radius: 3px;
        text-align: left;
        font-size: 12px;
    }

    .tree-row:hover,
    .tree-row.selected {
        background: var(--color-surface-hover);
    }

    .folder-row {
        color: var(--accent2);
        font-weight: 700;
    }

    .folder-row > i:first-child {
        width: 8px;
        color: var(--secondary-text);
        font-size: 9px;
    }

    .color-tag {
        flex: 0 0 auto;
        width: 9px;
        height: 9px;
        border-radius: 3px;
    }
</style>
