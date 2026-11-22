const $ = (s, r = document) => r.querySelector(s);
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
      <form id="gf2" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:6px"><input class="input" name="name" placeholder="নাম" required><input class="input" name="email" type="email" placeholder="ইমেইল" required><input class="input" name="phone" placeholder="ফোন" required><button class="btn">দিন</button></form>
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
    <div class="logo" style="margin-bottom:18px"><b>▶</b> ক্লাসভল্ট অ্যাডমিন</div>
    <label>অ্যাডমিন পাসওয়ার্ড</label><input class="input" type="password" name="password" autofocus required>
    <div class="err" id="err"></div><button class="btn" style="width:100%;justify-content:center">লগইন</button></form></div>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    try { await post('/api/admin/login', Object.fromEntries(new FormData(e.target))); location.reload(); }
    catch (er) { $('#err').textContent = er.message; }
  };
}

// ---------------- shell ----------------
function shell() {
  document.body.innerHTML = `<div class="layout">
    <aside class="side"><div class="logo"><b>▶</b> ক্লাসভল্ট</div>
      <nav class="nav">
        <a href="#/overview" data-r="overview">📊 ওভারভিউ</a>
        <a href="#/videos" data-r="videos">🎬 ক্লাস ও ভিডিও</a>
        <a href="#/students" data-r="students">👥 স্টুডেন্ট</a>
      </nav>
      <div class="foot" style="margin-top:auto;display:grid;gap:8px">
        <a class="btn ghost sm" href="/api/admin/students.csv" style="justify-content:center">⬇ স্টুডেন্ট তালিকা (CSV)</a>
        <a class="btn ghost sm" href="/api/admin/export.csv" style="justify-content:center">⬇ ভিডিও রিপোর্ট (CSV)</a>
        <button class="btn ghost sm" id="logout" style="justify-content:center">লগআউট</button>
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
  try {
    if (r === 'videos') await viewVideos(main);
    else if (r === 'students') await viewStudents(main, id);
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
    <button class="btn ghost" id="addClass">＋ নতুন ক্লাস</button><button class="btn" id="upload">⬆ ভিডিও আপলোড</button></div></div>
    ${classes.map(c => {
      const vs = videos.filter(v => v.class_id === c.id);
      return `<div class="card panel cls-block"><div class="cls-head"><h3>${esc(c.name)} <span class="pill">${bn(vs.length)}টি ভিডিও</span></h3>
        <div style="display:flex;gap:6px"><button class="btn ghost sm" onclick="renameClass(${c.id}, '${esc(c.name).replace(/'/g, "\\'")}')">নাম বদলান</button>
        <button class="btn danger sm" onclick="delClass(${c.id})">মুছুন</button></div></div>
        ${vs.map(v => `<div class="vrow"><div class="vthumb" style="background-image:url(/api/thumb/${v.id})"></div>
          <div><b>${esc(v.title)}</b>
            <div class="vmeta">${v.status === 'ready' ? `<span>⏱ ${fmt(v.duration)}</span><span>👥 ${bn(v.viewers)} জন দেখেছে</span><span>👁 মোট ${bn(v.views)} বার</span><span>🔑 ${bn(v.access_count)} জনের অনুমতি</span>${v.share_enabled ? '' : '<span class="pill bad">লিংক বন্ধ</span>'}<span>✓ ${bn(v.completed)} জন শেষ করেছে</span><span>গড় ${pct(v.avg_percent)}</span>`
              : v.status === 'processing' ? `<span class="pill warn">⏳ প্রসেস হচ্ছে ${v.job != null ? bn(v.job) + '%' : ''}</span>` : `<span class="pill bad">সমস্যা: ${esc(v.error)}</span>`}</div></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${v.status === 'ready' ? `${v.share_enabled ? `<button class="btn sm" onclick="copyLink('${v.share_token}')">🔗 লিংক কপি</button>` : ''}<a class="btn ghost sm" href="#/video/${v.id}">শেয়ার ও রিপোর্ট</a>` : ''}<button class="btn danger sm" onclick="delVideo(${v.id})">মুছুন</button></div></div>`).join('')
          || '<div class="muted" style="padding:16px 18px">এই ক্লাসে এখনো কোনো ভিডিও নেই</div>'}</div>`;
    }).join('') || '<div class="card" style="padding:30px;text-align:center" class="muted">প্রথমে একটি ক্লাস তৈরি করুন (যেমন: ক্লাস ১)</div>'}`;
  $('#addClass').onclick = () => {
    const m = modal(`<h2>নতুন ক্লাস</h2><form id="cf"><label>ক্লাসের নাম</label><input class="input" name="name" placeholder="যেমন: ক্লাস ৩" required autofocus>
      <div class="err" id="cerr"></div><button class="btn">তৈরি করুন</button></form>`);
    $('#cf', m).onsubmit = async (e) => { e.preventDefault(); try { await post('/api/admin/classes', Object.fromEntries(new FormData(e.target))); m.remove(); route(); } catch (er) { $('#cerr', m).textContent = er.message; } };
  };
  $('#upload').onclick = () => uploadModal(classes);
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
  const { student: s, progress, sessions, access } = await api('/api/admin/students/' + id); await companiesReady;
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
