/* Detalhes de interface: animações, deslizar para concluir e modos de cor do leitor. */
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;

function contar(el) {
  const to = +el.dataset.to || 0; if (RM || !to) { el.textContent = to; return; }
  const t0 = performance.now();
  (function f(t) { const k = Math.min(1, (t - t0) / 900); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(f); })(t0);
}
function animar(raiz) {
  raiz.querySelectorAll("[data-to]").forEach(contar);
  requestAnimationFrame(() => requestAnimationFrame(() => raiz.querySelectorAll("[data-dash]").forEach((c) => { c.style.strokeDasharray = c.dataset.dash; })));
}
document.addEventListener("af:render", (e) => { if (e.detail && e.detail.el) animar(e.detail.el); });

/* Deslizar a revisão para a esquerda conclui (só toque; no computador clica-se no círculo). */
let sw = null;
document.addEventListener("pointerdown", (e) => {
  const r = e.target.closest(".rvlinha");
  if (!r || e.pointerType === "mouse" || r.classList.contains("okrev") || r.classList.contains("feito") || e.target.closest("button,input,select")) return;
  sw = { r, x: e.clientX, y: e.clientY, dx: 0, on: false };
});
document.addEventListener("pointermove", (e) => {
  if (!sw) return;
  const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
  if (!sw.on && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) { sw = null; return; }
  if (Math.abs(dx) > 10) sw.on = true;
  if (!sw.on) return;
  sw.dx = Math.min(0, dx); sw.r.style.transition = "none"; sw.r.style.transform = `translateX(${sw.dx}px)`;
  sw.r.classList.toggle("swp", sw.dx < -90);
});
function fimSwipe() {
  if (!sw) return; const { r, dx, on } = sw; sw = null;
  r.style.transition = ""; r.style.transform = ""; r.classList.remove("swp");
  if (!on) return;
  const bloqueia = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
  document.addEventListener("click", bloqueia, { capture: true, once: true }); setTimeout(() => document.removeEventListener("click", bloqueia, true), 80);
  const c = r.querySelector(".rvcheck"); if (dx < -90 && c && !c.checked && !c.disabled) { c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })); }
}
document.addEventListener("pointerup", fimSwipe); document.addEventListener("pointercancel", fimSwipe);

/* Leitor: claro, sépia e noite, mais barra de progresso da apostila. */
const TEMAS = ["", "sepia", "noite"], NOMES = { "": "Claro", sepia: "Sépia", noite: "Noite" };
(function leitor() {
  const dlg = document.getElementById("dlgLeitor"), nav = dlg && dlg.querySelector(".lnav"); if (!dlg || !nav) return;
  let t = ""; try { t = localStorage.getItem("leitor_tema") || ""; } catch (e) { /* ignora */ }
  const aplica = () => { if (t) dlg.dataset.lt = t; else delete dlg.dataset.lt; b.textContent = "Aa"; b.title = "Cor da página: " + NOMES[t]; b.setAttribute("aria-label", "Cor da página: " + NOMES[t]); };
  const b = document.createElement("button"); b.type = "button"; b.id = "lTema";
  nav.insertBefore(b, document.getElementById("lMenos"));
  b.onclick = () => { t = TEMAS[(TEMAS.indexOf(t) + 1) % TEMAS.length]; try { localStorage.setItem("leitor_tema", t); } catch (e) { /* ignora */ } aplica(); };
  aplica();
  const barra = document.createElement("div"); barra.className = "lprog"; barra.innerHTML = "<i></i>"; dlg.prepend(barra);
  setInterval(() => {
    if (!dlg.open) return;
    const p = +document.getElementById("lPag").value || 0, tot = parseInt((document.getElementById("lTotal").textContent || "").replace(/\D+/g, ""), 10) || 0;
    barra.firstChild.style.width = tot ? Math.min(100, p / tot * 100) + "%" : "0";
  }, 500);
})();

/* Login: mostrar/ocultar senha. */
document.addEventListener("click", (e) => {
  const b = e.target.closest(".lg-eye"); if (!b) return;
  const i = document.getElementById("senha"), ver = i.type === "password";
  i.type = ver ? "text" : "password"; b.classList.toggle("on", ver); b.setAttribute("aria-label", ver ? "Ocultar senha" : "Mostrar senha");
});

/* Login: balança o cartão quando aparece um erro. */
(function () { const e = document.getElementById("erroLogin"), l = document.getElementById("login"); if (!e || !l) return;
  new MutationObserver(() => { if (e.textContent.trim()) { l.classList.remove("shake"); void l.offsetWidth; l.classList.add("shake"); } }).observe(e, { childList: true, characterData: true, subtree: true }); })();

/* Login: frase inspiradora. Começa pela frase da hora e troca sozinha a cada poucos segundos. */
(function () {
  const FRASES = [
    "Um pouco por dia, todos os dias, leva você longe.",
    "A aprovação é feita de constância, não de pressa.",
    "Cada questão resolvida é um passo a menos até o seu objetivo.",
    "Errar faz parte. O que importa é entender e voltar mais forte.",
    "Disciplina hoje, tranquilidade no dia da prova.",
    "Quem revisa na hora certa esquece menos e aprende mais.",
    "Você não precisa ser perfeito, só precisa continuar.",
    "O seu futuro agradece cada hora de estudo de hoje."
  ];
  const el = document.getElementById("lgFrase"), dots = document.getElementById("lgDots"); if (!el || !dots) return;
  let i = new Date().getHours() % FRASES.length;
  dots.innerHTML = FRASES.map(() => "<i></i>").join("");
  const pinta = () => { el.textContent = FRASES[i]; [...dots.children].forEach((d, k) => d.classList.toggle("on", k === i)); };
  pinta();
  const reduz = matchMedia("(prefers-reduced-motion: reduce)").matches;
  setInterval(() => {
    const login = document.getElementById("login"); if (document.hidden || !login || login.hidden) return;
    i = (i + 1) % FRASES.length;
    if (reduz) { pinta(); return; }
    el.classList.add("sai");
    setTimeout(() => { pinta(); el.classList.remove("sai"); el.classList.add("entra"); void el.offsetWidth; el.classList.remove("entra"); }, 450);
  }, 7000);
})();
