"use strict";
// Ядро интерфейса: состояние, запросы, диалоги, уведомления, вспомогательные виды.
const S = { user: null, orgs: [], staff: [], view: "home", arg: null };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const safeUrl = u => /^(https?:\/\/[^\s"'<>]+|\/uploads\/[A-Za-z0-9._-]+)$/i.test(u || "") ? u : "";
const can = p => !!S.user && S.user.perms.includes(p);
const isMain = () => S.user?.role === "main_admin";
const debounce = (f, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
const initials = fio => esc(String(fio || "?").split(/\s+/).map(x => x[0]).filter(Boolean).slice(0, 2).join("").toUpperCase());
const fmtDT = s => s ? String(s).replace("T", " ").slice(0, 16) : "";

async function api(url, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const headers = { "X-Requested-With": "KordRP", ...(isForm || opts.body === undefined ? {} : { "Content-Type": "application/json" }), ...(opts.headers || {}) };
  let r;
  try { r = await fetch(url, { credentials: "same-origin", ...opts, headers }); }
  catch { throw Error("Нет связи с сервером. Проверьте интернет и повторите."); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && S.user) { S.user = null; toast("Сессия истекла — войдите снова", "err"); setTimeout(() => location.reload(), 1200); }
  if (!r.ok) throw Error(d.error || "Ошибка запроса (" + r.status + ")");
  return d;
}
const post = (u, b) => api(u, { method: "POST", body: JSON.stringify(b ?? {}) });
const put = (u, b) => api(u, { method: "PUT", body: JSON.stringify(b ?? {}) });
const patch = (u, b) => api(u, { method: "PATCH", body: JSON.stringify(b ?? {}) });
const del = (u, b) => api(u, { method: "DELETE", body: JSON.stringify(b ?? {}) });

function toast(msg, type = "") {
  const t = document.createElement("div");
  t.className = "toast " + type; t.textContent = msg;
  $("toasts").appendChild(t);
  setTimeout(() => t.remove(), type === "err" ? 6500 : 3500);
}
const fail = e => toast(e.message || String(e), "err");
// Обёртка: выполнить действие, показать ошибку, не падать.
const run = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) toast(okMsg, "ok"); return r; } catch (e) { fail(e); return undefined; } };

// ---------- Диалоги ----------
function openDlg(id, title, body, { cls = "", footer = "", onClose } = {}) {
  const d = $(id);
  d.className = cls;
  d.innerHTML = `<div class="dh"><h2>${title}</h2><button class="btn ghost sm" data-x>✕</button></div><div class="db">${body}</div>${footer ? `<div class="df">${footer}</div>` : ""}`;
  d.querySelector("[data-x]").onclick = () => d.close();
  d.onclose = () => { if (onClose) onClose(); };
  if (!d.open) d.showModal();
  return d;
}
const closeDlg = id => { if ($(id).open) $(id).close(); };
function confirmBox(text, { ok = "Подтвердить", danger = false } = {}) {
  return new Promise(res => {
    const d = openDlg("dlg3", "Подтверждение", `<p>${esc(text)}</p>`, { footer: `<button class="btn" data-no>Отмена</button><button class="btn ${danger ? "danger" : "primary"}" data-yes>${esc(ok)}</button>`, onClose: () => res(false) });
    d.querySelector("[data-no]").onclick = () => d.close();
    d.querySelector("[data-yes]").onclick = () => { d.onclose = null; d.close(); res(true); };
  });
}
function askBox(title, label, { value = "", multiline = false, type = "text", ok = "ОК", hint = "" } = {}) {
  return new Promise(res => {
    const inp = multiline ? `<textarea id="askv" rows="3">${esc(value)}</textarea>` : `<input id="askv" type="${type}" value="${esc(value)}">`;
    const d = openDlg("dlg3", esc(title), `<div class="field"><label>${esc(label)}</label>${inp}${hint ? `<div class="small">${esc(hint)}</div>` : ""}</div>`,
      { footer: `<button class="btn" data-no>Отмена</button><button class="btn primary" data-yes>${esc(ok)}</button>`, onClose: () => res(null) });
    const v = d.querySelector("#askv"); v.focus();
    d.querySelector("[data-no]").onclick = () => d.close();
    const go = () => { d.onclose = null; d.close(); res(v.value); };
    d.querySelector("[data-yes]").onclick = go;
    if (!multiline) v.onkeydown = e => { if (e.key === "Enter") go(); };
  });
}

// ---------- Мелкие компоненты ----------
function pogony(stars, color) {
  const n = Math.max(0, Math.min(6, stars | 0));
  return `<span class="ep ${n ? "" : "empty"}" style="--c:${esc(color || "#6b7a99")}" title="Погоны">${n ? "<i></i>".repeat(n) : "<i style='opacity:.3'></i>"}</span>`;
}
function avatar(path, fio, { masked = false, cls = "" } = {}) {
  const u = safeUrl(path);
  return `<div class="av ${cls} ${masked ? "badge" : ""}">${u ? `<img src="${esc(u)}" alt="" loading="lazy">` : (masked ? "🔒" : initials(fio))}</div>`;
}
const orgBadge = (name, color) => `<span class="org" style="--c:${esc(color || orgColor(name))}"><i></i>${esc(name)}</span>`;
const orgColor = name => S.orgs.find(o => o.name === name)?.color || "#6b7a99";
const orgByName = name => S.orgs.find(o => o.name === name);
const optionList = (arr, sel, empty) => (empty !== undefined ? `<option value="">${esc(empty)}</option>` : "") + arr.map(x => `<option ${x === sel ? "selected" : ""}>${esc(x)}</option>`).join("");
const statusPills = s => [
  s.classified ? '<span class="pill sec">🔒 Засекречено</span>' : "",
  s.archived ? '<span class="pill bad">В архиве</span>' : (!s.published ? '<span class="pill warn">Черновик</span>' : ""),
  s.status === "Уволен" ? '<span class="pill bad">Уволен</span>' : ""
].join(" ");
const copyBtn = (text, label = "копировать") => `<button class="btn ghost sm" data-copy="${esc(text)}" title="Скопировать">📋 ${label}</button>`;
document.addEventListener("click", e => {
  const b = e.target.closest("[data-copy]");
  if (b) navigator.clipboard?.writeText(b.dataset.copy).then(() => toast("Скопировано", "ok"), () => toast("Не удалось скопировать", "err"));
});

