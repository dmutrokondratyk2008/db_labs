// Лабораторна робота 7. Стрічка постів: фільтри, повнотекстовий пошук, теги,
// пагінація ($facet на сервері), перегляд посту, реакції, дерево коментарів,
// створення й редагування з версіонуванням.

const CITIES = [['Луцьк', 25.3254, 50.7472], ['Київ', 30.5234, 50.4501], ['Львів', 24.0297, 49.8397], ['Рівне', 26.2516, 50.6199],
  ['Ковель', 24.7111, 51.2153], ['Харків', 36.2304, 49.9935], ['Одеса', 30.7233, 46.4825], ['Дніпро', 35.0462, 48.4647],
  ['Тернопіль', 25.5948, 49.5535], ['Вінниця', 28.4682, 49.2331], ['Ужгород', 22.2879, 48.6208], ['Житомир', 28.6587, 50.2547]];

const state = { page: 1, limit: 9, q: '', category: '', sort: 'new', near: '', tags: new Set(), tagMode: 'all' };
let CATS = [], TAGS = [], current = null, editing = null;

const $ = id => document.getElementById(id);

// ---------------- стрічка ----------------
function queryString() {
  const p = new URLSearchParams({ page: state.page, limit: state.limit });
  if (state.q) p.set('q', state.q);
  if (state.category) p.set('category', state.category);
  if (state.sort && !(state.q && state.sort === 'new')) p.set('sort', state.sort);
  if (state.tags.size) { p.set('tags', [...state.tags].join(',')); p.set('tag_mode', state.tagMode); }
  if (state.near) { const [lng, lat] = state.near.split(','); p.set('lng', lng); p.set('lat', lat); p.set('km', 100); }
  return p.toString();
}

async function loadPosts() {
  const grid = $('postsGrid');
  const t0 = performance.now();
  let res, data;
  try {
    res = await fetch('/api/posts?' + queryString());
    data = await res.json();
    if (!res.ok) throw new Error(data.error);
  } catch (e) {
    grid.innerHTML = `<div class="empty">Не вдалося завантажити пости: ${esc(e.message)}</div>`;
    return;
  }
  const ms = (performance.now() - t0).toFixed(1);
  $('cacheInfo').textContent = `кеш: ${res.headers.get('X-Cache') || '-'}, сервер ${res.headers.get('X-Response-Time') || ''}, усього ${ms} мс`;
  $('resultInfo').textContent = data.total ? `Знайдено постів: ${data.total} · сторінка ${data.page} з ${data.pages}` : '';
  grid.innerHTML = data.items.length ? '' : '<div class="empty">Нічого не знайдено. Змініть умови пошуку.</div>';
  data.items.forEach(p => grid.appendChild(card(p)));
  renderPagination(data);
}

function card(p) {
  const el = document.createElement('article');
  el.className = 'post-card';
  el.onclick = () => openPost(p.slug);
  const cat = CATS.find(c => c.slug === p.category.slug);
  el.innerHTML = `
    <img src="${esc(p.featured_image)}" alt="" loading="lazy">
    <div class="body">
      <div><span class="cat" style="background:${esc(cat ? cat.color : '#2563eb')}">${esc(p.category.name)}</span>
        ${p.distance_m !== undefined ? `<span class="muted" style="font-size:.8rem"> · 📍 ${esc(p.location.place)}, ${(p.distance_m / 1000).toFixed(1)} км</span>` : ''}
        ${p.score !== undefined ? `<span class="muted" style="font-size:.8rem"> · релевантність ${p.score.toFixed(2)}</span>` : ''}</div>
      <h2>${esc(p.title)}</h2>
      <div class="meta"><span>👤 ${esc(p.author.username)}</span><span>📅 ${fmtDate(p.published_at)}</span>
        <span>👁 ${fmtNum(p.statistics.views)}</span><span>👍 ${p.statistics.likes}</span><span>💬 ${p.statistics.comments_count}</span></div>
      <p class="excerpt">${esc(p.excerpt)}</p>
      <div class="tags">${p.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div>
    </div>`;
  return el;
}

