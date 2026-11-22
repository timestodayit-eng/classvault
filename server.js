// ClassVault: secure class video platform
// Node 22+ (uses built-in node:sqlite). Requires ffmpeg + ffprobe on PATH.
const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

const PORT = Number(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const COMPLETE_AT = 0.95; // 95% unique coverage = finished
fs.mkdirSync(path.join(DATA, 'videos'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'tmp'), { recursive: true });

const secretFile = path.join(DATA, 'secret.key');
const SECRET = process.env.APP_SECRET ||
  (fs.existsSync(secretFile) ? fs.readFileSync(secretFile, 'utf8') :
    (() => { const s = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(secretFile, s); return s; })());

// ---------- Database ----------
const db = new DatabaseSync(path.join(DATA, 'app.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS students(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL UNIQUE,
  blocked INTEGER DEFAULT 0, created_at INTEGER, last_seen INTEGER, login_count INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS classes(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort INTEGER DEFAULT 0, created_at INTEGER);
CREATE TABLE IF NOT EXISTS videos(
  id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT DEFAULT '', duration REAL DEFAULT 0,
  status TEXT DEFAULT 'processing', error TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS sessions(
  id INTEGER PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
  started_at INTEGER, last_active INTEGER, watch_time REAL DEFAULT 0,
  pauses INTEGER DEFAULT 0, pause_time REAL DEFAULT 0, seeks INTEGER DEFAULT 0,
  tab_switches INTEGER DEFAULT 0, blocked_actions INTEGER DEFAULT 0, max_rate REAL DEFAULT 1,
  start_pos REAL DEFAULT 0, end_pos REAL DEFAULT 0, ended INTEGER DEFAULT 0,
  ip TEXT, user_agent TEXT, device TEXT, browser TEXT, os TEXT, screen TEXT);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY, session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
  student_id INTEGER, video_id INTEGER, type TEXT, pos REAL, at INTEGER, data TEXT);
CREATE INDEX IF NOT EXISTS ev_session ON events(session_id);
CREATE TABLE IF NOT EXISTS progress(
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
  ranges TEXT DEFAULT '[]', unique_seconds REAL DEFAULT 0, watch_time REAL DEFAULT 0,
  last_position REAL DEFAULT 0, percent REAL DEFAULT 0, completed INTEGER DEFAULT 0,
  completed_at INTEGER, first_watched INTEGER, last_watched INTEGER,
  PRIMARY KEY(student_id, video_id));
`);
// migrations for rewatch tracking
for (const [t, c] of [['progress', 'media_seconds REAL DEFAULT 0'], ['progress', 'full_views INTEGER DEFAULT 0'],
  ['progress', "buckets TEXT DEFAULT '[]'"], ['sessions', 'media_seconds REAL DEFAULT 0'],
  ['sessions', 'mask TEXT'], ['sessions', 'native INTEGER DEFAULT 0'], ['sessions', 'key_fetches INTEGER DEFAULT 0'],
  ['sessions', 'playlist_fetches INTEGER DEFAULT 0'], ['sessions', 'stream_blocked INTEGER DEFAULT 0'],
  ['videos', 'share_token TEXT'], ['videos', 'share_enabled INTEGER DEFAULT 1']]) {
  try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${c}`); } catch { /* exists */ }
}
// Access control: every video is private. A student can watch a video only if they have a row here,
// given either by opening the video's share link ("link") or by the admin ("admin").
db.exec(`CREATE TABLE IF NOT EXISTS access(
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
  source TEXT, granted_at INTEGER, PRIMARY KEY(student_id, video_id));`);
const newShareToken = () => crypto.randomBytes(9).toString('base64url');
for (const v of db.prepare('SELECT id FROM videos WHERE share_token IS NULL').all())
  db.prepare('UPDATE videos SET share_token=? WHERE id=?').run(newShareToken(), v.id);
// keep access for students who were already watching before permissions existed
db.exec(`INSERT OR IGNORE INTO access(student_id, video_id, source, granted_at)
  SELECT student_id, video_id, 'legacy', first_watched FROM progress`);
const NB = 100;           // the video is split into 100 equal parts to count how many times each part was watched
const VIEW_MIN = 5;       // a session counts as a "view" after 5+ seconds of watching
const q = (sql) => db.prepare(sql);
const now = () => Date.now();

// ---------- Signed tokens ----------
const b64 = (s) => Buffer.from(s).toString('base64url');
function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + mac;
}
function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const good = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > now() ? p : null; }
  catch { return null; }
}

// ---------- App ----------
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(cookieParser());
app.use(express.json({ type: ['application/json', 'text/plain'], limit: '1mb' }));
app.use((req, res, next) => {
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Content-Type-Options', 'nosniff');
  next();
});
const cookieOpts = (maxAge) => ({ httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === '1', maxAge });

function currentStudent(req) {
  const p = verify(req.cookies.sid);
  if (!p || p.t !== 's') return null;
  const s = q('SELECT * FROM students WHERE id=?').get(p.id);
  if (!s || s.blocked) return null;
  return s;
}
function requireStudent(req, res, next) {
  const s = currentStudent(req);
  if (!s) return res.status(401).json({ error: 'লগইন করুন' });
  req.student = s; next();
}
function requireAdmin(req, res, next) {
  const p = verify(req.cookies.aid);
  if (!p || p.t !== 'a') return res.status(401).json({ error: 'অ্যাডমিন লগইন প্রয়োজন' });
  next();
}

// ---------- Student auth (no password) ----------
const normEmail = (e) => String(e || '').trim().toLowerCase();
const normPhone = (p) => { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('880')) d = '0' + d.slice(3); return d; };

