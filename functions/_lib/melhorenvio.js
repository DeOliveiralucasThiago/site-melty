// Melhor Envio: cotação de frete e geração de etiquetas.
// Escrito conforme a documentação oficial (docs.melhorenvio.com.br). Ainda NÃO validado contra o ambiente de teste (sandbox) com token real.
//
// Variáveis: MELHORENVIO_TOKEN (segredo, token gerado no painel do Melhor Envio), MELHORENVIO_AMBIENTE ("sandbox" padrão | "producao").
// Só para desenvolvimento: MELHORENVIO_AMBIENTE="teste" + MELHORENVIO_URL=http://localhost:xxxx aponta para um servidor de mentira.
import { numeroDoPedido } from "./util.js";

const soDigitos = (t) => String(t ?? "").replace(/\D/g, "");

export class ErroME extends Error {
  constructor(mensagem, status = 0, detalhes = null) { super(mensagem); this.status = status; this.detalhes = detalhes; }
}

const BASES = { producao: "https://melhorenvio.com.br", sandbox: "https://sandbox.melhorenvio.com.br" };
export function baseUrl(env) {
  if (env.MELHORENVIO_AMBIENTE === "teste" && env.MELHORENVIO_URL) return String(env.MELHORENVIO_URL).replace(/\/+$/, "");
  return env.MELHORENVIO_AMBIENTE === "producao" ? BASES.producao : BASES.sandbox;
}
export const meDisponivel = (env) => typeof env.MELHORENVIO_TOKEN === "string" && env.MELHORENVIO_TOKEN.length >= 10;

// Junta as mensagens de erro nos formatos da API: { message }, { error: "..." }, { errors: { campo: [..] } }, { error: { campo: [[..]] } }
function mensagemDeErro(j) {
  if (!j || typeof j !== "object") return "";
  const partes = [];
  const achata = (x) => { if (Array.isArray(x)) x.forEach(achata); else if (x && typeof x === "object") Object.values(x).forEach(achata); else if (x) partes.push(String(x)); };
  if (j.errors) achata(j.errors);
  if (j.error) achata(j.error);
  if (!partes.length && j.message) partes.push(String(j.message));
  return [...new Set(partes)].join(" ").slice(0, 400);
}

