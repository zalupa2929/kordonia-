"use strict";
// Администрирование: регистрации, пользователи, права, журнал, копии и база.
let ROLES = [];
const loadRoles = async () => { ROLES = (await api("/api/perms")).roles; return ROLES; };
const roleTitle = id => id === "main_admin" ? "Главный администратор" : (ROLES.find(r => r.id === id)?.title || id);
const roleOpts = (sel, withMain) => ROLES.map(r => `<option value="${esc(r.id)}" ${r.id === sel ? "selected" : ""}>${esc(r.title)}</option>`).join("");
const orgOpts = sel => '<option value="">Без организации</option>' + S.orgs.map(o => `<option ${o.name === sel ? "selected" : ""}>${esc(o.name)}</option>`).join("");

// ---------- Регистрации ----------
VIEWS.regs = {
  async render(el) {
    await loadRoles();
    const a = await api("/api/registrations");
    navBadges.regs = a.filter(r => r.status === "Ожидает").length || ""; buildNav();
    el.innerHTML = `<div class="head"><div><h2>Регистрации</h2><div class="muted">Новые пользователи получают доступ только после вашего одобрения</div></div></div>
      <div class="grid">${a.map(r => {
        const cls = r.status === "Одобрена" ? "good" : r.status === "Ожидает" ? "warn" : "bad";
        const m = !r.token ? "" : r.staff_match ? `<div class="good small">Жетон найден в реестре: ${esc(r.staff_match.fio)} (${esc(r.staff_match.org)}, ${esc(r.staff_match.status)})</div>` : '<div class="muted small">Жетон не найден среди сотрудников</div>';
        return `<div class="card"><div class="row sp"><b>${esc(r.username)}</b><span class="pill ${cls}">${esc(r.status)}</span></div><div style="margin-top:6px">${esc(r.fio)}</div>
          <div class="small">ник: ${esc(r.nickname)} · Discord: ${esc(r.discord)}<br>жетон: ${esc(r.token || "—")} · паспорт: ${esc(r.passport)}</div>${m}
          <div class="small" style="margin-top:6px">${esc(fmtDT(r.created_at))}${r.decided_by ? " · решение: " + esc(r.decided_by) : ""}${r.decision_note ? " · " + esc(r.decision_note) : ""}</div>
          ${r.status === "Ожидает" ? `<div class="row" style="margin-top:10px"><button class="btn primary sm" data-ok="${r.id}" data-who="${esc(r.username)}">Одобрить</button><button class="btn sm danger" data-no="${r.id}">Отклонить</button></div>` : ""}</div>`;
      }).join("") || '<div class="empty">Регистраций пока нет</div>'}</div>`;
    el.querySelectorAll("[data-ok]").forEach(b => b.onclick = () => {
      const d = openDlg("dlg2", "Одобрить регистрацию", `<p>Пользователь: <b>${esc(b.dataset.who)}</b></p><div class="form"><div class="field"><label>Роль</label><select id="rg_role">${roleOpts("viewer")}</select></div><div class="field"><label>Организация (для ролей «только своя организация»)</label><select id="rg_org">${orgOpts("")}</select></div></div>`,
        { footer: '<button class="btn" data-no>Отмена</button><button class="btn primary" id="rg_ok">Одобрить</button>' });
      d.querySelector("[data-no]").onclick = () => d.close();
      d.querySelector("#rg_ok").onclick = () => run(async () => { await post(`/api/registrations/${b.dataset.ok}/approve`, { role: d.querySelector("#rg_role").value, org: d.querySelector("#rg_org").value }); d.close(); go("regs", null, { push: false }); }, "Регистрация одобрена");
    });
    el.querySelectorAll("[data-no]").forEach(b => b.onclick = async () => { const n = await askBox("Отклонить регистрацию", "Причина (можно пусто)", { multiline: true, ok: "Отклонить" }); if (n === null) return; run(async () => { await post(`/api/registrations/${b.dataset.no}/reject`, { note: n }); go("regs", null, { push: false }); }, "Отклонено"); });
  }
};

