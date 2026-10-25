"use strict";
// Игроки, приказы, аттестации, история, организации и звания, профиль.
const ORDER_TYPES = ["Приём", "Перевод", "Повышение", "Понижение", "Назначение", "Увольнение", "Взыскание", "Поощрение"];
const myStaffChoices = () => S.staff.filter(s => s.published && (S.user.scope_all || s.org === S.user.org));

// ---------- Игроки ----------
VIEWS.players = {
  async render(el) {
    el.innerHTML = `<div class="head"><div><h2>Профили игроков</h2><div class="muted">Где работает, жетон, № удостоверения. Поиск по нику, ФИО, Discord, жетону.</div></div></div>
      <div class="toolbar"><input type="search" id="plQ" placeholder="Ник игрока, ФИО, жетон…" autofocus style="max-width:420px"></div><div id="plList"></div>`;
    const find = async () => {
      const q = $("plQ").value.trim();
      const r = await run(() => api("/api/players?q=" + encodeURIComponent(q))) || [];
      $("plList").innerHTML = r.length ? `<div class="grid">${r.map(p => `<div class="card click" data-k="${esc(p.key)}"><div class="person">${avatar(p.avatar, p.fio || p.nickname, { masked: p.masked })}<div style="min-width:0"><h3>${esc(p.fio || p.nickname || "Без имени")}</h3>
        <div class="nick">${esc([p.nickname, p.discord].filter(Boolean).join(" · "))}</div></div></div>
        ${p.org ? `<div class="row sp" style="margin-top:12px"><span>${pogony(p.stars, p.color)} <span class="small">${esc(p.rank)}</span></span>${orgBadge(p.org, p.color)}</div><div class="small" style="margin-top:6px">${esc(p.position)} · жетон <b>${esc(p.token)}</b>${p.credential_no ? " · " + esc(p.credential_no) : ""}</div>`
          : `<div class="small" style="margin-top:12px">Нигде не служит${p.token ? " · жетон " + esc(p.token) : ""}</div>`}</div>`).join("")}</div>` : '<div class="empty">Профили не найдены</div>';
      $("plList").querySelectorAll("[data-k]").forEach(b => b.onclick = () => openPlayer(b.dataset.k));
    };
    $("plQ").oninput = debounce(find, 250); find();
  }
};
async function openPlayer(key) {
  const d = openDlg("dlg", "Профиль игрока", '<div class="empty">Загрузка…</div>', { cls: "mid" });
  const load = async () => {
    const p = await api("/api/players/" + encodeURIComponent(key));
    const kv = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : "";
    d.querySelector(".db").innerHTML = `<div class="person" style="align-items:flex-start">${avatar(p.avatar, p.fio || p.nickname, { masked: p.masked, cls: "xl" })}<div style="flex:1">
      <h2>${esc(p.fio || "ФИО не указано")}</h2><div class="nick" style="font-size:12px">${esc(p.nickname || "ник не указан")}</div>
      ${p.org ? `<div style="margin:10px 0">${pogony(p.stars, p.color)} <b>${esc(p.rank || "звание не указано")}</b></div><div class="row">${orgBadge(p.org, p.color)}<span class="muted">${esc(p.position)}</span></div>
      <div style="margin-top:8px"><span class="pill ${p.valid ? "good" : "bad"}">${p.valid ? "Удостоверение действует" : esc(p.reason || "Недействительно")}</span> ${p.archived ? '<span class="pill bad">В архиве</span>' : ""}${p.masked ? ' <span class="pill sec">🔒 Засекречено</span>' : ""}</div>` : '<div class="muted" style="margin-top:10px">Не состоит в организациях</div>'}
      <dl class="kv" style="margin-top:14px">${kv("Ник в Discord", esc(p.discord))}${kv("Логин", esc(p.username))}${kv("Жетон", p.token ? `<b>${esc(p.token)}</b> ${copyBtn(p.token, "")}` : "")}${kv("№ удостоверения", esc(p.credential?.credential_no))}${kv("Выдано / до", p.credential ? esc((p.credential.issued_on || "—") + " / " + (p.credential.expires_on || "бессрочно")) : "")}${kv("Паспорт", esc(p.passport))}
      ${p.training ? kv("Аттестации", Object.entries(p.training).map(([k, n]) => `${esc(k)}: ${n}`).join(" · ")) : ""}</dl>
      ${p.can_open_case && p.staff_id ? `<div class="row" style="margin-top:12px"><button class="btn" id="pl_case">📁 Открыть личное дело</button></div>` : ""}</div></div>
      ${p.career ? `<div class="head" style="margin-top:22px;margin-bottom:8px"><h3>Трудовая</h3>${p.can_manage_career ? '<button class="btn sm primary" id="pl_add">➕ Добавить запись</button>' : ""}</div>
        <div class="tl">${p.career.map(c => `<div class="k-${esc(c.kind)}"><div class="row sp"><b>${esc(c.title)}</b><span class="small">${esc(c.date)}</span></div><div class="small"><span class="pill ${c.kind === "Судимость" ? "bad" : ""}">${esc(c.kind)}</span>${c.status ? ` <span class="pill ${c.status === "Не погашена" ? "bad" : "good"}">${esc(c.status)}</span>` : ""} ${esc(c.org || "")}</div>${c.details ? `<div>${esc(c.details)}</div>` : ""}
          ${p.can_manage_career ? `<div class="row" style="margin-top:4px">${c.kind === "Судимость" ? `<button class="btn sm" data-sud="${c.id}" data-st="${c.status === "Не погашена" ? "Погашена" : "Не погашена"}">${c.status === "Не погашена" ? "Отметить погашенной" : "Вернуть «не погашена»"}</button>` : ""}<button class="btn sm danger" data-cdel="${c.id}">Удалить</button></div>` : ""}</div>`).join("") || '<div class="muted">Записей нет</div>'}</div>` : ""}`;
    const b = d.querySelector("#pl_case"); if (b) b.onclick = () => { d.close(); openCase(p.staff_id); };
    const add = d.querySelector("#pl_add"); if (add) add.onclick = () => openCareerForm(p, load);
    d.querySelectorAll("[data-sud]").forEach(x => x.onclick = () => run(async () => { await patch("/api/career/" + x.dataset.sud, { status: x.dataset.st }); await load(); }));
    d.querySelectorAll("[data-cdel]").forEach(x => x.onclick = async () => { if (await confirmBox("Удалить запись из трудовой?", { danger: true, ok: "Удалить" })) await run(async () => { await del("/api/career/" + x.dataset.cdel); await load(); }, "Удалено"); });
  };
  try { await load(); } catch (e) { d.querySelector(".db").innerHTML = `<div class="empty bad">${esc(e.message)}</div>`; }
}
function openCareerForm(p, reload) {
  const d = openDlg("dlg2", "Запись в трудовую", `<div class="form"><div class="field"><label>Тип</label><select id="cr_k"><option>Судимость</option><option>Взыскание</option><option>Поощрение</option><option>Заметка</option></select></div><div class="field"><label>Дата</label><input type="date" id="cr_d" value="${today()}"></div></div>
    <div class="field"><label id="cr_tl">Статья / решение суда *</label><input id="cr_t" maxlength="200"></div><div class="field"><label>Подробности (суд, наказание…)</label><textarea id="cr_x" rows="3"></textarea></div>
    <div class="field" id="cr_sw"><label>Статус судимости</label><select id="cr_s"><option>Не погашена</option><option>Погашена</option><option>Снята</option></select></div>`,
    { footer: '<button class="btn" data-no>Отмена</button><button class="btn primary" id="cr_ok">Добавить</button>' });
  d.querySelector("[data-no]").onclick = () => d.close();
  const k = d.querySelector("#cr_k"), sync = () => { d.querySelector("#cr_sw").classList.toggle("hide", k.value !== "Судимость"); d.querySelector("#cr_tl").textContent = k.value === "Судимость" ? "Статья / решение суда *" : "Название записи *"; };
  k.onchange = sync; sync();
  d.querySelector("#cr_ok").onclick = () => run(async () => {
    await post("/api/career", { ...(p.staff_id ? { staff_id: p.staff_id } : { user_id: p.uid }), kind: k.value, date: d.querySelector("#cr_d").value, title: d.querySelector("#cr_t").value, details: d.querySelector("#cr_x").value, status: d.querySelector("#cr_s").value });
    d.close(); await reload();
  }, "Запись добавлена");
}

