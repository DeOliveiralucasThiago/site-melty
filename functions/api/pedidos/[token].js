// Acompanhamento do pedido pelo link secreto. Mostra só o necessário (sem CPF, e-mail, telefone ou endereço completo).
import { json, erro } from "../../_lib/util.js";
import { paraAcompanhamento } from "../../_lib/pedidos.js";

export async function onRequestGet({ env, params }) {
  if (!/^[a-f0-9]{32}$/.test(params.token)) return erro("Pedido não encontrado.", 404);
  const p = await env.DB.prepare("SELECT * FROM pedidos WHERE token = ?").bind(params.token).first();
  if (!p) return erro("Pedido não encontrado.", 404);
  return json(await paraAcompanhamento(env.DB, p), 200, { "x-robots-tag": "noindex" });
}
