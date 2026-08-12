#!/usr/bin/env node

// Merge a reviewed learning-track manifest into both offline vocabulary bundles.
// This script intentionally does not write to Supabase; cloud publication happens
// only after the generated local data and audit report pass verification.

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(manifestPath)) {
  throw new Error('Usage: node tools/apply_vocab_rebuild.js MANIFEST.json');
}

const vocabPath = path.join(root, 'data', 'vocab.json');
const appVocabPath = path.join(root, 'app build', 'data', 'vocab.json');
const reportPath = path.join(root, 'artifacts', 'vocab-rebuild-report-20260812.json');
const adversarialReportPath = path.join(root, 'artifacts', 'vocab-adversarial-audit-20260812.json');
const vocabPayload = JSON.parse(fs.readFileSync(vocabPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const words = Array.isArray(vocabPayload) ? vocabPayload : (vocabPayload.words || []);
const manifestById = new Map(manifest.rows.map(row => [Number(row.id), row]));
// These rows were verified in the live editor after the last offline export.
// Preserve the newer cloud review state when rebuilding the local bundle.
const cloudVerifiedIds = new Set([3937, 4203, 4363, 5108, 6172, 6173, 6177]);
const preservedPhraseMetadata = new Map([6172, 6173, 6177].map(id => [id, {
  curation_batch: 'phrase_curation_20260726',
  phrase_quality: 'core',
  original_unit_type: 'expression'
}]));

const corrections = new Map(Object.entries({
  3202: {
    hint: 'adj: absolută / absoluți / absolute',
    example_ro: 'Radu a refuzat categoric orice compromis care ar fi afectat calitatea proiectului.',
    example_zh: 'Radu断然拒绝任何可能影响项目质量的妥协。'
  },
  3203: {
    example_ro: 'El este un student relativ harnic.',
    example_zh: '他是一名比较勤奋的学生。'
  },
  3205: { zh: '原则；原理' },
  3207: { hint: 'adj: infinită / infiniți / infinite' },
  3231: { zh: '防御；辩护' },
  3252: { zh: '文凭；毕业证书' },
  3265: {
    zh: '主题；作业',
    topic: 'education_language',
    cat: 'Education',
    specialist_book: 'specialist_education_language'
  },
  3332: {
    example_ro: 'Ana a așteptat trei săptămâni pentru o programare la ortopedie după accidentarea de la schi.'
  },
  3333: {
    example_ro: 'Mihai i-a acordat primul ajutor colegului care leșinase în sala de conferințe.',
    example_zh: 'Mihai对在会议室晕倒的同事进行了急救。'
  },
  3335: { example_ro: 'Elena a petrecut un semestru întreg studiind anatomia înainte de primul stagiu clinic.' },
  3353: { hint: 's.f.: gherile' },
  3430: { zh: '谋杀；严重罪行' },
  3445: {
    hint: 's.n.: curricula',
    example_ro: 'Profesorul a modificat curriculumul după feedbackul studenților.'
  },
  3463: { zh: '版本；版次' },
  3511: { zh: '收成；收获物' },
  3515: { zh: '小麦' },
  3529: {
    example_ro: 'Elena lucrează ca asistentă medicală într-o clinică universitară și îi pregătește pe pacienți pentru consultații.',
    example_zh: 'Elena在一家大学诊所担任护士，帮助患者做好就诊准备。'
  },
  3545: { zh: '信息', topic: 'people_society', cat: 'People & Society', specialist_book: null },
  3565: { zh: '工具；仪器；乐器' },
  3849: { ro: 'naționalism' },
  4008: {
    zh: '结案；撤案（刑事程序）',
    ro: 'clasare',
    ipa: 'clasAre',
    hint: 's.f.: clasări',
    example_ro: 'Procurorii au dispus clasarea dosarului din lipsă de probe.',
    example_zh: '检察官因证据不足决定对该案作结案处理。',
    unit_type: 'word',
    learning_track: 'specialist',
    specialist_book: 'specialist_law_public_affairs',
    content_status: 'active',
    curation_reason: '用现行刑事程序术语替换旧法残缺表达'
  },
  4568: {
    ro: 'criza migrației',
    ipa: 'crIza migrAției',
    hint: 's.f.: crize ale migrației',
    example_ro: 'Criza migrației a pus presiune pe sistemele europene de azil.',
    topic: 'law_public_affairs',
    cat: 'Law & Public Affairs',
    specialist_book: 'specialist_law_public_affairs'
  },
  4580: {
    ro: 'inseparabilitate cuantică',
    ipa: 'inseparabilitAte cuAntică',
    hint: 's.f.: inseparabilități cuantice',
    example_ro: 'Inseparabilitatea cuantică leagă stările unor particule aflate la distanță.',
    grammar_data: { aliases: ['entanglement cuantic'] }
  },
  4660: {
    ro: 'cultivarea arborelui de cacao',
    ipa: 'cultivArea Arborelui de cacAo',
    hint: 's.f.: (fără plural)',
    example_ro: 'Cultivarea arborelui de cacao este vulnerabilă la boli și la schimbările climatice.'
  },
  5201: {
    ro: 'metoda Lean Startup',
    ipa: 'metOda Lean Startup',
    hint: 's.f.: metode Lean Startup',
    example_ro: 'Metoda Lean Startup testează rapid ipotezele înaintea unor investiții mari.'
  },
  5228: {
    ro: 'arta noilor media',
    ipa: 'Arta nOilor mEdia',
    hint: 's.f.: (fără plural)',
    example_ro: 'Arta noilor media folosește ecrane, cod și instalații interactive.'
  },
  5683: {
    zh: '从事；任职；活跃于',
    example_ro: 'Actorul activează în cadrul teatrului de peste zece ani.',
    example_zh: '这位演员在该剧院工作已有十多年。'
  },
  6435: {
    zh: '清洁人员',
    ro: 'agent de curățenie',
    ipa: 'agEnt de curățEnie',
    hint: 's.m./s.f.: agenți / agente de curățenie',
    example_ro: 'Agentul de curățenie vine seara, după ce pleacă angajații.',
    example_zh: '清洁人员在员工下班后于晚上过来。',
    topic: 'work_management',
    cat: 'Management',
    unit_type: 'term',
    learning_track: 'scenario_phrasebook',
    specialist_book: 'specialist_work_management'
  },
  8449: {
    zh: '预约课程名额',
    ro: 'a rezerva un loc la curs',
    ipa: 'a rezervA un loc la curs',
    example_ro: 'Îmi rezerv din aplicație un loc la cursul de yoga.',
    example_zh: '我通过应用预约瑜伽课的一个名额。',
    unit_type: 'verb_phrase',
    learning_track: 'scenario_phrasebook',
    specialist_book: null
  },
  3410: { learning_track: 'specialist', curation_reason: '哲学术语移入专项词书' },
  3785: { learning_track: 'specialist', curation_reason: '哲学术语移入专项词书' },
  3883: { learning_track: 'specialist', curation_reason: '设备术语移入科技专项词书' },
  3973: { learning_track: 'specialist', curation_reason: '哲学术语移入专项词书' },
  4170: { learning_track: 'specialist', curation_reason: '哲学术语移入专项词书' },
  4254: { learning_track: 'specialist', curation_reason: '学科术语移入科技专项词书' },
  4263: { learning_track: 'specialist', curation_reason: '学科术语移入科技专项词书' },
  5050: { learning_track: 'specialist', curation_reason: '数学术语移入科技专项词书' },
  3213: { zh: '怀疑；怀疑态度' },
  3436: { zh: '规章；条例；规则' },
  3794: {
    zh: '抵押权；不动产抵押',
    example_ro: 'Banca a înscris o ipotecă asupra locuinței.',
    example_zh: '银行在该房产上设立了抵押权。', learning_track: 'specialist'
  },
  3813: { zh: '公证处；公证机构' },
  3935: {
    ro: 'fuziuni și achiziții', ipa: 'fuziUni și achizIții', hint: 's.f.pl.: fuziuni și achiziții',
    example_ro: 'Radu a consiliat echipa juridică în procesul de fuziuni și achiziții.',
    example_zh: 'Radu在并购过程中为法律团队提供了咨询。', learning_track: 'specialist'
  },
  4051: { zh: '移居国外；外迁' },
  4099: {
    example_ro: 'Medicul endocrinolog i-a recomandat analize hormonale.',
    learning_track: 'specialist', curation_reason: '医学学科术语移入健康专项词书'
  },
  4162: { zh: '市场；集市；广场' },
  4172: {
    zh: '自己；自身', part_of_speech: 'pronoun', topic: 'people_society', cat: 'People & Society',
    hint: 'pron. reflexiv accentuat: sine', example_zh: '治疗帮助他更真诚地谈论自己。', specialist_book: null
  },
  4173: {
    zh: '另一个；其余的；对方', topic: 'people_society', cat: 'People & Society', specialist_book: null,
    example_ro: 'Celălalt candidat și-a anunțat retragerea.', example_zh: '另一名候选人宣布退出。'
  },
  4388: {
    zh: '坏的；糟糕的；恶劣的', part_of_speech: 'adjective', topic: 'daily_life', cat: 'Daily Life', specialist_book: null,
    hint: 'adj.: rea / răi / rele', example_ro: 'Vremea rea a întârziat zborurile.', example_zh: '恶劣天气导致航班延误。'
  },
  4389: {
    zh: '漂亮的；美好的', part_of_speech: 'adjective', topic: 'daily_life', cat: 'Daily Life', specialist_book: null,
    hint: 'adj.: frumoasă / frumoși / frumoase', example_ro: 'Orașul este frumos primăvara.', example_zh: '这座城市春天很美。'
  },
  4834: {
    zh: '方式；办法', topic: 'people_society', cat: 'People & Society', specialist_book: null,
    example_ro: 'Guvernul caută o modalitate de a reduce costurile.', example_zh: '政府正在寻找降低成本的办法。'
  },
  4846: { zh: '共情；同理心', example_zh: '同理心帮助他不加评判地理解他人的痛苦。' },
  5284: { zh: '减少；降价；折扣' },
  5377: {
    learning_track: 'scenario_phrasebook', topic: 'daily_life', cat: 'Daily Life', specialist_book: null,
    frequency_rank: null, frequency_source: null, corpus_frequency: null,
    news_frequency: 0, news_document_count: 0, news_category_count: 0,
    curation_reason: '钉子义与疑问代词 cui 同形，移入生活场景词书'
  },
  5501: { zh: '协议；一致；同意', example_zh: '他们经过长时间讨论后达成一致。' },
  5530: { zh: '报告；汇报；举报' },
  5650: {
    zh: '退出；撤回；撤退；退休', topic: 'people_society', cat: 'People & Society', specialist_book: null,
    example_ro: 'Candidatul s-a retras din cursă înainte de vot.', example_zh: '这名候选人在投票前退出了竞选。'
  },
  5654: {
    zh: '认出；承认；认可', topic: 'people_society', cat: 'People & Society', specialist_book: null,
    example_ro: 'Ministrul a recunoscut că măsura a fost aplicată prea târziu.', example_zh: '部长承认这项措施实施得太晚。'
  },
  5722: { zh: '向前；以前；在……之前' },
  6104: { zh: '背痛；腰背痛' },
  6131: { zh: '工作；工作岗位；工作场所', example_zh: '一份稳定的工作让他更有安全感。' },
  6241: {
    zh: '集会；大会；集合', topic: 'people_society', cat: 'People & Society', specialist_book: null,
    example_ro: 'Adunarea generală va avea loc vineri.', example_zh: '全体大会将于周五举行。'
  },
  6294: { zh: '表面；面积' },
  6378: {
    zh: '扮演角色；发挥作用', example_ro: 'Investițiile joacă un rol important în creșterea economică.',
    example_zh: '投资在经济增长中发挥重要作用。'
  },
  6712: {
    zh: '专栏', ro: 'rubrică', ipa: 'rUbrică', hint: 's.f.: rubrici',
    example_ro: 'Scrie o rubrică săptămânală despre viața urbană.', example_zh: '他每周写一个关于城市生活的专栏。'
  },
  6796: {
    zh: '边防警察', ro: 'polițist de frontieră', ipa: 'polițIst de frontiEră',
    hint: 's.m./s.f.: polițiști / polițiste de frontieră',
    example_ro: 'Polițistul de frontieră patrulează zona noaptea.', example_zh: '边防警察夜间在边境地区巡逻。',
    learning_track: 'specialist'
  },
  6938: {
    zh: '幼崽；小鸡；鸡', frequency_rank: null, frequency_source: null, corpus_frequency: null,
    news_frequency: 0, news_document_count: 0, news_category_count: 0,
    learning_track: 'scenario_phrasebook', curation_reason: '名词 pui 与动词 a pune 的自动词元证据碰撞'
  },
  7146: { zh: '办公室；书桌', example_zh: '我在办公室工作到很晚。' },
  7400: { zh: '无气泡水；静水', example_zh: '我更喜欢无气泡水，不要气泡水。' },
  7439: { zh: '便条；笔记', example_zh: '我把地址写在一张便条上。' },
  7521: { zh: '独自的；一个人的；单身的' },
  7581: { zh: '地方；位置；座位' },
  7663: {
    zh: '转诊单', ro: 'bilet de trimitere', ipa: 'bilEt de trimitEre', hint: 's.n.: bilete de trimitere',
    example_ro: 'Medicul de familie mi-a dat un bilet de trimitere.', example_zh: '家庭医生给了我一张转诊单。',
    learning_track: 'scenario_phrasebook', specialist_book: 'specialist_health_medicine'
  },
  7887: { zh: '堵塞的；鼻塞的；低沉的', example_ro: 'Chiuveta este înfundată.', example_zh: '水槽堵住了。' },
  7901: {
    ro: 'aplică (lampă de perete)', zh: '壁灯', learning_track: 'scenario_phrasebook',
    frequency_rank: null, frequency_source: null, corpus_frequency: null,
    news_frequency: 0, news_document_count: 0, news_category_count: 0,
    curation_reason: '壁灯义与高频动词 a aplica 同形，移入生活场景词书'
  },
  7987: {
    zh: '完整的；全部的；全额地', example_ro: 'Raportul integral va fi publicat mâine.', example_zh: '完整报告将于明天发布。'
  },
  8037: { zh: '道路通行费' },
  8061: { zh: '通过；经由；借助；穿过' },
  8071: { zh: '一直；持续地；永久地' },
  8119: { zh: '改变；发生变化；换衣服', example_ro: 'Situația s-a schimbat rapid.', example_zh: '情况很快发生了变化。' },
  8626: { example_ro: 'Masa este la mijloc.', example_zh: '桌子在中间。' },
  8698: { zh: '睡觉时间', example_zh: '睡觉时间在午饭后。' }
}).map(([id, patch]) => [Number(id), patch]));

function normalizeKey(value) {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ro');
}

function difficultyFor(row) {
  if (row.learning_track === 'news_core' && Number(row.frequency_rank || 0) > 0 && Number(row.frequency_rank) <= 2000) return 'beginner';
  if (row.learning_track === 'news_core' || row.learning_track === 'news_extension') return 'intermediate';
  return 'advanced';
}

function naturalnessFor(word, row, wasCorrected) {
  if (wasCorrected) return 'revised';
  if (cloudVerifiedIds.has(Number(word.id)) || word.verification_status === 'verified' || word.grammar_data?.phrase_quality === 'core') return 'verified';
  return 'needs_review';
}

const beforeById = new Map(words.map(word => [Number(word.id), structuredClone(word)]));
const rebuilt = words.map(word => {
  const row = manifestById.get(Number(word.id));
  if (!row) throw new Error(`Missing manifest row for ${word.id}`);
  const correction = corrections.get(Number(word.id)) || {};
  const grammarPatch = correction.grammar_data || {};
  const phraseMetadataPatch = preservedPhraseMetadata.get(Number(word.id)) || {};
  const next = {
    ...word,
    ...row,
    ...correction,
    grammar_data: {
      ...(word.grammar_data || {}),
      ...grammarPatch,
      ...phraseMetadataPatch
    },
    corpus_snapshot: 'CoRoLa lemma v1 (2022) + MOROCO Romanian news (2018)',
    content_status: correction.content_status || row.content_status || 'active',
    naturalness_status: naturalnessFor(word, row, corrections.has(Number(word.id))),
    difficulty: difficultyFor({ ...row, ...correction }),
    verification_status: corrections.has(Number(word.id)) || cloudVerifiedIds.has(Number(word.id)) ? 'verified' : word.verification_status,
    source: corrections.has(Number(word.id))
      ? 'manual_curation_20260812'
      : (cloudVerifiedIds.has(Number(word.id)) ? 'admin_edit' : word.source)
  };
  if (correction.hint) next.grammar_data.raw_hint = correction.hint;
  if (Number(word.id) === 3202 || Number(word.id) === 3207) next.grammar_data.forms = correction.hint.replace(/^adj:\s*/, '');
  if (Number(word.id) === 3353 || Number(word.id) === 3445 || Number(word.id) === 4008) {
    next.grammar_data.plural = correction.hint.replace(/^.*?:\s*/, '');
    next.grammar_data.invariant = false;
  }
  next.grammar_data.part_of_speech = next.part_of_speech;
  return next;
});

const duplicateGroups = new Map();
for (const word of rebuilt) {
  const key = normalizeKey(word.ro);
  const ids = duplicateGroups.get(key) || [];
  ids.push(word.id);
  duplicateGroups.set(key, ids);
}
const duplicates = [...duplicateGroups.entries()].filter(([, ids]) => ids.length > 1);
if (duplicates.length) throw new Error(`Corrections created duplicate headwords: ${JSON.stringify(duplicates.slice(0, 5))}`);

const exportedAt = new Date().toISOString();
const output = JSON.stringify({ exportedAt, words: rebuilt }, null, 2) + '\n';
fs.writeFileSync(vocabPath, output);
fs.writeFileSync(appVocabPath, output);

const trackCounts = Object.fromEntries([...new Set(rebuilt.map(word => word.learning_track))]
  .sort()
  .map(track => [track, rebuilt.filter(word => word.learning_track === track).length]));
const collectionCounts = Object.fromEntries([...new Set(rebuilt.map(word => word.specialist_book).filter(Boolean))]
  .sort()
  .map(book => [book, rebuilt.filter(word => word.specialist_book === book).length]));
const correctionReport = [...corrections.keys()].sort((a, b) => a - b).map(id => {
  const before = beforeById.get(id);
  const after = rebuilt.find(word => Number(word.id) === id);
  return {
    id,
    before: { ro: before.ro, zh: before.zh, hint: before.hint, example_ro: before.example_ro },
    after: { ro: after.ro, zh: after.zh, hint: after.hint, example_ro: after.example_ro },
    preservedWordId: true
  };
});
const report = {
  generatedAt: exportedAt,
  corpusEvidence: manifest.generatedFrom,
  totalWords: rebuilt.length,
  trackCounts,
  collectionCounts,
  naturalnessCounts: Object.fromEntries(['verified', 'revised', 'corpus_attested', 'needs_review']
    .map(status => [status, rebuilt.filter(word => word.naturalness_status === status).length])),
  frequencyCoverage: {
    rankedSingleWords: rebuilt.filter(word => word.frequency_rank).length,
    newsAttestedEntries: rebuilt.filter(word => word.news_document_count > 0).length
  },
  corrections: correctionReport
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
const adversarialReport = {
  generatedAt: exportedAt,
  verdict: 'initial lemma-only core assignment falsified and corrected',
  correctedStableIds: correctionReport.length,
  trackCounts,
  retiredNaturalnessClaim: 'Automatic frequency evidence no longer sets naturalness_status=corpus_attested.',
  regressionAnchors: [4172, 5377, 6321, 6938, 7901],
  corrections: correctionReport
};
fs.writeFileSync(adversarialReportPath, JSON.stringify(adversarialReport, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
