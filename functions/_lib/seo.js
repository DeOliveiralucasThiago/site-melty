// Informações para Google e para a pré-visualização ao compartilhar (WhatsApp, Instagram etc.).
// As redes não executam o JavaScript do site, então estas tags são inseridas pelo servidor.
import { precoVigente } from "./precos.js";
import { sanitizarDescricao } from "./html.js";

export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const semTags = (html) => String(html).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const corta = (t, n) => (t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…");
export const origemDe = (env, request) => (env.SITE_URL || new URL(request.url).origin).replace(/\/+$/, "");
const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;

function tagsOg({ titulo, descricao, url, imagem, tipo = "website", loja }) {
  return [
    `<meta name="description" content="${esc(descricao)}">`,
    `<meta property="og:type" content="${tipo}">`, `<meta property="og:site_name" content="${esc(loja)}">`, `<meta property="og:locale" content="pt_BR">`,
    `<meta property="og:title" content="${esc(titulo)}">`, `<meta property="og:description" content="${esc(descricao)}">`, `<meta property="og:url" content="${esc(url)}">`,
    imagem ? `<meta property="og:image" content="${esc(imagem)}">` : "", `<meta name="twitter:card" content="${imagem ? "summary_large_image" : "summary"}">`,
    `<link rel="canonical" href="${esc(url)}">`,
  ].join("\n");
}

async function configBasica(db) {
  const r = (await db.prepare("SELECT chave, valor FROM config WHERE chave IN ('loja','slogan','instagram')").all()).results;
  const c = Object.fromEntries(r.map((x) => [x.chave, JSON.parse(x.valor)]));
  return { loja: c.loja || "Melty", slogan: c.slogan || "", instagram: c.instagram || "" };
}

export async function seoHome(db, origem) {
  const c = await configBasica(db);
  const banner = await db.prepare("SELECT imagem_id FROM banners WHERE ativo = 1 ORDER BY ordem, id LIMIT 1").first();
  const titulo = `${c.loja} | ${c.slogan || "Velas aromáticas artesanais"}`;
  const descricao = `${c.slogan || "Velas aromáticas artesanais"}. Veja as velas da ${c.loja} e compre online.`;
  const imagem = banner ? `${origem}/img/${banner.imagem_id}` : "";
  const dados = { "@context": "https://schema.org", "@type": "Organization", name: c.loja, url: origem + "/", ...(imagem ? { image: imagem } : {}), ...(c.instagram ? { sameAs: [`https://instagram.com/${c.instagram}`] } : {}) };
  return { titulo, head: tagsOg({ titulo, descricao, url: origem + "/", imagem, loja: c.loja }) + "\n" + jsonLd(dados) };
}

export async function seoProduto(db, origem, id) {
  const p = await db.prepare("SELECT * FROM produtos WHERE id = ? AND ativo = 1").bind(id).first();
  if (!p) return null;
  const c = await configBasica(db);
  const pv = precoVigente(p);
  const reais = (pv.centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const titulo = `${p.nome} | ${c.loja}`;
  const resumo = corta(semTags(sanitizarDescricao(p.descricao)), 140);
  const descricao = `${resumo ? resumo + " " : ""}${reais}${p.estoque > 0 ? "" : " (esgotada)"}`.trim();
  const imgs = JSON.parse(p.imagens);
  const imagem = imgs[0] ? `${origem}/img/${imgs[0]}` : "";
  const url = `${origem}/produto?id=${encodeURIComponent(p.id)}`;
  const dados = {
    "@context": "https://schema.org", "@type": "Product", name: p.nome, description: semTags(sanitizarDescricao(p.descricao)) || p.nome,
    ...(imgs.length ? { image: imgs.map((i) => `${origem}/img/${i}`) } : {}), brand: { "@type": "Brand", name: c.loja },
    offers: { "@type": "Offer", url, priceCurrency: "BRL", price: (pv.centavos / 100).toFixed(2), availability: p.estoque > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" },
  };
  return { titulo, head: tagsOg({ titulo, descricao, url, imagem, tipo: "product", loja: c.loja }) + "\n" + jsonLd(dados) };
}
