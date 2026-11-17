// Fila de e-mails (padrão "caixa de saída"): os eventos do pedido só gravam o e-mail no banco;
// o envio acontece depois, com nova tentativa se falhar. Assim uma falha de e-mail nunca derruba o pedido.
import { numeroDoPedido } from "./util.js";
import { montarEmail } from "./emails-modelos.js";

const agoraSql = (d = new Date()) => d.toISOString().slice(0, 19).replace("T", " ");
const MAX_TENTATIVAS = 5;

/* ---------- provedores ----------
   EMAIL_PROVEDOR:
     "teste"  -> não envia de verdade: marca como "simulado" (para desenvolvimento)
     "resend" -> Resend (https://resend.com). Precisa de RESEND_API_KEY e EMAIL_REMETENTE (domínio verificado).
                 Escrito conforme a documentação pública; AINDA NÃO testado com chave real. */
function provedorEmail(env) {
  if (env.EMAIL_PROVEDOR === "teste") return { nome: "teste", async enviar() { return { id: "teste" }; } };
  if (env.EMAIL_PROVEDOR === "resend" && env.RESEND_API_KEY && env.EMAIL_REMETENTE) {
    return {
      nome: "resend",
      async enviar({ para, assunto, html, texto, responderPara, chave }) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        try {
          const r = await fetch("https://api.resend.com/emails", {
            method: "POST", signal: ctrl.signal,
            headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": chave, "User-Agent": "melty-loja/1.0" },
            body: JSON.stringify({ from: env.EMAIL_REMETENTE, to: [para], subject: assunto, html, text: texto, ...(responderPara ? { reply_to: responderPara } : {}) }),
          });
          const corpo = await r.text();
          if (!r.ok) throw new Error(`Resend ${r.status}: ${corpo.slice(0, 200)}`);
          let id = ""; try { id = JSON.parse(corpo).id || ""; } catch { /* sem id */ }
          return { id };
        } finally { clearTimeout(timer); }
      },
    };
  }
  return null;
}
export const emailAtivo = (env) => !!provedorEmail(env);

/* ---------- montar e enfileirar ---------- */
async function contexto(db, env, pedidoId) {
  const p = await db.prepare("SELECT * FROM pedidos WHERE id = ?").bind(pedidoId).first();
  if (!p) return null;
  const itens = (await db.prepare("SELECT nome, qtd, unitario_centavos FROM pedido_itens WHERE pedido_id = ? ORDER BY id").bind(pedidoId).all()).results;
  const cfg = Object.fromEntries((await db.prepare("SELECT chave, valor FROM config WHERE chave IN ('loja','whatsapp','email','prazo_producao_dias_uteis','prazo_postagem_dias_uteis','aviso_prazo','retirada','aviso_loja')").all()).results.map((r) => [r.chave, JSON.parse(r.valor)]));
  const urlBase = (env?.SITE_URL || p.url_base || "").replace(/\/+$/, "");
  return { pedido: { ...p, numero: numeroDoPedido(p.id) }, itens, config: { loja: cfg.loja || "Melty", whatsapp: cfg.whatsapp || "", email: cfg.email || "", prazo: cfg.prazo_producao_dias_uteis, envio_dias: Number(cfg.prazo_postagem_dias_uteis) || 0, retirada: cfg.retirada || null, aviso_prazo: cfg.aviso_prazo || "" }, avisoLoja: cfg.aviso_loja || null, urlBase };
}

