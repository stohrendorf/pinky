<script lang="ts">
    import {
        createEventDispatcher
    } from 'svelte';

    const dispatch = createEventDispatcher<{ click: MouseEvent }>();

    interface Props {
        variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
        disabled?: boolean;
        title?: string;
        type?: 'button' | 'submit' | 'reset';
        className?: string;
        pressed?: boolean | undefined;
        expanded?: boolean | undefined;
        ariaControls?: string | undefined;
        compact?: boolean;
        children?: import('svelte').Snippet;
    }

    const {
        variant = 'primary',
        disabled = false,
        title = '',
        type = 'button',
        className = '',
        pressed = undefined,
        expanded = undefined,
        ariaControls = undefined,
        compact = false,
        children
    }: Props = $props();
</script>

<button
        class="btn {variant} {compact ? 'compact' : ''} {className}"
        aria-controls={ariaControls}
        aria-expanded={expanded}
        aria-pressed={pressed}
        {disabled}
        onclick={event => dispatch('click', event)}
        {title}
        {type}
>
    {@render children?.()}
</button>

<style>
    .btn {
        border: 1px solid transparent;
        color: var(--primary-text);
        padding: 7px 12px;
        font-size: 11px;
        font-weight: 600;
        border-radius: 2px;
        letter-spacing: .055em;
        cursor: pointer;
        transition: background-color .12s ease, border-color .12s ease, color .12s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        line-height: 1;
    }

    .btn.compact {
        padding: 5px 10px;
        font-size: 12px;
    }

    .btn:hover:not(:disabled) {
        filter: none;
    }

    .btn:active:not(:disabled) {
        transform: translateY(1px);
    }

    .btn.primary {
        background: var(--accent);
        border-color: var(--accent);
        color: var(--action-text);
    }

    .btn.secondary {
        background: var(--color-surface-raised);
        border-color: var(--border);
    }

    .btn.danger {
        background: var(--color-danger);
    }

    .btn.ghost {
        background: transparent;
        border-color: transparent;
    }

    .btn.secondary:hover:not(:disabled),
    .btn.ghost:hover:not(:disabled) {
        background: var(--color-surface-hover);
        border-color: var(--border);
    }

    .btn.primary:hover:not(:disabled) {
        background: var(--color-accent-bright);
        border-color: var(--color-accent-bright);
    }

    .btn:disabled {
        opacity: .3;
        cursor: not-allowed;
    }
</style>
