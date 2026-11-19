// Valida o Melhor Envio de verdade (ambiente SANDBOX): cotação e o fluxo completo da etiqueta, usando o banco local.
// Uso:  MELHORENVIO_TOKEN=<token do sandbox> node scripts/validar-melhorenvio.mjs        (antes: npm run db:reset)
// Gasta apenas o saldo de mentira do sandbox. Nunca use token de produção aqui.
import { getPlatformProxy } from "wrangler";
import { cotarFrete } from "../functions/_lib/frete.js";
import { criarPedido, aplicarPagamento } from "../functions/_lib/pedidos.js";
import { gerarEtiqueta, linkEtiqueta, buscarRastreio, cancelarEtiqueta, userAgent } from "../functions/_lib/melhorenvio.js";

if (!process.env.MELHORENVIO_TOKEN) { console.error("Defina MELHORENVIO_TOKEN (token do sandbox)."); process.exit(1); }
const { env: base, dispose } = await getPlatformProxy({ configPath: new URL("../wrangler.toml", import.meta.url).pathname, persist: { path: new URL("../.wrangler/state/v3", import.meta.url).pathname } });
const env = { ...base, PAGAMENTO_PROVEDOR: "teste", EMAIL_PROVEDOR: "teste", MELHORENVIO_TOKEN: process.env.MELHORENVIO_TOKEN, MELHORENVIO_AMBIENTE: "sandbox" };
const db = env.DB;
const setCfg = (k, v) => db.prepare("INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").bind(k, JSON.stringify(v)).run();
const passo = (t) => console.log("\n== " + t);
const mostra = (o) => console.log(JSON.stringify(o, null, 1).slice(0, 900));

// Remetente de teste (CEP de RUA, não o CEP geral da cidade) e cliente no Rio
await setCfg("remetente", { nome: "Maria Teste", telefone: "11999990000", email: "teste@exemplo.com", documento: "52998224725", cep: "01001000", rua: "Praça da Sé", numero: "100", complemento: "", bairro: "Sé", cidade: "São Paulo", uf: "SP", observacao: "" });
await setCfg("melhorenvio", { ativo: true, servicos: [1, 2, 3, 4], etiquetas_ativas: true, nao_comercial: true });
await setCfg("frete_regioes", []); await setCfg("prazo_producao_dias_uteis", 3);
await db.prepare("UPDATE produtos SET estoque = 50").run();
const cfg = Object.fromEntries((await db.prepare("SELECT chave, valor FROM config").all()).results.map((r) => [r.chave, JSON.parse(r.valor)]));
const contato = userAgent(cfg.loja, cfg.email);

passo("1) Cotação real (SP -> RJ)");
const linhas = [{ qtd: 1, peso_kg: 0.42, altura_cm: null, largura_cm: null, comprimento_cm: null }];
const cot = await cotarFrete(db, env, { cep: "20040020", linhas, subtotal_centavos: 7990 });
mostra({ fonte: cot.fonte, falhou: cot.cotacao_falhou, opcoes: cot.opcoes.map((o) => `${o.id} ${o.servico} R$ ${(o.preco_centavos / 100).toFixed(2)} transporte ${o.transporte_dias}d => prazo ${o.prazo_dias_uteis}d`) });
if (!cot.opcoes.length) { console.error("Sem opções: confira token/ambiente/CEPs."); await dispose(); process.exit(2); }

passo("2) Pedido com a 1ª opção + pagamento simulado");
const escolhida = cot.opcoes.find((o) => o.id === "me:1") || cot.opcoes[0];
const r = await criarPedido(env, { itens: [{ id: "bamboo-dreams", qtd: 1 }], cliente: { nome: "João Teste", email: "joao@exemplo.com", telefone: "21988887777", cpf: "11144477735", cep: "20040-020", rua: "Rua da Assembleia", numero: "10", complemento: "sala 2", bairro: "Centro", cidade: "Rio de Janeiro", uf: "RJ", aceite: true, frete_id: escolhida.id } }, { urlBase: "https://loja.exemplo" });
const ped = await db.prepare("SELECT * FROM pedidos WHERE token = ?").bind(r.token).first();
await aplicarPagamento(env, r.token, { status: "aprovado", valorCentavos: ped.total_centavos, cpfPagador: "11144477735" });
mostra({ id: ped.id, frete_id: ped.frete_id, frete: ped.frete_centavos / 100, pacote: JSON.parse(ped.pacote_json) });

passo("3) Gerar etiqueta (carrinho -> compra -> geração -> rastreio)");
try { mostra(await gerarEtiqueta(env, db, ped.id, { contato, cfg })); }
catch (e) { console.log("FALHOU:", e.message); mostra(e.detalhes ?? {}); }
const aposGerar = await db.prepare("SELECT * FROM pedidos WHERE id = ?").bind(ped.id).first();
mostra({ me_estado: aposGerar.me_estado, me_ordem_id: aposGerar.me_ordem_id, me_rastreio: aposGerar.me_rastreio, me_erro: aposGerar.me_erro });

if (aposGerar.me_ordem_id) {
  passo("4) Rastreio e link de impressão");
  try { console.log("rastreio:", await buscarRastreio(env, db, ped.id, { contato, ordem: aposGerar.me_ordem_id }) || "(ainda não disponível)"); } catch (e) { console.log("rastreio falhou:", e.message); }
  try { console.log("link:", await linkEtiqueta(env, await db.prepare("SELECT * FROM pedidos WHERE id = ?").bind(ped.id).first(), { contato })); } catch (e) { console.log("link falhou:", e.message); }
  passo("5) Cancelar a etiqueta");
  try { await cancelarEtiqueta(env, db, await db.prepare("SELECT * FROM pedidos WHERE id = ?").bind(ped.id).first(), { contato }); console.log("cancelada"); } catch (e) { console.log("cancelamento falhou:", e.message); }
}
await dispose();
