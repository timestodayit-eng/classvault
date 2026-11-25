const $ = (s, r = document) => r.querySelector(s);
const BRAND = window.BRAND || { logo_html: '<b>▶</b> ক্লাসভল্ট' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bn = (n) => String(n).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]);
const fmt = (s) => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const dur = (s) => { s = Math.round(s || 0); if (s < 60) return bn(s) + ' সে'; const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return h ? `${bn(h)} ঘ ${bn(m)} মি` : `${bn(m)} মি ${bn(s % 60)} সে`; };
const dt = (ms) => ms ? new Date(ms).toLocaleString('bn-BD', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';
const ago = (ms) => { if (!ms) return '—'; const s = (Date.now() - ms) / 1000; if (s < 60) return 'এইমাত্র'; if (s < 3600) return bn(Math.floor(s / 60)) + ' মিনিট আগে';
  if (s < 86400) return bn(Math.floor(s / 3600)) + ' ঘণ্টা আগে'; return bn(Math.floor(s / 86400)) + ' দিন আগে'; };
const pct = (p) => bn(Math.round(p || 0)) + '%';
const co = (c) => c ? `<span class="pill brand" style="font-size:11.5px">🏢 ${esc(c)}</span>` : '<span class="muted" style="font-size:12px">কোম্পানি দেয়নি</span>';
let COMPANIES = []; const companiesReady = fetch('/api/companies').then(r => r.json()).then(l => { COMPANIES = l; }).catch(() => {});
const companySelect = (id, val = '') => `<select class="input" id="${id}" style="width:auto;min-width:190px"><option value="">সব কোম্পানি</option>${COMPANIES.map(c => `<option ${c === val ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option value="__none" ${val === '__none' ? 'selected' : ''}>কোম্পানি দেয়নি</option></select>`;
const byCo = (f) => (x) => !f || (f === '__none' ? !x.company : x.company === f);
const bar = (p, ok) => `<div class="bar ${ok ? 'ok' : ''}"><i style="width:${Math.min(100, p || 0)}%"></i></div>`;
const status = (p) => p.completed ? '<span class="pill ok">✓ শেষ করেছে</span>' : (p.percent || 0) > 0 ? '<span class="pill warn">দেখছে</span>' : '<span class="pill">শুরু করেনি</span>';
const rangesBar = (ranges, d) => `<div class="ranges" title="সবুজ অংশগুলো দেখা হয়েছে">${JSON.parse(ranges || '[]').map(([a, b]) =>
  `<i style="left:${a / d * 100}%;width:${(b - a) / d * 100}%"></i>`).join('')}</div>`;

// Each video is split into 100 parts; colour shows how many times each part was watched.
function timesInfo(bucketsJson, d) {
  const bk = JSON.parse(bucketsJson || '[]'); if (!bk.length || !d) return { max: 0, times: [] };
  const bl = d / bk.length, times = bk.map(sec => sec / bl >= 0.5 ? Math.max(1, Math.round(sec / bl)) : 0);
  let max = 0, at = 0; times.forEach((t, i) => { if (t > max) { max = t; at = i; } });
  let a = at, b = at; while (a > 0 && times[a - 1] === max) a--; while (b < times.length - 1 && times[b + 1] === max) b++;
  return { max, times, from: a * bl, to: (b + 1) * bl };
}
const TCOL = ['transparent', '#9be3c4', '#2fbf87', '#0f8a5f', '#6d28d9'];
function timesBar(bucketsJson, d) {
  const { times } = timesInfo(bucketsJson, d);
  if (!times.length) return '<div class="ranges"></div>';
  return `<div class="ranges" style="display:flex">${times.map((t, i) => `<i style="position:static;flex:1;background:${TCOL[Math.min(4, t)]}" title="${fmt(i / times.length * d)}: ${t ? bn(t) + ' বার দেখেছে' : 'দেখেনি'}"></i>`).join('')}</div>`;
}
const timesLegend = `<span class="muted" style="font-size:12px;display:inline-flex;gap:10px;align-items:center;font-weight:400">
  ${[['১ বার', 1], ['২ বার', 2], ['৩ বার', 3], ['৪+ বার', 4]].map(([l, i]) => `<span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${TCOL[i]};margin-right:4px"></i>${l}</span>`).join('')}</span>`;
function rewatchCell(p, d) {
  const r = Math.max(0, (p.media_seconds || 0) - (p.unique_seconds || 0)), ti = timesInfo(p.buckets, d);
  return `${r >= 1 ? dur(r) : '—'}${ti.max >= 2 ? `<div class="muted" style="font-size:12px">${fmt(ti.from)}–${fmt(ti.to)} অংশ ${bn(ti.max)} বার</div>` : ''}`;
}

const shareUrl = (t) => `${location.origin}/v/${t}`;
window.copyLink = async (t) => {
  try { await navigator.clipboard.writeText(shareUrl(t)); toast('লিংক কপি হয়েছে, এখন যাকে খুশি পাঠান'); }
  catch { modal(`<h2>শেয়ার লিংক</h2><input class="input" value="${shareUrl(t)}" onclick="this.select()" readonly>`); }
};

// Share link + who has access to one video
async function renderSharePanel(el, v) {
  const list = await api(`/api/admin/videos/${v.id}/access`);
  const students = await api('/api/admin/students');
  const have = new Set(list.map(a => a.student_id));
  const SRC = { link: 'লিংক দিয়ে', admin: 'আপনি দিয়েছেন', legacy: 'আগে থেকে' };
  el.innerHTML = `<div class="cols" style="margin-bottom:18px">
    <div class="card" style="padding:18px">
      <b>🔗 শেয়ার লিংক</b> ${v.share_enabled ? '<span class="pill ok">চালু</span>' : '<span class="pill bad">বন্ধ</span>'}
      <p class="muted" style="font-size:13px;margin:6px 0 12px">ভিডিওটি প্রাইভেট। শুধু এই লিংক যারা পাবে, তারা নাম, ইমেইল ও ফোন দিয়ে এটি দেখতে পারবে। লিংক ছাড়া কেউ ভিডিওটি খুঁজে পাবে না।</p>
      <div style="display:flex;gap:8px"><input class="input" id="shareUrl" value="${shareUrl(v.share_token)}" readonly onclick="this.select()" style="${v.share_enabled ? '' : 'opacity:.5;text-decoration:line-through'}">
        <button class="btn" id="cp" ${v.share_enabled ? '' : 'disabled'}>কপি</button></div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn ghost sm" id="tog">${v.share_enabled ? '⛔ লিংক বন্ধ করুন' : '✅ লিংক চালু করুন'}</button>
        <button class="btn ghost sm" id="regen">🔄 নতুন লিংক বানান (পুরানোটা আর কাজ করবে না)</button>
      </div>
    </div>
    <div class="card" style="padding:18px">
      <b>➕ নির্দিষ্ট কাউকে অনুমতি দিন</b>
      <p class="muted" style="font-size:13px;margin:6px 0 10px">অনুমতি পেলে সে মূল পেজে লগইন করলেই এই ভিডিওটি দেখতে পাবে, লিংক লাগবে না।</p>
      <form id="gf1" style="display:flex;gap:8px"><select class="input" name="student_id" required><option value="">আগের স্টুডেন্ট বেছে নিন…</option>
        ${students.filter(x => !have.has(x.id)).map(x => `<option value="${x.id}">${esc(x.name)} · ${esc(x.phone)}</option>`).join('')}</select><button class="btn">দিন</button></form>
      <div class="muted" style="font-size:12.5px;margin:10px 0 6px">অথবা নতুন কাউকে:</div>
      <form id="gf2" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr auto;gap:6px"><input class="input" name="name" placeholder="নাম" required><input class="input" name="email" type="email" placeholder="ইমেইল" required><input class="input" name="phone" placeholder="ফোন" required><select class="input" name="company" required><option value="">কোম্পানি</option>${COMPANIES.map(c => `<option>${esc(c)}</option>`).join('')}</select><button class="btn">দিন</button></form>
      <div class="err" id="gerr"></div>
    </div>
  </div>
  <div class="card panel" style="margin-bottom:18px"><h3>🔑 যাদের এই ভিডিও দেখার অনুমতি আছে <span class="pill">${bn(list.length)} জন</span></h3><div class="scroll"><table>
    <tr><th>নাম</th><th>ফোন / ইমেইল</th><th>কীভাবে পেয়েছে</th><th>কবে</th><th></th></tr>
    ${list.map(a => `<tr><td><a href="#/student/${a.student_id}">${esc(a.name)}</a></td><td>${esc(a.phone)}<div class="muted" style="font-size:12px">${esc(a.email)}</div></td>
      <td><span class="pill ${a.source === 'link' ? 'brand' : ''}">${SRC[a.source] || a.source}</span></td><td class="muted">${dt(a.granted_at)}</td>
      <td><button class="btn danger sm" onclick="revoke(${a.student_id}, ${v.id})">অনুমতি বাতিল</button></td></tr>`).join('') || '<tr><td colspan=5 class="muted">এখনো কেউ নেই। লিংক শেয়ার করুন বা উপরে থেকে অনুমতি দিন।</td></tr>'}
  </table></div></div>`;
  $('#cp', el).onclick = () => copyLink(v.share_token);
  $('#tog', el).onclick = async () => { await post(`/api/admin/videos/${v.id}/share`, { enabled: !v.share_enabled }); route(); };
  $('#regen', el).onclick = () => confirmBox('পুরানো লিংকটি আর কাজ করবে না। যারা আগে ঢুকেছে তাদের অনুমতি থাকবে (চাইলে নিচে থেকে বাতিল করতে পারবেন)।',
    async () => { await post(`/api/admin/videos/${v.id}/share`, { regenerate: true }); route(); toast('নতুন লিংক তৈরি হয়েছে'); }, 'হ্যাঁ, নতুন লিংক');
  const grant = async (body) => { try { await post('/api/admin/access', { video_id: v.id, ...body }); toast('অনুমতি দেওয়া হয়েছে'); route(); } catch (e) { $('#gerr', el).textContent = e.message; } };
  $('#gf1', el).onsubmit = (e) => { e.preventDefault(); grant(Object.fromEntries(new FormData(e.target))); };
  $('#gf2', el).onsubmit = (e) => { e.preventDefault(); grant(Object.fromEntries(new FormData(e.target))); };
}
window.revoke = (studentId, videoId) => confirmBox('এই স্টুডেন্ট আর এই ভিডিওটি দেখতে পারবে না। (আগের দেখার রিপোর্ট থেকে যাবে)', async () => {
  await api('/api/admin/access', { method: 'DELETE', body: JSON.stringify({ student_id: studentId, video_id: videoId }) }); route();
}, 'হ্যাঁ, বাতিল');

let navGen = 0;
async function api(url, opts = {}) {
  const gen = navGen, isGet = !opts.method || opts.method === 'GET';
  const r = await fetch(url, { ...opts, headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {} });
  const j = await r.json().catch(() => ({}));
  // a page load that finishes after the admin moved to another menu must not overwrite the new page
  if (isGet && gen !== navGen) throw new Error('stale');
  if (r.status === 401) { renderLogin(); throw new Error('auth'); }
  if (!r.ok) throw new Error(j.error || 'সমস্যা হয়েছে');
  return j;
}
const post = (u, b, m = 'POST') => api(u, { method: m, body: JSON.stringify(b) });
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 3000); }
function modal(html, wide) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="card modal ${wide ? 'wide' : ''}">${html}</div>`;
  bg.onclick = (e) => { if (e.target === bg) bg.remove(); };
  document.body.appendChild(bg); return bg;
}

// ---------------- login ----------------
function renderLogin() {
  document.body.innerHTML = `<div class="loginbox"><form class="card" id="lf" style="width:360px;padding:30px">
    <div class="logo" style="margin-bottom:18px">${BRAND.logo_html} <span class="muted" style="font-weight:600;font-size:14px">অ্যাডমিন</span></div>
    <label>অ্যাডমিন পাসওয়ার্ড</label><input class="input" type="password" name="password" autofocus required>
    <div class="err" id="err"></div><button class="btn" style="width:100%;justify-content:center">লগইন</button></form>${themeBtn('float')}</div>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    try { await post('/api/admin/login', Object.fromEntries(new FormData(e.target))); location.reload(); }
    catch (er) { $('#err').textContent = er.message; }
  };
}

// ---------------- shell ----------------
function shell() {
  document.body.innerHTML = `<div class="layout">
    <aside class="side"><div class="logo">${BRAND.logo_html}</div>
      <nav class="nav">
        <a href="#/overview" data-r="overview">📊 ওভারভিউ</a>
        <a href="#/videos" data-r="videos">🎬 ক্লাস ও ভিডিও</a>
        <a href="#/students" data-r="students">👥 স্টুডেন্ট</a>
        <a href="#/leaderboard" data-r="leaderboard">🏆 লিডারবোর্ড</a>
        <a href="#/questions" data-r="questions">❓ প্রশ্ন <span class="badge" id="qBadge" style="display:none"></span></a>
        <a href="#/quiz" data-r="quiz">📝 কুইজ লিডারবোর্ড</a>
        <a href="#/allow" data-r="allow">👮 লগইন তালিকা</a>
        <a href="#/settings" data-r="settings">⚙️ সেটিংস</a>
      </nav>
      <div class="foot" style="margin-top:auto;display:grid;gap:8px">
        <a class="btn ghost sm" href="/api/admin/students.csv" style="justify-content:center">⬇ স্টুডেন্ট তালিকা (CSV)</a>
        <a class="btn ghost sm" href="/api/admin/export.csv" style="justify-content:center">⬇ ভিডিও রিপোর্ট (CSV)</a>
        <a class="btn ghost sm" href="/api/admin/form-entries.csv" style="justify-content:center">⬇ ফর্ম এন্ট্রি (CSV)</a>
        <div style="display:flex;gap:8px">${themeBtn()}<button class="btn ghost sm" id="logout" style="justify-content:center;flex:1">লগআউট</button></div>
      </div>
    </aside><main class="main" id="main"></main></div>`;
  $('#logout').onclick = async () => { await post('/api/admin/logout', {}); location.reload(); };
}
let refreshTimer = null;
async function route() {
  clearInterval(refreshTimer);
  navGen++;
  document.querySelectorAll('.modal-bg').forEach(m => m.remove());
  const [, r, id] = (location.hash || '#/overview').split('/');
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', a.dataset.r === r || (r === 'student' && a.dataset.r === 'students') || (r === 'video' && a.dataset.r === 'videos')));
  const main = $('#main');
  updateQBadge();
  try {
    if (r === 'videos') await viewVideos(main);
    else if (r === 'students') await viewStudents(main, id);
    else if (r === 'settings') await viewSettings(main);
    else if (r === 'allow') await viewAllow(main);
    else if (r === 'questions') await viewQuestions(main, id || 'open');
    else if (r === 'quiz') await viewQuizBoard(main, id || 'overall');
    else if (r === 'leaderboard') await viewLeaderboard(main, id || 'overall');
    else if (r === 'student') await viewStudent(main, id);
    else if (r === 'video') await viewVideoReport(main, id);
    else await viewOverview(main);
  } catch (e) { if (e.message !== 'auth' && e.message !== 'stale') main.innerHTML = `<div class="card" style="padding:30px">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', route);

// ---------------- overview ----------------
async function viewOverview(main) {
  const o = await api('/api/admin/overview');
  main.innerHTML = `<div class="head"><h1>ওভারভিউ</h1><span class="pill ok">● এখন অনলাইনে ${bn(o.activeNow)} জন</span></div>
  <div class="stats">
    <div class="card stat"><div class="k">মোট স্টুডেন্ট</div><div class="v">${bn(o.students)}</div></div>
    <div class="card stat"><div class="k">ভিডিও</div><div class="v">${bn(o.videos)}</div><div class="s">${bn(o.classes)}টি ক্লাসে</div></div>
    <div class="card stat"><div class="k">মোট দেখার সময়</div><div class="v">${dur(o.watchTime)}</div></div>
    <div class="card stat"><div class="k">আজকের সেশন</div><div class="v">${bn(o.sessionsToday)}</div></div>
    <div class="card stat"><div class="k">ভিডিও শেষ করেছে</div><div class="v">${bn(o.completions)}</div><div class="s">গড়ে ${pct(o.avgPercent)} দেখা</div></div>
    <div class="card stat"><div class="k">ব্লক করা চেষ্টা</div><div class="v" style="color:var(--bad)">${bn(o.blocked)}</div><div class="s">রাইট ক্লিক, শর্টকাট, ডেভটুলস</div></div>
  </div>
  <div class="cols">
    <div class="card panel"><h3>সাম্প্রতিক অ্যাক্টিভিটি</h3><div class="scroll"><table>
      <tr><th>স্টুডেন্ট</th><th>ভিডিও</th><th>দেখেছে</th><th>অগ্রগতি</th><th>কখন</th></tr>
      ${o.recent.map(x => `<tr class="click" onclick="openSession(${x.id})"><td><a href="#/student/${x.student_id}" onclick="event.stopPropagation()"><b>${esc(x.student)}</b></a><div>${co(x.company)}</div><div style="font-size:12.5px">📞 ${esc(x.phone)}</div><div class="muted" style="font-size:12px">✉️ ${esc(x.email)}</div><div class="muted" style="font-size:11.5px">${esc(x.device)} · ${esc(x.browser)} · ${esc(x.os)}</div></td>
        <td>${esc(x.video)}</td><td>${dur(x.watch_time)}</td><td style="min-width:110px">${bar(x.percent, x.percent >= 95)}<span class="muted" style="font-size:12px">${pct(x.percent)}</span></td><td class="muted">${ago(x.last_active)}</td></tr>`).join('') || '<tr><td colspan=5 class="muted">এখনো কোনো অ্যাক্টিভিটি নেই</td></tr>'}
    </table></div></div>
    <div class="card panel"><h3>জনপ্রিয় ভিডিও</h3><table>
      <tr><th>ভিডিও</th><th>দর্শক</th><th>গড় দেখা</th></tr>
      ${o.topVideos.map(v => `<tr class="click" onclick="location.hash='#/video/${v.id}'"><td>${esc(v.title)}<div class="muted" style="font-size:12px">${esc(v.class)}</div></td><td>${bn(v.viewers)}</td><td style="min-width:90px">${bar(v.avg_percent)}<span class="muted" style="font-size:12px">${pct(v.avg_percent)}</span></td></tr>`).join('') || '<tr><td colspan=3 class="muted">কোনো ভিডিও নেই</td></tr>'}
    </table></div>
  </div>
  <div class="card panel" style="margin-top:18px"><h3>👥 নতুন স্টুডেন্ট / দর্শক <span style="display:flex;gap:8px"><a class="btn ghost sm" href="/api/admin/students.csv">⬇ সবার তালিকা (CSV)</a><a class="btn sm" href="#/students">সব স্টুডেন্ট দেখুন →</a></span></h3><div class="scroll"><table>
    <tr><th>নাম</th><th>কোম্পানি</th><th>ফোন</th><th>ইমেইল</th><th>ভিডিও শুরু</th><th>মোট দেখা</th><th>যোগ দিয়েছে</th><th>শেষ দেখা</th></tr>
    ${o.latestStudents.map(x => `<tr class="click" onclick="location.hash='#/student/${x.id}'"><td><b>${esc(x.name)}</b></td><td>${co(x.company)}</td><td>${esc(x.phone)}</td><td>${esc(x.email)}</td><td>${bn(x.started)}</td><td>${dur(x.watch_time)}</td><td class="muted">${dt(x.created_at)}</td><td class="muted">${ago(x.last_seen)}</td></tr>`).join('') || '<tr><td colspan=8 class="muted">এখনো কেউ নেই</td></tr>'}
  </table></div></div>
  <div class="card panel" style="margin-top:18px"><h3>🏢 কোম্পানি অনুযায়ী</h3><table>
    <tr><th>কোম্পানি</th><th>স্টুডেন্ট</th><th>মোট দেখার সময়</th></tr>
    ${o.byCompany.map(c => `<tr class="click" onclick="location.hash='#/students/${encodeURIComponent(c.company || '__none')}'"><td>${co(c.company)}</td><td>${bn(c.students)} জন</td><td>${dur(c.watch_time)}</td></tr>`).join('') || '<tr><td colspan=3 class="muted">এখনো কেউ নেই</td></tr>'}
  </table></div>`;
  refreshTimer = setInterval(() => { if (location.hash === '' || location.hash === '#/overview') viewOverview(main).catch(() => {}); }, 15000);
}

// ---------------- classes & videos ----------------
async function viewVideos(main) {
  const [classes, videos] = await Promise.all([api('/api/admin/classes'), api('/api/admin/videos')]);
  main.innerHTML = `<div class="head"><h1>ক্লাস ও ভিডিও</h1><div style="display:flex;gap:8px">
    <button class="btn ghost" id="addClass">＋ নতুন ক্লাস</button><button class="btn ghost" id="ytAdd" style="color:#c00">▶ YouTube ভিডিও যোগ</button><button class="btn" id="upload">⬆ ভিডিও আপলোড</button></div></div>
    ${classes.map(c => {
      const vs = videos.filter(v => v.class_id === c.id);
      return `<div class="card panel cls-block"><div class="cls-head"><h3>${esc(c.name)} <span class="pill">${bn(vs.length)}টি ভিডিও</span></h3>
        <div style="display:flex;gap:6px"><button class="btn ghost sm" onclick="renameClass(${c.id}, '${esc(c.name).replace(/'/g, "\\'")}')">নাম বদলান</button>
        <button class="btn danger sm" onclick="delClass(${c.id})">মুছুন</button></div></div>
        ${vs.map(v => `<div class="vrow"><div class="vthumb" style="background-image:url(/api/thumb/${v.id})"></div>
          <div><b>${esc(v.title)}</b> ${v.source === 'youtube' ? '<span class="pill" style="background:#fee2e2;color:#b91c1c">▶ YouTube</span>' : ''}
            <div class="vmeta">${v.status === 'ready' ? `<span>⏱ ${v.duration ? fmt(v.duration) : 'প্রথম বার চালালে জানা যাবে'}</span><span>👥 ${bn(v.viewers)} জন দেখেছে</span><span>👁 মোট ${bn(v.views)} বার</span><span>🔑 ${bn(v.access_count)} জনের অনুমতি</span>${v.share_enabled ? '' : '<span class="pill bad">লিংক বন্ধ</span>'}<span>✓ ${bn(v.completed)} জন শেষ করেছে</span><span>গড় ${pct(v.avg_percent)}</span>${v.quiz_count ? `<span>📝 ${bn(v.quiz_count)}টি কুইজ প্রশ্ন · ${bn(v.quiz_attempts)} জন দিয়েছে</span>` : ''}${v.open_questions ? `<a class="pill warn" href="#/questions/open">❓ ${bn(v.open_questions)}টি প্রশ্নের উত্তর বাকি</a>` : ''}`
              : v.status === 'processing' ? `<span class="pill warn">⏳ প্রসেস হচ্ছে ${v.job != null ? bn(v.job) + '%' : ''}</span>` : `<span class="pill bad">সমস্যা: ${esc(v.error)}</span>`}</div></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${v.status === 'ready' ? `${v.share_enabled ? `<button class="btn sm" onclick="copyLink('${v.share_token}')">🔗 লিংক কপি</button>` : ''}<button class="btn ghost sm" onclick="quizEditor(${v.id})">📝 কুইজ${v.quiz_count ? ' (' + bn(v.quiz_count) + ')' : ''}</button><a class="btn ghost sm" href="#/video/${v.id}">শেয়ার ও রিপোর্ট</a>` : ''}<button class="btn danger sm" onclick="delVideo(${v.id})">মুছুন</button></div></div>`).join('')
          || '<div class="muted" style="padding:16px 18px">এই ক্লাসে এখনো কোনো ভিডিও নেই</div>'}</div>`;
    }).join('') || '<div class="card" style="padding:30px;text-align:center" class="muted">প্রথমে একটি ক্লাস তৈরি করুন (যেমন: ক্লাস ১)</div>'}`;
  $('#addClass').onclick = () => {
    const m = modal(`<h2>নতুন ক্লাস</h2><form id="cf"><label>ক্লাসের নাম</label><input class="input" name="name" placeholder="যেমন: ক্লাস ৩" required autofocus>
      <div class="err" id="cerr"></div><button class="btn">তৈরি করুন</button></form>`);
    $('#cf', m).onsubmit = async (e) => { e.preventDefault(); try { await post('/api/admin/classes', Object.fromEntries(new FormData(e.target))); m.remove(); route(); } catch (er) { $('#cerr', m).textContent = er.message; } };
  };
  $('#upload').onclick = () => uploadModal(classes);
  $('#ytAdd').onclick = () => {
    if (!classes.length) return toast('প্রথমে একটি ক্লাস তৈরি করুন');
    const m = modal(`<h2>▶ YouTube ভিডিও ক্লাস হিসেবে যোগ করুন</h2><form id="yf">
      <label>ক্লাস</label><select class="input" name="class_id" required>${classes.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <label>YouTube লিংক</label><input class="input" name="url" placeholder="https://youtu.be/... বা https://www.youtube.com/watch?v=..." required>
      <label>ভিডিওর নাম</label><input class="input" name="title" required>
      <label>বিবরণ (ঐচ্ছিক)</label><textarea class="input" name="description" rows="2"></textarea>
      <label>দৈর্ঘ্য, মিনিটে (ঐচ্ছিক, না দিলে প্রথম বার চালানোর সময় নিজে থেকে নেবে)</label><input class="input" name="minutes" type="number" step="0.1" min="0">
      <div class="muted" style="font-size:12.5px;margin:8px 0">ভিডিওটি YouTube এ <b>Unlisted</b> রাখুন (Private ভিডিও অন্য সাইটে চলে না) এবং Embedding চালু রাখুন। স্টুডেন্টরা পেজে YouTube লিংক দেখতে পাবে না।</div>
      <div class="err" id="yerr"></div><button class="btn" id="ybtn">যোগ করুন</button></form>`);
    $('#yf', m).onsubmit = async (e) => { e.preventDefault(); $('#ybtn', m).disabled = true;
      try { await post('/api/admin/videos/youtube', Object.fromEntries(new FormData(e.target))); m.remove(); toast('YouTube ভিডিও যোগ হয়েছে। এখন লিংক কপি করে শেয়ার করুন।'); route(); }
      catch (er) { $('#yerr', m).textContent = er.message; $('#ybtn', m).disabled = false; } };
  };
  if (videos.some(v => v.status === 'processing')) refreshTimer = setInterval(() => viewVideos(main).catch(() => {}), 3000);
}
window.renameClass = async (id, name) => {
  const m = modal(`<h2>ক্লাসের নাম বদলান</h2><form id="rf"><input class="input" name="name" value="${esc(name)}" required><br><br><button class="btn">সেভ</button></form>`);
  $('#rf', m).onsubmit = async (e) => { e.preventDefault(); await post('/api/admin/classes/' + id, Object.fromEntries(new FormData(e.target)), 'PATCH'); m.remove(); route(); };
};
window.delClass = (id) => confirmBox('এই ক্লাস এবং এর সব ভিডিও ও ডাটা মুছে যাবে।', async () => { await api('/api/admin/classes/' + id, { method: 'DELETE' }); route(); });
window.delVideo = (id) => confirmBox('এই ভিডিও এবং এর সব দেখার ডাটা মুছে যাবে।', async () => { await api('/api/admin/videos/' + id, { method: 'DELETE' }); route(); });
function confirmBox(msg, fn, yes = 'হ্যাঁ, মুছুন') {
  const m = modal(`<h2>নিশ্চিত?</h2><p class="muted">${esc(msg)}</p><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn ghost" id="no">না</button><button class="btn danger" id="yes">${esc(yes)}</button></div>`);
  $('#no', m).onclick = () => m.remove(); $('#yes', m).onclick = async () => { m.remove(); await fn(); };
}
function uploadModal(classes) {
  if (!classes.length) return toast('আগে একটি ক্লাস তৈরি করুন');
  const m = modal(`<h2>ভিডিও আপলোড</h2><form id="uf">
    <label>ক্লাস</label><select class="input" name="class_id">${classes.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
    <label>ভিডিওর শিরোনাম</label><input class="input" name="title" placeholder="যেমন: অধ্যায় ১ - ভগ্নাংশ" required>
    <label>বিবরণ (ঐচ্ছিক)</label><textarea class="input" name="description" rows="2"></textarea>
    <label>ভিডিও ফাইল</label><div class="drop" id="drop">এখানে ক্লিক করুন বা ফাইল টেনে আনুন<br><small>MP4, MOV, MKV ইত্যাদি</small></div>
    <input type="file" name="file" accept="video/*" hidden id="file">
    <div class="upbar" id="upbar"><i></i></div><div class="err" id="uerr"></div>
    <button class="btn" id="ubtn">আপলোড শুরু করুন</button>
    <p class="muted" style="font-size:12.5px">আপলোডের পর ভিডিওটি এনক্রিপ্ট করা স্ট্রিমিং ফরম্যাটে রূপান্তর হবে। আসল ফাইলটি সার্ভারে রাখা হয় না।</p></form>`);
  const file = $('#file', m), drop = $('#drop', m);
  drop.onclick = () => file.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('has'); };
  drop.ondrop = (e) => { e.preventDefault(); file.files = e.dataTransfer.files; file.onchange(); };
  file.onchange = () => { if (file.files[0]) { drop.classList.add('has'); drop.innerHTML = '🎬 ' + esc(file.files[0].name) + `<br><small>${(file.files[0].size / 1048576).toFixed(1)} MB</small>`;
    const t = $('[name=title]', m); if (!t.value) t.value = file.files[0].name.replace(/\.[^.]+$/, ''); } };
  $('#uf', m).onsubmit = (e) => {
    e.preventDefault();
    if (!file.files[0]) return ($('#uerr', m).textContent = 'ভিডিও ফাইল সিলেক্ট করুন');
    const fd = new FormData(e.target), xhr = new XMLHttpRequest();
    $('#ubtn', m).disabled = true; $('#upbar', m).style.display = 'block';
    xhr.upload.onprogress = (ev) => { $('#upbar i', m).style.width = (ev.loaded / ev.total * 100) + '%'; $('#ubtn', m).textContent = `আপলোড হচ্ছে ${bn(Math.round(ev.loaded / ev.total * 100))}%`; };
    xhr.onload = () => { if (xhr.status === 200) { m.remove(); toast('আপলোড হয়েছে, এখন প্রসেস হচ্ছে'); route(); } else { $('#uerr', m).textContent = (JSON.parse(xhr.responseText || '{}').error) || 'আপলোড ব্যর্থ'; $('#ubtn', m).disabled = false; } };
    xhr.onerror = () => { $('#uerr', m).textContent = 'নেটওয়ার্ক সমস্যা'; $('#ubtn', m).disabled = false; };
    xhr.open('POST', '/api/admin/videos'); xhr.send(fd);
  };
}

