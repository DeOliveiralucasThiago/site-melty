// Mostra o total com cupom e frete SEM criar pedido (para a tela de fechamento). Mesma regra do pedido real.
import { json, erro, lerJson, limitar, ipDe } from "../../_lib/util.js";
import { calcularPedido, ErroNegocio } from "../../_lib/cupons.js";
import { cotarFrete } from "../../_lib/frete.js";

export async function onRequestPost({ request, env }) {
  if (!(await limitar(env.DB, `sim:${ipDe(request)}`, 40, 3600 * 1000))) return erro("Muitas tentativas. Aguarde um pouco.", 429);
  const corpo = await lerJson(request);
  if (!corpo) return erro("Dados inválidos.");
  try {
    const c = await calcularPedido(env.DB, env, { itens: corpo.itens, cupom: String(corpo.cupom ?? "").slice(0, 20), cpf: corpo.cpf });
    // Frete só entra na conta quando o CEP e a forma de entrega foram escolhidos
    let frete = null, entrega = "";
    const cep = String(corpo.cep ?? "").replace(/\D/g, "");
    if (cep.length === 8) {
      const q = await cotarFrete(env.DB, env, { cep, linhas: c.itens, subtotal_centavos: c.subtotal_centavos });
      const op = corpo.frete_id ? q.opcoes.find((o) => o.id === String(corpo.frete_id)) : (q.opcoes.length === 1 ? q.opcoes[0] : null);
      if (op) { frete = c.frete_gratis ? 0 : op.preco_centavos; entrega = op.servico; }
    }
    return json({
      itens: c.itens.map((l) => ({ id: l.id, nome: l.nome, qtd: l.qtd, unitario: l.unitario / 100, subtotal: l.subtotal / 100, promocao: l.promocao })),
      subtotal: c.subtotal_centavos / 100, desconto: c.desconto_centavos / 100, frete: frete === null ? null : frete / 100, entrega, total: (c.total_centavos + (frete ?? 0)) / 100,
      cupom: c.cupom ? { codigo: c.cupom.codigo, tipo: c.cupom.tipo } : null, frete_gratis: c.frete_gratis,
    });
  } catch (e) {
    if (e instanceof ErroNegocio) return json({ erro: e.message, codigo: e.codigo }, 422);
    console.error("erro ao simular", e);
    return erro("Algo deu errado. Tente novamente.", 500);
  }
}
