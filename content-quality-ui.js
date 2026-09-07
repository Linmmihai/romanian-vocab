(function (root, factory) {
  const quality = root?.RomanianVocabContentQuality ||
    (typeof require === 'function' ? require('./content-quality.js') : null);
  const api = factory(quality);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RomanianVocabContentQualityUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (quality) {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  function ensureStyles(documentRef) {
    if (!documentRef?.head || documentRef.getElementById('content-quality-styles')) return;
    const style = documentRef.createElement('style');
    style.id = 'content-quality-styles';
    style.textContent = `
      .content-scope-control{margin-top:12px;padding-top:12px;border-top:1px solid var(--border)}
      .content-scope-control select{width:100%;padding:9px 10px;border:1px solid var(--border2);border-radius:var(--radius-sm);background:var(--bg);color:var(--text)}
      .content-quality-summary{margin-top:7px;font-size:12px;line-height:1.55;color:var(--text2)}
      .content-quality-detail{margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2)}
      .content-quality-title{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:14px;font-weight:800;margin-bottom:10px}
      .content-quality-badge{font-size:11px;padding:3px 8px;border-radius:99px;background:var(--yellow-bg);color:var(--yellow-text);white-space:nowrap}
      .content-quality-badge.trusted{background:var(--green-bg);color:var(--green-text)}
      .content-quality-dimensions{display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:7px}
      .content-quality-dimension{padding:8px;border-radius:var(--radius-sm);background:var(--bg)}
      .content-quality-dimension-label{font-size:11px;color:var(--text2);margin-bottom:3px}
      .content-quality-dimension-value{font-size:12px;font-weight:700}
      .content-quality-evidence{display:grid;gap:5px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:12px;line-height:1.45}
      .content-quality-evidence-row{display:grid;grid-template-columns:72px minmax(0,1fr);gap:8px}
      .content-quality-evidence-label{color:var(--text2)}
      .content-quality-evidence-value{overflow-wrap:anywhere}
    `;
    documentRef.head.appendChild(style);
  }

  function scopeSummaryText(summary) {
    if (!summary) return '';
    const base = `本词书已核对 ${summary.trustedCount}/${summary.totalCount} 个。`;
    if (summary.scope !== 'trusted') return `${base}全部内容可进入新词。`;
    if (!summary.trustedCount) {
      const retained = summary.retainedProgressCount
        ? `仍保留 ${summary.retainedProgressCount} 个已有进度${summary.retainedDueCount ? `，其中 ${summary.retainedDueCount} 个已到期` : ''}。`
        : '已有进度和到期复习仍会保留。';
      return `${base}暂无可用的已核对新词；${retained}`;
    }
    const retained = summary.retainedProgressCount
      ? `另保留 ${summary.retainedProgressCount} 个已有进度${summary.retainedDueCount ? `，其中 ${summary.retainedDueCount} 个已到期` : ''}。`
      : '';
    return `${base}${retained}未核对内容不会作为新词出现。`;
  }

  function mountLearningScopeControl(options = {}) {
    const documentRef = options.document || (typeof document !== 'undefined' ? document : null);
    if (!documentRef || !quality) return null;
    ensureStyles(documentRef);
    let container = documentRef.getElementById('learning-content-scope-control');
    if (!container) {
      const anchor = documentRef.getElementById('learning-collection-note');
      if (!anchor?.parentNode) return null;
      container = documentRef.createElement('div');
      container.id = 'learning-content-scope-control';
      container.className = 'content-scope-control';
      container.innerHTML = `
        <div class="cat-panel-title">内容范围</div>
        <select id="learning-content-scope-select" aria-label="选择学习内容范围">
          ${quality.CONTENT_SCOPE_OPTIONS.map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('')}
        </select>
        <div class="content-quality-summary" id="learning-content-scope-summary" aria-live="polite"></div>`;
      anchor.insertAdjacentElement('afterend', container);
      const select = container.querySelector('#learning-content-scope-select');
      select?.addEventListener('change', async event => {
        select.disabled = true;
        try {
          await options.onChange?.(event.target.value);
        } finally {
          select.disabled = false;
        }
      });
    }
    updateLearningScopeControl({
      document: documentRef,
      scope: options.scope,
      summary: options.summary
    });
    return container;
  }

  function updateLearningScopeControl(options = {}) {
    const documentRef = options.document || (typeof document !== 'undefined' ? document : null);
    if (!documentRef) return;
    const select = documentRef.getElementById('learning-content-scope-select');
    if (select) select.value = quality.normalizeContentScope(options.scope);
    const summary = documentRef.getElementById('learning-content-scope-summary');
    if (summary) summary.textContent = scopeSummaryText(options.summary);
  }

  function renderWordQualityDetail(word) {
    if (!quality) return '';
    const report = quality.getWordQuality(word);
    const evidenceRows = [
      ['内容来源', report.evidence.source],
      ['依据方法', report.evidence.evidenceMethod],
      ['收录原因', report.evidence.curationReason],
      ['语料快照', report.evidence.corpusSnapshot],
      ['频率来源', report.evidence.frequencySource],
      ['审阅人', report.evidence.reviewer],
      ['审阅时间', report.evidence.reviewedAt]
    ].filter(([, value], index) => value || index >= 5);
    return `<div class="content-quality-detail">
      <div class="content-quality-title">
        <span>内容核对</span>
        <span class="content-quality-badge${report.trusted ? ' trusted' : ''}">${escapeHtml(report.eligibilityLabel)}</span>
      </div>
      <div class="content-quality-dimensions">
        ${report.dimensions.map(dimension => `<div class="content-quality-dimension">
          <div class="content-quality-dimension-label">${escapeHtml(dimension.label)}</div>
          <div class="content-quality-dimension-value">${escapeHtml(dimension.statusLabel)}</div>
        </div>`).join('')}
      </div>
      <div class="content-quality-evidence">
        ${evidenceRows.map(([label, value]) => `<div class="content-quality-evidence-row"><span class="content-quality-evidence-label">${escapeHtml(label)}</span><span class="content-quality-evidence-value">${escapeHtml(value)}</span></div>`).join('')}
      </div>
    </div>`;
  }

  return Object.freeze({
    escapeHtml,
    scopeSummaryText,
    mountLearningScopeControl,
    updateLearningScopeControl,
    renderWordQualityDetail
  });
});
