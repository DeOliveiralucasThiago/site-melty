// Cotação de frete. O servidor calcula o pacote a partir dos produtos do banco e cota por CEP; o navegador só escolhe uma opção.
//
// Provedores de cotação (hoje: "tabela", por região, configurada no painel).
// O Melhor Envio entra aqui depois, devolvendo o mesmo formato de opção:
//   { id, servico, transportadora, preco_centavos, prazo_dias_uteis }

export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

// Faixas de CEP por estado (5 primeiros dígitos). Usado só para descobrir o estado do CEP; conferir antes de publicar.
const FAIXAS = [["AC", 69900, 69999], ["AL", 57000, 57999], ["AM", 69000, 69299], ["AM", 69400, 69899], ["AP", 68900, 68999], ["BA", 40000, 48999], ["CE", 60000, 63999],
  ["DF", 70000, 72799], ["DF", 73000, 73699], ["ES", 29000, 29999], ["GO", 72800, 72999], ["GO", 73700, 76799], ["MA", 65000, 65999], ["MG", 30000, 39999], ["MS", 79000, 79999],
  ["MT", 78000, 78899], ["PA", 66000, 68899], ["PB", 58000, 58999], ["PE", 50000, 56999], ["PI", 64000, 64999], ["PR", 80000, 87999], ["RJ", 20000, 28999], ["RN", 59000, 59999],
  ["RO", 76800, 76999], ["RO", 78900, 78999], ["RR", 69300, 69399], ["RS", 90000, 99999], ["SC", 88000, 89999], ["SE", 49000, 49999], ["SP", 1000, 19999], ["TO", 77000, 77999]];

export function ufDoCep(cep) {
  const d = String(cep ?? "").replace(/\D/g, "");
  if (d.length !== 8) return null;
  const n = Number(d.slice(0, 5));
  const f = FAIXAS.find(([, a, b]) => n >= a && n <= b);
  return f ? f[0] : null;
}

// Mínimos aceitos pelos Correios (cm) para o pacote não ser recusado
const MIN = { comprimento: 16, largura: 11, altura: 2 };

/** Empilha os itens: maior comprimento e largura, soma das alturas, soma dos pesos. */
export function montarPacote(linhas, padrao) {
  let peso = 0, comp = 0, larg = 0, alt = 0;
  for (const l of linhas) {
    peso += (l.peso_kg || 0) * l.qtd;
    comp = Math.max(comp, l.comprimento_cm ?? padrao.comprimento);
    larg = Math.max(larg, l.largura_cm ?? padrao.largura);
    alt += (l.altura_cm ?? padrao.altura) * l.qtd;
  }
  const r1 = (x) => Math.round(x * 10) / 10;
  return { peso_kg: r1(Math.max(peso, 0.01) * 1000) / 1000, comprimento_cm: r1(Math.max(comp, MIN.comprimento)), largura_cm: r1(Math.max(larg, MIN.largura)), altura_cm: r1(Math.max(alt, MIN.altura)) };
}

async function cfg(db, chaves) {
  const r = (await db.prepare(`SELECT chave, valor FROM config WHERE chave IN (${chaves.map(() => "?").join(",")})`).bind(...chaves).all()).results;
  return Object.fromEntries(r.map((x) => [x.chave, JSON.parse(x.valor)]));
}
export const EMBALAGEM_PADRAO = { altura: 10, largura: 12, comprimento: 16 };

const slug = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "x";

/**
 * Opções de entrega para um CEP.
 * entrada: { cep, linhas (itens do pedido calculado), subtotal_centavos }
 * saída: { uf, producao_dias, pacote, opcoes: [{ id, servico, transportadora, preco_centavos, prazo_dias_uteis, gratis }] }
 */
export async function cotarFrete(db, env, { cep, linhas, subtotal_centavos }) {
  const c = await cfg(db, ["frete_regioes", "frete_provisorio", "frete_gratis_acima", "embalagem_padrao", "prazo_producao_dias_uteis"]);
  const uf = ufDoCep(cep);
  const pacote = montarPacote(linhas, { ...EMBALAGEM_PADRAO, ...(c.embalagem_padrao || {}) });
  const gratisAcima = Math.round(Number(c.frete_gratis_acima || 0) * 100);
  const gratis = gratisAcima > 0 && subtotal_centavos >= gratisAcima;
  const regioes = Array.isArray(c.frete_regioes) ? c.frete_regioes : [];

  let opcoes;
  if (regioes.length) {
    opcoes = regioes.filter((r) => uf && r.ufs.includes(uf)).map((r) => ({
      id: "regiao:" + slug(r.nome), servico: r.nome, transportadora: "", preco_centavos: Math.round(Number(r.preco) * 100), prazo_dias_uteis: r.prazo ?? null,
    }));
  } else {
    // Nenhuma região configurada: um valor único provisório
    opcoes = [{ id: "unico", servico: "Entrega", transportadora: "", preco_centavos: Math.round(Number(c.frete_provisorio || 0) * 100), prazo_dias_uteis: null }];
  }
  opcoes = opcoes.map((o) => (gratis ? { ...o, preco_centavos: 0, gratis: true } : { ...o, gratis: false }));
  return { uf, producao_dias: Number(c.prazo_producao_dias_uteis) || 0, pacote, opcoes };
}
