import { json, erro, lerJson } from "../../../_lib/util.js";
import { lerCupom, paraPainel } from "./index.js";

async function atualizar(env, id, corpo, parcial) {
  const atual = await env.DB.prepare("SELECT * FROM cupons WHERE id = ?").bind(id).first();
  if (!atual) return erro("Cupom não encontrado.", 404);
  if (!corpo) return erro("Dados inválidos.");
  try {
    const o = await lerCupom(env.DB, corpo, { parcial });
    if ("codigo" in o && o.codigo !== atual.codigo) {
      const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM cupom_usos WHERE cupom_id = ?").bind(id).first();
      if (n > 0) throw new Error("Este cupom já foi usado, então o código não pode mudar. Crie um cupom novo e desative este.");
      if (await env.DB.prepare("SELECT 1 FROM cupons WHERE codigo = ? AND id <> ?").bind(o.codigo, id).first()) throw new Error("Já existe um cupom com esse código.");
    }
    const cols = Object.keys(o);
    if (cols.length) await env.DB.prepare(`UPDATE cupons SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).bind(...cols.map((c) => o[c]), id).run();
    const novo = await env.DB.prepare("SELECT * FROM cupons WHERE id = ?").bind(id).first();
    return json(paraPainel(novo));
  } catch (e) { return erro(e.message); }
}
export const onRequestPut = async ({ request, env, params }) => atualizar(env, params.id, await lerJson(request), false);
export const onRequestPatch = async ({ request, env, params }) => atualizar(env, params.id, await lerJson(request), true);

export async function onRequestDelete({ env, params }) {
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM cupom_usos WHERE cupom_id = ?").bind(params.id).first();
  if (n > 0) return erro("Este cupom já tem usos registrados e não pode ser excluído. Desative-o para encerrar.", 409);
  const r = await env.DB.prepare("DELETE FROM cupons WHERE id = ?").bind(params.id).run();
  return r.meta.changes ? json({ ok: true }) : erro("Cupom não encontrado.", 404);
}
