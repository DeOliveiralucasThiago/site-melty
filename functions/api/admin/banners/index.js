import { json, erro, lerJson, ID_IMAGEM } from "../../../_lib/util.js";
import * as v from "../../../_lib/validar.js";
import { todasExistem } from "../../../_lib/imagens.js";

export async function lerBanner(db, c, parcial = false) {
  const o = {};
  if (!parcial || "imagem_id" in c) {
    if (typeof c.imagem_id !== "string" || !ID_IMAGEM.test(c.imagem_id) || !(await todasExistem(db, [c.imagem_id]))) throw new Error("Envie a imagem do banner.");
    o.imagem_id = c.imagem_id;
  }
  if (!parcial || "alt" in c) o.alt = v.texto(c.alt, "Descrição da imagem", { max: 200 });
  if (!parcial || "titulo" in c) o.titulo = v.texto(c.titulo, "Título", { max: 80 });
  if (!parcial || "botao" in c) o.botao = v.texto(c.botao, "Texto do botão", { max: 30 });
  if (!parcial || "link" in c) o.link = v.link(c.link, "Link");
  if (!parcial || "ordem" in c) o.ordem = v.inteiro(c.ordem ?? 0, "Posição", 0, 9999);
  if (!parcial || "ativo" in c) o.ativo = v.bool(c.ativo);
  return o;
}

export async function onRequestGet({ env }) {
  const r = await env.DB.prepare("SELECT * FROM banners ORDER BY ordem, id").all();
  return json(r.results.map((b) => ({ ...b, ativo: !!b.ativo })));
}

export async function onRequestPost({ request, env }) {
  const corpo = await lerJson(request);
  if (!corpo) return erro("Dados inválidos.");
  try {
    const mx = await env.DB.prepare("SELECT COALESCE(MAX(ordem), -1) + 1 AS prox FROM banners").first();
    const o = await lerBanner(env.DB, { ativo: true, ordem: mx.prox, ...corpo });
    const cols = Object.keys(o);
    const r = await env.DB.prepare(`INSERT INTO banners (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...cols.map((c) => o[c])).run();
    return json({ id: r.meta.last_row_id, ...o, ativo: !!o.ativo }, 201);
  } catch (e) { return erro(e.message); }
}
