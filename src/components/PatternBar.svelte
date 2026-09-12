<script lang="ts">
    import type {NamedTreeItem} from '../lib/name-tree';
    import type {Pattern} from '../lib/types';

    import {STEPS} from '../lib/notes';
    import {createPattern, project, renamePattern, selPatId, touch} from '../lib/project';
    import ColorPicker from './ui/ColorPicker.svelte';
    import Confirm from './ui/Confirm.svelte';
    import Dialog from './ui/Dialog.svelte';
    import Prompt from './ui/Prompt.svelte';
    import TreeView from './ui/TreeView.svelte';

    const pat = $derived(
        ($project?.patterns.find(p => p.id === $selPatId) || $project?.patterns[0]) as Pattern,
    );

    let showRename = $state(false);
    let renameValue = $state('');
    let renameTargetId: string | null = $state(null);

    let showConfirmDelete = $state(false);
    let showColor = $state(false);

    const itemActions = [
        { id: 'rename', label: 'Rename', icon: 'fa-pencil' },
        { id: 'color', label: 'Pattern color', icon: 'fa-palette' },
        { id: 'duplicate', label: 'Duplicate', icon: 'fa-clone' },
        { id: 'clear', label: 'Clear notes', icon: 'fa-broom' },
        { id: 'delete', label: 'Delete', icon: 'fa-trash' },
    ];

    function add() {
        if (!$project) {
            return;
        }
        const np = createPattern('pattern ' + ($project.patterns.length + 1));
        $project.patterns = [...$project.patterns, np];
        selPatId.set(np.id);
    }

    function duplicate() {
        if (!$project) {
            return;
        }
        const np = createPattern(pat.name + ' copy', pat.steps || STEPS);
        np.tracks = Object.fromEntries(
            Object.entries(pat.tracks).map(([id, notes]) => [id, notes.map(n => ({ ...n }))]),
        );
        $project.patterns = [...$project.patterns, np];
        selPatId.set(np.id);
    }

    function openRename(pattern: Pattern = pat) {
        renameTargetId = pattern.id;
        renameValue = pattern.name;
        showRename = true;
    }

    function onRename(value: string) {
        if (value && renameTargetId) {
            renamePattern(renameTargetId, value);
        }
        renameTargetId = null;
    }

    function clearPat() {
        Object.keys(pat.tracks).forEach(id => (pat.tracks[id] = []));
        touch();
    }

    function remove() {
        if (!$project || $project.patterns.length <= 1) {
            return;
        }
        showConfirmDelete = true;
    }

    function onConfirmDelete() {
        if (!$project) {
            return;
        }
        const id = pat.id;
        $project.arrangement = $project.arrangement.filter(s => s.patternId !== id);
        $project.patterns = $project.patterns.filter(p => p.id !== id);
        selPatId.set($project.patterns[0].id);
    }

    function openColor() {
        showColor = true;
    }

    function renameFolder(path: string) {
        renameValue = path;
        showRename = true;
        folderToRename = path;
    }

    let folderToRename: string | null = $state(null);

    function onTreeAction(action: string, item: NamedTreeItem) {
        const pattern = $project?.patterns.find(candidate => candidate.id === item.id);
        if (!pattern) {
            return;
        }
        selPatId.set(pattern.id);
        if (action === 'rename') {
            openRename(pattern);
        }
        if (action === 'color') {
            openColor();
        }
        if (action === 'duplicate') {
            duplicate();
        }
        if (action === 'clear') {
            clearPat();
        }
        if (action === 'delete') {
            remove();
        }
    }

    function onFolderAction(action: string, path: string) {
        if (action === 'rename') {
            renameFolder(path);
        }
    }

    function onRenameSubmit(value: string) {
        if (!value) {
            return;
        }
        if (folderToRename) {
            const prefix = folderToRename + '/';
            project.update(current =>
                current
                    ? {
                          ...current,
                          patterns: current.patterns.map(pattern => ({
                              ...pattern,
                              name:
                                  pattern.name === folderToRename ||
                                  pattern.name.startsWith(prefix)
                                      ? value + pattern.name.slice(folderToRename!.length)
                                      : pattern.name,
                          })),
                      }
                    : current,
            );
            folderToRename = null;
        } else {
            onRename(value);
        }
    }
</script>

<div class="pattern-tree-panel">
    <TreeView
        folderActions={[{ id: 'rename', label: 'Rename folder', icon: 'fa-pencil' }]}
        {itemActions}
        items={$project?.patterns ?? []}
        onaction={onTreeAction}
        onfolderaction={onFolderAction}
        onselect={id => selPatId.set(id)}
        selectedId={pat?.id}
        sortFolders={true}
        title="Patterns"
    >
        {#snippet headerActions()}
            <button
                class="header-add"
                aria-label="New pattern"
                onclick={add}
                title="New pattern"
                type="button"><i class="fa fa-add"></i></button
            >
        {/snippet}
    </TreeView>
</div>

<Prompt
    label="Name (use / to create folders)"
    onsubmit={onRenameSubmit}
    title={folderToRename ? 'Rename Folder' : 'Rename Pattern'}
    bind:show={showRename}
    bind:value={renameValue}
/>
<Confirm
    confirmLabel="Delete pattern"
    destructive
    message={`Are you sure you want to delete "${pat.name}"? It will be removed from the song arrangement.`}
    onconfirm={onConfirmDelete}
    title="Delete Pattern"
    bind:show={showConfirmDelete}
/>
<Dialog title="Pattern Color" bind:show={showColor}>
    <ColorPicker
        onchange={value => {
            pat.color = value;
            touch();
        }}
        value={pat.color}
    />
</Dialog>

<style>
    .pattern-tree-panel {
        display: flex;
        flex-direction: column;
        gap: 6px;
        width: 250px;
        min-width: 250px;
        min-height: 0;
    }

    .pattern-tree-panel :global(.tree-view) {
        flex: 1;
    }

    .header-add {
        width: 24px;
        height: 22px;
        padding: 2px;
        background: var(--color-surface);
        border: 1px solid var(--border);
        border-radius: 4px;
        color: var(--accent);
        font: inherit;
        font-size: 11px;
        cursor: pointer;
    }

    .header-add:hover {
        background: var(--color-surface-hover);
    }
</style>
