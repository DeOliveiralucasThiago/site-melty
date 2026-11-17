import { getPlatformProxy } from "wrangler";
import { criarPedido, aplicarPagamento, cancelarPedido, liberarVencidos, mudarStatus, paraAcompanhamento } from "../functions/_lib/pedidos.js";
import { ErroNegocio } from "../functions/_lib/cupons.js";

const { env: base, dispose } = await getPlatformProxy({ configPath: new URL("../wrangler.toml", import.meta.url).pathname, persist: { path: new URL("../.wrangler/state/v3", import.meta.url).pathname } });
const env = { ...base, PAGAMENTO_PROVEDOR: "teste" };
const db = env.DB;
const URL_BASE = "https://loja.exemplo";
let ok = 0, bad = 0;
const t = (nome, cond, extra = "") => { cond ? ok++ : bad++; console.log(cond ? "OK  " : "FALHA", nome, cond ? "" : String(extra)); };
const cod = async (fn) => { try { await fn(); return null; } catch (e) { return e instanceof ErroNegocio ? e.codigo : "ERRO:" + e.message; } };

// CPFs de teste válidos (calculados, não são de pessoas reais)
const CPFS = ["52998224725", "11144477735", "39053344705", "86288366757", "71428793860", "93541134780", "15350946056"];
const cliente = (i, extra = {}) => ({ nome: "Maria da Silva", email: `m${i}@exemplo.com`, telefone: "(27) 99999-0000", cpf: CPFS[i], cep: "29100-000", rua: "Rua das Flores", numero: "10", complemento: "ap 2", bairro: "Centro", cidade: "Vila Velha", uf: "ES", aceite: true, ...extra });
const pedir = (i, itens, extra = {}, ambiente = env) => criarPedido(ambiente, { itens, cliente: cliente(i, extra) }, { urlBase: URL_BASE });
const estoque = async (id) => (await db.prepare("SELECT estoque FROM produtos WHERE id = ?").bind(id).first()).estoque;
const pedidoPorToken = (tk) => db.prepare("SELECT * FROM pedidos WHERE token = ?").bind(tk).first();
const novoCupom = async (c) => (await db.prepare("INSERT INTO cupons (codigo, tipo, valor, limite_total, so_primeira_compra) VALUES (?, ?, ?, ?, ?)").bind(c.codigo, c.tipo, c.valor ?? 0, c.limite ?? null, c.primeira ? 1 : 0).run()).meta.last_row_id;

await db.prepare("INSERT INTO config (chave, valor) VALUES ('frete_provisorio', '20') ON CONFLICT(chave) DO UPDATE SET valor = '20'").run();

// ---- sem provedor / dados inválidos ----
t("sem provedor de pagamento: recusa", (await cod(() => pedir(0, [{ id: "bamboo-dreams", qtd: 1 }], {}, base))) === "pagamento_inativo");
for (const [nome, extra] of [["CPF inválido", { cpf: "123" }], ["e-mail inválido", { email: "x" }], ["telefone curto", { telefone: "123" }], ["CEP curto", { cep: "123" }], ["UF inválida", { uf: "XX" }], ["sem aceite da política", { aceite: false }], ["nome vazio", { nome: "" }], ["rua vazia", { rua: "" }]])
  t(`dados inválidos: ${nome}`, (await cod(() => pedir(0, [{ id: "bamboo-dreams", qtd: 1 }], extra))) === "dados");
t("carrinho vazio", (await cod(() => criarPedido(env, { itens: [], cliente: cliente(0) }, { urlBase: URL_BASE }))) === "carrinho");

// ---- pedido válido ----
const e0 = await estoque("bamboo-dreams");               // 2
const r1 = await pedir(0, [{ id: "bamboo-dreams", qtd: 1 }]);
const p1 = await pedidoPorToken(r1.token);
t("pedido criado: status, token e link de pagamento", p1.status === "aguardando_pagamento" && /^[a-f0-9]{32}$/.test(r1.token) && r1.url.includes(r1.token) && r1.numero === 1000 + p1.id, JSON.stringify(r1));
t("total = produto + frete provisório (R$ 79,90 + R$ 20,00)", p1.subtotal_centavos === 7990 && p1.frete_centavos === 2000 && p1.total_centavos === 9990, JSON.stringify(p1));
t("estoque reservado (baixou 1)", (await estoque("bamboo-dreams")) === e0 - 1);
t("CPF guardado só com dígitos", p1.cliente_cpf === CPFS[0] && p1.cliente_telefone === "27999990000");
t("item guardado com nome e preço da hora da compra", (await db.prepare("SELECT nome, unitario_centavos, qtd FROM pedido_itens WHERE pedido_id = ?").bind(p1.id).first()).nome === "Vela Bamboo Dreams");
t("expira em ~30 min", Math.abs(new Date(p1.expira_em.replace(" ", "T") + "Z") - Date.now() - 30 * 60000) < 30000);

