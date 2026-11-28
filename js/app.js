import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, setPersistence, browserLocalPersistence, browserSessionPersistence, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, addDoc, updateDoc, deleteDoc, deleteField, writeBatch, onSnapshot, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA9k7aqcBb2dVMVMA6zp0PAN6rLvADReaI",
  authDomain: "questoes-b0c0b.firebaseapp.com",
  projectId: "questoes-b0c0b",
  storageBucket: "questoes-b0c0b.firebasestorage.app",
  messagingSenderId: "194950212696",
  appId: "1:194950212696:web:b4b59dbf93460088056e2d",
  measurementId: "G-8H53FTS93Y"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Cache offline: continua funcionando sem internet e sincroniza depois
const fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

// ---------- Leitor de PDF (PDF.js via CDN, com CDN de reserva) ----------
let pdfWorker = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
let statusImport = "", ultimoTexto = "", ultimaLeitura = {};
const carregarScript = (src) => new Promise((ok, no) => {
  const sc = document.createElement("script"); sc.src = src; sc.onload = ok; sc.onerror = () => no(new Error("Falha ao carregar " + src));
  document.head.appendChild(sc);
});
async function garantirPdfjs() { // carrega o PDF.js só quando preciso; tenta cdnjs e, se falhar, jsDelivr
  if (!window.pdfjsLib) {
    for (const [src, w] of [["https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"], ["https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js", "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js"]]) {
      try { await carregarScript(src); pdfWorker = w; break; } catch (e) { /* tenta o próximo */ }
    }
  }
  if (!window.pdfjsLib) throw new Error("Não foi possível carregar o leitor de PDF (PDF.js). Verifique a internet ou bloqueadores de conteúdo.");
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
}
const $ = (id) => document.getElementById(id);
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- Estado ----------
let user = null, materias = [], listas = [], unsubs = [], listasOk = false;
const ui0 = JSON.parse(localStorage.getItem("ui_estudos") || "{}"); // preferências de tela (por aparelho)
let sel = { materia: ui0.materia || null, lista: ui0.lista || null };
let filtro = ui0.filtro || "todas";
let secao = ui0.secao || "inicio", subC = "regular";
let faixa = ui0.faixa || { de: 1, ate: 9999 };
const saveUi = () => localStorage.setItem("ui_estudos", JSON.stringify({ ...sel, filtro, faixa, secao }));
const col = (n) => collection(fs, "users", user.uid, n);
const ref = (n, id) => doc(fs, "users", user.uid, n, id);
const falha = (err) => { console.error(err); alert("Erro ao salvar na nuvem: " + err.message); };
// Ordem alfabética natural (Aula 2 antes de Aula 10, ignora acentos/maiúsculas)
const alfa = (a, b) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true, sensitivity: "base" });
const listaAtual = () => listas.find((l) => l.id === sel.lista);
const statTxt = (l) => { // ex.: "12/87 resp. • 75%"
  const c = contar(l, l.questoes), tot = l.questoes.length, cor = c.acerto + c.erro;
  return `${tot - c.branco}/${tot} resp. • ${cor ? Math.round((c.acerto / cor) * 100) + "%" : "—"}`;
};
const atualizarLinha = (L) => { const r = document.querySelector(`.mrow[data-l="${L.id}"]`); if (r) { const d = mrowDados(L); r.querySelector("[data-stat]").textContent = `${d.resp}/${d.t}`; r.querySelector(".mbar i").style.width = d.pr + "%"; const pp = r.querySelector(".mpct"); pp.textContent = d.pct === null ? "—" : d.pct + "%"; pp.className = "mpct " + d.nivel; } const dq = document.getElementById("dlgQuestoes"); if (dq && dq.open && L.id === sel.lista) topoQuestoes(L); };
let exibidas = []; // números das questões que estão na tela agora
const pendentesTela = (L) => L.questoes.filter((q) => exibidas.includes(q.num) && status(L, q) === "pendente");
// Atualiza o botão inferior em tempo real (contador e habilitação)
function atualizarFab() { // botão flutuante "Corrigir": corrige todas as marcadas
  const f = $("qFab"); if (!f) return;
  const L = listaAtual(); if (!L) { f.classList.remove("on"); return; }
  const n = pendentesTela(L).length;
  const mostra = !!(n && Object.keys(L.gabarito || {}).length); f.classList.toggle("on", mostra); f.tabIndex = mostra ? 0 : -1;
  const c = f.querySelector(".qcn"); if (c) c.textContent = n;
}
function atualizarBotao(L) {
  atualizarFab();
  const n = pendentesTela(L).length;
  document.querySelectorAll(".qcorrigir .qcn").forEach((e) => { e.textContent = n; e.hidden = n < 2; });
  const b = $("corrigir"); if (!b) return;
  b.textContent = `Corrigir questões marcadas (${n})`;
  b.disabled = !(n && Object.keys(L.gabarito).length);
}
const sig = (ls) => ls.map((L) => [L.id, L.nome, L.materia, L.questoes.length,
  Object.entries(L.respostas || {}).sort().join(), Object.keys(L.corrigidas || {}).sort().join(), Object.entries(L.riscadas || {}).sort().join(), Object.keys(L.ia || {}).sort().join()].join("~")).join("|");

// ---------- Leitura de PDF / questões / relatório (reaproveitados) ----------
// ---------- Extração do PDF ----------
const LIXO = new RegExp([
  "www\\.", "https?:", "t\\.me", "telegram", "estrat[eé]gia\\s+concursos",
  "p[aá]gina\\s+\\d+", "^\\s*\\d+\\s*(de|/)\\s*\\d+\\s*$",   // numeração de páginas
  ",\\s*equipe\\s", "^\\s*aula\\s+\\d+",                       // "Fulano, Equipe Direito X  Aula 07 ..."
  "direitos?\\s+autorais?", "proibida\\s+a\\s+reprodu", "9\\.610", "licenciado",
  "\\bcpf\\b", "\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}", "^\\s*prof\\."
].join("|"), "i");
const chaveLinha = (l) => l.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

// Limpeza final do texto (links, assinatura de rodapé, "Página N") — também aplicada ao exibir
function limpar(t) {
  return t
    .replace(/https?:\/\/\S+|t\.me\/\S+|www\.\S+/gi, " ")
    .replace(/[A-ZÀ-Ú][\wÀ-ú.]+(?:\s[A-ZÀ-Ú][\wÀ-ú.]+){0,1},\s*Equipe\s[\wÀ-ú ]{3,60}?\sAula\s\d+(?:\s[A-ZÀ-Ú0-9\-.()\/]{2,}){0,3}/g, " ")
    .replace(/\bP[aá]gina\s+\d+(\s+de\s+\d+)?/gi, " ")
    .replace(/\s{2,}/g, " ").trim();
}
// Gabarito: "1. C", "2 - A", "3: Certo", "4) ANULADA"...
const PAD_GAB = /(?<!\d)(\d{1,3})\s*[.\-–:)]?\s*(ANULAD[AO]|CERTO|ERRADO|[A-E])(?![A-Za-zÀ-ú])/g;

// Lê uma página: agrupa por linha (posição vertical), ordena da esquerda p/ a direita e marca colunas com \t
async function linhasDaPagina(pg) {
  const H = (pg.view && pg.view[3]) || 800, tc = await pg.getTextContent();
  const its = tc.items.filter((it) => it.transform).map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: it.height || 10 }));
  its.sort((a, b) => b.y - a.y);
  const grupos = [];
  for (const it of its) {
    const g = grupos[grupos.length - 1];
    if (g && Math.abs(it.y - g.y) <= 3) g.its.push(it); else grupos.push({ y: it.y, its: [it] });
  }
  return grupos.map((g) => {
    g.its.sort((a, b) => a.x - b.x);
    let linha = "", fim = null;
    for (const it of g.its) {
      if (fim !== null && it.s.trim() && it.x - fim > Math.max(10, it.h * 1.5)) linha += "\t"; // grande vão = nova coluna
      linha += it.s; fim = it.x + it.w;
    }
    return { t: linha.trim(), z: g.y > H * 0.88 || g.y < H * 0.12 }; // z = linha na margem (cabeçalho/rodapé)
  }).filter((l) => l.t);
}

async function extrairTexto(file) {
  await garantirPdfjs();
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  ultimaLeitura = { paginas: pdf.numPages };
  const paginas = [];
  for (let p = 1; p <= pdf.numPages; p++) paginas.push(await linhasDaPagina(await pdf.getPage(p)));
  // Rodapés/cabeçalhos/marcas d'água se repetem nas MARGENS de várias páginas (ignorando números): descarta.
  // (Linhas do corpo, como linhas repetidas de balanços, nunca são descartadas por repetição.)
  const cont = new Map();
  paginas.forEach((ls) => new Set(ls.filter((l) => l.z).map((l) => chaveLinha(l.t))).forEach((k) => cont.set(k, (cont.get(k) || 0) + 1)));
  const limite = Math.max(3, Math.ceil(paginas.length * 0.3));
  const lixo = (l) => !/gabarito/i.test(l.t) && (LIXO.test(l.t) || (l.z && chaveLinha(l.t).length >= 8 && cont.get(chaveLinha(l.t)) >= limite));
  return paginas.map((ls) => ls.filter((l) => !lixo(l)).map((l) => l.t).join("\n")).join("\n");
}

const norm = (r) => {
  r = r.toUpperCase();
  return r === "CERTO" ? "C" : r === "ERRADO" ? "E" : r.startsWith("ANULAD") ? "ANULADA" : r;
};

function lerGabarito(t) {
  const g = {};
  for (const m of t.replace(/\s+/g, " ").matchAll(PAD_GAB)) {
    const n = +m[1];
    if (!(n in g)) g[n] = norm(m[2]);
  }
  return g;
}

// Testa cada "GABARITO" e escolhe a ocorrência com maior sequência 1,2,3...
function extrairGabarito(texto) {
  let best = { g: {}, pos: texto.length }, bestRun = 0;
  for (const m of texto.matchAll(/gabarito/gi)) {
    const g = lerGabarito(texto.slice(m.index + m[0].length));
    let r = 0;
    while (r + 1 in g) r++;
    if (r > 0 && r >= bestRun) { bestRun = r; best = { g, pos: m.index }; } // empate: vale a última (gabarito fica no fim do PDF)
  }
  return best;
}

// Divide por "1.", "2.", ... aceitando só o número esperado na sequência
function dividirQuestoes(texto) {
  texto = texto.replace(/^[ \t]*LISTA\s+DE\s+QUEST[ÕO]ES\b.*$/gim, ""); // títulos de seção entre bancas
  let ach = [], esp = 1;
  for (const m of texto.matchAll(/^[ \t]*(?:Quest[aã]o[ \t]+|Q\.?[ \t]*)?(\d{1,3})[ \t]*[.)\-–:](?:[ \t]+(?=\S)|[ \t]*$)/gim)) {
    const n = +m[1];
    if (n === 1 && ach.length < 3) { ach = []; esp = 1; } // ignora sumário
    if (n === esp) { ach.push({ n, ini: m.index, fim: m.index + m[0].length }); esp++; }
  }
  return ach.map((a, i) => ({ n: a.n, bloco: texto.slice(a.fim, i + 1 < ach.length ? ach[i + 1].ini : texto.length) }));
}

// Separa enunciado e alternativas a) b) c) d) e); sem alternativas => Certo/Errado
// ---------- Tabelas (balanços, DREs...) ----------
const NUMX = /^[\(\-–]?\s*(?:R\$\s*)?[\d.,]+\s*\)?\s*%?$/;
function extrairTabelas(bloco) {
  const linhas = bloco.split("\n"), saida = [], tabelas = [];
  const cel = (l) => l.split("\t").map((x) => x.trim()).filter(Boolean);
  const ehAlt = (l) => /^\s*\(?[a-eA-E]\)\s/.test(l);
  const cand = (l) => l.includes("\t") && cel(l).length >= 2 && !ehAlt(l);
  let i = 0;
  while (i < linhas.length) {
    if (!cand(linhas[i])) { saida.push(linhas[i]); i++; continue; }
    let j = i; const rows = [];
    let cab = null; // título curto logo acima (ex.: ATIVO / Balanço Patrimonial) entra como linha de seção
    const prev = saida[saida.length - 1], pt = prev === undefined ? "" : prev.trim();
    if (pt && pt.length <= 45 && !prev.includes("\t") && !/^\[\[T\d+\]\]$/.test(pt) && !/[.?!;:,]$/.test(pt) && !ehAlt(prev) && !/^[•●▪■◦\-–—]\s/.test(pt) && !/^\(?\d{1,3}[.)]\s/.test(pt)
      && (pt.replace(/[^A-ZÀ-Ú]/g, "").length / (pt.replace(/[^A-Za-zÀ-ú]/g, "").length || 1) > 0.6 || pt.split(/\s+/).length <= 4)) { cab = saida.pop(); rows.push([pt]); }
    while (j < linhas.length) { // linhas com colunas + subtítulos curtos entre elas (ATIVO, PASSIVO...)
      const l = linhas[j];
      if (cand(l)) { rows.push(cel(l)); j++; }
      else if (rows.length && !ehAlt(l) && cel(l).length === 1 && cel(l)[0].length <= 45 && j + 1 < linhas.length && cand(linhas[j + 1]) && !/[.?!;:]$/.test(l.trim())) { rows.push(cel(l)); j++; }
      else break;
    }
    const cells = rows.flat(), nums = cells.filter((x) => NUMX.test(x)).length, fortes = rows.filter((r) => r.length >= 2).length;
    const ok = fortes >= 2 && (nums / cells.length >= 0.25 || (fortes >= 3 && Math.max(...rows.map((r) => r.length)) <= 5 && cells.reduce((a, x) => a + x.length, 0) / cells.length <= 35));
    if (ok) { tabelas.push({ linhas: rows.map((c) => ({ c })) }); saida.push(`[[T${tabelas.length - 1}]]`); } // {c:[...]}: o Firestore não aceita arrays aninhados
    else { if (cab !== null) saida.push(cab); for (let k = i; k < j; k++) saida.push(linhas[k].replace(/\t+/g, " ")); }
    i = j;
  }
  return { texto: saida.join("\n").replace(/\t+/g, " "), tabelas };
}
function tabelaHTML(t) {
  if (!t || !t.linhas || !t.linhas.length) return "";
  const n = Math.max(...t.linhas.map((l) => l.c.length));
  return '<div class="tblwrap"><table class="qtab">' + t.linhas.map((l, i) => {
    let cs = l.c;
    if (cs.length === 1 && n > 1) return `<tr class="sec"><td colspan="${n}">${esc(cs[0])}</td></tr>`;
    if (cs.length < n && n > 2) cs = [cs[0], ...Array(n - cs.length).fill(""), ...cs.slice(1)]; // valor na última coluna
    const cab = i === 0 && !cs.some((x) => NUMX.test(x));
    return "<tr>" + cs.map((x) => `<${cab ? "th" : "td"} class="${NUMX.test(x) ? "n" : ""}">${esc(x)}</${cab ? "th" : "td"}>`).join("") + "</tr>";
  }).join("") + "</table></div>";
}
const enunciadoHTML = (txt, tabelas) => txt.split(/\[\[T(\d+)\]\]/).map((p, i) => (i % 2 ? tabelaHTML((tabelas || [])[+p]) : p.trim() ? htmlEnunciado(p) : "")).join("");
const enunciadoTexto = (q) => limpar(q.enunciado).replace(/\[\[T(\d+)\]\]/g, (m, i) => "\n" + (((q.tabelas || [])[+i]) ? q.tabelas[+i].linhas.map((l) => l.c.join(" | ")).join("\n") : "") + "\n");

function parsearQuestao(num, bloco) {
  const ex = extrairTabelas(bloco);
  bloco = limpar(ex.texto.trim().replace(/\s*\n\s*/g, " "));
  const marcas = [...bloco.matchAll(/(?:^|\s)\(?([a-eA-E])\)\s/g)]
    .map((m) => ({ l: m[1].toUpperCase(), ini: m.index, fim: m.index + m[0].length }));
  // Última ocorrência de cada letra (as alternativas vêm depois do enunciado); vale a letra, não a posição
  const ultima = {};
  marcas.forEach((m) => { ultima[m.l] = m; });
  const seq = Object.values(ultima).sort((a, b) => a.ini - b.ini); // ordem em que aparecem no texto
  if (seq.length >= 2) {
    const bruto = {};
    seq.forEach((s, k) => { bruto[s.l] = bloco.slice(s.fim, k + 1 < seq.length ? seq[k + 1].ini : bloco.length).trim(); });
    const alt = {};
    Object.keys(bruto).sort().forEach((k) => (alt[k] = bruto[k])); // A, B, C, D, E
    return { num, tipo: "ME", enunciado: bloco.slice(0, seq[0].ini).trim(), alternativas: alt, tabelas: ex.tabelas };
  }
  return { num, tipo: "CE", enunciado: bloco, alternativas: { C: "Certo", E: "Errado" }, tabelas: ex.tabelas };
}

const ROM = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const FIM_AFIRM = /(?<=[.;!?])\s+(?=(?:Est[aã]o|Est[aá]|Assinale|Marque|Indique|Julgue|Considerando|Com base|Analise|[EÉ] correto|Somente|Apenas|Quais|Qual)\b)/;
// Detecta I., II., III... (em sequência) no texto corrido e separa em linhas
function htmlEnunciado(txt) {
  txt = limpar(txt);
  const ms = []; let e = 0;
  for (const m of txt.matchAll(/(?:^|\s)(VIII|VII|VI|IV|IX|III|II|I|V|X)\s*[.)\-–]\s+(?=\S)/g)) {
    if (m[1] === "I" && e < 2) { ms.length = 0; e = 0; } // reinicia se ainda não fechou I, II
    if (m[1] === ROM[e]) { ms.push({ r: m[1], ini: m.index, fim: m.index + m[0].length }); e++; }
  }
  if (ms.length < 2) return `<p>${esc(txt)}</p>`;
  const intro = txt.slice(0, ms[0].ini).trim();
  let resto = "";
  const itens = ms.map((x, k) => {
    let t = txt.slice(x.fim, k + 1 < ms.length ? ms[k + 1].ini : txt.length).trim();
    if (k === ms.length - 1) { const q = t.search(FIM_AFIRM); if (q > 0) { resto = t.slice(q).trim(); t = t.slice(0, q).trim(); } } // "Estão corretas..."
    return `<li><b>${x.r}.</b> ${esc(t)}</li>`;
  });
  return (intro ? `<p>${esc(intro)}</p>` : "") + `<ul class="afirm">${itens.join("")}</ul>` + (resto ? `<p>${esc(resto)}</p>` : "");
}

async function processarPDF(file) {
  const texto = await extrairTexto(file);
  ultimoTexto = texto;
  if (texto.replace(/\s/g, "").length < 50) throw new Error("o PDF não tem texto selecionável (parece escaneado/imagem) — seria necessário OCR.");
  const { g, pos } = extrairGabarito(texto);
  const questoes = dividirQuestoes(texto.slice(0, pos)).map((q) => parsearQuestao(q.n, q.bloco));
  return { id: Date.now() + Math.random().toString(36).slice(2, 6), nome: file.name.replace(/\.pdf$/i, ""), questoes, gabarito: g, respostas: {}, corrigidas: {}, paginas: ultimaLeitura.paginas };
}

// ---------- Interface ----------
const TAM = 20; // tamanho dos blocos (chips e gráfico por bloco)
const FILTROS = [["todas", "Todas"], ["nao", "Não resolvidas"], ["res", "Resolvidas"], ["erro", "Erradas"]];

// Estado: branco | pendente (marcada, ainda não corrigida) | acerto | erro | anulada
function status(L, q) {
  const m = L.respostas[q.num], c = L.gabarito[q.num];
  if (!m) return "branco";
  if (!L.corrigidas[q.num]) return "pendente";
  if (!c || c === "ANULADA") return "anulada";
  return m === c ? "acerto" : "erro";
}

// Questões exibidas conforme bloco (de/até) e filtro
function visiveis(L) {
  return L.questoes.filter((q) => {
    if (q.num < faixa.de || q.num > faixa.ate) return false;
    const s = status(L, q);
    return filtro === "todas" || (filtro === "nao" && s === "branco") ||
      (filtro === "res" && s !== "branco") || (filtro === "erro" && s === "erro");
  });
}

const seg = (c, t) => ["acerto", "erro", "pendente"].map((k) => `<i class="s-${k}" style="width:${(c[k] / t) * 100}%"></i>`).join("");
const contar = (L, qs) => { const c = { acerto: 0, erro: 0, pendente: 0, branco: 0, anulada: 0 }; qs.forEach((q) => c[status(L, q)]++); return c; };

// Relatório de desempenho (atualiza em tempo real)
const matHue = (i) => ((i < 0 ? 0 : i) * 53 + 262) % 360; // cor do avatar de cada matéria
function relatorio(L) {
  const total = L.questoes.length, c = contar(L, L.questoes);
  const corr = c.acerto + c.erro, pct = corr ? (c.acerto / corr) * 100 : 0;
  const pctTotal = (c.acerto / (total - c.anulada || 1)) * 100, resp = total - c.branco;
  const kpi = (cl, n, t) => `<div class="rp-k"><b>${n}</b><span><i class="dot ${cl}"></i>${t}</span></div>`;
  return `<details class="card rp" open><summary><b>Relatório de desempenho</b></summary>
    <div class="rp-top">
      <div class="rp-ring ${corr ? "" : "vazio"}" style="--p:${pct.toFixed(1)}"><div><b>${corr ? Math.round(pct) + "%" : "—"}</b><span>Aproveitamento</span></div></div>
      <div class="rp-kpis">${kpi("s-acerto", c.acerto, "Acertos")}${kpi("s-erro", c.erro, "Erros")}${kpi("s-pendente", c.pendente, "Aguardando correção")}${kpi("s-branco", c.branco, "Em branco")}</div>
    </div>
    <div class="rp-sec"><div class="rp-sh"><b>Progresso da lista</b><span>${resp} de ${total} respondidas</span></div>
      <div class="bar big">${seg(c, total)}</div></div>
    <div class="rp-foot"><p class="muted">Aproveitamento = acertos ÷ questões corrigidas (${corr}). Sobre o total da lista: ${pctTotal.toFixed(1)}%.</p>
      <button id="refazer">Refazer lista inteira</button></div></details>`;
}

function renderLista(L) {
  const total = L.questoes.length;
  if (!total) return '<p class="card">Não consegui identificar questões neste PDF (talvez seja escaneado).</p>';
  const temGab = Object.keys(L.gabarito).length > 0, maxN = L.questoes[total - 1].num;
  const vis = visiveis(L); exibidas = vis.map((q) => q.num); const pend = pendentesTela(L).length;

  let h = temGab ? "" : '<p class="card">⚠️ Gabarito não encontrado no final do PDF — a correção não será possível.</p>';
  h += `<div id="rel">${relatorio(L)}</div>`;

  // Filtros + blocos
  let chips = `<button class="chip ${faixa.de <= 1 && faixa.ate >= maxN ? "on" : ""}" data-de="1" data-ate="9999">Todos</button>`;
  for (let s = 1; s <= maxN; s += TAM) {
    const e = Math.min(s + TAM - 1, maxN);
    chips += `<button class="chip ${faixa.de === s && faixa.ate === e ? "on" : ""}" data-de="${s}" data-ate="${e}">${s}–${e}</button>`;
  }
  h += `<div class="filtros"><div class="chips">${FILTROS.map(([k, t]) => `<button class="chip ${filtro === k ? "on" : ""}" data-f="${k}">${t}</button>`).join("")}</div>
    <div class="chips"><span class="muted">Blocos:</span>${chips}</div>
    <div class="faixa">Da questão <input type="number" id="de" min="1" max="${maxN}" value="${faixa.de}"> até
    <input type="number" id="ate" min="1" max="${maxN}" value="${Math.min(faixa.ate, maxN)}"></div>
    <p class="muted">Exibindo ${vis.length} de ${total} questões</p></div>`;

  carregarCaderno(); const faltam = L.questoes.filter((q) => L.corrigidas && L.corrigidas[q.num] && status(L, q) === "erro" && !noCaderno(L.id + "|" + q.num)).length;
  if (faltam) h += `<div class="cd-lote"><span>${faltam} erro${faltam > 1 ? "s" : ""} desta lista ainda fora do caderno.</span><button type="button" data-cdlote="${esc(L.id)}">${SVG_CADERNO} Enviar todos</button></div>`;
  h += '<div class="qslides" id="qSlides">' + (vis.map((q) => {
    const s = status(L, q), marc = L.respostas[q.num], certa = L.gabarito[q.num];
    // Uma questão corrigida fica bloqueada até o usuário clicar em "↺ refazer".
    const bloqueada = !!(L.corrigidas && L.corrigidas[q.num]);
    const corr = bloqueada && ["acerto", "erro", "anulada"].includes(s);
    const fb = !corr ? "" : s === "acerto" ? `✅ Acertou! Gabarito: ${certa}` :
      s === "erro" ? `❌ Errou. Você marcou ${marc} — gabarito: ${certa}` : "Questão anulada / sem gabarito.";
    const cortadas = (L.riscadas && L.riscadas[q.num]) || "";
    const alts = Object.entries(q.alternativas).sort(([a], [b]) => a.localeCompare(b)).map(([k, t]) => {
      const cl = [cortadas.includes(k) ? "cut" : "", marc === k ? "sel" : "", corr && certa === k ? "certa" : "",
        corr && marc === k && certa && marc !== certa ? "errada" : ""].join(" ");
      return `<div class="altrow ${cl}"><label class="alt"><input type="radio" name="q${q.num}" value="${k}" data-q="${q.num}"
       ${marc === k ? "checked" : ""} ${bloqueada ? "disabled" : ""}><span class="letra">${k}</span><span class="atxt">${q.tipo === "CE" ? t : esc(limpar(t))}</span></label>
       ${bloqueada ? "" : `<button class="cut-btn" data-x="${q.num}|${k}" title="Riscar / desconsiderar">✂️</button>`}</div>`;
    }).join("");
    const hd = cabecalhoQuestao(q.enunciado), matNome = ((materias.find((m) => m.id === L.materia)) || {}).nome;
    const badges = [["banca", hd.banca], ["ano", hd.ano], ["orgao", hd.orgao], ["mat", matNome]].filter((b) => b[1])
      .map(([k, v]) => `<span class="badge ${k}">${esc(v)}</span>`).join("");
    return `<div class="card q ${{ acerto: "ok", erro: "err", pendente: "pend" }[s] || ""} ${marc && !bloqueada ? "marcada" : ""}" data-qn="${q.num}"><div class="qhead"><span class="qnum">Questão ${q.num}</span>
      <span class="qbtns"><button class="ia-btn" data-ia="${q.num}" title="Abre o DuckDuckGo Chat com o print da questão e o prompt de professor">Explicar com IA</button>${bloqueada ? `<button class="mini" data-rq="${q.num}">↺ refazer</button>` : ""}</span></div>
      <div class="badges">${badges}</div>
      <div class="enun">${enunciadoHTML(hd.resto, q.tabelas)}</div><div class="alts">${alts}</div>
      ${fb ? `<p class="fb">${fb}</p>` : ""}${corr && s === "erro" ? cadEnviarBtn(L.id + "|" + q.num) : ""}<div id="ia-${q.num}">${iaBolha(L, q)}</div></div>`;
  }).join("") || '<p class="muted">Nenhuma questão para este filtro/bloco.</p>') + '</div>';

  setTimeout(atualizarFab, 0);
  return h;
}


// ---------- Interface: abas de matérias + PDFs em linha ----------
let matFiltro = "";
function renderMaterias() { // lista vertical (sidebar no desktop / janela no celular), com busca
  const q = sem(matFiltro);
  const html = materias.filter((m) => !q || sem(m.nome).includes(q)).map((m) => {
    const n = listas.filter((l) => l.materia === m.id).length;
    return `<button class="mitem ${m.id === sel.materia && secao === "questoes" ? "on" : ""}" data-m="${m.id}"><span class="mdot2" style="--h:${hue(m.nome)}"></span><span class="mn">${esc(m.nome)}</span><span class="mc">${n}</span></button>`;
  }).join("") || '<p class="muted" style="padding:6px 8px">Nenhuma matéria.</p>';
  ["listaMaterias", "listaMaterias2"].forEach((id) => { const e = $(id); if (e) e.innerHTML = html; });
}

function render() {
  const y = scrollY, qc = $("qCorpo"), qy = qc ? qc.scrollTop : 0;
  materias.sort(alfa);
  if (!materias.some((m) => m.id === sel.materia)) sel.materia = materias[0]?.id || null;
  renderMaterias();
  renderPainel();
  scrollTo(0, y); if (qc) qc.scrollTop = qy;
}

// ---------- Lista de materiais (cards com progresso, taxa de acerto e menu ⋮) ----------
function mrowDados(l) {
  const t = l.questoes.length, c = contar(l, l.questoes), cor = c.acerto + c.erro, resp = t - c.branco;
  const pct = cor ? Math.round((c.acerto / cor) * 100) : null, pr = t ? Math.round((resp / t) * 100) : 0;
  const nivel = pct === null ? "na" : (t && resp / t < 0.1) ? "low" : pct >= 75 ? "hi" : pct >= 60 ? "mid" : "lo";
  return { t, resp, pct, pr, nivel };
}
function linhaMaterial(l) {
  const d = mrowDados(l);
  return `<div class="pdfrow mrow ${l.id === sel.lista ? "on" : ""}" data-l="${l.id}"><span class="mic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/></svg></span>
    <div class="mtx"><span class="nm">${esc(l.nome)}</span><div class="mprog"><div class="mbar"><i style="width:${d.pr}%"></i></div><span class="stat" data-stat="${l.id}">${d.resp}/${d.t}</span></div></div>
    <span class="mpct ${d.nivel}">${d.pct === null ? "—" : d.pct + "%"}</span>
    <div class="kwrap"><button type="button" class="kb" data-kb="${l.id}" title="Mais opções" aria-label="Mais opções"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg></button>
      <div class="kmenu"><button type="button" data-rn="${l.id}">${SVG_LAPIS}<span>Renomear</span></button><button type="button" class="dg" data-dl="${l.id}">${SVG_LIXO}<span>Excluir</span></button></div></div></div>`;
}
function resumoMateriais(ls) {
  let resp = 0, tot = 0, ac = 0, er = 0;
  ls.forEach((l) => { const c = contar(l, l.questoes); tot += l.questoes.length; resp += l.questoes.length - c.branco; ac += c.acerto; er += c.erro; });
  const cor = ac + er;
  return `<div class="mstats"><div><b>${ls.length}</b><span>Materiais</span></div><div><b>${resp}<i> de ${tot}</i></b><span>Questões respondidas</span></div><div><b>${cor ? Math.round((ac / cor) * 100) + "%" : "—"}</b><span>Taxa de acerto</span></div></div>`;
}
document.addEventListener("click", (e) => { // menu ⋮ das linhas
  const kb = e.target.closest("[data-kb]");
  document.querySelectorAll(".kwrap.kopen").forEach((w) => { if (!kb || w !== kb.closest(".kwrap")) w.classList.remove("kopen"); });
  if (kb) kb.closest(".kwrap").classList.toggle("kopen");
});