function renderPagination({ page, pages }) {
  const box = $('pagination');
  box.innerHTML = '';
  if (pages <= 1) return;
  const add = (label, p, disabled, cur) => {
    const b = document.createElement('button');
    b.className = 'btn' + (cur ? ' current' : ''); b.textContent = label; b.disabled = disabled;
    b.onclick = () => { state.page = p; loadPosts(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    box.appendChild(b);
  };
  add('←', page - 1, page === 1);
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 2) add(String(i), i, false, i === page);
    else if (Math.abs(i - page) === 3) { const s = document.createElement('span'); s.textContent = '…'; s.className = 'muted'; box.appendChild(s); }
  }
  add('→', page + 1, page === pages);
}

function renderTagbar() {
  const bar = $('tagbar');
  bar.innerHTML = '<span class="muted" style="font-size:.85rem">Теги:</span>' +
    TAGS.filter(t => t.statistics.posts_count > 0).map(t =>
      `<button class="chip ${state.tags.has(t.slug) ? 'on' : ''}" data-tag="${esc(t.slug)}">#${esc(t.slug)} <small>${t.statistics.posts_count}</small></button>`).join('') +
    `<span class="mode">збіг: <label style="margin:0"><input type="radio" name="tm" value="all" ${state.tagMode === 'all' ? 'checked' : ''}> усі ($all)</label>
     <label style="margin:0"><input type="radio" name="tm" value="any" ${state.tagMode === 'any' ? 'checked' : ''}> будь-який ($in)</label>
     ${state.tags.size ? '<button class="btn small" id="clearTags">скинути</button>' : ''}</span>`;
  bar.querySelectorAll('.chip').forEach(b => b.onclick = () => {
    const t = b.dataset.tag;
    state.tags.has(t) ? state.tags.delete(t) : state.tags.add(t);
    state.page = 1; renderTagbar(); loadPosts();
  });
  bar.querySelectorAll('input[name=tm]').forEach(r => r.onchange = () => { state.tagMode = r.value; state.page = 1; loadPosts(); });
  const clr = $('clearTags');
  if (clr) clr.onclick = () => { state.tags.clear(); state.page = 1; renderTagbar(); loadPosts(); };
}

// ---------------- перегляд посту ----------------
async function openPost(slug, keepScroll) {
  let p;
  try { p = await api('/posts/' + encodeURIComponent(slug)); } catch (e) { toast(e.message); return; }
  if (!keepScroll) {
    try { const v = await api(`/posts/${p._id}/view`, { method: 'POST' }); p.statistics.views = v.views; } catch { /* чернетка */ }
  }
  current = p;
  renderPost();
  $('postModal').classList.add('open');
  history.replaceState(null, '', '#' + slug);
}

