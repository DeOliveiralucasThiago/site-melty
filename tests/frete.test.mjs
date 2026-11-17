import { getPlatformProxy } from "wrangler";
import { ufDoCep, montarPacote, cotarFrete } from "../functions/_lib/frete.js";
import { criarPedido } from "../functions/_lib/pedidos.js";
import { ErroNegocio } from "../functions/_lib/cupons.js";

const { env: base, dispose } = await getPlatformProxy({ configPath: new URL("../wrangler.toml", import.meta.url).pathname, persist: { path: new URL("../.wrangler/state/v3", import.meta.url).pathname } });
const env = { ...base, PAGAMENTO_PROVEDOR: "teste", EMAIL_PROVEDOR: "teste" };
const db = env.DB;
let ok = 0, bad = 0;
const t = (nome, cond, extra = "") => { cond ? ok++ : bad++; console.log(cond ? "OK  " : "FALHA", nome, cond ? "" : String(extra).slice(0, 300)); };
const cod = async (fn) => { try { await fn(); return null; } catch (e) { return e instanceof ErroNegocio ? e.codigo : "ERRO:" + e.message; } };
const setCfg = (k, v) => db.prepare("INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").bind(k, JSON.stringify(v)).run();
const CPFS = ["52998224725", "11144477735", "39053344705", "86288366757", "71428793860", "93541134780"];
const cli = (i, extra = {}) => ({ nome: "Maria da Silva", email: `m${i}@exemplo.com`, telefone: "27999990000", cpf: CPFS[i], cep: "29100-000", rua: "Rua A", numero: "10", bairro: "Centro", cidade: "Vila Velha", uf: "ES", aceite: true, ...extra });
const pedir = (i, itens, extra) => criarPedido(env, { itens, cliente: cli(i, extra) }, { urlBase: "https://loja.exemplo" });
const linhas = (n) => [{ qtd: n, peso_kg: 0.42, altura_cm: null, largura_cm: null, comprimento_cm: null }];

// ---- estado pelo CEP ----
for (const [cep, uf] of [["29100-000", "ES"], ["01001-000", "SP"], ["20040-020", "RJ"], ["30140-071", "MG"], ["40020-000", "BA"], ["70040-010", "DF"], ["80010-000", "PR"], ["90010-000", "RS"], ["69900-000", "AC"], ["88010-000", "SC"], ["60010-000", "CE"], ["51020-000", "PE"], ["66010-000", "PA"], ["77001-000", "TO"], ["79002-000", "MS"]])
  t(`CEP ${cep} → ${uf}`, ufDoCep(cep) === uf, ufDoCep(cep));
t("CEP inválido/curto → nenhum estado", ufDoCep("123") === null && ufDoCep("") === null && ufDoCep(null) === null && ufDoCep("00000000") === null);

// ---- pacote ----
const pad = { altura: 10, largura: 12, comprimento: 16 };
let p = montarPacote(linhas(1), pad);
t("1 vela na caixa padrão", p.altura_cm === 10 && p.largura_cm === 12 && p.comprimento_cm === 16 && p.peso_kg === 0.42, JSON.stringify(p));
p = montarPacote(linhas(3), pad);
t("3 velas empilhadas: altura 30, peso 1,26", p.altura_cm === 30 && p.largura_cm === 12 && p.comprimento_cm === 16 && p.peso_kg === 1.26, JSON.stringify(p));
p = montarPacote([{ qtd: 1, peso_kg: 0.3, altura_cm: 5, largura_cm: 20, comprimento_cm: 8 }, { qtd: 2, peso_kg: 0.42, altura_cm: null, largura_cm: null, comprimento_cm: null }], pad);
t("itens com medidas próprias e itens na caixa padrão", p.altura_cm === 25 && p.largura_cm === 20 && p.comprimento_cm === 16 && p.peso_kg === 1.14, JSON.stringify(p));
p = montarPacote([{ qtd: 1, peso_kg: 0.05, altura_cm: 1, largura_cm: 5, comprimento_cm: 5 }], pad);
t("pacote pequeno respeita o mínimo dos Correios (16×11×2)", p.comprimento_cm === 16 && p.largura_cm === 11 && p.altura_cm === 2, JSON.stringify(p));

