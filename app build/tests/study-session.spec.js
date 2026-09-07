const { test, expect } = require('@playwright/test');

async function enterOfflineApp(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '离线使用本机词库' }).click();
  await expect(page.locator('#app-screen')).toBeVisible();
  await expect(page.locator('#flash-content')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#fc-zh')).not.toHaveText('');
  await expect(page.locator('#study-session-panel')).toBeVisible();
}

async function startTimedSession(page, minutes = 5) {
  await page.locator('[data-session-mode="time"]').click();
  await page.locator('#study-session-minutes').selectOption(String(minutes));
  await page.locator('[data-session-action="start"]').click();
  await expect.poll(() => page.evaluate(() => RomanianVocabStudySessionUI.getState()?.status)).toBe('active');
}

async function answerKnown(page) {
  await page.locator('#main-card').click();
  await expect(page.locator('#mark-known-btn')).toBeVisible();
  await page.locator('#mark-known-btn').click();
}

async function studyStorage(page) {
  return page.evaluate(() => {
    const keys = [...Array(localStorage.length)].map((_, index) => localStorage.key(index)).filter(Boolean);
    const stateKey = keys.find(key => key.startsWith('rv_study_session:v1:local-offline-user:'));
    const sampleKey = keys.find(key => key === 'rv_study_session_samples:v1:local-offline-user');
    return {
      stateKey,
      state: stateKey ? JSON.parse(localStorage.getItem(stateKey)) : null,
      sampleKey,
      samples: sampleKey ? JSON.parse(localStorage.getItem(sampleKey)) : []
    };
  });
}

test('quantity mode remains the default and does not block an answer', async ({ page }) => {
  await enterOfflineApp(page);

  expect(await page.evaluate(() => RomanianVocabStudySessionUI.getState().mode)).toBe('count');
  await answerKnown(page);

  await expect(page.locator('#review-new-count')).toHaveText('1/200');
  const evidence = await page.evaluate(() => {
    const session = RomanianVocabStudySessionUI.getState();
    return {
      mode: session.mode,
      completedCount: session.completedCount,
      answerCount: session.answers.length,
      sessionCounted: session.answers.at(-1)?.sessionCounted
    };
  });
  expect(evidence).toEqual({ mode: 'count', completedCount: 0, answerCount: 1, sessionCounted: false });
});

test('a timed session counts an answer without changing the daily goal or new-word cap', async ({ page }) => {
  await enterOfflineApp(page);
  const before = await page.evaluate(() => ({
    dailyGoal,
    defaultDailyGoal,
    dailyNewLimit,
    goalInput: Number(document.getElementById('goal-input').value),
    capInput: Number(document.getElementById('new-limit-input').value)
  }));
  expect(before).toEqual({ dailyGoal: 200, defaultDailyGoal: 200, dailyNewLimit: 30, goalInput: 200, capInput: 30 });

  await startTimedSession(page, 5);
  await answerKnown(page);
  await expect.poll(() => page.evaluate(() => RomanianVocabStudySessionUI.getState().completedCount)).toBe(1);

  const after = await page.evaluate(() => ({
    dailyGoal,
    defaultDailyGoal,
    dailyNewLimit,
    goalInput: Number(document.getElementById('goal-input').value),
    capInput: Number(document.getElementById('new-limit-input').value)
  }));
  expect(after).toEqual(before);
});

test('ending a timed session blocks another answer and never checks in automatically', async ({ page }) => {
  await enterOfflineApp(page);
  await startTimedSession(page, 5);
  await page.locator('[data-session-action="end"]').click();
  await expect.poll(() => page.evaluate(() => RomanianVocabStudySessionUI.getState().status)).toBe('ended');

  const before = await page.evaluate(() => {
    const word = getCurrentFlashWord();
    return {
      ro: word.ro,
      progress: JSON.stringify(getProgress(word.ro) || null),
      todayNewWords,
      checkedIn: isDailyCheckinDone()
    };
  });
  await answerKnown(page);

  const after = await page.evaluate((ro) => ({
    progress: JSON.stringify(getProgress(ro) || null),
    todayNewWords,
    checkedIn: isDailyCheckinDone(),
    completedCount: RomanianVocabStudySessionUI.getState().completedCount,
    message: document.getElementById('study-session-panel').dataset.message || ''
  }), before.ro);
  expect(after.progress).toBe(before.progress);
  expect(after.todayNewWords).toBe(before.todayNewWords);
  expect(after.checkedIn).toBe(false);
  expect(after.completedCount).toBe(0);
  expect(after.message).toContain('请先开始');
});

