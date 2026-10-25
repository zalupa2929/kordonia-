"use strict";
// KordRP — реестр личных дел. Запускается через boot.js (он готовит базу и восстанавливает данные).
require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const C = require("./lib/core");
const K = require("./lib/backup");
const { db, DATA_DIR } = require("./lib/db");

const app = express();
const IS_PROD = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT || 3000);

// ---------- Секреты ----------
const DEFAULT_SECRET = "development-only-change-me";
const DEFAULT_ADMIN_PASS = "change-this-immediately";
const ENV_SECRET = (process.env.SESSION_SECRET || "").trim();
const ENV_PASS = process.env.ADMIN_PASSWORD || "";
const ENV_NAME = (process.env.ADMIN_USERNAME || "").trim();
const ADMIN_NAME = ENV_NAME || "admin";
const weakSecret = !!ENV_SECRET && (ENV_SECRET === DEFAULT_SECRET || ENV_SECRET.startsWith("replace-this") || ENV_SECRET.length < 24);
const weakPass = !!ENV_PASS && (ENV_PASS === DEFAULT_ADMIN_PASS || ENV_PASS.length < 10);
if (weakSecret || weakPass) {
  const msg = "заданы слабые значения: " + [weakSecret && "SESSION_SECRET (нужно 24+ символа)", weakPass && "ADMIN_PASSWORD (нужно 10+ символов)"].filter(Boolean).join(", ");
  if (IS_PROD) { console.error("ОШИБКА: " + msg + ". Исправьте их в Environment или удалите переменные — тогда значения создадутся автоматически."); process.exit(1); }
  console.warn("ВНИМАНИЕ: " + msg + ". Допустимо только для локальной проверки.");
}
function loadSessionSecret() {
  if (ENV_SECRET) return ENV_SECRET;
  const f = path.join(DATA_DIR, "session.secret");
  try { const v = fs.readFileSync(f, "utf8").trim(); if (v.length >= 24) return v; } catch { /* создадим ниже */ }
  const v = crypto.randomBytes(32).toString("hex");
  try { fs.writeFileSync(f, v, { mode: 0o600 }); } catch { /* секрет живёт до перезапуска */ }
  return v;
}
const SESSION_SECRET = loadSessionSecret();
const GENERATED_ADMIN_PASS = ENV_PASS ? null : crypto.randomBytes(9).toString("base64url");

// ---------- Главный администратор ----------
(function ensureAdmin() {
  const exists = db.prepare("SELECT id FROM users WHERE username=?").get(ADMIN_NAME);
  if (exists) return;
  const mains = db.prepare("SELECT id,username FROM users WHERE role='main_admin'").all();
  // Переименование старого логина (owner1/admin) в ADMIN_USERNAME с сохранением пароля.
  const legacy = ENV_NAME && mains.length === 1 && (["owner1", "admin"].includes(mains[0].username) || mains[0].username === process.env.ADMIN_RENAME_FROM);
  if (legacy) {
    db.prepare("UPDATE users SET username=? WHERE id=?").run(ADMIN_NAME, mains[0].id);
    C.log("Логин главного администратора изменён", mains[0].username + " → " + ADMIN_NAME);
    console.log(`Логин главного администратора изменён: ${mains[0].username} → ${ADMIN_NAME} (пароль прежний).`);
    return;
  }
  if (mains.length && !ENV_NAME) return; // админ уже есть, лишнего не создаём
  const pass = ENV_PASS || GENERATED_ADMIN_PASS;
  db.prepare("INSERT INTO users(username,password_hash,role) VALUES(?,?,?)").run(ADMIN_NAME, bcrypt.hashSync(pass, 12), "main_admin");
  if (GENERATED_ADMIN_PASS) {
    console.log("==================================================");
    console.log(" Создан главный администратор (пароль показан один раз):");
    console.log("   логин:  " + ADMIN_NAME);
    console.log("   пароль: " + GENERATED_ADMIN_PASS);
    console.log(" Войдите и сразу смените пароль кнопкой «Сменить пароль».");
    console.log("==================================================");
  } else console.log("Главный администратор создан из ADMIN_USERNAME / ADMIN_PASSWORD.");
})();

// ---------- Middleware ----------
app.disable("x-powered-by");
if (IS_PROD) app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https:"], connectSrc: ["'self'"], objectSrc: ["'none'"],
      baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"]
    }
  },
  crossOriginResourcePolicy: { policy: "same-origin" }
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

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
    setInterval(() => { try { this.qClean.run(Date.now()); } catch { /* ignore */ } }, 15 * 60 * 1000).unref();
  }
  expiry(sess) { const e = sess && sess.cookie && sess.cookie.expires; return e ? new Date(e).getTime() : Date.now() + 8 * 3600e3; }
  get(sid, cb) { try { const r = this.qGet.get(sid, Date.now()); cb(null, r ? JSON.parse(r.sess) : null); } catch (e) { cb(e); } }
  set(sid, sess, cb) { try { this.qSet.run(sid, JSON.stringify(sess), this.expiry(sess)); cb && cb(null); } catch (e) { cb && cb(e); } }
  destroy(sid, cb) { try { this.qDel.run(sid); cb && cb(null); } catch (e) { cb && cb(e); } }
  touch(sid, sess, cb) { try { this.qTouch.run(this.expiry(sess), sid); cb && cb(null); } catch (e) { cb && cb(e); } }
}
app.use(session({
  store: new SqliteSessionStore(db), secret: SESSION_SECRET, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: IS_PROD, maxAge: 8 * 3600e3 }
}));

// Защита от CSRF: изменяющие запросы несут собственный заголовок и тот же Origin.
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
  if (u.username !== su.username || u.role !== su.role || u.org !== su.org) req.session.user = { id: u.id, username: u.username, role: u.role, org: u.org };
  next();
});
// Любое успешное изменение данных ставит резервную копию в очередь.
app.use("/api", (req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) res.on("finish", () => { if (res.statusCode < 400 && !req.path.startsWith("/backup")) K.markDirty(); });
  next();
});

// Файлы (фото) лежат в базе и видны только вошедшим.
app.get("/uploads/:name", C.auth, (req, res) => {
  const name = req.params.name;
  const f = /^[A-Za-z0-9._-]+$/.test(name) ? db.prepare("SELECT mime,data FROM files WHERE name=?").get(name) : null;
  if (!f) return res.status(404).end();
  res.set({ "Content-Type": f.mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600" });
  res.send(f.data);
});

require("./routes/auth")(app);
require("./routes/staff")(app);
require("./routes/people")(app);
require("./routes/admin")(app);
require("./routes/backup")(app);

app.get("/healthz", (req, res) => res.json({ ok: true }));
app.use("/api", (req, res) => res.status(404).json({ error: "Метод не найден" }));
app.use(express.static(path.join(__dirname, "public"), { setHeaders: res => res.set("Cache-Control", "no-cache") }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  const msg = err.isUser ? err.message : status === 413 ? "Слишком большой запрос" : status === 404 ? "Не найдено" : status < 500 ? "Неверный запрос" : "Внутренняя ошибка сервера";
  res.status(status).json({ error: msg });
});
process.on("unhandledRejection", e => console.error("unhandledRejection:", e));

app.listen(PORT, () => { console.log(`KordRP registry listening on ${PORT}`); K.start(); });
