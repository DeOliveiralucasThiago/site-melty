// Regras de pedido: criar, pagar, cancelar, expirar e avançar de etapa. Valores sempre em centavos.
import { calcularPedido, reservarCupom, confirmarUso, liberarUso, registrarCompra, validarCpf, ErroNegocio } from "./cupons.js";
import { provedor } from "./pagamento.js";
import * as v from "./validar.js";

export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
export const MINUTOS_RESERVA = 30;
export const STATUS_TEXTO = {
  aguardando_pagamento: "Aguardando pagamento", pago: "Pago", em_producao: "Em produção", enviado: "Enviado",
  entregue: "Entregue", cancelado: "Cancelado", reembolsado: "Reembolsado",
};
export const REVISAO_TEXTO = {
  cpf_diferente: "O CPF de quem pagou é diferente do CPF informado no pedido",
  valor_divergente: "O valor pago é menor que o total do pedido",
  pago_apos_cancelamento: "Pagamento recebido depois do pedido ser cancelado/expirado: confira o estoque ou reembolse",
  sem_estoque: "Pagamento recebido, mas o estoque já não cobre os itens: reembolse ou reponha",
};

const agoraSql = (d = new Date()) => d.toISOString().slice(0, 19).replace("T", " ");
export const numeroDoPedido = (id) => 1000 + id;

