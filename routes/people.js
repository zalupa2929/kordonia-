"use strict";
const C = require("../lib/core");
const S = require("../lib/staffops");
const { profileOf } = require("./auth");
const { ownStaff } = require("./staff");
const { db, str, DATE_RE, okDate, todayStr, audit, careerAdd, can, orgOK, scopeAll, auth, need, maps, staffRow, credFor, staffVisible, staffView, canSeeClassified } = C;

const ORDER_TYPES = {
  "Приём": [], "Перевод": ["org_to"], "Повышение": ["rank_to"], "Понижение": ["rank_to"],
  "Назначение": ["position_to"], "Увольнение": ["reason"], "Взыскание": ["reason"], "Поощрение": ["reason"]
};
const MANUAL_KINDS = ["Судимость", "Взыскание", "Поощрение", "Заметка"];
const httpErr = (msg, status = 400) => Object.assign(new Error(msg), { status });

module.exports = app => {
  // ---------- Кадровые приказы ----------
  app.get("/api/orders", need("orders.view"), (req, res) => {
    const u = req.session.user;
    const rows = db.prepare("SELECT o.*,s.classified,s.org sorg,s.token FROM orders o LEFT JOIN staff s ON s.id=o.staff_id ORDER BY o.id DESC LIMIT 500").all();
    res.json(rows.filter(x => orgOK(u, x.org) || (x.sorg && orgOK(u, x.sorg))).map(x => {
      const hide = x.classified && !canSeeClassified(u, { org: x.sorg || x.org });
      return { ...x, fio: hide ? "Засекречено" : x.fio, classified: undefined, sorg: undefined };
    }));
  });

  app.post("/api/orders", need("orders.create"), (req, res) => {
    const u = req.session.user, b = req.body || {};
    const s = staffRow(String(b.staff_id || ""));
    if (!s) return res.status(404).json({ error: "Сотрудник не найден" });
    if (!orgOK(u, s.org)) return res.status(403).json({ error: "Нет доступа к этой организации" });
    const type = str(b.type, 30), req_ = ORDER_TYPES[type];
    if (!req_) return res.status(400).json({ error: "Неизвестный тип приказа" });
    const date = str(b.date, 10) || todayStr();
    if (!DATE_RE.test(date) || !okDate(date)) return res.status(400).json({ error: "Дата указана неверно" });
    const f = { reason: str(b.reason, 500), org_to: str(b.org_to, 60), rank_to: str(b.rank_to, 100), position_to: str(b.position_to, 100) };
    for (const k of req_) if (!f[k]) return res.status(400).json({ error: { org_to: "Выберите организацию", rank_to: "Выберите звание", position_to: "Укажите должность", reason: "Укажите основание" }[k] });
    if (s.archived && type !== "Приём") return res.status(409).json({ error: "Дело в архиве — приказ возможен только «Приём»" });
    const targetOrg = type === "Перевод" ? f.org_to : (type === "Приём" && f.org_to ? f.org_to : s.org);
    if (!C.orgExists(targetOrg)) return res.status(400).json({ error: "Неизвестная организация" });
    if (["Перевод", "Повышение", "Понижение", "Приём"].includes(type) && f.rank_to && !C.rankExists(targetOrg, f.rank_to)) return res.status(400).json({ error: "Звание не относится к организации" });

    const d = { ...s };
    if (type === "Приём") { d.status = "Служит"; if (f.org_to) d.org = f.org_to; if (f.position_to) d.position = f.position_to; if (f.rank_to) d.rank = f.rank_to; }
    else if (type === "Перевод") { d.org = f.org_to; if (f.position_to) d.position = f.position_to; d.rank = f.rank_to || ""; }
    else if (type === "Повышение" || type === "Понижение") d.rank = f.rank_to;
    else if (type === "Назначение") d.position = f.position_to;
    else if (type === "Увольнение") d.status = "Уволен";

    let number = "";
    db.transaction(() => {
      if (type === "Приём" && s.archived) db.prepare("UPDATE staff SET archived=0,archived_at=NULL,archive_reason=NULL WHERE id=?").run(s.id);
      S.updateStaff(s, d, u.username, { noCareer: true });
      const year = date.slice(0, 4);
      let n = db.prepare("SELECT COUNT(*) n FROM orders WHERE number LIKE ?").get("П-" + year + "-%").n + 1;
      do { number = "П-" + year + "-" + String(n++).padStart(4, "0"); } while (db.prepare("SELECT 1 FROM orders WHERE number=?").get(number));
      const id = db.prepare(`INSERT INTO orders(number,staff_id,fio,type,date,org,org_to,rank_from,rank_to,position_from,position_to,reason,actor)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(number, s.id, s.fio, type, date, s.org, d.org !== s.org ? d.org : null, s.rank || "", d.rank || "", s.position || "", d.position || "", f.reason, u.username).lastInsertRowid;
      const parts = [];
      if (d.org !== s.org) parts.push(s.org + " → " + d.org);
      if ((s.rank || "") !== (d.rank || "")) parts.push("звание: " + (s.rank || "—") + " → " + (d.rank || "—"));
      if ((s.position || "") !== (d.position || "")) parts.push("должность: " + (s.position || "—") + " → " + (d.position || "—"));
      if (f.reason) parts.push("основание: " + f.reason);
      const kind = { "Приём": "Служба", "Перевод": "Перевод", "Повышение": "Звание", "Понижение": "Звание", "Назначение": "Должность", "Увольнение": "Увольнение", "Взыскание": "Взыскание", "Поощрение": "Поощрение" }[type];
      careerAdd({ staff_id: s.id, kind, title: "Приказ " + number + " · " + type, details: parts.join("; "), org: d.org, order_id: id, date, actor: u.username });
      audit(staffRow(s.id), "Приказ " + number, type + (parts.length ? " · " + parts.join("; ") : ""), u.username);
    })();
    res.json({ ok: true, number });
  });

  // ---------- Трудовая ----------
  function careerAccess(u, row) {
    if (row.staff_id) { const s = staffRow(row.staff_id); return !!s && orgOK(u, s.org); }
    return scopeAll(u);
  }
  app.post("/api/career", need("career.manage"), (req, res) => {
    const u = req.session.user, b = req.body || {};
    const kind = str(b.kind, 20), title = str(b.title, 200), date = str(b.date, 10) || todayStr();
    if (!MANUAL_KINDS.includes(kind)) return res.status(400).json({ error: "Неизвестный тип записи" });
    if (!title) return res.status(400).json({ error: kind === "Судимость" ? "Укажите статью / решение суда" : "Укажите название записи" });
    if (!DATE_RE.test(date) || !okDate(date)) return res.status(400).json({ error: "Дата указана неверно" });
    const row = { staff_id: b.staff_id ? String(b.staff_id) : null, user_id: b.user_id ? Number(b.user_id) : null };
    if (!row.staff_id && !row.user_id) return res.status(400).json({ error: "Не указан игрок" });
    if (row.staff_id && !staffRow(row.staff_id)) return res.status(404).json({ error: "Дело не найдено" });
    if (row.user_id && !db.prepare("SELECT 1 FROM users WHERE id=?").get(row.user_id)) return res.status(404).json({ error: "Пользователь не найден" });
    if (!careerAccess(u, row)) return res.status(403).json({ error: "Нет доступа" });
    const s = row.staff_id ? staffRow(row.staff_id) : null;
    careerAdd({ ...row, kind, date, title, details: str(b.details, 1000), status: kind === "Судимость" ? (str(b.status, 40) || "Не погашена") : "", org: s?.org, actor: u.username });
    if (s) audit(s, "Запись в трудовой: " + kind, title, u.username);
    res.json({ ok: true });
  });
  app.patch("/api/career/:id", need("career.manage"), (req, res) => {
    const u = req.session.user, r = db.prepare("SELECT * FROM career WHERE id=?").get(Number(req.params.id));
    if (!r) return res.status(404).json({ error: "Запись не найдена" });
    if (!careerAccess(u, r)) return res.status(403).json({ error: "Нет доступа" });
    if (r.kind !== "Судимость") return res.status(400).json({ error: "Менять статус можно только у судимостей" });
    const status = str((req.body || {}).status, 40);
    if (!["Не погашена", "Погашена", "Снята"].includes(status)) return res.status(400).json({ error: "Неизвестный статус" });
    db.prepare("UPDATE career SET status=? WHERE id=?").run(status, r.id);
    res.json({ ok: true });
  });
  app.delete("/api/career/:id", need("career.manage"), (req, res) => {
    const u = req.session.user, r = db.prepare("SELECT * FROM career WHERE id=?").get(Number(req.params.id));
    if (!r) return res.status(404).json({ error: "Запись не найдена" });
    if (!careerAccess(u, r)) return res.status(403).json({ error: "Нет доступа" });
    if (!MANUAL_KINDS.includes(r.kind) && u.role !== "main_admin") return res.status(403).json({ error: "Автоматические записи удаляет только главный администратор" });
    db.prepare("DELETE FROM career WHERE id=?").run(r.id);
    const s = r.staff_id ? staffRow(r.staff_id) : null;
    if (s) audit(s, "Запись трудовой удалена", r.kind + ": " + r.title, u.username);
    res.json({ ok: true });
  });
  app.get("/api/my-career", auth, (req, res) => {
    const u = req.session.user, s = ownStaff(u);
    res.json(db.prepare("SELECT id,kind,date,title,details,status,org FROM career WHERE user_id=? OR staff_id=? ORDER BY date DESC,id DESC").all(u.id, s ? s.id : "-"));
  });

  // ---------- Игроки (малое дело) ----------
  function entries(u) {
    const m = maps();
    const staffAll = db.prepare("SELECT * FROM staff").all().filter(s => staffVisible(s, u));
    const byToken = new Map(staffAll.map(s => [s.token, s]));
    const used = new Set(), out = [];
    const mk = (p, s) => {
      const v = s ? staffView(s, u, m) : null, masked = !!v?.masked;
      return {
        key: p ? "u" + p.uid : "s" + s.id, uid: p ? p.uid : null, has_account: !!p,
        username: masked ? "" : (p?.username || ""),
        nickname: masked ? "" : (p?.nickname || s?.nickname || ""), discord: masked ? "" : (p?.discord || s?.discord || ""),
        fio: v ? v.fio : (p?.fio || ""), avatar: v ? (v.portrait_path || (masked ? null : p?.avatar_path) || null) : (p?.avatar_path || null),
        token: v ? v.token : (p?.token || ""), org: v?.org || "", position: v?.position || "", rank: v?.rank || "", stars: v?.stars || 0,
        color: v?.color || "#6b7a99", status: v?.status || "", archived: v?.archived || 0, masked,
        credential_no: v?.credential?.credential_no || "", staff_id: v ? v.id : null, _s: s, _p: p
      };
    };
    for (const p of db.prepare("SELECT p.*,u.username,u.id uid FROM profiles p JOIN users u ON u.id=p.user_id WHERE u.active=1").all()) {
      const s = p.token ? byToken.get(p.token) : null;
      if (s) used.add(s.id);
      out.push(mk(p, s || null));
    }
    for (const s of staffAll) if (!used.has(s.id)) out.push(mk(null, s));
    return out.filter(e => scopeAll(u) || (e._s && orgOK(u, e._s.org)));
  }
  const strip = e => { const { _s, _p, ...x } = e; return x; };

  app.get("/api/players", need("players.search"), (req, res) => {
    const q = str(req.query.q, 60).toLowerCase();
    let list = entries(req.session.user);
    if (q) list = list.filter(e => [e.nickname, e.discord, e.fio, e.token, e.username, e.org, e.position, e.rank, e.credential_no].join(" ").toLowerCase().includes(q));
    list.sort((a, b) => (a.fio || a.nickname).localeCompare(b.fio || b.nickname, "ru"));
    res.json(list.slice(0, 60).map(strip));
  });

  app.get("/api/players/:key", need("players.search"), (req, res) => {
    const u = req.session.user, key = String(req.params.key);
    const e = entries(u).find(x => x.key === key);
    if (!e) return res.status(404).json({ error: "Профиль не найден" });
    const s = e._s, p = e._p, out = strip(e);
    if (s) {
      const c = credFor(s.id), reason = S.validity(s, c);
      out.credential = c ? { credential_no: c.credential_no, issued_on: c.issued_on, expires_on: c.expires_on, status: c.status } : null;
      out.valid = !reason; out.reason = reason;
      if (can(u, "training.view") && orgOK(u, s.org) && !e.masked) {
        const t = db.prepare("SELECT result,COUNT(*) n FROM training WHERE staff_id=? GROUP BY result").all(s.id);
        out.training = Object.fromEntries(t.map(r => [r.result, r.n]));
      }
      out.can_open_case = can(u, "staff.view");
    }
    if (can(u, "players.passport") && !e.masked) out.passport = p?.passport || (s?.passport || "");
    const careerOK = can(u, "career.view") && (s ? orgOK(u, s.org) : scopeAll(u)) && !e.masked;
    if (careerOK) {
      out.career = db.prepare("SELECT id,kind,date,title,details,status,org,actor FROM career WHERE (? IS NOT NULL AND user_id=?) OR (? IS NOT NULL AND staff_id=?) ORDER BY date DESC,id DESC")
        .all(e.uid, e.uid, s ? s.id : null, s ? s.id : null);
      out.can_manage_career = can(u, "career.manage") && (s ? orgOK(u, s.org) : scopeAll(u));
    }
    res.json(out);
  });
};
