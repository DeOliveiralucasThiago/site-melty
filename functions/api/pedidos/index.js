// Cria o pedido (público). O servidor recalcula preços, estoque, cupom e frete; nada do navegador é confiável.
import { json, erro, lerJson, limitar, ipDe } from "../../_lib/util.js";
import { criarPedido } from "../../_lib/pedidos.js";
import { ErroNegocio } from "../../_lib/cupons.js";

export const statusDe = (e) => (e.codigo === "pagamento_inativo" ? 503 : e.codigo === "dados" || e.codigo === "carrinho" ? 400 : 409);

export async function onRequestPost({ request, env }) {
  if (!(await limitar(env.DB, `pedido:${ipDe(request)}`, 10, 3600 * 1000))) return erro("Muitas tentativas. Aguarde um pouco e tente de novo.", 429);
  const corpo = await lerJson(request);
  if (!corpo) return erro("Dados inválidos.");
  try {
    return json(await criarPedido(env, corpo, { urlBase: new URL(request.url).origin }), 201);
  } catch (e) {
    if (e instanceof ErroNegocio) return json({ erro: e.message, codigo: e.codigo }, statusDe(e));
    console.error("erro ao criar pedido", e);
    return erro("Algo deu errado. Tente novamente em instantes.", 500);
  }
}
