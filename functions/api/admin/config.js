// Textos e configurações da loja. Cada chave é validada; só as chaves enviadas são alteradas.
import { json, erro, lerJson, ID_IMAGEM } from "../../_lib/util.js";
import { UFS } from "../../_lib/frete.js";
import * as v from "../../_lib/validar.js";
import { todasExistem, limparOrfas } from "../../_lib/imagens.js";

const ICONES = ["mao", "cartao", "caixa", "zap"];


async function imagemOuNulo(db, id, nome) {
  if (!id) return null;
  if (typeof id !== "string" || !ID_IMAGEM.test(id) || !(await todasExistem(db, [id]))) throw new Error(`${nome}: imagem não encontrada. Envie de novo.`);
  return id;
}

const VALIDADORES = {
  loja: (x) => v.texto(x, "Nome da loja", { max: 40, obrigatorio: true }),
  slogan: (x) => v.texto(x, "Frase da loja", { max: 80 }),
  whatsapp: (x) => { const d = String(x ?? "").replace(/\D/g, ""); if (d.length < 12 || d.length > 15) throw new Error("WhatsApp: use o número com código do país e DDD (ex.: 5527999999999)."); return d; },
  instagram: (x) => { const t = String(x ?? "").trim().replace(/^@/, ""); if (!/^[A-Za-z0-9._]{1,30}$/.test(t)) throw new Error("Instagram: informe só o nome de usuário."); return t; },
  email: (x) => { const t = v.texto(x, "E-mail", { max: 120, obrigatorio: true }); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) throw new Error("E-mail inválido."); return t; },
  prazo_postagem_dias_uteis: (x) => v.inteiro(x ?? 0, "Prazo de envio do pedido", 0, 30),
  prazo_producao_dias_uteis: (x) => v.inteiro(x, "Dias a somar ao prazo de transporte", 0, 60),
  frete_regioes: (x) => {
    if (!Array.isArray(x) || x.length > 20) throw new Error("Entrega por região: no máximo 20 regiões.");
    return x.map((r) => {
      const ufs = (Array.isArray(r.ufs) ? r.ufs : []).map((u) => String(u).trim().toUpperCase());
      if (!ufs.length || ufs.some((u) => !UFS.includes(u))) throw new Error(`Região “${r.nome ?? ""}”: informe estados válidos (ex.: ES, RJ, MG).`);
      return { nome: v.texto(r.nome, "Nome da região", { max: 40, obrigatorio: true }), ufs: [...new Set(ufs)], preco: v.decimal(r.preco ?? 0, "Preço da entrega", 0, 500),
               prazo: r.prazo === "" || r.prazo === null || r.prazo === undefined ? null : v.inteiro(r.prazo, "Prazo de transporte (dias úteis)", 0, 60) };
    });
  },
  retirada: (x) => {
    const ativa = !!(x && x.ativa);
    const nome = v.texto(x?.nome, "Nome da retirada", { max: 40 }) || "Retirada no local";
    const endereco = v.texto(x?.endereco, "Endereço da retirada", { max: 200 });
    if (ativa && !endereco) throw new Error("Retirada no local: informe o endereço de retirada.");
    const ceps = (Array.isArray(x?.ceps) ? x.ceps : []).map((c) => String(c).replace(/\D/g, "")).filter(Boolean);
    if (ceps.length > 30 || ceps.some((c) => c.length < 3 || c.length > 8)) throw new Error("CEPs da retirada: informe o começo do CEP, de 3 a 8 números (ex.: 29100). Deixe vazio para valer em qualquer CEP.");
    return { ativa, nome, endereco, instrucoes: v.texto(x?.instrucoes, "Instruções da retirada", { max: 300 }), ceps: [...new Set(ceps)] };
  },
  aviso_loja: (x) => {
    const emails = [...new Set((Array.isArray(x?.emails) ? x.emails : []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
    if (emails.length > 3) throw new Error("Avisos para a loja: no máximo 3 e-mails.");
    for (const e of emails) if (e.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error(`Avisos para a loja: o e-mail “${e}” é inválido.`);
    return { emails, ao_criar: !!x?.ao_criar, ao_pagar: x?.ao_pagar === undefined ? true : !!x.ao_pagar };
  },
  frete_gratis_acima: (x) => v.decimal(x ?? 0, "Frete grátis a partir de", 0, 100000),
  embalagem_padrao: (x) => ({ altura: v.decimal(x?.altura, "Altura da caixa padrão", 1, 105), largura: v.decimal(x?.largura, "Largura da caixa padrão", 1, 105), comprimento: v.decimal(x?.comprimento, "Comprimento da caixa padrão", 1, 105) }),
  frete_provisorio: (x) => v.decimal(x ?? 0, "Frete provisório", 0, 500),
  aviso_prazo: (x) => v.texto(x, "Aviso de prazo", { max: 400 }),
  faixa_avisos: (x) => v.listaDeTextos(x, "Faixa de avisos", 5, 100),
  beneficios: (x) => {
    if (!Array.isArray(x) || x.length > 4) throw new Error("Benefícios: no máximo 4.");
    return x.map((b) => {
      if (!ICONES.includes(b.icone)) throw new Error("Benefícios: ícone inválido.");
      return { icone: b.icone, titulo: v.texto(b.titulo, "Título do benefício", { max: 40, obrigatorio: true }), texto: v.texto(b.texto, "Texto do benefício", { max: 80 }) };
    });
  },
  depoimentos: (x) => {
    if (!Array.isArray(x) || x.length > 12) throw new Error("Depoimentos: no máximo 12.");
    return x.map((d) => ({ nome: v.texto(d.nome, "Nome no depoimento", { max: 40, obrigatorio: true }), texto: v.texto(d.texto, "Depoimento", { max: 400, obrigatorio: true }) }));
  },
};

export async function onRequestGet({ env }) {
  const r = await env.DB.prepare("SELECT chave, valor FROM config").all();
  return json(Object.fromEntries(r.results.map((x) => [x.chave, JSON.parse(x.valor)])));
}

export async function onRequestPut({ request, env }) {
  const corpo = await lerJson(request);
  if (!corpo || typeof corpo !== "object") return erro("Dados inválidos.");
  try {
    const novos = {};
    for (const [k, valor] of Object.entries(corpo)) {
      if (k === "quem_somos") {
        novos[k] = {
          titulo: v.texto(valor.titulo, "Título de Quem somos", { max: 60 }),
          textos: v.listaDeTextos(valor.textos, "Textos de Quem somos", 6, 800),
          imagem_id: await imagemOuNulo(env.DB, valor.imagem_id, "Foto de Quem somos"),
        };
      } else if (k === "logo_id") {
        novos[k] = await imagemOuNulo(env.DB, valor, "Logo");
      } else if (VALIDADORES[k]) {
        novos[k] = VALIDADORES[k](valor);
      } else throw new Error(`Campo desconhecido: ${k}`);
    }
    await env.DB.batch(Object.entries(novos).map(([k, valor]) =>
      env.DB.prepare("INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").bind(k, JSON.stringify(valor))));
    if ("logo_id" in novos || "quem_somos" in novos) await limparOrfas(env.DB);
    return json({ ok: true });
  } catch (e) { return erro(e.message); }
}
