"use strict";
// Работающие резервные копии: снимок живой базы, расписание, отправка в GitHub.
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { db } = require("./db");
const B = require("./bk");

const boot = global.__KR_BOOT || { restored: "", remote: B.remoteConfigured() ? "synced" : "none", note: "" };
const state = {
  remoteSynced: boot.remote === "synced",
  local: { at: null, name: "", error: "" },
  remote: { at: null, error: boot.remote === "failed" ? boot.note : "", pushes: 0 },
  restored: boot.restored, note: boot.note
};
let dirty = false, timer = null, lastRemote = 0, running = null;

async function snapshotGz() {
  const tmp = path.join(os.tmpdir(), "kr-" + crypto.randomBytes(6).toString("hex") + ".sqlite");
  try { await db.backup(tmp); return zlib.gzipSync(fs.readFileSync(tmp)); }
  finally { fs.rmSync(tmp, { force: true }); }
}

// opts.remote: отправлять ли в GitHub (если настроено и синхронизировано); opts.force: игнорировать флаг синхронизации.
async function runBackup(reason, opts = {}) {
  if (running) return running;
  running = (async () => {
    const out = { local: null, remote: null };
    try {
      const gz = await snapshotGz();
      try { out.local = B.saveLocal(gz); state.local = { at: new Date().toISOString(), name: out.local, error: "" }; }
      catch (e) { state.local.error = e.message; out.localError = e.message; }
      if (opts.remote !== false && B.remoteConfigured()) {
        if (!state.remoteSynced && !opts.force) { out.remote = "пропущено: сервер стартовал без доступа к GitHub-копии, чтобы не затереть её пустой базой"; }
        else {
          try { await B.remotePush(gz); state.remote = { at: new Date().toISOString(), error: "", pushes: state.remote.pushes + 1 }; state.remoteSynced = true; lastRemote = Date.now(); out.remote = "ok"; }
          catch (e) { state.remote.error = e.message; out.remote = "ошибка: " + e.message; console.error("[backup] GitHub:", e.message); }
        }
      }
    } catch (e) { console.error("[backup] ошибка снимка:", e.message); out.error = e.message; }
    return out;
  })().finally(() => { running = null; });
  return running;
}

// Пометка «данные менялись»: копия уйдёт через 3 минуты тишины, но не чаще раза в 10 минут.
function markDirty() {
  dirty = true;
  if (timer || !B.remoteConfigured()) return;
  const wait = Math.max(3 * 60e3, lastRemote + 10 * 60e3 - Date.now());
  timer = setTimeout(async () => { timer = null; if (dirty) { dirty = false; await runBackup("auto"); } }, wait);
}

function start() {
  setTimeout(() => runBackup("startup", { remote: false }), 30e3).unref();
  const every = Math.max(1, Number(process.env.BACKUP_INTERVAL_HOURS) || 6) * 3600e3;
  setInterval(() => { dirty = false; runBackup("interval"); }, every).unref();
  let closing = false;
  const bye = sig => async () => {
    if (closing) return; closing = true;
    console.log(`[backup] ${sig}: финальная копия…`);
    try { await Promise.race([runBackup("shutdown"), new Promise(r => setTimeout(r, 9000))]); } catch { /* ignore */ }
    try { db.close(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on("SIGTERM", bye("SIGTERM")); process.on("SIGINT", bye("SIGINT"));
}

function checkDb() {
  const rep = [];
  const add = (name, ok, detail = "") => rep.push({ name, ok, detail });
  const ic = db.pragma("integrity_check", { simple: true });
  add("Целостность файла базы (integrity_check)", ic === "ok", ic === "ok" ? "" : String(ic));
  const fk = db.pragma("foreign_key_check");
  add("Связи между таблицами (foreign_key_check)", !fk.length, fk.length ? "Нарушений: " + fk.length : "");
  const noRole = db.prepare("SELECT username,role FROM users WHERE role<>'main_admin' AND role NOT IN (SELECT id FROM roles)").all();
  add("У всех пользователей существует роль", !noRole.length, noRole.map(r => r.username + " → " + r.role).join(", "));
  const noOrg = db.prepare("SELECT DISTINCT org FROM staff WHERE org NOT IN (SELECT name FROM orgs)").all();
  add("Все дела относятся к существующим организациям", !noOrg.length, noOrg.map(r => r.org).join(", "));
  const admins = db.prepare("SELECT COUNT(*) n FROM users WHERE role='main_admin' AND active=1").get().n;
  add("Есть активный главный администратор", admins > 0, admins ? "" : "Войти будет некому");
  const refs = [...db.prepare("SELECT portrait_path p FROM staff UNION SELECT badge_path FROM staff UNION SELECT avatar_path FROM profiles UNION SELECT image_path FROM credentials").all().map(r => r.p).filter(Boolean)];
  const have = new Set(db.prepare("SELECT name FROM files").all().map(r => "/uploads/" + r.name));
  const missing = refs.filter(p => p.startsWith("/uploads/") && !have.has(p));
  add("Все загруженные фото на месте", !missing.length, missing.length ? "Нет файлов: " + missing.length : "");
  const orphan = [...have].filter(p => !refs.includes(p));
  add("Лишние файлы", true, orphan.length ? `${orphan.length} неиспользуемых (можно очистить)` : "нет");
  const stale = db.prepare("SELECT COUNT(*) n FROM credentials c JOIN staff s ON s.id=c.staff_id WHERE c.status='Действует' AND (s.status<>'Служит' OR s.archived=1)").get().n;
  add("Статусы удостоверений согласованы с делами", !stale, stale ? stale + " расхождений" : "");
  return { ok: rep.every(r => r.ok), report: rep, orphans: orphan.length };
}
function cleanupFiles() {
  const refs = new Set(db.prepare("SELECT portrait_path p FROM staff UNION SELECT badge_path FROM staff UNION SELECT avatar_path FROM profiles UNION SELECT image_path FROM credentials").all().map(r => r.p).filter(Boolean));
  let n = 0;
  for (const f of db.prepare("SELECT name FROM files").all()) if (!refs.has("/uploads/" + f.name)) { db.prepare("DELETE FROM files WHERE name=?").run(f.name); n++; }
  return n;
}
module.exports = { state, runBackup, markDirty, start, snapshotGz, checkDb, cleanupFiles };
