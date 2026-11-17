// Protege tudo em /api/admin (exceto o login): exige sessão válida e, nas alterações,
// o cabeçalho X-Requested-With e a mesma origem (proteção contra requisições forjadas).
import { configurado, sessaoValida } from "../../_lib/auth.js";
import { erro } from "../../_lib/util.js";

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (!configurado(env)) return erro("O painel ainda não foi configurado (ADMIN_PASSWORD e SESSION_SECRET).", 503);

  const origem = request.headers.get("origin");
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (origem && new URL(origem).host !== url.host) return erro("Origem não permitida.", 403);
    if (request.headers.get("x-requested-with") !== "melty") return erro("Requisição não permitida.", 403);
  }

  if (url.pathname === "/api/admin/login") return next();
  if (!(await sessaoValida(env, request))) return erro("Sessão expirada. Entre novamente.", 401);
  return next();
}
