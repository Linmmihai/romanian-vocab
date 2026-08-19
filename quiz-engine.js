(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RomanianVocabQuizEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TRUSTED_STATUSES = new Set(['verified', 'revised']);
  const DIFFICULTY_RANK = { beginner: 1, intermediate: 2, advanced: 3 };
  const DIMENSION_LABELS = {
    translation: '词义辨认',
    listening: '听音辨义',
    dictation: '听写解码',
    nounPlural: '名词复数',
    verbConj: '动词变位',
    stress: '重音判断'
  };

  function clean(value) {
    return String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
  }

  function normalizeRomanianAnswer(value) {
    return clean(value)
      .toLocaleLowerCase('ro')
      .replace(/[’`]/g, "'")
      .replace(/\s*([-'])\s*/g, '$1');
  }

  function stripRomanianDiacritics(value) {
    return normalizeRomanianAnswer(value)
      .replace(/[ăâ]/g, 'a')
      .replace(/î/g, 'i')
      .replace(/ș/g, 's')
      .replace(/ț/g, 't');
  }

  function normalizeChineseLabel(value) {
    return clean(value)
      .toLocaleLowerCase('zh-CN')
      .replace(/[，。；：！？、,.!?;:\s]/g, '');
  }

  function getTrustedAudioUrl(word, baseHref = 'https://localhost/') {
    const raw = clean(word?.audio_url || word?.audioUrl);
    const source = clean(word?.audio_source || word?.audioSource);
    const license = clean(word?.audio_license || word?.audioLicense);
    const kind = clean(word?.audio_kind || word?.audioKind).toLowerCase();
    if (!raw || !source || !license || kind !== 'human') return '';
    try {
      const base = new URL(baseHref);
      const url = new URL(raw, base);
      const localHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost)) return '';
      return url.href;
    } catch {
      return '';
    }
  }

  function classifyDictation(response, answer) {
    const typed = normalizeRomanianAnswer(response);
    const expected = normalizeRomanianAnswer(answer);
    if (!typed) return { kind: 'blank', points: 0, exact: false, listeningCorrect: false };
    if (typed === expected) return { kind: 'exact', points: 1, exact: true, listeningCorrect: true };
    if (stripRomanianDiacritics(typed) === stripRomanianDiacritics(expected)) {
      return { kind: 'diacritics', points: 0.5, exact: false, listeningCorrect: true };
    }
    return { kind: 'wrong', points: 0, exact: false, listeningCorrect: false };
  }

  function getDifficultyRank(word) {
    return DIFFICULTY_RANK[String(word?.difficulty || '').toLowerCase()] || 2;
  }

  function filterWordsByDifficulty(words, difficulty = 'standard') {
    const pool = Array.isArray(words) ? words.filter(Boolean) : [];
    if (difficulty === 'foundation') return pool.filter(word => getDifficultyRank(word) === 1);
    if (difficulty === 'challenge') return pool.filter(word => getDifficultyRank(word) >= 2);
    return pool;
  }

  function isAssessmentEligible(word) {
    return !!(
      clean(word?.ro) &&
      clean(word?.zh) &&
      TRUSTED_STATUSES.has(String(word?.naturalness_status || '').toLowerCase())
    );
  }

  function uniqueWords(words) {
    const seen = new Set();
    return (Array.isArray(words) ? words : []).filter(word => {
      const key = normalizeRomanianAnswer(word?.ro);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function shuffled(values, random = Math.random) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index--) {
      const target = Math.floor(random() * (index + 1));
      [result[index], result[target]] = [result[target], result[index]];
    }
    return result;
  }

  function buildTypeSequence(total, difficulty) {
    const ratios = difficulty === 'foundation'
      ? { listening: 0.45, dictation: 0.25, translation: 0.30 }
      : difficulty === 'challenge'
        ? { listening: 0.20, dictation: 0.50, translation: 0.30 }
        : { listening: 0.35, dictation: 0.35, translation: 0.30 };
    const counts = {
      listening: Math.floor(total * ratios.listening),
      dictation: Math.floor(total * ratios.dictation),
      translation: Math.floor(total * ratios.translation)
    };
    let assigned = counts.listening + counts.dictation + counts.translation;
    const order = ['listening', 'dictation', 'translation'];
    while (assigned < total) {
      counts[order[assigned % order.length]]++;
      assigned++;
    }
    const sequence = [];
    while (sequence.length < total) {
      for (const type of order) {
        if (counts[type] > 0) {
          sequence.push(type);
          counts[type]--;
        }
      }
    }
    return sequence;
  }

  function buildDiagnosticPlan(words, options = {}) {
    const difficulty = options.difficulty || 'standard';
    const random = typeof options.random === 'function' ? options.random : Math.random;
    const requestedSize = Math.max(0, Number(options.size || 0));
    const eligible = filterWordsByDifficulty(
      uniqueWords(words).filter(isAssessmentEligible),
      difficulty
    );
    const total = requestedSize > 0 ? Math.min(requestedSize, eligible.length) : eligible.length;
    const selected = shuffled(eligible, random).slice(0, total);
    const types = buildTypeSequence(selected.length, difficulty);
    return selected.map((word, index) => ({ word, type: types[index] }));
  }

  function getOptionLabel(word, direction) {
    return direction === 'zh-to-ro' ? normalizeRomanianAnswer(word?.ro) : normalizeChineseLabel(word?.zh);
  }

  function getDistractorScore(candidate, answer) {
    let score = 0;
    if (candidate?.part_of_speech && candidate.part_of_speech === answer?.part_of_speech) score += 8;
    if (candidate?.topic && candidate.topic === answer?.topic) score += 5;
    if (getDifficultyRank(candidate) === getDifficultyRank(answer)) score += 4;
    if (candidate?.unit_type && candidate.unit_type === answer?.unit_type) score += 2;
    const lengthGap = Math.abs(clean(candidate?.ro).length - clean(answer?.ro).length);
    score += Math.max(0, 3 - Math.min(3, lengthGap));
    return score;
  }

  function buildDistractors(answer, words, options = {}) {
    if (!answer) return [];
    const count = Math.max(1, Number(options.count || 3));
    const direction = options.direction === 'zh-to-ro' ? 'zh-to-ro' : 'ro-to-zh';
    const random = typeof options.random === 'function' ? options.random : Math.random;
    const answerKey = normalizeRomanianAnswer(answer.ro);
    const answerLabel = getOptionLabel(answer, direction);
    const seenLabels = new Set([answerLabel]);
    return uniqueWords(words)
      .filter(candidate => normalizeRomanianAnswer(candidate.ro) !== answerKey)
      .map(candidate => ({ candidate, score: getDistractorScore(candidate, answer), tie: random() }))
      .sort((left, right) => right.score - left.score || left.tie - right.tie)
      .map(entry => entry.candidate)
      .filter(candidate => {
        const label = getOptionLabel(candidate, direction);
        if (!label || seenLabels.has(label)) return false;
        seenLabels.add(label);
        return true;
      })
      .slice(0, count);
  }

  function summarizeResults(results) {
    const rows = Array.isArray(results) ? results.filter(Boolean) : [];
    const dimensions = {};
    let points = 0;
    let exact = 0;
    let partial = 0;
    for (const result of rows) {
      const type = result.type || 'translation';
      if (!dimensions[type]) dimensions[type] = { type, label: DIMENSION_LABELS[type] || type, points: 0, total: 0, exact: 0, partial: 0 };
      const value = Math.max(0, Math.min(1, Number(result.points || 0)));
      points += value;
      exact += result.exact ? 1 : 0;
      partial += !result.exact && value > 0 ? 1 : 0;
      dimensions[type].points += value;
      dimensions[type].total++;
      dimensions[type].exact += result.exact ? 1 : 0;
      dimensions[type].partial += !result.exact && value > 0 ? 1 : 0;
    }
    const total = rows.length;
    const listeningRows = rows.filter(result => ['listening', 'dictation'].includes(result.type));
    const recordingRows = listeningRows.filter(result => result.audioSource === 'recording');
    const replayTotal = listeningRows.reduce((sum, result) => sum + Math.max(0, Number(result.replayCount || 0)), 0);
    return {
      points,
      total,
      exact,
      partial,
      percent: total ? Math.round(points / total * 100) : 0,
      dimensions: Object.values(dimensions).map(dimension => ({
        ...dimension,
        percent: dimension.total ? Math.round(dimension.points / dimension.total * 100) : 0
      })),
      listeningCount: listeningRows.length,
      recordingCount: recordingRows.length,
      averageListeningPlays: listeningRows.length ? replayTotal / listeningRows.length : 0,
      evidenceLabel: total >= 50 ? '样本较充分' : total >= 20 ? '初步证据' : '样本很少'
    };
  }

  return {
    TRUSTED_STATUSES,
    DIMENSION_LABELS,
    normalizeRomanianAnswer,
    stripRomanianDiacritics,
    normalizeChineseLabel,
    getTrustedAudioUrl,
    classifyDictation,
    getDifficultyRank,
    filterWordsByDifficulty,
    isAssessmentEligible,
    buildDiagnosticPlan,
    buildDistractors,
    summarizeResults
  };
});
