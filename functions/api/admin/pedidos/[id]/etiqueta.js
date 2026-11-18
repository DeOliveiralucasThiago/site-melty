// Etiqueta do Melhor Envio para um pedido. acao: "gerar" (gasta saldo da carteira), "rastreio", "imprimir", "cancelar".
import { json, erro, lerJson } from "../../../../_lib/util.js";
import { gerarEtiqueta, buscarRastreio, linkEtiqueta, cancelarEtiqueta, userAgent, ErroME } from "../../../../_lib/melhorenvio.js";
import { detalhe } from "../[id].js";

export async function onRequestPost({ request, env, params }) {
  const id = Number(params.id);
  const corpo = (await lerJson(request)) || {};
  const cfg = Object.fromEntries((await env.DB.prepare("SELECT chave, valor FROM config WHERE chave IN ('melhorenvio','remetente','loja','email')").all()).results.map((r) => [r.chave, JSON.parse(r.valor)]));
  const contato = userAgent(cfg.loja, cfg.email);
  const pedido = await env.DB.prepare("SELECT * FROM pedidos WHERE id = ?").bind(id).first();
  if (!pedido) return erro("Pedido não encontrado.", 404);
  try {
    let extra = {};
    if (corpo.acao === "gerar") extra = await gerarEtiqueta(env, env.DB, id, { contato, cfg });
    else if (corpo.acao === "rastreio") { if (!pedido.me_ordem_id) throw new ErroME("Este pedido não tem etiqueta.", 0); extra = { rastreio: await buscarRastreio(env, env.DB, id, { contato, ordem: pedido.me_ordem_id }) }; }
    else if (corpo.acao === "imprimir") extra = { url: await linkEtiqueta(env, pedido, { contato }) };
    else if (corpo.acao === "cancelar") await cancelarEtiqueta(env, env.DB, pedido, { contato });
    else return erro("Ação inválida.");
    return json({ ...extra, pedido: await detalhe(env.DB, id) });
  } catch (e) {
    if (e instanceof ErroME) return json({ erro: e.message, pedido: await detalhe(env.DB, id) }, e.status === 404 ? 404 : 422);
    console.error("etiqueta", e);
    return erro("Algo deu errado ao falar com o Melhor Envio.", 500);
  }
}