function renderPainel() {
  const el = $("painel"), m = materias.find((x) => x.id === sel.materia);
  if (!m) { el.innerHTML = `<div class="retomar vazio"><div><div class="rt-tit sm">Comece criando uma matéria</div><div class="rt-det">Crie a primeira matéria e depois envie o PDF da lista de questões.</div></div></div><p><button class="pri" data-novamat="1">Criar matéria</button></p>`; return; }
  const ls = listas.filter((l) => l.materia === m.id).sort(alfa); // ordem alfabética
  if (!ls.some((l) => l.id === sel.lista)) sel.lista = null;
  let h = `
    <div class="phead pbar"><div class="matsel"><div class="msd" id="msd"><select id="selMat" aria-label="Matéria" style="display:none">${materias.map((x) => `<option value="${x.id}" ${x.id === m.id ? "selected" : ""}>${esc(x.nome)}</option>`).join("")}</select>
      <button type="button" class="msd-btn" data-msd="toggle" aria-haspopup="listbox" aria-expanded="false"><span class="msd-av" style="--h:${matHue(materias.indexOf(m))}">${esc((m.nome || "?").trim().charAt(0).toUpperCase())}</span><span class="msd-txt"><small>Matéria</small><b>${esc(m.nome)}</b></span><svg class="msd-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
      <div class="msd-menu" role="listbox" hidden>${materias.map((x, i) => { const n = listas.filter((l) => l.materia === x.id).length; return `<button type="button" role="option" class="msd-it ${x.id === m.id ? "on" : ""}" data-msdv="${x.id}" aria-selected="${x.id === m.id}"><span class="msd-av" style="--h:${matHue(i)}">${esc((x.nome || "?").trim().charAt(0).toUpperCase())}</span><span class="msd-nm">${esc(x.nome)}</span><span class="msd-n">${n} ${n === 1 ? "lista" : "listas"}</span><svg class="msd-ok" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>`; }).join("")}</div></div><button data-novamat="1" title="Nova matéria" aria-label="Nova matéria"><svg class="svg-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div>
    <span class="rhbtns"><button data-rm="${m.id}" title="Renomear matéria" aria-label="Renomear matéria">${SVG_LAPIS}</button><button data-dm="${m.id}" title="Excluir matéria" aria-label="Excluir matéria">${SVG_LIXO}</button></span></div>
    <div class="upbar"><label class="upbtn"><svg class="svg-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 15v4a2 2 0 0 0 2 2h14"/></svg><span>Enviar PDF(s)</span><input type="file" id="pdf" accept="application/pdf" multiple></label>
      <div id="status" class="muted upstat" style="white-space:pre-wrap">${esc(statusImport)}</div></div>
    ${ultimoTexto && statusImport.includes("⚠️") ? `<details><summary>Ver texto lido do PDF</summary><pre class="rawtxt">${esc(ultimoTexto.slice(0, 4000))}</pre></details>` : ""}
    ${resumoMateriais(ls)}<div class="mhead"><b>Materiais</b><span class="count">${ls.length}</span></div><div class="mlist">` +
    (ls.map(linhaMaterial).join("") || '<p class="muted" style="margin:6px 0 0">Nenhum PDF ainda. Envie um acima.</p>') + "</div>";
  el.innerHTML = h;
  renderQuestoesDlg();
}

// ---------- Questões em janela sobreposta (abre ao clicar na apostila) ----------
function topoQuestoes(L) {
  const t = L.questoes.length, c = contar(L, L.questoes), cor = c.acerto + c.erro;
  $("qScore").innerHTML =
    `<div class="qs ok"><b>${c.acerto}</b><span>Acertos</span></div><div class="qs er"><b>${c.erro}</b><span>Erros</span></div>` +
    `<div class="qs br"><b>${c.branco}</b><span>Em branco</span></div><div class="qs pc"><b>${cor ? Math.round((c.acerto / cor) * 100) + "%" : "—"}</b><span>Aproveit.</span></div>`;
  $("qBar").innerHTML = t ? seg(c, t) : "";
  $("qResp").textContent = `${t - c.branco}/${t}`; $("qResp").title = "questões respondidas";
}
function renderQuestoesDlg() {
  const dq = $("dlgQuestoes"); if (!dq || !dq.open) return;
  const L = listaAtual(); if (!L) { dq.close(); return; }
  const m = materias.find((x) => x.id === L.materia);
  $("qMat").textContent = m ? m.nome : ""; $("qTitulo").textContent = L.nome;
  const _sl = document.getElementById("qSlides"), _ix = _sl ? Math.round(_sl.scrollLeft / (_sl.clientWidth || 1)) : 0;
  $("qLista").innerHTML = renderLista(L);
  { const s2 = document.getElementById("qSlides"); if (s2 && _ix) { s2.style.scrollBehavior = "auto"; s2.scrollLeft = _ix * s2.clientWidth; } }
  setTimeout(() => document.dispatchEvent(new Event("af:qslides")), 0);
  topoQuestoes(L);
}
function abrirQuestoes() { const dq = $("dlgQuestoes"); if (!dq.open) dq.showModal(); render(); }

// ---------- Conteúdo e Cronograma (salvos em users/{uid}/config/...) ----------
const R = (nome, material, detalhe = "") => ({ nome, material, detalhe });
const SEED_CONT = {
  regular: [R("Direito administrativo", "Apostila 8", "exercícios"), R("Contabilidade geral", "Apostila 15", "página 32"),
    R("Direito constitucional", "Apostila 9", "página 17"), R("Matemática financeira", "Apostila 3", "página 35"),
    R("Direito tributário", "Apostila 10", "página 14"), R("Português", "Apostila 2", "página 28"),
    R("Tecnologia da informação", "Apostila 1", "página 18"), R("Raciocínio lógico", "Aula 2"),
    R("Auditoria", "Apostila 2", "página 28"), R("Contabilidade pública", "Apostila 3", "página 8"),
    R("Estatística", "Apostila 2", "página 21"), R("Direito penal", "Apostila 1", "página 40"),
    R("Direito empresarial", "Apostila 1", "página 23")],
  passe: [R("Direito constitucional", "Apostila 4"), R("Contabilidade geral", "Apostila 8"),
    R("Direito tributário", "Apostila 6", "exercício 7"), R("Português", "Apostila 2")]
};
const SEED_CRON = { ativo: "c1", ciclos: [{ id: "c1", nome: "Ciclo 1", dias: {
  seg: ["Contabilidade geral", "Auditoria"], ter: ["Direito tributário"],
  qua: ["Direito administrativo", "Direito constitucional"], qui: ["Português"],
  sex: ["Tecnologia da informação"], sab: ["Estatística", "Matemática financeira", "Raciocínio lógico"], dom: [] } }] };
const DIAS = [["seg", "Segunda-feira"], ["ter", "Terça-feira"], ["qua", "Quarta-feira"], ["qui", "Quinta-feira"],
  ["sex", "Sexta-feira"], ["sab", "Sábado"], ["dom", "Domingo"]];
let conteudo = null, cron = null;
const cfgRef = (n) => doc(fs, "users", user.uid, "config", n);
const salvarConteudo = () => {
  const st = $("saveStatus"); if (st) st.textContent = "Salvando…";
  return setDoc(cfgRef("conteudo"), conteudo).then(() => { const e = $("saveStatus"); if (e) e.textContent = "✓ Salvo na nuvem"; }).catch(falha);
};
const salvarCron = () => { atualizarPerfil(); return setDoc(cfgRef("cronograma"), cron).catch(falha); };
const canon = (o) => JSON.stringify(o, (k, v) => v && typeof v === "object" && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v);

// Formata o texto de uma página de apostila: títulos, parágrafos, tópicos e tabelas HTML
function formatarPagina(linhas) {
  const ex = extrairTabelas(linhas.map((l) => l.t).join("\n"));
  const out = []; let par = [];
  const flush = () => { if (par.length) { out.push(`<p>${esc(par.join(" "))}</p>`); par = []; } };
  for (const raw of ex.texto.split("\n")) {
    const t = raw.trim(); if (!t) { flush(); continue; }
    const m = /^\[\[T(\d+)\]\]$/.exec(t);
    if (m) { flush(); out.push(tabelaHTML(ex.tabelas[+m[1]])); continue; }
    const letras = t.replace(/[^A-Za-zÀ-ú]/g, "").length || 1, maiusc = t.replace(/[^A-ZÀ-Ú]/g, "").length / letras;
    if (t.length > 2 && t.length <= 80 && !/[.;,:]$/.test(t) && (maiusc > 0.7 || /^(\d+(\.\d+)*[.)]?|cap[ií]tulo|aula|parte|item)\s+\S/i.test(t))) { flush(); out.push(`<h3>${esc(t)}</h3>`); continue; }
    if (/^[•●▪■◦\-–—]\s+/.test(t)) { flush(); out.push(`<p class="li">• ${esc(t.replace(/^[•●▪■◦\-–—]\s+/, ""))}</p>`); continue; }
    par.push(t);
    if (/[.!?:;]$/.test(t) && t.length < 60) flush();
  }
  flush();
  return out.join("");
}
let apPdf = null, apCtx = null, apAtiva = null; // apAtiva = id da apostila da biblioteca aberta no leitor
async function mostrarPaginaApostila(n) {
  if (!apPdf) return;
  if (apPdf.lib) return apOrig.on ? apOrigIr(n) : apLerDe(n);
  n = Math.min(Math.max(1, n || 1), apPdf.numPages);
  $("lPag").value = n; $("lPag").max = apPdf.numPages; $("lTotal").textContent = "/ " + apPdf.numPages;
  $("lCorpo").innerHTML = '<p class="muted">⏳ Lendo página…</p>';
  try {
    const linhas = apPdf.lib ? await apLinhasLib(n) : (await linhasDaPagina(await apPdf.getPage(n))).filter((l) => !LIXO.test(l.t));
    $("lCorpo").innerHTML = linhas.length ? formatarPagina(linhas) : '<p class="muted">Esta página não tem texto selecionável (pode ser imagem).</p>';
    $("lCorpo").scrollTop = 0;
    registrarProgresso({ tipo: "apostila", arquivo: (apArq && apArq.name) || "", titulo: $("lTitulo").textContent || "", pagina: n, total: apPdf.numPages,
      nome: (apMeta && apMeta.nome) || "", material: (apMeta && apMeta.material) || "", sec: (apMeta && apMeta.sec) || "", i: apMeta ? apMeta.i : -1,
      apostila: apAtiva || "" });
    apostilaPagina(n);
  } catch (e) { $("lCorpo").innerHTML = "❌ " + esc(e.message); }
}
async function abrirApostila(file, pag, titulo) {
  try {
    await garantirPdfjs();
    apPdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    apArq = file; apCache = {};
    $("lTitulo").textContent = titulo || file.name; $("lSub").textContent = "";
    apSyncFeito();
    $("dlgLeitor").showModal();
    mostrarPaginaApostila(pag || 1);
  } catch (e) { alert("Não foi possível abrir o PDF: " + e.message); }
}
$("lFechar").onclick = () => $("dlgLeitor").close();
$("lIA").onclick = () => formatarComGemini();
$("lPrev").onclick = () => mostrarPaginaApostila(+$("lPag").value - 1);
$("lNext").onclick = () => mostrarPaginaApostila(+$("lPag").value + 1);
$("lPag").onchange = () => mostrarPaginaApostila(+$("lPag").value);

// ---------- Leitura de PDF pelo Gemini (PDF em Base64 enviado à API) ----------
const paraBase64 = (file) => new Promise((ok, no) => {
  const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = () => no(new Error("Falha ao ler o arquivo")); r.readAsDataURL(file);
});
const bytesParaBase64 = (u8) => { let t = ""; for (let i = 0; i < u8.length; i += 0x8000) t += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(t); };
const MAX_PDF = 14 * 1024 * 1024; // envio direto: ~20 MB por requisição (Base64 aumenta 33%)

const SISTEMA_EXTRACAO = (inicio) => `Você é um extrator de dados de provas de concursos. Receberá um PDF (lista de questões, por exemplo do Estratégia Concursos) e deve devolver SOMENTE objetos JSON compactos, um por linha (JSON Lines), sem markdown, sem comentários e sem nenhum texto fora do JSON.

Formato:
{"tipo":"questao","numero":1,"banca":"FGV","ano":2022,"orgao":"SEFAZ-MG","enunciado":"...","alternativas":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"tabelas":[{"titulo":"Balanço Patrimonial","linhas":[["ATIVO"],["Caixa","1.000"],["Total","3.500"]]}],"gabarito":"B"}
e, ao terminar TODAS as questões do PDF, uma última linha: {"tipo":"fim"}

Regras:
- Extraia TODAS as questões em ordem crescente, começando exatamente pela questão número ${inicio}.
- Transcreva enunciados e alternativas fielmente, corrigindo apenas quebras de linha e hifenização do PDF. Mantenha afirmativas I., II., III., IV. dentro do enunciado, separadas por espaço. Remova rodapés, cabeçalhos, marcas d'água, links, numeração de página e assinaturas de professor.
- Questões Certo/Errado (sem alternativas A–E): use "alternativas":{} e gabarito "C" ou "E".
- Tabelas (balanço patrimonial, DRE, razonetes, quadros comparativos): coloque cada tabela em "tabelas" (cada linha é um array de células de texto; mantenha valores, sinais e parênteses exatamente como no PDF; títulos de seção como linha de uma só célula) e escreva o marcador [[T0]], [[T1]]... no ponto exato do enunciado em que a tabela aparece.
- "gabarito": use o gabarito oficial das páginas finais do PDF (letra A–E; C/E para Certo/Errado; "ANULADA" se anulada). Se não encontrar, use null. NÃO resolva a questão você mesmo.
- banca, ano e orgao: preencha a partir do cabeçalho da questão, se existir; senão null.
- Não invente nada. Se algo estiver ilegível, escreva [ilegível].`;

const SISTEMA_APOSTILA = `Você transcreve páginas de apostilas de concursos para HTML limpo e semântico. Responda SOMENTE com HTML, sem markdown e sem comentários.
Use apenas estas tags: h3, h4, p, ul, ol, li, strong, em, blockquote, table, thead, tbody, tr, th, td. Sem estilos, classes ou atributos.
Tabelas (balanço patrimonial, DRE, razonetes, quadros) devem virar <table> com cabeçalho e valores fiéis ao PDF. Preserve títulos, listas, destaques (strong), fórmulas em texto e exemplos numéricos.
Remova cabeçalhos, rodapés, marcas d'água, links e numeração de página. Não resuma, não explique e não acrescente nada.`;

// Extrai todos os objetos JSON de um texto (funciona com JSON em linhas, formatado ou truncado)
function objetosJson(t) {
  const out = []; let d = 0, ini = -1, str = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (str) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') str = false; continue; }
    if (ch === '"') { if (d > 0) str = true; continue; }
    if (ch === "{") { if (d === 0) ini = i; d++; }
    else if (ch === "}" && d > 0) { d--; if (d === 0) { try { out.push(JSON.parse(t.slice(ini, i + 1))); } catch (e) { /* objeto inválido: ignora */ } } }
  }
  return out;
}

function questaoDeIA(o) { // converte o JSON do Gemini no formato do app
  const nulo = (x) => (x == null || x === "null" || x === "" ? null : x);
  const cab = [nulo(o.banca), nulo(o.orgao), nulo(o.ano)].filter(Boolean).join(" / ");
  let enun = String(o.enunciado || "").replace(/\s+/g, " ").trim();
  if (cab && !/^\s*\(/.test(enun)) enun = `(${cab}) ${enun}`; // o cabeçalho vira as badges Banca/Ano/Órgão
  const alt = {};
  Object.entries(o.alternativas || {}).forEach(([k, v]) => { const L = String(k).trim().toUpperCase().charAt(0); if ("ABCDE".includes(L) && v != null) alt[L] = String(v).replace(/\s+/g, " ").trim(); });
  const me = Object.keys(alt).length >= 2;
  const tabelas = (o.tabelas || []).map((t) => {
    const linhas = (t.linhas || []).map((r) => ({ c: (Array.isArray(r) ? r : [r]).map((x) => String(x == null ? "" : x)) }));
    if (t.titulo) linhas.unshift({ c: [String(t.titulo)] });
    return { linhas };
  }).filter((t) => t.linhas.length);
  tabelas.forEach((t, i) => { if (!enun.includes(`[[T${i}]]`)) enun += ` [[T${i}]]`; });
  return { num: +o.numero, tipo: me ? "ME" : "CE", enunciado: enun,
    alternativas: me ? Object.fromEntries(Object.keys(alt).sort().map((k) => [k, alt[k]])) : { C: "Certo", E: "Errado" }, tabelas };
}

// Erros temporários do provedor (sobrecarga, limite, instabilidade) -> vale tentar de novo
const erroTemporario = (e) => [429, 500, 502, 503, 504].includes(e && e.status) || /high demand|overloaded|unavailable|try again later|resource.?exhausted/i.test(String(e && e.message || ""));
// Modelos reserva por provedor (usados só se o principal continuar falhando)
const MODELOS_RESERVA = {
  gemini: ["gemini-flash-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
  openai: ["gpt-4o-mini", "gpt-4o"],
  anthropic: ["claude-sonnet-4-5", "claude-haiku-4-5"]
};
async function chamarProvedor(c, sistema, usuario, pdfBase64, nomeArquivo, info) {
  const prov = c.prov || "gemini", principal = c.model || MODELOS[prov] || MODELOS.gemini;
  const modelos = [principal, ...(MODELOS_RESERVA[prov] || [])].filter((m, i, a) => m && a.indexOf(m) === i);
  const esperas = [2500, 6000]; // 1 tentativa + 2 novas por modelo
  let ultimo;
  for (let mi = 0; mi < modelos.length; mi++) {
    const modelo = modelos[mi];
    for (let t = 0; t <= esperas.length; t++) {
      try {
        return await chamarProvedorUnico({ ...c, model: modelo }, sistema, usuario, pdfBase64, nomeArquivo);
      } catch (e) {
        ultimo = e;
        const modeloInexistente = e.status === 404;
        if (modeloInexistente) break;                  // este modelo não existe: vai direto ao próximo
        if (!erroTemporario(e)) throw e;               // chave inválida, PDF grande demais etc.: não adianta repetir
        if (t < esperas.length) {
          if (info) info(`⏳ ${modelo} sobrecarregado. Nova tentativa em ${Math.round(esperas[t] / 1000)}s… (${t + 1}/${esperas.length})`);
          await esperar(esperas[t]);
        }
      }
    }
    if (mi < modelos.length - 1 && info) info(`🔁 Trocando para o modelo ${modelos[mi + 1]}…`);
  }
  throw ultimo || new Error("Falha ao consultar a IA.");
}

async function chamarProvedorUnico(c, sistema, usuario, pdfBase64, nomeArquivo) {
  const prov = c.prov || "gemini", modelo = c.model || MODELOS[prov] || MODELOS.gemini;
  const key = c.key || (c.keys && c.keys[prov]) || "";
  if (!key) throw new Error(`Configure a chave de API de ${prov === "openai" ? "OpenAI/ChatGPT" : prov === "anthropic" ? "Anthropic/Claude" : "Google Gemini"} em ⚙️ Configurar IA.`);
  let url, headers = { "content-type": "application/json" }, body;
  if (prov === "gemini") {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(key)}`;
    const parts = [{ text: usuario }];
    if (pdfBase64) parts.push({ inline_data: { mime_type: "application/pdf", data: pdfBase64 } });
    body = { system_instruction: { parts: [{ text: sistema }] }, contents: [{ role: "user", parts }], generationConfig: {} };
  } else if (prov === "openai") {
    url = "https://api.openai.com/v1/responses"; headers.authorization = `Bearer ${key}`;
    const content = [{ type: "input_text", text: usuario }];
    if (pdfBase64) content.push({ type: "input_file", filename: nomeArquivo || "apostila.pdf", file_data: `data:application/pdf;base64,${pdfBase64}` });
    body = { model: modelo, instructions: sistema, input: [{ role: "user", content }], temperature: 0.1 };
  } else if (prov === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers["x-api-key"] = key; headers["anthropic-version"] = "2023-06-01"; headers["anthropic-dangerous-direct-browser-access"] = "true";
    const content = [];
    if (pdfBase64) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } });
    content.push({ type: "text", text: usuario });
    body = { model: modelo, max_tokens: 8192, system: sistema, messages: [{ role: "user", content }], temperature: 0.1 };
  } else throw new Error("Provedor de IA não reconhecido.");
  const ctl = new AbortController(), timeout = setTimeout(() => ctl.abort(), pdfBase64 ? 400000 : 150000);
  try {
    const r = await fetch(url, { method: "POST", headers, signal: ctl.signal, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detalhe = j.error?.message || j.message || j.error || `HTTP ${r.status}`;
      const e = new Error(typeof detalhe === "string" ? detalhe : JSON.stringify(detalhe)); e.status = r.status; throw e;
    }
    let txt = "";
    if (prov === "gemini") txt = (j.candidates?.[0]?.content?.parts || []).map(x => x.text || "").join("\n");
    else if (prov === "openai") txt = j.output_text || (j.output || []).flatMap(x => x.content || []).map(x => x.text || "").join("\n");
    else txt = (j.content || []).filter(x => x.type === "text").map(x => x.text || "").join("\n");
    if (!txt) throw new Error("O provedor retornou uma resposta vazia.");
    return { txt, texto: txt, modelo: j.model || modelo, fim: "STOP" };
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Tempo esgotado ao aguardar a resposta da IA.");
    if (e instanceof TypeError) throw new Error("Falha de conexão com o provedor. Verifique a internet e as permissões de acesso à API (CORS).");
    throw e;
  } finally { clearTimeout(timeout); }
}

async function geminiStream(modelo, sistema, b64, usuario, key, onTexto) {
  const r = await chamarProvedor({ ...cfgIA(), prov: "gemini", model: modelo, key }, sistema, usuario, b64, "questoes.pdf");
  if (onTexto) onTexto(r.txt); return { texto: r.txt, fim: "STOP", modelo };
}

async function streamComCadeia(c, sistema, b64, usuario, info, onTexto, nomeArquivo) {
  const r = await chamarProvedor(c, sistema, usuario, b64, nomeArquivo || "questoes.pdf", info);
  if (onTexto) onTexto(r.txt); return { texto: r.txt, fim: r.fim || "STOP", modelo: r.modelo };
}

async function processarPDFComIA(file, c, info) {
  if (file.size > MAX_PDF) throw new Error("o PDF passa de ~14 MB (limite de envio direto à API)");
  info("📤 Preparando o PDF…");
  const b64 = await paraBase64(file);
  const mapa = new Map(), gab = {}; let fim = false, modelo = ""; c = { ...c };
  for (let passo = 0; passo < 8 && !fim; passo++) {
    const inicio = mapa.size ? Math.max(...mapa.keys()) + 1 : 1, antes = mapa.size;
    const r = await streamComCadeia(c, SISTEMA_EXTRACAO(inicio), b64, `Analise o PDF anexo e extraia as questões conforme as instruções, a partir da questão ${inicio}.`, info,
      (txt) => info(`🤖 ${c.prov === "openai" ? "ChatGPT" : c.prov === "anthropic" ? "Claude" : "Gemini"} lendo o PDF… ${antes + (txt.match(/"tipo"\s*:\s*"questao"/g) || []).length} questões`));
    modelo = r.modelo; c.model = r.modelo;
    for (const o of objetosJson(r.texto)) {
      if (o.tipo === "fim") fim = true;
      else if (o.tipo === "questao" && +o.numero >= inicio && !mapa.has(+o.numero)) {
        const q = questaoDeIA(o); mapa.set(q.num, q);
        const g = o.gabarito == null ? null : norm(String(o.gabarito).trim());
        if (g && (/^[A-E]$/.test(g) || g === "ANULADA")) gab[q.num] = g;
      }
    }
    if (!fim && mapa.size === antes) throw new Error(passo === 0 ? "o Gemini não retornou nenhuma questão" : "o Gemini parou de retornar questões");
    if (!fim) info(`🤖 Continuando a partir da questão ${Math.max(...mapa.keys()) + 1}…`);
  }
  if (!mapa.size) throw new Error("nenhuma questão encontrada");
  const questoes = [...mapa.values()].sort((a, b) => a.num - b.num);
  return { id: Date.now() + Math.random().toString(36).slice(2, 6), nome: file.name.replace(/\.pdf$/i, ""), questoes, gabarito: gab, respostas: {}, corrigidas: {}, paginas: null, leitor: modelo };
}

const modoLeitor = () => "local"; // leitor de IA removido: o PDF é lido direto
async function lerPDF(f, info, forcarLocal) { // Gemini primeiro; se não der, cai para o leitor local
  const c = cfgIA();
  if (!forcarLocal && modoLeitor() === "ia" && c.key) {
    try {
      return await processarPDFComIA(f, c, info);
    } catch (e) {
      statusImport += `⚠️ A IA (${c.prov || "Gemini"}) não conseguiu ler ${f.name} (${e.message}). Usando o leitor local…\n`;
    }
  }
  return processarPDF(f);
}

// ---------- Apostilas: recorte de páginas + transcrição pelo Gemini ----------
async function garantirPdfLib() {
  if (window.PDFLib) return;
  for (const u of ["https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js", "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js"]) {
    try { await carregarScript(u); if (window.PDFLib) return; } catch (e) { /* tenta o próximo */ }
  }
  throw new Error("não foi possível carregar a biblioteca de recorte de PDF");
}
async function recortarPDF(file, de, ate) { // devolve um PDF só com as páginas pedidas (em Base64)
  await garantirPdfLib();
  const src = await PDFLib.PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true }), dst = await PDFLib.PDFDocument.create();
  const idx = []; for (let i = de - 1; i < ate; i++) idx.push(i);
  (await dst.copyPages(src, idx)).forEach((pg) => dst.addPage(pg));
  return bytesParaBase64(await dst.save());
}
// Sanitiza o HTML devolvido pela IA: só tags conhecidas, sem atributos (tabelas ganham o invólucro responsivo)
function sanitizarHTML(h) {
  const ok = new Set(["h3", "h4", "p", "ul", "ol", "li", "strong", "em", "blockquote", "table", "thead", "tbody", "tr", "th", "td", "br"]);
  return String(h).replace(/^\s*```(?:html)?/i, "").replace(/```\s*$/, "").split(/(<\/?[a-zA-Z][^<>]*>)/).map((part, i) => {
    if (i % 2 === 0) return part.replace(/</g, "&lt;").replace(/>/g, "&gt;"); // texto
    const m = /^<(\/?)([a-zA-Z0-9]+)([^>]*)>$/.exec(part);
    const tag = m[2].toLowerCase();
    if (!ok.has(tag)) return "";
    if (m[1]) return tag === "table" ? "</table></div>" : `</${tag}>`;
    if (tag === "table") return '<div class="tblwrap"><table class="qtab">';
    const span = /\bcolspan\s*=\s*["']?(\d{1,2})/i.exec(m[3]);
    return `<${tag}${span && (tag === "td" || tag === "th") ? ` colspan="${span[1]}"` : ""}>`;
  }).join("");
}
let apArq = null, apCache = {};
async function formatarComGemini() {
  const c = cfgIA();
  if (apPdf && apPdf.lib) return formatarLibIA();
  if (!apPdf || !apArq) return;
  const de = +$("lPag").value || 1, ate = Math.min(apPdf.numPages, de + (+$("lQtd").value || 3) - 1), k = `${c.prov || "gemini"}|${c.model || ""}|${de}-${ate}`;
  const corpo = $("lCorpo");
  if (apCache[k]) { corpo.innerHTML = apCache[k]; return; }
  const nomeIA = c.prov === "openai" ? "ChatGPT" : c.prov === "anthropic" ? "Claude" : "Gemini";
  corpo.innerHTML = `<p class="muted">🤖 ${nomeIA} lendo as páginas ${de} a ${ate}…</p>`;
  try {
    let b64;
    try { b64 = await recortarPDF(apArq, de, ate); }
    catch (e) { if (apArq.size > MAX_PDF) throw e; b64 = await paraBase64(apArq); }
    const r = await chamarProvedor(c, SISTEMA_APOSTILA, `Transcreva para HTML as páginas ${de} a ${ate} do PDF anexo (se o PDF anexo tiver só essas páginas, transcreva todas).`, b64, apArq.name);
    apCache[k] = `<div class="gemhtml">${sanitizarHTML(r.txt)}</div><p class="muted">Páginas ${de}–${ate} · transcrito por ${esc(r.modelo)}</p>`;
    corpo.innerHTML = apCache[k];
  } catch (e) { corpo.innerHTML = `<p>❌ ${esc(e.message)}</p>`; }
}

function mostrarSecao(sec) {
  secao = sec; saveUi();
  ["questoes", "diagnostico", "caderno", "conteudo", "cronograma"].forEach((k) => { $("sec" + k[0].toUpperCase() + k.slice(1)).hidden = k !== sec; });
  document.querySelectorAll(".mi").forEach((b) => b.classList.toggle("on", b.dataset.sec === sec));
  if (sec === "questoes") render(); else if (sec === "diagnostico") renderDiag(); else if (sec === "caderno") renderCaderno(); else if (sec === "conteudo") renderConteudo(); else renderCron();
}

// ---------- Diagnóstico por matéria + Explicar com IA ----------
const MIN = 5; // mínimo de questões corrigidas para o diagnóstico ser considerado confiável
const sem = (t) => (t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const fmtAp = (r) => esc(r.material || "—") + (r.detalhe ? ` (${esc(r.detalhe)})` : "");

function statsMateria(m) { // acertos/erros nas questões corrigidas de todas as listas da matéria
  let ac = 0, er = 0, resp = 0, tot = 0;
  listas.filter((l) => l.materia === m.id).forEach((l) => {
    const c = contar(l, l.questoes); ac += c.acerto; er += c.erro; resp += l.questoes.length - c.branco; tot += l.questoes.length;
  });
  return { ac, er, resp, tot, corr: ac + er, pct: ac + er ? (ac / (ac + er)) * 100 : null };
}

function diagLinhas() { // cruza matérias das Questões com as apostilas cadastradas em Conteúdo (pelo nome)
  const mapa = new Map();
  const get = (nome) => { const k = sem(nome); if (!mapa.has(k)) mapa.set(k, { nome, st: null, reg: [], pas: [] }); return mapa.get(k); };
  materias.forEach((m) => { const e = get(m.nome); e.st = statsMateria(m); e.m = m; });
  ((conteudo && conteudo.regular) || []).forEach((r) => get(r.nome).reg.push(r));
  ((conteudo && conteudo.passe) || []).forEach((r) => get(r.nome).pas.push(r));
  return [...mapa.values()];
}

function nivel(x) {
  const st = x.st;
  if (!st || st.corr < MIN) return { k: "nd", ic: "⚪", txt: st && st.corr ? `Poucos dados (${st.corr} corrigidas)` : "Sem questões corrigidas" };
  if (st.pct < 60) return { k: "alto", ic: "🔴", txt: "Revisar com prioridade" };
  if (st.pct < 75) return { k: "med", ic: "🟡", txt: "Atenção" };
  return { k: "ok", ic: "🟢", txt: "Bom desempenho" };
}

const diasDe = (nome) => {
  if (!cron) return "";
  const c = cicloAtivo();
  return DIAS.filter(([k]) => ((c.dias && c.dias[k]) || []).some((n) => sem(n) === sem(nome))).map(([, d]) => d.slice(0, 3)).join(", ");
};

const numLista = (nome) => { const m = /(?:aula|apostila|pdf|lista|cap[ií]tulo)\D{0,3}(\d+)/i.exec(nome || ""); return m ? +m[1] : null; };
const numDe = (t) => { const m = /(\d+)/.exec(t || ""); return m ? +m[1] : null; };
const statsLista = (l) => { const c = contar(l, l.questoes), corr = c.acerto + c.erro; return { ac: c.acerto, er: c.erro, resp: l.questoes.length - c.branco, tot: l.questoes.length, pct: corr ? (c.acerto / corr) * 100 : null }; };
const corNivel = (p) => (p === null ? "nd" : p < 60 ? "alto" : p < 75 ? "med" : "ok");

function diagHTML() {
  if (!conteudo) return "";
  const linhas = diagLinhas().map((x) => ({ ...x, nv: nivel(x) }));
  const comDados = linhas.filter((x) => x.st && x.st.corr >= MIN).sort((a, b) => a.st.pct - b.st.pct); // piores primeiro
  const resto = linhas.filter((x) => !(x.st && x.st.corr >= MIN)).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const ap = (x) => [...x.reg.map((r) => `📘 ${fmtAp(r)}`), ...x.pas.map((r) => `⭐ Passe: ${fmtAp(r)}`)].join(" · ") || "sem apostila cadastrada (cadastre em Conteúdo)";
  const alerta = comDados.filter((x) => x.st.pct < 75), foco = alerta.slice(0, 3);
  const comSt = linhas.filter((x) => x.st);
  const tAc = comSt.reduce((a, x) => a + x.st.ac, 0), tEr = comSt.reduce((a, x) => a + x.st.er, 0), geral = tAc + tEr ? (tAc / (tAc + tEr)) * 100 : null;
  const tiles = `<div class="stats dtiles"><div><b>${comSt.length}</b>Matérias</div><div><b>${tAc + tEr}</b>Corrigidas</div>
    <div><b>${geral === null ? "—" : geral.toFixed(0) + "%"}</b>Acerto geral</div><div><b>${alerta.length}</b>Em alerta</div></div>`;
  const topo = foco.length
    ? `<div class="foco"><b>Foco da semana: revise primeiro</b>` + foco.map((x) => {
        const dd = diasDe(x.nome);
        return `<div class="focoitem ${x.nv.k}"><b>${esc(x.nome)}</b> — ${x.st.pct.toFixed(0)}% de acerto<br><span>📖 ${ap(x)}</span>${dd ? `<br><span>📅 No cronograma: ${dd}</span>` : ""}</div>`;
      }).join("") + "</div>"
    : comDados.length ? '<div class="foco ok">🎉 Todas as matérias com dados estão com 75% ou mais. Continue assim!</div>'
    : `<div class="foco nd">Resolva e corrija pelo menos ${MIN} questões de uma matéria (aba Questões) para gerar o diagnóstico.</div>`;
  const card = (x) => {
    const st = x.st, p = st && st.corr ? st.pct : null, tot = st ? st.corr : 0, C = 2 * Math.PI * 30, dash = tot ? st.ac / tot * C : 0;
    const donut = `<svg class="dgraf" viewBox="0 0 76 76" role="img" aria-label="${p === null ? "Sem dados" : p.toFixed(0) + "% de acerto"}"><circle cx="38" cy="38" r="30" fill="none" stroke="${tot ? "#e5586a" : "var(--line)"}" stroke-opacity="${tot ? ".3" : "1"}" stroke-width="9"/>${tot ? `<circle cx="38" cy="38" r="30" fill="none" stroke="${COR_NV[x.nv.k]}" stroke-width="9" stroke-linecap="round" data-dash="${dash.toFixed(1)} ${C.toFixed(1)}" stroke-dasharray="0 ${C.toFixed(1)}" transform="rotate(-90 38 38)"/>` : ""}<text x="38" y="43" text-anchor="middle">${p === null ? "—" : p.toFixed(0) + "%"}</text></svg>`;
    return `<div class="drow ${x.nv.k}" data-dk="${esc(x.nome)}" role="button" tabindex="0" aria-label="Ver estatísticas de ${esc(x.nome)}">${donut}<div class="dinfo"><b>${esc(x.nome)}</b><span class="nvb"><i class="ndot ${x.nv.k}"></i>${x.nv.txt}</span><div class="muted">${p === null ? "Sem questões corrigidas" : `${st.ac} acertos / ${st.er} erros`}${st ? ` · ${st.resp}/${st.tot} respondidas` : ""}</div></div><span class="dgo" aria-hidden="true">${SVG_SETA}</span></div>`;
  };
  return tiles + (comDados.length ? "" : topo) + `<div class="dlist big">${[...comDados, ...resto].map(card).join("")}</div>`;
}
function renderDiag() {
  const el = $("secDiagnostico");
  if (!conteudo) { el.innerHTML = '<p class="muted">Carregando...</p>'; return; }
  el.innerHTML = `<div class="ctop"><div><h2>Diagnóstico</h2><p class="muted">Toque em uma disciplina para ver as estatísticas dela.</p></div></div>` + diagHTML();
  document.dispatchEvent(new CustomEvent("af:render", { detail: { secao: "diagnostico", el } }));
}
const COR_NV = { ok: "#2bb283", med: "#f0952a", alto: "#e5586a", nd: "#94a3b8" };
function abrirEstat(nome) {
  const x = diagLinhas().map((y) => ({ ...y, nv: nivel(y) })).find((y) => y.nome === nome); if (!x) return;
  const st = x.st || { ac: 0, er: 0, resp: 0, tot: 0, corr: 0, pct: null }, p = st.corr ? st.pct : null, C = 2 * Math.PI * 52;
  const ls = (x.m ? listas.filter((l) => l.materia === x.m.id) : []).sort(alfa);
  const lrows = ls.map((l) => { const t = statsLista(l);
    return `<div class="eg-mrow"><div class="eg-mtop"><span>${esc(l.nome)}</span><span><b>${t.pct === null ? "—" : t.pct.toFixed(0) + "%"}</b><i style="color:${COR_NV[corNivel(t.pct)]}">${t.ac}/${t.ac + t.er}</i></span></div><div class="eg-track"><div style="width:${t.pct === null ? 0 : t.pct}%;background:${COR_NV[corNivel(t.pct)]}"></div></div></div>`; }).join("");
  carregarCaderno();
  const erros = errosCaderno().filter((e) => sem(e.nomeMat || "") === sem(nome)), cont = {}; let sm = 0;
  erros.forEach((e) => { const k = (cadernoEstado.motivos || {})[e.id]; if (k) cont[k] = (cont[k] || 0) + 1; else sm++; });
  const maxM = Math.max(1, sm, ...Object.values(cont));
  const mrows = erros.length ? [...MOTIVOS.map(([k, t]) => [t, cont[k] || 0, MOT_COR[k]]), ["Sem motivo", sm, "#64748b"]].filter((m) => m[1]).map(([t, n, c]) => `<div class="motbar" style="--mc:${c};cursor:default"><span class="mt">${t}</span><span class="mtr"><i style="width:${n / maxM * 100}%"></i></span><b>${n}</b></div>`).join("") : "";
  const rv = estudos().filter((e) => sem(e.materia || "") === sem(nome)), venc = rv.filter((e) => e.prox <= isoHoje()).length;
  const ap = [...x.reg.map((r) => fmtAp(r)), ...x.pas.map((r) => "Passe: " + fmtAp(r))].join(" · ");
  let d = $("dlgEstat"); if (!d) { d = document.createElement("dialog"); d.id = "dlgEstat"; d.className = "dlg-estat"; document.body.appendChild(d); d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-estat-fechar]")) d.close(); }); }
  d.innerHTML = `<div class="estat"><div class="estat-h"><div><h3>${esc(nome)}</h3><span class="nvb"><i class="ndot ${x.nv.k}"></i>${x.nv.txt}</span></div><button type="button" class="estat-x" data-estat-fechar="1" aria-label="Fechar"><svg class="svg-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="estat-top"><svg class="estat-anel" viewBox="0 0 120 120" role="img" aria-label="${p === null ? "Sem dados" : p.toFixed(0) + "% de acerto"}"><circle cx="60" cy="60" r="52" fill="none" stroke="${st.corr ? "#e5586a" : "var(--line)"}" stroke-opacity="${st.corr ? ".3" : "1"}" stroke-width="11"/>${st.corr ? `<circle cx="60" cy="60" r="52" fill="none" stroke="${COR_NV[x.nv.k]}" stroke-width="11" stroke-linecap="round" stroke-dasharray="${(st.ac / st.corr * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 60 60)"/>` : ""}<text x="60" y="68" text-anchor="middle">${p === null ? "—" : p.toFixed(0) + "%"}</text></svg>
      <div class="estat-tiles"><div><b>${st.ac}</b><small>acertos</small></div><div><b>${st.er}</b><small>erros</small></div><div><b>${st.resp}/${st.tot}</b><small>respondidas</small></div><div><b>${venc}</b><small>revisões hoje</small></div></div></div>
    ${lrows ? `<h4>Acerto por lista</h4>${lrows}` : ""}
    ${mrows ? `<h4>Por que eu erro</h4>${mrows}` : ""}
    ${ap ? `<h4>Apostilas</h4><p class="muted" style="margin:0">${esc(ap)}</p>` : ""}
    <div class="estat-ac">${x.m ? `<button type="button" class="pri" data-estat-ir="questoes" data-mat="${esc(x.m.id)}">Abrir questões</button>` : ""}<button type="button" data-estat-ir="caderno" data-nome="${esc(nome)}">Ver erros no caderno</button></div></div>`;
  d.showModal();
}
const atualizarDiag = () => { if (secao === "diagnostico") renderDiag(); };

function aviso(msg) {
  document.querySelectorAll(".toast").forEach((t) => t.remove()); // um aviso por vez, sem empilhar
  const el = document.createElement("div"); el.className = "toast"; el.textContent = msg; el.setAttribute("role", "status");
  const ab = document.querySelectorAll("dialog[open]"); (ab.length ? ab[ab.length - 1] : document.body).appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("on")));
  setTimeout(() => { el.classList.remove("on"); setTimeout(() => el.remove(), 180); }, 3500);
}