// ---- estoque ----
t("quantidade maior que o estoque", (await cod(() => pedir(1, [{ id: "bamboo-dreams", qtd: 5 }]))) === "estoque");
t("produto esgotado", (await cod(() => pedir(1, [{ id: "mousse-de-limao", qtd: 1 }]))) === "estoque");
t("preço enviado pelo navegador é ignorado no pedido", await (async () => { const r = await criarPedido(env, { itens: [{ id: "cereja-avela", qtd: 1, preco: 1, unitario: 1 }], total: 1, cliente: cliente(1) }, { urlBase: URL_BASE }); return (await pedidoPorToken(r.token)).subtotal_centavos === 7990; })());

// ---- disputa pelo último item (apple-pie tem 1) ----
const disputa = await Promise.all([2, 3, 4].map((i) => pedir(i, [{ id: "apple-pie", qtd: 1 }]).then((r) => "ok:" + r.token, (e) => e.codigo)));
const vencedores = disputa.filter((x) => x.startsWith("ok:")), perdedores = disputa.filter((x) => !x.startsWith("ok:"));
t("3 pessoas, 1 unidade: exatamente 1 compra", vencedores.length === 1 && perdedores.length === 2 && perdedores.every((x) => x === "estoque"), JSON.stringify(disputa));
t("estoque nunca fica negativo", (await estoque("apple-pie")) === 0);
const { n: pedidosApple } = await db.prepare("SELECT COUNT(*) AS n FROM pedido_itens WHERE produto_id = 'apple-pie' AND pedido_id IN (SELECT id FROM pedidos WHERE status = 'aguardando_pagamento')").first();
t("só 1 pedido gravado para o item disputado", pedidosApple === 1, pedidosApple);

// ---- cupom no pedido ----
const cid = await novoCupom({ codigo: "DEZ", tipo: "percentual", valor: 10 });
const rc = await pedir(5, [{ id: "cappuccino", qtd: 1 }], { cupom: "dez" });
const pc = await pedidoPorToken(rc.token);
t("cupom: desconto de 10% no pedido", pc.desconto_centavos === 799 && pc.total_centavos === 7990 - 799 + 2000 && pc.cupom_codigo === "DEZ", JSON.stringify(pc));
t("cupom fica reservado enquanto não paga", (await db.prepare("SELECT status FROM cupom_usos WHERE pedido_ref = ?").bind(rc.token).first()).status === "reservado");
t("mesmo CPF não reusa o cupom em outro pedido", (await cod(() => pedir(5, [{ id: "cereja-avela", qtd: 1 }], { cupom: "DEZ" }))) === "cpf_ja_usou");

// ---- pagamento ----
let res = await aplicarPagamento(env, rc.token, { status: "aprovado", valorCentavos: pc.total_centavos, cpfPagador: CPFS[5] });
const pagoC = await pedidoPorToken(rc.token);
t("pagamento aprovado: pedido pago", pagoC.status === "pago" && pagoC.pago_em && pagoC.revisao === "", JSON.stringify(pagoC));
t("cupom virou 'consumido' e CPF entrou em 'já comprou'", (await db.prepare("SELECT status FROM cupom_usos WHERE pedido_ref = ?").bind(rc.token).first()).status === "consumido" && !!(await db.prepare("SELECT 1 FROM compradores WHERE pedido_ref = ?").bind(rc.token).first()));
const repetido = await Promise.all([1, 2, 3].map(() => aplicarPagamento(env, rc.token, { status: "aprovado", valorCentavos: pc.total_centavos, cpfPagador: CPFS[5] })));
t("aviso repetido/simultâneo não duplica nada", repetido.every((x) => x.repetido) && (await db.prepare("SELECT COUNT(*) AS n FROM compradores WHERE pedido_ref = ?").bind(rc.token).first()).n === 1);
t("pedido pago não pode ser cancelado por expiração", (await cancelarPedido(db, pagoC.id, "x")) === false);

// CPF diferente e valor menor ficam sinalizados
const rd = await pedir(6, [{ id: "lavanda", qtd: 1 }]);
res = await aplicarPagamento(env, rd.token, { status: "aprovado", valorCentavos: 5000, cpfPagador: CPFS[0] });
t("CPF do pagador diferente + valor menor: pago, mas com alerta de revisão", (await pedidoPorToken(rd.token)).revisao === "valor_divergente,cpf_diferente" && res.ok, (await pedidoPorToken(rd.token)).revisao);
t("pagamento sem CPF do pagador (provedor que não informa) não gera alerta de CPF", await (async () => { const r = await pedir(0, [{ id: "cereja-avela", qtd: 1 }]); await aplicarPagamento(env, r.token, { status: "aprovado", valorCentavos: 9990 }); return (await pedidoPorToken(r.token)).revisao === ""; })());

// recusado não cancela
const rr = await pedir(1, [{ id: "peachy", qtd: 1 }]);
await aplicarPagamento(env, rr.token, { status: "recusado" });
t("pagamento recusado mantém o pedido aguardando (pode tentar de novo)", (await pedidoPorToken(rr.token)).status === "aguardando_pagamento");

