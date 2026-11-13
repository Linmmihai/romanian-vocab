const { test, expect } = require('@playwright/test');

async function openStudy(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '离线使用本机词库' }).click();
  await expect(page.locator('#flash-content')).toBeVisible();
}

// Use Chromium's real localStorage quota, rather than a mock of setItem.
test('full storage recovers an interrupted answer from a durable backup before startup', async ({ page }) => {
  await openStudy(page);
  const seeded = await page.evaluate(() => {
    markCard('known');
    const userId = currentUser.id;
    const expectedEvents = Object.values(apiReadLearningEvidence(userId)).flatMap(record => record.evidence.events).map(event => event.id);
    const key = `study_commit:${userId}:2026-11-13:quota-recovery-test`;
    const target = `daily_state_event:${userId}:quota-test`;
    const value = JSON.stringify({ eventId: 'quota-test', date: '2026-11-13', payload: 'x'.repeat(24_000) });
    localStorage.setItem(key, JSON.stringify({ writes: [[target, value]] }));
    let n = 0;
    try { while (true) localStorage.setItem(`quota-test-padding:${n++}`, 'p'.repeat(4096)); } catch {}
    let didThrow = false;
    try { recoverStudyCommits(); } catch (error) { didThrow = error.name === 'QuotaExceededError'; }
    return { key, target, value, expectedEvents, didThrow };
  });
  expect(seeded.didThrow).toBe(true);
  await page.reload();
  await expect(page.locator('#flash-content')).toBeVisible();
  const recovered = await page.evaluate(async ({ key, target, value, expectedEvents }) => {
    const db = await new Promise(resolve => { const request = indexedDB.open('romanian-vocab-storage-recovery'); request.onsuccess = () => resolve(request.result); });
    const backups = await new Promise(resolve => { const request = db.transaction('backups').objectStore('backups').getAll(); request.onsuccess = () => resolve(request.result); });
    const pending = await new Promise(resolve => { const request = db.transaction('pending').objectStore('pending').getAll(); request.onsuccess = () => resolve(request.result); });
    db.close();
    const actualEvents = Object.values(apiReadLearningEvidence(currentUser.id)).flatMap(record => record.evidence.events).map(event => event.id);
    return {
      receiptRemoved: localStorage.getItem(key) === null,
      materialized: localStorage.getItem(target) === value,
      originalBackedUp: backups.some(backup => backup.values[key]?.includes('quota-test')),
      pending: pending.length,
      eventsPreserved: expectedEvents.every(id => actualEvents.includes(id)),
      duplicates: actualEvents.length - new Set(actualEvents).size
    };
  }, seeded);
  expect(recovered).toEqual({ receiptRemoved: true, materialized: true, originalBackedUp: true, pending: 0, eventsPreserved: true, duplicates: 0 });
  await page.reload();
  await expect(page.locator('#flash-content')).toBeVisible();
});

test('a crash after receipt transfer resumes from IndexedDB on the next startup', async ({ page }) => {
  await openStudy(page);
  await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('romanian-vocab-storage-recovery'); r.onsuccess = () => resolve(r.result); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('pending', 'readwrite');
      tx.objectStore('pending').put({ key: 'study_commit:local-offline-user:interrupted', raw: JSON.stringify({ writes: [['today_accuracy:recovery-test', '{"total":3,"correct":2}']] }) });
      tx.oncomplete = resolve; tx.onerror = reject;
    });
    db.close();
  });
  await page.reload();
  await expect(page.locator('#flash-content')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('today_accuracy:recovery-test'))).toBe('{"total":3,"correct":2}');
});

test('failed backup keeps the receipt and prevents login from consuming pending data', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('study_commit:local-offline-user:backup-failure', JSON.stringify({ writes: [['daily_state_event:local-offline-user:answer', '{"eventId":"answer"}']] }));
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = () => { throw new Error('simulated backup unavailable'); };
  });
  await page.goto('/');
  await expect(page.locator('#auth-msg')).toContainText('原始记录已保留');
  expect(await page.evaluate(() => localStorage.getItem('study_commit:local-offline-user:backup-failure'))).not.toBeNull();
});
