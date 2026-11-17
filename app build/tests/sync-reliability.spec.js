const { test, expect } = require('@playwright/test');

async function openStudy(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '离线使用本机词库' }).click();
  await expect(page.locator('#flash-content')).toBeVisible();
}

test('progress mirrors omit durable evidence despite identity enrichment and retain unbacked events', async ({ page }) => {
  await openStudy(page);
  const result = await page.evaluate(() => {
    const userId = currentUser.id;
    const word = W[0];
    const evidence = { version: 1, events: [{ id: 'normalized-event', at: new Date().toISOString(), correct: true }] };
    const progress = { word_id: word.id, word_ro: word.ro, seen: true, qr: 1, qt: 1, learningEvidence: evidence };
    for (const [key, value] of buildLearningEvidenceWrites(userId, word.id, word.ro, progress)) localStorage.setItem(key, value);
    writeLocalProgressSnapshot(userId, { [word.id]: progress });
    const snapshot = JSON.parse(localStorage.getItem(localKey(userId, 'progress')))[word.id];
    const restored = readLocalProgressFallback(userId)[word.id];
    const unbacked = { ...progress, learningEvidence: { version: 1, events: [...evidence.events, { id: 'not-yet-durable', at: new Date().toISOString() }] } };
    writeLocalProgressSnapshot(userId, { [word.id]: unbacked });
    const retained = JSON.parse(localStorage.getItem(localKey(userId, 'progress')))[word.id];
    return { duplicated: !!snapshot.learningEvidence, restoredIds: restored.learningEvidence.events.map(event => event.id), retainedIds: retained.learningEvidence.events.map(event => event.id) };
  });
  expect(result).toEqual({ duplicated: false, restoredIds: ['normalized-event'], retainedIds: ['normalized-event', 'not-yet-durable'] });
});

test('daily replay respects a larger budget and stops after a failed dependent prefix', async ({ page }) => {
  await openStudy(page);
  const result = await page.evaluate(async () => {
    localStorage.removeItem('offline-mode');
    currentUser = { id: 'sync-test-user' };
    for (let i = 1; i <= 25; i++) localStorage.setItem(`${dailyStateEventPrefix(currentUser.id)}event-${i}`, JSON.stringify({ eventId: `event-${i}`, userId: currentUser.id, date: '2026-11-17', clientId: 'test-client', clientSeq: i, createdAt: new Date(i * 1000).toISOString() }));
    let calls = 0;
    enqueueDailyStateEventSync = async (userId, event) => {
      calls++;
      if (calls === 3) throw new Error('simulated network timeout');
      clearPendingDailyEvent(userId, event.eventId);
    };
    const failed = await apiRetryPendingDailyState(currentUser.id, 1000);
    const failureCalls = calls;
    enqueueDailyStateEventSync = async (userId, event) => clearPendingDailyEvent(userId, event.eventId);
    const recovered = await apiRetryPendingDailyState(currentUser.id, 1000);
    return { failureCalls, remainingAfterFailure: failed.remaining, error: failed.error.message, savedAfterRecovery: recovered.saved, remaining: recovered.remaining };
  });
  expect(result).toEqual({ failureCalls: 3, remainingAfterFailure: 23, error: 'simulated network timeout', savedAfterRecovery: 23, remaining: 0 });
});

test('continuous activity cannot postpone backup and a failed backup retries without input', async ({ page }) => {
  await openStudy(page);
  await page.clock.install();
  await page.evaluate(() => {
    clearTimeout(progressCloudSyncTimer);
    progressCloudSyncTimer = null;
    currentUser = { id: 'timer-test-user' };
    localStorage.removeItem('offline-mode');
    window.backupCalls = 0;
    flushPendingFastCardState = () => {};
    hasPendingSync = () => true;
    hasPendingProgress = () => false;
    reconcileProgressPendingFlags = () => ({ totalCount: 1 });
    apiRetryPendingProgress = async () => { window.backupCalls++; throw new Error('temporary network failure'); };
    syncDailyStateToCloud = async () => ({ saved: true });
    apiRetryPendingLearningEvidence = async () => ({ attempted: 0 });
    scheduleIdleProgressBackup();
  });
  for (let i = 0; i < 3; i++) {
    await page.clock.runFor(4000);
    await page.evaluate(() => scheduleIdleProgressBackup());
  }
  await page.clock.runFor(3100);
  expect(await page.evaluate(() => window.backupCalls)).toBe(1);
  await page.clock.runFor(5100);
  expect(await page.evaluate(() => window.backupCalls)).toBe(2);
});
