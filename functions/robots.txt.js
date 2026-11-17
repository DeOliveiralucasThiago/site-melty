import { origemDe } from "./_lib/seo.js";

export async function onRequestGet({ request, env }) {
  const o = origemDe(env, request);
  return new Response(`User-agent: *\nDisallow: /admin/\nDisallow: /api/\nDisallow: /checkout\nDisallow: /pedido\nDisallow: /pagamento-teste\n\nSitemap: ${o}/sitemap.xml\n`, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
