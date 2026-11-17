import { json } from "../../../_lib/util.js";

export async function onRequestGet({ env }) {
  const r = await env.DB.prepare("SELECT slug, titulo, publicada, atualizado_em FROM paginas ORDER BY titulo").all();
  return json(r.results.map((p) => ({ slug: p.slug, titulo: p.titulo, publicada: !!p.publicada, atualizado_em: p.atualizado_em })));
}
