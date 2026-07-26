// Romanian display helpers. This module is pure and must not access app state or the DOM.
(function initRomanianText(global) {
  const RO_VOWELS = 'aeiouăâîAEIOUĂÂÎ';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    })[char]);
  }

  function isRoVowel(char) {
    return RO_VOWELS.includes(char);
  }

  function autoStressToken(token) {
    const groups = [];
    let start = -1;
    for (let index = 0; index < token.length; index++) {
      if (isRoVowel(token[index])) {
        if (start === -1) start = index;
      } else if (start !== -1) {
        groups.push({ start, end: index });
        start = -1;
      }
    }
    if (start !== -1) groups.push({ start, end: token.length });
    if (!groups.length) return token;

    const target = groups[Math.max(0, groups.length - 2)];
    return token
      .split('')
      .map((char, index) => (index >= target.start && index < target.end ? char.toUpperCase() : char))
      .join('');
  }

  function autoStressWord(value) {
    return String(value || '')
      .split(/([\s-]+)/)
      .map(part => (/^[\s-]+$/.test(part) ? part : autoStressToken(part)))
      .join('');
  }

  function getStressDisplay(word) {
    const manual = String(word?.ipa || '').trim();
    return manual
      ? { text: manual, auto: false }
      : { text: autoStressWord(word?.ro || ''), auto: true };
  }

  function normalizeStressText(value) {
    return String(value || '').replace(/^\/|\/$/g, '').replace(/[ˌ']/g, '').trim();
  }

  function lowerRo(value) {
    return String(value || '').toLocaleLowerCase('ro');
  }

  function underlineTokenByUppercase(token) {
    const chars = [...token];
    const upperIndexes = chars
      .map((char, index) => (/[A-ZĂÂÎȘȚ]/.test(char) ? index : -1))
      .filter(index => index >= 0);
    if (!upperIndexes.length) return escapeHtml(lowerRo(token));

    const start = upperIndexes[0];
    const end = upperIndexes[upperIndexes.length - 1] + 1;
    return `${escapeHtml(lowerRo(chars.slice(0, start).join('')))}<span class="stress-mark">${escapeHtml(lowerRo(chars.slice(start, end).join('')))}</span>${escapeHtml(lowerRo(chars.slice(end).join('')))}`;
  }

  function underlineTokenByStressMark(token) {
    const markerIndex = token.indexOf('ˈ');
    if (markerIndex < 0) return underlineTokenByUppercase(token);
    const chars = [...token.replace('ˈ', '')];
    const start = [...token.slice(0, markerIndex)].length;
    let end = chars.length;
    for (let index = start + 1; index < chars.length; index++) {
      if (/[-.\s/]/.test(chars[index])) {
        end = index;
        break;
      }
    }
    return `${escapeHtml(lowerRo(chars.slice(0, start).join('')))}<span class="stress-mark">${escapeHtml(lowerRo(chars.slice(start, end).join('')))}</span>${escapeHtml(lowerRo(chars.slice(end).join('')))}`;
  }

  function stressToHtml(text) {
    const normalized = normalizeStressText(text);
    if (!normalized) return '';
    return normalized
      .split(/(\s+)/)
      .map(part => (/^\s+$/.test(part) ? part : underlineTokenByStressMark(part)))
      .join('');
  }

  function inferGrammarInfo(word) {
    const category = String(word?.cat || '');
    const romanian = lowerRo(word?.ro);
    if (category.includes('动词')) return '动词 · 变位待补充';
    if (category.includes('形容词')) return '形容词';
    if (category.includes('副词')) return '副词';
    if (category.includes('介词')) return '介词';
    if (category.includes('连词') || category.includes('连接词')) return '连词';
    if (category.includes('代词')) return '代词';
    if (category.includes('数词')) return '数词';
    if (category.includes('感叹')) return '感叹词';
    if (/(a|ea|e|i|î)$/.test(romanian) && category.includes('动')) return '动词 · 变位待补充';
    return '名词 · 复数待补充';
  }

  function getGrammarInfo(word) {
    const taxonomy = global.RomanianVocabTaxonomy;
    if (taxonomy?.formatGrammarInfo) return taxonomy.formatGrammarInfo(word);
    return String(word?.grammar_note || word?.grammar || word?.forms || word?.hint || '').trim() || inferGrammarInfo(word);
  }

  global.RomanianVocabText = Object.freeze({
    autoStressToken,
    autoStressWord,
    getStressDisplay,
    normalizeStressText,
    lowerRo,
    stressToHtml,
    inferGrammarInfo,
    getGrammarInfo
  });
})(typeof window !== 'undefined' ? window : globalThis);
