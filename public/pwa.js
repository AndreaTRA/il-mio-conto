/** Install/offline status concerns the app shell, independently from financial data. */
let activeRegistration, offerAvailableUpdate;
export async function checkForAppUpdate() {
  if (!('serviceWorker' in navigator)) return false;
  const registration = activeRegistration || await navigator.serviceWorker.getRegistration('./');
  if (!registration) return false;
  await registration.update();
  offerAvailableUpdate?.();
  return Boolean(registration.waiting);
}
export async function initializePwa({ onStatus, onUpdate }) {
  if (new URL(location.href).searchParams.has('dev')) { onStatus('online-only'); return; }
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    onStatus('online-only'); return;
  }
  try {
    const registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './', updateViaCache: 'none' });
    activeRegistration = registration;
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloadRequested = false;
    const offerUpdate = () => {
      if (registration.waiting && navigator.serviceWorker.controller) onUpdate(() => { reloadRequested = true; registration.waiting?.postMessage({ type: 'ACTIVATE_UPDATE' }); });
    };
    offerAvailableUpdate = offerUpdate;
    offerUpdate();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed') offerUpdate(); });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadRequested) window.location.reload();
      else {
        onStatus('offline-ready');
        // The worker is already active, so the remaining action is just a
        // guarded page reload, not another message to a waiting worker.
        if (hadController) onUpdate(() => window.location.reload());
      }
    });
    await navigator.serviceWorker.ready;
    onStatus('offline-ready');
  } catch { onStatus('online-only'); }
}
export function isInstalled() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
