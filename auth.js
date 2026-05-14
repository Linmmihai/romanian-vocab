// ============================================================
//  auth.js — 登录 / 注册 / 登出 / 会话管理
//  如需修改登录逻辑，只改这个文件
// ============================================================

/**
 * 切换登录/注册标签
 */
function showAuthTab(tab) {
  document.querySelectorAll('#auth-card .auth-tabs .auth-tab').forEach((b, i) =>
    b.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'signup'))
  );
  document.getElementById('login-form').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('signup-form').style.display = tab === 'signup' ? 'block' : 'none';
  document.getElementById('auth-msg').className = 'auth-msg';
}

function showAuthMsg(msg, type) {
  const el = document.getElementById('auth-msg');
  el.textContent = msg;
  el.className = 'auth-msg ' + type;
}

function isFileApp() {
  return window.location.protocol === 'file:';
}

function authErrorMessage(error) {
  const raw = String(error?.message || error || '未知错误');
  if (isFileApp()) {
    return '当前是从本地文件打开的页面，登录可能被浏览器拦截。请用 http://127.0.0.1:4173/ 打开应用后再登录。';
  }
  if (/Failed to fetch|NetworkError|fetch/i.test(raw)) {
    return '网络连接失败，请确认当前页面是 http://127.0.0.1:4173/ 或正式网站，并检查网络后重试。';
  }
  return raw;
}

async function doOfflineLogin() {
  localStorage.setItem('offline-mode', '1');
  await onLogin({
    id: OFFLINE_USER_ID,
    email: 'offline@local.app',
    app_metadata: {},
    user_metadata: { nickname: '本机学习' }
  });
}

/**
 * 显示等待审批界面
 */
function showPendingScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('auth-card').style.display = 'none';
  document.getElementById('pending-card').style.display = 'block';
  document.getElementById('app-screen').style.display = 'none';
}

/**
 * 显示登录界面
 */
function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('auth-card').style.display = 'block';
  document.getElementById('pending-card').style.display = 'none';
  document.getElementById('app-screen').style.display = 'none';
}

/**
 * 显示主应用界面
 */
function showAppScreen(nickname, isAdmin) {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'block';
  document.getElementById('user-chip').textContent = nickname;
  document.getElementById('admin-tab').style.display = isAdmin ? '' : 'none';
}

/**
 * 登录
 */
async function doLogin() {
  if (isFileApp()) {
    showAuthMsg(authErrorMessage(), 'error');
    return;
  }
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;
  if (!email || !pass) { showAuthMsg('请填写邮箱和密码', 'error'); return; }
  const btn = document.querySelector('#login-form .btn-primary');
  btn.disabled = true; btn.textContent = '登录中...';
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) { showAuthMsg('登录失败：' + authErrorMessage(error), 'error'); return; }
    await onLogin(data.user);
  } catch (error) {
    showAuthMsg('登录失败：' + authErrorMessage(error), 'error');
  } finally {
    btn.disabled = false; btn.textContent = '登录';
  }
}

/**
 * 注册
 */
async function doSignup() {
  if (isFileApp()) {
    showAuthMsg(authErrorMessage(), 'error');
    return;
  }
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const pass = document.getElementById('signup-pass').value;
  if (!name || !email || !pass) { showAuthMsg('请填写所有字段', 'error'); return; }
  if (pass.length < 6) { showAuthMsg('密码至少6位', 'error'); return; }
  const btn = document.querySelector('#signup-form .btn-primary');
  btn.disabled = true; btn.textContent = '注册中...';
  try {
    const { data, error } = await sb.auth.signUp({ email, password: pass });
    if (error) { showAuthMsg('注册失败：' + authErrorMessage(error), 'error'); return; }
    if (data.user) await apiUpdateNickname(data.user.id, name);
    showAuthMsg('注册成功！请等待管理员审批后登录。', 'success');
  } catch (error) {
    showAuthMsg('注册失败：' + authErrorMessage(error), 'error');
  } finally {
    btn.disabled = false; btn.textContent = '注册账号';
  }
}

/**
 * 登出
 */
async function doLogout() {
  localStorage.removeItem('offline-mode');
  try { await sb.auth.signOut(); } catch {}
  currentUser = null;
  userRole = null;
  progressMap = {};
  W = [];
  showAuthScreen();
}
