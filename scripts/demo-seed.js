// Seeds demo students + realistic viewing activity through the public API (for preview only).
const BASE = process.env.BASE || 'http://localhost:3000';
const people = [
  ['সাকিব হাসান', 'sakib@example.com', '01811223344'], ['নুসরাত জাহান', 'nusrat@example.com', '01922334455'],
  ['তানভীর রহমান', 'tanvir@example.com', '01633445566'], ['মীম আক্তার', 'mim@example.com', '01544556677'],
  ['আরিফ হোসেন', 'arif@example.com', '01355667788'], ['ফারিয়া ইসলাম', 'faria@example.com', '01766778899'],
];
const uas = ['Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'];
async function call(path, body, cookie, ua) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: cookie || '', 'user-agent': ua }, body: JSON.stringify(body) });
  return { r, j: await r.json(), set: r.headers.get('set-cookie') };
}
(async () => {
  for (const [i, [name, email, phone]] of people.entries()) {
    const ua = uas[i % 3];
    const { set } = await call('/api/login', { name, email, phone }, '', ua);
    const cookie = set.split(';')[0];
    const plan = [1, 2, 3, 4, 5].filter(() => Math.random() > 0.3);
    if (Math.random() < 0.7 && plan.length) plan.push(plan[0]); // some students rewatch a video
    if (Math.random() < 0.4 && plan.length > 1) plan.push(plan[1]);
    for (const vid of plan) {
      const { j } = await call('/api/track/start', { videoId: vid, screen: i % 2 ? '1920x1080' : '412x915' }, cookie, ua);
      const D = j.video.duration, target = Math.random() < 0.45 ? D : D * (0.2 + Math.random() * 0.7);
      const ev = []; let pos = 0, t = Date.now() - 3600e3 * (i + vid);
      ev.push({ type: 'session_start', pos: 0, at: t, d: { startPos: 0 } }, { type: 'play', pos: 0, at: t });
      while (pos < target) {
        const step = Math.min(5, target - pos); ev.push({ type: 'tick', pos: pos + step, at: t, d: { from: pos, to: pos + step, wall: step } });
        pos += step; t += step * 1000;
        if (Math.random() < 0.06) { ev.push({ type: 'pause', pos, at: t, d: { reason: 'user' } }); const p = 3 + Math.random() * 40; t += p * 1000; ev.push({ type: 'resume', pos, at: t, d: { paused: +p.toFixed(1) } }); }
        if (Math.random() < 0.03) { ev.push({ type: 'tab_hidden', pos, at: t, d: {} }, { type: 'pause', pos, at: t, d: { reason: 'tab_hidden' } }); t += 8000; ev.push({ type: 'tab_visible', pos, at: t, d: {} }, { type: 'resume', pos, at: t, d: { paused: 8 } }); }
        if (Math.random() < 0.04 && pos > 20) { const to = pos - 15; ev.push({ type: 'seek', pos: to, at: t, d: { from: pos, to, dir: 'back' } }); pos = to; }
        if (Math.random() < 0.025) { const to = Math.min(D, pos + 10); ev.push({ type: 'seek', pos: to, at: t, d: { from: pos, to, dir: 'forward' } }); pos = to; }
        if (Math.random() < 0.01) ev.push({ type: 'ratechange', pos, at: t, d: { rate: 1.5 } });
      }
      if (i === 4 && vid === 1) ev.push({ type: 'context_menu', pos, at: t }, { type: 'printscreen', pos, at: t }, { type: 'blocked_key', pos, at: t, d: { key: 'Ctrl+S' } });
      if (pos >= D - 0.5) ev.push({ type: 'ended', pos: D, at: t });
      for (let k = 0; k < ev.length; k += 250) await call('/api/track/events', { sessionId: j.sessionId, events: ev.slice(k, k + 250) }, cookie, ua);
    }
  }
  console.log('seeded');
})();
