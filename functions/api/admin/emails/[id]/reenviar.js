import { json, erro } from "../../../../_lib/util.js";
import { enfileirar, processarFila, emailAtivo } from "../../../../_lib/email.js";

export async function onRequestPost({ env, params }) {
  const e = await env.DB.prepare("SELECT pedido_id, tipo FROM emails WHERE id = ?").bind(Number(params.id)).first();
  if (!e) return erro("E-mail não encontrado.", 404);
  if (!emailAtivo(env)) return erro("O envio de e-mails ainda não está configurado (EMAIL_PROVEDOR).", 503);
  await enfileirar(env.DB, e.pedido_id, e.tipo, { env, forcar: true });
  await processarFila(env);
  const r = await env.DB.prepare("SELECT status, erro FROM emails WHERE id = ?").bind(Number(params.id)).first();
  return json({ status: r.status, erro: r.erro });
}
