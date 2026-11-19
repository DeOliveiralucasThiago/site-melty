import { getPlatformProxy } from "wrangler";
import crypto from "node:crypto";
import { criarPedido, liberarVencidos } from "../functions/_lib/pedidos.js";
import { conferirPedido, assinaturaValida } from "../functions/_lib/mercadopago.js";
import { onRequestGet as pagarGet, onRequestPost as pagarPost } from "../functions/api/pagar/[token].js";
import { onRequestPost as webhook } from "../functions/api/mercadopago/webhook.js";
import { onRequestGet as acompanhar } from "../functions/api/pedidos/[token].js";
import { ErroNegocio } from "../functions/_lib/cupons.js";

const { env: base, dispose } = await getPlatformProxy({ configPath: new URL("../wrangler.toml", import.meta.url).pathname, persist: { path: new URL("../.wrangler/state/v3", import.meta.url).pathname } });
const TOKEN = "APP_USR-token-de-teste-9876543210", SEGREDO = "segredo_do_webhook_de_teste";
const env = { ...base, PAGAMENTO_PROVEDOR: "mercadopago", EMAIL_PROVEDOR: "teste", MERCADOPAGO_ACCESS_TOKEN: TOKEN, MERCADOPAGO_WEBHOOK_SECRET: SEGREDO, MERCADOPAGO_PUBLIC_KEY: "APP_USR-chave-publica-de-teste" };
const db = env.DB;
let ok = 0, bad = 0;
const t = (nome, cond, extra = "") => { cond ? ok++ : bad++; console.log(cond ? "OK  " : "FALHA", nome, cond ? "" : String(extra).slice(0, 600)); };
const setCfg = (k, v) => db.prepare("INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").bind(k, JSON.stringify(v)).run();
await db.prepare("UPDATE produtos SET estoque = 80").run();
await setCfg("frete_provisorio", 15);
await setCfg("melhorenvio", { ativo: false });
const esperar = [];
const waitUntil = (p) => esperar.push(p);

// ---------- servidor de mentira do Mercado Pago ----------
const realFetch = globalThis.fetch;
let chamadas = [], orders = {};
globalThis.fetch = async (url, opt = {}) => {
  const u = String(url);
  if (!u.startsWith("https://api.mercadopago.com")) return realFetch(url, opt);
  const caminho = u.replace("https://api.mercadopago.com", "");
  const corpo = opt.body ? JSON.parse(opt.body) : null;
  chamadas.push({ caminho, metodo: opt.method || "GET", headers: opt.headers, corpo });
  const resp = (status, j) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });
  if (caminho === "/v1/orders" && opt.method === "POST" && corpo.transactions.payments[0].payment_method.type === "credit_card") {
    const pm = corpo.transactions.payments[0].payment_method, id = "ORDTSTCARD" + crypto.createHash("md5").update(opt.headers["X-Idempotency-Key"]).digest("hex").toUpperCase();
    if (/RECUSA|SEMLIMITE/.test(pm.token)) {
      const det = /SEMLIMITE/.test(pm.token) ? "insufficient_amount" : "rejected_by_issuer";
      const o = { id, external_reference: corpo.external_reference, total_amount: corpo.total_amount, total_paid_amount: "0.00", status: "failed", status_detail: "failed", transactions: { payments: [{ id: "PAYX", status: "failed", status_detail: det }] } };
      orders[id] = o; return resp(402, { errors: [{ code: "failed", message: "The following transactions failed", details: ["PAYX: " + det] }], data: o });
    }
    orders[id] = { id, external_reference: corpo.external_reference, total_amount: corpo.total_amount, total_paid_amount: corpo.total_amount, status: "processed", status_detail: "accredited", transactions: { payments: [{ id: "PAYC", status: "processed", status_detail: "accredited" }] } };
    return resp(201, orders[id]);
  }
  if (caminho === "/v1/orders" && opt.method === "POST") {
    const chave = opt.headers["X-Idempotency-Key"];
    const id = "ORDTST" + crypto.createHash("md5").update(chave).digest("hex").toUpperCase();
    orders[id] ||= { id, external_reference: corpo.external_reference, total_amount: corpo.total_amount, total_paid_amount: "0.00", status: "action_required", status_detail: "waiting_transfer",
      transactions: { payments: [{ id: "PAY1", status: "action_required", date_of_expiration: new Date(Date.now() + 30 * 60000).toISOString(), payment_method: { id: "pix", type: "bank_transfer", qr_code: "00020126PIXCOPIAECOLA" + id, qr_code_base64: "iVBORw0KGgo=", ticket_url: "https://exemplo/ticket" } }] } };
    return resp(201, orders[id]);
  }
  let m = caminho.match(/^\/v1\/orders\/([A-Za-z0-9]+)$/);
  if (m && (opt.method || "GET") === "GET") return orders[m[1]] ? resp(200, orders[m[1]]) : resp(404, { message: "not found" });
  m = caminho.match(/^\/v1\/orders\/([A-Za-z0-9]+)\/cancel$/);
  if (m && opt.method === "POST") { if (!orders[m[1]]) return resp(404, {}); orders[m[1]].status = "canceled"; orders[m[1]].status_detail = "canceled"; return resp(200, orders[m[1]]); }
  return resp(404, { message: "rota não simulada" });
};
const pagarOrder = (id, extra = {}) => Object.assign(orders[id], { status: "processed", status_detail: "accredited", total_paid_amount: orders[id].total_amount }, extra);

