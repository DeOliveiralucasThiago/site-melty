// Gera seed/seed.sql a partir de seed/data/*.json e da imagem do banner provisório.
// Uso: npm run db:seed-gerar
import { readFileSync, writeFileSync } from "node:fs";

const lerJson = (f) => JSON.parse(readFileSync(new URL(`../seed/data/${f}`, import.meta.url), "utf8"));
const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const cfg = lerJson("config.json");
const produtos = lerJson("produtos.json");
const categorias = lerJson("categorias.json");
const banners = lerJson("banners.json");
const paginas = lerJson("paginas.json");

const BANNER_ID = "a1b2c3d4e5f60718293a4b5c";
const bannerB64 = readFileSync(new URL("../seed/banner-1.webp", import.meta.url)).toString("base64");

const sql = [];
sql.push("-- Gerado por scripts/gerar-seed.mjs. Não edite à mão.");
categorias.forEach((c, i) =>
  sql.push(`INSERT INTO categorias (id, nome, descricao, ordem) VALUES (${q(c.id)}, ${q(c.nome)}, ${q(c.descricao || "")}, ${i});`));
produtos.forEach((p, i) =>
  sql.push(`INSERT INTO produtos (id, nome, descricao, preco_centavos, estoque, categoria_id, peso_kg, imagens, novidade, destaque, ordem) VALUES (${q(p.id)}, ${q(p.nome)}, ${q(p.descricao)}, ${Math.round(p.preco * 100)}, ${p.estoque}, ${q(p.categoria)}, ${p.peso_kg}, '[]', ${p.novidade ? 1 : 0}, ${p.destaque ? 1 : 0}, ${i});`));
// O D1 limita cada instrução SQL a ~100 KB, então a imagem entra em pedaços.
const PEDACO = 40000;
sql.push(`INSERT INTO imagens (id, mime, dados, tamanho) VALUES (${q(BANNER_ID)}, 'image/webp', '', ${Buffer.from(bannerB64, "base64").length});`);
for (let i = 0; i < bannerB64.length; i += PEDACO)
  sql.push(`UPDATE imagens SET dados = dados || ${q(bannerB64.slice(i, i + PEDACO))} WHERE id = ${q(BANNER_ID)};`);
banners.forEach((b, i) =>
  sql.push(`INSERT INTO banners (imagem_id, alt, titulo, botao, link, ordem) VALUES (${q(BANNER_ID)}, ${q(b.alt || "")}, ${q(b.titulo || "")}, ${q(b.botao || "")}, ${q(b.link || "")}, ${i});`));

paginas.forEach((p) => sql.push(`INSERT INTO paginas (slug, titulo, conteudo) VALUES (${q(p.slug)}, ${q(p.titulo)}, ${q(p.conteudo)});`));

const config = {
  loja: cfg.loja, slogan: cfg.slogan, whatsapp: cfg.whatsapp, instagram: cfg.instagram, email: cfg.email,
  frete_provisorio: 0, prazo_producao_dias_uteis: cfg.prazo_producao_dias_uteis, prazo_postagem_dias_uteis: cfg.prazo_postagem_dias_uteis, retirada: cfg.retirada, aviso_loja: cfg.aviso_loja, aviso_prazo: cfg.aviso_prazo,
  faixa_avisos: cfg.faixa_avisos, beneficios: cfg.beneficios,
  quem_somos: { titulo: cfg.quem_somos.titulo, textos: cfg.quem_somos.textos, imagem_id: null },
  depoimentos: cfg.depoimentos, logo_id: null,
};
for (const [k, v] of Object.entries(config))
  sql.push(`INSERT INTO config (chave, valor) VALUES (${q(k)}, ${q(JSON.stringify(v))});`);

writeFileSync(new URL("../seed/seed.sql", import.meta.url), sql.join("\n") + "\n");
console.log(`seed.sql gerado: ${categorias.length} categorias, ${produtos.length} produtos, ${banners.length} banners`);
