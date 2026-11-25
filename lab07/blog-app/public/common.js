// Лабораторна робота 7. Спільний код сторінок: виклики API, поточний користувач,
// шапка з навігацією та сповіщеннями, екранування HTML.

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function fmtDate(value, withTime) {
  const d = new Date(value);
  if (isNaN(d)) return '';
  return withTime ? d.toLocaleString('uk-UA', { dateStyle: 'medium', timeStyle: 'short' }) : d.toLocaleDateString('uk-UA');
}
const fmtNum = n => Number(n || 0).toLocaleString('uk-UA');

function getUserId() { try { return localStorage.getItem('blog_user_id') || ''; } catch { return ''; } }
function setUserId(id) { try { localStorage.setItem('blog_user_id', id); } catch { /* сховище недоступне */ } }

let USERS = [];
const currentUser = () => USERS.find(u => u._id === getUserId()) || null;

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (getUserId()) headers['X-User-Id'] = getUserId();
  const res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || ('HTTP ' + res.status));
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

function toast(text) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = text; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600);
}

const ROLE_UA = { admin: 'адміністратор', author: 'автор', reader: 'читач' };

async function initHeader(active, onUserChange) {
  const header = document.createElement('header');
  header.className = 'top';
  header.innerHTML = `
    <div class="container">
      <a class="logo" href="/">📝 Блог на MongoDB</a>
      <nav>
        <a href="/" data-p="feed">Стрічка</a>
        <a href="/moderation.html" data-p="moderation">Модерація</a>
        <a href="/dashboard.html" data-p="dashboard">Аналітика</a>
        <a href="/api.html" data-p="api">REST API</a>
      </nav>
      <div class="userbox">
        <select id="userSelect" title="Від імені якого користувача працювати"></select>
        <button class="bell" id="bell" title="Сповіщення">🔔<span class="badge" id="bellBadge" hidden>0</span></button>
      </div>
    </div>
    <div class="notif-panel" id="notifPanel"></div>`;
  document.body.prepend(header);
  header.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.p === active));

  try { USERS = await api('/users'); } catch { USERS = []; }
  // ?as=username - швидкий вибір користувача через адресу (для демонстрації і скриншотів)
  const as = new URLSearchParams(location.search).get('as');
  if (as) { const u = USERS.find(x => x.username === as); setUserId(u ? u._id : ''); }
  const sel = header.querySelector('#userSelect');
  const groups = { admin: [], author: [], reader: [] };
  USERS.filter(u => u.status === 'active').forEach(u => groups[u.role].push(u));
  sel.innerHTML = '<option value="">Гість (без входу)</option>' + Object.entries(groups).map(([role, list]) =>
    `<optgroup label="${esc(ROLE_UA[role])}">${list.map(u => `<option value="${u._id}">${esc(u.profile.full_name)} (${esc(u.username)})</option>`).join('')}</optgroup>`).join('');
  if (!USERS.some(u => u._id === getUserId())) setUserId('');
  sel.value = getUserId();
  sel.onchange = () => { setUserId(sel.value); refreshBell(); if (onUserChange) onUserChange(currentUser()); };

  const panel = header.querySelector('#notifPanel');
  header.querySelector('#bell').onclick = async () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) await renderNotifications();
  };
  document.addEventListener('click', e => { if (!header.contains(e.target)) panel.classList.remove('open'); });
  refreshBell();
  setInterval(refreshBell, 15000);
  return currentUser();
}

async function refreshBell() {
  const badge = document.getElementById('bellBadge');
  if (!badge) return;
  if (!getUserId()) { badge.hidden = true; return; }
  try {
    const r = await api('/notifications?unread=1&limit=1');
    badge.textContent = r.unread; badge.hidden = r.unread === 0;
  } catch { badge.hidden = true; }
}

const NOTIF_ICON = { new_comment: '💬', comment_reply: '↩️', comment_approved: '✅', comment_rejected: '⛔' };
async function renderNotifications() {
  const panel = document.getElementById('notifPanel');
  if (!getUserId()) { panel.innerHTML = '<h4>Сповіщення</h4><div class="notif-item">Оберіть користувача у списку зліва.</div>'; return; }
  const r = await api('/notifications?limit=15');
  panel.innerHTML = `<h4>Сповіщення (${r.unread} нових) <button class="btn small" id="markAll">Прочитати всі</button></h4>` +
    (r.items.length ? r.items.map(n => `<div class="notif-item ${n.read ? '' : 'unread'}">${NOTIF_ICON[n.type] || '•'} ${esc(n.message)}
      <small>${fmtDate(n.created_at, true)}</small></div>`).join('') : '<div class="notif-item">Сповіщень немає.</div>');
  panel.querySelector('#markAll').onclick = async e => {
    e.stopPropagation();
    await api('/notifications/read', { method: 'PATCH', body: {} });
    await renderNotifications(); refreshBell();
  };
}
