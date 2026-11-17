// Pré-visualização do e-mail exatamente como foi montado. Resposta própria, com política de segurança que bloqueia scripts.
import { erro } from "../../../../_lib/util.js";

export async function onRequestGet({ env, params }) {
  const e = await env.DB.prepare("SELECT html FROM emails WHERE id = ?").bind(Number(params.id)).first();
  if (!e) return erro("E-mail não encontrado.", 404);
  return new Response(e.html, { headers: {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  } });
}
