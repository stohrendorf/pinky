<script lang="ts">
    import {onDestroy} from 'svelte';

    import type { ArrangementClip, AutomationLane as Lane, AutomationPoint } from '../lib/types';

    import {
        addArrangementTrack,
        getPatternPreview,
        insertArrangementTrack,
        moveArrangementTrack,
        type PreviewNote,
        removeArrangementTrack,
        shouldEditAutomation,
        shouldPlacePattern,
    } from '../lib/arrangement';
    import {
        automationCurrentValue,
        autoParamDef,
        autoParams,
        laneColor,
        laneTargetTitle,
        laneTitle,
        laneValueAt,
        newLane,
    } from '../lib/automation';
    import { master } from '../lib/engine';
    import {
        curStep,
        playing,
        playMode,
        project,
        selPatId,
        songCursor,
        touch,
    } from '../lib/project';
    import { rendering } from '../lib/render';
    import { barAt, barsInRange, snapToBeat } from '../lib/timing';
    import { seekSong } from '../lib/transport';
    import {
        createViewportState,
        handleViewportMouseDown,
        handleViewportMouseMove,
        handleViewportMouseUp,
        handleViewportWheel,
    } from '../lib/viewport';
    import AutomationLane from './AutomationLane.svelte';
    import AutomationPicker from './AutomationPicker.svelte';
    import Conductor from './Conductor.svelte';
    import { preventDefault, stopPropagation } from './event-modifiers';
    import Button from './ui/Button.svelte';
    import ColorPicker from './ui/ColorPicker.svelte';
    import Confirm from './ui/Confirm.svelte';
    import ContextMenu from './ui/ContextMenu.svelte';
    import Dialog from './ui/Dialog.svelte';
    import Prompt from './ui/Prompt.svelte';

    interface Props {
        contextualEditor?: string | null;
    }

    let { contextualEditor = $bindable(null) }: Props = $props();

    interface ExtendedClip extends ArrangementClip {
        _initStart?: number;
        _initLen?: number;
        _initTrack?: number;
    }

    let dragClip: ExtendedClip | null = $state(null);
    let dragStartRawS = 0;
    let dragStartPos = { s: 0, t: 0 };
    let dragOffset = { s: 0, t: 0 };
    let resizeMode = $state(false);
    let playlistEl: HTMLElement | undefined = $state();
    let scrollLeft = $state(0);
    let scrollTop = $state(0);
    let viewportWidth = $state(0);
    let arrangerZoom = $state({
        width: $project?.zoom.arr.width ?? 24,
        height: $project?.zoom.arr.height ?? 32,
    });
    const unsubscribeProjectZoom = project.subscribe(currentProject => {
        if (currentProject) {
            arrangerZoom = {...currentProject.zoom.arr};
        }
    });
    onDestroy(unsubscribeProjectZoom);

    function setZoom(w: number, h: number) {
        if (!$project) {
            return;
        }
        arrangerZoom.width = w;
        arrangerZoom.height = h;
        $project.zoom.arr.width = w;
        $project.zoom.arr.height = h;
    }

    function syncFrozenPanes() {
        if (!playlistEl) {
            return;
        }
        scrollLeft = playlistEl.scrollLeft;
        scrollTop = playlistEl.scrollTop;
    }

    function scrollPlayheadIntoView(
        container: HTMLElement | undefined,
        step: number,
        width: number,
    ) {
        if (!container) {
            return;
        }
        const position = step * width - container.scrollLeft;
        const padding = Math.min(48, container.clientWidth / 4);
        if (position >= padding && position <= container.clientWidth - padding) {
            return;
        }
        const nextLeft = step * width - container.clientWidth * 0.35;
        container.scrollLeft = Math.max(
            0,
            Math.min(nextLeft, container.scrollWidth - container.clientWidth),
        );
    }

    const viewport = createViewportState();

    let isSelecting = $state(false);
    let isRightDragging = false;
    let selectionStart = $state({ s: 0, t: 0 });
    let selectionEnd = $state({ s: 0, t: 0 });
    // Keep the lane's original point reference. Deep $state proxies would make
    // the selected point fail identity lookups in the lane when it is edited.
    let selectedAutomationPoint: { laneId: string; point: AutomationPoint } | null = $state.raw(null);

    const previewCache = new Map<string, PreviewNote[]>();

    function selectAutomationPoint(lane: Lane | null, point: AutomationPoint | null) {
        selectedAutomationPoint = point && lane ? { laneId: lane.id, point } : null;
    }

    // timeline interaction: click = place playback cursor, drag = mark loop region
    let loopDragging = false;
    let loopAnchor = 0;
    let loopPreview: { start: number; end: number } | null = $state(null);

    function timelineStep(e: MouseEvent): number {
        const grid = playlistEl?.querySelector('.grid-container') as HTMLElement;
        if (!grid) {
            return 0;
        }
        return (e.clientX - grid.getBoundingClientRect().left) / cellWidth;
    }

    function handleTimelineMouseDown(e: MouseEvent) {
        if ($rendering) {
            return;
        }
        if (e.button === 2) {
            // right-click clears the loop
            if ($project?.loop) {
                $project.loop = null;
                touch();
            }
            return;
        }
        if (e.button !== 0) {
            return;
        }
        e.stopPropagation();
        loopDragging = true;
        loopAnchor = timelineStep(e);
        loopPreview = null;
    }

    let editingTrackIdx: number | null = $state(null);
    let showRenameTrack = $state(false);
    let renameTrackValue = $state('');
    let showTrackColor = $state(false);
    let showRemoveTrack = $state(false);
    let trackToRemove: number | null = null;
    let contextMenuTarget = $state<
        { kind: 'track'; trackIndex: number } | { kind: 'automation'; lane: Lane } | null
    >(null);
    let contextMenuPoint = $state<{ x: number; y: number } | null>(null);
    let draggingTrack: number | null = $state(null);
    let draggingAutomationLane: string | null = null;
    let dragInsertionRow: number | null = $state(null);

    // Clip pitch: semitone transpose is the usual musical interval; an optional
    // exact harmonic multiplier layers partials from the same written pattern.
    const TRANSPOSE_MAX = 24;
    const PARTIAL_MAX = 24;
    const CLIP_GAIN_STEP = 0.1;
    let showPartialControls = $state(false);

    function hasPartialMultiplier(clip: ArrangementClip): boolean {
        return (clip.partial ?? 1) !== 1;
    }

    function transposeClips(delta: number) {
        if (!$project || !selectedClips.length) {
            return;
        }
        selectedClips.forEach(c => {
            c.transpose = Math.max(
                -TRANSPOSE_MAX,
                Math.min(TRANSPOSE_MAX, (c.transpose || 0) + delta),
            );
        });
        touch();
    }

    function resetClipTranspose() {
        if (!$project || !selectedClips.length) {
            return;
        }
        selectedClips.forEach(c => (c.transpose = 0));
        touch();
    }

    function setClipTranspose(value: number) {
        if (!$project || !selectedClips.length || !Number.isFinite(value)) {
            return;
        }
        selectedClips.forEach(c => {
            c.transpose = Math.max(-TRANSPOSE_MAX, Math.min(TRANSPOSE_MAX, value));
        });
        touch();
    }

    function adjustClipPartial(delta: number) {
        if (!$project || !selectedClips.length) {
            return;
        }
        selectedClips.forEach(c => {
            c.partial = Math.max(1, Math.min(PARTIAL_MAX, (c.partial ?? 1) + delta));
        });
        touch();
    }

    function setClipPartial(value: number) {
        if (!$project || !selectedClips.length || !Number.isFinite(value)) {
            return;
        }
        selectedClips.forEach(c => {
            c.partial = Math.max(1, Math.min(PARTIAL_MAX, Math.round(value)));
        });
        touch();
    }

    function resetClipPartial() {
        if (!$project || !selectedClips.length) {
            return;
        }
        selectedClips.forEach(c => delete c.partial);
        touch();
    }

    function adjustClipGain(delta: number) {
        if (!$project || !selectedClips.length) {
            return;
        }
        selectedClips.forEach(c => {
            c.gain = Math.max(0, Math.min(1, (c.gain ?? 1) + delta));
        });
        touch();
    }

    function setClipGainPercent(value: number) {
        if (!$project || !selectedClips.length || !Number.isFinite(value)) {
            return;
        }
        selectedClips.forEach(c => {
            c.gain = Math.max(0, Math.min(1, value / 100));
        });
        touch();
    }

    function resetClipGain() {
        if (!$project || !selectedClips.length) {
            return;
        }
        selectedClips.forEach(c => delete c.gain);
        touch();
    }

    const semiLabel = (n: number): string => (n > 0 ? '+' : '') + n;
    const partialLabel = (partial: number | undefined): string => `${partial ?? 1}×`;
    const gainLabel = (gain: number | undefined): string => `${Math.round((gain ?? 1) * 100)}%`;

    function clearSelection() {
        if ($project) {
            $project.arrangement.forEach(c => (c.selected = false));
            touch();
        }
    }

    function deleteClipAt(t: number, s_raw: number) {
        if (!$project) {
            return;
        }
        const found = $project.arrangement.find(
            c => c.track === t && s_raw >= c.start && s_raw < c.start + c.len,
        );
        if (found) {
            $project.arrangement = $project.arrangement.filter(c => c !== found);
            touch();
        }
    }

    function handleMouseDown(e: MouseEvent, t: number, s_raw: number) {
        if (e.button === 1) {
            return;
        }
        if (!$project) {
            return;
        }

        const snap =
            cellWidth > 160
                ? 0.0625
                : cellWidth > 80
                  ? 0.125
                  : cellWidth > 40
                    ? 0.25
                    : cellWidth > 20
                      ? 0.5
                      : 1;
        const s = Math.round(s_raw / snap) * snap;

        if (e.button === 2) {
            // Right click delete
            isRightDragging = true;
            deleteClipAt(t, s_raw);
            return;
        }

        if (e.button !== 0) {
            return;
        }

        if (selectedAutomationPoint) {
            selectAutomationPoint(null, null);
            return;
        }

        const found = $project.arrangement.find(
            c => c.track === t && s_raw >= c.start && s_raw < c.start + c.len,
        ) as ExtendedClip;

        if (e.ctrlKey && !found) {
            isSelecting = true;
            selectionStart = { s: s_raw, t };
            selectionEnd = { s: s_raw, t };
            if (!e.shiftKey) {
                clearSelection();
            }
            return;
        }

        if (found) {
            if (e.shiftKey || e.ctrlKey) {
                found.selected = !found.selected;
            } else {
                if (!found.selected) {
                    clearSelection();
                    found.selected = true;
                }
            }
            dragClip = found;
            dragStartRawS = s_raw;
            dragStartPos = { s, t };

            const targetClips = found.selected
                ? ($project.arrangement.filter(c => c.selected) as ExtendedClip[])
                : [found];
            if ((e.target as HTMLElement).classList.contains('resize-handle')) {
                resizeMode = true;
                targetClips.forEach(c => (c._initLen = c.len));
            } else {
                resizeMode = false;
                dragOffset = { s: s - found.start, t: t - found.track };
                targetClips.forEach(c => {
                    c._initStart = c.start;
                    c._initTrack = c.track;
                });
            }
            touch();
        } else {
            if (!shouldPlacePattern(selectedClips.length > 0, e.shiftKey)) {
                clearSelection();
                return;
            }
            if (!e.shiftKey) {
                clearSelection();
            }
            const pat = $project.patterns.find(p => p.id === $selPatId);
            const newClip: ExtendedClip = {
                id: Math.random().toString(36).slice(2),
                patternId: $selPatId || '',
                track: t,
                start: s,
                len: pat ? pat.steps || 32 : 32,
                selected: true,
            };
            $project.arrangement = [...$project.arrangement, newClip];
            dragClip = newClip;
            dragStartRawS = s_raw;
            dragStartPos = { s, t };
            dragOffset = { s: 0, t: 0 };
            newClip._initStart = newClip.start;
            newClip._initTrack = newClip.track;
            touch();
        }
    }

    function handleMouseMove(e: MouseEvent, t: number, s_raw: number) {
        if (isRightDragging) {
            deleteClipAt(t, s_raw);
            return;
        }

        if (isSelecting && $project) {
            selectionEnd = { s: s_raw, t };
            const s_min = Math.min(selectionStart.s, selectionEnd.s);
            const s_max = Math.max(selectionStart.s, selectionEnd.s);
            const t_min = Math.min(selectionStart.t, selectionEnd.t);
            const t_max = Math.max(selectionStart.t, selectionEnd.t);

            $project.arrangement.forEach(c => {
                const inRect =
                    c.start < s_max &&
                    c.start + c.len > s_min &&
                    c.track >= t_min &&
                    c.track <= t_max;
                if (e.shiftKey) {
                    if (inRect) {
                        c.selected = true;
                    }
                } else {
                    c.selected = inRect;
                }
            });
            touch();
            return;
        }

        if (!dragClip || isNaN(t) || isNaN(s_raw) || !$project) {
            return;
        }

        const snap =
            cellWidth > 160
                ? 0.0625
                : cellWidth > 80
                  ? 0.125
                  : cellWidth > 40
                    ? 0.25
                    : cellWidth > 20
                      ? 0.5
                      : 1;

        if (resizeMode) {
            const deltaLen = s_raw - dragStartRawS;
            const targetClips = dragClip.selected ? selectedClips : [dragClip];
            targetClips.forEach(c => {
                const initLen = c._initLen ?? c.len;
                const newLen = Math.max(snap, initLen + deltaLen);
                c.len = Math.round(newLen / snap) * snap;
            });
            touch();
        } else {
            const deltaS = s_raw - dragStartRawS;
            const deltaT = t - dragStartPos.t;
            const targetClips = dragClip.selected ? selectedClips : [dragClip];
            targetClips.forEach(c => {
                const initStart = c._initStart ?? c.start;
                const initTrack = c._initTrack ?? c.track;
                const newStart = Math.max(0, initStart + deltaS);
                c.start = Math.round(newStart / snap) * snap;
                c.track = Math.max(0, Math.min($project!.tracks.length - 1, initTrack + deltaT));
            });
            touch();
        }
    }

    function handleMouseUp() {
        if ($rendering) {
            loopDragging = false;
            loopPreview = null;
        }
        if (loopDragging) {
            loopDragging = false;
            if (loopPreview) {
                // a real drag → set the loop region
                if ($project) {
                    $project.loop = loopPreview;
                    touch();
                }
            } else {
                // just a click → place the playback cursor
                seekSong(loopAnchor);
            }
            loopPreview = null;
        }
        if (dragClip) {
            selectedClips.forEach(c => {
                delete c._initLen;
                delete c._initStart;
                delete c._initTrack;
            });
        }
        dragClip = null;
        handleViewportMouseUp(viewport);
        isSelecting = false;
        isRightDragging = false;
    }

    function handleWheel(e: WheelEvent) {
        // Alt + wheel over the arranger transposes the selected clips
        if (e.altKey && selectedClips.length) {
            e.preventDefault();
            const delta = (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 12 : 1);
            transposeClips(delta);
            return;
        }
        handleViewportWheel(e, viewportOptions);
    }

    function preventBrowserZoom(e: WheelEvent) {
        if (e.ctrlKey) {
            e.preventDefault();
        }
    }

    function handlePlaylistMouseDown(e: MouseEvent) {
        handleViewportMouseDown(e, viewport);
        const row = (e.target as Element).closest<HTMLElement>('.grid-row[data-track]');
        if (!row) {
            return;
        }
        const track = Number(row.dataset.track);
        const s_raw = (e.clientX - row.getBoundingClientRect().left) / cellWidth;
        handleMouseDown(e, track, s_raw);
    }

    function handleMouseMoveGlobal(e: MouseEvent) {
        if (handleViewportMouseMove(e, viewport, viewportOptions)) {
            return;
        }

        if (loopDragging) {
            const s = timelineStep(e);
            const timing = $project ?? { bpm: 112 };
            const a = snapToBeat(timing, Math.min(loopAnchor, s));
            const b = snapToBeat(timing, Math.max(loopAnchor, s));
            loopPreview = b > a ? { start: a, end: b } : null;
            return;
        }

        if (!playlistEl) {
            return;
        }
        const grid = playlistEl.querySelector('.grid-container') as HTMLElement;
        if (!grid) {
            return;
        }
        const rect = grid.getBoundingClientRect();
        const s_raw = (e.clientX - rect.left) / cellWidth;
        const t = trackIndexAtY(e.clientY - rect.top);
        handleMouseMove(e, t, s_raw);
    }

    function getPatternName(id: string) {
        return $project?.patterns.find(p => p.id === id)?.name || 'Unknown';
    }

    function getPatternColor(id: string) {
        return $project?.patterns.find(p => p.id === id)?.color || '#53d8fb';
    }

    function getPatternNotes(id: string, clipLen: number): PreviewNote[] {
        const pat = $project?.patterns.find(p => p.id === id);
        if (!pat) {
            return [];
        }
        const patSteps = pat.steps || 32;

        // Cache management
        const cacheKey = `${id}-${clipLen}-${patSteps}`;
        if (previewCache.has(cacheKey)) {
            return previewCache.get(cacheKey)!;
        }

        const repeatedNotes = getPatternPreview(pat, clipLen);
        if (repeatedNotes.length === 0) {
            return [];
        }

        previewCache.set(cacheKey, repeatedNotes);
        // Keep cache size reasonable
        if (previewCache.size > 100) {
            const firstKey = previewCache.keys().next().value;
            previewCache.delete(firstKey!);
        }
        return repeatedNotes;
    }

    function editTrack(trackIdx: number) {
        if (!$project) {
            return;
        }
        editingTrackIdx = trackIdx;
        renameTrackValue = $project.tracks[trackIdx].name;
        showRenameTrack = true;
    }

    function onRenameTrack(value: string) {
        if (editingTrackIdx !== null && $project && value) {
            $project.tracks[editingTrackIdx].name = value;
            touch();
        }
    }

    function activateOnKeyboard(event: KeyboardEvent, action: () => void) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            action();
        }
    }

    function toggleTrackMute(t: number) {
        if (!$project) {
            return;
        }
        $project.tracks[t].mute = !$project.tracks[t].mute;
        touch();
    }

    function toggleTrackSolo(t: number) {
        if (!$project) {
            return;
        }
        $project.tracks[t].solo = !$project.tracks[t].solo;
        touch();
    }

    function changeTrackColor(trackIdx: number) {
        if (!$project) {
            return;
        }
        editingTrackIdx = trackIdx;
        showTrackColor = true;
    }

    function closeContextMenu() {
        contextMenuTarget = null;
        contextMenuPoint = null;
    }

    function openTrackContextMenu(event: MouseEvent, trackIndex: number) {
        event.preventDefault();
        event.stopPropagation();
        contextMenuTarget = { kind: 'track', trackIndex };
        contextMenuPoint = { x: event.clientX, y: event.clientY };
    }

    function openAutomationContextMenu(event: MouseEvent, lane: Lane) {
        event.preventDefault();
        event.stopPropagation();
        contextMenuTarget = { kind: 'automation', lane };
        contextMenuPoint = { x: event.clientX, y: event.clientY };
    }

    function contextMenuActions() {
        switch(contextMenuTarget?.kind) {
            case 'track':
                return [
                    {id: 'rename', label: 'Rename track', icon: 'fa-pencil'},
                    {id: 'color', label: 'Track color', icon: 'fa-palette'},
                    {
                        id: 'delete',
                        label: 'Remove track',
                        icon: 'fa-trash',
                        disabled: ($project?.tracks.length ?? 0) <= 1,
                    },
                ];
            case 'automation':
                return [{id: 'delete', label: 'Remove automation lane', icon: 'fa-trash'}];
            default:
                return [];
        }
    }

    function selectContextMenuAction(action: string) {
        const target = contextMenuTarget;
        closeContextMenu();
        if (!target) {
            return;
        }
        if (target.kind === 'automation') {
            if (action === 'delete') {
                requestRemoveAutoLane(target.lane);
            }
            return;
        }
        switch(action) {
            case 'rename':
                editTrack(target.trackIndex);
                break;
            case 'color':
                changeTrackColor(target.trackIndex);
                break;
            case 'delete':
                requestRemoveTrack(target.trackIndex);
                break;
        }
    }

    function onTrackColorChange(value: string) {
        if (editingTrackIdx !== null && $project) {
            $project.tracks[editingTrackIdx].color = value;
            touch();
        }
    }

    function addTrack() {
        if (!$project) {
            return;
        }
        $project.tracks = addArrangementTrack($project.tracks);
        touch();
    }

    function insertTrack(index: number) {
        if (!$project) {
            return;
        }
        const updated = insertArrangementTrack($project.tracks, $project.arrangement, index);
        $project.tracks = updated.tracks;
        $project.arrangement = updated.arrangement;
        if ($project.automationPositions) {
            Object.keys($project.automationPositions).forEach(id => {
                if ($project!.automationPositions![id] >= index) {
                    $project!.automationPositions![id]++;
                }
            });
        }
        touch();
    }

    function startTrackDrag(event: DragEvent, trackIndex: number) {
        draggingTrack = trackIndex;
        dragInsertionRow = null;
        event.dataTransfer?.setData('text/plain', String(trackIndex));
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
        }
    }

    function updateDragInsertion(event: DragEvent, rowIndex: number) {
        if (draggingTrack === null && !draggingAutomationLane) {
            return;
        }
        const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
        dragInsertionRow = rowIndex + (event.clientY > bounds.top + bounds.height / 2 ? 1 : 0);
    }

    function clearDragState() {
        draggingTrack = null;
        draggingAutomationLane = null;
        dragInsertionRow = null;
    }

    function dropTrack(event: DragEvent, trackIndex: number) {
        if (draggingAutomationLane) {
            moveAutomationLane(
                draggingAutomationLane,
                trackIndex +
                    (event.clientY >
                    (event.currentTarget as HTMLElement).getBoundingClientRect().top +
                        (event.currentTarget as HTMLElement).getBoundingClientRect().height / 2
                        ? 1
                        : 0),
            );
            dragInsertionRow = null;
            return;
        }
        if (!$project || draggingTrack === null) {
            return;
        }
        const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const insertionIndex =
            trackIndex + (event.clientY > bounds.top + bounds.height / 2 ? 1 : 0);
        const updated = moveArrangementTrack(
            $project.tracks,
            $project.arrangement,
            draggingTrack,
            insertionIndex,
        );
        $project.tracks = updated.tracks;
        $project.arrangement = updated.arrangement;
        clearDragState();
        touch();
    }

    function startAutomationDrag(event: DragEvent, lane: Lane) {
        draggingAutomationLane = lane.id;
        dragInsertionRow = null;
        event.dataTransfer?.setData('text/plain', lane.id);
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
        }
    }

    function moveAutomationLane(laneId: string, slot: number, beforeLaneId?: string) {
        if (!$project) {
            return;
        }
        const lanes = $project.automation || [];
        const lane = lanes.find(item => item.id === laneId);
        if (!lane) {
            return;
        }
        $project.automationPositions = {
            ...($project.automationPositions || {}),
            [laneId]: Math.max(0, Math.min($project.tracks.length, slot)),
        };
        const order = [...($project.automationOrder || lanes.map(item => item.id))].filter(
            id => id !== laneId,
        );
        if (beforeLaneId) {
            order.splice(Math.max(0, order.indexOf(beforeLaneId)), 0, laneId);
        } else {
            order.push(laneId);
        }
        $project.automationOrder = order;
        draggingAutomationLane = null;
        dragInsertionRow = null;
        touch();
    }

    function dropAutomationLane(event: DragEvent, lane: Lane) {
        if (!draggingAutomationLane || draggingAutomationLane === lane.id) {
            return;
        }
        const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const order = $project?.automationOrder || autoLanes.map(item => item.id);
        const targetIndex = order.indexOf(lane.id);
        const targetSlot =
            $project?.automationPositions?.[lane.id] ?? ($project?.tracks.length || 0);
        moveAutomationLane(
            draggingAutomationLane,
            targetSlot,
            event.clientY <= bounds.top + bounds.height / 2 ? lane.id : order[targetIndex + 1],
        );
    }

    function rowBoundaryTop(boundary: number): number {
        return arrangerRows
            .slice(0, boundary)
            .reduce((height, row) => height + (row.kind === 'track' ? cellHeight : LANE_H), 0);
    }

    function requestRemoveTrack(trackIndex: number) {
        if (!$project || $project.tracks.length <= 1) {
            return;
        }
        trackToRemove = trackIndex;
        showRemoveTrack = $project.arrangement.some(clip => clip.track === trackIndex);
        if (!showRemoveTrack) {
            removeTrack();
        }
    }

    function removeTrack() {
        if (!$project || trackToRemove === null) {
            return;
        }
        const updated = removeArrangementTrack(
            $project.tracks,
            $project.arrangement,
            trackToRemove,
        );
        $project.tracks = updated.tracks;
        $project.arrangement = updated.arrangement;
        if ($project.automationPositions) {
            Object.keys($project.automationPositions).forEach(id => {
                const position = $project!.automationPositions![id];
                if (trackToRemove !== null && position > trackToRemove) {
                    $project!.automationPositions![id] = position - 1;
                } else if (trackToRemove !== null && position === trackToRemove) {
                    $project!.automationPositions![id] = Math.max(0, position - 1);
                }
            });
        }
        trackToRemove = null;
        showRemoveTrack = false;
        touch();
    }

    /* ---- automation lanes ----
     * Extra rows under the tracks, one per automated parameter: the curve is
     * read by the scheduler at every 16th step (see lib/automation.ts). */
    const LANE_H = 54;

    function laneValueLabel(lane: Lane, step: number): string {
        const d = autoParamDef(lane);
        if (!d) {
            return '';
        }
        const v = laneValueAt(lane, Math.max(0, step));
        return (
            (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100) +
            (d.unit ? ' ' + d.unit : '')
        );
    }

    function rowIndexForTrack(trackIndex: number): number {
        return arrangerRows.findIndex(row => row.kind === 'track' && row.trackIndex === trackIndex);
    }

    function rowTopForTrack(trackIndex: number): number {
        const rowIndex = rowIndexForTrack(trackIndex);
        return rowIndex < 0 ? 0 : rowBoundaryTop(rowIndex);
    }

    function rowBottomForTrack(trackIndex: number): number {
        return rowTopForTrack(trackIndex) + cellHeight;
    }

    function trackIndexAtY(y: number): number {
        let top = 0;
        let previousTrack = 0;
        for (const row of arrangerRows) {
            const height = row.kind === 'track' ? cellHeight : LANE_H;
            if (y >= top && y < top + height) {
                return row.kind === 'track' ? row.trackIndex : previousTrack;
            }
            if (row.kind === 'track') {
                previousTrack = row.trackIndex;
            }
            top += height;
        }
        return previousTrack;
    }

    let showAddAuto = $state(false);
    let showRemoveAutoLane = $state(false);
    let autoLaneToRemove: Lane | null = null;

    function openAddAuto() {
        if (!$project) {
            return;
        }
        showAddAuto = true;
    }

    function addAutoLane(target: string, param: string) {
        if (!$project) {
            return;
        }
        if (autoLanes.some(lane => lane.target === target && lane.param === param)) {
            return;
        }
        const def = autoParams(target).find(candidate => candidate.param === param);
        if (!def) {
            return;
        }
        const cur = automationCurrentValue($project, target, param, master);
        const lane = newLane(target, param, cur ?? def.min);
        $project.automation = [...autoLanes, lane];
        $project.automationOrder = [
            ...($project.automationOrder || autoLanes.map(l => l.id)),
            lane.id,
        ];
        $project.automationPositions = {
            ...($project.automationPositions || {}),
            [lane.id]: $project.tracks.length,
        };
        showAddAuto = false;
        touch();
    }

    function requestRemoveAutoLane(lane: Lane) {
        autoLaneToRemove = lane;
        showRemoveAutoLane = true;
    }

    function removeAutoLane() {
        if (!$project || !autoLaneToRemove) {
            return;
        }
        const lane = autoLaneToRemove;
        $project.automation = autoLanes.filter(l => l !== lane);
        $project.automationOrder = ($project.automationOrder || []).filter(id => id !== lane.id);
        if ($project.automationPositions) {
            delete $project.automationPositions[lane.id];
        }
        if (selectedAutomationPoint?.laneId === lane.id) {
            selectAutomationPoint(null, null);
        }
        autoLaneToRemove = null;
        showRemoveAutoLane = false;
        touch();
    }

    const cellWidth = $derived(arrangerZoom.width);
    const cellHeight = $derived(arrangerZoom.height);
    $effect.pre(() => {
        if ($playing && $playMode === 'song' && $curStep >= 0) {
            scrollPlayheadIntoView(playlistEl, $curStep, cellWidth);
        }
    });
    const viewportOptions = $derived({
        getContainer: () => playlistEl!,
        getZoom: () => ({ width: cellWidth, height: cellHeight }),
        setZoom,
        sidebarWidth: 0,
    });
    const currentPattern = $derived($project?.patterns.find(pattern => pattern.id === $selPatId));
    const currentPatternClips = $derived(
        $project?.arrangement.filter(clip => clip.patternId === $selPatId) ?? [],
    );
    const currentPatternLocations = $derived(
        currentPatternClips.map(clip => `bar ${barAt($project!, clip.start).bar}`).join(', '),
    );
    const selectionRect = $derived(
        isSelecting
            ? {
                  left: Math.min(selectionStart.s, selectionEnd.s) * cellWidth,
                  top: Math.min(rowTopForTrack(selectionStart.t), rowTopForTrack(selectionEnd.t)),
                  width: Math.abs(selectionStart.s - selectionEnd.s) * cellWidth,
                  height:
                      Math.max(
                          rowBottomForTrack(selectionStart.t),
                          rowBottomForTrack(selectionEnd.t),
                      ) -
                      Math.min(rowTopForTrack(selectionStart.t), rowTopForTrack(selectionEnd.t)),
              }
            : null,
    );
    const loopRect = $derived(loopPreview || $project?.loop || null);
    const selectedClips = $derived(
        ($project?.arrangement.filter(c => c.selected) || []) as ExtendedClip[],
    );
    // lane mute/solo — same rule as the scheduler: any soloed lane silences the rest
    const laneSilent = $derived(
        ($project?.tracks || []).map(
            (t, _i, all) => !!t.mute || (all.some(o => o.solo) && !t.solo),
        ),
    );
    const totalLength = $derived(
        Math.max(
            128,
            ...($project?.arrangement.map(c => c.start + c.len) ?? []),
            ...($project?.conductor?.tempos.map(marker => marker.step) ?? []),
            ...($project?.conductor?.meters.map(marker => marker.step) ?? []),
            ...($project?.conductor?.sections.map(marker => marker.step) ?? []),
        ) + 64,
    );
    const visibleBars = $derived(
        $project
            ? barsInRange(
                  $project,
                  scrollLeft / cellWidth,
                  Math.min(totalLength, (scrollLeft + viewportWidth) / cellWidth),
              )
            : [],
    );
    const autoLanes = $derived(($project?.automation || []) as Lane[]);
    const arrangerRows = $derived(
        (() => {
            const positions = $project?.automationPositions || {};
            const order = $project?.automationOrder || autoLanes.map(lane => lane.id);
            const ordered = [...autoLanes].sort(
                (a, b) => order.indexOf(a.id) - order.indexOf(b.id),
            );
            const rows: (
                { kind: 'track'; trackIndex: number } | { kind: 'automation'; lane: Lane }
            )[] = [];
            for (let slot = 0; slot <= ($project?.tracks.length || 0); slot++) {
                ordered
                    .filter(lane => (positions[lane.id] ?? ($project?.tracks.length || 0)) === slot)
                    .forEach(lane => rows.push({ kind: 'automation', lane }));
                if (slot < ($project?.tracks.length || 0)) {
                    rows.push({ kind: 'track', trackIndex: slot });
                }
            }
            return rows;
        })(),
    );
    // the value a lane is feeding the engine right now (playhead, else cursor)
    const autoStep = $derived($playing && $curStep >= 0 ? $curStep : $songCursor);
    const gridHeight = $derived(
        arrangerRows.reduce(
            (height, row) => height + (row.kind === 'track' ? cellHeight : LANE_H),
            0,
        ),
    );
