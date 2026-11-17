import { getPlatformProxy } from "wrangler";
import { validarCpf, hashDado, calcularPedido, reservarCupom, confirmarUso, liberarUso, registrarCompra, ErroNegocio } from "../functions/_lib/cupons.js";
import { precoVigente } from "../functions/_lib/precos.js";

const { env, dispose } = await getPlatformProxy({ configPath: new URL("../wrangler.toml", import.meta.url).pathname, persist: { path: new URL("../.wrangler/state/v3", import.meta.url).pathname } });
const db = env.DB;
let ok = 0, bad = 0;
const t = (nome, cond, extra = "") => { cond ? ok++ : bad++; console.log(cond ? "OK  " : "FALHA", nome, cond ? "" : String(extra)); };
const erroCodigo = async (fn) => { try { await fn(); return null; } catch (e) { return e instanceof ErroNegocio ? e.codigo : "ERRO:" + e.message; } };

// CPFs válidos de teste (gerados por cálculo, não são de pessoas reais)
const CPF = { a: "52998224725", b: "11144477735", c: "39053344705", d: "86288366757", e: "71428793860" };
t("CPFs de teste são válidos", Object.values(CPF).every(validarCpf), Object.values(CPF).map(validarCpf));
t("CPF com máscara", validarCpf("529.982.247-25") === "52998224725");
t("CPF com dígito errado", validarCpf("52998224726") === null);
t("CPF repetido (111.111.111-11)", validarCpf("11111111111") === null);
t("CPF curto/vazio", validarCpf("123") === null && validarCpf("") === null && validarCpf(null) === null);
const h1 = await hashDado(env, "cpf", CPF.a), h2 = await hashDado(env, "email", CPF.a);
t("hash não contém o CPF e difere por tipo", !h1.includes(CPF.a) && h1 !== h2 && h1.length === 64);

// ---- preços e promoção ----
const base = { preco_centavos: 10000, preco_promo_centavos: 8000, promo_inicio: null, promo_fim: null };
const dia = (s) => new Date(s + "T15:00:00Z");
t("promoção sem datas vale", precoVigente(base).promocao);
t("promoção antes do início não vale", !precoVigente({ ...base, promo_inicio: "2030-01-01" }).promocao);
t("promoção depois do fim não vale", !precoVigente({ ...base, promo_fim: "2020-01-01" }).promocao);
t("fim inclusivo (último dia vale)", precoVigente({ ...base, promo_fim: "2026-11-20" }, dia("2026-11-20")).promocao);
t("dia seguinte ao fim não vale", !precoVigente({ ...base, promo_fim: "2026-11-20" }, dia("2026-11-21")).promocao);
t("promo >= preço cheio é ignorada", !precoVigente({ ...base, preco_promo_centavos: 10000 }).promocao);
t("23h59 de Brasília ainda é o mesmo dia", precoVigente({ ...base, promo_fim: "2026-11-20" }, new Date("2026-11-21T02:30:00Z")).promocao);

// ---- pedido sem cupom ----
await db.prepare("UPDATE produtos SET preco_promo_centavos = 6000 WHERE id = 'peachy'").run();       // peachy: 75,00 → 60,00 (promo)
const itens = [{ id: "bamboo-dreams", qtd: 2 }, { id: "peachy", qtd: 1 }];                           // 79,90×2 + 60,00
let r = await calcularPedido(db, env, { itens });
t("subtotal usa preço promocional", r.subtotal_centavos === 7990 * 2 + 6000 && r.total_centavos === r.subtotal_centavos, JSON.stringify(r));
t("estoque insuficiente", (await erroCodigo(() => calcularPedido(db, env, { itens: [{ id: "bamboo-dreams", qtd: 99 }] }))) === "estoque");
t("produto esgotado", (await erroCodigo(() => calcularPedido(db, env, { itens: [{ id: "mousse-de-limao", qtd: 1 }] }))) === "estoque");
t("produto inexistente", (await erroCodigo(() => calcularPedido(db, env, { itens: [{ id: "nao-existe", qtd: 1 }] }))) === "produto");
t("quantidade inválida", (await erroCodigo(() => calcularPedido(db, env, { itens: [{ id: "peachy", qtd: -1 }] }))) === "carrinho");
t("preço enviado pelo navegador é ignorado", (await calcularPedido(db, env, { itens: [{ id: "peachy", qtd: 1, preco: 1, unitario: 1 }] })).subtotal_centavos === 6000);

