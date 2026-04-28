// ============================================================
//  api.js — 所有 Supabase 数据库操作
//  如需修改数据库逻辑，只改这个文件
// ============================================================

const SUPA_URL = 'https://wuiblzpyhcjxevotwcqz.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1aWJsenB5aGNqeGV2b3R3Y3F6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMjg3NTksImV4cCI6MjA5MjcwNDc1OX0.ImJ1yH8v0op6_5G2P4fI--uJG8LOXIPt-JujPCzeN54';

// 初始化 Supabase 客户端（由 index.html 的 CDN script 提供 supabase 全局变量）
const sb = supabase.createClient(SUPA_URL, SUPA_KEY);

// ── 词库 ──────────────────────────────────────────────────

/**
 * 从数据库加载全部词汇（自动分页，支持超过1000条）
 * @returns {Promise<Array>} 词汇数组
 */
async function apiLoadWords() {
  let all = [], from = 0;
  while (true) {
    const { data, error } = await sb.from('words').select('*').order('id').range(from, from + 999);
    if (error || !data || !data.length) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

/**
 * 更新一个词条
 * @param {number} wordId
 * @param {object} updates - { zh, ro, ipa, hint, cat }
 */
async function apiUpdateWord(wordId, updates) {
  const { error } = await sb.from('words').update(updates).eq('id', wordId);
  if (error) throw new Error(error.message);
}

// ── 学习进度 ──────────────────────────────────────────────

/**
 * 加载当前用户的所有学习进度
 * @param {string} userId
 * @returns {Promise<object>} { word_ro: { known, qr, qt } }
 */
async function apiLoadProgress(userId) {
  const { data } = await sb.from('progress').select('*').eq('user_id', userId);
  const map = {};
  (data || []).forEach(r => {
    map[r.word_ro] = { known: r.known, qr: r.quiz_right, qt: r.quiz_total };
  });
  return map;
}

/**
 * 保存/更新一个词的学习进度
 * @param {string} userId
 * @param {string} wordRo
 * @param {boolean} known
 * @param {number} qr - 答对次数
 * @param {number} qt - 总答题次数
 */
async function apiSaveProgress(userId, wordRo, known, qr, qt) {
  const { error } = await sb.from('progress').upsert(
    { user_id: userId, word_ro: wordRo, known, quiz_right: qr || 0, quiz_total: qt || 0, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,word_ro' }
  );
  if (error) throw new Error(error.message);
}

// ── 报错反馈 ──────────────────────────────────────────────

/**
 * 提交一条用户报错
 */
async function apiSubmitReport({ wordId, wordRo, wordZh, reporterId, reporterEmail, issueType, note }) {
  const { error } = await sb.from('word_reports').insert({
    word_id: wordId, word_ro: wordRo, word_zh: wordZh,
    reporter_id: reporterId, reporter_email: reporterEmail,
    issue_type: issueType, note: note || null, status: 'pending'
  });
  if (error) throw new Error(error.message);
}

/**
 * 加载所有报错记录（管理员用）
 */
async function apiLoadReports() {
  const { data, error } = await sb.from('word_reports').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * 标记一条报错为已解决
 */
async function apiResolveReport(reportId) {
  const { error } = await sb.from('word_reports').update({ status: 'resolved' }).eq('id', reportId);
  if (error) throw new Error(error.message);
}

/**
 * 获取待处理报错数量
 */
async function apiPendingReportCount() {
  const { count } = await sb.from('word_reports').select('*', { count: 'exact', head: true }).eq('status', 'pending');
  return count || 0;
}

// ── 用户管理 ──────────────────────────────────────────────

/**
 * 加载所有用户资料（管理员用）
 */
async function apiLoadUsers() {
  const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * 获取单个用户的 profile
 */
async function apiGetProfile(userId) {
  const { data } = await sb.from('profiles').select('*').eq('id', userId).single();
  return data;
}

/**
 * 设置用户角色
 */
async function apiSetUserRole(userId, role) {
  const { error } = await sb.from('profiles').update({ role }).eq('id', userId);
  if (error) throw new Error(error.message);
}

/**
 * 更新用户昵称
 */
async function apiUpdateNickname(userId, nickname) {
  const { error } = await sb.from('profiles').update({ nickname }).eq('id', userId);
  if (error) throw new Error(error.message);
}
