import { origemDe, esc } from "./_lib/seo.js";

export async function onRequestGet({ request, env }) {
  const o = origemDe(env, request);
  const urls = [`${o}/`, `${o}/catalogo`];
  const cats = (await env.DB.prepare("SELECT id FROM categorias WHERE ativa = 1").all()).results;
  cats.forEach((c) => urls.push(`${o}/catalogo?cat=${encodeURIComponent(c.id)}`));
  const prods = (await env.DB.prepare("SELECT id FROM produtos WHERE ativo = 1 ORDER BY ordem, criado_em").all()).results;
  prods.forEach((p) => urls.push(`${o}/produto?id=${encodeURIComponent(p.id)}`));
  const pgs = (await env.DB.prepare("SELECT slug FROM paginas WHERE publicada = 1").all()).results;
  pgs.forEach((p) => urls.push(`${o}/${p.slug === "prazos-e-envio" ? "prazos" : p.slug}`));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(u)}</loc></url>`).join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
