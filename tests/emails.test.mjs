import { getPlatformProxy } from "wrangler";
import { criarPedido, aplicarPagamento, mudarStatus, liberarVencidos } from "../functions/_lib/pedidos.js";
import { processarFila, enfileirar, emailAtivo } from "../functions/_lib/email.js";

const { env: base, dispose } = await getPlatformProxy({ configPath: new URL("../wrangler.toml", import.meta.url).pathname, persist: { path: new URL("../.wrangler/state/v3", import.meta.url).pathname } });
const env = { ...base, PAGAMENTO_PROVEDOR: "teste", EMAIL_PROVEDOR: "teste" };
const db = env.DB;
let ok = 0, bad = 0;
const t = (nome, cond, extra = "") => { cond ? ok++ : bad++; console.log(cond ? "OK  " : "FALHA", nome, cond ? "" : String(extra).slice(0, 400)); };
const CPFS = ["52998224725", "11144477735", "39053344705", "86288366757", "71428793860", "93541134780"];
const cli = (i, extra = {}) => ({ nome: "Maria da Silva", email: `m${i}@exemplo.com`, telefone: "27999990000", cpf: CPFS[i], cep: "29100000", rua: "Rua das Flores", numero: "10", complemento: "", bairro: "Centro", cidade: "Vila Velha", uf: "ES", aceite: true, ...extra });
const pedir = (i, itens, extra) => criarPedido(env, { itens, cliente: cli(i, extra) }, { urlBase: "https://loja.exemplo" });
const emailsDe = async (token) => (await db.prepare("SELECT e.* FROM emails e JOIN pedidos p ON p.id = e.pedido_id WHERE p.token = ? ORDER BY e.id").bind(token).all()).results;
const idDe = async (token) => (await db.prepare("SELECT id FROM pedidos WHERE token = ?").bind(token).first()).id;

await db.prepare("INSERT INTO config (chave, valor) VALUES ('email', '\"contato@exemplo.com\"') ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").run();

// ---- pedido recebido ----
const r1 = await pedir(0, [{ id: "bamboo-dreams", qtd: 1 }]);
let es = await emailsDe(r1.token);
t("pedido criado enfileira 'recebido' (ainda pendente)", es.length === 1 && es[0].tipo === "recebido" && es[0].status === "pendente" && es[0].para === "m0@exemplo.com", JSON.stringify(es.map((e) => [e.tipo, e.status])));
t("assunto e botões do 'recebido'", es[0].assunto === `Recebemos o seu pedido #${r1.numero}` && es[0].html.includes("Pagar agora") && es[0].html.includes(`https://loja.exemplo/pedido.html?t=${r1.token}`) && es[0].html.includes(r1.url));
t("e-mail não leva CPF nem endereço completo", ![CPFS[0], "11144477735", "Rua das Flores", "29100000", "27999990000"].some((x) => es[0].html.includes(x) || es[0].texto.includes(x)));
t("tem versão em texto simples, sem tags", !/<[a-z]/i.test(es[0].texto) && es[0].texto.includes("Pagar agora:"));
t("visual da marca (vinho, idioma pt-BR)", es[0].html.includes("#B52141") && es[0].html.includes('lang="pt-BR"') && es[0].html.includes("MELTY"));
t("resumo com itens e total", es[0].html.includes("1× Vela Bamboo Dreams") && es[0].html.includes("R$") && es[0].html.includes("Total"));

// ---- sem provedor: nada é enviado e nada se perde ----
t("sem provedor de e-mail configurado: fila intacta", !emailAtivo(base) && (await processarFila(base)).enviados === 0 && (await emailsDe(r1.token))[0].status === "pendente");

// ---- envio com provedor injetado ----
const chamadas = [];
let res = await processarFila(env, { enviar: async (x) => { chamadas.push(x); return { id: "abc" }; } });
es = await emailsDe(r1.token);
t("envia o e-mail pendente e marca como enviado", res.enviados >= 1 && es[0].status === "simulado" && es[0].provedor_ref === "abc" && es[0].tentativas === 1, JSON.stringify(es[0]));
const ch = chamadas.find((c) => c.para === "m0@exemplo.com");
t("chamada ao provedor: destinatário, responder-para e chave anti-duplicação", ch && ch.responderPara === "contato@exemplo.com" && ch.chave === `melty-email-${es[0].id}-v1` && ch.html.includes("Pagar agora"), JSON.stringify(ch)?.slice(0, 200));
res = await processarFila(env, { enviar: async () => { throw new Error("não deveria enviar de novo"); } });
t("e-mail já enviado não é reenviado", res.enviados === 0 && res.falhas === 0);

