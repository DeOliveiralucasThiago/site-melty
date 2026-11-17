// Dados públicos da vitrine (o site lê tudo daqui).
import { json } from "../_lib/util.js";
import { urlImagem } from "../_lib/imagens.js";
import { sanitizarDescricao } from "../_lib/html.js";
import { precoVigente } from "../_lib/precos.js";
import { provedor } from "../_lib/pagamento.js";
import { liberarVencidos } from "../_lib/pedidos.js";

export async function onRequestGet({ env }) {
  const db = env.DB;
  try { await liberarVencidos(db); } catch { /* a vitrine não pode cair por causa disso */ }
  const [cfg, cats, prods, bans] = await Promise.all([
    db.prepare("SELECT chave, valor FROM config").all(),
    db.prepare("SELECT id, nome, descricao FROM categorias WHERE ativa = 1 ORDER BY ordem, nome").all(),
    db.prepare("SELECT * FROM produtos WHERE ativo = 1 ORDER BY ordem, criado_em, nome").all(),
    db.prepare("SELECT * FROM banners WHERE ativo = 1 ORDER BY ordem, id").all(),
  ]);

  const c = Object.fromEntries(cfg.results.map((r) => [r.chave, JSON.parse(r.valor)]));
  const quem = c.quem_somos || {};
  const config = {
    ...c,
    logo: urlImagem(c.logo_id),
    pagamento_ativo: !!provedor(env),
    quem_somos: { titulo: quem.titulo || "", textos: quem.textos || [], imagem: urlImagem(quem.imagem_id) },
  };
  delete config.logo_id;
  delete config.frete_provisorio;

  const produtos = prods.results.map((p) => {
    const imagens = JSON.parse(p.imagens).map(urlImagem);
    const pv = precoVigente(p);
    return {
      id: p.id, nome: p.nome, descricao: sanitizarDescricao(p.descricao), preco: pv.centavos / 100, preco_cheio: pv.promocao ? pv.cheio / 100 : null,
      promocao: pv.promocao, estoque: p.estoque,
      categoria: p.categoria_id, peso_kg: p.peso_kg, novidade: !!p.novidade, destaque: !!p.destaque,
      imagem: imagens[0] || "", imagens,
    };
  });
  const banners = bans.results.map((b) => ({ imagem: urlImagem(b.imagem_id), alt: b.alt, titulo: b.titulo, botao: b.botao, link: b.link }));

  return json({ config, categorias: cats.results, produtos, banners }, 200, { "cache-control": "public, max-age=20" });
}