// ---------- Приказы ----------
function openOrderForm(staffId, after) {
  const list = staffId ? [] : myStaffChoices();
  const d = openDlg("dlg2", "Кадровый приказ", `${staffId ? "" : `<div class="field"><label>Сотрудник *</label><select id="of_st">${list.map(x => `<option value="${esc(x.id)}">${esc(x.fio)} — ${esc(x.org)}, ${esc(x.token)}</option>`).join("")}</select></div>`}
    <div class="form"><div class="field"><label>Тип приказа *</label><select id="of_t">${ORDER_TYPES.map(t => `<option>${t}</option>`).join("")}</select></div><div class="field"><label>Дата</label><input type="date" id="of_d" value="${today()}"></div>
    <div class="field" id="of_orgw"><label>Новая организация</label><select id="of_org"></select></div><div class="field" id="of_rankw"><label>Новое звание</label><select id="of_rank"></select></div>
    <div class="field wide" id="of_posw"><label>Новая должность</label><input id="of_pos" list="of_dl" maxlength="100"><datalist id="of_dl"></datalist></div></div>
    <div class="field"><label id="of_rl">Основание</label><textarea id="of_r" rows="2" maxlength="500"></textarea></div>
    <p class="small">Приказ сразу применяется к делу, записывается в историю и в трудовую игрока.</p>`,
    { footer: '<button class="btn" data-no>Отмена</button><button class="btn primary" id="of_ok">Издать приказ</button>', cls: "mid" });
  d.querySelector("[data-no]").onclick = () => d.close();
  const t = d.querySelector("#of_t"), orgSel = d.querySelector("#of_org"), rank = d.querySelector("#of_rank");
  const cur = () => S.staff.find(x => x.id === (staffId || d.querySelector("#of_st")?.value));
  const fillOrg = () => { const o = orgByName(orgSel.value); rank.innerHTML = '<option value="">—</option>' + (o?.ranks || []).map(r => `<option>${esc(r.name)}</option>`).join(""); d.querySelector("#of_dl").innerHTML = (o?.positions || []).map(p => `<option value="${esc(p.name)}">`).join(""); };
  const sync = () => {
    const ty = t.value, s = cur();
    const showOrg = ["Перевод", "Приём"].includes(ty), showRank = ["Перевод", "Повышение", "Понижение", "Приём"].includes(ty), showPos = ["Перевод", "Назначение", "Приём"].includes(ty);
    d.querySelector("#of_orgw").classList.toggle("hide", !showOrg); d.querySelector("#of_rankw").classList.toggle("hide", !showRank); d.querySelector("#of_posw").classList.toggle("hide", !showPos);
    orgSel.innerHTML = (ty === "Приём" ? '<option value="">Без изменений</option>' : "") + S.orgs.map(o => `<option ${s && o.name === s.org && ty !== "Перевод" ? "selected" : ""}>${esc(o.name)}</option>`).join("");
    if (!showOrg) orgSel.value = s?.org || "";
    if (ty === "Приём" && s) orgSel.value = "";
    fillOrg();
    d.querySelector("#of_rl").textContent = ["Увольнение", "Взыскание", "Поощрение"].includes(ty) ? "Основание *" : "Основание";
  };
  t.onchange = sync; orgSel.onchange = fillOrg; d.querySelector("#of_st")?.addEventListener("change", sync); sync();
  d.querySelector("#of_ok").onclick = () => run(async () => {
    const ty = t.value, s = cur(), body = { staff_id: staffId || d.querySelector("#of_st").value, type: ty, date: d.querySelector("#of_d").value, reason: d.querySelector("#of_r").value };
    if (["Перевод", "Приём"].includes(ty)) body.org_to = orgSel.value;
    if (["Перевод", "Повышение", "Понижение", "Приём"].includes(ty)) body.rank_to = rank.value;
    if (["Перевод", "Назначение", "Приём"].includes(ty)) body.position_to = d.querySelector("#of_pos").value;
    if (["Повышение", "Понижение", "Назначение"].includes(ty) && !s) throw Error("Выберите сотрудника");
    const r = await post("/api/orders", body);
    d.close(); toast("Издан приказ " + r.number, "ok"); await refreshStaff(); if (after) after(); else if (S.view === "orders") go("orders");
  });
}
VIEWS.orders = {
  async render(el) {
    await refreshStaff();
    const rows = await api("/api/orders"); let q = "";
    el.innerHTML = `<div class="head"><div><h2>Кадровые приказы</h2><div class="muted">Все изменения службы с основанием</div></div>${can("orders.create") ? '<button class="btn primary" id="orNew">➕ Новый приказ</button>' : ""}</div>
      <div class="toolbar"><input type="search" id="orQ" placeholder="Поиск по номеру, ФИО, типу…"></div><div id="orList"></div>`;
    const draw = () => {
      const a = rows.filter(r => !q || [r.number, r.fio, r.type, r.reason, r.org].join(" ").toLowerCase().includes(q));
      $("orList").innerHTML = a.length ? `<div class="tablewrap"><table><thead><tr><th>№</th><th>Дата</th><th>Тип</th><th>Сотрудник</th><th>Изменение</th><th>Основание</th><th>Издал</th></tr></thead><tbody>${a.map(r => `<tr><td><b>${esc(r.number)}</b></td><td>${esc(r.date)}</td><td><span class="pill">${esc(r.type)}</span></td><td>${esc(r.fio)}<div class="small">${esc(r.org || "")}</div></td>
        <td class="small">${[r.org_to ? `${esc(r.org)} → ${esc(r.org_to)}` : "", r.rank_from !== r.rank_to ? `звание: ${esc(r.rank_from || "—")} → ${esc(r.rank_to || "—")}` : "", r.position_from !== r.position_to ? `должность: ${esc(r.position_from || "—")} → ${esc(r.position_to || "—")}` : ""].filter(Boolean).join("<br>") || "—"}</td><td>${esc(r.reason || "")}</td><td class="small">${esc(r.actor || "")}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">Приказов пока нет</div>';
    };
    draw(); $("orQ").oninput = debounce(() => { q = $("orQ").value.toLowerCase(); draw(); }, 150);
    if ($("orNew")) $("orNew").onclick = () => openOrderForm(null);
  }
};

