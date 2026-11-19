// Dados da página de pagamento e criação do Pix. O valor vem do pedido salvo no servidor, nunca do navegador.
import { json, erro, lerJson, limitar, ipDe } from "../../_lib/util.js";
import { criarOrderPix, criarOrderCartao, aplicarOrder, cancelarOrder, motivoRecusa, mpAtivo, ErroMP } from "../../_lib/mercadopago.js";
import { processarFila } from "../../_lib/email.js";
import { numeroDoPedido } from "../../_lib/pedidos.js";

const PARCELAS_MAX = (env) => Math.min(12, Math.max(1, parseInt(env.MERCADOPAGO_PARCELAS_MAX, 10) || 1));
const ver = (p, env) => ({
  numero: numeroDoPedido(p.id), status: p.status, total: p.total_centavos / 100, expira_em: p.expira_em,
  cartao: env.MERCADOPAGO_PUBLIC_KEY ? { public_key: env.MERCADOPAGO_PUBLIC_KEY, parcelas_max: PARCELAS_MAX(env) } : null,
  pix: p.pix_codigo ? { codigo: p.pix_codigo, qr_base64: p.pix_qr, expira_em: p.pix_expira_em } : null,
});

async function pedidoDe(env, token) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  return env.DB.prepare("SELECT * FROM pedidos WHERE token = ? AND provedor = 'mercadopago'").bind(token).first();
}

export async function onRequestGet({ env, params }) {
  const p = await pedidoDe(env, params.token);
  if (!p) return erro("Pedido não encontrado.", 404);
  return json(ver(p, env), 200, { "x-robots-tag": "noindex" });
}

export async function onRequestPost({ request, env, params, waitUntil }) {
  if (!(await limitar(env.DB, `pix:${ipDe(request)}`, 20, 3600 * 1000))) return erro("Muitas tentativas. Aguarde um pouco e tente de novo.", 429);
  const p = await pedidoDe(env, params.token);
  if (!p) return erro("Pedido não encontrado.", 404);
  const corpo = (await lerJson(request)) || {};
  if (!["pix", "cartao"].includes(corpo.metodo)) return erro("Forma de pagamento inválida.");
  if (p.status !== "aguardando_pagamento") return erro("Este pedido não está aguardando pagamento.", 409);
  if (!mpAtivo(env)) return erro("O pagamento online ainda não está disponível.", 503);
  return corpo.metodo === "pix" ? pagarPix(env, p) : pagarCartao(env, p, corpo, waitUntil);
}

async function pagarPix(env, p) {
  if (p.pix_codigo) return json(ver(p, env));                 // já criado: devolve o mesmo
  try {
    const x = await criarOrderPix(env, p);
    await env.DB.prepare("UPDATE pedidos SET pagamento_ref = ?, pix_codigo = ?, pix_qr = ?, pix_expira_em = ? WHERE id = ? AND pix_codigo = ''")
      .bind(x.id, x.codigo, x.qr_base64, x.expira, p.id).run();
    return json(ver(await env.DB.prepare("SELECT * FROM pedidos WHERE id = ?").bind(p.id).first(), env), 201);
  } catch (e) {
    console.error("criar Pix", e instanceof ErroMP ? `${e.message} ${JSON.stringify(e.detalhes || "").slice(0, 300)}` : e);
    return erro("Não foi possível gerar o Pix agora. Tente de novo em instantes.", 502);
  }
}

async function pagarCartao(env, p, corpo, waitUntil) {
  if (!env.MERCADOPAGO_PUBLIC_KEY) return erro("O pagamento por cartão ainda não está disponível.", 503);
  const token = String(corpo.token || ""), metodo = String(corpo.payment_method_id || ""), parcelas = Number(corpo.installments);
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(token) || !/^[a-z_]{2,30}$/.test(metodo) || !Number.isInteger(parcelas) || parcelas < 1 || parcelas > PARCELAS_MAX(env)) return erro("Dados do cartão inválidos. Confira e tente de novo.");
  let order;
  try { order = await criarOrderCartao(env, p, { token, paymentMethodId: metodo, parcelas }); }
  catch (e) {
    console.error("pagar com cartão", e instanceof ErroMP ? `${e.message} ${JSON.stringify(e.detalhes || "").slice(0, 300)}` : e);
    return erro("Não foi possível processar o cartão agora. Tente de novo em instantes.", 502);
  }
  if (order.status === "failed") {
    await aplicarOrder(env, p, order);                          // registra a recusa no histórico
    return json({ aprovado: false, erro: motivoRecusa(order.motivo || order.status_detail) }, 402);
  }
  // Aprovado (ou ainda em análise): guarda a order e, se aprovou, aplica o pagamento agora
  await env.DB.prepare("UPDATE pedidos SET pagamento_ref = ? WHERE id = ?").bind(order.id, p.id).run();
  const r = await aplicarOrder(env, p, order);
  if (r && r.pendente === undefined) waitUntil(processarFila(env).catch((e) => console.error("fila de e-mails", e)));
  if (order.status === "processed" && p.pix_codigo && p.pagamento_ref) { try { await cancelarOrder(env, p.pagamento_ref); } catch { /* o Pix antigo expira sozinho */ } }   // evita pagar duas vezes
  return json({ aprovado: order.status === "processed", analise: order.status !== "processed" }, 201);
}
