let config = { orgs: {}, user: null }, staff = [], history = [], training = [], requests = [];
const $ = x => document.getElementById(x);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const safeUrl = u => /^(https?:\/\/[^\s"'<>]+|\/uploads\/[A-Za-z0-9._-]+)$/i.test(u || "") ? u : "";
const initials = fio => esc(String(fio || "?").split(" ").map(x => x[0]).filter(Boolean).slice(0, 2).join(""));
const MANAGE_ROLES = ["main_admin", "hr", "org_head"];

async function api(url, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const headers = { "X-Requested-With": "KordRP", ...(isForm ? {} : { "Content-Type": "application/json" }), ...(opts.headers || {}) };
  const r = await fetch(url, { credentials: "same-origin", ...opts, headers });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || "Ошибка запроса (" + r.status + ")");
  return d;
}
function say(e) { alert(e.message || String(e)); }

// Количество звёзд на погонах по званию.
function ep(rank = "") {
  const r = String(rank).toLowerCase();
  let n = 1;
  if (/^генерал( полиции)?$|генерал армии|генерал-полковник|генерал юстиции/.test(r)) n = 5;
  else if (/генерал/.test(r)) n = 4;
  else if (/(?<![а-яё])полковник|советник юстиции 1 класса/.test(r)) n = 3;
  else if (/подполковник|майор|капитан|советник юстиции/.test(r)) n = 2;
  return Array.from({ length: n }, () => "<i></i>").join("");
}
function rankOptions(org, sel = "") {
  return '<option value="">Не указано</option>' + (config.orgs[org] || []).map(x => `<option ${x === sel ? "selected" : ""}>${esc(x)}</option>`).join("");
}
function orgChoices() {
  const all = Object.keys(config.orgs), u = config.user;
  return u && ["org_head", "hr"].includes(u.role) && u.org ? all.filter(x => x === u.org) : all;
}

function switchView(v) {
  if (!config.user && v !== "public") v = "public";
  document.querySelectorAll(".view").forEach(x => x.classList.add("hide"));
  $("v-" + v).classList.remove("hide");
  document.querySelectorAll("[data-view]").forEach(x => x.classList.toggle("on", x.dataset.view === v));
}
document.querySelector(".tabs").onclick = e => { const b = e.target.closest("[data-view]"); if (b) switchView(b.dataset.view); };
document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => $(b.dataset.close).close());

async function init() {
  config = await api("/api/config");
  const orgs = Object.keys(config.orgs);
  $("orgFilter").innerHTML = '<option value="">Все</option>' + orgs.map(x => `<option>${esc(x)}</option>`).join("");
  $("newOrg").innerHTML = '<option value="">Без организации</option>' + orgs.map(x => `<option>${esc(x)}</option>`).join("");
  $("org").onchange = () => { $("rank").innerHTML = rankOptions($("org").value, ""); updatePreview(); };
  $("rank").onchange = updatePreview;
  $("orgList").innerHTML = Object.entries(config.orgs).map(([o, rs]) => `<div class="panel"><h3>${esc(o)}</h3><ol>${rs.map(r => `<li>${esc(r)}</li>`).join("")}</ol></div>`).join("");
  applyUser();
  if (config.user) await loadPrivate();
}

function applyUser() {
  const u = config.user;
  document.querySelectorAll(".auth-tab").forEach(x => x.classList.toggle("hide", !u));
  $("verifyLocked").classList.toggle("hide", !!u);
  $("verifyArea").classList.toggle("hide", !u);
  $("loginBtn").classList.toggle("hide", !!u);
  $("logoutBtn").classList.toggle("hide", !u);
  $("pwBtn").classList.toggle("hide", !u);
  document.querySelectorAll(".restricted").forEach(x => x.classList.toggle("hide", !u || !MANAGE_ROLES.includes(u.role)));
  document.querySelectorAll(".admin").forEach(x => x.classList.toggle("hide", !u || !["main_admin", "technical_admin"].includes(u.role)));
  $("addUser").classList.toggle("hide", !u || u.role !== "main_admin");
  $("sessionText").textContent = u ? `Вход: ${u.username} · ${u.role}${u.org ? " · " + u.org : ""}` : "Для просмотра списка сотрудников войдите в систему.";
}

