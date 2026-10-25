"use strict";
// Главная, реестр, личное дело, «Моё дело», удостоверения.
async function refreshStaff() { S.staff = can("staff.view") ? await api("/api/staff") : []; }

// ---------- Проверка жетона ----------
function verifyHtml(s) {
  const bad = !s.valid;
  const photo = s.id ? `<img class="cardimg" src="/api/staff/${esc(s.id)}/card.svg?t=${Date.now()}" alt="Удостоверение">` : "";
  return `<div class="panel" style="margin-top:14px">
    <div class="row" style="margin-bottom:14px"><span class="verdict ${bad ? "bad" : "good"}">${bad ? "УДОСТОВЕРЕНИЕ НЕДЕЙСТВИТЕЛЬНО" : "УДОСТОВЕРЕНИЕ ДЕЙСТВИТЕЛЬНО"}</span>${bad && s.reason ? `<span class="bad">${esc(s.reason)}</span>` : ""}</div>
    <div class="two" style="grid-template-columns:minmax(0,1fr) minmax(0,1.2fr)"><div>
      <div class="person">${avatar(s.portrait_path, s.fio, { masked: s.masked, cls: "xl" })}<div>
        <h3>${esc(s.fio)}</h3>
        <div style="margin:6px 0">${pogony(s.stars, s.color)} <b>${esc(s.rank || "звание не указано")}</b></div>
        <div>${orgBadge(s.org, s.color)}</div><div class="muted">${esc(s.position || "")}</div>
        ${s.masked ? '<div style="margin-top:6px"><span class="pill sec">🔒 Личность засекречена</span></div>' : ""}
      </div></div>
      <dl class="kv" style="margin-top:14px"><dt>Жетон</dt><dd><b>${esc(s.token)}</b> ${copyBtn(s.token, "")}</dd><dt>№ удостоверения</dt><dd>${esc(s.credential_no || "—")}</dd>
      <dt>Выдано</dt><dd>${esc(s.issued_on || "—")}</dd><dt>Действует до</dt><dd>${esc(s.expires_on || "бессрочно")}</dd><dt>Статус службы</dt><dd>${esc(s.status || "—")}</dd></dl>
    </div><div>${photo}</div></div></div>`;
}
async function doVerify(token, out) {
  token = String(token || "").trim();
  if (!/^\d{3}-\d{3}$/.test(token)) { out.innerHTML = '<div class="panel bad" style="margin-top:14px">Введите жетон в формате 000-000</div>'; return; }
  out.innerHTML = '<div class="empty" style="margin-top:14px">Проверяю…</div>';
  try { out.innerHTML = verifyHtml(await api("/api/verify/" + encodeURIComponent(token))); }
  catch (e) { out.innerHTML = `<div class="panel bad" style="margin-top:14px">❌ ${esc(e.message)}</div>`; }
}
const tokenInput = v => `<input id="vtok" placeholder="000-000" maxlength="7" inputmode="numeric" value="${esc(v || "")}" style="max-width:200px;font-size:18px;letter-spacing:2px">`;
function bindToken(inp) { inp.oninput = () => { let v = inp.value.replace(/\D/g, "").slice(0, 6); inp.value = v.length > 3 ? v.slice(0, 3) + "-" + v.slice(3) : v; }; }