// ---------- Пользователи ----------
function openUserForm() {
  const d = openDlg("dlg", "Новый пользователь", `<div class="form"><div class="field"><label>Логин</label><input id="nu_n" maxlength="40"></div><div class="field"><label>Пароль (от 10 символов)</label><input id="nu_p" type="password" autocomplete="new-password"></div>
    <div class="field"><label>Роль</label><select id="nu_r">${roleOpts("viewer")}</select></div><div class="field"><label>Организация</label><select id="nu_o">${orgOpts("")}</select></div></div>`,
    { footer: '<button class="btn" data-no>Отмена</button><button class="btn primary" id="nu_ok">Создать</button>' });
  d.querySelector("[data-no]").onclick = () => d.close();
  d.querySelector("#nu_ok").onclick = () => run(async () => { await post("/api/users", { username: d.querySelector("#nu_n").value.trim(), password: d.querySelector("#nu_p").value, role: d.querySelector("#nu_r").value, org: d.querySelector("#nu_o").value }); d.close(); go("users", null, { push: false }); }, "Пользователь создан");
}
VIEWS.users = {
  async render(el) {
    await loadRoles();
    const a = await api("/api/users"); let q = "";
    el.innerHTML = `<div class="head"><div><h2>Пользователи</h2></div><button class="btn primary" id="uNew">➕ Новый пользователь</button></div><div class="toolbar"><input type="search" id="uQ" placeholder="Поиск по логину, ФИО…"></div><div id="uList"></div>`;
    const draw = () => {
      const l = a.filter(u => !q || [u.username, u.fio, u.role_title, u.org].join(" ").toLowerCase().includes(q));
      $("uList").innerHTML = `<div class="grid">${l.map(u => `<div class="card"><div class="row sp"><b>${esc(u.username)}</b><span class="pill ${u.active ? "good" : "bad"}">${u.active ? "активен" : "отключён"}</span></div>
        <div class="small" style="margin:4px 0 8px">${esc(u.fio || "ФИО не указано")}${u.token ? " · жетон " + esc(u.token) : ""}</div>
        ${u.role === "main_admin" ? '<span class="pill sec">Главный администратор</span>' : `<div class="row"><select data-role="${u.id}" style="flex:1;min-width:140px">${roleOpts(u.role)}</select><select data-uorg="${u.id}" style="flex:1;min-width:120px">${orgOpts(u.org)}</select></div>`}
        <div class="row" style="margin-top:10px"><button class="btn sm" data-prof="${u.id}">Профиль</button><button class="btn sm" data-ren="${u.id}" data-n="${esc(u.username)}">Логин</button><button class="btn sm" data-pw="${u.id}">Пароль</button>
        ${u.role !== "main_admin" ? `<button class="btn sm" data-tog="${u.id}" data-a="${u.active ? 0 : 1}">${u.active ? "Отключить" : "Включить"}</button><button class="btn sm danger" data-rm="${u.id}" data-n="${esc(u.username)}">Удалить</button>` : ""}</div></div>`).join("")}</div>`;
      const again = () => go("users", null, { push: false });
      const save = id => run(async () => { await patch("/api/users/" + id, { role: $("uList").querySelector(`[data-role="${id}"]`).value, org: $("uList").querySelector(`[data-uorg="${id}"]`).value }); }, "Сохранено").then(again);
      $("uList").querySelectorAll("[data-role]").forEach(s => s.onchange = () => save(s.dataset.role));
      $("uList").querySelectorAll("[data-uorg]").forEach(s => s.onchange = () => save(s.dataset.uorg));
      $("uList").querySelectorAll("[data-tog]").forEach(b => b.onclick = () => run(async () => { await patch("/api/users/" + b.dataset.tog, { active: b.dataset.a === "1" }); again(); }));
      $("uList").querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => { if (await confirmBox(`Удалить пользователя «${b.dataset.n}»?`, { danger: true, ok: "Удалить" })) run(async () => { await del("/api/users/" + b.dataset.rm); again(); }, "Удалён"); });
      $("uList").querySelectorAll("[data-ren]").forEach(b => b.onclick = async () => { const v = await askBox("Сменить логин", "Новый логин", { value: b.dataset.n }); if (v && v.trim() !== b.dataset.n) run(async () => { await patch("/api/users/" + b.dataset.ren, { username: v.trim() }); if (b.dataset.n === S.user.username) { await loadConfig(); applyUser(); } again(); }, "Логин изменён"); });
      $("uList").querySelectorAll("[data-pw]").forEach(b => b.onclick = async () => { const v = await askBox("Сброс пароля", "Новый пароль (от 10 символов)", { type: "password" }); if (v) run(() => patch("/api/users/" + b.dataset.pw, { password: v }), "Пароль изменён"); });
      $("uList").querySelectorAll("[data-prof]").forEach(b => b.onclick = () => run(async () => {
        const r = await api("/api/profiles/" + b.dataset.prof), p = r.profile || {};
        const dd = openDlg("dlg", "Профиль: " + esc(r.user.username), `<div class="form"><div class="field wide"><label>ФИО</label><input id="ap_fio" value="${esc(p.fio || "")}"></div><div class="field"><label>Ник</label><input id="ap_nick" value="${esc(p.nickname || "")}"></div><div class="field"><label>Discord</label><input id="ap_disc" value="${esc(p.discord || "")}"></div><div class="field"><label>Жетон (привязывает дело)</label><input id="ap_tok" value="${esc(p.token || "")}" placeholder="123-456"></div><div class="field"><label>Паспорт</label><input id="ap_pass" value="${esc(p.passport || "")}"></div></div>`,
          { footer: '<button class="btn" data-no>Отмена</button><button class="btn primary" id="ap_ok">Сохранить</button>' });
        dd.querySelector("[data-no]").onclick = () => dd.close();
        dd.querySelector("#ap_ok").onclick = () => run(async () => { await put("/api/profiles/" + b.dataset.prof, { fio: dd.querySelector("#ap_fio").value, nickname: dd.querySelector("#ap_nick").value, discord: dd.querySelector("#ap_disc").value, token: dd.querySelector("#ap_tok").value, passport: dd.querySelector("#ap_pass").value }); dd.close(); again(); }, "Профиль сохранён");
      }));
    };
    draw(); $("uQ").oninput = debounce(() => { q = $("uQ").value.toLowerCase(); draw(); }, 150);
    $("uNew").onclick = openUserForm;
  }
};

