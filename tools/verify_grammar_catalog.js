const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/grammar-courses.json'), 'utf8'));
const content = JSON.parse(fs.readFileSync(path.join(root, 'data/grammar-content.json'), 'utf8'));
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

assert.strictEqual(catalog.title, '罗马尼亚语语法知识库', 'grammar catalog must use the knowledge-base title');
assert.strictEqual(catalog.scopeLabel, '按词法与句法编排', 'grammar catalog must use grammar-system organization');
assert.strictEqual(catalog.sourceSpaceUrl, 'https://space.bilibili.com/674194261/upload/video', 'grammar catalog must record the Bilibili source space');
assert(Array.isArray(catalog.modules), 'grammar catalog modules must be an array');
assert(Array.isArray(catalog.courses), 'grammar catalog courses must be an array');
assert.strictEqual(catalog.modules.length, 8, 'grammar catalog must keep the eight-module structure');
assert.strictEqual(catalog.courses.length, 86, 'grammar catalog must keep the complete 86-topic outline');

const moduleIds = catalog.modules.map(module => module.id);
const topicIds = catalog.courses.map(topic => topic.id);
const topicOrders = catalog.courses.map(topic => topic.order);
const linkedTopics = catalog.courses.filter(topic => Array.isArray(topic.bilibiliVideos) && topic.bilibiliVideos.length);
const linkedVideos = linkedTopics.flatMap(topic => topic.bilibiliVideos);
assert.strictEqual(new Set(moduleIds).size, moduleIds.length, 'grammar module ids must be unique');
assert.strictEqual(new Set(topicIds).size, topicIds.length, 'grammar topic ids must be unique');
assert.strictEqual(new Set(topicOrders).size, topicOrders.length, 'grammar topic orders must be unique');
assert(content.topics && typeof content.topics === 'object', 'structured grammar content must expose a topics map');
assert.deepStrictEqual(Object.keys(content.topics).sort(), [...topicIds].sort(), 'every grammar topic must have exactly one structured content entry');
assert.strictEqual(linkedTopics.length, 24, 'the current high-confidence Bilibili mapping must cover 24 grammar topics');
assert.strictEqual(linkedVideos.length, 34, 'combined and multi-part courses must keep all 34 topic associations');
assert.strictEqual(new Set(linkedVideos.map(video => video.url)).size, 30, 'the mapping must retain all 30 distinct public course videos');

for (const module of catalog.modules) {
  assert(module.id && module.title && module.summary && module.readingGuide, `grammar module ${module.id || '(unknown)'} is incomplete`);
}

for (const topic of catalog.courses) {
  assert(topic.id && topic.title && topic.summary && topic.category, `grammar topic ${topic.id || '(unknown)'} is incomplete`);
  assert(moduleIds.includes(topic.module), `grammar topic ${topic.id} refers to an unknown module`);
  if (topic.bilibiliVideos) {
    assert(Array.isArray(topic.bilibiliVideos) && topic.bilibiliVideos.length >= 1, `grammar topic ${topic.id} needs a non-empty course list`);
    for (const video of topic.bilibiliVideos) {
      assert(video.title && video.duration, `grammar topic ${topic.id} course metadata is incomplete`);
      assert(/^\d{2}:\d{2}$/.test(video.duration), `grammar topic ${topic.id} course duration is invalid`);
      const url = new URL(video.url);
      assert.strictEqual(url.protocol, 'https:', `grammar topic ${topic.id} must use HTTPS course links`);
      assert.strictEqual(url.hostname, 'www.bilibili.com', `grammar topic ${topic.id} must use a canonical Bilibili URL`);
      assert(/^\/video\/BV[A-Za-z0-9]+\/$/.test(url.pathname), `grammar topic ${topic.id} course URL must point to a BV video`);
    }
  }
  const detail = content.topics[topic.id];
  assert(typeof detail.overview === 'string' && detail.overview.length >= 20, `grammar topic ${topic.id} needs a useful overview`);
  assert(Array.isArray(detail.keyPoints) && detail.keyPoints.length >= 2, `grammar topic ${topic.id} needs multiple key points`);
  assert(detail.keyPoints.every(point => typeof point === 'string' && point.length >= 8), `grammar topic ${topic.id} has an incomplete key point`);
  assert(Array.isArray(detail.examples) && detail.examples.length >= 1, `grammar topic ${topic.id} needs at least one example`);
  assert(detail.examples.every(example => example && example.ro && example.zh), `grammar topic ${topic.id} examples need Romanian and Chinese text`);
  if (topic.module === 'verb-system') {
    assert(detail.paradigm && Array.isArray(detail.paradigm.rows), `verb topic ${topic.id} needs a conjugation or construction table`);
    assert(detail.paradigm.rows.length >= 3, `verb topic ${topic.id} needs a useful conjugation or construction table`);
    assert(detail.paradigm.rows.every(row => row.label && row.form && row.example), `verb topic ${topic.id} has an incomplete conjugation row`);
  }
}

assert(/class="nav-tab"[^>]*data-page="grammar"/.test(index), 'grammar must be a primary navigation tab');
assert(!/class="nav-tab"[^>]*data-page="wrongbook"/.test(index), 'reinforcement must not remain in primary navigation');
assert(index.includes('id="grammar-search-input"'), 'grammar catalog must expose a search input');
assert(index.includes('onclick="openPronunciationGuide()"'), 'grammar catalog must link beginners to the pronunciation guide');
assert(index.includes('id="guide-pronunciation"'), 'the guide must expose a pronunciation destination');
assert.strictEqual((index.match(/class="guide-video-link"/g) || []).length, 3, 'the pronunciation guide must expose the three Bilibili lessons');
for (const bv of ['BV1tx4y1d77H', 'BV1yk4y1U7mN', 'BV1yk4y1U7Xm']) {
  assert(index.includes(`https://www.bilibili.com/video/${bv}/`), `the pronunciation guide is missing ${bv}`);
}
assert(!index.includes('grammar-filter-bar'), 'grammar catalog must not expose CEFR level filters');
assert(!index.includes('A1–C1 语法框架'), 'grammar catalog must not present CEFR as its organizing dimension');
assert(app.includes('function normalizeGrammarSearch'), 'grammar search must normalize Romanian diacritics');
assert(app.includes('data-grammar-topic='), 'grammar topics must render as expandable entries');
assert(app.includes("fetch('./data/grammar-content.json"), 'grammar topics must load structured content');
assert(app.includes('grammar-detail-label">先看结论'), 'grammar topics must expose a concise conclusion');
assert(app.includes('grammar-detail-label">核心规则'), 'grammar topics must expose key rules');
assert(app.includes('grammar-paradigm-table'), 'verb topics must render conjugation or construction tables');
assert(app.includes('grammar-example-list'), 'grammar topics must render examples');
assert(!app.includes('data-grammar-filter'), 'grammar level-filter logic must be removed');
assert(app.includes('function getGrammarCourseVideos'), 'grammar topics must support multiple course videos');
assert(app.includes('function openPronunciationGuide'), 'the grammar-to-pronunciation handoff must be implemented');
assert(app.includes('isSupportedBilibiliUrl(video.url)'), 'grammar links must be validated before rendering');
assert(app.includes('courseVideos.flatMap(video => [video.title, video.duration])'), 'grammar search must index course titles');
assert(app.includes('const footer = watchActions'), 'topics without a course must omit the link footer');
assert(app.includes('grammar-watch-title'), 'course links must show their source video titles');

console.log('grammar catalog verification passed');
