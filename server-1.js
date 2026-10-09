'use strict';
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { db, DATA_DIR, getSetting, setSettings, SqliteStore } = require('./database');

const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const TZ_OFFSET = '+05:30'; // Sri Lanka: offers expire at the end of the chosen day

// ---------- Secrets ----------
function loadSessionSecret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (isProd) {
    console.error('SESSION_SECRET (32+ chars) is required when NODE_ENV=production.');
    process.exit(1);
  }
  const f = path.join(DATA_DIR, '.session_secret'); // dev only, auto-generated
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const gen = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(f, gen, { mode: 0o600 });
  return gen;
}

async function bootstrapAdmin() {
  if (getSetting('admin_password_hash')) return;
  const pw = process.env.ADMIN_INITIAL_PASSWORD;
  if (!pw || pw.length < 8) {
    console.error('First start: set ADMIN_INITIAL_PASSWORD (8+ chars) in .env, start once, then remove it.');
    process.exit(1);
  }
  setSettings({ admin_password_hash: await bcrypt.hash(pw, 12) });
  console.log('Admin password initialised (stored as a bcrypt hash). Remove ADMIN_INITIAL_PASSWORD from .env now.');
}

// ---------- Helpers ----------
const todayColombo = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

function normalizeTelegram(v) {
  v = String(v || '').trim();
  const m = v.match(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(@?[A-Za-z][A-Za-z0-9_]{4,31})\/?$/i) || v.match(/^@?([A-Za-z][A-Za-z0-9_]{4,31})$/);
  return m ? 'https://t.me/' + m[1].replace('@', '') : null;
}
function validHttpsUrl(v) {
  try { const u = new URL(v); return u.protocol === 'https:' && v.length <= 200 ? u.toString() : null; } catch { return null; }
}
const round2 = (n) => Math.round(n * 100) / 100;

function serializeOffer(r) {
  const now = Date.now();
  return {
    id: r.id,
    title: r.title,
    original_price: r.original_price,
    discounted_price: r.discounted_price,
    discount_percent: Math.round((1 - r.discounted_price / r.original_price) * 100),
    description: r.description,
    button_text: r.button_text,
    expires_date: r.expires_date,
    expires_at: r.expires_at,
    expired: r.expires_at != null && r.expires_at <= now,
    active: !!r.active,
  };
}

function validateOffer(b, existingDate) {
  const errors = {};
  const out = {};
  b = b || {};
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (title.length < 2 || title.length > 60) errors.title = 'Title must be 2 to 60 characters.';
  out.title = title;

  const price = (v) => (v === '' || v == null ? NaN : Number(v));
  const o = price(b.original_price), d = price(b.discounted_price);
  if (!Number.isFinite(o) || o <= 0 || o > 10000000) errors.original_price = 'Enter a price greater than 0.';
  if (!Number.isFinite(d) || d <= 0 || d > 10000000) errors.discounted_price = 'Enter a price greater than 0.';
  if (!errors.original_price && !errors.discounted_price && d >= o) {
    errors.discounted_price = 'Discounted price must be lower than the original price.';
  }
  out.original_price = round2(o);
  out.discounted_price = round2(d);

  const desc = typeof b.description === 'string' ? b.description.trim() : '';
  if (desc.length > 300) errors.description = 'Description can be up to 300 characters.';
  out.description = desc;

  const btn = typeof b.button_text === 'string' && b.button_text.trim() ? b.button_text.trim() : 'Buy Now';
  if (btn.length > 30) errors.button_text = 'Button text can be up to 30 characters.';
  out.button_text = btn;

  out.expires_date = null;
  out.expires_at = null;
  const ed = typeof b.expires_date === 'string' ? b.expires_date.trim() : '';
  if (ed) {
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(ed) && !isNaN(Date.parse(ed + 'T00:00:00Z')) &&
      new Date(ed + 'T00:00:00Z').toISOString().slice(0, 10) === ed;
    if (!ok) errors.expires_date = 'Enter a valid date.';
    else if (ed < todayColombo() && ed !== existingDate) errors.expires_date = 'Expiry date cannot be in the past.';
    else { out.expires_date = ed; out.expires_at = Date.parse(ed + 'T23:59:59' + TZ_OFFSET); }
  }
  out.active = b.active === true || b.active === 1 || b.active === '1' ? 1 : 0;
  return { errors, out };
}