/* ---------- dados do cliente ---------- */
export function lerCliente(c) {
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
  if (!UFS.includes(uf)) throw new Error("Estado (UF) inválido.");
  if (c.aceite !== true) throw new Error("É preciso aceitar a Política de Privacidade para continuar.");
  return {
    nome: v.texto(c.nome, "Nome", { max: 80, min: 3 }), email, telefone: tel, cpf, cep,
    rua: v.texto(c.rua, "Rua", { max: 100, min: 2 }), numero: v.texto(c.numero, "Número", { max: 10, min: 1 }),
    complemento: v.texto(c.complemento, "Complemento", { max: 40 }), bairro: v.texto(c.bairro, "Bairro", { max: 60, min: 2 }),
    cidade: v.texto(c.cidade, "Cidade", { max: 60, min: 2 }), uf, cupom: v.texto(c.cupom, "Cupom", { max: 20 }),
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
  try { cliente = lerCliente(corpo.cliente); }
  catch (e) { throw e instanceof ErroNegocio ? e : new ErroNegocio(e.message, "dados"); }
  await liberarVencidos(db);

  const calc = await calcularPedido(db, env, { itens: corpo.itens, cupom: cliente.cupom, cpf: cliente.cpf });
  const frete = calc.frete_gratis ? 0 : await fretePadraoCentavos(db);
  const total = calc.total_centavos + frete;
  const token = crypto.randomUUID().replace(/-/g, "");
  const expira = agoraSql(new Date(Date.now() + MINUTOS_RESERVA * 60000));

  if (calc.cupom) await reservarCupom(db, env, { cupomId: calc.cupom.id, cpf: cliente.cpf, pedidoRef: token, descontoCentavos: calc.desconto_centavos, minutos: MINUTOS_RESERVA });

  const sub = "(SELECT id FROM pedidos WHERE token = ?)";
  try {
    // Tudo ou nada: se o estoque faltar, o banco recusa (estoque nunca fica negativo) e nada é gravado.
    await db.batch([
      db.prepare(`INSERT INTO pedidos (token, status, cliente_nome, cliente_email, cliente_telefone, cliente_cpf, end_cep, end_rua, end_numero, end_complemento, end_bairro, end_cidade, end_uf,
                  subtotal_centavos, desconto_centavos, frete_centavos, total_centavos, cupom_codigo, provedor, expira_em)
                  VALUES (?, 'aguardando_pagamento', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(token, cliente.nome, cliente.email, cliente.telefone, cliente.cpf, cliente.cep, cliente.rua, cliente.numero, cliente.complemento, cliente.bairro, cliente.cidade, cliente.uf,
              calc.subtotal_centavos, calc.desconto_centavos, frete, total, calc.cupom?.codigo ?? "", prov.nome, expira),
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
    return { token, numero: numeroDoPedido(pedido.id), url: cob.url };
  } catch (err) {
    await cancelarPedido(db, pedido.id, "Falha ao iniciar o pagamento");
    throw new ErroNegocio("Não foi possível iniciar o pagamento agora. Tente de novo em instantes.", "pagamento");
  }
}

/* ---------- cancelar e expirar ---------- */
async function evento(db, pedidoId, tipo, detalhe = "") {
  await db.prepare("INSERT INTO pedido_eventos (pedido_id, tipo, detalhe) VALUES (?, ?, ?)").bind(pedidoId, tipo, detalhe).run();
}

// Cancela, devolve os itens ao estoque (se pedido) e libera o cupom reservado.
export async function cancelarPedido(db, id, motivo, { somenteAguardando = true, devolverEstoque = true } = {}) {
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
  return true;
}

export async function liberarVencidos(db) {
  const r = await db.prepare("SELECT id FROM pedidos WHERE status = 'aguardando_pagamento' AND expira_em < ? LIMIT 25").bind(agoraSql()).all();
  for (const { id } of r.results) await cancelarPedido(db, id, "Pagamento não confirmado no prazo");
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
    if (r.meta.changes) await evento(db, p.id, "reembolsado", ev.ref ?? "");
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
  return { ok: true, revisao: motivos };
}

/* ---------- avanço manual (painel) ---------- */
const PROXIMOS = {
  aguardando_pagamento: ["cancelado"],
  pago: ["em_producao", "enviado", "cancelado", "reembolsado"],
  em_producao: ["enviado", "cancelado", "reembolsado"],
  enviado: ["entregue", "cancelado", "reembolsado"],
  entregue: ["reembolsado"],
  cancelado: [], reembolsado: [],
};

export async function mudarStatus(db, id, novo, { rastreio = "" } = {}) {
  const p = await db.prepare("SELECT * FROM pedidos WHERE id = ?").bind(id).first();
  if (!p) throw new ErroNegocio("Pedido não encontrado.", "pedido");
  if (!(PROXIMOS[p.status] || []).includes(novo)) throw new ErroNegocio(`Não dá para mudar de “${STATUS_TEXTO[p.status]}” para “${STATUS_TEXTO[novo] ?? novo}”.`, "transicao");

  if (novo === "cancelado") {
    await cancelarPedido(db, id, "Cancelado pelo painel", { somenteAguardando: false, devolverEstoque: p.status !== "enviado" });
    return;
  }
  if (novo === "enviado") {
    const cod = String(rastreio).trim().toUpperCase();
    if (!/^[A-Z0-9]{8,30}$/.test(cod)) throw new ErroNegocio("Informe o código de rastreio (8 a 30 letras e números, sem espaços).", "rastreio");
    await db.prepare("UPDATE pedidos SET status = 'enviado', rastreio = ?, enviado_em = datetime('now'), atualizado_em = datetime('now') WHERE id = ?").bind(cod, id).run();
    await evento(db, id, "enviado", cod);
    return;
  }
  const col = novo === "entregue" ? ", entregue_em = datetime('now')" : "";
  await db.prepare(`UPDATE pedidos SET status = ?${col}, atualizado_em = datetime('now') WHERE id = ?`).bind(novo, id).run();
  await evento(db, id, novo);
}

/* ---------- visão pública (sem dados sensíveis) ---------- */
export async function paraAcompanhamento(db, p) {
  const itens = (await db.prepare("SELECT nome, qtd, unitario_centavos FROM pedido_itens WHERE pedido_id = ? ORDER BY id").bind(p.id).all()).results;
  const ev = (await db.prepare("SELECT tipo, criado_em FROM pedido_eventos WHERE pedido_id = ? AND tipo IN ('criado','pago','em_producao','enviado','entregue','cancelado') ORDER BY id").bind(p.id).all()).results;
  const espera = p.status === "aguardando_pagamento";
  return {
    numero: numeroDoPedido(p.id), status: p.status, status_texto: STATUS_TEXTO[p.status],
    primeiro_nome: p.cliente_nome.split(" ")[0], cidade: p.end_cidade, uf: p.end_uf,
    itens: itens.map((i) => ({ nome: i.nome, qtd: i.qtd, unitario: i.unitario_centavos / 100, subtotal: (i.unitario_centavos * i.qtd) / 100 })),
    subtotal: p.subtotal_centavos / 100, desconto: p.desconto_centavos / 100, frete: p.frete_centavos / 100, total: p.total_centavos / 100, cupom: p.cupom_codigo,
    rastreio: p.rastreio, rastreio_url: p.rastreio ? `https://melhorrastreio.com.br/rastreio/${encodeURIComponent(p.rastreio)}` : "",
    pagamento_url: espera ? p.pagamento_url : "", expira_em: espera ? p.expira_em : null,
    historico: ev.map((e) => ({ tipo: e.tipo, quando: e.criado_em })),
  };
}
