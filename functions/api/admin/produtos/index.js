import { json, erro, lerJson, idUnico } from "../../../_lib/util.js";
import * as v from "../../../_lib/validar.js";
import { todasExistem } from "../../../_lib/imagens.js";
import { sanitizarDescricao } from "../../../_lib/html.js";
import { promocaoVigente } from "../../../_lib/precos.js";

export async function lerProduto(db, c, { parcial = false, existente = null } = {}) {
  const o = {};
  if (!parcial || "nome" in c) o.nome = v.texto(c.nome, "Nome", { max: 80, obrigatorio: true });
  if (!parcial || "descricao" in c) {
    const limpa = sanitizarDescricao(v.texto(c.descricao, "Descrição", { max: 20000 }));
    if (limpa.length > 6000) throw new Error("Descrição: texto longo demais. Reduza um pouco.");
    o.descricao = limpa;
  }
  if (!parcial || "preco" in c) o.preco_centavos = v.centavos(c.preco, "Preço");
  if (!parcial || "estoque" in c) o.estoque = v.inteiro(c.estoque, "Estoque", 0, 9999);
  if (!parcial || "peso_kg" in c) o.peso_kg = v.decimal(c.peso_kg ?? 0.42, "Peso (kg)", 0.01, 30);
  if (!parcial || "ordem" in c) o.ordem = v.inteiro(c.ordem ?? 0, "Posição", 0, 9999);
  if (!parcial || "preco_promo" in c || "promo_inicio" in c || "promo_fim" in c) {
    const vazio = c.preco_promo === undefined || c.preco_promo === null || c.preco_promo === "";
    if (vazio) { o.preco_promo_centavos = null; o.promo_inicio = null; o.promo_fim = null; }
    else {
      o.preco_promo_centavos = v.centavos(c.preco_promo, "Preço promocional");
      o.promo_inicio = v.data(c.promo_inicio, "Início da promoção");
      o.promo_fim = v.data(c.promo_fim, "Fim da promoção");
      if (o.promo_inicio && o.promo_fim && o.promo_fim < o.promo_inicio) throw new Error("Promoção: o fim não pode ser antes do início.");
      const cheio = o.preco_centavos ?? existente?.preco_centavos;
      if (cheio !== undefined && o.preco_promo_centavos >= cheio) throw new Error("Preço promocional: precisa ser menor que o preço normal.");
    }
  }
  if (!parcial || "altura_cm" in c || "largura_cm" in c || "comprimento_cm" in c) {
    const dims = ["altura_cm", "largura_cm", "comprimento_cm"].map((k) => (c[k] === undefined || c[k] === null || c[k] === "" ? null : v.decimal(c[k], "Medida (cm)", 1, 105)));
    if (dims.some((x) => x === null) && dims.some((x) => x !== null)) throw new Error("Medidas: preencha altura, largura e comprimento (ou deixe as três vazias para usar a caixa padrão).");
    [o.altura_cm, o.largura_cm, o.comprimento_cm] = dims;
  }
  for (const k of ["novidade", "destaque", "ativo"]) if (!parcial || k in c) o[k] = v.bool(c[k]);
  if (!parcial || "categoria" in c) {
    if (c.categoria) {
      if (!(await db.prepare("SELECT 1 FROM categorias WHERE id = ?").bind(String(c.categoria)).first())) throw new Error("Categoria inválida.");
      o.categoria_id = String(c.categoria);
    } else o.categoria_id = null;
  }
  if (!parcial || "imagens" in c) {
    if (!Array.isArray(c.imagens) || c.imagens.length > 8) throw new Error("Imagens: no máximo 8 fotos por produto.");
    if (!(await todasExistem(db, c.imagens))) throw new Error("Imagens: alguma foto não foi encontrada. Envie de novo.");
    o.imagens = JSON.stringify(c.imagens);
  }
  return o;
}

export function paraPainel(p) {
  return { id: p.id, nome: p.nome, descricao: sanitizarDescricao(p.descricao), preco: p.preco_centavos / 100, estoque: p.estoque, categoria: p.categoria_id,
    peso_kg: p.peso_kg, altura_cm: p.altura_cm, largura_cm: p.largura_cm, comprimento_cm: p.comprimento_cm, preco_promo: p.preco_promo_centavos ? p.preco_promo_centavos / 100 : null, promo_inicio: p.promo_inicio, promo_fim: p.promo_fim,
    promocao_vigente: promocaoVigente(p), imagens: JSON.parse(p.imagens), novidade: !!p.novidade, destaque: !!p.destaque, ativo: !!p.ativo, ordem: p.ordem };
}

export async function onRequestGet({ env }) {
  const r = await env.DB.prepare("SELECT * FROM produtos ORDER BY ordem, criado_em, nome").all();
  return json(r.results.map(paraPainel));
}

export async function onRequestPost({ request, env }) {
  const corpo = await lerJson(request);
  if (!corpo) return erro("Dados inválidos.");
  try {
    const o = await lerProduto(env.DB, { ativo: true, imagens: [], ...corpo });
    const id = await idUnico(env.DB, "produtos", o.nome);
    const cols = Object.keys(o);
    await env.DB.prepare(`INSERT INTO produtos (id, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})`)
      .bind(id, ...cols.map((c) => o[c])).run();
    const p = await env.DB.prepare("SELECT * FROM produtos WHERE id = ?").bind(id).first();
    return json(paraPainel(p), 201);
  } catch (e) { return erro(e.message); }
}
