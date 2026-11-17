// "Já conferi": limpa o alerta de revisão do pedido.
import { json, erro } from "../../../../_lib/util.js";
import { detalhe } from "../[id].js";

export async function onRequestPost({ env, params }) {
  const id = Number(params.id);
  const r = await env.DB.prepare("UPDATE pedidos SET revisao = '' WHERE id = ? AND revisao <> ''").bind(id).run();
  if (r.meta.changes) await env.DB.prepare("INSERT INTO pedido_eventos (pedido_id, tipo, detalhe) VALUES (?, 'revisao_resolvida', '')").bind(id).run();
  const d = await detalhe(env.DB, id);
  return d ? json(d) : erro("Pedido não encontrado.", 404);
}
