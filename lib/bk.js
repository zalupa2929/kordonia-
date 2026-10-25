"use strict";
// Резервные копии без открытия рабочей базы: шифрование, GitHub, проверка файла, подготовка восстановления.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
const DB_FILE = path.join(DATA_DIR, "kordrp.sqlite");
const PENDING = path.join(DATA_DIR, "restore.pending.sqlite");
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(DATA_DIR, "backups"));
const KEY = (process.env.BACKUP_KEY || "").trim();
const GH = {
  token: (process.env.BACKUP_GITHUB_TOKEN || "").trim(),
  repo: (process.env.BACKUP_GITHUB_REPO || "").trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, ""),
  branch: (process.env.BACKUP_GITHUB_BRANCH || "data-backup").trim(),
  file: "kordrp-backup.kbk"
};
const remoteConfigured = () => !!(GH.token && GH.repo && KEY.length >= 12);
const remoteProblem = () => {
  if (!GH.token && !GH.repo && !KEY) return "";
  if (!GH.token) return "не задан BACKUP_GITHUB_TOKEN";
  if (!GH.repo) return "не задан BACKUP_GITHUB_REPO";
  if (KEY.length < 12) return "BACKUP_KEY должен быть не короче 12 символов";
  return "";
};

// ---- шифрование: KRB1 | соль(16) | iv(12) | tag(16) | данные (AES-256-GCM, ключ из scrypt) ----
function encrypt(buf) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", crypto.scryptSync(KEY, salt, 32), iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([Buffer.from("KRB1"), salt, iv, c.getAuthTag(), ct]);
}
function decrypt(buf) {
  if (!KEY) throw new Error("Для расшифровки нужен BACKUP_KEY");
  const salt = buf.subarray(4, 20), iv = buf.subarray(20, 32), tag = buf.subarray(32, 48), ct = buf.subarray(48);
  const d = crypto.createDecipheriv("aes-256-gcm", crypto.scryptSync(KEY, salt, 32), iv);
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(ct), d.final()]); }
  catch { throw new Error("Не удалось расшифровать копию: неверный BACKUP_KEY или файл повреждён"); }
}
// Любой поддерживаемый формат → сырой SQLite-файл (Buffer).
function toSqlite(buf) {
  if (buf.length > 4 && buf.subarray(0, 4).toString() === "KRB1") buf = decrypt(buf);
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  if (buf.subarray(0, 15).toString() !== "SQLite format 3") throw new Error("Файл не похож на копию базы KordRP");
  return buf;
}
function validateDbFile(file) {
  let d;
  try {
    d = new Database(file, { readonly: true, fileMustExist: true });
    const ic = d.pragma("integrity_check", { simple: true });
    if (ic !== "ok") return { ok: false, error: "Проверка целостности: " + ic };
    const t = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','staff')").all().map(x => x.name);
    if (!t.includes("users") || !t.includes("staff")) return { ok: false, error: "В файле нет таблиц KordRP (users, staff)" };
    return { ok: true, users: d.prepare("SELECT COUNT(*) n FROM users").get().n, staff: d.prepare("SELECT COUNT(*) n FROM staff").get().n };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { try { d && d.close(); } catch { /* ignore */ } }
}
function stageRestore(sqliteBuf) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = PENDING + ".tmp";
  fs.writeFileSync(tmp, sqliteBuf);
  const v = validateDbFile(tmp);
  if (!v.ok) { fs.rmSync(tmp, { force: true }); throw new Error(v.error); }
  fs.renameSync(tmp, PENDING);
  return v;
}

// ---- локальные копии ----
function listLocal() {
  try {
    return fs.readdirSync(BACKUP_DIR).filter(f => /^kordrp-.*\.sqlite\.gz$/.test(f)).map(f => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, size: st.size, created: st.mtime.toISOString() };
    }).sort((a, b) => b.created.localeCompare(a.created));
  } catch { return []; }
}
function saveLocal(gz, keep = 24) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = "kordrp-" + new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-") + ".sqlite.gz";
  fs.writeFileSync(path.join(BACKUP_DIR, name), gz);
  listLocal().slice(keep).forEach(f => fs.rmSync(path.join(BACKUP_DIR, f.name), { force: true }));
  return name;
}

// ---- GitHub (отдельная ветка, чтобы пуши не запускали деплой сайта) ----
async function gh(method, url, { body, accept, raw } = {}) {
  const r = await fetch((process.env.BACKUP_GITHUB_API || "https://api.github.com") + "/repos/" + GH.repo + url, {
    method, signal: AbortSignal.timeout(25000),
    headers: { Authorization: "Bearer " + GH.token, "User-Agent": "kordrp-backup", "X-GitHub-Api-Version": "2022-11-28", Accept: accept || "application/vnd.github+json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (raw && r.ok) return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* не JSON */ }
  return { status: r.status, ok: r.ok, json, text };
}
const ghErr = r => `GitHub ${r.status}: ${(r.json && r.json.message) || String(r.text || "").slice(0, 120)}`;
async function ensureBranch() {
  const b = await gh("GET", "/branches/" + encodeURIComponent(GH.branch));
  if (b.ok) return;
  if (b.status !== 404) throw new Error(ghErr(b));
  const repo = await gh("GET", "");
  if (!repo.ok) throw new Error(ghErr(repo) + (repo.status === 404 ? " (репозиторий не найден или у токена нет доступа)" : ""));
  const ref = await gh("GET", "/git/ref/heads/" + encodeURIComponent(repo.json.default_branch));
  if (!ref.ok) throw new Error(ghErr(ref) + " — репозиторий должен содержать хотя бы один коммит (создайте его с README)");
  const mk = await gh("POST", "/git/refs", { body: { ref: "refs/heads/" + GH.branch, sha: ref.json.object.sha } });
  if (!mk.ok && mk.status !== 422) throw new Error(ghErr(mk));
}
async function remotePush(gz) {
  await ensureBranch();
  const p = "/contents/" + GH.file;
  const cur = await gh("GET", p + "?ref=" + encodeURIComponent(GH.branch));
  const sha = cur.ok ? cur.json.sha : null;
  if (!cur.ok && cur.status !== 404) throw new Error(ghErr(cur));
  const put = await gh("PUT", p, { body: { message: "backup " + new Date().toISOString(), content: encrypt(gz).toString("base64"), branch: GH.branch, ...(sha ? { sha } : {}) } });
  if (!put.ok) throw new Error(ghErr(put));
}
// null — копии в GitHub ещё нет; бросает ошибку при сбое сети/прав.
async function remotePull() {
  const r = await gh("GET", "/contents/" + GH.file + "?ref=" + encodeURIComponent(GH.branch), { accept: "application/vnd.github.raw+json", raw: true });
  if (r.buf) return r.buf;
  if (r.status === 404) return null;
  throw new Error(ghErr(r));
}

module.exports = { DATA_DIR, DB_FILE, PENDING, BACKUP_DIR, GH, KEY, remoteConfigured, remoteProblem, encrypt, decrypt, toSqlite, validateDbFile, stageRestore, listLocal, saveLocal, remotePush, remotePull };
