<script lang="ts">
    import {tick} from 'svelte';

    import type {MasterId} from '../lib/master-controls';
    import type {DemoSong} from '../lib/project';
    import type {Project} from '../lib/types';

    import {BUDGET_MAX, BUDGET_MIN, getNodeBudget, setNodeBudget} from '../lib/engine';
    import {MASTER_SLIDERS} from '../lib/instruments';
    import {createMixer, ensureMixer} from '../lib/mixer';
    import {
        activeDemo,
        DEMO_LIBRARY,
        exportProject,
        importProject,
        lastPlayedPitch,
        loadDemoProject,
        loadSavedProject,
        newEmptyProject,
        playing,
        project,
        restoreSavedProject,
        savedAt,
        saveProject,
        selInstId,
        selPatId,
        songCursor,
        songLabel,
        touch,
    } from '../lib/project';
    import {exportWav, rendering} from '../lib/render';
    import {showShortcuts} from '../lib/shortcuts';
    import {playSong, seekSong, stopTransport} from '../lib/transport';
    import ExportProgress from './ExportProgress.svelte';
    import Mixer from './Mixer.svelte';
    import Slider from './Slider.svelte';
    import Button from './ui/Button.svelte';
    import Confirm from './ui/Confirm.svelte';
    import Dialog from './ui/Dialog.svelte';
    import IconButton from './ui/IconButton.svelte';

    const legacyMaster = createMixer([], false).master;
    const masterParams = $derived({ ...($project?.mixer?.master ?? legacyMaster) });
    const mixerDialogWidth = $derived(
        `min(${Math.max(
            520,
            Math.min(
                1180,
                296 +
                    (($project?.instruments.length ?? 0) + ($project?.mixer?.buses.length ?? 0)) *
                        132,
            ),
        )}px, calc(100vw - 32px))`,
    );
    let showMixer = $state(false);

    let showConfirmNew = $state(false);
    let showAlert = $state(false);
    let alertMessage = $state('');
    let activePanel = $state<'demos' | 'audio' | 'export' | null>(null);
    let browserSaveAvailable = $state(loadSavedProject() !== null);
    let panelButton: HTMLButtonElement | undefined;
    let panelElement: HTMLDivElement | undefined = $state();
    let demoRecovery = $state.raw<{
        project: Project;
        activeDemo: DemoSong | null;
        selInstId: string | null;
        selPatId: string | null;
        songCursor: number;
        lastPlayedPitch: string;
    } | null>(null);

    function togglePanel(panel: 'demos' | 'audio' | 'export', button: HTMLButtonElement) {
        if (activePanel === panel) {
            closePanel(true);
            return;
        }
        panelButton = button;
        activePanel = panel;
        void tick().then(() =>
            panelElement
                ?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')
                ?.focus(),
        );
    }

    function closePanel(restoreFocus = false) {
        if (!activePanel) {
            return;
        }
        const opener = panelButton;
        activePanel = null;
        if (restoreFocus) {
            void tick().then(() => opener?.blur());
        }
    }

    function handleOutsidePointer(event: Event) {
        const target = event.target;
        if (
            target instanceof Node &&
            (panelButton?.contains(target) || panelElement?.contains(target))
        ) {
            return;
        }
        closePanel(false);
    }

    function handleMenuKeydown(event: KeyboardEvent) {
        event.stopPropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            closePanel(true);
            return;
        }
        if (
            (activePanel !== 'demos' && activePanel !== 'export') ||
            !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
        ) {
            return;
        }
        event.preventDefault();
        const buttons = [
            ...(panelElement?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
        ];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
            event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buttons.length - 1
                  : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                    buttons.length;
        buttons[next]?.focus();
    }

    $effect(() => {
        if (!activePanel) {
            return;
        }
        document.addEventListener('pointerdown', handleOutsidePointer);
        document.addEventListener('click', handleOutsidePointer);
        document.addEventListener('focusin', handleOutsidePointer);
        return () => {
            document.removeEventListener('pointerdown', handleOutsidePointer);
            document.removeEventListener('click', handleOutsidePointer);
            document.removeEventListener('focusin', handleOutsidePointer);
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
        if ($rendering) {
            return;
        }
        showConfirmNew = true;
    }

    function onConfirmNew() {
        if ($rendering) {
            return;
        }
        stopTransport();
        const p = newEmptyProject();
        demoRecovery = null;
        activeDemo.set(null);
        project.set(p);
        selInstId.set(p.instruments[0].id);
        selPatId.set(p.patterns[0].id);
        songCursor.set(0);
    }

    function demo(song: DemoSong) {
        if ($rendering) {
            return;
        }
        if ($project && !demoRecovery) {
            demoRecovery = {
                project: JSON.parse(JSON.stringify($project)) as Project,
                activeDemo: $activeDemo,
                selInstId: $selInstId,
                selPatId: $selPatId,
                songCursor: $songCursor,
                lastPlayedPitch: $lastPlayedPitch,
            };
        }
        stopTransport();
        loadDemoProject(song);
        closePanel(true);
    }

    function restoreDemoProject() {
        if (!demoRecovery || $rendering) {
            return;
        }
        stopTransport();
        project.set(demoRecovery.project);
        activeDemo.set(demoRecovery.activeDemo);
        selInstId.set(demoRecovery.selInstId);
        selPatId.set(demoRecovery.selPatId);
        songCursor.set(demoRecovery.songCursor);
        lastPlayedPitch.set(demoRecovery.lastPlayedPitch);
        demoRecovery = null;
        closePanel(true);
    }

    function saveBrowserProject() {
        browserSaveAvailable = saveProject() || loadSavedProject() !== null;
    }

    function loadBrowserSave() {
        if ($rendering) {
            return;
        }
        stopTransport();
        if (!restoreSavedProject()) {
            browserSaveAvailable = false;
            return;
        }
        demoRecovery = null;
        closePanel(true);
    }

    // Save feedback — driven by the store, so Ctrl+S flashes it too
    let saved = $state('');
    $effect(() => {
        if ($savedAt) {
            browserSaveAvailable = true;
            saved = 'Saved';
            const timer = setTimeout(() => (saved = ''), 1600);
            return () => clearTimeout(timer);
        }
    });

    function setSwing(v: number) {
        if (!$project || $rendering || !Number.isFinite(v)) {
            return;
        }
        $project.swing = Math.max(0, Math.min(100, v)) / 100;
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
        if (!$project || $rendering) {
            return;
        }
        const opener = panelButton;
        closePanel(false);
        await exportWav();
        await tick();
        opener?.blur();
    }

    function downloadProject() {
        if (!$project || $rendering) {
            return;
        }
        exportProject();
        closePanel(true);
    }

    let fileInput: HTMLInputElement | undefined = $state();

    async function importFile(e: Event) {
        const target = e.target as HTMLInputElement;
        const file = target.files?.[0];
        target.value = '';
        if (!file || $rendering) {
            return;
        }
        const json = await file.text();
        if ($rendering) {
            return;
        }
        stopTransport();
        const ok = importProject(json);
        if (!ok) {
            alertMessage = 'Could not import: not a valid song file.';
            showAlert = true;
        } else {
            demoRecovery = null;
        }
    }
</script>

<header class="topbar">
    <div class="topbar-main">
        <span class="brand">
            <i class="fa fa-wave-square" aria-hidden="true"></i> Pinky
        </span>
        <a
            class="github-link"
            aria-label="Pinky on GitHub"
            href="https://github.com/stohrendorf/pinky"
            rel="noopener noreferrer"
            target="_blank"
            title="Pinky on GitHub"
        >
            <i class="fa-brands fa-github"></i>
        </a>
        <div class="project-controls" aria-label="Project" role="group">
            <Button
                compact
                disabled={$rendering}
                onclick={newProject}
                title="New project"
                variant="ghost"
                >New
            </Button>
            <Button
                compact
                disabled={$rendering}
                onclick={() => fileInput?.click()}
                title="Open a project file (JSON)"
                variant="ghost"
                >Open
            </Button>
            <Button
                compact
                disabled={!$project || $rendering}
                onclick={saveBrowserProject}
                title="Save in this browser (Ctrl+S)"
                variant="ghost"
            >
                {#if saved}
                    <span class="save-icon"><i class="fa fa-check" aria-hidden="true"></i></span>
                {:else}
                    <span class="save-icon"><i class="fa fa-save" aria-hidden="true"></i></span>
                {/if}
                Save
            </Button>
            <span class="saved-flash" aria-live="polite">{saved}</span>
        </div>
        <div class="export-controls" aria-label="Download" role="group">
            <button
                class="panel-toggle"
                aria-controls="export-panel"
                aria-expanded={activePanel === 'export'}
                aria-haspopup="dialog"
                disabled={!$project || $rendering}
                onclick={e => togglePanel('export', e.currentTarget)}
                title="Export project or audio"
                type="button"
            >
                Export <i class="fa fa-angle-down" aria-hidden="true"></i>
            </button>
            {#if activePanel === 'export'}
                <div
                    bind:this={panelElement}
                    id="export-panel"
                    class="toolbar-panel export-panel"
                    aria-label="Export"
                    onkeydown={handleMenuKeydown}
                    role="dialog"
                    tabindex="-1"
                >
                    <button
                        class="export-item"
                        disabled={!$project || $rendering}
                        onclick={downloadProject}
                        title="Download an editable project"
                        type="button"
                    >
                        <i class="fa fa-download" aria-hidden="true"></i> Project file (.json)
                    </button>
                    <button
                        class="export-item"
                        disabled={!$project || $rendering}
                        onclick={exportAudio}
                        title="Render the marked loop or whole song (Ctrl+E)"
                        type="button"
                    >
                        <i class="fa fa-wave-square" aria-hidden="true"></i> Audio (.wav)
                    </button>
                </div>
            {/if}
        </div>
        <div class="session-group" aria-label="Transport and timing" role="group">
            <div class="transport-controls">
                <IconButton
                    ariaLabel="Back to start"
                    disabled={$songCursor === 0 || $rendering}
                    icon="fa-backward-step"
                    onclick={() => seekSong(0)}
                    title="Back to start (Home)"
                    variant="ghost"
                />
                <IconButton
                    ariaLabel="Play song"
                    disabled={$playing || $rendering}
                    icon="fa-play"
                    onclick={playSong}
                    title="Play song from cursor (Space)"
                    variant="primary"
                />
                <IconButton
                    ariaLabel="Stop"
                    disabled={!$playing}
                    icon="fa-stop"
                    onclick={stopTransport}
                    title="Stop (Space)"
                    variant="ghost"
                />
            </div>
            {#if $project}
                <label
                    class="bpm-label"
                    title="Base tempo; conductor markers can override it. Stop to edit."
                >
                    BPM
                    <input
                        aria-label="Tempo (BPM)"
                        disabled={$playing || $rendering}
                        max="300"
                        min="30"
                        onchange={e => setBpm(e.currentTarget)}
                        type="number"
                        value={$project.bpm}
                    />
                </label>
                <label class="swing-label" title="Delay alternate 16ths; 100% = triplet shuffle">
                    Swing
                    <input
                        aria-label="Swing (%)"
                        disabled={$rendering}
                        max="100"
                        min="0"
                        onchange={e => setSwing(e.currentTarget.valueAsNumber)}
                        type="number"
                        value={swingPct}
                    />
                    <span>%</span>
                </label>
            {/if}
        </div>
        <span class="song-label" title={$songLabel}>{$songLabel}</span>
        <div class="utility-group">
            <button
                class="panel-toggle"
                aria-controls="topbar-panel"
                aria-expanded={activePanel === 'demos'}
                aria-haspopup="dialog"
                disabled={$rendering}
                onclick={e => togglePanel('demos', e.currentTarget)}
                title="Load a demo song"
                type="button"
            >
                Demos <i class="fa fa-angle-down" aria-hidden="true"></i>
            </button>
            <Button
                className="mixer-toggle"
                compact
                onclick={() => (showMixer = true)}
                pressed={showMixer}
                title="Open mixer: channels, routing and master protection"
                variant="ghost"
            >
                <i class="fa fa-chart-simple" aria-hidden="true"></i> Mixer
            </Button>
            <button
                class="panel-toggle"
                aria-controls="topbar-panel"
                aria-expanded={activePanel === 'audio'}
                aria-haspopup="dialog"
                onclick={e => togglePanel('audio', e.currentTarget)}
                title="Master sound and audio performance"
                type="button"
            >
                Audio <i class="fa fa-angle-down" aria-hidden="true"></i>
            </button>
            <IconButton
                icon="fa-question-circle"
                onclick={() => showShortcuts.set(true)}
                title="Keyboard shortcuts (?)"
                variant="ghost"
            ></IconButton>
        </div>
    </div>

    {#if activePanel === 'demos' || activePanel === 'audio'}
        <div
            bind:this={panelElement}
            id="topbar-panel"
            class="toolbar-panel"
            aria-label={activePanel === 'demos' ? 'Demo songs' : 'Audio'}
            onkeydown={handleMenuKeydown}
            role="dialog"
            tabindex="-1"
        >
            {#if activePanel === 'demos'}
                <div class="demo-list">
                    <button
                        class="restore-project"
                        disabled={$rendering || !browserSaveAvailable}
                        onclick={loadBrowserSave}
                        title={browserSaveAvailable
                            ? 'Load the project saved in this browser'
                            : 'No browser save is available'}
                        type="button"
                    >
                        <i class="fa fa-hard-drive" aria-hidden="true"></i> Load browser save
                    </button>
                    {#each DEMO_LIBRARY as d (d.id)}
                        <button
                            class="demo-item"
                            aria-pressed={$activeDemo === d.id}
                            disabled={$rendering}
                            onclick={() => demo(d.id)}
                            title={d.title}
                            type="button"
                        >
                            <i class="fa {d.icon}" aria-hidden="true"></i>
                            <span>{d.label}</span>
                            {#if $activeDemo === d.id}<i
                                    class="fa fa-check demo-check"
                                    aria-hidden="true"
                                ></i>{/if}
                        </button>
                    {/each}
                    {#if demoRecovery}
                        <button
                            class="restore-project"
                            disabled={$rendering}
                            onclick={restoreDemoProject}
                            title="Restore the project from before you started exploring demos (this session only)"
                            type="button"
                        >
                            <i class="fa fa-rotate-left" aria-hidden="true"></i> Restore previous project
                        </button>
                    {/if}
                </div>
            {:else}
                <div class="audio-controls">
                    <section>
                        <h3>Master</h3>
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
                    </section>
                    <section>
                        <h3>Performance</h3>
                        <label
                            class="node-budget-control"
                            title="Audio node budget: lower if playback stutters; higher allows more simultaneous voices."
                        >
                            Nodes
                            <input
                                max={BUDGET_MAX}
                                min={BUDGET_MIN}
                                oninput={e =>
                                    setBudget(parseInt((e.target as HTMLInputElement).value, 10))}
                                step="20"
                                type="range"
                                value={nodeBudget}
                            />
                            <span>{nodeBudget}</span>
                        </label>
                    </section>
                </div>
            {/if}
        </div>
    {/if}
</header>

<ExportProgress />

<Dialog title="Mixer" width={mixerDialogWidth} bind:show={showMixer}>
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
    onconfirm={onConfirmNew}
    title="New Project"
    bind:show={showConfirmNew}
/>
<Dialog title="Alert" bind:show={showAlert}>
    <p>{alertMessage}</p>
    <div style="display: flex; justify-content: flex-end; margin-top: 12px;">
        <Button onclick={() => (showAlert = false)}>OK</Button>
    </div>
</Dialog>

<style>
    .topbar {
        position: relative;
        z-index: 50;
        background: var(--color-surface);
        border-bottom: 1px solid var(--border);
    }

    .topbar-main {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
        height: 48px;
        padding: 0 12px;
    }

    .project-controls,
    .export-controls,
    .session-group,
    .utility-group {
        display: flex;
        align-items: center;
        gap: 2px;
        flex: 0 0 auto;
    }

    .export-controls,
    .session-group {
        border-left: 1px solid var(--border);
        padding-left: 12px;
    }

    .session-group {
        gap: 12px;
    }

    .export-controls {
        position: relative;
    }

    .toolbar-panel.export-panel {
        left: 12px;
        right: auto;
        top: calc(100% + 9px);
        width: 220px;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .brand {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        flex: 0 0 auto;
        color: var(--accent);
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.04em;
    }

    .github-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        border-radius: 3px;
        color: var(--color-text-muted);
    }

    .github-link:hover,
    .github-link:focus-visible {
        background: var(--color-surface-hover);
        color: var(--primary-text);
    }

    .transport-controls {
        display: flex;
        align-items: center;
        gap: 2px;
    }

    .panel-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 30px;
        padding: 0 10px;
        border: 1px solid transparent;
        border-radius: 2px;
        background: transparent;
        color: var(--primary-text);
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
    }

    .panel-toggle:hover:not(:disabled),
    .panel-toggle[aria-expanded='true'] {
        border-color: var(--border);
        background: var(--color-surface-hover);
    }

    .panel-toggle:disabled,
    .export-item:disabled,
    .demo-item:disabled,
    .restore-project:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    .panel-toggle i {
        color: var(--color-text-muted);
        font-size: 10px;
    }

    .toolbar-panel {
        position: absolute;
        top: 100%;
        right: 12px;
        z-index: 1;
        box-sizing: border-box;
        width: 320px;
        max-height: calc(100dvh - 100% - 16px);
        overflow: auto;
        padding: 6px;
        border: 1px solid var(--border);
        border-radius: 4px;
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.4);
        background: var(--color-surface);
    }

    .song-label {
        font-size: 11px;
        color: var(--color-text-muted);
        flex: 1 1 0;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .save-icon {
        display: inline-grid;
        place-items: center;
        width: 14px;
    }

    .saved-flash {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
    }

    .bpm-label,
    .swing-label {
        font-size: 11px;
        color: var(--color-text-muted);
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }

    .bpm-label input,
    .swing-label input {
        box-sizing: border-box;
        width: 52px;
        height: 28px;
        border: 1px solid var(--border);
        border-radius: 3px;
        background: var(--color-surface-input);
        color: var(--primary-text);
        font: inherit;
        font-variant-numeric: tabular-nums;
        padding: 3px 4px;
    }

    .node-budget-control {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
    }

    .node-budget-control input {
        flex: 1;
        min-width: 0;
    }

    .node-budget-control span {
        min-width: 32px;
        opacity: 0.7;
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

    .file-input {
        display: none;
    }

    .audio-controls {
        display: flex;
        flex-direction: column;
        gap: 18px;
        padding: 10px;
    }

    .audio-controls h3 {
        margin: 0 0 10px;
        color: var(--color-text-muted);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
    }

    .demo-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .export-item,
    .demo-item,
    .restore-project {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 10px;
        border: 0;
        border-radius: 3px;
        background: transparent;
        color: var(--primary-text);
        font: inherit;
        font-size: 12px;
        text-align: left;
        cursor: pointer;
    }

    .export-item:hover:not(:disabled),
    .export-item:focus-visible,
    .demo-item:hover:not(:disabled),
    .demo-item:focus-visible,
    .restore-project:hover:not(:disabled),
    .restore-project:focus-visible {
        background: var(--color-surface-hover);
    }

    .demo-item[aria-pressed='true'] {
        color: var(--accent);
        background: var(--color-accent-soft);
    }

    .demo-item > i:first-child {
        width: 18px;
        text-align: center;
    }

    .demo-check {
        margin-left: auto;
    }

    .restore-project {
        margin-top: 6px;
        border-top: 1px solid var(--border);
        border-radius: 0;
        color: var(--color-text-muted);
    }
</style>
