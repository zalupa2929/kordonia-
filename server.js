require("dotenv").config();
const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const IS_PROD = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads");

// ---------- Проверка секретов ----------
const DEFAULT_SECRET = "development-only-change-me";
const DEFAULT_ADMIN_PASS = "change-this-immediately";
const SESSION_SECRET = process.env.SESSION_SECRET || DEFAULT_SECRET;
const ADMIN_NAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASS = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASS;
const weakSecret = SESSION_SECRET === DEFAULT_SECRET || SESSION_SECRET.startsWith("replace-this") || SESSION_SECRET.length < 24;
const weakPass = ADMIN_PASS === DEFAULT_ADMIN_PASS || ADMIN_PASS.length < 10;
if (IS_PROD && (weakSecret || weakPass)) {
  console.error("ОШИБКА: в production заданы неподходящие переменные окружения:");
  if (weakSecret) console.error(" - SESSION_SECRET " + (process.env.SESSION_SECRET ? "слишком короткий (нужно 24+ символа) или стандартный" : "НЕ ЗАДАН"));
  if (weakPass) console.error(" - ADMIN_PASSWORD " + (process.env.ADMIN_PASSWORD ? "слишком короткий (нужно 10+ символов) или стандартный" : "НЕ ЗАДАН"));
  console.error("Добавьте их в Render → Environment и перезапустите деплой.");
  process.exit(1);
}
if (!IS_PROD && (weakSecret || weakPass)) {
  console.warn("ВНИМАНИЕ: используются слабые/стандартные SESSION_SECRET или ADMIN_PASSWORD. Допустимо только для локальной проверки.");
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "kordrp.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const ORGS = {
 "Правительство": ["Контролёр доступа","Глава протокольной безопасности","Хранитель реестра","Аналитик стратегических рисков","Магистр регламентов","Председатель Государственной Думы","Депутат","Вице-губернатор","Губернатор","Министр социальной политики","Заместитель премьер-министра","Премьер-министр"],
 "Кордоновский суд": ["Председатель Городского суда","Главный районный судья","Районный судья","Судья по уголовным делам","Судья по гражданским делам","Следственный судья","Судебный медиатор","Судебный эксперт","Секретарь судебного заседания","Судебный пристав","Помощник судьи","Практикант"],
 "СК": ["Младший лейтенант юстиции","Лейтенант юстиции","Старший лейтенант юстиции","Капитан юстиции","Майор юстиции","Подполковник юстиции","Полковник юстиции","Генерал-майор юстиции","Генерал-лейтенант юстиции","Генерал-полковник юстиции","Генерал юстиции"],
 "Прокуратура": ["Младший юрист","Юрист 3 класса","Юрист 2 класса","Юрист 1 класса","Младший советник юстиции","Советник юстиции","Старший советник юстиции","Государственный советник юстиции 3 класса","Государственный советник юстиции 2 класса","Государственный советник юстиции 1 класса","Действительный государственный советник юстиции"],
 "ДГБ": ["Младший оперуполномоченный","Оперуполномоченный","Старший оперуполномоченный","Заместитель начальника отдела","Начальник отдела","Генерал","Генерал-полковник","Генерал-лейтенант","Генерал-майор","Полковник","Подполковник","Майор","Капитан","Старший лейтенант","Лейтенант","Младший лейтенант","Старший прапорщик","Прапорщик","Старшина","Старший сержант","Сержант","Младший сержант"],
 "КНД": ["Генерал-полковник полиции","Генерал-лейтенант полиции","Генерал-майор полиции","Полковник полиции","Подполковник полиции","Майор полиции","Капитан полиции","Старший лейтенант полиции","Лейтенант полиции","Младший лейтенант полиции","Старший прапорщик полиции","Прапорщик полиции","Старшина полиции","Старший сержант полиции","Сержант полиции","Младший сержант полиции","Рядовой полиции"],
 "МВД": ["Генерал полиции","Генерал-полковник полиции","Генерал-лейтенант полиции","Генерал-майор полиции","Полковник полиции","Подполковник полиции","Майор полиции","Капитан полиции","Старший лейтенант полиции","Лейтенант полиции","Младший лейтенант полиции","Старший прапорщик полиции","Прапорщик полиции","Старшина полиции","Старший сержант полиции","Сержант полиции","Младший сержант полиции","Рядовой полиции"],
 "ВС РК": ["Рядовой","Ефрейтор","Младший сержант","Сержант","Старший сержант","Старшина","Прапорщик","Старший прапорщик","Младший лейтенант","Лейтенант","Старший лейтенант","Капитан","Майор","Подполковник","Полковник","Генерал-майор","Генерал-лейтенант","Генерал-полковник","Генерал армии"],
 "ГБ": ["Главный врач","Зам. главного врача","Заведующий отделением","Зам. заведующего отделением","Врач-психиатр","Врач-нарколог","Врач-реаниматолог","Врач-хирург","Врач-травматолог","Врач-терапевт","Старший парамедик","Парамедик","Фельдшер","Медбрат / Медсестра","Санитар","Интерн"],
 "СМИ": ["Генеральный директор","Зам. генерального директора","Управляющий СМИ","Главный редактор","Зам. главного редактора","Режиссёр","Ведущий","Журналист","Репортёр","Оператор","Радиоведущий","Корреспондент","Фотокорреспондент","Верстальщик","Помощник редактора","Стажёр"]
};

