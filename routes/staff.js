"use strict";
const crypto = require("crypto");
const C = require("../lib/core");
const S = require("../lib/staffops");
const { cardSvg } = require("../lib/card");
const { profileOf } = require("./auth");
const { db, str, DATE_RE, okDate, todayStr, isUnique, log, audit, careerAdd, can, orgOK, scopeAll, auth, need, makeLimiter,
  maps, staffRow, credFor, staffVisible, staffView, canEditStaff, canSeeClassified, imageUpload, saveImage, dropFile, TOKEN_RE } = C;

const RESULTS = ["Сдано", "Не сдано", "Ожидает"];
const verifyLimiter = makeLimiter(40, 60 * 1000);

// Какое дело «моё»: по жетону из профиля, затем по совпадению логина с ником/Discord.
function ownStaff(u) {
  const prof = profileOf(u.id);
  let s = prof && prof.token ? db.prepare("SELECT * FROM staff WHERE token=?").get(prof.token) : null;
  if (!s) {
    const name = u.username.toLowerCase();
    s = db.prepare("SELECT * FROM staff WHERE nickname<>'' OR discord<>''").all()
      .find(x => String(x.nickname || "").toLowerCase() === name || String(x.discord || "").toLowerCase() === name) || null;
  }
  return s;
}

function buildCase(s, u, m, owner) {
  const full = owner || canEditStaff(u, s) || (can(u, "case.others") && orgOK(u, s.org));
  const v = staffView(s, u, m, { owner });
  const masked = v.masked;
  const out = { staff: v, level: full ? "full" : "summary", training: [], history: [], orders: [], actions: {} };
  if (full) {
    if (owner || (can(u, "training.view") && orgOK(u, s.org)))
      out.training = db.prepare("SELECT id,course,result,date,examiner,notes FROM training WHERE staff_id=? ORDER BY date DESC,id DESC").all(s.id);
    if (owner || (can(u, "history.view") && orgOK(u, s.org)))
      out.history = db.prepare("SELECT action,details,actor,created_at FROM history WHERE staff_id=? ORDER BY id DESC LIMIT 200").all(s.id);
    if (owner || (can(u, "orders.view") && orgOK(u, s.org)))
      out.orders = db.prepare("SELECT number,type,date,reason,org,org_to,rank_from,rank_to,position_from,position_to FROM orders WHERE staff_id=? ORDER BY id DESC").all(s.id);
  }
  const mine = canEditStaff(u, s);
  out.actions = {
    edit: mine && !s.archived,
    publish: can(u, "staff.publish") && orgOK(u, s.org) && !s.archived,
    remove: can(u, "staff.remove") && orgOK(u, s.org) && !s.archived,
    restore: can(u, "staff.remove") && orgOK(u, s.org) && !!s.archived,
    delete: can(u, "staff.delete") && orgOK(u, s.org),
    credential: can(u, "credentials.manage") && orgOK(u, s.org) && !s.archived,
    classified: can(u, "classified.set") && orgOK(u, s.org),
    training: can(u, "training.manage") && orgOK(u, s.org) && !s.archived,
    trainingDelete: can(u, "training.delete") && orgOK(u, s.org),
    order: can(u, "orders.create") && orgOK(u, s.org) && !s.archived,
    uploads: mine && !s.archived
  };
  out.masked = masked;
  return out;
}

