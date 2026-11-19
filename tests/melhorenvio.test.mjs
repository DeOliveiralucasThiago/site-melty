import { getPlatformProxy } from "wrangler";
import { cotarFrete } from "../functions/_lib/frete.js";
import { criarPedido, aplicarPagamento, mudarStatus } from "../functions/_lib/pedidos.js";
import { gerarEtiqueta, linkEtiqueta, cancelarEtiqueta, buscarRastreio, testarConexao, ErroME } from "../functions/_lib/melhorenvio.js";
import { ErroNegocio } from "../functions/_lib/cupons.js";

const { env: base, dispose } = await getPlatformProxy({ configPath: new URL("../wrangler.toml", import.meta.url).pathname, persist: { path: new URL("../.wrangler/state/v3", import.meta.url).pathname } });
const TOKEN = "token_de_teste_1234567890";
const env = { ...base, PAGAMENTO_PROVEDOR: "teste", EMAIL_PROVEDOR: "teste", MELHORENVIO_TOKEN: TOKEN, MELHORENVIO_AMBIENTE: "sandbox" };
const db = env.DB;
let ok = 0, bad = 0;
const t = (nome, cond, extra = "") => { cond ? ok++ : bad++; console.log(cond ? "OK  " : "FALHA", nome, cond ? "" : String(extra).slice(0, 500)); };
const cod = async (fn) => { try { await fn(); return null; } catch (e) { return e instanceof ErroNegocio ? "N:" + e.codigo : e instanceof ErroME ? "ME:" + e.message : "ERRO:" + e.message; } };
const setCfg = (k, v) => db.prepare("INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").bind(k, JSON.stringify(v)).run();
await db.prepare("UPDATE produtos SET estoque = 80").run();
await db.prepare("DELETE FROM cotacoes_cache").run();

// ---------- servidor de mentira ----------
const realFetch = globalThis.fetch;
let chamadas = [];
let respostas = {};                       // caminho -> função (corpo, chamada) => { status, json }
globalThis.fetch = async (url, opt = {}) => {
  const u = String(url);
  if (!u.startsWith("https://sandbox.melhorenvio.com.br")) return realFetch(url, opt);
  const caminho = u.replace("https://sandbox.melhorenvio.com.br", "");
  const corpo = opt.body ? JSON.parse(opt.body) : null;
  const c = { caminho, metodo: opt.method, headers: opt.headers, corpo };
  chamadas.push(c);
  const f = respostas[caminho];
  const r = f ? await f(corpo, c) : { status: 404, json: { message: "rota não simulada" } };
  return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
};
const quantas = (caminho) => chamadas.filter((c) => c.caminho === caminho).length;
const ORDEM = "9f0c1f6e-4a3b-4e2e-8d52-0a1b2c3d4e5f";
const calculoOk = () => ({ json: [
  { id: 2, name: "SEDEX", price: "40.00", custom_price: "36.40", discount: "3.60", delivery_time: 2, custom_delivery_time: 3, company: { id: 1, name: "Correios" } },
  { id: 1, name: "PAC", price: "25.00", custom_price: "21.90", delivery_time: 5, custom_delivery_time: 6, company: { id: 1, name: "Correios" } },
  { id: 3, name: ".Package", price: "30.00", custom_price: "30.00", delivery_time: 4, custom_delivery_time: 4, company: { id: 2, name: "Jadlog" } },
  { id: 4, name: ".Com", error: "Serviço indisponível para este trajeto", company: { id: 2, name: "Jadlog" } },
] });
respostas["/api/v2/me/shipment/calculate"] = calculoOk;

// ---------- configuração ----------
const REM = { nome: "Maria Remetente", telefone: "(27) 99999-1111", email: "loja@exemplo.com", documento: "529.982.247-25", cep: "29100-000", rua: "Rua da Loja", numero: "50", complemento: "sala 1", bairro: "Centro", cidade: "Vila Velha", uf: "ES", observacao: "" };
await setCfg("remetente", { ...REM, cep: "29100000", documento: "52998224725", telefone: "27999991111" });
await setCfg("melhorenvio", { ativo: true, servicos: [1, 2], etiquetas_ativas: true, nao_comercial: true });
await setCfg("prazo_producao_dias_uteis", 3);
await setCfg("loja", "Melty"); await setCfg("email", "contato@exemplo.com");
await setCfg("frete_regioes", []); await setCfg("frete_provisorio", 0); await setCfg("frete_gratis_acima", 0);
await setCfg("retirada", { ativa: false, nome: "Retirada no local", endereco: "", instrucoes: "", ceps: [] });
await setCfg("embalagem_padrao", { altura: 10.5, largura: 12, comprimento: 16 });