</script>

<svelte:window onmousemove={handleMouseMoveGlobal} onmouseup={handleMouseUp} />

<div
    class="playlist-container"
    class:resizing={resizeMode && !!dragClip}
    onwheelcapture={preventBrowserZoom}
>
    <div class="playlist-header">
        <div class="playlist-controls">
            {#if currentPattern}
                <div
                    class="pattern-usage"
                    title={`Open pattern: ${currentPattern.name}. Used ${currentPatternClips.length} time${currentPatternClips.length === 1 ? '' : 's'}${currentPatternLocations ? ` — ${currentPatternLocations}` : ''}.`}
                >
                    {currentPattern.name} · {currentPatternClips.length}
                    use{currentPatternClips.length === 1 ? '' : 's'}{currentPatternLocations
                        ? ` · ${currentPatternLocations}`
                        : ''}
                </div>
            {/if}
            {#if selectedClips.length}
                <div class="clip-tools">
                    <span class="sel-count"
                        >{selectedClips.length} clip{selectedClips.length > 1 ? 's' : ''}</span
                    >
                    <div class="clip-tool-group">
                        <span class="lbl">Transpose</span>
                        <Button
                            compact
                            onclick={() => transposeClips(-12)}
                            title="An octave down"
                            variant="secondary"
                        >
                            −12
                        </Button>
                        <Button
                            compact
                            onclick={() => transposeClips(-1)}
                            title="A semitone down"
                            variant="secondary"
                        >
                            −1
                        </Button>
                        <input
                            class="clip-value-input"
                            aria-label="Transpose selected clips in semitones"
                            max={TRANSPOSE_MAX}
                            min={-TRANSPOSE_MAX}
                            onchange={e => setClipTranspose(parseFloat(e.currentTarget.value))}
                            step="1"
                            title="Transpose selected clips in semitones"
                            type="number"
                            value={selectedClips[0].transpose ?? 0}
                        />
                        <Button
                            compact
                            onclick={() => transposeClips(1)}
                            title="A semitone up"
                            variant="secondary"
                        >
                            +1
                        </Button>
                        <Button
                            compact
                            onclick={() => transposeClips(12)}
                            title="An octave up"
                            variant="secondary"
                        >
                            +12
                        </Button>
                        <Button
                            compact
                            onclick={resetClipTranspose}
                            title="Back to the written pitch"
                            variant="secondary"
                        >
                            0
                        </Button>
                    </div>
                    <div class="clip-tool-group">
                        <Button
                            compact
                            onclick={() => (showPartialControls = !showPartialControls)}
                            pressed={showPartialControls || hasPartialMultiplier(selectedClips[0])}
                            title="Show exact harmonic multiplier controls"
                            variant="secondary"
                        >
                            <i class="fa fa-signal"></i>
                        </Button>
                        {#if showPartialControls || hasPartialMultiplier(selectedClips[0])}
                            <span class="lbl">Partial</span>
                            <Button
                                compact
                                onclick={() => adjustClipPartial(-1)}
                                title="Previous harmonic partial"
                                variant="secondary"
                            >
                                −1
                            </Button>
                            <input
                                class="clip-value-input"
                                aria-label="Harmonic multiplier for selected clips"
                                max={PARTIAL_MAX}
                                min="1"
                                onchange={e => setClipPartial(parseFloat(e.currentTarget.value))}
                                step="1"
                                title="Exact harmonic multiplier for selected clips"
                                type="number"
                                value={selectedClips[0].partial ?? 1}
                            />
                            <Button
                                compact
                                onclick={() => adjustClipPartial(1)}
                                title="Next harmonic partial"
                                variant="secondary"
                            >
                                +1
                            </Button>
                            <Button
                                compact
                                onclick={resetClipPartial}
                                title="Remove harmonic multiplier"
                                variant="secondary"
                            >
                                1×
                            </Button>
                        {/if}
                    </div>
                    <div class="clip-tool-group">
                        <span class="lbl">Level</span>
                        <Button
                            compact
                            onclick={() => adjustClipGain(-CLIP_GAIN_STEP)}
                            title="Lower the selected clips by 10%"
                            variant="secondary"
                        >
                            −10%
                        </Button>
                        <input
                            class="clip-value-input"
                            aria-label="Level for selected clips as a percent"
                            max="100"
                            min="0"
                            onchange={e => setClipGainPercent(parseFloat(e.currentTarget.value))}
                            step="1"
                            title="Level for selected clips as a percent"
                            type="number"
                            value={Math.round((selectedClips[0].gain ?? 1) * 100)}
                        />
                        <Button
                            compact
                            onclick={() => adjustClipGain(CLIP_GAIN_STEP)}
                            title="Raise the selected clips by 10%"
                            variant="secondary"
                        >
                            +10%
                        </Button>
                        <Button
                            compact
                            onclick={resetClipGain}
                            title="Restore full clip level"
                            variant="secondary"
                        >
                            100%
                        </Button>
                    </div>
                    <span class="tip">(or Alt + wheel)</span>
                </div>
            {/if}
        </div>
    </div>
    <div class="playlist-scroll">
        <div class="corner frozen-corner">
            <div class="corner-actions">
                <button aria-label="Add track" onclick={addTrack} title="Add track">
                    <i class="fa fa-plus"></i>
                </button>
                <button
                    class="auto-add"
                    aria-label="Add automation lane"
                    onclick={openAddAuto}
                    title="Add automation lane"
                >
                    <i class="fa fa-bezier-curve"></i>
                </button>
            </div>
        </div>
        <div style="max-width: {viewportWidth}px;" class="timeline-viewport">
            <div
                style="width: {totalLength * cellWidth}px; transform: translateX(-{scrollLeft}px);"
                class="timeline"
                aria-label="Arrangement timeline"
                oncontextmenu={preventDefault(() => {})}
                onmousedown={handleTimelineMouseDown}
                role="grid"
                tabindex="0"
            >
                {#each visibleBars as bar (bar.start)}
                    <div
                        style="left: {bar.start * cellWidth}px; width: {(bar.end - bar.start) *
                            cellWidth}px;"
                        class="time-marker"
                        title={`Bar ${bar.bar} · ${bar.numerator}/${bar.denominator} · step ${bar.start}`}
                    >
                        {bar.bar}
                    </div>
                {/each}
                {#if loopRect}
                    <div
                        style="left: {loopRect.start * cellWidth}px; width: {(loopRect.end -
                            loopRect.start) *
                            cellWidth}px;"
                        class="loop-band"
                    ></div>
                {/if}
            </div>
        </div>
        <div class="conductor-row">
            <Conductor {cellWidth} {scrollLeft} {totalLength} {viewportWidth} />
        </div>
        <div class="frozen-track-labels">
            <div style="transform: translateY(-{scrollTop}px);" class="track-labels">
                {#if dragInsertionRow !== null}
                    <div
                        style="top: {rowBoundaryTop(dragInsertionRow)}px;"
                        class="drop-indicator"
                    ></div>
                {/if}
                <div class="track-divider top-track-divider">
                    <button
                        class="track-insert"
                        aria-label="Insert track"
                        onclick={stopPropagation(() => insertTrack(0))}
                        ondblclick={stopPropagation()}
                        ondragover={preventDefault(() => (dragInsertionRow = 0))}
                        onmousedown={stopPropagation()}
                        title="Insert track at the top"><i class="fa fa-plus"></i></button
                    >
                </div>
                {#each arrangerRows as row, rowIndex}
                    {#if row.kind === 'track'}
                        {@const t = row.trackIndex}
                        {@const track = $project!.tracks[t]}
                        <div class="track-row">
                            {#if t > 0}
                                <div class="track-divider">
                                    <button
                                        class="track-insert"
                                        aria-label="Insert track"
                                        onclick={stopPropagation(() => insertTrack(t))}
                                        ondblclick={stopPropagation()}
                                        onmousedown={stopPropagation()}
                                        title="Insert track here"
                                        ><i class="fa fa-plus"></i>
                                    </button>
                                </div>
                            {/if}
                            <div
                                style="height: {cellHeight}px; border-left: 4px solid {track.color}"
                                class="track-label"
                                class:dragging={draggingTrack === t}
                                class:silent={laneSilent[t]}
                                draggable="true"
                                oncontextmenu={event => openTrackContextMenu(event, t)}
                                ondblclick={() => editTrack(t)}
                                ondragend={clearDragState}
                                ondragover={preventDefault(event =>
                                    updateDragInsertion(event as DragEvent, rowIndex),
                                )}
                                ondragstart={event => startTrackDrag(event as DragEvent, t)}
                                ondrop={event => dropTrack(event as DragEvent, t)}
                                onkeydown={event => activateOnKeyboard(event, () => editTrack(t))}
                                role="button"
                                tabindex="0"
                                title="Double click to rename, Right click for color; drag to reorder"
                            >
                                <div class="track-name">
                                    {track.name}
                                </div>
                                <button
                                    class="ms"
                                    class:on={track.mute}
                                    aria-label="Mute lane"
                                    onclick={stopPropagation(() => toggleTrackMute(t))}
                                    ondblclick={stopPropagation()}
                                    onmousedown={stopPropagation()}
                                    title="Mute lane"><i class="fa fa-volume-xmark"></i></button
                                >
                                <button
                                    class="ms solo"
                                    class:on={track.solo}
                                    aria-label="Solo lane"
                                    onclick={stopPropagation(() => toggleTrackSolo(t))}
                                    ondblclick={stopPropagation()}
                                    onmousedown={stopPropagation()}
                                    title="Solo lane"><i class="fa fa-headphones"></i></button
                                >
                            </div>
                        </div>
                    {/if}
                    {#if row.kind === 'automation'}
                        {@const lane = row.lane}
                        <div
                            style="height: {LANE_H}px; border-left: 4px solid {laneColor(
                                $project!,
                                lane,
                            )}"
                            class="auto-label track-label"
                            draggable="true"
                            oncontextmenu={event => openAutomationContextMenu(event, lane)}
                            ondragend={clearDragState}
                            ondragover={preventDefault(event =>
                                updateDragInsertion(event as DragEvent, rowIndex),
                            )}
                            ondragstart={event => startAutomationDrag(event as DragEvent, lane)}
                            ondrop={stopPropagation(event =>
                                dropAutomationLane(event as DragEvent, lane),
                            )}
                            role="rowheader"
                            tabindex="0"
                            title="{laneTitle(
                                $project!,
                                lane,
                            )} — click the curve to add a point, drag to move, right-click a point to remove"
                        >
                            <div class="auto-name" title={laneTitle($project!, lane)}>
                                <span class="auto-target">{laneTargetTitle($project!, lane)}</span>
                                <span class="auto-param"
                                    >{autoParamDef(lane)?.label || lane.param}</span
                                >
                            </div>
                            <div
                                class="auto-val"
                                class:live={$playing}
                                title="Value at the playhead"
                            >
                                {laneValueLabel(lane, autoStep)}
                            </div>
                        </div>
                    {/if}
                {/each}
            </div>
        </div>
        <div
            bind:this={playlistEl}
            class="grid-viewport"
            aria-label="Arrangement editor"
            oncontextmenu={preventDefault(() => {})}
            onmousedown={handlePlaylistMouseDown}
            onscroll={syncFrozenPanes}
            onwheel={handleWheel}
            role="grid"
            tabindex="0"
            bind:clientWidth={viewportWidth}
        >
            <div
                style="width: {totalLength *
                    cellWidth}px; height: {gridHeight}px; --cell-width: {cellWidth}px;"
                class="grid-container"
            >
                {#if dragInsertionRow !== null}
                    <div
                        style="top: {rowBoundaryTop(dragInsertionRow)}px;"
                        class="drop-indicator"
                    ></div>
                {/if}
                <div class="grid-bg">
                    {#each arrangerRows as row}
                        {#if row.kind === 'track'}
                            {@const t = row.trackIndex}
                            <div
                                style="height: {cellHeight}px;"
                                class="grid-row"
                                class:silent={laneSilent[t]}
                                data-track={t}
                            ></div>
                        {:else}
                            {@const lane = row.lane}
                            {@const def = autoParamDef(lane)}
                            {#if def}
                                <AutomationLane
                                    canEdit={shouldEditAutomation(selectedClips.length > 0)}
                                    {cellWidth}
                                    color={laneColor($project!, lane)}
                                    {def}
                                    editorKey={`automation:${lane.id}`}
                                    hasSelectedPoint={!!selectedAutomationPoint}
                                    height={LANE_H}
                                    {lane}
                                    onblocked={clearSelection}
                                    onselect={point => selectAutomationPoint(lane, point)}
                                    selectedPoint={selectedAutomationPoint?.laneId === lane.id
                                        ? selectedAutomationPoint.point
                                        : null}
                                    width={totalLength * cellWidth}
                                    bind:contextualEditor
                                />
                            {/if}
                        {/if}
                    {/each}
                </div>

                {#each visibleBars as bar (bar.start)}
                    <div style="left: {bar.start * cellWidth}px;" class="bar-line"></div>
                {/each}

                <div class="clips-layer">
                    {#if selectionRect}
                        <div
                            style="left: {selectionRect.left}px; top: {selectionRect.top}px; width: {selectionRect.width}px; height: {selectionRect.height}px;"
                            class="selection-rect"
                        ></div>
                    {/if}
                    {#each $project!.arrangement as clip (clip.id)}
                        <div
                            style="left: {clip.start * cellWidth}px; width: {clip.len *
                                cellWidth}px; top: {rowTopForTrack(clip.track) +
                                2}px; height: {cellHeight - 4}px; background: {getPatternColor(
                                clip.patternId,
                            )}"
                            class="clip"
                            class:has-pitch-modifier={clip.transpose || hasPartialMultiplier(clip)}
                            class:open-pattern={clip.patternId === $selPatId}
                            class:selected={clip.selected}
                            class:silent={laneSilent[clip.track]}
                            aria-label={`Open ${getPatternName(clip.patternId)} pattern`}
                            ondblclick={() => ($selPatId = clip.patternId)}
                            onkeydown={event =>
                                activateOnKeyboard(event, () => ($selPatId = clip.patternId))}
                            onmousedown={stopPropagation(e => {
                                const mouseEvent = e as MouseEvent;
                                if (handleViewportMouseDown(mouseEvent, viewport)) {
                                    return;
                                }
                                const rect = (
                                    mouseEvent.currentTarget as HTMLElement
                                ).parentElement!.getBoundingClientRect();
                                const s_raw = (mouseEvent.clientX - rect.left) / cellWidth;
                                handleMouseDown(mouseEvent, clip.track, s_raw);
                            })}
                            role="button"
                            tabindex="0"
                        >
                            <div class="clip-name clip-badge">{getPatternName(clip.patternId)}</div>
                            {#if clip.transpose || hasPartialMultiplier(clip)}
                                <div
                                    class="clip-pitch clip-badge"
                                    title={`Clip pitch: ${clip.transpose ? `${semiLabel(clip.transpose)} transpose` : 'written pitch'}${hasPartialMultiplier(clip) ? `${clip.transpose ? ' · ' : ''}${partialLabel(clip.partial)} harmonic partial` : ''}`}
                                >
                                    {clip.transpose ? semiLabel(clip.transpose) : ''}{clip.transpose &&
                                    hasPartialMultiplier(clip)
                                        ? ' · '
                                        : ''}{hasPartialMultiplier(clip) ? partialLabel(clip.partial) : ''}
                                </div>
                            {/if}
                            {#if clip.gain !== undefined && clip.gain !== 1}
                                <div class="clip-gain clip-badge" title={`Clip level: ${gainLabel(clip.gain)}`}>
                                    {gainLabel(clip.gain)}
                                </div>
                            {/if}
                            <div class="clip-preview">
                                {#each getPatternNotes(clip.patternId, clip.len) as n}
                                    <div
                                        style="left: {(n.start / (clip.len || 1)) * 100}%;
                                                width: {(n.len / (clip.len || 1)) * 100}%;
                                                top: {n.y * 60 + 25}%;
                                                height: 2px;"
                                        class="preview-note"
                                    ></div>
                                {/each}
                            </div>
                            <div
                                style="width: {Math.min(
                                    clip.len * cellWidth,
                                    Math.max(8, cellWidth * 0.2),
                                )}px"
                                class="resize-handle"
                            ></div>
                        </div>
                    {/each}
                </div>

                {#if loopRect}
                    <div
                        style="left: {loopRect.start * cellWidth}px; width: {(loopRect.end -
                            loopRect.start) *
                            cellWidth}px;"
                        class="loop-overlay"
                    ></div>
                {/if}

                <div style="left: {$songCursor * cellWidth}px" class="song-cursor"></div>
                {#if $playing && $playMode === 'song'}
                    <div style="left: {$curStep * cellWidth}px" class="playhead"></div>
                {/if}
            </div>
        </div>
    </div>
    <div class="playlist-footer">
        <div class="tip">
            Click an empty lane to clear the selection, then click again to place the selected
            pattern • Add tracks or automation above the track names • MMB drag to pan • Right-click
            to remove • Timeline: click = cursor, drag = loop, right-click = clear loop
        </div>
    </div>
</div>

<Dialog title="Add Automation Lane" width="720px" bind:show={showAddAuto}>
    {#if $project}
        <AutomationPicker onadd={addAutoLane} project={$project} />
    {/if}
</Dialog>
<ContextMenu
    actions={contextMenuActions()}
    onclose={closeContextMenu}
    onselect={selectContextMenuAction}
    open={contextMenuTarget !== null}
    point={contextMenuPoint}
/>
<Prompt
    label="New Name"
    onsubmit={onRenameTrack}
    title="Rename Track"
    bind:show={showRenameTrack}
    bind:value={renameTrackValue}
/>
<Dialog title="Track Color" bind:show={showTrackColor}>
    {#if editingTrackIdx !== null}
        <ColorPicker
            onchange={onTrackColorChange}
            value={$project!.tracks[editingTrackIdx].color}
        />
    {/if}
</Dialog>
<Confirm
    confirmLabel="Remove track"
    destructive
    message="This track has clips. Removing it will permanently remove those clips."
    onconfirm={removeTrack}
    title="Remove Track"
    bind:show={showRemoveTrack}
/>
<Confirm
    confirmLabel="Remove lane"
    destructive
    message="Removing this lane will permanently remove all of its automation points."
    onconfirm={removeAutoLane}
    title="Remove Automation Lane"
    bind:show={showRemoveAutoLane}
/>

<style>
    .playlist-container {
        background: var(--color-canvas-deep);
        border: 1px solid var(--border);
        border-radius: 2px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        height: 100%;
        min-width: 0;
        min-height: 0;
        user-select: none;
    }

    .playlist-container.resizing,
    .playlist-container.resizing * {
        cursor: ew-resize !important;
    }

    .playlist-header {
        background: var(--color-surface);
        box-sizing: border-box;
        height: 40px;
        padding: 6px 12px;
        border-bottom: 1px solid var(--border);
        display: flex;
        align-items: center;
        min-width: 0;
    }

    .playlist-controls {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        min-width: 0;
    }

    .pattern-usage {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--secondary-text);
        font-size: 11px;
    }

    .clip-tools {
        margin-left: auto;
    }

    .playlist-scroll {
        flex: 1;
        min-height: 0;
        overflow: hidden;
        display: grid;
        grid-template-columns: 200px minmax(0, 1fr);
        grid-template-rows: 24px 28px minmax(0, 1fr);
        position: relative;
    }

    .conductor-row {
        grid-column: 1 / -1;
        grid-row: 2;
        min-width: 0;
        min-height: 0;
    }

    .timeline-viewport {
        grid-column: 2;
        grid-row: 1;
        overflow: hidden;
        min-width: 0;
        background: var(--color-surface-input);
        border-bottom: 1px solid var(--border);
    }

    .corner {
        grid-column: 1;
        grid-row: 1;
        border-right: 1px solid var(--border);
        border-bottom: 1px solid var(--border);
        background: var(--color-surface);
    }

    .corner-actions {
        height: 100%;
        display: flex;
    }

    .corner-actions button {
        flex: 1;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 0;
        white-space: nowrap;
    }

    .corner-actions button i {
        font-size: 12px;
    }

    .timeline {
        position: relative;
        min-width: 100%;
        height: 100%;
        background: var(--color-surface-input);
        will-change: transform;
    }

    .time-marker {
        position: absolute;
        top: 0;
        font-size: 9px;
        color: var(--color-text-subtle);
        padding: 4px;
        border-left: 1px solid var(--border);
        height: 100%;
        box-sizing: border-box;
        overflow: hidden;
        white-space: nowrap;
    }

    .clip.open-pattern {
        box-shadow:
            inset 0 0 0 1px var(--accent2),
            0 0 0 1px color-mix(in srgb, var(--accent2) 45%, transparent);
    }

    .frozen-track-labels {
        grid-column: 1;
        grid-row: 3;
        z-index: 10;
        overflow: hidden;
        min-height: 0;
        border-right: 1px solid var(--border);
        background: var(--color-canvas-deep);
    }

    .track-labels {
        position: relative;
        width: 100%;
        background: var(--color-canvas-deep);
        will-change: transform;
    }

    .track-row {
        position: relative;
    }

    .drop-indicator {
        position: absolute;
        z-index: 20;
        right: 0;
        left: 0;
        height: 2px;
        pointer-events: none;
        background: var(--action);
        box-shadow: 0 0 5px var(--action);
        transform: translateY(-1px);
    }

    .grid-viewport {
        grid-column: 2;
        grid-row: 3;
        min-width: 0;
        min-height: 0;
        overflow: auto;
        overscroll-behavior: contain;
    }

    .track-label {
        position: relative;
        font-size: 11px;
        color: var(--color-text-muted);
        display: flex;
        align-items: center;
        padding: 0 8px;
        border-bottom: 1px solid var(--border-subtle);
        box-sizing: border-box;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: pointer;
    }

    .track-label.dragging {
        opacity: 0.45;
    }

    .track-insert {
        position: absolute;
        z-index: 4;
        top: 50%;
        left: 6px;
        width: 18px;
        height: 18px;
        transform: translateY(-50%);
        display: grid;
        place-items: center;
        padding: 0;
        border: none;
        border-radius: 3px;
        background: var(--action);
        color: var(--action-text);
        font-size: 14px;
        font-weight: 700;
        line-height: 1;
        opacity: 0;
        pointer-events: none;
        cursor: pointer;
        transition:
            opacity 0.12s ease,
            background 0.12s ease;
    }

    .track-divider {
        position: absolute;
        z-index: 3;
        top: -9px;
        right: 0;
        left: 0;
        height: 18px;
        pointer-events: none;
    }

    .top-track-divider {
        top: -9px;
    }

    .track-divider::before {
        content: '';
        position: absolute;
        top: 50%;
        right: 0;
        left: 0;
        border-top: 1px solid transparent;
        transform: translateY(-50%);
        transition: border-color 0.12s ease;
        pointer-events: none;
    }

    .track-divider:hover::before,
    .track-divider:has(:global(.track-insert:focus-visible))::before {
        border-color: var(--action);
    }

    .track-divider:hover .track-insert,
    .track-insert:focus-visible {
        opacity: 1;
        pointer-events: auto;
    }

    .track-insert:hover {
        background: var(--accent2);
        color: var(--action-text);
    }

    .track-label:hover {
        background: rgba(255, 255, 255, 0.05);
        color: var(--primary-text);
    }

    .track-label .track-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .track-label.silent .track-name {
        opacity: 0.45;
        text-decoration: line-through;
    }

    .track-label .ms {
        width: 24px;
        height: 24px;
        flex-shrink: 0;
        background: transparent;
        border: none;
        color: var(--secondary-text);
        font-size: 11px;
        opacity: 0.7;
        cursor: pointer;
        padding: 0;
        border-radius: 3px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition:
            color 0.12s ease,
            background 0.12s ease,
            opacity 0.12s ease;
    }

    .track-label .ms:hover {
        opacity: 1;
        color: var(--accent);
        background: var(--color-surface-hover);
    }

    .track-label .ms.on {
        opacity: 1;
        background: var(--accent2);
        color: var(--action-text);
    }

    .track-label .ms.solo.on {
        background: #ffd166;
        color: #282238;
    }

    .track-label .ms:disabled {
        opacity: 0.2;
        cursor: default;
    }

    .grid-row.silent {
        background: rgba(0, 0, 0, 0.35);
    }

    .clip.silent {
        opacity: 0.3;
    }

    .grid-container {
        position: relative;
        flex-shrink: 0;
    }

    .grid-bg {
        display: flex;
        flex-direction: column;
        background-image: linear-gradient(90deg, var(--color-grid) 1px, transparent 1px);
        background-size: var(--cell-width) 100%;
        padding-bottom: 1rem;
    }

    .bar-line {
        position: absolute;
        top: 0;
        bottom: 0;
        border-left: 1px solid var(--border);
        pointer-events: none;
    }

    .grid-row {
        display: flex;
        border-bottom: 1px solid var(--border-subtle);
        box-sizing: border-box;
    }

    .clips-layer {
        position: absolute;
        top: 0;
        left: 0;
        pointer-events: none;
    }

    .clip {
        position: absolute;
        background: var(--accent);
        border-radius: 1px;
        pointer-events: auto;
        cursor: move;
        box-sizing: border-box;
        font-size: 10px;
        color: var(--primary-text);
        overflow: hidden;
        opacity: 0.85;
        box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2);
    }

    .clip.selected {
        opacity: 1;
        filter: brightness(1.2);
        outline: 1px solid var(--color-playhead);
        z-index: 10;
    }

    .clip-name {
        position: absolute;
        top: 2px;
        left: 4px;
        z-index: 2;
        pointer-events: none;
        max-width: calc(100% - 8px);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .clip.has-pitch-modifier .clip-name {
        max-width: calc(100% - 72px);
    }

    .clip-badge {
        padding: 0 3px;
        border-radius: 3px;
        background: rgba(0, 0, 0, 0.45);
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
    }

    .clip-preview {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        pointer-events: none;
    }

    .preview-note {
        position: absolute;
        background: rgba(255, 255, 255, 0.4);
        border-radius: 1px;
    }

    .resize-handle {
        position: absolute;
        right: 0;
        top: 0;
        bottom: 0;
        cursor: ew-resize;
        z-index: 10;
        background: transparent;
    }

    .resize-handle:hover {
        background: rgba(255, 255, 255, 0.2);
    }

    .clip:hover {
        opacity: 1;
        filter: brightness(1.1);
    }

    .playhead {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 2px;
        background: var(--color-playhead);
        box-shadow: 0 0 8px rgba(255, 244, 244, 0.7);
        z-index: 20;
        pointer-events: none;
    }

    .tip {
        font-size: 11px;
        opacity: 0.6;
    }

    .playlist-footer {
        background: var(--color-surface);
        border-top: 1px solid var(--border);
        padding: 5px 12px;
    }

    .clip-tools {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        overflow-x: auto;
        white-space: nowrap;
    }

    .clip-tool-group {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .clip-tool-group + .clip-tool-group {
        border-left: 1px solid var(--border);
        padding-left: 10px;
    }

    .clip-tools .sel-count {
        color: var(--accent2);
    }

    .clip-tools .lbl {
        opacity: 0.6;
    }

    .clip-value-input {
        width: 46px;
        box-sizing: border-box;
        border: 1px solid var(--border);
        border-radius: 2px;
        background: var(--color-surface-input);
        color: var(--primary-text);
        font: inherit;
        font-weight: bold;
        padding: 4px 3px;
        text-align: center;
    }

    .clip-value-input:focus {
        border-color: var(--accent2);
        outline: none;
    }

    .clip-pitch {
        position: absolute;
        top: 2px;
        right: 4px;
        z-index: 3;
        font-size: 9px;
        font-weight: bold;
        pointer-events: none;
    }

    .clip-gain {
        position: absolute;
        bottom: 2px;
        right: 4px;
        z-index: 3;
        font-size: 9px;
        font-weight: bold;
        pointer-events: none;
    }

    .selection-rect {
        position: absolute;
        border: 1px solid var(--accent);
        background: var(--color-accent-selection);
        pointer-events: none;
        z-index: 100;
    }

    .loop-band {
        position: absolute;
        top: 0;
        bottom: 0;
        background: var(--color-accent-selection);
        border-left: 2px solid var(--accent2);
        border-right: 2px solid var(--accent2);
        box-sizing: border-box;
        pointer-events: none;
    }

    .loop-overlay {
        position: absolute;
        top: 0;
        bottom: 0;
        background: rgba(231, 109, 117, 0.07);
        border-left: 1px solid rgba(231, 109, 117, 0.5);
        border-right: 1px solid rgba(231, 109, 117, 0.5);
        box-sizing: border-box;
        pointer-events: none;
        z-index: 5;
    }

    .song-cursor {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 2px;
        background: var(--accent2);
        opacity: 0.7;
        z-index: 15;
        pointer-events: none;
    }

    /* automation lanes */
    .auto-add {
        background: var(--border);
        border: none;
        color: var(--primary-text);
        font-family: inherit;
        font-size: 11px;
        padding: 3px 8px;
        border-radius: 4px;
        cursor: pointer;
        white-space: nowrap;
    }

    .auto-add:hover {
        background: var(--color-surface-hover);
    }

    .auto-label {
        font-size: 10px;
        color: var(--color-text-muted);
        display: flex;
        align-items: center;
        padding: 0 6px;
        border-bottom: 1px solid var(--border-subtle);
        box-sizing: border-box;
        background: var(--surface-deep);
    }

    .auto-label .auto-name {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        line-height: 1.2;
    }

    .auto-label .auto-target,
    .auto-label .auto-param {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .auto-label .auto-param {
        color: var(--secondary-text);
    }

    .auto-label .auto-val {
        font-variant-numeric: tabular-nums;
        color: var(--color-text-subtle);
        padding: 0 4px;
        white-space: nowrap;
    }

    .auto-label .auto-val.live {
        color: var(--accent);
    }
</style>
