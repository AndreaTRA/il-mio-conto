/** Install/offline status concerns the app shell, independently from financial data. */
export async function initializePwa({ onStatus, onUpdate }) {
  if (new URL(location.href).searchParams.has('dev')) { onStatus('online-only'); return; }
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    onStatus('online-only'); return;
  }
  try {
    const registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './', updateViaCache: 'none' });
    let reloadRequested = false;
    const offerUpdate = () => {
      if (registration.waiting && navigator.serviceWorker.controller) onUpdate(() => { reloadRequested = true; registration.waiting?.postMessage({ type: 'ACTIVATE_UPDATE' }); });
    };
    offerUpdate();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed') offerUpdate(); });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloadRequested) window.location.reload(); else onStatus('offline-ready'); });
    await navigator.serviceWorker.ready;
    onStatus('offline-ready');
  } catch { onStatus('online-only'); }
}
export function isInstalled() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
