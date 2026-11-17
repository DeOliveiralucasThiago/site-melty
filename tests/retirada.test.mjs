import { getPlatformProxy } from "wrangler";
import { cotarFrete } from "../functions/_lib/frete.js";
import { criarPedido, aplicarPagamento, mudarStatus, paraAcompanhamento, proximosStatus } from "../functions/_lib/pedidos.js";
import { processarFila, enfileirar } from "../functions/_lib/email.js";
import { ErroNegocio } from "../functions/_lib/cupons.js";

const { env: base, dispose } = await getPlatformProxy({ configPath: new URL("../wrangler.toml", import.meta.url).pathname, persist: { path: new URL("../.wrangler/state/v3", import.meta.url).pathname } });
const env = { ...base, PAGAMENTO_PROVEDOR: "teste", EMAIL_PROVEDOR: "teste" };
const db = env.DB;
let ok = 0, bad = 0;
const t = (nome, cond, extra = "") => { cond ? ok++ : bad++; console.log(cond ? "OK  " : "FALHA", nome, cond ? "" : String(extra).slice(0, 400)); };
const cod = async (fn) => { try { await fn(); return null; } catch (e) { return e instanceof ErroNegocio ? e.codigo : "ERRO:" + e.message; } };
const setCfg = (k, v) => db.prepare("INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").bind(k, JSON.stringify(v)).run();
await db.prepare("UPDATE produtos SET estoque = 60").run();

const RET = { ativa: true, nome: "Retirada no local", endereco: "Rua das Palmeiras, 123 - Centro, Vila Velha/ES", instrucoes: "Seg a sex, das 9h às 17h. Toque o interófone.", ceps: [] };
const linhas = [{ qtd: 1, peso_kg: 0.42, altura_cm: null, largura_cm: null, comprimento_cm: null }];
const cot = (cep) => cotarFrete(db, env, { cep, linhas, subtotal_centavos: 7990 });
const CPF = "52998224725";
const cliente = (extra = {}) => ({ nome: "Maria da Silva", email: "maria@exemplo.com", telefone: "27999990000", cpf: CPF, cep: "29100-000", aceite: true, ...extra });
const ENTREGA = { rua: "Rua das Flores", numero: "10", complemento: "ap 2", bairro: "Centro", cidade: "Vila Velha", uf: "ES" };
const pedir = (itens, extra) => criarPedido(env, { itens, cliente: cliente(extra) }, { urlBase: "https://loja.exemplo" });
const pegar = (tk) => db.prepare("SELECT * FROM pedidos WHERE token = ?").bind(tk).first();
const emails = async (tk, tipo) => (await db.prepare("SELECT e.* FROM emails e JOIN pedidos p ON p.id = e.pedido_id WHERE p.token = ?" + (tipo ? " AND e.tipo = ?" : "") + " ORDER BY e.id").bind(...(tipo ? [tk, tipo] : [tk])).all()).results;

// ---- cotação ----
await setCfg("frete_regioes", [{ nome: "Grande Vitória", ufs: ["ES"], preco: 12, prazo: 2 }]);
await setCfg("retirada", { ...RET, ativa: false });
let q = await cot("29100000");
t("retirada desligada: não aparece", !q.opcoes.some((o) => o.retirada));
await setCfg("retirada", RET);
q = await cot("29100000");
const r = q.opcoes.find((o) => o.retirada);
t("retirada ligada: aparece, grátis, com endereço e instruções", r && r.id === "retirada" && r.preco_centavos === 0 && r.endereco === RET.endereco && r.instrucoes.includes("interófone") && q.opcoes.length === 2, JSON.stringify(q.opcoes));
q = await cot("69900000");
t("estado sem entrega configurada, mas retirada vale para qualquer CEP: só a retirada", q.opcoes.length === 1 && q.opcoes[0].retirada);
await setCfg("retirada", { ...RET, ceps: ["29100", "29101"] });
t("retirada só para CEPs próximos: 29100-000 tem", (await cot("29100000")).opcoes.some((o) => o.retirada));
t("retirada só para CEPs próximos: 29101-500 tem", (await cot("29101500")).opcoes.some((o) => o.retirada));
t("retirada só para CEPs próximos: 01001-000 NÃO tem", !(await cot("01001000")).opcoes.some((o) => o.retirada));
await setCfg("retirada", RET);
await setCfg("frete_regioes", []); await setCfg("frete_provisorio", 0);
q = await cot("29100000");
t("sem entrega configurada e com retirada: só a retirada (não oferece 'entrega grátis' por engano)", q.opcoes.length === 1 && q.opcoes[0].retirada, JSON.stringify(q.opcoes));
await setCfg("frete_regioes", [{ nome: "Grande Vitória", ufs: ["ES"], preco: 12, prazo: 2 }]);