// ---- cancelar e expirar ----
const eP = await estoque("peachy");
t("cancelar pedido aguardando devolve o estoque", (await cancelarPedido(db, (await pedidoPorToken(rr.token)).id, "teste")) === true && (await estoque("peachy")) === eP + 1);
t("cancelar duas vezes não devolve em dobro", (await cancelarPedido(db, (await pedidoPorToken(rr.token)).id, "teste")) === false && (await estoque("peachy")) === eP + 1);
const cid2 = await novoCupom({ codigo: "UMUSO", tipo: "valor", valor: 500, limite: 1 });
const antesRx = await estoque("peachy");
const rx = await pedir(2, [{ id: "peachy", qtd: 1 }], { cupom: "UMUSO" });
t("cupom de 1 uso reservado: outro CPF não consegue", (await cod(() => pedir(3, [{ id: "peachy", qtd: 1 }], { cupom: "UMUSO" }))) === "cupom_esgotado");
await db.prepare("UPDATE pedidos SET expira_em = datetime('now', '-1 minute') WHERE token = ?").bind(rx.token).run();
await liberarVencidos(db);
t("pedido vencido é cancelado, estoque volta e cupom é liberado", (await pedidoPorToken(rx.token)).status === "cancelado" && (await estoque("peachy")) === antesRx && (await cod(() => pedir(3, [{ id: "peachy", qtd: 1 }], { cupom: "UMUSO" }))) === null);

// ---- pagou depois de vencer ----
const rv = await pedir(4, [{ id: "figo-ambarado", qtd: 1 }]);
await db.prepare("UPDATE pedidos SET expira_em = datetime('now', '-1 minute') WHERE token = ?").bind(rv.token).run();
await liberarVencidos(db);
const eF = await estoque("figo-ambarado");
await aplicarPagamento(env, rv.token, { status: "aprovado", valorCentavos: 9990, cpfPagador: CPFS[4] });
const pv = await pedidoPorToken(rv.token);
t("pagamento após vencer: pedido vira 'pago' com alerta e pega o estoque de volta", pv.status === "pago" && pv.revisao === "pago_apos_cancelamento" && (await estoque("figo-ambarado")) === eF - 1, JSON.stringify(pv));

// ---- frete grátis ----
await novoCupom({ codigo: "FRETEGRATIS", tipo: "frete" });
const rf = await pedir(6, [{ id: "bamboo-dreams", qtd: 1 }], { cupom: "FRETEGRATIS" });
t("cupom de frete grátis zera o frete", (await pedidoPorToken(rf.token)).frete_centavos === 0 && (await pedidoPorToken(rf.token)).total_centavos === 7990);

// ---- etapas pelo painel ----
const idPago = pagoC.id;
t("pago → enviado exige código de rastreio válido", (await cod(() => mudarStatus(db, idPago, "enviado", { rastreio: "x" }))) === "rastreio");
await mudarStatus(db, idPago, "em_producao");
await mudarStatus(db, idPago, "enviado", { rastreio: "ab123456789br" });
const pe = await db.prepare("SELECT * FROM pedidos WHERE id = ?").bind(idPago).first();
t("enviado: rastreio em maiúsculas e data de envio", pe.status === "enviado" && pe.rastreio === "AB123456789BR" && !!pe.enviado_em);
t("não volta de enviado para em produção", (await cod(() => mudarStatus(db, idPago, "em_producao"))) === "transicao");
await mudarStatus(db, idPago, "entregue");
t("entregue", (await db.prepare("SELECT status, entregue_em FROM pedidos WHERE id = ?").bind(idPago).first()).entregue_em !== null);
t("entregue não pode ser cancelado (só reembolsado)", (await cod(() => mudarStatus(db, idPago, "cancelado"))) === "transicao");
const eCapp = await estoque("cha-branco");
const rCan = await pedir(3, [{ id: "cha-branco", qtd: 1 }]);
await aplicarPagamento(env, rCan.token, { status: "aprovado", valorCentavos: 10290 });
await mudarStatus(db, (await pedidoPorToken(rCan.token)).id, "cancelado");
t("cancelar pedido pago (ainda não enviado) devolve o estoque", (await estoque("cha-branco")) === eCapp);

// ---- privacidade da página de acompanhamento ----
const pub = JSON.stringify(await paraAcompanhamento(db, await pedidoPorToken(rc.token)));
t("acompanhamento não expõe CPF, e-mail, telefone nem rua", ![CPFS[5], "m5@exemplo.com", "27999990000", "Rua das Flores", "29100"].some((x) => pub.includes(x)), pub);
t("acompanhamento mostra o essencial", pub.includes("Entregue") && pub.includes("Cappuccino") && pub.includes("Vila Velha"));
await mudarStatus(db, pagoC.id, "reembolsado").catch(() => {});

console.log(`\n${ok} ok, ${bad} falhas`);
await dispose();
process.exit(bad ? 1 : 0);
