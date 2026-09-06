<script lang="ts">
    import {
        tick
    } from 'svelte';

    import {
        formatStageEta
    } from '../lib/export-eta';
    import {
        cancelExport, dismissExportError, exportProgress, exportWav
    } from '../lib/render';

    let dialog = $state<HTMLDialogElement>();
    const visible = $derived($exportProgress !== null);
    const failed = $derived($exportProgress?.stage === 'error');
    const stages = [
        {id: 'preparing', label: 'Preparing audio'},
        {id: 'scheduling', label: 'Scheduling notes'},
        {id: 'rendering', label: 'Rendering audio'},
        {id: 'encoding', label: 'Encoding WAV'}
    ];
    const label = $derived(stages.find(stage => stage.id === $exportProgress?.stage)?.label ?? 'Export failed');
    const percent = $derived(typeof $exportProgress?.progress === 'number' ? Math.floor($exportProgress.progress * 100) : null);
    const waitsForRender = $derived($exportProgress?.stage === 'rendering' && $exportProgress.canSuspend === false);
    const eta = $derived(!$exportProgress?.cancelling && percent !== null && percent < 100
        ? formatStageEta($exportProgress?.etaSeconds) : null);

    function cancel() {
        if (failed) {dismissExportError();}
        else {cancelExport();}
    }

    function handleKey(event: KeyboardEvent) {
        // The app has window-level piano/transport shortcuts. A modal must
        // intercept those as well as keeping tab focus inside its controls.
        event.stopImmediatePropagation();
        if (event.type !== 'keydown') {return;}
        if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
        } else if (event.key === 'Tab') {
            const buttons = [...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            event.preventDefault();
            buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
        }
    }

    $effect(() => {
        if (!visible || !dialog) {return;}
        const element = dialog;
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        element.showModal();
        element.querySelector('button')?.focus();
        window.addEventListener('keydown', handleKey, true);
        window.addEventListener('keyup', handleKey, true);
        return () => {
            window.removeEventListener('keydown', handleKey, true);
            window.removeEventListener('keyup', handleKey, true);
            element.close();
            void tick().then(() => {if (opener?.isConnected) {opener.focus();}});
        };
    });

    $effect(() => {
        if (!visible) {return;}
        const target = failed ? 'button' : 'button[aria-disabled]';
        void tick().then(() => dialog?.querySelector<HTMLButtonElement>(target)?.focus());
    });
</script>

<dialog
        bind:this={dialog}
        aria-describedby="export-description"
        aria-labelledby="export-title"
        aria-modal="true"
        oncancel={event => {event.preventDefault(); cancel();}}>
    <h2 id="export-title">{failed ? 'WAV export failed' : 'Export WAV'}</h2>
    {#if $exportProgress}
        {#if failed}
            <p id="export-description" role="alert">{$exportProgress.error}</p>
            <div class="actions">
                <button onclick={dismissExportError} type="button">Close</button>
                <button onclick={() => void exportWav()} type="button">Retry export</button>
            </div>
        {:else}
            <p id="export-description">Exporting a snapshot of your song. Editing and playback resume when this dialog closes.</p>
            <ol aria-label="Export stages">
                {#each stages as stage (stage.id)}
                    <li aria-current={$exportProgress.stage === stage.id ? 'step' : undefined}>{stage.label}</li>
                {/each}
            </ol>
            <p class="status" aria-live="polite" role="status">
                {$exportProgress.cancelling
                    ? (waitsForRender
                        ? 'Cancelling — waiting for this browser to finish rendering…'
                        : 'Cancelling — waiting for audio to stop…')
                    : label}
            </p>
            {#if percent === null}
                <progress aria-label={label} max="100"></progress>
            {:else}
                <progress aria-label={label} max="100" value={percent}></progress>
            {/if}
            <p class="detail">{percent === null
                ? ($exportProgress.stage === 'rendering'
                    ? 'Waiting for audio progress…'
                    : 'Initializing the audio graph…')
                : `${percent}% of this stage`}</p>
            {#if eta}<p class="detail">{eta}</p>{/if}
            {#if waitsForRender}<p class="hint">Cancellation waits for rendering to finish.</p>{/if}
            <div class="actions">
                <button aria-disabled={$exportProgress.cancelling} onclick={cancelExport} type="button">
                    {$exportProgress.cancelling ? 'Cancelling…' : 'Cancel export'}
                </button>
            </div>
            <p class="hint">Escape cancels. No file is downloaded after cancellation.</p>
        {/if}
    {/if}
</dialog>

<style>
    dialog {
        box-sizing: border-box;
        width: min(460px, calc(100vw - 32px));
        max-height: calc(100dvh - 32px);
        overflow: auto;
        padding: 24px;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--color-surface);
        color: var(--primary-text);
        box-shadow: 0 24px 56px rgba(0, 0, 0, .7), inset 0 2px var(--accent);
    }

    dialog::backdrop {
        background: var(--color-overlay);
    }

    h2 {
        margin: 0 0 16px;
        font-size: 16px;
        color: var(--accent2);
    }

    p {
        font-size: 12px;
        line-height: 1.6;
        overflow-wrap: anywhere;
    }

    ol {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px 24px;
        padding-left: 20px;
        font-size: 12px;
        color: var(--color-text-muted);
    }

    li[aria-current='step'] {
        color: var(--accent2);
        font-weight: bold;
    }

    .status {
        margin-bottom: 8px;
        min-height: 2em;
    }

    progress {
        width: 100%;
        height: 14px;
        accent-color: var(--accent);
    }

    .detail,
    .hint {
        color: var(--color-text-muted);
        font-size: 11px;
    }

    .actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 20px;
    }

    button {
        min-height: 40px;
        padding: 8px 16px;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--color-surface-raised);
        color: var(--primary-text);
        cursor: pointer;
    }

    button:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }

    button[aria-disabled='true'] {
        opacity: .65;
        cursor: wait;
    }

    @media (max-width: 360px) {
        dialog {padding: 16px;}
        ol {grid-template-columns: 1fr;}
    }
</style>
