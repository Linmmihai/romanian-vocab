(function (root) {
  function uniqueBy(items = [], keyOf = value => String(value || '')) {
    const seen = new Set();
    return (Array.isArray(items) ? items : []).filter(item => {
      const key = keyOf(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function sortByPhase(items = [], options = {}) {
    const keyOf = options.keyOf || (value => String(value || ''));
    const priorityOf = options.priorityOf || (() => 0);
    const dueAtOf = options.dueAtOf || (() => null);
    const locale = options.locale || 'ro';
    return uniqueBy(items, keyOf).sort((a, b) => {
      const priorityDiff = Number(priorityOf(a) || 0) - Number(priorityOf(b) || 0);
      if (priorityDiff) return priorityDiff;
      const aDue = dueAtOf(a) ? new Date(dueAtOf(a)).getTime() : Number.MAX_SAFE_INTEGER;
      const bDue = dueAtOf(b) ? new Date(dueAtOf(b)).getTime() : Number.MAX_SAFE_INTEGER;
      return aDue - bDue || String(keyOf(a)).localeCompare(String(keyOf(b)), locale);
    });
  }

  function buildTieredPlan(tiers = [], options = {}) {
    const keyOf = options.keyOf || (value => String(value || ''));
    const limit = Math.max(1, Number(options.limit || 200));
    return uniqueBy(tiers.flatMap(tier => Array.isArray(tier) ? tier : []), keyOf).slice(0, limit);
  }

  function composeOpenQueue(options = {}) {
    const keyOf = options.keyOf || (value => String(value || ''));
    const sortWords = options.sortWords || (items => uniqueBy(items, keyOf));
    const goal = Math.max(1, Number(options.goal || 200));
    const completedCount = Math.max(0, Number(options.completedCount || 0));
    const openSlots = Math.max(0, goal - completedCount);
    const deferred = uniqueBy(options.deferred || [], keyOf).slice(0, openSlots);
    if (!openSlots) {
      return { words: deferred, active: [], replacements: [], deferred, openSlots };
    }
    const activeSlots = Math.max(0, openSlots - deferred.length);
    const active = sortWords(uniqueBy(options.active || [], keyOf)).slice(0, activeSlots);
    const used = new Set([...active, ...deferred].map(keyOf));
    const missing = Math.max(0, activeSlots - active.length);
    const replacements = missing
      ? sortWords(uniqueBy(options.candidates || [], keyOf))
          .filter(item => !used.has(keyOf(item)))
          .slice(0, missing)
      : [];
    return {
      words: uniqueBy([...active, ...replacements, ...deferred], keyOf).slice(0, openSlots),
      active,
      replacements,
      deferred,
      openSlots
    };
  }

  const api = { uniqueBy, sortByPhase, buildTieredPlan, composeOpenQueue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RomanianVocabDailyPlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
