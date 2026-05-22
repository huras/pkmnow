/**
 * @fileoverview Pointer / keyboard input for the editor canvas.
 *
 * Responsibilities:
 *  - Translate canvas pixel events to painter macro coords.
 *  - Track current paint mode (brush | rect), brush size, hover cell.
 *  - Drive paint mutations on `EditorStore` (Bresenham brush, rect marquee).
 *  - Pan camera (middle-button or right-button drag).
 *  - Zoom camera (wheel) with fixed steps.
 *  - Emit lightweight observable state via callbacks for the main loop / HUD.
 *
 * This module is intentionally framework-free: it holds its own mutable state
 * objects (`mode`, `hover`, `marqueeStart`) and exposes them via getters.
 */

import { canvasToPainterMacro } from './editor-renderer.js';

const ZOOM_STEPS = [
  0.015625, 0.03125, 0.0625, 0.1, 0.15, 0.25, 0.4,
  0.5, 0.75, 1, 1.5, 2, 3, 4,
];

/**
 * @typedef {'brush'|'rect'} PaintMode
 */

export class EditorInput {
  /**
   * @param {object} opts
   * @param {HTMLCanvasElement} opts.canvas
   * @param {import('./editor-store.js').EditorStore} opts.store
   * @param {{ x: number, y: number, zoom: number }} opts.camera
   * @param {() => number} opts.getActiveBiomeId
   * @param {() => number} opts.getBrushSize
   * @param {() => PaintMode} opts.getMode
   * @param {(facts: object) => void} [opts.onChange] - emitted on hover/marquee tick
   * @param {() => void} [opts.onRequestRedraw]
   */
  constructor(opts) {
    this.canvas = opts.canvas;
    this.store = opts.store;
    this.camera = opts.camera;
    this.getActiveBiomeId = opts.getActiveBiomeId;
    this.getBrushSize = opts.getBrushSize;
    this.getMode = opts.getMode;
    this.onChange = opts.onChange || (() => {});
    this.onRequestRedraw = opts.onRequestRedraw || (() => {});

    /** @type {{ macroX: number, macroY: number } | null} */
    this.hover = null;
    this._painting = false;
    this._lastPaintCell = null;
    /** @type {{ macroX: number, macroY: number } | null} */
    this.marqueeStart = null;
    this.marqueeEnd = null;
    this._panning = false;
    this._panStart = null;

    this._bind();
  }

