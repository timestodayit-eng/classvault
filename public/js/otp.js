// Phone number + OTP login, shared by the home page and the share-link popup.
// otpLogin(box, { via, token, onDone }) renders the steps into `box`.
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const en = (s) => String(s || '').replace(/[০-৯]/g, d => '০১২৩৪৫৬৭৮৯'.indexOf(d));
  const bn = (n) => String(n).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]);
  async function call(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'সমস্যা হয়েছে, আবার চেষ্টা করুন'), j);
    return j;
  }
  window.otpLogin = function (box, opts = {}) {
    let phone = '', timer = null;
    const extra = { via: opts.via || 'login', token: opts.token || '' };
    const q = (s) => box.querySelector(s);
    const busy = (b, on, label) => { b.disabled = on; if (label) b.textContent = label; };

    function stepPhone(prefill = '') {
      clearInterval(timer);
      box.innerHTML = `<form class="otp-f" autocomplete="on">
        <label>মোবাইল নম্বর</label>
        <input class="input" name="phone" type="tel" inputmode="tel" placeholder="01XXXXXXXXX" autocomplete="tel" required value="${esc(prefill)}">
        <div class="err"></div>
        <button class="btn otp-btn">কোড পাঠান →</button>
        <p class="otp-hint">এই নম্বরে একটি ৬ সংখ্যার কোড SMS এ যাবে। আপনার নম্বরই আপনার প্রোফাইল, সবসময় এই নম্বর দিয়েই ঢুকবেন।</p></form>`;
      q('input').focus();
      q('form').onsubmit = async (e) => {
        e.preventDefault(); const b = q('.otp-btn'); q('.err').textContent = ''; busy(b, true, 'পাঠানো হচ্ছে…');
        try { const r = await call('/api/otp/send', { phone: en(q('input').value) }); phone = r.phone; stepCode(r); }
        catch (er) { q('.err').textContent = er.message; busy(b, false, 'কোড পাঠান →'); }
      };
    }
    function stepCode(r) {
      box.innerHTML = `<form class="otp-f" autocomplete="one-time-code">
        <div class="otp-sent">📩 <b>${esc(phone)}</b> নম্বরে কোড পাঠানো হয়েছে <a href="#" class="otp-chg">নম্বর বদলান</a></div>
        <label>৬ সংখ্যার কোড</label>
        <input class="input otp-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" required>
        ${r.test ? '<div class="otp-test">টেস্ট মোড: SMS যায়নি। কোডটি অ্যাডমিন প্যানেলের ⚙️ সেটিংস পেজে দেখুন।</div>' : ''}
        <div class="err"></div>
        <button class="btn otp-btn">যাচাই করুন</button>
        <p class="otp-hint"><span class="otp-again"></span></p></form>`;
      const inp = q('.otp-code'); inp.focus();
      q('.otp-chg').onclick = (e) => { e.preventDefault(); stepPhone(phone); };
      inp.oninput = () => { inp.value = en(inp.value).replace(/\D/g, '').slice(0, 6); if (inp.value.length === 6) q('form').requestSubmit(); };
      let left = r.wait || 60;
      const tick = () => {
        const a = q('.otp-again'); if (!a) return clearInterval(timer);
        if (left > 0) { a.textContent = `কোড পাননি? ${bn(left)} সেকেন্ড পর আবার চাইতে পারবেন।`; left--; }
        else { clearInterval(timer); a.innerHTML = 'কোড পাননি? <a href="#">আবার কোড পাঠান</a>';
          a.querySelector('a').onclick = async (e) => { e.preventDefault(); try { stepCode(await call('/api/otp/send', { phone })); } catch (er) { q('.err').textContent = er.message; } }; }
      };
      clearInterval(timer); tick(); timer = setInterval(tick, 1000);
      q('form').onsubmit = async (e) => {
        e.preventDefault(); const b = q('.otp-btn'); if (b.disabled) return; q('.err').textContent = ''; busy(b, true, 'যাচাই হচ্ছে…');
        try {
          const v = await call('/api/otp/verify', { phone, code: inp.value, ...extra });
          clearInterval(timer);
          if (v.needProfile) stepProfile(v); else opts.onDone && opts.onDone(v.student);
        } catch (er) { q('.err').textContent = er.message; busy(b, false, 'যাচাই করুন'); inp.select(); if (er.expired) inp.value = ''; }
      };
    }
    async function stepProfile(v) {
      const p = v.prefill || {};
      const companies = await fetch('/api/companies').then(r => r.json()).catch(() => []);
      box.innerHTML = `<form class="otp-f">
        <div class="otp-sent">✅ নম্বর যাচাই হয়েছে। প্রথমবার, তাই একবার আপনার তথ্য দিন।</div>
        <label>আপনার নাম</label><input class="input" name="name" placeholder="যেমন: রাফি আহমেদ" autocomplete="name" required value="${esc(p.name)}">
        <label>ইমেইল</label><input class="input" name="email" type="email" placeholder="you@example.com" autocomplete="email" required value="${esc(p.email)}">
        <label>আপনি কোন কোম্পানির?</label><select class="input" name="company" required><option value="">কোম্পানি বেছে নিন</option>
          ${companies.map(c => `<option ${c === p.company ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <div class="err"></div><button class="btn otp-btn">শুরু করুন →</button></form>`;
      q('input').focus();
      q('form').onsubmit = async (e) => {
        e.preventDefault(); const b = q('.otp-btn'); q('.err').textContent = ''; busy(b, true, 'একটু অপেক্ষা…');
        try { const r = await call('/api/otp/profile', { ticket: v.ticket, ...Object.fromEntries(new FormData(e.target)), ...extra }); opts.onDone && opts.onDone(r.student); }
        catch (er) { q('.err').textContent = er.message; busy(b, false, 'শুরু করুন →'); if (er.restart) setTimeout(() => stepPhone(phone), 1500); }
      };
    }
    stepPhone(opts.phone || '');
  };
})();
