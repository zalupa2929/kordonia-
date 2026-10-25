"use strict";
const bcrypt = require("bcryptjs");
const multer = require("multer");
const C = require("../lib/core");
const B = require("../lib/bk");
const K = require("../lib/backup");
const { db, log, adminOnly } = C;

const restoreUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 150 * 1024 * 1024, files: 1 } });

function reauth(req, res) {
  const u = db.prepare("SELECT password_hash FROM users WHERE id=?").get(req.session.user.id);
  if (!u || !bcrypt.compareSync(String((req.body || {}).password || ""), u.password_hash)) { res.status(403).json({ error: "Неверный пароль администратора" }); return false; }
  return true;
}
function restartSoon() { setTimeout(() => { console.log("[backup] Перезапуск для применения восстановления"); process.exit(0); }, 700); }

module.exports = app => {
  app.get("/api/backup/status", adminOnly, (req, res) => {
    const rp = B.remoteProblem();
    res.json({
      remote: { configured: B.remoteConfigured(), problem: rp, repo: B.GH.repo, branch: B.GH.branch, synced: K.state.remoteSynced, ...K.state.remote },
      local: { ...K.state.local, files: B.listLocal(), dir: B.BACKUP_DIR }, restored: K.state.restored, note: K.state.note,
      env: { has_disk_hint: process.env.RENDER ? "render" : "" }
    });
  });
  app.post("/api/backup/run", adminOnly, async (req, res) => {
    const r = await K.runBackup("manual", { force: !!(req.body || {}).force });
    log("Резервная копия (вручную)", JSON.stringify({ local: r.local, remote: r.remote }), req.session.user.username);
    res.json({ ok: !r.error, ...r });
  });
  app.get("/api/backup/download", adminOnly, async (req, res) => {
    const gz = await K.snapshotGz();
    log("Скачана резервная копия", "", req.session.user.username);
    res.set({ "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="kordrp-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.sqlite.gz"`, "Cache-Control": "no-store" });
    res.send(gz);
  });
  app.get("/api/backup/local/:name", adminOnly, (req, res) => {
    const f = B.listLocal().find(x => x.name === req.params.name);
    if (!f) return res.status(404).json({ error: "Файл не найден" });
    res.download(require("path").join(B.BACKUP_DIR, f.name));
  });
  app.post("/api/backup/check", adminOnly, (req, res) => res.json(K.checkDb()));
  app.post("/api/backup/cleanup", adminOnly, (req, res) => {
    const n = K.cleanupFiles();
    log("Очистка лишних файлов", String(n), req.session.user.username);
    res.json({ ok: true, removed: n });
  });
  app.post("/api/backup/test-remote", adminOnly, async (req, res) => {
    if (!B.remoteConfigured()) return res.status(400).json({ error: "GitHub-копии не настроены: " + (B.remoteProblem() || "задайте переменные") });
    try {
      const buf = await B.remotePull();
      res.json({ ok: true, exists: !!buf, size: buf ? buf.length : 0 });
    } catch (e) { res.status(502).json({ error: e.message }); }
  });
  // Восстановление: копия проверяется, затем сервер перезапускается и подменяет базу при старте.
  app.post("/api/backup/restore", adminOnly, (req, res, next) => {
    restoreUpload.single("file")(req, res, err => {
      if (err) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Файл больше 150 МБ" : "Ошибка загрузки файла" });
      if (!req.file) return res.status(400).json({ error: "Выберите файл копии" });
      if (!reauth(req, res)) return;
      try {
        const v = B.stageRestore(B.toSqlite(req.file.buffer));
        log("Восстановление из файла", `${v.users} польз., ${v.staff} дел`, req.session.user.username);
        res.json({ ok: true, users: v.users, staff: v.staff });
        restartSoon();
      } catch (e) { res.status(400).json({ error: e.message }); }
    });
  });
  app.post("/api/backup/restore-remote", adminOnly, async (req, res) => {
    if (!reauth(req, res)) return;
    if (!B.remoteConfigured()) return res.status(400).json({ error: "GitHub-копии не настроены" });
    try {
      const buf = await B.remotePull();
      if (!buf) return res.status(404).json({ error: "В GitHub пока нет копии" });
      const v = B.stageRestore(B.toSqlite(buf));
      log("Восстановление из GitHub", `${v.users} польз., ${v.staff} дел`, req.session.user.username);
      res.json({ ok: true, users: v.users, staff: v.staff });
      restartSoon();
    } catch (e) { res.status(502).json({ error: e.message }); }
  });
  app.post("/api/backup/restore-local", adminOnly, (req, res) => {
    if (!reauth(req, res)) return;
    const f = B.listLocal().find(x => x.name === String((req.body || {}).name || ""));
    if (!f) return res.status(404).json({ error: "Копия не найдена" });
    try {
      const v = B.stageRestore(require("zlib").gunzipSync(require("fs").readFileSync(require("path").join(B.BACKUP_DIR, f.name))));
      log("Восстановление из локальной копии", f.name, req.session.user.username);
      res.json({ ok: true, users: v.users, staff: v.staff });
      restartSoon();
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
};
