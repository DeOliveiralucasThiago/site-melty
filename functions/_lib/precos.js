// Preço vigente de um produto (promoção por data). O servidor é quem decide o preço, nunca o navegador.

// Data de hoje no horário de Brasília (AAAA-MM-DD). O Brasil não usa horário de verão atualmente.
export function hojeBrasilia(agora = new Date()) {
  return new Date(agora.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export function promocaoVigente(p, agora = new Date()) {
  if (!p.preco_promo_centavos || p.preco_promo_centavos >= p.preco_centavos) return false;
  const hoje = hojeBrasilia(agora);
  if (p.promo_inicio && hoje < p.promo_inicio) return false;
  if (p.promo_fim && hoje > p.promo_fim) return false;
  return true;
}

// { centavos, cheio, promocao }
export function precoVigente(p, agora = new Date()) {
  const promocao = promocaoVigente(p, agora);
  return { centavos: promocao ? p.preco_promo_centavos : p.preco_centavos, cheio: p.preco_centavos, promocao };
}
