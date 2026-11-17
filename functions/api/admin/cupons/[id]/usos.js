// Histórico de usos de um cupom. Mostra só data, situação, pedido e valor (nunca CPF ou e-mail).
import { json } from "../../../../_lib/util.js";

export async function onRequestGet({ env, params }) {
  const r = await env.DB.prepare(
    "SELECT status, pedido_ref, desconto_centavos, reservado_em, atualizado_em FROM cupom_usos WHERE cupom_id = ? ORDER BY id DESC LIMIT 200").bind(params.id).all();
  return json(r.results.map((u) => ({ situacao: u.status, pedido: u.pedido_ref, desconto: u.desconto_centavos / 100, quando: u.reservado_em, atualizado: u.atualizado_em })));
}
