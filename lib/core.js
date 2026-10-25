"use strict";
// Общие помощники: проверки прав, организации, личные дела, файлы.
const multer = require("multer");
const crypto = require("crypto");
const { db, PERM_IDS } = require("./db");

const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_RE = /^\d{3}-\d{3}$/;
const okDate = v => v === "" || (DATE_RE.test(v) && !Number.isNaN(Date.parse(v)));
const todayStr = () => new Date().toISOString().slice(0, 10);
const isUnique = e => e && String(e.code || "").startsWith("SQLITE_CONSTRAINT");
const bool = v => v === true || v === 1 || v === "1" || v === "true" || v === "on";

function log(action, target = "", username = "system") {
  db.prepare("INSERT INTO access_log(username,action,target) VALUES(?,?,?)").run(str(username, 100), action, str(target, 200));
}
function audit(staff, action, details = "", actor = "system") {
  db.prepare("INSERT INTO history(staff_id,fio,org,action,details,actor) VALUES(?,?,?,?,?,?)")
    .run(staff?.id || null, staff?.fio || "—", staff?.org || "—", action, details, actor);
}
function careerAdd(o) {
  return db.prepare("INSERT INTO career(staff_id,user_id,kind,date,title,details,status,org,order_id,actor) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(o.staff_id || null, o.user_id || null, o.kind, o.date || todayStr(), str(o.title, 200), str(o.details, 1000), str(o.status, 40), o.org || null, o.order_id || null, o.actor || "system");
}

function makeLimiter(max, windowMs) {
  const hits = new Map();
  const entry = key => {
    const now = Date.now();
    let e = hits.get(key);
    if (!e || e.reset < now) { e = { n: 0, reset: now + windowMs }; hits.set(key, e); }
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return e;
  };
  return { blocked: k => entry(k).n >= max, hit: k => { entry(k).n++; }, clear: k => hits.delete(k) };
}

// ---------- Роли и права ----------
let rolePerms = new Map(), roleScope = new Map(), roleTitle = new Map();
function loadRoles() {
  rolePerms = new Map(); roleScope = new Map(); roleTitle = new Map();
  for (const r of db.prepare("SELECT id,title,scope FROM roles").all()) { rolePerms.set(r.id, new Set()); roleScope.set(r.id, r.scope); roleTitle.set(r.id, r.title); }
  for (const p of db.prepare("SELECT role,perm FROM role_perms").all()) rolePerms.get(p.role)?.add(p.perm);
}
loadRoles();
const can = (u, perm) => !!u && (u.role === "main_admin" || (rolePerms.get(u.role)?.has(perm) ?? false));
const scopeAll = u => !!u && (u.role === "main_admin" || roleScope.get(u.role) === "all");
const orgOK = (u, org) => scopeAll(u) || (!!u?.org && u.org === org);
const permsOf = u => u.role === "main_admin" ? PERM_IDS.slice() : [...(rolePerms.get(u.role) || [])];
const roleName = id => id === "main_admin" ? "Главный администратор" : (roleTitle.get(id) || id);
const roleExists = id => rolePerms.has(id);

function auth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Требуется вход" });
  next();
}
const need = perm => (req, res, next) => {
  const u = req.session.user;
  if (!u) return res.status(401).json({ error: "Требуется вход" });
  if (!can(u, perm)) return res.status(403).json({ error: "Недостаточно прав" });
  next();
};
const adminOnly = (req, res, next) => {
  const u = req.session.user;
  if (!u) return res.status(401).json({ error: "Требуется вход" });
  if (u.role !== "main_admin") return res.status(403).json({ error: "Только для главного администратора" });
  next();
};

// ---------- Организации ----------
function orgTree() {
  const orgs = db.prepare("SELECT id,name,color,sort FROM orgs ORDER BY sort,id").all();
  const items = db.prepare("SELECT id,org_id,kind,name,stars FROM org_items ORDER BY sort,id").all();
  return orgs.map(o => {
    const mine = items.filter(i => i.org_id === o.id);
    return {
      id: o.id, name: o.name, color: o.color,
      ranks: mine.filter(i => i.kind === "rank").map(i => ({ id: i.id, name: i.name, stars: i.stars })),
      positions: mine.filter(i => i.kind === "position").map(i => ({ id: i.id, name: i.name })),
      units: mine.filter(i => i.kind === "unit").map(i => ({ id: i.id, name: i.name }))
    };
  });
}
const orgExists = name => !!db.prepare("SELECT 1 FROM orgs WHERE name=?").get(name);
const rankExists = (org, rank) => !!db.prepare("SELECT 1 FROM org_items i JOIN orgs o ON o.id=i.org_id WHERE o.name=? AND i.kind='rank' AND i.name=?").get(org, rank);
function maps() {
  const colors = new Map(db.prepare("SELECT name,color FROM orgs").all().map(o => [o.name, o.color]));
  const stars = new Map(db.prepare("SELECT o.name org,i.name rank,i.stars FROM org_items i JOIN orgs o ON o.id=i.org_id WHERE i.kind='rank'").all().map(r => [r.org + "|" + r.rank, r.stars]));
  return { colors, stars };
}

