// Aviso (webhook) do Mercado Pago. A assinatura é conferida e, mesmo assim, o estado vem de uma consulta à API (nunca do corpo do aviso).
import { json, erro, lerJson } from "../../_lib/util.js";
import { assinaturaValida, buscarOrder, aplicarOrder, mpAtivo } from "../../_lib/mercadopago.js";
import { processarFila } from "../../_lib/email.js";

export async function onRequestPost({ request, env, waitUntil }) {
  if (!mpAtivo(env) || !env.MERCADOPAGO_WEBHOOK_SECRET) return erro("Webhook não configurado.", 503);
  const url = new URL(request.url);
  const corpo = (await lerJson(request)) || {};
  const dataId = String(url.searchParams.get("data.id") || (corpo.data && corpo.data.id) || "");
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(dataId)) return erro("Aviso inválido.", 400);
  const ok = await assinaturaValida(env, { assinatura: request.headers.get("x-signature"), requestId: request.headers.get("x-request-id"), dataId });
  if (!ok) return erro("Assinatura inválida.", 401);
  if ((url.searchParams.get("type") || corpo.type) !== "order") return json({ ok: true, ignorado: true });   // outros tipos de aviso
  try {
    const order = await buscarOrder(env, dataId);
    const pedido = order && order.external_reference ? await env.DB.prepare("SELECT * FROM pedidos WHERE token = ?").bind(order.external_reference).first() : null;
    if (!pedido) return json({ ok: true, pedido: false });
    const r = await aplicarOrder(env, pedido, order);
    waitUntil(processarFila(env).catch((e) => console.error("fila de e-mails", e)));
    return json(r);
  } catch (e) {
    console.error("webhook Mercado Pago", e.message);
    return erro("Falha ao processar. Tente de novo.", 500);     // o Mercado Pago reenvia
  }
}
