import { ID_IMAGEM } from "./util.js";

export const LIMITE_BYTES = 1_000_000;

// Descobre o tipo real pelo conteúdo (não confia no que o navegador diz)
export function tipoDaImagem(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

export function paraBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function deBase64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export const urlImagem = (id) => (id ? `/img/${id}` : "");

export async function todasExistem(db, ids) {
  for (const id of ids) {
    if (typeof id !== "string" || !ID_IMAGEM.test(id)) return false;
    if (!(await db.prepare("SELECT 1 FROM imagens WHERE id = ?").bind(id).first())) return false;
  }
  return true;
}

// Apaga imagens que nenhum produto, banner ou texto usa mais (com 1 hora de folga para uploads recentes)
export async function limparOrfas(db) {
  const usados = new Set();
  const [prods, bans, cfg] = await Promise.all([
    db.prepare("SELECT imagens FROM produtos").all(),
    db.prepare("SELECT imagem_id FROM banners").all(),
    db.prepare("SELECT valor FROM config WHERE chave IN ('logo_id','quem_somos')").all(),
  ]);
  prods.results.forEach((p) => JSON.parse(p.imagens).forEach((i) => usados.add(i)));
  bans.results.forEach((b) => usados.add(b.imagem_id));
  cfg.results.forEach((c) => {
    const v = JSON.parse(c.valor);
    if (typeof v === "string") usados.add(v);
    else if (v && v.imagem_id) usados.add(v.imagem_id);
  });
  const antigas = await db.prepare("SELECT id FROM imagens WHERE criado_em < datetime('now', '-1 hour')").all();
  const apagar = antigas.results.map((r) => r.id).filter((id) => !usados.has(id));
  for (const id of apagar) await db.prepare("DELETE FROM imagens WHERE id = ?").bind(id).run();
}
