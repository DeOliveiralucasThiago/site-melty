import { json, erro, lerJson } from "../../../_lib/util.js";
import * as v from "../../../_lib/validar.js";
import { hojeBrasilia } from "../../../_lib/precos.js";

export async function lerCupom(db, c, { parcial = false } = {}) {
  const o = {};
  if (!parcial || "codigo" in c) {
    const cod = v.texto(c.codigo, "Código", { max: 20, obrigatorio: true }).toUpperCase();
    if (!/^[A-Z0-9_-]{3,20}$/.test(cod)) throw new Error("Código: use de 3 a 20 letras, números, hífen ou _ (sem espaços ou acentos).");
    o.codigo = cod;
  }
  if (!parcial || "tipo" in c) {
    if (!["percentual", "valor", "frete"].includes(c.tipo)) throw new Error("Tipo de desconto inválido.");
    o.tipo = c.tipo;
  }
  if (!parcial || "valor" in c || "tipo" in c) {
    const tipo = o.tipo ?? c.tipo;
    if (tipo === "percentual") o.valor = v.inteiro(c.valor, "Desconto (%)", 1, 100);
    else if (tipo === "valor") o.valor = v.centavos(c.valor, "Valor do desconto");
    else o.valor = 0;
  }
  if (!parcial || "limite_total" in c) {
    const vazio = c.limite_total === undefined || c.limite_total === null || c.limite_total === "";
    o.limite_total = vazio ? null : v.inteiro(c.limite_total, "Limite de usos", 1, 1000000);
  }
  if (!parcial || "valor_minimo" in c) {
    const vazio = c.valor_minimo === undefined || c.valor_minimo === null || c.valor_minimo === "" || Number(c.valor_minimo) === 0;
    o.valor_minimo_centavos = vazio ? 0 : v.centavos(c.valor_minimo, "Valor mínimo");
  }
  if (!parcial || "inicio" in c) o.inicio = v.data(c.inicio, "Início");
  if (!parcial || "fim" in c) o.fim = v.data(c.fim, "Fim");
  if ((o.inicio ?? c.inicio) && (o.fim ?? c.fim) && (o.fim ?? c.fim) < (o.inicio ?? c.inicio)) throw new Error("O fim não pode ser antes do início.");
  for (const [k, col] of [["so_primeira_compra", "so_primeira_compra"], ["acumula_promocao", "acumula_promocao"], ["ativo", "ativo"]]) if (!parcial || k in c) o[col] = v.bool(c[k]);
  if (!parcial || "escopo" in c || "escopo_ids" in c) {
    const escopo = c.escopo ?? "todos";
    if (!["todos", "categorias", "produtos"].includes(escopo)) throw new Error("Escopo inválido.");
    o.escopo = escopo;
    if (escopo === "todos") o.escopo_ids = "[]";
    else {
      const ids = Array.isArray(c.escopo_ids) ? [...new Set(c.escopo_ids.map(String))] : [];
      if (!ids.length || ids.length > 200) throw new Error("Escolha pelo menos uma categoria ou produto para este cupom.");
      const tabela = escopo === "categorias" ? "categorias" : "produtos";
      const { results } = await db.prepare(`SELECT id FROM ${tabela} WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
      if (results.length !== ids.length) throw new Error("Algum item escolhido não existe mais.");
      o.escopo_ids = JSON.stringify(ids);
    }
  }
  return o;
}

export function situacao(c, usosAtivos) {
  if (!c.ativo) return "desativado";
  const hoje = hojeBrasilia();
  if (c.fim && hoje > c.fim) return "expirado";
  if (c.limite_total && usosAtivos >= c.limite_total) return "esgotado";
  if (c.inicio && hoje < c.inicio) return "agendado";
  return "ativo";
}

export function paraPainel(c, usosAtivos = 0, consumidos = 0) {
  return {
    id: c.id, codigo: c.codigo, tipo: c.tipo, valor: c.tipo === "valor" ? c.valor / 100 : c.valor, limite_total: c.limite_total,
    so_primeira_compra: !!c.so_primeira_compra, valor_minimo: c.valor_minimo_centavos ? c.valor_minimo_centavos / 100 : null,
    inicio: c.inicio, fim: c.fim, escopo: c.escopo, escopo_ids: JSON.parse(c.escopo_ids), acumula_promocao: !!c.acumula_promocao, ativo: !!c.ativo,
    usos_ativos: usosAtivos, usos_pagos: consumidos, situacao: situacao(c, usosAtivos),
  };
}

export async function onRequestGet({ env }) {
  await env.DB.prepare("UPDATE cupom_usos SET status = 'liberado' WHERE status = 'reservado' AND expira_em IS NOT NULL AND expira_em < datetime('now')").run();
  const r = await env.DB.prepare(
    `SELECT c.*, 
       (SELECT COUNT(*) FROM cupom_usos u WHERE u.cupom_id = c.id AND u.status IN ('reservado','consumido')) AS ativos,
       (SELECT COUNT(*) FROM cupom_usos u WHERE u.cupom_id = c.id AND u.status = 'consumido') AS pagos
     FROM cupons c ORDER BY c.id DESC`).all();
  return json(r.results.map((c) => paraPainel(c, c.ativos, c.pagos)));
}

export async function onRequestPost({ request, env }) {
  const corpo = await lerJson(request);
  if (!corpo) return erro("Dados inválidos.");
  try {
    const o = await lerCupom(env.DB, { ativo: true, escopo: "todos", ...corpo });
    if (await env.DB.prepare("SELECT 1 FROM cupons WHERE codigo = ?").bind(o.codigo).first()) throw new Error("Já existe um cupom com esse código.");
    const cols = Object.keys(o);
    const r = await env.DB.prepare(`INSERT INTO cupons (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...cols.map((c) => o[c])).run();
    const novo = await env.DB.prepare("SELECT * FROM cupons WHERE id = ?").bind(r.meta.last_row_id).first();
    return json(paraPainel(novo), 201);
  } catch (e) { return erro(e.message); }
}
