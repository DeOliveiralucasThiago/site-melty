import { json, erro, lerJson } from "../../../_lib/util.js";
import { lerCategoria } from "./index.js";

async function atualizar(env, id, corpo, parcial) {
  if (!(await env.DB.prepare("SELECT 1 FROM categorias WHERE id = ?").bind(id).first())) return erro("Categoria não encontrada.", 404);
  if (!corpo) return erro("Dados inválidos.");
  try {
    const o = lerCategoria(corpo, parcial);
    const cols = Object.keys(o);
    if (cols.length) await env.DB.prepare(`UPDATE categorias SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).bind(...cols.map((c) => o[c]), id).run();
    return json({ ok: true });
  } catch (e) { return erro(e.message); }
}
export const onRequestPut = async ({ request, env, params }) => atualizar(env, params.id, await lerJson(request), false);
export const onRequestPatch = async ({ request, env, params }) => atualizar(env, params.id, await lerJson(request), true);

export async function onRequestDelete({ env, params }) {
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM produtos WHERE categoria_id = ?").bind(params.id).first();
  if (n > 0) return erro(`Esta categoria tem ${n} produto(s). Mude os produtos de categoria (ou oculte a categoria) antes de excluir.`, 409);
  const r = await env.DB.prepare("DELETE FROM categorias WHERE id = ?").bind(params.id).run();
  return r.meta.changes ? json({ ok: true }) : erro("Categoria não encontrada.", 404);
}