// Prompt para o ChatGPT: professor de Direito Tributário/Contabilidade/Legislação fiscal, banca FGV
const SISTEMA_IA = `Você é um professor sênior e mentor de elite da área fiscal (Direito Tributário, Contabilidade e Legislação tributária/financeira), com profundo e absoluto domínio das características, do estilo, do perfil de cobrança e do histórico da banca FGV, especialmente nas provas de Auditor Fiscal das Secretarias de Fazenda (SEFAZ).

Analise a questão que o aluno enviar e responda em português do Brasil, de forma clara, didática e cirúrgica, usando EXATAMENTE esta estrutura (títulos em markdown com ###):

### ✅ Gabarito comentado
Indique a alternativa correta e explique o fundamento central.

### 🔍 Análise das alternativas
Para cada alternativa, diga em uma ou duas frases por que está certa ou errada.

### ⚠️ Pegadinhas da FGV
Destaque EXPLICITAMENTE as armadilhas deste enunciado e das alternativas, e as pegadinhas que a FGV costuma usar nesse tema para confundir o candidato (palavras absolutas como "sempre", "apenas", "somente"; inversão de sujeito ou de regra e exceção; institutos parecidos trocados; prazos, percentuais e competências; jurisprudência aplicada fora do contexto; texto de lei quase igual ao correto).

### 📊 Recorrência e importância
Classifique o assunto como Baixa, Média, Alta ou Altíssima recorrência nas provas de Auditor Fiscal/SEFAZ e justifique em poucas linhas. Trate como estimativa baseada no padrão da banca; não invente estatísticas exatas.

### 💡 Exemplo prático
Um caso concreto e curto que fixe o conceito.

### 📚 Base legal e jurisprudência
Cite as leis de regência, o CTN, a CF/88, leis complementares, normas contábeis (CPC, NBC, Lei 6.404/76, MCASP, conforme o caso), súmulas e julgados do STF/STJ aplicáveis.

### 🧠 Dica de memorização
Um macete curto.

Regras: não invente artigos, números de leis, súmulas ou julgados; se não tiver certeza, escreva "confirme na legislação". Se o gabarito oficial informado divergir da sua análise, aponte a divergência e explique (possível desatualização legislativa ou anulação). Se o aluno errou, explique o raciocínio que provavelmente o levou ao erro. Seja objetivo e evite enrolação.`;

function dadosQuestao(L, q) {
  const mat = ((materias.find((m) => m.id === L.materia)) || {}).nome || "";
  const ce = q.tipo === "CE", nomeR = (r) => (!r ? "" : ce ? (r === "C" ? "Certo" : r === "E" ? "Errado" : r) : r);
  const alts = ce ? "Julgue: Certo ou Errado." : Object.entries(q.alternativas).sort(([a], [b]) => a.localeCompare(b)).map(([k, t]) => `${k}) ${limpar(t)}`).join("\n");
  const marc = L.respostas[q.num], certa = L.gabarito[q.num], temGab = certa && certa !== "ANULADA";
  const situ = marc && temGab ? (marc === certa
    ? "Eu ACERTEI: confirme se o meu raciocínio faz sentido e aprofunde o tema."
    : "Eu ERREI: explique onde está o erro e a armadilha que provavelmente me levou a essa alternativa.") : "";
  return `Matéria: ${mat || "não informada"}
Questão ${q.num}:
${enunciadoTexto(q)}

${alts}

Minha resposta: ${nomeR(marc) || "não respondi"}
Gabarito oficial: ${temGab ? nomeR(certa) : "não informado"}
${situ}`.trim();
}
const promptIA = (L, q) => SISTEMA_IA + "\n\n---\n\n" + dadosQuestao(L, q); // versão única (link do ChatGPT / cópia)

function explicarIA(L, q) { // abre o ChatGPT em nova aba (e copia o prompt como garantia)
  const txt = promptIA(L, q), url = "https://chatgpt.com/?q=" + encodeURIComponent(txt), longo = url.length > 6500;
  window.open(longo ? "https://chatgpt.com/" : url, "_blank", "noopener");
  if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {});
  aviso(longo ? "Prompt copiado! Cole no ChatGPT." : "Abrindo o ChatGPT… (o prompt também foi copiado)");
}

// ---------- Explicar com IA → DuckDuckGo Chat (nova aba): print da questão + prompt de professor ----------
let h2cP = null;
function garantirH2C() { // carrega o html2canvas só quando preciso
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  return h2cP = h2cP || new Promise((ok, no) => {
    const sc = document.createElement("script"); sc.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    sc.onload = () => ok(window.html2canvas); sc.onerror = () => { h2cP = null; no(new Error("html2canvas não carregou")); };
    document.head.appendChild(sc);
  });
}
async function printQuestao(q, alvo) { // devolve um Blob PNG do cartão da questão (sem botões e sem a explicação)
  const el = alvo || document.querySelector(`#dlgQuestoes .card.q[data-qn="${q.num}"]`); if (!el) throw new Error("questão não encontrada");
  const h2c = await garantirH2C();
  const cv = await h2c(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false,
    ignoreElements: (n) => n.classList && (n.classList.contains("qbtns") || n.id === "ia-" + q.num) });
  return new Promise((ok, no) => cv.toBlob((b) => (b ? ok(b) : no(new Error("sem imagem"))), "image/png"));
}
function explicarDuck(L, q, alvo) {
  const txt = promptIA(L, q);
  // O prompt vai preenchido pela própria URL do DuckDuckGo (nenhum site consegue "colar" dentro de outro).
  const url = "https://duckduckgo.com/?q=" + encodeURIComponent(txt) + "&ia=chat&bang=1";
  const cabe = url.length <= 7000;
  window.open(cabe ? url : "https://duckduckgo.com/?q=DuckDuckGo+AI+Chat&ia=chat&duckai=1", "_blank", "noopener"); // precisa ser aqui, direto no toque
  const soTexto = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {});
    aviso(cabe ? "Prompt enviado ao DuckDuckGo. (O print não pôde ser copiado.)" : "Prompt copiado! Cole no chat do DuckDuckGo.");
  };
  if (navigator.clipboard && window.ClipboardItem) {
    // prompt preenchido pela URL: na área de transferência vai só o print (Ctrl+V no chat). Se o prompt for longo demais, vai texto + print.
    const itens = cabe ? { "image/png": printQuestao(q, alvo) } : { "text/plain": new Blob([txt], { type: "text/plain" }), "image/png": printQuestao(q, alvo) };
    navigator.clipboard.write([new ClipboardItem(itens)])
      .then(() => aviso(cabe ? "Prompt já preenchido no DuckDuckGo. Print copiado: cole com Ctrl+V se quiser anexar." : "Print e prompt copiados! Cole no chat do DuckDuckGo."))
      .catch(soTexto);
  } else soTexto();
}

async function renomearLista(id) {
  const l = listas.find((x) => x.id === id); if (!l) return;
  const nome = ((await uiPrompt("Renomear arquivo", l.nome, { ok: "Salvar", msg: "Digite o novo nome do arquivo." })) || "").trim();
  if (!nome || nome === l.nome) return;
  l.nome = nome;                                         // atualiza na tela já…
  updateDoc(ref("listas", id), { nome }).catch(falha);   // …e salva na nuvem
  render();                                              // reordena (alfabética)
}

// ---------- Explicação com IA direto na tela (chave de API só neste aparelho) ----------
const cfgIA = () => {
  try {
    const c = JSON.parse(localStorage.getItem("ia_cfg") || '{"prov":"gemini","model":"","keys":{}}');
    c.keys = c.keys || {};
    // Atualiza automaticamente configurações antigas do Gemini.
    if (c.prov === "gemini" && (!c.model || /^gemini-2\.5-flash(?:$|-)/i.test(c.model))) {
      c.model = MODELOS.gemini;
      try { localStorage.setItem("ia_cfg", JSON.stringify(c)); } catch (_) {}
    }
    c.key = c.keys[c.prov] || c.key || "";
    return c;
  } catch (e) { return { prov: "gemini", model: "", keys: {}, key: "" }; }
};
const MODELOS = { gemini: "gemini-3.8-flash", openai: "gpt-4o-mini", anthropic: "claude-sonnet-4-5" };
const iaSt = {}; // estado dos balões: chave "listaId|nº" -> { open, estado, msg }
const mdLite = (t) => esc(t).replace(/^#{1,4}\s*(.+)$/gm, "<h4>$1</h4>").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/^\s*[-*]\s+/gm, "• ");

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function geminiUma(modelo, sistema, usuario, key, pdf) {
  return (await chamarProvedor({ ...cfgIA(), prov: "gemini", model: modelo, key }, sistema, usuario, pdf, "documento.pdf")).txt;
}
async function gemini(c, sistema, usuario, info, pdf) {
  if (info) info("🔐 Enviando a solicitação ao provedor configurado…");
  const r = await chamarProvedor(c, sistema, usuario, pdf, "documento.pdf", info);
  return { txt: r.txt, modelo: r.modelo };
}
async function chamarIA(sistema, usuario, c, info) {
  if (info) info("🔐 Enviando a solicitação ao provedor configurado…");
  const r = await chamarProvedor(c, sistema, usuario, null, null, info);
  return { txt: r.txt, modelo: r.modelo };
}

// Divide a resposta em seções (### títulos) para o cartão do professor
function medidor(k, corpo) { // barra de incidência do tema (Baixa → Altíssima)
  if (k !== "info") return "";
  const m = /(alt[ií]ssima|alta|m[eé]dia|baixa)/i.exec(corpo); if (!m) return "";
  const w = m[1].toLowerCase(), lv = w.includes("ss") ? 4 : w === "alta" ? 3 : w.startsWith("m") ? 2 : 1;
  return `<div class="inc l${lv}"><span class="mt"><i></i><i></i><i></i><i></i></span><b>Incidência: ${["", "Baixa", "Média", "Alta", "Altíssima"][lv]}</b></div>`;
}
function mdSecoes(t) {
  const partes = t.split(/^#{1,4}[ \t]*/m);
  const intro = /^\s*#/.test(t) ? "" : partes.shift();
  const sec = partes.filter((x) => x.trim()).map((p) => {
    const i = p.indexOf("\n"), tit = (i < 0 ? p : p.slice(0, i)).trim(), corpo = i < 0 ? "" : p.slice(i + 1).trim();
    const k = /pegadinha/i.test(tit) ? "warn" : /gabarito/i.test(tit) ? "ok" : /recorr/i.test(tit) ? "info" : /base legal|jurisprud/i.test(tit) ? "law" : "";
    return `<section class="isec ${k}"><h4>${esc(tit)}</h4>${medidor(k, corpo)}<div class="isb">${mdLite(corpo)}</div></section>`;
  }).join("");
  return (intro && intro.trim() ? `<div class="isb">${mdLite(intro.trim())}</div>` : "") + sec;
}

// Balão exibido logo abaixo da questão
function iaBolha(L, q) {
  const e = iaSt[L.id + "|" + q.num];
  if (!e || !e.open) return "";
  const corpo = e.estado === "carregando" ? `<div class="isb muted">⏳ ${esc(e.info || "O professor está analisando a questão…")}</div>`
    : e.estado === "semchave" ? '<div class="isb">Para gerar a explicação aqui dentro do app, configure sua chave de API em <b>⚙️</b> (Google Gemini, ChatGPT ou Claude).\n\nEnquanto isso, use <b>↗ ChatGPT</b> para abrir o prompt pronto.</div>'
    : e.estado === "erro" ? `<div class="isb">❌ Não foi possível gerar a explicação: ${esc(e.msg || "")}\n\n<span class="muted">Confira a chave e o modelo em ⚙️.</span></div>`
    : mdSecoes((L.ia || {})[q.num] || "");
  return `<div class="iabox"><div class="iahead"><span class="iatitle"><span class="iaav">🎓</span><span><b>Professor FGV · Área Fiscal</b>
    <small>${e.modelo ? "via " + esc(e.modelo) : "mentor de elite"}</small></span></span><span class="iabtns">
    <button data-iarege="${q.num}" title="Gerar novamente">🔄</button><button data-iacopy="${q.num}" title="Copiar">📋</button>
    <button data-iagpt="${q.num}" title="Abrir no ChatGPT">↗ ChatGPT</button>
    <button data-iaclose="${q.num}" title="Fechar">✕</button></span></div><div class="iabody">${corpo}</div></div>`;
}
const atualizarBolha = (L, q) => { const el = $("ia-" + q.num); if (el) el.innerHTML = iaBolha(L, q); };

async function abrirIA(L, q, forcar) {
  const k = L.id + "|" + q.num, e = iaSt[k] || (iaSt[k] = {});
  if (e.estado === "carregando") return;
  if (e.open && !forcar) { e.open = false; atualizarBolha(L, q); return; } // clicar de novo recolhe
  e.open = true;
  const cache = L.ia && L.ia[q.num];
  if (cache && !forcar) { e.estado = "ok"; atualizarBolha(L, q); return; } // já gerada (salva na nuvem)
  const c = cfgIA();
  if (!c.prov) { e.estado = "semchave"; atualizarBolha(L, q); return; }
  e.estado = "carregando"; e.info = ""; atualizarBolha(L, q);
  const el = $("ia-" + q.num); if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  try {
    const r = await chamarIA(SISTEMA_IA, dadosQuestao(L, q), c, (m) => { e.info = m; atualizarBolha(L, q); });
    const txt = r.txt.trim(); e.modelo = r.modelo;
    L.ia = L.ia || {}; L.ia[q.num] = txt;
    updateDoc(ref("listas", L.id), { [`ia.${q.num}`]: txt }).catch(falha);
    e.estado = "ok";
  } catch (err) { e.estado = "erro"; e.msg = String(err.message || err); }
  atualizarBolha(L, q);
}

function iaAcao(k, L, q) {
  if (k === "ia") explicarDuck(L, q);
  else if (k === "iarege") abrirIA(L, q, true);
  else if (k === "iaclose") { iaSt[L.id + "|" + q.num].open = false; atualizarBolha(L, q); }
  else if (k === "iacopy") { if (navigator.clipboard) navigator.clipboard.writeText((L.ia || {})[q.num] || "").catch(() => {}); aviso("Copiado!"); }
  else if (k === "iagpt") explicarIA(L, q);
}
function abrirCfg() {
  const c = cfgIA(), keys = c.keys || {};
  $("cProv").value = c.prov || "gemini"; $("cModel").value = c.model || "";
  $("cGemKey").value = keys.gemini || ""; $("cOpenKey").value = keys.openai || ""; $("cAnthKey").value = keys.anthropic || "";
  $("dlgCfg").showModal();
}
$("cCancel").onclick = () => $("dlgCfg").close();
$("formCfg").onsubmit = (e) => {
  e.preventDefault();
  const anterior = cfgIA().keys || {};
  const keys = {
    gemini: $("cGemKey").value.trim() || anterior.gemini || "",
    openai: $("cOpenKey").value.trim() || anterior.openai || "",
    anthropic: $("cAnthKey").value.trim() || anterior.anthropic || ""
  };
  const prov = $("cProv").value;
  if (!keys[prov]) { aviso("Informe a chave de API do provedor selecionado."); return; }
  localStorage.setItem("ia_cfg", JSON.stringify({ prov, model: $("cModel").value.trim(), keys }));
  $("dlgCfg").close(); aviso("Configuração de IA salva neste aparelho.");
};

const hue = (n) => { let h = 0; for (const c of (n || "?").toLowerCase()) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const SECOES = [["regular", "📘 PDF Regular"], ["passe", "⭐ Passe Estratégico"]];

// Extrai "(FGV / SEFAZ-MG / 2022)" do início do enunciado -> badges de Banca / Ano / Órgão
function cabecalhoQuestao(enun) {
  enun = enun || "";
  const m = /^\s*\(([^)]{3,90})\)\s*/.exec(enun);
  if (!m) return { resto: enun };
  const ano = (m[1].match(/\b(?:19|20)\d{2}\b/) || [])[0];
  if (!ano) return { resto: enun };
  const toks = m[1].split(/\s*[\/–—]\s*|\s+-\s+/).map((x) => x.trim()).filter(Boolean);
  const anoTok = (x) => /^(?:19|20)\d{2}$/.test(x);
  const banca = toks.find((x) => !anoTok(x));
  if (!banca || !/^[A-Za-zÀ-ú.&\- ]{2,28}$/.test(banca)) return { resto: enun }; // não parece um cabeçalho de banca
  const orgao = toks.find((x) => !anoTok(x) && x !== banca);
  return { banca, ano, orgao, resto: enun.slice(m[0].length) };
}

function cardMateria(sec, r, i) {
  const at = `data-cs="${sec}" data-ci="${i}"`;
  return `<div class="mcard"><div class="mtop"><span class="mdot" style="--h:${hue(r.nome)}">${esc((r.nome || "?").trim().charAt(0).toUpperCase())}</span>
    <input class="mnome" ${at} data-cf="nome" value="${esc(r.nome || "")}" placeholder="Matéria">
    <button class="ico" data-ler="${sec}|${i}" title="Ler a apostila em PDF (abre na página cadastrada)">📖</button><button class="ico" data-cdel="${sec}|${i}" title="Remover">🗑️</button></div>
    <div class="mfields">
      <div class="fld"><label>Apostila / Aula</label><input ${at} data-cf="material" value="${esc(r.material || "")}" placeholder="Ex.: Apostila 8"></div>
      <div class="fld"><label>Página / Exercício</label><input ${at} data-cf="detalhe" value="${esc(r.detalhe || "")}" placeholder="Ex.: página 32"></div>
    </div></div>`;
}

function renderConteudo() {
  const el = $("secConteudo");
  el.innerHTML = `<div class="ctop"><div><h2>Conteúdo</h2><p class="ctsub">${AP_MATERIAS.length} matérias · ${apEstado.itens.length} apostila${apEstado.itens.length === 1 ? "" : "s"}</p></div>
    <span class="ctopbtns"><button class="addbig" data-apup="1">+ Enviar apostila</button><button class="addbig" data-drivesync="1" title="Buscar as apostilas da pasta do Google Drive">☁ Sincronizar Drive</button></span></div>${apostilasHTML()}`;
}

// Matérias disponíveis para o cronograma (Conteúdo + Questões + já usadas), sem repetir
function poolMaterias() {
  const m = new Map();
  const add = (n) => { n = (n || "").trim(); if (n && !m.has(n.toLowerCase())) m.set(n.toLowerCase(), n); };
  [...(conteudo?.regular || []), ...(conteudo?.passe || []), ...materias].forEach((x) => add(x.nome));
  (cron?.ciclos || []).forEach((c) => Object.values(c.dias || {}).flat().forEach(add));
  return [...m.values()].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
}
const cicloAtivo = () => cron.ciclos.find((x) => x.id === cron.ativo) || cron.ciclos[0];

function renderCron() {
  atualizarPerfil();
  const el = $("secCronograma");
  if (!cron) { el.innerHTML = '<p class="muted">Carregando...</p>'; return; }
  const c = cicloAtivo(), pool = poolMaterias();
  const hoje = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"][new Date().getDay()];
  el.innerHTML = `<div class="ctop"><h2>Cronograma</h2></div>
    <div class="kbar"><div class="tabs">${cron.ciclos.map((x) => `<button class="tab ${x.id === c.id ? "on" : ""}" data-kc="${x.id}">${esc(x.nome)}</button>`).join("")}
      <button class="tab add" data-knovo="1">Novo ciclo</button></div>
      <div class="kact"><button data-kren="1">Renomear</button><button data-kdel="1" ${cron.ciclos.length < 2 ? "disabled" : ""}>Excluir</button></div></div>
    <div class="kgrid">` + DIAS.map(([k, nome]) => {
      const ms = (c.dias && c.dias[k]) || [], desc = !ms.length;
      const livres = pool.filter((n) => !ms.some((x) => x.toLowerCase() === n.toLowerCase()));
      return `<div class="kdia ${k === hoje ? "hoje" : ""} ${desc ? "descanso" : ""}">
        <div class="khead"><span class="kico">${desc ? "😴" : "📅"}</span><b>${nome.replace("-feira", "")}</b>${k === hoje ? '<span class="tag">Hoje</span>' : ""}
          <span class="kcount">${desc ? "Descanso" : ms.length + (ms.length > 1 ? " matérias" : " matéria")}</span></div>
        <div class="kbody">${desc ? '<p class="muted">Dia livre para recarregar as energias.</p>' :
          `<div class="chips">${ms.map((n, i) => `<span class="pill" style="--h:${hue(n)}"><span>${esc(n)}</span><button data-krem="${k}|${i}" title="Remover">✕</button></span>`).join("")}</div>`}
          <select data-kadd="${k}"><option value="">Adicionar matéria…</option>${livres.map((n) => `<option>${esc(n)}</option>`).join("")}
          <option value="__novo__">✏️ Outra (digitar)…</option></select></div></div>`;
    }).join("") + "</div>";
}


// ---------- Continuar de onde parei ----------
// Guarda o último ponto de estudo (questão respondida, página lida no leitor ou página anotada em Conteúdo).
// Fica no aparelho (localStorage "ultimo_estudo") e também em users/{uid}/config/progresso para aparecer nos outros aparelhos.
// É um registro novo e separado: não altera Conteúdo, Cronograma, listas nem matérias.
const PROG_KEY = "ultimo_estudo";
let progresso = (() => { try { return JSON.parse(localStorage.getItem(PROG_KEY) || "null"); } catch (e) { return null; } })();
let tProg, apMeta = null, retomarAp = null;
const progAtual = () => (progresso && user && (!progresso.uid || progresso.uid === user.uid) ? progresso : null);
function registrarProgresso(p) {
  marcarAtividade();
  progresso = { ...p, uid: (user && user.uid) || "", ts: Date.now() };
  try { localStorage.setItem(PROG_KEY, JSON.stringify(progresso)); } catch (e) { /* armazenamento cheio: segue só na memória */ }
  clearTimeout(tProg);
  tProg = setTimeout(() => { if (user) setDoc(cfgRef("progresso"), progresso).catch((e) => console.warn("progresso:", e.message)); }, 1200);
  atualizarRetomar();
}
const quando = (ts) => {
  const s = Math.round((Date.now() - (ts || 0)) / 1000);
  if (s < 60) return "agora há pouco";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400); return d === 1 ? "ontem" : `há ${d} dias`;
};
const proximaQuestao = (L, n) => { const nx = L.questoes.find((q) => q.num > n && status(L, q) === "branco"); return nx ? nx.num : n; };
function localizarCtx(p) { // posição atual da matéria em Conteúdo (a lista pode ter sido reordenada)
  if (!conteudo) return null;
  if (conteudo[p.sec] && conteudo[p.sec][p.i] && sem(conteudo[p.sec][p.i].nome) === sem(p.nome)) return `${p.sec}|${p.i}`;
  for (const sec of ["regular", "passe"]) { const i = (conteudo[sec] || []).findIndex((r) => sem(r.nome) === sem(p.nome)); if (i >= 0) return `${sec}|${i}`; }
  return null;
}
function retomarHTML(ctx) {
  const p = progAtual();
  if (!p) return ctx !== "conteudo" ? "" : `<div class="retomar vazio"><div><div class="rt-tit sm">Continuar de onde parei</div>
    <div class="rt-det">Responda uma questão, abra uma apostila no leitor ou anote a página de uma matéria abaixo. O último ponto de estudo aparece aqui.</div></div></div>`;
  let mat = "", tit = "", det = "", btn = "Retomar", pct = null, nota = "";
  if (p.tipo === "questoes") {
    const L = listas.find((l) => l.id === p.lista), m = materias.find((x) => x.id === (L ? L.materia : p.materia));
    mat = (m && m.nome) || p.materiaNome || ""; tit = (L && L.nome) || p.listaNome || "Lista de questões";
    if (L && L.questoes.length) {
      const tot = L.questoes.length, c = contar(L, L.questoes), resp = tot - c.branco, nx = proximaQuestao(L, p.questao);
      det = `Parou na questão ${p.questao} de ${L.questoes[tot - 1].num}. ${resp} respondidas.`;
      pct = (resp / tot) * 100; btn = nx !== p.questao ? `Retomar na questão ${nx}` : `Ir para a questão ${nx}`;
    } else if (!listas.length) { det = `Parou na questão ${p.questao}.`; btn = ""; }
    else { det = "Esta lista foi excluída."; btn = ""; }
  } else if (p.tipo === "apostila") {
    mat = p.nome || ""; tit = p.material || p.titulo || p.arquivo || "Apostila";
    det = `Página ${p.pagina}${p.total ? ` de ${p.total}` : ""}`; pct = p.total ? (p.pagina / p.total) * 100 : null;
    btn = `Retomar na página ${p.pagina}`;
    if (!p.apostila && !(apPdf && apArq && apArq.name === p.arquivo)) nota = `Ao retomar, selecione o arquivo ${p.arquivo || "da apostila"}: o navegador não guarda o PDF entre sessões.`;
  } else {
    mat = p.nome || ""; tit = p.material || "Apostila"; det = p.detalhe ? `Parou em: ${p.detalhe}` : "Sem página anotada"; btn = "Abrir apostila";
  }
  return `<div class="retomar"><div class="rt-top"><b>Continuar de onde parei</b><span>${quando(p.ts)}</span></div>
    <div class="rt-main">${mat ? `<div class="rt-mat">${esc(String(mat))}</div>` : ""}<div class="rt-tit">${esc(String(tit))}</div><div class="rt-det">${esc(det)}</div></div>
    ${btn ? `<button class="pri rt-btn" data-retomar="1">${esc(btn)}</button>` : ""}${nota ? `<div class="rt-nota">${esc(nota)}</div>` : ""}
    ${pct !== null ? `<div class="rt-prog" aria-hidden="true"><i style="width:${Math.min(100, Math.max(2, pct)).toFixed(1)}%"></i></div>` : ""}</div>`;
}
function atualizarRetomar() { document.querySelectorAll(".retomar-slot").forEach((e) => { e.innerHTML = retomarHTML(e.dataset.ctx); }); }
function retomar() {
  const p = progAtual(); if (!p) return;
  if (p.tipo === "questoes") {
    const L = listas.find((l) => l.id === p.lista); if (!L) return aviso("Essa lista não existe mais.");
    const alvo = proximaQuestao(L, p.questao), maxN = L.questoes[L.questoes.length - 1].num;
    sel = { materia: L.materia, lista: L.id };
    if (!visiveis(L).some((q) => q.num === alvo)) { // abre o bloco que contém a questão, sem filtro
      filtro = "todas"; const ini = Math.floor((alvo - 1) / TAM) * TAM + 1; faixa = { de: ini, ate: Math.min(ini + TAM - 1, maxN) };
    }
    saveUi(); mostrarSecao("questoes"); abrirQuestoes();
    requestAnimationFrame(() => {
      const el = document.querySelector(`.card.q[data-qn="${alvo}"]`); if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" }); el.classList.add("pulse"); setTimeout(() => el.classList.remove("pulse"), 1800);
    });
  } else if (p.tipo === "apostila") {
    if (p.apostila && apItem(p.apostila)) { lerApostilaLib(p.apostila, p.pagina); return; }
    if (apPdf && apArq && apArq.name === p.arquivo) { if (!$("dlgLeitor").open) $("dlgLeitor").showModal(); mostrarPaginaApostila(p.pagina); return; }
    apCtx = localizarCtx(p) || "top"; retomarAp = { pag: p.pagina, tit: p.titulo };
    $("apFile").value = ""; $("apFile").click();
  } else {
    apCtx = localizarCtx(p); retomarAp = null;
    if (!apCtx) { aviso("Essa matéria não está mais em Conteúdo."); return mostrarSecao("conteudo"); }
    $("apFile").value = ""; $("apFile").click();
  }
}

document.addEventListener("click", async (e) => {
  const t = e.target, d = (k) => t.closest(`[data-${k}]`)?.dataset[k];
  if (d("retomar")) return retomar();
  if (d("sec")) return mostrarSecao(d("sec"));
  if (d("ler")) { apCtx = d("ler"); $("apFile").value = ""; $("apFile").click(); return; } // escolhe o PDF da apostila
  if (d("abrirmat")) { renderMaterias(); $("dlgMaterias").showModal(); return; }
  if (d("rm")) { // renomear matéria
    const m = materias.find((x) => x.id === d("rm")); if (!m) return;
    const nome = ((await uiPrompt("Renomear matéria", m.nome, { ok: "Salvar", msg: "Digite o novo nome da matéria." })) || "").trim();
    if (!nome || nome === m.nome) return;
    if (materias.some((x) => x.id !== m.id && x.nome.toLowerCase() === nome.toLowerCase())) return alert("Já existe uma matéria com esse nome.");
    m.nome = nome; updateDoc(ref("materias", m.id), { nome }).catch(falha); render();
    return;
  }
  const ik = ["ia", "iarege", "iaclose", "iacopy", "iagpt"].find((k) => d(k));
  if (ik) {
    const L = listaAtual(), q = L && L.questoes.find((x) => String(x.num) === d(ik));
    if (q) iaAcao(ik, L, q);
    return;
  }
  if (d("iacfg")) return abrirCfg();
  if (conteudo && d("cadd")) {
    abrirDlg(d("cadd"));
  } else if (conteudo && d("cdel")) {
    const [sec, i] = d("cdel").split("|"), r = conteudo[sec][+i];
    if (!(await uiConfirm(`Remover “${r.nome}”?`, { titulo: "Remover item", ok: "Remover", perigo: true }))) return;
    conteudo[sec].splice(+i, 1); salvarConteudo(); renderConteudo();
  } else if (cron && d("kc")) { cron.ativo = d("kc"); salvarCron(); renderCron(); }
  else if (cron && d("knovo")) {
    const nome = ((await uiPrompt("Novo ciclo", `Ciclo ${cron.ciclos.length + 1}`, { ok: "Criar", msg: "Dê um nome ao ciclo." })) || "").trim();
    if (!nome) return;
    const id = "c" + Date.now();
    cron.ciclos.push({ id, nome, dias: { seg: [], ter: [], qua: [], qui: [], sex: [], sab: [], dom: [] } });
    cron.ativo = id; salvarCron(); renderCron();
  } else if (cron && d("kren")) {
    const c = cicloAtivo(), nome = ((await uiPrompt("Renomear ciclo", c.nome, { ok: "Salvar" })) || "").trim();
    if (nome) { c.nome = nome; salvarCron(); renderCron(); }
  } else if (cron && d("kdel")) {
    if (cron.ciclos.length < 2 || !(await uiConfirm("O ciclo e tudo o que está nele serão excluídos.", { titulo: "Excluir ciclo?", ok: "Excluir", perigo: true }))) return;
    cron.ciclos = cron.ciclos.filter((x) => x.id !== cicloAtivo().id);
    cron.ativo = cron.ciclos[0].id; salvarCron(); renderCron();
  } else if (cron && d("krem")) {
    const [dia, i] = d("krem").split("|");
    cicloAtivo().dias[dia].splice(+i, 1); salvarCron(); renderCron();
  }
});

document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.id === "apFile") { // abre a apostila escolhida na página cadastrada
    const f = t.files[0]; if (!f) return;
    let pag = 1, tit = f.name; apMeta = null; apAtiva = null;
    if (apCtx && apCtx !== "top" && conteudo) {
      const [sec, i] = apCtx.split("|"), r = conteudo[sec][+i];
      pag = +((/p[áa]g(?:ina)?s?\.?\s*(\d+)/i.exec(r.detalhe || "") || [])[1] || 1);
      tit = `${r.nome} — ${r.material || f.name}`;
      apMeta = { sec, i: +i, nome: r.nome || "", material: r.material || "" };
    }
    if (retomarAp) { pag = retomarAp.pag || pag; if (!apMeta && retomarAp.tit) tit = retomarAp.tit; retomarAp = null; }
    abrirApostila(f, pag, tit);
    return;
  }
  if (conteudo && t.dataset.cf) { // edição de apostila/página/nome
    conteudo[t.dataset.cs][+t.dataset.ci][t.dataset.cf] = t.value.trim();
    clearTimeout(tSalvar); salvarConteudo();
    const rr = conteudo[t.dataset.cs][+t.dataset.ci];
    registrarProgresso({ tipo: "conteudo", sec: t.dataset.cs, i: +t.dataset.ci, nome: rr.nome || "", material: rr.material || "", detalhe: rr.detalhe || "" });
  } else if (cron && t.dataset.kadd) { // escolher matéria do dia
    let nome = t.value;
    if (nome === "__novo__") nome = ((await uiPrompt("Nova matéria", "", { ok: "Criar", msg: "Qual o nome da matéria?" })) || "").trim();
    if (nome) {
      const c = cicloAtivo();
      if (!c.dias[t.dataset.kadd]) c.dias[t.dataset.kadd] = [];
      c.dias[t.dataset.kadd].push(nome);
      salvarCron();
    }
    renderCron();
  }
});

