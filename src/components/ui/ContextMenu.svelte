<script lang="ts">
    import { onMount, tick } from 'svelte';
    import { run } from 'svelte/legacy';

    interface Props {
        open?: boolean;
        anchor?: HTMLElement | null;
        actions?: { id: string; label: string; icon?: string; disabled?: boolean }[];
        onselect?: (action: string) => void;
        onclose?: () => void;
    }

    const {
        open = false,
        anchor = null,
        actions = [],
        onselect = () => {},
        onclose = () => {},
    }: Props = $props();

    let menuEl: HTMLDivElement | undefined = $state();
    let position = $state({ top: 0, left: 0 });

    async function updatePosition() {
        if (!anchor) {
            return;
        }
        await tick();
        const bounds = anchor.getBoundingClientRect();
        const menuWidth = menuEl?.offsetWidth || 150;
        const menuHeight = menuEl?.offsetHeight || actions.length * 30 + 8;
        position = {
            top: Math.max(4, Math.min(bounds.bottom + 2, window.innerHeight - menuHeight - 4)),
            left: Math.max(
                4,
                Math.min(bounds.right - menuWidth, window.innerWidth - menuWidth - 4),
            ),
        };
    }

    function handleWindowClick(event: MouseEvent) {
        if (
            !open ||
            menuEl?.contains(event.target as Node) ||
            anchor?.contains(event.target as Node)
        ) {
            return;
        }
        onclose();
    }

    function handleKeydown(event: KeyboardEvent) {
        if (open && event.key === 'Escape') {
            onclose();
        }
    }

    run(() => {
        if (open) {
            updatePosition();
        }
    });

    onMount(() => {
        const reposition = () => updatePosition();
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);
        return () => {
            window.removeEventListener('resize', reposition);
            window.removeEventListener('scroll', reposition, true);
        };
    });
</script>

<svelte:window onclickcapture={handleWindowClick} onkeydown={handleKeydown} />

{#if open}
    <div
        bind:this={menuEl}
        style="top: {position.top}px; left: {position.left}px;"
        class="context-menu"
        role="menu"
    >
        {#each actions as menu (menu.id)}
            <button
                disabled={menu.disabled}
                onclick={() => onselect(menu.id)}
                role="menuitem"
                type="button"
            >
                <i class="fa {menu.icon || ''}" aria-hidden="true"></i>{menu.label}
            </button>
        {/each}
    </div>
{/if}

<style>
    .context-menu {
        position: fixed;
        z-index: 1000;
        min-width: 150px;
        padding: 4px;
        background: var(--color-surface-raised);
        border: 1px solid var(--border);
        border-radius: 4px;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
    }

    .context-menu button {
        display: flex;
        gap: 8px;
        align-items: center;
        width: 100%;
        padding: 6px 8px;
        background: transparent;
        border: 0;
        color: var(--primary-text);
        font: inherit;
        font-size: 11px;
        text-align: left;
        cursor: pointer;
    }

    .context-menu button:hover {
        background: var(--color-surface-hover);
    }

    .context-menu button:disabled {
        opacity: 0.35;
        cursor: default;
    }

    .context-menu i {
        width: 12px;
        color: var(--accent2);
    }
</style>
