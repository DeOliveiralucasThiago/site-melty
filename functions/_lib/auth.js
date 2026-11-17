// Login do painel: senha única (variável ADMIN_PASSWORD) + cookie assinado com HMAC (SESSION_SECRET).
const enc = new TextEncoder();
export const COOKIE = "melty_sess";
const DURACAO_MS = 12 * 60 * 60 * 1000;

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const chave = (segredo) => crypto.subtle.importKey("raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export function configurado(env) {
  return typeof env.ADMIN_PASSWORD === "string" && env.ADMIN_PASSWORD.length >= 8 &&
         typeof env.SESSION_SECRET === "string" && env.SESSION_SECRET.length >= 16;
}

export async function senhaCorreta(env, tentativa) {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(String(tentativa))),
    crypto.subtle.digest("SHA-256", enc.encode(env.ADMIN_PASSWORD)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export async function criarSessao(env) {
  const corpo = b64u(enc.encode(JSON.stringify({ exp: Date.now() + DURACAO_MS })));
  const assinatura = await crypto.subtle.sign("HMAC", await chave(env.SESSION_SECRET), enc.encode(corpo));
  return `${corpo}.${b64u(assinatura)}`;
}

export async function sessaoValida(env, request) {
  const cookie = (request.headers.get("cookie") || "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!cookie) return false;
  const [corpo, assinatura] = cookie.slice(COOKIE.length + 1).split(".");
  if (!corpo || !assinatura) return false;
  try {
    const ok = await crypto.subtle.verify("HMAC", await chave(env.SESSION_SECRET), deB64u(assinatura), enc.encode(corpo));
    if (!ok) return false;
    return JSON.parse(new TextDecoder().decode(deB64u(corpo))).exp > Date.now();
  } catch { return false; }
}

export function cabecalhoCookie(valor, request, maxAge) {
  const seguro = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${seguro}`;
}
