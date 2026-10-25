"use strict";
const crypto = require("crypto");
const C = require("../lib/core");
const { PERMS, PERM_IDS } = require("../lib/db");
const { db, str, isUnique, log, need, adminOnly, can, orgTree, loadRoles } = C;

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const KINDS = ["rank", "position", "unit"];
const httpErr = (msg, status = 400) => Object.assign(new Error(msg), { status });

module.exports = app => {
  // ---------- Организации, звания, должности, подразделения ----------
  app.get("/api/orgs", C.auth, (req, res) => {
    const cnt = Object.fromEntries(db.prepare("SELECT org,COUNT(*) n FROM staff GROUP BY org").all().map(r => [r.org, r.n]));
    const ucnt = Object.fromEntries(db.prepare("SELECT org,COUNT(*) n FROM users WHERE org IS NOT NULL GROUP BY org").all().map(r => [r.org, r.n]));
    res.json(orgTree().map(o => ({ ...o, staff_count: cnt[o.name] || 0, user_count: ucnt[o.name] || 0 })));
  });

  app.post("/api/orgs", need("orgs.manage"), (req, res) => {
    const name = str((req.body || {}).name, 60), color = str((req.body || {}).color, 7) || "#6b7a99";
    if (name.length < 2) return res.status(400).json({ error: "Введите название организации" });
    if (!COLOR_RE.test(color)) return res.status(400).json({ error: "Цвет в формате #rrggbb" });
    try {
      const max = db.prepare("SELECT COALESCE(MAX(sort),-1)+1 n FROM orgs").get().n;
      const id = db.prepare("INSERT INTO orgs(name,color,sort) VALUES(?,?,?)").run(name, color, max).lastInsertRowid;
      log("Организация добавлена", name, req.session.user.username);
      res.json({ ok: true, id });
    } catch (e) {
      if (isUnique(e)) return res.status(409).json({ error: "Такая организация уже есть" });
      throw e;
    }
  });

  app.patch("/api/orgs/:id", need("orgs.manage"), (req, res) => {
    const o = db.prepare("SELECT * FROM orgs WHERE id=?").get(Number(req.params.id));
    if (!o) return res.status(404).json({ error: "Организация не найдена" });
    const b = req.body || {};
    const name = b.name === undefined ? o.name : str(b.name, 60), color = b.color === undefined ? o.color : str(b.color, 7);
    if (name.length < 2) return res.status(400).json({ error: "Введите название организации" });
    if (!COLOR_RE.test(color)) return res.status(400).json({ error: "Цвет в формате #rrggbb" });
    try {
      db.transaction(() => {
        db.prepare("UPDATE orgs SET name=?,color=? WHERE id=?").run(name, color, o.id);
        if (name !== o.name) {
          for (const [t, c] of [["staff", "org"], ["users", "org"], ["history", "org"], ["orders", "org"], ["orders", "org_to"], ["career", "org"]])
            db.prepare(`UPDATE ${t} SET ${c}=? WHERE ${c}=?`).run(name, o.name);
        }
      })();
    } catch (e) {
      if (isUnique(e)) return res.status(409).json({ error: "Организация с таким названием уже есть" });
      throw e;
    }
    log("Организация изменена", o.name + (name !== o.name ? " → " + name : ""), req.session.user.username);
    res.json({ ok: true });
  });

  app.post("/api/orgs/:id/move", need("orgs.manage"), (req, res) => {
    const list = db.prepare("SELECT id FROM orgs ORDER BY sort,id").all().map(r => r.id);
    const i = list.indexOf(Number(req.params.id)), j = i + ((req.body || {}).dir === "up" ? -1 : 1);
    if (i < 0) return res.status(404).json({ error: "Организация не найдена" });
    if (j >= 0 && j < list.length) { [list[i], list[j]] = [list[j], list[i]]; db.transaction(() => list.forEach((id, k) => db.prepare("UPDATE orgs SET sort=? WHERE id=?").run(k, id)))(); }
    res.json({ ok: true });
  });

  app.delete("/api/orgs/:id", need("orgs.manage"), (req, res) => {
    const o = db.prepare("SELECT * FROM orgs WHERE id=?").get(Number(req.params.id));
    if (!o) return res.status(404).json({ error: "Организация не найдена" });
    const sc = db.prepare("SELECT COUNT(*) n FROM staff WHERE org=?").get(o.name).n;
    const uc = db.prepare("SELECT COUNT(*) n FROM users WHERE org=?").get(o.name).n;
    const moveTo = str((req.body || {}).moveTo, 60);
    if ((sc || uc) && !moveTo) return res.status(409).json({ error: `В организации ${sc} дел и ${uc} пользователей. Выберите, куда их перенести.`, staff: sc, users: uc });
    if (moveTo && (moveTo === o.name || !C.orgExists(moveTo))) return res.status(400).json({ error: "Неверная организация для переноса" });
    db.transaction(() => {
      if (moveTo) { db.prepare("UPDATE staff SET org=? WHERE org=?").run(moveTo, o.name); db.prepare("UPDATE users SET org=? WHERE org=?").run(moveTo, o.name); }
      db.prepare("DELETE FROM orgs WHERE id=?").run(o.id);
    })();
    log("Организация удалена", o.name + (moveTo ? " (дела → " + moveTo + ")" : ""), req.session.user.username);
    res.json({ ok: true });
  });

  app.post("/api/orgs/:id/items", need("orgs.manage"), (req, res) => {
    const o = db.prepare("SELECT * FROM orgs WHERE id=?").get(Number(req.params.id));
    if (!o) return res.status(404).json({ error: "Организация не найдена" });
    const b = req.body || {}, kind = str(b.kind, 10), name = str(b.name, 100);
    if (!KINDS.includes(kind)) return res.status(400).json({ error: "Неизвестный тип записи" });
    if (!name) return res.status(400).json({ error: "Введите название" });
    const stars = kind === "rank" ? Math.max(0, Math.min(6, Number(b.stars) | 0)) : 0;
    try {
      const max = db.prepare("SELECT COALESCE(MAX(sort),-1)+1 n FROM org_items WHERE org_id=? AND kind=?").get(o.id, kind).n;
      db.prepare("INSERT INTO org_items(org_id,kind,name,sort,stars) VALUES(?,?,?,?,?)").run(o.id, kind, name, max, stars);
    } catch (e) {
      if (isUnique(e)) return res.status(409).json({ error: "Такая запись уже есть" });
      throw e;
    }
    log("Справочник: добавлено", o.name + " / " + kind + " / " + name, req.session.user.username);
    res.json({ ok: true });
  });

  app.patch("/api/items/:id", need("orgs.manage"), (req, res) => {
    const it = db.prepare("SELECT i.*,o.name org FROM org_items i JOIN orgs o ON o.id=i.org_id WHERE i.id=?").get(Number(req.params.id));
    if (!it) return res.status(404).json({ error: "Запись не найдена" });
    const b = req.body || {};
    const name = b.name === undefined ? it.name : str(b.name, 100);
    const stars = b.stars === undefined || it.kind !== "rank" ? it.stars : Math.max(0, Math.min(6, Number(b.stars) | 0));
    if (!name) return res.status(400).json({ error: "Введите название" });
    try {
      db.transaction(() => {
        db.prepare("UPDATE org_items SET name=?,stars=? WHERE id=?").run(name, stars, it.id);
        if (name !== it.name) {
          const col = { rank: "rank", position: "position", unit: "unit" }[it.kind];
          db.prepare(`UPDATE staff SET ${col}=? WHERE org=? AND ${col}=?`).run(name, it.org, it.name);
        }
      })();
    } catch (e) {
      if (isUnique(e)) return res.status(409).json({ error: "Такая запись уже есть" });
      throw e;
    }
    res.json({ ok: true });
  });

  app.post("/api/items/:id/move", need("orgs.manage"), (req, res) => {
    const it = db.prepare("SELECT * FROM org_items WHERE id=?").get(Number(req.params.id));
    if (!it) return res.status(404).json({ error: "Запись не найдена" });
    const list = db.prepare("SELECT id FROM org_items WHERE org_id=? AND kind=? ORDER BY sort,id").all(it.org_id, it.kind).map(r => r.id);
    const i = list.indexOf(it.id), j = i + ((req.body || {}).dir === "up" ? -1 : 1);
    if (j >= 0 && j < list.length) { [list[i], list[j]] = [list[j], list[i]]; db.transaction(() => list.forEach((id, k) => db.prepare("UPDATE org_items SET sort=? WHERE id=?").run(k, id)))(); }
    res.json({ ok: true });
  });

  app.delete("/api/items/:id", need("orgs.manage"), (req, res) => {
    const it = db.prepare("SELECT i.*,o.name org FROM org_items i JOIN orgs o ON o.id=i.org_id WHERE i.id=?").get(Number(req.params.id));
    if (!it) return res.status(404).json({ error: "Запись не найдена" });
    db.prepare("DELETE FROM org_items WHERE id=?").run(it.id);
    log("Справочник: удалено", it.org + " / " + it.kind + " / " + it.name, req.session.user.username);
    res.json({ ok: true });
  });

  // ---------- Права ----------
  const roleRows = () => db.prepare("SELECT id,title,scope,builtin FROM roles ORDER BY builtin DESC, title").all().map(r => ({
    ...r, perms: db.prepare("SELECT perm FROM role_perms WHERE role=?").all(r.id).map(x => x.perm),
    users: db.prepare("SELECT COUNT(*) n FROM users WHERE role=?").get(r.id).n
  }));
  app.get("/api/perms", adminOnly, (req, res) => res.json({ perms: PERMS.map(([id, group, title]) => ({ id, group, title })), roles: roleRows() }));

  function saveRole(id, b) {
    const perms = [...new Set((Array.isArray(b.perms) ? b.perms : []).filter(p => PERM_IDS.includes(p)))];
    db.transaction(() => {
      db.prepare("DELETE FROM role_perms WHERE role=?").run(id);
      perms.forEach(p => db.prepare("INSERT INTO role_perms(role,perm) VALUES(?,?)").run(id, p));
    })();
  }
  app.put("/api/perms/roles/:id", adminOnly, (req, res) => {
    const r = db.prepare("SELECT * FROM roles WHERE id=?").get(req.params.id);
    if (!r) return res.status(404).json({ error: "Роль не найдена" });
    const b = req.body || {}, title = b.title === undefined ? r.title : str(b.title, 60), scope = b.scope === undefined ? r.scope : str(b.scope, 5);
    if (!title) return res.status(400).json({ error: "Введите название роли" });
    if (!["own", "all"].includes(scope)) return res.status(400).json({ error: "Область: own или all" });
    db.prepare("UPDATE roles SET title=?,scope=? WHERE id=?").run(title, scope, r.id);
    if (b.perms !== undefined) saveRole(r.id, b);
    loadRoles();
    log("Права роли изменены", r.id, req.session.user.username);
    res.json({ ok: true });
  });
  app.post("/api/perms/roles", adminOnly, (req, res) => {
    const b = req.body || {}, title = str(b.title, 60), scope = str(b.scope, 5) || "own";
    if (!title) return res.status(400).json({ error: "Введите название роли" });
    if (!["own", "all"].includes(scope)) return res.status(400).json({ error: "Область: own или all" });
    const id = "role_" + crypto.randomBytes(3).toString("hex");
    db.prepare("INSERT INTO roles(id,title,scope,builtin) VALUES(?,?,?,0)").run(id, title, scope);
    saveRole(id, b);
    loadRoles();
    log("Создана роль", title, req.session.user.username);
    res.json({ ok: true, id });
  });
  app.delete("/api/perms/roles/:id", adminOnly, (req, res) => {
    const r = db.prepare("SELECT * FROM roles WHERE id=?").get(req.params.id);
    if (!r) return res.status(404).json({ error: "Роль не найдена" });
    if (r.id === "viewer") return res.status(400).json({ error: "Роль «Просмотр» удалить нельзя" });
    const n = db.prepare("SELECT COUNT(*) n FROM users WHERE role=?").get(r.id).n;
    if (n) return res.status(409).json({ error: `Роль назначена ${n} пользователям — сначала смените им роль` });
    db.prepare("DELETE FROM roles WHERE id=?").run(r.id);
    loadRoles();
    log("Роль удалена", r.title, req.session.user.username);
    res.json({ ok: true });
  });

  // ---------- Журнал действий ----------
  app.get("/api/audit", need("audit.view"), (req, res) =>
    res.json(db.prepare("SELECT username,action,target,created_at FROM access_log ORDER BY id DESC LIMIT 500").all()));
};
