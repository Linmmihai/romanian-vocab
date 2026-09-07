(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RomanianVocabLearningEvidence = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const DEFAULT_EVENT_LIMIT = 500;
  const GRAMMAR_EXERCISES = new Set(['nounPlural', 'verbConj', 'stress', 'grammar']);
  const ACTIVE_RECALL_EXERCISES = new Set(['activeRecall', 'flashcard', 'review', 'wrongbook']);

  function isGrammarExercise(meta = {}) {
    return meta.grammar === true || GRAMMAR_EXERCISES.has(String(meta.exerciseType || ''));
  }

  function isActiveRecall(meta = {}) {
    if (typeof meta.activeRecall === 'boolean') return meta.activeRecall;
    const exerciseType = String(meta.exerciseType || '');
    return !exerciseType || ACTIVE_RECALL_EXERCISES.has(exerciseType);
  }

  function validIso(value) {
    const time = new Date(value || '').getTime();
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  }

  function createEventId(at) {
    if (typeof globalThis !== 'undefined' && typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return `${at}:${Math.random().toString(36).slice(2)}:${Date.now().toString(36)}`;
  }

  function inferCorrect(interaction, meta) {
    if (typeof meta.correct === 'boolean') return meta.correct;
    if (typeof meta.success === 'boolean') return meta.success;
    if (typeof meta.exact === 'boolean') return meta.exact;
    if (/_correct$|_known$/.test(interaction)) return true;
    if (/_wrong$|_unknown$|_fuzzy$/.test(interaction)) return false;
    return undefined;
  }

  function inferDueReview(interaction, meta, at) {
    if (typeof meta.dueReview === 'boolean') return meta.dueReview;
    if (!/^review_/.test(interaction)) return false;
    const progress = meta.prevProgress || {};
    const dueAt = validIso(progress.dueAt || progress.nextReviewAt || progress.nextReview);
    return !!dueAt && new Date(dueAt).getTime() <= new Date(at).getTime();
  }

  function normalizeEvidence(value = {}, options = {}) {
    const source = value && !Array.isArray(value) && typeof value === 'object' ? value : {};
    const events = Array.isArray(value)
      ? value.filter(event => event && typeof event === 'object')
      : (Array.isArray(source.events) ? source.events.filter(event => event && typeof event === 'object') : []);
    const requestedLimit = Number(options.limit || DEFAULT_EVENT_LIMIT);
    const limit = Math.max(1, Math.min(1000, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : DEFAULT_EVENT_LIMIT));
    return {
      ...source,
      version: Number(source.version || VERSION),
      events: events
        .map((event, index) => ({ event, index, time: new Date(event.at || '').getTime() }))
        .sort((left, right) => {
          const leftTime = Number.isFinite(left.time) ? left.time : 0;
          const rightTime = Number.isFinite(right.time) ? right.time : 0;
          return leftTime - rightTime || left.index - right.index;
        })
        .map(entry => entry.event)
        .slice(-limit)
    };
  }

  function mergeEvidence(left = {}, right = {}, options = {}) {
    const leftNormalized = normalizeEvidence(left, { limit: 1000 });
    const rightNormalized = normalizeEvidence(right, { limit: 1000 });
    const mergedEvents = [];
    const indexesById = new Map();
    for (const event of [...leftNormalized.events, ...rightNormalized.events]) {
      const id = String(event.id || '');
      if (id && indexesById.has(id)) {
        const index = indexesById.get(id);
        mergedEvents[index] = { ...mergedEvents[index], ...event };
      } else {
        if (id) indexesById.set(id, mergedEvents.length);
        mergedEvents.push(event);
      }
    }
    return normalizeEvidence({
      ...leftNormalized,
      ...rightNormalized,
      version: Math.max(Number(leftNormalized.version || 0), Number(rightNormalized.version || 0), VERSION),
      events: mergedEvents
    }, options);
  }

  function evidenceEvents(records) {
    if (!records) return [];
    if (Array.isArray(records)) {
      return records.flatMap(record => record && Array.isArray(record.events) ? record.events : [record])
        .filter(event => event && typeof event === 'object');
    }
    return Array.isArray(records.events) ? records.events.filter(event => event && typeof event === 'object') : [];
  }

  function emptyRate() {
    return { total: 0, correct: 0, accuracy: null };
  }

  function addRate(rate, correct) {
    rate.total += 1;
    if (correct) rate.correct += 1;
    rate.accuracy = rate.total ? rate.correct / rate.total : null;
  }

  function summarizeEvidence(records) {
    // Per-word retention belongs to storage. A whole-book summary must include
    // every supplied event, even after multiple devices contribute >1,000 rows.
    const byId = new Map();
    for (const event of evidenceEvents(records)) {
      const key = event.id ? String(event.id) : Symbol();
      byId.set(key, { ...byId.get(key), ...event });
    }
    const events = [...byId.values()].sort((a, b) =>
      (new Date(a.at || '').getTime() || 0) - (new Date(b.at || '').getTime() || 0));
    const summary = {
      total: events.length,
      byExerciseType: {},
      byPromptMode: {},
      listening: emptyRate(),
      spelling: emptyRate(),
      dueReviewFirstAttempt: emptyRate()
    };
    const seenDueAttempts = new Set();
    for (const event of events) {
      if (event.exerciseType) {
        summary.byExerciseType[event.exerciseType] ||= emptyRate();
        if (typeof event.correct === 'boolean') addRate(summary.byExerciseType[event.exerciseType], event.correct);
      }
      if (event.promptMode) {
        summary.byPromptMode[event.promptMode] ||= emptyRate();
        if (typeof event.correct === 'boolean') addRate(summary.byPromptMode[event.promptMode], event.correct);
      }
      if (typeof event.listeningCorrect === 'boolean') addRate(summary.listening, event.listeningCorrect);
      if (typeof event.spellingExact === 'boolean') addRate(summary.spelling, event.spellingExact);
      if (event.dueReview && event.firstAttempt === true && isActiveRecall(event) && typeof event.correct === 'boolean') {
        const wordKey = String(event.wordId ?? event.wordRo ?? '');
        const key = `${wordKey}\u0000${event.date || ''}`;
        if (!seenDueAttempts.has(key)) {
          seenDueAttempts.add(key);
          addRate(summary.dueReviewFirstAttempt, event.correct);
        }
      }
    }
    return summary;
  }

  function buildEvidence(previous = {}, interactionType, meta = {}) {
    const previousObject = normalizeEvidence(previous, { limit: 1000 });
    const previousEvents = previousObject.events;
    const interaction = String(interactionType || '').trim();
    if (!interaction) return { ...previousObject, version: Number(previousObject.version || VERSION), events: previousEvents };

    const at = validIso(meta.at) || new Date().toISOString();
    const date = String(meta.date || at.slice(0, 10));
    const exerciseType = String(meta.exerciseType || (isActiveRecall(meta) ? 'activeRecall' : '')).trim();
    const promptMode = String(meta.promptMode || (/^(flashcard|review|wrongbook)_/.test(interaction)
      ? 'meaning-to-form-card'
      : '')).trim();
    const correct = inferCorrect(interaction, meta);
    const event = {
      id: String(meta.eventId || createEventId(at)),
      at,
      date,
      interaction,
      ...(meta.wordId !== undefined && meta.wordId !== null ? { wordId: meta.wordId } : {}),
      ...(String(meta.wordRo || '').trim() ? { wordRo: String(meta.wordRo).trim() } : {}),
      ...(exerciseType ? { exerciseType } : {}),
      ...(promptMode ? { promptMode } : {}),
      ...(typeof correct === 'boolean' ? { correct } : {}),
      ...(typeof meta.exact === 'boolean' ? { exact: meta.exact } : {}),
      ...(typeof meta.spellingExact === 'boolean' ? { spellingExact: meta.spellingExact } : {}),
      ...(typeof meta.listeningCorrect === 'boolean' ? { listeningCorrect: meta.listeningCorrect } : {}),
      ...(meta.responseMs !== null && meta.responseMs !== undefined && Number.isFinite(Number(meta.responseMs))
        ? { responseMs: Math.max(0, Math.round(Number(meta.responseMs))) }
        : {}),
      dueReview: inferDueReview(interaction, meta, at)
    };
    const previousWithSameId = previousEvents.find(previousEvent =>
      String(previousEvent.id || '') && String(previousEvent.id) === event.id
    );
    event.firstAttempt = typeof previousWithSameId?.firstAttempt === 'boolean'
      ? previousWithSameId.firstAttempt
      : !previousEvents.some(previousEvent =>
          previousEvent.date === event.date &&
          previousEvent.exerciseType === event.exerciseType
        );

    return mergeEvidence(previousObject, {
      version: Number(previousObject.version || VERSION),
      events: [event]
    }, { limit: meta.limit });
  }

  return {
    VERSION,
    DEFAULT_EVENT_LIMIT,
    isGrammarExercise,
    isActiveRecall,
    normalizeEvidence,
    mergeEvidence,
    summarizeEvidence,
    buildEvidence
  };
});
