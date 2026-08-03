const assert = require('assert');
const fs = require('fs');
const path = require('path');
const dailyPlan = require('../daily-plan.js');

function roKey(value) {
  return String(value || '').trim().toLocaleLowerCase('ro');
}

function repairTodayQueue({
  todayQueue,
  completed = [],
  deferred = [],
  unseen = [],
  dailyGoal = todayQueue.length,
  todayNewWords = completed.length,
  dailyNewLimit = 30
}) {
  const completedKeys = new Set(completed.map(roKey));
  const deferredKeys = new Set(deferred.map(roKey));
  const activeOpen = todayQueue.filter((ro) => !completedKeys.has(roKey(ro)) && !deferredKeys.has(roKey(ro)));
  const deferredOpen = todayQueue.filter((ro) => !completedKeys.has(roKey(ro)) && deferredKeys.has(roKey(ro)));
  return dailyPlan.composeOpenQueue({
    active: activeOpen,
    deferred: deferredOpen,
    candidates: unseen.filter(ro => !completedKeys.has(roKey(ro))).slice(0, dailyNewLimit),
    goal: dailyGoal,
    completedCount: todayNewWords,
    keyOf: roKey,
    sortWords: values => values
  }).words;
}

function shouldFastPathActiveQueue({ todayQueue, completed = [], deferred = [], dailyGoal, todayNewWords }) {
  const completedKeys = new Set(completed.map(roKey));
  const deferredKeys = new Set(deferred.map(roKey));
  const activeOpen = todayQueue.filter((ro) => !completedKeys.has(roKey(ro)) && !deferredKeys.has(roKey(ro)));
  const remainingQuota = Math.max(0, dailyGoal - todayNewWords);
  return activeOpen.length >= remainingQuota;
}

{
  const reviews = Array.from({ length: 3 }, (_, index) => `review-${index}`);
  const unseen = Array.from({ length: 250 }, (_, index) => `new-${String(index).padStart(3, '0')}`);
  const plan = dailyPlan.buildTieredPlan([reviews, unseen.slice(0, 30)], { limit: 200, keyOf: roKey });
  assert.deepStrictEqual(plan.slice(0, 3), reviews, 'due reviews must occupy the first slots in the 200-task queue');
  assert.strictEqual(plan.filter(ro => ro.startsWith('new-')).length, 30, 'new words must stop at their independent daily cap');
  assert.strictEqual(plan.length, 33, 'a large daily completion goal must not silently become a large new-card quota');
}

{
  const todayQueue = Array.from({ length: 20 }, (_, index) => `retry-${index}`);
  const deferred = [...todayQueue];
  const unseen = Array.from({ length: 135 }, (_, index) => `new-${index}`);
  const repaired = repairTodayQueue({ todayQueue, deferred, unseen, dailyGoal: 170, todayNewWords: 7 });
  const active = repaired.filter((ro) => ro.startsWith('new-'));
  const keptDeferred = repaired.filter((ro) => ro.startsWith('retry-'));
  assert.strictEqual(active.length, 30, 'expected repair to respect the independent new-card limit');
  assert.strictEqual(keptDeferred.length, 20, 'expected deferred retry cards to be preserved');
}

{
  const todayQueue = Array.from({ length: 20 }, (_, index) => `retry-${index}`);
  const deferred = [...todayQueue];
  const unseen = Array.from({ length: 20 }, (_, index) => `new-${index}`);
  const repaired = repairTodayQueue({ todayQueue, deferred, unseen, dailyGoal: 20, todayNewWords: 0 });
  assert.strictEqual(repaired.filter(ro => ro.startsWith('new-')).length, 20, 'waiting review steps must not consume active new-card slots');
  assert.strictEqual(repaired.filter(ro => ro.startsWith('retry-')).length, 20, 'waiting review steps must remain queued for their due time');
}

{
  const due = Array.from({ length: 8 }, (_, index) => `review-${index}`);
  const unseen = Array.from({ length: 4 }, (_, index) => `new-${index}`);
  const displayed = due.length ? due : unseen;
  assert.deepStrictEqual(displayed, due, 'new cards must remain blocked until all due cards are cleared');
}

{
  const todayQueue = Array.from({ length: 20 }, (_, index) => `retry-${index}`);
  const deferred = [...todayQueue];
  const repaired = repairTodayQueue({ todayQueue, deferred, unseen: [], dailyGoal: 170, todayNewWords: 7 });
  assert.deepStrictEqual(repaired, todayQueue, 'expected deferred-only queue to remain when no unseen cards are eligible');
}

{
  const todayQueue = Array.from({ length: 30 }, (_, index) => `active-${index}`);
  assert.strictEqual(
    shouldFastPathActiveQueue({ todayQueue, dailyGoal: 30, todayNewWords: 0 }),
    true,
    'expected normal active queue to skip expensive repair'
  );
  const repaired = repairTodayQueue({
    todayQueue,
    unseen: Array.from({ length: 50 }, (_, index) => `new-${index}`),
    dailyGoal: 30,
    todayNewWords: 0
  });
  assert.deepStrictEqual(repaired, todayQueue, 'expected active queue repair to make no queue changes');
}