const CPF = "52998224725";
const cliente = (extra = {}) => ({ nome: "João da Silva", email: "joao@exemplo.com", telefone: "27988887777", cpf: CPF, cep: "01001-000", rua: "Praça da Sé", numero: "100", complemento: "", bairro: "Sé", cidade: "São Paulo", uf: "SP", aceite: true, ...extra });
const pedir = async (itens = [{ id: "bamboo-dreams", qtd: 1 }]) => { const r = await criarPedido(env, { itens, cliente: cliente() }, { urlBase: "https://loja.exemplo" }); return { ...r, p: await db.prepare("SELECT * FROM pedidos WHERE token = ?").bind(r.token).first() }; };
const recarregar = (id) => db.prepare("SELECT * FROM pedidos WHERE id = ?").bind(id).first();
let ipN = 0;   // cada chamada com IP próprio, para o limitador de tentativas não atrapalhar
const POST = (corpo, headers = {}) => new Request("https://loja.exemplo/x", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `10.0.${Math.floor(++ipN / 250)}.${ipN % 250}`, ...headers }, body: JSON.stringify(corpo) });
const assinar = (dataId, { ts = String(Math.floor(Date.now() / 1000)), reqId = "req-1", segredo = SEGREDO } = {}) =>
  `ts=${ts},v1=${crypto.createHmac("sha256", segredo).update(`id:${dataId};request-id:${reqId};ts:${ts};`).digest("hex")}`;
const aviso = (dataId, { sig, tipo = "order", reqId = "req-1" } = {}) => new Request(`https://loja.exemplo/api/mercadopago/webhook?data.id=${dataId}&type=${tipo}`, {
  method: "POST", headers: { "content-type": "application/json", "x-request-id": reqId, "x-signature": sig ?? assinar(dataId, { reqId }) }, body: JSON.stringify({ type: tipo, data: { id: dataId } }) });
const cod = async (fn) => { try { await fn(); return null; } catch (e) { return e instanceof ErroNegocio ? "N:" + e.codigo : "ERRO:" + e.message; } };

// ---------- pedido ----------
const A = await pedir();
t("pedido leva à página /pagar do próprio site e grava o provedor", A.url === `https://loja.exemplo/pagar?t=${A.token}` && A.p.provedor === "mercadopago" && A.p.pagamento_ref === "", JSON.stringify([A.url, A.p.provedor]));
t("criar o pedido NÃO chama o Mercado Pago (a order só nasce ao escolher Pix)", chamadas.length === 0);
// limitador de tentativas
{ const L = await pedir(); let ultimo; for (let i = 0; i < 22; i++) ultimo = await pagarPost({ request: new Request("https://loja.exemplo/x", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "9.9.9.9" }, body: JSON.stringify({ metodo: "boleto" }) }), env, params: { token: L.token }, waitUntil });
  t("muitas tentativas seguidas do mesmo IP: 429", ultimo.status === 429, ultimo.status); }
