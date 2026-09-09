<script lang="ts">
    import type { NamedTreeItem } from '../lib/name-tree';
    import type { Instrument } from '../lib/types';

    import { createInstrument } from '../lib/instruments';
    import { project, selInstId, touch } from '../lib/project';
    import Confirm from './ui/Confirm.svelte';
    import Prompt from './ui/Prompt.svelte';
    import TreeView from './ui/TreeView.svelte';

    interface Props {
        onEdit?: () => void;
    }

    const { onEdit = () => {} }: Props = $props();
    let showRename = $state(false);
    let showDelete = $state(false);
    let renameValue = $state('');
    let target: Instrument | undefined = $state();

    const itemActions = [
        { id: 'edit', label: 'Edit instrument', icon: 'fa-sliders' },
        { id: 'rename', label: 'Rename', icon: 'fa-pencil' },
        { id: 'mute', label: 'Mute / unmute', icon: 'fa-volume-xmark' },
        { id: 'solo', label: 'Solo / unsolo', icon: 'fa-headphones' },
        { id: 'delete', label: 'Delete', icon: 'fa-trash' },
    ];

    const selected = $derived(
        ($project?.instruments.find(i => i.id === $selInstId) ||
            $project?.instruments[0]) as Instrument,
    );

    function choose(item: NamedTreeItem): Instrument | null {
        const instrument = $project?.instruments.find(candidate => candidate.id === item.id);
        if (!instrument) {
            return null;
        }
        target = instrument;
        selInstId.set(instrument.id);
        return instrument;
    }

    function add() {
        if (!$project) {
            return;
        }
        const instrument = createInstrument('Instrument ' + ($project.instruments.length + 1));
        $project.instruments = [...$project.instruments, instrument];
        selInstId.set(instrument.id);
    }

    function action(actionId: string, item: NamedTreeItem) {
        const instrument = choose(item);
        if (!instrument) {
            return;
        }
        if (actionId === 'edit') {
            onEdit();
        }
        if (actionId === 'rename') {
            renameValue = instrument.name;
            showRename = true;
        }
        if (actionId === 'mute') {
            instrument.mute = !instrument.mute;
            touch();
        }
        if (actionId === 'solo') {
            instrument.solo = !instrument.solo;
            touch();
        }
        if (actionId === 'delete' && ($project?.instruments.length || 0) > 1) {
            showDelete = true;
        }
    }

    function rename(value: string) {
        if (value && target) {
            target.name = value;
            touch();
        }
    }

    function remove() {
        if (!$project || !target || $project.instruments.length <= 1) {
            return;
        }
        const id = target.id;
        $project.patterns.forEach(pattern => delete pattern.tracks[id]);
        $project.instruments = $project.instruments.filter(instrument => instrument.id !== id);
        selInstId.set($project.instruments[0].id);
        showDelete = false;
    }

    function renameFolder(path: string) {
        renameValue = path;
        target = null as unknown as Instrument;
        showRename = true;
        folderToRename = path;
    }

    let folderToRename: string | null = $state(null);

    function folderAction(actionId: string, path: string) {
        if (actionId === 'rename') {
            renameFolder(path);
        }
    }

    function toggleMute(item: NamedTreeItem) {
        const instrument = choose(item);
        if (!instrument) {
            return;
        }
        instrument.mute = !instrument.mute;
        touch();
    }

    function toggleSolo(item: NamedTreeItem) {
        const instrument = choose(item);
        if (!instrument) {
            return;
        }
        instrument.solo = !instrument.solo;
        touch();
    }

    function submitRename(value: string) {
        if (!value) {
            return;
        }
        if (folderToRename) {
            const prefix = folderToRename + '/';
            $project?.instruments.forEach(instrument => {
                if (instrument.name === folderToRename) {
                    instrument.name = value;
                } else if (instrument.name.startsWith(prefix)) {
                    instrument.name = value + instrument.name.slice(folderToRename!.length);
                }
            });
            folderToRename = null;
            touch();
        } else {
            rename(value);
        }
    }
</script>

<div class="instrument-tree-panel">
    <TreeView
        folderActions={[{ id: 'rename', label: 'Rename folder', icon: 'fa-pencil' }]}
        {itemActions}
        items={$project?.instruments ?? []}
        onaction={action}
        onfolderaction={folderAction}
        onmute={toggleMute}
        onselect={id => selInstId.set(id)}
        onsolo={toggleSolo}
        selectedId={selected?.id}
        showMuteSolo={true}
        title="Instruments"
    >
        {#snippet headerActions()}
            <button
                class="header-add"
                aria-label="New instrument"
                onclick={add}
                title="New instrument"
                type="button"><i class="fa fa-add"></i></button
            >
        {/snippet}
    </TreeView>
</div>
<Prompt
    label="New Name"
    onsubmit={submitRename}
    title={folderToRename ? 'Rename Folder' : 'Rename Instrument'}
    bind:show={showRename}
    bind:value={renameValue}
/>
<Confirm
    confirmLabel="Delete instrument"
    destructive
    message={`Delete "${target?.name}"? Notes using it will be removed.`}
    onconfirm={remove}
    title="Delete Instrument"
    bind:show={showDelete}
/>

<style>
    .instrument-tree-panel {
        display: flex;
        flex-direction: column;
        gap: 6px;
        width: 250px;
        min-width: 250px;
        min-height: 0;
    }

    .instrument-tree-panel :global(.tree-view) {
        flex: 1;
    }

    .header-add {
        width: 24px;
        height: 22px;
        padding: 2px;
        background: transparent;
        border: 1px solid var(--border);
        border-radius: 4px;
        color: var(--accent);
        cursor: pointer;
    }

    .header-add:hover {
        background: var(--color-surface-hover);
    }
</style>
