"use strict";
// Вход, регистрация, пароль и запуск приложения.
async function loadConfig() { const c = await api("/api/config"); S.orgs = c.orgs; S.user = c.user; }
function applyUser() {
  const u = S.user;
  $("loginBtn").classList.toggle("hide", !!u); $("regBtn").classList.toggle("hide", !!u);
  $("logoutBtn").classList.toggle("hide", !u); $("pwBtn").classList.toggle("hide", !u);
  $("userChip").classList.toggle("hide", !u);
  if (u) $("userChip").innerHTML = `<b>${esc(u.username)}</b> · ${esc(u.role_title)}${u.org ? " · " + esc(u.org) : ""}`;
  buildNav();
}
function openLogin() {
  const d = openDlg("dlg", "Вход", `<form id="lf"><div class="field"><label>Логин</label><input id="lf_u" autocomplete="username" autofocus></div><div class="field"><label>Пароль</label><input id="lf_p" type="password" autocomplete="current-password"></div>
    <div class="row sp"><button type="button" class="btn ghost" id="lf_reg">Нет аккаунта? Регистрация</button><button class="btn primary" id="lf_ok">Войти</button></div></form>`);
  d.querySelector("#lf_reg").onclick = () => { d.close(); openRegister(); };
  d.querySelector("#lf").onsubmit = async e => {
    e.preventDefault();
    try { await post("/api/login", { username: d.querySelector("#lf_u").value.trim(), password: d.querySelector("#lf_p").value }); d.close(); await boot(); toast("Добро пожаловать!", "ok"); }
    catch (err) { fail(err); }
  };
}
function openRegister() {
  const f = (id, label, extra = "", cls = "") => `<div class="field ${cls}"><label>${label}</label><input id="${id}" ${extra}></div>`;
  const d = openDlg("dlg", "Регистрация", `<p class="small">После отправки администратор проверит данные и одобрит доступ. Войти можно будет с указанными логином и паролем.</p><form id="rf" class="form" style="margin-top:12px">
    ${f("rg_u", "Логин *", 'maxlength=40 autocomplete=username required')}${f("rg_fio", "ФИО персонажа *", "maxlength=150 required")}
    ${f("rg_p", "Пароль * (10–64 символа)", 'type=password minlength=10 maxlength=64 autocomplete=new-password required')}${f("rg_p2", "Повторите пароль *", 'type=password minlength=10 maxlength=64 autocomplete=new-password required')}
    ${f("rg_n", "Ник *", "maxlength=60 required")}${f("rg_d", "Ник в Discord *", "maxlength=60 required")}
    ${f("rg_t", "Жетон — 000-000 (если уже выдан)", 'maxlength=7 placeholder="123-456"')}${f("rg_pp", "Номер паспорта *", "maxlength=30 required")}
    <div class="wide row sp"><button type="button" class="btn" data-x2>Отмена</button><button class="btn primary">Отправить</button></div></form>`);
  d.querySelector("[data-x2]").onclick = () => d.close();
  bindToken(d.querySelector("#rg_t"));
  d.querySelector("#rf").onsubmit = async e => {
    e.preventDefault();
    if (d.querySelector("#rg_p").value !== d.querySelector("#rg_p2").value) return toast("Пароли не совпадают", "err");
    try {
      await post("/api/register", { username: d.querySelector("#rg_u").value.trim(), password: d.querySelector("#rg_p").value, fio: d.querySelector("#rg_fio").value.trim(), nickname: d.querySelector("#rg_n").value.trim(), discord: d.querySelector("#rg_d").value.trim(), token: d.querySelector("#rg_t").value.trim(), passport: d.querySelector("#rg_pp").value.trim() });
      d.close(); openDlg("dlg", "Готово", '<p>Регистрация отправлена на рассмотрение. После одобрения администратором войдите с вашим логином и паролем.</p>');
    } catch (err) { fail(err); }
  };
}
function openPassword() {
  const d = openDlg("dlg", "Смена пароля", `<form id="pf"><div class="field"><label>Текущий пароль</label><input id="pw_c" type="password" autocomplete="current-password" required></div><div class="field"><label>Новый пароль (от 10 символов)</label><input id="pw_n" type="password" minlength="10" autocomplete="new-password" required></div><div class="row" style="justify-content:flex-end"><button class="btn primary">Сменить</button></div></form>`);
  d.querySelector("#pf").onsubmit = async e => { e.preventDefault(); try { await post("/api/password", { current: d.querySelector("#pw_c").value, password: d.querySelector("#pw_n").value }); d.close(); toast("Пароль изменён", "ok"); } catch (err) { fail(err); } };
}
$("loginBtn").onclick = openLogin; $("regBtn").onclick = openRegister; $("pwBtn").onclick = openPassword;
$("logoutBtn").onclick = async () => { try { await post("/api/logout"); } catch { /* уже вышли */ } location.href = "/"; };

async function boot() {
  await loadConfig(); applyUser();
  if (isMain()) api("/api/registrations").then(a => { navBadges.regs = a.filter(r => r.status === "Ожидает").length || ""; buildNav(); }).catch(() => {});
  const h = (location.hash || "").replace(/^#\//, "");
  await go(VIEWS[h] ? h : "home", null, { push: false });
}
if ($("ver")) $("ver").textContent += " · js v8";
window.addEventListener("popstate", () => { const h = (location.hash || "").replace(/^#\//, ""); if (VIEWS[h] && h !== S.view) go(h, null, { push: false }); });
boot().catch(e => { $("view").innerHTML = `<div class="empty bad">Не удалось загрузить: ${esc(e.message)}</div>`; });
