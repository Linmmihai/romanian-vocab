const { test, expect } = require('@playwright/test');

async function enterApp(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '离线使用本机词库' }).click();
  await expect(page.locator('#flash-content')).toBeVisible();
}

async function startQuiz(page, mode = 'translation') {
  await enterApp(page);
  await page.locator('.nav-tab[data-page="quiz"]').click();
  await page.evaluate(mode => setExerciseMode(mode), mode);
  await page.locator('#quiz-area .btn-primary').click();
}

async function mockSpeech(page) {
  await page.evaluate(() => {
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    speechSynthesis.cancel = () => {};
    speechSynthesis.getVoices = () => [{ lang: 'ro-RO' }];
    speechSynthesis.speak = utterance => utterance.onstart?.();
  });
}

test('navigation preserves quiz choices, feedback, score and the current question', async ({ page }) => {
  await startQuiz(page);
  const options = await page.locator('#quiz-area .opt').allTextContents();
  await page.locator('#quiz-area .opt').first().click();
  await expect(page.locator('#qnxt')).toBeVisible();
  const before = await page.evaluate(() => ({ results: qRoundResults, word: getCurrentQuizWord().ro, feedback: document.getElementById('qfb').innerHTML }));
  await page.locator('.nav-tab[data-page="list"]').click();
  await page.locator('.nav-tab[data-page="quiz"]').click();
  await expect(page.locator('#qnxt')).toBeVisible();
  expect(await page.locator('#quiz-area .opt').allTextContents()).toEqual(options);
  expect(await page.evaluate(() => ({ results: qRoundResults, word: getCurrentQuizWord().ro, feedback: document.getElementById('qfb').innerHTML }))).toEqual(before);
  await page.locator('#qnxt').click();
  expect(await page.evaluate(() => qIdx)).toBe(1);
});

test('navigation preserves dictation draft and its two-play limit', async ({ page }) => {
  await startQuiz(page, 'dictation');
  await mockSpeech(page);
  await page.locator('#quiz-play-btn').click();
  await page.locator('#quiz-play-btn').click();
  await page.locator('#quiz-dictation-input').fill('draft answer');
  await page.locator('.nav-tab[data-page="grammar"]').click();
  await page.locator('.nav-tab[data-page="quiz"]').click();
  await expect(page.locator('#quiz-dictation-input')).toHaveValue('draft answer');
  await expect(page.locator('#quiz-play-btn')).toBeDisabled();
  await expect(page.locator('#quiz-audio-meta')).toHaveText('设备合成音 · 2/2 次');
});

