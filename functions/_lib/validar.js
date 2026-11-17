// Validação e limpeza dos dados recebidos do painel. Lançam Error com mensagem em português.

export function texto(v, nome, { max = 200, min = 0, obrigatorio = false } = {}) {
  if (v === undefined || v === null) v = "";
  if (typeof v !== "string") throw new Error(`${nome}: texto inválido.`);
  v = v.trim();
  if ((obrigatorio || min > 0) && v.length < Math.max(min, 1)) throw new Error(`${nome}: preencha este campo.`);
  if (v.length > max) throw new Error(`${nome}: no máximo ${max} caracteres.`);
  return v;
}

export function inteiro(v, nome, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${nome}: use um número inteiro entre ${min} e ${max}.`);
  return n;
}

export function decimal(v, nome, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${nome}: use um valor entre ${min} e ${max}.`);
  return n;
}

export function centavos(v, nome) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 99999) throw new Error(`${nome}: informe um valor entre R$ 0,01 e R$ 99.999,00.`);
  return Math.round(n * 100);
}

export const bool = (v) => (v ? 1 : 0);

// Links: só caminhos internos (começando com / ou sem ":") ou endereços https://
export function link(v, nome) {
  v = texto(v, nome, { max: 300 });
  if (!v) return "";
  if (/^https:\/\//i.test(v)) return v;
  if (v.includes(":") || v.startsWith("//")) throw new Error(`${nome}: use um endereço que comece com https:// ou um caminho interno (ex.: catalogo.html).`);
  return v;
}

export function listaDeTextos(v, nome, maxItens, maxChars) {
  if (!Array.isArray(v) || v.length > maxItens) throw new Error(`${nome}: lista inválida (máximo ${maxItens} itens).`);
  return v.map((t) => texto(t, nome, { max: maxChars })).filter(Boolean);
}

// Data AAAA-MM-DD (opcional). Devolve null se vazia.
export function data(v, nome) {
  v = texto(v, nome, { max: 10 });
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + "T00:00:00Z")) || new Date(v + "T00:00:00Z").toISOString().slice(0, 10) !== v)
    throw new Error(`${nome}: data inválida.`);
  return v;
}
