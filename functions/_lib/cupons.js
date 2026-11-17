// Motor de preços e cupons. Toda regra é conferida no servidor, na hora de criar o pedido.
// O navegador só informa "quais produtos, quantas unidades e qual cupom"; os valores nunca vêm dele.
import { precoVigente, hojeBrasilia } from "./precos.js";

export class ErroNegocio extends Error {
  constructor(mensagem, codigo) { super(mensagem); this.codigo = codigo; }
}

/* ---------- CPF ---------- */

// Devolve só os 11 dígitos se o CPF for válido (dígitos verificadores corretos); senão null.
export function validarCpf(entrada) {
  const d = String(entrada ?? "").replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return null;
  const dv = (base) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (base.length + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(d.slice(0, 9)) === Number(d[9]) && dv(d.slice(0, 10)) === Number(d[10]) ? d : null;
}

// Código embaralhado com chave secreta (HMAC). Sem a chave não dá para descobrir o CPF a partir do código.
export async function hashDado(env, tipo, valor) {
  if (typeof env.HASH_SECRET !== "string" || env.HASH_SECRET.length < 16) throw new Error("HASH_SECRET não configurado.");
  const enc = new TextEncoder();
  const chave = await crypto.subtle.importKey("raw", enc.encode(env.HASH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const ass = await crypto.subtle.sign("HMAC", chave, enc.encode(`${tipo}:${valor}`));
  return [...new Uint8Array(ass)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- cálculo do pedido ---------- */

const ATIVO = "status IN ('reservado', 'consumido')";

function libera(db, agora) {
  // reservas vencidas (pedido não pago a tempo) voltam a ficar disponíveis
  return db.prepare("UPDATE cupom_usos SET status = 'liberado', atualizado_em = datetime('now') WHERE status = 'reservado' AND expira_em IS NOT NULL AND expira_em < ?")
    .bind(agora.toISOString().slice(0, 19).replace("T", " ")).run();
}

function limparItens(itens) {
  if (!Array.isArray(itens) || !itens.length || itens.length > 50) throw new ErroNegocio("Carrinho vazio ou inválido.", "carrinho");
  const mapa = new Map();
  for (const it of itens) {
    const qtd = Number(it?.qtd);
    if (typeof it?.id !== "string" || !Number.isInteger(qtd) || qtd < 1 || qtd > 99) throw new ErroNegocio("Item do carrinho inválido.", "carrinho");
    mapa.set(it.id, (mapa.get(it.id) || 0) + qtd);
  }
  return [...mapa].map(([id, qtd]) => ({ id, qtd }));
}

/**
 * Calcula o pedido e valida o cupom (sem gravar nada).
 * entrada: { itens: [{id, qtd}], cupom?, cpf? }  (o cupom é controlado só pelo CPF)
 * Lança ErroNegocio com mensagem pronta para o cliente.
 */
export async function calcularPedido(db, env, entrada, { agora = new Date() } = {}) {
  const itens = limparItens(entrada.itens);
  const marcas = itens.map(() => "?").join(",");
  const prods = (await db.prepare(`SELECT * FROM produtos WHERE id IN (${marcas})`).bind(...itens.map((i) => i.id)).all()).results;

  const linhas = itens.map((it) => {
    const p = prods.find((x) => x.id === it.id);
    if (!p || !p.ativo) throw new ErroNegocio("Um dos produtos não está mais disponível.", "produto");
    if (p.estoque < it.qtd) throw new ErroNegocio(p.estoque > 0 ? `Só temos ${p.estoque} unidade(s) de ${p.nome}.` : `${p.nome} está esgotada.`, "estoque");
    const preco = precoVigente(p, agora);
    return { id: p.id, nome: p.nome, categoria: p.categoria_id, qtd: it.qtd, unitario: preco.centavos, cheio: preco.cheio, promocao: preco.promocao,
             subtotal: preco.centavos * it.qtd, peso_kg: p.peso_kg };
  });
  const subtotal = linhas.reduce((s, l) => s + l.subtotal, 0);
  const resultado = { itens: linhas, subtotal_centavos: subtotal, desconto_centavos: 0, frete_gratis: false, cupom: null };

  const codigo = String(entrada.cupom ?? "").trim().toUpperCase();
  if (!codigo) { resultado.total_centavos = subtotal; return resultado; }

  await libera(db, agora);
  const c = await db.prepare("SELECT * FROM cupons WHERE codigo = ?").bind(codigo).first();
  if (!c || !c.ativo) throw new ErroNegocio("Cupom inválido.", "cupom");
  const hoje = hojeBrasilia(agora);
  if (c.inicio && hoje < c.inicio) throw new ErroNegocio("Este cupom ainda não começou.", "cupom_inicio");
  if (c.fim && hoje > c.fim) throw new ErroNegocio("Este cupom expirou.", "cupom_expirado");

  if (c.limite_total) {
    const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM cupom_usos WHERE cupom_id = ? AND ${ATIVO}`).bind(c.id).first();
    if (n >= c.limite_total) throw new ErroNegocio("Este cupom esgotou.", "cupom_esgotado");
  }

  const cpf = validarCpf(entrada.cpf);
  if (!cpf) throw new ErroNegocio("Informe um CPF válido para usar o cupom.", "cpf");
  const cpfHash = await hashDado(env, "cpf", cpf);

  if (await db.prepare(`SELECT 1 FROM cupom_usos WHERE cupom_id = ? AND cpf_hash = ? AND ${ATIVO}`).bind(c.id, cpfHash).first())
    throw new ErroNegocio("Este cupom já foi usado neste CPF.", "cpf_ja_usou");

  // Primeira compra: este CPF nunca pagou um pedido antes
  if (c.so_primeira_compra && await db.prepare("SELECT 1 FROM compradores WHERE cpf_hash = ? LIMIT 1").bind(cpfHash).first())
    throw new ErroNegocio("Este cupom é válido apenas para a primeira compra.", "primeira_compra");

  // Quais itens o cupom alcança: dentro do escopo e (se não acumula) fora de promoção
  const ids = JSON.parse(c.escopo_ids);
  const base = linhas.filter((l) => {
    if (l.promocao && !c.acumula_promocao) return false;
    if (c.escopo === "categorias") return ids.includes(l.categoria);
    if (c.escopo === "produtos") return ids.includes(l.id);
    return true;
  }).reduce((s, l) => s + l.subtotal, 0);

  if (c.tipo !== "frete" && base === 0) throw new ErroNegocio("Este cupom não vale para os itens do carrinho (itens em promoção não somam com cupom).", "cupom_escopo");
  if (base < c.valor_minimo_centavos) throw new ErroNegocio(`Este cupom exige um mínimo de R$ ${(c.valor_minimo_centavos / 100).toFixed(2).replace(".", ",")} em produtos elegíveis.`, "cupom_minimo");

  let desconto = 0;
  if (c.tipo === "percentual") desconto = Math.floor((base * c.valor) / 100);
  else if (c.tipo === "valor") desconto = Math.min(c.valor, base);
  resultado.desconto_centavos = desconto;
  resultado.frete_gratis = c.tipo === "frete";
  resultado.total_centavos = subtotal - desconto;
  resultado.cupom = { id: c.id, codigo: c.codigo, tipo: c.tipo };
  return resultado;
}

/* ---------- reserva, confirmação e liberação ---------- */

/**
 * Reserva o cupom para um pedido, de forma atômica: confere o limite e grava no mesmo comando,
 * e o banco impede um segundo uso do mesmo CPF. Chamar logo após calcularPedido, ao criar o pedido.
 */
export async function reservarCupom(db, env, { cupomId, cpf, pedidoRef, descontoCentavos, minutos = 30 }, agora = new Date()) {
  const cpfValido = validarCpf(cpf);
  if (!cpfValido) throw new ErroNegocio("CPF inválido.", "cpf");
  const cpfHash = await hashDado(env, "cpf", cpfValido);
  await libera(db, agora);
  const expira = new Date(agora.getTime() + minutos * 60000).toISOString().slice(0, 19).replace("T", " ");
  try {
    const r = await db.prepare(
      `INSERT INTO cupom_usos (cupom_id, cpf_hash, pedido_ref, status, desconto_centavos, expira_em)
       SELECT ?, ?, ?, 'reservado', ?, ?
       WHERE (SELECT COUNT(*) FROM cupom_usos WHERE cupom_id = ? AND ${ATIVO}) < COALESCE((SELECT limite_total FROM cupons WHERE id = ?), 1000000000)`)
      .bind(cupomId, cpfHash, pedidoRef, descontoCentavos, expira, cupomId, cupomId).run();
    if (!r.meta.changes) throw new ErroNegocio("Este cupom esgotou.", "cupom_esgotado");
  } catch (err) {
    if (err instanceof ErroNegocio) throw err;
    if (/idx_uso_cpf|cpf_hash/.test(String(err.message))) throw new ErroNegocio("Este cupom já foi usado neste CPF.", "cpf_ja_usou");
    throw err;
  }
}

// Pagamento confirmado: o uso passa a definitivo e o CPF entra no registro de "já comprou"
export async function confirmarUso(db, env, { pedidoRef, cpf }) {
  await db.prepare("UPDATE cupom_usos SET status = 'consumido', expira_em = NULL, atualizado_em = datetime('now') WHERE pedido_ref = ? AND status = 'reservado'").bind(pedidoRef).run();
  await registrarCompra(db, env, { pedidoRef, cpf });
}

// Pedido cancelado ou vencido: o cupom volta a ficar disponível
export async function liberarUso(db, pedidoRef) {
  await db.prepare("UPDATE cupom_usos SET status = 'liberado', atualizado_em = datetime('now') WHERE pedido_ref = ? AND status = 'reservado'").bind(pedidoRef).run();
}

export async function registrarCompra(db, env, { pedidoRef, cpf }) {
  const c = validarCpf(cpf);
  if (!c) return;
  await db.prepare("INSERT INTO compradores (cpf_hash, pedido_ref) VALUES (?, ?)").bind(await hashDado(env, "cpf", c), pedidoRef).run();
}