// ---- pago ----
await db.prepare("INSERT INTO config (chave, valor) VALUES ('prazo_producao_dias_uteis', '3') ON CONFLICT(chave) DO UPDATE SET valor = '3'").run();
await Promise.all([1, 2, 3].map(() => aplicarPagamento(env, r1.token, { status: "aprovado", valorCentavos: 9990, cpfPagador: CPFS[0] })));
es = await emailsDe(r1.token);
const pago = es.find((e) => e.tipo === "pago");
t("pagamento (mesmo com 3 avisos repetidos) gera UM e-mail 'pago'", es.filter((e) => e.tipo === "pago").length === 1, es.map((e) => e.tipo));
t("'pago' diz que o pedido será enviado em até 2 dias úteis (config), sem falar em produção", pago.html.includes("Seu pedido será enviado em até <b>2 dias úteis</b>") && pago.texto.includes("Seu pedido será enviado em até 2 dias úteis") && !/produ[çc]/i.test(pago.html) && !/produ[çc]/i.test(pago.texto) && pago.assunto.startsWith("Pagamento confirmado"), pago.html.slice(pago.html.indexOf("Recebemos o pagamento"), pago.html.indexOf("Recebemos o pagamento") + 200));
await db.prepare("UPDATE pedidos SET frete_prazo_dias = 5 WHERE token = ?").bind(r1.token).run();
await enfileirar(db, await idDe(r1.token), "pago", { env, forcar: true });
const pago2 = (await emailsDe(r1.token)).find((e) => e.tipo === "pago");
t("com previsão conhecida, 'pago' informa o prazo único (em até 5 dias úteis após o envio)", pago2.html.includes("em até <b>5 dias úteis</b>") && pago2.html.includes("após o envio do pedido") && pago2.texto.includes("em até 5 dias úteis"), pago2.html.slice(pago2.html.indexOf("Previs"), pago2.html.indexOf("Previs") + 160));
await db.prepare("UPDATE pedidos SET frete_prazo_dias = NULL WHERE token = ?").bind(r1.token).run();
await db.prepare("UPDATE config SET valor = '0' WHERE chave = 'prazo_postagem_dias_uteis'").run();
await enfileirar(db, await idDe(r1.token), "pago", { env, forcar: true });
const pago3 = (await emailsDe(r1.token)).find((e) => e.tipo === "pago");
t("sem prazo de envio configurado (0), volta a dizer 'em breve ... separado e enviado'", pago3.html.includes("Em breve o seu pedido será separado e enviado") && !pago3.html.includes("em até <b>"), pago3.html.slice(pago3.html.indexOf("Recebemos"), pago3.html.indexOf("Recebemos") + 200));
await db.prepare("UPDATE config SET valor = '2' WHERE chave = 'prazo_postagem_dias_uteis'").run();
await enfileirar(db, await idDe(r1.token), "pago", { env, forcar: true });

// ---- enviado, entregue ----
const id1 = await idDe(r1.token);
await mudarStatus(db, id1, "em_producao", { env });
t("'em preparo' não envia e-mail (só aviso no painel)", (await emailsDe(r1.token)).every((e) => e.tipo !== "em_producao"));
await mudarStatus(db, id1, "enviado", { rastreio: "ab123456789br", env });
const env1 = (await emailsDe(r1.token)).find((e) => e.tipo === "enviado");
t("'enviado' traz o rastreio e o link de rastreio", env1.html.includes("AB123456789BR") && env1.html.includes("https://melhorrastreio.com.br/rastreio/AB123456789BR") && env1.texto.includes("AB123456789BR"));
await mudarStatus(db, id1, "entregue", { env });
t("'entregue' enfileirado", (await emailsDe(r1.token)).some((e) => e.tipo === "entregue"));
await mudarStatus(db, id1, "reembolsado", { env });
t("'reembolsado' enfileirado", (await emailsDe(r1.token)).some((e) => e.tipo === "reembolsado"));

