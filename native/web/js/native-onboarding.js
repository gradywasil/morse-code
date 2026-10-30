const WARNING_KEY = 'morse.hide-flash-warning.v1';

export function installNativeOnboarding(hardware, doc = document, storage = localStorage) {
  let warningRead = false;
  let requestedBroadcast = false;
  const permissionReady = hardware.prepareCamera().catch(() => {});
  const saved = () => {
    try { return storage.getItem(WARNING_KEY) === 'yes'; } catch { return false; }
  };
  doc.addEventListener('click', event => {
    if (event.target.closest('[data-action="ack"]')) {
      warningRead = true;
      if (doc.querySelector('#remember-flash-warning')?.checked) {
        try { storage.setItem(WARNING_KEY, 'yes'); } catch { /* Keep this launch usable. */ }
      }
    }
    if (event.target.closest('[data-show-flash-warning]')) {
      try { storage.removeItem(WARNING_KEY); } catch { /* No persisted choice to clear. */ }
      warningRead = false;
      doc.querySelector('[data-show-flash-warning]').textContent = 'WARNING RESTORED';
    }
  }, true);
  async function advance() {
    const state = doc.body.dataset.state;
    if (state === 'idle' || state === 'done' || state === 'stopped') requestedBroadcast = false;
    if (state === 'preflight') requestedBroadcast = true;
    await permissionReady;
    if (doc.body.dataset.state !== state) return;
    const action = state === 'preflight' && (warningRead || saved()) ? 'ack'
      : state === 'awaiting-permission' ? 'continue-prompt'
      : state === 'receive-preflight' ? 'begin-listening'
      : state === 'torch-ready' && requestedBroadcast ? 'broadcast' : null;
    if (action) {
      if (state === 'torch-ready') requestedBroadcast = false;
      doc.querySelector(`[data-action="${action}"]`)?.click();
    }
  }
  new MutationObserver(advance).observe(doc.body, { attributes: true, attributeFilter: ['data-state'] });
  advance();
}