async function chamar(env, contato, metodo, caminho, corpo, { timeoutMs = 9000 } = {}) {
  if (!meDisponivel(env)) throw new ErroME("O Melhor Envio ainda não foi conectado (falta o token).", 0);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let r;
  try {
    r = await fetch(baseUrl(env) + caminho, {
      method: metodo, signal: ctrl.signal,
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${env.MELHORENVIO_TOKEN}`, "User-Agent": contato },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch (e) {
    throw new ErroME(e.name === "AbortError" ? "O Melhor Envio demorou para responder." : "Não foi possível falar com o Melhor Envio.", 0);
  } finally { clearTimeout(timer); }
  const texto = await r.text();
  let j = null; try { j = texto ? JSON.parse(texto) : null; } catch { /* resposta não é JSON */ }
  if (!r.ok) {
    if (r.status === 401) throw new ErroME("O Melhor Envio não reconheceu o token (inválido ou vencido). Gere um novo token no painel do Melhor Envio.", 401, j);
    if (r.status === 403) throw new ErroME("O token não tem permissão para esta ação. Ao gerar o token no Melhor Envio, marque as permissões de cotação, carrinho, compra, geração, impressão, rastreio e cancelamento de etiquetas.", 403, j);
    throw new ErroME(mensagemDeErro(j) || `O Melhor Envio respondeu com erro ${r.status}.`, r.status, j);
  }
  return j;
}

// "Loja Melty (contato@exemplo.com)": o User-Agent é obrigatório e precisa ter o nome da aplicação e um e-mail de contato
export const userAgent = (loja, email) => `${loja || "Loja"} (${email || "sem-contato@exemplo.com"})`;

/* ---------------- cotação ---------------- */
const CACHE_MIN = 10;
const hex = async (t) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Cota o pacote inteiro como um só volume (o mesmo que será usado na etiqueta).
 * Devolve opções: { id: "me:<serviço>", servico, transportadora, preco_centavos, transporte_dias }
 */
export async function cotarMelhorEnvio(env, db, { contato, cepOrigem, cepDestino, pacote, valorCentavos, servicos }) {
  const ids = (servicos && servicos.length ? servicos : [1, 2]).map(Number).filter(Number.isInteger);
  const corpo = {
    from: { postal_code: String(cepOrigem).replace(/\D/g, "") },
    to: { postal_code: String(cepDestino).replace(/\D/g, "") },
    products: [{
      id: "pacote", width: Math.ceil(pacote.largura_cm), height: Math.ceil(pacote.altura_cm), length: Math.ceil(pacote.comprimento_cm),
      weight: pacote.peso_kg, insurance_value: Math.min(Math.round(valorCentavos) / 100, 3000), quantity: 1,
    }],
    options: { receipt: false, own_hand: false },
    services: ids.join(","),
  };
  const chave = await hex(JSON.stringify([baseUrl(env), corpo]));
  const em = db ? await db.prepare("SELECT resposta FROM cotacoes_cache WHERE chave = ? AND criado_em > datetime('now', ?)").bind(chave, `-${CACHE_MIN} minutes`).first() : null;
  let lista;
  if (em) lista = JSON.parse(em.resposta);
  else {
    lista = await chamar(env, contato, "POST", "/api/v2/me/shipment/calculate", corpo);
    if (!Array.isArray(lista)) throw new ErroME("Resposta inesperada do Melhor Envio ao cotar o frete.", 200, lista);
    if (db) {
      await db.prepare("DELETE FROM cotacoes_cache WHERE criado_em < datetime('now', '-1 hour')").run();
      await db.prepare("INSERT OR REPLACE INTO cotacoes_cache (chave, resposta, criado_em) VALUES (?, ?, datetime('now'))").bind(chave, JSON.stringify(lista)).run();
    }
  }
  // Documentação: usar custom_price e custom_delivery_time (já com as regras da conta). Serviço com "error" ou sem preço não está disponível.
  return lista
    .filter((s) => s && !s.error && ids.includes(Number(s.id)))
    .map((s) => ({ s, preco: Number.parseFloat(s.custom_price ?? s.price), dias: Number.parseInt(s.custom_delivery_time ?? s.delivery_time, 10) }))
    .filter((x) => Number.isFinite(x.preco) && x.preco >= 0)
    .map(({ s, preco, dias }) => ({
      id: `me:${s.id}`, servico: `${s.name}${s.company?.name ? ` (${s.company.name})` : ""}`, transportadora: s.company?.name ?? "",
      preco_centavos: Math.round(preco * 100), transporte_dias: Number.isFinite(dias) ? dias : null,
    }))
    .sort((a, b) => a.preco_centavos - b.preco_centavos);
}

/**
 * Teste de conexão (não gasta nada): cota 1 kg a partir do CEP de origem para alguns destinos (para no primeiro que tiver preço)
 * e confere se o token tem a permissão de carrinho (necessária para gerar etiquetas).
 */
export async function testarConexao(env, db, { contato, cepOrigem, servicos }) {
  const origem = soDigitos(cepOrigem);
  let opcoes = [];
  for (const destino of ["01001000", "20040020", "30140071"]) {
    if (destino === origem) continue;
    opcoes = await cotarMelhorEnvio(env, null, { contato, cepOrigem, cepDestino: destino, pacote: { largura_cm: 16, altura_cm: 11, comprimento_cm: 16, peso_kg: 1 }, valorCentavos: 5000, servicos });
    if (opcoes.length) break;
  }
  let carrinho = null;   // true = tem permissão; false = falta; null = não deu para saber
  try { await chamar(env, contato, "GET", "/api/v2/me/cart"); carrinho = true; } catch (e) { carrinho = e instanceof ErroME && e.status === 403 ? false : null; }
  return { opcoes, carrinho };
}

/* ---------------- etiquetas ---------------- */
export function remetenteCompleto(r) {
  return !!(r && r.nome && soDigitos(r.telefone).length >= 10 && r.email && [11, 14].includes(soDigitos(r.documento).length) && r.rua && r.numero && r.bairro && r.cidade && r.uf && soDigitos(r.cep).length === 8);
}

function pessoa(nome, telefone, email, documento, ender, estadoIsento) {
  const doc = soDigitos(documento);
  return {
    name: nome, phone: soDigitos(telefone), email, document: doc.length === 11 ? doc : "", company_document: doc.length === 14 ? doc : "",
    ...(estadoIsento ? { state_register: "ISENTO" } : {}),
    address: ender.rua, number: ender.numero, complement: ender.complemento || "", district: ender.bairro, city: ender.cidade, country_id: "BR",
    postal_code: soDigitos(ender.cep), state_abbr: ender.uf, note: ender.nota || "",
  };
}

/** Corpo do POST /me/cart. Envio "não comercial" = declaração de conteúdo (sem nota fiscal). */
export function montarCarrinho({ pedido, itens, remetente, pacote, servicoId, naoComercial }) {
  return {
    service: servicoId,
    from: pessoa(remetente.nome, remetente.telefone, remetente.email, remetente.documento, { ...remetente, nota: remetente.observacao }, naoComercial),
    to: pessoa(pedido.cliente_nome, pedido.cliente_telefone, pedido.cliente_email, pedido.cliente_cpf, { rua: pedido.end_rua, numero: pedido.end_numero, complemento: pedido.end_complemento, bairro: pedido.end_bairro, cidade: pedido.end_cidade, uf: pedido.end_uf, cep: pedido.end_cep }, naoComercial),
    products: itens.map((i) => ({ name: i.nome, quantity: String(i.qtd), unitary_value: (i.unitario_centavos / 100).toFixed(2) })),
    volumes: [{ height: Math.ceil(pacote.altura_cm), width: Math.ceil(pacote.largura_cm), length: Math.ceil(pacote.comprimento_cm), weight: pacote.peso_kg }],
    options: { insurance_value: Math.min(pedido.subtotal_centavos / 100, 3000), receipt: false, own_hand: false, reverse: false, non_commercial: !!naoComercial, reminder: `Pedido #${numeroDoPedido(pedido.id)}` },
  };
}

const ESTADOS = { "": 0, criando: 0, carrinho: 1, paga: 2, gerada: 3 };

/**
 * Gera a etiqueta em etapas, guardando o andamento no pedido (carrinho → pagamento com o saldo → geração → rastreio).
 * Se uma etapa falhar (ex.: saldo insuficiente), nada se perde: ao tentar de novo, continua de onde parou, sem comprar duas vezes.
 */
export async function gerarEtiqueta(env, db, pedidoId, { contato, cfg }) {
  const me = cfg.melhorenvio || {};
  if (!me.etiquetas_ativas) throw new ErroME("A geração de etiquetas está desligada nas configurações (Melhor Envio).", 0);
  if (!remetenteCompleto(cfg.remetente)) throw new ErroME("Preencha todos os dados do remetente (Textos e contato > Melhor Envio) antes de gerar etiquetas.", 0);
  const p = await db.prepare("SELECT * FROM pedidos WHERE id = ?").bind(pedidoId).first();
  if (!p) throw new ErroME("Pedido não encontrado.", 404);
  if (!["pago", "em_producao"].includes(p.status)) throw new ErroME("A etiqueta só pode ser gerada para pedidos pagos que ainda não foram enviados.", 0);
  if (p.retirada || !String(p.frete_id).startsWith("me:")) throw new ErroME("Este pedido não usa uma entrega do Melhor Envio.", 0);
  const servicoId = Number(String(p.frete_id).slice(3));
  const pacote = p.pacote_json ? JSON.parse(p.pacote_json) : null;
  if (!pacote) throw new ErroME("O pedido não tem as medidas do pacote registradas.", 0);

  // Trava contra clique duplo / duas pessoas: só um processo avança por vez (a trava vence sozinha em 2 minutos)
  const trava = await db.prepare("UPDATE pedidos SET me_travado_em = datetime('now') WHERE id = ? AND (me_travado_em IS NULL OR me_travado_em < datetime('now', '-2 minutes'))").bind(pedidoId).run();
  if (!trava.meta.changes) throw new ErroME("Já existe uma geração de etiqueta em andamento para este pedido. Aguarde alguns segundos.", 0);
  const salvar = (campos) => { const k = Object.keys(campos); return db.prepare(`UPDATE pedidos SET ${k.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).bind(...k.map((c) => campos[c]), pedidoId).run(); };
  try {
    let estado = p.me_estado || "", ordem = p.me_ordem_id || "";
    if (!ordem) {
      const itens = (await db.prepare("SELECT nome, qtd, unitario_centavos FROM pedido_itens WHERE pedido_id = ?").bind(pedidoId).all()).results;
      const r = await chamar(env, contato, "POST", "/api/v2/me/cart", montarCarrinho({ pedido: p, itens, remetente: cfg.remetente, pacote, servicoId, naoComercial: me.nao_comercial !== false }), { timeoutMs: 20000 });
      if (!r || !r.id) throw new ErroME("O Melhor Envio não devolveu o código da etiqueta.", 200, r);
      ordem = r.id; estado = "carrinho";
      await salvar({ me_ordem_id: ordem, me_estado: estado, me_erro: "" });
    }
    if (ESTADOS[estado] < 2) {
      await chamar(env, contato, "POST", "/api/v2/me/shipment/checkout", { orders: [ordem] }, { timeoutMs: 20000 });   // debita o saldo da carteira
      estado = "paga"; await salvar({ me_estado: estado, me_erro: "" });
    }
    if (ESTADOS[estado] < 3) {
      const g = await chamar(env, contato, "POST", "/api/v2/me/shipment/generate", { orders: [ordem] }, { timeoutMs: 20000 });
      const item = g && g[ordem];
      if (item && item.status === false) throw new ErroME(item.message || "O Melhor Envio não conseguiu gerar a etiqueta.", 200, g);
      estado = "gerada"; await salvar({ me_estado: estado, me_erro: "" });
    }
    const rastreio = await buscarRastreio(env, db, pedidoId, { contato, ordem });
    return { estado, ordem, rastreio };
  } catch (e) {
    await salvar({ me_erro: String(e.message).slice(0, 400) });
    throw e;
  } finally {
    await db.prepare("UPDATE pedidos SET me_travado_em = NULL WHERE id = ?").bind(pedidoId).run();
  }
}

/** Busca o código de rastreio na etiqueta já gerada (pode demorar alguns instantes para aparecer). */
export async function buscarRastreio(env, db, pedidoId, { contato, ordem }) {
  // O detalhe da etiqueta é a fonte mais confiável: o endpoint /shipment/tracking pode seguir vazio
  // mesmo depois de o código já existir (visto no sandbox real).
  const extrai = (x) => {
    const c = x && (x.tracking || x.melhorenvio_tracking || x.self_tracking) ? String(x.tracking || x.melhorenvio_tracking || x.self_tracking).toUpperCase() : "";
    return /^[A-Z0-9]{8,30}$/.test(c) ? c : "";
  };
  let cod = "";
  try { cod = extrai(await chamar(env, contato, "GET", `/api/v2/me/orders/${encodeURIComponent(ordem)}`)); } catch (e) { if (e && e.status === 401) throw e; }
  if (!cod) {
    const r = await chamar(env, contato, "POST", "/api/v2/me/shipment/tracking", { orders: [ordem] });
    cod = extrai(r && r[ordem]);
  }
  if (cod) await db.prepare("UPDATE pedidos SET me_rastreio = ? WHERE id = ?").bind(cod, pedidoId).run();
  return cod;
}

/** Link para imprimir a etiqueta. "private": só abre quem estiver logado na conta do Melhor Envio. */
export async function linkEtiqueta(env, pedido, { contato }) {
  if (!pedido.me_ordem_id || ESTADOS[pedido.me_estado] < 3) throw new ErroME("A etiqueta ainda não foi gerada.", 0);
  const r = await chamar(env, contato, "POST", "/api/v2/me/shipment/print", { mode: "private", orders: [pedido.me_ordem_id] });
  if (!r || !r.url || !/^https:\/\/|^http:\/\/localhost/.test(r.url)) throw new ErroME("O Melhor Envio não devolveu o link da etiqueta.", 200, r);
  return r.url;
}

/** Cancela a etiqueta (o estorno do valor é feito pelo Melhor Envio, em até 12 horas, segundo a documentação). */
export async function cancelarEtiqueta(env, db, pedido, { contato }) {
  if (!pedido.me_ordem_id) throw new ErroME("Este pedido não tem etiqueta.", 0);
  if (pedido.status === "enviado" || pedido.status === "entregue") throw new ErroME("O pedido já foi enviado: a etiqueta não pode mais ser cancelada por aqui.", 0);
  const r = await chamar(env, contato, "POST", "/api/v2/me/shipment/cancel", { order: { id: pedido.me_ordem_id, reason_id: "2", description: "Cancelada pela loja" } });
  const x = r && r[pedido.me_ordem_id];
  if (!x || x.canceled !== true) throw new ErroME("O Melhor Envio não confirmou o cancelamento da etiqueta (ela pode já ter sido coletada).", 200, r);
  await db.prepare("UPDATE pedidos SET me_ordem_id = '', me_estado = '', me_rastreio = '', me_erro = '' WHERE id = ?").bind(pedido.id).run();
}