// ---------- Права ----------
VIEWS.perms = {
  async render(el) {
    const d = await api("/api/perms"); ROLES = d.roles;
    const groups = [...new Set(d.perms.map(p => p.group))];
    const state = Object.fromEntries(d.roles.map(r => [r.id, { scope: r.scope, perms: new Set(r.perms) }]));
    el.innerHTML = `<div class="head"><div><h2>Права доступа</h2><div class="muted">Отметьте, что может делать каждая роль. «Только своя организация» — действует в рамках организации пользователя. Главный администратор может всё и не настраивается.</div></div>
      <div class="row"><button class="btn" id="pmAdd">➕ Новая роль</button><button class="btn primary" id="pmSave">💾 Сохранить</button></div></div>
      <div class="tablewrap"><table class="matrix"><thead><tr><th>Право</th>${d.roles.map(r => `<th style="min-width:130px">${esc(r.title)}<div class="small" style="text-transform:none;letter-spacing:0">${r.users} польз.</div>
        <select data-scope="${esc(r.id)}" style="padding:3px 6px;margin-top:4px;font-size:12px"><option value="own" ${r.scope === "own" ? "selected" : ""}>только своя орг.</option><option value="all" ${r.scope === "all" ? "selected" : ""}>все организации</option></select>
        ${r.builtin ? "" : `<div><button class="btn sm danger" data-delrole="${esc(r.id)}" style="margin-top:4px">удалить</button></div>`}</th>`).join("")}</tr></thead><tbody>
      ${groups.map(g => `<tr class="grp"><td colspan="${d.roles.length + 1}">${esc(g)}</td></tr>${d.perms.filter(p => p.group === g).map(p => `<tr><td>${esc(p.title)}</td>${d.roles.map(r => `<td><input type="checkbox" data-r="${esc(r.id)}" data-p="${esc(p.id)}" ${r.perms.includes(p.id) ? "checked" : ""}></td>`).join("")}</tr>`).join("")}`).join("")}</tbody></table></div>
      <p class="small" style="margin-top:12px">Не настраиваются и всегда только у главного администратора: пользователи, регистрации, права, резервные копии и восстановление.</p>`;
    el.querySelectorAll("[data-p]").forEach(c => c.onchange = () => { const s = state[c.dataset.r].perms; c.checked ? s.add(c.dataset.p) : s.delete(c.dataset.p); });
    el.querySelectorAll("[data-scope]").forEach(s => s.onchange = () => { state[s.dataset.scope].scope = s.value; });
    $("pmSave").onclick = () => run(async () => { for (const [id, v] of Object.entries(state)) await put("/api/perms/roles/" + id, { scope: v.scope, perms: [...v.perms] }); await loadConfig(); applyUser(); }, "Права сохранены и уже действуют");
    el.querySelectorAll("[data-delrole]").forEach(b => b.onclick = async () => { if (await confirmBox("Удалить роль?", { danger: true, ok: "Удалить" })) run(async () => { await del("/api/perms/roles/" + b.dataset.delrole); go("perms", null, { push: false }); }, "Роль удалена"); });
    $("pmAdd").onclick = () => {
      const dd = openDlg("dlg2", "Новая роль", `<div class="field"><label>Название (например, «Прокурор»)</label><input id="nr_t" maxlength="60"></div><div class="field"><label>Область действия</label><select id="nr_s"><option value="own">только своя организация</option><option value="all">все организации</option></select></div><p class="small">Права отметите в таблице после создания.</p>`,
        { footer: '<button class="btn" data-no>Отмена</button><button class="btn primary" id="nr_ok">Создать</button>' });
      dd.querySelector("[data-no]").onclick = () => dd.close();
      dd.querySelector("#nr_ok").onclick = () => run(async () => { await post("/api/perms/roles", { title: dd.querySelector("#nr_t").value, scope: dd.querySelector("#nr_s").value, perms: ["staff.view"] }); dd.close(); go("perms", null, { push: false }); }, "Роль создана");
    };
  }
};

