// SÓ para desenvolvimento: simula o aviso do provedor (aprovado, recusado...). Fica desligado se PAGAMENTO_PROVEDOR != "teste".
import { json, erro, lerJson } from "../../_lib/util.js";
import { aplicarPagamento } from "../../_lib/pedidos.js";
import { processarFila } from "../../_lib/email.js";

export async function onRequestPost({ request, env, params, waitUntil }) {
  if (env.PAGAMENTO_PROVEDOR !== "teste") return new Response("Não encontrado", { status: 404 });
  if (!/^[a-f0-9]{32}$/.test(params.token)) return erro("Pedido não encontrado.", 404);
  const p = await env.DB.prepare("SELECT * FROM pedidos WHERE token = ?").bind(params.token).first();
  if (!p) return erro("Pedido não encontrado.", 404);
  const corpo = (await lerJson(request)) || {};
  const ev = {
    aprovar: { status: "aprovado", valorCentavos: p.total_centavos, cpfPagador: p.cliente_cpf },
    aprovar_outro_cpf: { status: "aprovado", valorCentavos: p.total_centavos, cpfPagador: "52998224725" },
    aprovar_valor_menor: { status: "aprovado", valorCentavos: Math.max(1, p.total_centavos - 100), cpfPagador: p.cliente_cpf },
    recusar: { status: "recusado" },
    reembolsar: { status: "reembolsado" },
  }[corpo.acao];
  if (!ev) return erro("Ação inválida.");
  const r = await aplicarPagamento(env, params.token, ev);
  waitUntil(processarFila(env).catch((e) => console.error("fila de e-mails", e)));
  return json(r);
}
