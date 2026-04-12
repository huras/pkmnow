/** Toggles debug colliders on/off */
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'c') {
    window.debugColliders = !window.debugColliders;
    console.log('[Debug] Colliders:', window.debugColliders);
  }
});
