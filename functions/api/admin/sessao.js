import { json } from "../../_lib/util.js";
// Se chegou aqui, o middleware já confirmou que a sessão é válida.
export async function onRequestGet() { return json({ ok: true }); }