const semToken = await cod(() => criarPedido({ ...env, MERCADOPAGO_ACCESS_TOKEN: undefined }, { itens: [{ id: "bamboo-dreams", qtd: 1 }], cliente: cliente() }, { urlBase: "https://x" }));
t("sem token do Mercado Pago o pagamento fica indisponível (nunca vira pedido de graça)", semToken === "N:pagamento_inativo", semToken);

// ---------- Pix ----------
let r = await pagarPost({ request: POST({ metodo: "pix" }), env, params: { token: A.token } });
let j = await r.json();
const c1 = chamadas[0];
t("Pix: cria a order na rota certa com token, chave de idempotência e valor do pedido", r.status === 201 && c1.caminho === "/v1/orders" && c1.metodo === "POST" && c1.headers.Authorization === `Bearer ${TOKEN}` && c1.headers["X-Idempotency-Key"] === `pix-${A.token}` && c1.corpo.total_amount === (A.p.total_centavos / 100).toFixed(2), JSON.stringify(c1.corpo));
t("Pix: referência = token do pedido, expira em 30 min, CPF e e-mail do pagador, modo automático", c1.corpo.external_reference === A.token && c1.corpo.transactions.payments[0].expiration_time === "PT30M" && c1.corpo.payer.identification.number === CPF && c1.corpo.payer.email === "joao@exemplo.com" && c1.corpo.processing_mode === "automatic" && c1.corpo.type === "online" && c1.corpo.transactions.payments[0].payment_method.id === "pix", JSON.stringify(c1.corpo));
t("Pix: devolve o copia e cola e o QR", j.pix && j.pix.codigo.startsWith("00020126") && j.pix.qr_base64 === "iVBORw0KGgo=", JSON.stringify(j));
const A2 = await recarregar(A.p.id);
t("Pix: guarda a order no pedido", A2.pagamento_ref.startsWith("ORDTST") && A2.pix_codigo === j.pix.codigo);
const n = chamadas.length;
r = await pagarPost({ request: POST({ metodo: "pix" }), env, params: { token: A.token } });
t("pedir Pix de novo devolve o mesmo, sem nova chamada", r.status === 200 && (await r.json()).pix.codigo === j.pix.codigo && chamadas.length === n);
r = await pagarGet({ env, params: { token: A.token } }); j = await r.json();
t("GET /pagar mostra número, total e Pix, sem CPF/e-mail/telefone", j.pix && j.total > 0 && !JSON.stringify(j).includes(CPF) && !JSON.stringify(j).includes("joao@") && !JSON.stringify(j).includes("27988887777"));
t("token do Mercado Pago nunca aparece nas respostas", !JSON.stringify(j).includes(TOKEN));
r = await pagarPost({ request: POST({ metodo: "boleto" }), env, params: { token: A.token } });
t("forma de pagamento inválida é recusada", r.status === 400);
r = await pagarGet({ env, params: { token: "0".repeat(32) } });
t("pedido inexistente: 404", r.status === 404);

