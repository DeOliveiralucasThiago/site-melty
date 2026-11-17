// Opções de entrega para um CEP. O pacote é montado pelo servidor a partir dos produtos do carrinho.
import { json, erro, lerJson, limitar, ipDe } from "../../_lib/util.js";
import { calcularPedido, ErroNegocio } from "../../_lib/cupons.js";
import { cotarFrete } from "../../_lib/frete.js";

export async function onRequestPost({ request, env }) {
  if (!(await limitar(env.DB, `frete:${ipDe(request)}`, 60, 3600 * 1000))) return erro("Muitas consultas. Aguarde um pouco.", 429);
  const corpo = await lerJson(request);
  if (!corpo) return erro("Dados inválidos.");
  const cep = String(corpo.cep ?? "").replace(/\D/g, "");
  if (cep.length !== 8) return erro("CEP: informe os 8 números.");
  try {
    const c = await calcularPedido(env.DB, env, { itens: corpo.itens });
    const q = await cotarFrete(env.DB, env, { cep, linhas: c.itens, subtotal_centavos: c.subtotal_centavos });
    return json({
      uf: q.uf,
      opcoes: q.opcoes.map((o) => ({ id: o.id, servico: o.servico, transportadora: o.transportadora, preco: o.preco_centavos / 100, prazo_dias_uteis: o.prazo_dias_uteis, gratis: o.gratis })),
    });
  } catch (e) {
    if (e instanceof ErroNegocio) return json({ erro: e.message, codigo: e.codigo }, 422);
    console.error("erro ao cotar frete", e);
    return erro("Não foi possível calcular o frete agora. Tente de novo.", 500);
  }
}
