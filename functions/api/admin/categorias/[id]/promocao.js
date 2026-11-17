// Desconto em porcentagem sobre todos os produtos de uma categoria (grava o preço promocional de cada um).
import { json, erro, lerJson } from "../../../../_lib/util.js";
import * as v from "../../../../_lib/validar.js";

export async function onRequestPost({ request, env, params }) {
  const corpo = await lerJson(request);
  if (!corpo) return erro("Dados inválidos.");
  if (!(await env.DB.prepare("SELECT 1 FROM categorias WHERE id = ?").bind(params.id).first())) return erro("Categoria não encontrada.", 404);
  try {
    if (corpo.remover) {
      const r = await env.DB.prepare("UPDATE produtos SET preco_promo_centavos = NULL, promo_inicio = NULL, promo_fim = NULL WHERE categoria_id = ?").bind(params.id).run();
      return json({ alterados: r.meta.changes });
    }
    const pct = v.inteiro(corpo.percentual, "Desconto (%)", 1, 90);
    const inicio = v.data(corpo.inicio, "Início"), fim = v.data(corpo.fim, "Fim");
    if (inicio && fim && fim < inicio) throw new Error("O fim não pode ser antes do início.");
    const r = await env.DB.prepare(
      "UPDATE produtos SET preco_promo_centavos = MAX(1, CAST(ROUND(preco_centavos * (100 - ?) / 100.0) AS INTEGER)), promo_inicio = ?, promo_fim = ? WHERE categoria_id = ?")
      .bind(pct, inicio, fim, params.id).run();
    return json({ alterados: r.meta.changes });
  } catch (e) { return erro(e.message); }
}