function renderPost() {
  const p = current, me = currentUser();
  const canEdit = me && (me.role === 'admin' || me._id === p.author.user_id);
  const canReact = me && p.status === 'published';
  $('postDetails').innerHTML = `
    <img class="cover" src="${esc(p.featured_image)}" alt="">
    <div class="meta" style="margin-bottom:6px"><span class="cat">${esc(p.category.name)}</span>
      ${p.status !== 'published' ? `<span class="status-pill ${p.status}">${p.status}</span>` : ''}
      <span>версія ${p.version}</span>${p.location ? `<span>📍 ${esc(p.location.place)}</span>` : ''}</div>
    <h1>${esc(p.title)}</h1>
    <div class="meta"><span>👤 ${esc(p.author.username)}</span><span>📅 ${fmtDate(p.published_at || p.created_at, true)}</span>
      <span>👁 ${fmtNum(p.statistics.views)} переглядів</span><span>💬 ${p.statistics.comments_count}</span></div>
    <div class="tags" style="margin:10px 0">${p.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div>
    <div class="content">${p.content.split(/\n\s*\n/).map(par => `<p>${esc(par)}</p>`).join('')}</div>
    <div class="actions">
      <button class="btn ${p.my_reaction === 1 ? 'active-like' : ''}" id="likeBtn" ${canReact ? '' : 'disabled'}>👍 ${p.statistics.likes}</button>
      <button class="btn ${p.my_reaction === -1 ? 'active-dislike' : ''}" id="dislikeBtn" ${canReact ? '' : 'disabled'}>👎 ${p.statistics.dislikes}</button>
      <span class="muted">рейтинг ${p.statistics.rating}</span>
      ${!me ? '<span class="muted">· оберіть користувача, щоб оцінювати й коментувати</span>' : ''}
      <span style="flex:1"></span>
      ${canEdit ? `<button class="btn" id="editBtn">✏️ Редагувати</button><button class="btn" id="histBtn">🕘 Історія (v${p.version})</button>
        ${p.status !== 'archived' ? '<button class="btn" id="archBtn">🗄 В архів</button>' : ''}` : ''}
    </div>
    ${p.related.length ? `<div class="related"><b>Схожі пости:</b> ${p.related.map(r => `<a href="#" data-slug="${esc(r.slug)}">${esc(r.title)}</a>`).join(' · ')}</div>` : ''}
    <div class="comments">
      <h3>Коментарі (${p.statistics.comments_count})</h3>
      ${me && p.status === 'published' ? `<div class="reply-form"><textarea id="newComment" placeholder="Ваш коментар..." maxlength="2000"></textarea>
        <button class="btn primary" id="sendComment">Надіслати</button></div>` : ''}
      <div id="tree">${renderTree(p.comment_tree)}</div>
    </div>`;
  $('likeBtn').onclick = () => react(1);
  $('dislikeBtn').onclick = () => react(-1);
  if (canEdit) { $('editBtn').onclick = () => openForm(p); $('histBtn').onclick = () => openHistory(p); }
  const arch = $('archBtn');
  if (arch) arch.onclick = async () => {
    if (!confirm('Перемістити пост в архів? Його можна буде відновити з історії версій.')) return;
    try { await api('/posts/' + p._id, { method: 'DELETE' }); toast('Пост переміщено в архів'); openPost(p.slug, true); loadPosts(); } catch (e) { toast(e.message); }
  };
  document.querySelectorAll('.related a').forEach(a => a.onclick = e => { e.preventDefault(); openPost(a.dataset.slug); });
  const send = $('sendComment');
  if (send) send.onclick = () => sendComment($('newComment').value, null);
  document.querySelectorAll('[data-reply]').forEach(b => b.onclick = () => {
    const box = document.getElementById('rf-' + b.dataset.reply);
    box.hidden = !box.hidden;
    if (!box.hidden) box.querySelector('textarea').focus();
  });
  document.querySelectorAll('[data-send-reply]').forEach(b => b.onclick = () =>
    sendComment(document.getElementById('rt-' + b.dataset.sendReply).value, b.dataset.sendReply));
}

function renderTree(nodes) {
  const me = currentUser();
  if (!nodes.length) return '<p class="muted" style="margin-top:8px">Коментарів ще немає.</p>';
  return nodes.map(c => `
    <div class="comment ${c.status === 'pending' ? 'pending' : ''}">
      <div class="comment-head"><b>${esc(c.author.username)}</b><span>${fmtDate(c.created_at, true)}</span>
        ${c.status === 'pending' ? '<span class="status-pill pending">очікує модерації</span>' : ''}
        ${c.likes ? `<span>❤ ${c.likes}</span>` : ''}
        ${me && c.status === 'approved' && c.depth < 5 ? `<button class="btn small" data-reply="${c.comment_id}">Відповісти</button>` : ''}</div>
      <p>${esc(c.text)}</p>
      <div class="reply-form" id="rf-${c.comment_id}" hidden><textarea id="rt-${c.comment_id}" placeholder="Відповідь для ${esc(c.author.username)}..."></textarea>
        <button class="btn primary small" data-send-reply="${c.comment_id}">Надіслати</button></div>
      ${c.replies.length ? `<div class="replies">${renderTree(c.replies)}</div>` : ''}
    </div>`).join('');
}

