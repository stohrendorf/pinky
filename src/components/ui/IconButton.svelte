<script lang="ts">
    interface Props {
        icon: string;
        variant?: 'primary' | 'secondary' | 'ghost';
        disabled?: boolean;
        title?: string;
        ariaLabel?: string;
        className?: string;
        onclick?: (event: MouseEvent) => void;
    }

    const {
        icon,
        variant = 'secondary',
        disabled = false,
        title = '',
        ariaLabel = '',
        className = '',
        onclick = () => {},
    }: Props = $props();
</script>

<button
    class="icon-btn {variant} {className}"
    aria-label={ariaLabel || title}
    {disabled}
    {onclick}
    {title}
>
    <i class="fa {icon}"></i>
</button>

<style>
    .icon-btn {
        border: 1px solid transparent;
        color: var(--primary-text);
        width: 32px;
        height: 32px;
        border-radius: 5px;
        cursor: pointer;
        transition:
            background-color 0.12s ease,
            border-color 0.12s ease,
            color 0.12s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
    }

    .icon-btn:hover:not(:disabled) {
        filter: none;
    }

    .icon-btn.primary {
        background: var(--accent);
        color: var(--action-text);
    }

    .icon-btn.secondary {
        background: var(--color-surface-raised);
        border-color: var(--border);
    }

    .icon-btn.ghost {
        background: transparent;
    }

    .icon-btn.secondary:hover:not(:disabled),
    .icon-btn.ghost:hover:not(:disabled) {
        background: var(--color-surface-hover);
        border-color: var(--border);
    }

    .icon-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }
</style>