test('changing quiz settings cancels pending audio and aligns every selected control', async ({ page }) => {
  await startQuiz(page, 'listening');
  await page.evaluate(() => {
    Object.assign(getCurrentQuizWord(), { audio_url: 'https://audio.example/word.ogg', audio_kind: 'human', audio_source: 'Test recording', audio_license: 'CC0' });
    window.Audio = class {
      play() { return new Promise((resolve, reject) => { window.rejectAudio = reject; }); }
      pause() {}
      removeAttribute() {}
    };
    window.SpeechSynthesisUtterance = class {};
    speechSynthesis.cancel = () => {};
    speechSynthesis.getVoices = () => [{ lang: 'ro-RO' }];
    speechSynthesis.speak = () => { window.unwantedSpeech = true; };
  });
  await page.locator('#quiz-play-btn').click();
  await page.evaluate(async () => {
    setExerciseMode('translation');
    window.rejectAudio(new Error('cancelled'));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(await page.evaluate(() => !!window.unwantedSpeech)).toBe(false);
  await page.locator('#quiz-area .btn-primary').click();
  expect(await page.evaluate(() => qCurrentAudioPlays)).toBe(0);
  await expect(page.locator('#quiz-area .opt:enabled')).toHaveCount(4);
});

test('selecting all quiz questions immediately shows the size warning and accessible selection', async ({ page }) => {
  await enterApp(page);
  await page.locator('.nav-tab[data-page="quiz"]').click();
  await page.locator('.qsize-btn[data-n="0"]').click();
  await expect(page.locator('.quiz-all-warning')).toBeVisible();
  await expect(page.locator('.qsize-btn[data-n="0"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.qsize-btn[data-n="20"]')).toHaveAttribute('aria-pressed', 'false');
});

test('an old answer save cannot unlock the next button in a new quiz', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await startQuiz(page);
  await page.evaluate(() => {
    recordInteraction = () => new Promise(resolve => { window.finishOldSave = resolve; });
  });
  await page.locator('#quiz-area .opt').first().click();
  await page.evaluate(() => {
    setExerciseMode('nounPlural');
    startQuiz();
    window.finishOldSave({});
  });
  await expect(page.locator('#qnxt')).toBeHidden();
  expect(await page.evaluate(() => qRoundResults.length)).toBe(0);
  expect(errors).toEqual([]);
});

test('waiting cards show a useful message and return automatically when the step is due', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T12:00:00+08:00') });
  await enterApp(page);
  await page.evaluate(async () => {
    writeDailyNewLimit(1);
    await setDailyGoalAndRebuild(1);
  });
  const wordRo = await page.evaluate(() => getCurrentFlashWord().ro);
  await page.locator('#main-card').click();
  await page.locator('#mark-unknown-btn').click();
  await expect(page.locator('#fc-zh')).toContainText('等待');
  await expect(page.locator('#fc-front-hint')).toContainText('等待');
  await expect(page.locator('#main-card')).toHaveAttribute('aria-disabled', 'true');
  await page.locator('#main-card').click({ force: true });
  await expect(page.locator('#main-card')).not.toHaveClass(/flipped/);
  const remaining = await page.evaluate(wordRo => new Date(getProgress(wordRo).nextReviewAt).getTime() - Date.now(), wordRo);
  expect(remaining).toBeGreaterThan(0);
  await page.clock.fastForward(remaining + 50);
  await expect(page.locator('#fc-zh')).not.toContainText('等待');
  expect(await page.evaluate(() => getCurrentFlashWord()?.ro)).toBe(wordRo);
  await expect(page.locator('#main-card')).toHaveAttribute('aria-disabled', 'false');
  await expect(page.locator('#review-new-count')).toHaveText('0/1');
  await expect(page.locator('#review-new-remaining')).toHaveText('1/1');
});

for (const mode of ['diagnostic', 'translation', 'listening', 'dictation', 'nounPlural', 'verbConj', 'stress']) {
  test(`${mode} retains scoring and its correct learning-progress boundary`, async ({ page }) => {
    await startQuiz(page, mode);
    await mockSpeech(page);
    const before = await page.evaluate(() => {
      const word = getCurrentQuizWord();
      const progress = getProgress(word.ro) || {};
      return { ro: word.ro, qt: progress.qt || 0, qr: progress.qr || 0, grammarQt: progress.grammarQt || 0 };
    });
    if (await page.locator('#quiz-play-btn').count()) await page.locator('#quiz-play-btn').click();
    if (mode === 'dictation') {
      await page.locator('#quiz-dictation-input').fill(before.ro);
      await page.locator('#quiz-dictation-submit').click();
    } else {
      await page.evaluate(() => {
        const answer = getCurrentQuizWord();
        const exercise = qList[qIdx];
        const button = [...document.querySelectorAll('#quiz-area .opt')].find(option =>
          option.dataset.quizAction === 'answer'
            ? roKey(option.dataset.optionRo) === roKey(answer.ro)
            : option.dataset.option === exercise.answer
        );
        button.click();
        button.click();
      });
    }
    await expect(page.locator('#qnxt')).toBeVisible();
    const after = await page.evaluate(ro => ({
      summary: summarizeQuizResults(qRoundResults),
      exerciseType: qRoundResults[0].type,
      progress: getProgress(ro),
      completed: todayQueueCompleted.size
    }), before.ro);
    expect(after.summary.total).toBe(1);
    expect(after.summary.percent).toBe(100);
    expect(after.completed).toBe(0);
    expect(after.progress.seenViaCard).toBe(false);
    const grammar = ['nounPlural', 'verbConj', 'stress'].includes(mode);
    expect(after.progress.qt).toBe(before.qt);
    expect(after.progress.qr).toBe(before.qr);
    expect(after.progress.grammarQt).toBe(before.grammarQt + (grammar ? 1 : 0));
    const events = after.progress.learningEvidence.events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ exerciseType: after.exerciseType, correct: true });
    if (mode === 'dictation') expect(events[0]).toMatchObject({ listeningCorrect: true, spellingExact: true });
    await page.getByRole('button', { name: '结束本轮' }).click();
    await expect(page.locator('.result-score')).toHaveText('100%');
    await page.locator('.nav-tab[data-page="flash"]').click();
    await page.locator('.nav-tab[data-page="quiz"]').click();
    await expect(page.locator('.result-score')).toHaveText('100%');
  });
}