function validateSettings(b) {
  const errors = {};
  const out = {};
  b = b || {};
  const t = String(b.site_title || '').trim();
  if (t.length < 2 || t.length > 60) errors.site_title = 'Website title must be 2 to 60 characters.';
  out.site_title = t;
  const g = validHttpsUrl(String(b.main_group_url || '').trim());
  if (!g) errors.main_group_url = 'Enter a valid https:// URL.';
  out.main_group_url = g;
  const a = normalizeTelegram(b.admin_telegram_url);
  if (!a) errors.admin_telegram_url = 'Enter a Telegram username (e.g. HAMBAWAVIP) or a https://t.me/ link.';
  out.admin_telegram_url = a;
  const p = Number(b.default_price);
  if (!Number.isFinite(p) || p <= 0 || p > 10000000) errors.default_price = 'Enter a price greater than 0.';
  out.default_price = round2(p);
  const an = String(b.announcement || '').trim();
  if (an.length > 200) errors.announcement = 'Announcement can be up to 200 characters.';
  out.announcement = an;
  out.offers_visible = b.offers_visible === true || b.offers_visible === '1' || b.offers_visible === 1 ? '1' : '0';
  const c = String(b.contact_label || '').trim();
  if (c.length < 2 || c.length > 30) errors.contact_label = 'Label must be 2 to 30 characters.';
  out.contact_label = c;
  return { errors, out };
}

const publicSettings = () => ({
  site_title: getSetting('site_title'),
  main_group_url: getSetting('main_group_url'),
  admin_url: getSetting('admin_telegram_url'),
  default_price: Number(getSetting('default_price')),
  announcement: getSetting('announcement'),
  offers_visible: getSetting('offers_visible') === '1',
  contact_label: getSetting('contact_label'),
});
const adminSettings = () => {
  const s = publicSettings();
  return { ...s, admin_telegram_url: s.admin_url };
};

// ---------- App ----------
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY && process.env.TRUST_PROXY !== '0') app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

if (isProd && process.env.FORCE_HTTPS !== 'false') {
  app.use((req, res, next) => (req.secure ? next() : res.redirect(301, 'https://' + req.headers.host + req.originalUrl)));
}

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(isProd ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
}));
app.use(express.json({ limit: '20kb' }));

const sessionStore = new SqliteStore();
app.use(session({
  name: 'hv.sid',
  secret: loadSessionSecret(),
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProd && process.env.COOKIE_SECURE !== 'false',
    maxAge: 2 * 3600 * 1000,
  },
}));

app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Same-origin + CSRF checks for every state-changing admin request
function originCheck(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Cross-origin request blocked.' }); }
    catch { return res.status(403).json({ error: 'Bad origin.' }); }
  }
  next();
}
function requireAuth(req, res, next) {
  if (req.session && req.session.admin === true) return next();
  res.status(401).json({ error: 'Not authenticated.' });
}
function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = Buffer.from(String(req.get('x-csrf-token') || ''));
  const real = Buffer.from(String(req.session.csrf || ''));
  if (sent.length === real.length && sent.length > 0 && crypto.timingSafeEqual(sent, real)) return next();
  res.status(403).json({ error: 'Invalid security token. Refresh the page and try again.' });
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 5, skipSuccessfulRequests: true,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many failed attempts. Try again in 15 minutes.' },
});
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
});
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false });

function startSession(req, res, cb) {
  req.session.regenerate((err) => {
    if (err) return cb(err);
    req.session.admin = true;
    req.session.csrf = crypto.randomBytes(32).toString('hex');
    req.session.save((e) => cb(e));
  });
}

// ---------- Public API ----------
app.get('/api/public', (req, res) => {
  const settings = publicSettings();
  let offers = [];
  if (settings.offers_visible) {
    offers = db.prepare('SELECT * FROM offers WHERE active = 1 AND (expires_at IS NULL OR expires_at > ?) ORDER BY id DESC')
      .all(Date.now()).map(serializeOffer);
  }
  res.json({ settings, offers, server_time: Date.now() });
});

// ---------- Admin API ----------
const admin = express.Router();
admin.use(adminLimiter, originCheck);

admin.post('/login', loginLimiter, async (req, res) => {
  const pw = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : '';
  const hash = getSetting('admin_password_hash');
  const ok = pw && hash ? await bcrypt.compare(pw, hash) : false;
  if (!ok) return res.status(401).json({ error: 'Incorrect password.' });
  startSession(req, res, (err) => {
    if (err) return res.status(500).json({ error: 'Could not start session.' });
    res.json({ ok: true, csrfToken: req.session.csrf });
  });
});