// ---------- webhook ----------
const idA = A2.pagamento_ref;
let w = await webhook({ request: aviso(idA, { sig: "ts=1,v1=abc" }), env, waitUntil });
t("webhook com assinatura errada: 401 e nada muda", w.status === 401 && (await recarregar(A.p.id)).status === "aguardando_pagamento");
w = await webhook({ request: aviso(idA, { sig: assinar(idA, { segredo: "outro_segredo" }) }), env, waitUntil });
t("webhook assinado com outro segredo: 401", w.status === 401);
w = await webhook({ request: aviso(idA, { sig: assinar(idA, { ts: String(Math.floor(Date.now() / 1000) - 3600) }) }), env, waitUntil });
t("webhook com assinatura velha (1 h): 401", w.status === 401);
w = await webhook({ request: aviso(idA), env: { ...env, MERCADOPAGO_WEBHOOK_SECRET: undefined }, waitUntil });
t("sem segredo configurado o webhook recusa (503)", w.status === 503);
w = await webhook({ request: aviso(idA, { tipo: "payment" }), env, waitUntil });
t("aviso de outro tipo é ignorado", w.status === 200 && (await w.json()).ignorado === true);
w = await webhook({ request: aviso(idA), env, waitUntil });
t("webhook válido com order ainda pendente: não paga", w.status === 200 && (await recarregar(A.p.id)).status === "aguardando_pagamento");
pagarOrder(idA);
w = await webhook({ request: aviso(idA), env, waitUntil });
const A3 = await recarregar(A.p.id);
t("webhook válido + order paga (consultada na API): pedido vira 'pago'", w.status === 200 && A3.status === "pago" && !A3.revisao, JSON.stringify([w.status, A3.status, A3.revisao]));
await Promise.all(esperar.splice(0));
const emails = (await db.prepare("SELECT tipo, para FROM emails WHERE pedido_id = ?").bind(A.p.id).all()).results;
t("avisos de pagamento foram enfileirados (cliente + loja)", emails.some((e) => e.tipo === "pago") && emails.some((e) => e.tipo === "loja_pago"), JSON.stringify(emails));
const nEmails = emails.length;
w = await webhook({ request: aviso(idA), env, waitUntil });
await Promise.all(esperar.splice(0));
t("aviso repetido não duplica e-mail nem pagamento", (await db.prepare("SELECT COUNT(*) n FROM emails WHERE pedido_id = ?").bind(A.p.id).first()).n === nEmails);

// ---------- o corpo do aviso não manda: a API manda ----------
const B = await pedir();
await pagarPost({ request: POST({ metodo: "pix" }), env, params: { token: B.token } });
const idB = (await recarregar(B.p.id)).pagamento_ref;
const falso = new Request(`https://loja.exemplo/api/mercadopago/webhook?data.id=${idB}&type=order`, { method: "POST", headers: { "x-request-id": "req-1", "x-signature": assinar(idB) }, body: JSON.stringify({ type: "order", data: { id: idB, status: "processed", status_detail: "accredited" } }) });
await webhook({ request: falso, env, waitUntil });
t("corpo do aviso dizendo 'processed' não basta: vale o que a API responde", (await recarregar(B.p.id)).status === "aguardando_pagamento");

// ---------- valor menor e order de outro pedido ----------
pagarOrder(idB, { total_paid_amount: "1.00" });
await webhook({ request: aviso(idB), env, waitUntil });
const B2 = await recarregar(B.p.id);
t("valor pago menor que o pedido: marcado para revisão (valor_divergente)", B2.status === "pago" && (B2.revisao || "").includes("valor_divergente"), JSON.stringify([B2.status, B2.revisao]));
const C = await pedir();
await pagarPost({ request: POST({ metodo: "pix" }), env, params: { token: C.token } });
const idC = (await recarregar(C.p.id)).pagamento_ref;
orders[idC].external_reference = B.token; pagarOrder(idC);
await webhook({ request: aviso(idC), env, waitUntil });
t("order cuja referência é de outro pedido não paga ninguém errado", (await recarregar(C.p.id)).status === "aguardando_pagamento");
orders[idC].external_reference = C.token;

// ---------- conferência de reserva (quando o webhook atrasa) ----------
chamadas = [];
let rr = await acompanhar({ env, params: { token: C.token }, waitUntil });
let jr = await rr.json();
t("abrir o acompanhamento confere no Mercado Pago e já mostra 'pago'", jr.status === "pago" && chamadas.length === 1 && chamadas[0].caminho === `/v1/orders/${idC}`, JSON.stringify([jr.status, chamadas.map((x) => x.caminho)]));
const D = await pedir();
await pagarPost({ request: POST({ metodo: "pix" }), env, params: { token: D.token } });
chamadas = [];
await acompanhar({ env, params: { token: D.token }, waitUntil }); await acompanhar({ env, params: { token: D.token }, waitUntil });
t("conferência limitada: 2 aberturas seguidas = 1 consulta", chamadas.length === 1, JSON.stringify(chamadas.map((x) => x.caminho)));

