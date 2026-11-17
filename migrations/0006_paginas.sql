-- Páginas de texto editáveis pelo painel (Privacidade, Prazos e Envio, Trocas e Devoluções)
CREATE TABLE paginas (
  slug TEXT PRIMARY KEY,
  titulo TEXT NOT NULL,
  conteudo TEXT NOT NULL,
  publicada INTEGER NOT NULL DEFAULT 1,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
