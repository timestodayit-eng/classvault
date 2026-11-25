// ClassVault: secure class video platform
// Node 22+ (uses built-in node:sqlite). Requires ffmpeg + ffprobe on PATH.
const express = require('express');
const { sendSms, PROVIDERS } = require('./lib/sms');
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
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT, phone TEXT NOT NULL UNIQUE,
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
  ['videos', 'share_token TEXT'], ['videos', 'share_enabled INTEGER DEFAULT 1'], ['students', 'company TEXT'], ['sessions', 'real_time REAL DEFAULT 0'], ['progress', 'real_time REAL DEFAULT 0'], ['videos', "source TEXT DEFAULT 'upload'"], ['videos', 'yt_id TEXT'], ['students', 'designation TEXT']]) {
  try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${c}`); } catch { /* exists */ }
}
// Access control: every video is private. A student can watch a video only if they have a row here,
// given either by opening the video's share link ("link") or by the admin ("admin").
db.exec('CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT)');
const getSetting = (k, d = '') => (db.prepare('SELECT v FROM settings WHERE k=?').get(k) || { v: d }).v;
const setSetting = (k, v) => db.prepare('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v ?? ''));
// ---------- Officer allowlist ----------
// Only mobile numbers on this list can get a login code. The admin imports the officers' list (pasted from Excel)
// and can add/remove numbers by hand. Name/company/designation/email from the list are pre-filled on first login.
db.exec(`CREATE TABLE IF NOT EXISTS allowlist(phone TEXT PRIMARY KEY, name TEXT, company TEXT, designation TEXT, email TEXT,
  alt_phone TEXT, source TEXT, added_at INTEGER)`);
const allowCount = () => db.prepare('SELECT COUNT(*) c FROM allowlist').get().c;
// enforced when switched on (default) and the list isn't empty, so an empty list never locks everyone out
const allowEnforced = () => getSetting('allowlist_enabled', '1') === '1' && allowCount() > 0;
const allowRow = (phone) => db.prepare('SELECT * FROM allowlist WHERE phone=? OR phone=?').get(phone, String(phone).replace('+', ''));
const isAllowed = (phone) => !allowEnforced() || !!allowRow(phone);
const DEFAULT_NOTICE = 'আপনার নম্বরটি লগইনের তালিকায় নেই। লগইন করার অনুমতির জন্য দয়া করে জনাব খালিদ সাইফুল স্যার অথবা আপনার ঊর্ধ্বতন অফিসারের সাথে যোগাযোগ করুন এবং আপনার তথ্য জমা দিন।';
const loginNotice = () => getSetting('login_notice', DEFAULT_NOTICE) || DEFAULT_NOTICE;

// Migration for OTP login: the phone number is now the identity, so email no longer has to be unique.
// SQLite can't drop a UNIQUE constraint in place, so the table is rebuilt once (all rows and ids are kept).
if (/email TEXT NOT NULL UNIQUE/.test(db.prepare("SELECT sql FROM sqlite_master WHERE name='students'").get().sql)) {
  const cols = db.prepare('PRAGMA table_info(students)').all().map(c => c.name);
  const extra = cols.filter(c => !['id', 'name', 'email', 'phone', 'blocked', 'created_at', 'last_seen', 'login_count'].includes(c));
  const types = Object.fromEntries(db.prepare('PRAGMA table_info(students)').all().map(c => [c.name, c.type + (c.dflt_value != null ? ' DEFAULT ' + c.dflt_value : '')]));
  db.exec('PRAGMA foreign_keys=OFF');
  db.exec('BEGIN');
  db.exec(`CREATE TABLE students_new(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT, phone TEXT NOT NULL UNIQUE,
    blocked INTEGER DEFAULT 0, created_at INTEGER, last_seen INTEGER, login_count INTEGER DEFAULT 0${extra.map(c => `, ${c} ${types[c]}`).join('')})`);
  db.exec(`INSERT INTO students_new(${cols.join(',')}) SELECT ${cols.join(',')} FROM students`);
  db.exec('DROP TABLE students'); db.exec('ALTER TABLE students_new RENAME TO students');
  db.exec('COMMIT'); db.exec('PRAGMA foreign_keys=ON');
  console.log('migrated students table for OTP login');
}
// every time someone fills the name/email/phone/company form (login page or share link)
db.exec(`CREATE TABLE IF NOT EXISTS form_entries(id INTEGER PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
  name TEXT, email TEXT, phone TEXT, company TEXT, via TEXT, video_id INTEGER, matched TEXT, ip TEXT, user_agent TEXT, at INTEGER)`);
db.exec('CREATE INDEX IF NOT EXISTS fe_student ON form_entries(student_id, at)');
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
  if (!p || p.t !== 's' || p.v !== SESSION_VER) return null;
  const s = q('SELECT * FROM students WHERE id=?').get(p.id);
  if (!s || s.blocked || !isAllowed(s.phone)) return null; // taken off the officer list → signed out
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
const bnDigits = (x) => String(x || '').replace(/[০-৯]/g, d => '০১২৩৪৫৬৭৮৯'.indexOf(d));
const normPhone = (p) => { let d = bnDigits(p).replace(/\D/g, ''); if (d.startsWith('880')) d = '0' + d.slice(3); return d; };

// Companies students can pick at login (admin can filter reports by these).
const COMPANIES = ['Creative International', 'Coastal Manpower', 'SM Enterprise', 'Creative Group'];
app.get('/api/companies', (req, res) => res.json(COMPANIES));
// ---------- Phone number + OTP login ----------
// The mobile number is the person's identity: one number = one profile. Every login needs a one-time code sent by SMS.
// First login with a number → after the code, the person fills name / email / company once and the profile is created.
// Phone: Bangladeshi mobile 01XXXXXXXXX (+880 accepted), or an international number written with + / 00.
function checkPhone(raw) {
  raw = bnDigits(raw).trim(); const phone = normPhone(raw);
  if (!raw) return { error: 'মোবাইল নম্বর লিখুন' };
  const bd = /^01[3-9]\d{8}$/.test(phone), intl = /^(\+|00)/.test(raw) && !raw.replace(/^(\+|00)/, '').startsWith('880') && phone.length >= 8 && phone.length <= 15;
  if (!bd && !intl) return { error: 'সঠিক মোবাইল নম্বর লিখুন (যেমন: 01712345678, বিদেশি হলে +60…)' };
  return { phone: intl ? '+' + raw.replace(/^(\+|00)/, '').replace(/\D/g, '') : phone };
}
function checkProfile(body) {
  const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const email = normEmail(body.email), company = String(body.company || '');
  if (!name) return { error: 'আপনার নাম লিখুন' };
  if (name.replace(/[^\p{L}]/gu, '').length < 3) return { error: 'পুরো নাম লিখুন (কমপক্ষে ৩ অক্ষর)' };
  if (!email) return { error: 'ইমেইল লিখুন' };
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i.test(email) || email.length > 120) return { error: 'সঠিক ইমেইল লিখুন (যেমন: name@gmail.com)' };
  if (!company) return { error: 'আপনি কোন কোম্পানির, সেটা বেছে নিন' };
  if (!COMPANIES.includes(company)) return { error: 'তালিকা থেকে কোম্পানি বেছে নিন' };
  return { name, email, company };
}
// used by the admin "give access" form: phone + profile together
function checkSignup(body) { const p = checkPhone(body.phone); if (p.error) return p; const f = checkProfile(body); return f.error ? f : { ...f, phone: p.phone }; }
const findByPhone = (phone) => q('SELECT * FROM students WHERE phone=? OR phone=?').get(phone, phone.replace('+', ''));
const profileDone = (s) => s && s.name && s.email && s.company;

const SESSION_VER = 2; // bumped when OTP login came in: older cookies are refused, so everyone signs in once with a code
function startStudentSession(req, res, student, via) {
  q(`INSERT INTO form_entries(student_id,name,email,phone,company,via,video_id,matched,ip,user_agent,at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(student.id, student.name, student.email, student.phone, student.company, req.body.via === 'link' ? 'link' : 'login',
      (q('SELECT id FROM videos WHERE share_token=?').get(String(req.body.token || '')) || {}).id || null, via, req.ip,
      String(req.get('user-agent') || '').slice(0, 300), now());
  q('UPDATE students SET last_seen=?, login_count=login_count+1 WHERE id=?').run(now(), student.id);
  res.cookie('sid', sign({ t: 's', id: student.id, v: SESSION_VER, exp: now() + 30 * 864e5 }), cookieOpts(30 * 864e5));
  res.json({ ok: true, student: { id: student.id, name: student.name, email: student.email, phone: student.phone, company: student.company } });
}

db.exec(`CREATE TABLE IF NOT EXISTS otps(phone TEXT PRIMARY KEY, code_hash TEXT, expires INTEGER, attempts INTEGER DEFAULT 0, sent_at INTEGER,
  hour_start INTEGER, hour_count INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS otp_log(id INTEGER PRIMARY KEY, phone TEXT, at INTEGER, ok INTEGER, provider TEXT, error TEXT, test_code TEXT, ip TEXT);`);
const OTP_TTL = 5 * 60e3, OTP_COOLDOWN = 60e3, OTP_PER_HOUR = 5, OTP_MAX_TRIES = 5, IP_PER_HOUR = 30;
const otpHash = (phone, code) => crypto.createHmac('sha256', SECRET).update('otp:' + phone + ':' + code).digest('hex');
const ipHits = new Map();
const smsCfg = () => ({ provider: getSetting('sms_provider', 'test'), api_key: getSetting('sms_api_key'), sender_id: getSetting('sms_sender_id'),
  custom_url: getSetting('sms_custom_url'), message: getSetting('sms_message', 'Your ClassVault login code is {code}. Valid for 5 minutes. Do not share it.') });

app.post('/api/otp/send', async (req, res) => {
  const chk = checkPhone(req.body.phone); if (chk.error) return res.status(400).json({ error: chk.error });
  const { phone } = chk, t = now();
  const ih = (ipHits.get(req.ip) || []).filter(x => t - x < 36e5);
  if (ih.length >= IP_PER_HOUR) return res.status(429).json({ error: 'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।' });
  const o = q('SELECT * FROM otps WHERE phone=?').get(phone);
  if (o && t - o.sent_at < OTP_COOLDOWN) return res.status(429).json({ error: 'একটু অপেক্ষা করুন, তারপর আবার কোড চান।', wait: Math.ceil((OTP_COOLDOWN - (t - o.sent_at)) / 1000) });
  const fresh = !o || t - o.hour_start > 36e5;
  if (!fresh && o.hour_count >= OTP_PER_HOUR) return res.status(429).json({ error: 'এই নম্বরে এক ঘণ্টায় অনেকবার কোড পাঠানো হয়েছে। পরে চেষ্টা করুন।' });
  const blocked = findByPhone(phone); if (blocked && blocked.blocked) return res.status(403).json({ error: 'আপনার অ্যাক্সেস বন্ধ করা হয়েছে। অ্যাডমিনের সাথে যোগাযোগ করুন।' });
  if (!isAllowed(phone)) {
    q('INSERT INTO otp_log(phone,at,ok,provider,error,test_code,ip) VALUES(?,?,0,?,?,NULL,?)').run(phone, t, 'blocked', 'not_on_list', req.ip);
    return res.status(403).json({ notAllowed: true, error: loginNotice() });
  }
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0'), cfg = smsCfg();
  const r = await sendSms(cfg, phone, cfg.message.replace('{code}', code));
  q('INSERT INTO otp_log(phone,at,ok,provider,error,test_code,ip) VALUES(?,?,?,?,?,?,?)').run(phone, t, r.ok ? 1 : 0, cfg.provider, r.error || null, r.test ? code : null, req.ip);
  if (!r.ok) { console.error('SMS failed:', r.error); return res.status(502).json({ error: 'এখন SMS পাঠানো যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।' }); }
  ih.push(t); ipHits.set(req.ip, ih);
  q(`INSERT INTO otps(phone,code_hash,expires,attempts,sent_at,hour_start,hour_count) VALUES(?,?,?,0,?,?,1)
     ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash, expires=excluded.expires, attempts=0, sent_at=excluded.sent_at,
     hour_start=CASE WHEN ? THEN excluded.hour_start ELSE otps.hour_start END, hour_count=CASE WHEN ? THEN 1 ELSE otps.hour_count+1 END`)
    .run(phone, otpHash(phone, code), t + OTP_TTL, t, t, fresh ? 1 : 0, fresh ? 1 : 0);
  res.json({ ok: true, phone, wait: OTP_COOLDOWN / 1000, test: !!r.test });
});
app.post('/api/otp/verify', (req, res) => {
  const chk = checkPhone(req.body.phone); if (chk.error) return res.status(400).json({ error: chk.error });
  const { phone } = chk, code = bnDigits(req.body.code).replace(/\D/g, '');
  const o = q('SELECT * FROM otps WHERE phone=?').get(phone);
  if (!o || !o.code_hash || o.expires < now()) return res.status(400).json({ error: 'কোডের মেয়াদ শেষ। আবার কোড চান।', expired: true });
  if (o.attempts >= OTP_MAX_TRIES) return res.status(400).json({ error: 'অনেকবার ভুল কোড দেওয়া হয়েছে। নতুন কোড চান।', expired: true });
  const good = code.length === 6 && crypto.timingSafeEqual(Buffer.from(otpHash(phone, code)), Buffer.from(o.code_hash));
  if (!good) { q('UPDATE otps SET attempts=attempts+1 WHERE phone=?').run(phone); return res.status(400).json({ error: `কোড মেলেনি। আর ${String(OTP_MAX_TRIES - o.attempts - 1).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d])} বার চেষ্টা করতে পারবেন।` }); }
  q('UPDATE otps SET code_hash=NULL WHERE phone=?').run(phone); // one use only
  if (!isAllowed(phone)) return res.status(403).json({ notAllowed: true, error: loginNotice() });
  const s = findByPhone(phone), al = allowRow(phone);
  if (s && s.blocked) return res.status(403).json({ error: 'আপনার অ্যাক্সেস বন্ধ করা হয়েছে। অ্যাডমিনের সাথে যোগাযোগ করুন।' });
  if (s && al && !s.designation && al.designation) q('UPDATE students SET designation=? WHERE id=?').run(al.designation, s.id);
  if (profileDone(s)) return startStudentSession(req, res, findByPhone(phone), 'otp');
  // number verified but no (complete) profile yet → one-time form, pre-filled from the officer list; the ticket proves the number was verified
  const pre = { name: (s && s.name) || (al && al.name) || '', email: (s && s.email) || (al && al.email) || '', company: (s && s.company) || (al && al.company) || '',
    designation: (s && s.designation) || (al && al.designation) || '' };
  res.json({ needProfile: true, ticket: sign({ t: 'otp', phone, exp: now() + 20 * 60e3 }), prefill: pre });
});
app.post('/api/otp/profile', (req, res) => {
  const tk = verify(req.body.ticket);
  if (!tk || tk.t !== 'otp') return res.status(400).json({ error: 'সময় শেষ হয়ে গেছে। আবার নম্বর দিয়ে শুরু করুন।', restart: true });
  const f = checkProfile(req.body); if (f.error) return res.status(400).json({ error: f.error });
  if (!isAllowed(tk.phone)) return res.status(403).json({ notAllowed: true, error: loginNotice() });
  const desig = String(req.body.designation || (allowRow(tk.phone) || {}).designation || '').trim().slice(0, 80) || null;
  let s = findByPhone(tk.phone), via = 'otp';
  if (s) q('UPDATE students SET name=?, email=?, company=?, designation=? WHERE id=?').run(f.name, f.email, f.company, desig, s.id);
  else { s = { id: Number(q('INSERT INTO students(name,email,phone,company,designation,created_at) VALUES(?,?,?,?,?,?)').run(f.name, f.email, tk.phone, f.company, desig, now()).lastInsertRowid) }; via = 'new'; }
  s = q('SELECT * FROM students WHERE id=?').get(s.id);
  if (s.blocked) return res.status(403).json({ error: 'আপনার অ্যাক্সেস বন্ধ করা হয়েছে।' });
  startStudentSession(req, res, s, via);
});
app.get('/api/login-info', (req, res) => res.json({ restricted: allowEnforced(), notice: loginNotice() }));
app.post('/api/login', (req, res) => res.status(410).json({ error: 'এখন মোবাইল নম্বর ও OTP কোড দিয়ে ঢুকতে হয়। পেজটি রিফ্রেশ করুন।' }));
app.post('/api/logout', (req, res) => { res.clearCookie('sid'); res.json({ ok: true }); });
app.get('/api/me', requireStudent, (req, res) => {
  const { id, name, email, phone, company } = req.student; res.json({ id, name, email, phone, company });
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
  res.json({ video: v, me: s ? { name: s.name, email: s.email, phone: s.phone, company: s.company } : null });
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
// Telling a downloader from a student who seeks a lot: a downloader pulls the segments IN ORDER, far faster than real time.
// A student who jumps around fetches a few segments at each new spot. So:
//  - more than SEG_PER_MIN in a minute → we only slow that session down a little (no block, playback keeps going);
//  - SEQ_RUN_MAX segments in a row within a minute (= several minutes of video pulled straight through) → block + log;
//  - SEG_HARD_MAX in a minute, in any order → block + log (no human can seek that much).
const SEQ_RUN_MAX = 45, SEG_HARD_MAX = 240;
app.get('/api/stream/:id/seg/:seg', async (req, res) => {
  if (!/^seg_\d+\.ts$/.test(req.params.seg)) return res.status(400).end();
  const sess = streamSession(req, res); if (!sess) return;
  const t = now(), idx = Number(req.params.seg.slice(4, -3));
  const hits = (segHits.get(sess.id) || []).filter(x => t - x.t < 60e3);
  hits.push({ t, idx }); segHits.set(sess.id, hits);
  let run = 1, best = 1;
  for (let i = 1; i < hits.length; i++) { run = hits[i].idx === hits[i - 1].idx + 1 ? run + 1 : (hits[i].idx === hits[i - 1].idx ? run : 1); if (run > best) best = run; }
  if (best >= SEQ_RUN_MAX || hits.length > SEG_HARD_MAX) {
    flagSession(sess, best >= SEQ_RUN_MAX ? 'too_fast' : 'too_many'); segHits.delete(sess.id); return res.status(403).end();
  }
  if (hits.length > SEG_PER_MIN) await new Promise(r => setTimeout(r, Math.min(3000, (hits.length - SEG_PER_MIN) * 100)));
  if (res.writableEnded || req.destroyed) return;
  res.set({ 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-store' });
  res.sendFile(path.join(vdir(req.params.id), req.params.seg));
});
setInterval(() => { const t = now(); for (const [k, v] of segHits) if (!v.length || t - v[v.length - 1].t > 120e3) segHits.delete(k); }, 60e3).unref();

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
  if (!req.student.company) return res.status(403).json({ error: 'company' }); // older accounts: ask for company once
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
  const yt = v.source === 'youtube' && v.yt_id ? Buffer.from(Buffer.from(v.yt_id).map((b, i) => b ^ mask[i % 16] ^ pad[(i + 7) % 32])).toString('base64') : null;
  res.json({
    sessionId, startPos, cfg: { b: 6, t: Buffer.from(mask.map((x, i) => x ^ pad[i])).toString('base64'), ...(yt ? { y: yt } : {}) },
    video: { id: v.id, title: v.title, description: v.description, duration: v.duration },
    src: v.source === 'youtube' ? null : `/api/stream/${v.id}/index.m3u8?s=${sessionId}`,
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
  const upd = { real: 0, watch: 0, pauses: 0, pauseTime: 0, seeks: 0, tabs: 0, blocked: 0, rate: sess.max_rate, ended: sess.ended, pos: sess.end_pos, media: 0, fullViews: 0 };
  // YouTube classes: if the admin didn't enter the length, take it from the first player that reports it
  if (video.source === 'youtube' && !video.duration) {
    const meta = events.find(e => e && e.type === 'meta' && e.d && Number(e.d.duration) > 0);
    if (meta) { video.duration = Math.round(Math.min(36000, Number(meta.d.duration))); q('UPDATE videos SET duration=? WHERE id=?').run(video.duration, video.id); }
  }
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
        // Watch time = how much of the VIDEO was played, at any speed: 10 min watched at 2x counts as 10 min, same as 1x.
        // (Real clock time is kept separately in real_time.)
        // sanity: covered media time can't exceed wall time * max speed (2x) + slack
        if (to > from && to - from <= wall * 2.1 + 2 && dur) {
          ranges.push([from, to]); upd.media += to - from; upd.watch += to - from;
          const bl = dur / NB;
          for (let i = Math.floor(from / bl); i < NB && i * bl < to; i++)
            buckets[i] += Math.max(0, Math.min(to, (i + 1) * bl) - Math.max(from, i * bl));
        }
        upd.real += wall; upd.pos = to;
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
    q(`UPDATE progress SET real_time=real_time+?, ranges=?, unique_seconds=?, watch_time=watch_time+?, last_position=?, percent=?, completed=?,
       completed_at=COALESCE(completed_at, ?), last_watched=?, media_seconds=media_seconds+?, full_views=full_views+?, buckets=? WHERE student_id=? AND video_id=?`)
      .run(upd.real, JSON.stringify(ranges.map(r => [+r[0].toFixed(1), +r[1].toFixed(1)])), unique, upd.watch, upd.pos, percent, completed,
        completed ? now() : null, now(), upd.media, upd.fullViews, JSON.stringify(buckets.map(x => +x.toFixed(1))), sess.student_id, sess.video_id);
    q(`UPDATE sessions SET real_time=real_time+?, last_active=?, watch_time=watch_time+?, pauses=pauses+?, pause_time=pause_time+?, seeks=seeks+?,
       tab_switches=tab_switches+?, blocked_actions=blocked_actions+?, max_rate=?, ended=?, end_pos=?, media_seconds=media_seconds+? WHERE id=?`)
      .run(upd.real, now(), upd.watch, upd.pauses, upd.pauseTime, upd.seeks, upd.tabs, upd.blocked, upd.rate, upd.ended, upd.pos, upd.media, sess.id);
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
    recent: q(`SELECT se.id, se.started_at, se.last_active, se.watch_time, se.device, se.browser, se.os, se.ip, s.name student, s.email, s.phone, s.company, s.id student_id,
       v.title video, v.id video_id, p.percent FROM sessions se JOIN students s ON s.id=se.student_id JOIN videos v ON v.id=se.video_id
       LEFT JOIN progress p ON p.student_id=se.student_id AND p.video_id=se.video_id
       ORDER BY se.last_active DESC LIMIT 12`).all(),
    latestStudents: q(`SELECT s.id, s.name, s.email, s.phone, s.company, s.created_at, s.last_seen,
       (SELECT COUNT(*) FROM progress p WHERE p.student_id=s.id) started,
       (SELECT COALESCE(SUM(watch_time),0) FROM progress p WHERE p.student_id=s.id) watch_time
       FROM students s ORDER BY s.created_at DESC LIMIT 10`).all(),
    byCompany: q(`SELECT COALESCE(s.company,'') company, COUNT(DISTINCT s.id) students,
       (SELECT COALESCE(SUM(p.watch_time),0) FROM progress p JOIN students s2 ON s2.id=p.student_id WHERE COALESCE(s2.company,'')=COALESCE(s.company,'')) watch_time
       FROM students s GROUP BY COALESCE(s.company,'') ORDER BY students DESC`).all(),
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

// ---------- YouTube classes ----------
// The admin pastes a YouTube link. The video ID is kept on the server and only sent to the player
// scrambled per session (the same way as the HLS key), so it isn't sitting readable in the page or API responses.
function parseYouTubeId(u) {
  const s = String(u || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/i);
  return m ? m[1] : null;
}
app.post('/api/admin/videos/youtube', requireAdmin, async (req, res) => {
  const yt = parseYouTubeId(req.body.url);
  if (!yt) return res.status(400).json({ error: 'সঠিক YouTube লিংক দিন (যেমন: https://youtu.be/xxxxxxxxxxx)' });
  const cls = q('SELECT id FROM classes WHERE id=?').get(req.body.class_id);
  if (!cls) return res.status(400).json({ error: 'ক্লাস সিলেক্ট করুন' });
  const title = String(req.body.title || '').trim().slice(0, 150);
  if (!title) return res.status(400).json({ error: 'ভিডিওর নাম দিন' });
  const mins = Number(req.body.minutes) || 0; // optional; otherwise the first viewer's player reports it
  const r = q(`INSERT INTO videos(class_id,title,description,status,created_at,share_token,source,yt_id,duration) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(cls.id, title, String(req.body.description || '').slice(0, 2000), 'ready', now(), newShareToken(), 'youtube', yt, Math.max(0, Math.round(mins * 60)));
  const id = Number(r.lastInsertRowid);
  // thumbnail is fetched by the server and served from here, so the YouTube ID never shows up in an <img> URL
  try {
    const t = await fetch(`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`, { signal: AbortSignal.timeout(8000) });
    if (t.ok) { fs.mkdirSync(vdir(id), { recursive: true }); fs.writeFileSync(path.join(vdir(id), 'thumb.jpg'), Buffer.from(await t.arrayBuffer())); }
  } catch { /* no thumbnail is fine */ }
  res.json({ id });
});
app.patch('/api/admin/videos/:id/youtube', requireAdmin, (req, res) => {
  const yt = parseYouTubeId(req.body.url);
  if (!yt) return res.status(400).json({ error: 'সঠিক YouTube লিংক দিন' });
  q("UPDATE videos SET yt_id=? WHERE id=? AND source='youtube'").run(yt, req.params.id); res.json({ ok: true });
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
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-maxrate', '1500k', '-bufsize', '3000k', '-vf', 'scale=-2:min(720\\,ih)', '-pix_fmt', 'yuv420p',
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
  const entries = q(`SELECT f.*, v.title video FROM form_entries f LEFT JOIN videos v ON v.id=f.video_id WHERE f.student_id=? ORDER BY f.at DESC LIMIT 100`).all(s.id);
  res.json({ student: s, progress, sessions, access, entries });
});
app.patch('/api/admin/students/:id', requireAdmin, (req, res) => {
  if ('company' in req.body) {
    if (req.body.company && !COMPANIES.includes(req.body.company)) return res.status(400).json({ error: 'কোম্পানি সঠিক নয়' });
    q('UPDATE students SET company=? WHERE id=?').run(req.body.company || null, req.params.id);
  }
  if ('blocked' in req.body) q('UPDATE students SET blocked=? WHERE id=?').run(req.body.blocked ? 1 : 0, req.params.id);
  res.json({ ok: true });
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
  res.json(q(`SELECT a.*, s.name, s.email, s.phone, s.company FROM access a JOIN students s ON s.id=a.student_id
      WHERE a.video_id=? ORDER BY a.granted_at DESC`).all(req.params.id));
});
// give a student access to a video: existing student by id, or a new/existing one by name+email+phone
app.post('/api/admin/access', requireAdmin, (req, res) => {
  const vid = Number(req.body.video_id);
  if (!q('SELECT 1 FROM videos WHERE id=?').get(vid)) return res.status(404).json({ error: 'ভিডিও পাওয়া যায়নি' });
  let sid = Number(req.body.student_id) || null;
  if (!sid) {
    const chk = checkSignup(req.body);
    if (chk.error) return res.status(400).json({ error: chk.error });
    const { name, email, phone, company } = chk;
    if (!allowRow(phone)) q("INSERT INTO allowlist(phone,name,company,email,source,added_at) VALUES(?,?,?,?,'admin',?)").run(phone, name, company, email, now());
    const byPhone = findByPhone(phone); // the number is the identity
    if (byPhone) sid = byPhone.id;
    else {
      sid = Number(q('INSERT INTO students(name,email,phone,company,created_at) VALUES(?,?,?,?,?)').run(name, email, phone, company, now()).lastInsertRowid);
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
  const rows = q(`SELECT p.*, (SELECT COUNT(*) FROM sessions se WHERE se.student_id=p.student_id AND se.video_id=p.video_id AND se.watch_time>=5) views, s.name, s.email, s.phone, s.company,
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
// ---------- Leaderboard (admin only — students never see it) ----------
// Points = 1 per minute of NEW video watched (rewatching the same part doesn't add) + 20 for every video finished.
// So nobody can climb by leaving a video looping; only real progress counts.
const PTS_FINISH = 20;
function leaderboard({ company = '', video = 0 } = {}) {
  const where = ['s.blocked=0'], args = [];
  if (company === '__none') where.push('s.company IS NULL'); else if (company) { where.push('s.company=?'); args.push(company); }
  const rows = q(`SELECT s.id, s.name, s.company, COUNT(p.video_id) started, COALESCE(SUM(p.completed),0) finished,
      COALESCE(AVG(p.percent),0) avg_percent, COALESCE(SUM(p.unique_seconds),0) unique_seconds, COALESCE(SUM(p.watch_time),0) watch_time,
      MAX(p.last_watched) last_watched,
      ROUND(COALESCE(SUM(p.unique_seconds),0)/60.0 + ${PTS_FINISH}*COALESCE(SUM(p.completed),0)) points
      FROM students s JOIN progress p ON p.student_id=s.id ${video ? 'AND p.video_id=?' : ''}
      WHERE ${where.join(' AND ')} GROUP BY s.id HAVING started>0
      ORDER BY points DESC, finished DESC, unique_seconds DESC, last_watched ASC`).all(...(video ? [video] : []), ...args);
  let rank = 0, prev = null;
  rows.forEach((r, i) => { if (r.points !== prev) { rank = i + 1; prev = r.points; } r.rank = rank; });
  return rows;
}
function companyBoard(video = 0) {
  const by = {};
  for (const r of leaderboard({ video })) {
    const k = r.company || ''; const c = by[k] = by[k] || { company: k, students: 0, points: 0, finished: 0, unique_seconds: 0, pct: 0 };
    c.students++; c.points += r.points; c.finished += r.finished; c.unique_seconds += r.unique_seconds; c.pct += r.avg_percent;
  }
  return Object.values(by).map(c => ({ ...c, avg_points: c.points / c.students, avg_percent: c.pct / c.students }))
    .sort((a, b) => b.avg_points - a.avg_points);
}
app.get('/api/admin/leaderboard/summary', requireAdmin, (req, res) => {
  const pick = (r) => ({ id: r.id, rank: r.rank, name: r.name, company: r.company, points: r.points, finished: r.finished, avg_percent: r.avg_percent, watch_time: r.watch_time });
  const videos = q(`SELECT v.id, v.title, v.source, c.name class_name FROM videos v JOIN classes c ON c.id=v.class_id WHERE v.status='ready' ORDER BY c.sort, v.id`).all()
    .map(v => { const rows = leaderboard({ video: v.id }); return { ...v, viewers: rows.length, top: rows.slice(0, 3).map(pick) }; });
  const companies = [...COMPANIES, '__none'].map(c => { const rows = leaderboard({ company: c }); return { company: c === '__none' ? '' : c, students: rows.length, top: rows.slice(0, 5).map(pick) }; })
    .filter(c => c.company || c.students);
  res.json({ videos, companies, board: companyBoard() });
});
app.get('/api/admin/leaderboard', requireAdmin, (req, res) => {
  const video = Number(req.query.video) || 0;
  res.json({ rows: leaderboard({ company: String(req.query.company || ''), video }), companies: companyBoard(video), ptsFinish: PTS_FINISH });
});
// ---------- Officer allowlist (admin) ----------
const fixPhone = (x) => { let d = bnDigits(x).replace(/\D/g, ''); if (d.startsWith('880')) d = d.slice(2); if (/^1[3-9]\d{8}$/.test(d)) d = '0' + d; return /^01[3-9]\d{8}$/.test(d) ? d : null; };
const fixCompany = (c) => { c = String(c || '').trim().replace(/\s+/g, ' '); return COMPANIES.find(x => x.toLowerCase() === c.toLowerCase()) || c; };
const goodEmail = (e) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i.test(e);
// Rows pasted from Excel/Sheets: name, company, designation, phone, email, alt phone (tab-separated; commas also work).
// Repeated phones are merged (a later row fills in or corrects fields; a valid email beats a broken one).
function parseOfficers(text) {
  const out = new Map(), bad = []; let rows = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue; rows++;
    const c = (line.includes('\t') ? line.split('\t') : line.split(/\s*,\s*/)).map(x => x.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim());
    const phone = fixPhone(c[3]);
    if (!phone) { if (!/name|নাম/i.test(c[0] || '') || rows > 1) bad.push(line.trim().slice(0, 120)); continue; }
    const email = String(c[4] || '').replace(/\s+/g, '').toLowerCase();
    const r = { phone, name: c[0].replace(/\s+/g, ' '), company: fixCompany(c[1]), designation: (c[2] || '').replace(/\s+/g, ' '), email, alt_phone: fixPhone(c[5]) || '' };
    const old = out.get(phone);
    if (!old) { out.set(phone, r); continue; }
    for (const k of ['name', 'company', 'designation', 'alt_phone']) if (r[k]) old[k] = r[k];
    if (email && (goodEmail(email) || !goodEmail(old.email))) old.email = email;
    old.dup = (old.dup || 0) + 1;
  }
  return { list: [...out.values()], rows, bad };
}
app.get('/api/admin/allowlist', requireAdmin, (req, res) => {
  res.json({
    enabled: getSetting('allowlist_enabled', '1') === '1', enforced: allowEnforced(), notice: loginNotice(), companies: COMPANIES,
    rows: q(`SELECT a.*, s.id student_id, s.last_seen FROM allowlist a LEFT JOIN students s ON s.phone=a.phone ORDER BY a.company, a.name`).all(),
    // people who tried to log in with a number that isn't on the list (to add them on request)
    rejected: q(`SELECT phone, MAX(at) at, COUNT(*) tries FROM otp_log WHERE error='not_on_list' AND phone NOT IN (SELECT phone FROM allowlist)
      GROUP BY phone ORDER BY at DESC LIMIT 50`).all(),
  });
});
app.post('/api/admin/allowlist/import', requireAdmin, (req, res) => {
  const { list, rows, bad } = parseOfficers(req.body.text);
  if (!list.length) return res.status(400).json({ error: 'কোনো সঠিক নম্বর পাওয়া যায়নি। Excel থেকে কলামগুলো (নাম, কোম্পানি, পদবি, ফোন, ইমেইল, বিকল্প ফোন) কপি করে পেস্ট করুন।', bad });
  let added = 0, updated = 0;
  db.exec('BEGIN');
  try {
    for (const r of list) {
      const ex = q('SELECT phone FROM allowlist WHERE phone=?').get(r.phone);
      if (ex) { q('UPDATE allowlist SET name=?, company=?, designation=?, email=?, alt_phone=? WHERE phone=?').run(r.name, r.company, r.designation, r.email, r.alt_phone, r.phone); updated++; }
      else { q("INSERT INTO allowlist(phone,name,company,designation,email,alt_phone,source,added_at) VALUES(?,?,?,?,?,?,'import',?)").run(r.phone, r.name, r.company, r.designation, r.email, r.alt_phone, now()); added++; }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json({ ok: true, rows, unique: list.length, added, updated, merged: rows - list.length - bad.length, bad,
    unknownCompany: [...new Set(list.map(r => r.company).filter(c => c && !COMPANIES.includes(c)))] });
});
app.post('/api/admin/allowlist', requireAdmin, (req, res) => {
  const phone = fixPhone(req.body.phone);
  if (!phone) return res.status(400).json({ error: 'সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)' });
  const name = String(req.body.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'নাম দিন' });
  const r = { name, company: fixCompany(req.body.company), designation: String(req.body.designation || '').trim().slice(0, 80), email: normEmail(req.body.email), alt_phone: fixPhone(req.body.alt_phone) || '' };
  q(`INSERT INTO allowlist(phone,name,company,designation,email,alt_phone,source,added_at) VALUES(?,?,?,?,?,?,'admin',?)
     ON CONFLICT(phone) DO UPDATE SET name=excluded.name, company=excluded.company, designation=excluded.designation, email=excluded.email, alt_phone=excluded.alt_phone`)
    .run(phone, r.name, r.company, r.designation, r.email, r.alt_phone, now());
  res.json({ ok: true, phone });
});
app.delete('/api/admin/allowlist/:phone', requireAdmin, (req, res) => {
  q('DELETE FROM allowlist WHERE phone=?').run(String(req.params.phone)); res.json({ ok: true });
});
app.post('/api/admin/allowlist/settings', requireAdmin, (req, res) => {
  if ('enabled' in req.body) setSetting('allowlist_enabled', req.body.enabled ? '1' : '0');
  if ('notice' in req.body) setSetting('login_notice', String(req.body.notice || '').trim().slice(0, 1000));
  res.json({ ok: true });
});

// ---------- SMS / OTP settings (admin) ----------
app.get('/api/admin/sms', requireAdmin, (req, res) => {
  const c = smsCfg(), k = c.api_key || '';
  res.json({ provider: c.provider, providers: PROVIDERS, sender_id: c.sender_id, custom_url: c.custom_url, message: c.message,
    api_key_set: !!k, api_key_hint: k ? '••••' + k.slice(-4) : '', login_notice: loginNotice(), allow_enforced: allowEnforced(), allow_count: allowCount(),
    log: q(`SELECT l.phone, l.at, l.ok, l.provider, l.error, l.test_code, s.name FROM otp_log l LEFT JOIN students s ON s.phone=l.phone ORDER BY l.id DESC LIMIT 50`).all() });
});
app.post('/api/admin/sms', requireAdmin, (req, res) => {
  const b = req.body;
  if (b.provider !== undefined) { if (!PROVIDERS.includes(b.provider)) return res.status(400).json({ error: 'কোম্পানি সঠিক নয়' }); setSetting('sms_provider', b.provider); }
  if (b.api_key) setSetting('sms_api_key', String(b.api_key).trim());   // blank = keep the old key
  if (b.sender_id !== undefined) setSetting('sms_sender_id', String(b.sender_id).trim().slice(0, 30));
  if (b.custom_url !== undefined) setSetting('sms_custom_url', String(b.custom_url).trim().slice(0, 500));
  if (b.login_notice !== undefined) setSetting('login_notice', String(b.login_notice).trim().slice(0, 1000));
  if (b.message !== undefined) {
    const m = String(b.message).trim().slice(0, 300);
    if (!m.includes('{code}')) return res.status(400).json({ error: 'মেসেজে {code} থাকতে হবে, সেখানেই কোড বসবে' });
    setSetting('sms_message', m);
  }
  res.json({ ok: true });
});
app.post('/api/admin/sms/test', requireAdmin, async (req, res) => {
  const chk = checkPhone(req.body.phone); if (chk.error) return res.status(400).json({ error: chk.error });
  const c = smsCfg(); const r = await sendSms(c, chk.phone, c.message.replace('{code}', '123456') + ' (test)');
  q('INSERT INTO otp_log(phone,at,ok,provider,error,test_code,ip) VALUES(?,?,?,?,?,?,?)').run(chk.phone, now(), r.ok ? 1 : 0, c.provider, r.error || null, r.test ? 'টেস্ট' : null, req.ip);
  res.status(r.ok ? 200 : 502).json(r.ok ? { ok: true, test: !!r.test } : { error: r.error });
});

app.get('/api/admin/students.csv', requireAdmin, (req, res) => {
  const rows = q(`SELECT s.name, s.email, s.phone, s.company, datetime(s.created_at/1000,'unixepoch','+6 hours') joined,
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
  const cols = ['name', 'company', 'email', 'phone', 'joined', 'last_seen', 'logins', 'videos_allowed', 'videos_started', 'videos_finished', 'watch_seconds', 'sessions', 'last_device', 'last_ip', 'status'];
  const esc = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="students.csv"' });
  res.send('\ufeff' + [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n'));
});
app.get('/api/admin/form-entries.csv', requireAdmin, (req, res) => {
  const rows = q(`SELECT datetime(f.at/1000,'unixepoch','+6 hours') time, f.name, f.company, f.email, f.phone, f.via, v.title video,
      f.matched, s.name profile_name, f.ip FROM form_entries f LEFT JOIN videos v ON v.id=f.video_id LEFT JOIN students s ON s.id=f.student_id
      ORDER BY f.at DESC`).all();
  const cols = ['time', 'name', 'company', 'email', 'phone', 'via', 'video', 'matched', 'profile_name', 'ip'];
  const esc = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="form-entries.csv"' });
  res.send('\ufeff' + [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n'));
});
app.get('/api/admin/export.csv', requireAdmin, (req, res) => {
  const rows = q(`SELECT s.name, s.email, s.phone, s.company, c.name class, v.title video, ROUND(p.percent,1) percent,
      ROUND(p.unique_seconds) unique_seconds, ROUND(p.watch_time) watch_seconds, p.completed, p.full_views times_finished, ROUND(MAX(p.media_seconds - p.unique_seconds,0)) rewatch_seconds,
      (SELECT COUNT(*) FROM sessions se WHERE se.student_id=p.student_id AND se.video_id=p.video_id AND se.watch_time>=5) views,
      datetime(p.first_watched/1000,'unixepoch') first_watched, datetime(p.last_watched/1000,'unixepoch') last_watched
      FROM progress p JOIN students s ON s.id=p.student_id JOIN videos v ON v.id=p.video_id JOIN classes c ON c.id=v.class_id
      ORDER BY s.name, c.sort, v.id`).all();
  const cols = ['name', 'company', 'email', 'phone', 'class', 'video', 'percent', 'unique_seconds', 'watch_seconds', 'completed', 'views', 'times_finished', 'rewatch_seconds', 'first_watched', 'last_watched'];
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
