const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');

async function openStudy(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '离线使用本机词库' }).click();
  await expect(page.locator('#fc-zh')).not.toHaveText('');
  await expect(page.locator('#app-screen')).toBeVisible();
}

test('card evidence is durable, omitted from cloud journals, and removed by undo', async ({ page }) => {
  await openStudy(page);
  const saved = await page.evaluate(() => {
    const word = getCurrentFlashWord();
    markCard('known');
    const records = apiReadLearningEvidence(currentUser.id);
    const journal = readProgressEventJournal(currentUser.id);
    return { events: records[String(word.id)].evidence.events.length,
      cloudIncludesHistory: journal.some(row => row.pendingProgress.learningEvidence) };
  });
  expect(saved).toEqual({ events: 1, cloudIncludesHistory: false });
  await page.evaluate(() => undoLastCardAnswer());
  expect(await page.evaluate(() => Object.keys(apiReadLearningEvidence(currentUser.id)).length)).toBe(0);
  await page.reload();
  await expect(page.locator('#review-new-count')).toHaveText('0/200');
});

test('cloud refresh cannot remove local evidence and backup round-trip is idempotent', async ({ page }) => {
  await openStudy(page);
  const refreshedCount = await page.evaluate(async () => {
    const word = getCurrentFlashWord();
    markCard('known');
    const originalLoad = apiLoadCloudProgressRows;
    const originalEvidenceLoad = apiLoadCloudLearningEvidenceRows;
    const originalOffline = isOfflineMode;
    apiLoadCloudProgressRows = async () => [{ word_id: word.id, word_ro: word.ro, seen: true, known: true, quiz_right: 1, quiz_total: 1 }];
    apiLoadCloudLearningEvidenceRows = async () => [];
    isOfflineMode = () => false;
    try {
      const loaded = await apiLoadProgress(currentUser.id);
      return loaded[String(word.id)].learningEvidence.events.length;
    } finally {
      apiLoadCloudProgressRows = originalLoad;
      apiLoadCloudLearningEvidenceRows = originalEvidenceLoad;
      isOfflineMode = originalOffline;
    }
  });
  expect(refreshedCount).toBe(1);
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(() => exportProgressBackup());
  const download = await downloadPromise;
  const payload = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  expect(payload.learningEvidenceScope).toBe('local-device');
  expect(Object.values(payload.progress).flatMap(p => p.learningEvidence?.events || [])).toHaveLength(1);
  await page.evaluate(async data => {
    await importProgressBackup(new File([JSON.stringify(data)], 'progress-backup.json', { type: 'application/json' }));
  }, payload);
  const count = await page.evaluate(() => Object.values(apiReadLearningEvidence(currentUser.id)).flatMap(row => row.evidence.events).length);
  expect(count).toBe(1);
});

test('backup preserves a permanent evidence tombstone across import', async ({ page }) => {
  await openStudy(page);
  const eventId = await page.evaluate(() => {
    markCard('known');
    const id = Object.values(apiReadLearningEvidence(currentUser.id))[0].evidence.events[0].id;
    return Promise.resolve(undoLastCardAnswer()).then(() => id);
  });
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(() => exportProgressBackup());
  const download = await downloadPromise;
  const payload = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  expect(payload.learningEvidenceTombstones.map(item => item.eventId)).toContain(eventId);

  await page.evaluate(({ backup, deletedId }) => {
    [...Array(localStorage.length)].map((_, index) => localStorage.key(index))
      .filter(key => key?.startsWith('learning_evidence:') || key?.startsWith('learning_evidence_tombstone:'))
      .forEach(key => localStorage.removeItem(key));
    importLearningEvidenceSyncState(currentUser.id, {
      tombstones: backup.learningEvidenceTombstones,
      pending: [{
        eventId: deletedId,
        wordId: 1,
        wordRo: 'resurrected',
        payload: { id: deletedId, at: new Date().toISOString(), date: '2026-09-07', interaction: 'flashcard_known' }
      }]
    });
  }, { backup: payload, deletedId: eventId });
  expect(await page.evaluate(id => ({
    visible: Object.values(apiReadLearningEvidence(currentUser.id)).flatMap(record => record.evidence.events).some(event => event.id === id),
    tombstoned: readLearningEvidenceTombstones(currentUser.id).has(id)
  }), eventId)).toEqual({ visible: false, tombstoned: true });
});
