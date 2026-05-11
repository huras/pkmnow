export function renderItemVisibleInPlayerVision(item, vision) {
  if (!vision?.enabled) return true;
  if (!item || typeof item !== 'object') return true;
  if (item.type === 'player') return true;

  let mx = null;
  let my = null;
  if (Number.isFinite(item.originX) && Number.isFinite(item.originY)) {
    if (item.type === 'tree') {
      mx = Math.floor(item.originX);
      my = Math.floor(item.originY);
    } else if (item.type === 'scatter') {
      mx = Math.floor(Number(item.originX) + Math.max(0, ((Number(item.cols) || 1) - 1) * 0.5));
      my = Math.floor(Number(item.y) || Number(item.originY));
    } else if (item.type === 'building') {
      const cols = Number(item.bData?.cols) || 1;
      const rows = Number(item.bData?.rows) || 1;
      mx = Math.floor(Number(item.originX) + (cols - 1) * 0.5);
      my = Math.floor(Number(item.originY) + rows - 1);
    } else {
      mx = Math.floor(item.originX);
      my = Math.floor(item.originY);
    }
  } else if (Number.isFinite(item.x) && Number.isFinite(item.y)) {
    mx = Math.floor(item.x);
    my = Math.floor(item.y);
  } else if (
    Number.isFinite(item.cx) &&
    Number.isFinite(item.cy) &&
    Number.isFinite(item.dw) &&
    Number.isFinite(item.dh)
  ) {
    // Fallback from pixel-space center/pivot back to micro tile estimate is not reliable here.
    return true;
  }
  if (!Number.isFinite(mx) || !Number.isFinite(my)) return true;
  return vision.isVisible(mx, my);
}

export function renderItemSortX(item) {
  if (Number.isFinite(item?.originX)) return Number(item.originX);
  if (Number.isFinite(item?.x)) return Number(item.x);
  if (Number.isFinite(item?.cx)) return Number(item.cx);
  return 0;
}