async function loadPrivate() {
  try {
    staff = await api("/api/staff");
    history = await api("/api/history").catch(() => []);
    training = await api("/api/training").catch(() => []);
    requests = await api("/api/requests").catch(() => []);
    renderStaff(); renderCreds(); renderHistory(); renderTraining(); renderRequests();
    await renderMyCase();
    if (["main_admin", "technical_admin"].includes(config.user?.role)) { renderUsers(); renderAudit(); }
  } catch (e) { say(e); }
}

async function renderMyCase() {
  try {
    const d = await api("/api/my-case");
    if (!d.found) { $("myCaseContent").innerHTML = '<div class="empty">Кадровое дело не привязано к вашей учётной записи. Обратитесь к кадровому подразделению.</div>'; return; }
    const s = d.staff, pu = safeUrl(s.portrait_path);
    $("myCaseContent").innerHTML = `<div class="staff"><div class="avatar">${pu ? `<img src="${esc(pu)}" alt="">` : initials(s.fio)}</div><div><h3>${esc(s.fio)}</h3><div class="muted">${esc(s.position)} · ${esc(s.rank || "звание не указано")}</div><span class="pill">${esc(s.org)}</span><span class="pill">Жетон ${esc(s.token)}</span><span class="pill ${s.status === "Служит" ? "good" : "bad"}">${esc(s.status)}</span></div></div><div class="panel"><h3>Основные сведения</h3><p>Подразделение: ${esc(s.unit || "не указано")}</p><p>Дата рождения: ${esc(s.dob || "не указана")}</p><p>Телефон: ${esc(s.phone || "не указан")}</p><p>Номер удостоверения: ${esc(s.credential?.credential_no || "не оформлено")}</p><p>Дата выдачи: ${esc(s.credential?.issued_on || "—")} · Действует до: ${esc(s.credential?.expires_on || "—")}</p></div><div class="panel"><h3>История службы</h3>${(d.history || []).map(h => `<p><b>${esc(h.action)}</b> — ${esc(h.details || "")} <span class="muted">${esc(h.created_at || "")}</span></p>`).join("") || '<p class="muted">Записей пока нет.</p>'}</div>`;
  } catch (e) { $("myCaseContent").innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

function renderStaff() {
  const q = $("search").value.toLowerCase(), o = $("orgFilter").value, st = $("statusFilter").value;
  const canEdit = config.user && MANAGE_ROLES.includes(config.user.role);
  const a = staff.filter(s => (!q || [s.fio, s.token, s.position, s.rank, s.org].join(" ").toLowerCase().includes(q)) && (!o || s.org === o) && (!st || s.status === st));
  $("staffList").innerHTML = a.map(s => {
    const pu = safeUrl(s.portrait_path);
    return `<article class="staff"><div class="avatar">${pu ? `<img src="${esc(pu)}" alt="">` : initials(s.fio)}</div><div><h3>${esc(s.fio)}</h3><div class="muted">${esc(s.position)} · ${esc(s.rank)}</div><div class="ooc">(${esc(s.nickname || "ник не указан")} · Discord: ${esc(s.discord || "не указан")})</div><span class="pill">${esc(s.org)}</span><span class="pill">Жетон ${esc(s.token)}</span><span class="pill ${s.status === "Служит" ? "good" : "bad"}">${esc(s.status)}</span></div><div class="act">${canEdit && orgChoices().includes(s.org) ? `<button data-edit="${esc(s.id)}">Изменить</button>` : ""}</div></article>`;
  }).join("") || '<div class="empty">Нет доступных записей.</div>';
  document.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => editStaff(b.dataset.edit));
}

function renderCreds() {
  const a = staff.filter(s => s.credential);
  $("credList").innerHTML = a.map(s => {
    const c = s.credential, iu = safeUrl(c.image_path), ok = s.status === "Служит" && c.status === "Действует";
    return `<div class="card"><div class="row">${`<div class="ep">${ep(s.rank)}</div>`}<div><h3>${esc(s.fio)}</h3><div class="muted">${esc(s.org)} · ${esc(s.position)} · ${esc(s.rank)}</div></div></div><p>Жетон <b>${esc(s.token)}</b> · Удостоверение <b>${esc(c.credential_no)}</b></p><p>Выдано ${esc(c.issued_on || "—")} · До ${esc(c.expires_on || "—")}</p><p class="${ok ? "good" : "bad"}">${esc(c.status)}</p>${iu ? `<a href="${esc(iu)}" target="_blank" rel="noopener">Открыть изображение удостоверения</a>` : ""}</div>`;
  }).join("") || '<div class="empty">Удостоверения ещё не оформлены.</div>';
}

function renderHistory() {
  $("historyList").innerHTML = history.map(h => `<div class="card"><h3>${esc(h.action)}</h3><p>${esc(h.fio)} · ${esc(h.org)}</p><p>${esc(h.created_at)} · ${esc(h.details)}</p></div>`).join("") || '<div class="empty">История недоступна или пуста.</div>';
}
function renderTraining() {
  $("trainingList").innerHTML = training.map(t => `<div class="card"><h3>${esc(t.course)}</h3><p>${esc(t.fio || "Сотрудник")} · ${esc(t.result)}</p><p>${esc(t.date)} · ${esc(t.examiner)}</p><p>${esc(t.notes)}</p></div>`).join("") || '<div class="empty">Записей нет.</div>';
}

// Предпросмотр погон обновляется при выборе звания.
function updatePreview() {
  const r = $("rank").value;
  $("rankName").textContent = r || "Звание не выбрано";
  $("epaulette").innerHTML = ep(r);
}

function editStaff(id) {
  const s = staff.find(x => x.id === id) || {};
  const choices = orgChoices();
  $("staffForm").reset();
  $("sid").value = s.id || "";
  $("org").innerHTML = choices.map(x => `<option>${esc(x)}</option>`).join("");
  ["fio", "dob", "passport", "phone", "nickname", "discord", "token", "unit", "position", "portrait_path"].forEach(k => { $(k).value = s[k] || ""; });
  $("status").value = s.status || "Служит";
  $("org").value = s.org && choices.includes(s.org) ? s.org : choices[0];
  $("rank").innerHTML = rankOptions($("org").value, s.rank);
  $("credential_no").value = s.credential?.credential_no || "";
  $("issued_on").value = s.credential?.issued_on || today();
  $("expires_on").value = s.credential?.expires_on || "";
  $("image_path").value = s.credential?.image_path || "";
  $("staffTitle").textContent = id ? "Редактировать профиль" : "Новый сотрудник";
  updatePreview();
  $("staffDialog").showModal();
}
$("addStaff").onclick = () => editStaff("");

$("staffForm").onsubmit = async e => {
  e.preventDefault();
  const b = {};
  ["fio", "dob", "passport", "phone", "nickname", "discord", "token", "org", "unit", "position", "rank", "status", "portrait_path"].forEach(k => b[k] = $(k).value.trim());
  try {
    let id = $("sid").value;
    if (id) await api("/api/staff/" + id, { method: "PUT", body: JSON.stringify(b) });
    else { id = (await api("/api/staff", { method: "POST", body: JSON.stringify(b) })).id; $("sid").value = id; }
    // Удостоверение создаётся автоматически (номер — по желанию) либо обновляется: номер, даты, изображение.
    const cr = await api("/api/staff/" + id + "/credential", {
      method: "POST",
      body: JSON.stringify({ credential_no: $("credential_no").value.trim(), issued_on: $("issued_on").value, expires_on: $("expires_on").value, image_path: $("image_path").value.trim() })
    });
    const f = $("image_file").files[0];
    if (f) { const fd = new FormData(); fd.append("image", f); await api("/api/credentials/" + cr.id + "/image", { method: "POST", body: fd }); }
    await loadPrivate();
    $("staffDialog").close();
  } catch (err) { say(err); await loadPrivate(); }
};

async function doVerify() {
  const t = $("verifyToken").value.trim();
  try {
    const s = await api("/api/verify/" + encodeURIComponent(t));
    const pu = safeUrl(s.portrait_path), iu = safeUrl(s.image_path);
    $("verifyResult").innerHTML = `<div class="card" style="margin-top:12px"><span class="pill ${s.valid ? "good" : "bad"}">${s.valid ? "УДОСТОВЕРЕНИЕ ДЕЙСТВИТЕЛЬНО" : "УДОСТОВЕРЕНИЕ НЕ ДЕЙСТВИТЕЛЬНО"}</span>${s.valid ? "" : `<p class="bad">Причина: ${esc(s.reason)}</p>`}<h3 style="margin-top:10px">${esc(s.fio)}</h3><p>${esc(s.org)} · ${esc(s.position)} · ${esc(s.rank)}</p><p>Жетон <b>${esc(s.token)}</b> · Удостоверение <b>${esc(s.credential_no || "не оформлено")}</b></p><p>Статус сотрудника: ${esc(s.status)} · Действует до: ${esc(s.expires_on || "не указано")}</p>${pu ? `<img src="${esc(pu)}" alt="" style="width:90px;border-radius:8px">` : ""}${iu ? `<p><a href="${esc(iu)}" target="_blank" rel="noopener">Изображение удостоверения</a></p>` : ""}</div>`;
  } catch (err) { $("verifyResult").innerHTML = `<div class="card bad" style="margin-top:12px">${esc(err.message)}</div>`; }
}
$("verifyBtn").onclick = doVerify;
$("verifyToken").onkeydown = e => { if (e.key === "Enter") doVerify(); };
$("verifyLogin").onclick = () => $("loginDialog").showModal();

$("loginBtn").onclick = () => $("loginDialog").showModal();
$("loginForm").onsubmit = async e => {
  e.preventDefault();
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ username: $("username").value, password: $("password").value }) });
    $("password").value = "";
    config = await api("/api/config");
    applyUser();
    $("loginDialog").close();
    await loadPrivate();
  } catch (err) { say(err); }
};
$("logoutBtn").onclick = async () => {
  try { await api("/api/logout", { method: "POST" }); config.user = null; staff = []; applyUser(); location.reload(); } catch (err) { say(err); }
};

