"use strict";
const bcrypt = require("bcryptjs");
const C = require("../lib/core");
const { db, str, isUnique, log, auth, need, adminOnly, can, permsOf, scopeAll, roleName, roleExists, orgTree, orgExists, makeLimiter, imageUpload, saveImage, dropFile, TOKEN_RE } = C;

const USERNAME_RE = /^[\p{L}\p{N}_.-]{3,40}$/u;
const loginLimiter = makeLimiter(10, 15 * 60 * 1000);
const registerLimiter = makeLimiter(5, 60 * 60 * 1000);
const userNameTaken = (name, exceptId = 0) => db.prepare("SELECT id,username FROM users").all().some(x => x.id !== exceptId && x.username.toLowerCase() === name.toLowerCase());
const pendingNameTaken = name => db.prepare("SELECT username FROM registrations WHERE status='Ожидает'").all().some(x => x.username.toLowerCase() === name.toLowerCase());
const sessionUser = u => ({ id: u.id, username: u.username, role: u.role, org: u.org });
const publicUser = u => ({ username: u.username, role: u.role, role_title: roleName(u.role), org: u.org, perms: permsOf(u), scope_all: scopeAll(u) });

module.exports = app => {
  app.get("/api/config", (req, res) => {
    const u = req.session.user;
    res.json({ orgs: orgTree(), user: u ? publicUser(u) : null, version: 8 });
  });

  app.post("/api/login", (req, res) => {
    const username = str((req.body || {}).username, 100);
    const password = String((req.body || {}).password || "");
    const key = req.ip + "|" + username.toLowerCase();
    if (loginLimiter.blocked(key)) return res.status(429).json({ error: "Слишком много попыток входа. Подождите 15 минут." });
    const u = db.prepare("SELECT * FROM users WHERE username=? AND active=1").get(username);
    if (!u) {
      const rg = db.prepare("SELECT * FROM registrations WHERE username=? AND status<>'Одобрена' ORDER BY id DESC LIMIT 1").get(username);
      if (rg && rg.password_hash && bcrypt.compareSync(password, rg.password_hash)) {
        if (rg.status === "Ожидает") return res.status(403).json({ error: "Ваша регистрация ещё на рассмотрении. Дождитесь решения администратора." });
        return res.status(403).json({ error: "Регистрация отклонена" + (rg.decision_note ? ": " + rg.decision_note : ".") });
      }
    }
    if (!u || !bcrypt.compareSync(password, u.password_hash)) {
      loginLimiter.hit(key);
      log("Неудачный вход", username);
      return res.status(401).json({ error: "Неверный логин или пароль" });
    }
    loginLimiter.clear(key);
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: "Ошибка сессии" });
      req.session.user = sessionUser(u);
      log("Вход в систему", "", u.username);
      res.json({ ok: true, user: publicUser(u) });
    });
  });

  app.post("/api/logout", auth, (req, res) => {
    log("Выход", "", req.session.user.username);
    req.session.destroy(() => { res.clearCookie("connect.sid"); res.json({ ok: true }); });
  });

  app.post("/api/password", auth, (req, res) => {
    const b = req.body || {};
    const u = db.prepare("SELECT * FROM users WHERE id=?").get(req.session.user.id);
    if (!u || !bcrypt.compareSync(String(b.current || ""), u.password_hash)) return res.status(403).json({ error: "Текущий пароль неверен" });
    const np = String(b.password || "");
    if (np.length < 10 || np.length > 72) return res.status(400).json({ error: "Новый пароль: от 10 до 72 символов" });
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(np, 12), u.id);
    log("Смена пароля", "", u.username);
    res.json({ ok: true });
  });

  // ---------- Пользователи ----------
  app.get("/api/users", adminOnly, (req, res) =>
    res.json(db.prepare("SELECT u.id,u.username,u.role,u.org,u.active,u.created_at,p.fio,p.token FROM users u LEFT JOIN profiles p ON p.user_id=u.id ORDER BY u.username").all()
      .map(u => ({ ...u, role_title: roleName(u.role) }))));

  function checkRoleOrg(role, org) {
    if (!roleExists(role)) return "Неизвестная роль";
    if (org && !orgExists(org)) return "Неизвестная организация";
    const sc = db.prepare("SELECT scope FROM roles WHERE id=?").get(role)?.scope;
    if (sc === "own" && !org && role !== "viewer") return "Для роли с доступом «только своя организация» укажите организацию";
    return null;
  }

  app.post("/api/users", adminOnly, (req, res) => {
    const b = req.body || {};
    const username = str(b.username, 40), password = String(b.password || ""), org = str(b.org, 60) || null;
    if (!USERNAME_RE.test(username)) return res.status(400).json({ error: "Логин: 3–40 символов — буквы, цифры, точка, дефис, подчёркивание" });
    if (password.length < 10 || password.length > 72) return res.status(400).json({ error: "Пароль: от 10 до 72 символов" });
    const err = checkRoleOrg(b.role, org);
    if (err) return res.status(400).json({ error: err });
    if (userNameTaken(username)) return res.status(409).json({ error: "Такой логин уже существует" });
    db.prepare("INSERT INTO users(username,password_hash,role,org) VALUES(?,?,?,?)").run(username, bcrypt.hashSync(password, 12), b.role, org);
    log("Создан пользователь", username + " (" + b.role + ")", req.session.user.username);
    res.json({ ok: true });
  });

  app.patch("/api/users/:id", adminOnly, (req, res) => {
    const t = db.prepare("SELECT * FROM users WHERE id=?").get(Number(req.params.id));
    if (!t) return res.status(404).json({ error: "Пользователь не найден" });
    const b = req.body || {}, actor = req.session.user;
    db.transaction(() => {
      if (b.active !== undefined) {
        if (t.id === actor.id) throw Object.assign(new Error("Нельзя отключить собственную учётную запись"), { status: 400, isUser: true });
        if (t.role === "main_admin") throw Object.assign(new Error("Нельзя отключить главного администратора"), { status: 400, isUser: true });
        db.prepare("UPDATE users SET active=? WHERE id=?").run(b.active ? 1 : 0, t.id);
        log(b.active ? "Пользователь включён" : "Пользователь отключён", t.username, actor.username);
      }
      if (b.password !== undefined) {
        const np = String(b.password);
        if (np.length < 10 || np.length > 72) throw Object.assign(new Error("Пароль: от 10 до 72 символов"), { status: 400, isUser: true });
        db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(np, 12), t.id);
        log("Сброс пароля", t.username, actor.username);
      }
      if (b.username !== undefined) {
        const nn = str(b.username, 40);
        if (!USERNAME_RE.test(nn)) throw Object.assign(new Error("Логин: 3–40 символов — буквы, цифры, точка, дефис, подчёркивание"), { status: 400, isUser: true });
        if (userNameTaken(nn, t.id)) throw Object.assign(new Error("Такой логин уже существует"), { status: 409, isUser: true });
        db.prepare("UPDATE users SET username=? WHERE id=?").run(nn, t.id);
        log("Смена логина", t.username + " → " + nn, actor.username);
      }
      if (b.role !== undefined || b.org !== undefined) {
        if (t.role === "main_admin") throw Object.assign(new Error("Роль главного администратора менять нельзя"), { status: 400, isUser: true });
        const role = b.role === undefined ? t.role : str(b.role, 40), org = b.org === undefined ? t.org : (str(b.org, 60) || null);
        const err = checkRoleOrg(role, org);
        if (err) throw Object.assign(new Error(err), { status: 400, isUser: true });
        db.prepare("UPDATE users SET role=?,org=? WHERE id=?").run(role, org, t.id);
        log("Изменены роль/организация", t.username + " → " + role + (org ? " / " + org : ""), actor.username);
      }
    })();
    res.json({ ok: true });
  });

  app.delete("/api/users/:id", adminOnly, (req, res) => {
    const t = db.prepare("SELECT * FROM users WHERE id=?").get(Number(req.params.id));
    if (!t) return res.status(404).json({ error: "Пользователь не найден" });
    if (t.role === "main_admin") return res.status(400).json({ error: "Главного администратора удалить нельзя" });
    if (t.id === req.session.user.id) return res.status(400).json({ error: "Нельзя удалить самого себя" });
    const p = db.prepare("SELECT avatar_path FROM profiles WHERE user_id=?").get(t.id);
    db.transaction(() => { db.prepare("DELETE FROM users WHERE id=?").run(t.id); if (p) dropFile(p.avatar_path); })();
    log("Пользователь удалён", t.username, req.session.user.username);
    res.json({ ok: true });
  });

  // ---------- Регистрация ----------
  app.post("/api/register", (req, res) => {
    if (req.session.user) return res.status(400).json({ error: "Вы уже вошли в систему" });
    if (registerLimiter.blocked(req.ip)) return res.status(429).json({ error: "Слишком много регистраций с вашего адреса. Попробуйте позже." });
    const b = req.body || {};
    const username = str(b.username, 40), password = String(b.password || "");
    const d = { fio: str(b.fio, 150), nickname: str(b.nickname, 60), discord: str(b.discord, 60), token: str(b.token, 7), passport: str(b.passport, 30) };
    if (!USERNAME_RE.test(username)) return res.status(400).json({ error: "Логин: 3–40 символов — буквы, цифры, точка, дефис, подчёркивание (без пробелов)" });
    if (password.length < 10 || password.length > 64) return res.status(400).json({ error: "Пароль должен быть от 10 до 64 символов" });
    if (password.toLowerCase() === username.toLowerCase()) return res.status(400).json({ error: "Пароль не должен совпадать с логином" });
    if (!d.fio) return res.status(400).json({ error: "Укажите ФИО" });
    if (!d.nickname) return res.status(400).json({ error: "Укажите ник" });
    if (!d.discord) return res.status(400).json({ error: "Укажите ник в Discord" });
    if (d.passport.length < 4) return res.status(400).json({ error: "Укажите номер паспорта" });
    if (d.token && !TOKEN_RE.test(d.token)) return res.status(400).json({ error: "Жетон должен иметь формат 000-000" });
    if (userNameTaken(username) || pendingNameTaken(username)) return res.status(409).json({ error: "Такой логин уже занят" });
    if (d.token && (db.prepare("SELECT 1 FROM profiles WHERE token=?").get(d.token) || db.prepare("SELECT 1 FROM registrations WHERE token=? AND status='Ожидает'").get(d.token)))
      return res.status(409).json({ error: "Этот жетон уже указан в другом профиле" });
    if (db.prepare("SELECT COUNT(*) n FROM registrations WHERE status='Ожидает'").get().n >= 200)
      return res.status(503).json({ error: "Приём регистраций временно закрыт: слишком много нерассмотренных. Обратитесь к администратору." });
    db.prepare("INSERT INTO registrations(username,password_hash,fio,nickname,discord,token,passport) VALUES(?,?,?,?,?,?,?)")
      .run(username, bcrypt.hashSync(password, 12), d.fio, d.nickname, d.discord, d.token, d.passport);
    registerLimiter.hit(req.ip);
    log("Подана регистрация", username, username);
    res.json({ ok: true });
  });

  app.get("/api/registrations", adminOnly, (req, res) => {
    const rows = db.prepare(`SELECT id,username,fio,nickname,discord,token,passport,status,decided_by,decided_at,decision_note,created_at
      FROM registrations ORDER BY CASE status WHEN 'Ожидает' THEN 0 ELSE 1 END, id DESC LIMIT 200`).all();
    const st = db.prepare("SELECT fio,org,status FROM staff WHERE token=?");
    res.json(rows.map(r => ({ ...r, staff_match: r.token ? (st.get(r.token) || null) : null })));
  });

  app.post("/api/registrations/:id/approve", adminOnly, (req, res) => {
    const r = db.prepare("SELECT * FROM registrations WHERE id=?").get(Number(req.params.id));
    if (!r) return res.status(404).json({ error: "Регистрация не найдена" });
    if (r.status !== "Ожидает") return res.status(409).json({ error: "Регистрация уже обработана" });
    const b = req.body || {};
    const roleName_ = str(b.role, 40) || "viewer", org = str(b.org, 60) || null;
    const err = checkRoleOrg(roleName_, org);
    if (err) return res.status(400).json({ error: err });
    if (userNameTaken(r.username)) return res.status(409).json({ error: "Логин уже занят — отклоните эту регистрацию" });
    try {
      db.transaction(() => {
        const info = db.prepare("INSERT INTO users(username,password_hash,role,org) VALUES(?,?,?,?)").run(r.username, r.password_hash, roleName_, org);
        db.prepare("INSERT INTO profiles(user_id,fio,nickname,discord,token,passport) VALUES(?,?,?,?,?,?)").run(info.lastInsertRowid, r.fio, r.nickname, r.discord, r.token, r.passport);
        db.prepare("UPDATE registrations SET status='Одобрена',password_hash='',decided_by=?,decided_at=? WHERE id=?").run(req.session.user.username, new Date().toISOString(), r.id);
      })();
    } catch (e) {
      if (isUnique(e)) return res.status(409).json({ error: "Логин или жетон уже заняты" });
      throw e;
    }
    log("Регистрация одобрена", r.username + " (" + roleName_ + ")", req.session.user.username);
    res.json({ ok: true });
  });

  app.post("/api/registrations/:id/reject", adminOnly, (req, res) => {
    const r = db.prepare("SELECT * FROM registrations WHERE id=?").get(Number(req.params.id));
    if (!r) return res.status(404).json({ error: "Регистрация не найдена" });
    if (r.status !== "Ожидает") return res.status(409).json({ error: "Регистрация уже обработана" });
    db.prepare("UPDATE registrations SET status='Отклонена',decided_by=?,decided_at=?,decision_note=? WHERE id=?")
      .run(req.session.user.username, new Date().toISOString(), str((req.body || {}).note, 300), r.id);
    log("Регистрация отклонена", r.username, req.session.user.username);
    res.json({ ok: true });
  });

  // ---------- Профили ----------
  const profileOf = userId => db.prepare("SELECT fio,nickname,discord,token,passport,avatar_path FROM profiles WHERE user_id=?").get(userId) || null;
  function profileInput(b, old, admin) {
    const pick = (k, max) => b[k] === undefined ? str(old ? old[k] : "", max) : str(b[k], max);
    const d = { fio: pick("fio", 150), nickname: pick("nickname", 60), discord: pick("discord", 60), token: pick("token", 7), passport: pick("passport", 30) };
    if (!admin) { d.token = old?.token || ""; if (old?.fio) d.fio = old.fio; }
    if (d.token && !TOKEN_RE.test(d.token)) return { error: "Жетон должен иметь формат 000-000" };
    return { d };
  }
  function saveProfile(userId, d) {
    db.prepare(`INSERT INTO profiles(user_id,fio,nickname,discord,token,passport) VALUES(@user_id,@fio,@nickname,@discord,@token,@passport)
      ON CONFLICT(user_id) DO UPDATE SET fio=@fio,nickname=@nickname,discord=@discord,token=@token,passport=@passport,updated_at=CURRENT_TIMESTAMP`).run({ user_id: userId, ...d });
  }
  app.get("/api/profile", auth, (req, res) => {
    const u = req.session.user;
    res.json({ username: u.username, role: u.role, role_title: roleName(u.role), org: u.org, profile: profileOf(u.id), can_edit_identity: u.role === "main_admin" });
  });
  app.put("/api/profile", auth, (req, res) => {
    const u = req.session.user;
    const r = profileInput(req.body || {}, profileOf(u.id), u.role === "main_admin");
    if (r.error) return res.status(400).json({ error: r.error });
    try { saveProfile(u.id, r.d); } catch (e) {
      if (isUnique(e)) return res.status(409).json({ error: "Этот жетон уже привязан к другому профилю" });
      throw e;
    }
    log("Профиль обновлён", u.username, u.username);
    res.json({ ok: true });
  });
  app.post("/api/profile/avatar", auth, imageUpload, (req, res) => {
    const uid = req.session.user.id, old = profileOf(uid), p = saveImage(req.img);
    db.prepare(`INSERT INTO profiles(user_id,avatar_path) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET avatar_path=excluded.avatar_path,updated_at=CURRENT_TIMESTAMP`).run(uid, p);
    if (old) dropFile(old.avatar_path);
    res.json({ ok: true, avatar_path: p });
  });
  app.get("/api/profiles/:userId", adminOnly, (req, res) => {
    const t = db.prepare("SELECT id,username,role,org FROM users WHERE id=?").get(Number(req.params.userId));
    if (!t) return res.status(404).json({ error: "Пользователь не найден" });
    res.json({ user: t, profile: profileOf(t.id) });
  });
  app.put("/api/profiles/:userId", adminOnly, (req, res) => {
    const t = db.prepare("SELECT id,username FROM users WHERE id=?").get(Number(req.params.userId));
    if (!t) return res.status(404).json({ error: "Пользователь не найден" });
    const r = profileInput(req.body || {}, profileOf(t.id), true);
    if (r.error) return res.status(400).json({ error: r.error });
    try { saveProfile(t.id, r.d); } catch (e) {
      if (isUnique(e)) return res.status(409).json({ error: "Этот жетон уже привязан к другому профилю" });
      throw e;
    }
    log("Профиль изменён администратором", t.username, req.session.user.username);
    res.json({ ok: true });
  });
};
module.exports.profileOf = userId => db.prepare("SELECT fio,nickname,discord,token,passport,avatar_path FROM profiles WHERE user_id=?").get(userId) || null;