const linhas = (n) => [{ qtd: n, peso_kg: 0.42, altura_cm: null, largura_cm: null, comprimento_cm: null }];
const cot = (cep, n = 1, sub = 7990) => cotarFrete(db, env, { cep, linhas: linhas(n), subtotal_centavos: sub });

// ---------- cotação ----------
let q = await cot("01001000");
const c1 = chamadas.find((c) => c.caminho === "/api/v2/me/shipment/calculate");
t("cotação: POST na rota certa com os cabeçalhos exigidos", c1 && c1.metodo === "POST" && c1.headers.Authorization === `Bearer ${TOKEN}` && c1.headers.Accept === "application/json" && c1.headers["Content-Type"] === "application/json" && c1.headers["User-Agent"] === "Melty (contato@exemplo.com)", JSON.stringify(c1?.headers));
t("cotação: CEPs só com números, serviços escolhidos e pacote como UM volume (medidas em inteiros, peso em kg)",
  c1.corpo.from.postal_code === "29100000" && c1.corpo.to.postal_code === "01001000" && c1.corpo.services === "1,2" && c1.corpo.products.length === 1 && c1.corpo.products[0].id === "pacote"
  && c1.corpo.products[0].height === 11 && c1.corpo.products[0].width === 12 && c1.corpo.products[0].length === 16 && c1.corpo.products[0].weight === 0.42 && c1.corpo.products[0].quantity === 1 && c1.corpo.products[0].insurance_value === 79.9
  && c1.corpo.options.receipt === false && c1.corpo.options.own_hand === false, JSON.stringify(c1.corpo));
t("cotação: usa custom_price e custom_delivery_time, ordena pelo preço, mostra transportadora",
  q.opcoes.map((o) => `${o.servico}|${o.preco_centavos}|${o.transporte_dias}`).join(" ; ") === "PAC (Correios)|2190|6 ; SEDEX (Correios)|3640|3", JSON.stringify(q.opcoes));
t("cotação: serviço com erro ou fora da lista escolhida some (.Package, .Com)", q.opcoes.length === 2 && q.fonte === "melhorenvio");
t("prazo exibido = transporte + margem de 3 dias (PAC 6+3=9, SEDEX 3+3=6)", q.opcoes[0].prazo_dias_uteis === 9 && q.opcoes[1].prazo_dias_uteis === 6, JSON.stringify(q.opcoes));
t("ids das opções: me:<serviço>", q.opcoes.map((o) => o.id).join() === "me:1,me:2");
const antes = chamadas.length;
await cot("01001000");
t("cotação repetida (mesmo CEP e pacote) vem do cache: sem nova chamada", chamadas.length === antes);
await cot("20040020");
t("outro CEP faz nova chamada", chamadas.length === antes + 1);
await cot("01001000", 3, 500000);
const c3 = chamadas.at(-1);
t("3 velas: pacote empilhado (altura 31,5 → 32) e peso 1,26; valor segurado limitado a R$ 3.000", c3.corpo.products[0].height === 32 && c3.corpo.products[0].weight === 1.26 && c3.corpo.products[0].insurance_value === 3000, JSON.stringify(c3.corpo.products));
await setCfg("melhorenvio", { ativo: true, servicos: [1], etiquetas_ativas: true, nao_comercial: true });
await cot("30140071");
t("só o serviço escolhido é pedido (services = \"1\")", chamadas.at(-1).corpo.services === "1");
await setCfg("melhorenvio", { ativo: true, servicos: [1, 2], etiquetas_ativas: true, nao_comercial: true });
await setCfg("frete_gratis_acima", 100);
q = await cot("40020000", 1, 12000);
t("frete grátis acima do valor também vale para o Melhor Envio", q.opcoes.every((o) => o.preco_centavos === 0 && o.gratis), JSON.stringify(q.opcoes));
await setCfg("frete_gratis_acima", 0);
await setCfg("retirada", { ativa: true, nome: "Retirada no local", endereco: "Rua X", instrucoes: "", ceps: [] });
q = await cot("50020000");
t("retirada aparece junto com as opções do Melhor Envio", q.opcoes.length === 3 && q.opcoes.at(-1).retirada === true);
await setCfg("retirada", { ativa: false, nome: "Retirada no local", endereco: "", instrucoes: "", ceps: [] });