app.post('/api/login', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  const email = normEmail(req.body.email);
  const phone = normPhone(req.body.phone);
  if (name.length < 2) return res.status(400).json({ error: 'সঠিক নাম লিখুন' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'সঠিক ইমেইল লিখুন' });
  if (phone.length < 10 || phone.length > 15) return res.status(400).json({ error: 'সঠিক ফোন নম্বর লিখুন' });

  const byEmail = q('SELECT * FROM students WHERE email=?').get(email);
  const byPhone = q('SELECT * FROM students WHERE phone=?').get(phone);
  let student;
  if (byEmail && byPhone && byEmail.id === byPhone.id) student = byEmail;
  else if (byEmail || byPhone) {
    // Email and phone must match the same person, otherwise someone could log in as another student.
    return res.status(409).json({ error: 'এই ইমেইল বা ফোন নম্বরটি অন্য তথ্যের সাথে আগে থেকেই নিবন্ধিত। আগের ইমেইল ও ফোন নম্বর একসাথে দিন।' });
  } else {
    const r = q('INSERT INTO students(name,email,phone,created_at) VALUES(?,?,?,?)').run(name, email, phone, now());
    student = q('SELECT * FROM students WHERE id=?').get(r.lastInsertRowid);
  }
  if (student.blocked) return res.status(403).json({ error: 'আপনার অ্যাক্সেস বন্ধ করা হয়েছে। অ্যাডমিনের সাথে যোগাযোগ করুন।' });
  q('UPDATE students SET name=?, last_seen=?, login_count=login_count+1 WHERE id=?').run(name, now(), student.id);
  res.cookie('sid', sign({ t: 's', id: student.id, exp: now() + 30 * 864e5 }), cookieOpts(30 * 864e5));
  res.json({ ok: true, student: { id: student.id, name, email, phone } });
});
app.post('/api/logout', (req, res) => { res.clearCookie('sid'); res.json({ ok: true }); });
app.get('/api/me', requireStudent, (req, res) => {
  const { id, name, email, phone } = req.student; res.json({ id, name, email, phone });
});

app.get('/api/catalog', requireStudent, (req, res) => {
  const classes = q('SELECT id,name FROM classes ORDER BY sort,id').all();
  const vids = q(`SELECT v.id,v.class_id,v.title,v.description,v.duration,
      p.percent,p.completed,p.last_position
      FROM videos v JOIN access a ON a.video_id=v.id AND a.student_id=?
      LEFT JOIN progress p ON p.video_id=v.id AND p.student_id=a.student_id
      WHERE v.status='ready' ORDER BY v.id`).all(req.student.id);
  res.json(classes.map(c => ({ ...c, videos: vids.filter(v => v.class_id === c.id) })));
});

// ---------- Share links ----------
app.get('/api/share/:token', (req, res) => {
  const v = q("SELECT id,title,duration FROM videos WHERE share_token=? AND share_enabled=1 AND status='ready'").get(String(req.params.token));
  if (!v) return res.status(404).json({ error: 'এই লিংকটি আর কাজ করছে না। যিনি লিংক দিয়েছেন তার সাথে যোগাযোগ করুন।' });
  const s = currentStudent(req);
  res.json({ video: v, me: s ? { name: s.name, email: s.email, phone: s.phone } : null });
});
app.post('/api/share/:token/claim', requireStudent, (req, res) => {
  const v = q("SELECT id FROM videos WHERE share_token=? AND share_enabled=1 AND status='ready'").get(String(req.params.token));
  if (!v) return res.status(404).json({ error: 'এই লিংকটি আর কাজ করছে না।' });
  q("INSERT OR IGNORE INTO access(student_id,video_id,source,granted_at) VALUES(?,?,'link',?)").run(req.student.id, v.id, now());
  res.json({ videoId: v.id });
});

// ---------- Secure streaming (AES-128 HLS + signed, user-bound URLs) ----------
const vdir = (id) => path.join(DATA, 'videos', String(Number(id)));

const hasAccess = (studentId, videoId) => !!q('SELECT 1 FROM access WHERE student_id=? AND video_id=?').get(studentId, videoId);
app.get('/api/thumb/:id', requireStudentOrAdmin, (req, res) => {
  if (req.student && !hasAccess(req.student.id, Number(req.params.id))) return res.status(403).end();
  const f = path.join(vdir(req.params.id), 'thumb.jpg');
  if (!fs.existsSync(f)) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=3600'); res.sendFile(f);
});
function requireStudentOrAdmin(req, res, next) {
  const a = verify(req.cookies.aid);
  if (a && a.t === 'a') return next();
  // (students fall through and get req.student set)
  return requireStudent(req, res, next);
}

