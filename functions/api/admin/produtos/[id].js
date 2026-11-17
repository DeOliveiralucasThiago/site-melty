import { json, erro, lerJson, agora } from "../../../_lib/util.js";
import { limparOrfas } from "../../../_lib/imagens.js";
import { lerProduto, paraPainel } from "./index.js";

async function atualizar(env, id, corpo, parcial) {
  const existe = await env.DB.prepare("SELECT * FROM produtos WHERE id = ?").bind(id).first();
  if (!existe) return erro("Produto não encontrado.", 404);
  if (!corpo) return erro("Dados inválidos.");
  try {
    const o = await lerProduto(env.DB, corpo, { parcial, existente: existe });
    const promo = "preco_promo_centavos" in o ? o.preco_promo_centavos : existe.preco_promo_centavos;
    const cheio = o.preco_centavos ?? existe.preco_centavos;
    if (promo && promo >= cheio) throw new Error("O preço normal ficou igual ou menor que o preço promocional. Ajuste ou remova a promoção.");
    o.atualizado_em = agora();
    const cols = Object.keys(o);
    await env.DB.prepare(`UPDATE produtos SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).bind(...cols.map((c) => o[c]), id).run();
    if ("imagens" in o) await limparOrfas(env.DB);
    return json(paraPainel(await env.DB.prepare("SELECT * FROM produtos WHERE id = ?").bind(id).first()));
  } catch (e) { return erro(e.message); }
}

export const onRequestPut = async ({ request, env, params }) => atualizar(env, params.id, await lerJson(request), false);
// PATCH: altera só os campos enviados (usado nos botões rápidos de estoque, ativo etc.)
export const onRequestPatch = async ({ request, env, params }) => atualizar(env, params.id, await lerJson(request), true);

export async function onRequestDelete({ env, params }) {
  const r = await env.DB.prepare("DELETE FROM produtos WHERE id = ?").bind(params.id).run();
  if (!r.meta.changes) return erro("Produto não encontrado.", 404);
  await limparOrfas(env.DB);
  return json({ ok: true });
}
