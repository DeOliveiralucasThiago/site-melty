// "Testar conexão": faz uma cotação de teste (não gasta saldo nem cria nada) para conferir token, ambiente e CEP de origem.
import { json, erro } from "../../../_lib/util.js";
import { testarConexao, meDisponivel, userAgent, baseUrl, ErroME } from "../../../_lib/melhorenvio.js";

export async function onRequestPost({ env }) {
  if (!meDisponivel(env)) return json({ ok: false, mensagem: "Falta o token do Melhor Envio (segredo MELHORENVIO_TOKEN no Cloudflare)." });
  const cfg = Object.fromEntries((await env.DB.prepare("SELECT chave, valor FROM config WHERE chave IN ('melhorenvio','remetente','loja','email')").all()).results.map((r) => [r.chave, JSON.parse(r.valor)]));
  const cep = String(cfg.remetente?.cep ?? "").replace(/\D/g, "");
  if (cep.length !== 8) return json({ ok: false, mensagem: "Preencha e salve o CEP do remetente antes de testar." });
  try {
    const ops = await testarConexao(env, null, { contato: userAgent(cfg.loja, cfg.email), cepOrigem: cep, servicos: cfg.melhorenvio?.servicos });
    const ambiente = env.MELHORENVIO_AMBIENTE === "producao" ? "produção" : env.MELHORENVIO_AMBIENTE === "teste" ? "teste local" : "sandbox (testes)";
    if (!ops.length) return json({ ok: false, mensagem: `Conectou (${ambiente}), mas nenhum dos serviços escolhidos devolveu preço para esse trajeto de teste. Confira os serviços e o CEP de origem.` });
    return json({ ok: true, ambiente, servicos: ops.map((o) => ({ nome: o.servico, preco: o.preco_centavos / 100, prazo: o.transporte_dias })) });
  } catch (e) {
    if (e instanceof ErroME) return json({ ok: false, mensagem: e.message });
    console.error("teste Melhor Envio", e);
    return erro("Erro inesperado ao testar.", 500);
  }
}
