// Acompanhamento do pedido pelo link secreto. Mostra só o necessário (sem CPF, e-mail, telefone ou endereço completo).
import { json, erro } from "../../_lib/util.js";
import { paraAcompanhamento } from "../../_lib/pedidos.js";
import { conferirPedido } from "../../_lib/mercadopago.js";
import { processarFila } from "../../_lib/email.js";

export async function onRequestGet({ env, params, waitUntil }) {
  if (!/^[a-f0-9]{32}$/.test(params.token)) return erro("Pedido não encontrado.", 404);
  const p = await env.DB.prepare("SELECT * FROM pedidos WHERE token = ?").bind(params.token).first();
  if (!p) return erro("Pedido não encontrado.", 404);
  // Reserva caso o aviso (webhook) atrase: ao abrir o acompanhamento, confere o pagamento direto no Mercado Pago.
  const c = await conferirPedido(env, p);
  if (c) { waitUntil(processarFila(env).catch((e) => console.error("fila de e-mails", e))); return json(await paraAcompanhamento(env.DB, await env.DB.prepare("SELECT * FROM pedidos WHERE id = ?").bind(p.id).first()), 200, { "x-robots-tag": "noindex" }); }
  return json(await paraAcompanhamento(env.DB, p), 200, { "x-robots-tag": "noindex" });
}
