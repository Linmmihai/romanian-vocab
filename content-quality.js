(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RomanianVocabContentQuality = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TRUSTED_NATURALNESS_STATUSES = Object.freeze(['verified', 'revised']);
  const CONTENT_SCOPE_OPTIONS = Object.freeze([
    Object.freeze({ value: 'all', label: '全部内容' }),
    Object.freeze({ value: 'trusted', label: '仅已核对新词' })
  ]);
  const CONTENT_SCOPE_VALUES = new Set(CONTENT_SCOPE_OPTIONS.map(option => option.value));
  const VERIFIED_STATUSES = new Set(['verified', 'revised']);
  const PENDING_STATUSES = new Set(['needs_review', 'pending', 'imported']);

  const DIMENSIONS = Object.freeze([
    Object.freeze({ key: 'meaning', label: '词义' }),
    Object.freeze({ key: 'grammar', label: '语法' }),
    Object.freeze({ key: 'stress', label: '重音' }),
    Object.freeze({ key: 'example', label: '例句' }),
    Object.freeze({ key: 'naturalness', label: '自然度' })
  ]);

  function clean(value) {
    return String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
  }

  function lower(value) {
    return clean(value).toLowerCase();
  }

  function normalizeContentScope(value) {
    const normalized = lower(value);
    return CONTENT_SCOPE_VALUES.has(normalized) ? normalized : 'all';
  }

  function isTrustedWord(word) {
    return !!(
      clean(word?.ro) &&
      clean(word?.zh) &&
      TRUSTED_NATURALNESS_STATUSES.includes(lower(word?.naturalness_status || word?.naturalnessStatus))
    );
  }

  function explicitDimensionStatus(word, key) {
    const quality = word?.quality_status || word?.qualityStatus || {};
    return lower(
      quality?.[key] ||
      word?.[`${key}_status`] ||
      word?.[`${key}Status`]
    );
  }

  function hasGrammarContent(word) {
    const grammar = word?.grammar_data || word?.grammarData;
    return !!(
      (grammar && typeof grammar === 'object' && Object.keys(grammar).length) ||
      clean(word?.grammar_note || word?.grammar || word?.forms || word?.hint)
    );
  }

  function hasStressContent(word) {
    return !!clean(word?.stress || word?.ipa);
  }

  function hasExampleContent(word) {
    return !!clean(word?.example_ro || word?.exampleRo || word?.sentence_ro);
  }

  function statusDescriptor(rawStatus, hasContent, options = {}) {
    const status = lower(rawStatus);
    if (!hasContent) return { status: 'missing', label: '缺少内容', recordedStatus: status };
    if (VERIFIED_STATUSES.has(status)) {
      return {
        status: 'verified',
        label: status === 'revised' ? '已修订' : (options.overall ? '词条已标记核对' : '已核对'),
        recordedStatus: status
      };
    }
    if (PENDING_STATUSES.has(status)) {
      return { status: 'pending', label: '待核对', recordedStatus: status };
    }
    return { status: 'not_recorded', label: '未记录单项核对', recordedStatus: status };
  }

  function getQualityDimensions(word) {
    const meaningStatus = explicitDimensionStatus(word, 'meaning') || lower(word?.verification_status || word?.verificationStatus);
    const naturalnessStatus = explicitDimensionStatus(word, 'naturalness') || lower(word?.naturalness_status || word?.naturalnessStatus);
    const definitions = {
      meaning: statusDescriptor(meaningStatus, !!(clean(word?.ro) && clean(word?.zh)), { overall: true }),
      grammar: statusDescriptor(explicitDimensionStatus(word, 'grammar'), hasGrammarContent(word)),
      stress: statusDescriptor(explicitDimensionStatus(word, 'stress'), hasStressContent(word)),
      example: statusDescriptor(explicitDimensionStatus(word, 'example'), hasExampleContent(word)),
      naturalness: statusDescriptor(naturalnessStatus, !!clean(word?.ro))
    };
    return DIMENSIONS.map(dimension => {
      const descriptor = definitions[dimension.key];
      return Object.freeze({
        ...dimension,
        status: descriptor.status,
        statusLabel: descriptor.label,
        recordedStatus: descriptor.recordedStatus
      });
    });
  }

  function firstRecorded(word, keys) {
    for (const key of keys) {
      const value = clean(word?.[key]);
      if (value) return value;
    }
    return '';
  }

  function getQualityEvidence(word) {
    return Object.freeze({
      source: firstRecorded(word, ['source']),
      evidenceMethod: firstRecorded(word, ['evidence_method', 'evidenceMethod']),
      curationReason: firstRecorded(word, ['curation_reason', 'curationReason']),
      corpusSnapshot: firstRecorded(word, ['corpus_snapshot', 'corpusSnapshot']),
      frequencySource: firstRecorded(word, ['frequency_source', 'frequencySource']),
      reviewer: firstRecorded(word, ['reviewed_by', 'reviewedBy', 'reviewer']) || '未记录',
      reviewedAt: firstRecorded(word, ['reviewed_at', 'reviewedAt', 'review_time', 'reviewTime']) || '未记录'
    });
  }

  function getWordQuality(word) {
    return Object.freeze({
      trusted: isTrustedWord(word),
      eligibilityLabel: isTrustedWord(word) ? '可作为已核对内容使用' : '待核对',
      dimensions: getQualityDimensions(word),
      evidence: getQualityEvidence(word)
    });
  }

  function filterWordsForContentScope(words, scope = 'all', options = {}) {
    const rows = Array.isArray(words) ? words.filter(Boolean) : [];
    if (normalizeContentScope(scope) === 'all') return [...rows];
    const shouldRetain = typeof options.shouldRetain === 'function' ? options.shouldRetain : () => false;
    return rows.filter(word => isTrustedWord(word) || shouldRetain(word));
  }

  function summarizeContentScope(words, scope = 'all', options = {}) {
    const rows = Array.isArray(words) ? words.filter(Boolean) : [];
    const shouldRetain = typeof options.shouldRetain === 'function' ? options.shouldRetain : () => false;
    const isDue = typeof options.isDue === 'function' ? options.isDue : () => false;
    const trustedCount = rows.filter(isTrustedWord).length;
    const retained = rows.filter(word => !isTrustedWord(word) && shouldRetain(word));
    return Object.freeze({
      scope: normalizeContentScope(scope),
      totalCount: rows.length,
      trustedCount,
      untrustedCount: Math.max(0, rows.length - trustedCount),
      visibleCount: normalizeContentScope(scope) === 'trusted' ? trustedCount + retained.length : rows.length,
      retainedProgressCount: retained.length,
      retainedDueCount: retained.filter(isDue).length
    });
  }

  function getContentReviewPriority(word) {
    const track = lower(word?.learning_track || word?.learningTrack);
    const pending = !isTrustedWord(word);
    const coreRank = pending && track === 'news_core' ? 0 : pending ? 1 : 2;
    const frequencyRank = Number(word?.frequency_rank || word?.frequencyRank);
    const newsDocuments = Number(word?.news_document_count || word?.newsDocumentCount || 0);
    return {
      coreRank,
      frequencyRank: Number.isFinite(frequencyRank) && frequencyRank > 0 ? frequencyRank : Number.MAX_SAFE_INTEGER,
      newsDocuments
    };
  }

  function compareContentReviewPriority(left, right) {
    const a = getContentReviewPriority(left);
    const b = getContentReviewPriority(right);
    return a.coreRank - b.coreRank ||
      a.frequencyRank - b.frequencyRank ||
      b.newsDocuments - a.newsDocuments ||
      clean(left?.ro).localeCompare(clean(right?.ro), 'ro');
  }

  function sortWordsForContentReview(words) {
    return [...(Array.isArray(words) ? words : [])].sort(compareContentReviewPriority);
  }

  return Object.freeze({
    TRUSTED_NATURALNESS_STATUSES,
    CONTENT_SCOPE_OPTIONS,
    DIMENSIONS,
    normalizeContentScope,
    isTrustedWord,
    getQualityDimensions,
    getQualityEvidence,
    getWordQuality,
    filterWordsForContentScope,
    summarizeContentScope,
    getContentReviewPriority,
    compareContentReviewPriority,
    sortWordsForContentReview
  });
});