$("dmFechar").onclick = () => $("dlgMaterias").close();
document.addEventListener("input", (e) => { // busca de matérias (sidebar e janela)
  const t = e.target;
  if (t.id === "buscaMat" || t.id === "buscaMat2") {
    matFiltro = t.value; renderMaterias();
    ["buscaMat", "buscaMat2"].forEach((id) => { const x = $(id); if (x && x !== t) x.value = matFiltro; });
  }
});
// Atualização em tempo real: salva 0,7 s depois de parar de digitar
let tSalvar;
document.addEventListener("input", (e) => {
  const t = e.target;
  if (conteudo && t.dataset.cf) {
    conteudo[t.dataset.cs][+t.dataset.ci][t.dataset.cf] = t.value;
    const st = $("saveStatus"); if (st) st.textContent = "Salvando…";
    clearTimeout(tSalvar); tSalvar = setTimeout(salvarConteudo, 700);
  }
});

// Diálogo "Nova matéria"
function abrirDlg(sec) {
  $("formDlg").reset(); $("dSec").value = sec === "passe" ? "passe" : "regular";
  $("dlgMateria").showModal(); $("dNome").focus();
}
$("dCancel").onclick = () => $("dlgMateria").close();
$("formDlg").onsubmit = (e) => {
  e.preventDefault();
  const nome = $("dNome").value.trim(), sec = $("dSec").value;
  if (!nome || !conteudo) return;
  if (!conteudo[sec]) conteudo[sec] = [];
  conteudo[sec].push(R(nome, $("dMat").value.trim(), $("dDet").value.trim()));
  $("dlgMateria").close(); salvarConteudo(); renderConteudo();
};

// ---------- Sidebar: perfil, status do ciclo e recolher ----------
function atualizarPerfil() {
  const nome = (user && (user.displayName || user.email)) || "";
  $("avatar").textContent = nome.charAt(0).toUpperCase() || "?";
  let st = "Carregando ciclo…";
  if (cron) {
    const c = cicloAtivo(), k = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"][new Date().getDay()];
    const ms = (c.dias && c.dias[k]) || [], dn = DIAS.find((d) => d[0] === k)[1].replace("-feira", "");
    st = ms.length ? `${c.nome} · Hoje (${dn}): ${ms.join(", ")}` : `${c.nome} · Hoje (${dn}): descanso 😴`;
  }
  $("statusCiclo").textContent = st;
}
if (localStorage.getItem("side_col") === "1") $("app").classList.add("col");
$("colapsar").onclick = () => {
  $("app").classList.toggle("col");
  localStorage.setItem("side_col", $("app").classList.contains("col") ? "1" : "0");
};

// ---------- Autenticação + sincronização em tempo real ----------
const msgErro = (e) => ({
  "auth/invalid-credential": "E-mail ou senha incorretos.",
  "auth/wrong-password": "E-mail ou senha incorretos.",
  "auth/user-not-found": "Conta não encontrada. Use “Criar conta”.",
  "auth/invalid-email": "E-mail inválido.",
  "auth/email-already-in-use": "Este e-mail já tem conta. Use “Entrar”.",
  "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
  "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco e tente de novo.",
  "auth/network-request-failed": "Sem conexão com a internet.",
  "auth/operation-not-allowed": "Ative o login por E-mail/senha no Firebase (Authentication)."
}[e.code] || e.message);

async function autenticar(criar) {
  $("erroLogin").textContent = "";
  try {
    // "Lembrar de mim": sessão guardada no aparelho; desmarcado = termina ao fechar o navegador
    await setPersistence(auth, $("lembrar").checked ? browserLocalPersistence : browserSessionPersistence);
    const fn = criar ? createUserWithEmailAndPassword : signInWithEmailAndPassword;
    await fn(auth, $("email").value.trim(), $("senha").value);
  } catch (e) { $("erroLogin").textContent = msgErro(e); }
}
$("formLogin").onsubmit = (e) => { e.preventDefault(); autenticar(false); };
$("btnCriar").onclick = () => { if ($("formLogin").reportValidity()) autenticar(true); };
$("btnReset").onclick = async () => {
  const email = $("email").value.trim();
  if (!email) { $("erroLogin").textContent = "Digite seu e-mail acima primeiro."; return; }
  try { await sendPasswordResetEmail(auth, email); $("erroLogin").textContent = "Enviamos um e-mail para redefinir a senha."; }
  catch (e) { $("erroLogin").textContent = msgErro(e); }
};

onAuthStateChanged(auth, (u) => {
  unsubs.forEach((f) => f()); unsubs = [];
  user = u; materias = []; listas = []; listasOk = false; conteudo = null; cron = null;
  $("login").hidden = !!u; $("app").hidden = !u; $("conta").hidden = !u;
  $("usuario").textContent = u ? u.displayName || u.email : ""; atualizarPerfil();
  if (!u) return;
  unsubs.push(onSnapshot(col("materias"), (s) => {
    materias = s.docs.map((d) => ({ id: d.id, ...d.data() })); render(); atualizarDiag();
  }, falha));
  unsubs.push(onSnapshot(col("listas"), (s) => {
    const n = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (sig(n) === sig(listas)) return; // já refletido localmente: evita redesenhar/pular a tela
    listas = n; listasOk = true; render(); atualizarDiag(); if(secao==="inicio")renderInicio();
  }, falha));
  // Conteúdo e Cronograma: cria os dados iniciais na primeira vez (somente após confirmar com o servidor)
  unsubs.push(onSnapshot(cfgRef("conteudo"), (s) => {
    if (!s.exists()) { if (!s.metadata.fromCache) { conteudo = structuredClone(SEED_CONT); salvarConteudo(); renderConteudo(); } return; }
    if (conteudo && canon(s.data()) === canon(conteudo)) return; // já refletido localmente
    conteudo = s.data(); if (secao === "conteudo") renderConteudo(); else if (secao === "cronograma") renderCron(); else if (secao === "diagnostico") renderDiag();
  }, falha));
  unsubs.push(onSnapshot(cfgRef("cronograma"), (s) => {
    if (!s.exists()) { if (!s.metadata.fromCache) { cron = structuredClone(SEED_CRON); salvarCron(); renderCron(); } return; }
    if (cron && canon(s.data()) === canon(cron)) return;
    cron = s.data(); atualizarPerfil(); if (secao === "cronograma") renderCron();
  }, falha));
  unsubs.push(onSnapshot(cfgRef("progresso"), (s) => {
    if (!s.exists()) return;
    const r = s.data();
    if (!progAtual() || (r.ts || 0) > (progresso.ts || 0)) {
      progresso = r; try { localStorage.setItem(PROG_KEY, JSON.stringify(r)); } catch (e) { /* ignora */ }
      atualizarRetomar();
    }
  }, (e) => console.warn("progresso:", e.message)));
  mostrarSecao(secao);
  document.dispatchEvent(new Event("af:ready"));
});

// ---------- Eventos ----------
document.addEventListener("click", async (e) => {
  const t = e.target, d = (k) => t.closest(`[data-${k}]`)?.dataset[k], L = listaAtual();
  const upd = (obj) => updateDoc(ref("listas", L.id), obj).catch(falha);
  if (d("x")) { // ✂️ descartar/restaurar alternativa (salvo na nuvem)
    const [n, k] = d("x").split("|");
    L.riscadas = L.riscadas || {};
    const cs = new Set((L.riscadas[n] || "").split("").filter(Boolean));
    if (cs.has(k)) cs.delete(k); else cs.add(k);
    const str = [...cs].sort().join("");
    if (str) L.riscadas[n] = str; else delete L.riscadas[n];
    upd({ [`riscadas.${n}`]: str || deleteField() });
    t.closest(".altrow").classList.toggle("cut", cs.has(k));
  } else if (d("dl")) {
    if (await uiConfirm(`“${(listas.find((x) => x.id === d("dl")) || {}).nome || "Esta lista"}” e as suas respostas serão apagadas. Essa ação não pode ser desfeita.`, { titulo: "Excluir lista?", ok: "Excluir", perigo: true })) deleteDoc(ref("listas", d("dl"))).catch(falha);
  } else if (d("rn")) { renomearLista(d("rn")); }
  else if (d("kb")) { /* menu ⋮: só abre/fecha o menu */ }
  else if (d("l")) { sel.lista = d("l"); saveUi(); abrirQuestoes(); $("qCorpo").scrollTop = 0; }
  else if (d("m")) { sel = { materia: d("m"), lista: null }; if ($("dlgMaterias").open) $("dlgMaterias").close(); mostrarSecao("questoes"); }
  else if (t.closest("#novaMat, [data-novamat]")) {
    if ($("dlgMaterias").open) $("dlgMaterias").close();
    const nome = ((await uiPrompt("Nova matéria", "", { ok: "Criar", msg: "Qual o nome da matéria?" })) || "").trim();
    if (!nome) return;
    if (materias.some((m) => m.nome.toLowerCase() === nome.toLowerCase())) return alert("Essa matéria já existe.");
    try { const r = await addDoc(col("materias"), { nome, criado: Date.now() }); sel = { materia: r.id, lista: null }; saveUi(); mostrarSecao("questoes"); }
    catch (err) { falha(err); }
  } else if (d("dm")) {
    if (!(await uiConfirm("A matéria e todas as listas dentro dela serão apagadas. Essa ação não pode ser desfeita.", { titulo: "Excluir matéria?", ok: "Excluir", perigo: true }))) return;
    const b = writeBatch(fs);
    listas.filter((l) => l.materia === d("dm")).forEach((l) => b.delete(ref("listas", l.id)));
    b.delete(ref("materias", d("dm")));
    b.commit().catch(falha);
  } else if (d("f")) { filtro = d("f"); saveUi(); render(); }
  else if (d("de")) { faixa = { de: +d("de"), ate: +t.closest("[data-de]").dataset.ate }; saveUi(); render(); }
  else if (d("rq")) {
    const n = d("rq"); delete L.respostas[n]; delete L.corrigidas[n]; if (L.riscadas) delete L.riscadas[n];
    upd({ [`respostas.${n}`]: deleteField(), [`corrigidas.${n}`]: deleteField(), [`riscadas.${n}`]: deleteField() }); render();
  } else if (t.id === "corrigir" || d("corrigir")) { // corrige todas as marcadas entre as exibidas
    const o = {};
    const pq = pendentesTela(L); registrarCorrecao(L, pq);
    pq.forEach((q) => { L.corrigidas[q.num] = true; o[`corrigidas.${q.num}`] = true; });
    upd(o); render();
  } else if (t.id === "refazer") {
    if (!(await uiConfirm("Todas as respostas desta lista serão apagadas e ela volta ao começo.", { titulo: "Apagar respostas?", ok: "Apagar", perigo: true }))) return;
    L.respostas = {}; L.corrigidas = {}; L.riscadas = {}; upd({ respostas: {}, corrigidas: {}, riscadas: {} }); render();
  }
});

document.addEventListener("click", async (e) => {
  const t = e.target.closest('input[type="radio"][data-q]');
  if (!t || !t.dataset.q) return;
  const L = listaAtual();
  // Questão corrigida: o radio está desabilitado no HTML e não pode ser alterado.
  if (L?.corrigidas?.[t.dataset.q]) {
    e.preventDefault();
    return;
  }
  // Radio normalmente não permite desmarcar clicando novamente. Fazemos isso manualmente.
  const atual = L?.respostas?.[t.dataset.q];
  if (atual === t.value) {
    e.preventDefault();
    t.checked = false;
    delete L.respostas[t.dataset.q];
    updateDoc(ref("listas", L.id), { [`respostas.${t.dataset.q}`]: deleteField() }).catch(falha);
    t.closest(".q").querySelectorAll(".altrow").forEach((r) => r.classList.remove("sel"));
    t.closest(".q").classList.remove("marcada");
    $("rel").innerHTML = relatorio(L);
    atualizarBotao(L);
    atualizarLinha(L);
  }
});

document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.dataset.q) { // marcou alternativa: atualiza na tela e grava na nuvem
    const L = listaAtual();
    // Segurança extra: uma questão corrigida nunca pode ser alterada sem "refazer".
    if (L?.corrigidas?.[t.dataset.q]) return;
    L.respostas[t.dataset.q] = t.value;
    t.closest(".q").querySelectorAll(".altrow").forEach((r) => r.classList.toggle("sel", r.contains(t)));
    t.closest(".q").classList.add("marcada");
    updateDoc(ref("listas", L.id), { [`respostas.${t.dataset.q}`]: t.value }).catch(falha);
    $("rel").innerHTML = relatorio(L);
    atualizarBotao(L);
    atualizarLinha(L);
    registrarProgresso({ tipo: "questoes", materia: L.materia || "", lista: L.id, questao: +t.dataset.q,
      listaNome: L.nome || "", materiaNome: ((materias.find((m) => m.id === L.materia)) || {}).nome || "" });
  } else if (t.id === "leitorPdf") {
    localStorage.setItem("leitor_pdf", t.value);
  } else if (t.id === "de" || t.id === "ate") {
    faixa = { de: Math.max(1, +$("de").value || 1), ate: +$("ate").value || 9999 }; saveUi(); render();
  } else if (t.id === "pdf" || t.id === "pdfDireto") {
    const direto = t.id === "pdfDireto", arquivos = [...t.files];
    const st = $("status"); statusImport = "";
    for (const f of arquivos) {
      st.textContent = `Processando ${f.name}...`;
      try {
        const { id, ...l } = await lerPDF(f, (m) => { st.textContent = m; }, direto);
        if (JSON.stringify(l).length > 900000) throw new Error("PDF grande demais para um documento do Firestore (limite ~1 MB).");
        const r = await addDoc(col("listas"), { ...l, materia: sel.materia, criado: Date.now() });
        sel.lista = r.id; saveUi();
        const nt = l.questoes.reduce((a, q) => a + ((q.tabelas && q.tabelas.length) || 0), 0);
        statusImport += `✅ ${f.name}: ${l.paginas ? l.paginas + " pág. · " : ""}${l.leitor ? "lido por " + l.leitor + " · " : "lido pelo leitor local (sem IA) · "}${l.questoes.length} questões · ${Object.keys(l.gabarito).length} no gabarito · ${nt} tabelas\n`;
        if (!l.questoes.length) statusImport += "⚠️ Nenhuma questão identificada. Veja o texto lido abaixo (e me envie um trecho para ajustar o leitor).\n";
        else if (Object.keys(l.gabarito).length < l.questoes.length) statusImport += "⚠️ O gabarito tem menos respostas que questões: confira o final do PDF.\n";
      } catch (err) { console.error(err); statusImport += `❌ ${f.name}: ${err.message}\n`; }
    }
    render();
  }
});