// ---- cupons ----
const novoCupom = async (o) => {
  const c = { codigo: "X", tipo: "percentual", valor: 10, limite_total: null, so_primeira_compra: 0, valor_minimo_centavos: 0, inicio: null, fim: null, escopo: "todos", escopo_ids: "[]", acumula_promocao: 0, ativo: 1, ...o };
  const rr = await db.prepare("INSERT INTO cupons (codigo,tipo,valor,limite_total,so_primeira_compra,valor_minimo_centavos,inicio,fim,escopo,escopo_ids,acumula_promocao,ativo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(c.codigo, c.tipo, c.valor, c.limite_total, c.so_primeira_compra, c.valor_minimo_centavos, c.inicio, c.fim, c.escopo, c.escopo_ids, c.acumula_promocao, c.ativo).run();
  return rr.meta.last_row_id;
};
const calc = (cupom, extra = {}, i = itens) => calcularPedido(db, env, { itens: i, cupom, cpf: CPF.a, ...extra });

await novoCupom({ codigo: "DEZ", tipo: "percentual", valor: 10 });
r = await calc("dez");
t("10%: aplica só nos itens SEM promoção (peachy está em promoção)", r.desconto_centavos === Math.floor(7990 * 2 * 0.10) && r.cupom.codigo === "DEZ", JSON.stringify(r));
await novoCupom({ codigo: "ACUMULA", tipo: "percentual", valor: 10, acumula_promocao: 1 });
r = await calc("ACUMULA");
t("cupom que acumula com promoção alcança todos os itens", r.desconto_centavos === Math.floor((7990 * 2 + 6000) * 0.10), r.desconto_centavos);
await novoCupom({ codigo: "R20", tipo: "valor", valor: 2000 });
t("valor fixo", (await calc("R20")).desconto_centavos === 2000);
await novoCupom({ codigo: "R500", tipo: "valor", valor: 50000 });
t("valor fixo nunca passa do que é elegível", (await calc("R500")).desconto_centavos === 7990 * 2);
await novoCupom({ codigo: "CAT", tipo: "percentual", valor: 50, escopo: "categorias", escopo_ids: '["home-spray"]' });
t("escopo de categoria sem itens da categoria", (await erroCodigo(() => calc("CAT"))) === "cupom_escopo");
await novoCupom({ codigo: "PROD", tipo: "percentual", valor: 50, escopo: "produtos", escopo_ids: '["bamboo-dreams"]' });
t("escopo de produto", (await calc("PROD")).desconto_centavos === Math.floor(7990 * 2 * 0.5));
await novoCupom({ codigo: "MIN", tipo: "valor", valor: 1000, valor_minimo_centavos: 20000 });
t("valor mínimo não atingido", (await erroCodigo(() => calc("MIN"))) === "cupom_minimo");
await novoCupom({ codigo: "FRETE", tipo: "frete", valor: 0 });
t("cupom de frete grátis", (await calc("FRETE")).frete_gratis === true && (await calc("FRETE")).desconto_centavos === 0);
await novoCupom({ codigo: "FUTURO", inicio: "2099-01-01" });
await novoCupom({ codigo: "VENCIDO", fim: "2020-01-01" });
await novoCupom({ codigo: "OFF", ativo: 0 });
t("cupom que ainda não começou", (await erroCodigo(() => calc("FUTURO"))) === "cupom_inicio");
t("cupom vencido", (await erroCodigo(() => calc("VENCIDO"))) === "cupom_expirado");
t("cupom desativado", (await erroCodigo(() => calc("OFF"))) === "cupom");
t("cupom inexistente", (await erroCodigo(() => calc("NAOEXISTE"))) === "cupom");
t("cupom exige CPF válido", (await erroCodigo(() => calc("DEZ", { cpf: "123" }))) === "cpf");
t("cupom exige CPF (vazio)", (await erroCodigo(() => calc("DEZ", { cpf: "" }))) === "cpf");

// ---- limite de usos e CPF ----
const idLim = await novoCupom({ codigo: "TRES", tipo: "percentual", valor: 10, limite_total: 3 });
const res = (cpf, ref, minutos) => reservarCupom(db, env, { cupomId: idLim, cpf, pedidoRef: ref, descontoCentavos: 100, minutos });
await res(CPF.a, "P1");
t("mesmo CPF não usa duas vezes", (await erroCodigo(() => res(CPF.a, "P1b"))) === "cpf_ja_usou");
t("mesmo CPF com a máscara escrita diferente também é bloqueado", (await erroCodigo(() => res("529.982.247-25", "P1c"))) === "cpf_ja_usou");
await res(CPF.b, "P2");   // CPF diferente = pessoa diferente, mesmo que use o mesmo e-mail ou endereço
t("validação mostra 'já usou' para o CPF reservado", (await erroCodigo(() => calc("TRES", { cpf: CPF.a }))) === "cpf_ja_usou");
t("CPF diferente com e-mail igual/parecido não é bloqueado (são pessoas diferentes)", (await erroCodigo(() => calc("TRES", { cpf: CPF.c, email: "ana@exemplo.com" }))) === null && (await erroCodigo(() => calc("TRES", { cpf: CPF.c, email: "a.na+x@exemplo.com" }))) === null);
await res(CPF.c, "P3");
t("limite total atingido: reserva recusada", (await erroCodigo(() => res(CPF.d, "P4"))) === "cupom_esgotado");
t("limite total atingido: cálculo recusa", (await erroCodigo(() => calc("TRES", { cpf: CPF.d }))) === "cupom_esgotado");
await liberarUso(db, "P3");
t("cupom liberado (pedido cancelado) volta a ficar disponível", (await erroCodigo(() => res(CPF.d, "P4"))) === null);
await confirmarUso(db, env, { pedidoRef: "P2", cpf: CPF.b });
await liberarUso(db, "P2");
const st = await db.prepare("SELECT status FROM cupom_usos WHERE pedido_ref = 'P2'").first();
t("uso consumido (pago) não é liberado depois", st.status === "consumido", st.status);

// ---- uso simultâneo: 8 pessoas diferentes disputam 3 vagas ----
const idCorr = await novoCupom({ codigo: "CORRIDA", limite_total: 3 });
const cpfs = ["52998224725", "11144477735", "39053344705", "86288366757", "71428793860", "93541134780", "15350946056", "01234567890"].filter(validarCpf).slice(0, 8);
const resultados = await Promise.all(cpfs.map((c, i) => reservarCupom(db, env, { cupomId: idCorr, cpf: c, pedidoRef: "C" + i, descontoCentavos: 1 }).then(() => "ok", (e) => e.codigo)));
const vagas = resultados.filter((x) => x === "ok").length;
const { n: gravados } = await db.prepare("SELECT COUNT(*) AS n FROM cupom_usos WHERE cupom_id = ? AND status = 'reservado'").bind(idCorr).first();
t(`corrida: ${cpfs.length} disputando 3 vagas → exatamente 3 usos`, vagas === 3 && gravados === 3, JSON.stringify({ resultados, gravados }));

// ---- o mesmo CPF tentando 5 vezes ao mesmo tempo ----
const idMesmo = await novoCupom({ codigo: "MESMOCPF" });
const rr = await Promise.all([1, 2, 3, 4, 5].map((i) => reservarCupom(db, env, { cupomId: idMesmo, cpf: CPF.e, pedidoRef: "M" + i, descontoCentavos: 1 }).then(() => "ok", (e) => e.codigo)));
t("mesmo CPF em 5 tentativas simultâneas (e-mails diferentes) → 1 uso só", rr.filter((x) => x === "ok").length === 1, JSON.stringify(rr));

// ---- reserva vence sozinha ----
const idVenc = await novoCupom({ codigo: "VENCE", limite_total: 1 });
await reservarCupom(db, env, { cupomId: idVenc, cpf: CPF.a, pedidoRef: "V1", descontoCentavos: 1, minutos: 30 });
t("dentro dos 30 min a vaga continua presa", (await erroCodigo(() => reservarCupom(db, env, { cupomId: idVenc, cpf: CPF.b, pedidoRef: "V2", descontoCentavos: 1 }))) === "cupom_esgotado");
const depois = new Date(Date.now() + 31 * 60000);
t("após 31 min sem pagar, a vaga é liberada", (await erroCodigo(() => reservarCupom(db, env, { cupomId: idVenc, cpf: CPF.b, pedidoRef: "V2", descontoCentavos: 1 }, depois))) === null);

// ---- primeira compra (só pelo CPF) ----
await novoCupom({ codigo: "BEMVINDO", tipo: "percentual", valor: 15, so_primeira_compra: 1 });
t("cliente novo pode usar", (await calc("BEMVINDO", { cpf: CPF.d })).desconto_centavos > 0);
await registrarCompra(db, env, { pedidoRef: "ANTIGO", cpf: CPF.a });
t("CPF que já comprou é recusado", (await erroCodigo(() => calc("BEMVINDO", { cpf: CPF.a }))) === "primeira_compra");
t("CPF que já comprou, escrito com máscara, também", (await erroCodigo(() => calc("BEMVINDO", { cpf: "529.982.247-25" }))) === "primeira_compra");
t("outro CPF com o mesmo e-mail/endereço de quem já comprou PODE usar (outra pessoa)", (await erroCodigo(() => calc("BEMVINDO", { cpf: CPF.d, email: "ana@exemplo.com", endereco: { cep: "29100-000", numero: "100" } }))) === null);
t("pedido só reservado (não pago) ainda não conta como 'já comprou'", (await erroCodigo(() => calc("BEMVINDO", { cpf: CPF.e }))) === null);

// ---- privacidade: nada aberto no banco ----
const dump = JSON.stringify((await db.prepare("SELECT * FROM cupom_usos").all()).results) + JSON.stringify((await db.prepare("SELECT * FROM compradores").all()).results);
t("banco não guarda o CPF aberto", !Object.values(CPF).some((c) => dump.includes(c)));

console.log(`\n${ok} ok, ${bad} falhas`);
await dispose();
process.exit(bad ? 1 : 0);
