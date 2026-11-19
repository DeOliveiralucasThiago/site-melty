// Provedor de pagamento. A loja fala com UM "provedor" por esta interface, então trocar ou acrescentar
// (Mercado Pago, InfinitePay...) não mexe em pedido, estoque, cupom nem painel.
//
//   criarCobranca({ pedido, itens, cliente, urlBase }) -> { url, ref }   (url para onde o cliente vai pagar)
//   Quando o provedor avisar que pagou, chamar aplicarPagamento() (functions/_lib/pedidos.js).
//
// PAGAMENTO_PROVEDOR:
//   "teste"        -> pagamento simulado, só para desenvolvimento (NUNCA usar em produção)
//   "mercadopago"  -> Mercado Pago (API de Orders). Exige o segredo MERCADOPAGO_ACCESS_TOKEN. O cliente paga na página /pagar do próprio site.

const provedorTeste = {
  nome: "teste",
  async criarCobranca({ pedido, urlBase }) {
    return { url: `${urlBase}/pagamento-teste.html?t=${pedido.token}`, ref: `teste-${pedido.token}` };
  },
};

const provedorMercadoPago = {
  nome: "mercadopago",
  async criarCobranca({ pedido, urlBase }) {
    return { url: `${urlBase}/pagar?t=${pedido.token}`, ref: "" };    // a order só é criada quando o cliente escolhe a forma de pagar
  },
};

export function provedor(env) {
  if (env.PAGAMENTO_PROVEDOR === "teste") return provedorTeste;
  if (env.PAGAMENTO_PROVEDOR === "mercadopago" && env.MERCADOPAGO_ACCESS_TOKEN) return provedorMercadoPago;
  return null;
}