/* ===== Núcleo de Estudos: dashboard + revisão IA ===== */
let revisaoEstado = {selecionada:"", historico:[], erros:[], ultima:null, estudos:[]};
let revUnsub = null;
const REV_KEY = "revisao_ia";
function revLocal(){ try{return JSON.parse(localStorage.getItem(REV_KEY)||"null")}catch(e){return null} }
function salvarRevisao(){
  try{localStorage.setItem(REV_KEY,JSON.stringify(revisaoEstado))}catch(e){}
  if(user) setDoc(cfgRef("revisao_ia"),revisaoEstado,{merge:false}).catch(falha);
}
function revMateriaOptions(){
  const all=[...(materias||[]).map(m=>({id:m.id,nome:m.nome})),...((conteudo?.regular||[]).map((m,i)=>({id:"cont-r-"+i,nome:m.nome}))),...((conteudo?.passe||[]).map((m,i)=>({id:"cont-p-"+i,nome:m.nome})))];
  const seen=new Set(); return all.filter(x=>{const k=sem(x.nome);if(!x.nome||seen.has(k))return false;seen.add(k);return true}).sort((a,b)=>a.nome.localeCompare(b.nome,"pt-BR"));
}
function revDadosMateria(nome){
  const mm=(materias||[]).filter(m=>sem(m.nome)===sem(nome));
  const ls=mm.flatMap(m=>listas.filter(l=>l.materia===m.id));
  const qs=ls.flatMap(l=>l.questoes.map(q=>({lista:l.nome,q,resposta:l.respostas?.[q.num]||"",gabarito:l.gabarito?.[q.num]||""})));
  const erros=qs.filter(x=>x.resposta&&x.gabarito&&x.gabarito!=="ANULADA"&&x.resposta!==x.gabarito).slice(-25);
  return {listas:ls.length,questoes:qs.length,erros};
}
// ---------- Revisão espaçada ----------
const REV_INT=[1,7,15,30,60]; // dias depois do estudo em que cada revisão é agendada
const pad2=n=>String(n).padStart(2,"0");
const isoDe=d=>`${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
const isoHoje=()=>isoDe(new Date());
const somaDias=(iso,n)=>{const [y,m,d]=iso.split("-").map(Number);return isoDe(new Date(y,m-1,d+n))};
const difDias=(a,b)=>{const f=t=>{const [y,m,d]=t.split("-").map(Number);return Date.UTC(y,m-1,d)};return Math.round((f(a)-f(b))/864e5)};
const fmtData=iso=>{const [,m,d]=iso.split("-");return `${d}/${m}`};
const REV_MENSAL=30; // depois das 5 primeiras revisões, o tema volta todo mês (nunca "acaba")
const estudos=()=>{const a=revisaoEstado.estudos||(revisaoEstado.estudos=[]); a.forEach(e=>{if(!e.prox)e.prox=somaDias(e.feitaEm||isoHoje(),REV_MENSAL)}); return a}; // ciclos antigos "concluídos" voltam para a fila mensal
const revAtivos=()=>estudos();
const revVencidas=()=>revAtivos().filter(e=>e.prox<=isoHoje());
function atualizarBadgeRevisao(){
  const n=revVencidas().length, b=document.querySelector('.mi[data-sec="revisao"]');
  if(b){let d=b.querySelector(".dot"); if(n){if(!d){d=document.createElement("span");d.className="dot";b.appendChild(d)} d.textContent=n}else if(d)d.remove()}
  document.title=(n?`(${n}) `:"")+"Área fiscal";
}
function revBanner(){
  const n=revVencidas().length; if(!n)return "";
  return `<div class="revalert"><span>${SVG_SINO}<span>Você tem <b>${n} revis${n>1?"ões":"ão"}</b> para fazer hoje.</span></span><button class="pri small" data-secnav="revisao">Ver revisões</button></div>`;
}
function revConcluir(id){
  const e=estudos().find(x=>x.id===id); if(!e)return;
  e.antes={feitas:e.feitas,prox:e.prox,feitaEm:e.feitaEm||""}; // permite desfazer
  e.feitas++; e.feitaEm=isoHoje();
  e.prox=e.feitas<REV_INT.length?somaDias(e.data,REV_INT[e.feitas]):somaDias(isoHoje(),REV_MENSAL);
  const amanha=somaDias(isoHoje(),1); if(e.prox<amanha)e.prox=amanha; aviso("Revisão feita! Ela volta em "+fmtData(e.prox)+".");
  salvarRevisao(); marcarAtividade(); atualizarBadgeRevisao();
  if(secao==="revisao")renderRevisao(); else if(secao==="inicio")renderInicio();
}
function revDesfazer(id){
  const e=estudos().find(x=>x.id===id); if(!e)return;
  if(e.antes){e.feitas=e.antes.feitas;e.prox=e.antes.prox;e.feitaEm=e.antes.feitaEm;delete e.antes}
  else if(e.feitas>0){e.feitas--;e.prox=somaDias(e.data,REV_INT[e.feitas]||1);delete e.feitaEm}
  salvarRevisao(); atualizarBadgeRevisao();
  if(secao==="revisao")renderRevisao(); else if(secao==="inicio")renderInicio();
}
// Uma revisão fica marcada enquanto está em dia; só desmarca quando ela volta a vencer.
const revFeito=e=>e.feitas>0&&e.prox>isoHoje();
const revHoje=()=>estudos().filter(e=>e.prox<=isoHoje()||e.feitaEm===isoHoje())
  .sort((a,b)=>Number(revFeito(a))-Number(revFeito(b))||String(a.prox).localeCompare(String(b.prox)));
function revLinhaHTML(e,semMat){
  const hoje=isoHoje(), ok=revFeito(e), fim=false;
  let cl,tx;
  if(fim){cl="okrev";tx="Ciclo concluído"}
  else if(ok){cl="okrev";tx=`Feita · volta ${e.prox===somaDias(hoje,1)?"amanhã":"em "+fmtData(e.prox)}`}
  else{const d=difDias(e.prox,hoje); [cl,tx]=d<0?["late",`Atrasada ${-d} dia${d<-1?"s":""}`]:d===0?["due","Revisar hoje"]:["fut",d===1?"Amanhã":`Em ${d} dias (${fmtData(e.prox)})`]}
  const sub=[semMat?"":e.materia,e.erroId?"Do caderno de erros":`${e.apostila?"Concluída":"Estudada"} em ${fmtDataC(e.data)}`,(n=>n<=REV_INT.length?`Revisão ${n} de ${REV_INT.length}`:`Revisão ${n} · mensal`)(e.feitas+(ok?0:1))].filter(Boolean).join(" · ");
  return `<label class="rvlinha ${cl}" data-rvid="${esc(e.id)}"><input type="checkbox" class="rvcheck" data-rvcheck="${esc(e.id)}" ${ok?"checked":""} ${fim?"disabled":""} aria-label="${ok?"Revisão feita. Desmarcar para desfazer":"Marcar esta revisão como feita"}"><span class="rvinfo"><b>${esc(e.tema)}</b><small>${esc(sub)}</small></span><span class="rvst">${tx}</span><button type="button" class="ico rvdel" data-revdel="${esc(e.id)}" title="Excluir esta revisão" aria-label="Excluir esta revisão">${SVG_LIXO}</button></label>`;
}
let revSoAtr=localStorage.getItem("rev_so_atr")==="1", revPorMat=localStorage.getItem("rev_por_mat")!=="0";
function renderRevisao(){
  const el=$("secRevisao"), vencidas=revVencidas().length, hoje=isoHoje();
  const atrasada=e=>!revFeito(e)&&e.prox<=hoje;
  const ord=(a,b)=>Number(revFeito(a))-Number(revFeito(b))||a.prox.localeCompare(b.prox)||String(a.tema).localeCompare(String(b.tema),"pt-BR",{numeric:true});
  const todos=revAtivos().slice().sort(ord), ativos=revSoAtr?todos.filter(atrasada):todos;
  let lista;
  if(!todos.length) lista=`<div class="revempty">${SVG_VAZIO_REV}<b>Nenhuma revisão agendada.</b><p>Quando você marcar uma apostila como “Terminei” em Conteúdo, o lembrete aparece aqui.</p><button class="pri" data-secnav="conteudo">Ir para Conteúdo</button></div>`;
  else if(!ativos.length) lista=`<div class="revempty">${SVG_VAZIO_REV}<b>Nenhuma revisão atrasada.</b><p>Tudo em dia! Desmarque “Somente atrasadas” para ver todas.</p></div>`;
  else if(revPorMat){
    const gr=new Map();
    ativos.forEach(e=>{const k=sem(e.materia||"")||"~"; if(!gr.has(k))gr.set(k,{nome:(e.materia||"").trim()||"Sem matéria",itens:[]}); gr.get(k).itens.push(e)});
    const arr=[...gr.values()].map(g=>({...g,atr:g.itens.filter(atrasada).length})).sort((a,b)=>b.atr-a.atr||a.nome.localeCompare(b.nome,"pt-BR"));
    lista=arr.map(g=>`<section class="rvgrupo"><div class="rvgh"><b>${esc(g.nome)}</b><span>${g.itens.length} ${g.itens.length>1?"temas":"tema"}${g.atr?` · <em>${g.atr} atrasada${g.atr>1?"s":""}</em>`:""}</span></div><div class="rvlista">${g.itens.map(x=>revLinhaHTML(x,true)).join("")}</div></section>`).join("");
  } else lista=`<div class="rvlista">${ativos.map(x=>revLinhaHTML(x)).join("")}</div>`;
  el.innerHTML=`<div class="ctop"><div><h2>Revisão</h2></div><button type="button" class="lem-btn" data-lem="abrir" aria-label="Lembrete diário" title="Lembrete diário">${SVG_SINO}</button></div>
  ${vencidas?`<div class="revalert"><span>${SVG_SINO}<span><b>${vencidas} revis${vencidas>1?"ões":"ão"}</b> para fazer hoje (ou atrasada${vencidas>1?"s":""}).</span></span></div>`:""}
  ${todos.length?`<div class="rvtools"><label class="rvsw"><input type="checkbox" id="rvSoAtr" ${revSoAtr?"checked":""}><span>Somente atrasadas e de hoje</span></label><label class="rvsw"><input type="checkbox" id="rvPorMat" ${revPorMat?"checked":""}><span>Separar por matéria</span></label></div>`:""}
  ${lista}`;
  atualizarBadgeRevisao();
  document.dispatchEvent(new CustomEvent("af:render",{detail:{secao:"revisao",el}}));
}
document.addEventListener("change",e=>{
  const t=e.target; if(!t||(t.id!=="rvSoAtr"&&t.id!=="rvPorMat"))return;
  if(t.id==="rvSoAtr"){revSoAtr=t.checked;try{localStorage.setItem("rev_so_atr",revSoAtr?"1":"0")}catch(x){}}
  else{revPorMat=t.checked;try{localStorage.setItem("rev_por_mat",revPorMat?"1":"0")}catch(x){}}
  renderRevisao();
});
const CADERNO_KEY = "caderno_erros";
let cadernoEstado = {notas:{}, revisados:{}, motivos:{}, enviados:{}, tent:{}, zerado:0};
const MOTIVOS=[["lembrei","Não lembrei"],["conteudo","Não sabia o conteúdo"],["atencao","Falta de atenção"],["conceito","Confundi conceitos"],["calculo","Erro de cálculo"],["interp","Interpretei mal"],["chute","Chutei"]];
const MOT_COR={lembrei:"#d946ef",atencao:"#f0952a",conteudo:"#e5586a",conceito:"#a78bfa",calculo:"#38bdf8",interp:"#2bb283",chute:"#94a3b8"};
let cadMot="";
function carregarCaderno(){ try { const x=JSON.parse(localStorage.getItem(CADERNO_KEY)||"null"); if(x) cadernoEstado={...cadernoEstado,...x}; } catch(e){} }
function salvarCaderno(){ try{localStorage.setItem(CADERNO_KEY,JSON.stringify(cadernoEstado));}catch(e){} if(user) setDoc(cfgRef("caderno_erros"),cadernoEstado,{merge:false}).catch(falha); }
function motivosHTML(erros){
  const m=cadernoEstado.motivos||{}, c={}; let sem=0;
  erros.forEach(x=>{const k=m[x.id]; if(k)c[k]=(c[k]||0)+1; else sem++});
  const total=erros.length, max=Math.max(1,...Object.values(c),sem);
  const linha=(k,t,n,cor)=>`<button type="button" class="motbar ${cadMot===k?"on":""}" data-motfiltro="${k}" style="--mc:${cor}" aria-pressed="${cadMot===k}"><span class="mt">${t}</span><span class="mtr"><i style="width:${n/max*100}%"></i></span><b>${n}</b></button>`;
  return `<section class="ei-card motresumo"><div class="ei-ch"><h3>Por que eu erro</h3>${cadMot?'<button type="button" class="link" data-motfiltro="">Limpar filtro</button>':`<small>${total-sem} de ${total} classificados</small>`}</div>
    ${MOTIVOS.map(([k,t])=>linha(k,t,c[k]||0,MOT_COR[k])).join("")}${linha("_sem","Sem motivo",sem,"#64748b")}</section>`;
}
function errosCaderno(){ // só entram as questões que o usuário enviou pelo botão da aba Questões
  carregarCaderno(); const out=[], env=cadernoEstado.enviados||{};
  Object.keys(env).forEach(id=>{
    const k=id.lastIndexOf("|"), L=(listas||[]).find(l=>l.id===id.slice(0,k)); if(!L)return;
    const q=(L.questoes||[]).find(x=>String(x.num)===id.slice(k+1)), g=q&&L.gabarito?.[q.num]; if(!q||!g||g==="ANULADA")return;
    out.push({id,lista:L,nomeMat:(materias.find(m=>m.id===L.materia)||{}).nome||"",q,resposta:env[id].r||L.respostas?.[q.num]||"—",gabarito:g,corr:true,ts:env[id].ts||0}); });
  return out.sort((a,b)=>a.id.localeCompare(b.id));
}
const noCaderno=id=>!!(cadernoEstado.enviados||{})[id];
function cadEnviar(id,sim){ // liga/desliga uma questão no caderno
  carregarCaderno(); cadernoEstado.enviados=cadernoEstado.enviados||{};
  const k=id.lastIndexOf("|"), L=listas.find(l=>l.id===id.slice(0,k));
  if(noCaderno(id)&&!sim){delete cadernoEstado.enviados[id]}
  else if(L){cadernoEstado.enviados[id]={r:L.respostas?.[id.slice(k+1)]||"",ts:Date.now()}}
  salvarCaderno(); return noCaderno(id);
}
function zerarCaderno(){
  carregarCaderno();
  cadernoEstado={...cadernoEstado,notas:{},revisados:{},motivos:{},enviados:{},excluidos:{},tent:{},zerado:1};
  revisaoEstado.estudos=estudos().filter(e=>!e.erroId); salvarRevisao(); salvarCaderno();
  cadMot="";cadFiltro="todas";cadQ="";cadAba="pend";cadAbertos.clear(); atualizarBadgeRevisao(); renderCaderno(); aviso("Caderno zerado. Suas listas e o desempenho não mudaram.");
}
let cadFiltro="todas", cadQ="", cadOrd="nat", cadAba="pend";
const cadAbertos=new Set(), cadRefaz={}, cadMsg={};
const SVG_CADERNO='<svg class="svg-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6z"/><path d="M6 3v18M10 8h5M10 12h5M10 16h3"/></svg>';
const SVG_CHECK='<svg class="svg-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
function cadEnviarBtn(id){ return noCaderno(id)
  ? `<button type="button" class="cd-send on" data-cdsend="${esc(id)}" title="Toque para tirar do caderno">${SVG_CHECK} No caderno de erros</button>`
  : `<button type="button" class="cd-send" data-cdsend="${esc(id)}">${SVG_CADERNO} Enviar para o caderno de erros</button>`; }
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-cdsend]"), lote=e.target.closest("[data-cdlote]");
  if(b){abrirEnviar(b.dataset.cdsend); return}
  if(lote){const L=listas.find(x=>x.id===lote.dataset.cdlote); if(!L)return; let n=0;
    L.questoes.forEach(q=>{const id=L.id+"|"+q.num; if(L.corrigidas&&L.corrigidas[q.num]&&status(L,q)==="erro"&&!noCaderno(id)){cadEnviar(id);n++}});
    document.querySelectorAll("[data-cdsend]").forEach(x=>{x.outerHTML=cadEnviarBtn(x.dataset.cdsend)}); lote.closest(".cd-lote").remove(); aviso(n+" erro"+(n>1?"s":"")+" enviado"+(n>1?"s":"")+" para o caderno.")}
});
const SVG_X='<svg class="svg-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
function abrirEnviar(id){ // mini aba: por que errei + opções, antes de mandar para o caderno
  carregarCaderno(); const k=id.lastIndexOf("|"), L=listas.find(l=>l.id===id.slice(0,k)); if(!L)return;
  const q=L.questoes.find(x=>String(x.num)===id.slice(k+1)); if(!q)return;
  const ja=noCaderno(id), mat=(materias.find(m=>m.id===L.materia)||{}).nome||"", mo=(cadernoEstado.motivos||{})[id]||"";
  let d=$("dlgEnviar");
  if(!d){d=document.createElement("dialog");d.id="dlgEnviar";d.className="sheet";document.body.appendChild(d);
    d.addEventListener("click",e=>{
      const id=d.dataset.id; if(e.target===d||e.target.closest("[data-sh-fechar]")){d.close();return}
      const m=e.target.closest("[data-sh-mot]"); if(m){const on=m.classList.contains("on");d.querySelectorAll("[data-sh-mot]").forEach(x=>{x.classList.remove("on");x.setAttribute("aria-pressed","false")});if(!on){m.classList.add("on");m.setAttribute("aria-pressed","true")}return}
      if(e.target.closest("[data-sh-ok]")){
        const tx=d.querySelector("#shTexto").value.trim(), sm=d.querySelector("[data-sh-mot].on"), eraNovo=!noCaderno(id);
        cadEnviar(id,true); cadernoEstado.motivos=cadernoEstado.motivos||{};
        if(sm)cadernoEstado.motivos[id]=sm.dataset.shMot; else delete cadernoEstado.motivos[id];
        if(tx)cadernoEstado.notas[id]=tx; else delete cadernoEstado.notas[id];
        salvarCaderno(); document.querySelectorAll("[data-cdsend]").forEach(x=>{if(x.dataset.cdsend===id)x.outerHTML=cadEnviarBtn(id)});
        const l=document.querySelector(".cd-lote"); if(l)atualizarLote(l); d.close(); aviso(eraNovo?"Enviada para o caderno de erros.":"Anotação salva."); return}
      if(e.target.closest("[data-sh-tirar]")){cadEnviar(id);document.querySelectorAll("[data-cdsend]").forEach(x=>{if(x.dataset.cdsend===id)x.outerHTML=cadEnviarBtn(id)});const l=document.querySelector(".cd-lote"); if(l)atualizarLote(l);d.close();aviso("Tirada do caderno de erros.")}
    });}
  if(!d.dataset.drag){d.dataset.drag="1";sheetDrag(d)}
  d.dataset.id=id;
  d.innerHTML=`<div class="sh"><div class="sh-grip" aria-hidden="true"></div>
    <div class="sh-h"><div><h3>${ja?"No caderno de erros":"Enviar para o caderno de erros"}</h3><p class="muted">${esc(mat||"Sem matéria")} · ${esc(L.nome)} · Questão ${esc(String(q.num))}</p></div><button type="button" class="sh-x" data-sh-fechar="1" aria-label="Fechar">${SVG_X}</button></div>
    <div class="sh-resp"><span>Você marcou <b>${esc(L.respostas?.[q.num]||"—")}</b></span><span>Gabarito <b>${esc(L.gabarito?.[q.num]||"—")}</b></span></div>
    <span class="cap">Por que errei?</span><div class="sh-mot" role="group" aria-label="Motivo do erro">${MOTIVOS.map(([k,t])=>`<button type="button" class="mot ${mo===k?"on":""}" style="--mc:${MOT_COR[k]}" data-sh-mot="${k}" aria-pressed="${mo===k}">${t}</button>`).join("")}</div>
    <label class="cap" for="shTexto">Escreva com as suas palavras</label>
    <textarea id="shTexto" rows="4" placeholder="Ex.: confundi decadência com prescrição. Regra: decadência atinge o direito de constituir o crédito.">${esc(cadernoEstado.notas[id]||"")}</textarea>
    <div class="sh-acts">${ja?'<button type="button" class="sh-rem" data-sh-tirar="1">Tirar do caderno</button>':'<button type="button" data-sh-fechar="1">Cancelar</button>'}<button type="button" class="pri" data-sh-ok="1">${ja?"Salvar":"Enviar ao caderno"}</button></div></div>`;
  d.showModal();
}
function atualizarLote(l){ const L=listas.find(x=>x.id===sel.lista); if(!L){return} const f=L.questoes.filter(q=>L.corrigidas&&L.corrigidas[q.num]&&status(L,q)==="erro"&&!noCaderno(L.id+"|"+q.num)).length; if(!f)l.remove(); else l.querySelector("span").textContent=f+" erro"+(f>1?"s":"")+" desta lista ainda fora do caderno."; }
const SVG_CHEV='<svg class="cd-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const estErro=id=>estudos().find(e=>e.erroId===id);
function cadCard(x){
  const id=x.id,n=cadernoEstado.notas[id]||"",ok=!!cadernoEstado.revisados[id],aberto=cadAbertos.has(id),rf=cadRefaz[id],msg=cadMsg[id],mo=(cadernoEstado.motivos||{})[id]||"",es=estErro(id);
  const hd=cabecalhoQuestao(x.q.enunciado||"");
  const alts=Object.entries(x.q.alternativas||{}).sort(([a],[b])=>a.localeCompare(b)).map(([l,t])=>{
    let c="",tg=""; if(rf){c=rf.sel===l?"sel":""} else if(l===x.gabarito){c="gab";tg="Gabarito"} else if(l===x.resposta){c="mar";tg="Você marcou"}
    return `<button type="button" class="cd-alt ${c}" data-cd-alt="${esc(id)}|${l}" ${rf&&!rf.fim?"":"disabled"}><i>${l}</i><span>${x.q.tipo==="CE"?t:esc(limpar(t))}</span>${tg?`<small>${tg}</small>`:""}</button>`}).join("");
  const sch=[1,7,30].map(d=>`<button type="button" class="${es&&es.agDias===d?"on":""}" data-cd-sch="${esc(id)}|${d}">${d===1?"Amanhã":"Em "+d+" dias"}</button>`).join("");
  return `<article class="cd-card ${aberto?"open":""} ${ok?"rv":""}" data-cd="${esc(id)}"><button type="button" class="cd-row" data-cd-open="${esc(id)}" aria-expanded="${aberto}"><span class="cd-n">${esc(String(x.q.num))}</span><span class="cd-t"><b>${esc(x.nomeMat||"Sem matéria")} · ${esc(x.lista.nome)}</b><small>Questão ${esc(String(x.q.num))}${mo?`<span class="cd-tag mo">${esc((MOTIVOS.find(m=>m[0]===mo)||[0,mo])[1])}</span>`:""}${es&&es.prox?`<span class="cd-tag ag">Revisão em ${fmtData(es.prox)}</span>`:""}${ok?'<span class="cd-tag rv">Revisado</span>':""}</small></span>${SVG_CHEV}</button>
  <div class="cd-det"><div class="cd-en">${enunciadoHTML(hd.resto,x.q.tabelas)}</div>${alts}
  ${rf&&!rf.fim?`<div class="cd-acts"><button type="button" class="pri" data-cd-resp="${esc(id)}" ${rf.sel?"":"disabled"}>Responder</button><button type="button" data-cd-cancel="${esc(id)}">Cancelar</button></div>`:""}
  ${msg?`<div class="cd-res ${msg.k}">${msg.t}</div>`:""}
  <div class="motivos" role="group" aria-label="Por que errei?"><span class="cap">Por que errei?</span>${MOTIVOS.map(([k,t])=>`<button type="button" class="mot ${mo===k?"on":""}" style="--mc:${MOT_COR[k]}" data-motivo="${esc(id)}|${k}" aria-pressed="${mo===k}">${t}</button>`).join("")}</div>
  <span class="cap">Regra que devo lembrar</span><textarea data-caderno-note="${esc(id)}" placeholder="Escreva a regra em uma frase…">${esc(n)}</textarea>
  <span class="cap">Voltar a revisar</span><div class="cd-sch">${sch}${es&&es.prox?`<span>Volta em ${fmtData(es.prox)}</span>`:""}</div>
  <div class="cd-acts"><button type="button" class="pri" data-cd-refaz="${esc(id)}">Refazer a questão</button><button type="button" class="ia-btn" data-cd-ia="${esc(id)}" title="Abre o DuckDuckGo Chat com a questão e o prompt de professor">Explicar com IA</button><button type="button" data-caderno-review="${esc(id)}">${ok?"Desfazer revisado":"Marcar revisado"}</button><button type="button" data-caderno-save="${esc(id)}">Salvar regra</button><button type="button" data-caderno-del="${esc(id)}" title="Tirar do caderno (continua na lista de questões)">${SVG_LIXO} Tirar do caderno</button></div></div></article>`;
}
function renderCaderno(){
  carregarCaderno(); const el=$("secCaderno"), erros=errosCaderno();
  const mot=x=>(cadernoEstado.motivos||{})[x.id]||"";
  const cab=`<div class="ctop"><div><h2>Caderno de erros</h2></div></div>`;
  if(!erros.length){el.innerHTML=`${cab}<div class="revempty">${SVG_VAZIO_REV}<b>Seu caderno está vazio.</b><p>Você escolhe o que entra aqui: na aba Questões, depois de corrigir, use o botão <b>Enviar para o caderno de erros</b> nas questões que errou.</p><button class="pri" data-secnav="questoes">Ir para Questões</button></div>`;return}
  const q=cadQ.trim().toLowerCase();
  const base=erros.filter(x=>(cadAba==="pend")!==!!cadernoEstado.revisados[x.id]).filter(x=>!cadMot||mot(x)===cadMot).filter(x=>!q||String(x.q.enunciado||"").toLowerCase().includes(q)||x.lista.nome.toLowerCase().includes(q));
  const nomes=[...new Set(base.map(x=>x.nomeMat||"Sem matéria"))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
  if(cadFiltro!=="todas"&&!nomes.includes(cadFiltro))cadFiltro="todas";
  let lista=base.filter(x=>cadFiltro==="todas"||(x.nomeMat||"Sem matéria")===cadFiltro);
  const nat=(a,b)=>(a.nomeMat||"").localeCompare(b.nomeMat||"","pt-BR")||a.lista.nome.localeCompare(b.lista.nome,"pt-BR",{numeric:true})||(+a.q.num-+b.q.num);
  if(cadOrd==="rec")lista.sort((a,b)=>b.ts-a.ts||nat(a,b)); else if(cadOrd==="mot")lista.sort((a,b)=>(mot(a)||"~").localeCompare(mot(b)||"~")||nat(a,b)); else lista.sort(nat);
  const nPend=erros.filter(x=>!cadernoEstado.revisados[x.id]).length, nRev=erros.length-nPend;
  const barra=`<div class="cd-bar"><select id="selCadMat" aria-label="Matéria"><option value="todas" ${cadFiltro==="todas"?"selected":""}>Todas as matérias (${base.length})</option>${nomes.map(n=>`<option value="${esc(n)}" ${cadFiltro===n?"selected":""}>${esc(n)} (${base.filter(x=>(x.nomeMat||"Sem matéria")===n).length})</option>`).join("")}</select>
    <select id="selCadOrd" aria-label="Ordem"><option value="nat" ${cadOrd==="nat"?"selected":""}>Ordem: lista e nº da questão</option><option value="rec" ${cadOrd==="rec"?"selected":""}>Ordem: mais recentes</option><option value="mot" ${cadOrd==="mot"?"selected":""}>Ordem: por motivo</option></select>
    <input type="search" id="cadBusca" value="${esc(cadQ)}" placeholder="Buscar no enunciado…" aria-label="Buscar"></div>
    <div class="cd-chips"><button type="button" class="chip ${cadAba==="pend"?"on":""}" data-cd-aba="pend">Pendentes (${nPend})</button><button type="button" class="chip ${cadAba==="rev"?"on":""}" data-cd-aba="rev">Revisados (${nRev})</button></div>`;
  const acoes=`<div class="cadchips">${nRev?`<button class="mini" data-cad-limpar="1">${SVG_LIXO} Remover revisadas (${nRev})</button>`:""}${erros.length?`<button class="mini" data-cad-zerar="1">Zerar caderno</button>`:""}</div>`;
  let ult="",corpo="";
  lista.forEach(x=>{ if(cadOrd==="nat"&&cadFiltro==="todas"){const m=x.nomeMat||"Sem matéria"; if(m!==ult){corpo+=`<h3 class="cadmat">${esc(m)}</h3>`;ult=m}} corpo+=cadCard(x)});
  el.innerHTML=`${cab}<div id="cadMotivos">${motivosHTML(erros)}</div>${barra}${corpo||`<div class="revempty">${SVG_VAZIO_REV}<b>Nada por aqui.</b><p>Troque o filtro, a aba ou a busca.</p></div>`}${acoes}`;
}
document.addEventListener("click",async e=>{
  const c=e.target.closest("[data-cd-open],[data-cd-aba],[data-cd-refaz],[data-cd-alt],[data-cd-resp],[data-cd-cancel],[data-cd-sch],[data-cad-zerar],[data-cad-manter]"); if(!c)return; const d=c.dataset;
  if(d.cdOpen){cadAbertos.has(d.cdOpen)?cadAbertos.delete(d.cdOpen):cadAbertos.add(d.cdOpen)}
  else if(d.cdAba)cadAba=d.cdAba;
  else if(d.cdRefaz){cadRefaz[d.cdRefaz]={sel:"",fim:false};delete cadMsg[d.cdRefaz];cadAbertos.add(d.cdRefaz)}
  else if(d.cdAlt){const k=d.cdAlt.lastIndexOf("|");if(cadRefaz[d.cdAlt.slice(0,k)])cadRefaz[d.cdAlt.slice(0,k)].sel=d.cdAlt.slice(k+1)}
  else if(d.cdCancel)delete cadRefaz[d.cdCancel];
  else if(d.cdResp){const id=d.cdResp,x=errosCaderno().find(y=>y.id===id),rf=cadRefaz[id]; if(!x||!rf)return;
    cadernoEstado.tent=cadernoEstado.tent||{}; cadernoEstado.tent[id]=(cadernoEstado.tent[id]||0)+1;
    if(rf.sel===x.gabarito){cadernoEstado.revisados[id]=Date.now();cadMsg[id]={k:"ok",t:"Acertou! Esse erro vai para Revisados."}} else cadMsg[id]={k:"no",t:`Ainda não. A resposta certa é ${esc(x.gabarito)}. Leia o gabarito e tente de novo depois.`};
    delete cadRefaz[id]; salvarCaderno()}
  else if(d.cdSch){const k=d.cdSch.lastIndexOf("|"),id=d.cdSch.slice(0,k),dias=+d.cdSch.slice(k+1),x=errosCaderno().find(y=>y.id===id); if(!x)return;
    const ex=estErro(id), hoje=isoHoje();
    if(ex&&ex.agDias===dias){revisaoEstado.estudos=estudos().filter(e=>e!==ex);aviso("Revisão removida.")}
    else{ const fe=dias===1?0:dias===7?1:3; const novo={id:"er"+Date.now().toString(36),tema:`${x.lista.nome} · Questão ${x.q.num}`,materia:x.nomeMat,data:hoje,feitas:fe,prox:somaDias(hoje,dias),erroId:id,agDias:dias};
      if(ex)Object.assign(ex,novo,{id:ex.id}); else estudos().push(novo); aviso("Revisão agendada para "+fmtData(somaDias(hoje,dias))+".")}
    salvarRevisao(); atualizarBadgeRevisao()}
  else if(d.cadZerar!==undefined){if(!await uiConfirm("Zerar o caderno de erros?\n\nTodos os erros atuais, anotações, motivos e revisões agendadas dos erros saem do caderno.\nSuas listas, respostas e o desempenho NÃO mudam."))return;zerarCaderno();return}
    renderCaderno();
});
document.addEventListener("input",e=>{if(e.target.id==="cadBusca"){cadQ=e.target.value;const p=e.target.selectionStart;renderCaderno();const n=$("cadBusca");if(n){n.focus();n.setSelectionRange(p,p)}}});
document.addEventListener("click",async e=>{
  const t=e.target.closest("[data-caderno-review],[data-caderno-save],[data-cadfiltro],[data-caderno-del],[data-cad-limpar],[data-cad-restaurar],[data-motivo],[data-motfiltro]"); if(!t)return;
  if(t.dataset.motfiltro!==undefined){cadMot=(t.dataset.motfiltro===cadMot||t.dataset.motfiltro==="_sem")?"":t.dataset.motfiltro;renderCaderno();return}
  if(t.dataset.motivo){carregarCaderno();const _v=t.dataset.motivo,_i=_v.lastIndexOf("|"),id=_v.slice(0,_i),k=_v.slice(_i+1);cadernoEstado.motivos=cadernoEstado.motivos||{};if(cadernoEstado.motivos[id]===k)delete cadernoEstado.motivos[id];else cadernoEstado.motivos[id]=k;salvarCaderno();
    t.closest(".motivos").querySelectorAll(".mot").forEach(b=>{const on=cadernoEstado.motivos[id]===b.dataset.motivo.slice(b.dataset.motivo.lastIndexOf("|")+1);b.classList.toggle("on",on);b.setAttribute("aria-pressed",on)});
    const h=$("cadMotivos");if(h)h.innerHTML=motivosHTML(errosCaderno());return}
  if(t.dataset.cadfiltro!==undefined){cadFiltro=t.dataset.cadfiltro;renderCaderno();return}
  carregarCaderno();
  const marcarExc=ids=>{cadernoEstado.enviados=cadernoEstado.enviados||{};ids.forEach(i=>{delete cadernoEstado.enviados[i]});salvarCaderno();renderCaderno()};
  if(t.dataset.cadernoDel){if(await uiConfirm("Tirar esta questão do caderno de erros? Ela continua na sua lista de questões e você pode enviá-la de novo pela aba Questões."))marcarExc([t.dataset.cadernoDel]);return}
  if(t.dataset.cadLimpar!==undefined){const ids=errosCaderno().filter(x=>cadernoEstado.revisados[x.id]).map(x=>x.id);if(ids.length&&await uiConfirm(`Tirar ${ids.length} questão(ões) já revisada(s) do caderno? Elas continuam na sua lista de questões.`))marcarExc(ids);return}
  if(t.dataset.cadRestaurar!==undefined){if(await uiConfirm("Trazer de volta todas as questões excluídas do caderno?")){cadernoEstado.excluidos={};salvarCaderno();renderCaderno()}return}
  if(t.dataset.cadernoReview){const id=t.dataset.cadernoReview; if(cadernoEstado.revisados[id])delete cadernoEstado.revisados[id]; else cadernoEstado.revisados[id]=Date.now(); salvarCaderno(); renderCaderno(); return}
  if(t.dataset.cadernoSave){const id=t.dataset.cadernoSave, ta=[...document.querySelectorAll("[data-caderno-note]")].find(x=>x.dataset.cadernoNote===id); if(ta){const v=ta.value.trim(); if(v)cadernoEstado.notas[id]=v; else delete cadernoEstado.notas[id]; salvarCaderno(); aviso("Regra salva.");}}
});
function resumoQuestoes(){
  let ac=0,er=0,pend=0;
  (listas||[]).forEach(L=>(L.questoes||[]).forEach(q=>{const r=L.respostas?.[q.num],g=L.gabarito?.[q.num]; if(r&&g&&g!=="ANULADA"){if(r===g)ac++;else er++}else pend++}));
  const corr=ac+er; return {ac,er,pend,corr,pct:corr?Math.round(ac/corr*100):0};
}
function materiaRecomendada(){
  return (materias||[]).map(m=>{let ac=0,er=0,pend=0; (listas||[]).filter(l=>l.materia===m.id).forEach(l=>(l.questoes||[]).forEach(q=>{const r=l.respostas?.[q.num],g=l.gabarito?.[q.num]; if(r&&g&&g!=="ANULADA"){if(r===g)ac++;else er++}else pend++}));
    const corr=ac+er; return {m,ac,er,pend,pct:corr?Math.round(ac/corr*100):0,score:er*3+pend*0.15}}).sort((a,b)=>b.score-a.score)[0];
}
function sequenciaDias(){let n=0,d=isoHoje(); if(!ativDias.includes(d))d=somaDias(d,-1); while(ativDias.includes(d)){n++;d=somaDias(d,-1)} return n}
const EI_ICO={
  alvo:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/></svg>',
  livro:'<svg viewBox="0 0 24 24"><path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/></svg>',
  ciclo:'<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>',
  erro:'<svg viewBox="0 0 24 24"><path d="M6 4h12v16H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
  ok:'<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
};
const SVG_LIVRO='<svg class="ei-deco" viewBox="0 0 200 160" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M100 44C80 32 46 32 20 40V124C46 116 80 116 100 128Z"/><path d="M100 44C120 32 154 32 180 40V124C154 116 120 116 100 128Z"/><path d="M100 44V128"/><path d="M38 58C54 55 70 56 84 61M38 74C54 71 70 72 84 77M38 90C54 87 70 88 84 93"/><path d="M116 61C130 56 146 55 162 58M116 77C130 72 146 71 162 74M116 93C130 88 146 87 162 90"/><path d="M150 18V32M143 25H157M176 6V14M172 10H180M118 10V16M115 13H121"/></svg>';
const SVG_MAIS='<svg class="ei-btn-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const SVG_SETA='<svg class="ei-btn-ico" viewBox="0 0 24 24" aria-hidden="true" style="margin:0 0 0 6px"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const SVG_SINO='<svg class="svg-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/></svg>';
const SVG_VAZIO_REV='<svg class="vazio-svg" viewBox="0 0 150 110" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="30" y="22" width="90" height="70" rx="10"/><path d="M30 42h90M52 12v18M98 12v18"/><path d="M56 66l12 12 26-26"/><path d="M128 22v10M123 27h10M18 70v8M14 74h8"/></svg>';
const SVG_LIXO='<svg class="svg-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg>';
const anel=p=>`<svg class="ei-ring" viewBox="0 0 64 64" role="img" aria-label="${Math.round(p)}% da apostila lida"><circle class="tr" cx="32" cy="32" r="26" fill="none" stroke-width="6"/><circle class="pg" cx="32" cy="32" r="26" fill="none" stroke-width="6" stroke-dasharray="${(p/100*163.4).toFixed(1)} 163.4"/><text x="32" y="37" text-anchor="middle">${Math.round(p)}%</text></svg>`;
const META_KEY="meta_dia";
const metaDia=()=>Math.max(1,parseInt(localStorage.getItem(META_KEY)||"20",10)||20);
const saudacaoHora=()=>{const h=new Date().getHours();return h<5?"Boa madrugada":h<12?"Bom dia":h<18?"Boa tarde":"Boa noite"};
const SVG_LAPIS='<svg class="svg-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>';
function inicioSkeleton(){
  return `<div class="hm-head"><div><div class="sk" style="width:120px;height:14px"></div><div class="sk" style="width:150px;height:34px;margin-top:8px"></div></div></div>
  <div class="hm-g2"><div class="hm-c1"><div class="sk" style="height:250px;border-radius:22px"></div>
    <div class="sk" style="height:22px;width:160px;margin:26px 0 12px"></div>${[0,1,2].map(()=>'<div class="sk" style="height:64px;border-radius:14px;margin-bottom:8px"></div>').join("")}</div>
  <div class="hm-c2"><div class="sk" style="height:96px;border-radius:20px"></div><div class="sk" style="height:84px;border-radius:16px;margin-top:20px"></div><div class="sk" style="height:140px;border-radius:16px;margin-top:20px"></div></div></div>`;
}
function renderInicio(){
  const el=$("secInicio"); if(!el)return;
  if(!listasOk){el.innerHTML=inicioSkeleton();return}
  carregarCaderno();
  const bruto=(user&&(user.displayName||user.email))||"", nome=(localStorage.getItem("nome_exibicao")||bruto.split("@")[0].split(/[._\s-]/)[0]||"").replace(/^./,c=>c.toUpperCase());
  if(!localStorage.getItem("nome_ok")&&!localStorage.getItem("nome_exibicao")&&nome.length>10){try{localStorage.setItem("nome_ok","1")}catch(e){}setTimeout(editarNome,500)}
  const q=resumoQuestoes(), rec=materiaRecomendada(), itens=apOrdenados(), concl=itens.filter(x=>x.concluida).length;
  const lendo=itens.find(x=>!x.concluida&&(x.pagina||1)>1)||itens.find(x=>!x.concluida);
  const venc=revVencidas(), lista=revHoje(), seq=sequenciaDias(), hoje=isoHoje();
  const erros=errosCaderno().filter(x=>!cadernoEstado.revisados[x.id]).length;
  const [ac,er]=histDia[hoje]||[0,0], feitas=ac+er, meta=metaDia(), pct=Math.min(100,Math.round(feitas/meta*100)), falta=Math.max(0,meta-feitas);
  const C=2*Math.PI*38;
  const anelMeta=`<svg class="ringw" viewBox="0 0 92 92" role="img" aria-label="${pct}% da meta diária"><circle class="t" cx="46" cy="46" r="38"/><circle class="p" cx="46" cy="46" r="38" data-dash="${(pct/100*C).toFixed(1)} ${C.toFixed(1)}" stroke-dasharray="0 ${C.toFixed(1)}"/><text x="46" y="52" text-anchor="middle">${pct}%</text></svg>`;
  const pontos=[...Array(7)].map((_,i)=>somaDias(hoje,i-6)).map(d=>{const f=ativDias.includes(d)||(d===hoje&&feitas>0);return `<i class="${f?"f":""}">${f?EI_ICO.ok:""}</i>`}).join("");
  const cta=venc.length?`<button class="cta" data-secnav="revisao">Começar ${venc.length} revis${venc.length>1?"ões":"ão"}${SVG_SETA}</button>`
    :`<button class="cta" data-secnav="${rec?"questoes":"simulado"}">${rec?"Fazer questões":"Montar um simulado"}${SVG_SETA}</button>`;
  const stat=(t,v,suf,s)=>`<div><span class="cap">${t}</span><b>${v}${suf||""}</b><span class="s">${s}</span></div>`;
  const leitura=lendo?`<button type="button" class="read" data-aplib="${esc(lendo.id)}"><span class="ic">${EI_ICO.livro}</span><span class="tx"><b>${esc(lendo.nome||"")}</b><small>${esc(lendo.materia||"Sem matéria")} · ${(lendo.pagina||1)>1?`página ${lendo.pagina} de ${lendo.total}`:`${lendo.total} páginas`}</small></span>${anel(lendo.total?Math.min(100,Math.max(2,(lendo.pagina||1)/lendo.total*100)):0)}</button>`
    :`<div class="read"><span class="ic">${EI_ICO.livro}</span><span class="tx"><b>${itens.length?"Todas as apostilas concluídas":"Envie sua primeira apostila"}</b><small>${itens.length?"Envie a próxima para continuar.":"O site lembra a página onde você parou."}</small></span><button type="button" class="small" data-apup="1">Enviar</button></div>`;
  const NR=5, isMob=matchMedia("(max-width:720px)").matches;
  const revisoes=lista.length?`<div class="rvlista compact mini">${lista.slice(0,NR).map(e=>revLinhaHTML(e,true)).join("")}</div>${lista.length>NR?`<button type="button" class="rv-all" data-secnav="revisao">Ver todas (${lista.length})${SVG_SETA}</button>`:""}`
    :`<div class="vazio-card">${SVG_VAZIO_REV}<b>Nenhuma revisão para hoje</b><p>Marque uma apostila como “Terminei” e o site agenda as revisões de 24 horas, 7 e 30 dias.</p><button class="pri" data-secnav="conteudo">Ir para Conteúdo</button></div>`;
const QA=(sec,t,ico,bd)=>`<button type="button" class="qa-b" ${sec==="apup"?'data-apup="1"':`data-secnav="${sec}"`}><span class="qa-i"><svg viewBox="0 0 24 24" aria-hidden="true">${ico}</svg>${bd?`<i class="bd">${bd}</i>`:""}</span>${t}</button>`;
  const qaHTML=`<div class="hm-qa">${QA("questoes","Questões",'<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>')}${QA("simulado","Simulado",'<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 3h6"/>')}${QA("caderno","Caderno",'<path d="M6 4h12v16H6z"/><path d="M9 9h6M9 13h6"/>',erros||"")}${QA("apup","Apostila",'<path d="M12 5v14M5 12h14"/>')}</div>`;
  el.innerHTML=`<div class="hm-head"><div><span class="cap">${saudacaoHora()}${nome?`, <span id="nomeEd" title="Clique para mudar o nome" style="cursor:pointer">${esc(nome)}</span>`:""}</span><h1>Hoje</h1></div>
      <div class="ei-right"><button class="ei-cta" data-apup="1">${SVG_MAIS}Enviar apostila</button>${userCluster(nome)}</div></div>
    <div class="hm-g2"><div class="hm-c1">
      <section class="hoje">${SVG_LIVRO}<span class="cap">Meta do dia</span>
        <div class="hrow"><div><div class="big"><b data-to="${feitas}">0</b><span>de ${meta} questões</span><button type="button" class="meta-ed" data-metaed="1" title="Mudar a meta diária" aria-label="Mudar a meta diária">${SVG_LAPIS}</button></div><p>${falta?`Faltam ${falta} para bater a meta`:"Meta batida. Bom trabalho!"}</p></div>${anelMeta}</div>
        <div class="dots" aria-label="${seq} dias seguidos">${pontos}<span>${seq?`${seq} dia${seq>1?"s":""} seguido${seq>1?"s":""}`:"Comece hoje"}</span></div>${cta}</section>
      ${qaHTML}
      <div class="hm-rev"><div class="sec-h"><h2>Revisões de hoje${lista.length?` <span class="cnt">${lista.length}</span>`:""}</h2></div>${revisoes}</div>
    </div><div class="hm-c2">
      <div class="hm-stats">${stat("Acerto",q.corr?`<span data-to="${q.pct}">0</span>`:"—",q.corr?"%":"",`${q.corr} questões`)}${stat("Apostilas",`<span data-to="${concl}">0</span>`,`/${itens.length}`,itens.length?"concluídas":"nenhuma enviada")}${stat("Erros",`<span data-to="${erros}">0</span>`,"",erros===1?"pendente":"pendentes")}</div>
      <div class="hm-lendo"><div class="sec-h"><h2>Continuar lendo</h2></div>${leitura}</div>
      <div class="ei-card ei-rec"><span class="ei-sico big">${EI_ICO.alvo}</span><div><b>Matéria para reforçar</b><p>${rec?`${esc(rec.m.nome)} · ${rec.er} erros · ${rec.pct}% de acerto`:"Cadastre questões para receber uma sugestão."}</p></div><button data-secnav="questoes">Abrir questões${SVG_SETA}</button></div>
    </div></div>
    <details class="hm-desemp" ${isMob?"":"open"}><summary><h2>Desempenho</h2><span class="chv2" aria-hidden="true"></span></summary>${eiGraficos()}</details>`;
  document.dispatchEvent(new CustomEvent("af:render",{detail:{secao:"inicio",el}}));
}
// Substitui a navegação antiga sem tocar na persistência do Cronograma.
mostrarSecao=function(sec){secao=sec;saveUi();["inicio","questoes","diagnostico","caderno","conteudo","revisao","cronograma","simulado"].forEach(k=>{const e=$("sec"+k[0].toUpperCase()+k.slice(1));if(e)e.hidden=k!==sec});document.querySelectorAll(".mi").forEach(b=>b.classList.toggle("on",b.dataset.sec===sec));if(sec==="inicio")renderInicio();else if(sec==="questoes")render();else if(sec==="diagnostico")renderDiag();else if(sec==="caderno")renderCaderno();else if(sec==="conteudo")renderConteudo();else if(sec==="revisao")renderRevisao();else if(sec==="simulado"&&window.AF&&AF.simulado)AF.simulado.render($("secSimulado"))};
// Evita reabrir a aba removida mesmo se uma preferência antiga apontar para cronograma.
if(secao==="cronograma")secao="inicio";

document.addEventListener("click",e=>{
  const t=e.target.closest("[data-secnav]");if(!t)return;
  mostrarSecao(t.dataset.secnav);
});

// Carrega a configuração de revisão sem interferir nos listeners existentes.
onAuthStateChanged(auth,u=>{
  if(revUnsub){try{revUnsub()}catch(e){}revUnsub=null}
  if(!u)return;
  const local=revLocal();if(local)revisaoEstado={...revisaoEstado,...local}; carregarCaderno(); atualizarBadgeRevisao();
  revUnsub=onSnapshot(cfgRef("revisao_ia"),s=>{if(s.exists()){revisaoEstado={...revisaoEstado,...s.data()};atualizarBadgeRevisao();if(secao==="revisao")renderRevisao();if(secao==="inicio")renderInicio()}},()=>{});
  setTimeout(()=>{if(secao==="inicio")mostrarSecao("inicio")},150);
});


/* ===== Biblioteca de apostilas (Conteúdo) ===== */
// Ao enviar um PDF, o site lê o texto de cada página e salva na nuvem (Firebase), como já faz com as questões.
// Nome, matéria, última página e data de conclusão ficam em users/{uid}/config/apostilas.
// O texto das páginas fica em users/{uid}/config/apostila_{id}_{bloco} (12 páginas por bloco).
const fmtDataC=iso=>{if(!iso)return "";const [y,m,d]=iso.split("-");return `${d}/${m}/${y}`};
const AP_BLOCO=12;
let apEstado={itens:[],ts:0}, apMsg="", apBusy=false, tAp, apUnsub=null, atvUnsub=null;
const apTextoCache={};
const apKey=()=>"apostilas_lib_"+(user?user.uid:"");
const apItem=id=>apEstado.itens.find(x=>x.id===id);
const apNovoId=()=>"ap"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const apBlocoRef=(id,k)=>cfgRef(`apostila_${id}_${k}`);

// ---- constância: dias com alguma atividade (questão, página lida, revisão feita)
const ATIV_KEY="atividade_dias";
let ativDias=(()=>{try{return JSON.parse(localStorage.getItem(ATIV_KEY)||"[]")}catch(e){return []}})();
function marcarAtividade(){
  const h=isoHoje(); if(ativDias.includes(h))return;
  ativDias=[...ativDias,h].sort().slice(-180);
  try{localStorage.setItem(ATIV_KEY,JSON.stringify(ativDias))}catch(e){}
  if(user)setDoc(cfgRef("atividade"),{dias:ativDias}).catch(()=>{});
}

// ---- texto das páginas na nuvem
const apBytes=s=>new TextEncoder().encode(s).length;
async function apLerPdf(f,progresso){
  await garantirPdfjs();
  const pdf=await pdfjsLib.getDocument({data:await f.arrayBuffer()}).promise, paginas=[];
  for(let p=1;p<=pdf.numPages;p++){
    const pg=await pdf.getPage(p); paginas.push(await linhasDaPagina(pg)); try{pg.cleanup()}catch(e){}
    if(p%5===0||p===pdf.numPages){progresso(p,pdf.numPages);await new Promise(r=>setTimeout(r))}
  }
  const total=pdf.numPages; try{pdf.destroy()}catch(e){}
  // cabeçalhos/rodapés repetidos nas margens e marcas d'água saem, como no leitor de questões
  const cont=new Map();
  paginas.forEach(ls=>new Set(ls.filter(l=>l.z).map(l=>chaveLinha(l.t))).forEach(k=>cont.set(k,(cont.get(k)||0)+1)));
  const limite=Math.max(3,Math.ceil(total*0.3));
  const lixo=l=>LIXO.test(l.t)||(l.z&&chaveLinha(l.t).length>=8&&cont.get(chaveLinha(l.t))>=limite);
  return {total,textos:paginas.map(ls=>ls.filter(l=>!lixo(l)).map(l=>l.t).join("\n"))};
}
async function apGravarTexto(id,textos,progresso){
  const nb=Math.ceil(textos.length/AP_BLOCO);
  for(let k=0;k<nb;k++){
    const paginas={}; textos.slice(k*AP_BLOCO,(k+1)*AP_BLOCO).forEach((t,i)=>{paginas[String(k*AP_BLOCO+i+1)]=t});
    if(apBytes(JSON.stringify(paginas))>900000)throw new Error("as páginas têm texto demais para salvar (limite do Firebase)");
    await setDoc(apBlocoRef(id,k),{id,bloco:k,paginas});
    progresso(k+1,nb);
  }
}
async function apApagarTexto(it){
  const nb=Math.ceil((it.total||0)/AP_BLOCO);
  for(let k=0;k<nb;k++){try{await deleteDoc(apBlocoRef(it.id,k))}catch(e){}}
  delete apTextoCache[it.id];
}
async function apTextoPagina(it,n){
  const k=Math.floor((n-1)/AP_BLOCO), c=apTextoCache[it.id]||(apTextoCache[it.id]={});
  if(!c[k]){
    const s=await getDoc(apBlocoRef(it.id,k));
    c[k]=s.exists()?(s.data().paginas||{}):{};
  }
  return c[k][String(n)]||"";
}
async function apLinhasLib(n){
  const it=apItem(apAtiva); if(!it)return [];
  const t=await apTextoPagina(it,n);
  if(n%AP_BLOCO===0&&n<it.total)apTextoPagina(it,n+1).catch(()=>{}); // adianta o próximo bloco
  return t.split("\n").filter(l=>l.trim()&&!LIXO.test(l)).map(l=>({t:l}));
}
async function formatarLibIA(){
  const c=cfgIA(), it=apItem(apAtiva); if(!it||!apPdf)return;
  const de=+$("lPag").value||1, ate=Math.min(apPdf.numPages,de+(+$("lQtd").value||3)-1), k=`lib|${c.prov||"gemini"}|${c.model||""}|${de}-${ate}`;
  const corpo=$("lCorpo");
  if(apCache[k]){corpo.innerHTML=apCache[k];return}
  corpo.innerHTML=`<p class="muted">🤖 Organizando as páginas ${de} a ${ate}…</p>`;
  try{
    let txt=""; for(let p=de;p<=ate;p++)txt+=`\n\n[Página ${p}]\n`+await apTextoPagina(it,p);
    const r=await chamarProvedor(c,SISTEMA_APOSTILA,`Transforme em HTML limpo o texto bruto extraído das páginas ${de} a ${ate} de uma apostila. A ordem das colunas de tabelas pode estar embaralhada: reconstrua com cuidado e não invente nada.\n${txt}`,null,"apostila.txt");
    apCache[k]=`<div class="gemhtml">${sanitizarHTML(r.txt)}</div><p class="muted">Páginas ${de}–${ate} · organizado por ${esc(r.modelo)}</p>`;
    corpo.innerHTML=apCache[k];
  }catch(e){corpo.innerHTML=`<p>❌ ${esc(e.message)}</p>`}
}

function apSalvar(agora){
  apEstado.ts=Date.now();
  try{localStorage.setItem(apKey(),JSON.stringify(apEstado))}catch(e){}
  clearTimeout(tAp);
  const enviar=()=>{if(user)setDoc(cfgRef("apostilas"),apEstado).catch(e=>console.warn("apostilas:",e.message))};
  if(agora)enviar();else tAp=setTimeout(enviar,1500);
}
function apStatus(m){apMsg=m||"";const e=$("apStatus");if(e)e.textContent=apMsg}
function apSyncFeito(){const it=apAtiva&&apItem(apAtiva),b=$("lFeitoBox");if(b){b.hidden=!it;if(it)$("lFeito").checked=!!it.concluida}}
function apAtualizarTela(suave){
  if(suave){const a=document.activeElement;if(a&&a.closest&&a.closest(".apcard")&&/INPUT/.test(a.tagName))return}
  if(secao==="conteudo")renderConteudo(); else if(secao==="inicio")renderInicio();
  apSyncFeito(); apFolhaAtualiza();
}

function apOrdenados(){
  const nat=(a,b)=>String(a.nome).localeCompare(String(b.nome),"pt-BR",{numeric:true,sensitivity:"base"});
  const em=apEstado.itens.filter(x=>!x.concluida).sort((a,b)=>(b.lido||0)-(a.lido||0)||nat(a,b));
  const ok=apEstado.itens.filter(x=>x.concluida).sort((a,b)=>String(b.data).localeCompare(String(a.data))||nat(a,b));
  return [...em,...ok];
}
function apCard(it){
  const pg=it.pagina||1, pct=it.total?Math.min(100,Math.max(2,pg/it.total*100)):0;
  const det=it.concluida?`Concluída em ${fmtDataC(it.data)} · enviada para Revisão`:`${pg>1?`Parou na página ${pg}`:"Ainda não começou"}${it.total?` · ${it.total} páginas`:""}`;
  const btn=it.concluida?"Reabrir":pg>1?"Continuar":"Começar", tit=it.concluida?"Abrir de novo":pg>1?`Continuar na página ${pg}`:"Começar a ler";
  return `<div class="mcard apcard aprow ${it.concluida?"feita":""}">
    <label class="apcheck" title="Marcar como concluída e enviar para Revisão"><input type="checkbox" data-apdone="${esc(it.id)}" ${it.concluida?"checked":""}><span>Terminei</span></label>
    <div class="apmain"><input class="apnome" data-apf="nome" data-apid="${esc(it.id)}" value="${esc(it.nome||"")}" title="${esc(it.nome||"")}" aria-label="Nome da apostila"><div class="apdet">${esc(det)}</div></div>
    <div class="apbar" aria-hidden="true"><i style="width:${it.concluida?100:pct.toFixed(1)}%"></i></div>
    <select class="apmat" data-apf="materia" data-apid="${esc(it.id)}" aria-label="Matéria (mudar de matéria)">${apOpcoes(apCanon(it.materia))}</select>
    <button class="${it.concluida?"":"pri"}" data-aplib="${esc(it.id)}" title="${esc(tit)}">${esc(btn)}</button>
    <button class="ico apdel" data-apdel="${esc(it.id)}" title="Remover apostila" aria-label="Remover apostila">🗑️</button>
  </div>`;
}
let apInitAb=false; // na primeira vez, já abre a matéria que você está lendo
const AP_MATERIAS=["Direito tributário","Contabilidade","Direito administrativo","Direito constitucional","Auditoria","Português","Raciocínio lógico","Tecnologia da informação"];
let apMatPend="";
const apCanon=v=>{v=(v||"").trim();return AP_MATERIAS.find(m=>sem(m)===sem(v))||v};
function apOpcoes(atual){
  const extra=atual&&!AP_MATERIAS.includes(atual)?[atual]:[];
  return `<option value="">Sem matéria</option>`+[...AP_MATERIAS,...extra].map(m=>`<option value="${esc(m)}" ${m===atual?"selected":""}>${esc(m)}</option>`).join("");
}
/* ===== Celular: tocar na matéria abre uma folha com todas as apostilas dela ===== */
let apMatFolha=null;
function apFolhaHTML(nome){
  const l=apOrdenados().filter(x=>apCanon(x.materia)===nome), f=l.filter(x=>x.concluida).length, pc=l.length?Math.round(f/l.length*100):0;
  return `<div class="sh"><div class="sh-grip" aria-hidden="true"></div>
    <div class="sh-h apm-h"><span class="apic">${esc((nome||"?").trim().charAt(0).toUpperCase())}</span><div class="aptx"><b>${esc(nome||"Sem matéria")}</b><span class="count">${l.length?`${f} de ${l.length} concluída${f===1?"":"s"}`:"nenhuma apostila ainda"}</span></div><button class="mini apsecbtn" data-apup="${esc(nome)}">+ Enviar</button><button type="button" class="sh-x" data-apfechar="1" aria-label="Fechar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    ${l.length?`<div class="apm-prog"><i style="width:${pc}%"></i></div>`:""}
    <div class="apm-body">${l.length?`<div class="aplist">${l.map(apCard).join("")}</div>`:'<p class="muted" style="margin:6px 2px">Nenhuma apostila ainda. Use “+ Enviar”.</p>'}</div></div>`;
}
function apFolhaAbrir(nome){
  apMatFolha=nome; let d=$("dlgApMat");
  if(!d){
    d=document.createElement("dialog"); d.id="dlgApMat"; d.className="sheet apm"; document.body.appendChild(d); sheetDrag(d);
    d.addEventListener("close",()=>{apMatFolha=null});
    d.addEventListener("click",e=>{if(e.target===d||e.target.closest("[data-apfechar]"))d.close()});
  }
  d.innerHTML=apFolhaHTML(nome); d.showModal(); if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();
}
function apFolhaAtualiza(){ // mantém a folha em dia quando você marca, renomeia ou remove uma apostila
  const d=$("dlgApMat"); if(!d||!d.open||apMatFolha===null)return;
  const sc=d.querySelector(".apm-body"), t=sc?sc.scrollTop:0; d.innerHTML=apFolhaHTML(apMatFolha);
  const sc2=d.querySelector(".apm-body"); if(sc2)sc2.scrollTop=t;
}
document.addEventListener("click",e=>{
  if(!matchMedia("(max-width:720px)").matches)return;
  const h=e.target.closest("[data-apt]"); if(!h||e.target.closest("button"))return;
  e.stopImmediatePropagation(); const sc=h.closest(".apsec"); apFolhaAbrir(sc?sc.dataset.apk||"":"");
},true);

function apostilasHTML(){
  const itens=apOrdenados(), grupos=new Map();
  AP_MATERIAS.forEach(m=>grupos.set(m,[]));
  itens.forEach(it=>{const k=apCanon(it.materia);if(!grupos.has(k))grupos.set(k,[]);grupos.get(k).push(it)});
  const extras=[...grupos.keys()].filter(k=>k&&!AP_MATERIAS.includes(k)).sort((a,b)=>a.localeCompare(b,"pt-BR"));
  const ordem=[...AP_MATERIAS,...extras]; if((grupos.get("")||[]).length)ordem.push("");
  if(!apInitAb){apInitAb=true; if(!apAbertas.size){const t=itens.find(x=>!x.concluida&&(x.pagina||1)>1)||itens.find(x=>!x.concluida)||itens[0]; if(t)apAbertas.add(apCanon(t.materia))}}
  const sec=nome=>{
    const l=grupos.get(nome)||[], f=l.filter(x=>x.concluida).length;
    const ab=apAbertas.has(nome), pc=l.length?Math.round(f/l.length*100):0;return `<div class="apsec ${ab?"aberta":""}" data-apk="${esc(nome)}"><div class="sechead ${l.length?"":"vazia"}" data-apt="1"><span class="apic">${esc((nome||"?").trim().charAt(0).toUpperCase())}</span><div class="aptx"><b>${esc(nome||"Sem matéria")}</b><span class="count">${l.length?`${f} de ${l.length} concluída${f===1?"":"s"}`:"nenhuma apostila ainda"}</span></div>${l.length?`<span class="appct ${pc===100?"ok":""}">${pc}%</span>`:""}<button class="mini apsecbtn" data-apup="${esc(nome)}">+ Enviar</button><span class="chev">›</span>${l.length?`<div class="approg"><i style="width:${pc}%"></i></div>`:""}</div><div class="apbody">${l.length?`<div class="aplist">${l.map(apCard).join("")}</div>`:'<p class="muted" style="margin:0">Nenhuma apostila ainda. Use “+ Enviar”.</p>'}</div></div>`;
  };
  const nT=itens.length, nOk=itens.filter(x=>x.concluida).length, pT=nT?Math.round(nOk/nT*100):0;
  const resumo=`<div class="apresumo"><div class="apring" style="--p:${pT}"><span>${pT}%</span></div><div class="aprtx"><b>${nOk} de ${nT} apostila${nT===1?"":"s"} concluída${nOk===1?"":"s"}</b><small>${!nT?"Envie sua primeira apostila para começar.":nOk===nT?"Tudo concluído. Excelente!":`Faltam ${nT-nOk} para concluir tudo.`}</small></div></div>`;
  return `<section class="apblock"><div class="apstatus" id="apStatus" role="status">${esc(apMsg)}</div>${resumo}${ordem.map(sec).join("")}</section>`;
}

async function apEnviar(arquivos,materia){
  if(apBusy){aviso("Aguarde: já existe um envio em andamento.");return}
  apBusy=true; let ok=0; apAbertas.add(materia||"");
  try{
    for(let i=0;i<arquivos.length;i++){
      const f=arquivos[i], pref=arquivos.length>1?`(${i+1}/${arquivos.length}) `:"";
      if(!/\.pdf$/i.test(f.name)&&f.type!=="application/pdf"){aviso(`${f.name}: não é um PDF.`);continue}
      const id=apNovoId(); let tot=0;
      try{
        apStatus(`${pref}Lendo ${f.name}…`);
        const {total,textos}=await apLerPdf(f,(p,t)=>apStatus(`${pref}Lendo ${f.name}: página ${p} de ${t}`));
        tot=total;
        const comTexto=textos.filter(t=>t.trim()).length;
        apStatus(`${pref}Salvando ${f.name} na nuvem…`);
        await apGravarTexto(id,textos,(b,nb)=>apStatus(`${pref}Salvando ${f.name} na nuvem (${b}/${nb})…`));
        try{await apPdfSalvar(id,f)}catch(e){console.warn("PDF local:",e)}
        apEstado.itens.push({id,nome:f.name.replace(/\.pdf$/i,""),materia:materia||"",arquivo:f.name,total,pagina:1,concluida:false,data:"",lido:0,texto:true});
        apSalvar(true); ok++; apAtualizarTela();
        if(comTexto<total*0.5)aviso(`${f.name}: muitas páginas sem texto (podem ser imagens). Elas aparecerão em branco no leitor.`);
      }catch(e){
        if(tot)apApagarTexto({id,total:tot});
        aviso(`Não consegui salvar ${f.name}: ${e.message||e}`);
      }
    }
  }finally{
    apBusy=false;
    apStatus(ok?`${ok} apostila${ok>1?"s":""} salva${ok>1?"s":""} na nuvem.`:"");
    if(ok)setTimeout(()=>apStatus(""),4000);
    apAtualizarTela();
  }
}
async function lerApostilaLib(id,pag){
  const it=apItem(id);if(!it)return;
  if(!it.texto&&!it.driveId){aviso("Esta apostila foi enviada na versão anterior e não está na nuvem. Remova e envie o PDF de novo.");return}
  apAtiva=id; apArq=null; apCache={}; retomarAp=null;
  apPdf={numPages:it.total||1,lib:true};
  apMeta={sec:"",i:-1,nome:it.materia||"",material:it.nome};
  $("lTitulo").textContent=it.nome; $("lSub").textContent=apCanon(it.materia)||"";
  apSyncFeito();
  if(!$("dlgLeitor").open)$("dlgLeitor").showModal();
  apIniciarLeitura(it,pag||it.pagina||1);
}
function apostilaPagina(n){
  if(!apAtiva)return; const it=apItem(apAtiva);if(!it)return;
  it.pagina=n; it.lido=Date.now(); apSalvar();
}
async function apostilaMarcar(id,feito){
  const it=apItem(id);if(!it)return;
  const rv=estudos();
  if(feito){
    it.concluida=true; it.data=isoHoje();
    if(!rv.some(x=>x.apostila===id)){
      rv.push({id:"e"+Date.now().toString(36)+Math.random().toString(36).slice(2,5),materia:it.materia||"",tema:it.nome,data:it.data,feitas:0,prox:somaDias(it.data,REV_INT[0]),ts:Date.now(),apostila:id});
    }
    marcarAtividade(); salvarRevisao(); atualizarBadgeRevisao();
    aviso(`Apostila concluída em ${fmtDataC(it.data)}! 1ª revisão em ${fmtData(somaDias(it.data,REV_INT[0]))}.`);
  }else{
    const ex=rv.find(x=>x.apostila===id);
    if(ex&&ex.feitas>0&&!await uiConfirm("Esta apostila já teve revisões feitas. Desmarcar apaga esse acompanhamento da aba Revisão. Continuar?")){apAtualizarTela();return}
    revisaoEstado.estudos=rv.filter(x=>x.apostila!==id); salvarRevisao(); atualizarBadgeRevisao();
    it.concluida=false; it.data="";
  }
  apSalvar(true); apAtualizarTela();
}

document.addEventListener("click",async e=>{
  const t=e.target.closest("[data-aplib],[data-apdel],[data-apup]");if(!t)return;
  if(t.dataset.apup!==undefined){apMatPend=t.dataset.apup==="1"?"":t.dataset.apup;$("apUp").value="";$("apUp").click();return}
  if(t.dataset.aplib){lerApostilaLib(t.dataset.aplib);return}
  if(t.dataset.apdel){
    const it=apItem(t.dataset.apdel);if(!it)return;
    if(!await uiConfirm(it.driveId?`Tirar “${it.nome}” da lista? O arquivo no Google Drive não é apagado, e o lembrete de revisão dela será removido.`:`Remover “${it.nome}”? O texto salvo na nuvem e o lembrete de revisão dela também serão apagados.`))return;
    if(it.driveId)(apEstado.ocultos=apEstado.ocultos||[]).push(it.driveId);
    apEstado.itens=apEstado.itens.filter(x=>x.id!==it.id);
    if(estudos().some(x=>x.apostila===it.id)){revisaoEstado.estudos=estudos().filter(x=>x.apostila!==it.id);salvarRevisao();atualizarBadgeRevisao()}
    apSalvar(true); apAtualizarTela(); if(!it.driveId)apApagarTexto(it); apPdfApagar(it.id).catch(()=>{});
  }
});
document.addEventListener("change",async e=>{
  const t=e.target;if(!t)return;
  if(t.id==="apUp"){
    const arquivos=[...t.files]; t.value="";
    if(!arquivos.length)return;
    if(secao!=="conteudo")mostrarSecao("conteudo");
    const m=apMatPend; apMatPend=""; await apEnviar(arquivos,m); return;
  }
  if(t.id==="lFeito"){if(apAtiva)apostilaMarcar(apAtiva,t.checked);return}
  if(t.dataset&&t.dataset.apdone){apostilaMarcar(t.dataset.apdone,t.checked);return}
  if(t.dataset&&t.dataset.apf){
    const it=apItem(t.dataset.apid);if(!it)return;
    const v=t.value.trim();
    if(t.dataset.apf==="nome"&&!v){t.value=it.nome;return}
    it[t.dataset.apf]=v;
    const ex=estudos().find(x=>x.apostila===it.id);
    if(ex){ex.tema=it.nome;ex.materia=it.materia||"";salvarRevisao()}
    apSalvar(true);
    if(t.dataset.apf==="materia")apAtualizarTela();
    return;
  }
  if(t.dataset&&t.dataset.rvcheck){
    const id=t.dataset.rvcheck, lin=t.closest(".rvlinha");
    if(t.checked){ if(lin)lin.classList.add("feito"); t.disabled=true; setTimeout(()=>revConcluir(id),380); }
    else revDesfazer(id); // desmarcar = desfazer a revisão
  }
});
$("dlgLeitor").addEventListener("close",()=>{
  apOrigLimpar(); apFull(false);
  if(apAtiva){clearTimeout(tAp);apSalvar(true)}
  apAtiva=null; apSyncFeito(); apAtualizarTela();
});
onAuthStateChanged(auth,u=>{
  if(apUnsub){try{apUnsub()}catch(e){}apUnsub=null}
  if(atvUnsub){try{atvUnsub()}catch(e){}atvUnsub=null}
  apEstado={itens:[],ts:0};
  if(!u)return;
  try{const l=JSON.parse(localStorage.getItem(apKey())||"null");if(l&&Array.isArray(l.itens))apEstado=l}catch(e){}
  apAtualizarTela(true);
  apUnsub=onSnapshot(cfgRef("apostilas"),s=>{
    if(!s.exists())return;
    const r=s.data();
    if((r.ts||0)>(apEstado.ts||0)){
      apEstado={itens:Array.isArray(r.itens)?r.itens:[],ocultos:Array.isArray(r.ocultos)?r.ocultos:[],ts:r.ts};
      try{localStorage.setItem(apKey(),JSON.stringify(apEstado))}catch(e){}
      apAtualizarTela(true);
    }
  },e=>console.warn("apostilas:",e.message));
  atvUnsub=onSnapshot(cfgRef("atividade"),s=>{
    if(!s.exists())return;
    const uni=[...new Set([...ativDias,...(s.data().dias||[])])].sort().slice(-180);
    if(uni.length!==ativDias.length){
      ativDias=uni; try{localStorage.setItem(ATIV_KEY,JSON.stringify(ativDias))}catch(e){}
      if(secao==="inicio")renderInicio();
    }
  },e=>console.warn("atividade:",e.message));
});

/* ===== Leitor contínuo das apostilas ===== */
let apLeitura={ini:1,fim:0,atual:0,carregando:false,fimMostrado:false,tok:0};
let apZoom=+localStorage.getItem("leitor_zoom")||1;
const apAplicaZoom=()=>$("dlgLeitor").style.setProperty("--lz",apZoom);
apAplicaZoom();
$("lMenos").onclick=()=>{if(apOrig.on)return apOrigZoom(-1);apZoom=Math.max(.85,+(apZoom-.1).toFixed(2));try{localStorage.setItem("leitor_zoom",apZoom)}catch(e){}apAplicaZoom()};
$("lMais").onclick=()=>{if(apOrig.on)return apOrigZoom(1);apZoom=Math.min(1.6,+(apZoom+.1).toFixed(2));try{localStorage.setItem("leitor_zoom",apZoom)}catch(e){}apAplicaZoom()};
function apMarcaPagina(p){
  apLeitura.atual=p; $("lPag").value=p;
  registrarProgresso({tipo:"apostila",arquivo:"",titulo:$("lTitulo").textContent||"",pagina:p,total:apPdf.numPages,nome:(apMeta&&apMeta.nome)||"",material:(apMeta&&apMeta.material)||"",sec:"",i:-1,apostila:apAtiva||""});
  apostilaPagina(p);
}
async function apCarregarMais(qtd,tok){
  if(apLeitura.carregando||!apItem(apAtiva))return;
  apLeitura.carregando=true;
  try{
    const c=$("lCorpo");
    for(let i=0;i<qtd&&apLeitura.fim<apPdf.numPages;i++){
      const p=apLeitura.fim+1, linhas=await apLinhasLib(p);
      if(tok!==apLeitura.tok)return;
      const sec=document.createElement("section"); sec.className="lpag"; sec.dataset.p=p;
      sec.innerHTML=`<div class="lpnum">Página ${p}</div>`+(linhas.length?formatarPagina(linhas):'<p class="muted">Esta página não tem texto (pode ser uma imagem).</p>');
      c.appendChild(sec); apLeitura.fim=p;
    }
    if(apLeitura.fim>=apPdf.numPages&&!apLeitura.fimMostrado){
      apLeitura.fimMostrado=true;
      const it=apItem(apAtiva), fim=document.createElement("div"); fim.className="lfim";
      fim.innerHTML=`<b>Fim da apostila</b>${it&&!it.concluida?'<button class="pri" data-lfim="1">Terminei esta apostila</button>':'<span class="muted">Apostila concluída.</span>'}`;
      c.appendChild(fim);
    }
  }catch(e){
    if(tok===apLeitura.tok)$("lCorpo").insertAdjacentHTML("beforeend",`<p>❌ ${esc(e.message||String(e))}</p>`);
  }finally{ if(tok===apLeitura.tok)apLeitura.carregando=false }
}
async function apLerDe(n){
  if(!apItem(apAtiva))return;
  n=Math.min(Math.max(1,n||1),apPdf.numPages);
  const tok=++apLeitura.tok, c=$("lCorpo");
  apLeitura={ini:n,fim:n-1,atual:0,carregando:false,fimMostrado:false,tok};
  c.innerHTML='<p class="muted">⏳ Abrindo…</p>'; $("lPag").value=n; $("lPag").max=apPdf.numPages; $("lTotal").textContent="/ "+apPdf.numPages;
  await apCarregarMais(3,tok); if(tok!==apLeitura.tok)return;
  c.querySelector(":scope > p.muted")?.remove(); c.scrollTop=0;
  // páginas curtas (capa, sumário): carrega mais até preencher a tela
  while(tok===apLeitura.tok&&apLeitura.fim<apPdf.numPages&&c.scrollHeight<c.clientHeight*1.6)await apCarregarMais(3,tok);
  if(tok===apLeitura.tok)apMarcaPagina(n);
}
$("lCorpo").addEventListener("scroll",()=>{
  if(!(apPdf&&apPdf.lib)||apOrig.on)return;
  const c=$("lCorpo");
  if(c.scrollTop+c.clientHeight>c.scrollHeight-900&&apLeitura.fim<apPdf.numPages)apCarregarMais(3,apLeitura.tok);
  const ref=c.scrollTop+c.clientHeight*0.25; let atual=apLeitura.ini;
  for(const sec of c.querySelectorAll(".lpag")){if(sec.offsetTop<=ref)atual=+sec.dataset.p;else break}
  if(atual!==apLeitura.atual)apMarcaPagina(atual);
},{passive:true});
document.addEventListener("keydown",e=>{
  if(!$("dlgLeitor").open||!(apPdf&&apPdf.lib)||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;
  if(e.key==="ArrowRight")$("lNext").click(); else if(e.key==="ArrowLeft")$("lPrev").click();
});
document.addEventListener("click",e=>{
  if(e.target.closest("[data-lfim]")&&apAtiva){apostilaMarcar(apAtiva,true);const f=e.target.closest(".lfim");if(f)f.innerHTML='<b>Fim da apostila</b><span class="muted">Apostila concluída.</span>'}
});

/* ===== PDF original no leitor (páginas desenhadas como no arquivo) ===== */
const apOrig={on:false,doc:null,blob:null,zoom:+localStorage.getItem("leitor_pdf_zoom")||1,tok:0,obs:null,raf:0,atual:0,razao:1.414,w:600,id:""};
const apModoPref=()=>{try{return localStorage.getItem("leitor_modo")||"orig"}catch(e){return "orig"}};
const apModoSalvar=m=>{try{localStorage.setItem("leitor_modo",m)}catch(e){}};
// o PDF fica guardado neste aparelho (IndexedDB), por id da apostila
function apDB(){return new Promise((ok,no)=>{const r=indexedDB.open("apostilas_pdf",1);r.onupgradeneeded=()=>r.result.createObjectStore("pdfs");r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}
async function apPdfSalvar(id,blob){const db=await apDB();return new Promise((ok,no)=>{const t=db.transaction("pdfs","readwrite");t.objectStore("pdfs").put(blob,id);t.oncomplete=()=>ok();t.onerror=()=>no(t.error)})}
async function apPdfObter(id){const db=await apDB();return new Promise((ok,no)=>{const r=db.transaction("pdfs").objectStore("pdfs").get(id);r.onsuccess=()=>ok(r.result||null);r.onerror=()=>no(r.error)})}
async function apPdfApagar(id){const db=await apDB();return new Promise((ok,no)=>{const t=db.transaction("pdfs","readwrite");t.objectStore("pdfs").delete(id);t.oncomplete=()=>ok();t.onerror=()=>no(t.error)})}

function apModoBtn(){
  const o=apModoPref()==="orig", b=$("lModo"); if(!b)return;
  b.innerHTML=o?'<span class="ic">📝</span><span class="lbl"> Texto</span>':'<span class="ic">📄</span><span class="lbl"> Original</span>';
  b.title=o?"Ler em modo texto":"Ver o PDF original";
}
function apOrigLimpar(){
  apOrig.tok++;
  if(apOrig.obs){apOrig.obs.disconnect();apOrig.obs=null}
  if(apOrig.doc){try{apOrig.doc.destroy()}catch(e){}apOrig.doc=null}
  apOrig.on=false; apOrig.blob=null; apOrig.atual=0;
  $("dlgLeitor").classList.remove("pdfmode");
}
async function apIniciarLeitura(it,n){
  apOrigLimpar(); apOrig.id=it.id; apModoBtn();
  $("lPag").value=n; $("lPag").max=it.total||1; $("lTotal").textContent="/ "+(it.total||"");
  await apOrigCarregar(it,n);
}
async function apOrigCarregar(it,n){
  const c=$("lCorpo"); c.className="lcorpo orig"; c.innerHTML='<p class="muted">⏳ Abrindo o PDF…</p>';
  let blob=null; try{blob=await apPdfObter(it.id)}catch(e){}
  if(apAtiva!==it.id)return;
  if(!blob&&it.driveId){
    try{c.innerHTML='<p class="muted">⏳ Baixando do Google Drive…</p>'; blob=await driveBaixar(it.driveId); try{await apPdfSalvar(it.id,blob)}catch(e){}}
    catch(e){if(apAtiva===it.id)c.innerHTML=`<div class="oprompt"><b>Não consegui baixar do Drive.</b><p class="muted">${esc(e.message||String(e))}</p><button class="pri" data-oretry="1">Tentar de novo</button></div>`;return}
    if(apAtiva!==it.id)return;
  }
  if(!blob){apOrigFaltando(it);return}
  try{await apOrigAbrir(blob,n)}catch(e){c.innerHTML=`<p>❌ ${esc(e.message||String(e))}</p>`}
}
function apOrigFaltando(it){
  $("lCorpo").innerHTML=`<div class="oprompt"><b>O PDF original não está salvo neste aparelho.</b>
    <p class="muted">Selecione o arquivo de “${esc(it.nome)}” uma única vez. Ele fica guardado aqui e as próximas leituras já abrem direto.</p>
    <button class="pri" data-oescolher="1">Selecionar o PDF</button></div>`;
}
async function apOrigUsarArquivo(it,f){
  try{
    await garantirPdfjs();
    const d=await pdfjsLib.getDocument({data:await f.arrayBuffer()}).promise, total=d.numPages; d.destroy();
    if(it.total&&total!==it.total&&!await uiConfirm(`Este PDF tem ${total} páginas e a apostila salva tem ${it.total}. Pode ser outro arquivo. Usar mesmo assim?`))return;
    try{await apPdfSalvar(it.id,f)}catch(e){aviso("Não consegui guardar o PDF neste aparelho; ele vale só até fechar o leitor.")}
    if(apAtiva!==it.id)return;
    await apOrigAbrir(f,+$("lPag").value||it.pagina||1);
  }catch(e){aviso("Não foi possível abrir o PDF: "+(e.message||e))}
}
async function apOrigAbrir(blob,n){
  await garantirPdfjs();
  const doc=await pdfjsLib.getDocument({data:await blob.arrayBuffer()}).promise;
  if(!apAtiva||apAtiva!==apOrig.id){try{doc.destroy()}catch(e){}return}
  if(apOrig.doc){try{apOrig.doc.destroy()}catch(e){}}
  apOrig.doc=doc; apOrig.blob=blob; apOrig.on=true;
  {const it0=apItem(apAtiva); if(it0&&it0.total!==doc.numPages){it0.total=doc.numPages;apSalvar()}}
  apPdf={numPages:doc.numPages,lib:true};
  $("lTotal").textContent="/ "+doc.numPages; $("lPag").max=doc.numPages;
  $("lCorpo").className="lcorpo orig"; $("dlgLeitor").classList.add("pdfmode");
  await apOrigMontar(n);
}
async function apOrigMontar(n){
  const doc=apOrig.doc; if(!doc)return;
  const c=$("lCorpo"), tok=++apOrig.tok;
  if(apOrig.obs){apOrig.obs.disconnect();apOrig.obs=null}
  const v1=(await doc.getPage(1)).getViewport({scale:1}); if(tok!==apOrig.tok)return;
  apOrig.razao=v1.height/v1.width;
  apOrig.w=Math.max(200,Math.floor((c.clientWidth-16)*apOrig.zoom));
  const inner=document.createElement("div"); inner.className="oin";
  for(let p=1;p<=doc.numPages;p++){
    const d=document.createElement("div"); d.className="opg"; d.dataset.p=p;
    d.style.width=apOrig.w+"px"; d.style.height=Math.round(apOrig.w*apOrig.razao)+"px"; inner.appendChild(d);
  }
  const it=apItem(apAtiva), fim=document.createElement("div"); fim.className="lfim";
  fim.innerHTML=`<b>Fim da apostila</b>${it&&!it.concluida?'<button class="pri" data-lfim="1">Terminei esta apostila</button>':'<span class="muted">Apostila concluída.</span>'}`;
  inner.appendChild(fim);
  c.innerHTML=""; c.appendChild(inner);
  n=Math.min(Math.max(1,n||1),doc.numPages); apOrig.atual=n; $("lPag").value=n;
  c.scrollTop=inner.children[n-1].offsetTop-6;
  apOrig.obs=new IntersectionObserver(es=>{
    for(const e of es){e.target._vis=e.isIntersecting; if(e.isIntersecting)apOrigPag(e.target,tok); else apOrigLib(e.target)}
  },{root:c,rootMargin:"1400px 0px"});
  inner.querySelectorAll(".opg").forEach(d=>apOrig.obs.observe(d));
}
async function apOrigPag(d,tok){
  if(d.dataset.r||d.dataset.busy)return; d.dataset.busy="1";
  try{
    const page=await apOrig.doc.getPage(+d.dataset.p); if(tok!==apOrig.tok)return;
    const base=page.getViewport({scale:1}), vp=page.getViewport({scale:apOrig.w/base.width});
    let dpr=Math.min(window.devicePixelRatio||1,2.5); dpr=Math.min(dpr,Math.sqrt(16e6/(vp.width*vp.height))); dpr=Math.max(1,dpr);
    const cv=document.createElement("canvas");
    cv.width=Math.floor(vp.width*dpr); cv.height=Math.floor(vp.height*dpr);
    cv.style.width=vp.width+"px"; cv.style.height=vp.height+"px";
    await page.render({canvasContext:cv.getContext("2d"),viewport:vp,transform:dpr!==1?[dpr,0,0,dpr,0,0]:null}).promise;
    if(tok!==apOrig.tok||!d._vis)return;
    d.style.height=Math.round(vp.height)+"px"; d.replaceChildren(cv); d.dataset.r="1";
  }catch(e){ if(tok===apOrig.tok)console.warn("página",d.dataset.p,e) }
  finally{ delete d.dataset.busy }
}
function apOrigLib(d){ if(d.dataset.r){d.replaceChildren();delete d.dataset.r} }
function apOrigIr(n){
  const c=$("lCorpo"), pgs=c.querySelectorAll(".opg"); if(!pgs.length)return;
  n=Math.min(Math.max(1,n||1),pgs.length); $("lPag").value=n; c.scrollTop=pgs[n-1].offsetTop-6;
}
function apOrigZoom(d){
  apOrig.zoom=Math.min(2.2,Math.max(.6,+(apOrig.zoom+d*.15).toFixed(2)));
  try{localStorage.setItem("leitor_pdf_zoom",apOrig.zoom)}catch(e){}
  apOrigMontar(apOrig.atual||+$("lPag").value||1);
}
$("lCorpo").addEventListener("scroll",()=>{
  if(!apOrig.on||apOrig.raf)return;
  apOrig.raf=requestAnimationFrame(()=>{
    apOrig.raf=0; if(!apOrig.on)return;
    const c=$("lCorpo"), ref=c.scrollTop+c.clientHeight*0.3, pgs=c.querySelectorAll(".opg"); if(!pgs.length)return;
    let lo=0,hi=pgs.length-1; while(lo<hi){const m=(lo+hi+1)>>1; if(pgs[m].offsetTop<=ref)lo=m; else hi=m-1}
    const p=lo+1; if(p!==apOrig.atual){apOrig.atual=p; apMarcaPagina(p)}
  });
},{passive:true});
let apRszT=0;
window.addEventListener("resize",()=>{
  if(!apOrig.on)return; clearTimeout(apRszT);
  apRszT=setTimeout(()=>{const c=$("lCorpo"); if(Math.abs(Math.floor((c.clientWidth-16)*apOrig.zoom)-apOrig.w)>8)apOrigMontar(apOrig.atual||1)},250);
});
$("lAba").onclick=async()=>{
  const it=apItem(apAtiva); if(!it)return;
  const w=window.open("","_blank"); // abre já no clique, para o navegador não bloquear
  let blob=apOrig.blob; if(!blob){try{blob=await apPdfObter(it.id)}catch(e){}}
  if(!blob){if(w)w.close();aviso("O PDF original não está salvo neste aparelho. Mude para “Original” e selecione o arquivo.");return}
  if(!w){aviso("O navegador bloqueou a nova aba. Permita pop-ups para este site.");return}
  const url=URL.createObjectURL(new Blob([blob],{type:"application/pdf"}));
  w.location.href=url+"#page="+(apOrig.on?apOrig.atual:+$("lPag").value||1);
  setTimeout(()=>URL.revokeObjectURL(url),10*60*1000);
};
document.addEventListener("click",e=>{
  const t=e.target.closest("[data-oescolher]"); if(!t)return;
  const it=apItem(apAtiva); if(!it)return;
  const i=document.createElement("input"); i.type="file"; i.accept="application/pdf";
  i.onchange=()=>{if(i.files[0])apOrigUsarArquivo(it,i.files[0])};
  i.click();
});
apModoBtn();

/* animação ao trocar de aba: escalona a entrada dos cartões */
(function(){
  const SEL=".card,.mcard,.homecard,.retomar,.revpanel,.kdia,.apsec,.errorcard,.drow,.rvlinha,.ei-stat";
  const mo=new MutationObserver(ms=>{for(const m of ms){
    const sc=m.target; if(sc.hidden)continue;
    sc.classList.remove("entrando"); void sc.offsetWidth;
    sc.querySelectorAll(SEL).forEach((e,i)=>e.style.setProperty("--i",Math.min(i,10)));
    sc.classList.add("entrando"); clearTimeout(sc._t); sc._t=setTimeout(()=>sc.classList.remove("entrando"),1000);
  }});
  document.querySelectorAll(".conteudo>section").forEach(sc=>mo.observe(sc,{attributes:true,attributeFilter:["hidden"]}));
})();

/* ===== tela cheia do leitor, matérias recolhidas, diagnóstico e seletor de matéria ===== */
function apFull(on){
  const d=$("dlgLeitor"); on=on===undefined?!d.classList.contains("fs"):on;
  d.classList.toggle("fs",on);
  try{
    if(on&&d.requestFullscreen&&!document.fullscreenElement)d.requestFullscreen().catch(()=>{});
    else if(!on&&document.fullscreenElement)document.exitFullscreen().catch(()=>{});
  }catch(e){}
  const b=$("lFull"); if(b){const t=on?"Sair da tela cheia":"Tela cheia"; b.title=t; b.setAttribute("aria-label",t); const lb=b.querySelector(".lbl"); if(lb)lb.textContent=on?"Reduzir":"Tela cheia"}
  if(apOrig.on)setTimeout(()=>apOrigMontar(apOrig.atual||1),200);
}
$("lFull").onclick=()=>apFull();
document.addEventListener("fullscreenchange",()=>{if(!document.fullscreenElement&&$("dlgLeitor").classList.contains("fs"))apFull(false)});
const apAbertas=new Set();
document.addEventListener("click",e=>{
  const h=e.target.closest("[data-apt]");
  if(h&&!e.target.closest("button")){
    const sc=h.closest(".apsec"), k=sc.dataset.apk;
    if(sc.classList.toggle("aberta"))apAbertas.add(k); else apAbertas.delete(k);
    return;
  }
  const r=e.target.closest(".drow[data-dk]");
  if(r&&!e.target.closest("button,a,input,select"))abrirEstat(r.dataset.dk);
  const ir=e.target.closest("[data-estat-ir]");
  if(ir){const d=$("dlgEstat"); if(d)d.close();
    if(ir.dataset.estatIr==="questoes"){sel={materia:ir.dataset.mat,lista:null};mostrarSecao("questoes")}
    else{cadFiltro=ir.dataset.nome;mostrarSecao("caderno")}}
});
document.addEventListener("keydown",e=>{if((e.key==="Enter"||e.key===" ")&&e.target.matches&&e.target.matches(".drow[data-dk]")){e.preventDefault();abrirEstat(e.target.dataset.dk)}});
document.addEventListener("change",e=>{
  if(e.target.id==="selCadMat"){cadFiltro=e.target.value;renderCaderno();return}
  if(e.target.id==="selCadOrd"){cadOrd=e.target.value;renderCaderno();return}
  if(e.target.id!=="selMat")return;
  sel={materia:e.target.value,lista:null}; mostrarSecao("questoes");
});

/* ===== nome de exibição e menu lateral deslizante ===== */
async function editarNome(){
  const v=await uiPrompt("Como quer ser chamado?",localStorage.getItem("nome_exibicao")||"",{ok:"Salvar",msg:"Só o primeiro nome."});
  if(v===null)return;
  const n=v.trim().split(/\s+/)[0]||"";
  try{n?localStorage.setItem("nome_exibicao",n):localStorage.removeItem("nome_exibicao")}catch(e){}
  renderInicio(); atualizarTopUser();
}
document.addEventListener("click",async e=>{
  if(e.target.closest("#nomeEd"))editarNome();
  if(e.target.closest("[data-metaed]")){const v=await uiPrompt("Meta de questões por dia",String(metaDia()),{ok:"Salvar",msg:"Quantas questões por dia?"});if(v===null)return;const n=parseInt(v,10);if(n>0&&n<=500){try{localStorage.setItem(META_KEY,String(n))}catch(x){}renderInicio()}}
});
(function(){
  const side=$("side"), app=$("app"), mq=matchMedia("(max-width:720px)"), MIN=76, MAX=256;
  let st=null, moved=false, engole=false;
  side.addEventListener("pointerdown",e=>{
    if(mq.matches||e.button>0||e.target.closest("input,select,textarea"))return;
    st={x:e.clientX,w:side.getBoundingClientRect().width,id:e.pointerId}; moved=false;
  });
  side.addEventListener("pointermove",e=>{
    if(!st||e.pointerId!==st.id)return;
    const dx=e.clientX-st.x;
    if(!moved){
      if(Math.abs(dx)<8)return;
      moved=true; try{side.setPointerCapture(e.pointerId)}catch(_){}
      app.classList.add("arrastando"); app.classList.remove("col");
    }
    const w=Math.min(MAX,Math.max(MIN,st.w+dx)); side.style.width=side.style.flexBasis=w+"px";
  });
  const fim=e=>{
    if(!st)return;
    if(moved){
      const col=side.getBoundingClientRect().width<(MIN+MAX)/2;
      app.classList.toggle("col",col); try{localStorage.setItem("side_col",col?"1":"0")}catch(_){}
      side.style.width=side.style.flexBasis=""; app.classList.remove("arrastando");
      engole=true; setTimeout(()=>{engole=false},0);
    }
    st=null; moved=false;
  };
  side.addEventListener("pointerup",fim); side.addEventListener("pointercancel",fim);
  side.addEventListener("click",e=>{if(engole){e.stopPropagation();e.preventDefault()}},true);
})();

/* ===== histórico, gráficos do dashboard, tema e menu do usuário ===== */
const HIST_KEY="hist_dia";
let histDia=(()=>{try{return JSON.parse(localStorage.getItem(HIST_KEY)||"{}")}catch(e){return {}}})();
function registrarCorrecao(L,qs){
  let ac=0,er=0;
  qs.forEach(q=>{const r=L.respostas?.[q.num],g=L.gabarito?.[q.num]; if(r&&g&&g!=="ANULADA"){r===g?ac++:er++}});
  if(!ac&&!er)return;
  const h=isoHoje(), v=histDia[h]||[0,0]; histDia[h]=[v[0]+ac,v[1]+er];
  try{localStorage.setItem(HIST_KEY,JSON.stringify(histDia))}catch(e){}
  if(user)setDoc(cfgRef("historico"),{dias:histDia}).catch(()=>{});
}
onAuthStateChanged(auth,u=>{
  if(!u)return;
  getDoc(cfgRef("historico")).then(sn=>{
    if(!sn.exists())return; const r=sn.data().dias||{}; let ch=false;
    for(const k in r){const a=histDia[k]; if(!a||a[0]+a[1]<r[k][0]+r[k][1]){histDia[k]=r[k];ch=true}}
    if(ch){try{localStorage.setItem(HIST_KEY,JSON.stringify(histDia))}catch(e){} if(secao==="inicio")renderInicio()}
  }).catch(()=>{});
});
function eiGraficos(){
  const hoje=isoHoje(), ds=[...Array(14)].map((_,i)=>somaDias(hoje,i-13)), q=resumoQuestoes();
  const vazio=t=>`<div class="eg-vazio">${t}</div>`;
  // evolução do acerto (por dia, últimos 14 dias)
  const X=i=>40+i*(580/13), Y=p=>200-p*1.8;
  const pts=ds.map((d,i)=>{const h=histDia[d];return h&&h[0]+h[1]?{i,p:h[0]/(h[0]+h[1])*100}:null}).filter(Boolean);
  let linha;
  if(pts.length<2) linha=vazio("O gráfico aparece quando você corrigir questões em pelo menos 2 dias diferentes. O histórico começa a ser registrado a partir de agora.");
  else{
    const pl=pts.map(o=>`${X(o.i).toFixed(1)},${Y(o.p).toFixed(1)}`).join(" ");
    const grade=[[0,"0%"],[50,"50%"],[100,"100%"]].map(([v,l])=>`<line class="gl" x1="40" x2="620" y1="${Y(v)}" y2="${Y(v)}"/><text x="30" y="${Y(v)+4}" text-anchor="end">${l}</text>`).join("");
    const dias=ds.map((d,i)=>i%2===0||i===13?`<text x="${X(i).toFixed(1)}" y="226" text-anchor="middle">${d.slice(8)}</text>`:"").join("");
    linha=`<svg viewBox="0 0 640 236" role="img" aria-label="Evolução do percentual de acerto nos últimos 14 dias" style="width:100%;height:auto;display:block">${grade}
      <line x1="40" x2="620" y1="${Y(75)}" y2="${Y(75)}" stroke="#c98a1b" stroke-width="1.5" stroke-dasharray="5 5"/><text x="620" y="${Y(75)-6}" text-anchor="end" style="fill:#7a520a;font-weight:600">Meta 75%</text>
      <polygon points="${X(pts[0].i)},200 ${pl} ${X(pts[pts.length-1].i)},200" fill="#2bb283" fill-opacity=".14"/>
      <polyline points="${pl}" fill="none" stroke="#1f9468" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      ${pts.map(o=>`<circle cx="${X(o.i).toFixed(1)}" cy="${Y(o.p).toFixed(1)}" r="4.5" fill="#fff" stroke="#1f9468" stroke-width="2.5"/>`).join("")}${dias}</svg>`;
  }
  // rosca acertos x erros
  let rosca;
  if(!q.corr) rosca=vazio("Sem questões corrigidas ainda.");
  else{
    const C=2*Math.PI*54, a=q.ac/q.corr*C;
    rosca=`<svg viewBox="0 0 160 160" role="img" aria-label="${q.ac} acertos e ${q.er} erros" style="width:170px;height:170px;display:block;margin:0 auto"><circle cx="80" cy="80" r="54" fill="none" stroke="#e8b9ae" stroke-width="18"/>
      <circle cx="80" cy="80" r="54" fill="none" stroke="#1f9468" stroke-width="18" stroke-dasharray="${a.toFixed(1)} ${(C-a).toFixed(1)}" transform="rotate(-90 80 80)"/>
      <text x="80" y="89" text-anchor="middle" style="font-size:28px;font-weight:800;fill:var(--head)">${q.pct}%</text></svg>
      <div class="eg-leg"><span style="--c:#1f9468">${q.ac} acertos</span><span style="--c:#e8b9ae">${q.er} erros</span></div>`;
  }
  // desempenho por matéria (piores primeiro)
  const ms=(materias||[]).map(m=>({n:m.nome,st:statsMateria(m)})).filter(x=>x.st.corr>0).sort((a,b)=>a.st.pct-b.st.pct).slice(0,6);
  const nv=p=>p>=75?["Bom","#1f9468","#17714f"]:p>=60?["Atenção","#c98a1b","#7a520a"]:["Crítico","#a23b2a","#8a2f20"];
  const mats=ms.length?ms.map(x=>{const p=Math.round(x.st.pct),[t,c,ink]=nv(p);return `<div class="eg-mrow"><div class="eg-mtop"><span>${esc(x.n)}</span><span><b>${p}%</b><i style="color:${ink}">${t}</i></span></div><div class="eg-track"><div style="width:${p}%;background:${c}"></div></div></div>`}).join(""):vazio("Corrija questões de uma matéria para ver o desempenho.");
  // questões por dia
  const tot=ds.map(d=>histDia[d]||[0,0]), mx=Math.max(10,...tot.map(t=>t[0]+t[1])), k=126/mx;
  let barras;
  if(!tot.some(t=>t[0]+t[1])) barras=vazio("Aparece depois que você corrigir questões. O histórico começa a ser registrado a partir de agora.");
  else{
    const b=tot.map(([ac,er],i)=>{const x=24+i*43,l=i%2===0||i===13?`<text x="${x+14}" y="192" text-anchor="middle">${ds[i].slice(8)}</text>`:"";
      return (ac+er?`<rect x="${x}" y="${170-ac*k}" width="28" height="${ac*k}" rx="3" fill="#2bb283"/><rect x="${x}" y="${170-(ac+er)*k-1}" width="28" height="${er*k}" rx="3" fill="#a23b2a"/>`:`<rect x="${x}" y="167" width="28" height="3" rx="1.5" fill="#cdd8d3"/>`)+l}).join("");
    barras=`<svg viewBox="0 0 640 200" role="img" aria-label="Questões corrigidas por dia, acertos e erros" style="width:100%;height:auto;display:block"><line class="gl" x1="16" x2="630" y1="170" y2="170"/>${b}</svg><div class="eg-leg"><span style="--c:#2bb283">Acertos</span><span style="--c:#a23b2a">Erros</span></div>`;
  }
  return `<div class="eg"><div class="eg-grid eg-3"><section class="ei-card"><h3>Evolução do acerto</h3><p class="eg-sub">Percentual de acerto por dia, últimos 14 dias</p>${linha}</section><section class="ei-card"><h3>Acertos x erros</h3><p class="eg-sub">Todas as questões corrigidas</p>${rosca}</section></div>
    <div class="eg-grid eg-2"><section class="ei-card"><h3>Desempenho por matéria</h3><p class="eg-sub">Bom: 75% ou mais · Atenção: 60% a 74% · Crítico: abaixo de 60%</p>${mats}</section><section class="ei-card"><h3>Questões por dia</h3><p class="eg-sub">Últimos 14 dias</p>${barras}</section></div></div>`;
}
const ICO_LUA='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
const ICO_SOL='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const escuro=()=>document.documentElement.getAttribute("data-tema")==="escuro";
const nomeExib=()=>(localStorage.getItem("nome_exibicao")||(((user&&(user.displayName||user.email))||"").split("@")[0].split(/[._\s-]/)[0])||"").replace(/^./,c=>c.toUpperCase());
function userCluster(nome){
  return `<button class="ei-tema" data-tema-btn="1" title="Paleta de cores" aria-label="Escolher paleta de cores" aria-haspopup="menu">${ICO_LUA}</button><button class="ei-user" data-usermenu="1" aria-haspopup="menu"><i>${esc((nome||"?").charAt(0))}</i>${esc(nome||"Conta")}<svg class="chv" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>`;
}
const topuser=document.createElement("div"); topuser.className="topuser"; topuser.hidden=true;
document.querySelector(".conteudo").prepend(topuser);
function atualizarTopUser(){ topuser.innerHTML=userCluster(nomeExib()); topuser.hidden=!user||secao==="inicio"; }
{const ms0=mostrarSecao; mostrarSecao=function(sec){ms0(sec);atualizarTopUser()}}
{const ms1=mostrarSecao, dq=$("dlgQuestoes");
 mostrarSecao=function(sec){ if(dq.open)dq.close(); ms1(sec); };
 $("qFechar").onclick=()=>dq.close();
 $("qFull").onclick=()=>dq.classList.toggle("fs");
 dq.addEventListener("click",e=>{if(e.target===dq)dq.close()});
 dq.addEventListener("close",()=>{dq.classList.remove("fs"); render()});
}
onAuthStateChanged(auth,()=>atualizarTopUser());
function fecharUserMenu(){const m=document.getElementById("userMenu"); if(m)m.remove()}
const PM_OK='<svg class="pm-ok" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const PALETAS=[
  {id:"roxobranco",nome:"Roxo e branco",sub:"Principal · claro com destaque roxo",cores:["#ffffff","#7c3aed","#3b1a94"]},
  {id:"roxo",nome:"Preto e roxo",sub:"Escuro com destaque roxo",cores:["#06050d","#8b5cf6","#ff8a1f"]},
  {id:"verde",nome:"Verde",sub:"Claro · verde",cores:["#f4f7f6","#2bb283","#12423a"]},
  {id:"verde-escuro",nome:"Verde escuro",sub:"Modo escuro verde",cores:["#0b1512","#2bb283","#5fe0b2"]}
];
const paletaAtual=()=>{const h=document.documentElement,p=h.getAttribute("data-paleta"); return p==="roxo"||p==="roxobranco"?p:(h.getAttribute("data-tema")==="escuro"?"verde-escuro":"verde")};
function aplicarPaleta(id){
  const h=document.documentElement; h.removeAttribute("data-paleta"); h.removeAttribute("data-tema");
  if(id==="roxo"||id==="roxobranco")h.setAttribute("data-paleta",id); else if(id==="verde-escuro")h.setAttribute("data-tema","escuro");
  try{localStorage.setItem("paleta_v2",id)}catch(_){}
  const mt=document.getElementById("metaTema"); if(mt)mt.content=id==="roxo"?"#06050d":id==="roxobranco"?"#faf9ff":id==="verde-escuro"?"#0b1512":"#ffffff";
}
function fecharPaletaMenu(){const m=document.getElementById("paletaMenu"); if(m)m.remove()}
document.addEventListener("click",e=>{
  const po=e.target.closest("[data-paleta-op]");
  if(po){aplicarPaleta(po.dataset.paletaOp);fecharPaletaMenu();return}
  const tb=e.target.closest("[data-tema-btn]");
  if(tb){
    fecharUserMenu();
    if(document.getElementById("paletaMenu")){fecharPaletaMenu();return}
    const r=tb.getBoundingClientRect(), m=document.createElement("div"); m.id="paletaMenu"; m.setAttribute("role","menu");
    m.style.top=(r.bottom+8)+"px"; m.style.visibility="hidden";
    m.innerHTML='<div class="pm-tit">Paleta de cores</div>'+PALETAS.map(p=>'<button type="button" role="menuitemradio" aria-checked="'+(paletaAtual()===p.id)+'" class="'+(paletaAtual()===p.id?"on":"")+'" data-paleta-op="'+p.id+'"><span class="pm-sw">'+p.cores.map(c=>'<i style="background:'+c+'"></i>').join("")+'</span><span class="pm-txt">'+p.nome+'<small>'+p.sub+'</small></span>'+PM_OK+'</button>').join("");
    document.body.appendChild(m);
    m.style.left=Math.max(8,Math.min(r.right-m.offsetWidth,innerWidth-m.offsetWidth-8))+"px"; m.style.visibility="";
    return;
  }
  fecharPaletaMenu();
  const um=e.target.closest("[data-um]");
  if(um){
    const trocar=um.dataset.um==="trocar"; fecharUserMenu();
    signOut(auth).then(()=>{if(trocar){const em=$("email"); if(em){em.value="";em.focus()}}});
    return;
  }
  const b=e.target.closest("[data-usermenu]");
  if(!b){fecharUserMenu();return}
  if(document.getElementById("userMenu")){fecharUserMenu();return}
  const r=b.getBoundingClientRect(), m=document.createElement("div"); m.id="userMenu"; m.setAttribute("role","menu");
  m.style.top=(r.bottom+8)+"px"; m.style.right=Math.max(8,innerWidth-r.right)+"px";
  m.innerHTML=`<div class="um-nome">${esc((user&&user.email)||"")}</div>
    <button role="menuitem" data-um="trocar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7"/></svg>Trocar de usuário</button>
    <button role="menuitem" data-um="sair"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>Sair</button>`;
  document.body.appendChild(m);
});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){fecharUserMenu();fecharPaletaMenu()}});

/* ===== Google Drive: apostilas buscadas de uma pasta ===== */
const DRIVE_CLIENT="616635519928-mvftf6qvks1viq3k5nfrb9c4ahg4p4oj.apps.googleusercontent.com";
const DRIVE_PASTA="1EEg62mP7rfzhVQ_ANCyJOIvrTyPTImpF";
let gTok=null,gExp=0,driveBusy=false;
try{const o=JSON.parse(sessionStorage.getItem("g_tok")||"null");if(o&&o.e>Date.now()+60000){gTok=o.t;gExp=o.e}}catch(_){}
function gisCarregar(){return new Promise((ok,no)=>{
  if(window.google&&google.accounts&&google.accounts.oauth2)return ok();
  const sc=document.createElement("script"); sc.src="https://accounts.google.com/gsi/client"; sc.onload=()=>ok();
  sc.onerror=()=>no(new Error("Não consegui carregar o login do Google. Verifique a internet.")); document.head.appendChild(sc);
})}
async function driveToken(){
  if(gTok&&Date.now()<gExp-60000)return gTok;
  await gisCarregar();
  return new Promise((ok,no)=>{
    const c=google.accounts.oauth2.initTokenClient({
      client_id:DRIVE_CLIENT, scope:"https://www.googleapis.com/auth/drive.readonly",
      callback:r=>{
        if(r.error)return no(new Error(r.error_description||r.error));
        gTok=r.access_token; gExp=Date.now()+(+r.expires_in||3600)*1000;
        try{sessionStorage.setItem("g_tok",JSON.stringify({t:gTok,e:gExp}));localStorage.setItem("g_ok","1")}catch(_){}
        ok(gTok);
      },
      error_callback:e=>no(new Error(e.type==="popup_closed"?"Login do Google cancelado.":e.type==="popup_failed_to_open"?"O navegador bloqueou a janela do Google. Permita pop-ups para este site.":(e.message||e.type||"Erro no login do Google")))
    });
    c.requestAccessToken({prompt:localStorage.getItem("g_ok")?"":"consent"});
  });
}
async function driveGet(url){
  const t=await driveToken();
  const r=await fetch(url,{headers:{Authorization:"Bearer "+t}});
  if(r.status===401){gTok=null;try{sessionStorage.removeItem("g_tok")}catch(_){}throw new Error("A sessão do Google expirou. Tente de novo.")}
  if(r.status===403||r.status===404)throw new Error(r.status===404?"Pasta ou arquivo não encontrado. Confira se você entrou com a conta Google dona da pasta.":"Sem permissão no Drive. Confira se a conta Google é a mesma da pasta.");
  if(!r.ok)throw new Error("O Drive respondeu com erro "+r.status+".");
  return r;
}
async function driveListar(pai){
  let out=[],pt="";
  do{
    const q=encodeURIComponent(`'${pai}' in parents and trashed=false`);
    const r=await driveGet(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType)&pageSize=200&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true${pt?"&pageToken="+encodeURIComponent(pt):""}`);
    const j=await r.json(); out=out.concat(j.files||[]); pt=j.nextPageToken||"";
  }while(pt);
  return out;
}
async function driveBaixar(id){
  const r=await driveGet(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`);
  return new Blob([await r.blob()],{type:"application/pdf"});
}
async function driveSincronizar(){
  if(driveBusy||apBusy){aviso("Aguarde: já existe uma operação em andamento.");return}
  driveBusy=true; apBusy=true;
  try{
    apStatus("Conectando ao Google Drive…");
    const achados=[];
    const varre=async(lista,materia,prof)=>{
      for(const f of lista){
        if(f.mimeType==="application/vnd.google-apps.folder"){
          if(prof<4){apStatus(`Lendo a pasta “${f.name}”…`);await varre(await driveListar(f.id),materia===null?f.name:materia,prof+1)}
        }else if(f.mimeType==="application/pdf"||/\.pdf$/i.test(f.name)){
          achados.push({driveId:f.id,nome:f.name.replace(/\.pdf$/i,""),arquivo:f.name,materia:apCanon(materia||"")});
        }
      }
    };
    await varre(await driveListar(DRIVE_PASTA),null,0);
    const ocultos=new Set(apEstado.ocultos||[]); let novas=0,mudou=false;
    achados.forEach(a=>{
      if(ocultos.has(a.driveId))return;
      const ex=apEstado.itens.find(x=>x.driveId===a.driveId);
      if(ex){ if(ex.nome!==a.nome||ex.materia!==a.materia){ex.nome=a.nome;ex.materia=a.materia;ex.arquivo=a.arquivo;mudou=true} return }
      apEstado.itens.push({id:"d"+a.driveId,driveId:a.driveId,nome:a.nome,materia:a.materia,arquivo:a.arquivo,total:0,pagina:1,concluida:false,data:"",lido:0});
      apAbertas.add(a.materia); novas++; mudou=true;
    });
    if(mudou)apSalvar(true);
    apStatus(novas?`${novas} apostila${novas>1?"s":""} nova${novas>1?"s":""} do Drive.`:achados.length?"Tudo em dia: nenhuma apostila nova no Drive.":"Nenhum PDF encontrado na pasta do Drive.");
    setTimeout(()=>apStatus(""),5000);
  }catch(e){apStatus("");aviso("Drive: "+(e.message||e))}
  finally{driveBusy=false;apBusy=false;apAtualizarTela()}
}
document.addEventListener("click",e=>{
  if(e.target.closest("[data-drivesync]")){driveSincronizar();return}
  if(e.target.closest("[data-oretry]")){const it=apItem(apAtiva);if(it)apOrigCarregar(it,+$("lPag").value||it.pagina||1)}
});

/* ===== excluir revisão ===== */
document.addEventListener("click",async e=>{
  const b=e.target.closest("[data-revdel]"); if(!b)return;
  e.preventDefault(); e.stopPropagation();
  const id=b.dataset.revdel, ev=estudos().find(x=>x.id===id); if(!ev)return;
  if(!await uiConfirm(`Excluir a revisão “${ev.tema}”? O lembrete sai da lista${ev.apostila?" (a apostila continua marcada como concluída)":""}.`))return;
  revisaoEstado.estudos=estudos().filter(x=>x.id!==id); salvarRevisao(); atualizarBadgeRevisao();
  if(secao==="revisao")renderRevisao(); else if(secao==="inicio")renderInicio();
  aviso("Revisão excluída.");
},true);


/* ===== Ponte com os módulos (js/*.js): só expõe o que eles precisam ===== */
window.AF={
  get user(){return user}, get listas(){return listas}, get materias(){return materias}, get secao(){return secao},
  revisao:()=>revisaoEstado, estudos, revVencidas, revHoje, revFeito, revAtivos, REV_INT,
  isoHoje, somaDias, difDias, fmtData, esc, limpar, sem, aviso, mostrarSecao, sheetDrag,
  cabecalhoQuestao, enunciadoHTML, registrarCorrecao, marcarAtividade, errosCaderno, histDia:()=>histDia,
  upd:(L,o)=>updateDoc(ref("listas",L.id),o).catch(falha),
  cfgSet:(n,d)=>user?setDoc(cfgRef(n),d).catch(()=>{}):Promise.resolve(),
  cfgGet:async n=>{try{const x=await getDoc(cfgRef(n));return x.exists()?x.data():null}catch(e){return null}},
  renderInicio, renderRevisao, atualizarBadgeRevisao, revConcluir, revDesfazer, cadEnviar, noCaderno, cadEnviarBtn:(id)=>{carregarCaderno();return cadEnviarBtn(id)}
};


/* ===== seletor de matérias (menu próprio, funciona igual no celular e no computador) ===== */
function fechaMsd() { document.querySelectorAll(".msd-menu").forEach((m) => { m.hidden = true; }); document.querySelectorAll(".msd-btn").forEach((b) => b.setAttribute("aria-expanded", "false")); }
document.addEventListener("click", (e) => {
  const tg = e.target.closest("[data-msd]"), it = e.target.closest("[data-msdv]");
  if (it) { const sl = document.getElementById("selMat"); fechaMsd(); if (sl && sl.value !== it.dataset.msdv) { sl.value = it.dataset.msdv; sl.dispatchEvent(new Event("change", { bubbles: true })); } return; }
  if (tg) { const mn = tg.parentElement.querySelector(".msd-menu"), abre = mn.hidden; fechaMsd(); mn.hidden = !abre; tg.setAttribute("aria-expanded", String(abre)); if (abre) mn.querySelector(".on")?.scrollIntoView({ block: "nearest" }); return; }
  if (!e.target.closest(".msd-menu")) fechaMsd();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") fechaMsd(); });


/* ===== caixas de diálogo próprias (substituem confirm/prompt do navegador) ===== */
const UI_ICO = {
  lixo: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  lapis: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4"/></svg>',
  ask: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 1 1 3.6 2.4c-.7.4-1.1.9-1.1 1.6M12 17h.01"/></svg>',
};
function uiDialog(o) {
  return new Promise((res) => {
    document.getElementById("dlgUi")?.remove();
    const d = document.createElement("dialog"); d.id = "dlgUi"; d.className = "uidlg";
    d.innerHTML = `<form method="dialog" class="uibox ${o.perigo ? "perigo" : ""}">
      <div class="uiico">${o.perigo ? UI_ICO.lixo : o.input ? UI_ICO.lapis : UI_ICO.ask}</div>
      <h3>${esc(o.titulo)}</h3>${o.msg ? `<p>${esc(o.msg)}</p>` : ""}
      ${o.input ? `<input class="uiin" type="text" maxlength="120" value="${esc(o.valor || "")}" autocomplete="off" spellcheck="false">` : ""}
      <div class="uibtns"><button type="button" class="uicancel">${esc(o.cancelar || "Cancelar")}</button><button type="submit" class="uiok">${esc(o.ok || "OK")}</button></div></form>`;
    document.body.appendChild(d);
    const inp = d.querySelector(".uiin"); let feito = false;
    const fim = (v) => { if (feito) return; feito = true; try { d.close(); } catch (e) {} d.remove(); res(v); };
    d.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); fim(o.input ? inp.value : true); });
    d.querySelector(".uicancel").addEventListener("click", () => fim(o.input ? null : false));
    d.addEventListener("cancel", (e) => { e.preventDefault(); fim(o.input ? null : false); });
    d.addEventListener("click", (e) => { if (e.target === d) fim(o.input ? null : false); });
    d.showModal();
    if (inp) { inp.focus(); inp.select(); } else d.querySelector(".uiok").focus();
  });
}
function uiConfirm(msg, o = {}) {
  const m = /(exclu|remov|apag|zerar|tirar)/i.exec(msg), perigo = o.perigo ?? !!m;
  const verbo = m ? { exclu: "Excluir", remov: "Remover", apag: "Apagar", zerar: "Zerar", tirar: "Tirar" }[m[1].toLowerCase()] : "Continuar";
  return uiDialog({ titulo: o.titulo || (perigo ? "Tem certeza?" : "Confirmar"), msg, ok: o.ok || (perigo ? verbo : "Continuar"), perigo });
}
function uiPrompt(titulo, valor = "", o = {}) { return uiDialog({ titulo, valor, input: true, msg: o.msg, ok: o.ok || "OK" }); }


/* ===== Caderno de erros: Explicar com IA (igual ao da aba Questões) ===== */
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-cd-ia]"); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const x = errosCaderno().find((i) => i.id === b.dataset.cdIa); if (!x) return;
  const card = b.closest(".cd-card"), det = card && card.querySelector(".cd-det");
  let alvo = null;
  if (det) { // print só do enunciado + alternativas (sem motivo, regra e botões)
    alvo = document.createElement("article"); alvo.className = "cd-card open";
    alvo.style.cssText = `position:fixed;left:-9999px;top:0;width:${Math.max(320, card.offsetWidth)}px;background:#fff`;
    const d2 = document.createElement("div"); d2.className = "cd-det"; alvo.appendChild(d2);
    det.querySelectorAll(".cd-en,.cd-alt").forEach((n) => d2.appendChild(n.cloneNode(true)));
    document.body.appendChild(alvo);
    setTimeout(() => alvo.remove(), 8000);
  }
  explicarDuck(x.lista, x.q, alvo);
}, true);


