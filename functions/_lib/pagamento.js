// Provedor de pagamento. A loja fala com UM "provedor" por esta interface, então trocar ou acrescentar
// (Mercado Pago, InfinitePay...) não mexe em pedido, estoque, cupom nem painel.
//
//   criarCobranca({ pedido, itens, cliente, urlBase }) -> { url, ref }   (url para onde o cliente vai pagar)
//   Quando o provedor avisar que pagou, chamar aplicarPagamento() (functions/_lib/pedidos.js).
//
// PAGAMENTO_PROVEDOR:
//   "teste"        -> pagamento simulado, só para desenvolvimento (NUNCA usar em produção)
//   "mercadopago"  -> ainda NÃO implementado: falta validar a documentação oficial (assinatura do aviso, formato do pagamento)
//                     com credenciais de teste. Enquanto isso, o pagamento online fica desativado.

const provedorTeste = {
  nome: "teste",
  async criarCobranca({ pedido, urlBase }) {
    return { url: `${urlBase}/pagamento-teste.html?t=${pedido.token}`, ref: `teste-${pedido.token}` };
  },
};

export function provedor(env) {
  if (env.PAGAMENTO_PROVEDOR === "teste") return provedorTeste;
  return null;
}