// ---------------- leaderboard (admin only) ----------------
let lbFilter = { company: '', video: '' };
const medal = (r) => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : bn(r);
async function viewLeaderboard(main, tab = 'overall') {
  const tabs = `<div class="tabs">${[['overall', '🌐 সব মিলিয়ে'], ['video', '🎬 ভিডিও অনুযায়ী'], ['company', '🏢 কোম্পানি অনুযায়ী']]
    .map(([k, t]) => `<a href="#/leaderboard/${k}" class="${tab === k ? 'on' : ''}">${t}</a>`).join('')}</div>`;
  const note = (pf) => `<div class="muted" style="margin:0 0 16px;font-size:13px">🔒 শুধু অ্যাডমিন দেখতে পান। পয়েন্ট = ভিডিওর নতুন অংশ প্রতি মিনিট ১ পয়েন্ট, প্রতিটি ভিডিও শেষ করলে +${bn(pf)}। যেকোনো স্পিডে (১x, ২x…) দেখলে একই হিসাব। একই অংশ বারবার দেখলে পয়েন্ট বাড়ে না।</div>`;
  if (tab === 'overall' || (tab === 'video' && lbFilter.video)) {
    const f = tab === 'overall' ? { company: lbFilter.company, video: '' } : { company: lbFilter.company, video: lbFilter.video };
    const [d, videos] = await Promise.all([api('/api/admin/leaderboard?' + new URLSearchParams(f)), api('/api/admin/videos')]); await companiesReady;
    const top = d.rows.slice(0, 3);
    const vSel = tab === 'video' ? `<select class="input" id="lbv" style="width:auto;min-width:220px"><option value="">← সব ভিডিওর সারাংশ</option>${videos.filter(v => v.status === 'ready').map(v => `<option value="${v.id}" ${String(v.id) === lbFilter.video ? 'selected' : ''}>${esc(v.class_name)} · ${esc(v.title)}</option>`).join('')}</select>` : '';
    main.innerHTML = `<div class="head"><h1>🏆 লিডারবোর্ড</h1><div style="display:flex;gap:8px;flex-wrap:wrap">${companySelect('lbc', lbFilter.company)}${vSel}</div></div>${tabs}${note(d.ptsFinish)}
    ${top.length ? `<div class="podium">${[top[1], top[0], top[2]].map(r => r ? `<div class="card pod p${r.rank > 3 ? 3 : r.rank} click" onclick="location.hash='#/student/${r.id}'">
        <div class="m">${medal(r.rank)}</div><b>${esc(r.name)}</b><div>${co(r.company)}</div>
        <div class="pts">${bn(r.points)} <small>পয়েন্ট</small></div><div class="muted" style="font-size:12.5px">${bn(r.finished)}টি শেষ · ${dur(r.watch_time)}</div></div>` : '<div></div>').join('')}</div>` : ''}
    <div class="cols">
      <div class="card panel"><h3>স্টুডেন্ট র‍্যাংকিং <span class="pill">${bn(d.rows.length)} জন</span></h3><div class="scroll"><table>
        <tr><th>র‍্যাংক</th><th>নাম</th><th>কোম্পানি</th><th>পয়েন্ট</th><th>শেষ করেছে</th><th>কতটুকু দেখেছে</th><th>দেখার সময়</th><th>শেষ দেখা</th></tr>
        ${d.rows.map(r => `<tr class="click" onclick="location.hash='#/student/${r.id}'"><td style="font-size:18px;font-weight:700">${medal(r.rank)}</td><td><b>${esc(r.name)}</b></td><td>${co(r.company)}</td>
          <td><b style="color:var(--brand)">${bn(r.points)}</b></td><td>${bn(r.finished)} / ${bn(r.started)}</td><td style="min-width:100px">${bar(r.avg_percent)}<span class="muted" style="font-size:12px">${pct(r.avg_percent)}</span></td>
          <td>${dur(r.watch_time)}</td><td class="muted">${ago(r.last_watched)}</td></tr>`).join('') || '<tr><td colspan=8 class="muted">এখনো কেউ দেখেনি</td></tr>'}
      </table></div></div>
      <div class="card panel"><h3>🏢 কোম্পানি র‍্যাংকিং</h3><table>
        <tr><th>#</th><th>কোম্পানি</th><th>গড় পয়েন্ট</th><th>স্টুডেন্ট</th><th>শেষ করেছে</th></tr>
        ${d.companies.map((c, i) => `<tr><td style="font-size:18px">${medal(i + 1)}</td><td>${co(c.company)}<div class="muted" style="font-size:12px">মোট ${bn(Math.round(c.points))} পয়েন্ট · গড়ে ${pct(c.avg_percent)}</div></td><td><b>${bn(Math.round(c.avg_points))}</b></td><td>${bn(c.students)}</td><td>${bn(c.finished)}</td></tr>`).join('') || '<tr><td colspan=5 class="muted">কোনো ডাটা নেই</td></tr>'}
      </table></div>
    </div>`;
    $('#lbc').onchange = (e) => { lbFilter.company = e.target.value; route(); };
    if ($('#lbv')) $('#lbv').onchange = (e) => { lbFilter.video = e.target.value; route(); };
    return;
  }
  const d = await api('/api/admin/leaderboard/summary'); await companiesReady;
  const mini = (rows, n) => rows.length ? `<table>${rows.map(r => `<tr class="click" onclick="location.hash='#/student/${r.id}'"><td style="width:34px;font-size:17px">${medal(r.rank)}</td><td><b>${esc(r.name)}</b><div>${co(r.company)}</div></td><td style="text-align:right"><b style="color:var(--brand)">${bn(r.points)}</b><div class="muted" style="font-size:11.5px">পয়েন্ট</div></td></tr>`).join('')}</table>` : '<div class="muted" style="padding:14px 18px">এখনো কেউ দেখেনি</div>';
  if (tab === 'video') {
    main.innerHTML = `<div class="head"><h1>🏆 লিডারবোর্ড</h1></div>${tabs}${note(20)}
      <div class="lbgrid">${d.videos.map(v => `<div class="card panel"><h3 style="font-size:15px"><span>${esc(v.title)} ${v.source === 'youtube' ? '<span class="pill" style="background:#fee2e2;color:#b91c1c">▶ YouTube</span>' : ''}<div class="muted" style="font-size:12px;font-weight:400">${esc(v.class_name)} · ${bn(v.viewers)} জন দেখেছে</div></span>
        <button class="btn ghost sm" onclick="lbVideo(${v.id})">পুরো তালিকা →</button></h3>${mini(v.top)}</div>`).join('') || '<div class="card" style="padding:30px">কোনো ভিডিও নেই</div>'}</div>`;
  } else {
    main.innerHTML = `<div class="head"><h1>🏆 লিডারবোর্ড</h1></div>${tabs}${note(20)}
      <div class="card panel" style="margin-bottom:18px"><h3>কোম্পানি র‍্যাংকিং <span class="muted" style="font-size:12.5px;font-weight:400">গড় পয়েন্ট দিয়ে সাজানো, যাতে বেশি লোকের কোম্পানি শুধু সংখ্যার জোরে না এগোয়</span></h3><table>
        <tr><th>#</th><th>কোম্পানি</th><th>গড় পয়েন্ট</th><th>মোট পয়েন্ট</th><th>স্টুডেন্ট</th><th>ভিডিও শেষ</th><th>গড় দেখা</th></tr>
        ${d.board.map((c, i) => `<tr class="click" onclick="lbCompany('${esc(c.company || '__none')}')"><td style="font-size:20px">${medal(i + 1)}</td><td>${co(c.company)}</td><td><b style="color:var(--brand);font-size:16px">${bn(Math.round(c.avg_points))}</b></td><td>${bn(Math.round(c.points))}</td><td>${bn(c.students)}</td><td>${bn(c.finished)}</td><td style="min-width:110px">${bar(c.avg_percent)}<span class="muted" style="font-size:12px">${pct(c.avg_percent)}</span></td></tr>`).join('') || '<tr><td colspan=7 class="muted">কোনো ডাটা নেই</td></tr>'}
      </table></div>
      <div class="lbgrid">${d.companies.map(c => `<div class="card panel"><h3 style="font-size:15px"><span>${co(c.company)} <span class="muted" style="font-size:12px;font-weight:400">${bn(c.students)} জন</span></span>
        <button class="btn ghost sm" onclick="lbCompany('${esc(c.company || '__none')}')">পুরো তালিকা →</button></h3>${mini(c.top)}</div>`).join('')}</div>`;
  }
}
window.lbVideo = (id) => { lbFilter.video = String(id); location.hash = '#/leaderboard/video'; route(); };
window.lbCompany = (c) => { lbFilter.company = c; lbFilter.video = ''; location.hash = '#/leaderboard/overall'; route(); };