// ---------- Личные дела ----------
const staffRow = id => db.prepare("SELECT * FROM staff WHERE id=?").get(id);
const credFor = id => db.prepare("SELECT * FROM credentials WHERE staff_id=? ORDER BY id DESC LIMIT 1").get(id);
const credStatusFor = s => (s.status === "Служит" && !s.archived) ? "Действует" : "Недействительно";

const canEditStaff = (u, s) => can(u, "staff.edit") && orgOK(u, s.org);
const canSeeClassified = (u, s) => u.role === "main_admin" || (can(u, "classified.view") && orgOK(u, s.org));
function staffVisible(s, u) {
  if (s.archived) return can(u, "staff.remove") && orgOK(u, s.org);
  if (!s.published) return canEditStaff(u, s);
  return true;
}
// Безопасное представление дела для конкретного пользователя (маска засекреченных, приватные поля).
function staffView(s, u, m = maps(), opts = {}) {
  const secretOK = opts.owner || canSeeClassified(u, s);
  const masked = !!s.classified && !secretOK;
  const priv = !masked && (opts.owner || (can(u, "staff.private") && orgOK(u, s.org)));
  const c = credFor(s.id);
  const x = {
    id: s.id, token: s.token, org: s.org, unit: s.unit || "", position: s.position, rank: s.rank || "", status: s.status,
    published: s.published, archived: s.archived, archive_reason: s.archive_reason || "", classified: s.classified, masked,
    stars: m.stars.get(s.org + "|" + s.rank) ?? (s.rank ? 1 : 0), color: m.colors.get(s.org) || "#6b7a99",
    fio: masked ? "Засекречено" : s.fio,
    portrait_path: masked ? (s.badge_path || null) : (s.portrait_path || null),
    badge_path: secretOK ? (s.badge_path || null) : null,
    created_at: s.created_at, updated_at: s.updated_at,
    credential: c ? { credential_no: c.credential_no, issued_on: c.issued_on, expires_on: c.expires_on, status: c.status, image_path: c.image_path || null } : null
  };
  if (priv) { x.dob = s.dob; x.passport = s.passport; x.phone = s.phone; x.nickname = s.nickname; x.discord = s.discord; }
  return x;
}

// ---------- Файлы (хранятся в базе, чтобы попадать в резервные копии) ----------
const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, !!EXT[file.mimetype])
});
function looksLikeImage(buf, mime) {
  if (!buf || buf.length < 12) return false;
  if (mime === "image/jpeg") return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === "image/png") return buf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (mime === "image/webp") return buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP";
  return false;
}
// Middleware: принимает поле "image", проверяет содержимое, кладёт в req.img = {buf, mime}.
function imageUpload(req, res, next) {
  memUpload.single("image")(req, res, err => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "Файл больше 3 МБ" });
      return next(err);
    }
    if (!req.file) return res.status(400).json({ error: "Выберите JPG, PNG или WEBP до 3 МБ" });
    if (!looksLikeImage(req.file.buffer, req.file.mimetype)) return res.status(400).json({ error: "Файл не является допустимым изображением" });
    req.img = { buf: req.file.buffer, mime: req.file.mimetype };
    next();
  });
}
function saveImage(img) {
  const name = crypto.randomUUID() + EXT[img.mime];
  db.prepare("INSERT INTO files(name,mime,data) VALUES(?,?,?)").run(name, img.mime, img.buf);
  return "/uploads/" + name;
}
function dropFile(p) {
  if (p && String(p).startsWith("/uploads/")) db.prepare("DELETE FROM files WHERE name=?").run(String(p).slice(9));
}
function imageData(p) {
  if (!p || !String(p).startsWith("/uploads/")) return null;
  return db.prepare("SELECT mime,data FROM files WHERE name=?").get(String(p).slice(9)) || null;
}

module.exports = {
  db, str, DATE_RE, TOKEN_RE, okDate, todayStr, isUnique, bool, log, audit, careerAdd, makeLimiter,
  loadRoles, can, scopeAll, orgOK, permsOf, roleName, roleExists, auth, need, adminOnly,
  orgTree, orgExists, rankExists, maps, staffRow, credFor, credStatusFor, canEditStaff, canSeeClassified, staffVisible, staffView,
  imageUpload, saveImage, dropFile, imageData
};
