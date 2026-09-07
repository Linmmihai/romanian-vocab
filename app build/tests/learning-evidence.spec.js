const { test, expect } = require('@playwright/test');

async function loadEvidence(page) {
  await page.goto('/');
  expect(await page.evaluate(() => typeof window.RomanianVocabLearningEvidence?.buildEvidence)).toBe('function');
}

async function enterOfflineApp(page) {
  await loadEvidence(page);
  await page.getByRole('button', { name: '离线使用本机词库' }).click();
  await expect(page.locator('#app-screen')).toBeVisible();
  await expect(page.locator('#flash-content')).toBeVisible({ timeout: 15_000 });
}

test('choice, listening, and grammar evidence cannot mutate active-recall progress', async ({ page }) => {
  await loadEvidence(page);
  const result = await page.evaluate(() => {
    const prev = {
      known: true,
      qr: 8,
      qt: 10,
      level: 'mastered',
      cardState: 'review',
      dueAt: '2026-09-01T00:00:00.000Z',
      nextReviewAt: '2026-09-01T00:00:00.000Z',
      lastReviewedAt: '2026-08-20T00:00:00.000Z',
      intervalDays: 15,
      memoryStrength: 88,
      reps: 10,
      correctCount: 8,
      fuzzyCount: 1,
      forgetCount: 2,
      lapses: 1,
      recentResults: ['known', 'unknown'],
      needsReinforcement: true,
      wrongCount: 3,
      errorStreak: 2,
      correctStreakSinceWrong: 0,
      lastWrongAt: '2026-09-01T00:00:00.000Z',
      weakClearedAt: null,
      wasMasteredAt: '2026-07-01T00:00:00.000Z',
      grammarQr: 4,
      grammarQt: 5
    };
    const protectedKeys = [
      'known', 'qr', 'qt', 'level', 'cardState', 'dueAt', 'nextReviewAt', 'lastReviewedAt',
      'intervalDays', 'memoryStrength', 'reps', 'correctCount', 'fuzzyCount', 'forgetCount',
      'lapses', 'recentResults', 'needsReinforcement', 'wrongCount', 'errorStreak',
      'correctStreakSinceWrong', 'lastWrongAt', 'weakClearedAt', 'wasMasteredAt'
    ];
    const pick = progress => Object.fromEntries(protectedKeys.map(key => [key, progress[key]]));
    const translation = buildProgressUpdate(prev, true, 9, 11, true, {
      interactionType: 'quiz_correct', exerciseType: 'translation', promptMode: 'zh-to-ro-choice', exact: true
    }).progress;
    const listening = buildProgressUpdate(prev, false, 8, 11, false, {
      interactionType: 'quiz_wrong', exerciseType: 'listening', promptMode: 'audio-to-meaning-choice', exact: false
    }).progress;
    const grammar = buildProgressUpdate(prev, true, 9, 11, true, {
      interactionType: 'quiz_correct', exerciseType: 'verbConj', promptMode: 'verbConj-choice', exact: true
    }).progress;
    const dictation = buildProgressUpdate(prev, true, 9, 11, true, {
      interactionType: 'quiz_correct', exerciseType: 'dictation', promptMode: 'audio-to-text',
      exact: false, spellingExact: false, listeningCorrect: true
    }).progress;
    return {
      before: pick(prev),
      translation: pick(translation),
      listening: pick(listening),
      grammar: pick(grammar),
      dictation: pick(dictation),
      grammarCounts: [grammar.grammarQr, grammar.grammarQt],
      translationGrammar: [translation.grammarQr, translation.grammarQt],
      dictationGrammar: [dictation.grammarQr, dictation.grammarQt],
      dictationEvent: dictation.learningEvidence.events.at(-1)
    };
  });
  expect(result.translation).toEqual(result.before);
  expect(result.listening).toEqual(result.before);
  expect(result.grammar).toEqual(result.before);
  expect(result.dictation).toEqual(result.before);
  expect(result.grammarCounts).toEqual([5, 6]);
  expect(result.translationGrammar).toEqual([4, 5]);
  expect(result.dictationGrammar).toEqual([4, 5]);
  expect(result.dictationEvent).toMatchObject({
    exerciseType: 'dictation', promptMode: 'audio-to-text', exact: false,
    spellingExact: false, listeningCorrect: true
  });
});

