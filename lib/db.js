"use strict";
// Открытие базы, схема, миграции и начальные данные.
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads"); // только для импорта старых файлов
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, "kordrp.sqlite");

const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
db.pragma("synchronous = NORMAL");

// ---------- Права ----------
// Список прав, которые главный администратор раздаёт ролям на вкладке «Права».
const PERMS = [
  ["staff.view", "Реестр", "Видеть реестр сотрудников"],
  ["staff.private", "Реестр", "Видеть паспорт, телефон, ник и Discord сотрудников"],
  ["staff.edit", "Реестр", "Создавать и редактировать личные дела"],
  ["staff.publish", "Реестр", "Публиковать дело (выдаёт удостоверение)"],
  ["staff.remove", "Реестр", "Исключать из организации и возвращать дело"],
  ["staff.delete", "Реестр", "Удалять дело полностью"],
  ["credentials.manage", "Реестр", "Менять номер и даты удостоверения"],
  ["classified.set", "Секретность", "Ставить и снимать отметку «засекреченная личность»"],
  ["classified.view", "Секретность", "Видеть засекреченные личности без маски"],
  ["case.others", "Дела", "Открывать чужие личные дела"],
  ["training.view", "Аттестации", "Видеть аттестации"],
  ["training.manage", "Аттестации", "Добавлять аттестации"],
  ["training.delete", "Аттестации", "Удалять аттестации"],
  ["history.view", "История", "Видеть историю изменений"],
  ["orders.view", "Приказы", "Видеть кадровые приказы"],
  ["orders.create", "Приказы", "Издавать кадровые приказы"],
  ["career.view", "Трудовая", "Видеть трудовую (с судимостями) в профиле игрока"],
  ["career.manage", "Трудовая", "Вносить и удалять записи трудовой, судимости"],
  ["players.search", "Игроки", "Искать профили игроков (где работает, жетон, № удостоверения)"],
  ["players.passport", "Игроки", "Видеть паспорт в профиле игрока"],
  ["orgs.manage", "Организации", "Менять организации, звания, должности, подразделения"],
  ["audit.view", "Система", "Видеть журнал действий"]
];
const PERM_IDS = PERMS.map(p => p[0]);
const ALL_BUT_ADMIN = PERM_IDS.filter(p => p !== "staff.delete");
const DEFAULT_ROLES = {
  technical_admin: { title: "Технический администратор", scope: "all", perms: ["staff.view", "staff.private", "case.others", "history.view", "training.view", "orders.view", "career.view", "players.search", "players.passport", "audit.view"] },
  org_head: { title: "Руководитель организации", scope: "own", perms: ALL_BUT_ADMIN.filter(p => !["orgs.manage", "audit.view"].includes(p)) },
  hr: { title: "Кадровик", scope: "own", perms: ALL_BUT_ADMIN.filter(p => !["orgs.manage", "audit.view", "classified.set"].includes(p)) },
  investigator: { title: "Следствие / надзор", scope: "all", perms: ["staff.view", "case.others", "history.view", "training.view", "players.search"] },
  viewer: { title: "Просмотр", scope: "own", perms: ["staff.view"] }
};