/* ===== gesto: arrastar a folha para baixo fecha (acompanha o dedo 1:1; solta por distância OU velocidade) ===== */
function sheetDrag(d) {
  let ativo = false, y0 = 0, y = 0, vy = 0, lastY = 0, lastT = 0, box = null;
  const reduz = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const limpa = () => { if (box) { box.style.transform = ""; box.style.transition = ""; box.classList.remove("arrastando"); } d.style.removeProperty("--drag"); box = null; };
  d.addEventListener("close", limpa);
  d.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    const el = d.querySelector(".sh"); if (!el) return;
    if (!e.target.closest(".sh-grip,.sh-h") || e.target.closest("button,textarea,input,a")) return;
    box = el; ativo = true;
    const m = new DOMMatrix(getComputedStyle(el).transform); y = m.m42 || 0;       // pega a folha no meio da animação
    box.classList.add("arrastando"); box.style.transform = `translateY(${y}px)`;
    y0 = e.clientY - y; lastY = e.clientY; lastT = e.timeStamp; vy = 0;
    try { d.setPointerCapture(e.pointerId); } catch (_) {}
  });
  d.addEventListener("pointermove", (e) => {
    if (!ativo || !box) return;
    let dy = e.clientY - y0; if (dy < 0) dy *= 0.2;                                  // elástico para cima
    const dt = e.timeStamp - lastT; if (dt > 0) { vy = (e.clientY - lastY) / dt; lastY = e.clientY; lastT = e.timeStamp; }
    y = dy; box.style.transform = `translateY(${dy}px)`;                             // transform direto, sem estado
    d.style.setProperty("--drag", String(Math.min(1, Math.max(0, dy / box.offsetHeight))));
  });
  const solta = () => {
    if (!ativo || !box) return; ativo = false;
    const h = box.offsetHeight, fecha = y > h * 0.4 || vy > 0.5;                     // distância OU velocidade (0,5 px/ms)
    box.classList.remove("arrastando");
    if (fecha) {
      box.style.transition = reduz() ? "none" : "transform .45s cubic-bezier(.32,.72,0,1)"; box.style.transform = `translateY(${h}px)`;
      d.style.setProperty("--drag", "1"); setTimeout(() => { if (d.open) d.close(); }, reduz() ? 0 : 240);
    } else {
      box.style.transition = "transform .22s cubic-bezier(.32,.72,0,1)"; box.style.transform = "";                 // volta rápido
      d.style.setProperty("--drag", "0"); setTimeout(() => { if (box && !ativo) { box.style.transition = ""; } }, 240);
    }
  };
  d.addEventListener("pointerup", solta); d.addEventListener("pointercancel", solta);
}


