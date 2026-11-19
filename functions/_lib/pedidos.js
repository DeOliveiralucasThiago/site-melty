// Regras de pedido: criar, pagar, cancelar, expirar e avançar de etapa. Valores sempre em centavos.
import { calcularPedido, reservarCupom, confirmarUso, liberarUso, registrarCompra, validarCpf, ErroNegocio } from "./cupons.js";
import { provedor } from "./pagamento.js";
import * as v from "./validar.js";
import { numeroDoPedido } from "./util.js";
import { enfileirar, enfileirarAvisoLoja } from "./email.js";
import { cotarFrete } from "./frete.js";
export { numeroDoPedido };

export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
export const MINUTOS_RESERVA = 30;
const MOTIVO_EXPIRADO = "Pagamento não confirmado no prazo";
export const STATUS_TEXTO = {
  aguardando_pagamento: "Aguardando pagamento", pago: "Pago", em_producao: "Em preparo", enviado: "Enviado", pronto_retirada: "Pronto para retirada",
  entregue: "Entregue", cancelado: "Cancelado", reembolsado: "Reembolsado",
};
export const REVISAO_TEXTO = {
  cpf_diferente: "O CPF de quem pagou é diferente do CPF informado no pedido",
  valor_divergente: "O valor pago é menor que o total do pedido",
  pago_apos_cancelamento: "Pagamento recebido depois do pedido ser cancelado/expirado: confira o estoque ou reembolse",
  sem_estoque: "Pagamento recebido, mas o estoque já não cobre os itens: reembolse ou reponha",
};

const agoraSql = (d = new Date()) => d.toISOString().slice(0, 19).replace("T", " ");

