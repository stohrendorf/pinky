<script lang="ts">
    import InstrumentPanel from './components/InstrumentPanel.svelte';
    import InstrumentPresetBar from './components/InstrumentPresetBar.svelte';
    import InstrumentTree from './components/InstrumentTree.svelte';
    import Keyboard from './components/Keyboard.svelte';
    import PatternBar from './components/PatternBar.svelte';
    import Playlist from './components/Playlist.svelte';
    import Scope from './components/Scope.svelte';
    import Sequencer from './components/Sequencer.svelte';
    import Shortcuts from './components/Shortcuts.svelte';
    import TopBar from './components/TopBar.svelte';
    import Dialog from './components/ui/Dialog.svelte';
    import { initHistory } from './lib/history';
    import { initProject, project } from './lib/project';

    initProject();
    initHistory();

    let showInstrumentEditor = $state(false);
    let scopeExpanded = $state(true);
    let contextualEditor: string | null = $state(null);
</script>

{#if $project}
    <div class="workspace">
        <Shortcuts />
        <TopBar />
        <main class="workspace-main">
            <section class="arranger-panel" aria-label="Song arranger">
                <div class="editor-with-tree">
                    <PatternBar />
                    <Playlist bind:contextualEditor />
                </div>
            </section>
            <div class="split-divider" aria-hidden="true"></div>
            <section class="piano-roll-panel" aria-label="Pattern editor">
                <div class="editor-with-tree">
                    <InstrumentTree onEdit={() => (showInstrumentEditor = true)} />
                    <Sequencer
                        onEditInstrument={() => (showInstrumentEditor = true)}
                        bind:contextualEditor
                    />
                </div>
            </section>
        </main>
        <section class="scope-tray" class:collapsed={!scopeExpanded}>
            <button
                class="scope-toggle"
                aria-expanded={scopeExpanded}
                onclick={() => (scopeExpanded = !scopeExpanded)}
            >
                <span><i class="fa fa-chart-simple"></i> Scope</span>
                <span
                    >{scopeExpanded ? 'Collapse' : 'Expand'}
                    <i class="fa fa-chevron-{scopeExpanded ? 'down' : 'up'}"></i></span
                >
            </button>
            {#if scopeExpanded}
                <Scope />
            {/if}
        </section>
    </div>

    <Dialog
        bodyClass="instrument-editor-body"
        height="min(720px, calc(100dvh - 32px))"
        title="Instrument editor"
        width="min(1040px, calc(100vw - 32px))"
        bind:show={showInstrumentEditor}
    >
        {#snippet headerActions()}
            <InstrumentPresetBar />
        {/snippet}
        <div class="instrument-editor-layout">
            <InstrumentPanel />
            <Keyboard />
        </div>
    </Dialog>
{/if}

<style>
    .workspace {
        display: flex;
        flex-direction: column;
        height: 100dvh;
        min-height: 0;
        overflow: hidden;
    }

    .workspace-main {
        display: grid;
        grid-template-rows: minmax(0, 1fr) 3px minmax(0, 1fr);
        flex: 1;
        min-width: 0;
        min-height: 0;
        gap: 8px;
        padding: 8px 12px;
        overflow: hidden;
    }

    .split-divider {
        width: 100%;
        height: 3px;
        border-top: 1px solid var(--border);
        border-bottom: 1px solid var(--color-surface-deep);
        background: var(--color-surface-raised);
    }

    .arranger-panel,
    .piano-roll-panel {
        min-width: 0;
        min-height: 0;
    }

    :global(.modal-body.instrument-editor-body) {
        height: 100%;
        overflow: hidden;
        padding: 12px 16px 16px;
    }

    .instrument-editor-layout {
        display: grid;
        grid-template-rows: minmax(0, 1fr) 72px;
        gap: 8px;
        height: 100%;
    }

    .instrument-editor-layout :global(.inst-panel) {
        min-height: 0;
    }

    .instrument-editor-layout :global(.keyboard) {
        margin: 0;
    }

    .arranger-panel {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .editor-with-tree {
        display: flex;
        gap: 8px;
        min-width: 0;
        min-height: 0;
        height: 100%;
    }

    .editor-with-tree > :global(.playlist-container),
    .editor-with-tree > :global(.piano-roll-container) {
        flex: 1;
        min-width: 0;
        min-height: 0;
    }

    .scope-toggle {
        display: flex;
        align-items: center;
    }

    .arranger-panel :global(.playlist-container) {
        flex: 1;
        min-height: 0;
    }

    .scope-tray {
        flex: 0 0 auto;
        background: var(--color-surface);
        border-top: 1px solid var(--border);
    }

    .scope-toggle {
        justify-content: space-between;
        width: 100%;
        padding: 5px 12px;
        background: transparent;
        color: var(--accent2);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
    }

    .scope-tray :global(.scope-wrap) {
        padding: 0 12px 8px;
    }

    .scope-tray.collapsed {
        border-bottom: 0;
    }
</style>
