/* Lembretes de revisão: notificação diária, selo no ícone e cartão de ajustes na aba Revisão. */
const CFG = "lembrete_cfg", ULT = "lembrete_ultimo";
const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const lerCfg = () => { try { return { on: false, hora: 19, ...JSON.parse(localStorage.getItem(CFG) || "{}") }; } catch (e) { return { on: false, hora: 19 }; } };
const gravar = (c) => { try { localStorage.setItem(CFG, JSON.stringify(c)); } catch (e) { /* ignora */ } };
const suporta = () => "Notification" in window;
const pend = () => (window.AF ? window.AF.revVencidas().length : 0);

function selo() { // número no ícone do app (iOS 16.4+ instalado, Android, desktop)
  const n = pend();
  try { if (n && navigator.setAppBadge) navigator.setAppBadge(n); else if (navigator.clearAppBadge) navigator.clearAppBadge(); } catch (e) { /* ignora */ }
}
async function avisar(titulo, corpo, tag) {
  const op = { body: corpo, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: tag || "revisoes", renotify: false, data: { url: "./#revisao" } };
  try { const reg = await navigator.serviceWorker.ready; await reg.showNotification(titulo, op); }
  catch (e) { try { new Notification(titulo, op); } catch (_) { /* ignora */ } }
}
function verificar() {
  selo();
  const c = lerCfg(); if (!c.on || !suporta() || Notification.permission !== "granted") return;
  const n = pend(); if (!n) return;
  const agora = new Date(), hoje = window.AF.isoHoje();
  if (agora.getHours() < c.hora || localStorage.getItem(ULT) === hoje) return;
  try { localStorage.setItem(ULT, hoje); } catch (e) { /* ignora */ }
  avisar("Revisões de hoje", n === 1 ? "Você tem 1 revisão para fazer hoje." : `Você tem ${n} revisões para fazer hoje.`);
}
function mensagem() {
  const c = lerCfg();
  if (!suporta()) return ios && !standalone
    ? "No iPhone os lembretes só funcionam com o app instalado: toque em Compartilhar, depois em Adicionar à Tela de Início, e abra pelo ícone."
    : "Este navegador não permite notificações.";
  if (Notification.permission === "denied") return "As notificações estão bloqueadas. Libere nas configurações do aparelho ou do navegador para este site.";
  if (c.on && Notification.permission === "granted") return `Ligado. Você recebe um aviso por dia, a partir das ${String(c.hora).padStart(2, "0")}:00, se houver revisões.`;
  return "Receba um aviso por dia quando houver revisões para fazer.";
}
function cartao() {
  const c = lerCfg(), ok = suporta() && Notification.permission !== "denied", on = c.on && suporta() && Notification.permission === "granted";
  const horas = [6, 7, 8, 9, 12, 14, 16, 18, 19, 20, 21].map((h) => `<option value="${h}" ${c.hora === h ? "selected" : ""}>${String(h).padStart(2, "0")}:00</option>`).join("");
  return `<section class="card lembrete"><span class="lem-ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/></svg></span>
    <div class="lem-tx"><b>Lembrete diário</b><p class="muted">${mensagem()}</p></div>
    <div class="lem-ac">${ok ? `<button type="button" class="${on ? "" : "pri"} small" data-lem="toggle">${on ? "Desligar" : "Ativar"}</button>` : ""}
      ${on ? `<label class="lem-h">Hora <select data-lem="hora" aria-label="Hora do lembrete">${horas}</select></label><button type="button" class="small" data-lem="teste">Testar</button>` : ""}</div></section>`;
}
function montar() { const s = document.getElementById("lembreteSlot"); if (s) s.innerHTML = cartao(); }

document.addEventListener("af:render", (e) => { if (e.detail && e.detail.secao === "revisao") montar(); verificar(); });
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-lem]"); if (!b) return;
  const k = b.dataset.lem, c = lerCfg();
  if (k === "toggle") {
    if (c.on) { c.on = false; gravar(c); }
    else {
      let p = Notification.permission; if (p === "default") p = await Notification.requestPermission();
      if (p === "granted") { c.on = true; gravar(c); window.AF.aviso("Lembrete ligado."); verificar(); } else c.on = false, gravar(c);
    }
    montar();
  } else if (k === "teste") { const n = pend(); avisar("Revisões de hoje", n ? `Você tem ${n} revis${n>1?"ões":"ão"} para fazer hoje.` : "Teste: nenhuma revisão vence hoje.", "teste"); }
});
document.addEventListener("change", (e) => { const s = e.target.closest('select[data-lem="hora"]'); if (!s) return; const c = lerCfg(); c.hora = +s.value; gravar(c); try { localStorage.removeItem(ULT); } catch (x) { /* ignora */ } montar(); verificar(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) verificar(); });
document.addEventListener("af:ready", () => {
  const h = location.hash.slice(1); if (h && document.getElementById("sec" + h[0].toUpperCase() + h.slice(1))) window.AF.mostrarSecao(h);
  verificar(); setInterval(verificar, 60000);
});