// ---- pedido de retirada ----
const r1 = await pedir([{ id: "bamboo-dreams", qtd: 1 }], { frete_id: "retirada", rua: "Rua Qualquer", numero: "99" });
const p1 = await pegar(r1.token);
t("retirada: pedido criado SEM endereço de entrega (o que veio é ignorado), frete zero", p1.retirada === 1 && p1.end_rua === "" && p1.end_numero === "" && p1.end_cidade === "" && p1.frete_centavos === 0 && p1.total_centavos === 7990 && p1.frete_servico === "Retirada no local" && p1.frete_prazo_dias === null, JSON.stringify(p1));
t("retirada mantém o CEP (usado só para listar as opções)", p1.end_cep === "29100000");
t("entrega sem endereço é recusada", (await cod(() => pedir([{ id: "cereja-avela", qtd: 1 }], { frete_id: "regiao:grande-vitoria" }))) === "dados");
const r2 = await pedir([{ id: "cereja-avela", qtd: 1 }], { frete_id: "regiao:grande-vitoria", ...ENTREGA });
t("entrega com endereço continua funcionando", (await pegar(r2.token)).retirada === 0 && (await pegar(r2.token)).end_rua === "Rua das Flores" && (await pegar(r2.token)).frete_centavos === 1200);
t("com retirada e entrega disponíveis, precisa escolher", (await cod(() => pedir([{ id: "peachy", qtd: 1 }], ENTREGA))) === "frete");

// ---- etapas da retirada ----
await aplicarPagamento(env, r1.token, { status: "aprovado", valorCentavos: 7990, cpfPagador: CPF });
t("retirada paga: próximos passos = preparo, pronto p/ retirada, cancelar, reembolsar (sem 'enviado')", JSON.stringify(proximosStatus(await pegar(r1.token))) === JSON.stringify(["em_producao", "pronto_retirada", "cancelado", "reembolsado"]));
t("retirada não pode ser marcada como 'enviada'", (await cod(() => mudarStatus(db, p1.id, "enviado", { rastreio: "AB123456789BR", env }))) === "transicao");
await aplicarPagamento(env, r2.token, { status: "aprovado", valorCentavos: 9190, cpfPagador: CPF });
const idR2 = (await pegar(r2.token)).id;
t("entrega não pode ser marcada 'pronto para retirada'", (await cod(() => mudarStatus(db, idR2, "pronto_retirada", { env }))) === "transicao");

let pub = await paraAcompanhamento(db, await pegar(r1.token));
t("acompanhamento (pago): é retirada, endereço ainda não aparece", pub.retirada === true && pub.retirada_endereco === null, JSON.stringify(pub));
const ePago = (await emails(r1.token, "pago"))[0];
t("e-mail 'pago' da retirada: 'pronto para retirada em até 2 dias úteis', sem rastreio nem previsão de entrega",
  ePago.html.includes("pronto para retirada em até <b>2 dias úteis</b>") && ePago.html.includes("Avisaremos por e-mail assim que estiver pronto para retirada") && !/rastreio/i.test(ePago.html) && !ePago.html.includes("Previsão de entrega"), ePago.html.slice(ePago.html.indexOf("Recebemos"), ePago.html.indexOf("Recebemos") + 260));

