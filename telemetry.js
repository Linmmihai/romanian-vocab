// Privacy-safe client diagnostics. Events contain operation metadata, never study content.
(function initTelemetry(global) {
  const reported = new Map();
  const REPORT_WINDOW_MS = 5 * 60 * 1000;
  const MAX_EVENTS_PER_SESSION = 20;
  let eventCount = 0;

  function scrub(value) {
    return String(value || '')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
      .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[id]')
      .replace(/https?:\/\/\S+/gi, '[url]')
      .slice(0, 240);
  }

  function safeContext(context = {}) {
    const allowed = ['source', 'operation', 'status', 'count', 'online', 'page', 'version'];
    return Object.fromEntries(allowed
      .filter(key => context[key] !== undefined)
      .map(key => [key, typeof context[key] === 'string' ? scrub(context[key]) : context[key]]));
  }

  function reportClientIssue(eventType, error, context = {}) {
    if (eventCount >= MAX_EVENTS_PER_SESSION || typeof global.apiReportClientEvent !== 'function') return;
    const message = scrub(error?.message || error || 'Unknown client error');
    const errorName = scrub(error?.name || 'Error');
    const normalizedType = String(eventType || 'client_error').replace(/[^a-z0-9_]/gi, '_').slice(0, 48);
    const signature = `${normalizedType}:${errorName}:${message}`;
    const now = Date.now();
    if (now - Number(reported.get(signature) || 0) < REPORT_WINDOW_MS) return;
    reported.set(signature, now);
    eventCount++;
    Promise.resolve(global.apiReportClientEvent(normalizedType, {
      error_name: errorName,
      message,
      ...safeContext(context),
      online: navigator.onLine,
      page: location.pathname,
      version: global.ROMANIAN_VOCAB_APP_VERSION || 'unknown'
    })).catch(() => {});
  }

  global.reportClientIssue = reportClientIssue;
  global.addEventListener('error', event => {
    reportClientIssue('unhandled_error', event.error || event.message, { source: 'window' });
  });
  global.addEventListener('unhandledrejection', event => {
    reportClientIssue('unhandled_rejection', event.reason, { source: 'promise' });
  });
})(window);