async function react(value) {
  try {
    const r = await api(`/posts/${current._id}/reactions`, { method: 'POST', body: { value } });
    current.statistics = { ...current.statistics, ...r.statistics }; current.my_reaction = r.my_reaction;
    renderPost();
    toast({ added: 'Реакцію додано', removed: 'Реакцію скасовано', switched: 'Реакцію змінено' }[r.action]);
  } catch (e) { toast(e.message); }
}

async function sendComment(text, parentId) {
  try {
    const c = await api(`/posts/${current._id}/comments`, { method: 'POST', body: { text, parent_id: parentId || undefined } });
    toast(c.status === 'approved' ? 'Коментар опубліковано' : 'Коментар надіслано на модерацію');
    await openPost(current.slug, true);
    refreshBell();
  } catch (e) { toast(e.message); }
}

// ---------------- створення і редагування ----------------
function openForm(post) {
  editing = post || null;
  $('formTitle').textContent = post ? `Редагування (поточна версія v${post.version})` : 'Новий пост';
  $('f_title').value = post ? post.title : '';
  $('f_category').value = post ? post.category.slug : CATS[0].slug;
  $('f_status').value = post && post.status === 'draft' ? 'draft' : 'published';
  $('f_tags').value = post ? post.tags.join(', ') : '';
  $('f_excerpt').value = post ? post.excerpt || '' : '';
  $('f_content').value = post ? post.content : '';
  $('f_city').value = '';
  $('f_geo_row').hidden = !!post; $('f_note_row').hidden = !post; $('f_note').value = '';
  $('f_len').textContent = $('f_content').value.length + ' символів';
  $('formMsg').className = 'form-msg';
  $('formModal').classList.add('open');
}

async function submitForm(e) {
  e.preventDefault();
  const msg = $('formMsg');
  const body = { title: $('f_title').value, category: $('f_category').value, status: $('f_status').value,
                 tags: $('f_tags').value, excerpt: $('f_excerpt').value, content: $('f_content').value };
  try {
    if (editing) {
      body.expected_version = editing.version; body.change_note = $('f_note').value;
      const r = await api('/posts/' + editing._id, { method: 'PUT', body });
      msg.className = 'form-msg ok';
      msg.textContent = r.changed.length ? `Збережено як версію v${r.version}. Змінено: ${r.changed.join(', ')}` : 'Змін немає, нову версію не створено';
      await openPost(editing.slug, true);
      editing = current;
    } else {
      const city = CITIES.find(c => c[0] === $('f_city').value);
      if (city) Object.assign(body, { place: city[0], lng: city[1], lat: city[2] });
      const r = await api('/posts', { method: 'POST', body });
      msg.className = 'form-msg ok'; msg.textContent = 'Пост створено: /' + r.slug;
      $('postForm').reset();
      setTimeout(() => { $('formModal').classList.remove('open'); openPost(r.slug); }, 700);
    }
    loadPosts();
  } catch (err) {
    msg.className = 'form-msg err';
    msg.textContent = err.message + (err.data && err.data.details ? ' (' + JSON.stringify(err.data.details).slice(0, 200) + ')' : '');
  }
}

async function openHistory(p) {
  const r = await api(`/posts/${p._id}/versions`);
  const rows = [{ version: r.current.version, title: r.current.title, note: 'поточна версія', by: '', at: r.current.updated_at, current: true }]
    .concat(r.versions.map(v => ({ version: v.version, title: v.snapshot.title, note: v.change_note, changed: v.changed_fields,
                                     by: v.edited_by.username, at: v.edited_at })));
  $('historyBody').innerHTML = `<p class="muted" style="margin-bottom:10px">Перед кожним редагуванням попередній стан зберігається в колекції
    <code>post_versions</code>. Рядок версії N показує стан посту до редагування, яке зробив зазначений користувач.</p>
    <table class="data"><thead><tr><th>Версія</th><th>Назва</th><th>Що змінено далі</th><th>Ким / коли</th><th></th></tr></thead><tbody>
    ${rows.map(v => `<tr><td>v${v.version}</td><td>${esc(v.title)}</td>
      <td>${v.current ? '<span class="muted">поточна</span>' : esc((v.changed || []).join(', ')) + (v.note ? '<br><small class="muted">' + esc(v.note) + '</small>' : '')}</td>
      <td>${esc(v.by)}<br><small class="muted">${fmtDate(v.at, true)}</small></td>
      <td>${v.current ? '' : `<button class="btn small" data-restore="${v.version}">Відновити</button>`}</td></tr>`).join('')}
    </tbody></table>`;
  $('historyBody').querySelectorAll('[data-restore]').forEach(b => b.onclick = async () => {
    try {
      const res = await api(`/posts/${p._id}/versions/${b.dataset.restore}/restore`, { method: 'POST' });
      toast(`Відновлено v${b.dataset.restore} як нову версію v${res.version}`);
      await openPost(p.slug, true); openHistory(current); loadPosts();
    } catch (e) { toast(e.message); }
  });
  $('historyModal').classList.add('open');
}

