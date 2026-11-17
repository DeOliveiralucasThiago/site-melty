import { seoHome, origemDe, esc } from "./_lib/seo.js";

export async function onRequestGet({ request, env, next }) {
  const resp = await next();
  if (!(resp.headers.get("content-type") || "").includes("text/html")) return resp;
  try {
    const s = await seoHome(env.DB, origemDe(env, request));
    return new HTMLRewriter().on('meta[name="description"]', { element: (e) => e.remove() }).on("title", { element: (e) => e.setInnerContent(s.titulo) }).on("head", { element: (e) => e.append(s.head, { html: true }) }).transform(resp);
  } catch (e) { console.error("seo home", e); return resp; }
}
