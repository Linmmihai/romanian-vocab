const { test, expect } = require('@playwright/test');

async function startOffline(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '离线使用本机词库' }).click();
  await page.waitForFunction(() => progressLoaded && !!getCurrentFlashWord());
}

test('first cross-day recall survives reload, counts a fuzzy first attempt once and supports undo', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-18T12:00:00Z'));
  await startOffline(page);
  const word = await page.evaluate(() => getCurrentFlashWord().ro);
  await page.locator('#main-card').click();
  await page.locator('#mark-known-btn').click();
  await page.evaluate(async () => { await lastCardAnswerSnapshot.recallChange; flushPendingFastCardState(); });
  await page.clock.setFixedTime(new Date('2026-11-28T12:00:00Z'));
  await page.reload();
  await page.waitForFunction(ro => progressLoaded && getCurrentFlashWord()?.ro === ro, word);
  await page.locator('#main-card').click();
  await page.locator('#mark-fuzzy-btn').click();
  await page.locator('.nav-tab[data-page="stats"]').click();
  await expect(page.locator('#stat-first-cross-day')).toContainText('首次复习准确回忆 0 个（0%）');
  await page.locator('.nav-tab[data-page="flash"]').click();
  await page.evaluate(() => undoLastCardAnswer());
  await page.locator('.nav-tab[data-page="stats"]').click();
  await expect(page.locator('#stat-first-cross-day')).toContainText('尚无样本');
  await page.locator('.nav-tab[data-page="flash"]').click();
  await page.locator('#main-card').click();
  await page.locator('#mark-known-btn').click();
  await page.locator('.nav-tab[data-page="stats"]').click();
  await expect(page.locator('#stat-first-cross-day')).toContainText('首次复习准确回忆 1 个（100%）');
  await page.reload();
  await page.waitForFunction(() => progressLoaded);
  await page.locator('.nav-tab[data-page="stats"]').click();
  await expect(page.locator('#stat-first-cross-day')).toContainText('已跨天复习 1 个词');
});

test('core review list uses class practice and an explicit editorial decision updates eligibility', async ({ page }) => {
  await startOffline(page);
  const result = await page.evaluate(async () => {
    const sample = W.find(word => word.learning_track === 'news_core' && !isAssessmentEligible(word)
      && validateEditUpdates(word, word.id).length === 0);
    const div = document.createElement('div');
    div.innerHTML = renderCoreReviewPriority([{ word_id: sample.id, quiz_total: 17 }], true);
    const first = div.querySelector('.admin-word-row').innerText || div.querySelector('.admin-word-row').textContent;
    let updates;
    apiUpdateWord = async (_, fields) => { updates = fields; };
    loadAdminStats = () => {};
    openEditById(sample.id);
    await saveEdit();
    const preserved = !Object.hasOwn(updates, 'naturalness_status');
    openEditById(sample.id);
    document.getElementById('em-naturalness').value = 'verified';
    await saveEdit();
    return { first, preserved, ro: sample.ro, eligible: isAssessmentEligible(getWordByRo(sample.ro)) };
  });
  expect(result.first).toContain(result.ro);
  expect(result.first).toContain('累计作答 17 次');
  expect(result.preserved).toBe(true);
  expect(result.eligible).toBe(true);
});

test('a saved 20-word goal survives login on a new device', async ({ page }) => {
  await startOffline(page);
  await page.evaluate(() => setDailyGoalAndRebuild(20));
  await page.reload();
  await expect(page.locator('#review-new-count')).toHaveText('0/20');
  expect(await page.evaluate(() => defaultDailyGoal)).toBe(20);
});

test('recall backup imports are scoped, repeatable and keep the earliest observed review', async ({ page }) => {
  await startOffline(page);
  const result = await page.evaluate(async () => {
    const user = currentUser.id;
    const wordKey = String(getCurrentFlashWord().id);
    const first = { wordKey, firstDay: '2026-10-01', reviewDay: '2026-10-07', correct: false };
    const later = { ...first, reviewDay: '2026-10-08', correct: true };
    await restoreRecallRecords(user, [later, first, later, first]);
    const records = await readRecallRecords(user);
    return [records.length, records[0].reviewDay, records[0].correct, (await readRecallRecords('another-user')).length];
  });
  expect(result).toEqual([1, '2026-10-07', false, 0]);
});