/** Grava o e-mail na fila. Cada tipo sai uma vez por pedido; com forcar=true, regrava e reenvia. */
export async function enfileirar(db, pedidoId, tipo, { env, forcar = false, para, responderPara = "" } = {}) {
  const ctx = await contexto(db, env, pedidoId);
  if (!ctx) return false;
  const destino = para || ctx.pedido.cliente_email;
  const m = montarEmail(tipo, ctx);
  const r = await db.prepare("INSERT OR IGNORE INTO emails (pedido_id, tipo, para, responder_para, assunto, html, texto) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(pedidoId, tipo, destino, responderPara, m.assunto, m.html, m.texto).run();
  if (!r.meta.changes && forcar) {
    await db.prepare("UPDATE emails SET assunto = ?, html = ?, texto = ?, status = 'pendente', tentativas = 0, versao = versao + 1, erro = '', atualizado_em = datetime('now') WHERE pedido_id = ? AND tipo = ? AND para = ?")
      .bind(m.assunto, m.html, m.texto, pedidoId, tipo, destino).run();
    return true;
  }
  return !!r.meta.changes;
}

/** Avisa a loja (os e-mails configurados no painel) que há um pedido novo. quando: "criado" (ainda sem pagamento) ou "pago". */
export async function enfileirarAvisoLoja(db, pedidoId, quando, { env } = {}) {
  const ctx = await contexto(db, env, pedidoId);
  const a = ctx && ctx.avisoLoja;
  if (!a || !Array.isArray(a.emails) || !a.emails.length) return 0;
  if ((quando === "criado" && !a.ao_criar) || (quando === "pago" && !a.ao_pagar)) return 0;
  let n = 0;
  for (const para of a.emails) if (await enfileirar(db, pedidoId, quando === "criado" ? "loja_novo" : "loja_pago", { env, para, responderPara: ctx.pedido.cliente_email })) n++;
  return n;
}

/* ---------- enviar ---------- */
export async function processarFila(env, { enviar } = {}) {
  const db = env.DB;
  const prov = enviar ? { nome: "teste", enviar } : provedorEmail(env);
  if (!prov) return { enviados: 0, falhas: 0 };

  await db.prepare("UPDATE emails SET status = 'descartado', atualizado_em = datetime('now') WHERE status IN ('pendente','falhou') AND atualizado_em < ?")
    .bind(agoraSql(new Date(Date.now() - 24 * 3600 * 1000))).run();   // e-mail velho demais não faz mais sentido enviar

  const espera = agoraSql(new Date(Date.now() - 5 * 60000));
  const elegivel = `(status = 'pendente' OR (status IN ('falhou','enviando') AND tentativas < ${MAX_TENTATIVAS} AND atualizado_em < '${espera}'))`;
  const fila = (await db.prepare(`SELECT id FROM emails WHERE ${elegivel} ORDER BY id LIMIT 10`).all()).results;
  let enviados = 0, falhas = 0;
  const responderPara = (await db.prepare("SELECT valor FROM config WHERE chave = 'email'").first());
  const reply = responderPara ? JSON.parse(responderPara.valor) : "";

  for (const { id } of fila) {
    // "Reserva" a linha: se dois processos tentarem ao mesmo tempo, só um envia
    const r = await db.prepare(`UPDATE emails SET status = 'enviando', tentativas = tentativas + 1, atualizado_em = datetime('now') WHERE id = ? AND ${elegivel}`).bind(id).run();
    if (!r.meta.changes) continue;
    const e = await db.prepare("SELECT * FROM emails WHERE id = ?").bind(id).first();
    try {
      const out = await prov.enviar({ para: e.para, assunto: e.assunto, html: e.html, texto: e.texto, responderPara: e.responder_para || reply, chave: `melty-email-${e.id}-v${e.versao}` });
      await db.prepare("UPDATE emails SET status = ?, enviado_em = datetime('now'), atualizado_em = datetime('now'), provedor = ?, provedor_ref = ?, erro = '' WHERE id = ?")
        .bind(prov.nome === "teste" ? "simulado" : "enviado", prov.nome, out?.id ?? "", id).run();
      enviados++;
    } catch (err) {
      await db.prepare("UPDATE emails SET status = 'falhou', atualizado_em = datetime('now'), erro = ? WHERE id = ?").bind(String(err.message).slice(0, 300), id).run();
      falhas++;
    }
  }
  return { enviados, falhas };
}
