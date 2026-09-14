<script lang="ts" module>
    const CONTEXT_MENU_OPEN_EVENT = 'pinky:context-menu-open';
    let nextContextMenuId = 0;
</script>

<script lang="ts">
    import { onMount, tick } from 'svelte';

    interface Props {
        open?: boolean;
        anchor?: HTMLElement | null;
        point?: { x: number; y: number } | null;
        actions?: { id: string; label: string; icon?: string; disabled?: boolean }[];
        onselect?: (action: string) => void;
        onclose?: () => void;
    }

    const {
        open = false,
        anchor = null,
        point = null,
        actions = [],
        onselect = () => {},
        onclose = () => {},
    }: Props = $props();

    let menuEl: HTMLDivElement | undefined = $state();
    let position = $state({ top: 0, left: 0 });
    const menuId = ++nextContextMenuId;

    async function updatePosition() {
        if (!anchor && !point) {
            return;
        }
        await tick();
        const menuWidth = menuEl?.offsetWidth || 150;
        const menuHeight = menuEl?.offsetHeight || actions.length * 30 + 8;
        const left = point?.x ?? anchor!.getBoundingClientRect().right - menuWidth;
        const top = point?.y ?? anchor!.getBoundingClientRect().bottom + 2;
        position = {
            top: Math.max(4, Math.min(top, window.innerHeight - menuHeight - 4)),
            left: Math.max(4, Math.min(left, window.innerWidth - menuWidth - 4)),
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
        event.preventDefault();
        event.stopPropagation();
        onclose();
    }

    function handleKeydown(event: KeyboardEvent) {
        if (open && event.key === 'Escape') {
            onclose();
        }
    }

    function handleOtherContextMenu(event: Event) {
        if (open && (event as CustomEvent<number>).detail !== menuId) {
            onclose();
        }
    }

    $effect.pre(() => {
        if (open) {
            updatePosition();
            window.dispatchEvent(new CustomEvent(CONTEXT_MENU_OPEN_EVENT, { detail: menuId }));
        }
    });

    onMount(() => {
        const reposition = () => updatePosition();
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);
        window.addEventListener(CONTEXT_MENU_OPEN_EVENT, handleOtherContextMenu);
        return () => {
            window.removeEventListener('resize', reposition);
            window.removeEventListener('scroll', reposition, true);
            window.removeEventListener(CONTEXT_MENU_OPEN_EVENT, handleOtherContextMenu);
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
