/**
 * Off-main-thread JSON.stringify + LZ-String for play session localStorage writes.
 */
import LZString from 'https://esm.sh/lz-string@1.5.0';

const STORAGE_LZ_PREFIX = 'pkmn_lz1:';

self.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg || msg.cmd !== 'pack') return;
  const { id, payload } = msg;
  try {
    const json = JSON.stringify(payload);
    const packed = STORAGE_LZ_PREFIX + LZString.compressToUTF16(json);
    self.postMessage({ cmd: 'packed', id, packed });
  } catch (e) {
    const err = e && typeof e === 'object' && 'message' in e ? String(/** @type {Error} */ (e).message) : String(e);
    self.postMessage({ cmd: 'packed', id, error: err });
  }
};