// ---------- Главная ----------
VIEWS.home = {
  async render(el) {
    if (!S.user) {
      el.innerHTML = `<div class="hero"><h2>Реестр Республики Кордония</h2><p class="muted" style="max-width:640px">Личные дела, удостоверения и проверка жетонов государственных организаций. Для работы войдите в систему или зарегистрируйтесь — доступ откроется после одобрения администратором.</p>
        <div class="row" style="margin-top:16px"><button class="btn primary" id="hLogin">Войти</button><button class="btn" id="hReg">Регистрация</button></div></div>
        <h3 style="margin-bottom:12px">Организации</h3><div class="grid s">${S.orgs.map(o => `<div class="card"><div class="org" style="--c:${esc(o.color)}"><i></i><b>${esc(o.name)}</b></div><div class="small" style="margin-top:6px">${o.ranks.length} званий</div></div>`).join("")}</div>`;
      $("hLogin").onclick = openLogin; $("hReg").onclick = openRegister;
      return;
    }
    await refreshStaff();
    const pub = S.staff.filter(s => s.published && !s.archived);
    const serving = pub.filter(s => s.status === "Служит");
    const drafts = S.staff.filter(s => !s.published && !s.archived);
    const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    const expiring = pub.filter(s => s.credential?.expires_on && s.credential.expires_on <= soon).sort((a, b) => a.credential.expires_on.localeCompare(b.credential.expires_on));
    const by = {}; serving.forEach(s => by[s.org] = (by[s.org] || 0) + 1);
    const max = Math.max(1, ...Object.values(by));
    const hist = can("history.view") ? await api("/api/history").catch(() => []) : [];
    el.innerHTML = `<div class="head"><div><h2>Здравствуйте, ${esc(S.user.username)}</h2><div class="muted">${esc(S.user.role_title)}${S.user.org ? " · " + esc(S.user.org) : ""}</div></div></div>
      <div class="stats"><div class="stat"><b>${serving.length}</b><span>служат сейчас</span></div><div class="stat"><b>${pub.length}</b><span>опубликованных дел</span></div>
      <div class="stat"><b>${drafts.length}</b><span>черновиков</span></div><div class="stat"><b>${expiring.length}</b><span>удостоверений истекает за 30 дней</span></div></div>
      <div class="panel"><h3>Проверка удостоверения по жетону</h3><div class="row" style="margin-top:10px">${tokenInput()}<button class="btn primary" id="vgo">Проверить</button></div><div id="vout"></div></div>
      <div class="two" style="grid-template-columns:1fr 1fr;margin-top:18px"><div class="panel"><h3 style="margin-bottom:12px">Личный состав по организациям</h3>
        ${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([o, n]) => `<div style="margin-bottom:10px"><div class="row sp small"><span>${esc(o)}</span><b>${n}</b></div><div class="bar" style="--c:${esc(orgColor(o))}"><i style="width:${n / max * 100}%"></i></div></div>`).join("") || '<div class="muted">Данных пока нет</div>'}</div>
        <div class="panel"><h3 style="margin-bottom:12px">Требует внимания</h3>
        ${expiring.slice(0, 6).map(s => `<div class="list-item" data-case="${esc(s.id)}">${avatar(s.portrait_path, s.fio, { masked: s.masked })}<div><b>${esc(s.fio)}</b><div class="small">удостоверение до ${esc(s.credential.expires_on)}</div></div></div>`).join("")}
        ${drafts.slice(0, 6).map(s => `<div class="list-item" data-case="${esc(s.id)}">${avatar(s.portrait_path, s.fio)}<div><b>${esc(s.fio)}</b><div class="small">черновик — не опубликовано</div></div></div>`).join("")}
        ${!expiring.length && !drafts.length ? '<div class="muted">Всё в порядке ✅</div>' : ""}</div></div>
      ${hist.length ? `<div class="panel" style="margin-top:18px"><h3 style="margin-bottom:10px">Последние события</h3>${hist.slice(0, 8).map(h => `<div class="row sp" style="padding:6px 0;border-bottom:1px solid var(--line)"><span><b>${esc(h.action)}</b> · ${esc(h.fio)} <span class="muted">${esc(h.details || "")}</span></span><span class="small">${esc(fmtDT(h.created_at))}</span></div>`).join("")}</div>` : ""}`;
    bindToken($("vtok"));
    const go_ = () => doVerify($("vtok").value, $("vout"));
    $("vgo").onclick = go_; $("vtok").onkeydown = e => { if (e.key === "Enter") go_(); };
    el.querySelectorAll("[data-case]").forEach(b => b.onclick = () => openCase(b.dataset.case));
  }
};

// ---------- Реестр ----------
const RG = { q: "", org: "", status: "", state: "", sort: "fio", mode: "cards" };
const staffCard = s => `<article class="card click" data-case="${esc(s.id)}"><div class="person">${avatar(s.portrait_path, s.fio, { masked: s.masked })}<div style="min-width:0">
  <h3>${esc(s.fio)}</h3>${s.nickname ? `<div class="nick">${esc(s.nickname)}</div>` : ""}<div class="muted" style="font-size:13px">${esc(s.position)}</div></div></div>
  <div class="row sp" style="margin-top:12px"><span>${pogony(s.stars, s.color)} <span class="small">${esc(s.rank || "")}</span></span>${orgBadge(s.org, s.color)}</div>
  <div class="row sp" style="margin-top:10px"><span class="small">Жетон <b>${esc(s.token)}</b></span><span>${statusPills(s)}</span></div></article>`;
