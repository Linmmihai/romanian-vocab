const { test, expect } = require('@playwright/test');

async function openStudy(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '离线使用本机词库' }).click();
  await expect(page.locator('#app-screen')).toBeVisible();
  await expect(page.locator('#fc-zh')).not.toHaveText('');
}

async function installEvidenceCloud(context, cloudState) {
  await context.exposeFunction('__evidenceRpc', async (events) => {
    if (cloudState.fail) throw new Error('simulated evidence network failure');
    const results = events.map(input => {
      const id = String(input.event_id);
      const prior = cloudState.rows.get(id);
      let row = prior;
      if (input.deleted) {
        row = {
          user_id: 'shared-user',
          event_id: id,
          word_id: prior?.word_id ?? input.word_id ?? null,
          word_ro: prior?.word_ro || input.word_ro || '',
          payload: prior?.payload || null,
          deleted: true,
          changed_at: new Date().toISOString(),
          created_at: prior?.created_at || new Date().toISOString()
        };
      } else if (!prior) {
        row = {
          user_id: 'shared-user',
          event_id: id,
          word_id: input.word_id ?? null,
          word_ro: input.word_ro || '',
          payload: input.payload,
          deleted: false,
          changed_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        };
      }
      cloudState.rows.set(id, row);
      return row;
    });
    return { results };
  });
  await context.exposeFunction('__evidenceRead', async (userId, from, to) => {
    if (cloudState.fail) throw new Error('simulated evidence network failure');
    return [...cloudState.rows.values()]
      .filter(row => row.user_id === userId)
      .sort((left, right) => left.event_id.localeCompare(right.event_id))
      .slice(from, to + 1);
  });
}

async function configureOnlineEvidence(page) {
  await page.evaluate(() => {
    currentUser = { id: 'shared-user', email: 'learner@example.com' };
    localStorage.removeItem('offline-mode');
    replaceProgressMap({});
    const originalFrom = sb.from.bind(sb);
    const originalRpc = sb.rpc.bind(sb);
    sb.rpc = async (name, args) => {
      if (name === 'apply_learning_evidence_batch') {
        try { return { data: await window.__evidenceRpc(args.p_events), error: null }; }
        catch (error) { return { data: null, error }; }
      }
      return originalRpc(name, args);
    };
    sb.from = table => {
      if (table !== 'learning_evidence_events') return originalFrom(table);
      let selectedUser = '';
      const query = {
        select() { return query; },
        eq(column, value) { if (column === 'user_id') selectedUser = value; return query; },
        order() { return query; },
        async range(from, to) {
          try { return { data: await window.__evidenceRead(selectedUser, from, to), error: null }; }
          catch (error) { return { data: null, error }; }
        }
      };
      return query;
    };
  });
}

