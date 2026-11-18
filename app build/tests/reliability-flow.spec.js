const { test: base, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const test = base.extend({
  pwaServer: async ({}, use) => {
    const webRoot = path.resolve(__dirname, '../www');
    const state = { failVocabulary: false, failures: 0 };
    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/worker-test.html') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end('<html><body>Worker setup</body></html>');
        return;
      }
      if (state.failVocabulary && pathname === '/data/vocab.json') {
        state.failures++;
        response.writeHead(503);
        response.end('Temporarily unavailable');
        return;
      }
      const file = path.resolve(webRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(webRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(404);
        response.end();
        return;
      }
      const type = { '.js': 'application/javascript', '.json': 'application/json', '.html': 'text/html', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      response.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const stop = async () => {
      if (!server.listening) return;
      const closed = new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
      await closed;
    };
    try {
      await use({ url: `http://vocab.localhost:${server.address().port}`, state, stop });
    } finally {
      await stop();
    }
  }
});

test.use({ launchOptions: { args: [
  '--host-resolver-rules=MAP vocab.localhost 127.0.0.1',
  '--no-proxy-server'
] } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  });
});

async function startListening(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '离线使用本机词库' }).click();
  await expect(page.locator('#flash-content')).toBeVisible();
  await page.locator('.nav-tab[data-page="quiz"]').click();
  await page.getByRole('button', { name: '开始词汇能力诊断' }).click();
}

test('failed synthesis cannot unlock listening answers or consume a play', async ({ page }) => {
  await startListening(page);
  await page.evaluate(() => {
    speechSynthesis.cancel = () => {};
    speechSynthesis.getVoices = () => [{ lang: 'ro-RO' }];
    speechSynthesis.speak = utterance => { window.pendingSpeech = utterance; };
  });
  await page.locator('#quiz-play-btn').click();
  await expect(page.locator('.opt:enabled')).toHaveCount(0);
  await page.evaluate(() => window.pendingSpeech.onerror?.({ error: 'synthesis-failed' }));
  await expect(page.locator('#quiz-play-btn')).toBeEnabled();
  expect(await page.evaluate(() => qCurrentAudioPlays)).toBe(0);
  await expect(page.locator('.opt:enabled')).toHaveCount(0);
  await page.locator('#quiz-play-btn').click();
  await page.evaluate(() => window.pendingSpeech.onstart?.());
  await expect(page.locator('.opt:enabled')).toHaveCount(4);
  expect(await page.evaluate(() => qCurrentAudioPlays)).toBe(1);
});