test('selecting the active quiz mode does not discard an unfinished question', async ({ page }) => {
  await startQuiz(page, 'dictation');
  await mockSpeech(page);
  await page.locator('#quiz-play-btn').click();
  await page.locator('#quiz-dictation-input').fill('keep this draft');
  await page.locator('.quiz-advanced summary').click();
  await page.locator('.exercise-btn[data-exercise="dictation"]').click();
  await expect(page.locator('#quiz-dictation-input')).toHaveValue('keep this draft');
  await expect(page.locator('#quiz-audio-meta')).toHaveText('设备合成音 · 1/2 次');
});

test('a due timer refreshes counters without replacing an unanswered flashcard', async ({ page }) => {
  await page.clock.install();
  await enterApp(page);
  const original = await page.evaluate(() => {
    const current = getCurrentFlashWord();
    const other = getLearningCollectionWords(W).find(word => word.ro !== current.ro);
    const dueAt = new Date(Date.now() + 60_000).toISOString();
    setProgress(other.ro, { seen: true, known: true, qt: 3, qr: 3, cardState: 'review', reviewStage: 2, reps: 3, dueAt, nextReviewAt: dueAt }, { replace: true });
    renderReviewPanel();
    return current.ro;
  });
  await page.clock.fastForward(60_050);
  expect(await page.evaluate(() => getCurrentFlashWord()?.ro)).toBe(original);
  await expect(page.locator('#review-due-count')).toHaveText('1');
});


test('noun exercises accept structured and legacy forms while excluding unsupported plurals', async ({ page }) => {
  await enterApp(page);
  const answers = await page.evaluate(() => [
    { ro: 'casă', part_of_speech: 'noun', grammar_data: { gender: 'feminine', plural: 'case' } },
    { ro: 'masă', part_of_speech: 'noun', hint: 's.f.: mese' },
    { ro: 'lapte', part_of_speech: 'noun', hint: 's.n.: (fără plural)' },
    { ro: 'ochelari', part_of_speech: 'noun', hint: 's.m.pl.: ochelari' },
    { ro: 'test', part_of_speech: 'noun', hint: '复数待核对' }
  ].map(parseNounPlural));
  expect(answers).toEqual(['case', 'mese', null, null, null]);
});

test('first-day plan can be checked in after every available word is recalled', async ({ page }) => {
  await enterApp(page);
  await expect(page.locator('#review-new-count')).toHaveText('0/30');
  for (let index = 0; index < 30; index++) {
    await page.locator('#main-card').click();
    await page.locator('#mark-known-btn').click();
  }
  await expect(page.locator('#daily-checkin-modal')).toBeVisible();
  await expect(page.locator('#checkin-fixed-goal')).toHaveText('30');
  await expect(page.locator('#checkin-finish-reviews-btn')).toBeHidden();
  await page.getByRole('button', { name: '今天到这里' }).click();
  await expect(page.locator('#review-new-count')).toHaveText('30/30');
  await page.reload();
  await expect(page.locator('#review-new-count')).toHaveText('30/30');
  await expect(page.locator('#goal-input')).toHaveValue('200');
  expect(await page.evaluate(() => isDailyCheckinDone())).toBe(true);
});

test('an empty plan cannot be checked in without completing a task', async ({ page }) => {
  await enterApp(page);
  await page.evaluate(async () => {
    writeDailyNewLimit(0);
    await setDailyGoalAndRebuild(200);
  });
  await expect(page.locator('#review-new-count')).toHaveText('0/0');
  expect(await page.evaluate(() => completeDailyCheckin())).toBe(false);
});