// ---------- falhas ----------
respostas["/api/v2/me/shipment/calculate"] = () => ({ status: 401, json: { message: "Unauthenticated." } });
await setCfg("frete_regioes", [{ nome: "Região ES", ufs: ["ES", "SP"], preco: 18, prazo: 4 }]);
q = await cot("29200000");
t("token recusado: usa a tabela por região como reserva (não deixa o cliente sem frete)", q.fonte === "tabela" && q.opcoes.length === 1 && q.opcoes[0].servico === "Região ES" && q.cotacao_falhou === false, JSON.stringify(q));
await setCfg("frete_regioes", []);
q = await cot("29210000");
t("token recusado e sem tabela: NENHUMA opção (nunca vira 'frete grátis'), marcado como falha", q.opcoes.length === 0 && q.cotacao_falhou === true, JSON.stringify(q));
t("pedido nessa situação é recusado com mensagem clara", (await cod(() => criarPedido(env, { itens: [{ id: "bamboo-dreams", qtd: 1 }], cliente: { nome: "Maria da Silva", email: "m@exemplo.com", telefone: "27999990000", cpf: "52998224725", cep: "29220-000", rua: "R", numero: "1", bairro: "B", cidade: "C", uf: "ES", aceite: true, frete_id: "me:1" } }, { urlBase: "https://loja.exemplo" }))) === "N:frete");
respostas["/api/v2/me/shipment/calculate"] = () => ({ status: 422, json: { message: "The given data was invalid.", errors: { "to.postal_code": ["CEP de destino inválido"] } } });
let err = null; try { await cot("29230000"); } catch (e) { err = e; }
t("erro 422 da API não derruba o site (vira falha de cotação)", err === null);
globalThis.fetch = async (url, opt) => { if (String(url).startsWith("https://sandbox.melhorenvio.com.br")) throw new Error("rede caiu"); return realFetch(url, opt); };
q = await cot("29240000");
t("sem internet com o Melhor Envio: falha tratada", q.opcoes.length === 0 && q.cotacao_falhou === true);
const tokenVazado = JSON.stringify(q);
t("o token nunca aparece nas respostas", !tokenVazado.includes(TOKEN));
// restaura o servidor de mentira
globalThis.fetch = async (url, opt = {}) => {
  const u = String(url);
  if (!u.startsWith("https://sandbox.melhorenvio.com.br")) return realFetch(url, opt);
  const caminho = u.replace("https://sandbox.melhorenvio.com.br", "");
  const corpo = opt.body ? JSON.parse(opt.body) : null;
  const c = { caminho, metodo: opt.method, headers: opt.headers, corpo }; chamadas.push(c);
  const f = respostas[caminho]; const r = f ? await f(corpo, c) : { status: 404, json: { message: "rota não simulada" } };
  return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
};
respostas["/api/v2/me/shipment/calculate"] = calculoOk;
await setCfg("melhorenvio", { ativo: false, servicos: [1, 2], etiquetas_ativas: true, nao_comercial: true });
const nA = chamadas.length; q = await cot("60020000");
t("Melhor Envio desligado: nem chama a API", chamadas.length === nA && q.fonte === "tabela");
await setCfg("melhorenvio", { ativo: true, servicos: [1, 2], etiquetas_ativas: true, nao_comercial: true });
const nB = chamadas.length; q = await cotarFrete(db, { ...env, MELHORENVIO_TOKEN: undefined }, { cep: "60020000", linhas: linhas(1), subtotal_centavos: 7990 });
t("sem token: nem chama a API", chamadas.length === nB && q.fonte === "tabela");

