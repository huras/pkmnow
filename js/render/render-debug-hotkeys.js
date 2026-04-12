/** Toggles play collider overlay (syncs with #chkPlayColliders). */
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'c') return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  const chk = document.getElementById('chkPlayColliders');
  if (chk) {
    chk.checked = !chk.checked;
    chk.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    window.debugColliders = !window.debugColliders;
    console.log('[Debug] Colliders:', window.debugColliders);
  }
});
