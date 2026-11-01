// Makes the app work offline and installable. The browser checks for a newer sw.js when the
// app opens, and that check carries none of your data. An update only applies when you say so.
export function registerServiceWorker(onUpdateReady) {
  if (!('serviceWorker' in navigator) || location.hostname === 'localhost') return;
  const watch = (reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) onUpdateReady(reg);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) onUpdateReady(reg);
      });
    });
  };
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(watch).catch(() => {});
}

export function applyUpdate(reg) {
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
  reg.waiting?.postMessage('apply-update');
}