// ---------- pedido com opção do Melhor Envio ----------
const CPF = "52998224725";
const cliente = (extra = {}) => ({ nome: "João da Silva", email: "joao@exemplo.com", telefone: "27988887777", cpf: CPF, cep: "01001-000", rua: "Praça da Sé", numero: "100", complemento: "ap 5", bairro: "Sé", cidade: "São Paulo", uf: "SP", aceite: true, ...extra });
const pedir = async (itens, extra) => { const r = await criarPedido(env, { itens, cliente: cliente(extra) }, { urlBase: "https://loja.exemplo" }); return { ...r, p: await db.prepare("SELECT * FROM pedidos WHERE token = ?").bind(r.token).first() }; };
await setCfg("prazo_producao_dias_uteis", 3);
const ped1 = await pedir([{ id: "bamboo-dreams", qtd: 2 }], { frete_id: "me:1" });
t("pedido com PAC: guarda serviço, preço (R$ 21,90), previsão (6+3=9) e o pacote", ped1.p.frete_id === "me:1" && ped1.p.frete_servico === "PAC (Correios)" && ped1.p.frete_centavos === 2190 && ped1.p.frete_prazo_dias === 9 && JSON.parse(ped1.p.pacote_json).altura_cm === 21 && JSON.parse(ped1.p.pacote_json).peso_kg === 0.84, JSON.stringify(ped1.p));
t("opção que não existe nessa cotação é recusada (me:99)", (await cod(() => pedir([{ id: "cereja-avela", qtd: 1 }], { frete_id: "me:99" }))) === "N:frete");
t("com 2 opções, precisa escolher", (await cod(() => pedir([{ id: "cereja-avela", qtd: 1 }], { frete_id: "" }))) === "N:frete");

// ---------- etiqueta ----------
const cfgEtq = async () => Object.fromEntries((await db.prepare("SELECT chave, valor FROM config").all()).results.map((r) => [r.chave, JSON.parse(r.valor)]));
const CONTATO = "Melty (contato@exemplo.com)";
const gerar = async (id) => gerarEtiqueta(env, db, id, { contato: CONTATO, cfg: await cfgEtq() });
respostas["/api/v2/me/cart"] = (corpo) => ({ status: 201, json: { id: ORDEM, protocol: "ORD-1", service_id: corpo.service, price: 21.9, status: "pending", tracking: null } });
respostas["/api/v2/me/shipment/checkout"] = () => ({ json: { purchase: { id: "p1", status: "paid", orders: [{ id: ORDEM, status: "released" }] } } });
respostas["/api/v2/me/shipment/generate"] = () => ({ json: { [ORDEM]: { status: true, message: "Envio gerado com sucesso" } } });
respostas["/api/v2/me/shipment/tracking"] = () => ({ json: { [ORDEM]: { id: ORDEM, protocol: "ORD-1", status: "released", tracking: "me23002owz7br", melhorenvio_tracking: "ME23002OWZ7BR" } } });
respostas["/api/v2/me/shipment/print"] = () => ({ json: { url: "https://sandbox.melhorenvio.com.br/imprimir/ixQLaqqjmb2E" } });

t("pedido aguardando pagamento não gera etiqueta", (await cod(() => gerar(ped1.p.id))).includes("pagos"));
await aplicarPagamento(env, ped1.token, { status: "aprovado", valorCentavos: ped1.p.total_centavos, cpfPagador: CPF });
await setCfg("melhorenvio", { ativo: true, servicos: [1, 2], etiquetas_ativas: false, nao_comercial: true });
t("etiquetas desligadas nas configurações: recusa", (await cod(() => gerar(ped1.p.id))).includes("desligada"));
await setCfg("melhorenvio", { ativo: true, servicos: [1, 2], etiquetas_ativas: true, nao_comercial: true });
await setCfg("remetente", { ...REM, cep: "29100000", documento: "52998224725", telefone: "27999991111", rua: "" });
t("remetente incompleto: recusa e avisa", (await cod(() => gerar(ped1.p.id))).includes("remetente"));
await setCfg("remetente", { ...REM, cep: "29100000", documento: "52998224725", telefone: "27999991111" });

