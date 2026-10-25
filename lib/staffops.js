"use strict";
// Операции над личными делами, общие для разных маршрутов.
const crypto = require("crypto");
const C = require("./core");
const { db, str, TOKEN_RE, okDate, todayStr, audit, careerAdd, orgExists, rankExists, credFor, credStatusFor, bool } = C;

const STATUSES = ["Служит", "Уволен"];

function readStaffBody(b, old, canSetClassified) {
  const pick = (k, max) => b[k] === undefined ? str(old ? old[k] : "", max) : str(b[k], max);
  return {
    fio: pick("fio", 150), dob: pick("dob", 10), passport: pick("passport", 60), phone: pick("phone", 40),
    nickname: pick("nickname", 60), discord: pick("discord", 60), token: pick("token", 7), org: pick("org", 60),
    unit: pick("unit", 100), position: pick("position", 100), rank: pick("rank", 100), status: pick("status", 20) || "Служит",
    classified: canSetClassified && b.classified !== undefined ? (bool(b.classified) ? 1 : 0) : (old ? old.classified : 0)
  };
}
function validateStaff(d, old) {
  if (!d.fio || !d.token || !d.org || !d.position) return "Заполните ФИО, жетон, организацию и должность";
  if (!TOKEN_RE.test(d.token)) return "Жетон должен иметь формат 000-000";
  if (!orgExists(d.org)) return "Неизвестная организация";
  if (!STATUSES.includes(d.status)) return "Неизвестный статус сотрудника";
  if (!okDate(d.dob)) return "Дата рождения указана неверно";
  const rankUnchanged = old && old.rank === d.rank && old.org === d.org;
  if (d.rank && !rankExists(d.org, d.rank) && !rankUnchanged) return "Звание не относится к выбранной организации";
  return null;
}

function validity(s, c) {
  if (s.archived) return "Исключён из организации";
  if (!s.published) return "Дело не опубликовано";
  if (!c) return "Удостоверение не оформлено";
  if (s.status !== "Служит") return "Сотрудник не числится на службе (статус: " + s.status + ")";
  if (c.status !== "Действует") return "Статус удостоверения: " + c.status;
  if (c.expires_on && c.expires_on < todayStr()) return "Срок действия удостоверения истёк " + c.expires_on;
  return "";
}

function newCredentialNo() {
  let n;
  do { n = "KR-" + crypto.randomBytes(4).toString("hex").toUpperCase(); } while (db.prepare("SELECT 1 FROM credentials WHERE credential_no=?").get(n));
  return n;
}
function ensureCredential(s, actor) {
  const c = credFor(s.id);
  if (c) return { cred: c, created: false };
  const number = newCredentialNo();
  db.prepare("INSERT INTO credentials(staff_id,credential_no,issued_on,expires_on,status,issuer) VALUES(?,?,?,?,?,?)")
    .run(s.id, number, todayStr(), "", credStatusFor(s), actor);
  audit(s, "Выдача удостоверения", number, actor);
  return { cred: credFor(s.id), created: true };
}
function syncCredential(s) {
  db.prepare("UPDATE credentials SET status=? WHERE staff_id=?").run(credStatusFor(s), s.id);
}

// Обновление дела целиком. Изменения службы автоматически попадают в историю и трудовую.
function updateStaff(old, d, actor, opts = {}) {
  const data = { ...d, id: old.id, updated_at: new Date().toISOString() };
  const changes = [];
  db.transaction(() => {
    db.prepare(`UPDATE staff SET fio=@fio,dob=@dob,passport=@passport,phone=@phone,nickname=@nickname,discord=@discord,token=@token,org=@org,
      unit=@unit,position=@position,rank=@rank,status=@status,classified=@classified,updated_at=@updated_at WHERE id=@id`).run(data);
    const cur = db.prepare("SELECT * FROM staff WHERE id=?").get(old.id);
    syncCredential(cur);
    const add = (kind, action, details) => {
      changes.push({ kind, details });
      audit(cur, action, details, actor);
      if (old.published && !opts.noCareer) careerAdd({ staff_id: cur.id, kind, title: action, details, org: cur.org, actor });
    };
    if (old.org !== d.org) add("Перевод", "Перевод", old.org + " → " + d.org);
    if ((old.rank || "") !== (d.rank || "")) add("Звание", "Изменение звания", (old.rank || "—") + " → " + (d.rank || "—"));
    if ((old.position || "") !== (d.position || "")) add("Должность", "Изменение должности", (old.position || "—") + " → " + (d.position || "—"));
    if (old.status !== d.status) add(d.status === "Уволен" ? "Увольнение" : "Служба", d.status === "Уволен" ? "Увольнение" : "Возобновление службы", "");
    if (!!old.classified !== !!d.classified) audit(cur, d.classified ? "Дело засекречено" : "Секретность снята", "", actor);
  })();
  return changes;
}

module.exports = { STATUSES, readStaffBody, validateStaff, validity, ensureCredential, syncCredential, updateStaff, newCredentialNo };