// ---- cotação ----
await setCfg("frete_provisorio", 20);
let q = await cotarFrete(db, env, { cep: "29100000", linhas: linhas(1), subtotal_centavos: 7990 });
t("sem regiões: valor único provisório", q.opcoes.length === 1 && q.opcoes[0].id === "unico" && q.opcoes[0].preco_centavos === 2000, JSON.stringify(q.opcoes));
await setCfg("frete_regioes", [
  { nome: "Entrega ES", ufs: ["ES"], preco: 15, prazo: 3 },
  { nome: "Sudeste", ufs: ["SP", "RJ", "MG"], preco: 25.5, prazo: 5 },
  { nome: "Entrega expressa", ufs: ["ES", "RJ"], preco: 40, prazo: 1 },
]);
q = await cotarFrete(db, env, { cep: "29100000", linhas: linhas(1), subtotal_centavos: 7990 });
t("ES: duas opções (padrão e expressa)", q.uf === "ES" && q.opcoes.map((o) => o.servico).join() === "Entrega ES,Entrega expressa" && q.opcoes[0].preco_centavos === 1500 && q.opcoes[1].transporte_dias === 1 && q.opcoes[1].prazo_dias_uteis === 4, JSON.stringify(q.opcoes));
q = await cotarFrete(db, env, { cep: "01001000", linhas: linhas(1), subtotal_centavos: 7990 });
t("SP: região Sudeste a R$ 25,50", q.uf === "SP" && q.opcoes.length === 1 && q.opcoes[0].preco_centavos === 2550, JSON.stringify(q.opcoes));
q = await cotarFrete(db, env, { cep: "69900000", linhas: linhas(1), subtotal_centavos: 7990 });
t("estado sem região configurada: nenhuma opção", q.uf === "AC" && q.opcoes.length === 0);
await setCfg("frete_gratis_acima", 150);
q = await cotarFrete(db, env, { cep: "29100000", linhas: linhas(1), subtotal_centavos: 15000 });
t("frete grátis a partir de R$ 150,00 (no limite)", q.opcoes.every((o) => o.preco_centavos === 0 && o.gratis), JSON.stringify(q.opcoes));
q = await cotarFrete(db, env, { cep: "29100000", linhas: linhas(1), subtotal_centavos: 14999 });
t("abaixo do limite continua cobrando", q.opcoes[0].preco_centavos === 1500 && !q.opcoes[0].gratis);
await setCfg("frete_gratis_acima", 0);
await setCfg("prazo_producao_dias_uteis", 3);
q = await cotarFrete(db, env, { cep: "29100000", linhas: linhas(1), subtotal_centavos: 7990 });
t("prazo único = transporte + preparo (3+3=6 e 1+3=4)", q.preparo_dias === 3 && q.opcoes[0].transporte_dias === 3 && q.opcoes[0].prazo_dias_uteis === 6 && q.opcoes[1].prazo_dias_uteis === 4, JSON.stringify(q.opcoes));
await setCfg("prazo_producao_dias_uteis", 2);
q = await cotarFrete(db, env, { cep: "29100000", linhas: linhas(1), subtotal_centavos: 7990 });
t("mudando o preparo para 2 dias, o prazo se ajusta sozinho (5 e 3)", q.opcoes[0].prazo_dias_uteis === 5 && q.opcoes[1].prazo_dias_uteis === 3);
await setCfg("prazo_producao_dias_uteis", 0);
q = await cotarFrete(db, env, { cep: "29100000", linhas: linhas(1), subtotal_centavos: 7990 });
t("sem dias de preparo, o prazo é só o do transporte", q.opcoes[0].prazo_dias_uteis === 3);
await setCfg("frete_regioes", [{ nome: "Sem prazo", ufs: ["ES"], preco: 10, prazo: null }, { nome: "Entrega ES", ufs: ["SP"], preco: 15, prazo: 3 }, { nome: "Sudeste", ufs: ["SP", "RJ", "MG"], preco: 25.5, prazo: 5 }, { nome: "Entrega expressa", ufs: ["ES", "RJ"], preco: 40, prazo: 1 }]);
await setCfg("prazo_producao_dias_uteis", 3);
q = await cotarFrete(db, env, { cep: "29100000", linhas: linhas(1), subtotal_centavos: 7990 });
t("região sem prazo de transporte informado: não inventa previsão", q.opcoes.find((o) => o.servico === "Sem prazo").prazo_dias_uteis === null);
await setCfg("frete_regioes", [
  { nome: "Entrega ES", ufs: ["ES"], preco: 15, prazo: 3 },
  { nome: "Sudeste", ufs: ["SP", "RJ", "MG"], preco: 25.5, prazo: 5 },
  { nome: "Entrega expressa", ufs: ["ES", "RJ"], preco: 40, prazo: 1 },
]);

