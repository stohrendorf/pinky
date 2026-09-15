<script lang="ts">
    interface Props {
        icon: string;
        variant?: 'primary' | 'secondary' | 'ghost' | 'outline';
        size?: 'standard' | 'compact';
        disabled?: boolean;
        title?: string;
        ariaLabel?: string;
        className?: string;
        pressed?: boolean | undefined;
        expanded?: boolean | undefined;
        ariaControls?: string | undefined;
        element?: HTMLButtonElement | null;
        type?: 'button' | 'submit' | 'reset';
        onclick?: (event: MouseEvent) => void;
    }

    let {
        icon,
        variant = 'secondary',
        size = 'standard',
        disabled = false,
        title = '',
        ariaLabel = '',
        className = '',
        pressed = undefined,
        expanded = undefined,
        ariaControls = undefined,
        element = $bindable<HTMLButtonElement | null>(null),
        type = 'button',
        onclick = () => {},
    }: Props = $props();
</script>

<button
    bind:this={element}
    class="icon-btn {variant} {size} {className}"
    aria-controls={ariaControls}
    aria-expanded={expanded}
    aria-label={ariaLabel || title}
    aria-pressed={pressed}
    {disabled}
    {onclick}
    {title}
    {type}
>
    <i class="fa {icon}"></i>
</button>

<style>
    .icon-btn {
        box-sizing: border-box;
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

    .icon-btn.compact {
        width: 24px;
        height: 22px;
        border-radius: 4px;
        font-size: 11px;
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

    .icon-btn.outline {
        background: var(--color-surface);
        border-color: var(--border);
        color: var(--accent);
    }

    .icon-btn.secondary:hover:not(:disabled),
    .icon-btn.ghost:hover:not(:disabled),
    .icon-btn.outline:hover:not(:disabled) {
        background: var(--color-surface-hover);
        border-color: var(--border);
    }

    .icon-btn[aria-pressed='true']:not(:disabled) {
        border-color: var(--accent);
        background: var(--color-accent-soft);
        color: var(--accent);
    }

    .icon-btn:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }

    .icon-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }
</style>