// ---------------- officer allowlist ----------------
async function viewAllow(main) {
  const d = await api('/api/admin/allowlist');
  main.innerHTML = `<div class="head"><h1>👮 লগইন তালিকা <span class="pill" id="acnt">${bn(d.rows.length)}টি নম্বর</span></h1>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="addOne">＋ একজন যোগ করুন</button><button class="btn ghost" id="imp">📋 Excel থেকে পেস্ট করে ইমপোর্ট</button></div></div>
  <div class="card" style="padding:14px 18px;margin-bottom:16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap;${d.enforced ? 'background:var(--ok-soft);border-color:var(--ok)' : 'background:var(--warn-soft);border-color:var(--warn)'}">
    <div style="flex:1;min-width:260px">${d.enforced ? '✅ <b>চালু:</b> শুধু এই তালিকার নম্বরে OTP যাবে ও লগইন করা যাবে। তালিকা থেকে কাউকে বাদ দিলে সে সাথে সাথে বের হয়ে যাবে।'
      : d.enabled ? '⚠️ তালিকা খালি, তাই এখন যেকোনো নম্বর ঢুকতে পারে। ইমপোর্ট করলেই নিয়ম চালু হবে।' : '⚠️ <b>বন্ধ:</b> এখন যেকোনো নম্বর দিয়ে লগইন করা যায়।'}</div>
    <label style="display:flex;gap:8px;align-items:center;font-weight:600;cursor:pointer"><input type="checkbox" id="aen" ${d.enabled ? 'checked' : ''}> শুধু তালিকার নম্বর ঢুকতে পারবে</label></div>
  ${d.rejected.length ? `<div class="card panel" style="margin-bottom:18px"><h3>🚫 তালিকার বাইরে থেকে যারা ঢুকতে চেয়েছিল <span class="muted" style="font-size:12.5px;font-weight:400">অনুরোধ এলে "যোগ করুন" চাপুন</span></h3><table>
    <tr><th>নম্বর</th><th>শেষ চেষ্টা</th><th>কতবার</th><th></th></tr>
    ${d.rejected.map(r => `<tr><td><b>${esc(r.phone)}</b></td><td class="muted">${ago(r.at)}</td><td>${bn(r.tries)}</td><td><button class="btn sm" onclick="allowAdd('${esc(r.phone)}')">＋ যোগ করুন</button></td></tr>`).join('')}</table></div>` : ''}
  <div class="card panel"><h3><span>অনুমোদিত নম্বর</span><span style="display:flex;gap:8px">${companySelect('acf')}<input class="input search" id="aq" placeholder="নাম, নম্বর বা ইমেইল"></span></h3><div class="scroll"><table id="atbl"></table></div></div>`;
  let cf = '';
  const draw = () => {
    const f = ($('#aq').value || '').toLowerCase();
    const rows = d.rows.filter(byCo(cf)).filter(r => (r.name + r.phone + r.email + r.designation + r.alt_phone).toLowerCase().includes(f));
    $('#acnt').textContent = bn(rows.length) + 'টি নম্বর';
    $('#atbl').innerHTML = `<tr><th>নাম</th><th>মোবাইল (লগইন)</th><th>কোম্পানি</th><th>পদবি</th><th>ইমেইল</th><th>লগইন করেছে?</th><th></th></tr>` +
      (rows.map(r => `<tr><td><b>${esc(r.name)}</b>${r.source === 'admin' ? ' <span class="pill" title="হাতে যোগ করা">হাতে</span>' : ''}</td><td style="white-space:nowrap">${esc(r.phone)}${r.alt_phone && r.alt_phone !== r.phone ? `<div class="muted" style="font-size:12px" title="বিকল্প ফোন (শুধু তথ্য)">বিকল্প: ${esc(r.alt_phone)}</div>` : ''}</td><td>${co(r.company)}</td><td>${esc(r.designation)}</td>
        <td style="font-size:13px">${esc(r.email)}${r.email && !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i.test(r.email) ? ' <span class="pill warn" title="প্রথম লগইনে নিজে ঠিক করে নেবে">ভুল?</span>' : ''}</td>
        <td>${r.student_id ? `<a href="#/student/${r.student_id}">✅ হ্যাঁ</a><div class="muted" style="font-size:12px">${ago(r.last_seen)}</div>` : '<span class="muted">এখনো না</span>'}</td>
        <td style="white-space:nowrap"><button class="btn ghost sm" onclick="allowEdit('${esc(r.phone)}')">এডিট</button> <button class="btn danger sm" onclick="allowDel('${esc(r.phone)}')">বাদ দিন</button></td></tr>`).join('')
      || '<tr><td colspan=7 class="muted">তালিকা খালি। উপরের "Excel থেকে পেস্ট করে ইমপোর্ট" দিয়ে অফিসারদের তালিকা যোগ করুন।</td></tr>');
  };
  draw(); $('#aq').oninput = draw; $('#acf').onchange = (e) => { cf = e.target.value; draw(); };
  $('#aen').onchange = async (e) => { await post('/api/admin/allowlist/settings', { enabled: e.target.checked }); toast(e.target.checked ? 'চালু হয়েছে' : 'বন্ধ হয়েছে'); route(); };
  window.allowRows = d.rows;
  $('#addOne').onclick = () => allowForm({});
  $('#imp').onclick = () => {
    const m = modal(`<h2>📋 অফিসারদের তালিকা ইমপোর্ট</h2>
      <div class="muted" style="font-size:13px">Excel বা Google Sheet থেকে এই ক্রমে কলামগুলো সিলেক্ট করে কপি করুন, তারপর নিচে পেস্ট করুন:<br><b>নাম · কোম্পানি · পদবি · মোবাইল · ইমেইল · বিকল্প ফোন</b><br>
      একই নম্বর একাধিকবার থাকলে একটাই রাখা হবে। আগে থেকে থাকা নম্বরের তথ্য আপডেট হবে, কাউকে বাদ দেওয়া হবে না।</div>
      <textarea class="input" id="impT" rows="12" style="font-family:monospace;font-size:12px;margin-top:10px;white-space:pre" placeholder="Rayhan	Coastal Manpower	Executive Officer	01805992626	name@gmail.com	01865428516"></textarea>
      <div class="err" id="impE"></div><div id="impR"></div><button class="btn" id="impB">ইমপোর্ট করুন</button>`, true);
    $('#impB', m).onclick = async () => {
      $('#impE', m).textContent = ''; $('#impB', m).disabled = true;
      try {
        const r = await post('/api/admin/allowlist/import', { text: $('#impT', m).value });
        $('#impR', m).innerHTML = `<div class="card" style="padding:12px 14px;margin:10px 0;background:#ecfdf5">✅ ${bn(r.rows)}টি লাইন থেকে ${bn(r.unique)} জন: নতুন ${bn(r.added)}, আপডেট ${bn(r.updated)}${r.merged ? `, ডুপ্লিকেট একত্র ${bn(r.merged)}` : ''}।
          ${r.bad.length ? `<div style="color:var(--bad);margin-top:6px">⚠️ ${bn(r.bad.length)}টি লাইনে সঠিক মোবাইল নম্বর নেই, বাদ গেছে:<br><small>${r.bad.map(esc).join('<br>')}</small></div>` : ''}
          ${r.unknownCompany.length ? `<div class="muted" style="margin-top:6px">অজানা কোম্পানি: ${r.unknownCompany.map(esc).join(', ')}</div>` : ''}</div>`;
        $('#impB', m).textContent = 'বন্ধ করুন'; $('#impB', m).disabled = false; $('#impB', m).onclick = () => { m.remove(); route(); };
      } catch (er) { $('#impE', m).textContent = er.message; $('#impB', m).disabled = false; }
    };
  };
}
function allowForm(r) {
  const m = modal(`<h2>${r.phone ? 'তথ্য এডিট' : '＋ লগইন তালিকায় যোগ করুন'}</h2><form id="alf">
    <label>মোবাইল নম্বর (এটা দিয়েই লগইন করবে)</label><input class="input" name="phone" value="${esc(r.phone)}" ${r.phone && r.name ? 'readonly' : ''} required placeholder="01XXXXXXXXX">
    <label>নাম</label><input class="input" name="name" value="${esc(r.name)}" required>
    <label>কোম্পানি</label><select class="input" name="company"><option value="">—</option>${COMPANIES.map(c => `<option ${c === r.company ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <label>পদবি</label><input class="input" name="designation" value="${esc(r.designation)}">
    <label>ইমেইল</label><input class="input" name="email" value="${esc(r.email)}">
    <label>বিকল্প ফোন</label><input class="input" name="alt_phone" value="${esc(r.alt_phone)}">
    <div class="err" id="alE"></div><button class="btn">সেভ করুন</button></form>`);
  $('#alf', m).onsubmit = async (e) => { e.preventDefault();
    try { await post('/api/admin/allowlist', Object.fromEntries(new FormData(e.target))); m.remove(); toast('সেভ হয়েছে, এখন এই নম্বর দিয়ে লগইন করা যাবে'); route(); }
    catch (er) { $('#alE', m).textContent = er.message; } };
}
window.allowAdd = (phone) => allowForm({ phone });
window.allowEdit = (phone) => allowForm((window.allowRows || []).find(r => r.phone === phone) || { phone });
window.allowDel = (phone) => confirmBox(`${phone} নম্বরটি তালিকা থেকে বাদ দিলে সে আর লগইন করতে পারবে না (তার দেখার ডাটা থেকে যাবে)।`, async () => { await api('/api/admin/allowlist/' + encodeURIComponent(phone), { method: 'DELETE' }); route(); }, 'হ্যাঁ, বাদ দিন');

// ---------------- settings: SMS gateway for OTP ----------------
async function viewSettings(main) {
  const d = await api('/api/admin/sms');
  const names = { test: '🧪 টেস্ট মোড (SMS যাবে না, কোড নিচে দেখাবে)', bulksmsbd: 'BulkSMSBD (bulksmsbd.net)', alpha: 'Alpha SMS (sms.net.bd)', custom: 'অন্য কোম্পানি (কাস্টম লিংক)' };
  main.innerHTML = `<div class="head"><h1>⚙️ সেটিংস</h1></div><div id="brandBox"></div>
  ${d.provider === 'test' ? '<div class="card" style="padding:14px 18px;margin-bottom:16px;background:var(--warn-soft);border-color:var(--warn)"><b>এখন টেস্ট মোড চালু।</b> স্টুডেন্টদের ফোনে SMS যাচ্ছে না, কোড শুধু নিচের তালিকায় দেখা যাচ্ছে। আসল ব্যবহারের আগে BulkSMSBD বেছে API key দিন।</div>' : ''}
  <div class="cols"><div class="card panel"><h3>📱 লগইন ও SMS সেটিংস</h3><form id="smsF" style="padding:6px 18px 18px">
    <label>SMS কোম্পানি</label><select class="input" name="provider">${d.providers.map(p => `<option value="${p}" ${p === d.provider ? 'selected' : ''}>${names[p] || p}</option>`).join('')}</select>
    <div class="pv pv-bulksmsbd pv-alpha pv-custom"><label>API Key ${d.api_key_set ? `<span class="muted" style="font-weight:400">(সেভ করা আছে ${esc(d.api_key_hint)}, বদলাতে চাইলে নতুনটা লিখুন)</span>` : ''}</label>
      <input class="input" name="api_key" autocomplete="off" placeholder="${d.api_key_set ? 'খালি রাখলে আগেরটাই থাকবে' : 'আপনার API key'}"></div>
    <div class="pv pv-bulksmsbd pv-alpha"><label>Sender ID <span class="muted" style="font-weight:400">(BulkSMSBD প্যানেলে যে Sender ID দেখায়)</span></label><input class="input" name="sender_id" value="${esc(d.sender_id)}" placeholder="যেমন: 8809617xxxxxx"></div>
    <div class="pv pv-custom"><label>লিংক <span class="muted" style="font-weight:400">({to} = নম্বর, {msg} = মেসেজ, {key} = API key)</span></label><input class="input" name="custom_url" value="${esc(d.custom_url)}" placeholder="https://.../send?key={key}&to={to}&text={msg}"></div>
    <label>তালিকার বাইরের নম্বরে যে নোটিস দেখাবে</label><textarea class="input" name="login_notice" rows="3">${esc(d.login_notice)}</textarea>
    <div class="muted" style="font-size:12px;margin-top:4px">${d.allow_enforced ? `👮 এখন শুধু লগইন তালিকার ${bn(d.allow_count)}টি নম্বর ঢুকতে পারে।` : '⚠️ লগইন তালিকা এখন বন্ধ বা খালি, তাই যেকোনো নম্বর ঢুকতে পারে।'} <a href="#/allow">তালিকা দেখুন →</a></div>
    <label>SMS এর লেখা <span class="muted" style="font-weight:400">({code} এর জায়গায় কোড বসবে। ইংরেজিতে লিখলে খরচ কম)</span></label><textarea class="input" name="message" rows="2">${esc(d.message)}</textarea>
    <div class="err" id="smsErr"></div><button class="btn">সেভ করুন</button></form></div>
    <div class="card panel"><h3>✉️ টেস্ট SMS পাঠান</h3><form id="testF" style="padding:6px 18px 18px;display:grid;gap:8px">
      <div class="muted" style="font-size:13px">সেভ করার পর নিজের নম্বরে একটা টেস্ট SMS পাঠিয়ে দেখুন ঠিকমতো যাচ্ছে কিনা।</div>
      <input class="input" name="phone" placeholder="01XXXXXXXXX" required><div class="err" id="testErr"></div><button class="btn ghost">টেস্ট SMS পাঠান</button></form></div></div>
  <div class="card panel" style="margin-top:18px"><h3>🔐 সাম্প্রতিক OTP <span class="muted" style="font-size:12.5px;font-weight:400">কোড শুধু টেস্ট মোডে দেখা যায়, আসল মোডে কোড কোথাও সেভ হয় না</span></h3><div class="scroll"><table>
    <tr><th>কখন</th><th>নম্বর</th><th>কে</th><th>অবস্থা</th><th>কোড (টেস্ট মোড)</th></tr>
    ${d.log.map(l => `<tr><td class="muted">${ago(l.at)}</td><td>${esc(l.phone)}</td><td>${l.name ? esc(l.name) : '<span class="muted">নতুন</span>'}</td>
      <td>${l.ok ? `<span class="pill ok">✓ ${l.provider === 'test' ? 'টেস্ট' : 'পাঠানো হয়েছে'}</span>` : `<span class="pill bad" title="${esc(l.error)}">✗ ব্যর্থ</span><div class="muted" style="font-size:12px">${esc(l.error)}</div>`}</td>
      <td style="font-size:18px;font-weight:700;letter-spacing:3px">${esc(l.test_code || '')}</td></tr>`).join('') || '<tr><td colspan=5 class="muted">এখনো কোনো OTP পাঠানো হয়নি</td></tr>'}
  </table></div></div>`;
  await renderBrand($('#brandBox'));
  const f = $('#smsF'); const showPv = () => f.querySelectorAll('.pv').forEach(x => { x.style.display = x.classList.contains('pv-' + f.provider.value) ? '' : 'none'; });
  f.provider.onchange = showPv; showPv();
  f.onsubmit = async (e) => { e.preventDefault(); $('#smsErr').textContent = '';
    try { await post('/api/admin/sms', Object.fromEntries(new FormData(f))); toast('সেভ হয়েছে'); route(); } catch (er) { $('#smsErr').textContent = er.message; } };
  $('#testF').onsubmit = async (e) => { e.preventDefault(); $('#testErr').textContent = '';
    try { const r = await post('/api/admin/sms/test', Object.fromEntries(new FormData(e.target))); toast(r.test ? 'টেস্ট মোড: SMS যায়নি, তালিকায় দেখুন' : 'SMS পাঠানো হয়েছে, ফোন চেক করুন'); route(); }
    catch (er) { $('#testErr').textContent = er.message; } };
  refreshTimer = setInterval(() => { if (location.hash === '#/settings' && !window.brandDirty && !document.activeElement.closest('form')) viewSettings(main).catch(() => {}); }, 10000);
}

// ---------------- questions from students ----------------
async function updateQBadge() {
  try { const r = await fetch('/api/admin/questions/count'); if (!r.ok) return; const { open } = await r.json();
    const b = $('#qBadge'); if (b) { b.textContent = bn(open); b.style.display = open ? '' : 'none'; } } catch {}
}
async function viewQuestions(main, tab = 'open') {
  const d = await api('/api/admin/questions?filter=' + tab);
  const tabs = `<div class="tabs">${[['open', `⏳ উত্তর বাকি (${bn(d.open)})`], ['answered', '✅ উত্তর দেওয়া'], ['hidden', '🙈 লুকানো'], ['all', 'সব']]
    .map(([k, t]) => `<a href="#/questions/${k}" class="${tab === k ? 'on' : ''}">${t}</a>`).join('')}</div>`;
  main.innerHTML = `<div class="head"><h1>❓ স্টুডেন্টদের প্রশ্ন</h1></div>${tabs}
    <div class="muted" style="margin:0 0 14px;font-size:13px">স্টুডেন্টরা প্রতিটি ভিডিওর নিচে প্রশ্ন করতে পারে। আপনি উত্তর দিলে সেটা ওই ভিডিওর নিচে সবাই দেখতে পাবে (প্রশ্নকারীর নামসহ)। উত্তর না দেওয়া প্রশ্ন শুধু প্রশ্নকারী নিজে দেখে। কোনো প্রশ্ন সবার সামনে রাখতে না চাইলে "লুকান" চাপুন।</div>
    <div class="card panel">${d.items.map(x => `<div class="qrow" id="q${x.id}">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><div><b>${esc(x.name)}</b> ${co(x.company)} <span class="muted" style="font-size:12.5px">${esc(x.phone)} · ${ago(x.created_at)}</span></div>
        <a class="pill" href="#/video/${x.video_id}">🎬 ${esc(x.video_title)}</a></div>
      <div style="white-space:pre-wrap;margin:8px 0;font-size:15.5px">${esc(x.body)}</div>
      <textarea class="input" rows="2" placeholder="উত্তর লিখুন…">${esc(x.answer || '')}</textarea>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center">
        <button class="btn sm" onclick="qAnswer(${x.id})">${x.answer ? 'উত্তর আপডেট করুন' : 'উত্তর দিন'}</button>
        <button class="btn ghost sm" onclick="qHide(${x.id}, ${x.hidden ? 0 : 1})">${x.hidden ? '👁 দেখান' : '🙈 লুকান'}</button>
        <button class="btn danger sm" onclick="qDel(${x.id})">মুছুন</button>
        ${x.answered_at ? `<span class="muted" style="font-size:12.5px">উত্তর দেওয়া হয়েছে ${ago(x.answered_at)}</span>` : ''}</div></div>`).join('')
      || `<div class="muted" style="padding:30px;text-align:center">${tab === 'open' ? '🎉 সব প্রশ্নের উত্তর দেওয়া হয়ে গেছে' : 'কিছু নেই'}</div>`}</div>`;
  refreshTimer = setInterval(() => { if (location.hash.startsWith('#/questions') && !document.activeElement.closest('textarea') && ![...document.querySelectorAll('.qrow textarea')].some(t => t.value !== t.defaultValue)) viewQuestions(main, tab).catch(() => {}); }, 30000);
}
window.qAnswer = async (id) => { const t = $(`#q${id} textarea`).value.trim(); if (!t) return toast('উত্তর লিখুন');
  await post('/api/admin/questions/' + id, { answer: t }); toast('উত্তর দেওয়া হয়েছে'); route(); };
window.qHide = async (id, h) => { await post('/api/admin/questions/' + id, { hidden: h }); route(); };
window.qDel = (id) => confirmBox('প্রশ্নটি মুছে যাবে।', async () => { await api('/api/admin/questions/' + id, { method: 'DELETE' }); route(); });

// ---------------- quiz editor (per video) ----------------
window.quizEditor = async (videoId) => {
  const [d, videos] = await Promise.all([api(`/api/admin/videos/${videoId}/quiz`), api('/api/admin/videos')]);
  const v = videos.find(x => x.id === videoId) || {};
  let items = d.items.length ? d.items.map(i => ({ q: i.q, options: [...i.options], correct: i.correct })) : [{ q: '', options: ['', '', '', ''], correct: -1 }];
  const m = modal(`<h2>📝 কুইজ: ${esc(v.title)}</h2>
    <div class="muted" style="font-size:13px;margin-bottom:12px">স্টুডেন্ট ভিডিওটি শেষ করলে নিচে কুইজ খুলবে, প্রত্যেকে একবার দিতে পারবে। প্রতিটি প্রশ্নে সঠিক উত্তরের পাশের গোল ঘরে টিক দিন।${d.attempts ? `<br>⚠️ এর মধ্যে ${bn(d.attempts)} জন কুইজ দিয়েছে। প্রশ্ন বদলালে তাদের আগের নম্বর আগের মতোই থাকবে।` : ''}</div>
    <div id="qzList"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px"><button class="btn ghost" id="qzAdd">＋ প্রশ্ন যোগ করুন</button><span style="flex:1"></span>
    <button class="btn" id="qzSave">সেভ করুন</button></div><div class="err" id="qzErr"></div>`, true);
  const sync = () => m.querySelectorAll('.qedit').forEach((el, n) => {
    items[n].q = $('.qq', el).value;
    items[n].options = [...el.querySelectorAll('.qo')].map(i => i.value);
    const c = el.querySelector('input[type=radio]:checked'); items[n].correct = c ? Number(c.value) : -1;
  });
  const draw = () => {
    $('#qzList', m).innerHTML = items.map((it, n) => `<div class="qedit">
      <div style="display:flex;gap:8px;align-items:center"><b>${bn(n + 1)}.</b><input class="input qq" value="${esc(it.q)}" placeholder="প্রশ্ন লিখুন"><button class="btn danger sm" onclick="this.dispatchEvent(new CustomEvent('qdel',{bubbles:true,detail:${n}}))" title="প্রশ্নটি বাদ দিন">✕</button></div>
      ${it.options.map((o, i) => `<div class="opt"><input type="radio" name="c${n}" value="${i}" ${it.correct === i ? 'checked' : ''} title="এটাই সঠিক উত্তর"><input class="input qo" value="${esc(o)}" placeholder="অপশন ${bn(i + 1)}">
        ${it.options.length > 2 ? `<button class="btn ghost sm" onclick="this.dispatchEvent(new CustomEvent('odel',{bubbles:true,detail:[${n},${i}]}))" title="অপশন বাদ">−</button>` : ''}</div>`).join('')}
      ${it.options.length < 6 ? `<button class="btn ghost sm" style="margin-top:8px" onclick="this.dispatchEvent(new CustomEvent('oadd',{bubbles:true,detail:${n}}))">＋ অপশন</button>` : ''}</div>`).join('')
      || '<div class="muted" style="padding:10px 0">কোনো প্রশ্ন নেই। সেভ করলে এই ভিডিওর কুইজ বন্ধ হয়ে যাবে।</div>';
  };
  m.addEventListener('qdel', (e) => { sync(); items.splice(e.detail, 1); draw(); });
  m.addEventListener('odel', (e) => { sync(); const [n, i] = e.detail, it = items[n]; it.options.splice(i, 1); if (it.correct === i) it.correct = -1; else if (it.correct > i) it.correct--; draw(); });
  m.addEventListener('oadd', (e) => { sync(); items[e.detail].options.push(''); draw(); });
  $('#qzAdd', m).onclick = () => { sync(); items.push({ q: '', options: ['', '', '', ''], correct: -1 }); draw(); m.querySelector('.qedit:last-child .qq').focus(); };
  $('#qzSave', m).onclick = async () => {
    sync(); $('#qzErr', m).textContent = '';
    // drop empty option boxes, keeping the right answer pointing at the same text
    const out = items.filter(it => it.q.trim() || it.options.some(o => o.trim())).map(it => {
      const keep = it.options.map((o, i) => [o.trim(), i]).filter(([o]) => o);
      return { q: it.q, options: keep.map(([o]) => o), correct: keep.findIndex(([, i]) => i === it.correct) };
    });
    try { const r = await post(`/api/admin/videos/${videoId}/quiz`, { items: out }, 'PUT'); m.remove(); toast(r.count ? `কুইজ সেভ হয়েছে (${bn(r.count)}টি প্রশ্ন)` : 'কুইজ বন্ধ করা হয়েছে'); route(); }
    catch (er) { $('#qzErr', m).textContent = er.message; }
  };
  draw();
};

// ---------------- quiz leaderboard ----------------
let qzFilter = { company: '', video: '' };
async function viewQuizBoard(main, tab = 'overall') {
  const tabs = `<div class="tabs">${[['overall', '🌐 সব মিলিয়ে'], ['video', '🎬 ভিডিও অনুযায়ী'], ['company', '🏢 কোম্পানি অনুযায়ী']]
    .map(([k, t]) => `<a href="#/quiz/${k}" class="${tab === k ? 'on' : ''}">${t}</a>`).join('')}</div>`;
  const note = `<div class="muted" style="margin:0 0 16px;font-size:13px">🔒 শুধু অ্যাডমিন দেখতে পান। র‍্যাংকিং = মোট সঠিক উত্তর, সমান হলে যার সঠিকের হার বেশি, তাও সমান হলে যে কম সময়ে শেষ করেছে। প্রত্যেকে প্রতিটি কুইজ একবার দিতে পারে।</div>`;
  const secs = (ms) => { const s = Math.round((ms || 0) / 1000); return s < 60 ? bn(s) + ' সে' : bn(Math.floor(s / 60)) + ' মি ' + bn(s % 60) + ' সে'; };
  await companiesReady;
  if (tab === 'overall' || (tab === 'video' && qzFilter.video)) {
    const f = { company: qzFilter.company, video: tab === 'video' ? qzFilter.video : '' };
    const [d, sum] = await Promise.all([api('/api/admin/quiz-board?' + new URLSearchParams(f)), api('/api/admin/quiz-board/summary')]);
    const top = d.rows.slice(0, 3), vid = Number(f.video) || 0;
    const vSel = tab === 'video' ? `<select class="input" id="qzv" style="width:auto;min-width:220px"><option value="">← সব কুইজের সারাংশ</option>${sum.videos.map(v => `<option value="${v.id}" ${String(v.id) === qzFilter.video ? 'selected' : ''}>${esc(v.class_name)} · ${esc(v.title)}</option>`).join('')}</select>` : '';
    main.innerHTML = `<div class="head"><h1>📝 কুইজ লিডারবোর্ড</h1><div style="display:flex;gap:8px;flex-wrap:wrap">${companySelect('qzc', qzFilter.company)}${vSel}</div></div>${tabs}${note}
    ${top.length ? `<div class="podium">${[top[1], top[0], top[2]].map(r => r ? `<div class="card pod p${r.rank > 3 ? 3 : r.rank}" onclick="location.hash='#/student/${r.id}'">
        <div class="m">${medal(r.rank)}</div><b>${esc(r.name)}</b><div>${co(r.company)}</div>
        <div class="pts">${bn(r.correct)} <small>সঠিক</small></div><div class="muted" style="font-size:12.5px">${bn(Math.round(r.pct))}% · ${bn(r.quizzes)}টি কুইজ · ${secs(r.time_ms)}</div></div>` : '<div></div>').join('')}</div>` : ''}
    <div class="cols">
      <div class="card panel"><h3>স্টুডেন্ট র‍্যাংকিং <span class="pill">${bn(d.rows.length)} জন</span></h3><div class="scroll"><table>
        <tr><th>র‍্যাংক</th><th>নাম</th><th>কোম্পানি</th><th>সঠিক</th><th>হার</th><th>কুইজ</th><th>সময়</th><th>কখন</th>${vid ? '<th></th>' : ''}</tr>
        ${d.rows.map(r => `<tr><td style="font-size:18px;font-weight:700">${medal(r.rank)}</td><td><a href="#/student/${r.id}"><b>${esc(r.name)}</b></a></td><td>${co(r.company)}</td>
          <td><b style="color:var(--brand)">${bn(r.correct)}</b> / ${bn(r.total)}</td><td style="min-width:90px">${bar(r.pct, r.pct >= 80)}<span class="muted" style="font-size:12px">${bn(Math.round(r.pct))}%</span></td>
          <td>${bn(r.quizzes)}</td><td>${secs(r.time_ms)}</td><td class="muted">${ago(r.last_at)}</td>
          ${vid ? `<td><button class="btn ghost sm" onclick="qzReset(${vid}, ${r.id})" title="এই স্টুডেন্ট আবার কুইজ দিতে পারবে">↺ আবার দিতে দিন</button></td>` : ''}</tr>`).join('') || `<tr><td colspan=9 class="muted">এখনো কেউ কুইজ দেয়নি${sum.videos.length ? '' : '। প্রথমে 🎬 ক্লাস ও ভিডিও পেজে কোনো ভিডিওর "📝 কুইজ" বাটন থেকে প্রশ্ন যোগ করুন।'}</td></tr>`}
      </table></div></div>
      <div class="card panel"><h3>🏢 কোম্পানি র‍্যাংকিং</h3><table>
        <tr><th>#</th><th>কোম্পানি</th><th>সঠিকের হার</th><th>অংশ নিয়েছে</th></tr>
        ${d.companies.map((c, i) => `<tr><td style="font-size:18px">${medal(i + 1)}</td><td>${co(c.company)}<div class="muted" style="font-size:12px">মোট ${bn(c.correct)} / ${bn(c.total)} সঠিক</div></td><td><b>${bn(Math.round(c.pct))}%</b></td><td>${bn(c.students)} জন</td></tr>`).join('') || '<tr><td colspan=4 class="muted">কোনো ডাটা নেই</td></tr>'}
      </table></div>
    </div>`;
    $('#qzc').onchange = (e) => { qzFilter.company = e.target.value; route(); };
    if ($('#qzv')) $('#qzv').onchange = (e) => { qzFilter.video = e.target.value; route(); };
    return;
  }
  const d = await api('/api/admin/quiz-board/summary');
  const mini = (rows) => rows.length ? `<table>${rows.map(r => `<tr class="click" onclick="location.hash='#/student/${r.id}'"><td style="width:34px;font-size:17px">${medal(r.rank)}</td><td><b>${esc(r.name)}</b><div>${co(r.company)}</div></td><td style="text-align:right"><b style="color:var(--brand)">${bn(r.correct)}/${bn(r.total)}</b><div class="muted" style="font-size:11.5px">${secs(r.time_ms)}</div></td></tr>`).join('')}</table>` : '<div class="muted" style="padding:14px 18px">এখনো কেউ দেয়নি</div>';
  if (tab === 'video') {
    main.innerHTML = `<div class="head"><h1>📝 কুইজ লিডারবোর্ড</h1></div>${tabs}${note}
      <div class="lbgrid">${d.videos.map(v => `<div class="card panel"><h3 style="font-size:15px"><span>${esc(v.title)}<div class="muted" style="font-size:12px;font-weight:400">${esc(v.class_name)} · ${bn(v.items)}টি প্রশ্ন · ${bn(v.attempts)} জন দিয়েছে${v.attempts ? ' · গড় ' + bn(Math.round(v.pct)) + '%' : ''}</div></span>
        <button class="btn ghost sm" onclick="qzVideo(${v.id})">পুরো তালিকা →</button></h3>${mini(v.top)}</div>`).join('') || '<div class="card" style="padding:30px">এখনো কোনো ভিডিওতে কুইজ নেই। 🎬 ক্লাস ও ভিডিও পেজে ভিডিওর পাশের "📝 কুইজ" বাটন থেকে প্রশ্ন যোগ করুন।</div>'}</div>`;
  } else {
    main.innerHTML = `<div class="head"><h1>📝 কুইজ লিডারবোর্ড</h1></div>${tabs}${note}
      <div class="card panel"><h3>কোম্পানি র‍্যাংকিং <span class="muted" style="font-size:12.5px;font-weight:400">সঠিকের হার দিয়ে সাজানো</span></h3><table>
        <tr><th>#</th><th>কোম্পানি</th><th>সঠিকের হার</th><th>মোট সঠিক</th><th>অংশ নিয়েছে</th><th>কুইজ দেওয়া হয়েছে</th></tr>
        ${d.companies.map((c, i) => `<tr class="click" onclick="qzCompany('${esc(c.company || '__none')}')"><td style="font-size:20px">${medal(i + 1)}</td><td>${co(c.company)}</td><td style="min-width:120px">${bar(c.pct, c.pct >= 80)}<b>${bn(Math.round(c.pct))}%</b></td><td>${bn(c.correct)} / ${bn(c.total)}</td><td>${bn(c.students)} জন</td><td>${bn(c.quizzes)} বার</td></tr>`).join('') || '<tr><td colspan=6 class="muted">কোনো ডাটা নেই</td></tr>'}
      </table></div>`;
  }
}
window.qzVideo = (id) => { qzFilter.video = String(id); location.hash = '#/quiz/video'; route(); };
window.qzCompany = (c) => { qzFilter.company = c; qzFilter.video = ''; location.hash = '#/quiz/overall'; route(); };
window.qzReset = (vid, sid) => confirmBox('এই স্টুডেন্টের এই কুইজের নম্বর মুছে যাবে এবং সে আবার কুইজ দিতে পারবে।', async () => { await api(`/api/admin/videos/${vid}/quiz/attempts/${sid}`, { method: 'DELETE' }); route(); }, 'হ্যাঁ, আবার দিতে দিন');

// ---------------- site customisation (inside ⚙️ সেটিংস) ----------------
async function renderBrand(el) {
  const b = await api('/api/admin/brand'); window.brandDirty = false;
  b.footer = b.footer_raw;
  const t = (k, label, rows, hint) => `<label>${label}${hint ? ` <span class="muted" style="font-weight:400">${hint}</span>` : ''}</label>${rows ? `<textarea class="input" name="${k}" rows="${rows}">${esc(b[k])}</textarea>` : `<input class="input" name="${k}" value="${esc(b[k])}">`}`;
  const tog = (k, label) => `<label style="display:flex;gap:10px;align-items:center;font-weight:600;margin:10px 0"><input type="checkbox" name="${k}" ${b[k] === '1' ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--brand)"> ${label}</label>`;
  el.innerHTML = `<div class="card panel" style="margin-bottom:18px"><h3>🎨 সাইট কাস্টমাইজ <span class="muted" style="font-size:12.5px;font-weight:400">নাম, লোগো, রং আর সাইটের লেখা এখান থেকে বদলান</span></h3>
  <form id="brandF" style="padding:6px 18px 18px"><div class="cols">
    <div>
      ${t('site_name', 'সাইটের নাম')}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><label>লোগোর চিহ্ন <span class="muted" style="font-weight:400">(ছবি না দিলে)</span></label><input class="input" name="logo_text" value="${esc(b.logo_text)}" maxlength="4" placeholder="▶ বা 🎓"></div>
        <div><label>মূল রং</label><input class="input" type="color" name="color" value="${esc(b.color)}" style="height:46px;padding:4px"></div></div>
      <label>লোগোর ছবি <span class="muted" style="font-weight:400">(PNG/JPG/SVG, ৫০০ KB এর কম, বর্গাকার হলে ভালো)</span></label>
      <div class="bpre">${b.has_logo ? `<img src="/brand/logo?v=${b.ver}">` : ''}<input type="file" id="logoFile" accept="image/png,image/jpeg,image/svg+xml,image/webp" class="input" style="flex:1">${b.has_logo ? '<button type="button" class="btn danger sm" id="logoDel">ছবি বাদ</button>' : ''}</div>
      <label>ফেভিকন (ব্রাউজার ট্যাবের ছোট আইকন) <span class="muted" style="font-weight:400">(না দিলে লোগো থেকেই বানাবে)</span></label>
      <div class="bpre"><img src="/brand/favicon?v=${b.ver}"><input type="file" id="favFile" accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml" class="input" style="flex:1">${b.has_favicon ? '<button type="button" class="btn danger sm" id="favDel">বাদ</button>' : ''}</div>
      <label>স্টুডেন্টদের জন্য শুরুর মোড</label><select class="input" name="theme"><option value="light" ${b.theme === 'light' ? 'selected' : ''}>☀️ দিনের মোড (সাদা)</option><option value="dark" ${b.theme === 'dark' ? 'selected' : ''}>🌙 রাতের মোড (কালো)</option></select>
      <div class="muted" style="font-size:12px;margin-top:4px">প্রত্যেকে উপরের 🌙/☀️ বাটন দিয়ে নিজের জন্য বদলে নিতে পারবে। ভিডিও পেজ শুরুতে রাতের মোডে থাকে।</div>
      ${tog('qa_enabled', '❓ ভিডিওর নিচে প্রশ্ন করা চালু')}
      ${tog('quiz_enabled', '📝 ভিডিওর পরে কুইজ চালু')}
      ${tog('quiz_need_finish', '🔒 ভিডিও পুরো শেষ করার পরই কুইজ খুলবে')}
    </div>
    <div>
      ${t('hero_title', 'লগইন পেজের বড় শিরোনাম', 2)}
      ${t('hero_text', 'শিরোনামের নিচের লেখা', 2)}
      ${t('features', 'বৈশিষ্ট্যের তালিকা', 3, '(প্রতি লাইনে একটা)')}
      ${t('login_title', 'লগইন বক্সের শিরোনাম')}
      ${t('login_sub', 'লগইন বক্সের ছোট লেখা', 2)}
      ${t('catalog_title', 'স্টুডেন্টের হোম পেজের শিরোনাম')}
      ${t('noshare', 'ভিডিওর উপরের লাল সতর্কবার্তা')}
      ${t('watch_note', 'ভিডিওর নিচের নিরাপত্তা নোট', 3)}
      ${t('footer', 'নিচের লেখা (ফুটার)', 0, '(খালি রাখলে "© সাইটের নাম")')}
    </div></div>
    <div class="err" id="brandErr"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn">সেভ করুন</button><button type="button" class="btn ghost" id="brandReset">লেখাগুলো আগের মতো করুন</button></div>
  </form></div>`;
  const f = $('#brandF'), extra = {};
  f.oninput = () => { window.brandDirty = true; };
  const readImg = (file) => new Promise((ok, no) => { if (file.size > 500 * 1024) return no(new Error('ছবিটি ৫০০ KB এর চেয়ে ছোট দিন'));
    const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(new Error('ছবি পড়া যায়নি')); r.readAsDataURL(file); });
  $('#logoFile').onchange = async (e) => { try { extra.logo_img = await readImg(e.target.files[0]); window.brandDirty = true; } catch (er) { $('#brandErr').textContent = er.message; e.target.value = ''; } };
  $('#favFile').onchange = async (e) => { try { extra.favicon = await readImg(e.target.files[0]); window.brandDirty = true; } catch (er) { $('#brandErr').textContent = er.message; e.target.value = ''; } };
  if ($('#logoDel')) $('#logoDel').onclick = async () => { await post('/api/admin/brand', { logo_img: '' }); location.reload(); };
  if ($('#favDel')) $('#favDel').onclick = async () => { await post('/api/admin/brand', { favicon: '' }); location.reload(); };
  $('#brandReset').onclick = () => confirmBox('সাইটের নাম, রং আর সব লেখা শুরুর মতো হয়ে যাবে (লোগোর ছবি থাকবে)।', async () => { await post('/api/admin/brand', { reset: true }); location.reload(); }, 'হ্যাঁ, আগের মতো করুন');
  f.onsubmit = async (e) => {
    e.preventDefault(); $('#brandErr').textContent = '';
    const data = Object.fromEntries(new FormData(f));
    for (const k of ['qa_enabled', 'quiz_enabled', 'quiz_need_finish']) data[k] = f.elements[k].checked ? '1' : '0';
    try { await post('/api/admin/brand', { ...data, ...extra }); window.brandDirty = false; toast('সেভ হয়েছে'); setTimeout(() => location.reload(), 600); }
    catch (er) { $('#brandErr').textContent = er.message; }
  };
}

// ---------------- students ----------------
async function viewStudents(main, preset) {
  const list = await api('/api/admin/students'); await companiesReady;
  let cf = preset ? decodeURIComponent(preset) : '';
  main.innerHTML = `<div class="head"><h1>স্টুডেন্ট <span class="pill" id="cnt">${bn(list.length)} জন</span></h1>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><input class="input search" id="q" placeholder="নাম, ইমেইল বা ফোন দিয়ে খুঁজুন">${companySelect('cf', cf)}<a class="btn ghost" href="/api/admin/students.csv">⬇ তালিকা (CSV)</a></div></div>
    <div class="card panel"><div class="scroll"><table id="tbl"></table></div></div>`;
  const draw = (f = '') => {
    const rows = list.filter(byCo(cf)).filter(s => (s.name + s.email + s.phone + (s.company || '')).toLowerCase().includes(f.toLowerCase()));
    $('#tbl').innerHTML = `<tr><th>নাম</th><th>কোম্পানি</th><th>ফোন / ইমেইল</th><th>ভিডিও শুরু</th><th>শেষ করেছে</th><th>গড় দেখা</th><th>মোট সময়</th><th>মোট ভিউ</th><th>আবার দেখা</th><th>শেষ দেখা</th></tr>` +
      (rows.map(s => `<tr class="click" onclick="location.hash='#/student/${s.id}'"><td><b>${esc(s.name)}</b> ${s.blocked ? '<span class="pill bad">ব্লকড</span>' : ''}${s.blocked_actions ? ` <span class="pill warn" title="ব্লক করা চেষ্টা">⚠ ${bn(s.blocked_actions)}</span>` : ''}</td>
        <td>${co(s.company)}</td><td>${esc(s.phone)}<div class="muted" style="font-size:12px">${esc(s.email)}</div></td><td>${bn(s.started)}</td><td>${bn(s.completed)}</td>
        <td style="min-width:100px">${bar(s.avg_percent)}<span class="muted" style="font-size:12px">${pct(s.avg_percent)}</span></td><td>${dur(s.watch_time)}</td><td>${bn(s.views)} বার</td><td>${s.rewatch_seconds >= 1 ? dur(s.rewatch_seconds) : '—'}</td><td class="muted">${ago(s.last_seen)}</td></tr>`).join('')
      || '<tr><td colspan=10 class="muted">কোনো স্টুডেন্ট নেই</td></tr>');
    $('#cnt').textContent = bn(rows.length) + ' জন';
  };
  draw(); $('#q').oninput = (e) => draw(e.target.value);
  $('#cf').onchange = (e) => { cf = e.target.value; draw($('#q').value); };
}

async function viewStudent(main, id) {
  const { student: s, progress, sessions, access, entries = [] } = await api('/api/admin/students/' + id); await companiesReady;
  const allVideos = (await api('/api/admin/videos')).filter(x => x.status === 'ready');
  const totalWatch = progress.reduce((a, p) => a + p.watch_time, 0);
  const totPauses = sessions.reduce((a, x) => a + x.pauses, 0), totSeeks = sessions.reduce((a, x) => a + x.seeks, 0);
  const totTabs = sessions.reduce((a, x) => a + x.tab_switches, 0), totBlocked = sessions.reduce((a, x) => a + x.blocked_actions, 0);
  main.innerHTML = `<div class="head"><a href="#/students" class="btn ghost sm">← সব স্টুডেন্ট</a>
    <div style="display:flex;gap:8px"><button class="btn ${s.blocked ? '' : 'danger'} sm" id="blk">${s.blocked ? 'আনব্লক করুন' : 'অ্যাক্সেস বন্ধ করুন'}</button></div></div>
  <div class="card prof"><div class="avatar">${esc(s.name.trim()[0] || '?')}</div><div style="flex:1">
    <h2 style="margin:0">${esc(s.name)} ${s.blocked ? '<span class="pill bad">ব্লকড</span>' : ''}</h2>
    <div class="muted">📞 ${esc(s.phone)} · ✉️ ${esc(s.email)}</div>
    <div style="margin:6px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">${co(s.company)}
      <select class="input" id="setCo" style="width:auto;padding:5px 10px;font-size:13px"><option value="">কোম্পানি বদলান…</option>${COMPANIES.filter(c => c !== s.company).map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
    <div class="muted" style="font-size:13px">যোগ দিয়েছে ${dt(s.created_at)} · ${bn(s.login_count)} বার লগইন · শেষ দেখা ${ago(s.last_seen)}</div></div></div>
  <div class="stats" style="margin-top:16px">
    <div class="card stat"><div class="k">মোট দেখার সময়</div><div class="v">${dur(totalWatch)}</div></div>
    <div class="card stat"><div class="k">ভিডিও শুরু / শেষ</div><div class="v">${bn(progress.length)} / ${bn(progress.filter(p => p.completed).length)}</div></div>
    <div class="card stat"><div class="k">মোট ভিউ</div><div class="v">${bn(progress.reduce((a, p) => a + p.views, 0))} বার</div><div class="s">পুরোটা শেষ ${bn(progress.reduce((a, p) => a + p.full_views, 0))} বার</div></div>
    <div class="card stat"><div class="k">পজ</div><div class="v">${bn(totPauses)}</div></div>
    <div class="card stat"><div class="k">সামনে-পিছনে টানা</div><div class="v">${bn(totSeeks)}</div></div>
    <div class="card stat"><div class="k">ট্যাব বদল</div><div class="v">${bn(totTabs)}</div></div>
    <div class="card stat"><div class="k">ব্লক করা চেষ্টা</div><div class="v" style="color:${totBlocked ? 'var(--bad)' : 'inherit'}">${bn(totBlocked)}</div></div>
  </div>
  <div class="card panel" style="margin-bottom:18px"><h3>ভিডিও অনুযায়ী অগ্রগতি ${timesLegend}</h3><div class="scroll"><table>
    <tr><th>ভিডিও</th><th>অবস্থা</th><th>কতটুকু দেখেছে</th><th>কোন অংশ কতবার দেখেছে</th><th>কতবার দেখেছে</th><th>আবার দেখা</th><th>ইউনিক / মোট সময়</th><th>শেষ অবস্থান</th><th>শেষ দেখা</th></tr>
    ${progress.map(p => `<tr><td><b>${esc(p.title)}</b><div class="muted" style="font-size:12px">${esc(p.class_name)} · ${fmt(p.duration)}</div></td><td>${status(p)}</td>
      <td style="min-width:110px">${bar(p.percent, p.completed)}<span style="font-size:13px;font-weight:600">${pct(p.percent)}</span></td>
      <td style="min-width:160px">${timesBar(p.buckets, p.duration)}</td>
      <td><b>${bn(p.views)} বার</b><div class="muted" style="font-size:12px">পুরোটা শেষ ${bn(p.full_views)} বার</div></td><td>${rewatchCell(p, p.duration)}</td>
      <td>${dur(p.unique_seconds)}<div class="muted" style="font-size:12px">মোট ${dur(p.watch_time)}</div></td><td>${fmt(p.last_position)}</td><td class="muted">${ago(p.last_watched)}</td></tr>`).join('')
      || '<tr><td colspan=9 class="muted">এখনো কোনো ভিডিও দেখেনি</td></tr>'}
  </table></div></div>
  <div class="card panel" style="margin-bottom:18px"><h3>🔑 যে ভিডিওগুলো দেখার অনুমতি আছে <span class="pill">${bn(access.length)}টি</span></h3>
    <div style="padding:12px 18px;border-bottom:1px solid var(--line)"><form id="ga" style="display:flex;gap:8px;max-width:560px">
      <select class="input" name="video_id" required><option value="">ভিডিও বেছে নিন…</option>${allVideos.filter(x => !access.some(a => a.video_id === x.id)).map(x => `<option value="${x.id}">${esc(x.class_name)} · ${esc(x.title)}</option>`).join('')}</select>
      <button class="btn">অনুমতি দিন</button></form></div>
    <div class="scroll"><table><tr><th>ভিডিও</th><th>কীভাবে পেয়েছে</th><th>কবে</th><th></th></tr>
    ${access.map(a => `<tr><td><b>${esc(a.title)}</b><div class="muted" style="font-size:12px">${esc(a.class_name)}</div></td><td><span class="pill ${a.source === 'link' ? 'brand' : ''}">${({ link: 'লিংক দিয়ে', admin: 'আপনি দিয়েছেন', legacy: 'আগে থেকে' })[a.source] || a.source}</span></td>
      <td class="muted">${dt(a.granted_at)}</td><td><button class="btn danger sm" onclick="revoke(${s.id}, ${a.video_id})">অনুমতি বাতিল</button></td></tr>`).join('') || '<tr><td colspan=4 class="muted">কোনো ভিডিওর অনুমতি নেই</td></tr>'}
    </table></div></div>
  <div class="card panel" style="margin-bottom:18px"><h3>📝 ফর্মে যা লিখেছে <span class="pill">${bn(entries.length)} বার</span></h3><div class="scroll"><table>
    <tr><th>কখন</th><th>নাম</th><th>কোম্পানি</th><th>ফোন</th><th>ইমেইল</th><th>কোথা থেকে</th><th></th></tr>
    ${entries.map(f => `<tr><td class="muted">${dt(f.at)}</td><td>${esc(f.name)}</td><td>${co(f.company)}</td><td>${esc(f.phone)}</td><td>${esc(f.email)}</td>
      <td>${f.via === 'link' ? '🔗 শেয়ার লিংক' + (f.video ? `<div class="muted" style="font-size:12px">${esc(f.video)}</div>` : '') : '🏠 লগইন পেজ'}</td>
      <td>${({ new: '<span class="pill ok">নতুন প্রোফাইল</span>', otp: '<span class="pill brand">🔐 OTP লগইন</span>', same: '', email: '<span class="pill warn">ফোন আলাদা</span>', phone: '<span class="pill warn">ইমেইল আলাদা</span>', mixed: '<span class="pill warn">ফোন অন্যজনের</span>' })[f.matched] || ''}</td></tr>`).join('')
      || '<tr><td colspan=7 class="muted">এখনো কোনো এন্ট্রি নেই (এই আপডেটের আগের লগইন এখানে নেই)</td></tr>'}
  </table></div></div>
  <div class="card panel"><h3>সব সেশন <span class="muted" style="font-weight:400;font-size:13px">ক্লিক করলে প্রতিটি অ্যাকশনের টাইমলাইন দেখাবে</span></h3><div class="scroll"><table>
    <tr><th>কখন</th><th>ভিডিও</th><th>দেখেছে</th><th>পজ</th><th>সিক</th><th>ট্যাব বদল</th><th>সর্বোচ্চ স্পিড</th><th>ডিভাইস</th><th>ব্লকড</th></tr>
    ${sessions.map(x => `<tr class="click" onclick="openSession(${x.id})"><td>${dt(x.started_at)}<div class="muted" style="font-size:12px">${fmt(x.start_pos)} → ${fmt(x.end_pos)}</div></td><td>${esc(x.title)} ${x.ended ? '<span class="pill ok">শেষ</span>' : ''}</td><td>${dur(x.watch_time)}</td>
      <td>${bn(x.pauses)}<div class="muted" style="font-size:12px">${dur(x.pause_time)}</div></td><td>${bn(x.seeks)}</td><td>${bn(x.tab_switches)}</td><td>${bn(x.max_rate)}x</td>
      <td>${esc(x.device)}<div class="muted" style="font-size:12px">${esc(x.browser)} · ${esc(x.os)}</div></td><td>${x.blocked_actions ? `<span class="pill bad">${bn(x.blocked_actions)}</span>` : '—'}</td></tr>`).join('')
      || '<tr><td colspan=9 class="muted">কোনো সেশন নেই</td></tr>'}
  </table></div></div>`;
  $('#ga').onsubmit = async (e) => { e.preventDefault(); await post('/api/admin/access', { student_id: s.id, video_id: Number(new FormData(e.target).get('video_id')) }); toast('অনুমতি দেওয়া হয়েছে'); route(); };
  $('#setCo').onchange = async (e) => { if (!e.target.value) return; await post('/api/admin/students/' + s.id, { company: e.target.value }, 'PATCH'); toast('কোম্পানি বদলানো হয়েছে'); route(); };
  $('#blk').onclick = async () => { await post('/api/admin/students/' + s.id, { blocked: !s.blocked }, 'PATCH'); route(); };
}

const EV = {
  session_start: ['▶️', 'দেখা শুরু করেছে', 'var(--brand)'], play: ['▶', 'চালিয়েছে', 'var(--ok)'], resume: ['▶', 'আবার চালিয়েছে', 'var(--ok)'],
  pause: ['⏸', 'পজ করেছে', 'var(--warn)'], seek: ['⏩', 'টেনে সরিয়েছে', 'var(--brand)'], ratechange: ['⚡', 'স্পিড বদলেছে', 'var(--brand)'],
  ended: ['🏁', 'ভিডিও শেষ করেছে', 'var(--ok)'], tab_hidden: ['👁', 'অন্য ট্যাবে গেছে', 'var(--bad)'], tab_visible: ['👁', 'ট্যাবে ফিরে এসেছে', 'var(--muted)'],
  window_blur: ['🪟', 'উইন্ডো থেকে ফোকাস সরেছে', 'var(--bad)'], window_focus: ['🪟', 'উইন্ডোতে ফিরেছে', 'var(--muted)'],
  fullscreen_on: ['⛶', 'ফুলস্ক্রিন করেছে', 'var(--muted)'], fullscreen_off: ['⛶', 'ফুলস্ক্রিন বন্ধ', 'var(--muted)'], buffering: ['⏳', 'বাফারিং', 'var(--muted)'],
  context_menu: ['🚫', 'রাইট ক্লিকের চেষ্টা', 'var(--bad)'], blocked_key: ['🚫', 'নিষিদ্ধ শর্টকাট', 'var(--bad)'], printscreen: ['📸', 'স্ক্রিনশট কী চেপেছে', 'var(--bad)'],
  devtools: ['🛠', 'ডেভেলপার টুলস খুলেছে', 'var(--bad)'], watermark_tamper: ['⛔', 'ওয়াটারমার্ক সরানোর চেষ্টা', 'var(--bad)'], copy_attempt: ['🚫', 'কপির চেষ্টা', 'var(--bad)'],
  download_attempt: ['⛔', 'ডাউনলোডের চেষ্টা ধরা পড়েছে, স্ট্রিম বন্ধ', 'var(--bad)'],
  leave_page: ['🚪', 'পেজ ছেড়ে গেছে', 'var(--muted)'], error: ['⚠️', 'প্লেয়ার এরর', 'var(--bad)'],
};
const DL = { too_fast: 'খুব দ্রুত সব অংশ নামানোর চেষ্টা', key_repeat: 'চাবি বারবার চাওয়া', playlist_repeat: 'প্লেলিস্ট বারবার চাওয়া' };
const REASON = { user: 'নিজে', tab_hidden: 'ট্যাব বদলের কারণে', window_blur: 'ফোকাস সরার কারণে', devtools: 'ডেভটুলসের কারণে', blocked_action: 'নিষিদ্ধ অ্যাকশনের কারণে', tamper: 'ওয়াটারমার্কের কারণে' };
function evDetail(type, d) {
  if (type === 'seek') return `${fmt(d.from)} → ${fmt(d.to)} (${d.dir === 'forward' ? 'সামনে' : 'পিছনে'})`;
  if (type === 'resume') return `${dur(d.paused)} থেমে থাকার পর`;
  if (type === 'pause') return REASON[d.reason] || '';
  if (type === 'ratechange') return bn(d.rate) + 'x';
  if (type === 'blocked_key') return esc(d.key);
  if (type === 'download_attempt') return DL[d.reason] || '';
  if (type === 'devtools') return d.how === 'debugger' ? '(কনসোল)' : '';
  if (type === 'session_start') return d.startPos ? `${fmt(d.startPos)} থেকে` : 'শুরু থেকে';
  return '';
}
window.openSession = async (id) => {
  const { session: s, events } = await api('/api/admin/sessions/' + id);
  modal(`<div style="display:flex;justify-content:space-between;align-items:start;gap:10px"><div><h2>${esc(s.student)} · ${esc(s.title)}</h2>
    <div class="muted" style="font-size:13px">${dt(s.started_at)} · ${esc(s.device)}, ${esc(s.browser)}, ${esc(s.os)} · স্ক্রিন ${esc(s.screen)} · IP ${esc(s.ip)}</div></div>
    <button class="btn ghost sm" onclick="this.closest('.modal-bg').remove()">✕</button></div>
    <div class="stats" style="margin:16px 0"><div class="card stat"><div class="k">দেখেছে</div><div class="v" style="font-size:20px">${dur(s.watch_time)}</div></div>
    <div class="card stat"><div class="k">পজ</div><div class="v" style="font-size:20px">${bn(s.pauses)}</div><div class="s">মোট ${dur(s.pause_time)}</div></div>
    <div class="card stat"><div class="k">সিক</div><div class="v" style="font-size:20px">${bn(s.seeks)}</div></div>
    <div class="card stat"><div class="k">ট্যাব বদল</div><div class="v" style="font-size:20px">${bn(s.tab_switches)}</div></div></div>
    <h3 style="margin:0 0 6px">প্রতিটি অ্যাকশন (A to Z)</h3>
    <ul class="tl"><li style="font-weight:600;color:var(--muted)"><span>সময়</span><span>ভিডিওর</span><span>কী করেছে</span></li>
    ${events.map(e => { const d = JSON.parse(e.data || '{}'); const [ic, label, col] = EV[e.type] || ['•', e.type, 'var(--muted)'];
      return `<li><span class="t">${new Date(e.at).toLocaleTimeString('bn-BD')}</span><span class="p">${fmt(e.pos)}</span><span><span class="dot" style="background:${col}"></span>${ic} ${label} <span class="muted">${evDetail(e.type, d)}</span></span></li>`; }).join('')
      || '<li class="muted">কোনো ইভেন্ট নেই</li>'}</ul>`, true);
};

// ---------------- video report ----------------
async function viewVideoReport(main, id) {
  const { video: v, rows, heat, pauseHeat, rewatchHeat } = await api(`/api/admin/videos/${id}/report`); await companiesReady;
  const mx = Math.max(1, ...heat), pmx = Math.max(1, ...pauseHeat), rmx = Math.max(0.01, ...rewatchHeat);
  const avg = rows.length ? rows.reduce((a, r) => a + r.percent, 0) / rows.length : 0;
  main.innerHTML = `<div class="head"><a href="#/videos" class="btn ghost sm">← ক্লাস ও ভিডিও</a></div>
  <div class="head"><div><h1>${esc(v.title)}</h1><div class="muted">${esc(v.class_name)} · ${fmt(v.duration)} · 🔒 প্রাইভেট ভিডিও</div></div></div>
  <div id="sharePanel"></div>
  <div class="stats">
    <div class="card stat"><div class="k">দেখেছে</div><div class="v">${bn(rows.length)} জন</div></div>
    <div class="card stat"><div class="k">শেষ করেছে</div><div class="v">${bn(rows.filter(r => r.completed).length)} জন</div></div>
    <div class="card stat"><div class="k">মোট ভিউ</div><div class="v">${bn(rows.reduce((a, r) => a + r.views, 0))} বার</div><div class="s">পুরোটা শেষ ${bn(rows.reduce((a, r) => a + r.full_views, 0))} বার</div></div>
    <div class="card stat"><div class="k">গড়ে দেখেছে</div><div class="v">${pct(avg)}</div></div>
    <div class="card stat"><div class="k">মোট দেখার সময়</div><div class="v">${dur(rows.reduce((a, r) => a + r.watch_time, 0))}</div></div>
  </div>
  <div class="cols" style="margin-bottom:18px">
    <div class="card" style="padding:16px 18px"><b>ভিডিওর কোন অংশ কতজন দেখেছে</b><div class="heat">${heat.map((h, i) => `<i title="${fmt(i / heat.length * v.duration)}: ${h} জন" style="height:${h / mx * 100}%"></i>`).join('')}</div>
      <div class="muted" style="display:flex;justify-content:space-between;font-size:12px"><span>0:00</span><span>${fmt(v.duration / 2)}</span><span>${fmt(v.duration)}</span></div></div>
    <div class="card" style="padding:16px 18px"><b>কোথায় বেশি পজ করেছে</b><div class="heat p">${pauseHeat.map((h, i) => `<i title="${fmt(i / pauseHeat.length * v.duration)}: ${h} বার" style="height:${h / pmx * 100}%"></i>`).join('')}</div>
      <div class="muted" style="display:flex;justify-content:space-between;font-size:12px"><span>0:00</span><span>${fmt(v.duration / 2)}</span><span>${fmt(v.duration)}</span></div></div>
  </div>
  <div class="card" style="padding:16px 18px;margin-bottom:18px"><b>কোন অংশ স্টুডেন্টরা বারবার দেখেছে</b> <span class="muted" style="font-size:13px">(উঁচু মানে বেশি বার ফিরে এসে দেখেছে, সম্ভবত কঠিন অংশ)</span>
    <div class="heat r">${rewatchHeat.map((h, i) => `<i title="${fmt(i / rewatchHeat.length * v.duration)}" style="height:${h / rmx * 100}%"></i>`).join('')}</div>
    <div class="muted" style="display:flex;justify-content:space-between;font-size:12px"><span>0:00</span><span>${fmt(v.duration / 2)}</span><span>${fmt(v.duration)}</span></div></div>
  <div class="card panel"><h3>প্রত্যেক স্টুডেন্ট ${timesLegend}</h3><div style="padding:10px 18px;border-bottom:1px solid var(--line)">${companySelect('rcf')}</div><div class="scroll"><table>
    <tr><th>স্টুডেন্ট</th><th>অবস্থা</th><th>কতটুকু</th><th>কোন অংশ কতবার</th><th>কতবার দেখেছে</th><th>আবার দেখা</th><th>ইউনিক / মোট</th><th>পজ</th><th>সিক</th><th>ট্যাব বদল</th><th>শেষ দেখা</th></tr>
    ${rows.map(r => `<tr class="click" data-co="${esc(r.company || '')}" onclick="location.hash='#/student/${r.student_id}'"><td><b>${esc(r.name)}</b><div>${co(r.company)}</div><div style="font-size:12.5px">📞 ${esc(r.phone)}</div><div class="muted" style="font-size:12px">✉️ ${esc(r.email)}</div></td><td>${status(r)}</td>
      <td style="min-width:100px">${bar(r.percent, r.completed)}<span style="font-size:13px;font-weight:600">${pct(r.percent)}</span></td><td style="min-width:150px">${timesBar(r.buckets, v.duration)}</td><td><b>${bn(r.views)} বার</b><div class="muted" style="font-size:12px">শেষ ${bn(r.full_views)} বার</div></td><td>${rewatchCell(r, v.duration)}</td>
      <td>${dur(r.unique_seconds)}<div class="muted" style="font-size:12px">মোট ${dur(r.watch_time)}</div></td><td>${bn(r.pauses)}</td><td>${bn(r.seeks)}</td><td>${bn(r.tab_switches)}</td><td class="muted">${ago(r.last_watched)}</td></tr>`).join('')
      || '<tr><td colspan=11 class="muted">এখনো কেউ দেখেনি</td></tr>'}
  </table></div></div>`;
  $('#rcf').onchange = (e) => { const f = e.target.value; main.querySelectorAll('tr[data-co]').forEach(tr => { tr.style.display = !f || (f === '__none' ? !tr.dataset.co : tr.dataset.co === f) ? '' : 'none'; }); };
  await renderSharePanel($('#sharePanel'), v);
}

// ---------------- boot ----------------
(async () => {
  const r = await fetch('/api/admin/check');
  if (!r.ok) return renderLogin();
  shell(); route();
})();
