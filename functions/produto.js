import { seoProduto, origemDe } from "./_lib/seo.js";

export async function onRequestGet({ request, env, next }) {
  const resp = await next();
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[a-z0-9-]{1,60}$/.test(id) || !(resp.headers.get("content-type") || "").includes("text/html")) return resp;
  try {
    const s = await seoProduto(env.DB, origemDe(env, request), id);
    if (!s) return resp;
    return new HTMLRewriter().on('meta[name="description"]', { element: (e) => e.remove() }).on("title", { element: (e) => e.setInnerContent(s.titulo) }).on("head", { element: (e) => e.append(s.head, { html: true }) }).transform(resp);
  } catch (e) { console.error("seo produto", e); return resp; }
}
