/* Simulado com cronômetro. Usa a ponte window.AF criada em app.js. */
const A = () => window.AF;
const KEY = "simulado_estado";
const I = {
  ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  br: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
  rel: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9.5 2.5h5"/></svg>',
  flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  seta: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  volta: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  corte: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.6 7.6L20 18M8.6 16.4L20 6"/></svg>',
  vazio: '<svg class="vazio-svg" viewBox="0 0 150 110" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="75" cy="62" r="34"/><path d="M75 40v22l14 9M64 14h22M75 14v8"/><path d="M122 24v10M117 29h10M20 78v8M16 82h8"/></svg>'
};
let cfg = { mats: null, n: 20, min: 60, livre: false, emb: true, novas: true };
let S = null, tick = null, hist = null, aberto = false; // aberto: a prova está na tela própria (modo foco)

try { const x = JSON.parse(localStorage.getItem(KEY) || "null"); if (x && x.itens && !x.fim) S = x; } catch (e) { /* ignora */ }
const salvar = () => { try { if (S) localStorage.setItem(KEY, JSON.stringify(S)); else localStorage.removeItem(KEY); } catch (e) { /* ignora */ } };
const chave = (it) => it.lid + "|" + it.num;
const fmt = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };

function pool() {
  const out = [];
  A().listas.forEach((L) => {
    const mat = (A().materias.find((m) => m.id === L.materia) || {}).nome || "Sem matéria";
    (L.questoes || []).forEach((q) => {
      const g = L.gabarito && L.gabarito[q.num];
      if (g && g !== "ANULADA") out.push({ lid: L.id, num: q.num, mat, feita: !!(L.respostas && L.respostas[q.num] && L.corrigidas && L.corrigidas[q.num]) });
    });
  });
  return out;
}
const matsDisp = () => [...new Set(pool().map((x) => x.mat))].sort((a, b) => a.localeCompare(b, "pt-BR"));
function elegiveis() {
  const sel = cfg.mats || matsDisp();
  return pool().filter((x) => sel.includes(x.mat) && (!cfg.novas || !x.feita));
}
function embaralhar(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- Configuração ---------- */
function renderSetup(el) {
  const mats = matsDisp(), sel = cfg.mats || mats, el0 = elegiveis(), disp = el0.length, E = A().esc;
  const chipN = [10, 20, 30, 40].map((n) => `<button class="chip ${cfg.n === n ? "on" : ""}" data-sn="${n}">${n}</button>`).join("") + `<button class="chip ${cfg.n === 0 ? "on" : ""}" data-sn="0">Todas</button>`;
  const chipT = [30, 60, 90, 120].map((m) => `<button class="chip ${!cfg.livre && cfg.min === m ? "on" : ""}" data-st="${m}">${m} min</button>`).join("") + `<button class="chip ${cfg.livre ? "on" : ""}" data-st="0">Sem limite</button>`;
  const nReal = cfg.n ? Math.min(cfg.n, disp) : disp;
  el.innerHTML = `<div class="ctop"><div><h2>Simulado</h2><p class="muted">Monte uma prova com suas próprias questões e treine com o relógio rodando.</p></div></div>
  ${S && !S.fim ? `<section class="card sim-em"><div><b>Simulado em andamento</b><p class="muted">${S.itens.filter((x) => S.resp[chave(x)]).length} de ${S.itens.length} respondidas · ${S.limite ? "restam " + fmt(restante()) : fmt(restante()) + " decorridos"}</p></div><button type="button" class="pri" data-scont="1">Continuar</button><button type="button" data-sabandona="1">Abandonar</button></section>` : ""}
  ${!mats.length ? `<div class="revempty">${I.vazio}<b>Ainda não há questões com gabarito.</b><p>Envie uma lista de questões com gabarito para montar simulados.</p><button class="pri" data-secnav="questoes">Ir para Questões</button></div>` : `
  <section class="card sim-cfg">
    <div class="sim-bloco"><span class="cap">Matérias</span><div class="chips">${mats.map((m) => `<button class="chip ${sel.includes(m) ? "on" : ""}" data-sm="${E(m)}">${E(m)}</button>`).join("")}</div></div>
    <div class="sim-bloco"><span class="cap">Número de questões</span><div class="chips">${chipN}</div></div>
    <div class="sim-bloco"><span class="cap">Tempo</span><div class="chips">${chipT}</div>
      ${cfg.livre ? '<p class="muted sim-dica">O cronômetro conta o tempo que você levar, sem limite.</p>' : `<p class="muted sim-dica">Cerca de ${nReal ? (cfg.min / nReal).toFixed(1).replace(".", ",") : "—"} min por questão.</p>`}</div>
    <div class="sim-bloco sim-opcs">
      <label class="sim-sw"><input type="checkbox" id="smEmb" ${cfg.emb ? "checked" : ""}><span>Embaralhar a ordem</span></label>
      <label class="sim-sw"><input type="checkbox" id="smNov" ${cfg.novas ? "checked" : ""}><span>Só questões que ainda não corrigi</span></label>
    </div>
    <div class="sim-rodape"><p class="muted"><b>${disp}</b> quest${disp === 1 ? "ão" : "ões"} disponíve${disp === 1 ? "l" : "is"} nessa seleção. As respostas do simulado entram no caderno de erros e no desempenho.</p>
      <button class="pri sim-ir" id="smIr" ${disp ? "" : "disabled"}>Iniciar simulado ${I.seta}</button></div>
  </section>`}
  <section class="card sim-hist"><div class="ei-ch"><h3>Últimos simulados</h3></div><div id="simHist"><div class="sk" style="height:52px"></div></div></section>`;
  carregarHist();
}
async function carregarHist() {
  if (!hist) { const d = await A().cfgGet("simulados"); hist = (d && d.itens) || []; }
  const box = document.getElementById("simHist"); if (!box) return;
  box.innerHTML = hist.length ? hist.slice(0, 6).map((h) => { const p = h.ac + h.er ? Math.round(h.ac / (h.ac + h.er) * 100) : 0; const [d, m] = [h.data.slice(8), h.data.slice(5, 7)];
    return `<div class="sim-h"><span class="sim-hd">${d}/${m}</span><span class="sim-hn">${h.n} questões · ${fmt(h.seg)}</span><span class="sim-hp ${p >= 75 ? "bom" : p >= 60 ? "med" : "ruim"}">${p}%</span></div>`; }).join("")
    : '<p class="muted" style="margin:0">Nenhum simulado ainda. O primeiro aparece aqui.</p>';
}

/* ---------- Prova ---------- */
function iniciar() {
  let it = elegiveis(); if (cfg.emb) it = embaralhar(it);
  if (cfg.n) it = it.slice(0, cfg.n);
  if (!it.length) return;
  S = { ini: Date.now(), limite: cfg.livre ? 0 : cfg.min * 60, itens: it.map((x) => ({ lid: x.lid, num: x.num, mat: x.mat })), resp: {}, flag: {}, risc: {}, atual: 0, fim: false };
  aberto = true; salvar(); renderTela();
}
const restante = () => S.limite ? S.limite - (Date.now() - S.ini) / 1000 : (Date.now() - S.ini) / 1000;
function iniciarRelogio() {
  clearInterval(tick);
  const up = () => {
    if (!S || S.fim) { clearInterval(tick); return; }
    const t = restante(), box = document.getElementById("simT"); if (!box) return;
    if (S.limite && t <= 0) { finalizar(true); return; }
    box.textContent = fmt(t);
    const pc = S.limite ? t / S.limite : 1;
    box.parentElement.classList.toggle("alerta", !!S.limite && pc <= .1 && t > 60);
    box.parentElement.classList.toggle("critico", !!S.limite && t <= 60);
  };
  up(); tick = setInterval(up, 500);
}
function questao(it) {
  const L = A().listas.find((x) => x.id === it.lid); if (!L) return null;
  const q = (L.questoes || []).find((x) => x.num === it.num); return q ? { L, q } : null;
}
function renderProva(el) {
  const it = S.itens[S.atual], Q = questao(it), E = A().esc;
  if (!Q) { el.innerHTML = '<p class="card">Esta questão não está mais disponível.</p>'; return; }
  const hd = A().cabecalhoQuestao(Q.q.enunciado), k = chave(it), marc = S.resp[k];
  const rk = (S.risc && S.risc[k]) || {};
  const alts = Object.entries(Q.q.alternativas).sort(([a], [b]) => a.localeCompare(b)).map(([l, t]) =>
    `<div class="salt-row"><button type="button" class="salt ${marc === l ? "sel" : ""} ${rk[l] ? "cortada" : ""}" data-alt="${l}" aria-pressed="${marc === l}"><span class="letra">${l}</span><span class="atxt">${Q.q.tipo === "CE" ? t : E(A().limpar(t))}</span></button><button type="button" class="salt-cut ${rk[l] ? "on" : ""}" data-scut="${l}" aria-pressed="${!!rk[l]}" aria-label="${rk[l] ? "Desfazer o corte da" : "Cortar a"} alternativa ${l}" title="${rk[l] ? "Desfazer corte" : "Cortar alternativa"}">${I.corte}</button></div>`).join("");
  const resp = S.itens.filter((x) => S.resp[chave(x)]).length;
  const grade = S.itens.map((x, i) => `<button type="button" class="sn ${S.resp[chave(x)] ? "ok" : ""} ${S.flag[chave(x)] ? "fl" : ""} ${i === S.atual ? "cur" : ""}" data-ir="${i}" aria-label="Questão ${i + 1}${S.resp[chave(x)] ? ", respondida" : ""}${S.flag[chave(x)] ? ", marcada para revisar" : ""}">${i + 1}</button>`).join("");
  el.innerHTML = `<div class="sim-topo"><div class="sim-rel" role="timer" aria-label="Tempo ${S.limite ? "restante" : "decorrido"}">${I.rel}<b id="simT">--:--</b><small>${S.limite ? "restante" : "decorrido"}</small></div>
      <div class="sim-prog"><span>Questão <b>${S.atual + 1}</b> de ${S.itens.length}</span><i style="--p:${resp / S.itens.length * 100}%"></i><small>${resp} respondida${resp === 1 ? "" : "s"}</small></div>
      <button type="button" class="sim-sair small" data-ssair="1">Sair</button><button type="button" class="pri small" data-sfim="1">Finalizar</button></div>
    <article class="card sim-q"><div class="badges"><span class="badge mat">${E(it.mat)}</span>${hd.banca ? `<span class="badge banca">${E(hd.banca)}</span>` : ""}${hd.ano ? `<span class="badge ano">${E(hd.ano)}</span>` : ""}</div>
      <div class="enun">${A().enunciadoHTML(hd.resto, Q.q.tabelas)}</div><div class="alts sim-alts">${alts}</div><p class="muted sim-dica2">Use a tesoura para cortar as alternativas que você tem certeza de que estão erradas.</p></article>
    <div class="sim-nav"><button type="button" class="sim-b" data-sp="-1" ${S.atual ? "" : "disabled"}>${I.volta} Anterior</button>
      <button type="button" class="sim-b fl ${S.flag[k] ? "on" : ""}" data-sflag="1" aria-pressed="${!!S.flag[k]}">${I.flag} ${S.flag[k] ? "Marcada" : "Revisar depois"}</button>
      <button type="button" class="sim-b" data-sp="1" ${S.atual < S.itens.length - 1 ? "" : "disabled"}>Próxima ${I.seta}</button></div>
    <section class="card sim-grade"><div class="ei-ch"><h3>Questões</h3><small><i class="lg ok"></i>respondida <i class="lg fl"></i>revisar</small></div><div class="sim-sn">${grade}</div></section>`;
  iniciarRelogio();
}

/* ---------- Resultado ---------- */
async function finalizar(auto) {
  if (!S || S.fim) return;
  const br0 = S.itens.filter((x) => !S.resp[chave(x)]).length;
  if (!auto && br0 && !confirm(`Você deixou ${br0} quest${br0>1?"ões":"ão"} em branco. Finalizar mesmo assim?`)) return;
  clearInterval(tick);
  const seg = Math.min(Math.round((Date.now() - S.ini) / 1000), S.limite || 1e9);
  const porL = new Map(), mats = {}, erros = []; let ac = 0, er = 0, br = 0;
  S.itens.forEach((it) => {
    const Q = questao(it), m = S.resp[chave(it)], pm = mats[it.mat] = mats[it.mat] || { ac: 0, er: 0, br: 0 };
    if (!Q || !m) { br++; pm.br++; return; }
    const g = Q.L.gabarito[it.num];
    Q.L.respostas = Q.L.respostas || {}; Q.L.corrigidas = Q.L.corrigidas || {};
    Q.L.respostas[it.num] = m; Q.L.corrigidas[it.num] = true;
    const o = porL.get(Q.L) || { o: {}, qs: [] }; porL.set(Q.L, o);
    o.o[`respostas.${it.num}`] = m; o.o[`corrigidas.${it.num}`] = true; o.qs.push(Q.q);
    if (m === g) { ac++; pm.ac++; } else { er++; pm.er++; erros.push({ id: chave(it), mat: it.mat, lista: Q.L.nome, num: it.num, marcou: m, gab: g, txt: A().limpar(Q.q.enunciado || "").slice(0, 4000) }); }
  });
  porL.forEach((v, L) => { A().upd(L, v.o); A().registrarCorrecao(L, v.qs); });
  A().marcarAtividade();
  const res = { data: A().isoHoje(), ts: Date.now(), n: S.itens.length, ac, er, br, seg, limite: S.limite, mats };
  S.fim = true; S.res = res; S.erros = erros; aberto = true; salvar();
  hist = [res, ...(hist || [])].slice(0, 30); A().cfgSet("simulados", { itens: hist });
  renderTela();
}
function anel(p, cor) {
  const C = 2 * Math.PI * 52;
  return `<svg class="sim-anel" viewBox="0 0 120 120" role="img" aria-label="${p}% de acerto"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--line)" stroke-width="10"/><circle class="pg" cx="60" cy="60" r="52" fill="none" stroke="${cor}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(p / 100 * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 60 60)"/><text x="60" y="68" text-anchor="middle">${p}%</text></svg>`;
}
function renderResultado(el) {
  const r = S.res, E = A().esc, p = r.ac + r.er ? Math.round(r.ac / (r.ac + r.er) * 100) : 0, cor = p >= 75 ? "#2bb283" : p >= 60 ? "#f0952a" : "#e5586a";
  const tile = (ic, v, t, c) => `<div class="sim-tile ${c}"><span>${ic}</span><b>${v}</b><small>${t}</small></div>`;
  const ms = Object.entries(r.mats).filter(([, v]) => v.ac + v.er).sort((a, b) => a[1].ac / (a[1].ac + a[1].er) - b[1].ac / (b[1].ac + b[1].er));
  el.innerHTML = `<div class="ctop"><div><h2>Resultado do simulado</h2><p class="muted">${r.n} questões em ${fmt(r.seg)}${r.limite && r.seg >= r.limite ? " (tempo esgotado)" : ""}.</p></div></div>
  <section class="card sim-res"><div class="sim-resh">${anel(p, cor)}<div class="sim-tiles">${tile(I.ok, r.ac, "acertos", "ok")}${tile(I.x, r.er, "erros", "er")}${tile(I.br, r.br, "em branco", "br")}${tile(I.rel, r.n ? fmt(r.seg / r.n) : "—", "por questão", "tm")}</div></div></section>
  ${ms.length ? `<section class="ei-card"><h3>Por matéria</h3>${ms.map(([n, v]) => { const q = Math.round(v.ac / (v.ac + v.er) * 100), c = q >= 75 ? "#2bb283" : q >= 60 ? "#f0952a" : "#e5586a"; return `<div class="eg-mrow"><div class="eg-mtop"><span>${E(n)}</span><span><b>${q}%</b><i style="color:${c}">${v.ac}/${v.ac + v.er}</i></span></div><div class="eg-track"><div style="width:${q}%;background:${c}"></div></div></div>`; }).join("")}</section>` : ""}
  ${S.erros.length ? `<section class="ei-card"><div class="ei-ch"><h3>Questões erradas</h3><button type="button" class="small" data-senv="1">Enviar todas ao caderno</button></div><p class="muted" style="margin:0 0 8px">Toque em “Enviar para o caderno de erros” em cada questão para anotar o motivo, ou envie todas de uma vez.</p>${S.erros.map((x) => `<div class="sim-err"><b>${E(x.lista)} · Questão ${x.num}</b><p>${E(x.txt)}</p><span>Você marcou <b>${x.marcou}</b> · Gabarito <b>${x.gab}</b></span>${A().cadEnviarBtn(x.id)}</div>`).join("")}</section>` : '<section class="revempty"><b>Nenhum erro neste simulado.</b><p>Ótimo resultado. Continue assim.</p></section>'}
  <div class="sim-fim"><button type="button" class="pri" data-snovo="1">Concluir</button></div>`;
}

/* ---------- Roteamento da seção ---------- */
function overlay() { let o = document.getElementById("simTela"); if (!o) { o = document.createElement("div"); o.id = "simTela"; o.className = "sim-tela"; o.innerHTML = '<div class="sim-wrap"></div>'; document.body.appendChild(o); } return o; }
function fechaOverlay() { clearInterval(tick); const o = document.getElementById("simTela"); if (o) o.remove(); document.body.classList.remove("sim-aberto"); }
function renderTela() {
  const sec = document.getElementById("secSimulado"); if (!sec) return;
  if (S && aberto) {
    const o = overlay(); document.body.classList.add("sim-aberto"); const w = o.querySelector(".sim-wrap");
    if (S.fim) renderResultado(w); else renderProva(w);
  } else { fechaOverlay(); renderSetup(sec); }
  document.dispatchEvent(new CustomEvent("af:render", { detail: { secao: "simulado", el: document.getElementById("simTela") || sec } }));
}
const topo = () => { const o = document.getElementById("simTela"); if (o) o.scrollTo({ top: 0 }); };
document.addEventListener("click", (e) => {
  const raiz = e.target.closest("#secSimulado, #simTela"); if (!raiz) return;
  const b = e.target.closest("button, input"); if (!b) return;
  const d = b.dataset;
  if (d.sn !== undefined) { cfg.n = +d.sn; renderTela(); }
  else if (d.st !== undefined) { if (+d.st) { cfg.min = +d.st; cfg.livre = false; } else cfg.livre = true; renderTela(); }
  else if (d.sm !== undefined) { const all = matsDisp(); let s = cfg.mats || all.slice(); s = s.includes(d.sm) ? s.filter((x) => x !== d.sm) : [...s, d.sm]; cfg.mats = s.length ? s : all; renderTela(); }
  else if (b.id === "smEmb") cfg.emb = b.checked;
  else if (b.id === "smNov") { cfg.novas = b.checked; renderTela(); }
  else if (b.id === "smIr") iniciar();
  else if (d.alt) { const k = chave(S.itens[S.atual]); S.risc = S.risc || {}; if (S.risc[k]) delete S.risc[k][d.alt]; if (S.resp[k] === d.alt) delete S.resp[k]; else S.resp[k] = d.alt; salvar(); renderTela(); }
  else if (d.scut) { const k = chave(S.itens[S.atual]); S.risc = S.risc || {}; const m = S.risc[k] = S.risc[k] || {}; if (m[d.scut]) delete m[d.scut]; else { m[d.scut] = 1; if (S.resp[k] === d.scut) delete S.resp[k]; } salvar(); renderTela(); }
  else if (d.sp) { S.atual = Math.max(0, Math.min(S.itens.length - 1, S.atual + +d.sp)); salvar(); renderTela(); topo(); }
  else if (d.ir !== undefined) { S.atual = +d.ir; salvar(); renderTela(); topo(); }
  else if (d.sflag) { const k = chave(S.itens[S.atual]); if (S.flag[k]) delete S.flag[k]; else S.flag[k] = 1; salvar(); renderTela(); }
  else if (d.sfim) finalizar(false);
  else if (d.scont) { aberto = true; if (S.limite && restante() <= 0) finalizar(true); else renderTela(); }
  else if (d.sabandona) { if (confirm("Abandonar este simulado? As respostas dadas nele não serão salvas.")) { S = null; aberto = false; salvar(); renderTela(); } }
  else if (d.ssair) { aberto = false; renderTela(); }
  else if (d.senv !== undefined) { let n = 0; S.erros.forEach((x) => { if (!window.AF.noCaderno(x.id)) { window.AF.cadEnviar(x.id); n++; } }); document.querySelectorAll("#simTela [data-cdsend]").forEach((x) => { x.outerHTML = window.AF.cadEnviarBtn(x.dataset.cdsend); }); window.AF.aviso(n ? n + " questão(ões) enviada(s) ao caderno." : "Todas já estavam no caderno."); }
  else if (d.sfechar) { S = null; aberto = false; salvar(); fechaOverlay(); }
  else if (d.snovo) { S = null; aberto = false; salvar(); renderTela(); }
});
window.AF.simulado = { render: renderTela };
document.addEventListener("af:ready", () => { if (window.AF.secao === "simulado") renderTela(); });
if (window.AF.secao === "simulado" && window.AF.user) renderTela();