// ---------- Аттестации ----------
VIEWS.training = {
  async render(el) {
    await refreshStaff();
    let rows = await api("/api/training"), q = "";
    el.innerHTML = `<div class="head"><div><h2>Аттестации и курсы</h2></div>${can("training.manage") ? '<button class="btn primary" id="trNew">➕ Добавить запись</button>' : ""}</div>
      <div class="toolbar"><input type="search" id="trQ" placeholder="Поиск по сотруднику, курсу…"></div><div id="trList"></div>`;
    const draw = () => {
      const a = rows.filter(r => !q || [r.fio, r.course, r.org, r.examiner, r.token].join(" ").toLowerCase().includes(q));
      $("trList").innerHTML = a.length ? `<div class="grid">${a.map(t => `<div class="card"><div class="row sp"><b>${esc(t.course)}</b><span class="pill ${t.result === "Сдано" ? "good" : t.result === "Не сдано" ? "bad" : "warn"}">${esc(t.result)}</span></div>
        <div style="margin-top:6px">${esc(t.fio)} <span class="small">· ${esc(t.org)}</span></div><div class="small">${esc(t.date)}${t.examiner ? " · " + esc(t.examiner) : ""}</div>${t.notes ? `<div style="margin-top:6px">${esc(t.notes)}</div>` : ""}
        ${can("training.delete") ? `<button class="btn sm danger" data-del="${t.id}" style="margin-top:10px">Удалить</button>` : ""}</div>`).join("")}</div>` : '<div class="empty">Записей нет</div>';
      $("trList").querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { if (!await confirmBox("Удалить запись об аттестации?", { danger: true, ok: "Удалить" })) return; await run(() => del("/api/training/" + b.dataset.del), "Удалено"); rows = await api("/api/training"); draw(); });
    };
    draw(); $("trQ").oninput = debounce(() => { q = $("trQ").value.toLowerCase(); draw(); }, 150);
    if ($("trNew")) $("trNew").onclick = () => { const l = myStaffChoices(); if (!l.length) return toast("Сначала добавьте и опубликуйте дело сотрудника", "err"); openTrainingForm(null, async () => { rows = await api("/api/training"); draw(); }, l); };
  }
};

