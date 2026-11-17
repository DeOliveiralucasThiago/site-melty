// Planilha de pedidos (CSV para Excel/Google Planilhas, separador ";", com acentos). Só para quem está logado no painel.
import { numeroDoPedido, STATUS_TEXTO } from "../../../_lib/pedidos.js";

const cel = (v) => {
  let t = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;          // evita que a planilha execute o texto como fórmula
  return /[";\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};
const dinheiro = (c) => (c / 100).toFixed(2).replace(".", ",");
const quando = (sql) => (sql ? new Date(sql.replace(" ", "T") + "Z").toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export async function onRequestGet({ env, request }) {
  const status = new URL(request.url).searchParams.get("status");
  const filtro = status && STATUS_TEXTO[status] ? "WHERE p.status = ?" : "";
  const stmt = env.DB.prepare(
    `SELECT p.*, (SELECT GROUP_CONCAT(i.qtd || 'x ' || i.nome, ' | ') FROM pedido_itens i WHERE i.pedido_id = p.id) AS itens
     FROM pedidos p ${filtro} ORDER BY p.id`);
  const rows = (await (filtro ? stmt.bind(status) : stmt).all()).results;
  const cab = ["Pedido", "Data", "Situação", "Nome", "E-mail", "Telefone", "CPF", "CEP", "Endereço", "Cidade", "UF", "Itens", "Subtotal", "Desconto", "Frete", "Total", "Cupom", "Entrega", "Rastreio", "Pago em", "Enviado em", "Entregue em"];
  const linhas = rows.map((p) => [
    numeroDoPedido(p.id), quando(p.criado_em), STATUS_TEXTO[p.status], p.cliente_nome, p.cliente_email, p.cliente_telefone, p.cliente_cpf, p.end_cep,
    `${p.end_rua}, ${p.end_numero}${p.end_complemento ? " - " + p.end_complemento : ""} - ${p.end_bairro}`, p.end_cidade, p.end_uf, p.itens,
    dinheiro(p.subtotal_centavos), dinheiro(p.desconto_centavos), dinheiro(p.frete_centavos), dinheiro(p.total_centavos), p.cupom_codigo, p.frete_servico, p.rastreio,
    quando(p.pago_em), quando(p.enviado_em), quando(p.entregue_em)]);
  const csv = "﻿" + [cab, ...linhas].map((l) => l.map(cel).join(";")).join("\r\n") + "\r\n";
  return new Response(csv, { headers: {
    "content-type": "text/csv; charset=utf-8", "cache-control": "no-store",
    "content-disposition": `attachment; filename="pedidos-melty-${new Date().toISOString().slice(0, 10)}.csv"`, "x-content-type-options": "nosniff",
  } });
}
