/**
 * Play event log state (chat-like HUD feed).
 *
 * Channels:
 * - local  : nearby gameplay events
 * - global : world/system-wide events
 * - social : social interactions / reactions
 * - system : generic system notes
 */

const MAX_EVENTS = 140;
const DEDUPE_WINDOW_MS = 900;

/** @type {Array<{ id: number, ts: number, channel: 'local'|'global'|'social'|'system', text: string, portraitDexId?: number, portraitSlug?: string, portraitDexIds?: number[], hoverEntityKey?: string, eventKey?: string, pending?: boolean, portraitMemCleanup?: boolean }>} */
const eventLog = [];
/** @type {Set<(events: ReadonlyArray<{ id: number, ts: number, channel: 'local'|'global'|'social'|'system', text: string, portraitDexId?: number, portraitSlug?: string, portraitDexIds?: number[], hoverEntityKey?: string, eventKey?: string, pending?: boolean, portraitMemCleanup?: boolean }>) => void>} */
const listeners = new Set();
/** @type {Map<string, number>} dedupe key -> last ts */
const dedupeLastAt = new Map();
/** @type {Map<string, number>} event key -> event id */
const eventIdByKey = new Map();
let nextEventId = 1;

function emit() {
  const snap = eventLog.slice();
  for (const fn of listeners) {
    try {
      fn(snap);
    } catch {
      /* ignore listener failures */
    }
  }
}

/**
 * @param {{ channel?: 'local'|'global'|'social'|'system', text?: string, dedupeKey?: string, portraitDexId?: number, portraitSlug?: string, portraitDexIds?: number[], hoverEntityKey?: string, eventKey?: string, pending?: boolean, upsertByEventKey?: boolean, portraitMemCleanup?: boolean }} ev
 */
