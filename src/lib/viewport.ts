export interface ViewportState {
  isPanning: boolean;
  isZooming: boolean;
  lastMousePos: { x: number; y: number };
}

export function createViewportState(): ViewportState {
  return {
    isPanning: false,
    isZooming: false,
    lastMousePos: { x: 0, y: 0 },
  };
}

export interface ViewportOptions {
  getContainer: () => HTMLElement;
  getZoom: () => { width: number; height: number };
  setZoom: (w: number, h: number) => void;
  sidebarWidth: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
}

export function handleViewportWheel(e: WheelEvent, options: ViewportOptions) {
  if (e.ctrlKey) {
    e.preventDefault();
    const {
      getContainer,
      getZoom,
      setZoom,
      sidebarWidth,
      minWidth = 4,
      maxWidth = 200,
    } = options;
    const container = getContainer();
    const zoom = getZoom();

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const oldWidth = zoom.width;
    const newWidth = Math.max(minWidth, Math.min(maxWidth, oldWidth * delta));

    setZoom(newWidth, zoom.height);

    // Adjust scroll to keep mouse position stable
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - sidebarWidth;
    if (mouseX > 0) {
      const ratio = newWidth / oldWidth;
      container.scrollLeft = (container.scrollLeft + mouseX) * ratio - mouseX;
    }
    return true;
  }
  return false;
}

export function handleViewportMouseDown(e: MouseEvent, state: ViewportState) {
  if (e.button === 1) {
    e.preventDefault();
    state.lastMousePos = { x: e.clientX, y: e.clientY };
    if (e.ctrlKey) {
      state.isZooming = true;
    } else {
      state.isPanning = true;
    }
    return true;
  }
  return false;
}

export function handleViewportMouseMove(
  e: MouseEvent,
  state: ViewportState,
  options: ViewportOptions,
) {
  if (state.isPanning) {
    const container = options.getContainer();
    container.scrollLeft -= e.clientX - state.lastMousePos.x;
    container.scrollTop -= e.clientY - state.lastMousePos.y;
    state.lastMousePos = { x: e.clientX, y: e.clientY };
    return true;
  }

  if (state.isZooming) {
    const {
      getZoom,
      setZoom,
      minWidth = 4,
      maxWidth = 200,
      minHeight = 4,
      maxHeight = 100,
    } = options;
    const zoom = getZoom();
    const dx = e.clientX - state.lastMousePos.x;
    const dy = e.clientY - state.lastMousePos.y;
    const factor = 1.05;

    let nw = zoom.width;
    let nh = zoom.height;

    if (dx > 0) {
      nw *= factor;
    } else if (dx < 0) {
      nw /= factor;
    }
    if (dy > 0) {
      nh *= factor;
    } else if (dy < 0) {
      nh /= factor;
    }

    nw = Math.max(minWidth, Math.min(maxWidth, nw));
    nh = Math.max(minHeight, Math.min(maxHeight, nh));

    setZoom(nw, nh);
    state.lastMousePos = { x: e.clientX, y: e.clientY };
    return true;
  }

  return false;
}

export function handleViewportMouseUp(state: ViewportState) {
  state.isPanning = false;
  state.isZooming = false;
}
