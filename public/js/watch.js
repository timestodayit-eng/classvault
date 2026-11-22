(() => {
  const $ = (s) => document.getElementById(s);
  const v = $('v'), player = $('player');
  const fmt = (s) => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  let videoId = Number(new URLSearchParams(location.search).get('v'));
  const shareToken = location.pathname.startsWith('/v/') ? decodeURIComponent(location.pathname.split('/')[2] || '') : null;
  let sessionId = null, duration = 0, wmInfo = null, hls = null, killed = false;

  // ---------------- event queue ----------------
  const queue = [];
  const log = (type, d) => queue.push({ type, pos: +(v.currentTime || 0).toFixed(2), at: Date.now(), d: d || {} });
  function flush(useBeacon) {
    closeSegment(true);
    if (!sessionId || !queue.length) return;
    const body = JSON.stringify({ sessionId, events: queue.splice(0, queue.length) });
    if (useBeacon && navigator.sendBeacon) navigator.sendBeacon('/api/track/events', new Blob([body], { type: 'text/plain' }));
    else fetch('/api/track/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
      .then(r => { if (r.status === 401) location.href = '/'; }).catch(() => {});
  }
  setInterval(() => flush(false), 5000);
  window.addEventListener('pagehide', () => { log('leave_page'); flush(true); });

  // ---------------- watched-range tracking ----------------
  // A "segment" is continuous playback. It's sent as a tick {from,to,wall} so the server can compute unique seconds watched.
  let seg = null, sessWatch = 0, lastPos = 0;
  function closeSegment(keepOpen) {
    if (!seg) return;
    if (seg.to > seg.from || seg.wall > 0) queue.push({ type: 'tick', pos: seg.to, at: Date.now(), d: { from: +seg.from.toFixed(2), to: +seg.to.toFixed(2), wall: +Math.max(seg.wall, (seg.to - seg.from) / (v.playbackRate || 1)).toFixed(2) } });
    seg = keepOpen && !v.paused ? { from: seg.to, to: seg.to, wall: 0, t: Date.now() } : null;
  }
  setInterval(() => {
    if (v.paused || v.seeking || v.readyState < 3) { if (seg) seg.t = Date.now(); return; }
    const t = Date.now(), pos = v.currentTime;
    if (!seg) { seg = { from: pos, to: pos, wall: 0, t }; return; }
    const dt = (t - seg.t) / 1000; seg.t = t;
    if (pos >= seg.to && pos - seg.to <= dt * v.playbackRate + 1.5) { seg.to = pos; seg.wall += dt; sessWatch += dt; }
    else { closeSegment(false); seg = { from: pos, to: pos, wall: 0, t }; }
    $('sessWatch').textContent = fmt(sessWatch);
  }, 1000);

  // ---------------- start ----------------
  // ---------------- share link: ask name/email/phone, then unlock this one video ----------------
  async function openShare() {
    const r = await fetch('/api/share/' + encodeURIComponent(shareToken));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { $('title').textContent = 'লিংকটি কাজ করছে না'; $('big').style.display = 'none'; showOv('🔗', j.error || 'লিংকটি সঠিক নয়।'); return false; }
    $('title').textContent = j.video.title; document.title = j.video.title + ' | ক্লাসভল্ট';
    const claim = async () => {
      const c = await fetch('/api/share/' + encodeURIComponent(shareToken) + '/claim', { method: 'POST' });
      if (!c.ok) { showOv('🔗', 'লিংকটি কাজ করছে না।'); return false; }
      videoId = (await c.json()).videoId; return true;
    };
    if (j.me) { $('gate').classList.remove('show'); return claim(); }
    $('big').style.display = 'none';
    $('gateTitle').textContent = j.video.title;
    $('gate').classList.add('show');
    return new Promise((resolve) => {
      $('gateForm').onsubmit = async (e) => {
        e.preventDefault(); $('gateErr').textContent = '';
        const body = Object.fromEntries(new FormData(e.target));
        const l = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const lj = await l.json().catch(() => ({}));
        if (!l.ok) { $('gateErr').textContent = lj.error || 'সমস্যা হয়েছে'; return; }
        $('gate').classList.remove('show'); $('big').style.display = '';
        resolve(claim());
      };
    });
  }

  async function start() {
    if (shareToken && !(await openShare())) return;
    const r = await fetch('/api/track/start', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, screen: `${screen.width}x${screen.height}`, native: !(window.Hls && Hls.isSupported()) && !!v.canPlayType('application/vnd.apple.mpegurl') }) });
    if (r.status === 401) return (location.href = '/');
    if (r.status === 403 && (await r.clone().json().catch(() => ({}))).error === 'noaccess') {
      $('title').textContent = 'এই ভিডিও দেখার অনুমতি নেই'; $('big').style.display = 'none';
      showOv('🔒', 'এই ভিডিওটি আপনাকে শেয়ার করা হয়নি। যিনি ভিডিও দেন, তার কাছ থেকে লিংক নিন।'); return;
    }
    if (r.status === 403) {
      const chrome = /Android/i.test(navigator.userAgent) ? `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=https;package=com.android.chrome;end` : null;
      $('title').textContent = 'এই অ্যাপে ভিডিও চলবে না';
      showOv('🚫', 'নিরাপত্তার কারণে ডাউনলোডার অ্যাপ বা অ্যাপের ভেতরের ব্রাউজারে (Facebook/Messenger সহ) ভিডিও চলে না। Chrome বা Safari তে লিংকটি খুলুন।',
        chrome ? 'Chrome এ খুলুন' : 'লিংক কপি করুন', () => { if (chrome) location.href = chrome; else navigator.clipboard.writeText(location.href).then(() => toast('লিংক কপি হয়েছে')); });
      $('big').style.display = 'none'; return;
    }
    if (!r.ok) { $('title').textContent = 'ভিডিও পাওয়া যায়নি'; return; }
    const j = await r.json();
    sessionId = j.sessionId; duration = j.video.duration; wmInfo = j.watermark;
    document.title = j.video.title + ' | ক্লাসভল্ট';
    $('title').textContent = j.video.title; $('desc').textContent = j.video.description || '';
    buildWatermark();
    if (window.Hls && Hls.isSupported()) {
      // The server sends the decryption key masked; only this loader knows how to unmask it.
      const pad = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cv' + sessionId)));
      const mk = Uint8Array.from(atob(j.cfg.t), (c, i) => c.charCodeAt(0) ^ pad[i]);
      const Base = Hls.DefaultConfig.loader;
      class L extends Base {
        load(ctx, cfg, cb) {
          if (ctx.type === 'key') {
            const ok = cb.onSuccess;
            cb = Object.assign({}, cb, { onSuccess: (r, st, c, n) => { const d = new Uint8Array(r.data); r.data = d.map((b, i) => b ^ mk[i]).buffer; ok(r, st, c, n); } });
          }
          super.load(ctx, cfg, cb);
        }
      }
      hls = new Hls({ loader: L, maxBufferLength: 30, maxMaxBufferLength: 40, startPosition: j.startPos || -1 });
      hls.loadSource(j.src); hls.attachMedia(v);
      hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal && !killed) { log('error', { kind: d.type, detail: d.details }); showOv('⚠️', 'ভিডিও লোড করতে সমস্যা হচ্ছে। পেজটি রিফ্রেশ করুন।', 'রিফ্রেশ', () => location.reload()); } });
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = j.src;
      if (j.startPos) v.addEventListener('loadedmetadata', () => { v.currentTime = j.startPos; }, { once: true });
    } else { showOv('⚠️', 'এই ব্রাউজারে ভিডিও চলবে না। Chrome বা Safari ব্যবহার করুন।'); return; }
    log('session_start', { startPos: j.startPos, ua: navigator.userAgent.slice(0, 120), lang: navigator.language, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
    if (j.startPos) toast(`আগের জায়গা (${fmt(j.startPos)}) থেকে শুরু হবে`);
  }

  // ---------------- watermark ----------------
  function wmText() { return `${wmInfo.name} · ${wmInfo.phone}`; }
  function buildWatermark() {
    const tile = $('wmTile'); tile.innerHTML = '';
    for (let i = 0; i < 40; i++) { const s = document.createElement('span'); s.textContent = wmText(); tile.appendChild(s); }
    moveWm(); setInterval(moveWm, 4000);
  }
  function moveWm() {
    const wm = $('wm');
    if (!wm || !wmInfo) return;
    const d = new Date();
    wm.innerHTML = `${esc(wmText())}<br><span style="font-weight:400;font-size:.85em">${esc(wmInfo.email)} · ${d.toLocaleDateString('en-GB')} ${d.toLocaleTimeString('en-GB')}</span>`;
    wm.style.left = (5 + Math.random() * 55) + '%';
    wm.style.top = (5 + Math.random() * 75) + '%';
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Tamper guard: if the watermark is removed or hidden via devtools, stop playback.
  setInterval(() => {
    const wm = $('wm'), tile = $('wmTile');
    const bad = !wm || !tile || !player.contains(wm) || getComputedStyle(wm).display === 'none' || getComputedStyle(wm).visibility === 'hidden' ||
      parseFloat(getComputedStyle(wm).opacity) < 0.2 || getComputedStyle(tile).display === 'none';
    if (bad && wmInfo && !killed) { log('watermark_tamper'); forcePause('tamper'); killPlayback('⛔', 'ওয়াটারমার্ক সরানোর চেষ্টা ধরা পড়েছে। পেজটি রিফ্রেশ করুন।'); }
  }, 1500);

  // ---------------- controls ----------------
  let hasPlayed = false, pauseReason = null, pauseStart = null, pausePos = 0, seekFrom = null;
  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  $('speedList').innerHTML = speeds.map(s => `<button data-s="${s}" class="${s === 1 ? 'on' : ''}">${s}x</button>`).join('');
  $('speedList').onclick = (e) => { const s = Number(e.target.dataset.s); if (!s) return; v.playbackRate = s; $('speedMenu').classList.remove('open'); };
  $('speedBtn').onclick = (e) => { e.stopPropagation(); $('speedMenu').classList.toggle('open'); };
  document.addEventListener('click', () => $('speedMenu').classList.remove('open'));

  const toggle = () => { if (v.paused) play(); else { pauseReason = 'user'; v.pause(); } };
  function play() { hideOv(); player.classList.remove('blurred'); v.play().catch(() => {}); }
  function forcePause(reason) { if (!v.paused) { pauseReason = reason; v.pause(); } }
  $('pp').onclick = toggle; $('big').onclick = play; $('shield').onclick = toggle;
  $('shield').ondblclick = () => $('fs').click();
  $('back').onclick = () => { v.currentTime = Math.max(0, v.currentTime - 10); };
  $('fwd').onclick = () => { v.currentTime = Math.min(duration, v.currentTime + 10); };
  $('mute').onclick = () => { v.muted = !v.muted; };
  $('vol').oninput = (e) => { v.volume = Number(e.target.value); v.muted = v.volume === 0; };
  $('fs').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else (player.requestFullscreen || player.webkitRequestFullscreen).call(player); // fullscreen the wrapper so the watermark stays visible
  };
  const seekEl = $('seek');
  function seekTo(e) { const r = seekEl.getBoundingClientRect(); const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; v.currentTime = Math.max(0, Math.min(1, x / r.width)) * (v.duration || duration); }
  let dragging = false;
  seekEl.addEventListener('pointerdown', (e) => { dragging = true; seekTo(e); seekEl.setPointerCapture(e.pointerId); });
  seekEl.addEventListener('pointermove', (e) => { if (dragging) seekTo(e); });
  seekEl.addEventListener('pointerup', () => { dragging = false; });
  if (matchMedia('(hover: none)').matches) player.classList.add('touch');

  // ---------------- media events → tracking ----------------
  v.addEventListener('play', () => {
    hasPlayed = true; if (!seg) seg = { from: v.currentTime, to: v.currentTime, wall: 0, t: Date.now() }; // start counting right away
    player.classList.remove('paused'); $('pp').textContent = '❚❚'; $('big').style.display = 'none';
    if (pauseStart) { log('resume', { paused: +((Date.now() - pauseStart) / 1000).toFixed(1), at: +pausePos.toFixed(1) }); pauseStart = null; }
    else log('play');
  });
  v.addEventListener('pause', () => {
    player.classList.add('paused'); $('pp').textContent = '▶';
    closeSegment(false);
    if (v.ended) return;
    pauseStart = Date.now(); pausePos = v.currentTime;
    log('pause', { reason: pauseReason || 'user' }); pauseReason = null;
  });
  v.addEventListener('seeking', () => { if (seekFrom === null) seekFrom = lastPos; closeSegment(false); });
  v.addEventListener('seeked', () => {
    if (hasPlayed && seekFrom !== null && Math.abs(v.currentTime - seekFrom) > 1) log('seek', { from: +seekFrom.toFixed(1), to: +v.currentTime.toFixed(1), dir: v.currentTime > seekFrom ? 'forward' : 'back' });
    seekFrom = null;
  });
  v.addEventListener('ratechange', () => {
    log('ratechange', { rate: v.playbackRate });
    $('speedBtn').textContent = v.playbackRate + 'x';
    $('speedList').querySelectorAll('button').forEach(b => b.classList.toggle('on', Number(b.dataset.s) === v.playbackRate));
  });
  v.addEventListener('volumechange', () => { $('mute').textContent = v.muted || v.volume === 0 ? '🔇' : '🔊'; });
  v.addEventListener('ended', () => { closeSegment(false); log('ended'); flush(false); showOv('🎉', 'ভিডিওটি শেষ হয়েছে!', 'আবার দেখুন', () => { v.currentTime = 0; play(); }); });
  v.addEventListener('waiting', () => log('buffering'));
  v.addEventListener('timeupdate', () => {
    if (!v.seeking) lastPos = v.currentTime;
    const d = v.duration || duration, p = d ? v.currentTime / d * 100 : 0;
    $('fill').style.width = p + '%'; $('knob').style.left = p + '%';
    $('time').textContent = `${fmt(v.currentTime)} / ${fmt(d)}`;
    if (v.buffered.length) $('buf').style.width = (v.buffered.end(v.buffered.length - 1) / d * 100) + '%';
  });
  document.addEventListener('fullscreenchange', () => log(document.fullscreenElement ? 'fullscreen_on' : 'fullscreen_off'));

  // ---------------- anti-piracy deterrents ----------------
  document.addEventListener('contextmenu', (e) => { e.preventDefault(); log('context_menu'); });
  document.addEventListener('dragstart', (e) => e.preventDefault());
  document.addEventListener('selectstart', (e) => { if (!/INPUT|TEXTAREA/.test(e.target.tagName || '')) e.preventDefault(); });
  document.addEventListener('copy', (e) => { e.preventDefault(); log('copy_attempt'); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { log('tab_hidden'); forcePause('tab_hidden'); flush(true); }
    else { log('tab_visible'); if (sessionId) showOv('⏸️', 'অন্য ট্যাবে যাওয়ায় ভিডিও থেমে গেছে।', 'আবার চালান', play); }
  });
  // Losing window focus (e.g. a screenshot / snipping tool or another app taking focus) blurs and pauses the video.
  window.addEventListener('blur', () => {
    if (document.hidden || !sessionId) return;
    log('window_blur'); player.classList.add('blurred'); forcePause('window_blur');
    showOv('🔒', 'উইন্ডো থেকে ফোকাস সরে যাওয়ায় ভিডিও থেমে গেছে।', 'আবার চালান', play);
  });
  window.addEventListener('focus', () => log('window_focus'));
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    const blocked = k === 'f12' || (mod && ['s', 'u', 'p', 'c', 'a', 'o'].includes(k)) || (mod && e.shiftKey && ['i', 'j', 'c', 's', 'k', 'e', 'm'].includes(k)) ||
      (e.metaKey && e.altKey && ['i', 'j', 'c', 'u'].includes(k)) || (e.metaKey && e.shiftKey && ['3', '4', '5', '6'].includes(k)) || (e.ctrlKey && e.altKey && k === 'i');
    if (blocked) { e.preventDefault(); log('blocked_key', { key: (mod ? 'Ctrl+' : '') + (e.shiftKey ? 'Shift+' : '') + e.key }); blurBriefly(); return; }
    if (e.target.tagName === 'INPUT') return;
    if (k === ' ' || k === 'k') { e.preventDefault(); toggle(); }
    else if (k === 'arrowright') v.currentTime = Math.min(duration, v.currentTime + 5);
    else if (k === 'arrowleft') v.currentTime = Math.max(0, v.currentTime - 5);
    else if (k === 'f') $('fs').click();
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'PrintScreen') {
      log('printscreen'); blurBriefly();
      try { navigator.clipboard.writeText('এই ভিডিওর স্ক্রিনশট নেওয়া নিষেধ'); } catch {}
    }
  });
  // Stop playback completely: drop the stream, clear the buffer, require a reload (new session, new key).
  function killPlayback(ic, msg) {
    killed = true; forcePause('devtools'); player.classList.add('blurred');
    try { if (hls) hls.destroy(); } catch {}
    hls = null; v.removeAttribute('src'); v.load(); flush(false);
    showOv(ic, msg, 'রিফ্রেশ করুন', () => location.reload());
  }
  function blurBriefly() { player.classList.add('blurred'); forcePause('blocked_action'); setTimeout(() => player.classList.remove('blurred'), 1500); }
  // DevTools heuristic (desktop only): docked devtools shrink the inner window.
  let devOpen = false;
  setInterval(() => {
    if (matchMedia('(hover: none)').matches) return;
    const open = (window.outerWidth - window.innerWidth > 200) || (window.outerHeight - window.innerHeight > 250);
    if (open && !devOpen && !killed) { log('devtools', { how: 'size' }); killPlayback('🛠️', 'ডেভেলপার টুলস / ইন্সপেক্ট খোলা হয়েছে। ভিডিও বন্ধ করা হলো। এটি বন্ধ করে পেজ রিফ্রেশ করুন।'); }
    devOpen = open;
  }, 1000);
  // Undocked devtools / console: a `debugger` statement only pauses when devtools are open, so a long pause means they're open.
  setInterval(() => {
    const t = performance.now();
    debugger; // eslint-disable-line no-debugger
    if (performance.now() - t > 120 && !killed) { log('devtools', { how: 'debugger' }); killPlayback('🛠️', 'ডেভেলপার টুলস / কনসোল খোলা হয়েছে। ভিডিও বন্ধ করা হলো। এটি বন্ধ করে পেজ রিফ্রেশ করুন।'); }
  }, 1000);

  // ---------------- overlay / toast ----------------
  function showOv(ic, msg, btn, fn) {
    $('ovIc').textContent = ic; $('ovMsg').textContent = msg;
    const b = $('ovBtn'); b.style.display = btn ? '' : 'none'; b.textContent = btn || ''; b.onclick = fn || null;
    $('ov').classList.add('show');
  }
  function hideOv() { $('ov').classList.remove('show'); }
  function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 3500); }

  start();
})();