// ---------- Схема ----------
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
CREATE TABLE IF NOT EXISTS registrations (
 id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, password_hash TEXT NOT NULL,
 fio TEXT NOT NULL, nickname TEXT NOT NULL DEFAULT '', discord TEXT NOT NULL DEFAULT '', token TEXT NOT NULL DEFAULT '', passport TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'Ожидает', decided_by TEXT, decided_at TEXT, decision_note TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS profiles (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 fio TEXT NOT NULL DEFAULT '', nickname TEXT NOT NULL DEFAULT '', discord TEXT NOT NULL DEFAULT '',
 token TEXT NOT NULL DEFAULT '', passport TEXT NOT NULL DEFAULT '', avatar_path TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, title TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'own', builtin INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS role_perms (role TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE, perm TEXT NOT NULL, PRIMARY KEY(role, perm));
CREATE TABLE IF NOT EXISTS orgs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, color TEXT NOT NULL DEFAULT '#6b7a99', sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS org_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('rank','position','unit')), name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
 stars INTEGER NOT NULL DEFAULT 0, UNIQUE(org_id, kind, name)
);
CREATE TABLE IF NOT EXISTS files (name TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT UNIQUE NOT NULL, staff_id TEXT NOT NULL, fio TEXT NOT NULL, type TEXT NOT NULL,
 date TEXT NOT NULL, org TEXT, org_to TEXT, rank_from TEXT, rank_to TEXT, position_from TEXT, position_to TEXT,
 reason TEXT, actor TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS career (
 id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id TEXT, user_id INTEGER, kind TEXT NOT NULL, date TEXT NOT NULL,
 title TEXT NOT NULL, details TEXT, status TEXT, org TEXT, order_id INTEGER, actor TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS idx_cred_staff ON credentials(staff_id);
CREATE INDEX IF NOT EXISTS idx_hist_staff ON history(staff_id);
CREATE INDEX IF NOT EXISTS idx_train_staff ON training(staff_id);
CREATE INDEX IF NOT EXISTS idx_reg_status ON registrations(status);
CREATE INDEX IF NOT EXISTS idx_orders_staff ON orders(staff_id);
CREATE INDEX IF NOT EXISTS idx_career_staff ON career(staff_id);
CREATE INDEX IF NOT EXISTS idx_career_user ON career(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_token ON profiles(token) WHERE token<>'';
`);

// ---------- Миграции (идемпотентные) ----------
function addCol(table, col, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addCol("staff", "classified", "INTEGER NOT NULL DEFAULT 0");
addCol("staff", "badge_path", "TEXT");
addCol("staff", "published", "INTEGER NOT NULL DEFAULT 1"); // старые дела считаются опубликованными
addCol("staff", "archived", "INTEGER NOT NULL DEFAULT 0");
addCol("staff", "archived_at", "TEXT");
addCol("staff", "archive_reason", "TEXT");

// Звёзды на погонах по названию звания (стартовые значения, потом правятся вручную).
function starsFor(rank = "") {
  const r = String(rank).toLowerCase();
  if (/^генерал( полиции)?$|генерал армии|генерал-полковник|генерал юстиции/.test(r)) return 5;
  if (/генерал/.test(r)) return 4;
  if (/(?<![а-яё])полковник|советник юстиции 1 класса/.test(r)) return 3;
  if (/подполковник|майор|капитан|советник юстиции/.test(r)) return 2;
  return 1;
}
const ORG_COLORS = { "Правительство": "#c9a227", "Кордоновский суд": "#8b6cc0", "СК": "#3f78c4", "Прокуратура": "#2f9a73", "ДГБ": "#7d8591", "КНД": "#3a8fd5", "МВД": "#2f62b8", "ВС РК": "#6b8f3c", "ГБ": "#cf4a3c", "СМИ": "#d9822b" };

// Организации и звания: первый запуск переносит их из seed/orgs.json в базу.
if (!db.prepare("SELECT COUNT(*) n FROM orgs").get().n) {
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "seed", "orgs.json"), "utf8"));
  const insOrg = db.prepare("INSERT INTO orgs(name,color,sort) VALUES(?,?,?)");
  const insItem = db.prepare("INSERT OR IGNORE INTO org_items(org_id,kind,name,sort,stars) VALUES(?,?,?,?,?)");
  db.transaction(() => {
    let i = 0;
    for (const [name, ranks] of Object.entries(seed)) {
      const id = insOrg.run(name, ORG_COLORS[name] || "#6b7a99", i++).lastInsertRowid;
      ranks.forEach((r, j) => insItem.run(id, "rank", r, j, starsFor(r)));
    }
  })();
}
// Должности и подразделения, уже встречающиеся в личных делах, попадают в справочник.
{
  const ins = db.prepare("INSERT OR IGNORE INTO org_items(org_id,kind,name,sort,stars) SELECT id,?,?,?,0 FROM orgs WHERE name=?");
  db.transaction(() => {
    db.prepare("SELECT DISTINCT org,position FROM staff WHERE position<>''").all().forEach(r => ins.run("position", r.position, 999, r.org));
    db.prepare("SELECT DISTINCT org,unit FROM staff WHERE COALESCE(unit,'')<>''").all().forEach(r => ins.run("unit", r.unit, 999, r.org));
  })();
}

// Роли и права: первый запуск создаёт стандартные роли, дальше всё настраивается на вкладке «Права».
if (!db.prepare("SELECT COUNT(*) n FROM roles").get().n) {
  const insRole = db.prepare("INSERT INTO roles(id,title,scope,builtin) VALUES(?,?,?,1)");
  const insPerm = db.prepare("INSERT OR IGNORE INTO role_perms(role,perm) VALUES(?,?)");
  db.transaction(() => {
    for (const [id, r] of Object.entries(DEFAULT_ROLES)) { insRole.run(id, r.title, r.scope); r.perms.forEach(p => insPerm.run(id, p)); }
  })();
}

// Синхронизация статусов удостоверений со статусом сотрудника.
db.exec(`UPDATE credentials SET status = CASE
  WHEN (SELECT status FROM staff WHERE staff.id = credentials.staff_id) = 'Служит'
   AND (SELECT archived FROM staff WHERE staff.id = credentials.staff_id) = 0 THEN 'Действует' ELSE 'Недействительно' END
  WHERE status <> CASE WHEN (SELECT status FROM staff WHERE staff.id = credentials.staff_id) = 'Служит'
   AND (SELECT archived FROM staff WHERE staff.id = credentials.staff_id) = 0 THEN 'Действует' ELSE 'Недействительно' END`);

// Старые загруженные файлы (из папки uploads) переезжают в базу — так фото попадают в резервные копии.
try {
  if (fs.existsSync(UPLOAD_DIR)) {
    const MIME = { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
    const has = db.prepare("SELECT 1 FROM files WHERE name=?"), ins = db.prepare("INSERT INTO files(name,mime,data) VALUES(?,?,?)");
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
      const m = MIME[path.extname(f).toLowerCase()];
      if (m && /^[A-Za-z0-9._-]+$/.test(f) && !has.get(f)) ins.run(f, m, fs.readFileSync(path.join(UPLOAD_DIR, f)));
    }
  }
} catch (e) { console.warn("Импорт старых файлов пропущен:", e.message); }

module.exports = { db, DATA_DIR, DB_FILE, PERMS, PERM_IDS, DEFAULT_ROLES, starsFor };
