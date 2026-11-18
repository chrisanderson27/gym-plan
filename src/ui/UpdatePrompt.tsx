import { useRegisterSW } from 'virtual:pwa-register/preact';

/** An update is offered, never forced: no auto-reload. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div class="update-bar" role="status">
      <span>Update available</span>
      <button type="button" onClick={() => updateServiceWorker(true)}>
        Reload
      </button>
      <button type="button" onClick={() => setNeedRefresh(false)}>
        Later
      </button>
    </div>
  );
}