// Every playback session gets its own token, its own key mask and its own limits.
// - The AES key is never sent in plain form: it's XOR-masked with a per-session secret that only the player knows how to undo,
//   so download managers / yt-dlp that grab the playlist get a wrong key and an unplayable file.
// - The key and playlist can be fetched only a few times per session; segments are rate-limited (a downloader pulling
//   everything at once gets the session blocked and the attempt is logged for the admin).
// - Requests must come from our own page (Sec-Fetch-* headers), not from a typed URL or another site.
const PLAYLIST_MAX = 4, KEY_MAX = 4, SEG_PER_MIN = 40;
const segHits = new Map(); // sessionId -> [timestamps]
function sameOriginFetch(req) {
  const site = req.get('sec-fetch-site'), mode = req.get('sec-fetch-mode'), dest = req.get('sec-fetch-dest');
  if (site && site !== 'same-origin') return false;
  if (dest && dest !== 'empty' && dest !== 'video' && dest !== 'audio') return false; // 'document' = opened directly in a tab
  if (mode === 'navigate') return false;
  return true;
}
// In-app browsers of downloader apps (VidMate, SnapTube, UC Browser…) and Android WebViews sniff media URLs and offer
// a "download" button. We refuse to play inside them and ask the student to open the page in Chrome/Safari instead.
const DOWNLOADER_UA = /; wv\)|\bwv\b.*Version\/\d|UCBrowser|UCWEB|UBrowser|VidMate|SnapTube|Snaptube|TubeMate|Videoder|InsTube|KeepVid|Y2mate|savefrom|NewPipe|1DM|IDMan|ADM\b|FBAN|FBAV|Instagram|Line\//i;
const badClient = (req) => DOWNLOADER_UA.test(String(req.get('user-agent') || ''));
function streamSession(req, res, needToken = true) {
  if (badClient(req)) { res.status(403).end(); return null; }
  const s = currentStudent(req);
  const p = needToken ? verify(req.query.tk) : null;
  const sid = needToken ? p && p.ss : Number(req.query.s);
  const sess = sid && q('SELECT * FROM sessions WHERE id=?').get(sid);
  const ok = s && sess && sess.student_id === s.id && hasAccess(s.id, sess.video_id) && sess.video_id === Number(req.params.id) && !sess.stream_blocked &&
    (!needToken || (p.t === 'v' && p.v === sess.video_id && p.s === s.id)) && sameOriginFetch(req);
  if (!ok) { res.status(403).end(); return null; }
  return sess;
}
function flagSession(sess, reason) {
  q('UPDATE sessions SET stream_blocked=1, blocked_actions=blocked_actions+1 WHERE id=?').run(sess.id);
  q('INSERT INTO events(session_id,student_id,video_id,type,pos,at,data) VALUES(?,?,?,?,?,?,?)')
    .run(sess.id, sess.student_id, sess.video_id, 'download_attempt', sess.end_pos || 0, now(), JSON.stringify({ reason }));
}