// ---- pedido com a forma de entrega ----
const r1 = await pedir(0, [{ id: "bamboo-dreams", qtd: 1 }], { frete_id: "regiao:entrega-expressa" });
const p1 = await db.prepare("SELECT * FROM pedidos WHERE token = ?").bind(r1.token).first();
t("pedido guarda a forma de entrega, o preço e a previsão (transporte 1 + preparo 3 = 4)", p1.frete_servico === "Entrega expressa" && p1.frete_id === "regiao:entrega-expressa" && p1.frete_centavos === 4000 && p1.frete_prazo_dias === 4 && p1.total_centavos === 7990 + 4000, JSON.stringify(p1));
t("com 2 opções, precisa escolher", (await cod(() => pedir(1, [{ id: "cereja-avela", qtd: 1 }]))) === "frete");
t("opção inexistente é recusada", (await cod(() => pedir(1, [{ id: "cereja-avela", qtd: 1 }], { frete_id: "regiao:inventada" }))) === "frete");
t("opção de OUTRA região é recusada (SP não tem 'Entrega ES')", (await cod(() => pedir(1, [{ id: "cereja-avela", qtd: 1 }], { cep: "01001-000", uf: "SP", frete_id: "regiao:entrega-es" }))) === "frete");
t("CEP sem entrega é recusado", (await cod(() => pedir(1, [{ id: "cereja-avela", qtd: 1 }], { cep: "69900-000", uf: "AC", frete_id: "x" }))) === "frete");
const r2 = await pedir(2, [{ id: "cereja-avela", qtd: 1 }], { cep: "01001-000", uf: "ES", frete_id: "" });
const p2 = await db.prepare("SELECT * FROM pedidos WHERE token = ?").bind(r2.token).first();
t("só 1 opção: é escolhida sozinha; o estado vem do CEP (não do que o cliente digitou)", p2.frete_servico === "Sudeste" && p2.frete_centavos === 2550, JSON.stringify(p2));
const antes = (await db.prepare("SELECT estoque FROM produtos WHERE id = 'cappuccino'").first()).estoque;
t("erro de frete não reserva estoque", (await cod(() => pedir(3, [{ id: "cappuccino", qtd: 1 }], { frete_id: "nada" }))) === "frete" && (await db.prepare("SELECT estoque FROM produtos WHERE id = 'cappuccino'").first()).estoque === antes);

// cupom de frete grátis
await db.prepare("INSERT INTO cupons (codigo, tipo, valor) VALUES ('FRETE0', 'frete', 0)").run();
const r3 = await pedir(3, [{ id: "cappuccino", qtd: 1 }], { frete_id: "regiao:entrega-es", cupom: "FRETE0" });
const p3 = await db.prepare("SELECT * FROM pedidos WHERE token = ?").bind(r3.token).first();
t("cupom de frete grátis zera o frete, mas o pedido guarda a forma de entrega", p3.frete_centavos === 0 && p3.frete_servico === "Entrega ES" && p3.total_centavos === 7990, JSON.stringify(p3));
const cupomUsos = (await db.prepare("SELECT COUNT(*) AS n FROM cupom_usos WHERE pedido_ref = ?").bind(r3.token).first()).n;
t("erro de frete não deixa cupom reservado", (await cod(() => pedir(4, [{ id: "lavanda", qtd: 1 }], { frete_id: "nada", cupom: "FRETE0" }))) === "frete" && (await db.prepare("SELECT COUNT(*) AS n FROM cupom_usos u JOIN cupons c ON c.id = u.cupom_id WHERE c.codigo = 'FRETE0' AND u.status = 'reservado'").first()).n === 1 && cupomUsos === 1);

// medidas do produto entram no pacote do pedido
await db.prepare("UPDATE produtos SET altura_cm = 8, largura_cm = 9, comprimento_cm = 20 WHERE id = 'lavanda'").run();
const ped = await criarPedido(env, { itens: [{ id: "lavanda", qtd: 1 }], cliente: cli(4, { frete_id: "regiao:entrega-es" }) }, { urlBase: "https://loja.exemplo" });
t("pedido com produto de medidas próprias é criado", !!ped.token);
console.log(`\n${ok} ok, ${bad} falhas`);
await dispose();
process.exit(bad ? 1 : 0);
