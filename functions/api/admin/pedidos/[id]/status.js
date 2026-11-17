import { json, erro, lerJson } from "../../../../_lib/util.js";
import { mudarStatus } from "../../../../_lib/pedidos.js";
import { ErroNegocio } from "../../../../_lib/cupons.js";
import { detalhe } from "../[id].js";

export async function onRequestPost({ request, env, params }) {
  const corpo = await lerJson(request);
  if (!corpo || typeof corpo.status !== "string") return erro("Dados inválidos.");
  try {
    await mudarStatus(env.DB, Number(params.id), corpo.status, { rastreio: corpo.rastreio });
    return json(await detalhe(env.DB, Number(params.id)));
  } catch (e) {
    if (e instanceof ErroNegocio) return erro(e.message, e.codigo === "pedido" ? 404 : 400);
    throw e;
  }
}
