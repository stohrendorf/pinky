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
    import {
        initHistory
    } from './lib/history';
    import {
        initProject, project
    } from './lib/project';

    initProject();
    initHistory();

    let showInstrumentEditor = $state(false);
    let scopeExpanded = $state(true);
    let contextualEditor: string | null = $state(null);
    let splitRatio = $state(0.58);
    let dividerDragging = $state(false);
    let workspaceMain: HTMLElement | undefined = $state();

    const dividerHeight = 8;
    const panelGap = 8;
    const verticalPadding = 8;

    function availableFlexibleHeight(rect: DOMRect) {
        return Math.max(0, rect.height - verticalPadding * 2 - panelGap * 2 - dividerHeight);
    }

    function setSplit(value: number) {
        splitRatio = Math.max(0, Math.min(1, value / 100));
    }

    function setSplitFromPointer(event: PointerEvent) {
        if (!workspaceMain) {
            return;
        }
        const rect = workspaceMain.getBoundingClientRect();
        const flexibleHeight = availableFlexibleHeight(rect);
        if (!flexibleHeight) {
            return;
        }

        const dividerCenter = event.clientY - rect.top;
        const arrangerHeight = dividerCenter - verticalPadding - panelGap - dividerHeight / 2;
        const clampedArrangerHeight = Math.max(0, Math.min(flexibleHeight, arrangerHeight));
        splitRatio = clampedArrangerHeight / flexibleHeight;
    }

    function startDividerDrag(event: PointerEvent) {
        event.preventDefault();
        dividerDragging = true;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        setSplitFromPointer(event);
    }

    function handleDividerPointerMove(event: PointerEvent) {
        if (dividerDragging) {
            setSplitFromPointer(event);
        }
    }

    function stopDividerDrag(event?: PointerEvent) {
        dividerDragging = false;
        if (event?.currentTarget instanceof HTMLElement && event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    }

    function handleDividerKeydown(event: KeyboardEvent) {
        const delta = event.shiftKey ? 0.05 : 0.01;
        if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
            event.preventDefault();
            setSplit(splitRatio * 100 - delta * 100);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
            event.preventDefault();
            setSplit(splitRatio * 100 + delta * 100);
        } else if (event.key === 'Home') {
            event.preventDefault();
            setSplit(0);
        } else if (event.key === 'End') {
            event.preventDefault();
            setSplit(100);
        }
    }
</script>

{#if $project}
    <div class="workspace">
        <Shortcuts/>
        <TopBar/>
        <main
                bind:this={workspaceMain}
                style="--arranger-fr: {splitRatio}fr; --editor-fr: {1 - splitRatio}fr;"
                class="workspace-main"
                class:divider-dragging={dividerDragging}
                onpointercancel={stopDividerDrag}
                onpointermove={handleDividerPointerMove}
                onpointerup={stopDividerDrag}>
            <section class="arranger-panel" aria-label="Song arranger">
                <div class="editor-with-tree">
                    <PatternBar/>
                    <Playlist bind:contextualEditor/>
                </div>
            </section>
            <div
                    class="split-divider"
                    aria-label="Resize arranger and pattern editor"
                    aria-orientation="horizontal"
                    aria-valuemax="100"
                    aria-valuemin="0"
                    aria-valuenow={Math.round(splitRatio * 100)}
                    onkeydown={handleDividerKeydown}
                    onpointercancel={stopDividerDrag}
                    onpointerdown={startDividerDrag}
                    onpointermove={handleDividerPointerMove}
                    onpointerup={stopDividerDrag}
                    role="separator"
                    tabindex="0"
                    title="Click or drag to resize editors"></div>
            <section class="piano-roll-panel" aria-label="Pattern editor">
                <div class="editor-with-tree">
                    <InstrumentTree onEdit={() => showInstrumentEditor = true}/>
                    <Sequencer onEditInstrument={() => showInstrumentEditor = true} bind:contextualEditor/>
                </div>
            </section>
        </main>
        <section class="scope-tray" class:collapsed={!scopeExpanded}>
            <button class="scope-toggle" aria-expanded={scopeExpanded} onclick={() => scopeExpanded = !scopeExpanded}>
                <span><i class="fa fa-chart-simple"></i> Scope</span>
                <span>{scopeExpanded ? 'Collapse' : 'Expand'} <i class="fa fa-chevron-{scopeExpanded ? 'down' : 'up'}"></i></span>
            </button>
            {#if scopeExpanded}
                <Scope/>
            {/if}
        </section>
    </div>

    <Dialog
            bodyClass="instrument-editor-body"
            height="min(720px, calc(100dvh - 32px))"
            title="Instrument editor"
            width="min(1040px, calc(100vw - 32px))"
            bind:show={showInstrumentEditor}>
        {#snippet headerActions()}
            <InstrumentPresetBar/>
        {/snippet}
        <div class="instrument-editor-layout">
            <InstrumentPanel/>
            <Keyboard/>
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
        grid-template-rows: minmax(0, var(--arranger-fr)) 8px minmax(0, var(--editor-fr));
        flex: 1;
        min-width: 0;
        min-height: 0;
        gap: 8px;
        padding: 8px 12px;
        overflow: hidden;
    }

    .split-divider {
        width: 100%;
        min-height: 8px;
        height: 8px;
        margin: 0;
        border: 0;
        border-radius: 3px;
        background: var(--color-surface);
        cursor: row-resize;
        touch-action: none;
    }

    .split-divider::before {
        content: '';
        display: block;
        width: 42px;
        height: 2px;
        margin: 3px auto;
        border-radius: 2px;
        background: var(--color-text-muted);
    }

    .split-divider:hover::before,
    .split-divider:focus-visible::before,
    .divider-dragging .split-divider::before {
        background: var(--accent);
    }

    .split-divider:focus-visible {
        outline: 1px solid var(--accent);
        outline-offset: 2px;
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
        letter-spacing: .08em;
    }

    .scope-tray :global(.scope-wrap) {
        padding: 0 12px 8px;
    }

    .scope-tray.collapsed {
        border-bottom: 0;
    }

</style>
