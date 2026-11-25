// Questions and quiz under the video on the watch page. watch.js fires `cv:video` once the video is open
// and `cv:ended` when it finishes (so the quiz can unlock).
(() => {
  const box = document.getElementById('extras'); if (!box) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bn = (n) => String(n).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]);
  const ago = (ms) => { const s = (Date.now() - ms) / 1000; if (s < 60) return 'এইমাত্র'; if (s < 3600) return bn(Math.floor(s / 60)) + ' মিনিট আগে';
    if (s < 86400) return bn(Math.floor(s / 3600)) + ' ঘণ্টা আগে'; return bn(Math.floor(s / 86400)) + ' দিন আগে'; };
  const secs = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? bn(s) + ' সেকেন্ড' : bn(Math.floor(s / 60)) + ' মিনিট ' + bn(s % 60) + ' সেকেন্ড'; };
  async function call(url, body) {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'সমস্যা হয়েছে, আবার চেষ্টা করুন');
    return j;
  }
  let vid = 0;
  box.innerHTML = '<div id="quizBox"></div><div id="qaBox"></div>';
  const $ = (s) => box.querySelector(s);

  // ---------------- quiz ----------------
  async function loadQuiz(scroll) {
    if ($('#qzF')) return; // already answering, don't wipe their picks
    let d; try { d = await call(`/api/videos/${vid}/quiz`); } catch { return; }
    const el = $('#quizBox');
    if (!d.count) { el.innerHTML = ''; return; }
    const head = `<h3>📝 কুইজ <span class="pill">${bn(d.count)}টি প্রশ্ন</span></h3>`;
    if (d.locked) {
      el.innerHTML = `<section class="card xbox">${head}<div class="xlock">🔒 ভিডিওটি পুরো দেখা শেষ হলে এখানে কুইজ খুলবে।<div style="font-size:13px;margin-top:4px">এখন পর্যন্ত দেখেছেন ${bn(Math.round(d.percent || 0))}%</div></div></section>`;
      return;
    }
    if (d.done) { showResult(el, head, d); if (scroll) el.scrollIntoView({ behavior: 'smooth' }); return; }
    el.innerHTML = `<section class="card xbox">${head}
      <div class="muted" style="font-size:13.5px;margin-bottom:12px">প্রতিটি প্রশ্নের একটি উত্তর বেছে নিন। একবারই জমা দেওয়া যাবে, তাই দেখে শুনে দিন।</div>
      <form id="qzF">${d.items.map((it, n) => `<div class="qz-q"><div class="t">${bn(n + 1)}. ${esc(it.q)}</div>
        ${it.options.map((o, i) => `<label class="qz-o"><input type="radio" name="q${it.id}" value="${i}" required> <span>${esc(o)}</span></label>`).join('')}</div>`).join('')}
      <div class="err" id="qzErr"></div><button class="btn" id="qzBtn">জমা দিন</button></form></section>`;
    $('#qzF').onsubmit = async (e) => {
      e.preventDefault(); const b = $('#qzBtn'); b.disabled = true; $('#qzErr').textContent = '';
      const answers = {}; d.items.forEach(it => { const c = $(`input[name="q${it.id}"]:checked`); if (c) answers[it.id] = Number(c.value); });
      try { const r = await call(`/api/videos/${vid}/quiz`, { answers }); showResult(el, head, r); el.scrollIntoView({ behavior: 'smooth' }); }
      catch (er) { $('#qzErr').textContent = er.message; b.disabled = false; }
    };
    if (scroll) el.scrollIntoView({ behavior: 'smooth' });
  }
  function showResult(el, head, d) {
    const p = d.total ? Math.round(100 * d.score / d.total) : 0;
    el.innerHTML = `<section class="card xbox">${head}
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:14px">
        <div class="qz-score">${bn(d.score)} / ${bn(d.total)}</div>
        <div><b>${p >= 80 ? '🎉 দারুণ!' : p >= 50 ? '👍 ভালো হয়েছে' : '📖 আরেকবার ভিডিওটা দেখে নিন'}</b><div class="muted" style="font-size:13px">${bn(p)}% সঠিক${d.time_ms ? ' · সময় লেগেছে ' + secs(d.time_ms) : ''}</div></div>
      </div>
      ${d.review.map((r, n) => `<div class="qz-q"><div class="t">${bn(n + 1)}. ${esc(r.q)} ${r.ok ? '✅' : '❌'}</div>
        ${r.options.map((o, i) => `<div class="qz-o ${i === r.correct ? 'ok' : i === r.pick ? 'bad' : ''}" style="cursor:default">${i === r.correct ? '✔' : i === r.pick ? '✘' : '•'} <span>${esc(o)}</span></div>`).join('')}</div>`).join('')}
    </section>`;
  }

  // ---------------- questions ----------------
  async function loadQA() {
    let d; try { d = await call(`/api/videos/${vid}/questions`); } catch { return; }
    const el = $('#qaBox');
    if (!d.enabled) { el.innerHTML = ''; return; }
    if (!el.innerHTML) {
      el.innerHTML = `<section class="card xbox"><h3>❓ প্রশ্ন ও উত্তর</h3>
        <form id="qaF"><textarea class="input" name="body" maxlength="1000" placeholder="এই ভিডিও নিয়ে কিছু বুঝতে না পারলে এখানে প্রশ্ন লিখুন…" required></textarea>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap">
            <span class="muted" style="font-size:12.5px">উত্তর দেওয়া হলে এখানেই দেখতে পাবেন।</span><button class="btn" id="qaBtn">প্রশ্ন পাঠান</button></div>
          <div class="err" id="qaErr"></div></form><div id="qaList"></div></section>`;
      $('#qaF').onsubmit = async (e) => {
        e.preventDefault(); const b = $('#qaBtn'); b.disabled = true; $('#qaErr').textContent = '';
        try { await call(`/api/videos/${vid}/questions`, { body: e.target.body.value }); e.target.reset(); await loadQA(); }
        catch (er) { $('#qaErr').textContent = er.message; }
        b.disabled = false;
      };
    }
    $('#qaList').innerHTML = d.items.map(x => `<div class="qa-item">
      <div class="who">${x.mine ? '🙋 আপনার প্রশ্ন' : esc(x.name)}${x.company && !x.mine ? ' · ' + esc(x.company) : ''} · ${ago(x.created_at)} ${x.answer ? '' : '<span class="pill warn">উত্তরের অপেক্ষায়</span>'}</div>
      <div class="body">${esc(x.body)}</div>
      ${x.answer ? `<div class="qa-ans"><b>উত্তর:</b> ${esc(x.answer)}</div>` : ''}</div>`).join('')
      || '<div class="muted" style="font-size:13.5px;padding-top:6px">এখনো কোনো প্রশ্নের উত্তর নেই। প্রথম প্রশ্নটা আপনিই করুন।</div>';
  }

  window.addEventListener('cv:video', (e) => { vid = e.detail.id; loadQuiz(); loadQA(); setInterval(() => { if (!document.hidden) loadQA(); }, 60000); });
  // the server marks the video finished from the last progress report, so give it a moment and retry once
  window.addEventListener('cv:ended', () => { if (!vid) return; loadQuiz(true); setTimeout(() => loadQuiz(), 4000); });
})();