await mudarStatus(db, p1.id, "pronto_retirada", { env });
const eProntoLista = await emails(r1.token, "pronto_retirada");
t("pronto para retirada: e-mail com 'está pronta para retirada no seguinte endereço' + endereço + instruções", eProntoLista.length === 1 && eProntoLista[0].html.includes("está pronta para retirada no seguinte endereço") && eProntoLista[0].html.includes("Rua das Palmeiras, 123 - Centro, Vila Velha/ES") && eProntoLista[0].html.includes("Seg a sex, das 9h às 17h") && eProntoLista[0].assunto === `Seu pedido #${r1.numero} está pronto para retirada` && eProntoLista[0].para === "maria@exemplo.com", eProntoLista[0]?.html.slice(0, 100));
t("e-mail de retirada não traz CPF, telefone nem rastreio", ![CPF, "27999990000"].some((x) => eProntoLista[0].html.includes(x)) && !/rastreio/i.test(eProntoLista[0].html));
t("texto simples do e-mail de retirada tem o endereço", eProntoLista[0].texto.includes("Rua das Palmeiras, 123") && !/<[a-z]/i.test(eProntoLista[0].texto));
pub = await paraAcompanhamento(db, await pegar(r1.token));
t("acompanhamento (pronto): mostra endereço e instruções de retirada", pub.status === "pronto_retirada" && pub.status_texto === "Pronto para retirada" && pub.retirada_endereco === RET.endereco && pub.retirada_instrucoes.includes("interófone"), JSON.stringify(pub));
t("'pronto para retirada' sai uma vez só (repetir não duplica)", (await enfileirar(db, p1.id, "pronto_retirada", { env })) === false && (await emails(r1.token, "pronto_retirada")).length === 1);
await mudarStatus(db, p1.id, "entregue", { env });
const eEnt = (await emails(r1.token, "entregue"))[0];
t("retirada concluída: e-mail diz 'retirado'", eEnt.html.includes("como retirado") && !eEnt.html.includes("como entregue"), eEnt.html.slice(eEnt.html.indexOf("Marcamos"), eEnt.html.indexOf("Marcamos") + 80));

// ---- avisos para a loja ----
await setCfg("aviso_loja", { emails: ["loja@exemplo.com"], ao_criar: false, ao_pagar: true });
const r3 = await pedir([{ id: "lavanda", qtd: 1 }], { frete_id: "regiao:grande-vitoria", ...ENTREGA, nome: "Joana <b>Souza</b>", email: "joana@exemplo.com" });
t("ao_criar desligado: pedido novo não avisa a loja", (await emails(r3.token, "loja_novo")).length === 0);
await Promise.all([1, 2, 3].map(() => aplicarPagamento(env, r3.token, { status: "aprovado", valorCentavos: 9190, cpfPagador: CPF })));
const lp = await emails(r3.token, "loja_pago");
t("pagamento confirmado avisa a loja (um e-mail, mesmo com aviso repetido do provedor)", lp.length === 1 && lp[0].para === "loja@exemplo.com", JSON.stringify(lp.map((e) => e.para)));
t("a resposta do e-mail da loja vai direto para o cliente (reply-to)", lp[0].responder_para === "joana@exemplo.com");
t("assunto do aviso: pago, número, total e nome", lp[0].assunto.startsWith(`Novo pedido PAGO #${r3.numero}: R$`) && lp[0].assunto.includes("Joana"), lp[0].assunto);
t("aviso traz telefone (link WhatsApp), e-mail, itens, entrega completa, total e link do painel", lp[0].html.includes("https://wa.me/5527999990000") && lp[0].html.includes("joana@exemplo.com") && lp[0].html.includes("1× Vela Lavanda") && lp[0].html.includes("Rua das Flores, 10 - ap 2 - Centro, Vila Velha/ES, CEP 29100-000") && lp[0].html.includes("https://loja.exemplo/admin/") && lp[0].html.includes("Total"), lp[0].html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 500));
t("aviso à loja NÃO traz o CPF; nome do cliente é escapado", !lp[0].html.includes(CPF) && !lp[0].texto.includes(CPF) && !lp[0].html.includes("<b>Souza</b>") && lp[0].html.includes("&lt;b&gt;Souza&lt;/b&gt;"));
t("aviso interno tem rodapé próprio (não diz 'você fez um pedido')", lp[0].html.includes("Aviso interno") && !lp[0].html.includes("porque fez um pedido"));

