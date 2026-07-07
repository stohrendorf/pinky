<script lang="ts">
    /* Global key handling + the "?" cheat sheet */
    import {
        handleShortcut, SHORTCUT_GROUPS, showShortcuts
    } from '../lib/shortcuts';
    import Dialog from './ui/Dialog.svelte';
</script>

<svelte:window onkeydown={handleShortcut}/>

<Dialog title="Keyboard Shortcuts" width="520px" bind:show={$showShortcuts}>
    <div class="groups">
        {#each SHORTCUT_GROUPS as g (g.title)}
            <div class="group">
                <h4>{g.title}</h4>
                {#each g.items as [keys, what] (keys)}
                    <div class="row">
                        <kbd>{keys}</kbd>
                        <span>{what}</span>
                    </div>
                {/each}
            </div>
        {/each}
    </div>
</Dialog>

<style>
    .groups {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 14px;
    }

    h4 {
        margin: 0 0 6px;
        font-size: 11px;
        color: var(--accent2);
        text-transform: uppercase;
        letter-spacing: 1px;
    }

    .row {
        display: flex;
        align-items: baseline;
        gap: 8px;
        font-size: 12px;
        margin-bottom: 4px;
    }

    .row span {
        opacity: .7;
    }

    kbd {
        background: var(--border);
        border-radius: 4px;
        padding: 2px 6px;
        font-size: 11px;
        font-family: inherit;
        white-space: nowrap;
        flex-shrink: 0;
    }
</style>
