const { test, expect } = require('@playwright/test');

async function enterOfflineApp(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '离线使用本机词库' }).click();
  await expect(page.locator('#app-screen')).toBeVisible();
  await expect(page.locator('#flash-content')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#fc-zh')).not.toHaveText('');
}

test('markCard persists progress before exposing the answer in the UI', async ({ page }) => {
  await enterOfflineApp(page);
  const result = await page.evaluate(() => {
    markCard('known');
    const raw = localStorage.getItem('progress:local-offline-user');
    const pending = readPendingProgress('local-offline-user');
    return { progressKeys: raw ? Object.keys(JSON.parse(raw)).length : 0, pending };
  });
  expect(result.progressKeys).toBeGreaterThan(0);
  expect(Object.keys(result.pending)).toHaveLength(1);
  await expect(page.locator('#review-new-count')).toHaveText('1/30');
});

test('a failed study commit leaves the card unchanged and retry creates one event', async ({ page }) => {
  await enterOfflineApp(page);
  const result = await page.evaluate(() => {
    const word = getCurrentFlashWord();
    const before = { progress: getProgress(word.ro), newCount: todayNewWords, introduced: [...todayIntroducedWords] };
    const originalSetItem = Storage.prototype.setItem;
    try {
      Storage.prototype.setItem = function(key, value) {
        if (String(key).startsWith('study_commit:')) throw new Error('simulated durable commit failure');
        return originalSetItem.call(this, key, value);
      };
      markCard('known');
    } finally {
      Storage.prototype.setItem = originalSetItem;
    }
    const afterFailure = { progress: getProgress(word.ro), newCount: todayNewWords, introduced: [...todayIntroducedWords] };
    markCard('known');
    const pending = readPendingProgress('local-offline-user');
    const events = Object.values(pending).flatMap(item => item.pendingEvents || []);
    return { before, afterFailure, eventIds: events.map(event => event.eventId) };
  });
  expect(result.afterFailure).toEqual(result.before);
  expect(result.eventIds).toHaveLength(1);
  expect(new Set(result.eventIds).size).toBe(1);
});

test('receipt survives materialization failure and recovery is idempotent after reload', async ({ page }) => {
  await enterOfflineApp(page);
  const first = await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    try {
      Storage.prototype.setItem = function(key, value) {
        if (String(key).startsWith('progress_pending_event:')) throw new Error('simulated materialization failure');
        return originalSetItem.call(this, key, value);
      };
      markCard('known');
    } finally {
      Storage.prototype.setItem = originalSetItem;
    }
    const receiptCount = [...Array(localStorage.length)].map((_, i) => localStorage.key(i)).filter(key => key?.startsWith('study_commit:')).length;
    const pendingBefore = readPendingProgress('local-offline-user');
    return { pendingBefore, receiptCount, newCount: todayNewWords };
  });
  expect(first.receiptCount).toBe(1);
  expect(first.newCount).toBe(1);
  expect(Object.keys(first.pendingBefore)).toHaveLength(1);
  await page.evaluate(() => recoverStudyCommits());
  const second = await page.evaluate(() => {
    const pending = readPendingProgress('local-offline-user');
    const events = Object.values(pending).flatMap(item => item.pendingEvents || []);
    recoverStudyCommits();
    const afterRepeat = readPendingProgress('local-offline-user');
    const receiptCount = [...Array(localStorage.length)].map((_, i) => localStorage.key(i)).filter(key => key?.startsWith('study_commit:')).length;
    return { events: events.map(event => event.eventId), afterRepeat: Object.values(afterRepeat).flatMap(item => item.pendingEvents || []).map(event => event.eventId), newCount: todayNewWords, receiptCount };
  });
  expect(second.events).toHaveLength(1);
  expect(second.afterRepeat).toEqual(second.events);
  expect(second.newCount).toBe(first.newCount);
  expect(second.receiptCount).toBe(0);
  await page.reload();
  await expect(page.locator('#review-new-count')).toHaveText('1/30');
});


test('a render failure after durable commit cannot submit the answer twice', async ({ page }) => {
  await enterOfflineApp(page);
  const result = await page.evaluate(() => {
    const originalRender = renderNextFlashCardInstantFront;
    renderNextFlashCardInstantFront = () => { throw new Error('simulated render failure'); };
    try { markCard('known'); } finally { renderNextFlashCardInstantFront = originalRender; }
    markCard('known');
    const events = Object.values(readPendingProgress(currentUser.id)).flatMap(entry => entry.pendingEvents || []);
    return { events: events.length, count: todayNewWords, progressLoaded };
  });
  expect(result).toEqual({ events: 1, count: 1, progressLoaded: false });
  await page.reload();
  await expect(page.locator('#review-new-count')).toHaveText('1/30');
});