test('active recall still uses the established scheduler interval sequence', async ({ page }) => {
  await loadEvidence(page);
  const result = await page.evaluate(() => buildProgressUpdate({
    known: true,
    qr: 2,
    qt: 3,
    level: 'learning',
    cardState: 'review',
    dueAt: '2026-09-01T00:00:00.000Z',
    intervalDays: 3,
    memoryStrength: 70,
    reps: 3,
    recentResults: ['known']
  }, true, 3, 4, true, {
    interactionType: 'review_correct',
    promptMode: 'card',
    at: '2026-09-07T00:00:00.000Z',
    date: '2026-09-07'
  }).progress);
  expect(result.qt).toBe(4);
  expect(result.qr).toBe(3);
  expect(result.intervalDays).toBe(7);
  expect(result.learningEvidence.events[0]).toMatchObject({
    interaction: 'review_correct', promptMode: 'card', dueReview: true, firstAttempt: true
  });
});

test('dictation handler persists listening and spelling as separate evidence', async ({ page }) => {
  await enterOfflineApp(page);
  const result = await page.evaluate(async () => {
    const word = W.find(candidate => /[ăâîșț]/i.test(candidate.ro));
    if (!word) throw new Error('fixture needs a Romanian word with diacritics');
    setProgress(word.ro, {
      known: true,
      qr: 5,
      qt: 6,
      level: 'mastered',
      cardState: 'review',
      dueAt: '2026-09-20T00:00:00.000Z',
      nextReviewAt: '2026-09-20T00:00:00.000Z',
      lastReviewedAt: '2026-09-01T00:00:00.000Z',
      intervalDays: 15,
      memoryStrength: 90,
      wrongCount: 2,
      errorStreak: 1,
      correctStreakSinceWrong: 0,
      weakClearedAt: null,
      wasMasteredAt: '2026-08-01T00:00:00.000Z',
      grammarQr: 3,
      grammarQt: 4
    }, { source: 'learning-evidence-test', replace: true });
    const protectedKeys = [
      'known', 'qr', 'qt', 'level', 'cardState', 'dueAt', 'nextReviewAt', 'lastReviewedAt',
      'intervalDays', 'memoryStrength', 'wrongCount', 'errorStreak', 'correctStreakSinceWrong',
      'weakClearedAt', 'wasMasteredAt', 'grammarQr', 'grammarQt'
    ];
    const pick = progress => Object.fromEntries(protectedKeys.map(key => [key, progress[key]]));
    const before = pick(getProgress(word.ro));
    qList = [word];
    qIdx = 0;
    qExerciseMode = 'dictation';
    qRoundResults = [];
    qAnswerLocked = false;
    renderQuiz();
    const input = document.getElementById('quiz-dictation-input');
    input.disabled = false;
    input.value = window.RomanianVocabQuizEngine.stripRomanianDiacritics(word.ro);
    qItemStartedAt = Date.now() - 50;
    await answerDictation({ preventDefault() {} });
    const afterProgress = getProgress(word.ro);
    const evidenceRecords = Object.values(apiReadLearningEvidence(currentUser.id));
    const durableEvent = evidenceRecords
      .flatMap(record => record.evidence?.events || [])
      .find(event => event.wordRo === word.ro && event.exerciseType === 'dictation');
    return {
      before,
      after: pick(afterProgress),
      progressEvent: afterProgress.learningEvidence.events.at(-1),
      durableEvent
    };
  });
  expect(result.after).toEqual(result.before);
  expect(result.progressEvent).toMatchObject({
    exerciseType: 'dictation', promptMode: 'audio-to-text',
    correct: true, exact: false, listeningCorrect: true, spellingExact: false
  });
  expect(result.durableEvent).toMatchObject({ id: result.progressEvent.id });
  expect(result.progressEvent.responseMs).toBeGreaterThanOrEqual(0);
});