// ---- cancelado (painel) e expirado ----
const r2 = await pedir(1, [{ id: "cereja-avela", qtd: 1 }]);
await aplicarPagamento(env, r2.token, { status: "aprovado", valorCentavos: 9990 });
await mudarStatus(db, await idDe(r2.token), "cancelado", { env });
t("cancelamento pelo painel envia 'cancelado'", (await emailsDe(r2.token)).some((e) => e.tipo === "cancelado" && e.html.includes("cancelado")));
const r3 = await pedir(2, [{ id: "cappuccino", qtd: 1 }]);
await db.prepare("UPDATE pedidos SET expira_em = datetime('now', '-1 minute') WHERE token = ?").bind(r3.token).run();
await liberarVencidos(db, env);
const ex = (await emailsDe(r3.token)).find((e) => e.tipo === "expirado");
t("pedido vencido envia 'expirado' (diz que nada foi cobrado)", !!ex && ex.html.includes("Nada foi cobrado") && ex.html.includes("Voltar para a loja"));

// esvazia a fila (o aviso à loja gera mais e-mails) para os testes de falha olharem só o que vem a seguir
for (let i = 0; i < 10; i++) { const x = await processarFila(env, { enviar: async () => ({ id: "dreno" }) }); if (!x.enviados) break; }

// ---- segurança do conteúdo ----
const r4 = await pedir(3, [{ id: "lavanda", qtd: 1 }], { nome: '<script>alert(1)</script> "Zé"' });
const e4 = (await emailsDe(r4.token))[0];
t("nome do cliente é escapado no HTML (sem <script> ativo)", !e4.html.includes("<script") && e4.html.includes("&lt;script&gt;") && !e4.assunto.includes("<"), e4.html.slice(e4.html.indexOf("Olá"), e4.html.indexOf("Olá") + 120));

// ---- falha e nova tentativa ----
let falha = 0;
res = await processarFila(env, { enviar: async () => { falha++; throw new Error("servidor fora do ar"); } });
const falhados = (await db.prepare("SELECT * FROM emails WHERE status = 'falhou'").all()).results;
t("falha de envio vira 'falhou' com o motivo guardado", res.falhas >= 1 && falhados.length >= 1 && falhados[0].erro.includes("servidor fora do ar") && falhados[0].tentativas === 1, JSON.stringify(falhados[0])?.slice(0, 200));
res = await processarFila(env, { enviar: async () => { throw new Error("não deveria tentar agora"); } });
t("não tenta de novo antes de 5 minutos", res.falhas === 0 && res.enviados === 0);
await db.prepare("UPDATE emails SET atualizado_em = datetime('now', '-6 minutes') WHERE status = 'falhou'").run();
res = await processarFila(env, { enviar: async () => ({ id: "ok" }) });
t("depois de 5 minutos tenta de novo e conclui", res.enviados === falhados.length && (await db.prepare("SELECT COUNT(*) AS n FROM emails WHERE status = 'falhou'").first()).n === 0);
await db.prepare("UPDATE emails SET status = 'falhou', tentativas = 5, atualizado_em = datetime('now', '-6 minutes') WHERE id = ?").bind(falhados[0].id).run();
res = await processarFila(env, { enviar: async () => ({ id: "x" }) });
t("depois de 5 tentativas desiste", res.enviados === 0 && (await db.prepare("SELECT status FROM emails WHERE id = ?").bind(falhados[0].id).first()).status === "falhou");

// ---- dois processos ao mesmo tempo ----
const r5 = await pedir(4, [{ id: "figo-ambarado", qtd: 1 }]);
let envios = 0;
const lento = async () => { envios++; await new Promise((r) => setTimeout(r, 40)); return { id: "z" }; };
await Promise.all([processarFila(env, { enviar: lento }), processarFila(env, { enviar: lento }), processarFila(env, { enviar: lento })]);
t("3 envios simultâneos da fila: cada e-mail sai uma vez só", envios === 1 && (await emailsDe(r5.token))[0].tentativas === 1, `envios=${envios}`);