chamadas = [];
const g1 = await gerar(ped1.p.id);
const cart = chamadas.find((c) => c.caminho === "/api/v2/me/cart").corpo;
t("etiqueta gerada: ordem, estado e código de rastreio (maiúsculas)", g1.estado === "gerada" && g1.ordem === ORDEM && g1.rastreio === "ME23002OWZ7BR", JSON.stringify(g1));
t("etapas na ordem certa: carrinho → compra → geração → rastreio", chamadas.map((c) => c.caminho).join(" ") === "/api/v2/me/cart /api/v2/me/shipment/checkout /api/v2/me/shipment/generate /api/v2/me/orders/"+ORDEM+" /api/v2/me/shipment/tracking", chamadas.map((c) => c.caminho));
t("carrinho: serviço do pedido, volume em inteiros, produtos como texto, envio não comercial e lembrete",
  cart.service === 1 && cart.volumes.length === 1 && cart.volumes[0].height === 21 && cart.volumes[0].width === 12 && cart.volumes[0].length === 16 && cart.volumes[0].weight === 0.84
  && cart.products[0].name === "Vela Bamboo Dreams" && cart.products[0].quantity === "2" && cart.products[0].unitary_value === "79.90"
  && cart.options.non_commercial === true && cart.options.receipt === false && cart.options.reverse === false && cart.options.insurance_value === 159.8 && cart.options.reminder === `Pedido #${ped1.numero}`, JSON.stringify(cart));
t("carrinho: remetente (CPF, sem CNPJ, ISENTO) e destinatário com endereço completo", cart.from.name === "Maria Remetente" && cart.from.document === "52998224725" && cart.from.company_document === "" && cart.from.state_register === "ISENTO" && cart.from.postal_code === "29100000" && cart.from.state_abbr === "ES" && cart.from.country_id === "BR"
  && cart.to.name === "João da Silva" && cart.to.document === CPF && cart.to.address === "Praça da Sé" && cart.to.number === "100" && cart.to.complement === "ap 5" && cart.to.district === "Sé" && cart.to.city === "São Paulo" && cart.to.state_abbr === "SP" && cart.to.postal_code === "01001000" && cart.to.phone === "27988887777", JSON.stringify(cart.to));
t("compra e geração usam o id (UUID) da etiqueta", chamadas.find((c) => c.caminho.endsWith("/checkout")).corpo.orders[0] === ORDEM && chamadas.find((c) => c.caminho.endsWith("/generate")).corpo.orders[0] === ORDEM);
t("todas as chamadas levam token e User-Agent", chamadas.every((c) => c.headers.Authorization === `Bearer ${TOKEN}` && c.headers["User-Agent"] === CONTATO));
let linha = await db.prepare("SELECT me_estado, me_ordem_id, me_rastreio, me_erro, me_travado_em FROM pedidos WHERE id = ?").bind(ped1.p.id).first();
t("andamento guardado no pedido e trava liberada", linha.me_estado === "gerada" && linha.me_ordem_id === ORDEM && linha.me_rastreio === "ME23002OWZ7BR" && linha.me_erro === "" && linha.me_travado_em === null, JSON.stringify(linha));

chamadas = [];
const g2 = await gerar(ped1.p.id);
t("gerar de novo NÃO compra outra etiqueta (só consulta o rastreio)", chamadas.map((c) => c.caminho).join() === "/api/v2/me/orders/"+ORDEM+",/api/v2/me/shipment/tracking" && g2.estado === "gerada", chamadas.map((c) => c.caminho));

// ---------- falha no meio: saldo insuficiente ----------
const ped2 = await pedir([{ id: "cereja-avela", qtd: 1 }], { frete_id: "me:2" });
await aplicarPagamento(env, ped2.token, { status: "aprovado", valorCentavos: ped2.p.total_centavos, cpfPagador: CPF });
let saldoOk = false;
const ORDEM2 = "11111111-2222-4333-8444-555555555555";
respostas["/api/v2/me/cart"] = (corpo) => ({ status: 201, json: { id: ORDEM2, protocol: "ORD-2", service_id: corpo.service } });
respostas["/api/v2/me/shipment/checkout"] = () => saldoOk ? { json: { purchase: { status: "paid" } } } : { status: 422, json: { message: "The given data was invalid.", errors: { orders: ["Saldo insuficiente na carteira."] } } };
respostas["/api/v2/me/shipment/generate"] = () => ({ json: { [ORDEM2]: { status: true, message: "ok" } } });
respostas["/api/v2/me/shipment/tracking"] = () => ({ json: { [ORDEM2]: { tracking: "ME99999AAA1BR" } } });
chamadas = [];
const falhou = await cod(() => gerar(ped2.p.id));
linha = await db.prepare("SELECT me_estado, me_ordem_id, me_erro, me_travado_em FROM pedidos WHERE id = ?").bind(ped2.p.id).first();
t("saldo insuficiente: erro claro, andamento parado em 'carrinho' e trava liberada", falhou.includes("Saldo insuficiente") && linha.me_estado === "carrinho" && linha.me_ordem_id === ORDEM2 && linha.me_erro.includes("Saldo insuficiente") && linha.me_travado_em === null, JSON.stringify([falhou, linha]));
saldoOk = true; chamadas = [];
const g3 = await gerar(ped2.p.id);
t("após repor o saldo, continua de onde parou: NÃO recria o carrinho", chamadas.map((c) => c.caminho).join(" ") === "/api/v2/me/shipment/checkout /api/v2/me/shipment/generate /api/v2/me/orders/"+ORDEM2+" /api/v2/me/shipment/tracking" && g3.rastreio === "ME99999AAA1BR", chamadas.map((c) => c.caminho));