const STATUSES = ["Служит", "Уволен"];
const USER_ROLES = ["technical_admin", "org_head", "hr", "investigator", "viewer"];
const RESULTS = ["Сдано", "Не сдано", "Ожидает"];

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'viewer', org TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS staff (
 id TEXT PRIMARY KEY, fio TEXT NOT NULL, dob TEXT, passport TEXT, phone TEXT, nickname TEXT, discord TEXT,
 token TEXT UNIQUE NOT NULL, org TEXT NOT NULL, unit TEXT, position TEXT NOT NULL, rank TEXT,
 status TEXT NOT NULL DEFAULT 'Служит', portrait_path TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS credentials (
 id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
 credential_no TEXT UNIQUE NOT NULL, issued_on TEXT, expires_on TEXT, status TEXT NOT NULL DEFAULT 'Действует',
 issuer TEXT, image_path TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS history (
 id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id TEXT, fio TEXT NOT NULL, org TEXT, action TEXT NOT NULL,
 details TEXT, actor TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS training (
 id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
 course TEXT NOT NULL, result TEXT NOT NULL, date TEXT NOT NULL, examiner TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS access_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, action TEXT NOT NULL, target TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cred_staff ON credentials(staff_id);
CREATE INDEX IF NOT EXISTS idx_hist_staff ON history(staff_id);
CREATE INDEX IF NOT EXISTS idx_train_staff ON training(staff_id);
`);

// Однократная синхронизация: статус удостоверения должен соответствовать статусу сотрудника.
db.exec(`UPDATE credentials SET status = CASE
  WHEN (SELECT status FROM staff WHERE staff.id = credentials.staff_id) = 'Служит' THEN 'Действует' ELSE 'Недействительно' END`);

// ---------- Вспомогательные функции ----------
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const okDate = v => v === "" || DATE_RE.test(v);
const URL_RE = /^(https?:\/\/[^\s"'<>]+|\/uploads\/[A-Za-z0-9._-]+)$/i;
const cleanUrl = v => { v = str(v, 500); return v && URL_RE.test(v) ? v : ""; };
const todayStr = () => new Date().toISOString().slice(0, 10);
const isUnique = e => e && String(e.code || "").startsWith("SQLITE_CONSTRAINT");

function log(action, target = "", username = "system") {
  db.prepare("INSERT INTO access_log(username,action,target) VALUES(?,?,?)").run(str(username, 100), action, str(target, 200));
}
function audit(staff, action, details = "", actor = "system") {
  db.prepare("INSERT INTO history(staff_id,fio,org,action,details,actor) VALUES(?,?,?,?,?,?)")
    .run(staff?.id || null, staff?.fio || "—", staff?.org || "—", action, details, actor);
}

// Простой ограничитель попыток (в памяти процесса).
function makeLimiter(max, windowMs) {
  const hits = new Map();
  const entry = key => {
    const now = Date.now();
    let e = hits.get(key);
    if (!e || e.reset < now) { e = { n: 0, reset: now + windowMs }; hits.set(key, e); }
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return e;
  };
  return {
    blocked: key => entry(key).n >= max,
    hit: key => { entry(key).n++; },
    clear: key => hits.delete(key)
  };
}
const loginLimiter = makeLimiter(10, 15 * 60 * 1000);
const verifyLimiter = makeLimiter(40, 60 * 1000);

// ---------- Первый администратор ----------
if (!db.prepare("SELECT id FROM users WHERE username=?").get(ADMIN_NAME)) {
  db.prepare("INSERT INTO users(username,password_hash,role) VALUES(?,?,?)").run(ADMIN_NAME, bcrypt.hashSync(ADMIN_PASS, 12), "main_admin");
  console.log("Initial admin created from ADMIN_USERNAME / ADMIN_PASSWORD environment variables.");
}

// ---------- Middleware ----------
app.disable("x-powered-by");
if (IS_PROD) app.set("trust proxy", 1); // иначе secure-cookie не ставится за прокси хостинга
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginResourcePolicy: { policy: "same-origin" }
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
// Хранилище сессий на better-sqlite3 (без второго нативного модуля sqlite3).
class SqliteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.db = database;
    this.db.exec("CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires INTEGER NOT NULL)");
    this.qGet = this.db.prepare("SELECT sess FROM sessions WHERE sid=? AND expires>?");
    this.qSet = this.db.prepare("INSERT OR REPLACE INTO sessions(sid,sess,expires) VALUES(?,?,?)");
    this.qDel = this.db.prepare("DELETE FROM sessions WHERE sid=?");
    this.qTouch = this.db.prepare("UPDATE sessions SET expires=? WHERE sid=?");
    this.qClean = this.db.prepare("DELETE FROM sessions WHERE expires<=?");
    const t = setInterval(() => { try { this.qClean.run(Date.now()); } catch { /* ignore */ } }, 15 * 60 * 1000);
    t.unref();
  }
  expiry(sess) {
    const e = sess && sess.cookie && sess.cookie.expires;
    return e ? new Date(e).getTime() : Date.now() + 8 * 60 * 60 * 1000;
  }
  get(sid, cb) { try { const r = this.qGet.get(sid, Date.now()); cb(null, r ? JSON.parse(r.sess) : null); } catch (e) { cb(e); } }
  set(sid, sess, cb) { try { this.qSet.run(sid, JSON.stringify(sess), this.expiry(sess)); cb && cb(null); } catch (e) { cb && cb(e); } }
  destroy(sid, cb) { try { this.qDel.run(sid); cb && cb(null); } catch (e) { cb && cb(e); } }
  touch(sid, sess, cb) { try { this.qTouch.run(this.expiry(sess), sid); cb && cb(null); } catch (e) { cb && cb(e); } }
}

app.use(session({
  store: new SqliteSessionStore(db),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: IS_PROD, maxAge: 8 * 60 * 60 * 1000 }
}));

// Защита от CSRF: изменяющие запросы должны нести собственный заголовок и тот же Origin.
app.use("/api", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("X-Requested-With") !== "KordRP") return res.status(403).json({ error: "Недопустимый запрос" });
  const origin = req.get("Origin");
  if (origin) {
    try { if (new URL(origin).host !== req.get("host")) return res.status(403).json({ error: "Недопустимый источник запроса" }); }
    catch { return res.status(403).json({ error: "Недопустимый источник запроса" }); }
  }
  next();
});

// Роль/организация/активность берутся из БД на каждом запросе: отключённый пользователь теряет доступ сразу.
app.use("/api", (req, res, next) => {
  const su = req.session && req.session.user;
  if (!su) return next();
  const u = db.prepare("SELECT id,username,role,org,active FROM users WHERE id=?").get(su.id);
  if (!u || !u.active) { delete req.session.user; return next(); }
  if (u.username !== su.username || u.role !== su.role || u.org !== su.org) {
    req.session.user = { id: u.id, username: u.username, role: u.role, org: u.org };
  }
  next();
});

function auth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Требуется вход" });
  next();
}
function role(...roles) {
  return (req, res, next) => {
    const u = req.session.user;
    if (!u) return res.status(401).json({ error: "Требуется вход" });
    if (u.role !== "main_admin" && !roles.includes(u.role)) return res.status(403).json({ error: "Недостаточно прав" });
    next();
  };
}
function canManageOrg(req, org) {
  const u = req.session.user;
  return u.role === "main_admin" || u.role === "technical_admin" || (["org_head", "hr"].includes(u.role) && u.org === org);
}
function seesAllOrgs(u) { return ["main_admin", "technical_admin", "investigator"].includes(u.role); }

function staffRow(id) { return db.prepare("SELECT * FROM staff WHERE id=?").get(id); }
function credFor(id) { return db.prepare("SELECT * FROM credentials WHERE staff_id=? ORDER BY id DESC LIMIT 1").get(id); }
function credStatusFor(staffStatus) { return staffStatus === "Служит" ? "Действует" : "Недействительно"; }

function safePublic(s, c, reason) {
  return {
    fio: s.fio, token: s.token, org: s.org, unit: s.unit, position: s.position, rank: s.rank, status: s.status,
    credential_no: c?.credential_no || "", issued_on: c?.issued_on || "", expires_on: c?.expires_on || "",
    credential_status: c?.status || "Нет удостоверения", portrait_path: s.portrait_path || null, image_path: c?.image_path || null,
    reason: reason || ""
  };
}

// ---------- Загрузка изображений ----------
const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + (EXT[file.mimetype] || ".bin")) // расширение — по MIME, не по имени файла
  }),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, !!EXT[file.mimetype])
});
function looksLikeImage(file) {
  try {
    const fd = fs.openSync(file.path, "r"); const b = Buffer.alloc(12); fs.readSync(fd, b, 0, 12, 0); fs.closeSync(fd);
    if (file.mimetype === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    if (file.mimetype === "image/png") return b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    if (file.mimetype === "image/webp") return b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP";
  } catch { /* ниже вернём false */ }
  return false;
}
function dropUpload(p) {
  if (p && p.startsWith("/uploads/")) fs.unlink(path.join(UPLOAD_DIR, path.basename(p)), () => {});
}

// Файлы удостоверений видны только вошедшим пользователям.
app.use("/uploads", auth, express.static(UPLOAD_DIR, {
  fallthrough: false, dotfiles: "deny", index: false,
  setHeaders: res => res.set("X-Content-Type-Options", "nosniff")
}));

// ---------- Валидация сотрудника ----------
function readStaffBody(b, old) {
  const pick = (k, max) => b[k] === undefined ? str(old ? old[k] : "", max) : str(b[k], max);
  return {
    fio: pick("fio", 150), dob: pick("dob", 10), passport: pick("passport", 60), phone: pick("phone", 40),
    nickname: pick("nickname", 60), discord: pick("discord", 60), token: pick("token", 7), org: pick("org", 60),
    unit: pick("unit", 100), position: pick("position", 100), rank: pick("rank", 100),
    status: pick("status", 20) || "Служит",
    portrait_path: b.portrait_path === undefined ? (old?.portrait_path || "") : cleanUrl(b.portrait_path)
  };
}
function validateStaff(d, old) {
  if (!d.fio || !d.token || !d.org || !d.position) return "Заполните ФИО, жетон, организацию и должность";
  if (!/^\d{3}-\d{3}$/.test(d.token)) return "Жетон должен иметь формат 000-000";
  if (!ORGS[d.org]) return "Неизвестная организация";
  if (!STATUSES.includes(d.status)) return "Неизвестный статус сотрудника";
  if (!okDate(d.dob)) return "Дата рождения указана неверно";
  const rankUnchanged = old && old.rank === d.rank && old.org === d.org;
  if (d.rank && !ORGS[d.org].includes(d.rank) && !rankUnchanged) return "Звание не относится к выбранной организации";
  return null;
}

// ---------- API ----------
app.get("/api/config", (req, res) => {
  const u = req.session.user;
  res.json({ orgs: ORGS, user: u ? { username: u.username, role: u.role, org: u.org } : null });
});

app.post("/api/login", (req, res) => {
  const username = str((req.body || {}).username, 100);
  const password = String((req.body || {}).password || "");
  const key = req.ip + "|" + username.toLowerCase();
  if (loginLimiter.blocked(key)) return res.status(429).json({ error: "Слишком много попыток входа. Подождите 15 минут." });
  const u = db.prepare("SELECT * FROM users WHERE username=? AND active=1").get(username);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) {
    loginLimiter.hit(key);
    log("Неудачный вход", username);
    return res.status(401).json({ error: "Неверный логин или пароль" });
  }
  loginLimiter.clear(key);
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Ошибка сессии" });
    req.session.user = { id: u.id, username: u.username, role: u.role, org: u.org };
    log("Вход в систему", "", u.username);
    res.json({ ok: true, user: { username: u.username, role: u.role, org: u.org } });
  });
});

app.post("/api/logout", auth, (req, res) => {
  log("Выход", "", req.session.user.username);
  req.session.destroy(() => { res.clearCookie("connect.sid"); res.json({ ok: true }); });
});

app.post("/api/password", auth, (req, res) => {
  const b = req.body || {};
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(req.session.user.id);
  if (!u || !bcrypt.compareSync(String(b.current || ""), u.password_hash)) return res.status(403).json({ error: "Текущий пароль неверен" });
  const np = String(b.password || "");
  if (np.length < 10) return res.status(400).json({ error: "Новый пароль должен быть не короче 10 символов" });
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(np, 12), u.id);
  log("Смена пароля", "", u.username);
  res.json({ ok: true });
});

app.get("/api/staff", auth, (req, res) => {
  const u = req.session.user;
  const rows = db.prepare("SELECT * FROM staff ORDER BY org,position,fio").all();
  const canPrivate = ["main_admin", "technical_admin", "hr", "org_head"].includes(u.role);
  res.json(rows.map(s => {
    const x = { ...s };
    delete x.passport; delete x.phone; delete x.nickname; delete x.discord;
    if (canPrivate && (u.role === "main_admin" || u.role === "technical_admin" || u.org === s.org)) {
      x.passport = s.passport; x.phone = s.phone; x.nickname = s.nickname; x.discord = s.discord;
    }
    x.credential = credFor(s.id) || null;
    return x;
  }));
});

app.post("/api/staff", role("main_admin", "hr", "org_head"), (req, res) => {
  const d = readStaffBody(req.body || {}, null);
  const err = validateStaff(d, null);
  if (err) return res.status(400).json({ error: err });
  if (!canManageOrg(req, d.org)) return res.status(403).json({ error: "Нет доступа к этой организации" });
  if (db.prepare("SELECT id FROM staff WHERE token=?").get(d.token)) return res.status(409).json({ error: "Такой жетон уже занят" });
  const data = { id: crypto.randomUUID(), ...d };
  try {
    db.prepare("INSERT INTO staff(id,fio,dob,passport,phone,nickname,discord,token,org,unit,position,rank,status,portrait_path) VALUES(@id,@fio,@dob,@passport,@phone,@nickname,@discord,@token,@org,@unit,@position,@rank,@status,@portrait_path)").run(data);
  } catch (e) {
    if (isUnique(e)) return res.status(409).json({ error: "Такой жетон уже занят" });
    throw e;
  }
  audit(data, "Приём на службу", "Создан профиль", req.session.user.username);
  res.json({ ok: true, id: data.id });
});

app.put("/api/staff/:id", role("main_admin", "hr", "org_head"), (req, res) => {
  const old = staffRow(req.params.id);
  if (!old) return res.status(404).json({ error: "Запись не найдена" });
  if (!canManageOrg(req, old.org)) return res.status(403).json({ error: "Нет доступа к этой организации" });
  const d = readStaffBody(req.body || {}, old);
  const err = validateStaff(d, old);
  if (err) return res.status(400).json({ error: err });
  if (!canManageOrg(req, d.org)) return res.status(403).json({ error: "Нет доступа к выбранной организации" });
  if (db.prepare("SELECT id FROM staff WHERE token=? AND id<>?").get(d.token, old.id)) return res.status(409).json({ error: "Жетон уже занят" });
  const data = { ...d, id: old.id, updated_at: new Date().toISOString() };
  const actor = req.session.user.username;
  try {
    db.transaction(() => {
      db.prepare("UPDATE staff SET fio=@fio,dob=@dob,passport=@passport,phone=@phone,nickname=@nickname,discord=@discord,token=@token,org=@org,unit=@unit,position=@position,rank=@rank,status=@status,portrait_path=@portrait_path,updated_at=@updated_at WHERE id=@id").run(data);
      if (old.status !== data.status) {
        db.prepare("UPDATE credentials SET status=? WHERE staff_id=?").run(credStatusFor(data.status), old.id);
      }
    })();
  } catch (e) {
    if (isUnique(e)) return res.status(409).json({ error: "Жетон уже занят" });
    throw e;
  }
  if (old.org !== data.org) audit(data, "Перевод", old.org + " → " + data.org, actor);
  if ((old.rank || "") !== data.rank) audit(data, "Изменение звания", (old.rank || "—") + " → " + (data.rank || "—"), actor);
  if (old.status !== data.status) audit(data, data.status === "Уволен" ? "Увольнение" : "Возобновление службы", "", actor);
  res.json({ ok: true });
});

app.delete("/api/staff/:id", role("main_admin"), (req, res) => {
  const s = staffRow(req.params.id);
  if (!s) return res.status(404).json({ error: "Не найдено" });
  audit(s, "Удаление профиля", "Удалён главным администратором", req.session.user.username);
  db.prepare("DELETE FROM staff WHERE id=?").run(s.id);
  res.json({ ok: true });
});

// Выдать или обновить удостоверение (без номера — номер создаётся автоматически).
app.post("/api/staff/:id/credential", role("main_admin", "hr", "org_head"), (req, res) => {
  const s = staffRow(req.params.id);
  if (!s) return res.status(404).json({ error: "Сотрудник не найден" });
  if (!canManageOrg(req, s.org)) return res.status(403).json({ error: "Нет доступа" });
  const b = req.body || {};
  const actor = req.session.user.username;
  const issued = b.issued_on === undefined ? undefined : str(b.issued_on, 10);
  const expires = b.expires_on === undefined ? undefined : str(b.expires_on, 10);
  if ((issued !== undefined && !okDate(issued)) || (expires !== undefined && !okDate(expires))) return res.status(400).json({ error: "Дата указана неверно" });
  const image = b.image_path === undefined ? undefined : cleanUrl(b.image_path);
  const current = credFor(s.id);
  try {
    if (!current) {
      let number = str(b.credential_no, 40);
      if (!number) {
        do { number = "KR-" + crypto.randomBytes(4).toString("hex").toUpperCase(); }
        while (db.prepare("SELECT 1 FROM credentials WHERE credential_no=?").get(number));
      }
      const info = db.prepare("INSERT INTO credentials(staff_id,credential_no,issued_on,expires_on,status,issuer,image_path) VALUES(?,?,?,?,?,?,?)")
        .run(s.id, number, issued || todayStr(), expires || "", credStatusFor(s.status), actor, image || null);
      audit(s, "Выдача удостоверения", number, actor);
      return res.json({ ok: true, id: info.lastInsertRowid, credential_no: number, created: true });
    }
    const number = str(b.credential_no, 40) || current.credential_no;
    const next = {
      id: current.id,
      credential_no: number,
      issued_on: issued || current.issued_on || todayStr(),
      expires_on: expires === undefined ? (current.expires_on || "") : expires,
      status: credStatusFor(s.status),
      image_path: image === undefined ? current.image_path : (image || null)
    };
    const changed = ["credential_no", "issued_on", "expires_on", "status", "image_path"].some(k => (next[k] || "") !== (current[k] || ""));
    if (changed) {
      db.prepare("UPDATE credentials SET credential_no=@credential_no,issued_on=@issued_on,expires_on=@expires_on,status=@status,image_path=@image_path WHERE id=@id").run(next);
      if (next.image_path !== current.image_path) dropUpload(current.image_path);
      audit(s, "Изменение удостоверения", number, actor);
    }
    res.json({ ok: true, id: current.id, credential_no: number, created: false });
  } catch (e) {
    if (isUnique(e)) return res.status(409).json({ error: "Номер удостоверения уже используется" });
    throw e;
  }
});

app.post("/api/credentials/:id/image", role("main_admin", "hr", "org_head"), (req, res, next) => {
  upload.single("image")(req, res, err => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "Файл больше 3 МБ" });
      return next(err);
    }
    const drop = () => { if (req.file) fs.unlink(req.file.path, () => {}); };
    if (!req.file) return res.status(400).json({ error: "Выберите JPG, PNG или WEBP до 3 МБ" });
    if (!looksLikeImage(req.file)) { drop(); return res.status(400).json({ error: "Файл не является допустимым изображением" }); }
    const c = db.prepare("SELECT * FROM credentials WHERE id=?").get(req.params.id);
    if (!c) { drop(); return res.status(404).json({ error: "Удостоверение не найдено" }); }
    const s = staffRow(c.staff_id);
    if (!s || !canManageOrg(req, s.org)) { drop(); return res.status(403).json({ error: "Нет доступа" }); }
    const p = "/uploads/" + req.file.filename;
    db.prepare("UPDATE credentials SET image_path=? WHERE id=?").run(p, c.id);
    dropUpload(c.image_path);
    audit(s, "Загрузка изображения удостоверения", c.credential_no, req.session.user.username);
    res.json({ ok: true, image_path: p });
  });
});

app.get("/api/history", role("main_admin", "technical_admin", "hr", "org_head", "investigator"), (req, res) => {
  const u = req.session.user;
  const rows = db.prepare("SELECT * FROM history ORDER BY id DESC LIMIT 500").all();
  res.json(rows.filter(x => seesAllOrgs(u) || u.org === x.org));
});

app.get("/api/training", auth, (req, res) => {
  const u = req.session.user;
  const rows = db.prepare("SELECT t.*,s.org,s.fio FROM training t JOIN staff s ON s.id=t.staff_id ORDER BY t.id DESC").all();
  res.json(rows.filter(x => seesAllOrgs(u) || (u.org && u.org === x.org)));
});

app.post("/api/training", role("main_admin", "hr", "org_head"), (req, res) => {
  const b = req.body || {};
  const s = staffRow(String(b.staff_id || ""));
  if (!s) return res.status(404).json({ error: "Сотрудник не найден" });
  if (!canManageOrg(req, s.org)) return res.status(403).json({ error: "Нет доступа" });
  const course = str(b.course, 150), result = str(b.result, 20), date = str(b.date, 10);
  if (!course) return res.status(400).json({ error: "Укажите курс / аттестацию" });
  if (!RESULTS.includes(result)) return res.status(400).json({ error: "Неизвестный результат" });
  if (!DATE_RE.test(date)) return res.status(400).json({ error: "Укажите дату" });
  db.prepare("INSERT INTO training(staff_id,course,result,date,examiner,notes) VALUES(?,?,?,?,?,?)")
    .run(s.id, course, result, date, str(b.examiner, 100), str(b.notes, 1000));
  audit(s, "Запись об аттестации", course + " — " + result, req.session.user.username);
  res.json({ ok: true });
});

// Проверка жетона: по решению проекта доступна только после входа.
app.get("/api/verify/:token", auth, (req, res) => {
  const user = req.session.user.username;
  if (verifyLimiter.blocked(user)) return res.status(429).json({ error: "Слишком много проверок. Подождите минуту." });
  verifyLimiter.hit(user);
  const token = String(req.params.token || "").trim();
  if (!/^\d{3}-\d{3}$/.test(token)) return res.status(400).json({ error: "Введите жетон в формате 000-000" });
  const s = db.prepare("SELECT * FROM staff WHERE token=?").get(token);
  log("Проверка жетона", token, user);
  if (!s) return res.status(404).json({ found: false, error: "Сотрудник с таким жетоном не найден" });
  const c = credFor(s.id);
  const expired = !!(c && c.expires_on && c.expires_on < todayStr());
  let reason = "";
  if (!c) reason = "Удостоверение не оформлено";
  else if (s.status !== "Служит") reason = "Сотрудник не числится на службе (статус: " + s.status + ")";
  else if (c.status !== "Действует") reason = "Статус удостоверения: " + c.status;
  else if (expired) reason = "Срок действия удостоверения истёк " + c.expires_on;
  res.json({ found: true, valid: !reason, ...safePublic(s, c, reason) });
});

app.get("/api/my-case", auth, (req, res) => {
  const u = req.session.user;
  const name = u.username.toLowerCase();
  // lower() в SQLite не понимает кириллицу, поэтому сравнение делаем в JS.
  const s = db.prepare("SELECT * FROM staff WHERE nickname<>'' OR discord<>''").all()
    .find(x => String(x.nickname || "").toLowerCase() === name || String(x.discord || "").toLowerCase() === name);
  if (!s) return res.json({ found: false });
  const c = credFor(s.id);
  const safe = {
    id: s.id, fio: s.fio, dob: s.dob, phone: s.phone, token: s.token, org: s.org, unit: s.unit, position: s.position,
    rank: s.rank, status: s.status, portrait_path: s.portrait_path,
    credential: c ? { credential_no: c.credential_no, issued_on: c.issued_on, expires_on: c.expires_on, status: c.status } : null
  };
  const rows = db.prepare("SELECT action,details,created_at FROM history WHERE staff_id=? ORDER BY id DESC LIMIT 100").all(s.id);
  res.json({ found: true, staff: safe, history: rows });
});

app.get("/api/public/organizations", (req, res) => res.json(ORGS));

app.get("/api/users", role("main_admin"), (req, res) =>
  res.json(db.prepare("SELECT id,username,role,org,active,created_at FROM users ORDER BY username").all()));

app.post("/api/users", role("main_admin"), (req, res) => {
  const b = req.body || {};
  const username = str(b.username, 40), password = String(b.password || "");
  const org = str(b.org, 60) || null;
  if (username.length < 3) return res.status(400).json({ error: "Логин должен быть не короче 3 символов" });
  if (password.length < 10) return res.status(400).json({ error: "Пароль должен быть не короче 10 символов" });
  if (!USER_ROLES.includes(b.role)) return res.status(400).json({ error: "Неизвестная роль" });
  if (org && !ORGS[org]) return res.status(400).json({ error: "Неизвестная организация" });
  if (["org_head", "hr"].includes(b.role) && !org) return res.status(400).json({ error: "Для руководителя и кадровика укажите организацию" });
  try {
    db.prepare("INSERT INTO users(username,password_hash,role,org) VALUES(?,?,?,?)").run(username, bcrypt.hashSync(password, 12), b.role, org);
    log("Создан пользователь", username + " (" + b.role + ")", req.session.user.username);
    res.json({ ok: true });
  } catch (e) {
    if (isUnique(e)) return res.status(409).json({ error: "Такой логин уже существует" });
    throw e;
  }
});

// Отключение/включение пользователя и сброс пароля.
app.patch("/api/users/:id", role("main_admin"), (req, res) => {
  const t = db.prepare("SELECT * FROM users WHERE id=?").get(Number(req.params.id));
  if (!t) return res.status(404).json({ error: "Пользователь не найден" });
  const b = req.body || {};
  const actor = req.session.user;
  if (b.active !== undefined) {
    if (t.id === actor.id) return res.status(400).json({ error: "Нельзя отключить собственную учётную запись" });
    if (t.role === "main_admin") return res.status(400).json({ error: "Нельзя отключить главного администратора" });
    db.prepare("UPDATE users SET active=? WHERE id=?").run(b.active ? 1 : 0, t.id);
    log(b.active ? "Пользователь включён" : "Пользователь отключён", t.username, actor.username);
  }
  if (b.password !== undefined) {
    const np = String(b.password);
    if (np.length < 10) return res.status(400).json({ error: "Пароль должен быть не короче 10 символов" });
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(np, 12), t.id);
    log("Сброс пароля", t.username, actor.username);
  }
  res.json({ ok: true });
});

app.get("/api/audit", role("main_admin", "technical_admin"), (req, res) =>
  res.json(db.prepare("SELECT * FROM access_log ORDER BY id DESC LIMIT 500").all()));

// Неизвестные /api-пути — JSON, а не HTML-страница.
app.use("/api", (req, res) => res.status(404).json({ error: "Метод не найден" }));

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// Единый обработчик ошибок: всегда JSON.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  const msg = status === 413 ? "Слишком большой запрос" : status === 404 ? "Не найдено" : status < 500 ? "Неверный запрос" : "Внутренняя ошибка сервера";
  res.status(status).json({ error: msg });
});

app.listen(PORT, () => console.log(`KordRP registry listening on ${PORT}`));