// ---------- История ----------
VIEWS.history = {
  async render(el) {
    const rows = await api("/api/history"); let q = "";
    el.innerHTML = `<div class="head"><div><h2>История изменений</h2></div></div><div class="toolbar"><input type="search" id="hiQ" placeholder="Поиск по действию, сотруднику, автору…"></div><div id="hiList"></div>`;
    const draw = () => {
      const a = rows.filter(r => !q || [r.action, r.fio, r.org, r.details, r.actor].join(" ").toLowerCase().includes(q));
      $("hiList").innerHTML = a.length ? `<div class="tablewrap"><table><thead><tr><th>Когда</th><th>Событие</th><th>Сотрудник</th><th>Детали</th><th>Кто</th></tr></thead><tbody>${a.map(h => `<tr><td class="small">${esc(fmtDT(h.created_at))}</td><td><b>${esc(h.action)}</b></td><td>${esc(h.fio)}<div class="small">${esc(h.org || "")}</div></td><td>${esc(h.details || "")}</td><td class="small">${esc(h.actor || "")}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">Ничего не найдено</div>';
    };
    draw(); $("hiQ").oninput = debounce(() => { q = $("hiQ").value.toLowerCase(); draw(); }, 150);
  }
};

// ---------- Организации и звания ----------
async function reloadOrgs() { S.orgs = (await api("/api/config")).orgs; }
let selOrg = null;
VIEWS.orgs = {
  async render(el) {
    await reloadOrgs();
    if (!can("orgs.manage")) {
      el.innerHTML = `<div class="head"><div><h2>Организации и звания</h2><div class="muted">Справочник государственных организаций</div></div></div><div class="grid">${S.orgs.map(o => `<div class="panel"><div class="org" style="--c:${esc(o.color)};font-size:16px"><i></i><b>${esc(o.name)}</b></div>
        <details style="margin-top:10px"><summary>Звания (${o.ranks.length})</summary><div style="margin-top:8px">${o.ranks.map(r => `<div style="padding:3px 0">${pogony(r.stars, o.color)} ${esc(r.name)}</div>`).join("")}</div></details>
        ${o.positions.length ? `<details><summary>Должности (${o.positions.length})</summary><div class="small" style="margin-top:6px">${o.positions.map(p => esc(p.name)).join("<br>")}</div></details>` : ""}</div>`).join("")}</div>`;
      return;
    }
    const full = await api("/api/orgs");
    if (!selOrg || !full.some(o => o.id === selOrg)) selOrg = full[0]?.id;
    const o = full.find(x => x.id === selOrg);
    const again = () => go("orgs", null, { push: false });
    const section = (kind, title, items) => `<div class="panel" style="margin-bottom:14px"><div class="row sp" style="margin-bottom:10px"><h3>${title} (${items.length})</h3></div>
      ${items.map((it, i) => `<div class="row" style="padding:5px 0;border-bottom:1px solid var(--line)"><span style="flex:1">${kind === "rank" ? pogony(it.stars, o.color) + " " : ""}<span data-ren="${it.id}" style="cursor:pointer" title="Нажмите, чтобы переименовать">${esc(it.name)}</span></span>
        ${kind === "rank" ? `<select data-st="${it.id}" style="width:auto;padding:3px 6px">${[0, 1, 2, 3, 4, 5, 6].map(n => `<option ${n === it.stars ? "selected" : ""}>${n}</option>`).join("")}</select><span class="small">★</span>` : ""}
        <button class="btn sm ghost" data-mv="${it.id}" data-dir="up" ${i === 0 ? "disabled" : ""}>↑</button><button class="btn sm ghost" data-mv="${it.id}" data-dir="down" ${i === items.length - 1 ? "disabled" : ""}>↓</button><button class="btn sm danger" data-rm="${it.id}">✕</button></div>`).join("") || '<div class="muted">Пока пусто</div>'}
      <div class="row" style="margin-top:10px"><input data-new="${kind}" placeholder="Добавить: ${kind === "rank" ? "звание" : kind === "position" ? "должность" : "подразделение"}…" style="flex:1">${kind === "rank" ? '<select data-newst style="width:auto"><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option><option>0</option></select><span class="small">★</span>' : ""}<button class="btn sm primary" data-add="${kind}">Добавить</button></div></div>`;
    el.innerHTML = `<div class="head"><div><h2>Организации и звания</h2><div class="muted">Добавляйте и удаляйте организации, звания, должности и подразделения. Звёзды задают погоны.</div></div></div>
      <div class="two"><div class="panel"><div id="orgSide">${full.map(x => `<div class="list-item ${x.id === selOrg ? "on" : ""}" data-sel="${x.id}"><span class="org" style="--c:${esc(x.color)}"><i></i>${esc(x.name)}</span><span class="small right">${x.staff_count}</span></div>`).join("")}</div>
        <div class="row" style="margin-top:12px"><input id="newOrgName" placeholder="Новая организация" style="flex:1"><input type="color" id="newOrgColor" value="#6b7a99" style="width:46px"><button class="btn sm primary" id="newOrgBtn">＋</button></div></div>
      <div>${o ? `<div class="panel" style="margin-bottom:14px"><div class="row"><input id="orgName" value="${esc(o.name)}" style="flex:1;min-width:180px"><input type="color" id="orgColor" value="${esc(o.color)}" style="width:50px"><button class="btn primary" id="orgSave">Сохранить</button>
        <button class="btn" data-omv="up">↑</button><button class="btn" data-omv="down">↓</button><button class="btn danger" id="orgDel">Удалить организацию</button></div><div class="small" style="margin-top:6px">В организации: дел — ${o.staff_count}, пользователей — ${o.user_count}</div></div>
        ${section("rank", "Звания", o.ranks)}${section("position", "Должности", o.positions)}${section("unit", "Подразделения", o.units)}` : '<div class="empty">Организаций нет — создайте первую</div>'}</div></div>`;
    el.querySelectorAll("[data-sel]").forEach(b => b.onclick = () => { selOrg = Number(b.dataset.sel); again(); });
    $("newOrgBtn").onclick = () => run(async () => { const r = await post("/api/orgs", { name: $("newOrgName").value, color: $("newOrgColor").value }); selOrg = r.id; await again(); }, "Организация добавлена");
    if (!o) return;
    $("orgSave").onclick = () => run(async () => { await patch("/api/orgs/" + o.id, { name: $("orgName").value, color: $("orgColor").value }); await again(); }, "Сохранено");
    el.querySelectorAll("[data-omv]").forEach(b => b.onclick = () => run(async () => { await post(`/api/orgs/${o.id}/move`, { dir: b.dataset.omv }); await again(); }));
    $("orgDel").onclick = async () => {
      let moveTo = "";
      if (o.staff_count || o.user_count) {
        const others = full.filter(x => x.id !== o.id);
        if (!others.length) return toast("Нельзя удалить единственную организацию с делами", "err");
        const dd = openDlg("dlg3", "Куда перенести дела?", `<p>В организации ${o.staff_count} дел и ${o.user_count} пользователей. Они будут перенесены:</p><select id="mvTo">${others.map(x => `<option>${esc(x.name)}</option>`).join("")}</select>`, { footer: '<button class="btn" data-no>Отмена</button><button class="btn danger" id="mvOk">Перенести и удалить</button>' });
        dd.querySelector("[data-no]").onclick = () => dd.close();
        dd.querySelector("#mvOk").onclick = () => run(async () => { await del("/api/orgs/" + o.id, { moveTo: dd.querySelector("#mvTo").value }); dd.close(); selOrg = null; await again(); }, "Организация удалена");
        return;
      }
      if (await confirmBox(`Удалить организацию «${o.name}»?`, { danger: true, ok: "Удалить" })) run(async () => { await del("/api/orgs/" + o.id, {}); selOrg = null; await again(); }, "Организация удалена");
    };
    el.querySelectorAll("[data-add]").forEach(b => b.onclick = () => run(async () => {
      const kind = b.dataset.add, inp = el.querySelector(`[data-new="${kind}"]`), st = kind === "rank" ? el.querySelector("[data-newst]").value : 0;
      await post(`/api/orgs/${o.id}/items`, { kind, name: inp.value, stars: st }); await again();
    }));
    el.querySelectorAll("[data-new]").forEach(i => i.onkeydown = e => { if (e.key === "Enter") el.querySelector(`[data-add="${i.dataset.new}"]`).click(); });
    el.querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => { if (await confirmBox("Удалить запись из справочника? У сотрудников с этим значением оно сохранится.", { danger: true, ok: "Удалить" })) run(async () => { await del("/api/items/" + b.dataset.rm); await again(); }); });
    el.querySelectorAll("[data-mv]").forEach(b => b.onclick = () => run(async () => { await post(`/api/items/${b.dataset.mv}/move`, { dir: b.dataset.dir }); await again(); }));
    el.querySelectorAll("[data-st]").forEach(s => s.onchange = () => run(async () => { await patch("/api/items/" + s.dataset.st, { stars: Number(s.value) }); await again(); }));
    el.querySelectorAll("[data-ren]").forEach(sp => sp.onclick = async () => { const v = await askBox("Переименовать", "Новое название", { value: sp.textContent }); if (v && v.trim() && v !== sp.textContent) run(async () => { await patch("/api/items/" + sp.dataset.ren, { name: v }); await again(); }, "Переименовано"); });
  }
};

