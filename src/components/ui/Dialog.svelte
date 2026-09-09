<script lang="ts">
    import { type Snippet, tick } from 'svelte';

    interface Props {
        bodyClass?: string;
        children?: Snippet;
        headerActions?: Snippet;
        height?: string;
        show?: boolean;
        title?: string;
        width?: string;
        onclose?: () => void;
    }

    let {
        bodyClass = '',
        children,
        headerActions,
        height = '',
        show = $bindable(false),
        title = '',
        width = '300px',
        onclose = () => {},
    }: Props = $props();
    let dialogEl: HTMLDivElement | undefined = $state();
    let opener: HTMLElement | null = null;

    $effect(() => {
        if (!show) {
            return;
        }
        opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        void tick().then(() => dialogEl?.focus());
    });

    function close() {
        show = false;
        onclose();
        tick().then(() => opener?.focus());
    }

    function handleKey(e: KeyboardEvent) {
        e.stopPropagation();
        if (e.defaultPrevented) {
            return;
        }
        if (e.key === 'Escape') {
            close();
            return;
        }
        if (e.key !== 'Tab' || !dialogEl) {
            return;
        }
        const controls = [
            ...dialogEl.querySelectorAll<HTMLElement>(
                'button, input, select, textarea, a[href], summary, [tabindex="0"]',
            ),
        ].filter(
            element => !element.matches(':disabled, [tabindex="-1"]') && element.checkVisibility(),
        );
        const first = controls[0];
        const last = controls.at(-1);
        if (!first) {
            e.preventDefault();
            dialogEl.focus();
        } else if (
            e.shiftKey &&
            (document.activeElement === first || document.activeElement === dialogEl)
        ) {
            e.preventDefault();
            last?.focus();
        } else if (
            !e.shiftKey &&
            (document.activeElement === last || document.activeElement === dialogEl)
        ) {
            e.preventDefault();
            first.focus();
        }
    }
</script>

{#if show}
    <div class="modal-overlay">
        <button class="modal-backdrop" aria-label="Close dialog" onclick={close} type="button"
        ></button>
        <div
            bind:this={dialogEl}
            style="width: {width}; height: {height}"
            class="modal-content"
            aria-label={title}
            aria-modal="true"
            onkeydown={handleKey}
            role="dialog"
            tabindex="-1"
        >
            <div class="modal-header">
                <h3>{title}</h3>
                {#if headerActions}
                    <div class="modal-header-actions">
                        {@render headerActions()}
                    </div>
                {/if}
                <button class="close-btn" aria-label="Close dialog" onclick={close}>&times;</button>
            </div>
            <div class="modal-body {bodyClass}">
                {@render children?.()}
            </div>
        </div>
    </div>
{/if}

<style>
    .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--color-overlay);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
    }

    .modal-backdrop {
        position: absolute;
        inset: 0;
        border: 0;
        background: transparent;
        cursor: default;
    }

    .modal-content {
        position: relative;
        z-index: 1;
        box-sizing: border-box;
        background: var(--color-surface);
        border: 1px solid var(--border);
        border-radius: 2px;
        box-shadow:
            0 24px 56px rgba(0, 0, 0, 0.7),
            inset 0 2px var(--accent);
        display: flex;
        flex-direction: column;
        max-width: calc(100vw - 32px);
        max-height: calc(100dvh - 32px);
    }

    .modal-header {
        padding: 14px 16px 12px;
        border-bottom: 1px solid var(--border);
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .modal-header h3 {
        margin: 0;
        flex: 0 0 auto;
        font-size: 12px;
        color: var(--accent2);
        letter-spacing: 0.12em;
    }

    .modal-header-actions {
        display: flex;
        flex: 1;
        justify-content: flex-end;
        min-width: 0;
    }

    .close-btn {
        background: transparent;
        border: none;
        color: var(--color-text-muted);
        font-size: 20px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
    }

    .close-btn:hover {
        color: var(--primary-text);
    }

    .modal-content:focus-visible,
    .close-btn:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }

    .modal-body {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 16px;
    }
</style>