test('an expired test budget saves the current answer and blocks the next one', async ({ page }) => {
  await enterOfflineApp(page);
  await startTimedSession(page, 5);

  // Test fixture: replace the five-minute budget with one millisecond. The
  // production choices and session algorithm remain unchanged. Apply on the
  // next document, after the old page has saved its state on pagehide.
  await page.addInitScript(() => {
    const key = [...Array(localStorage.length)]
      .map((_, index) => localStorage.key(index))
      .find(item => item?.startsWith('rv_study_session:v1:local-offline-user:'));
    if (!key) throw new Error('study-session state fixture key not found');
    const value = JSON.parse(localStorage.getItem(key));
    value.budgetMs = 1;
    value.plannedCount = 1;
    value.activeElapsedMs = 0;
    value.activeStartedAt = null;
    value.attempt = null;
    value.status = 'active';
    localStorage.setItem(key, JSON.stringify(value));
  });
  await page.reload();
  await expect(page.locator('#flash-content')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#fc-zh')).not.toHaveText('');
  await page.waitForTimeout(25);

  await answerKnown(page);
  await expect.poll(() => page.evaluate(() => RomanianVocabStudySessionUI.getState().status)).toBe('paused');
  await expect(page.locator('#review-new-count')).toHaveText('1/200');
  const saved = await page.evaluate(() => ({
    completedCount: RomanianVocabStudySessionUI.getState().completedCount,
    answers: RomanianVocabStudySessionUI.getState().answers.length,
    progressCount: Object.keys(JSON.parse(localStorage.getItem('progress:local-offline-user') || '{}')).length
  }));
  expect(saved.completedCount).toBe(1);
  expect(saved.answers).toBe(1);
  expect(saved.progressCount).toBeGreaterThan(0);

  const blockedBefore = await page.evaluate(() => {
    const word = getCurrentFlashWord();
    return { ro: word.ro, progress: JSON.stringify(getProgress(word.ro) || null) };
  });
  await answerKnown(page);
  const blockedAfter = await page.evaluate((ro) => ({
    progress: JSON.stringify(getProgress(ro) || null),
    completedCount: RomanianVocabStudySessionUI.getState().completedCount,
    answers: RomanianVocabStudySessionUI.getState().answers.length
  }), blockedBefore.ro);
  expect(blockedAfter).toEqual({ progress: blockedBefore.progress, completedCount: 1, answers: 1 });

  await page.locator('[data-session-action="continue"]').click();
  await expect.poll(() => page.evaluate(() => RomanianVocabStudySessionUI.getState().status)).toBe('active');
  await page.locator('#mark-known-btn').click();
  await expect.poll(() => page.evaluate(() => RomanianVocabStudySessionUI.getState().completedCount)).toBe(2);
  await expect(page.locator('#review-new-count')).toHaveText('2/200');
});

test('undo removes its session sample and refreshed session progress is retained', async ({ page }) => {
  await enterOfflineApp(page);
  await startTimedSession(page, 5);
  const answeredRo = await page.evaluate(() => getCurrentFlashWord().ro);

  // The production sampler accepts effective answers from one second onward.
  await page.waitForTimeout(1100);
  await answerKnown(page);
  await expect.poll(() => page.evaluate(() => RomanianVocabStudySessionUI.getState().completedCount)).toBe(1);
  const afterAnswer = await studyStorage(page);
  expect(afterAnswer.samples).toHaveLength(1);
  const removedSampleId = afterAnswer.samples[0].id;

  await page.locator('#undo-last-answer-btn').click();
  await expect.poll(() => page.evaluate(() => RomanianVocabStudySessionUI.getState().completedCount)).toBe(0);
  const afterUndo = await studyStorage(page);
  expect(afterUndo.samples.map(sample => sample.id)).not.toContain(removedSampleId);
  expect(await page.evaluate((ro) => JSON.stringify(getProgress(ro) || null), answeredRo)).toBe('null');

  // Record a new answer so refresh recovery proves a non-zero current result.
  await answerKnown(page);
  await expect.poll(() => page.evaluate(() => RomanianVocabStudySessionUI.getState().completedCount)).toBe(1);
  await page.reload();
  await expect(page.locator('#flash-content')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => RomanianVocabStudySessionUI.getState().completedCount)).toBe(1);
  const recovered = await studyStorage(page);
  expect(recovered.samples.map(sample => sample.id)).not.toContain(removedSampleId);
  await expect(page.locator('#review-new-count')).toHaveText('1/200');
});