$("search").oninput = renderStaff;
$("orgFilter").onchange = renderStaff;
$("statusFilter").onchange = renderStaff;

$("addTraining").onclick = () => {
  const own = staff.filter(s => orgChoices().includes(s.org));
  if (!own.length) return alert("Сначала добавьте сотрудника");
  $("trainingStaff").innerHTML = own.map(s => `<option value="${esc(s.id)}">${esc(s.fio)}</option>`).join("");
  $("trainingDate").value = today();
  $("trainingDialog").showModal();
};
$("trainingForm").onsubmit = async e => {
  e.preventDefault();
  try {
    await api("/api/training", { method: "POST", body: JSON.stringify({ staff_id: $("trainingStaff").value, course: $("course").value, result: $("result").value, date: $("trainingDate").value, examiner: $("examiner").value, notes: $("notes").value }) });
    await loadPrivate();
    $("trainingDialog").close();
  } catch (err) { say(err); }
};

// ---- Пользователи ----
$("addUser").onclick = () => $("userDialog").showModal();
$("userForm").onsubmit = async e => {
  e.preventDefault();
  try {
    await api("/api/users", { method: "POST", body: JSON.stringify({ username: $("newUsername").value, password: $("newPassword").value, role: $("newRole").value, org: $("newOrg").value }) });
    $("newPassword").value = "";
    await renderUsers();
    $("userDialog").close();
  } catch (err) { say(err); }
};
async function renderUsers() {
  try {
    const a = await api("/api/users");
    const isMain = config.user?.role === "main_admin";
    $("usersList").innerHTML = a.map(u => `<div class="card"><b>${esc(u.username)}</b><p>${esc(u.role)} · ${esc(u.org || "без организации")} · ${u.active ? "активен" : "отключён"}</p>${isMain ? `<div class="userrow"><button data-pw="${u.id}">Сбросить пароль</button>${u.role !== "main_admin" ? `<button data-toggle="${u.id}" data-active="${u.active ? 0 : 1}">${u.active ? "Отключить" : "Включить"}</button>` : ""}</div>` : ""}</div>`).join("");
    document.querySelectorAll("[data-toggle]").forEach(b => b.onclick = async () => {
      try { await api("/api/users/" + b.dataset.toggle, { method: "PATCH", body: JSON.stringify({ active: b.dataset.active === "1" }) }); await renderUsers(); } catch (err) { say(err); }
    });
    document.querySelectorAll("[data-pw]").forEach(b => b.onclick = () => openPw(b.dataset.pw));
  } catch (e) { say(e); }
}
async function renderAudit() {
  try {
    const a = await api("/api/audit");
    $("auditList").innerHTML = a.map(x => `<div class="card"><b>${esc(x.action)}</b><p>${esc(x.username)} · ${esc(x.target)} · ${esc(x.created_at)}</p></div>`).join("");
  } catch (e) { say(e); }
}

