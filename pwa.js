(function initPwaUpdates(global) {
  const isLocalDevHost = ['127.0.0.1', 'localhost'].includes(location.hostname);
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;

  function showUpdatePrompt(registration) {
    if (!registration.waiting || document.getElementById('pwa-update-notice')) return;
    const notice = document.createElement('div');
    notice.id = 'pwa-update-notice';
    notice.className = 'pwa-update-notice';
    notice.setAttribute('role', 'status');
    notice.innerHTML = '<span>新版本已准备好</span><button type="button" aria-label="刷新并使用新版本">↻ 刷新</button>';
    notice.querySelector('button').addEventListener('click', () => {
      notice.querySelector('button').disabled = true;
      registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
    });
    document.body.appendChild(notice);
  }

  if (isLocalDevHost) {
    navigator.serviceWorker.getRegistrations()
      .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
      .catch(error => global.reportClientIssue?.('service_worker_cleanup_failed', error, { operation: 'unregister' }));
    if ('caches' in global) {
      caches.keys()
        .then(keys => Promise.all(keys.map(key => caches.delete(key))))
        .catch(error => global.reportClientIssue?.('service_worker_cleanup_failed', error, { operation: 'cache_clear' }));
    }
    return;
  }

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  global.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then(registration => {
        showUpdatePrompt(registration);
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdatePrompt(registration);
          });
        });
        return registration.update();
      })
      .catch(error => global.reportClientIssue?.('service_worker_update_failed', error, { operation: 'register' }));
  });
})(window);