module.exports = app => {
  // ---------- Реестр ----------
  app.get("/api/staff", need("staff.view"), (req, res) => {
    const u = req.session.user, m = maps();
    const rows = db.prepare("SELECT * FROM staff ORDER BY org,position,fio").all().filter(s => staffVisible(s, u));
    res.json(rows.map(s => staffView(s, u, m)));
  });

  app.post("/api/staff", need("staff.edit"), (req, res) => {
    const u = req.session.user;
    const d = S.readStaffBody(req.body || {}, null, can(u, "classified.set"));
    const err = S.validateStaff(d, null);
    if (err) return res.status(400).json({ error: err });
    if (!orgOK(u, d.org)) return res.status(403).json({ error: "Нет доступа к этой организации" });
    if (db.prepare("SELECT 1 FROM staff WHERE token=?").get(d.token)) return res.status(409).json({ error: "Такой жетон уже занят" });
    const id = crypto.randomUUID();
    try {
      db.prepare(`INSERT INTO staff(id,fio,dob,passport,phone,nickname,discord,token,org,unit,position,rank,status,classified,published)
        VALUES(@id,@fio,@dob,@passport,@phone,@nickname,@discord,@token,@org,@unit,@position,@rank,@status,@classified,0)`).run({ id, ...d });
    } catch (e) {
      if (isUnique(e)) return res.status(409).json({ error: "Такой жетон уже занят" });
      throw e;
    }
    audit({ id, ...d }, "Создано дело (черновик)", "", u.username);
    res.json({ ok: true, id });
  });

  app.put("/api/staff/:id", need("staff.edit"), (req, res) => {
    const u = req.session.user, old = staffRow(req.params.id);
    if (!old) return res.status(404).json({ error: "Запись не найдена" });
    if (!canEditStaff(u, old)) return res.status(403).json({ error: "Нет доступа к этой организации" });
    if (old.archived) return res.status(409).json({ error: "Дело в архиве — сначала верните его в организацию" });
    const d = S.readStaffBody(req.body || {}, old, can(u, "classified.set") && orgOK(u, old.org));
    const err = S.validateStaff(d, old);
    if (err) return res.status(400).json({ error: err });
    if (!orgOK(u, d.org)) return res.status(403).json({ error: "Нет доступа к выбранной организации" });
    if (db.prepare("SELECT 1 FROM staff WHERE token=? AND id<>?").get(d.token, old.id)) return res.status(409).json({ error: "Жетон уже занят" });
    try { S.updateStaff(old, d, u.username); } catch (e) {
      if (isUnique(e)) return res.status(409).json({ error: "Жетон уже занят" });
      throw e;
    }
    res.json({ ok: true });
  });

  // Публикация: дело становится видимым, автоматически выдаётся удостоверение и пишется запись «Приём» в трудовую.
  app.post("/api/staff/:id/publish", need("staff.publish"), (req, res) => {
    const u = req.session.user, s = staffRow(req.params.id);
    if (!s) return res.status(404).json({ error: "Запись не найдена" });
    if (!orgOK(u, s.org)) return res.status(403).json({ error: "Нет доступа к этой организации" });
    if (s.archived) return res.status(409).json({ error: "Дело в архиве" });
    if (!s.fio || !s.token || !s.org || !s.position) return res.status(400).json({ error: "Для публикации заполните ФИО, жетон, организацию и должность" });
    let credNo = "";
    db.transaction(() => {
      db.prepare("UPDATE staff SET published=1,updated_at=? WHERE id=?").run(new Date().toISOString(), s.id);
      const cur = staffRow(s.id);
      const r = S.ensureCredential(cur, u.username);
      S.syncCredential(cur);
      credNo = r.cred.credential_no;
      if (!s.published) {
        audit(cur, "Дело опубликовано", "Удостоверение " + credNo, u.username);
        if (!db.prepare("SELECT 1 FROM career WHERE staff_id=? AND kind='Приём'").get(s.id))
          careerAdd({ staff_id: s.id, kind: "Приём", title: "Приём на службу", details: s.org + " · " + s.position + (s.rank ? " · " + s.rank : ""), org: s.org, actor: u.username });
      }
    })();
    res.json({ ok: true, credential_no: credNo });
  });
  app.post("/api/staff/:id/unpublish", need("staff.publish"), (req, res) => {
    const u = req.session.user, s = staffRow(req.params.id);
    if (!s) return res.status(404).json({ error: "Запись не найдена" });
    if (!orgOK(u, s.org)) return res.status(403).json({ error: "Нет доступа к этой организации" });
    db.prepare("UPDATE staff SET published=0 WHERE id=?").run(s.id);
    audit(s, "Дело снято с публикации", "", u.username);
    res.json({ ok: true });
  });

  // Исключение из организации: дело уходит в архив (данные и трудовая сохраняются), удостоверение недействительно.
  app.post("/api/staff/:id/remove", need("staff.remove"), (req, res) => {
    const u = req.session.user, s = staffRow(req.params.id);
    if (!s) return res.status(404).json({ error: "Запись не найдена" });
    if (!orgOK(u, s.org)) return res.status(403).json({ error: "Нет доступа к этой организации" });
    if (s.archived) return res.status(409).json({ error: "Дело уже в архиве" });
    const reason = str((req.body || {}).reason, 300);
    db.transaction(() => {
      db.prepare("UPDATE staff SET archived=1,archived_at=?,archive_reason=?,updated_at=? WHERE id=?").run(new Date().toISOString(), reason, new Date().toISOString(), s.id);
      S.syncCredential(staffRow(s.id));
      audit(s, "Исключён из организации", reason, u.username);
      if (s.published) careerAdd({ staff_id: s.id, kind: "Исключение", title: "Исключён из организации", details: (s.org || "") + (reason ? " · " + reason : ""), org: s.org, actor: u.username });
    })();
    res.json({ ok: true });
  });
  app.post("/api/staff/:id/restore", need("staff.remove"), (req, res) => {
    const u = req.session.user, s = staffRow(req.params.id);
    if (!s) return res.status(404).json({ error: "Запись не найдена" });
    if (!orgOK(u, s.org)) return res.status(403).json({ error: "Нет доступа к этой организации" });
    if (!s.archived) return res.status(409).json({ error: "Дело не в архиве" });
    db.transaction(() => {
      db.prepare("UPDATE staff SET archived=0,archived_at=NULL,archive_reason=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(), s.id);
      S.syncCredential(staffRow(s.id));
      audit(s, "Возвращено в организацию", "", u.username);
      if (s.published) careerAdd({ staff_id: s.id, kind: "Служба", title: "Возвращён в организацию", details: s.org, org: s.org, actor: u.username });
    })();
    res.json({ ok: true });
  });

  app.delete("/api/staff/:id", need("staff.delete"), (req, res) => {
    const u = req.session.user, s = staffRow(req.params.id);
    if (!s) return res.status(404).json({ error: "Не найдено" });
    if (!orgOK(u, s.org)) return res.status(403).json({ error: "Нет доступа к этой организации" });
    db.transaction(() => {
      audit(s, "Дело удалено полностью", "", u.username);
      db.prepare("DELETE FROM career WHERE staff_id=?").run(s.id);
      db.prepare("DELETE FROM staff WHERE id=?").run(s.id);
      dropFile(s.portrait_path); dropFile(s.badge_path);
    })();
    res.json({ ok: true });
  });

  // ---------- Фото (файлом, хранится в базе) ----------
  for (const [kind, col] of [["portrait", "portrait_path"], ["badge", "badge_path"]]) {
    app.post(`/api/staff/:id/${kind}`, need("staff.edit"), imageUpload, (req, res) => {
      const u = req.session.user, s = staffRow(req.params.id);
      if (!s) return res.status(404).json({ error: "Запись не найдена" });
      if (!canEditStaff(u, s)) return res.status(403).json({ error: "Нет доступа" });
      const p = saveImage(req.img);
      db.prepare(`UPDATE staff SET ${col}=?,updated_at=? WHERE id=?`).run(p, new Date().toISOString(), s.id);
      dropFile(s[col]);
      audit(s, kind === "portrait" ? "Загружено фото" : "Загружено фото жетона", "", u.username);
      res.json({ ok: true, path: p });
    });
    app.delete(`/api/staff/:id/${kind}`, need("staff.edit"), (req, res) => {
      const u = req.session.user, s = staffRow(req.params.id);
      if (!s) return res.status(404).json({ error: "Запись не найдена" });
      if (!canEditStaff(u, s)) return res.status(403).json({ error: "Нет доступа" });
      db.prepare(`UPDATE staff SET ${col}=NULL,updated_at=? WHERE id=?`).run(new Date().toISOString(), s.id);
      dropFile(s[col]);
      audit(s, kind === "portrait" ? "Фото удалено" : "Фото жетона удалено", "", u.username);
      res.json({ ok: true });
    });
  }

  // ---------- Удостоверение ----------
  app.post("/api/staff/:id/credential", need("credentials.manage"), (req, res) => {
    const u = req.session.user, s = staffRow(req.params.id);
    if (!s) return res.status(404).json({ error: "Сотрудник не найден" });
    if (!orgOK(u, s.org)) return res.status(403).json({ error: "Нет доступа" });
    const b = req.body || {};
    const issued = b.issued_on === undefined ? undefined : str(b.issued_on, 10);
    const expires = b.expires_on === undefined ? undefined : str(b.expires_on, 10);
    if ((issued !== undefined && !okDate(issued)) || (expires !== undefined && !okDate(expires))) return res.status(400).json({ error: "Дата указана неверно" });
    const cur = credFor(s.id);
    try {
      if (!cur) {
        const number = str(b.credential_no, 40) || S.newCredentialNo();
        db.prepare("INSERT INTO credentials(staff_id,credential_no,issued_on,expires_on,status,issuer) VALUES(?,?,?,?,?,?)")
          .run(s.id, number, issued || todayStr(), expires || "", C.credStatusFor(s), u.username);
        audit(s, "Выдача удостоверения", number, u.username);
        return res.json({ ok: true, credential_no: number });
      }
      const next = { id: cur.id, credential_no: str(b.credential_no, 40) || cur.credential_no, issued_on: issued || cur.issued_on || todayStr(), expires_on: expires === undefined ? (cur.expires_on || "") : expires };
      db.prepare("UPDATE credentials SET credential_no=@credential_no,issued_on=@issued_on,expires_on=@expires_on WHERE id=@id").run(next);
      if (next.credential_no !== cur.credential_no || next.issued_on !== cur.issued_on || next.expires_on !== (cur.expires_on || "")) audit(s, "Изменение удостоверения", next.credential_no, u.username);
      res.json({ ok: true, credential_no: next.credential_no });
    } catch (e) {
      if (isUnique(e)) return res.status(409).json({ error: "Номер удостоверения уже используется" });
      throw e;
    }
  });

  function cardFor(s, u) {
    const v = staffView(s, u, maps());
    const c = credFor(s.id), reason = S.validity(s, c);
    return cardSvg({ ...v, cred: c, valid: !reason, reason });
  }
  app.get("/api/staff/:id/card.svg", auth, (req, res) => {
    const u = req.session.user, s = staffRow(req.params.id);
    if (!s || !staffVisible(s, u)) return res.status(404).json({ error: "Не найдено" });
    res.set({ "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.send(cardFor(s, u));
  });

  // ---------- Личное дело ----------
  app.get("/api/staff/:id/case", need("staff.view"), (req, res) => {
    const u = req.session.user, s = staffRow(req.params.id);
    if (!s || !staffVisible(s, u)) return res.status(404).json({ error: "Дело не найдено" });
    const own = ownStaff(u);
    res.json(buildCase(s, u, maps(), !!own && own.id === s.id));
  });
  app.get("/api/my-case", auth, (req, res) => {
    const u = req.session.user, s = ownStaff(u);
    if (!s) return res.json({ found: false });
    res.json({ found: true, ...buildCase(s, u, maps(), true) });
  });
  // Поиск дел для вкладки «Моё дело» (для тех, кто может открывать чужие).
  app.get("/api/cases/search", need("case.others"), (req, res) => {
    const u = req.session.user, q = str(req.query.q, 60).toLowerCase(), m = maps();
    const rows = db.prepare("SELECT * FROM staff ORDER BY fio").all().filter(s => staffVisible(s, u) && orgOK(u, s.org));
    const out = [];
    for (const s of rows) {
      const v = staffView(s, u, m);
      const hay = [v.fio, v.token, v.position, v.rank, v.org, v.nickname, v.discord].join(" ").toLowerCase();
      if (!q || hay.includes(q)) out.push({ id: v.id, fio: v.fio, token: v.token, org: v.org, rank: v.rank, position: v.position, stars: v.stars, color: v.color, portrait_path: v.portrait_path, masked: v.masked, status: v.status, archived: v.archived, published: v.published });
      if (out.length >= 40) break;
    }
    res.json(out);
  });

  // ---------- Проверка жетона ----------
  app.get("/api/verify/:token", auth, (req, res) => {
    const u = req.session.user;
    if (verifyLimiter.blocked(u.username)) return res.status(429).json({ error: "Слишком много проверок. Подождите минуту." });
    verifyLimiter.hit(u.username);
    const token = String(req.params.token || "").trim();
    if (!TOKEN_RE.test(token)) return res.status(400).json({ error: "Введите жетон в формате 000-000" });
    const s = db.prepare("SELECT * FROM staff WHERE token=?").get(token);
    log("Проверка жетона", token, u.username);
    if (!s || (!s.published && !staffVisible(s, u))) return res.status(404).json({ found: false, error: "Сотрудник с таким жетоном не найден" });
    const c = credFor(s.id), reason = S.validity(s, c);
    if (s.archived && !staffVisible(s, u)) return res.json({ found: true, valid: false, reason, token: s.token, org: s.org, masked: true, fio: "Исключён из организации", stars: 0, color: "#6b7a99", credential_status: "Недействительно" });
    const v = staffView(s, u, maps());
    res.json({
      found: true, valid: !reason, reason, id: s.id, fio: v.fio, token: v.token, org: v.org, unit: v.unit, position: v.position, rank: v.rank,
      status: v.status, stars: v.stars, color: v.color, masked: v.masked, portrait_path: v.portrait_path,
      credential_no: c?.credential_no || "", issued_on: c?.issued_on || "", expires_on: c?.expires_on || "", credential_status: c?.status || "Нет удостоверения"
    });
  });

  // ---------- Аттестации ----------
  app.get("/api/training", need("training.view"), (req, res) => {
    const u = req.session.user;
    const rows = db.prepare("SELECT t.*,s.org,s.fio,s.classified,s.token FROM training t JOIN staff s ON s.id=t.staff_id ORDER BY t.id DESC").all();
    res.json(rows.filter(x => orgOK(u, x.org)).map(x => {
      const hide = x.classified && !canSeeClassified(u, x);
      return { id: x.id, staff_id: x.staff_id, fio: hide ? "Засекречено" : x.fio, org: x.org, token: x.token, course: x.course, result: x.result, date: x.date, examiner: x.examiner, notes: hide ? "" : x.notes };
    }));
  });
  app.post("/api/training", need("training.manage"), (req, res) => {
    const u = req.session.user, b = req.body || {}, s = staffRow(String(b.staff_id || ""));
    if (!s) return res.status(404).json({ error: "Сотрудник не найден" });
    if (!orgOK(u, s.org)) return res.status(403).json({ error: "Нет доступа" });
    const course = str(b.course, 150), result = str(b.result, 20), date = str(b.date, 10);
    if (!course) return res.status(400).json({ error: "Укажите курс / аттестацию" });
    if (!RESULTS.includes(result)) return res.status(400).json({ error: "Неизвестный результат" });
    if (!DATE_RE.test(date) || !okDate(date)) return res.status(400).json({ error: "Укажите дату" });
    db.prepare("INSERT INTO training(staff_id,course,result,date,examiner,notes) VALUES(?,?,?,?,?,?)").run(s.id, course, result, date, str(b.examiner, 100), str(b.notes, 1000));
    audit(s, "Запись об аттестации", course + " — " + result, u.username);
    res.json({ ok: true });
  });
  app.delete("/api/training/:id", need("training.delete"), (req, res) => {
    const u = req.session.user;
    const t = db.prepare("SELECT t.*,s.org,s.fio,s.id sid FROM training t JOIN staff s ON s.id=t.staff_id WHERE t.id=?").get(Number(req.params.id));
    if (!t) return res.status(404).json({ error: "Запись не найдена" });
    if (!orgOK(u, t.org)) return res.status(403).json({ error: "Нет доступа" });
    db.prepare("DELETE FROM training WHERE id=?").run(t.id);
    audit({ id: t.sid, fio: t.fio, org: t.org }, "Аттестация удалена", t.course + " — " + t.result, u.username);
    res.json({ ok: true });
  });

  // ---------- История ----------
  app.get("/api/history", need("history.view"), (req, res) => {
    const u = req.session.user;
    const rows = db.prepare("SELECT h.*,s.classified,s.org sorg FROM history h LEFT JOIN staff s ON s.id=h.staff_id ORDER BY h.id DESC LIMIT 600").all();
    res.json(rows.filter(x => orgOK(u, x.org)).slice(0, 500).map(x => {
      const hide = x.classified && !canSeeClassified(u, { org: x.sorg || x.org });
      return { id: x.id, staff_id: x.staff_id, fio: hide ? "Засекречено" : x.fio, org: x.org, action: x.action, details: hide ? "" : x.details, actor: x.actor, created_at: x.created_at };
    }));
  });
};
module.exports.ownStaff = ownStaff;