// ---- Смена пароля (свой) и сброс пароля (админом) ----
let pwTarget = null;
function openPw(userId) {
  pwTarget = userId || null;
  $("pwForm").reset();
  $("pwTitle").textContent = pwTarget ? "Сброс пароля пользователя" : "Смена пароля";
  $("pwCurWrap").classList.toggle("hide", !!pwTarget);
  $("pwCur").required = !pwTarget;
  $("pwDialog").showModal();
}
$("pwBtn").onclick = () => openPw(null);
$("pwForm").onsubmit = async e => {
  e.preventDefault();
  try {
    if (pwTarget) await api("/api/users/" + pwTarget, { method: "PATCH", body: JSON.stringify({ password: $("pwNew").value }) });
    else await api("/api/password", { method: "POST", body: JSON.stringify({ current: $("pwCur").value, password: $("pwNew").value }) });
    $("pwDialog").close();
    alert("Пароль изменён");
  } catch (err) { say(err); }
};

// ---- Заявки ----
const RQ_KEY = { "Вступление": "join", "Перевод": "transfer", "Звание": "rank", "Увольнение": "dismiss" };
function renderRequests() {
  const pending = requests.filter(r => r.can_decide).length;
  $("reqTab").textContent = pending ? `Заявки (${pending})` : "Заявки";
  $("requestList").innerHTML = requests.map(r => {
    const cls = r.status === "Одобрена" ? "good" : (r.status === "Ожидает" ? "" : "bad");
    let what = "";
    if (r.type === "Вступление") what = `${esc(r.fio)} → ${esc(r.org)}, должность: ${esc(r.position)}${r.rank ? ", звание: " + esc(r.rank) : ""}${r.nickname || r.discord ? `<br><span class="muted">${esc(r.nickname || "ник не указан")} · Discord: ${esc(r.discord || "не указан")}</span>` : ""}`;
    else if (r.type === "Перевод") what = `${esc(r.fio)} → ${esc(r.org)}${r.position ? ", должность: " + esc(r.position) : ""}${r.rank ? ", звание: " + esc(r.rank) : ""}`;
    else if (r.type === "Звание") what = `${esc(r.fio)} (${esc(r.org)}) → звание: ${esc(r.rank)}`;
    else what = `${esc(r.fio)} (${esc(r.org)}) — увольнение`;
    const buttons = [
      r.can_decide ? `<button class="primary" data-rq-ok="${r.id}">Одобрить</button><button data-rq-no="${r.id}">Отклонить</button>` : "",
      r.can_cancel ? `<button data-rq-cancel="${r.id}">Отозвать</button>` : ""
    ].join("");
    return `<div class="card"><div class="row"><h3>#${r.id} · ${esc(r.type)}</h3><span class="pill ${cls}">${esc(r.status)}</span></div><p>${what}</p>${r.comment ? `<p class="muted">Комментарий: ${esc(r.comment)}</p>` : ""}<p class="muted">Автор: ${esc(r.author)} · ${esc(r.created_at)}</p>${r.decided_by ? `<p class="muted">Решение: ${esc(r.decided_by)}${r.decision_note ? " — " + esc(r.decision_note) : ""}</p>` : ""}${buttons ? `<div class="userrow">${buttons}</div>` : ""}</div>`;
  }).join("") || '<div class="empty">Заявок пока нет.</div>';
  document.querySelectorAll("[data-rq-ok]").forEach(b => b.onclick = () => decideRequest(b.dataset.rqOk, true));
  document.querySelectorAll("[data-rq-no]").forEach(b => b.onclick = () => decideRequest(b.dataset.rqNo, false));
  document.querySelectorAll("[data-rq-cancel]").forEach(b => b.onclick = async () => {
    try { await api("/api/requests/" + b.dataset.rqCancel + "/cancel", { method: "POST" }); await loadPrivate(); } catch (e) { say(e); }
  });
}
async function decideRequest(id, approve) {
  const note = prompt(approve ? "Комментарий к одобрению (можно пусто):" : "Причина отказа (можно пусто):");
  if (note === null) return;
  try { await api("/api/requests/" + id + "/decide", { method: "POST", body: JSON.stringify({ approve, note }) }); await loadPrivate(); } catch (e) { say(e); await loadPrivate(); }
}
function refreshRqRank() {
  const type = $("rqType").value;
  let org = $("rqOrg").value;
  if (type === "Звание") org = (staff.find(s => s.id === $("rqStaff").value) || {}).org || "";
  $("rqRank").innerHTML = rankOptions(org, "");
}
function updateRequestForm() {
  const key = RQ_KEY[$("rqType").value];
  document.querySelectorAll("[data-rq]").forEach(el => el.classList.toggle("hide", !el.dataset.rq.split(" ").includes(key)));
  $("rqOrgLabel").textContent = key === "transfer" ? "Перевести в организацию" : "Организация";
  refreshRqRank();
}
$("addRequest").onclick = () => {
  $("requestForm").reset();
  const orgs = Object.keys(config.orgs);
  $("rqOrg").innerHTML = orgs.map(x => `<option>${esc(x)}</option>`).join("");
  $("rqStaff").innerHTML = staff.filter(s => s.status === "Служит").map(s => `<option value="${esc(s.id)}">${esc(s.fio)} — ${esc(s.org)}</option>`).join("");
  updateRequestForm();
  $("requestDialog").showModal();
};
$("rqType").onchange = updateRequestForm;
$("rqOrg").onchange = refreshRqRank;
$("rqStaff").onchange = refreshRqRank;
$("requestForm").onsubmit = async e => {
  e.preventDefault();
  const body = { type: $("rqType").value, comment: $("rqComment").value.trim(), staff_id: $("rqStaff").value, fio: $("rqFio").value.trim(), nickname: $("rqNick").value.trim(), discord: $("rqDiscord").value.trim(), org: $("rqOrg").value, position: $("rqPosition").value.trim(), rank: $("rqRank").value };
  try { await api("/api/requests", { method: "POST", body: JSON.stringify(body) }); await loadPrivate(); $("requestDialog").close(); } catch (err) { say(err); }
};

init().catch(say);
