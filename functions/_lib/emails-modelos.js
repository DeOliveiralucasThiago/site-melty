// Modelos dos e-mails (HTML compatível com e-mail: tabelas e estilos inline) e a versão em texto simples.
// Todo texto vindo do cliente é escapado. Os e-mails não levam CPF nem endereço completo.

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const reais = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const quando = (sql) => (sql ? new Date(sql.replace(" ", "T") + "Z").toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

export const TIPOS = {
  recebido: "Pedido recebido", pago: "Pagamento confirmado", enviado: "Pedido enviado", entregue: "Pedido entregue",
  cancelado: "Pedido cancelado", expirado: "Pedido expirado", reembolsado: "Reembolso",
};

function layout({ assunto, titulo, paragrafos, botoes = [], resumo = "", rodapeExtra = "", c }) {
  const p = paragrafos.map((t) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.55">${t}</p>`).join("");
  const b = botoes.map((x) => `<a href="${esc(x.url)}" style="display:inline-block;background:${x.claro ? "#ffffff" : "#B52141"};color:${x.claro ? "#8f1a33" : "#ffffff"};border:2px solid #B52141;text-decoration:none;padding:11px 24px;border-radius:999px;font-weight:bold;font-size:15px;margin:0 8px 8px 0">${esc(x.texto)}</a>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(assunto)}</title></head>
<body style="margin:0;background:#fffafa;font-family:Arial,Helvetica,sans-serif;color:#2b2224">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffafa"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #f1dede;border-radius:16px">
<tr><td align="center" style="background:#B52141;border-radius:15px 15px 0 0;padding:20px"><span style="font-family:Georgia,'Times New Roman',serif;font-size:26px;letter-spacing:7px;color:#ffffff">${esc(String(c.loja).toUpperCase())}</span></td></tr>
<tr><td style="padding:28px 28px 8px"><h1 style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.25;color:#8f1a33;margin:0 0 14px">${titulo}</h1>${p}<div style="margin:18px 0 6px">${b}</div></td></tr>
${resumo ? `<tr><td style="padding:8px 28px 8px">${resumo}</td></tr>` : ""}
<tr><td style="padding:18px 28px 26px;border-top:1px solid #f1dede;font-size:13px;line-height:1.5;color:#75656a">${rodapeExtra}Dúvidas? Responda este e-mail ou chame no <a href="https://wa.me/${esc(c.whatsapp)}" style="color:#B52141">WhatsApp</a>.<br>Você recebeu esta mensagem porque fez um pedido na ${esc(c.loja)}. É um aviso sobre o seu pedido, não é propaganda.</td></tr>
</table></td></tr></table></body></html>`;
}

function resumoHtml(pedido, itens) {
  const linha = (a, b, forte) => `<tr><td style="padding:6px 0;border-bottom:1px dashed #f1dede;font-size:15px;${forte ? "font-weight:bold;color:#8f1a33;" : ""}">${a}</td><td align="right" style="padding:6px 0;border-bottom:1px dashed #f1dede;font-size:15px;white-space:nowrap;${forte ? "font-weight:bold;color:#8f1a33;" : ""}">${b}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td colspan="2" style="font-family:Georgia,serif;font-size:18px;color:#8f1a33;padding-bottom:6px">Resumo do pedido #${pedido.numero}</td></tr>` +
    itens.map((i) => linha(`${i.qtd}× ${esc(i.nome)}`, reais(i.unitario_centavos * i.qtd))).join("") +
    linha("Subtotal", reais(pedido.subtotal_centavos)) +
    (pedido.desconto_centavos > 0 ? linha(`Desconto${pedido.cupom_codigo ? " (" + esc(pedido.cupom_codigo) + ")" : ""}`, "− " + reais(pedido.desconto_centavos)) : "") +
    linha("Frete" + (pedido.frete_servico ? " (" + esc(pedido.frete_servico) + ")" : ""), pedido.frete_centavos > 0 ? reais(pedido.frete_centavos) : "Grátis") +
    linha("Total", reais(pedido.total_centavos), true) + "</table>";
}
function resumoTexto(pedido, itens) {
  return [`Resumo do pedido #${pedido.numero}`, ...itens.map((i) => `- ${i.qtd}x ${i.nome}: ${reais(i.unitario_centavos * i.qtd)}`),
    `Subtotal: ${reais(pedido.subtotal_centavos)}`, ...(pedido.desconto_centavos > 0 ? [`Desconto: -${reais(pedido.desconto_centavos)}`] : []),
    `Frete${pedido.frete_servico ? " (" + pedido.frete_servico + ")" : ""}: ${pedido.frete_centavos > 0 ? reais(pedido.frete_centavos) : "Grátis"}`, `Total: ${reais(pedido.total_centavos)}`].join("\n");
}

/**
 * ctx: { pedido (linha do banco + numero), itens, config: {loja, whatsapp, email, prazo, aviso_prazo}, urlBase }
 * devolve { assunto, html, texto }
 */
export function montarEmail(tipo, ctx) {
  const { pedido, itens, config: c, urlBase } = ctx;
  const nome = esc(pedido.cliente_nome.split(" ")[0]);
  const nomeTxt = pedido.cliente_nome.split(" ")[0];
  const link = `${urlBase}/pedido.html?t=${pedido.token}`;
  const num = pedido.numero;
  const resumo = resumoHtml(pedido, itens), resumoT = resumoTexto(pedido, itens);
  const acompanhar = { texto: "Acompanhar meu pedido", url: link };
  let assunto, titulo, paragrafos, botoes = [acompanhar], paragrafosTxt, mostrarResumo = true, rodapeExtra = "";

  if (tipo === "recebido") {
    assunto = `Recebemos o seu pedido #${num}`;
    titulo = `Olá, ${nome}! Recebemos o seu pedido`;
    paragrafos = [`Seu pedido <b>#${num}</b> foi criado e falta só o pagamento. Reservamos os seus itens até <b>${esc(quando(pedido.expira_em))}</b>; depois disso a reserva é liberada.`];
    botoes = pedido.pagamento_url ? [{ texto: "Pagar agora", url: pedido.pagamento_url }, { ...acompanhar, claro: true }] : [acompanhar];
    paragrafosTxt = [`Olá, ${nomeTxt}! Recebemos o seu pedido #${num}. Falta só o pagamento. Reservamos os itens até ${quando(pedido.expira_em)}.`, pedido.pagamento_url ? `Pagar agora: ${pedido.pagamento_url}` : ""];
  } else if (tipo === "pago") {
    assunto = `Pagamento confirmado: pedido #${num}`;
    titulo = `Pagamento confirmado, ${nome}!`;
    const prev = pedido.frete_prazo_dias;
    const previsao = prev !== null && prev !== undefined ? `Previsão de entrega: em até <b>${prev} dias úteis</b> após o envio do pedido.` : "";
    paragrafos = [`Recebemos o pagamento do pedido <b>#${num}</b>. Em breve o seu pedido será separado e enviado. Assim que for postado, enviamos o código de rastreio por aqui.`,
      previsao, c.aviso_prazo ? `<span style="color:#75656a;font-size:14px">${esc(c.aviso_prazo)}</span>` : ""].filter(Boolean);
    paragrafosTxt = [`Pagamento confirmado, ${nomeTxt}! Recebemos o pagamento do pedido #${num}. Em breve o seu pedido será separado e enviado. Assim que for postado, enviamos o código de rastreio.`,
      prev !== null && prev !== undefined ? `Previsão de entrega: em até ${prev} dias úteis após o envio do pedido.` : "", c.aviso_prazo || ""];
  } else if (tipo === "enviado") {
    assunto = `Seu pedido #${num} está a caminho`;
    titulo = `Seu pedido está a caminho, ${nome}!`;
    const rastreioUrl = `https://melhorrastreio.com.br/rastreio/${encodeURIComponent(pedido.rastreio)}`;
    paragrafos = [`O pedido <b>#${num}</b> foi postado. Código de rastreio: <b style="letter-spacing:1px">${esc(pedido.rastreio)}</b>.`, `O rastreio pode levar algumas horas para aparecer depois da postagem.`];
    botoes = [{ texto: "Rastrear a entrega", url: rastreioUrl }, { ...acompanhar, claro: true }];
    paragrafosTxt = [`Seu pedido #${num} foi postado. Código de rastreio: ${pedido.rastreio}`, `Rastrear: ${rastreioUrl}`];
  } else if (tipo === "entregue") {
    assunto = `Seu pedido #${num} foi entregue`;
    titulo = `Pedido entregue! Esperamos que você ame, ${nome}`;
    paragrafos = [`Marcamos o pedido <b>#${num}</b> como entregue. Para a vela durar mais: apare o pavio em 5 mm antes de acender e mantenha-a em local fresco, longe de sol direto.`,
      `Se algo não saiu como esperado, é só responder este e-mail ou chamar no WhatsApp. Vamos resolver.`];
    mostrarResumo = false;
    paragrafosTxt = [`Marcamos o pedido #${num} como entregue. Para a vela durar mais: apare o pavio em 5 mm antes de acender e mantenha-a em local fresco, longe de sol direto.`, `Se algo não saiu como esperado, responda este e-mail ou chame no WhatsApp.`];
  } else if (tipo === "expirado") {
    assunto = `Seu pedido #${num} expirou`;
    titulo = `O prazo de pagamento terminou, ${nome}`;
    paragrafos = [`O pedido <b>#${num}</b> não teve o pagamento confirmado dentro do prazo, então liberamos os itens reservados. Nada foi cobrado.`, `Se ainda quiser as velas, é só fazer um novo pedido na loja.`];
    botoes = [{ texto: "Voltar para a loja", url: urlBase + "/" }];
    mostrarResumo = false;
    paragrafosTxt = [`O pedido #${num} não teve o pagamento confirmado no prazo e os itens reservados foram liberados. Nada foi cobrado.`, `Para comprar de novo: ${urlBase}/`];
  } else if (tipo === "cancelado") {
    assunto = `Seu pedido #${num} foi cancelado`;
    titulo = `Pedido cancelado, ${nome}`;
    paragrafos = [`O pedido <b>#${num}</b> foi cancelado. Se você já tinha pago, o valor será devolvido; o prazo para aparecer depende do banco ou do meio de pagamento.`, `Qualquer dúvida, responda este e-mail ou chame no WhatsApp.`];
    paragrafosTxt = [`O pedido #${num} foi cancelado. Se você já tinha pago, o valor será devolvido; o prazo depende do banco ou do meio de pagamento.`];
  } else if (tipo === "reembolsado") {
    assunto = `Reembolso do pedido #${num}`;
    titulo = `Seu reembolso foi feito, ${nome}`;
    paragrafos = [`O pagamento do pedido <b>#${num}</b> foi reembolsado. O prazo para o valor aparecer depende do banco ou do meio de pagamento utilizado.`];
    paragrafosTxt = [`O pagamento do pedido #${num} foi reembolsado. O prazo para o valor aparecer depende do banco ou do meio de pagamento.`];
  } else throw new Error("Tipo de e-mail desconhecido: " + tipo);

  const html = layout({ assunto, titulo, paragrafos, botoes, resumo: mostrarResumo ? resumo : "", rodapeExtra, c });
  const texto = [titulo.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&"), "", ...paragrafosTxt.filter(Boolean), "", ...(botoes.map((b) => `${b.texto}: ${b.url}`)), ...(mostrarResumo ? ["", resumoT] : []),
    "", `Dúvidas? Responda este e-mail ou chame no WhatsApp: https://wa.me/${c.whatsapp}`, `${c.loja} - aviso sobre o seu pedido.`].join("\n");
  return { assunto, html, texto };
}
