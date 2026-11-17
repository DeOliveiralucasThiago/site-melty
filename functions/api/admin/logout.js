import { cabecalhoCookie } from "../../_lib/auth.js";
import { json } from "../../_lib/util.js";

export async function onRequestPost({ request }) {
  return json({ ok: true }, 200, { "set-cookie": cabecalhoCookie("", request, 0) });
}
