// Página de texto pública. O texto aceita {{loja}}, {{email}}, {{whatsapp}}, {{aviso_prazo}} e {{envio}} ("em até 2 dias úteis"), trocados pelos dados atuais da loja.
import { json, erro } from "../../_lib/util.js";
import { sanitizarDescricao } from "../../_lib/html.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtZap = (d) => (/^55\d{11}$/.test(d) ? `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}` : d);

export async function paginaPublica(db, slug) {
  const p = await db.prepare("SELECT titulo, conteudo FROM paginas WHERE slug = ? AND publicada = 1").bind(slug).first();
  if (!p) return null;
  const c = Object.fromEntries((await db.prepare("SELECT chave, valor FROM config WHERE chave IN ('loja','email','whatsapp','prazo_producao_dias_uteis','prazo_postagem_dias_uteis','aviso_prazo')").all()).results.map((r) => [r.chave, JSON.parse(r.valor)]));
  const valores = { loja: c.loja, email: c.email, whatsapp: fmtZap(String(c.whatsapp ?? "")), prazo_producao: c.prazo_producao_dias_uteis, aviso_prazo: c.aviso_prazo,
    envio: Number(c.prazo_postagem_dias_uteis) > 0 ? `em até ${Number(c.prazo_postagem_dias_uteis)} dias úteis` : "em breve" };
  const conteudo = sanitizarDescricao(p.conteudo).replace(/\{\{(loja|email|whatsapp|prazo_producao|aviso_prazo|envio)\}\}/g, (_, k) => esc(valores[k]));
  return { titulo: p.titulo, conteudo };
}

export async function onRequestGet({ env, params }) {
  if (!/^[a-z0-9-]{1,60}$/.test(params.slug)) return erro("Página não encontrada.", 404);
  const p = await paginaPublica(env.DB, params.slug);
  return p ? json(p, 200, { "cache-control": "public, max-age=60" }) : erro("Página não encontrada.", 404);
}
