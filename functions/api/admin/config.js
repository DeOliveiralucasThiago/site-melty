// Textos e configurações da loja. Cada chave é validada; só as chaves enviadas são alteradas.
import { json, erro, lerJson, ID_IMAGEM } from "../../_lib/util.js";
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
  prazo_producao_dias_uteis: (x) => v.inteiro(x, "Dias de produção", 0, 60),
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