// ---------- dois cliques ao mesmo tempo ----------
const ped3 = await pedir([{ id: "lavanda", qtd: 1 }], { frete_id: "me:1" });
await aplicarPagamento(env, ped3.token, { status: "aprovado", valorCentavos: ped3.p.total_centavos, cpfPagador: CPF });
const ORDEM3 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
respostas["/api/v2/me/cart"] = async (corpo) => { await new Promise((r) => setTimeout(r, 60)); return { status: 201, json: { id: ORDEM3 } }; };
respostas["/api/v2/me/shipment/checkout"] = () => ({ json: {} });
respostas["/api/v2/me/shipment/generate"] = () => ({ json: { [ORDEM3]: { status: true } } });
respostas["/api/v2/me/shipment/tracking"] = () => ({ json: { [ORDEM3]: { tracking: "ME11111AAA1BR" } } });
chamadas = [];
const res = await Promise.all([1, 2, 3].map(() => gerar(ped3.p.id).then(() => "ok", (e) => e.message)));
t("3 cliques simultâneos: 1 gera a etiqueta, os outros são avisados", res.filter((x) => x === "ok").length === 1 && res.filter((x) => String(x).includes("em andamento")).length === 2, JSON.stringify(res));
t("e o carrinho e a compra aconteceram UMA vez só", quantas("/api/v2/me/cart") === 1 && quantas("/api/v2/me/shipment/checkout") === 1 && quantas("/api/v2/me/shipment/generate") === 1, JSON.stringify(chamadas.map((c) => c.caminho)));

// ---------- recusas ----------
await setCfg("retirada", { ativa: true, nome: "Retirada no local", endereco: "Rua X", instrucoes: "", ceps: [] });
const pedRet = await pedir([{ id: "peachy", qtd: 1 }], { frete_id: "retirada" });
await aplicarPagamento(env, pedRet.token, { status: "aprovado", valorCentavos: pedRet.p.total_centavos, cpfPagador: CPF });
t("pedido de retirada não gera etiqueta", (await cod(() => gerar(pedRet.p.id))).includes("não usa uma entrega do Melhor Envio"));
await setCfg("retirada", { ativa: false, nome: "Retirada no local", endereco: "", instrucoes: "", ceps: [] });
await setCfg("frete_regioes", [{ nome: "Região ES", ufs: ["PR"], preco: 18, prazo: 4 }]);
respostas["/api/v2/me/shipment/calculate"] = () => ({ status: 500, json: {} });
const pedTab = await pedir([{ id: "cappuccino", qtd: 1 }], { frete_id: "regiao:regiao-es", cep: "80010-000", uf: "PR" });
await aplicarPagamento(env, pedTab.token, { status: "aprovado", valorCentavos: pedTab.p.total_centavos, cpfPagador: CPF });
t("pedido com frete da tabela (não Melhor Envio) não gera etiqueta", (await cod(() => gerar(pedTab.p.id))).includes("não usa uma entrega do Melhor Envio"));
respostas["/api/v2/me/shipment/calculate"] = calculoOk; await setCfg("frete_regioes", []);

