// Recebe uma imagem (corpo binário). O painel já reduz a foto antes de enviar.
import { json, erro, novoId } from "../../../_lib/util.js";
import { LIMITE_BYTES, tipoDaImagem, paraBase64 } from "../../../_lib/imagens.js";

export async function onRequestPost({ request, env }) {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return erro("Nenhuma imagem recebida.");
  if (bytes.length > LIMITE_BYTES) return erro("Imagem muito grande (máximo 1 MB). Use uma foto menor.", 413);
  const mime = tipoDaImagem(bytes);
  if (!mime) return erro("Formato não aceito. Use JPG, PNG ou WebP.", 415);
  const id = novoId();
  await env.DB.prepare("INSERT INTO imagens (id, mime, dados, tamanho) VALUES (?, ?, ?, ?)").bind(id, mime, paraBase64(bytes), bytes.length).run();
  return json({ id, url: `/img/${id}` }, 201);
}