VIEWS.registry = {
  async render(el) {
    await refreshStaff();
    el.innerHTML = `<div class="head"><div><h2>Реестр сотрудников</h2><div class="muted" id="rgCount"></div></div>
      <div class="row">${can("staff.edit") ? '<button class="btn primary" id="rgNew">➕ Новое дело</button>' : ""}<button class="btn" id="rgCsv">⬇ CSV</button></div></div>
      <div class="toolbar"><input type="search" id="rgQ" placeholder="Поиск: ФИО, жетон, должность, звание…" value="${esc(RG.q)}">
      <select id="rgOrg"><option value="">Все организации</option>${S.orgs.map(o => `<option ${RG.org === o.name ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select>
      <select id="rgSt"><option value="">Любой статус</option><option ${RG.status === "Служит" ? "selected" : ""}>Служит</option><option ${RG.status === "Уволен" ? "selected" : ""}>Уволен</option></select>
      ${can("staff.edit") || can("staff.remove") ? `<select id="rgState"><option value="">Опубликованные</option><option value="draft" ${RG.state === "draft" ? "selected" : ""}>Черновики</option><option value="archive" ${RG.state === "archive" ? "selected" : ""}>Архив</option><option value="all" ${RG.state === "all" ? "selected" : ""}>Все</option></select>` : ""}
      <select id="rgSort"><option value="fio">По ФИО</option><option value="rank" ${RG.sort === "rank" ? "selected" : ""}>По званию (звёзды)</option><option value="new" ${RG.sort === "new" ? "selected" : ""}>Сначала новые</option></select>
      <button class="btn" id="rgMode">${RG.mode === "cards" ? "☰ Таблица" : "▦ Карточки"}</button></div><div id="rgList"></div>`;
    const draw = () => {
      const q = RG.q.toLowerCase();
      let a = S.staff.filter(s => {
        const st = RG.state === "all" ? true : RG.state === "draft" ? (!s.published && !s.archived) : RG.state === "archive" ? s.archived : (s.published && !s.archived);
        return st && (!q || [s.fio, s.token, s.position, s.rank, s.org, s.nickname, s.discord].join(" ").toLowerCase().includes(q)) && (!RG.org || s.org === RG.org) && (!RG.status || s.status === RG.status);
      });
      a = a.sort(RG.sort === "rank" ? (x, y) => y.stars - x.stars || x.fio.localeCompare(y.fio, "ru") : RG.sort === "new" ? (x, y) => String(y.created_at).localeCompare(String(x.created_at)) : (x, y) => x.fio.localeCompare(y.fio, "ru"));
      $("rgCount").textContent = `Найдено: ${a.length}`;
      $("rgList").innerHTML = !a.length ? '<div class="empty">Ничего не найдено. Измените фильтры.</div>'
        : RG.mode === "cards" ? `<div class="grid">${a.map(staffCard).join("")}</div>`
        : `<div class="tablewrap"><table><thead><tr><th></th><th>ФИО</th><th>Организация</th><th>Должность</th><th>Звание</th><th>Жетон</th><th>Статус</th></tr></thead><tbody>${a.map(s => `<tr class="click" data-case="${esc(s.id)}" style="cursor:pointer"><td>${avatar(s.portrait_path, s.fio, { masked: s.masked })}</td><td><b>${esc(s.fio)}</b></td><td>${orgBadge(s.org, s.color)}</td><td>${esc(s.position)}</td><td>${pogony(s.stars, s.color)} ${esc(s.rank)}</td><td>${esc(s.token)}</td><td>${statusPills(s) || esc(s.status)}</td></tr>`).join("")}</tbody></table></div>`;
      $("rgList").querySelectorAll("[data-case]").forEach(b => b.onclick = () => openCase(b.dataset.case));
      el._shown = a;
    };
    draw();
    $("rgQ").oninput = debounce(e => { RG.q = $("rgQ").value; draw(); }, 150);
    $("rgOrg").onchange = e => { RG.org = e.target.value; draw(); };
    $("rgSt").onchange = e => { RG.status = e.target.value; draw(); };
    if ($("rgState")) $("rgState").onchange = e => { RG.state = e.target.value; draw(); };
    $("rgSort").onchange = e => { RG.sort = e.target.value; draw(); };
    $("rgMode").onclick = () => { RG.mode = RG.mode === "cards" ? "table" : "cards"; $("rgMode").textContent = RG.mode === "cards" ? "☰ Таблица" : "▦ Карточки"; draw(); };
    if ($("rgNew")) $("rgNew").onclick = () => openStaffForm(null, () => go("registry"));
    $("rgCsv").onclick = () => {
      const priv = S.staff.some(s => s.passport !== undefined);
      csvDownload("reestr.csv", [["ФИО", "Жетон", "Организация", "Подразделение", "Должность", "Звание", "Статус", ...(priv ? ["Ник", "Discord"] : [])],
        ...(el._shown || []).map(s => [s.fio, s.token, s.org, s.unit, s.position, s.rank, s.status, ...(priv ? [s.nickname || "", s.discord || ""] : [])])]);
    };
  }
};

// ---------- Форма дела ----------
function openStaffForm(s, after) {
  const isNew = !s, priv = isNew || s.passport !== undefined;
  s = s || { org: S.user.org && orgByName(S.user.org) ? S.user.org : (S.orgs[0]?.name || ""), status: "Служит" };
  const orgs = S.user.scope_all ? S.orgs.map(o => o.name) : [S.user.org].filter(Boolean);
  const f = (id, label, val, extra = "", cls = "") => `<div class="field ${cls}"><label>${label}</label><input id="${id}" value="${esc(val ?? "")}" ${extra}></div>`;
  const body = `<div class="form">${f("sf_fio", "ФИО *", s.masked ? "" : s.fio, "maxlength=150", "wide")}
    <div class="field"><label>Организация *</label><select id="sf_org">${orgs.map(o => `<option ${o === s.org ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>
    <div class="field"><label>Подразделение</label><input id="sf_unit" list="dl_units" value="${esc(s.unit || "")}"><datalist id="dl_units"></datalist></div>
    <div class="field"><label>Должность *</label><input id="sf_pos" list="dl_pos" value="${esc(s.position || "")}"><datalist id="dl_pos"></datalist></div>
    <div class="field"><label>Звание <span id="sf_ep"></span></label><select id="sf_rank"></select></div>
    ${f("sf_token", "Жетон * (000-000)", s.token, 'maxlength=7 placeholder="123-456"')}
    <div class="field"><label>Статус службы</label><select id="sf_status"><option ${s.status === "Служит" ? "selected" : ""}>Служит</option><option ${s.status === "Уволен" ? "selected" : ""}>Уволен</option></select></div>
    ${priv ? f("sf_dob", "Дата рождения", s.dob, 'type="date"') + f("sf_phone", "Телефон", s.phone, "maxlength=40") + f("sf_nick", "Ник", s.nickname, "maxlength=60") + f("sf_disc", "Ник в Discord", s.discord, "maxlength=60") + f("sf_pass", "Номер паспорта", s.passport, "maxlength=60", "wide") : '<p class="small wide">Паспорт, телефон, ник и Discord вам недоступны — они не изменятся.</p>'}
    ${isNew || s.actions?.classified !== false ? "" : ""}
    ${can("classified.set") ? `<div class="field wide"><label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" id="sf_cls" ${s.classified ? "checked" : ""}> 🔒 Засекреченная личность (вместо ФИО и фото показывается фото жетона)</label></div>` : ""}
    <div class="field"><label>Фото сотрудника (JPG/PNG/WEBP)</label><input type="file" id="sf_photo" accept="image/jpeg,image/png,image/webp">${s.id && s.portrait_path && !s.masked ? '<div class="small"><label style="display:inline-flex;gap:6px;color:var(--bad)"><input type="checkbox" id="sf_rmphoto"> удалить текущее фото</label></div>' : ""}</div>
    <div class="field" id="sf_badgebox"><label>Фото жетона (для засекреченных)</label><input type="file" id="sf_badge" accept="image/jpeg,image/png,image/webp"></div></div>
    <p class="small">Если фото пока нет — поле на удостоверении останется пустым и заполнится автоматически, как только фото загрузят.</p>`;
  const footer = `<button class="btn" data-no>Отмена</button><button class="btn" id="sf_save">Сохранить черновик</button>${can("staff.publish") ? '<button class="btn primary" id="sf_pub">Сохранить и опубликовать</button>' : ""}`;
  const d = openDlg("dlg2", isNew ? "Новое личное дело" : "Редактирование дела", body, { footer, cls: "mid" });
  d.querySelector("[data-no]").onclick = () => d.close();
  const orgSel = d.querySelector("#sf_org"), rankSel = d.querySelector("#sf_rank");
  const fillOrg = (keepRank) => {
    const o = orgByName(orgSel.value) || { ranks: [], positions: [], units: [] };
    d.querySelector("#dl_units").innerHTML = o.units.map(x => `<option value="${esc(x.name)}">`).join("");
    d.querySelector("#dl_pos").innerHTML = o.positions.map(x => `<option value="${esc(x.name)}">`).join("");
    rankSel.innerHTML = '<option value="">Не указано</option>' + o.ranks.map(r => `<option ${r.name === keepRank ? "selected" : ""} data-st="${r.stars}">${esc(r.name)}</option>`).join("") + (keepRank && !o.ranks.some(r => r.name === keepRank) ? `<option selected>${esc(keepRank)}</option>` : "");
    prev();
  };
  const prev = () => { const st = Number(rankSel.selectedOptions[0]?.dataset.st || 0); d.querySelector("#sf_ep").innerHTML = rankSel.value ? pogony(st, orgColor(orgSel.value)) : ""; };
  orgSel.onchange = () => fillOrg(""); rankSel.onchange = prev;
  fillOrg(s.rank || "");
  const token = d.querySelector("#sf_token"); bindToken(token);
  const save = async publish => {
    const b = { fio: d.querySelector("#sf_fio").value.trim(), org: orgSel.value, unit: d.querySelector("#sf_unit").value.trim(), position: d.querySelector("#sf_pos").value.trim(), rank: rankSel.value, token: token.value.trim(), status: d.querySelector("#sf_status").value };
    if (priv) Object.assign(b, { dob: d.querySelector("#sf_dob").value, phone: d.querySelector("#sf_phone").value.trim(), nickname: d.querySelector("#sf_nick").value.trim(), discord: d.querySelector("#sf_disc").value.trim(), passport: d.querySelector("#sf_pass").value.trim() });
    if (d.querySelector("#sf_cls")) b.classified = d.querySelector("#sf_cls").checked;
    if (s.masked) delete b.fio; // ФИО засекречено — не перезаписываем
    try {
      const id = s.id ? (await put("/api/staff/" + s.id, b), s.id) : (await post("/api/staff", b)).id;
      const pf = d.querySelector("#sf_photo").files[0], bf = d.querySelector("#sf_badge").files[0];
      if (pf) await uploadImage(`/api/staff/${id}/portrait`, pf);
      else if (d.querySelector("#sf_rmphoto")?.checked) await del(`/api/staff/${id}/portrait`);
      if (bf) await uploadImage(`/api/staff/${id}/badge`, bf);
      if (publish) { const r = await post(`/api/staff/${id}/publish`); toast("Дело опубликовано, удостоверение " + r.credential_no, "ok"); } else toast("Сохранено", "ok");
      d.close(); await refreshStaff(); if (after) after(id);
    } catch (e) { fail(e); }
  };
  d.querySelector("#sf_save").onclick = () => save(false);
  if (d.querySelector("#sf_pub")) d.querySelector("#sf_pub").onclick = () => save(true);
}

// ---------- Личное дело (большое) ----------
async function openCase(id, tab) {
  const d = openDlg("dlg", "Личное дело", '<div class="empty">Загрузка…</div>', { cls: "wide printable" });
  try { const data = await api(`/api/staff/${id}/case`); mountCase(d.querySelector(".db"), data, { reload: () => openCase(id, curTab(d)), dialog: d, tab }); }
  catch (e) { d.querySelector(".db").innerHTML = `<div class="empty bad">${esc(e.message)}</div>`; }
}
const curTab = d => d.querySelector(".tabs .on")?.dataset.tab;
function mountCase(el, data, { reload, dialog, tab }) {
  const s = data.staff, a = data.actions, full = data.level === "full";
  const tabs = [["ov", "Обзор"], ["card", "Удостоверение"], ...(full ? [["tr", `Аттестации (${data.training.length})`], ["or", `Приказы (${data.orders.length})`], ["hi", "История"]] : [])];
  if (dialog) dialog.querySelector(".dh h2").innerHTML = `Личное дело · <span class="muted">${esc(s.token)}</span>`;
  const row = (k, v) => v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : "";
  const btn = (key, label, cls = "") => a[key] ? `<button class="btn ${cls}" data-act="${key}">${label}</button>` : "";
  const c = s.credential;
  el.innerHTML = `<div class="row" style="align-items:flex-start;gap:20px">${avatar(s.portrait_path, s.fio, { masked: s.masked, cls: "xl" })}
    <div style="flex:1;min-width:240px"><h2>${esc(s.fio)}</h2>
    <div style="margin:8px 0">${pogony(s.stars, s.color)} <b>${esc(s.rank || "звание не указано")}</b></div>
    <div class="row" style="gap:12px">${orgBadge(s.org, s.color)}<span class="muted">${esc(s.position)}${s.unit ? " · " + esc(s.unit) : ""}</span></div>
    <div style="margin-top:8px">${statusPills(s)} <span class="pill ${s.status === "Служит" ? "good" : "bad"}">${esc(s.status)}</span></div>
    <div style="margin-top:8px" class="row">Жетон <b style="font-size:18px">${esc(s.token)}</b> ${copyBtn(s.token, "")}${c ? `<span class="muted">· № ${esc(c.credential_no)}</span>` : ""}</div>
    ${s.archived ? `<div class="bad" style="margin-top:8px">Исключён из организации${s.archive_reason ? ": " + esc(s.archive_reason) : ""}</div>` : ""}
    ${s.masked ? '<div class="small" style="margin-top:8px">Личность засекречена: показаны только служебные данные и фото жетона.</div>' : ""}</div></div>
    <div class="row noprint" style="margin:16px 0 4px">${btn("edit", "✏️ Редактировать")}${btn("publish", s.published ? "↻ Обновить удостоверение" : "🚀 Опубликовать дело", s.published ? "" : "primary")}${btn("order", "📜 Приказ")}${btn("training", "📝 Аттестация")}${btn("remove", "🚪 Исключить из организации", "danger")}${btn("restore", "↩ Вернуть в организацию")}${btn("delete", "🗑 Удалить полностью", "danger")}<button class="btn" data-act="print">🖨 Печать</button></div>
    <div class="tabs noprint">${tabs.map(([k, t]) => `<button data-tab="${k}" class="${k === (tab || "ov") ? "on" : ""}">${t}</button>`).join("")}</div>
    <div class="tabpane" id="p_ov"><dl class="kv">${row("Организация", s.org)}${row("Подразделение", s.unit)}${row("Должность", s.position)}${row("Звание", s.rank)}${row("Статус", s.status)}
      ${row("Дата рождения", s.dob)}${row("Телефон", s.phone)}${row("Паспорт", s.passport)}${row("Ник", s.nickname)}${row("Discord", s.discord)}${row("Создано", fmtDT(s.created_at))}${row("Обновлено", fmtDT(s.updated_at))}</dl>
      ${data.level === "summary" ? '<p class="small" style="margin-top:12px">Показана публичная часть дела. Полное дело доступно сотрудникам с правом просмотра чужих дел.</p>' : ""}</div>
    <div class="tabpane hide" id="p_card"><div class="row" style="align-items:flex-start;gap:18px"><div style="flex:1;min-width:300px"><img class="cardimg" id="cardImg" src="/api/staff/${esc(s.id)}/card.svg?t=${Date.now()}" alt="Удостоверение"></div>
      <div style="min-width:220px"><dl class="kv" style="grid-template-columns:110px 1fr"><dt>№</dt><dd>${esc(c?.credential_no || "не присвоен")}</dd><dt>Выдано</dt><dd>${esc(c?.issued_on || "—")}</dd><dt>До</dt><dd>${esc(c?.expires_on || "бессрочно")}</dd><dt>Статус</dt><dd>${esc(c?.status || "—")}</dd></dl>
      <div class="row noprint" style="margin-top:12px;flex-direction:column;align-items:stretch"><button class="btn primary" data-act="png">⬇ Скачать PNG</button><a class="btn" href="/api/staff/${esc(s.id)}/card.svg" download="udostoverenie.svg">⬇ Скачать SVG</a>${btn("credential", "✏️ Номер и даты")}</div>
      ${!s.portrait_path ? '<p class="small">Фото ещё не загружено — поле на удостоверении пустое. Оно заполнится само после загрузки фото.</p>' : ""}${!s.published ? '<p class="small warn">Дело — черновик: удостоверение станет действительным после публикации.</p>' : ""}</div></div></div>
    ${full ? `<div class="tabpane hide" id="p_tr">${data.training.map(t => `<div class="card" style="margin-bottom:10px"><div class="row sp"><b>${esc(t.course)}</b><span class="pill ${t.result === "Сдано" ? "good" : t.result === "Не сдано" ? "bad" : "warn"}">${esc(t.result)}</span></div><div class="small">${esc(t.date)} · ${esc(t.examiner || "")}</div>${t.notes ? `<div>${esc(t.notes)}</div>` : ""}${a.trainingDelete ? `<button class="btn danger sm noprint" data-tdel="${t.id}" style="margin-top:8px">Удалить</button>` : ""}</div>`).join("") || '<div class="empty">Аттестаций нет</div>'}</div>
      <div class="tabpane hide" id="p_or">${data.orders.map(o => `<div class="card" style="margin-bottom:10px"><div class="row sp"><b>${esc(o.number)} · ${esc(o.type)}</b><span class="small">${esc(o.date)}</span></div><div class="small">${[o.org_to ? o.org + " → " + o.org_to : "", o.rank_from !== o.rank_to ? `звание: ${o.rank_from || "—"} → ${o.rank_to || "—"}` : "", o.position_from !== o.position_to ? `должность: ${o.position_from || "—"} → ${o.position_to || "—"}` : ""].filter(Boolean).map(esc).join(" · ")}</div>${o.reason ? `<div>${esc(o.reason)}</div>` : ""}</div>`).join("") || '<div class="empty">Приказов нет</div>'}</div>
      <div class="tabpane hide" id="p_hi">${data.history.map(h => `<div class="row sp" style="padding:7px 0;border-bottom:1px solid var(--line)"><span><b>${esc(h.action)}</b> <span class="muted">${esc(h.details || "")}</span></span><span class="small">${esc(h.actor || "")} · ${esc(fmtDT(h.created_at))}</span></div>`).join("") || '<div class="empty">История пуста</div>'}</div>` : ""}`;
  const show = k => { el.querySelectorAll(".tabpane").forEach(p => p.classList.toggle("hide", p.id !== "p_" + k)); el.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === k)); };
  show(tab || "ov");
  el.querySelectorAll(".tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  const after = () => { refreshStaff(); reload(); };
  const act = {
    edit: () => openStaffForm(s, after),
    publish: async () => { const r = await post(`/api/staff/${s.id}/publish`); toast(s.published ? "Удостоверение обновлено" : "Дело опубликовано, удостоверение " + r.credential_no, "ok"); after(); },
    remove: async () => { const reason = await askBox("Исключить из организации", "Причина", { multiline: true, ok: "Исключить" }); if (reason === null) return; await post(`/api/staff/${s.id}/remove`, { reason }); toast("Дело перенесено в архив", "ok"); after(); },
    restore: async () => { if (!await confirmBox("Вернуть дело в организацию?")) return; await post(`/api/staff/${s.id}/restore`); toast("Возвращено", "ok"); after(); },
    delete: async () => { if (!await confirmBox("Удалить дело полностью вместе с трудовой? Это нельзя отменить.", { danger: true, ok: "Удалить навсегда" })) return; await del(`/api/staff/${s.id}`); toast("Дело удалено", "ok"); if (dialog) dialog.close(); else go("mycase"); await refreshStaff(); },
    order: () => openOrderForm(s.id, after),
    training: () => openTrainingForm(s.id, after),
    credential: () => openCredForm(s, after),
    png: () => downloadCardPng(s.id, s.fio),
    print: () => window.print()
  };
  el.querySelectorAll("[data-act]").forEach(b => b.onclick = () => run(() => act[b.dataset.act]()));
  el.querySelectorAll("[data-tdel]").forEach(b => b.onclick = async () => { if (!await confirmBox("Удалить запись об аттестации?", { danger: true, ok: "Удалить" })) return; await run(() => del("/api/training/" + b.dataset.tdel), "Аттестация удалена"); reload(); });
}
function openCredForm(s, after) {
  const c = s.credential || {};
  const d = openDlg("dlg2", "Удостоверение", `<div class="field"><label>Номер (пусто — создать автоматически)</label><input id="cf_no" value="${esc(c.credential_no || "")}"></div>
    <div class="form"><div class="field"><label>Дата выдачи</label><input type="date" id="cf_is" value="${esc(c.issued_on || today())}"></div><div class="field"><label>Действует до (пусто — бессрочно)</label><input type="date" id="cf_ex" value="${esc(c.expires_on || "")}"></div></div>`,
    { footer: '<button class="btn" data-no>Отмена</button><button class="btn primary" id="cf_ok">Сохранить</button>' });
  d.querySelector("[data-no]").onclick = () => d.close();
  d.querySelector("#cf_ok").onclick = () => run(async () => { await post(`/api/staff/${s.id}/credential`, { credential_no: d.querySelector("#cf_no").value.trim(), issued_on: d.querySelector("#cf_is").value, expires_on: d.querySelector("#cf_ex").value }); d.close(); after(); }, "Удостоверение сохранено");
}
function openTrainingForm(staffId, after, staffList) {
  const sel = staffId ? "" : `<div class="field"><label>Сотрудник *</label><select id="tf_st">${staffList.map(x => `<option value="${esc(x.id)}">${esc(x.fio)} (${esc(x.token)})</option>`).join("")}</select></div>`;
  const d = openDlg("dlg2", "Запись об аттестации", `${sel}<div class="field"><label>Курс / аттестация *</label><input id="tf_c" maxlength="150"></div>
    <div class="form"><div class="field"><label>Результат</label><select id="tf_r"><option>Сдано</option><option>Не сдано</option><option>Ожидает</option></select></div><div class="field"><label>Дата</label><input type="date" id="tf_d" value="${today()}"></div></div>
    <div class="field"><label>Экзаменатор</label><input id="tf_e" maxlength="100"></div><div class="field"><label>Заметки</label><textarea id="tf_n" rows="2"></textarea></div>`,
    { footer: '<button class="btn" data-no>Отмена</button><button class="btn primary" id="tf_ok">Добавить</button>' });
  d.querySelector("[data-no]").onclick = () => d.close();
  d.querySelector("#tf_ok").onclick = () => run(async () => { await post("/api/training", { staff_id: staffId || d.querySelector("#tf_st").value, course: d.querySelector("#tf_c").value, result: d.querySelector("#tf_r").value, date: d.querySelector("#tf_d").value, examiner: d.querySelector("#tf_e").value, notes: d.querySelector("#tf_n").value }); d.close(); after && after(); }, "Аттестация добавлена");
}

// ---------- Моё дело ----------
VIEWS.mycase = {
  async render(el) {
    const d = await api("/api/my-case");
    el.innerHTML = `<div class="head"><div><h2>Моё дело</h2></div></div>
      ${can("case.others") ? `<div class="panel noprint" style="margin-bottom:18px"><h3>Просмотр чужих дел</h3><div class="row" style="margin:10px 0"><input type="search" id="mcQ" placeholder="ФИО, жетон, ник, организация…" style="max-width:380px"></div><div id="mcRes"></div></div>` : ""}
      <div id="mcOwn" class="panel printable">${d.found ? "" : '<div class="empty">К вашему аккаунту пока не привязано дело. Привязка идёт по жетону в профиле — попросите администратора указать его.</div>'}</div>`;
    if (d.found) mountCase($("mcOwn"), d, { reload: () => go("mycase") });
    if ($("mcQ")) {
      const find = debounce(async () => {
        const q = $("mcQ").value.trim();
        if (!q) { $("mcRes").innerHTML = '<div class="small">Введите запрос — покажу до 40 дел</div>'; return; }
        const r = await run(() => api("/api/cases/search?q=" + encodeURIComponent(q))) || [];
        $("mcRes").innerHTML = r.length ? `<div class="grid s">${r.map(x => `<div class="card click" data-case="${esc(x.id)}"><div class="person">${avatar(x.portrait_path, x.fio, { masked: x.masked })}<div><b>${esc(x.fio)}</b><div class="small">${pogony(x.stars, x.color)} ${esc(x.rank || "")}</div><div class="small">${esc(x.org)} · ${esc(x.token)}</div></div></div></div>`).join("")}</div>` : '<div class="muted">Ничего не найдено</div>';
        $("mcRes").querySelectorAll("[data-case]").forEach(b => b.onclick = () => openCase(b.dataset.case));
      }, 250);
      $("mcQ").oninput = find; find();
    }
  }
};

// ---------- Удостоверения ----------
VIEWS.creds = {
  async render(el) {
    await refreshStaff();
    let q = "";
    el.innerHTML = `<div class="head"><div><h2>Удостоверения</h2><div class="muted">Создаются автоматически при публикации дела и обновляются сами</div></div></div>
      <div class="toolbar"><input type="search" id="crQ" placeholder="Поиск по ФИО, жетону, номеру…"></div><div id="crList"></div>`;
    const draw = () => {
      const a = S.staff.filter(s => s.credential && s.published && !s.archived && (!q || [s.fio, s.token, s.credential.credential_no, s.org].join(" ").toLowerCase().includes(q)));
      $("crList").innerHTML = a.length ? `<div class="grid">${a.slice(0, 60).map(s => `<div class="card"><img class="cardimg" loading="lazy" src="/api/staff/${esc(s.id)}/card.svg" alt="" style="cursor:pointer" data-case="${esc(s.id)}" data-tab="card"><div class="row sp" style="margin-top:10px"><span class="small">${esc(s.credential.credential_no)} · ${esc(s.credential.status)}</span><span><button class="btn sm" data-png="${esc(s.id)}" data-n="${esc(s.fio)}">⬇ PNG</button></span></div></div>`).join("")}</div>${a.length > 60 ? `<p class="small">Показаны первые 60 из ${a.length}. Уточните поиск.</p>` : ""}` : '<div class="empty">Удостоверений пока нет. Опубликуйте личное дело — удостоверение создастся автоматически.</div>';
      $("crList").querySelectorAll("[data-case]").forEach(b => b.onclick = () => openCase(b.dataset.case, "card"));
      $("crList").querySelectorAll("[data-png]").forEach(b => b.onclick = () => downloadCardPng(b.dataset.png, b.dataset.n));
    };
    draw(); $("crQ").oninput = debounce(() => { q = $("crQ").value.toLowerCase(); draw(); }, 150);
  }
};