test('two devices sync evidence deltas, permanent undo tombstones, retries, and legacy migration', async ({ browser }) => {
  const cloudState = { rows: new Map(), fail: false };
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  await Promise.all([installEvidenceCloud(contextA, cloudState), installEvidenceCloud(contextB, cloudState)]);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await Promise.all([openStudy(pageA), openStudy(pageB)]);
  await Promise.all([configureOnlineEvidence(pageA), configureOnlineEvidence(pageB)]);

  const first = await pageA.evaluate(() => {
    const word = getCurrentFlashWord();
    markCard('known');
    const pending = readPendingLearningEvidence(currentUser.id);
    return { wordId: word.id, wordRo: word.ro, eventId: pending[0]?.eventId, pending: pending.length };
  });
  expect(first.pending).toBe(1);
  expect(first.eventId).toBeTruthy();
  expect(await pageA.evaluate(() => apiRetryPendingLearningEvidence(currentUser.id))).toMatchObject({ saved: 1, remaining: 0 });

  await pageB.evaluate(() => apiLoadAndMergeLearningEvidence(currentUser.id));
  expect(await pageB.evaluate(id => Object.values(apiReadLearningEvidence(currentUser.id))
    .flatMap(record => record.evidence.events).map(event => event.id), first.eventId)).toContain(first.eventId);

  const second = await pageB.evaluate(async ({ wordId, wordRo }) => {
    const existing = apiReadLearningEvidence(currentUser.id)[String(wordId)]?.evidence || {};
    const evidence = RomanianVocabLearningEvidence.buildEvidence(existing, 'translation_correct', {
      wordId, wordRo, exerciseType: 'translation', correct: true
    });
    const writes = buildLearningEvidenceWrites(currentUser.id, wordId, wordRo, { learningEvidence: evidence });
    commitLocalStudyWrites(currentUser.id, evidence.events.at(-1).id, writes);
    const record = readPendingLearningEvidence(currentUser.id).at(-1);
    await apiRetryPendingLearningEvidence(currentUser.id);
    // Replay the exact acknowledged increment. The server and local merge must stay idempotent.
    localStorage.setItem(learningEvidenceOutboxKey(currentUser.id, record.eventId), JSON.stringify(record));
    await apiRetryPendingLearningEvidence(currentUser.id);
    return record.eventId;
  }, first);
  expect(cloudState.rows.size).toBe(2);

  // A pulls B's newer event before undoing its own answer. Only A's answer may be tombstoned.
  await pageA.evaluate(() => apiLoadAndMergeLearningEvidence(currentUser.id));
  await pageA.evaluate(() => undoLastCardAnswer());
  const afterUndoLocal = await pageA.evaluate(() => ({
    events: Object.values(apiReadLearningEvidence(currentUser.id)).flatMap(record => record.evidence.events).map(event => event.id),
    pending: readPendingLearningEvidence(currentUser.id).map(record => ({ id: record.eventId, deleted: record.deleted }))
  }));
  expect(afterUndoLocal.events).toContain(second);
  expect(afterUndoLocal.events).not.toContain(first.eventId);
  expect(afterUndoLocal.pending).toContainEqual({ id: first.eventId, deleted: true });
  await pageA.evaluate(() => apiRetryPendingLearningEvidence(currentUser.id));

  // B still has the old local add. Pulling the cloud tombstone removes it permanently.
  await pageB.evaluate(() => apiLoadAndMergeLearningEvidence(currentUser.id));
  const afterTombstone = await pageB.evaluate(eventId => ({
    events: Object.values(apiReadLearningEvidence(currentUser.id)).flatMap(record => record.evidence.events).map(event => event.id),
    tombstoned: readLearningEvidenceTombstones(currentUser.id).has(eventId)
  }), first.eventId);
  expect(afterTombstone.events).toEqual([second]);
  expect(afterTombstone.tombstoned).toBe(true);

  const failedRetry = await pageB.evaluate(async ({ wordId, wordRo }) => {
    const existing = apiReadLearningEvidence(currentUser.id)[String(wordId)]?.evidence || {};
    const evidence = RomanianVocabLearningEvidence.buildEvidence(existing, 'dictation_correct', {
      wordId, wordRo, exerciseType: 'dictation', correct: true, spellingExact: true
    });
    const event = evidence.events.at(-1);
    commitLocalStudyWrites(currentUser.id, event.id,
      buildLearningEvidenceWrites(currentUser.id, wordId, wordRo, { learningEvidence: evidence }));
    return event.id;
  }, first);
  cloudState.fail = true;
  expect(await pageB.evaluate(() => apiRetryPendingLearningEvidence(currentUser.id))).toMatchObject({ failed: 1, remaining: 1 });
  expect(await pageB.evaluate(() => apiGetPendingSyncSummary(currentUser.id).evidenceCount)).toBe(1);
  cloudState.fail = false;
  expect(await pageB.evaluate(() => apiRetryPendingLearningEvidence(currentUser.id))).toMatchObject({ saved: 1, remaining: 0 });
  expect(cloudState.rows.has(failedRetry)).toBe(true);

  const migration = await pageB.evaluate(({ wordId, wordRo }) => {
    currentUser = { id: 'legacy-user', email: 'legacy@example.com' };
    const oldEvidence = RomanianVocabLearningEvidence.buildEvidence({}, 'stress_correct', {
      eventId: 'legacy-evidence-1', wordId, wordRo, exerciseType: 'stress', correct: true
    });
    localStorage.setItem(`learning_evidence:legacy-user:${wordId}`, JSON.stringify({ wordId, wordRo, evidence: oldEvidence }));
    const result = migrateLegacyLearningEvidenceToOutbox('legacy-user');
    return {
      result,
      legacy: readPendingLearningEvidence('legacy-user').map(record => record.eventId),
      shared: readPendingLearningEvidence('shared-user').map(record => record.eventId),
      marker: localStorage.getItem('learning_evidence_outbox_v1:legacy-user')
    };
  }, first);
  expect(migration.result.migrated).toBe(1);
  expect(migration.legacy).toEqual(['legacy-evidence-1']);
  expect(migration.shared).toEqual([]);
  expect(migration.marker).toBe('1');

  await Promise.all([contextA.close(), contextB.close()]);
});
