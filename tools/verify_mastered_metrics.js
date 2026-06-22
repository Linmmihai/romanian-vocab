const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REVIEW_INTERVALS = [1, 3, 7, 15, 30, 60];

function getProgressReviewStage(progress = {}) {
  return Number(
    progress.reviewStage ??
    progress.reviewCount ??
    progress.review_stage ??
    progress.review_count ??
    0
  ) || 0;
}

function normalizeStoredProgressLevel(level) {
  return ['unknown', 'learning', 'mastered'].includes(level) ? level : 'unknown';
}

function legacyIntervalDays(progress = {}) {
  const direct = Number(progress.intervalDays ?? progress.interval_days ?? 0) || 0;
  if (direct > 0) return direct;
  const stage = getProgressReviewStage(progress);
  if (stage <= 0) return 0;
  return REVIEW_INTERVALS[Math.min(stage - 1, REVIEW_INTERVALS.length - 1)] || 1;
}

function normalizeScheduler(progress = {}) {
  const qt = Number(progress.qt ?? progress.quiz_total ?? 0) || 0;
  const qr = Number(progress.qr ?? progress.quiz_right ?? 0) || 0;
  const reviewStage = getProgressReviewStage(progress);
  const intervalDays = legacyIntervalDays(progress);
  const memoryStrength = Math.max(0, Math.min(100, Number(
    progress.memoryStrength ?? progress.memory_strength ?? (qt ? Math.round((qr / Math.max(qt, 1)) * 60 + Math.min(intervalDays, 30)) : 0)
  ) || 0));
  const raw = progress.cardState || progress.card_state;
  const cardState = raw || (progress.level === 'mastered' || reviewStage > 0 ? 'review' : (qt || qr || progress.known ? 'learning' : 'new'));
  return {
    cardState,
    intervalDays,
    memoryStrength,
    needsReinforcement: !!(progress.needsReinforcement || progress.needs_reinforcement)
  };
}

function hasActiveWeakState(progress = {}, scheduler = normalizeScheduler(progress)) {
  if (scheduler.needsReinforcement || progress.needsReinforcement || progress.needs_reinforcement) return true;
  const wrongCount = Number(progress.wrongCount || progress.wrong_count || 0);
  const errorStreak = Number(progress.errorStreak || progress.error_streak || 0);
  return wrongCount >= 2 && errorStreak > 0;
}

function isMasteredProgress(progress = {}) {
  if (!progress) return false;
  const scheduler = normalizeScheduler(progress);
  if (hasActiveWeakState(progress, scheduler)) return false;
  const qt = Number(progress.qt || progress.quiz_total || 0);
  const qr = Number(progress.qr || progress.quiz_right || 0);
  const reviewStage = getProgressReviewStage(progress);
  if (scheduler.cardState === 'mastered') return true;
  if (normalizeStoredProgressLevel(progress.level) === 'mastered') return true;
  if (
    scheduler.cardState === 'review' &&
    scheduler.intervalDays >= 15 &&
    scheduler.memoryStrength >= 75
  ) return true;
  return qt >= 3 && qr / Math.max(qt, 1) >= 0.8 && reviewStage >= 2;
}

function calcProgressSummary(map) {
  const vals = Object.values(map || {});
  return {
    mastered: vals.filter(isMasteredProgress).length,
    known: vals.filter(p => p.known).length,
    qr: vals.reduce((sum, p) => sum + (p.qr || p.quiz_right || 0), 0),
    qt: vals.reduce((sum, p) => sum + (p.qt || p.quiz_total || 0), 0)
  };
}

{
  const legacyCloud = {
    known: true,
    qr: 4,
    qt: 5,
    reviewStage: 2,
    level: 'learning'
  };
  assert.strictEqual(isMasteredProgress(legacyCloud), true, 'legacy review-stage progress should count as mastered');
  assert.strictEqual(calcProgressSummary({ word: legacyCloud }).mastered, 1, 'summary should use the same mastered rule');
}

{
  const legacyLevelOnlyCloud = {
    known: true,
    qr: 6,
    qt: 6,
    level: 'mastered'
  };
  assert.strictEqual(isMasteredProgress(legacyLevelOnlyCloud), true, 'legacy stored level mastered should count');
}

{
  const modernScheduler = {
    known: true,
    qr: 8,
    qt: 9,
    cardState: 'review',
    intervalDays: 30,
    memoryStrength: 88,
    reviewStage: 5
  };
  assert.strictEqual(isMasteredProgress(modernScheduler), true, 'modern stable review scheduler progress should count');
}

{
  const unlearned = { known: false, qr: 0, qt: 0, cardState: 'new', level: 'unknown' };
  assert.strictEqual(isMasteredProgress(unlearned), false, 'new/unlearned word should not count as mastered');
}

{
  const weak = {
    known: true,
    qr: 8,
    qt: 9,
    cardState: 'review',
    intervalDays: 30,
    memoryStrength: 88,
    reviewStage: 5,
    needsReinforcement: true
  };
  assert.strictEqual(isMasteredProgress(weak), false, 'active weak/reinforcement word should not count as mastered');
}

{
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert(app.includes('function isMasteredProgress'), 'expected explicit shared mastered helper');
  assert(app.includes('const mastered = vals.filter(isMasteredProgress).length'), 'expected summary to use shared mastered helper');
  assert(app.includes('byUser[r.user_id][r.word_ro] = rowToProgress(r);'), 'expected leaderboard to preserve full Supabase progress rows');
  assert(!app.includes('byUser[r.user_id][r.word_ro] = {\n        known: r.known,'), 'leaderboard must not strip review/scheduler fields');
}

console.log('mastered metrics verification passed');
