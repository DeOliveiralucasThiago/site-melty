import { json, erro, lerJson, idUnico } from "../../../_lib/util.js";
import * as v from "../../../_lib/validar.js";

export function lerCategoria(c, parcial = false) {
  const o = {};
  if (!parcial || "nome" in c) o.nome = v.texto(c.nome, "Nome", { max: 40, obrigatorio: true });
  if (!parcial || "descricao" in c) o.descricao = v.texto(c.descricao, "Descrição", { max: 200 });
  if (!parcial || "ordem" in c) o.ordem = v.inteiro(c.ordem ?? 0, "Posição", 0, 9999);
  if (!parcial || "ativa" in c) o.ativa = v.bool(c.ativa);
  return o;
}
export const paraPainel = (c) => ({ id: c.id, nome: c.nome, descricao: c.descricao, ordem: c.ordem, ativa: !!c.ativa });

export async function onRequestGet({ env }) {
  const r = await env.DB.prepare(
    "SELECT c.*, (SELECT COUNT(*) FROM produtos p WHERE p.categoria_id = c.id) AS total FROM categorias c ORDER BY ordem, nome").all();
  return json(r.results.map((c) => ({ ...paraPainel(c), total: c.total })));
}

export async function onRequestPost({ request, env }) {
  const corpo = await lerJson(request);
  if (!corpo) return erro("Dados inválidos.");
  try {
    const mx = await env.DB.prepare("SELECT COALESCE(MAX(ordem), -1) + 1 AS prox FROM categorias").first();
    const o = lerCategoria({ ativa: true, ordem: mx.prox, ...corpo });
    const id = await idUnico(env.DB, "categorias", o.nome);
    await env.DB.prepare("INSERT INTO categorias (id, nome, descricao, ordem, ativa) VALUES (?, ?, ?, ?, ?)")
      .bind(id, o.nome, o.descricao, o.ordem, o.ativa).run();
    return json({ ...paraPainel({ id, ...o }), total: 0 }, 201);
  } catch (e) { return erro(e.message); }
}
