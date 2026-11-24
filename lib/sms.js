// Sending OTP text messages through a Bangladeshi SMS gateway.
// The provider and its API key are set by the admin in the panel (⚙️ সেটিংস), stored in the settings table.
//   test      – nothing is sent; the code is shown to the admin (for trying the system before buying SMS)
//   bulksmsbd – bulksmsbd.net
//   alpha     – Alpha SMS (sms.net.bd)
//   custom    – any gateway with a GET link: {to} and {msg} in the link are replaced
const PROVIDERS = ['test', 'bulksmsbd', 'alpha', 'custom'];

// 01712345678 → 8801712345678; +60123456789 → 60123456789
const toIntl = (phone) => phone.startsWith('+') ? phone.slice(1) : '88' + phone;

async function sendSms(cfg, phone, msg) {
  const to = toIntl(phone), signal = AbortSignal.timeout(15000);
  if (cfg.provider === 'test') return { ok: true, test: true };
  if (!cfg.api_key && cfg.provider !== 'custom') return { ok: false, error: 'SMS এর API key দেওয়া হয়নি' };
  try {
    if (cfg.provider === 'bulksmsbd') {
      const u = new URL('http://bulksmsbd.net/api/smsapi');
      u.search = new URLSearchParams({ api_key: cfg.api_key, type: 'text', number: to, senderid: cfg.sender_id || '', message: msg });
      const r = await fetch(u, { signal }); const t = await r.text();
      let j = {}; try { j = JSON.parse(t); } catch {}
      return Number(j.response_code) === 202 ? { ok: true } : { ok: false, error: 'BulkSMSBD: ' + (j.error_message || j.success_message || t).toString().slice(0, 160) };
    }
    if (cfg.provider === 'alpha') {
      const body = new URLSearchParams({ api_key: cfg.api_key, msg, to });
      if (cfg.sender_id) body.set('sender_id', cfg.sender_id);
      const r = await fetch('https://api.sms.net.bd/sendsms', { method: 'POST', body, signal }); const t = await r.text();
      let j = {}; try { j = JSON.parse(t); } catch {}
      return Number(j.error) === 0 ? { ok: true } : { ok: false, error: 'Alpha SMS: ' + (j.msg || t).toString().slice(0, 160) };
    }
    if (cfg.provider === 'custom') {
      if (!/^https?:\/\//.test(cfg.custom_url || '') || !cfg.custom_url.includes('{to}') || !cfg.custom_url.includes('{msg}'))
        return { ok: false, error: 'কাস্টম লিংকে {to} আর {msg} থাকতে হবে' };
      const u = cfg.custom_url.replace('{to}', encodeURIComponent(to)).replace('{msg}', encodeURIComponent(msg)).replace('{key}', encodeURIComponent(cfg.api_key || ''));
      const r = await fetch(u, { signal }); const t = await r.text();
      return r.ok ? { ok: true } : { ok: false, error: `HTTP ${r.status}: ${t.slice(0, 160)}` };
    }
    return { ok: false, error: 'SMS কোম্পানি সেট করা নেই' };
  } catch (e) { return { ok: false, error: 'SMS পাঠানো যায়নি: ' + (e.name === 'TimeoutError' ? 'সময় শেষ' : e.message).slice(0, 120) }; }
}
module.exports = { sendSms, PROVIDERS };
