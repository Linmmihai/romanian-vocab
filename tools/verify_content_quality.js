const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const contentQuality = require(path.join(root, 'content-quality.js'));
const contentQualityUi = require(path.join(root, 'content-quality-ui.js'));
const quizEngine = require(path.join(root, 'quiz-engine.js'));
const payload = JSON.parse(fs.readFileSync(path.join(root, 'data', 'vocab.json'), 'utf8'));
const words = payload.words || [];

assert.equal(words.length, 4867, 'the verifier must audit the current complete vocabulary snapshot');
assert.strictEqual(quizEngine.isAssessmentEligible, contentQuality.isTrustedWord,
  'quiz eligibility must use the shared content-quality predicate');

const trusted = words.filter(contentQuality.isTrustedWord);
const coreWords = words.filter(word => word.content_status === 'active' && word.learning_track === 'news_core');
assert.equal(trusted.length, 283, 'the existing trusted inventory must not disappear');
assert.equal(coreWords.filter(contentQuality.isTrustedWord).length, 153,
  'the existing trusted news-core inventory must not disappear');

const untrusted = coreWords.find(word => !contentQuality.isTrustedWord(word));
const trustedCore = coreWords.find(contentQuality.isTrustedWord);
assert(untrusted && trustedCore, 'fixtures require both trusted and pending news-core words');
assert.deepEqual(
  contentQuality.filterWordsForContentScope([untrusted, trustedCore], 'trusted'),
  [trustedCore],
  'trusted scope must exclude an unlearned pending word'
);
assert.deepEqual(
  contentQuality.filterWordsForContentScope([untrusted, trustedCore], 'trusted', {
    shouldRetain: word => word === untrusted
  }),
  [untrusted, trustedCore],
  'trusted scope must retain a pending word that already has progress'
);

const summary = contentQuality.summarizeContentScope([untrusted, trustedCore], 'trusted', {
  shouldRetain: word => word === untrusted,
  isDue: word => word === untrusted
});
assert.deepEqual(summary, {
  scope: 'trusted',
  totalCount: 2,
  trustedCount: 1,
  untrustedCount: 1,
  visibleCount: 2,
  retainedProgressCount: 1,
  retainedDueCount: 1
});
assert.match(contentQualityUi.scopeSummaryText(summary), /已核对 1\/2/);
assert.match(contentQualityUi.scopeSummaryText(summary), /其中 1 个已到期/);
assert.match(contentQualityUi.scopeSummaryText({ ...summary, trustedCount: 0 }), /暂无可用的已核对新词/);

const report = contentQuality.getWordQuality(trustedCore);
assert.deepEqual(report.dimensions.map(item => item.label), ['词义', '语法', '重音', '例句', '自然度']);
assert.equal(report.trusted, true);
assert.equal(report.evidence.source, trustedCore.source);
assert.equal(report.evidence.reviewer, '未记录', 'a source value must never be presented as the reviewer');
assert.equal(report.evidence.reviewedAt, '未记录', 'an absent review time must stay explicitly unrecorded');
assert.equal(report.dimensions.find(item => item.key === 'grammar').status, 'not_recorded',
  'structured grammar without a dimension-specific review field must not be called reviewed');
assert.equal(report.dimensions.find(item => item.key === 'example').status, 'not_recorded',
  'an example without a dimension-specific review field must not be called reviewed');

const reviewOrder = contentQuality.sortWordsForContentReview([
  { ro: 'z', learning_track: 'news_extension', naturalness_status: 'needs_review' },
  { ro: 'a', learning_track: 'news_core', naturalness_status: 'needs_review' },
  { ro: 'b', zh: '乙', learning_track: 'news_core', naturalness_status: 'verified' }
]);
assert.equal(reviewOrder[0].ro, 'a', 'pending core content must be first in the review queue');
const realPendingOrder = contentQuality.sortWordsForContentReview(words.filter(word => !contentQuality.isTrustedWord(word)));
assert(realPendingOrder.slice(0, 30).every(word => word.learning_track === 'news_core'),
  'the first rendered review page must be reserved for pending core content while it exists');

const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
assert.match(appSource, /learning_content_scope:/, 'content scope must persist per user');
assert.match(appSource, /filterWordsForContentScope\(collectionWords, learningContentScope/, 'study scope must use the shared filter');
assert.match(appSource, /wordMatchesActiveLearningScope\(word\)/, 'saved daily cards must pass the active content scope');
assert.match(appSource, /renderWordQualityDetail\(w\)/, 'word detail must show quality dimensions and evidence');
assert.match(appSource, /function getLearningContentScopeSummary\(\)[\s\S]*?const collectionWords = W\.filter/,
  'scope totals must be calculated from the raw selected collection, not the already filtered visible pool');
assert.match(appSource, /!isTrustedWord\(word\).*issues\.includes\('needs_review'\)/,
  'the rendered admin queue must include words pending under the shared trust definition');
assert.match(appSource, /orderedWords = sortWordsForContentReview/,
  'the rendered admin queue must apply pending-core review priority');
assert.match(appSource, /audit\.rows\.slice\(0, 30\)[\s\S]*?openEditById/,
  'pending-core rows in the rendered admin queue must keep their edit action');

console.log(`content quality verified: ${trusted.length}/${words.length} trusted overall; ${coreWords.filter(contentQuality.isTrustedWord).length}/${coreWords.length} in news core`);
