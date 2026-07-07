import {
    readFileSync
} from 'node:fs';
import {
    fileURLToPath
} from 'node:url';
import {
    describe, expect, it
} from 'vitest';

const playlist = readFileSync(fileURLToPath(new URL('./Playlist.svelte', import.meta.url)), 'utf8');

describe('Playlist frozen track labels', () => {
    it('keeps labels outside the horizontally scrolling grid pane', () => {
        expect(playlist).toMatch(/class="frozen-track-labels"/);
        expect(playlist).toMatch(/class="grid-viewport"/);
        expect(playlist).toMatch(/\.playlist-scroll\s*\{[^}]*overflow:\s*hidden;/s);
        expect(playlist).toMatch(/\.grid-viewport\s*\{[^}]*overflow:\s*auto;/s);
    });

    it('keeps selected-clip controls within the arranger width', () => {
        expect(playlist).toMatch(/\.playlist-container\s*\{[^}]*min-width:\s*0;/s);
        expect(playlist).toMatch(/\.clip-tools\s*\{[^}]*overflow-x:\s*auto;/s);
    });

    it('keeps song orientation visible by identifying all uses of the open pattern', () => {
        expect(playlist).toContain('currentPatternClips');
        expect(playlist).toContain('currentPatternLocations');
        expect(playlist).toContain('class="pattern-usage"');
        expect(playlist).toContain('class:open-pattern={clip.patternId === $selPatId}');
        expect(playlist).toMatch(/\.clip\.open-pattern\s*\{[\s\S]*box-shadow:/);
    });

    it('keeps the song playhead visible while playback advances', () => {
        expect(playlist).toContain('function scrollPlayheadIntoView');
        expect(playlist).toContain('scrollPlayheadIntoView(playlistEl, $curStep, cellWidth)');
    });

    it('hides the arranger playhead while previewing one pattern', () => {
        expect(playlist).toContain('curStep, playMode, playing, project');
        expect(playlist).toContain('{#if $playing && $playMode === \'song\'}');
    });

    it('uses the timeline corner for the automation action and retains a stable selection toolbar', () => {
        expect(playlist).toContain('aria-label="Add track"');
        expect(playlist).toMatch(/class="corner frozen-corner"[\s\S]*aria-label="Add automation lane"/);
        expect(playlist).toContain('class="playlist-header"');
        expect(playlist).toMatch(/\{#if selectedClips\.length}[\s\S]*class="clip-tools"/);
        expect(playlist).toMatch(/\.playlist-header\s*\{[^}]*height:\s*40px;/s);
        expect(playlist).toMatch(/class="playlist-footer">[\s\S]*Click an empty lane to clear the selection/);
    });

    it('coordinates one selected automation point and popup across all lanes', () => {
        expect(playlist).toMatch(/let selectedAutomationPoint:\s*\{\s*laneId: string;\s*point: AutomationPoint\s*}\s*\| null\s*= \$state\(null\)/);
        expect(playlist).toContain('selectedPoint={selectedAutomationPoint?.laneId === lane.id ? selectedAutomationPoint.point : null}');
        expect(playlist).toContain('hasSelectedPoint={!!selectedAutomationPoint}');
        expect(playlist).toContain('editorKey={`automation:${lane.id}`}');
        expect(playlist).toContain('bind:contextualEditor');
    });

    it('keeps complete automation target and parameter names readable in the frozen labels', () => {
        expect(playlist).toContain('class="auto-name" title={laneTitle($project!, lane)}');
        expect(playlist).toContain('class="auto-target"');
        expect(playlist).toContain('class="auto-param"');
        expect(playlist).toMatch(/\.auto-label \.auto-name\s*\{[^}]*flex-direction:\s*column;/s);
    });

    it('clears clip selection before an automation lane can edit points', () => {
        expect(playlist).toContain('canEdit={shouldEditAutomation(selectedClips.length > 0)}');
        expect(playlist).toContain('onblocked={clearSelection}');
    });

    it('clears a selected automation point before placing a pattern clip', () => {
        expect(playlist).toContain('if (selectedAutomationPoint)');
        expect(playlist).toContain('selectAutomationPoint(null, null);');
        expect(playlist.indexOf('selectAutomationPoint(null, null);')).toBeLessThan(playlist.lastIndexOf('const found = $project.arrangement.find(c => c.track === t'));
    });

    it('renders automation lanes as draggable rows that can occupy track slots', () => {
        expect(playlist).toContain('$project.automationPositions');
        expect(playlist).toContain('const arrangerRows = $derived');
        expect(playlist).toContain('draggable="true"');
        expect(playlist).toMatch(/startAutomationDrag\(event(?: as DragEvent)?, lane\)/);
        expect(playlist).toMatch(/dropAutomationLane\(event(?: as DragEvent)?, lane\)/);
        expect(playlist).toContain('rowTopForTrack(clip.track)');
    });

    it('uses mixed row heights for clips and selections beside automation lanes', () => {
        expect(playlist).toContain('function rowTopForTrack(trackIndex: number): number');
        expect(playlist).toContain('top: {rowTopForTrack(clip.track) + 2}px;');
        expect(playlist).toContain('top: Math.min(rowTopForTrack(selectionStart.t), rowTopForTrack(selectionEnd.t))');
    });

    it('shows a shared insertion indicator while dragging arranger rows', () => {
        expect(playlist).toContain('let dragInsertionRow: number | null = $state(null)');
        expect(playlist).toContain('function updateDragInsertion');
        expect(playlist).toContain('function rowBoundaryTop');
        expect(playlist).toContain('class="drop-indicator"');
        expect(playlist).toContain('style="top: {rowBoundaryTop(dragInsertionRow)}px;"');
        expect(playlist).toMatch(/\.drop-indicator\s*\{[^}]*pointer-events:\s*none;[^}]*background:\s*var\(--action\);/s);
    });

    it('offers guarded lane removal beside the existing track controls', () => {
        expect(playlist).toContain('aria-label="Remove track"');
        expect(playlist).toContain('class="auto-label track-label"');
        expect(playlist).toMatch(/<button\b(?=[^>]*\bclass="ms remove-track")(?=[^>]*\baria-label="Remove automation lane")[^>]*>/);
        expect(playlist).toContain('requestRemoveAutoLane(lane)');
        expect(playlist).toContain('let showRemoveAutoLane = $state(false)');
        expect(playlist).toContain("import Confirm from './ui/Confirm.svelte'");
        expect(playlist).toContain('title="Remove Automation Lane"');
        expect(playlist).toContain('bind:show={showRemoveAutoLane}');
        expect(playlist).toContain('confirmLabel="Remove lane"');
        expect(playlist).toContain('on:confirm={removeAutoLane}');
        expect(playlist).toContain('showRemoveTrack');
        expect(playlist).toContain('confirmLabel="Remove track"');
        expect(playlist).toContain('on:confirm={removeTrack}');
        expect(playlist).toContain('removeArrangementTrack($project.tracks, $project.arrangement, trackToRemove)');
    });

    it('shows square left-edge insertion controls at every track divider and supports lane drag reordering', () => {
        expect(playlist).toContain('class="track-divider top-track-divider"');
        expect(playlist).toContain('onclick={stopPropagation(() => insertTrack(0))}');
        expect(playlist).toContain('aria-label="Insert track"');
        expect(playlist).toContain('class="track-insert"');
        expect(playlist).toMatch(/\.track-divider:hover::before[^}]*border-color:\s*var\(--action\)/s);
        expect(playlist).toMatch(/\.track-insert\s*\{[^}]*border-radius:\s*3px;/s);
        expect(playlist).toMatch(/\.track-insert\s*\{[^}]*left:\s*6px;/s);
        expect(playlist).toMatch(/\.track-insert\s*\{[^}]*padding:\s*0;/s);
        expect(playlist).toMatch(/\.track-insert\s*\{[^}]*place-items:\s*center;/s);
        expect(playlist).toMatch(/\.track-divider\s*\{[^}]*top:\s*-9px;/s);
        expect(playlist).toMatch(/\.track-divider::before\s*\{[^}]*top:\s*50%;/s);
        expect(playlist).toMatch(/\.track-insert\s*\{[^}]*background:\s*var\(--action\);/s);
        expect(playlist).toMatch(/\.track-insert:focus-visible\s*\{[^}]*opacity:\s*1;/s);
        expect(playlist).toContain('.track-divider:has(:global(.track-insert:focus-visible))::before');
        expect(playlist).not.toContain('.track-divider:focus-within::before');
        expect(playlist).not.toContain('.track-divider:focus-within .track-insert');
        expect(playlist).toContain('draggable="true"');
        expect(playlist).toMatch(/ondragstart=\{\(event\) => startTrackDrag\(event(?: as DragEvent)?, t\)\}/);
        expect(playlist).toMatch(/ondrop=\{\(event\) => dropTrack\(event(?: as DragEvent)?, t\)\}/);
        expect(playlist).toMatch(/\.track-divider\s*\{[^}]*pointer-events:\s*none;/s);
        expect(playlist).toMatch(/\.track-divider:hover \.track-insert[\s\S]*pointer-events:\s*auto;/s);
    });
});