// ---------- imprimir, rastreio, cancelar ----------
let pg = await db.prepare("SELECT * FROM pedidos WHERE id = ?").bind(ped1.p.id).first();
chamadas = [];
const url = await linkEtiqueta(env, pg, { contato: CONTATO });
t("imprimir: pede o link privado da etiqueta e devolve a URL", url === "https://sandbox.melhorenvio.com.br/imprimir/ixQLaqqjmb2E" && chamadas[0].corpo.mode === "private" && chamadas[0].corpo.orders[0] === ORDEM, JSON.stringify(chamadas[0]?.corpo));
respostas["/api/v2/me/shipment/print"] = () => ({ json: { url: "javascript:alert(1)" } });
t("link estranho devolvido pela API é recusado", (await cod(() => linkEtiqueta(env, pg, { contato: CONTATO }))).includes("não devolveu o link"));
t("imprimir sem etiqueta gerada é recusado", (await cod(() => linkEtiqueta(env, { me_ordem_id: "", me_estado: "" }, { contato: CONTATO }))).includes("ainda não foi gerada"));
respostas["/api/v2/me/shipment/tracking"] = () => ({ json: { [ORDEM]: { tracking: null, melhorenvio_tracking: null } } });
await db.prepare("UPDATE pedidos SET me_rastreio = '' WHERE id = ?").bind(ped1.p.id).run();
t("rastreio ainda não disponível: devolve vazio, sem erro", (await buscarRastreio(env, db, ped1.p.id, { contato: CONTATO, ordem: ORDEM })) === "");
respostas["/api/v2/me/shipment/tracking"] = () => ({ json: { [ORDEM]: { tracking: "ME23002OWZ7BR" } } });
t("rastreio disponível depois: guarda no pedido", (await buscarRastreio(env, db, ped1.p.id, { contato: CONTATO, ordem: ORDEM })) === "ME23002OWZ7BR" && (await db.prepare("SELECT me_rastreio FROM pedidos WHERE id = ?").bind(ped1.p.id).first()).me_rastreio === "ME23002OWZ7BR");

// marcar como enviado usa o rastreio da etiqueta
await mudarStatus(db, ped1.p.id, "em_producao", { env });
await mudarStatus(db, ped1.p.id, "enviado", { rastreio: "", env });
const env1 = await db.prepare("SELECT status, rastreio FROM pedidos WHERE id = ?").bind(ped1.p.id).first();
t("'enviado' sem digitar rastreio usa o código da etiqueta do Melhor Envio", env1.status === "enviado" && env1.rastreio === "ME23002OWZ7BR", JSON.stringify(env1));
const eEnv = (await db.prepare("SELECT html FROM emails WHERE pedido_id = ? AND tipo = 'enviado'").bind(ped1.p.id).first());
t("e o e-mail de envio sai com esse código", eEnv && eEnv.html.includes("ME23002OWZ7BR"));
pg = await db.prepare("SELECT * FROM pedidos WHERE id = ?").bind(ped1.p.id).first();
t("etiqueta de pedido já enviado não pode ser cancelada por aqui", (await cod(() => cancelarEtiqueta(env, db, pg, { contato: CONTATO }))).includes("já foi enviado"));

const pg3 = await db.prepare("SELECT * FROM pedidos WHERE id = ?").bind(ped3.p.id).first();
respostas["/api/v2/me/shipment/cancel"] = () => ({ json: { [ORDEM3]: { canceled: true } } });
chamadas = [];
await cancelarEtiqueta(env, db, pg3, { contato: CONTATO });
const cc = chamadas[0].corpo;
const aposCancelar = await db.prepare("SELECT me_ordem_id, me_estado, me_rastreio FROM pedidos WHERE id = ?").bind(ped3.p.id).first();
t("cancelar: corpo conforme a documentação e pedido volta a ficar sem etiqueta", cc.order.id === ORDEM3 && cc.order.reason_id === "2" && aposCancelar.me_ordem_id === "" && aposCancelar.me_estado === "" && aposCancelar.me_rastreio === "", JSON.stringify([cc, aposCancelar]));
respostas["/api/v2/me/shipment/cancel"] = () => ({ json: { [ORDEM3]: { canceled: false } } });
t("cancelamento não confirmado pela API: erro e nada muda", (await cod(() => cancelarEtiqueta(env, db, { ...pg3, me_ordem_id: ORDEM3 }, { contato: CONTATO }))).includes("não confirmou"));