export function pushPlayEventLog(ev) {
  const text = String(ev?.text || '').trim();
  if (!text) return;
  const now = Date.now();
  const eventKeyRaw = String(ev?.eventKey || '').trim();
  const eventKey = eventKeyRaw.length ? eventKeyRaw : '';
  if (eventKey && ev?.upsertByEventKey) {
    const existingId = eventIdByKey.get(eventKey);
    if (typeof existingId === 'number') {
      const idx = eventLog.findIndex((row) => row.id === existingId);
      if (idx >= 0) {
        const prev = eventLog[idx];
        const rawPortraitDex = Number(ev?.portraitDexId);
        const portraitDexId = Number.isFinite(rawPortraitDex) && rawPortraitDex >= 1 ? Math.floor(rawPortraitDex) : prev.portraitDexId;
        const portraitSlug = String(ev?.portraitSlug || prev.portraitSlug || 'Normal').replace(/[^\w.-]/g, '') || 'Normal';
        const hoverEntityKeyRaw = String(ev?.hoverEntityKey || '').trim();
        const hoverEntityKey = hoverEntityKeyRaw.length ? hoverEntityKeyRaw : undefined;
        const incomingPortraitDexIds = normalizePortraitDexIds(ev?.portraitDexIds);
        const portraitDexIds = incomingPortraitDexIds || prev.portraitDexIds;
        const nextRow = {
          ...prev,
          channel: ev?.channel || prev.channel || 'system',
          text,
          ...(portraitDexId ? { portraitDexId, portraitSlug } : {}),
          ...(hoverEntityKey ? { hoverEntityKey } : {}),
          ...(hoverEntityKey ? {} : { hoverEntityKey: undefined }),
          pending: ev?.pending == null ? prev.pending : !!ev.pending,
          eventKey,
          ...(portraitDexIds ? { portraitDexIds } : {})
        };
        if (
          prev.channel === nextRow.channel &&
          prev.text === nextRow.text &&
          prev.portraitDexId === nextRow.portraitDexId &&
          prev.portraitSlug === nextRow.portraitSlug &&
          areNumberArraysEqual(prev.portraitDexIds, nextRow.portraitDexIds) &&
          prev.hoverEntityKey === nextRow.hoverEntityKey &&
          !!prev.pending === !!nextRow.pending &&
          !!prev.portraitMemCleanup === !!nextRow.portraitMemCleanup
        ) {
          return;
        }
        eventLog[idx] = nextRow;
        emit();
        return;
      }
      eventIdByKey.delete(eventKey);
    }
  }
  const dedupeKey = String(ev?.dedupeKey || '');
  if (dedupeKey) {
    const last = dedupeLastAt.get(dedupeKey) || 0;
    if (now - last < DEDUPE_WINDOW_MS) return;
    dedupeLastAt.set(dedupeKey, now);
  }
  const rawPortraitDex = Number(ev?.portraitDexId);
  const portraitDexId = Number.isFinite(rawPortraitDex) && rawPortraitDex >= 1 ? Math.floor(rawPortraitDex) : undefined;
  const portraitSlug = String(ev?.portraitSlug || 'Normal').replace(/[^\w.-]/g, '') || 'Normal';
  const portraitDexIds = normalizePortraitDexIds(ev?.portraitDexIds);
  const hoverEntityKeyRaw = String(ev?.hoverEntityKey || '').trim();
  const hoverEntityKey = hoverEntityKeyRaw.length ? hoverEntityKeyRaw : undefined;
  const id = nextEventId++;
  eventLog.push({
    id,
    ts: now,
    channel: ev?.channel || 'system',
    text,
    ...(portraitDexId ? { portraitDexId, portraitSlug } : {}),
    ...(portraitDexIds ? { portraitDexIds } : {}),
    ...(hoverEntityKey ? { hoverEntityKey } : {}),
    ...(eventKey ? { eventKey } : {}),
    ...(ev?.pending != null ? { pending: !!ev.pending } : {}),
    ...(ev?.portraitMemCleanup ? { portraitMemCleanup: true } : {})
  });
  if (eventKey) eventIdByKey.set(eventKey, id);
  if (eventLog.length > MAX_EVENTS) {
    const removed = eventLog.splice(0, eventLog.length - MAX_EVENTS);
    for (const row of removed) {
      const k = String(row?.eventKey || '');
      if (!k) continue;
      const idNow = eventIdByKey.get(k);
      if (idNow === row.id) eventIdByKey.delete(k);
    }
  }
  emit();
}

export function getPlayEventLogSnapshot() {
  return eventLog.slice();
}

export function clearPlayEventLog() {
  eventLog.length = 0;
  dedupeLastAt.clear();
  eventIdByKey.clear();
  emit();
}

/**
 * @param {(events: ReadonlyArray<{ id: number, ts: number, channel: 'local'|'global'|'social'|'system', text: string, portraitDexId?: number, portraitSlug?: string, portraitDexIds?: number[], hoverEntityKey?: string, eventKey?: string, pending?: boolean, portraitMemCleanup?: boolean }>) => void} fn
 * @returns {() => void}
 */
export function onPlayEventLogChanged(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  try {
    fn(eventLog.slice());
  } catch {
    /* ignore listener failures */
  }
  return () => {
    listeners.delete(fn);
  };
}

/**
 * @param {number[] | undefined | null} raw
 * @returns {number[] | undefined}
 */
function normalizePortraitDexIds(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out = [];
  for (const value of raw) {
    const dex = Math.floor(Number(value) || 0);
    if (dex >= 1) out.push(dex);
  }
  return out.length ? out : undefined;
}

/**
 * @param {number[] | undefined} a
 * @param {number[] | undefined} b
 */
function areNumberArraysEqual(a, b) {
  const aLen = Array.isArray(a) ? a.length : 0;
  const bLen = Array.isArray(b) ? b.length : 0;
  if (aLen !== bLen) return false;
  for (let i = 0; i < aLen; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return false;
  }
  return true;
}

