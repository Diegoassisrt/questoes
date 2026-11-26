/* App instalável: service worker, aviso de instalação e de nova versão. */
const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
let evInstalar = null;

function faixa(html, cls) {
  const d = document.createElement("div"); d.className = "pwa-faixa " + (cls || ""); d.setAttribute("role", "status"); d.innerHTML = html;
  document.body.appendChild(d); return d;
}
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const n = reg.installing; if (!n) return;
      n.addEventListener("statechange", () => {
        if (n.state === "installed" && navigator.serviceWorker.controller) {
          const f = faixa('<span>Há uma versão nova do app.</span><button type="button" class="pri small">Atualizar</button>', "nova");
          f.querySelector("button").onclick = () => { n.postMessage("SKIP_WAITING"); };
        }
      });
    });
  }).catch(() => {});
  let recarregou = false; const tinha = !!navigator.serviceWorker.controller; // só recarrega ao ATUALIZAR, não na primeira instalação
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (recarregou || !tinha) return; recarregou = true; location.reload(); });
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.ir && window.AF) { const s = String(e.data.ir).split("#")[1]; if (s) AF.mostrarSecao(s); } });
}
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); evInstalar = e; mostrarConvite(); });

function mostrarConvite() {
  if (standalone || localStorage.getItem("pwa_convite") === "1" || document.querySelector(".pwa-faixa.conv")) return;
  const iosTxt = 'Instale o app: toque em <b>Compartilhar</b> <svg class="svg-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg> e depois em <b>Adicionar à Tela de Início</b>.';
  const f = faixa(`<span>${ios ? iosTxt : "Instale o app para abrir mais rápido, até sem internet."}</span>${!ios && evInstalar ? '<button type="button" class="pri small" data-inst="1">Instalar</button>' : ""}<button type="button" class="pwa-x" aria-label="Fechar">✕</button>`, "conv");
  f.querySelector(".pwa-x").onclick = () => { localStorage.setItem("pwa_convite", "1"); f.remove(); };
  const b = f.querySelector("[data-inst]"); if (b) b.onclick = async () => { evInstalar.prompt(); await evInstalar.userChoice; f.remove(); };
}
document.addEventListener("af:ready", () => { if (ios && !standalone) setTimeout(mostrarConvite, 2500); });