// ---------- recusa ----------
const E = await pedir();
await pagarPost({ request: POST({ metodo: "pix" }), env, params: { token: E.token } });
const idE = (await recarregar(E.p.id)).pagamento_ref;
orders[idE].status = "failed"; orders[idE].status_detail = "failed";
await webhook({ request: aviso(idE), env, waitUntil });
t("order falhou: registra a recusa e o pedido continua aguardando", (await recarregar(E.p.id)).status === "aguardando_pagamento" && (await db.prepare("SELECT 1 FROM pedido_eventos WHERE pedido_id = ? AND tipo = 'pagamento_recusado'").bind(E.p.id).first()));

// ---------- expiração: cancela a order no Mercado Pago ----------
const F = await pedir();
await pagarPost({ request: POST({ metodo: "pix" }), env, params: { token: F.token } });
const idF = (await recarregar(F.p.id)).pagamento_ref;
await db.prepare("UPDATE pedidos SET expira_em = '2000-01-01 00:00:00' WHERE id = ?").bind(F.p.id).run();
chamadas = [];
await liberarVencidos(db, env);
t("pedido vencido é cancelado e a order também (Pix não pode ser pago depois)", (await recarregar(F.p.id)).status === "cancelado" && chamadas.some((x) => x.caminho === `/v1/orders/${idF}/cancel` && x.metodo === "POST") && orders[idF].status === "canceled", JSON.stringify(chamadas.map((x) => x.caminho)));
const G = await recarregar(F.p.id);
r = await pagarPost({ request: POST({ metodo: "pix" }), env, params: { token: F.token } });
t("pedido cancelado não gera novo Pix", r.status === 409);

// ---------- cartão ----------
const cartao = (token, extra = {}) => ({ metodo: "cartao", token, payment_method_id: "master", installments: 1, ...extra });
const H1 = await pedir();
r = await pagarGet({ env, params: { token: H1.token } }); j = await r.json();
t("GET /pagar informa a chave pública (não secreta) e as parcelas", j.cartao && j.cartao.public_key === "APP_USR-chave-publica-de-teste" && j.cartao.parcelas_max === 1 && !JSON.stringify(j).includes(TOKEN), JSON.stringify(j.cartao));
r = await pagarGet({ env: { ...env, MERCADOPAGO_PUBLIC_KEY: undefined }, params: { token: H1.token } });
t("sem chave pública o cartão fica escondido", (await r.json()).cartao === null);
r = await pagarPost({ request: POST(cartao("TOKENCARTAO1234567890")), env: { ...env, MERCADOPAGO_PUBLIC_KEY: undefined }, params: { token: H1.token }, waitUntil });
t("sem chave pública o servidor recusa cartão (503)", r.status === 503);
chamadas = [];
for (const [nome, corpo] of [["token curto", cartao("abc")], ["token com lixo", cartao("TOKEN<script>12345678")], ["parcelas acima do máximo (1)", cartao("TOKENCARTAO1234567890", { installments: 3 })], ["parcelas 0", cartao("TOKENCARTAO1234567890", { installments: 0 })], ["parcelas fracionadas", cartao("TOKENCARTAO1234567890", { installments: 1.5 })], ["bandeira inválida", cartao("TOKENCARTAO1234567890", { payment_method_id: "../x" })]]) {
  r = await pagarPost({ request: POST(corpo), env, params: { token: H1.token }, waitUntil });
  t(`cartão: ${nome} é recusado antes de falar com o Mercado Pago`, r.status === 400, r.status);
}
t("nenhuma dessas tentativas chegou ao Mercado Pago", chamadas.length === 0);

// recusado (HTTP 402 com a order dentro do erro)
r = await pagarPost({ request: POST(cartao("TOKENRECUSA1234567890")), env, params: { token: H1.token }, waitUntil });
j = await r.json();
t("cartão recusado: mensagem amigável (402), sem detalhes do banco", r.status === 402 && j.aprovado === false && /banco não autorizou/.test(j.erro) && !/rejected|PAYX|ORD/.test(JSON.stringify(j)), JSON.stringify(j));
let H1b = await recarregar(H1.p.id);
t("recusa: pedido continua aguardando, order recusada não substitui a referência e fica no histórico", H1b.status === "aguardando_pagamento" && H1b.pagamento_ref === "" && !!(await db.prepare("SELECT 1 FROM pedido_eventos WHERE pedido_id = ? AND tipo = 'pagamento_recusado'").bind(H1.p.id).first()));
r = await pagarPost({ request: POST(cartao("TOKENSEMLIMITE12345678")), env, params: { token: H1.token }, waitUntil });
t("sem limite: mensagem específica", /limite ou saldo/.test((await r.json()).erro));