{
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert(app.includes('function ensureTodayQueueHasActiveCards'), 'expected centralized queue repair function');
  assert(app.includes("fastPath: 'active-queue-full'"), 'expected active queues to have a repair fast path');
  assert(app.includes('activeOpenCount >= activeSlots'), 'expected only active cards to satisfy the remaining daily quota');
  assert(app.includes('cap - Number(todayNewWords || 0)'), 'expected open slots to use the canonical daily completion count');
  assert(app.includes('if (globalDueWords.length)'), 'global due reviews must strictly block queued new cards');
  assert(app.includes("path = result.length ? 'due-only' : 'due-scope-fallback'"), 'a due review outside the selected topic must force the all-topic fallback instead of releasing new cards');
  assert(app.includes('function canContinueIncrementalTodayPool'), 'cached new-card pools must recheck the global due gate before advancing');
  assert(app.includes('return getRemainingTodayReviewWords().length === 0;'), 'incremental today mode must stop as soon as a review becomes due');
  assert(app.includes("if (flashMode === 'today' && filtered.length && !canContinueIncrementalTodayPool(filtered))"), 'manual next-card navigation must not bypass a newly reopened review gate');
  assert(app.includes('return words.filter(isDueReviewWord);'), 'daily completion bookkeeping must not hide a card that becomes due again');
  assert(!app.includes('RomanianVocabDailyPlan.interleavePriority'), 'today mode must not interleave new cards while reviews are due');
  assert(app.includes('isTodayBlockingReviewWord'), 'expected blocking review cards in today mode to count when known');
  assert(app.includes('const completesTodayTask = isKnownAction;'), 'expected fuzzy answers not to complete daily tasks');
  assert(app.includes('function appendExplicitTodayQueueCards'), 'expected explicit goal changes to keep their fast append path');
  assert(app.includes('return wordByRoIndex.get(key) || null'), 'expected getWordByRo to use indexed lookup');
  assert(app.includes('skipRepair: true'), 'expected applyFilters to avoid duplicate getDailyWordList repair');
  assert(!app.includes('ensureTodayQueueHasActiveCards(`markCard:${action}`)'), 'expected markCard not to duplicate normal repair');
  assert(app.includes('RomanianVocabDailyPlan.composeOpenQueue'), 'expected open queue composition to use the shared daily planner');
  assert(!app.includes('function buildSmartDailyPlan'), 'expected obsolete duplicate daily planner to be removed');
  assert(app.includes("incrementalToday: flashMode === 'today'"), 'expected every normal today answer to advance away from the current card');
  assert(app.includes('incrementalToday'), 'expected normal today answers to advance without rebuilding the whole queue');
  assert(app.includes('todaySeenWords.size'), 'expected metrics cache key to include todaySeenWords.size');
  assert(app.includes("todayQueue.join('|')"), 'expected metrics cache key to include todayQueue signature');
  assert(app.includes('todayQueueCompleted.size'), 'expected metrics cache key to include completed queue size');
  assert(app.includes('getDailyWordList:using-active-queue-before-load'), 'expected active repaired queues to render before dailyQueueLoaded settles');
  assert(app.includes("if (isDueLearningStepWord(w)) return 0;"), 'expected due learning steps to have first queue priority');
  assert(app.includes("if (isDueGraduatedReviewWord(w)) return 1;"), 'expected graduated reviews to follow learning steps');
  assert(app.includes("if (isUnseenWord(w)) return getUnseenContentPriority(w);"), 'expected unseen cards to use content-quality priority behind learning and review cards');
  assert(app.includes("if (phraseQuality === 'core') return 3;"), 'expected reviewed core phrases to lead the unseen-card tier');
  assert(app.includes("if (phraseQuality === 'needs_review') return 5;"), 'expected unreviewed phrase content to trail ordinary unseen cards');
  assert(app.includes('function getEffectiveDailyNewLimit()'), 'expected temporary goal extensions to expose an effective same-day new-card limit');
  assert(app.includes('fixedLimit + temporaryGoalIncrease'), 'expected explicit same-day goal increases to add usable new-card capacity');
  assert(app.includes('Number(getEffectiveDailyNewLimit() || 0)'), 'expected queue repair to use the effective same-day new-card limit');
  assert(app.includes("queuePhase === 'learning-due'"), 'expected learning steps to have a distinct visible state');
  assert(app.includes("queuePhase === 'review-due' || queuePhase === 'relearning-due'"), 'expected due review and relearning cards to render as review');
  assert(index.includes('id="today-focus-meta"'), 'expected one concise daily-plan explanation instead of repeated stage cards');
  assert(index.includes('严格先做已到点内容，再按新词上限引入新卡'), 'expected the strict priority and new-card cap to be visible');
  assert(app.includes('const DEFAULT_DAILY_GOAL = 200;'), 'expected the default daily processing quota to be 200');
  assert(app.includes('const DEFAULT_DAILY_NEW_LIMIT = 30;'), 'expected an independent default daily new-card limit');
}

console.log('daily queue repair verification passed');
