let config = { orgs: {}, user: null }, staff = [], history = [], training = [];
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
  $("decOrg").innerHTML = '<option value="">Без организации</option>' + orgs.map(x => `<option>${esc(x)}</option>`).join("");
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
  $("regBtn").classList.toggle("hide", !!u);
  $("logoutBtn").classList.toggle("hide", !u);
  $("pwBtn").classList.toggle("hide", !u);
  document.querySelectorAll(".restricted").forEach(x => x.classList.toggle("hide", !u || !MANAGE_ROLES.includes(u.role)));
  document.querySelectorAll(".admin").forEach(x => x.classList.toggle("hide", !u || !["main_admin", "technical_admin"].includes(u.role)));
  document.querySelectorAll(".mainadmin").forEach(x => x.classList.toggle("hide", !u || u.role !== "main_admin"));
  $("addUser").classList.toggle("hide", !u || u.role !== "main_admin");
  $("sessionText").textContent = u ? `Вход: ${u.username} · ${u.role}${u.org ? " · " + u.org : ""}` : "Для просмотра списка сотрудников войдите в систему.";
}

async function loadPrivate() {
  try {
    staff = await api("/api/staff");
    history = await api("/api/history").catch(() => []);
    training = await api("/api/training").catch(() => []);
    renderStaff(); renderCreds(); renderHistory(); renderTraining();
    await renderProfile();
    await renderMyCase();
    if (["main_admin", "technical_admin"].includes(config.user?.role)) { renderUsers(); renderAudit(); }
    if (config.user?.role === "main_admin") renderRegs();
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
    $("usersList").innerHTML = a.map(u => `<div class="card"><b>${esc(u.username)}</b><p>${esc(u.role)} · ${esc(u.org || "без организации")} · ${u.active ? "активен" : "отключён"}</p>${u.fio || u.token ? `<p class="muted">${esc(u.fio || "ФИО не указано")}${u.token ? " · жетон " + esc(u.token) : ""}</p>` : ""}${isMain ? `<div class="userrow"><button data-prof="${u.id}">Профиль</button><button data-pw="${u.id}">Сбросить пароль</button>${u.role !== "main_admin" ? `<button data-toggle="${u.id}" data-active="${u.active ? 0 : 1}">${u.active ? "Отключить" : "Включить"}</button>` : ""}</div>` : ""}</div>`).join("");
    document.querySelectorAll("[data-toggle]").forEach(b => b.onclick = async () => {
      try { await api("/api/users/" + b.dataset.toggle, { method: "PATCH", body: JSON.stringify({ active: b.dataset.active === "1" }) }); await renderUsers(); } catch (err) { say(err); }
    });
    document.querySelectorAll("[data-pw]").forEach(b => b.onclick = () => openPw(b.dataset.pw));
    document.querySelectorAll("[data-prof]").forEach(b => b.onclick = async () => {
      try { const d = await api("/api/profiles/" + b.dataset.prof); openProfile(b.dataset.prof, d.profile, true, d.user.username); } catch (err) { say(err); }
    });
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

// ---- Регистрация ----
$("regBtn").onclick = () => { $("regForm").reset(); $("regDialog").showModal(); };
$("loginToReg").onclick = () => { $("loginDialog").close(); $("regBtn").click(); };
$("regForm").onsubmit = async e => {
  e.preventDefault();
  if ($("regPass").value !== $("regPass2").value) return alert("Пароли не совпадают");
  try {
    await api("/api/register", { method: "POST", body: JSON.stringify({
      username: $("regUser").value.trim(), password: $("regPass").value, fio: $("regFio").value.trim(),
      nickname: $("regNick").value.trim(), discord: $("regDiscord").value.trim(), token: $("regToken").value.trim(), passport: $("regPassport").value.trim()
    }) });
    $("regForm").reset();
    $("regDialog").close();
    alert("Регистрация отправлена на рассмотрение. После одобрения администратором войдите с вашим логином и паролем.");
  } catch (err) { say(err); }
};

// ---- Профиль ----
let profTarget = null; // null — свой профиль, иначе id пользователя (редактирует главный администратор)
const dash = v => v ? esc(v) : '<span class="muted">не указано</span>';
async function renderProfile() {
  try {
    const d = await api("/api/profile");
    const p = d.profile || {}, au = safeUrl(p.avatar_path);
    $("profileContent").innerHTML = `<div class="panel pcard"><div class="pava">${au ? `<img src="${esc(au)}" alt="">` : initials(p.fio || d.username)}</div><div><h3>${p.fio ? esc(p.fio) : "ФИО не указано"}</h3><div class="pnick">${p.nickname ? esc(p.nickname) : "ник не указан"}</div><div class="pfields"><div class="pf"><span>Ник в Discord</span><b>${dash(p.discord)}</b></div><div class="pf"><span>Жетон</span><b>${dash(p.token)}</b></div><div class="pf"><span>Номер паспорта</span><b>${dash(p.passport)}</b></div></div><div class="userrow"><button class="primary" id="profEdit">Редактировать</button></div></div></div><p class="small">Паспортные данные видны только вам и главному администратору. Жетон меняет только администратор.</p>`;
    $("profEdit").onclick = () => openProfile(null, d.profile, d.can_edit_identity, d.username);
  } catch (e) { $("profileContent").innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
function openProfile(userId, p, full, name) {
  profTarget = userId;
  p = p || {};
  $("pfFio").value = p.fio || ""; $("pfNick").value = p.nickname || ""; $("pfDiscord").value = p.discord || "";
  $("pfToken").value = p.token || ""; $("pfPassport").value = p.passport || ""; $("pfFile").value = "";
  $("pfFio").disabled = !full && !!p.fio;
  $("pfToken").disabled = !full;
  $("pfAvatarWrap").classList.toggle("hide", !!userId);
  $("pfHint").textContent = full ? "" : "ФИО и жетон после заполнения меняет только администратор.";
  $("profTitle").textContent = userId ? "Профиль: " + (name || "") : "Мой профиль";
  $("profDialog").showModal();
}
$("profForm").onsubmit = async e => {
  e.preventDefault();
  const body = { fio: $("pfFio").value.trim(), nickname: $("pfNick").value.trim(), discord: $("pfDiscord").value.trim(), token: $("pfToken").value.trim(), passport: $("pfPassport").value.trim() };
  try {
    await api(profTarget ? "/api/profiles/" + profTarget : "/api/profile", { method: "PUT", body: JSON.stringify(body) });
    const f = $("pfFile").files[0];
    if (f && !profTarget) { const fd = new FormData(); fd.append("image", f); await api("/api/profile/avatar", { method: "POST", body: fd }); }
    $("profDialog").close();
    await renderProfile();
    if (profTarget) await renderUsers();
  } catch (err) { say(err); await renderProfile(); }
};

// ---- Регистрации (главный администратор) ----
let regDecideId = null;
async function renderRegs() {
  try {
    const a = await api("/api/registrations");
    const pending = a.filter(r => r.status === "Ожидает").length;
    $("regTab").textContent = pending ? `Регистрации (${pending})` : "Регистрации";
    $("regList").innerHTML = a.map(r => {
      const cls = r.status === "Одобрена" ? "good" : (r.status === "Ожидает" ? "" : "bad");
      const match = !r.token ? "" : r.staff_match
        ? `<br><span class="good">Жетон найден в реестре: ${esc(r.staff_match.fio)} (${esc(r.staff_match.org)}, ${esc(r.staff_match.status)})</span>`
        : `<br><span class="muted">Жетон не найден среди сотрудников</span>`;
      return `<div class="card"><b>${esc(r.username)}</b> <span class="pill ${cls}">${esc(r.status)}</span>
        <p>${esc(r.fio)}<br><span class="muted">ник: ${esc(r.nickname)} · Discord: ${esc(r.discord)} · жетон: ${esc(r.token || "—")} · паспорт: ${esc(r.passport)}</span>${match}</p>
        <p class="muted">${esc(r.created_at)}${r.decided_by ? " · решение: " + esc(r.decided_by) : ""}${r.decision_note ? " · " + esc(r.decision_note) : ""}</p>
        ${r.status === "Ожидает" ? `<div class="userrow"><button class="primary" data-reg-ok="${r.id}" data-who="${esc(r.username)}">Одобрить</button><button data-reg-no="${r.id}">Отклонить</button></div>` : ""}</div>`;
    }).join("") || '<div class="empty">Регистраций пока нет.</div>';
    document.querySelectorAll("[data-reg-ok]").forEach(b => b.onclick = () => {
      regDecideId = b.dataset.regOk;
      $("decWho").textContent = "Пользователь: " + b.dataset.who;
      $("decRole").value = "viewer"; $("decOrg").value = "";
      $("regDecideDialog").showModal();
    });
    document.querySelectorAll("[data-reg-no]").forEach(b => b.onclick = async () => {
      const note = prompt("Причина отказа (можно оставить пустой):");
      if (note === null) return;
      try { await api("/api/registrations/" + b.dataset.regNo + "/reject", { method: "POST", body: JSON.stringify({ note }) }); await renderRegs(); } catch (e) { say(e); await renderRegs(); }
    });
  } catch (e) { say(e); }
}
$("regDecideForm").onsubmit = async e => {
  e.preventDefault();
  try {
    await api("/api/registrations/" + regDecideId + "/approve", { method: "POST", body: JSON.stringify({ role: $("decRole").value, org: $("decOrg").value }) });
    $("regDecideDialog").close();
    await renderRegs(); await renderUsers();
  } catch (err) { say(err); await renderRegs(); }
};

init().catch(say);
