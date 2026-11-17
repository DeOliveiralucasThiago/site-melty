import { json } from "../../../_lib/util.js";
import { liberarVencidos, numeroDoPedido, STATUS_TEXTO } from "../../../_lib/pedidos.js";

export async function onRequestGet({ env, request }) {
  await liberarVencidos(env.DB);
  const status = new URL(request.url).searchParams.get("status");
  const filtro = status && STATUS_TEXTO[status] ? "WHERE p.status = ?" : "";
  const stmt = env.DB.prepare(
    `SELECT p.id, p.status, p.cliente_nome, p.total_centavos, p.cupom_codigo, p.rastreio, p.revisao, p.criado_em, p.pago_em,
            (SELECT COALESCE(SUM(qtd), 0) FROM pedido_itens i WHERE i.pedido_id = p.id) AS qtd
     FROM pedidos p ${filtro} ORDER BY p.id DESC LIMIT 200`);
  const r = await (filtro ? stmt.bind(status) : stmt).all();
  return json(r.results.map((p) => ({
    id: p.id, numero: numeroDoPedido(p.id), status: p.status, status_texto: STATUS_TEXTO[p.status], cliente: p.cliente_nome, total: p.total_centavos / 100,
    itens: p.qtd, cupom: p.cupom_codigo, rastreio: p.rastreio, revisao: p.revisao ? p.revisao.split(",") : [], criado_em: p.criado_em, pago_em: p.pago_em,
  })));
}