// ---------- formatos de erro da API ----------
respostas["/api/v2/me/cart"] = () => ({ status: 422, json: { error: { volumes: [["Peso do pacote 1 não informado", "Altura do pacote 1 não informada"]] } } });
const ped4 = await pedir([{ id: "figo-ambarado", qtd: 1 }], { frete_id: "me:1" });
await aplicarPagamento(env, ped4.token, { status: "aprovado", valorCentavos: ped4.p.total_centavos, cpfPagador: CPF });
const m4 = await cod(() => gerar(ped4.p.id));
t("erro 422 no formato do carrinho vira mensagem legível", m4.includes("Peso do pacote 1 não informado") && m4.includes("Altura do pacote 1 não informada"), m4);
respostas["/api/v2/me/cart"] = () => ({ status: 401, json: { message: "Unauthenticated." } });
const m5 = await cod(() => gerar(ped4.p.id));
t("token vencido durante a etiqueta: mensagem pede um novo token (sem vazar o token)", m5.includes("token") && m5.includes("novo token") && !m5.includes(TOKEN), m5);

// ---------- permissões do token e teste de conexão ----------
respostas["/api/v2/me/cart"] = () => ({ status: 403, json: { message: "This action is unauthorized." } });
const m6 = await cod(() => gerar(ped4.p.id));
t("403 = falta permissão (diferente de token vencido): a mensagem lista as permissões a marcar", m6.includes("não tem permissão") && m6.includes("carrinho") && !m6.includes("vencido"), m6);
const semAlcance = () => ({ json: [{ id: 1, name: "PAC", error: "Transportadora não atende este trecho.", company: { name: "Correios" } }, { id: 2, name: "SEDEX", error: "Transportadora não atende este trecho.", company: { name: "Correios" } }] });
respostas["/api/v2/me/shipment/calculate"] = (corpo) => (corpo.to.postal_code === "20040020" ? calculoOk() : semAlcance());
chamadas = [];
const tc = await testarConexao(env, db, { contato: CONTATO, cepOrigem: "29100000", servicos: [1, 2] });
t("teste de conexão: tenta outros destinos até achar preço (01001000 sem alcance → 20040020)", tc.opcoes.length === 2 && chamadas.filter((c) => c.caminho.endsWith("/calculate")).map((c) => c.corpo.to.postal_code).join() === "01001000,20040020", JSON.stringify(chamadas.map((c) => c.corpo?.to?.postal_code)));
t("teste de conexão: detecta que falta a permissão de carrinho", tc.carrinho === false);
respostas["/api/v2/me/cart"] = () => ({ json: [] });
t("teste de conexão: detecta que o token tem a permissão de carrinho", (await testarConexao(env, db, { contato: CONTATO, cepOrigem: "29100000", servicos: [1, 2] })).carrinho === true);
respostas["/api/v2/me/shipment/calculate"] = semAlcance;
const tz = await testarConexao(env, db, { contato: CONTATO, cepOrigem: "29100000", servicos: [1, 2] });
t("teste de conexão: se nenhum destino tem preço, devolve lista vazia (o painel explica o CEP genérico)", tz.opcoes.length === 0);
respostas["/api/v2/me/shipment/calculate"] = () => ({ status: 401, json: { message: "Unauthenticated." } });
t("teste de conexão com token vencido: erro claro", (await cod(() => testarConexao(env, db, { contato: CONTATO, cepOrigem: "29100000", servicos: [1, 2] }))).includes("não reconheceu o token"));

// comportamento visto no sandbox real: /shipment/tracking vazio, mas o detalhe da etiqueta já traz o código
const ORDEM4 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
respostas["/api/v2/me/orders/" + ORDEM4] = () => ({ json: { id: ORDEM4, status: "released", tracking: "QJ43682530BR", generated_at: "2026-11-19 15:22:43" } });
respostas["/api/v2/me/shipment/tracking"] = () => ({ json: { [ORDEM4]: { tracking: null, melhorenvio_tracking: null } } });
const pRast = await db.prepare("SELECT id FROM pedidos LIMIT 1").first();
chamadas = [];
const codReal = await buscarRastreio(env, db, pRast.id, { contato: CONTATO, ordem: ORDEM4 });
t("rastreio: usa o detalhe da etiqueta quando /tracking vem vazio", codReal === "QJ43682530BR" && chamadas.length === 1, JSON.stringify(chamadas.map((c) => c.caminho)));

globalThis.fetch = realFetch;
console.log(`\n${ok} ok, ${bad} falhas`);
await dispose();
process.exit(bad ? 1 : 0);