await setCfg("aviso_loja", { emails: ["loja@exemplo.com", "outra@exemplo.com"], ao_criar: true, ao_pagar: true });
const r4 = await pedir([{ id: "cappuccino", qtd: 1 }], { frete_id: "retirada" });
t("ao_criar ligado: pedido novo avisa os 2 e-mails da loja", (await emails(r4.token, "loja_novo")).map((e) => e.para).sort().join() === "loja@exemplo.com,outra@exemplo.com");
const ln = (await emails(r4.token, "loja_novo"))[0];
t("aviso de pedido novo diz que ainda não foi pago e marca RETIRADA", ln.assunto.includes("aguardando pagamento") && ln.assunto.includes("(RETIRADA)") && ln.html.includes("RETIRADA NO LOCAL") && !ln.html.includes("CEP"), ln.assunto);
await aplicarPagamento(env, r4.token, { status: "aprovado", valorCentavos: 7990, cpfPagador: CPF });
t("ao pagar: mais 2 avisos (total 4 para este pedido)", (await emails(r4.token)).filter((e) => e.tipo.startsWith("loja_")).length === 4);
await setCfg("aviso_loja", { emails: [], ao_criar: true, ao_pagar: true });
const r5 = await pedir([{ id: "figo-ambarado", qtd: 1 }], { frete_id: "retirada" });
await aplicarPagamento(env, r5.token, { status: "aprovado", valorCentavos: 7990, cpfPagador: CPF });
t("sem e-mails configurados: nenhum aviso à loja", (await emails(r5.token)).filter((e) => e.tipo.startsWith("loja_")).length === 0);

// ---- envio: reply-to e reenvio ----
const enviados = [];
for (let i = 0; i < 8; i++) { const rr = await processarFila(env, { enviar: async (x) => { enviados.push(x); return { id: "ok" }; } }); if (!rr.enviados) break; }
const aviso = enviados.find((x) => x.para === "loja@exemplo.com" && x.assunto.includes(`#${r3.numero}`));
t("na hora de enviar, o responder-para do aviso é o e-mail do cliente", aviso && aviso.responderPara === "joana@exemplo.com", JSON.stringify(aviso)?.slice(0, 200));
const cliEnv = enviados.find((x) => x.para === "joana@exemplo.com");
t("e-mail ao cliente continua respondendo para a loja", cliEnv && cliEnv.responderPara === (JSON.parse((await db.prepare("SELECT valor FROM config WHERE chave = 'email'").first()).valor)), JSON.stringify(cliEnv)?.slice(0, 160));
await enfileirar(db, (await pegar(r3.token)).id, "loja_pago", { env, forcar: true, para: "loja@exemplo.com", responderPara: "joana@exemplo.com" });
const reen = (await emails(r3.token, "loja_pago")).find((e) => e.para === "loja@exemplo.com");
t("reenviar aviso da loja mantém destinatário e responder-para, e sobe a versão", reen.status === "pendente" && reen.versao === 2 && reen.responder_para === "joana@exemplo.com" && (await emails(r3.token, "loja_pago")).length === 1);

console.log(`\n${ok} ok, ${bad} falhas`);
await dispose();
process.exit(bad ? 1 : 0);
