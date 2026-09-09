<script lang="ts">
    import { run } from 'svelte/legacy';

    import type { MasterId } from '../lib/master-controls';
    import type { DemoSong } from '../lib/project';

    import { BUDGET_MAX, BUDGET_MIN, getNodeBudget, setNodeBudget } from '../lib/engine';
    import { MASTER_SLIDERS } from '../lib/instruments';
    import { createMixer, ensureMixer } from '../lib/mixer';
    import {
        activeDemo,
        DEMO_LIBRARY,
        exportProject,
        importProject,
        loadDemoProject,
        newEmptyProject,
        playing,
        project,
        savedAt,
        saveProject,
        selInstId,
        selPatId,
        songCursor,
        songLabel,
        touch,
    } from '../lib/project';
    import { exportWav, rendering } from '../lib/render';
    import { showShortcuts } from '../lib/shortcuts';
    import { playPattern, playSong, seekSong, stopTransport } from '../lib/transport';
    import ExportProgress from './ExportProgress.svelte';
    import Mixer from './Mixer.svelte';
    import Slider from './Slider.svelte';
    import Button from './ui/Button.svelte';
    import Confirm from './ui/Confirm.svelte';
    import Dialog from './ui/Dialog.svelte';
    import IconButton from './ui/IconButton.svelte';

    const legacyMaster = createMixer([], false).master;
    const masterParams = $derived({ ...($project?.mixer?.master ?? legacyMaster) });
    let showMixer = $state(false);

    let showConfirmNew = $state(false);
    let showAlert = $state(false);
    let alertMessage = $state('');
    let utilityExpanded = $state(false);
    let utilityButton: HTMLButtonElement | undefined = $state();
    let utilityMenu: HTMLElement | undefined = $state();

    function toggleUtilities() {
        if (utilityExpanded) {
            closeUtilities();
            return;
        }
        utilityExpanded = true;
    }

    function closeUtilities(restoreFocus = false) {
        if (!utilityExpanded) {
            return;
        }
        utilityExpanded = false;
        if (restoreFocus) {
            queueMicrotask(() => utilityButton?.focus());
        }
    }

    function runUtilityAction(action: () => void | Promise<void>, restoreFocus = true) {
        closeUtilities(restoreFocus);
        void action();
    }

    function handleOutsidePointer(event: Event) {
        const target = event.target;
        if (
            target instanceof Node &&
            (utilityButton?.contains(target) || utilityMenu?.contains(target))
        ) {
            return;
        }
        closeUtilities(true);
    }

    function handleMenuKeydown(event: KeyboardEvent) {
        if (event.key !== 'Escape') {
            return;
        }
        event.preventDefault();
        closeUtilities(true);
    }

    $effect(() => {
        if (!utilityExpanded) {
            return;
        }
        document.addEventListener('pointerdown', handleOutsidePointer);
        document.addEventListener('click', handleOutsidePointer);
        document.addEventListener('keydown', handleMenuKeydown);
        return () => {
            document.removeEventListener('pointerdown', handleOutsidePointer);
            document.removeEventListener('click', handleOutsidePointer);
            document.removeEventListener('keydown', handleMenuKeydown);
        };
    });

    function setMaster(id: MasterId, v: number) {
        if (!$project || $rendering || !Number.isFinite(v)) {
            return;
        }
        const slider = MASTER_SLIDERS.find(s => s.id === id);
        if (!slider) {
            return;
        }
        ensureMixer($project).master[id] = Math.max(slider.min, Math.min(slider.max, v));
        touch();
    }

    function setBpm(input: HTMLInputElement) {
        if (!$project || $playing || $rendering || !Number.isFinite(input.valueAsNumber)) {
            return;
        }
        $project.bpm = Math.max(30, Math.min(300, input.valueAsNumber));
        touch();
    }

    function newProject() {
        showConfirmNew = true;
    }

    function onConfirmNew() {
        stopTransport();
        const p = newEmptyProject();
        activeDemo.set(null);
        project.set(p);
        selInstId.set(p.instruments[0].id);
        selPatId.set(p.patterns[0].id);
        songCursor.set(0);
    }

    function demo(song: DemoSong) {
        stopTransport();
        loadDemoProject(song);
    }

    // Save feedback — driven by the store, so Ctrl+S flashes it too
    let saved = $state('');
    let savedTimer: ReturnType<typeof setTimeout> | undefined = $state();
    run(() => {
        if ($savedAt) {
            saved = '✓ saved';
            clearTimeout(savedTimer);
            savedTimer = setTimeout(() => (saved = ''), 1600);
        }
    });

    function setSwing(v: number) {
        if (!$project) {
            return;
        }
        $project.swing = v / 100;
        touch();
    }

    const swingPct = $derived(Math.round(($project?.swing || 0) * 100));

    /* Performance, not music: how many audio nodes the engine may run before it
     * starts thinning new voices out (see the scope readout). It depends on the
     * machine, so it lives here as a slider and is stored per browser — not in
     * the song. */
    let nodeBudget = $state(getNodeBudget());

    function setBudget(v: number) {
        setNodeBudget(v);
        nodeBudget = getNodeBudget();
    }

    // Offline bounce: renders the song (or the marked loop region) to a WAV file
    async function exportAudio() {
        await exportWav();
    }

    let fileInput: HTMLInputElement | undefined = $state();

    async function importFile(e: Event) {
        const target = e.target as HTMLInputElement;
        const file = target.files?.[0];
        target.value = '';
        if (!file) {
            return;
        }
        stopTransport();
        const ok = importProject(await file.text());
        if (!ok) {
            alertMessage = 'Could not import: not a valid song file.';
            showAlert = true;
        }
    }