test('old recording failure cannot alter or unlock the next listening question', async ({ page }) => {
  await startListening(page);
  await page.evaluate(() => {
    const word = getCurrentQuizWord();
    Object.assign(word, { audio_url: 'https://audio.example/word.ogg', audio_kind: 'human', audio_source: 'Test recording', audio_license: 'CC0' });
    window.Audio = class {
      play() { return new Promise((resolve, reject) => { window.rejectOldAudio = reject; }); }
      pause() {}
      removeAttribute() {}
    };
    speechSynthesis.cancel = () => {};
    speechSynthesis.getVoices = () => [{ lang: 'ro-RO' }];
    speechSynthesis.speak = () => { window.staleSpeechPlayed = true; };
  });
  await page.locator('#quiz-play-btn').click();
  await page.evaluate(async () => {
    qIdx = qList.findIndex((item, index) => index > 0 && item.type === 'listening');
    renderQuiz();
    window.rejectOldAudio(new Error('late recording failure'));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await expect(page.locator('.opt:enabled')).toHaveCount(0);
  expect(await page.evaluate(() => ({ plays: qCurrentAudioPlays, source: qCurrentAudioSource, stale: !!window.staleSpeechPlayed })))
    .toEqual({ plays: 0, source: '', stale: false });
});

test('listening waits for a Romanian voice instead of accepting the device default', async ({ page }) => {
  await startListening(page);
  await page.evaluate(() => {
    speechSynthesis.cancel = () => {};
    speechSynthesis.getVoices = () => [{ lang: 'en-US' }];
    speechSynthesis.speak = () => { window.wrongLanguagePlayed = true; };
  });
  await page.locator('#quiz-play-btn').click();
  await expect(page.locator('#quiz-play-btn')).toBeEnabled();
  await expect(page.locator('.opt:enabled')).toHaveCount(0);
  expect(await page.evaluate(() => !!window.wrongLanguagePlayed)).toBe(false);
  expect(await page.evaluate(() => qCurrentAudioPlays)).toBe(0);
});

test('pending playback is serialized and times out without consuming the replay budget', async ({ page }) => {
  await startListening(page);
  await page.clock.install();
  await page.evaluate(() => {
    speechSynthesis.cancel = () => {};
    speechSynthesis.getVoices = () => [{ lang: 'ro-RO' }];
    speechSynthesis.speak = utterance => {
      window.pendingSpeech = utterance;
      window.speechRequests = (window.speechRequests || 0) + 1;
    };
  });
  await page.locator('#quiz-play-btn').click();
  await expect(page.locator('#quiz-play-btn')).toBeDisabled();
  await page.evaluate(() => speakQuizWord());
  expect(await page.evaluate(() => window.speechRequests)).toBe(1);
  await page.clock.fastForward(10001);
  await expect(page.locator('#quiz-play-btn')).toBeEnabled();
  expect(await page.evaluate(() => qCurrentAudioPlays)).toBe(0);
  // A late start after timeout must not turn a failed attempt into evidence.
  await page.evaluate(() => window.pendingSpeech.onstart?.());
  await expect(page.locator('.opt:enabled')).toHaveCount(0);
});

test('recording failure falls back to Romanian synthesis and counts only successful starts', async ({ page }) => {
  await startListening(page);
  await page.evaluate(() => {
    Object.assign(getCurrentQuizWord(), { audio_url: 'https://audio.example/word.ogg', audio_kind: 'human', audio_source: 'Test recording', audio_license: 'CC0' });
    window.Audio = class {
      play() { return Promise.reject(new Error('unavailable recording')); }
      pause() {}
      removeAttribute() {}
    };
    speechSynthesis.cancel = () => {};
    speechSynthesis.getVoices = () => [{ lang: 'ro-RO' }];
    speechSynthesis.speak = utterance => utterance.onstart?.();
  });
  await page.locator('#quiz-play-btn').click();
  await expect(page.locator('#quiz-audio-meta')).toHaveText('设备合成音 · 1/2 次');
  await expect(page.locator('.opt:enabled')).toHaveCount(4);
  await page.locator('#quiz-play-btn').click();
  await expect(page.locator('#quiz-play-btn')).toBeDisabled();
  await expect(page.locator('#quiz-audio-meta')).toHaveText('设备合成音 · 2/2 次');
});

test.describe('production PWA behavior', () => {

test('worker prepares first offline visit and preserves unrelated caches', async ({ page, context, pwaServer }) => {
  await page.goto(pwaServer.url + '/worker-test.html');
  await page.evaluate(async () => {
    await caches.open('unrelated-app-cache');
    await caches.open('ro-vocab-pwa-old-test');
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  expect(await page.evaluate(() => caches.has('unrelated-app-cache'))).toBe(true);
  expect(await page.evaluate(() => caches.has('ro-vocab-pwa-old-test'))).toBe(false);
  await page.close();
  // Stop the actual server: browser offline emulation can leave worker
  // network requests usable. The new page must survive on its caches alone.
  await pwaServer.stop();
  await context.setOffline(true);
  const offlinePage = await context.newPage();
  const errors = [];
  offlinePage.on('pageerror', error => errors.push(error.message));
  await offlinePage.goto(pwaServer.url + '/');
  expect(await offlinePage.evaluate(() => fetch('/offline-network-probe').then(() => false, () => true))).toBe(true);
  expect(await offlinePage.evaluate(() => typeof window.supabase?.createClient)).toBe('function');
  await offlinePage.getByRole('button', { name: '离线使用本机词库' }).click();
  await expect(offlinePage.locator('#flash-content')).toBeVisible();
  await expect(offlinePage.locator('#fc-zh')).not.toHaveText('');
  await offlinePage.locator('#main-card').click();
  await offlinePage.locator('#mark-known-btn').click();
  await expect(offlinePage.locator('#review-new-count')).toHaveText('1/30');
  await offlinePage.reload();
  await expect(offlinePage.locator('#review-new-count')).toHaveText('1/30');
  expect(errors).toEqual([]);
});

test('temporary server errors fall back to cached vocabulary without poisoning it', async ({ page, pwaServer }) => {
  await page.goto(pwaServer.url + '/worker-test.html');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  pwaServer.state.failVocabulary = true;
  const response = await page.evaluate(async () => {
    const response = await fetch('/data/vocab.json?reliability-test=503');
    return { status: response.status, words: (await response.json()).words.length };
  });
  expect(pwaServer.state.failures).toBeGreaterThan(0);
  expect(response).toEqual({ status: 200, words: 4867 });
});
});

test('local preview cleanup preserves unrelated caches and service workers', async ({ page }) => {
  await page.addInitScript(() => {
    window.unregisteredWorkers = [];
    navigator.serviceWorker.getRegistrations = async () => ['sw.js', 'other-worker.js'].map(file => ({
      active: { scriptURL: new URL(file, location.href).href },
      unregister: async () => { window.unregisteredWorkers.push(file); }
    }));
  });
  await page.goto('/');
  await page.evaluate(async () => {
    await caches.open('unrelated-app-cache');
    await caches.open('ro-vocab-pwa-old-test');
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => caches.has('ro-vocab-pwa-old-test'))).toBe(false);
  expect(await page.evaluate(() => caches.has('unrelated-app-cache'))).toBe(true);
  expect(await page.evaluate(() => window.unregisteredWorkers)).toEqual(['sw.js']);
});
