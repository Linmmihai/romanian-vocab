// Vocabulary taxonomy and data-quality helpers.
// Pure module: no DOM access and no application state.
(function initVocabularyTaxonomy(global) {
  const TOPICS = Object.freeze([
    { value: 'daily_life', label: '日常与个人生活' },
    { value: 'people_society', label: '人际与社会' },
    { value: 'education_language', label: '教育与语言' },
    { value: 'work_management', label: '工作与管理' },
    { value: 'economics_finance', label: '经济与金融' },
    { value: 'law_public_affairs', label: '法律与公共事务' },
    { value: 'health_medicine', label: '健康与医学' },
    { value: 'nature_agriculture', label: '自然与农业' },
    { value: 'science_technology', label: '科学与技术' },
    { value: 'history_culture_arts', label: '历史、文化与艺术' },
    { value: 'philosophy_abstract', label: '哲学与抽象概念' },
    { value: 'defense_security', label: '国防与安全' },
    { value: 'unclassified', label: '待归类' }
  ]);

  const PARTS_OF_SPEECH = Object.freeze([
    { value: 'noun', label: '名词' },
    { value: 'verb', label: '动词' },
    { value: 'adjective', label: '形容词' },
    { value: 'adverb', label: '副词' },
    { value: 'pronoun', label: '代词' },
    { value: 'preposition', label: '介词' },
    { value: 'conjunction', label: '连词' },
    { value: 'numeral', label: '数词' },
    { value: 'interjection', label: '感叹词' },
    { value: 'expression', label: '固定表达' },
    { value: 'proper_noun', label: '专有名称' },
    { value: 'other', label: '词性待核对' }
  ]);

  const UNIT_TYPES = Object.freeze([
    { value: 'word', label: '单词' },
    { value: 'verb_phrase', label: '动词短语' },
    { value: 'collocation', label: '搭配' },
    { value: 'expression', label: '固定表达' },
    { value: 'sentence_pattern', label: '句型' },
    { value: 'term', label: '术语' },
    { value: 'proper_name', label: '专名' }
  ]);

  const REGISTERS = Object.freeze([
    { value: 'neutral', label: '中性语域' },
    { value: 'formal', label: '正式' },
    { value: 'informal', label: '非正式' },
    { value: 'colloquial', label: '口语' },
    { value: 'literary', label: '书面或文学' },
    { value: 'technical', label: '专业' }
  ]);

  const CEFR_LEVELS = Object.freeze(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
  const VERIFICATION_STATUSES = Object.freeze(['verified', 'imported', 'needs_review']);
  const topicValues = new Set(TOPICS.map(item => item.value));
  const posValues = new Set(PARTS_OF_SPEECH.map(item => item.value));
  const unitValues = new Set(UNIT_TYPES.map(item => item.value));
  const registerValues = new Set(REGISTERS.map(item => item.value));

  const TOPIC_ALIASES = Object.freeze({
    'daily life': 'daily_life',
    'daily_life': 'daily_life',
    '日常': 'daily_life',
    '日常生活': 'daily_life',
    '生活': 'daily_life',
    '城市': 'daily_life',
    '地理': 'daily_life',
    '方向': 'daily_life',
    '家居': 'daily_life',
    '饮食': 'daily_life',
    '运动': 'daily_life',
    '时间': 'daily_life',
    '时间2': 'daily_life',
    '交通': 'daily_life',
    '旅行': 'daily_life',
    '旅游': 'daily_life',
    '烹饪': 'daily_life',
    '游戏': 'daily_life',
    'people_society': 'people_society',
    '人际': 'people_society',
    '社会': 'people_society',
    '情感': 'people_society',
    'education': 'education_language',
    'education_language': 'education_language',
    '学习': 'education_language',
    '教育': 'education_language',
    '语言': 'education_language',
    'verb': 'education_language',
    'adjective': 'education_language',
    'adverb': 'education_language',
    'conjunction': 'education_language',
    'preposition': 'education_language',
    'pronoun': 'education_language',
    'numeral': 'education_language',
    'interjection': 'education_language',
    '动词': 'education_language',
    '动词2': 'education_language',
    '形容词': 'education_language',
    '形容词2': 'education_language',
    '副词': 'education_language',
    '连词': 'education_language',
    '连接词': 'education_language',
    '介词': 'education_language',
    '代词': 'education_language',
    '数词': 'education_language',
    '感叹词': 'education_language',
    'management': 'work_management',
    'work_management': 'work_management',
    '职场': 'work_management',
    '管理': 'work_management',
    'economics': 'economics_finance',
    'economics_finance': 'economics_finance',
    '购物': 'economics_finance',
    '商业': 'economics_finance',
    '金融': 'economics_finance',
    '经济': 'economics_finance',
    'law': 'law_public_affairs',
    'law_public_affairs': 'law_public_affairs',
    '法律': 'law_public_affairs',
    'medicine': 'health_medicine',
    'health_medicine': 'health_medicine',
    '健康': 'health_medicine',
    '医疗': 'health_medicine',
    '医学': 'health_medicine',
    '身体': 'health_medicine',
    'agriculture': 'nature_agriculture',
    'nature_agriculture': 'nature_agriculture',
    '农业': 'nature_agriculture',
    '自然': 'nature_agriculture',
    '环境': 'nature_agriculture',
    '季节': 'nature_agriculture',
    '天气': 'nature_agriculture',
    'science': 'science_technology',
    'engineering': 'science_technology',
    'science_technology': 'science_technology',
    '科技': 'science_technology',
    '技术': 'science_technology',
    '科学': 'science_technology',
    'literature': 'history_culture_arts',
    'history': 'history_culture_arts',
    'art': 'history_culture_arts',
    'history_culture_arts': 'history_culture_arts',
    '文学': 'history_culture_arts',
    '历史': 'history_culture_arts',
    '艺术': 'history_culture_arts',
    '文化': 'history_culture_arts',
    'philosophy': 'philosophy_abstract',
    'philosophy_abstract': 'philosophy_abstract',
    '哲学': 'philosophy_abstract',
    'military science': 'defense_security',
    'defense_security': 'defense_security',
    '军事': 'defense_security',
    '军队': 'defense_security',
    '其他': 'unclassified',
    'other': 'unclassified',
    'clasificare': 'unclassified',
    '分类': 'unclassified',
    'unclassified': 'unclassified',
    '待归类': 'unclassified'
  });

  const POS_ALIASES = Object.freeze({
    noun: 'noun',
    substantive: 'noun',
    名词: 'noun',
    verb: 'verb',
    动词: 'verb',
    adjective: 'adjective',
    adj: 'adjective',
    形容词: 'adjective',
    adverb: 'adverb',
    adv: 'adverb',
    副词: 'adverb',
    pronoun: 'pronoun',
    pron: 'pronoun',
    代词: 'pronoun',
    preposition: 'preposition',
    prep: 'preposition',
    介词: 'preposition',
    conjunction: 'conjunction',
    conj: 'conjunction',
    连词: 'conjunction',
    numeral: 'numeral',
    num: 'numeral',
    数词: 'numeral',
    interjection: 'interjection',
    interj: 'interjection',
    感叹词: 'interjection',
    expression: 'expression',
    expr: 'expression',
    固定表达: 'expression',
    proper_noun: 'proper_noun',
    专有名称: 'proper_noun',
    other: 'other',
    待核对: 'other'
  });

  const UNIT_ALIASES = Object.freeze({
    word: 'word',
    单词: 'word',
    lemma: 'word',
    verb_phrase: 'verb_phrase',
    动词短语: 'verb_phrase',
    collocation: 'collocation',
    搭配: 'collocation',
    expression: 'expression',
    固定表达: 'expression',
    sentence_pattern: 'sentence_pattern',
    句型: 'sentence_pattern',
    term: 'term',
    术语: 'term',
    proper_name: 'proper_name',
    专名: 'proper_name'
  });

  function clean(value) {
    return String(value ?? '').normalize('NFC').trim();
  }

  function lower(value) {
    return clean(value).toLocaleLowerCase('ro');
  }

  function safeObject(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return { ...value };
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch {}
    }
    return {};
  }

  function labelFor(items, value, fallback = '') {
    return items.find(item => item.value === value)?.label || fallback || clean(value);
  }

  function getTopicLabel(value) {
    return labelFor(TOPICS, normalizeTopic(value), '待归类');
  }

  function getPartOfSpeechLabel(value) {
    return labelFor(PARTS_OF_SPEECH, value, '词性待核对');
  }

  function getUnitTypeLabel(value) {
    return labelFor(UNIT_TYPES, value, '词汇单位');
  }

  function getRegisterLabel(value) {
    return labelFor(REGISTERS, value, '');
  }

  function normalizeTopic(value, word = null) {
    const raw = clean(value || word?.topic || word?.cat);
    if (topicValues.has(raw)) return raw;
    return TOPIC_ALIASES[lower(raw)] || TOPIC_ALIASES[raw] || 'unclassified';
  }

  function normalizeExplicitPartOfSpeech(value) {
    const raw = clean(value);
    if (posValues.has(raw)) return raw;
    return POS_ALIASES[lower(raw)] || POS_ALIASES[raw] || '';
  }

  function normalizePartOfSpeech(value, word = null) {
    const provided = normalizeExplicitPartOfSpeech(
      value || word?.part_of_speech || word?.partOfSpeech || safeObject(word?.grammar_data || word?.grammarData).part_of_speech
    );
    if (provided) return provided;

    const categoryPos = normalizeExplicitPartOfSpeech(word?.rawCat || word?.cat);
    if (categoryPos) return categoryPos;

    const hint = lower(word?.hint || word?.grammar_note || word?.grammar);
    const romanian = lower(word?.ro);
    if (/^s\.[fmn](?:\.pl)?\.?\s*[:(]/.test(hint)) return 'noun';
    if (/^(verb|vb\.?)\b/.test(hint) || /动词|变位/.test(hint)) return 'verb';
    if (/^(loc\.\s*)?adj\.?\b/.test(hint)) return 'adjective';
    if (/^(loc\.\s*)?(adv\.?|adverb)\b/.test(hint)) return 'adverb';
    if (/^(locuțiune\s+)?conjunc/.test(hint) || /^conj\.?\b/.test(hint)) return 'conjunction';
    if (/^(locuțiune\s+)?prepozi/.test(hint) || /^(loc\.\s*)?prep\.?\b/.test(hint)) return 'preposition';
    if (/^pron(ume)?\.?\b/.test(hint)) return 'pronoun';
    if (/^numeral\b|^num\.?\b/.test(hint)) return 'numeral';
    if (/^interjec/.test(hint)) return 'interjection';
    if (/^(expr\.?|expresie)\b|^=\s*/.test(hint) || /^loc\.\s*(lat|conj)\./.test(hint)) return 'expression';
    if (/艺术风格/.test(hint) || /^[A-ZĂÂÎȘȚ][\p{L}-]+$/u.test(clean(word?.ro))) return 'proper_noun';
    if (/^a\s+(?:se\s+)?\p{L}+(?:-\p{L}+)?$/u.test(romanian)) return 'verb';
    return 'other';
  }

  function normalizeUnitType(value, word = null, partOfSpeech = '') {
    const raw = clean(value || word?.unit_type || word?.unitType);
    const provided = unitValues.has(raw) ? raw : (UNIT_ALIASES[lower(raw)] || UNIT_ALIASES[raw]);
    if (provided) return provided;

    const pos = partOfSpeech || normalizePartOfSpeech('', word);
    const romanian = lower(word?.ro);
    const hint = lower(word?.hint);
    const tokens = romanian.split(/\s+/).filter(Boolean);
    if (pos === 'proper_noun') return 'proper_name';
    if (pos === 'expression' || /locuțiune|invariabil/.test(hint) && tokens.length > 1) return 'expression';
    if (pos === 'verb') {
      if (/^a\s+(?:se\s+)?\p{L}+(?:-\p{L}+)?$/u.test(romanian)) return 'word';
      return 'verb_phrase';
    }
    if (tokens.length <= 1) return 'word';
    if (['adverb', 'preposition', 'conjunction', 'interjection'].includes(pos)) return 'expression';
    if (/[.…]/.test(romanian) || tokens.length > 8) return 'sentence_pattern';
    return 'term';
  }

  function afterFirstColon(value) {
    const text = clean(value);
    const index = text.indexOf(':');
    return index >= 0 ? text.slice(index + 1).trim() : '';
  }

  function normalizeGrammarData(value, word = null, partOfSpeech = '') {
    const original = safeObject(value || word?.grammar_data || word?.grammarData);
    const pos = partOfSpeech || normalizePartOfSpeech(original.part_of_speech, word);
    const hint = clean(word?.hint || original.raw_hint || original.raw);
    const hintLower = lower(hint);
    const data = {
      ...original,
      part_of_speech: pos,
      raw_hint: clean(original.raw_hint || original.raw || hint)
    };

    if (pos === 'noun') {
      const noun = hintLower.match(/^s\.([fmn])(\.pl)?\.?\s*:/);
      const genderMap = { f: 'feminine', m: 'masculine', n: 'neuter' };
      if (!data.gender && noun) data.gender = genderMap[noun[1]];
      if (!data.number) data.number = noun?.[2] ? 'plural' : 'singular';
      const form = afterFirstColon(hint);
      const noPlural = /fără plural|invariabil/i.test(form);
      if (data.number === 'plural') {
        data.plural_only = true;
        data.invariant = false;
        delete data.plural;
      } else if (noPlural) {
        data.invariant = true;
        delete data.plural;
      } else if (form && !data.plural) {
        data.plural = form;
      }
    } else if (pos === 'verb') {
      data.reflexive = typeof data.reflexive === 'boolean'
        ? data.reflexive
        : /^a\s+se\s+/i.test(clean(word?.ro));
      const conjugation = hint.match(/conj\.\s*(I{1,3}|IV)\b/i);
      if (!data.conjugation && conjugation) data.conjugation = conjugation[1].toUpperCase();
      const forms = hint.match(/\(([^()]+)\)\s*$/);
      if (!data.forms && forms) data.forms = forms[1].trim();
      const pattern = hint.match(/(-(?:esc|ează|ez|ăsc|uiesc))\b/i);
      if (!data.pattern && pattern) data.pattern = pattern[1];
      if (!data.forms && /零变位/.test(hint)) data.forms_pending_review = true;
    } else if (pos === 'adjective') {
      const forms = afterFirstColon(hint);
      if (!data.forms && forms) data.forms = forms;
    } else if (['adverb', 'preposition', 'conjunction', 'interjection', 'expression'].includes(pos)) {
      data.invariant = data.invariant !== false;
      if (!data.subtype && hint && !/^(adv\.?|adverb)$/i.test(hint)) data.subtype = hint;
    } else if (pos === 'pronoun' || pos === 'numeral') {
      if (!data.subtype && hint) data.subtype = hint;
    }
    return data;
  }

  function normalizeCefr(value) {
    const normalized = clean(value).toUpperCase();
    return CEFR_LEVELS.includes(normalized) ? normalized : '';
  }

  function normalizeRegister(value) {
    const normalized = lower(value);
    return registerValues.has(normalized) ? normalized : '';
  }

  function normalizeVerificationStatus(value) {
    const normalized = lower(value);
    return VERIFICATION_STATUSES.includes(normalized) ? normalized : 'imported';
  }

  function formatGrammarInfo(word) {
    const pos = normalizePartOfSpeech('', word);
    const grammar = normalizeGrammarData(null, word, pos);
    const posLabel = getPartOfSpeechLabel(pos);
    const parts = [];

    if (pos === 'noun') {
      const genderLabels = { feminine: '阴性名词', masculine: '阳性名词', neuter: '中性名词' };
      parts.push(genderLabels[grammar.gender] || '名词');
      if (grammar.number === 'plural' || grammar.plural_only) parts.push('复数形式');
      else if (grammar.plural) parts.push(`复数 ${grammar.plural}`);
      else if (grammar.invariant) parts.push('通常不使用复数');
    } else if (pos === 'verb') {
      parts.push('动词');
      if (grammar.reflexive) parts.push('反身');
      if (grammar.conjugation) parts.push(`第 ${grammar.conjugation} 变位`);
      if (grammar.pattern) parts.push(`${grammar.pattern} 型`);
      if (grammar.forms) parts.push(grammar.forms);
      else if (grammar.forms_pending_review) parts.push('变位形式待核对');
    } else if (pos === 'adjective') {
      parts.push('形容词');
      if (grammar.forms) parts.push(grammar.forms);
    } else {
      parts.push(posLabel);
      if (grammar.subtype && lower(grammar.subtype) !== lower(posLabel)) parts.push(grammar.subtype);
    }

    return parts.filter(Boolean).join(' · ') || '语法待核对';
  }

  function looksLikeTemplateWord(word) {
    const ro = clean(word?.ro);
    const zh = clean(word?.zh);
    const ipa = lower(word?.ipa);
    const hint = lower(word?.hint);
    const category = lower(word?.cat || word?.topic);
    return /[\u3400-\u9fff]/u.test(ro) ||
      /^#\s*格式/.test(zh) ||
      ['汉字', '中文'].includes(zh) ||
      ['accent', '重音标记'].includes(ipa) ||
      ['informație gramaticală', '语法信息'].includes(hint) ||
      ['clasificare', '分类'].includes(category);
  }

  function normalizedWordKey(value) {
    return lower(value);
  }

  function normalizeWord(word) {
    const topic = normalizeTopic(word?.topic || word?.cat, word);
    const partOfSpeech = normalizePartOfSpeech(word?.part_of_speech || word?.partOfSpeech, word);
    const unitType = normalizeUnitType(word?.unit_type || word?.unitType, word, partOfSpeech);
    const grammarData = normalizeGrammarData(word?.grammar_data || word?.grammarData, word, partOfSpeech);
    return {
      ...word,
      topic,
      part_of_speech: partOfSpeech,
      partOfSpeech,
      unit_type: unitType,
      unitType,
      grammar_data: grammarData,
      grammarData,
      cefr: normalizeCefr(word?.cefr),
      register: normalizeRegister(word?.register),
      verification_status: normalizeVerificationStatus(word?.verification_status || word?.verificationStatus),
      source: clean(word?.source || 'legacy_import')
    };
  }

  function qualityIssues(word) {
    const normalized = normalizeWord(word || {});
    const issues = [];
    if (!clean(normalized.ro)) issues.push('missing_ro');
    if (!clean(normalized.zh)) issues.push('missing_zh');
    if (!clean(normalized.ipa)) issues.push('missing_stress');
    if (!clean(normalized.hint) && normalized.part_of_speech === 'other') issues.push('missing_grammar');
    if (!clean(normalized.example_ro)) issues.push('missing_example_ro');
    if (!clean(normalized.example_zh)) issues.push('missing_example_zh');
    if (looksLikeTemplateWord(normalized)) issues.push('template_row');
    if (normalized.topic === 'unclassified') issues.push('unclassified_topic');
    if (normalized.part_of_speech === 'other') issues.push('unclassified_pos');
    if (/^s\.[fmn]\.pl\.?\s*:/i.test(clean(normalized.hint)) && /fără plural/i.test(clean(normalized.hint))) {
      issues.push('plural_contradiction');
    }
    if (normalized.verification_status === 'needs_review') issues.push('needs_review');
    return [...new Set(issues)];
  }

  function getClassificationSummary(word, options = {}) {
    const normalized = normalizeWord(word || {});
    const parts = [
      getTopicLabel(normalized.topic),
      getPartOfSpeechLabel(normalized.part_of_speech)
    ];
    if (options.includeUnit && normalized.unit_type !== 'word') parts.push(getUnitTypeLabel(normalized.unit_type));
    if (options.includeCefr && normalized.cefr) parts.push(normalized.cefr);
    return parts.filter(Boolean).join(' · ');
  }

  global.RomanianVocabTaxonomy = Object.freeze({
    TOPICS,
    PARTS_OF_SPEECH,
    UNIT_TYPES,
    REGISTERS,
    CEFR_LEVELS,
    VERIFICATION_STATUSES,
    normalizeTopic,
    normalizePartOfSpeech,
    normalizeUnitType,
    normalizeGrammarData,
    normalizeCefr,
    normalizeRegister,
    normalizeVerificationStatus,
    normalizeWord,
    formatGrammarInfo,
    getTopicLabel,
    getPartOfSpeechLabel,
    getUnitTypeLabel,
    getRegisterLabel,
    getClassificationSummary,
    looksLikeTemplateWord,
    normalizedWordKey,
    qualityIssues
  });
})(typeof window !== 'undefined' ? window : globalThis);
