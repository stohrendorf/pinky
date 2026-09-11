// Undo / redo — snapshot history around the project store.
import type { Writable } from "svelte/store";

//
// Every mutation in the app ends with `touch()` (i.e. `project.update(p => p)`),
// which re-publishes the *same* object. So the history simply listens to the
// store: same identity = an edit happened (debounced, so a whole drag becomes
// one undo step), new identity = a new document (New/Demo/Import) → reset.
import { get, writable } from "svelte/store";

import type { Project } from "./types";

import { project, selInstId, selPatId } from "./project";

const LIMIT = 60; // snapshots kept per direction
const DEBOUNCE = 350; // ms of quiet before an edit is committed

// `selected` flags and the zoom levels are view state, not document state —
// they neither create nor survive an undo step.
const VIEW_KEYS = new Set(["selected", "zoom"]);
const snap = (p: Project): string =>
  JSON.stringify(p, (k, v) => (VIEW_KEYS.has(k) ? undefined : v));

export const canUndo: Writable<boolean> = writable(false);
export const canRedo: Writable<boolean> = writable(false);

let past: string[] = [];
let future: string[] = [];
let base = ""; // snapshot of the last committed state
let known: Project | null = null; // the document identity we are tracking
let timer: ReturnType<typeof setTimeout> | null = null;
let applying = false;

function flags(): void {
  canUndo.set(past.length > 0);
  canRedo.set(future.length > 0);
}

function reset(p: Project): void {
  past = [];
  future = [];
  base = snap(p);
  flags();
}

// Fold everything that happened since the last commit into one history entry.
function commit(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const p = get(project);
  if (!p) {
    return;
  }
  const s = snap(p);
  if (s === base) {
    return;
  }
  past.push(base);
  if (past.length > LIMIT) {
    past.shift();
  }
  future = [];
  base = s;
  flags();
}

function apply(s: string): void {
  const cur = get(project);
  if (!cur) {
    return;
  }
  const next = JSON.parse(s) as Project;
  next.zoom = cur.zoom; // keep the current view
  base = s;
  applying = true;
  project.set(next);
  applying = false;
  // the restored document may not contain what is currently selected
  if (!next.instruments.some((i) => i.id === get(selInstId))) {
    selInstId.set(next.instruments[0]?.id || null);
  }
  if (!next.patterns.some((pt) => pt.id === get(selPatId))) {
    selPatId.set(next.patterns[0]?.id || null);
  }
  flags();
}

export function undo(): void {
  commit();
  if (!past.length) {
    return;
  }
  future.push(base);
  apply(past.pop() as string);
}

export function redo(): void {
  commit();
  if (!future.length) {
    return;
  }
  past.push(base);
  apply(future.pop() as string);
}

export function initHistory(): void {
  project.subscribe((p) => {
    if (!p) {
      return;
    }
    if (p !== known) {
      // a whole new document (or our own undo/redo)
      known = p;
      if (!applying) {
        reset(p);
      }
      return;
    }
    if (applying) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(commit, DEBOUNCE);
  });
}