  destroy() {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._onPointerDown);
    c.removeEventListener('pointermove', this._onPointerMove);
    c.removeEventListener('pointerup', this._onPointerUp);
    c.removeEventListener('pointercancel', this._onPointerUp);
    c.removeEventListener('pointerleave', this._onPointerLeave);
    c.removeEventListener('contextmenu', this._onContextMenu);
    c.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('keydown', this._onKeyDown);
  }

  _bind() {
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);
    this._onContextMenu = (e) => e.preventDefault();
    this._onWheel = this._onWheel.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);

    const c = this.canvas;
    c.addEventListener('pointerdown', this._onPointerDown);
    c.addEventListener('pointermove', this._onPointerMove);
    c.addEventListener('pointerup', this._onPointerUp);
    c.addEventListener('pointercancel', this._onPointerUp);
    c.addEventListener('pointerleave', this._onPointerLeave);
    c.addEventListener('contextmenu', this._onContextMenu);
    c.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('keydown', this._onKeyDown);
  }

  _pickerCoords(evt) {
    const rect = this.canvas.getBoundingClientRect();
    const xCss = evt.clientX - rect.left;
    const yCss = evt.clientY - rect.top;
    const xCanvas = (xCss / rect.width) * this.canvas.width;
    const yCanvas = (yCss / rect.height) * this.canvas.height;
    return canvasToPainterMacro(xCanvas, yCanvas, this.camera, {
      width: this.canvas.width,
      height: this.canvas.height,
    });
  }

  _emitHud() {
    this.onChange({
      hover: this.hover,
      marquee:
        this.marqueeStart && this.marqueeEnd
          ? {
              macroX0: this.marqueeStart.macroX,
              macroY0: this.marqueeStart.macroY,
              macroX1: this.marqueeEnd.macroX,
              macroY1: this.marqueeEnd.macroY,
            }
          : null,
    });
    this.onRequestRedraw();
  }

  _onPointerDown(evt) {
    // Avoid the UA scrolling the page (or a flex/grid ancestor) to show the
    // focused canvas — on tall sidebars that can shove `.editor-header` off-screen.
    const c = this.canvas;
    if (typeof c.focus === 'function') {
      try {
        c.focus({ preventScroll: true });
      } catch {
        c.focus();
      }
    }
    this.canvas.setPointerCapture?.(evt.pointerId);
    if (evt.button === 1 || evt.button === 2 || evt.altKey) {
      this._panning = true;
      this._panStart = { x: evt.clientX, y: evt.clientY, camX: this.camera.x, camY: this.camera.y };
      evt.preventDefault();
      return;
    }
    if (evt.button !== 0) return;
    const cell = this._pickerCoords(evt);
    const mode = this.getMode();
    if (mode === 'rect') {
      this.marqueeStart = cell;
      this.marqueeEnd = cell;
    } else {
      this._painting = true;
      this._lastPaintCell = cell;
      this._paintBrushAt(cell.macroX, cell.macroY);
    }
    this._emitHud();
  }

  _onPointerMove(evt) {
    if (this._panning && this._panStart) {
      const dxCss = evt.clientX - this._panStart.x;
      const dyCss = evt.clientY - this._panStart.y;
      const rect = this.canvas.getBoundingClientRect();
      const dxCanvas = (dxCss / rect.width) * this.canvas.width;
      const dyCanvas = (dyCss / rect.height) * this.canvas.height;
      const zoom = this.camera.zoom || 1;
      this.camera.x = this._panStart.camX - dxCanvas / zoom;
      this.camera.y = this._panStart.camY - dyCanvas / zoom;
      this.onRequestRedraw();
      return;
    }

    const cell = this._pickerCoords(evt);
    this.hover = cell;

    if (this._painting && this.getMode() === 'brush') {
      if (
        !this._lastPaintCell ||
        this._lastPaintCell.macroX !== cell.macroX ||
        this._lastPaintCell.macroY !== cell.macroY
      ) {
        this._paintLine(this._lastPaintCell, cell);
        this._lastPaintCell = cell;
      }
    } else if (this.marqueeStart && this.getMode() === 'rect') {
      this.marqueeEnd = cell;
    }
    this._emitHud();
  }

  _onPointerUp(evt) {
    if (this._panning) {
      this._panning = false;
      this._panStart = null;
      this.canvas.releasePointerCapture?.(evt.pointerId);
      return;
    }
    if (this.marqueeStart && this.getMode() === 'rect') {
      const end = this._pickerCoords(evt);
      this.store.setRect(
        this.marqueeStart.macroX,
        this.marqueeStart.macroY,
        end.macroX,
        end.macroY,
        this.getActiveBiomeId(),
      );
      this.marqueeStart = null;
      this.marqueeEnd = null;
    }
    this._painting = false;
    this._lastPaintCell = null;
    this.canvas.releasePointerCapture?.(evt.pointerId);
    this._emitHud();
  }

  _onPointerLeave() {
    this.hover = null;
    this.onRequestRedraw();
  }

  _onWheel(evt) {
    evt.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const xCss = evt.clientX - rect.left;
    const yCss = evt.clientY - rect.top;
    const xCanvas = (xCss / rect.width) * this.canvas.width;
    const yCanvas = (yCss / rect.height) * this.canvas.height;
    const prevZoom = this.camera.zoom || 1;
    const idx = nearestZoomIdx(prevZoom);
    const next = evt.deltaY > 0 ? Math.max(0, idx - 1) : Math.min(ZOOM_STEPS.length - 1, idx + 1);
    const newZoom = ZOOM_STEPS[next];
    if (newZoom === prevZoom) return;
    // Keep the painter-pixel under the cursor stable while zooming.
    const painterPxXBefore = (xCanvas - this.canvas.width / 2) / prevZoom + this.camera.x;
    const painterPxYBefore = (yCanvas - this.canvas.height / 2) / prevZoom + this.camera.y;
    this.camera.zoom = newZoom;
    const painterPxXAfter = (xCanvas - this.canvas.width / 2) / newZoom + this.camera.x;
    const painterPxYAfter = (yCanvas - this.canvas.height / 2) / newZoom + this.camera.y;
    this.camera.x += painterPxXBefore - painterPxXAfter;
    this.camera.y += painterPxYBefore - painterPxYAfter;
    this.onRequestRedraw();
  }

  _onKeyDown(evt) {
    // Mode switching shortcuts are owned by the main module; we keep input
    // pure (move + cancel only) so the same instance works headless in tests.
    if (evt.key === 'Escape') {
      this.marqueeStart = null;
      this.marqueeEnd = null;
      this._painting = false;
      this.onRequestRedraw();
    }
  }

  _paintBrushAt(cx, cy) {
    const size = this.getBrushSize();
    const half = (size - 1) >> 1;
    const id = this.getActiveBiomeId();
    this.store.setRect(cx - half, cy - half, cx + half, cy + half, id);
  }

  _paintLine(from, to) {
    if (!from) {
      this._paintBrushAt(to.macroX, to.macroY);
      return;
    }
    let x0 = from.macroX;
    let y0 = from.macroY;
    const x1 = to.macroX;
    const y1 = to.macroY;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    this.store.beginBatch();
    try {
      while (true) {
        this._paintBrushAt(x0, y0);
        if (x0 === x1 && y0 === y1) break;
        const e2 = err * 2;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
      }
    } finally {
      this.store.endBatch();
    }
  }
}

function nearestZoomIdx(z) {
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < ZOOM_STEPS.length; i++) {
    const d = Math.abs(ZOOM_STEPS[i] - z);
    if (d < bestDiff) { bestDiff = d; best = i; }
  }
  return best;
}

export { ZOOM_STEPS };
