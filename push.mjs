// TB Wetter – Push-Nachrichten (läuft als GitHub Action alle 15 Minuten)
// Ohne fremde Bibliotheken: Web-Push-Verschlüsselung (RFC 8291) und VAPID-Signatur (RFC 8292) mit Node-Bordmitteln.
import crypto from 'node:crypto';
import fs from 'node:fs';

const TZ = 'Europe/Berlin';
const STATE_FILE = process.env.STATE_FILE || 'state.json';
const DRY = process.env.DRY_RUN === '1';
const TEST = process.env.TEST_PUSH === '1' || process.env.TEST_PUSH === 'true';
const NOW = process.env.NOW ? new Date(process.env.NOW) : new Date();

/* ---------- Hilfen ---------- */
const b64u = b => Buffer.from(b).toString('base64url');
const local = (d = NOW) => { // Ortszeit Berlin als Teile
  const p = Object.fromEntries(new Intl.DateTimeFormat('de-DE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, h: +p.hour % 24, m: +p.minute, hm: `${p.hour}:${p.minute}` };
};
const hmOf = iso => iso.slice(11, 16);
const r0 = v => String(Math.round(v)).replace('-', '−');
const log = (...a) => console.log(...a);

/* ---------- Web Push ---------- */
export function vapidAuth(endpoint, publicKey, privateKey, subject = 'mailto:tb-wetter@users.noreply.github.com') {
  const pub = Buffer.from(publicKey, 'base64url');
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${publicKey}`;
}
export function encrypt(payload, p256dh, auth) {
  const ua = Buffer.from(p256dh, 'base64url'), authSecret = Buffer.from(auth, 'base64url');
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const asPub = ecdh.getPublicKey(), shared = ecdh.computeSecret(ua);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub]), 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const enc = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, enc]);
}
async function send(sub, msg) {
  const body = encrypt(JSON.stringify(msg), sub.keys.p256dh, sub.keys.auth);
  if (DRY) { log('  [Trockenlauf] würde senden:', msg.title, '–', msg.body); return 201; }
  const res = await fetch(sub.endpoint, { method: 'POST', body, headers: {
    TTL: '43200', Urgency: msg.urgent ? 'high' : 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
    Authorization: vapidAuth(sub.endpoint, process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE) } });
  log('  gesendet:', msg.title, '→', res.status);
  return res.status;
}

/* ---------- Daten ---------- */
async function getJSON(url) {
  if (process.env.MOCK_DIR) { // Tests: Antworten aus Dateien
    const name = url.includes('brightsky') ? 'alerts' : 'forecast';
    return JSON.parse(fs.readFileSync(`${process.env.MOCK_DIR}/${name}.json`, 'utf8'));
  }
  const r = await fetch(url, { headers: { 'User-Agent': 'TB-Wetter-Push (privat)' } });
  if (!r.ok) throw new Error(url + ' → ' + r.status);
  return r.json();
}
const inDE = p => p.lat > 47.2 && p.lat < 55.1 && p.lon > 5.8 && p.lon < 15.1;
const forecast = p => getJSON('https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({ latitude: p.lat, longitude: p.lon, timezone: TZ, forecast_days: '2',
  hourly: 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_gusts_10m,dew_point_2m', minutely_15: 'precipitation', forecast_minutely_15: '8', past_minutely_15: '0' }));
const alerts = p => getJSON(`https://api.brightsky.dev/alerts?lat=${p.lat}&lon=${p.lon}&tz=${TZ}`);
const SEV = { minor: 1, moderate: 2, severe: 3, extreme: 4 };
const fmtT = iso => { const d = new Date(iso); return new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(d) + ' Uhr'; };

/* ---------- Inhalte ---------- */
function morningText(f, name) {
  // Vor 14 Uhr: Überblick für heute (ab jetzt); ab 14 Uhr: Überblick für morgen
  const L = local(), tomorrow = L.h >= 14;
  const day = tomorrow ? f.hourly.time.find(t => t.slice(0, 10) > L.date)?.slice(0, 10) : L.date;
  const H = f.hourly, idx = H.time.map((t, i) => [t, i]).filter(([t]) => t.startsWith(day) && +t.slice(11, 13) >= (tomorrow ? 6 : Math.max(6, L.h)) && +t.slice(11, 13) <= 22).map(x => x[1]);
  if (!idx.length) return null;
  const T = idx.map(i => H.temperature_2m[i]), A = idx.map(i => H.apparent_temperature?.[i] ?? H.temperature_2m[i]);
  const lo = Math.min(...T), hi = Math.max(...T), fmin = Math.min(...A);
  const parts = [`${r0(lo)} bis ${r0(hi)}°`];
  // Regenzeiträume
  let run = null; const rains = [];
  for (const i of idx) { const p = H.precipitation_probability?.[i] ?? 0, mm = H.precipitation?.[i] ?? 0;
    if (p >= 40 || mm >= 0.3) { if (!run) run = { s: i, e: i, p }; run.e = i; run.p = Math.max(run.p, p); } else if (run) { rains.push(run); run = null; } }
  if (run) rains.push(run);
  parts.push(rains.length ? rains.slice(0, 2).map(r => `${kindOf(H.weather_code[r.s], H.temperature_2m[r.s]).w} ${+H.time[r.s].slice(11, 13)}–${+H.time[r.e].slice(11, 13) + 1} Uhr (${r.p} %)`).join(', ') : 'kein Niederschlag');
  // Glätte am Morgen
  const early = idx.filter(i => +H.time[i].slice(11, 13) <= 10);
  const ice = early.some(i => H.temperature_2m[i] <= 0.5 && ((H.precipitation?.[i] ?? 0) > 0 || [56, 57, 66, 67, 71, 73, 75].includes(H.weather_code[i]) || (H.dew_point_2m?.[i] != null && H.temperature_2m[i] - H.dew_point_2m[i] <= 1.5)));
  if (ice) parts.push('Glätte möglich');
  const wear = fmin < -5 ? 'dicke Winterjacke, Mütze & Handschuhe' : fmin < 3 ? 'Winterjacke & Handschuhe' : fmin < 10 ? 'warme Jacke' : fmin < 16 ? 'leichte Jacke' : 'T-Shirt';
  const take = []; if (rains.some(r => r.p >= 50 && kindOf(H.weather_code[r.s], H.temperature_2m[r.s]).w === 'Regen')) take.push('Schirm');
  if (rains.some(r => r.p >= 50 && kindOf(H.weather_code[r.s], H.temperature_2m[r.s]).w !== 'Regen')) take.push('feste Schuhe'); if (ice) take.push('Eiskratzer');
  const g = L.h < 11 ? 'Guten Morgen' : L.h < 17 ? 'Hallo' : L.h < 22 ? 'Guten Abend' : 'Hallo';
  return { title: `${g}${name ? ', ' + name : ''}${tomorrow ? ' – so wird morgen' : ''}`, body: parts.join(' · ') + `. Anziehen: ${wear}${take.length ? ', mitnehmen: ' + take.join(' & ') : ''}.` };
}
// Art des Niederschlags aus Wettercode (und Temperatur als Rückfallebene)
export function kindOf(code, t) {
  if ([95, 96, 99].includes(code)) return { w: 'Gewitter', e: '⛈' };
  if ([66, 67, 56, 57].includes(code)) return { w: 'gefrierender Regen', e: '🧊' };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { w: 'Schnee', e: '❄️' };
  if (t != null && t <= 1 && t > -1 && [61, 63, 65, 80, 81, 82, 51, 53, 55].includes(code)) return { w: 'Schneeregen', e: '🌨' };
  return { w: 'Regen', e: '🌧' };
}
function rainSoon(f) {
  const M = f.minutely_15; if (!M?.time) return null;
  const nowIso = local().date + 'T' + local().hm;
  const i0 = Math.max(0, M.time.findIndex(t => t >= nowIso.slice(0, 14) + String(Math.floor(local().m / 15) * 15).padStart(2, '0')));
  for (let i = i0; i < Math.min(M.time.length, i0 + 4); i++) if ((M.precipitation[i] || 0) >= 0.2) {
    const hi = f.hourly.time.findIndex(t => t.slice(0, 13) === M.time[i].slice(0, 13));
    const pp = hi >= 0 ? f.hourly.precipitation_probability?.[hi] : null;
    return { at: hmOf(M.time[i]), pp, kind: kindOf(f.hourly.weather_code[hi], f.hourly.temperature_2m[hi]) };
  }
  return null;
}

/* ---------- Ablauf ---------- */
function subscribers() {
  const out = [];
  for (let n = 1; n <= 6; n++) { const raw = process.env['PUSH_' + n]; if (!raw || !raw.trim()) continue;
    try { const s = JSON.parse(Buffer.from(raw.trim(), 'base64').toString('utf8')); if (s?.sub?.endpoint) out.push({ ...s, slot: n }); else log(`PUSH_${n}: ungültig`); }
    catch (e) { log(`PUSH_${n}: Code nicht lesbar – bitte in der App neu kopieren`); } }
  return out;
}
export async function main() {
  const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
  const subs = subscribers(); const L = local();
  log(`TB Wetter Push · ${L.date} ${L.hm} · ${subs.length} Empfänger${DRY ? ' · Trockenlauf' : ''}`);
  const night = L.h >= 22 || L.h < 6;
  const cacheF = {}, cacheA = {};
  for (const s of subs) {
    const id = 'p' + s.slot + '_' + crypto.createHash('sha1').update(s.sub.endpoint).digest('hex').slice(0, 10), st = state[id] ||= { sent: {} };
    const prefs = s.prefs || { warn: true, rain: false, morning: true }, places = (s.places || []).slice(0, 3);
    log(`• ${s.name || 'Empfänger ' + s.slot}: ${places.map(p => p.n).join(', ') || 'keine Orte'}`);
    if (TEST) { await send(s.sub, { title: 'TB Wetter', body: `✅ Push funktioniert${s.name ? ', ' + s.name : ''}!`, tag: 'test' }); continue; }
    try {
      // 1) Amtliche Warnungen
      if (prefs.warn) for (const p of places.filter(inDE)) {
        const key = p.lat.toFixed(2) + ',' + p.lon.toFixed(2);
        const a = cacheA[key] ||= await alerts(p);
        for (const w of (a.alerts || []).filter(x => x.status !== 'test')) {
          const k = 'w:' + w.alert_id + ':' + key; if (st.sent[k]) continue;
          const lv = SEV[w.severity] || 1; if (night && lv < 3) continue; // nachts nur Unwetter
          await send(s.sub, { title: `⚠️ ${w.headline_de || 'Amtliche Warnung'}`, body: `${p.n}: ${w.onset ? 'ab ' + fmtT(w.onset) : ''}${w.expires ? ' bis ' + fmtT(w.expires) : ''}. Quelle: DWD`, tag: 'warn-' + (w.event_code || '') + key, urgent: lv >= 3, view: 'wetter' });
          st.sent[k] = Date.now();
        }
      }
      // 2) Regen in der nächsten Stunde (nur erster Ort, 6–22 Uhr, höchstens alle 3 Std.)
      if (prefs.rain && !night && places[0]) {
        const p = places[0], key = p.lat.toFixed(2) + ',' + p.lon.toFixed(2), f = cacheF[key] ||= await forecast(p);
        const r = rainSoon(f), last = st.sent['rain:' + key] || 0;
        if (r && Date.now() - last > 3 * 3600e3) {
          const W = r.kind.w[0].toUpperCase() + r.kind.w.slice(1);
          await send(s.sub, { title: `${r.kind.e} ${W} in Kürze`, body: `${p.n}: ${W} ab ca. ${r.at} Uhr${r.pp != null ? ' (' + r.pp + ' %)' : ''}.`, tag: 'rain-' + key, view: 'radar', urgent: r.kind.w !== 'Regen' });
          st.sent['rain:' + key] = Date.now();
        }
      }
      // 3) Morgen-Hinweis zur gewählten Uhrzeit (Fenster 50 Min. wegen möglicher Verspätung, einmal pro Tag)
      const [mh, mm] = String(prefs.mt || '06:00').split(':').map(Number), target = mh * 60 + mm, nowMin = L.h * 60 + L.m;
      if (prefs.morning && nowMin >= target && nowMin < target + 50 && places[0] && st.sent['morning'] !== L.date) {
        const p = places[0], key = p.lat.toFixed(2) + ',' + p.lon.toFixed(2), f = cacheF[key] ||= await forecast(p);
        const m = morningText(f, s.name); if (m) { await send(s.sub, { ...m, body: `${p.n}: ${m.body}`, tag: 'morning', view: 'wetter' }); st.sent['morning'] = L.date; }
      }
    } catch (e) { log('  Fehler:', e.message); }
    // Alte Einträge aufräumen (älter als 3 Tage)
    for (const [k, v] of Object.entries(st.sent)) if (typeof v === 'number' && Date.now() - v > 3 * 864e5) delete st.sent[k];
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