// aprovado: usa valor, CPF e e-mail do PEDIDO, não do navegador
chamadas = [];
r = await pagarPost({ request: POST({ ...cartao("TOKENAPROVADO12345678"), transaction_amount: 0.01, payer: { email: "fraude@x.com", identification: { number: "11111111111" } }, total: 1 }), env, params: { token: H1.token }, waitUntil });
j = await r.json();
const cc = chamadas.find((x) => x.caminho === "/v1/orders").corpo;
t("cartão aprovado: 201 e pedido vira 'pago'", r.status === 201 && j.aprovado === true && (await recarregar(H1.p.id)).status === "pago", JSON.stringify([r.status, j]));
t("cartão: valor, CPF e e-mail vêm do pedido salvo (campos extras do navegador são ignorados)", cc.total_amount === (H1.p.total_centavos / 100).toFixed(2) && cc.payer.identification.number === CPF && cc.payer.email === "joao@exemplo.com" && cc.transactions.payments[0].payment_method.type === "credit_card" && cc.transactions.payments[0].payment_method.installments === 1, JSON.stringify(cc));
await Promise.all(esperar.splice(0));
t("cartão aprovado: e-mails de pagamento enfileirados", (await db.prepare("SELECT COUNT(*) n FROM emails WHERE pedido_id = ? AND tipo IN ('pago','loja_pago')").bind(H1.p.id).first()).n === 2);
r = await pagarPost({ request: POST(cartao("TOKENOUTRO1234567890")), env, params: { token: H1.token }, waitUntil });
t("pedido já pago não aceita outro pagamento (409)", r.status === 409);

// parcelas: com máximo 3, aceita 3
const H2 = await pedir();
r = await pagarPost({ request: POST(cartao("TOKENPARCELADO1234567", { installments: 3 })), env: { ...env, MERCADOPAGO_PARCELAS_MAX: "3" }, params: { token: H2.token }, waitUntil });
t("com máximo de 3 parcelas, 3x é aceito e vai ao Mercado Pago", r.status === 201 && chamadas.at(-1).corpo.transactions.payments[0].payment_method.installments === 3);

// Pix aberto + cartão aprovado: o Pix é cancelado (não paga duas vezes)
const H3 = await pedir();
await pagarPost({ request: POST({ metodo: "pix" }), env, params: { token: H3.token }, waitUntil });
const idPix = (await recarregar(H3.p.id)).pagamento_ref;
await pagarPost({ request: POST(cartao("TOKENTROCA12345678901")), env, params: { token: H3.token }, waitUntil });
t("pagou no cartão depois de gerar Pix: o Pix é cancelado", (await recarregar(H3.p.id)).status === "pago" && orders[idPix].status === "canceled", orders[idPix] && orders[idPix].status);
const k1 = chamadas.filter((x) => x.caminho === "/v1/orders" && x.corpo.transactions.payments[0].payment_method.type === "credit_card").map((x) => x.headers["X-Idempotency-Key"]);
t("cada tentativa de cartão usa chave de idempotência própria", new Set(k1).size === k1.length && k1.length >= 3, JSON.stringify(k1));

// ---------- assinatura: id em minúsculas também vale ----------
const idm = "ORDABC12345678";
const ts = String(Math.floor(Date.now() / 1000));
const sigMin = `ts=${ts},v1=${crypto.createHmac("sha256", SEGREDO).update(`id:${idm.toLowerCase()};request-id:r9;ts:${ts};`).digest("hex")}`;
t("assinatura calculada com o id em minúsculas também é aceita", await assinaturaValida(env, { assinatura: sigMin, requestId: "r9", dataId: idm }));
t("assinatura com id diferente é recusada", !(await assinaturaValida(env, { assinatura: sigMin, requestId: "r9", dataId: "ORDOUTRO1234" })));

await Promise.all(esperar.splice(0));
globalThis.fetch = realFetch;
console.log(`\n${ok} ok, ${bad} falhas`);
await dispose();
process.exit(bad ? 1 : 0);
