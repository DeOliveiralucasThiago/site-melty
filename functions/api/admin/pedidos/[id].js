import { json, erro } from "../../../_lib/util.js";
import { numeroDoPedido, STATUS_TEXTO, REVISAO_TEXTO } from "../../../_lib/pedidos.js";

export async function detalhe(db, id) {
  const p = await db.prepare("SELECT * FROM pedidos WHERE id = ?").bind(id).first();
  if (!p) return null;
  const itens = (await db.prepare("SELECT produto_id, nome, qtd, unitario_centavos, cheio_centavos, promocao FROM pedido_itens WHERE pedido_id = ? ORDER BY id").bind(id).all()).results;
  const eventos = (await db.prepare("SELECT tipo, detalhe, criado_em FROM pedido_eventos WHERE pedido_id = ? ORDER BY id").bind(id).all()).results;
  const emails = (await db.prepare("SELECT id, tipo, para, assunto, status, tentativas, erro, enviado_em, atualizado_em FROM emails WHERE pedido_id = ? ORDER BY id").bind(id).all()).results;
  const codigos = p.revisao ? p.revisao.split(",") : [];
  return {
    id: p.id, numero: numeroDoPedido(p.id), token: p.token, status: p.status, status_texto: STATUS_TEXTO[p.status],
    cliente: { nome: p.cliente_nome, email: p.cliente_email, telefone: p.cliente_telefone, cpf: p.cliente_cpf },
    endereco: { cep: p.end_cep, rua: p.end_rua, numero: p.end_numero, complemento: p.end_complemento, bairro: p.end_bairro, cidade: p.end_cidade, uf: p.end_uf },
    itens: itens.map((i) => ({ produto: i.produto_id, nome: i.nome, qtd: i.qtd, unitario: i.unitario_centavos / 100, cheio: i.cheio_centavos / 100, promocao: !!i.promocao })),
    subtotal: p.subtotal_centavos / 100, desconto: p.desconto_centavos / 100, frete: p.frete_centavos / 100, total: p.total_centavos / 100,
    cupom: p.cupom_codigo, entrega: p.frete_servico, prazo_transporte_dias: p.frete_prazo_dias, rastreio: p.rastreio, provedor: p.provedor, pagamento_ref: p.pagamento_ref,
    revisao: codigos.map((c) => ({ codigo: c, texto: REVISAO_TEXTO[c] || c })),
    criado_em: p.criado_em, pago_em: p.pago_em, enviado_em: p.enviado_em, entregue_em: p.entregue_em, expira_em: p.expira_em,
    emails: emails.map((e) => ({ id: e.id, tipo: e.tipo, para: e.para, assunto: e.assunto, status: e.status, tentativas: e.tentativas, erro: e.erro, quando: e.enviado_em || e.atualizado_em })),
    eventos: eventos.map((e) => ({ tipo: e.tipo, detalhe: e.detalhe, quando: e.criado_em })),
  };
}

export async function onRequestGet({ env, params }) {
  const d = await detalhe(env.DB, params.id);
  return d ? json(d) : erro("Pedido não encontrado.", 404);
}