// ---------- Журнал ----------
VIEWS.audit = {
  async render(el) {
    const rows = await api("/api/audit"); let q = "";
    el.innerHTML = `<div class="head"><div><h2>Журнал действий</h2><div class="muted">Входы, изменения доступа, проверки жетонов</div></div></div><div class="toolbar"><input type="search" id="auQ" placeholder="Поиск…"></div><div id="auList"></div>`;
    const draw = () => { const a = rows.filter(r => !q || [r.username, r.action, r.target].join(" ").toLowerCase().includes(q));
      $("auList").innerHTML = a.length ? `<div class="tablewrap"><table><thead><tr><th>Когда</th><th>Кто</th><th>Действие</th><th>Объект</th></tr></thead><tbody>${a.map(r => `<tr><td class="small">${esc(fmtDT(r.created_at))}</td><td>${esc(r.username)}</td><td><b>${esc(r.action)}</b></td><td>${esc(r.target || "")}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">Пусто</div>'; };
    draw(); $("auQ").oninput = debounce(() => { q = $("auQ").value.toLowerCase(); draw(); }, 150);
  }
};

// ---------- Копии и база ----------
function waitRestart() {
  openDlg("dlg3", "Восстановление", '<p>Данные приняты. Сервер перезапускается и применяет копию…</p><p class="small">Страница обновится сама, когда сервер снова заработает (обычно 10–40 секунд).</p>');
  $("dlg3").oncancel = e => e.preventDefault();
  let n = 0;
  const t = setInterval(async () => { n++; try { const r = await fetch("/healthz", { cache: "no-store" }); if (r.ok && n > 3) { clearInterval(t); location.href = "/"; } } catch { /* сервер перезапускается */ } if (n > 120) clearInterval(t); }, 1500);
}
const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + " МБ" : Math.max(1, Math.round(n / 1024)) + " КБ";
VIEWS.backup = {
  async render(el) {
    const st = await api("/api/backup/status"), r = st.remote;
    const gh = r.configured
      ? `<div class="row sp"><b>GitHub-копия</b><span class="pill ${r.error ? "bad" : r.synced ? "good" : "warn"}">${r.error ? "ошибка" : r.synced ? "включена" : "ожидает"}</span></div><div class="small" style="margin-top:6px">Репозиторий ${esc(r.repo)} · ветка ${esc(r.branch)}<br>Последняя отправка: ${r.at ? esc(fmtDT(r.at)) : "ещё не было"}${r.error ? `<br><span class="bad">${esc(r.error)}</span>` : ""}${!r.synced ? '<br><span class="warn">Сервер стартовал без доступа к копии — отправка заблокирована, чтобы не затереть её пустой базой. Нажмите «Восстановить из GitHub» или «Отправить принудительно».</span>' : ""}</div>`
      : `<div class="row sp"><b>GitHub-копия</b><span class="pill warn">не настроена</span></div><div class="small" style="margin-top:6px">${r.problem ? "Проблема: " + esc(r.problem) + "<br>" : ""}Без неё на бесплатном Render <b>все данные пропадают при каждом перезапуске</b>. Настройка ниже.</div>`;
    el.innerHTML = `<div class="head"><div><h2>Копии и база данных</h2><div class="muted">Резервное копирование, проверка и восстановление</div></div></div>
      ${st.restored ? `<div class="panel good" style="margin-bottom:14px">✅ При запуске данные восстановлены: ${esc(st.restored)}</div>` : ""}
      <div class="grid" style="margin-bottom:16px"><div class="panel">${gh}</div>
        <div class="panel"><div class="row sp"><b>Локальные копии</b><span class="pill">${st.local.files.length}</span></div><div class="small" style="margin-top:6px">Последняя: ${st.local.at ? esc(fmtDT(st.local.at)) : "нет"} <br>Папка: ${esc(st.local.dir)}<br>Лежат рядом с базой: если диск стирается при перезапуске (бесплатный Render), они пропадут вместе с ним.</div></div></div>
      <div class="panel" style="margin-bottom:16px"><h3 style="margin-bottom:10px">Действия</h3><div class="row"><button class="btn primary" id="bkRun">💾 Сделать копию сейчас</button><a class="btn" href="/api/backup/download">⬇ Скачать копию (.sqlite.gz)</a><button class="btn" id="bkCheck">🔍 Проверить базу</button><button class="btn" id="bkClean">🧹 Очистить лишние файлы</button>${r.configured ? '<button class="btn" id="bkTest">🔗 Проверить GitHub</button><button class="btn danger" id="bkForce">⬆ Отправить в GitHub принудительно</button>' : ""}</div><div id="bkOut" style="margin-top:12px"></div></div>
      <div class="panel" style="margin-bottom:16px"><h3 style="margin-bottom:6px">Восстановление</h3><p class="small">Перед применением копия проверяется. Текущая база откладывается рядом с пометкой before-restore. Нужен пароль администратора. Сервер перезапустится.</p>
        <div class="row" style="margin-top:10px"><input type="file" id="bkFile" accept=".gz,.sqlite,.kbk" style="max-width:340px"><button class="btn danger" id="bkRestoreFile">Восстановить из файла</button>${r.configured ? '<button class="btn danger" id="bkRestoreGh">Восстановить из GitHub</button>' : ""}</div>
        ${st.local.files.length ? `<details style="margin-top:12px"><summary>Локальные копии (${st.local.files.length})</summary>${st.local.files.map(f => `<div class="row sp" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(f.name)} <span class="small">${kb(f.size)}</span></span><span class="row"><a class="btn sm" href="/api/backup/local/${encodeURIComponent(f.name)}">⬇</a><button class="btn sm danger" data-rl="${esc(f.name)}">Восстановить</button></span></div>`).join("")}</details>` : ""}</div>
      <div class="panel"><h3 style="margin-bottom:8px">Как настроить автосохранение в GitHub (бесплатно)</h3><ol class="small" style="line-height:1.8;padding-left:20px">
        <li>Создайте на GitHub <b>отдельный приватный</b> репозиторий (например, <code>kordrp-backup</code>) и поставьте галочку «Add a README».</li>
        <li>GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → создайте токен только для этого репозитория, право <b>Contents: Read and write</b>.</li>
        <li>В Render → Environment добавьте переменные: <code>BACKUP_GITHUB_TOKEN</code> (токен), <code>BACKUP_GITHUB_REPO</code> (<code>ваш-логин/kordrp-backup</code>), <code>BACKUP_KEY</code> (любой длинный секрет от 12 символов — им копия шифруется, сохраните его отдельно!).</li>
        <li>Сохраните и дождитесь перезапуска. Здесь появится «GitHub-копия — включена». Дальше копия уходит сама через несколько минут после любого изменения и при остановке сервера, а при запуске с пустым диском данные поднимаются автоматически.</li></ol></div>`;
    const pass = async () => askBox("Подтверждение", "Пароль администратора", { type: "password", ok: "Подтвердить" });
    $("bkRun").onclick = () => run(async () => { const x = await post("/api/backup/run"); toast(x.remote === "ok" ? "Копия сохранена и отправлена в GitHub" : x.local ? "Копия сохранена локально" + (x.remote ? " · GitHub: " + x.remote : "") : "Не удалось сделать копию", x.local ? "ok" : "err"); go("backup", null, { push: false }); });
    $("bkCheck").onclick = () => run(async () => { const x = await post("/api/backup/check"); $("bkOut").innerHTML = `<div class="${x.ok ? "good" : "bad"}"><b>${x.ok ? "✅ База в порядке" : "⚠ Найдены проблемы"}</b></div>` + x.report.map(i => `<div class="small">${i.ok ? "✅" : "❌"} ${esc(i.name)}${i.detail ? " — " + esc(i.detail) : ""}</div>`).join(""); });
    $("bkClean").onclick = () => run(async () => { const x = await post("/api/backup/cleanup"); toast(`Удалено лишних файлов: ${x.removed}`, "ok"); });
    if ($("bkTest")) $("bkTest").onclick = () => run(async () => { const x = await post("/api/backup/test-remote"); toast(x.exists ? `GitHub доступен, копия найдена (${kb(x.size)})` : "GitHub доступен, копии пока нет", "ok"); });
    if ($("bkForce")) $("bkForce").onclick = async () => { if (await confirmBox("Отправить текущую базу в GitHub и заменить там копию? Старая останется в истории коммитов.", { danger: true, ok: "Отправить" })) run(async () => { const x = await post("/api/backup/run", { force: true }); toast(x.remote === "ok" ? "Отправлено" : String(x.remote || "Не отправлено"), x.remote === "ok" ? "ok" : "err"); go("backup", null, { push: false }); }); };
    $("bkRestoreFile").onclick = async () => {
      const f = $("bkFile").files[0]; if (!f) return toast("Выберите файл копии", "err");
      if (!await confirmBox("Заменить ВСЕ текущие данные данными из файла?", { danger: true, ok: "Продолжить" })) return;
      const p = await pass(); if (!p) return;
      const fd = new FormData(); fd.append("file", f); fd.append("password", p);
      run(async () => { const x = await api("/api/backup/restore", { method: "POST", body: fd }); toast(`Принято: ${x.users} польз., ${x.staff} дел`, "ok"); waitRestart(); });
    };
    if ($("bkRestoreGh")) $("bkRestoreGh").onclick = async () => {
      if (!await confirmBox("Заменить ВСЕ текущие данные копией из GitHub?", { danger: true, ok: "Продолжить" })) return;
      const p = await pass(); if (!p) return;
      run(async () => { const x = await post("/api/backup/restore-remote", { password: p }); toast(`Принято: ${x.users} польз., ${x.staff} дел`, "ok"); waitRestart(); });
    };
    el.querySelectorAll("[data-rl]").forEach(b => b.onclick = async () => {
      if (!await confirmBox(`Восстановить из ${b.dataset.rl}?`, { danger: true, ok: "Продолжить" })) return;
      const p = await pass(); if (!p) return;
      run(async () => { await post("/api/backup/restore-local", { password: p, name: b.dataset.rl }); waitRestart(); });
    });
  }
};