</script>

<header class="topbar">
    <div class="topbar-main">
        <div class="session-group">
            <button
                bind:this={utilityButton}
                class="brand"
                aria-controls="topbar-utilities"
                aria-expanded={utilityExpanded}
                aria-label="Pinky application menu"
                onclick={toggleUtilities}
                title={utilityExpanded
                    ? 'Close Pinky application menu'
                    : 'Open Pinky application menu'}
                type="button"
            >
                <i class="fa fa-wave-square" aria-hidden="true"></i>
                <span>Pinky</span>
                <i class="fa fa-caret-down menu-caret" aria-hidden="true"></i>
            </button>
            <div class="transport-controls">
                <Button
                    className="compact-button"
                    disabled={$playing || $rendering}
                    title="Play Pattern"
                    on:click={playPattern}
                    ><i class="fa fa-play"></i> Pattern
                </Button>
                <Button
                    className="compact-button"
                    disabled={$playing || $rendering}
                    title="Play Song"
                    on:click={playSong}
                    ><i class="fa fa-music"></i> Song
                </Button>
                <Button
                    className="compact-button"
                    disabled={!$playing}
                    title="Stop"
                    variant="secondary"
                    on:click={stopTransport}><i class="fa fa-stop"></i></Button
                >
                <Button
                    className="compact-button"
                    disabled={$songCursor === 0}
                    title="Playback cursor back to the start (Home)"
                    variant="secondary"
                    on:click={() => seekSong(0)}><i class="fa fa-backward-step"></i></Button
                >
            </div>
            <span class="song-label">{$songLabel}</span>
            <span class="saved-flash" aria-live="polite">{saved}</span>
        </div>
        <div class="utility-group">
            <Button
                className="mixer-toggle"
                pressed={showMixer}
                title="Open mixer: channels, routing and master protection"
                variant="secondary"
                on:click={() => (showMixer = true)}
            >
                <i class="fa fa-chart-simple" aria-hidden="true"></i> Mixer
            </Button>
            <a
                class="repo-link"
                aria-label="View Pinky on GitHub"
                href="https://github.com/stohrendorf/pinky"
                rel="noopener noreferrer"
                target="_blank"
                title="View source on GitHub"
            >
                <i class="fa-brands fa-github"></i>
            </a>
            <IconButton
                icon="fa-question-circle"
                title="Keyboard shortcuts (?)"
                variant="ghost"
                on:click={() => showShortcuts.set(true)}
            ></IconButton>
        </div>
    </div>

    {#if utilityExpanded}
        <aside
            bind:this={utilityMenu}
            id="topbar-utilities"
            class="utility-sidebar"
            aria-label="Application utilities"
        >
            <div class="sidebar-column">
                <div class="sidebar-section">
                    <span class="menu-heading">Project</span>
                    <Button variant="secondary" on:click={() => runUtilityAction(saveProject)}
                        ><i class="fa fa-save"></i> Save
                    </Button>
                    <Button variant="secondary" on:click={() => runUtilityAction(exportProject)}
                        ><i class="fa fa-download"></i> Export
                    </Button>
                    <Button
                        variant="secondary"
                        on:click={() => runUtilityAction(() => fileInput?.click())}
                        ><i class="fa fa-upload"></i> Import
                    </Button>
                    <Button variant="secondary" on:click={() => runUtilityAction(newProject, false)}
                        ><i class="fa fa-add"></i> New
                    </Button>
                </div>
                <div class="sidebar-section">
                    <span class="menu-heading">Render</span>
                    <Button
                        disabled={$rendering}
                        title="Render to a WAV file (the loop region if one is marked, otherwise the whole song)"
                        variant="secondary"
                        on:click={() => runUtilityAction(exportAudio)}
                    >
                        <i class="fa fa-file-audio"></i>
                        {$rendering ? 'Rendering…' : 'Render WAV'}</Button
                    >
                </div>
            </div>
            <div class="sidebar-column">
                <div class="sidebar-section">
                    <span class="menu-heading">Mix</span>
                    <div class="master-controls" aria-label="Master controls">
                        <fieldset class="master-editing" disabled={$rendering || !$project}>
                            {#each MASTER_SLIDERS as s (s.id)}
                                <Slider
                                    {...s}
                                    onchange={v => setMaster(s.id as MasterId, v)}
                                    value={masterParams[s.id as MasterId]}
                                />
                            {/each}
                        </fieldset>
                    </div>
                </div>
                <div class="sidebar-section timing-section" aria-label="Timing controls">
                    <span class="menu-heading">Timing</span>
                    <label
                        class="swing-label"
                        title="Groove: pushes every 2nd 16th late (100% = triplet shuffle)"
                    >
                        Swing
                        <input
                            max="100"
                            min="0"
                            oninput={e =>
                                setSwing(parseInt((e.target as HTMLInputElement).value, 10))}
                            step="1"
                            type="range"
                            value={swingPct}
                        />
                        <span class="swing-val">{swingPct}%</span>
                    </label>
                    {#if $project}<label
                            class="bpm-label"
                            title="Base tempo for pattern preview and before the first conductor marker. Stop to edit."
                            >BPM
                            <input
                                disabled={$playing || $rendering}
                                max="300"
                                min="30"
                                onchange={e => setBpm(e.currentTarget)}
                                type="number"
                                value={$project.bpm}
                            /></label
                        >{/if}
                </div>
            </div>
            <div class="sidebar-section library-section">
                <span class="menu-heading"><i class="fa fa-compact-disc"></i> Demo songs</span>
                <div class="demo-grid">
                    {#each DEMO_LIBRARY as d (d.id)}
                        <Button
                            pressed={$activeDemo === d.id}
                            title={d.title}
                            variant={$activeDemo === d.id ? 'primary' : 'secondary'}
                            on:click={() => runUtilityAction(() => demo(d.id))}
                            ><i class="fa {d.icon}"></i> {d.label}
                        </Button>
                    {/each}
                </div>
            </div>
            <div class="sidebar-section">
                <span class="menu-heading">Performance</span>
                <label
                    class="node-budget-control"
                    title="Audio node budget: above it the engine thins new voices so playback can keep up."
                >
                    Nodes
                    <input
                        max={BUDGET_MAX}
                        min={BUDGET_MIN}
                        oninput={e => setBudget(parseInt((e.target as HTMLInputElement).value, 10))}
                        step="20"
                        type="range"
                        value={nodeBudget}
                    />
                    <span>{nodeBudget}</span>
                </label>
            </div>
        </aside>
    {/if}
</header>

<ExportProgress />

<Dialog title="Mixer" width="1180px" bind:show={showMixer}>
    {#if showMixer}
        <Mixer />
    {/if}
</Dialog>

<input
    bind:this={fileInput}
    class="file-input"
    accept=".json,application/json"
    onchange={importFile}
    type="file"
/>

<Confirm
    confirmLabel="Create new project"
    destructive
    message="Start a new empty project? Unsaved changes are lost."
    title="New Project"
    bind:show={showConfirmNew}
    on:confirm={onConfirmNew}
/>
<Dialog title="Alert" bind:show={showAlert}>
    <p>{alertMessage}</p>
    <div style="display: flex; justify-content: flex-end; margin-top: 12px;">
        <Button on:click={() => (showAlert = false)}>OK</Button>
    </div>
</Dialog>

<style>
    .topbar {
        position: relative;
        z-index: 50;
        background: linear-gradient(90deg, var(--color-surface-deep), var(--color-surface));
        border-bottom: 1px solid var(--border);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
    }

    .topbar-main {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        min-height: 52px;
        padding: 8px 16px;
        overflow: hidden;
    }

    .session-group,
    .utility-group {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
    }

    .session-group {
        flex: 1 1 auto;
    }

    .utility-group {
        flex: 0 0 auto;
        margin-left: auto;
    }

    .repo-link {
        display: inline-grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border-radius: 5px;
        color: var(--color-text-muted);
        font-size: 15px;
        text-decoration: none;
    }

    .repo-link:hover,
    .repo-link:focus-visible {
        color: var(--primary-text);
        background: var(--color-surface-raised);
    }

    .brand {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        flex: 0 0 auto;
        padding: 5px 7px;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--color-surface-raised);
        color: var(--accent);
        cursor: pointer;
        font-family: inherit;
        font-size: 15px;
        font-weight: 700;
        letter-spacing: 0.12em;
    }

    .brand:hover,
    .brand:focus-visible,
    .brand[aria-expanded='true'] {
        border-color: var(--accent);
        background: var(--color-surface-input);
        color: var(--primary-text);
    }

    .menu-caret {
        color: var(--color-text-muted);
        font-size: 10px;
        transition: transform 0.12s ease;
    }

    .brand[aria-expanded='true'] .menu-caret {
        transform: rotate(180deg);
    }

    .transport-controls {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: 0 0 auto;
    }

    .utility-sidebar {
        min-width: 0;
    }

    .utility-sidebar {
        position: absolute;
        top: calc(100% + 8px);
        left: 16px;
        z-index: 1;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: start;
        gap: 16px 20px;
        box-sizing: border-box;
        width: min(600px, calc(100vw - 32px));
        max-height: calc(100dvh - 56px);
        overflow: auto;
        padding: 18px;
        border: 1px solid var(--border);
        border-radius: 2px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
        background: var(--color-surface);
    }

    :global(.compact-button.btn) {
        min-width: 32px;
        padding: 7px 10px;
        font-size: 11px;
    }

    .song-label {
        font-size: 12px;
        opacity: 0.75;
        color: var(--color-text-muted);
        flex: 0 0 110px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .saved-flash {
        display: inline-block;
        width: 52px;
        text-align: left;
        margin-left: 2px;
        font-weight: 400;
        opacity: 0.8;
        white-space: nowrap;
    }

    .bpm-label {
        font-size: 12px;
        display: inline;
    }

    .swing-label {
        font-size: 12px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }

    .swing-label input {
        width: 70px;
        vertical-align: middle;
    }

    .node-budget-control {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
    }

    .node-budget-control input {
        width: 120px;
    }

    .node-budget-control span {
        min-width: 32px;
        opacity: 0.7;
    }

    .swing-val {
        opacity: 0.7;
        width: 34px;
        display: inline-block;
    }

    .master-controls {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
        width: 100%;
    }

    .master-controls :global(.slider-group) {
        width: 100%;
        margin: 0;
        font-size: 10px;
    }

    .master-editing {
        display: flex;
        flex-direction: column;
        gap: 10px;
        border: 0;
        margin: 0;
        padding: 0;
        min-width: 0;
    }

    .master-editing:disabled {
        opacity: 0.5;
    }

    .bpm-label input {
        width: 56px;
        background: var(--border);
        color: var(--primary-text);
        border: none;
        border-radius: 4px;
        padding: 4px;
    }

    .file-input {
        display: none;
    }

    .sidebar-section {
        display: flex;
        flex-wrap: wrap;
        align-content: flex-start;
        gap: 6px;
        min-width: 0;
    }

    .sidebar-column {
        display: flex;
        flex-direction: column;
        gap: 16px;
        min-width: 0;
    }

    .menu-heading {
        display: block;
        width: 100%;
        margin-bottom: 2px;
        color: var(--color-text-subtle);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.1em;
    }

    .demo-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 6px;
        margin-top: 8px;
    }
</style>
