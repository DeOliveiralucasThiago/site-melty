// Dados da página de pagamento e criação do Pix. O valor vem do pedido salvo no servidor, nunca do navegador.
import { json, erro, lerJson, limitar, ipDe } from "../../_lib/util.js";
import { criarOrderPix, mpAtivo, ErroMP } from "../../_lib/mercadopago.js";
import { numeroDoPedido } from "../../_lib/pedidos.js";

const ver = (p) => ({
  numero: numeroDoPedido(p.id), status: p.status, total: p.total_centavos / 100, expira_em: p.expira_em,
  pix: p.pix_codigo ? { codigo: p.pix_codigo, qr_base64: p.pix_qr, expira_em: p.pix_expira_em } : null,
});

async function pedidoDe(env, token) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  return env.DB.prepare("SELECT * FROM pedidos WHERE token = ? AND provedor = 'mercadopago'").bind(token).first();
}

export async function onRequestGet({ env, params }) {
  const p = await pedidoDe(env, params.token);
  if (!p) return erro("Pedido não encontrado.", 404);
  return json(ver(p), 200, { "x-robots-tag": "noindex" });
}

export async function onRequestPost({ request, env, params }) {
  if (!(await limitar(env.DB, `pix:${ipDe(request)}`, 20, 3600 * 1000))) return erro("Muitas tentativas. Aguarde um pouco e tente de novo.", 429);
  const p = await pedidoDe(env, params.token);
  if (!p) return erro("Pedido não encontrado.", 404);
  const corpo = (await lerJson(request)) || {};
  if (corpo.metodo !== "pix") return erro("Forma de pagamento inválida.");
  if (p.status !== "aguardando_pagamento") return erro("Este pedido não está aguardando pagamento.", 409);
  if (p.pix_codigo) return json(ver(p));                      // já criado: devolve o mesmo
  if (!mpAtivo(env)) return erro("O pagamento online ainda não está disponível.", 503);
  try {
    const x = await criarOrderPix(env, p);
    await env.DB.prepare("UPDATE pedidos SET pagamento_ref = ?, pix_codigo = ?, pix_qr = ?, pix_expira_em = ? WHERE id = ? AND pix_codigo = ''")
      .bind(x.id, x.codigo, x.qr_base64, x.expira, p.id).run();
    return json(ver(await env.DB.prepare("SELECT * FROM pedidos WHERE id = ?").bind(p.id).first()), 201);
  } catch (e) {
    console.error("criar Pix", e instanceof ErroMP ? `${e.message} ${JSON.stringify(e.detalhes || "").slice(0, 300)}` : e);
    return erro("Não foi possível gerar o Pix agora. Tente de novo em instantes.", 502);
  }
}