// ---------------- ініціалізація ----------------
function applyUser(me) {
  $('newPostBtn').hidden = !(me && me.role !== 'reader');
  if ($('postModal').classList.contains('open') && current) openPost(current.slug, true);
}

(async function init() {
  const me = await initHeader('feed', applyUser);
  [CATS, TAGS] = await Promise.all([api('/categories'), api('/tags')]).catch(() => [[], []]);
  $('category').innerHTML += CATS.map(c => `<option value="${esc(c.slug)}">${esc(c.name)} (${c.statistics.posts_count})</option>`).join('');
  $('f_category').innerHTML = CATS.map(c => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join('');
  $('tagList').innerHTML = TAGS.map(t => `<option value="${esc(t.slug)}">`).join('');
  $('f_city').innerHTML += CITIES.map(c => `<option>${esc(c[0])}</option>`).join('');
  // початковий стан фільтрів з адреси: /?q=...&tags=a,b&tag_mode=any&category=...&sort=...&near=lng,lat&page=N
  const u = new URLSearchParams(location.search);
  if (u.get('q')) state.q = $('q').value = u.get('q');
  if (u.get('tags')) u.get('tags').split(',').filter(Boolean).forEach(t => state.tags.add(t));
  if (u.get('tag_mode') === 'any') state.tagMode = 'any';
  if (u.get('category')) state.category = $('category').value = u.get('category');
  if (u.get('sort')) state.sort = $('sort').value = u.get('sort');
  if (u.get('near')) state.near = $('near').value = u.get('near');
  if (u.get('page')) state.page = Math.max(1, parseInt(u.get('page'), 10) || 1);
  renderTagbar();
  applyUser(me);

  let timer;
  $('q').oninput = () => { clearTimeout(timer); timer = setTimeout(() => { state.q = $('q').value.trim(); state.page = 1; loadPosts(); }, 350); };
  $('category').onchange = () => { state.category = $('category').value; state.page = 1; loadPosts(); };
  $('sort').onchange = () => { state.sort = $('sort').value; state.page = 1; loadPosts(); };
  $('near').onchange = () => { state.near = $('near').value; state.page = 1; loadPosts(); };
  $('newPostBtn').onclick = () => openForm(null);
  $('postForm').onsubmit = submitForm;
  $('f_content').oninput = () => { $('f_len').textContent = $('f_content').value.length + ' символів'; };
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => {
    b.closest('.modal').classList.remove('open');
    if (b.closest('#postModal')) history.replaceState(null, '', location.pathname);
  });
  document.querySelectorAll('.modal').forEach(m => m.onclick = e => { if (e.target === m) m.querySelector('[data-close]').click(); });

  await loadPosts();
  if (location.hash.length > 1) openPost(decodeURIComponent(location.hash.slice(1)));
  // посилання виду /#slug (зі стрічки модерації, аналітики) і кнопка «Назад» відкривають пост без перезавантаження
  window.addEventListener('hashchange', () => {
    const slug = decodeURIComponent(location.hash.slice(1));
    if (slug && (!current || current.slug !== slug || !$('postModal').classList.contains('open'))) openPost(slug);
    if (!slug) $('postModal').classList.remove('open');
  });
})();