/* ---------- dados do cliente ---------- */
export function lerCliente(c, { exigirEndereco = true } = {}) {
  if (!c || typeof c !== "object") throw new Error("Dados do pedido inválidos.");
  const email = v.texto(c.email, "E-mail", { max: 120, obrigatorio: true }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("E-mail inválido.");
  let tel = String(c.telefone ?? "").replace(/\D/g, "");
  if (tel.length > 11 && tel.startsWith("55")) tel = tel.slice(2);
  if (tel.length < 10 || tel.length > 11) throw new Error("Telefone: informe com DDD (10 ou 11 números).");
  const cpf = validarCpf(c.cpf);
  if (!cpf) throw new Error("CPF inválido.");
  const cep = String(c.cep ?? "").replace(/\D/g, "");
  if (cep.length !== 8) throw new Error("CEP: informe os 8 números.");
  const uf = String(c.uf ?? "").toUpperCase();
  if (exigirEndereco && !UFS.includes(uf)) throw new Error("Estado (UF) inválido.");
  if (c.aceite !== true) throw new Error("É preciso aceitar a Política de Privacidade para continuar.");
  return {
    nome: v.texto(c.nome, "Nome", { max: 80, min: 3 }), email, telefone: tel, cpf, cep,
    // Na retirada no local não há endereço de entrega
    rua: exigirEndereco ? v.texto(c.rua, "Rua", { max: 100, min: 2 }) : "", numero: exigirEndereco ? v.texto(c.numero, "Número", { max: 10, min: 1 }) : "",
    complemento: exigirEndereco ? v.texto(c.complemento, "Complemento", { max: 40 }) : "", bairro: exigirEndereco ? v.texto(c.bairro, "Bairro", { max: 60, min: 2 }) : "",
    cidade: exigirEndereco ? v.texto(c.cidade, "Cidade", { max: 60, min: 2 }) : "", uf: exigirEndereco ? uf : "", cupom: v.texto(c.cupom, "Cupom", { max: 20 }), frete_id: v.texto(c.frete_id, "Forma de entrega", { max: 40 }),
  };
}

export async function fretePadraoCentavos(db) {
  const r = await db.prepare("SELECT valor FROM config WHERE chave = 'frete_provisorio'").first();
  const reais = r ? Number(JSON.parse(r.valor)) : 0;
  return Number.isFinite(reais) && reais > 0 ? Math.round(reais * 100) : 0;
}

/* ---------- criar ---------- */
export async function criarPedido(env, corpo, { urlBase }) {
  const db = env.DB;
  const prov = provedor(env);
  if (!prov) throw new ErroNegocio("O pagamento online ainda não está disponível. Fale com a gente pelo WhatsApp.", "pagamento_inativo");
  let cliente;
  try { cliente = lerCliente(corpo.cliente, { exigirEndereco: false }); }
  catch (e) { throw e instanceof ErroNegocio ? e : new ErroNegocio(e.message, "dados"); }
  await liberarVencidos(db, env);

  const calc = await calcularPedido(db, env, { itens: corpo.itens, cupom: cliente.cupom, cpf: cliente.cpf });
  const cot = await cotarFrete(db, env, { cep: cliente.cep, linhas: calc.itens, subtotal_centavos: calc.subtotal_centavos });
  if (!cot.opcoes.length) throw new ErroNegocio(cot.cotacao_falhou ? "Não foi possível calcular o frete agora. Tente de novo em instantes ou fale com a gente pelo WhatsApp." : "Não encontramos opções de entrega para este CEP. Confira se o CEP está correto ou fale com a gente pelo WhatsApp.", "frete");
  const opcao = cliente.frete_id ? cot.opcoes.find((o) => o.id === cliente.frete_id) : (cot.opcoes.length === 1 ? cot.opcoes[0] : null);
  if (!opcao) throw new ErroNegocio("Escolha uma forma de entrega.", "frete");
  if (!opcao.retirada) {
    try { cliente = lerCliente(corpo.cliente, { exigirEndereco: true }); }
    catch (e) { throw e instanceof ErroNegocio ? e : new ErroNegocio(e.message, "dados"); }
  }
  const frete = opcao.retirada ? 0 : (calc.frete_gratis ? 0 : opcao.preco_centavos);
  const total = calc.total_centavos + frete;
  const token = crypto.randomUUID().replace(/-/g, "");
  const expira = agoraSql(new Date(Date.now() + MINUTOS_RESERVA * 60000));

  if (calc.cupom) await reservarCupom(db, env, { cupomId: calc.cupom.id, cpf: cliente.cpf, pedidoRef: token, descontoCentavos: calc.desconto_centavos, minutos: MINUTOS_RESERVA });

  const sub = "(SELECT id FROM pedidos WHERE token = ?)";
  try {
    // Tudo ou nada: se o estoque faltar, o banco recusa (estoque nunca fica negativo) e nada é gravado.
    await db.batch([
      (() => {
        const col = {
          token, status: "aguardando_pagamento", cliente_nome: cliente.nome, cliente_email: cliente.email, cliente_telefone: cliente.telefone, cliente_cpf: cliente.cpf,
          end_cep: cliente.cep, end_rua: cliente.rua, end_numero: cliente.numero, end_complemento: cliente.complemento, end_bairro: cliente.bairro, end_cidade: cliente.cidade, end_uf: cliente.uf,
          subtotal_centavos: calc.subtotal_centavos, desconto_centavos: calc.desconto_centavos, frete_centavos: frete, total_centavos: total, cupom_codigo: calc.cupom?.codigo ?? "",
          provedor: prov.nome, expira_em: expira, url_base: urlBase, frete_servico: opcao.servico, frete_id: opcao.id, frete_prazo_dias: opcao.prazo_dias_uteis ?? null, retirada: opcao.retirada ? 1 : 0, pacote_json: opcao.retirada ? null : JSON.stringify(cot.pacote),
        };
        const nomes = Object.keys(col);
        return db.prepare(`INSERT INTO pedidos (${nomes.join(", ")}) VALUES (${nomes.map(() => "?").join(", ")})`).bind(...Object.values(col));
      })(),
      ...calc.itens.map((l) => db.prepare(`INSERT INTO pedido_itens (pedido_id, produto_id, nome, qtd, unitario_centavos, cheio_centavos, promocao) VALUES (${sub}, ?, ?, ?, ?, ?, ?)`)
        .bind(token, l.id, l.nome, l.qtd, l.unitario, l.cheio, l.promocao ? 1 : 0)),
      ...calc.itens.map((l) => db.prepare("UPDATE produtos SET estoque = estoque - ? WHERE id = ?").bind(l.qtd, l.id)),
      db.prepare(`INSERT INTO pedido_eventos (pedido_id, tipo, detalhe) VALUES (${sub}, 'criado', ?)`).bind(token, calc.cupom ? `Cupom ${calc.cupom.codigo}` : ""),
    ]);
  } catch (err) {
    if (calc.cupom) await liberarUso(db, token);
    if (/CHECK|estoque/i.test(String(err.message))) throw new ErroNegocio("Um dos itens acabou enquanto você finalizava a compra. Confira o carrinho.", "estoque");
    throw err;
  }

  const pedido = await db.prepare("SELECT * FROM pedidos WHERE token = ?").bind(token).first();
  try {
    const cob = await prov.criarCobranca({ pedido, itens: calc.itens, cliente, urlBase });
    await db.prepare("UPDATE pedidos SET pagamento_url = ?, pagamento_ref = ? WHERE id = ?").bind(cob.url, cob.ref, pedido.id).run();
    try { await enfileirar(db, pedido.id, "recebido", { env }); await enfileirarAvisoLoja(db, pedido.id, "criado", { env }); } catch (e) { console.error("e-mail recebido não enfileirado", e); }
    return { token, numero: numeroDoPedido(pedido.id), url: cob.url };
  } catch (err) {
    await cancelarPedido(db, pedido.id, "Falha ao iniciar o pagamento", { avisar: false });
    throw new ErroNegocio("Não foi possível iniciar o pagamento agora. Tente de novo em instantes.", "pagamento");
  }
}

/* ---------- cancelar e expirar ---------- */
async function evento(db, pedidoId, tipo, detalhe = "") {
  await db.prepare("INSERT INTO pedido_eventos (pedido_id, tipo, detalhe) VALUES (?, ?, ?)").bind(pedidoId, tipo, detalhe).run();
}

// Cancela, devolve os itens ao estoque (se pedido) e libera o cupom reservado.
export async function cancelarPedido(db, id, motivo, { somenteAguardando = true, devolverEstoque = true, avisar = true, env } = {}) {
  const p = await db.prepare("SELECT * FROM pedidos WHERE id = ?").bind(id).first();
  if (!p || ["cancelado", "reembolsado"].includes(p.status)) return false;
  if (somenteAguardando && p.status !== "aguardando_pagamento") return false;
  // "Reserva" a troca de status primeiro: se duas chamadas chegarem juntas, só uma devolve o estoque
  const r = await db.prepare("UPDATE pedidos SET status = 'cancelado', atualizado_em = datetime('now') WHERE id = ? AND status = ?").bind(id, p.status).run();
  if (!r.meta.changes) return false;
  if (devolverEstoque) {
    const itens = (await db.prepare("SELECT produto_id, qtd FROM pedido_itens WHERE pedido_id = ?").bind(id).all()).results;
    await db.batch(itens.map((i) => db.prepare("UPDATE produtos SET estoque = estoque + ? WHERE id = ?").bind(i.qtd, i.produto_id)));
  }
  if (p.status === "aguardando_pagamento") await liberarUso(db, p.token);
  await evento(db, id, "cancelado", motivo);
  if (avisar) { try { await enfileirar(db, id, motivo === MOTIVO_EXPIRADO ? "expirado" : "cancelado", { env }); } catch (e) { console.error("e-mail de cancelamento não enfileirado", e); } }
  return true;
}

export async function liberarVencidos(db, env) {
  const r = await db.prepare("SELECT id FROM pedidos WHERE status = 'aguardando_pagamento' AND expira_em < ? LIMIT 25").bind(agoraSql()).all();
  for (const { id } of r.results) await cancelarPedido(db, id, MOTIVO_EXPIRADO, { env });
}

/* ---------- pagamento (chamado pelo aviso do provedor) ---------- */
/**
 * evento: { status: "aprovado" | "recusado" | "reembolsado", valorCentavos?, cpfPagador?, ref? }
 * Pode ser chamado várias vezes para o mesmo pagamento (provedores reenviam avisos): só a primeira aprovação vale.
 */
export async function aplicarPagamento(env, token, ev) {
  const db = env.DB;
  const p = await db.prepare("SELECT * FROM pedidos WHERE token = ?").bind(token).first();
  if (!p) return { ok: false, motivo: "pedido_inexistente" };

  if (ev.status === "recusado") { await evento(db, p.id, "pagamento_recusado", ev.ref ?? ""); return { ok: true }; }

  if (ev.status === "reembolsado") {
    const r = await db.prepare("UPDATE pedidos SET status = 'reembolsado', atualizado_em = datetime('now') WHERE id = ? AND status NOT IN ('reembolsado','aguardando_pagamento')").bind(p.id).run();
    if (r.meta.changes) { await evento(db, p.id, "reembolsado", ev.ref ?? ""); try { await enfileirar(db, p.id, "reembolsado", { env }); } catch (e) { console.error(e); } }
    return { ok: true };
  }
  if (ev.status !== "aprovado") return { ok: false, motivo: "status_desconhecido" };

  const motivos = [];
  if (ev.valorCentavos !== undefined && ev.valorCentavos < p.total_centavos) motivos.push("valor_divergente");
  const cpfPagador = ev.cpfPagador ? validarCpf(ev.cpfPagador) : null;
  if (cpfPagador && cpfPagador !== p.cliente_cpf) motivos.push("cpf_diferente");

  let r = await db.prepare("UPDATE pedidos SET status = 'pago', pago_em = datetime('now'), atualizado_em = datetime('now') WHERE id = ? AND status = 'aguardando_pagamento'").bind(p.id).run();
  if (!r.meta.changes && p.status === "cancelado") {
    // Pagou depois de o pedido vencer: aceita o dinheiro, tenta pegar o estoque de volta e chama atenção humana
    r = await db.prepare("UPDATE pedidos SET status = 'pago', pago_em = datetime('now'), atualizado_em = datetime('now') WHERE id = ? AND status = 'cancelado'").bind(p.id).run();
    if (r.meta.changes) {
      motivos.push("pago_apos_cancelamento");
      const itens = (await db.prepare("SELECT produto_id, qtd FROM pedido_itens WHERE pedido_id = ?").bind(p.id).all()).results;
      try { await db.batch(itens.map((i) => db.prepare("UPDATE produtos SET estoque = estoque - ? WHERE id = ?").bind(i.qtd, i.produto_id))); }
      catch { motivos.push("sem_estoque"); }
    }
  }
  if (!r.meta.changes) return { ok: true, repetido: true };   // já estava pago (aviso repetido)

  if (motivos.length) await db.prepare("UPDATE pedidos SET revisao = ? WHERE id = ?").bind(motivos.join(","), p.id).run();
  await confirmarUso(db, env, { pedidoRef: token, cpf: p.cliente_cpf });
  await evento(db, p.id, "pago", motivos.length ? "Atenção: " + motivos.join(", ") : "");
  try { await enfileirar(db, p.id, "pago", { env }); await enfileirarAvisoLoja(db, p.id, "pago", { env }); } catch (e) { console.error("e-mail de pagamento não enfileirado", e); }
  return { ok: true, revisao: motivos };
}

/* ---------- avanço manual (painel) ---------- */
// Entrega: pago → (em preparo) → enviado → entregue. Retirada: pago → (em preparo) → pronto para retirada → entregue (retirado).
export function proximosStatus(p) {
  const saida = p.retirada ? "pronto_retirada" : "enviado";
  return {
    aguardando_pagamento: ["cancelado"],
    pago: ["em_producao", saida, "cancelado", "reembolsado"],
    em_producao: [saida, "cancelado", "reembolsado"],
    enviado: ["entregue", "cancelado", "reembolsado"],
    pronto_retirada: ["entregue", "cancelado", "reembolsado"],
    entregue: ["reembolsado"],
    cancelado: [], reembolsado: [],
  }[p.status] || [];
}

export async function mudarStatus(db, id, novo, { rastreio = "", env } = {}) {
  const p = await db.prepare("SELECT * FROM pedidos WHERE id = ?").bind(id).first();
  if (!p) throw new ErroNegocio("Pedido não encontrado.", "pedido");
  if (!proximosStatus(p).includes(novo)) throw new ErroNegocio(`Não dá para mudar de “${STATUS_TEXTO[p.status]}” para “${STATUS_TEXTO[novo] ?? novo}”.`, "transicao");

  if (novo === "cancelado") {
    await cancelarPedido(db, id, "Cancelado pelo painel", { somenteAguardando: false, devolverEstoque: p.status !== "enviado", env });
    return;
  }
  if (novo === "enviado") {
    const cod = String(rastreio || p.me_rastreio || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{8,30}$/.test(cod)) throw new ErroNegocio("Informe o código de rastreio (8 a 30 letras e números, sem espaços).", "rastreio");
    await db.prepare("UPDATE pedidos SET status = 'enviado', rastreio = ?, enviado_em = datetime('now'), atualizado_em = datetime('now') WHERE id = ?").bind(cod, id).run();
    await evento(db, id, "enviado", cod);
    try { await enfileirar(db, id, "enviado", { env }); } catch (e) { console.error("e-mail de envio não enfileirado", e); }
    return;
  }
  if (novo === "pronto_retirada") {
    await db.prepare("UPDATE pedidos SET status = 'pronto_retirada', atualizado_em = datetime('now') WHERE id = ?").bind(id).run();
    await evento(db, id, "pronto_retirada");
    try { await enfileirar(db, id, "pronto_retirada", { env }); } catch (e) { console.error("e-mail de retirada não enfileirado", e); }
    return;
  }
  const col = novo === "entregue" ? ", entregue_em = datetime('now')" : "";
  await db.prepare(`UPDATE pedidos SET status = ?${col}, atualizado_em = datetime('now') WHERE id = ?`).bind(novo, id).run();
  await evento(db, id, novo);
  if (novo === "entregue" || novo === "reembolsado") { try { await enfileirar(db, id, novo, { env }); } catch (e) { console.error(e); } }
}

/* ---------- visão pública (sem dados sensíveis) ---------- */
export async function paraAcompanhamento(db, p) {
  const itens = (await db.prepare("SELECT nome, qtd, unitario_centavos FROM pedido_itens WHERE pedido_id = ? ORDER BY id").bind(p.id).all()).results;
  const ev = (await db.prepare("SELECT tipo, criado_em FROM pedido_eventos WHERE pedido_id = ? AND tipo IN ('criado','pago','em_producao','enviado','pronto_retirada','entregue','cancelado') ORDER BY id").bind(p.id).all()).results;
  const espera = p.status === "aguardando_pagamento";
  const cfgEnvio = await db.prepare("SELECT valor FROM config WHERE chave = 'prazo_postagem_dias_uteis'").first();
  const diasEnvio = cfgEnvio ? Number(JSON.parse(cfgEnvio.valor)) || 0 : 0;
  const cfgRet = p.retirada ? await db.prepare("SELECT valor FROM config WHERE chave = 'retirada'").first() : null;
  const ret = cfgRet ? JSON.parse(cfgRet.valor) : null;
  return {
    numero: numeroDoPedido(p.id), status: p.status, status_texto: STATUS_TEXTO[p.status],
    primeiro_nome: p.cliente_nome.split(" ")[0], cidade: p.end_cidade, uf: p.end_uf, entrega: p.frete_servico, retirada: !!p.retirada,
    retirada_endereco: p.retirada && ["pronto_retirada", "entregue"].includes(p.status) && ret ? ret.endereco : null, retirada_instrucoes: p.retirada && p.status === "pronto_retirada" && ret ? ret.instrucoes || "" : null,
    prazo_dias: p.frete_prazo_dias, prazo_envio_dias: ["pago", "em_producao"].includes(p.status) && diasEnvio > 0 ? diasEnvio : null,
    itens: itens.map((i) => ({ nome: i.nome, qtd: i.qtd, unitario: i.unitario_centavos / 100, subtotal: (i.unitario_centavos * i.qtd) / 100 })),
    subtotal: p.subtotal_centavos / 100, desconto: p.desconto_centavos / 100, frete: p.frete_centavos / 100, total: p.total_centavos / 100, cupom: p.cupom_codigo,
    rastreio: p.rastreio, rastreio_url: p.rastreio ? `https://melhorrastreio.com.br/rastreio/${encodeURIComponent(p.rastreio)}` : "",
    pagamento_url: espera ? p.pagamento_url : "", expira_em: espera ? p.expira_em : null,
    historico: ev.map((e) => ({ tipo: e.tipo, quando: e.criado_em })),
  };
}
