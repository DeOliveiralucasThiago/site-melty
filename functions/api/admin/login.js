import { senhaCorreta, criarSessao, cabecalhoCookie } from "../../_lib/auth.js";
import { json, erro, lerJson } from "../../_lib/util.js";

const MAX_FALHAS = 5;
const JANELA_MS = 15 * 60 * 1000;

export async function onRequestPost({ request, env }) {
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const desde = Date.now() - JANELA_MS;
  await env.DB.prepare("DELETE FROM login_falhas WHERE ts < ?").bind(desde).run();
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_falhas WHERE ip = ? AND ts >= ?").bind(ip, desde).first();
  if (n >= MAX_FALHAS) return erro("Muitas tentativas erradas. Aguarde 15 minutos e tente de novo.", 429);

  const corpo = await lerJson(request);
  if (!corpo || typeof corpo.senha !== "string" || !(await senhaCorreta(env, corpo.senha))) {
    await env.DB.prepare("INSERT INTO login_falhas (ip, ts) VALUES (?, ?)").bind(ip, Date.now()).run();
    return erro("Senha incorreta.", 401);
  }
  await env.DB.prepare("DELETE FROM login_falhas WHERE ip = ?").bind(ip).run();
  return json({ ok: true }, 200, { "set-cookie": cabecalhoCookie(await criarSessao(env), request, 12 * 60 * 60) });
}
