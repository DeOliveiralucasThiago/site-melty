import { ID_IMAGEM } from "../_lib/util.js";
import { deBase64 } from "../_lib/imagens.js";

export async function onRequestGet({ env, params }) {
  if (!ID_IMAGEM.test(params.id)) return new Response("Não encontrada", { status: 404 });
  const img = await env.DB.prepare("SELECT mime, dados FROM imagens WHERE id = ?").bind(params.id).first();
  if (!img) return new Response("Não encontrada", { status: 404 });
  return new Response(deBase64(img.dados), {
    headers: {
      "content-type": img.mime,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
