import { json, erro, lerJson } from "../../../_lib/util.js";
import { limparOrfas } from "../../../_lib/imagens.js";
import { lerBanner } from "./index.js";

async function atualizar(env, id, corpo, parcial) {
  if (!(await env.DB.prepare("SELECT 1 FROM banners WHERE id = ?").bind(id).first())) return erro("Banner não encontrado.", 404);
  if (!corpo) return erro("Dados inválidos.");
  try {
    const o = await lerBanner(env.DB, corpo, parcial);
    const cols = Object.keys(o);
    if (cols.length) await env.DB.prepare(`UPDATE banners SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).bind(...cols.map((c) => o[c]), id).run();
    if ("imagem_id" in o) await limparOrfas(env.DB);
    return json({ ok: true });
  } catch (e) { return erro(e.message); }
}
export const onRequestPut = async ({ request, env, params }) => atualizar(env, params.id, await lerJson(request), false);
export const onRequestPatch = async ({ request, env, params }) => atualizar(env, params.id, await lerJson(request), true);

export async function onRequestDelete({ env, params }) {
  const r = await env.DB.prepare("DELETE FROM banners WHERE id = ?").bind(params.id).run();
  if (!r.meta.changes) return erro("Banner não encontrado.", 404);
  await limparOrfas(env.DB);
  return json({ ok: true });
}
