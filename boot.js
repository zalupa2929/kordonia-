"use strict";
// Запуск: применяет отложенное восстановление, проверяет базу и при пустом диске поднимает данные из резервной копии.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const B = require("./lib/bk");

const ts = () => new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
function moveAside(suffix) {
  for (const ext of ["", "-wal", "-shm"]) if (fs.existsSync(B.DB_FILE + ext)) fs.renameSync(B.DB_FILE + ext, B.DB_FILE + "." + suffix + ext);
}

(async () => {
  fs.mkdirSync(B.DATA_DIR, { recursive: true });
  global.__KR_BOOT = { restored: "", remote: "none", note: "" };
  const boot = global.__KR_BOOT;

  // 1. Отложенное восстановление из панели администратора.
  if (fs.existsSync(B.PENDING)) {
    const v = B.validateDbFile(B.PENDING);
    if (v.ok) {
      if (fs.existsSync(B.DB_FILE)) moveAside("before-restore-" + ts());
      fs.renameSync(B.PENDING, B.DB_FILE);
      boot.restored = "панель администратора";
      console.log(`[boot] Восстановление применено: ${v.users} пользователей, ${v.staff} дел.`);
    } else { console.error("[boot] Файл восстановления отклонён:", v.error); fs.rmSync(B.PENDING, { force: true }); }
  }

  // 2. Проверка существующей базы.
  let need = !fs.existsSync(B.DB_FILE);
  if (!need) {
    const v = B.validateDbFile(B.DB_FILE);
    if (!v.ok) { console.error("[boot] База повреждена:", v.error, "— откладываю и восстанавливаю из копии."); moveAside("corrupt-" + ts()); need = true; }
  }

  // 3. Базы нет — берём удалённую копию, затем последнюю локальную.
  if (need) {
    let done = false;
    if (B.remoteConfigured()) {
      try {
        const buf = await B.remotePull();
        if (buf) {
          const v = B.stageRestore(B.toSqlite(buf));
          fs.renameSync(B.PENDING, B.DB_FILE);
          boot.restored = "копия GitHub"; boot.remote = "synced"; done = true;
          console.log(`[boot] Данные восстановлены из GitHub: ${v.users} пользователей, ${v.staff} дел.`);
        } else { boot.remote = "synced"; boot.note = "в GitHub пока нет копии"; console.log("[boot] В GitHub ещё нет копии — запуск с чистой базой."); }
      } catch (e) { boot.remote = "failed"; boot.note = e.message; console.error("[boot] Не удалось получить копию из GitHub:", e.message); }
    }
    if (!done) {
      const last = B.listLocal()[0];
      if (last) {
        try {
          const raw = zlib.gunzipSync(fs.readFileSync(path.join(B.BACKUP_DIR, last.name)));
          const v = B.stageRestore(raw); fs.renameSync(B.PENDING, B.DB_FILE);
          boot.restored = "локальная копия " + last.name; done = true;
          console.log(`[boot] Данные восстановлены из ${last.name}: ${v.users} пользователей, ${v.staff} дел.`);
        } catch (e) { console.error("[boot] Локальная копия непригодна:", e.message); }
      }
    }
  } else if (B.remoteConfigured()) boot.remote = "synced"; // рабочая локальная база считается актуальной

  require("./server");
})().catch(e => { console.error("[boot] Критическая ошибка запуска:", e); process.exit(1); });