/* ===== App no celular: barra com 5 abas, "Praticar" com abas, "Eu" e questões deslizáveis ===== */
const MOB=()=>matchMedia("(max-width:720px)").matches;
const GRUPO_PRATICAR=["questoes","simulado","caderno","diagnostico"];
{
  const pseg=document.createElement("div"); pseg.id="pseg"; pseg.className="pseg"; pseg.hidden=true; pseg.setAttribute("role","tablist");
  pseg.innerHTML=[["questoes","Questões"],["simulado","Simulado"],["caderno","Caderno"],["diagnostico","Diagnóstico"]].map(([k,t])=>`<button type="button" role="tab" data-secnav="${k}" data-ps="${k}">${t}</button>`).join("");
  document.querySelector(".conteudo").prepend(pseg);
  const ms=mostrarSecao;
  mostrarSecao=function(sec){
    ms(sec);
    const grupo=GRUPO_PRATICAR.includes(sec);
    pseg.hidden=!grupo; pseg.querySelectorAll("button").forEach(b=>{const on=b.dataset.ps===sec;b.classList.toggle("on",on);b.setAttribute("aria-selected",on)});
    if(MOB()){const q=document.querySelector('.mi[data-sec="questoes"]'); if(q)q.classList.toggle("on",grupo)}
    window.scrollTo({top:0});
  };
}
// aba "Eu": folha com nome, meta, paleta e conta
document.addEventListener("click",(e)=>{
  const b=e.target.closest('[data-sec="eu"]'); if(!b)return;
  e.preventDefault(); e.stopImmediatePropagation();
  let d=document.getElementById("dlgEu"); if(d)d.remove();
  d=document.createElement("dialog"); d.id="dlgEu"; d.className="sheet eu";
  const nome=nomeExib(), ic=(p)=>`<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
  d.innerHTML=`<div class="sh"><div class="sh-grip" aria-hidden="true"></div>
    <div class="sh-h eu-h"><span class="eu-av">${esc((nome||"?").charAt(0))}</span><div><b>${esc(nome||"Conta")}</b><small>${esc((user&&user.email)||"")}</small></div></div>
    <div class="eu-list">
      <button type="button" data-eu="nome">${ic('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/>')}Mudar nome</button>
      <button type="button" data-metaed="1">${ic('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>')}Meta diária de questões</button>
      <button type="button" data-secnav="diagnostico">${ic('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>')}Diagnóstico</button>
    </div>
    <div class="eu-sub">Paleta de cores</div>
    <div class="eu-pal">${PALETAS.map(p=>`<button type="button" class="${paletaAtual()===p.id?"on":""}" data-paleta-op="${p.id}"><span class="pm-sw">${p.cores.map(c=>`<i style="background:${c}"></i>`).join("")}</span>${esc(p.nome)}</button>`).join("")}</div>
    <div class="eu-list eu-conta"><button type="button" data-um="trocar">${ic('<path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7"/>')}Trocar de usuário</button><button type="button" class="sair" data-um="sair">${ic('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>')}Sair</button></div></div>`;
  document.body.appendChild(d); sheetDrag(d);
  d.addEventListener("click",(ev)=>{
    if(ev.target===d){d.close();return}
    const x=ev.target.closest("button"); if(!x)return;
    if(x.dataset.eu==="nome")editarNome();
    if(!x.dataset.paletaOp)setTimeout(()=>d.close(),0); else d.querySelectorAll(".eu-pal button").forEach(y=>y.classList.toggle("on",y===x));
  });
  d.addEventListener("close",()=>setTimeout(()=>d.remove(),400));
  d.showModal();
},true);
// questões: navegação inferior e contador (o trilho desliza com o dedo; aqui só os botões)
{
  const dq=$("dlgQuestoes"), sl=()=>document.getElementById("qSlides");
  const idx=()=>{const s=sl();return s?Math.round(s.scrollLeft/(s.clientWidth||1)):0};
  const tot=()=>{const s=sl();return s?s.children.length:0};
  const atual=()=>{const n=tot(),i=idx(),pos=$("qPos"); if(pos)pos.textContent=n?`${i+1}/${n}`:""; const pv=$("qPrev"),nx=$("qNext"); if(pv)pv.disabled=i<=0; if(nx)nx.disabled=i>=n-1};
  const ir=(d)=>{const s=sl();if(!s)return; s.style.scrollBehavior="smooth"; s.scrollTo({left:(idx()+d)*s.clientWidth}); $("qCorpo").scrollTo({top:Math.max(0,s.offsetTop-70),behavior:"smooth"})};
  $("qPrev").onclick=()=>ir(-1); $("qNext").onclick=()=>ir(1);
  $("qIA").onclick=()=>{const s=sl(),c=s&&s.children[idx()],b=c&&c.querySelector("[data-ia]"); if(b)b.click()};
  document.addEventListener("scroll",(e)=>{if(e.target&&e.target.id==="qSlides"){atual(); const c=$("qCorpo"),s=sl(); if(c&&s&&c.scrollTop<s.offsetTop-70)c.scrollTo({top:s.offsetTop-70,behavior:"smooth"})}},true);
  let primeiro=true; dq.addEventListener("close",()=>{primeiro=true});
  document.addEventListener("af:qslides",()=>{atual(); const s=sl(); if(primeiro&&MOB()&&dq.open&&s){primeiro=false; $("qCorpo").scrollTo({top:Math.max(0,s.offsetTop-70)})}});
}