admin.get('/session', (req, res) => {
  if (req.session && req.session.admin === true) return res.json({ authenticated: true, csrfToken: req.session.csrf });
  res.json({ authenticated: false });
});

admin.post('/logout', requireAuth, requireCsrf, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('hv.sid');
    res.json({ ok: true });
  });
});

admin.use(requireAuth, requireCsrf);

admin.get('/offers', (req, res) => {
  res.json({ offers: db.prepare('SELECT * FROM offers ORDER BY id DESC').all().map(serializeOffer) });
});

admin.post('/offers', (req, res) => {
  const { errors, out } = validateOffer(req.body, null);
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });
  const now = Date.now();
  const r = db.prepare(`INSERT INTO offers (title, original_price, discounted_price, description, button_text,
    expires_date, expires_at, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(out.title, out.original_price, out.discounted_price, out.description, out.button_text, out.expires_date, out.expires_at, out.active, now, now);
  res.status(201).json({ offer: serializeOffer(db.prepare('SELECT * FROM offers WHERE id = ?').get(r.lastInsertRowid)) });
});

function offerId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: 'Invalid offer id.' }); return null; }
  const row = db.prepare('SELECT * FROM offers WHERE id = ?').get(id);
  if (!row) { res.status(404).json({ error: 'Offer not found.' }); return null; }
  return row;
}

admin.put('/offers/:id', (req, res) => {
  const row = offerId(req, res); if (!row) return;
  const { errors, out } = validateOffer(req.body, row.expires_date);
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });
  db.prepare(`UPDATE offers SET title=?, original_price=?, discounted_price=?, description=?, button_text=?,
    expires_date=?, expires_at=?, active=?, updated_at=? WHERE id=?`)
    .run(out.title, out.original_price, out.discounted_price, out.description, out.button_text, out.expires_date, out.expires_at, out.active, Date.now(), row.id);
  res.json({ offer: serializeOffer(db.prepare('SELECT * FROM offers WHERE id = ?').get(row.id)) });
});

admin.patch('/offers/:id/toggle', (req, res) => {
  const row = offerId(req, res); if (!row) return;
  const active = req.body && typeof req.body.active === 'boolean' ? (req.body.active ? 1 : 0) : row.active ? 0 : 1;
  db.prepare('UPDATE offers SET active=?, updated_at=? WHERE id=?').run(active, Date.now(), row.id);
  res.json({ offer: serializeOffer(db.prepare('SELECT * FROM offers WHERE id = ?').get(row.id)) });
});

admin.delete('/offers/:id', (req, res) => {
  const row = offerId(req, res); if (!row) return;
  db.prepare('DELETE FROM offers WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

admin.get('/settings', (req, res) => res.json({ settings: adminSettings() }));

admin.put('/settings', (req, res) => {
  const { errors, out } = validateSettings(req.body);
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });
  setSettings(out);
  res.json({ settings: adminSettings() });
});

admin.post('/password', sensitiveLimiter, async (req, res) => {
  const cur = typeof req.body.currentPassword === 'string' ? req.body.currentPassword.slice(0, 200) : '';
  const next = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
  const fields = {};
  if (!(await bcrypt.compare(cur, getSetting('admin_password_hash')))) fields.currentPassword = 'Current password is incorrect.';
  if (next.length < 10 || next.length > 72) fields.newPassword = 'New password must be 10 to 72 characters.';
  else if (next === cur) fields.newPassword = 'New password must be different from the current one.';
  if (Object.keys(fields).length) return res.status(400).json({ error: 'Password not changed.', fields });
  setSettings({ admin_password_hash: await bcrypt.hash(next, 12) });
  sessionStore.destroyAll(); // sign out every other session
  startSession(req, res, (err) => {
    if (err) return res.status(500).json({ error: 'Password changed, but a new session could not start. Log in again.' });
    res.json({ ok: true, csrfToken: req.session.csrf });
  });
});

app.use('/api/admin', admin);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// ---------- Pages ----------
app.get('/admin', (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  res.sendFile(path.join(PUBLIC, 'admin.html'));
});
app.get('/admin.html', (req, res) => res.redirect('/admin'));
app.use(express.static(PUBLIC, { maxAge: isProd ? '1h' : 0, index: 'index.html' }));
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, '404.html')));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  console.error('Server error:', err.message);
  if (req.path.startsWith('/api')) return res.status(500).json({ error: 'Server error.' });
  res.status(500).send('Server error');
});

bootstrapAdmin().then(() => {
  app.listen(PORT, () => console.log(`HAMBAWA VIP SPECIAL running on http://localhost:${PORT}`));
});