app.get('/api/stream/:id/index.m3u8', (req, res) => {
  const sess = streamSession(req, res, false); if (!sess) return;
  const v = q("SELECT * FROM videos WHERE id=? AND status='ready'").get(req.params.id);
  if (!v) return res.status(404).end();
  if (sess.playlist_fetches >= PLAYLIST_MAX) { flagSession(sess, 'playlist_repeat'); return res.status(403).end(); }
  q('UPDATE sessions SET playlist_fetches=playlist_fetches+1 WHERE id=?').run(sess.id);
  const ttl = Math.max(20 * 60e3, v.duration * 2.5 * 1000);
  const tk = sign({ t: 'v', v: v.id, s: sess.student_id, ss: sess.id, exp: now() + ttl });
  let m3u8 = fs.readFileSync(path.join(vdir(v.id), 'index.m3u8'), 'utf8');
  m3u8 = m3u8.replace(/URI="[^"]*"/, `URI="/api/stream/${v.id}/key?tk=${tk}"`)
    .replace(/^(seg_\d+\.ts)$/gm, `/api/stream/${v.id}/seg/$1?tk=${tk}`);
  res.set({ 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' });
  res.send(m3u8);
});
app.get('/api/stream/:id/key', (req, res) => {
  const sess = streamSession(req, res); if (!sess) return;
  if (sess.key_fetches >= KEY_MAX) { flagSession(sess, 'key_repeat'); return res.status(403).end(); }
  q('UPDATE sessions SET key_fetches=key_fetches+1 WHERE id=?').run(sess.id);
  const key = fs.readFileSync(path.join(vdir(req.params.id), 'enc.key'));
  // Native-HLS browsers (old iOS Safari) can't unmask, so they get the plain key; everyone else gets the masked key.
  const out = sess.native ? key : Buffer.from(key.map((b, i) => b ^ Buffer.from(sess.mask, 'hex')[i]));
  res.set({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.send(out);
});
app.get('/api/stream/:id/seg/:seg', (req, res) => {
  if (!/^seg_\d+\.ts$/.test(req.params.seg)) return res.status(400).end();
  const sess = streamSession(req, res); if (!sess) return;
  const t = now(), hits = (segHits.get(sess.id) || []).filter(x => t - x < 60e3);
  hits.push(t); segHits.set(sess.id, hits);
  if (hits.length > SEG_PER_MIN) { flagSession(sess, 'too_fast'); segHits.delete(sess.id); return res.status(403).end(); }
  res.set({ 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-store' });
  res.sendFile(path.join(vdir(req.params.id), req.params.seg));
});
setInterval(() => { const t = now(); for (const [k, v] of segHits) if (!v.length || t - v[v.length - 1] > 120e3) segHits.delete(k); }, 60e3).unref();

// ---------- Tracking ----------
function parseUA(ua = '') {
  const device = /iPad|Tablet/i.test(ua) ? 'ট্যাবলেট' : /Mobi|Android|iPhone/i.test(ua) ? 'মোবাইল' : 'কম্পিউটার';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung' :
    /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'অন্যান্য';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' :
    /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'অন্যান্য';
  return { device, browser, os };
}

app.post('/api/track/start', requireStudent, (req, res) => {
  if (badClient(req)) return res.status(403).json({ error: 'browser' });
  const v = q("SELECT * FROM videos WHERE id=? AND status='ready'").get(req.body.videoId);
  if (!v) return res.status(404).json({ error: 'ভিডিও পাওয়া যায়নি' });
  if (!hasAccess(req.student.id, v.id)) return res.status(403).json({ error: 'noaccess' });
  const ua = String(req.get('user-agent') || '').slice(0, 400);
  const { device, browser, os } = parseUA(ua);
  const p = q('SELECT last_position,percent,completed FROM progress WHERE student_id=? AND video_id=?').get(req.student.id, v.id);
  const startPos = p && !p.completed && p.last_position < v.duration - 5 ? p.last_position : 0;
  const mask = crypto.randomBytes(16);
  // plain key only for genuine native-HLS clients (iPhone/iPad Safari without MediaSource)
  const native = req.body.native === true && /iPhone|iPad|Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|CriOS|Firefox|Edg/.test(ua) ? 1 : 0;
  const r = q(`INSERT INTO sessions(student_id,video_id,started_at,last_active,start_pos,end_pos,ip,user_agent,device,browser,os,screen,mask,native)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.student.id, v.id, now(), now(), startPos, startPos, req.ip, ua, device, browser, os,
    String(req.body.screen || '').slice(0, 40), mask.toString('hex'), native);
  const sessionId = Number(r.lastInsertRowid);
  // the mask travels lightly obscured (xor with a session-derived pad), so it isn't sitting in plain sight in the network tab
  const pad = crypto.createHash('sha256').update('cv' + sessionId).digest();
  q(`INSERT INTO progress(student_id,video_id,first_watched,last_watched) VALUES(?,?,?,?)
     ON CONFLICT DO UPDATE SET last_watched=excluded.last_watched`).run(req.student.id, v.id, now(), now());
  res.json({
    sessionId, startPos, cfg: { b: 6, t: Buffer.from(mask.map((x, i) => x ^ pad[i])).toString('base64') },
    video: { id: v.id, title: v.title, description: v.description, duration: v.duration },
    src: `/api/stream/${v.id}/index.m3u8?s=${sessionId}`,
    watermark: { name: req.student.name, phone: req.student.phone, email: req.student.email },
  });
});

function mergeRanges(ranges) {
  ranges.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 0.5) last[1] = Math.max(last[1], r[1]); else out.push([r[0], r[1]]);
  }
  return out;
}
const COUNTERS = { pause: 'pauses', seek: 'seeks', tab_hidden: 'tab_switches', window_blur: null };
const BLOCKED = new Set(['download_attempt', 'blocked_key', 'context_menu', 'devtools', 'printscreen', 'watermark_tamper', 'copy_attempt']);

app.post('/api/track/events', requireStudent, (req, res) => {
  const sess = q('SELECT * FROM sessions WHERE id=? AND student_id=?').get(req.body.sessionId, req.student.id);
  if (!sess) return res.status(404).json({ error: 'session' });
  const video = q('SELECT * FROM videos WHERE id=?').get(sess.video_id);
  const prog = q('SELECT * FROM progress WHERE student_id=? AND video_id=?').get(sess.student_id, sess.video_id);
  let ranges = JSON.parse(prog.ranges || '[]');
  let buckets = JSON.parse(prog.buckets || '[]'); if (buckets.length !== NB) buckets = new Array(NB).fill(0);
  const events = Array.isArray(req.body.events) ? req.body.events.slice(0, 300) : [];
  const ins = q('INSERT INTO events(session_id,student_id,video_id,type,pos,at,data) VALUES(?,?,?,?,?,?,?)');
  const upd = { watch: 0, pauses: 0, pauseTime: 0, seeks: 0, tabs: 0, blocked: 0, rate: sess.max_rate, ended: sess.ended, pos: sess.end_pos, media: 0, fullViews: 0 };
  const dur = video.duration || 0;
  db.exec('BEGIN');
  try {
    for (const e of events) {
      const type = String(e.type || '').slice(0, 30);
      const pos = Math.max(0, Math.min(dur, Number(e.pos) || 0));
      const d = e.d && typeof e.d === 'object' ? e.d : {};
      const at = Number(e.at) && Math.abs(Number(e.at) - now()) < 864e5 ? Number(e.at) : now();
      if (type === 'tick') {
        const from = Math.max(0, Math.min(dur, Number(d.from) || 0));
        const to = Math.max(0, Math.min(dur, Number(d.to) || 0));
        const wall = Math.max(0, Math.min(30, Number(d.wall) || 0));
        // sanity: covered media time can't exceed wall time * max speed (2x) + slack
        if (to > from && to - from <= wall * 2.1 + 2 && dur) {
          ranges.push([from, to]); upd.media += to - from;
          const bl = dur / NB;
          for (let i = Math.floor(from / bl); i < NB && i * bl < to; i++)
            buckets[i] += Math.max(0, Math.min(to, (i + 1) * bl) - Math.max(from, i * bl));
        }
        upd.watch += wall; upd.pos = to;
        continue; // ticks are aggregated, not stored individually
      }
      if (type === 'pause') upd.pauses++;
      if (type === 'resume') upd.pauseTime += Math.max(0, Math.min(86400, Number(d.paused) || 0));
      if (type === 'seek') upd.seeks++;
      if (type === 'tab_hidden') upd.tabs++;
      if (BLOCKED.has(type)) upd.blocked++;
      if (type === 'ratechange') upd.rate = Math.max(upd.rate, Number(d.rate) || 1);
      if (type === 'ended') { upd.ended = 1; upd.fullViews++; }
      upd.pos = pos;
      ins.run(sess.id, sess.student_id, sess.video_id, type, pos, at, JSON.stringify(d).slice(0, 500));
    }
    ranges = mergeRanges(ranges);
    const unique = ranges.reduce((s, r) => s + (r[1] - r[0]), 0);
    const percent = dur ? Math.min(100, unique / dur * 100) : 0;
    const completed = prog.completed || percent >= COMPLETE_AT * 100 ? 1 : 0;
    q(`UPDATE progress SET ranges=?, unique_seconds=?, watch_time=watch_time+?, last_position=?, percent=?, completed=?,
       completed_at=COALESCE(completed_at, ?), last_watched=?, media_seconds=media_seconds+?, full_views=full_views+?, buckets=? WHERE student_id=? AND video_id=?`)
      .run(JSON.stringify(ranges.map(r => [+r[0].toFixed(1), +r[1].toFixed(1)])), unique, upd.watch, upd.pos, percent, completed,
        completed ? now() : null, now(), upd.media, upd.fullViews, JSON.stringify(buckets.map(x => +x.toFixed(1))), sess.student_id, sess.video_id);
    q(`UPDATE sessions SET last_active=?, watch_time=watch_time+?, pauses=pauses+?, pause_time=pause_time+?, seeks=seeks+?,
       tab_switches=tab_switches+?, blocked_actions=blocked_actions+?, max_rate=?, ended=?, end_pos=?, media_seconds=media_seconds+? WHERE id=?`)
      .run(now(), upd.watch, upd.pauses, upd.pauseTime, upd.seeks, upd.tabs, upd.blocked, upd.rate, upd.ended, upd.pos, upd.media, sess.id);
    q('UPDATE students SET last_seen=? WHERE id=?').run(now(), sess.student_id);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); console.error(err); return res.status(500).json({ error: 'track' }); }
  res.json({ ok: true });
});

// ---------- Admin ----------
app.post('/api/admin/login', (req, res) => {
  const a = Buffer.from(String(req.body.password || '')), b = Buffer.from(ADMIN_PASSWORD);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'ভুল পাসওয়ার্ড' });
  res.cookie('aid', sign({ t: 'a', exp: now() + 12 * 36e5 }), cookieOpts(12 * 36e5));
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => { res.clearCookie('aid'); res.json({ ok: true }); });
app.get('/api/admin/check', requireAdmin, (req, res) => res.json({ ok: true }));

app.get('/api/admin/overview', requireAdmin, (req, res) => {
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  res.json({
    students: q('SELECT COUNT(*) c FROM students').get().c,
    videos: q("SELECT COUNT(*) c FROM videos WHERE status='ready'").get().c,
    classes: q('SELECT COUNT(*) c FROM classes').get().c,
    watchTime: q('SELECT COALESCE(SUM(watch_time),0) s FROM sessions').get().s,
    sessionsToday: q('SELECT COUNT(*) c FROM sessions WHERE started_at>=?').get(dayStart.getTime()).c,
    activeNow: q('SELECT COUNT(DISTINCT student_id) c FROM sessions WHERE last_active>=?').get(now() - 60e3).c,
    completions: q('SELECT COUNT(*) c FROM progress WHERE completed=1').get().c,
    avgPercent: q('SELECT COALESCE(AVG(percent),0) a FROM progress').get().a,
    blocked: q('SELECT COALESCE(SUM(blocked_actions),0) s FROM sessions').get().s,
    recent: q(`SELECT se.id, se.started_at, se.last_active, se.watch_time, se.device, se.browser, se.os, se.ip, s.name student, s.email, s.phone, s.id student_id,
       v.title video, v.id video_id, p.percent FROM sessions se JOIN students s ON s.id=se.student_id JOIN videos v ON v.id=se.video_id
       LEFT JOIN progress p ON p.student_id=se.student_id AND p.video_id=se.video_id
       ORDER BY se.last_active DESC LIMIT 12`).all(),
    latestStudents: q(`SELECT s.id, s.name, s.email, s.phone, s.created_at, s.last_seen,
       (SELECT COUNT(*) FROM progress p WHERE p.student_id=s.id) started,
       (SELECT COALESCE(SUM(watch_time),0) FROM progress p WHERE p.student_id=s.id) watch_time
       FROM students s ORDER BY s.created_at DESC LIMIT 10`).all(),
    topVideos: q(`SELECT v.id, v.title, c.name class, COUNT(p.student_id) viewers, COALESCE(AVG(p.percent),0) avg_percent,
       SUM(p.completed) completed FROM videos v JOIN classes c ON c.id=v.class_id LEFT JOIN progress p ON p.video_id=v.id
       WHERE v.status='ready' GROUP BY v.id ORDER BY viewers DESC LIMIT 6`).all(),
  });
});

app.get('/api/admin/classes', requireAdmin, (req, res) => {
  res.json(q(`SELECT c.*, (SELECT COUNT(*) FROM videos v WHERE v.class_id=c.id) videos FROM classes c ORDER BY sort,id`).all());
});
app.post('/api/admin/classes', requireAdmin, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'ক্লাসের নাম দিন' });
  const sort = (q('SELECT MAX(sort) m FROM classes').get().m || 0) + 1;
  const r = q('INSERT INTO classes(name,sort,created_at) VALUES(?,?,?)').run(name, sort, now());
  res.json({ id: Number(r.lastInsertRowid) });
});
app.patch('/api/admin/classes/:id', requireAdmin, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'ক্লাসের নাম দিন' });
  q('UPDATE classes SET name=? WHERE id=?').run(name, req.params.id); res.json({ ok: true });
});
app.delete('/api/admin/classes/:id', requireAdmin, (req, res) => {
  for (const v of q('SELECT id FROM videos WHERE class_id=?').all(req.params.id)) fs.rmSync(vdir(v.id), { recursive: true, force: true });
  q('DELETE FROM classes WHERE id=?').run(req.params.id); res.json({ ok: true });
});

const jobs = new Map(); // videoId -> percent
let encodeQueue = Promise.resolve();
app.get('/api/admin/videos', requireAdmin, (req, res) => {
  const rows = q(`SELECT v.*, c.name class_name, COUNT(p.student_id) viewers, COALESCE(AVG(p.percent),0) avg_percent,
      COALESCE(SUM(p.completed),0) completed, COALESCE(SUM(p.watch_time),0) watch_time,
      (SELECT COUNT(*) FROM sessions se WHERE se.video_id=v.id AND se.watch_time>=5) views,
      (SELECT COUNT(*) FROM access a WHERE a.video_id=v.id) access_count
      FROM videos v JOIN classes c ON c.id=v.class_id LEFT JOIN progress p ON p.video_id=v.id
      GROUP BY v.id ORDER BY c.sort, v.id`).all();
  res.json(rows.map(r => ({ ...r, job: jobs.get(r.id) ?? null })));
});
app.patch('/api/admin/videos/:id', requireAdmin, (req, res) => {
  const v = q('SELECT * FROM videos WHERE id=?').get(req.params.id);
  if (!v) return res.status(404).end();
  q('UPDATE videos SET title=?, description=?, class_id=? WHERE id=?').run(
    String(req.body.title ?? v.title).slice(0, 150), String(req.body.description ?? v.description).slice(0, 2000),
    Number(req.body.class_id ?? v.class_id), v.id);
  res.json({ ok: true });
});
app.delete('/api/admin/videos/:id', requireAdmin, (req, res) => {
  fs.rmSync(vdir(req.params.id), { recursive: true, force: true });
  q('DELETE FROM videos WHERE id=?').run(req.params.id); res.json({ ok: true });
});

const upload = multer({ dest: path.join(DATA, 'tmp'), limits: { fileSize: 5 * 1024 ** 3 } });
app.post('/api/admin/videos', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ভিডিও ফাইল দিন' });
  const cls = q('SELECT id FROM classes WHERE id=?').get(req.body.class_id);
  if (!cls) { fs.rmSync(req.file.path, { force: true }); return res.status(400).json({ error: 'ক্লাস সিলেক্ট করুন' }); }
  const title = String(req.body.title || req.file.originalname).trim().slice(0, 150);
  const r = q('INSERT INTO videos(class_id,title,description,status,created_at,share_token) VALUES(?,?,?,?,?,?)')
    .run(cls.id, title, String(req.body.description || '').slice(0, 2000), 'processing', now(), newShareToken());
  const id = Number(r.lastInsertRowid);
  jobs.set(id, 0);
  encodeQueue = encodeQueue.then(() => processVideo(id, req.file.path)); // one encode at a time
  res.json({ id });
});

function probeDuration(file) {
  return new Promise((resolve) => execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    (err, out) => resolve(err ? 0 : parseFloat(out) || 0)));
}
async function processVideo(id, input) {
  const dir = vdir(id);
  fs.mkdirSync(dir, { recursive: true });
  jobs.set(id, 0);
  try {
    const duration = await probeDuration(input);
    if (!duration) throw new Error('ভিডিও ফাইলটি পড়া যাচ্ছে না');
    fs.writeFileSync(path.join(dir, 'enc.key'), crypto.randomBytes(16));
    fs.writeFileSync(path.join(dir, 'keyinfo'), `KEYURI\n${path.join(dir, 'enc.key')}\n${crypto.randomBytes(16).toString('hex')}\n`);
    await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', ['-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-vf', 'scale=-2:min(720\\,ih)', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
        '-hls_time', '6', '-hls_playlist_type', 'vod', '-hls_key_info_file', path.join(dir, 'keyinfo'),
        '-hls_segment_filename', path.join(dir, 'seg_%04d.ts'), '-progress', 'pipe:1', '-nostats', path.join(dir, 'index.m3u8')]);
      let err = '';
      ff.stdout.on('data', (b) => {
        const m = /out_time_ms=(\d+)/.exec(String(b));
        if (m) jobs.set(id, Math.min(99, Math.round(Number(m[1]) / 1e6 / duration * 100)));
      });
      ff.stderr.on('data', (b) => { err = (err + b).slice(-2000); });
      ff.on('close', (code) => code === 0 ? resolve() : reject(new Error('ffmpeg: ' + err.split('\n').slice(-3).join(' '))));
    });
    await new Promise((resolve) => execFile('ffmpeg', ['-y', '-ss', String(Math.min(3, duration / 3)), '-i', input, '-frames:v', '1',
      '-vf', 'scale=480:-2', path.join(dir, 'thumb.jpg')], () => resolve()));
    fs.rmSync(path.join(dir, 'keyinfo'), { force: true });
    q("UPDATE videos SET status='ready', duration=? WHERE id=?").run(duration, id);
  } catch (e) {
    console.error('process video', id, e.message);
    q("UPDATE videos SET status='error', error=? WHERE id=?").run(String(e.message).slice(0, 500), id);
  } finally {
    jobs.delete(id);
    fs.rmSync(input, { force: true });
  }
}

app.get('/api/admin/students', requireAdmin, (req, res) => {
  res.json(q(`SELECT s.*, COUNT(p.video_id) started, COALESCE(SUM(p.completed),0) completed,
      COALESCE(SUM(p.watch_time),0) watch_time, COALESCE(AVG(p.percent),0) avg_percent,
      COALESCE(SUM(p.full_views),0) full_views, COALESCE(SUM(MAX(p.media_seconds - p.unique_seconds, 0)),0) rewatch_seconds,
      (SELECT COUNT(*) FROM sessions se WHERE se.student_id=s.id AND se.watch_time>=5) views,
      (SELECT COUNT(*) FROM sessions se WHERE se.student_id=s.id) sessions,
      (SELECT COALESCE(SUM(blocked_actions),0) FROM sessions se WHERE se.student_id=s.id) blocked_actions
      FROM students s LEFT JOIN progress p ON p.student_id=s.id GROUP BY s.id ORDER BY s.last_seen DESC`).all());
});
app.get('/api/admin/students/:id', requireAdmin, (req, res) => {
  const s = q('SELECT * FROM students WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).end();
  const progress = q(`SELECT p.*, (SELECT COUNT(*) FROM sessions se WHERE se.student_id=p.student_id AND se.video_id=p.video_id AND se.watch_time>=5) views, v.title, v.duration, c.name class_name FROM progress p JOIN videos v ON v.id=p.video_id
      JOIN classes c ON c.id=v.class_id WHERE p.student_id=? ORDER BY p.last_watched DESC`).all(s.id);
  const sessions = q(`SELECT se.*, v.title FROM sessions se JOIN videos v ON v.id=se.video_id WHERE se.student_id=?
      ORDER BY se.started_at DESC LIMIT 200`).all(s.id);
  const access = q(`SELECT a.*, v.title, c.name class_name FROM access a JOIN videos v ON v.id=a.video_id JOIN classes c ON c.id=v.class_id
      WHERE a.student_id=? ORDER BY a.granted_at DESC`).all(s.id);
  res.json({ student: s, progress, sessions, access });
});
app.patch('/api/admin/students/:id', requireAdmin, (req, res) => {
  q('UPDATE students SET blocked=? WHERE id=?').run(req.body.blocked ? 1 : 0, req.params.id); res.json({ ok: true });
});
app.delete('/api/admin/students/:id', requireAdmin, (req, res) => {
  q('DELETE FROM students WHERE id=?').run(req.params.id); res.json({ ok: true });
});
// share link controls
app.post('/api/admin/videos/:id/share', requireAdmin, (req, res) => {
  const v = q('SELECT * FROM videos WHERE id=?').get(req.params.id);
  if (!v) return res.status(404).end();
  if (req.body.regenerate) q('UPDATE videos SET share_token=? WHERE id=?').run(newShareToken(), v.id);
  if (typeof req.body.enabled === 'boolean') q('UPDATE videos SET share_enabled=? WHERE id=?').run(req.body.enabled ? 1 : 0, v.id);
  res.json(q('SELECT share_token, share_enabled FROM videos WHERE id=?').get(v.id));
});
app.get('/api/admin/videos/:id/access', requireAdmin, (req, res) => {
  res.json(q(`SELECT a.*, s.name, s.email, s.phone FROM access a JOIN students s ON s.id=a.student_id
      WHERE a.video_id=? ORDER BY a.granted_at DESC`).all(req.params.id));
});
// give a student access to a video: existing student by id, or a new/existing one by name+email+phone
app.post('/api/admin/access', requireAdmin, (req, res) => {
  const vid = Number(req.body.video_id);
  if (!q('SELECT 1 FROM videos WHERE id=?').get(vid)) return res.status(404).json({ error: 'ভিডিও পাওয়া যায়নি' });
  let sid = Number(req.body.student_id) || null;
  if (!sid) {
    const name = String(req.body.name || '').trim().slice(0, 80), email = normEmail(req.body.email), phone = normPhone(req.body.phone);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length < 10) return res.status(400).json({ error: 'সঠিক ইমেইল ও ফোন নম্বর দিন' });
    const byEmail = q('SELECT * FROM students WHERE email=?').get(email), byPhone = q('SELECT * FROM students WHERE phone=?').get(phone);
    if (byEmail && byPhone && byEmail.id === byPhone.id) sid = byEmail.id;
    else if (byEmail || byPhone) return res.status(409).json({ error: 'এই ইমেইল বা ফোন অন্য একজন স্টুডেন্টের নামে আছে। তালিকা থেকে বেছে নিন।' });
    else {
      if (name.length < 2) return res.status(400).json({ error: 'নাম দিন' });
      sid = Number(q('INSERT INTO students(name,email,phone,created_at) VALUES(?,?,?,?)').run(name, email, phone, now()).lastInsertRowid);
    }
  }
  if (!q('SELECT 1 FROM students WHERE id=?').get(sid)) return res.status(404).json({ error: 'স্টুডেন্ট পাওয়া যায়নি' });
  q("INSERT OR IGNORE INTO access(student_id,video_id,source,granted_at) VALUES(?,?,'admin',?)").run(sid, vid, now());
  res.json({ ok: true, student_id: sid });
});
app.delete('/api/admin/access', requireAdmin, (req, res) => {
  q('DELETE FROM access WHERE student_id=? AND video_id=?').run(Number(req.body.student_id), Number(req.body.video_id));
  res.json({ ok: true });
});
app.get('/api/admin/sessions/:id', requireAdmin, (req, res) => {
  const se = q(`SELECT se.*, v.title, v.duration, s.name student FROM sessions se JOIN videos v ON v.id=se.video_id
     JOIN students s ON s.id=se.student_id WHERE se.id=?`).get(req.params.id);
  if (!se) return res.status(404).end();
  res.json({ session: se, events: q('SELECT type,pos,at,data FROM events WHERE session_id=? ORDER BY at, id').all(se.id) });
});
app.get('/api/admin/videos/:id/report', requireAdmin, (req, res) => {
  const v = q('SELECT v.*, c.name class_name FROM videos v JOIN classes c ON c.id=v.class_id WHERE v.id=?').get(req.params.id);
  if (!v) return res.status(404).end();
  const rows = q(`SELECT p.*, (SELECT COUNT(*) FROM sessions se WHERE se.student_id=p.student_id AND se.video_id=p.video_id AND se.watch_time>=5) views, s.name, s.email, s.phone,
      (SELECT COUNT(*) FROM sessions se WHERE se.student_id=p.student_id AND se.video_id=p.video_id) sessions,
      (SELECT COALESCE(SUM(pauses),0) FROM sessions se WHERE se.student_id=p.student_id AND se.video_id=p.video_id) pauses,
      (SELECT COALESCE(SUM(seeks),0) FROM sessions se WHERE se.student_id=p.student_id AND se.video_id=p.video_id) seeks,
      (SELECT COALESCE(SUM(tab_switches),0) FROM sessions se WHERE se.student_id=p.student_id AND se.video_id=p.video_id) tab_switches
      FROM progress p JOIN students s ON s.id=p.student_id WHERE p.video_id=? ORDER BY p.percent DESC`).all(v.id);
  // heatmap: how many students watched each 1/60th of the video; pause hotspots
  const B = 60, heat = new Array(B).fill(0), pauseHeat = new Array(B).fill(0);
  for (const r of rows) {
    const seen = new Array(B).fill(false);
    for (const [a, b] of JSON.parse(r.ranges || '[]'))
      for (let i = Math.floor(a / v.duration * B); i < Math.min(B, Math.ceil(b / v.duration * B)); i++) seen[i] = true;
    seen.forEach((x, i) => { if (x) heat[i]++; });
  }
  const rewatchHeat = new Array(B).fill(0), bl = v.duration / NB;
  for (const r of rows) {
    const bk = JSON.parse(r.buckets || '[]');
    bk.forEach((sec, i) => { const extra = Math.max(0, sec / bl - 1); rewatchHeat[Math.min(B - 1, Math.floor(i / NB * B))] += extra / (NB / B); });
  }
  for (const e of q("SELECT pos FROM events WHERE video_id=? AND type='pause'").all(v.id))
    pauseHeat[Math.min(B - 1, Math.floor(e.pos / (v.duration || 1) * B))]++;
  res.json({ video: v, rows, heat, pauseHeat, rewatchHeat });
});
app.get('/api/admin/students.csv', requireAdmin, (req, res) => {
  const rows = q(`SELECT s.name, s.email, s.phone, datetime(s.created_at/1000,'unixepoch','+6 hours') joined,
      datetime(s.last_seen/1000,'unixepoch','+6 hours') last_seen, s.login_count logins,
      (SELECT COUNT(*) FROM access a WHERE a.student_id=s.id) videos_allowed,
      (SELECT COUNT(*) FROM progress p WHERE p.student_id=s.id) videos_started,
      (SELECT COALESCE(SUM(completed),0) FROM progress p WHERE p.student_id=s.id) videos_finished,
      (SELECT ROUND(COALESCE(SUM(watch_time),0)) FROM progress p WHERE p.student_id=s.id) watch_seconds,
      (SELECT COUNT(*) FROM sessions se WHERE se.student_id=s.id) sessions,
      (SELECT device || ' / ' || browser || ' / ' || os FROM sessions se WHERE se.student_id=s.id ORDER BY started_at DESC LIMIT 1) last_device,
      (SELECT ip FROM sessions se WHERE se.student_id=s.id ORDER BY started_at DESC LIMIT 1) last_ip,
      CASE WHEN s.blocked THEN 'blocked' ELSE '' END status
      FROM students s ORDER BY s.created_at DESC`).all();
  const cols = ['name', 'email', 'phone', 'joined', 'last_seen', 'logins', 'videos_allowed', 'videos_started', 'videos_finished', 'watch_seconds', 'sessions', 'last_device', 'last_ip', 'status'];
  const esc = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="students.csv"' });
  res.send('\ufeff' + [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n'));
});
app.get('/api/admin/export.csv', requireAdmin, (req, res) => {
  const rows = q(`SELECT s.name, s.email, s.phone, c.name class, v.title video, ROUND(p.percent,1) percent,
      ROUND(p.unique_seconds) unique_seconds, ROUND(p.watch_time) watch_seconds, p.completed, p.full_views times_finished, ROUND(MAX(p.media_seconds - p.unique_seconds,0)) rewatch_seconds,
      (SELECT COUNT(*) FROM sessions se WHERE se.student_id=p.student_id AND se.video_id=p.video_id AND se.watch_time>=5) views,
      datetime(p.first_watched/1000,'unixepoch') first_watched, datetime(p.last_watched/1000,'unixepoch') last_watched
      FROM progress p JOIN students s ON s.id=p.student_id JOIN videos v ON v.id=p.video_id JOIN classes c ON c.id=v.class_id
      ORDER BY s.name, c.sort, v.id`).all();
  const cols = ['name', 'email', 'phone', 'class', 'video', 'percent', 'unique_seconds', 'watch_seconds', 'completed', 'views', 'times_finished', 'rewatch_seconds', 'first_watched', 'last_watched'];
  const esc = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="student-progress.csv"' });
  res.send('﻿' + [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n'));
});

// ---------- Static ----------
// The player script is served minified + name-mangled so it's hard to read in devtools.
let playerJs = null;
require('terser').minify(fs.readFileSync(path.join(__dirname, 'public/js/watch.js'), 'utf8'),
  { compress: { drop_debugger: false }, mangle: { toplevel: true }, format: { comments: false } })
  .then(r => { playerJs = r.code; }).catch(e => console.error('minify', e.message));
app.get('/js/watch.js', (req, res, next) => {
  if (!playerJs) return next();
  res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); res.send(playerJs);
});
app.use('/vendor/hls.min.js', (req, res) => res.sendFile(require.resolve('hls.js/dist/hls.min.js')));
app.use('/fonts', express.static(path.join(__dirname, 'node_modules/@fontsource/hind-siliguri/files'), { maxAge: '30d' }));
app.get('/v/:token', (req, res) => res.sendFile(path.join(__dirname, 'public/watch.html')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// Mark videos stuck in processing (server restarted mid-encode) as errored
q("UPDATE videos SET status='error', error='সার্ভার রিস্টার্ট হয়েছে, আবার আপলোড করুন' WHERE status='processing'").run();

if (require.main === module) app.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`ClassVault running on http://${process.env.HOST || 'localhost'}:${PORT}  (admin: /admin)`));
module.exports = { app, processVideo, db };