// ---- e-mail velho demais ----
const r6 = await pedir(5, [{ id: "cha-branco", qtd: 1 }]);
await db.prepare("UPDATE emails SET atualizado_em = datetime('now', '-2 days') WHERE pedido_id = (SELECT id FROM pedidos WHERE token = ?)").bind(r6.token).run();
await processarFila(env, { enviar: async () => ({ id: "q" }) });
t("e-mail pendente há mais de 1 dia é descartado (não faz sentido mandar atrasado)", (await emailsDe(r6.token))[0].status === "descartado");

// ---- reenviar ----
const idRec = (await emailsDe(r1.token))[0].id;
await enfileirar(db, id1, "recebido", { env, forcar: true });
const rr = (await emailsDe(r1.token))[0];
const chaves = [];
await processarFila(env, { enviar: async (x) => { chaves.push(x.chave); return { id: "r" }; } });
t("reenviar: volta para a fila, nova versão e nova chave", rr.status === "pendente" && rr.versao === 2 && chaves.includes(`melty-email-${idRec}-v2`), JSON.stringify([rr.status, rr.versao, chaves]));

// ---- adaptador Resend (com servidor de mentira) ----
const realFetch = globalThis.fetch; const reqs = [];
globalThis.fetch = async (url, opt) => { reqs.push({ url, opt }); return url === "https://api.resend.com/emails" ? new Response(JSON.stringify({ id: "re_123" }), { status: 200 }) : realFetch(url, opt); };
const envR = { ...base, EMAIL_PROVEDOR: "resend", RESEND_API_KEY: "re_chave_falsa", EMAIL_REMETENTE: "Melty <pedidos@exemplo.com.br>" };
t("Resend só ativa com chave e remetente", emailAtivo(envR) && !emailAtivo({ ...base, EMAIL_PROVEDOR: "resend" }) && !emailAtivo({ ...base, EMAIL_PROVEDOR: "resend", RESEND_API_KEY: "x" }));
const r7 = await criarPedido({ ...envR, PAGAMENTO_PROVEDOR: "teste" }, { itens: [{ id: "bamboo-dreams", qtd: 1 }], cliente: cli(0, { cpf: CPFS[5], email: "nova@exemplo.com" }) }, { urlBase: "https://loja.exemplo" }).catch((e) => e);
await processarFila(envR);
const chamadaR = reqs.find((r) => r.url === "https://api.resend.com/emails");
const corpoR = chamadaR && JSON.parse(chamadaR.opt.body);
t("Resend: endereço, método, autenticação, chave de repetição e corpo", chamadaR && chamadaR.opt.method === "POST" && chamadaR.opt.headers.Authorization === "Bearer re_chave_falsa" && chamadaR.opt.headers["Content-Type"] === "application/json" && /^melty-email-\d+-v1$/.test(chamadaR.opt.headers["Idempotency-Key"]) && !!chamadaR.opt.headers["User-Agent"]
  && corpoR.from === "Melty <pedidos@exemplo.com.br>" && Array.isArray(corpoR.to) && corpoR.to[0] === "nova@exemplo.com" && corpoR.subject.startsWith("Recebemos") && corpoR.html && corpoR.text && corpoR.reply_to === "contato@exemplo.com", JSON.stringify(corpoR)?.slice(0, 250));
t("Resend: resposta guardada (id) e status 'enviado'", r7.token && (await emailsDe(r7.token))[0].status === "enviado" && (await emailsDe(r7.token))[0].provedor_ref === "re_123", JSON.stringify(await emailsDe(r7.token ?? "")).slice(0, 200));
globalThis.fetch = async (url) => (url === "https://api.resend.com/emails" ? new Response('{"message":"domínio não verificado"}', { status: 403 }) : realFetch(url));
await enfileirar(db, await idDe(r7.token), "pago", { env: envR });
await processarFila(envR);
const falhaR = (await emailsDe(r7.token)).find((e) => e.tipo === "pago");
t("Resend: erro HTTP vira 'falhou' com o motivo", falhaR.status === "falhou" && falhaR.erro.includes("403") && falhaR.erro.includes("domínio não verificado"), JSON.stringify(falhaR).slice(0, 200));
globalThis.fetch = realFetch;

console.log(`\n${ok} ok, ${bad} falhas`);
await dispose();
process.exit(bad ? 1 : 0);
