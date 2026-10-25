"use strict";
// Удостоверение как картинка (SVG). Рисуется на лету, поэтому новое фото или звание появляются сразу.
const { imageData } = require("./core");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cut = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const safeColor = c => /^#[0-9a-f]{6}$/i.test(c || "") ? c : "#6b7a99";

function star(cx, cy, r) {
  const p = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
    p.push((cx + rr * Math.cos(a)).toFixed(1) + "," + (cy + rr * Math.sin(a)).toFixed(1));
  }
  return `<polygon points="${p.join(" ")}" fill="#f5d77a" stroke="#8a6d1c" stroke-width=".6"/>`;
}
function pogony(x, y, stars, color) {
  const n = Math.max(0, Math.min(6, stars | 0)), w = 96, h = 44;
  let g = `<g transform="translate(${x},${y})"><rect width="${w}" height="${h}" rx="6" fill="${safeColor(color)}" stroke="#ffffff55"/><rect x="0" y="${h / 2 - 2}" width="${w}" height="4" fill="#00000033"/>`;
  const gap = 15, start = w / 2 - (n - 1) * gap / 2;
  for (let i = 0; i < n; i++) g += star(start + i * gap, h / 2, 6);
  return g + "</g>";
}

// v: { fio, token, org, position, rank, status, stars, color, masked, portrait_path, cred, valid, reason }
function cardSvg(v) {
  const color = safeColor(v.color);
  const img = imageData(v.portrait_path);
  const photo = img
    ? `<image href="data:${img.mime};base64,${img.data.toString("base64")}" x="30" y="96" width="172" height="212" preserveAspectRatio="xMidYMid slice" clip-path="url(#pc)"/>`
    : `<g opacity=".55"><circle cx="116" cy="170" r="34" fill="#8da0c8"/><path d="M52 292c6-44 36-66 64-66s58 22 64 66z" fill="#8da0c8"/></g><text x="116" y="318" font-size="11" text-anchor="middle" fill="#8da0c8" letter-spacing="2">ФОТО</text>`;
  const fio = v.fio || "—", fs = fio.length > 30 ? 17 : fio.length > 22 ? 20 : 24;
  const c = v.cred;
  const ok = v.valid;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="640" height="400" font-family="Segoe UI, Arial, sans-serif">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#101c3a"/><stop offset="1" stop-color="#1b2b55"/></linearGradient>
<clipPath id="pc"><rect x="30" y="96" width="172" height="212" rx="10"/></clipPath></defs>
<rect width="640" height="400" rx="20" fill="url(#bg)"/>
<rect x="3" y="3" width="634" height="394" rx="18" fill="none" stroke="#d6ae52" stroke-width="2"/>
<path d="M0 20Q0 0 20 0H620Q640 0 640 20V70H0Z" fill="${color}"/><rect y="62" width="640" height="8" fill="#00000030"/>
<text x="30" y="30" font-size="11" fill="#ffffffcc" letter-spacing="3">РЕСПУБЛИКА КОРДОНИЯ · СЛУЖЕБНОЕ УДОСТОВЕРЕНИЕ</text>
<text x="30" y="55" font-size="20" font-weight="700" fill="#fff">${esc(cut(v.org, 34))}</text>
<rect x="30" y="96" width="172" height="212" rx="10" fill="#0a1228" stroke="#ffffff30"/>${photo}
<text x="230" y="112" font-size="10" fill="#8da0c8" letter-spacing="2">ФИО</text>
<text x="230" y="140" font-size="${fs}" font-weight="700" fill="#fff">${esc(cut(fio, 36))}</text>
<text x="230" y="176" font-size="10" fill="#8da0c8" letter-spacing="2">ЗВАНИЕ</text>
<text x="230" y="198" font-size="16" fill="#f1f4fb">${esc(cut(v.rank || "не указано", 28))}</text>
${pogony(530, 160, v.stars, color)}
<text x="230" y="230" font-size="10" fill="#8da0c8" letter-spacing="2">ДОЛЖНОСТЬ</text>
<text x="230" y="250" font-size="15" fill="#f1f4fb">${esc(cut(v.position, 42))}</text>
<text x="230" y="284" font-size="10" fill="#8da0c8" letter-spacing="2">ЖЕТОН</text><text x="230" y="306" font-size="20" font-weight="700" fill="#f5d77a">${esc(v.token)}</text>
<text x="350" y="284" font-size="10" fill="#8da0c8" letter-spacing="2">№ УДОСТОВЕРЕНИЯ</text><text x="350" y="306" font-size="18" font-weight="700" fill="#fff">${esc(c?.credential_no || "не присвоен")}</text>
<text x="30" y="346" font-size="10" fill="#8da0c8" letter-spacing="2">ВЫДАНО</text><text x="30" y="364" font-size="13" fill="#e6ebf7">${esc(c?.issued_on || "—")}</text>
<text x="150" y="346" font-size="10" fill="#8da0c8" letter-spacing="2">ДЕЙСТВИТЕЛЬНО ДО</text><text x="150" y="364" font-size="13" fill="#e6ebf7">${esc(c?.expires_on || "бессрочно")}</text>
<g transform="translate(396,330)"><rect width="214" height="46" rx="10" fill="${ok ? "#12362a" : "#3a1717"}" stroke="${ok ? "#35c28a" : "#e5534b"}" stroke-width="2"/>
<text x="107" y="29" font-size="14" font-weight="700" text-anchor="middle" fill="${ok ? "#58e0a8" : "#ff7b72"}" letter-spacing="1">${ok ? "ДЕЙСТВИТЕЛЬНО" : "НЕДЕЙСТВИТЕЛЬНО"}</text></g>
</svg>`;
}
module.exports = { cardSvg, esc };
