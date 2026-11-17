// Cópia de segurança dos dados em um arquivo JSON. Contém dados pessoais de clientes: guarde em local seguro.
// ?imagens=1 inclui as imagens (arquivo bem maior). Não inclui senhas, limites de acesso nem o conteúdo dos e-mails.
import { json } from "../../_lib/util.js";

const TABELAS = ["config", "categorias", "produtos", "banners", "paginas", "cupons", "pedidos", "pedido_itens", "pedido_eventos", "cupom_usos", "compradores"];

export async function onRequestGet({ env, request }) {
  const comImagens = new URL(request.url).searchParams.get("imagens") === "1";
  const dados = {};
  for (const t of TABELAS) dados[t] = (await env.DB.prepare(`SELECT * FROM ${t}`).all()).results;
  dados.emails = (await env.DB.prepare("SELECT id, pedido_id, tipo, para, assunto, status, tentativas, erro, criado_em, enviado_em FROM emails").all()).results;
  dados.imagens = comImagens
    ? (await env.DB.prepare("SELECT * FROM imagens").all()).results
    : (await env.DB.prepare("SELECT id, mime, tamanho, criado_em FROM imagens").all()).results;
  const corpo = JSON.stringify({ sistema: "loja-melty", versao_do_formato: 1, gerado_em: new Date().toISOString(), imagens_incluidas: comImagens, tabelas: dados });
  return new Response(corpo, { headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "content-disposition": `attachment; filename="backup-melty-${new Date().toISOString().slice(0, 10)}${comImagens ? "-com-imagens" : ""}.json"`, "x-content-type-options": "nosniff",
  } });
}
