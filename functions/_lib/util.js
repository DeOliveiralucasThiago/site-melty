// Funções de apoio compartilhadas pelas rotas da API.

export function json(dados, status = 200, extra = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}
export const erro = (mensagem, status = 400) => json({ erro: mensagem }, status);

export async function lerJson(request) {
  try { return await request.json(); } catch { return null; }
}

export function agora() { return new Date().toISOString().slice(0, 19).replace("T", " "); }

export function novoId() { return crypto.randomUUID().replace(/-/g, "").slice(0, 24); }

export function slug(texto) {
  return String(texto).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "item";
}

// Gera um id legível e único dentro de uma tabela (ex.: vela-lavanda, vela-lavanda-2)
export async function idUnico(db, tabela, texto) {
  const base = slug(texto);
  let candidato = base, n = 1;
  while (await db.prepare(`SELECT 1 FROM ${tabela} WHERE id = ?`).bind(candidato).first()) {
    n += 1; candidato = `${base}-${n}`;
  }
  return candidato;
}

export const ID_IMAGEM = /^[a-f0-9]{24}$/;

// Limite de requisições: devolve false se a chave já passou do máximo dentro da janela (em ms).
export async function limitar(db, chave, max, janelaMs) {
  const agoraMs = Date.now();
  await db.prepare("DELETE FROM limites WHERE ts < ?").bind(agoraMs - 24 * 3600 * 1000).run();
  const { n } = await db.prepare("SELECT COUNT(*) AS n FROM limites WHERE chave = ? AND ts >= ?").bind(chave, agoraMs - janelaMs).first();
  if (n >= max) return false;
  await db.prepare("INSERT INTO limites (chave, ts) VALUES (?, ?)").bind(chave, agoraMs).run();
  return true;
}
export const ipDe = (request) => request.headers.get("cf-connecting-ip") || "local";

export const numeroDoPedido = (id) => 1000 + id;