// ---------- Мой профиль ----------
VIEWS.profile = {
  async render(el) {
    const d = await api("/api/profile"), p = d.profile || {};
    const own = await api("/api/my-case").catch(() => ({ found: false }));
    const career = await api("/api/my-career").catch(() => []);
    const dash = v => v ? esc(v) : '<span class="muted">не указано</span>';
    el.innerHTML = `<div class="head"><div><h2>Мой профиль</h2><div class="muted">${esc(d.role_title)}${d.org ? " · " + esc(d.org) : ""} · логин ${esc(d.username)}</div></div></div>
      <div class="panel" style="display:grid;grid-template-columns:150px 1fr;gap:20px">${avatar(p.avatar_path, p.fio || d.username, { cls: "xl" })}<div>
        <h2>${p.fio ? esc(p.fio) : "ФИО не указано"}</h2><div class="nick" style="font-size:11px">${p.nickname ? esc(p.nickname) : "ник не указан"}</div>
        <dl class="kv" style="margin-top:14px"><dt>Ник в Discord</dt><dd>${dash(p.discord)}</dd><dt>Жетон</dt><dd>${dash(p.token)}</dd><dt>Номер паспорта</dt><dd>${dash(p.passport)}</dd></dl>
        <div class="row" style="margin-top:14px"><button class="btn primary" id="pfEdit">Редактировать</button></div>
        <p class="small">Паспорт виден только вам и главному администратору. Жетон меняет только администратор.</p></div></div>
      ${own.found ? `<div class="panel" style="margin-top:16px"><h3>Служба</h3><div class="person" style="margin-top:10px">${avatar(own.staff.portrait_path, own.staff.fio)}<div><b>${esc(own.staff.fio)}</b><div>${pogony(own.staff.stars, own.staff.color)} ${esc(own.staff.rank || "")}</div><div class="small">${esc(own.staff.org)} · ${esc(own.staff.position)} · № ${esc(own.staff.credential?.credential_no || "—")}</div></div><button class="btn right" data-go="mycase">Открыть дело</button></div></div>` : ""}
      <div class="panel" style="margin-top:16px"><h3 style="margin-bottom:12px">Трудовая</h3>${career.length ? `<div class="tl">${career.map(c => `<div class="k-${esc(c.kind)}"><div class="row sp"><b>${esc(c.title)}</b><span class="small">${esc(c.date)}</span></div><div class="small"><span class="pill ${c.kind === "Судимость" ? "bad" : ""}">${esc(c.kind)}</span>${c.status ? ` <span class="pill">${esc(c.status)}</span>` : ""} ${esc(c.org || "")}</div>${c.details ? `<div>${esc(c.details)}</div>` : ""}</div>`).join("")}</div>` : '<div class="muted">Записей пока нет</div>'}</div>`;
    $("pfEdit").onclick = () => {
      const full = d.can_edit_identity;
      const dd = openDlg("dlg", "Мой профиль", `<div class="form"><div class="field wide"><label>ФИО</label><input id="pf_fio" value="${esc(p.fio || "")}" ${!full && p.fio ? "disabled" : ""}></div><div class="field"><label>Ник</label><input id="pf_nick" value="${esc(p.nickname || "")}"></div><div class="field"><label>Ник в Discord</label><input id="pf_disc" value="${esc(p.discord || "")}"></div>
        <div class="field"><label>Жетон</label><input id="pf_tok" value="${esc(p.token || "")}" ${full ? "" : "disabled"} placeholder="123-456"></div><div class="field"><label>Номер паспорта</label><input id="pf_pass" value="${esc(p.passport || "")}"></div>
        <div class="field wide"><label>Фото профиля</label><input type="file" id="pf_file" accept="image/jpeg,image/png,image/webp"></div></div><p class="small">${full ? "" : "ФИО и жетон после заполнения меняет только администратор."}</p>`,
        { footer: '<button class="btn" data-no>Отмена</button><button class="btn primary" id="pf_ok">Сохранить</button>' });
      dd.querySelector("[data-no]").onclick = () => dd.close();
      dd.querySelector("#pf_ok").onclick = () => run(async () => {
        await put("/api/profile", { fio: dd.querySelector("#pf_fio").value, nickname: dd.querySelector("#pf_nick").value, discord: dd.querySelector("#pf_disc").value, token: dd.querySelector("#pf_tok").value, passport: dd.querySelector("#pf_pass").value });
        const f = dd.querySelector("#pf_file").files[0]; if (f) await uploadImage("/api/profile/avatar", f);
        dd.close(); go("profile", null, { push: false });
      }, "Профиль сохранён");
    };
  }
};
