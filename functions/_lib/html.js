// Limpeza (sanitização) da descrição dos produtos.
// O editor do painel gera HTML; aqui só passa uma lista fechada de formatações. Todo o resto vira texto puro.
// Permitidos: parágrafo, quebra de linha, negrito, itálico, listas, subtítulo, link https e as 3 cores da marca.

const PERMITIDAS = new Set(["p", "br", "strong", "em", "ul", "ol", "li", "h3", "a", "span"]);
const MAPA = { b: "strong", i: "em", div: "p", h1: "h3", h2: "h3", h4: "h3" };
const BLOCOS = new Set(["p", "ul", "ol", "h3"]);
const CLASSES = new Set(["cor-vinho", "cor-rosa", "marca-rosa"]);
const DESCARTAR_COM_CONTEUDO = ["script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math"];
// Cores da marca aceitas (hex minúsculo) e a classe de cada uma
const COR_TEXTO = { "#b52141": "cor-vinho", "#f2808a": "cor-rosa" };
const COR_FUNDO = { "#ffd9d9": "marca-rosa" };
const ENTIDADES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

const decodificar = (s) => s.replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (m) => ENTIDADES[m]);
const escapar = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function corParaHex(v) {
  v = String(v).trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) return "#" + m[1];
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (m) return "#" + m[1] + m[1] + m[2] + m[2] + m[3] + m[3];
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*1(?:\.0+)?\s*)?\)$/.exec(v);
  if (m) return "#" + [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("");
  return null;
}

export function sanitizarDescricao(entrada) {
  const s = String(entrada ?? "").replace(/\r\n?/g, "\n");

  // Texto simples (sem nenhuma tag): vira parágrafos
  if (!/<[a-zA-Z!\/]/.test(s)) {
    return s.trim().split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
      .map((b) => "<p>" + escapar(b).replace(/\n/g, "<br>") + "</p>").join("");
  }

  const saida = [];
  const pilha = [];
  const texto = (t) => { if (t) saida.push(escapar(decodificar(t))); };
  const fechar = (ate) => { while (pilha.length > ate) saida.push(`</${pilha.pop()}>`); };

  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let ultimo = 0, m;
  while ((m = re.exec(s))) {
    texto(s.slice(ultimo, m.index));
    ultimo = re.lastIndex;
    if (m[0].startsWith("<!--")) continue;

    const bruto = m[1].toLowerCase();
    const fecha = m[0][1] === "/";

    if (!fecha && DESCARTAR_COM_CONTEUDO.includes(bruto)) {
      // descarta a tag e tudo até o fechamento dela
      const fim = new RegExp(`</${bruto}\\s*>`, "i");
      const resto = s.slice(re.lastIndex);
      const achou = fim.exec(resto);
      re.lastIndex = ultimo = achou ? re.lastIndex + achou.index + achou[0].length : s.length;
      continue;
    }

    const nome = MAPA[bruto] || bruto;
    if (!PERMITIDAS.has(nome)) continue;

    if (nome === "br") { if (!fecha) saida.push("<br>"); continue; }

    if (fecha) {
      const idx = pilha.lastIndexOf(nome);
      if (idx >= 0) fechar(idx);
      continue;
    }

    let atributos = "";
    if (nome === "a") {
      const h = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[2]);
      const url = h ? decodificar((h[1] ?? h[2]).trim()) : "";
      if (!/^https:\/\/[^\s<>"']+$/i.test(url) || url.length > 300) continue;
      atributos = ` href="${escapar(url)}" target="_blank" rel="noopener noreferrer"`;
    } else if (nome === "span") {
      const classes = new Set();
      const c = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[2]);
      if (c) (c[1] ?? c[2]).split(/\s+/).forEach((t) => { if (CLASSES.has(t)) classes.add(t); });
      // O editor aplica cor com style; só as cores exatas da marca são aceitas e viram classes
      const st = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[2]);
      if (st) {
        decodificar(st[1] ?? st[2]).split(";").forEach((decl) => {
          const i = decl.indexOf(":");
          if (i < 0) return;
          const k = decl.slice(0, i).trim().toLowerCase(), hex = corParaHex(decl.slice(i + 1));
          if (k === "color" && COR_TEXTO[hex]) classes.add(COR_TEXTO[hex]);
          if ((k === "background-color" || k === "background") && COR_FUNDO[hex]) classes.add(COR_FUNDO[hex]);
        });
      }
      if (!classes.size) continue;
      atributos = ` class="${[...classes].join(" ")}"`;
    }

    // Um bloco novo não pode ficar dentro de parágrafo ou subtítulo aberto
    if (BLOCOS.has(nome)) {
      const aberto = Math.max(pilha.lastIndexOf("p"), pilha.lastIndexOf("h3"));
      if (aberto >= 0) fechar(aberto);
    }
    saida.push(`<${nome}${atributos}>`);
    pilha.push(nome);
  }
  texto(s.slice(ultimo));
  fechar(0);

  let html = saida.join("");
  let antes;
  do { antes = html; html = html.replace(/<(p|h3|li|strong|em|span)(?: [^>]*)?>(?:\s|<br>)*<\/\1>/g, ""); } while (html !== antes);
  return html.trim();
}
