import { json, erro, lerJson } from "../../../_lib/util.js";
import * as v from "../../../_lib/validar.js";
import { sanitizarDescricao } from "../../../_lib/html.js";

export async function onRequestGet({ env, params }) {
  const p = await env.DB.prepare("SELECT slug, titulo, conteudo, publicada FROM paginas WHERE slug = ?").bind(params.slug).first();
  return p ? json({ slug: p.slug, titulo: p.titulo, conteudo: sanitizarDescricao(p.conteudo), publicada: !!p.publicada }) : erro("Página não encontrada.", 404);
}

export async function onRequestPut({ request, env, params }) {
  if (!(await env.DB.prepare("SELECT 1 FROM paginas WHERE slug = ?").bind(params.slug).first())) return erro("Página não encontrada.", 404);
  const c = await lerJson(request);
  if (!c) return erro("Dados inválidos.");
  try {
    const titulo = v.texto(c.titulo, "Título", { max: 80, obrigatorio: true });
    const limpo = sanitizarDescricao(v.texto(c.conteudo, "Texto", { max: 60000 }));
    if (limpo.length > 30000) throw new Error("Texto: longo demais. Reduza um pouco.");
    await env.DB.prepare("UPDATE paginas SET titulo = ?, conteudo = ?, publicada = ?, atualizado_em = datetime('now') WHERE slug = ?").bind(titulo, limpo, v.bool(c.publicada), params.slug).run();
    return json({ ok: true });
  } catch (e) { return erro(e.message); }
}