// Уменьшение фото перед загрузкой: меньше трафика и меньше размер резервной копии.
function shrinkImage(file, max = 720) {
  return new Promise(res => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return res(file);
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, max / Math.max(img.width, img.height));
      if (k === 1 && file.size < 400 * 1024) return res(file);
      const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => res(b ? new File([b], "photo.jpg", { type: "image/jpeg" }) : file), "image/jpeg", 0.88);
    };
    img.onerror = () => { URL.revokeObjectURL(url); res(file); };
    img.src = url;
  });
}
async function uploadImage(url, file) {
  const f = await shrinkImage(file), fd = new FormData();
  fd.append("image", f, f.name || "photo.jpg");
  return api(url, { method: "POST", body: fd });
}
// Удостоверение → PNG (рисуем SVG с сервера на canvas).
async function downloadCardPng(id, name) {
  try {
    const r = await fetch(`/api/staff/${id}/card.svg?t=${Date.now()}`, { credentials: "same-origin" });
    if (!r.ok) throw Error("Не удалось получить удостоверение");
    const url = URL.createObjectURL(await r.blob());
    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(Error("Не удалось отрисовать удостоверение")); img.src = url; });
    const c = document.createElement("canvas"); c.width = 1280; c.height = 800;
    c.getContext("2d").drawImage(img, 0, 0, 1280, 800);
    URL.revokeObjectURL(url);
    c.toBlob(b => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `udostoverenie-${String(name || id).replace(/[^\wА-Яа-яЁё-]+/g, "_")}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }, "image/png");
  } catch (e) { fail(e); }
}
function csvDownload(name, rows) {
  const q = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const blob = new Blob(["\ufeff" + rows.map(r => r.map(q).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- Навигация ----------
const NAV = [
  { id: "home", t: "Главная", i: "🏠", show: () => true },
  { id: "registry", t: "Реестр", i: "🗂️", show: () => can("staff.view") },
  { id: "mycase", t: "Моё дело", i: "📁", show: () => !!S.user },
  { id: "players", t: "Игроки", i: "🔎", show: () => can("players.search") },
  { id: "creds", t: "Удостоверения", i: "🪪", show: () => can("staff.view") },
  { id: "training", t: "Аттестации", i: "📝", show: () => can("training.view") },
  { id: "orders", t: "Приказы", i: "📜", show: () => can("orders.view") },
  { id: "orgs", t: "Организации и звания", i: "🏛️", show: () => true },
  { id: "history", t: "История", i: "🕘", show: () => can("history.view") },
  { id: "profile", t: "Мой профиль", i: "👤", show: () => !!S.user },
  { grp: "Администрирование", show: () => isMain() || can("audit.view") },
  { id: "regs", t: "Регистрации", i: "✅", show: () => isMain() },
  { id: "users", t: "Пользователи", i: "👥", show: () => isMain() },
  { id: "perms", t: "Права доступа", i: "🔐", show: () => isMain() },
  { id: "audit", t: "Журнал действий", i: "📋", show: () => can("audit.view") },
  { id: "backup", t: "Копии и база", i: "💾", show: () => isMain() }
];
const VIEWS = {}; // id → { title, render(el, arg) }
let navBadges = {};
function buildNav() {
  $("nav").innerHTML = NAV.filter(n => n.show()).map(n => n.grp ? `<div class="navgrp">${n.grp}</div>`
    : `<button class="nav ${S.view === n.id ? "on" : ""}" data-go="${n.id}"><span class="ico">${n.i}</span>${n.t}${navBadges[n.id] ? `<span class="cnt">${navBadges[n.id]}</span>` : ""}</button>`).join("");
}
async function go(view, arg, { push = true } = {}) {
  const n = NAV.find(x => x.id === view);
  if (!n || !n.show()) view = "home";
  S.view = view; S.arg = arg ?? null;
  if (push && location.hash !== "#/" + view) history.pushState(null, "", "#/" + view);
  const v = VIEWS[view];
  $("pageTitle").textContent = (NAV.find(x => x.id === view) || {}).t || "";
  $("side").classList.remove("open");
  buildNav();
  const el = $("view"); el.innerHTML = '<div class="empty">Загрузка…</div>';
  try { await v.render(el, S.arg); } catch (e) { el.innerHTML = `<div class="empty bad">${esc(e.message)}</div>`; }
  window.scrollTo(0, 0);
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-go]");
  if (b) { e.preventDefault(); go(b.dataset.go); }
});
$("burger").onclick = () => $("side").classList.toggle("open");

// Тема
const savedTheme = (() => { try { return localStorage.getItem("kr-theme"); } catch { return null; } })();
document.documentElement.dataset.theme = savedTheme || "dark";
$("themeBtn").onclick = () => {
  const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("kr-theme", t); } catch { /* приватный режим */ }
};
