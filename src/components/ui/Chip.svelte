<script lang="ts">
    interface Props {
        selected?: boolean;
        className?: string;
        onclick?: (event: MouseEvent) => void;
        children?: import('svelte').Snippet;
    }

    const { selected = false, className = '', onclick = () => {}, children }: Props = $props();
</script>

<button class="chip {selected ? 'sel' : ''} {className}" {onclick}>
    {@render children?.()}
</button>

<style>
    .chip {
        background: var(--border);
        padding: 5px 12px;
        font-size: 12px;
        border: none;
        color: var(--primary-text);
        border-radius: 4px;
        cursor: pointer;
        transition: background 0.1s;
    }

    .chip.sel {
        background: var(--accent);
    }

    .chip:hover:not(.sel) {
        background: var(--color-surface-hover);
    }
</style>
