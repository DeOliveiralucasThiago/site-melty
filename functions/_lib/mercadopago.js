// Mercado Pago — API de Orders (Checkout Transparente). Documentação: mercadopago.com.br/developers/pt/docs/checkout-api-orders
// O servidor NUNCA confia no que chega pelo aviso (webhook): sempre consulta a order na API antes de dar o pedido como pago.
import { aplicarPagamento } from "./pedidos.js";

const BASE = "https://api.mercadopago.com";

export class ErroMP extends Error {
  constructor(mensagem, status = 0, detalhes = null) { super(mensagem); this.status = status; this.detalhes = detalhes; }
}

export const mpAtivo = (env) => !!env.MERCADOPAGO_ACCESS_TOKEN;
const reais = (centavos) => (centavos / 100).toFixed(2);
const centavosDe = (txt) => Math.round(parseFloat(txt) * 100);

async function chamar(env, metodo, caminho, corpo, chaveIdempotencia) {
  if (!mpAtivo(env)) throw new ErroMP("O Mercado Pago não está configurado.", 0);
  const headers = { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}` };
  if (metodo === "POST") headers["X-Idempotency-Key"] = chaveIdempotencia || crypto.randomUUID();
  let r, texto;
  try {
    r = await fetch(BASE + caminho, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined, signal: AbortSignal.timeout(15000) });
    texto = await r.text();
  } catch (e) { throw new ErroMP("Não foi possível falar com o Mercado Pago.", 0, String(e.message || e)); }
  let j = null; try { j = JSON.parse(texto); } catch { /* resposta sem JSON */ }
  if (!r.ok) {
    const detalhe = j && (j.message || (j.errors && j.errors[0] && (j.errors[0].message || j.errors[0].code))) || "";
    throw new ErroMP(r.status === 401 ? "O Mercado Pago não reconheceu o token (inválido ou vencido)." : `O Mercado Pago respondeu com erro ${r.status}${detalhe ? ": " + String(detalhe).slice(0, 200) : ""}.`, r.status, j);
  }
  return j;
}

const partirNome = (nome) => { const p = String(nome).trim().split(/\s+/); return { first_name: p[0] || "Cliente", last_name: p.slice(1).join(" ") || p[0] || "Cliente" }; };

/** Cria (ou devolve a mesma, por idempotência) a order Pix do pedido. Expira em 30 min (mínimo aceito pelo Mercado Pago). */
export async function criarOrderPix(env, pedido) {
  const o = await chamar(env, "POST", "/v1/orders", {
    type: "online", processing_mode: "automatic", total_amount: reais(pedido.total_centavos), external_reference: pedido.token,
    payer: { email: pedido.cliente_email, ...partirNome(pedido.cliente_nome), identification: { type: "CPF", number: pedido.cliente_cpf } },
    transactions: { payments: [{ amount: reais(pedido.total_centavos), payment_method: { id: "pix", type: "bank_transfer" }, expiration_time: "PT30M" }] },
  }, `pix-${pedido.token}`);
  const pm = o && o.transactions && o.transactions.payments && o.transactions.payments[0] && o.transactions.payments[0].payment_method;
  if (!o || !o.id || !pm || !pm.qr_code) throw new ErroMP("O Mercado Pago não devolveu o código Pix.", 200, o);
  const pg = o.transactions.payments[0];
  return { id: o.id, codigo: pm.qr_code, qr_base64: pm.qr_code_base64 || "", ticket_url: pm.ticket_url || "", expira: pg.date_of_expiration || null };
}

/** Mensagem para o cliente a partir do motivo técnico da recusa (sem expor detalhes do banco). */
export function motivoRecusa(detalhe) {
  const d = String(detalhe || "");
  if (/insufficient_amount/.test(d)) return "O cartão não tem limite ou saldo suficiente. Tente outro cartão.";
  if (/security_code|bad_filled/.test(d)) return "Confira o código de segurança e a validade do cartão.";
  if (/call_for_authorize|high_risk|blacklist|rejected_by_issuer|rejected_by_bank/.test(d)) return "O banco não autorizou o pagamento. Tente outro cartão ou fale com o seu banco.";
  return "Não foi possível aprovar o pagamento. Confira os dados ou tente outro cartão.";
}

/**
 * Paga o pedido com cartão de crédito. O token do cartão é gerado pelo Mercado Pago no navegador (os dados do cartão nunca passam pelo nosso servidor).
 * Recusa vem como HTTP 402 com a order dentro do erro: devolvida como order "failed" (não é erro do site).
 * Valor, CPF e e-mail são os do pedido salvo, nunca os que o navegador mandar.
 */
export async function criarOrderCartao(env, pedido, { token, paymentMethodId, parcelas }) {
  const corpo = {
    type: "online", processing_mode: "automatic", total_amount: reais(pedido.total_centavos), external_reference: pedido.token,
    payer: { email: pedido.cliente_email, ...partirNome(pedido.cliente_nome), identification: { type: "CPF", number: pedido.cliente_cpf } },
    transactions: { payments: [{ amount: reais(pedido.total_centavos), payment_method: { id: paymentMethodId, type: "credit_card", token, installments: parcelas } }] },
  };
  try {
    return await chamar(env, "POST", "/v1/orders", corpo, `cartao-${pedido.token}-${String(token).slice(-12)}`);   // token do cartão é de uso único: cada tentativa tem a sua chave
  } catch (e) {
    const data = e instanceof ErroMP && e.status === 402 && e.detalhes && e.detalhes.data;
    if (data && data.id) {
      const det = e.detalhes.errors && e.detalhes.errors[0] && e.detalhes.errors[0].details && e.detalhes.errors[0].details[0];
      return { ...data, status: "failed", status_detail: data.status_detail || "failed", motivo: String(det || "") };
    }
    throw e;
  }
}

export const buscarOrder = (env, id) => chamar(env, "GET", `/v1/orders/${encodeURIComponent(id)}`);
export const cancelarOrder = (env, id) => chamar(env, "POST", `/v1/orders/${encodeURIComponent(id)}/cancel`);

/** Converte o estado da order em ação sobre o pedido. */
export async function aplicarOrder(env, pedido, order) {
  if (!order || order.external_reference !== pedido.token) return { ok: false, motivo: "order_de_outro_pedido" };
  if (order.status === "processed" && order.status_detail === "accredited") {
    return aplicarPagamento(env, pedido.token, { status: "aprovado", valorCentavos: centavosDe(order.total_paid_amount), ref: order.id });
  }
  if (order.status === "refunded") return aplicarPagamento(env, pedido.token, { status: "reembolsado", ref: order.id });
  if (order.status === "failed") return aplicarPagamento(env, pedido.token, { status: "recusado", ref: `${order.id} ${order.status_detail || ""}`.trim() });
  return { ok: true, pendente: true };
}

/** Consulta a order e atualiza o pedido. Limita a 1 consulta a cada 8 s por pedido (o cliente fica abrindo a página). */
export async function conferirPedido(env, pedido) {
  if (pedido.provedor !== "mercadopago" || !pedido.pagamento_ref || pedido.status !== "aguardando_pagamento" || !mpAtivo(env)) return null;
  const agoraMs = Date.now();
  const r = await env.DB.prepare("UPDATE pedidos SET mp_checado_em = ? WHERE id = ? AND mp_checado_em < ?").bind(agoraMs, pedido.id, agoraMs - 8000).run();
  if (!r.meta.changes) return null;
  try { return await aplicarOrder(env, pedido, await buscarOrder(env, pedido.pagamento_ref)); }
  catch (e) { console.error("conferência Mercado Pago", e.message); return null; }
}

/* ---------- assinatura do aviso (x-signature) ---------- */
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
function iguais(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

/** manifest: "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" com HMAC-SHA256 do segredo do webhook. Aceita o id como veio ou em minúsculas. */
export async function assinaturaValida(env, { assinatura, requestId, dataId }) {
  if (!env.MERCADOPAGO_WEBHOOK_SECRET || !assinatura || !dataId) return false;
  const partes = Object.fromEntries(String(assinatura).split(",").map((x) => x.trim().split("=").map((s) => s.trim())));
  if (!partes.ts || !partes.v1) return false;
  const ts = Number(partes.ts);
  if (!Number.isFinite(ts)) return false;
  const idadeMs = Math.abs(Date.now() - (ts > 1e12 ? ts : ts * 1000));
  if (idadeMs > 15 * 60 * 1000) return false;                       // aviso velho demais (evita repetição)
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.MERCADOPAGO_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  for (const id of new Set([dataId, dataId.toLowerCase()])) {
    const manifest = `id:${id};${requestId ? `request-id:${requestId};` : ""}ts:${partes.ts};`;
    if (iguais(hex(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(manifest))), String(partes.v1).toLowerCase())) return true;
  }
  return false;
}
