-- Loja Melty: estrutura inicial do banco de dados (Cloudflare D1 / SQLite)

CREATE TABLE categorias (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  ordem INTEGER NOT NULL DEFAULT 0,
  ativa INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE produtos (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 0),
  estoque INTEGER NOT NULL DEFAULT 0 CHECK (estoque >= 0),
  categoria_id TEXT REFERENCES categorias(id),
  peso_kg REAL NOT NULL DEFAULT 0.42,
  imagens TEXT NOT NULL DEFAULT '[]',   -- lista (JSON) de ids de imagens
  novidade INTEGER NOT NULL DEFAULT 0,
  destaque INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  ordem INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_produtos_categoria ON produtos(categoria_id);

CREATE TABLE banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  imagem_id TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  titulo TEXT NOT NULL DEFAULT '',
  botao TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1
);

-- Textos e configurações da loja: cada linha guarda um valor em JSON
CREATE TABLE config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

-- Imagens enviadas pelo painel (guardadas em base64 para não exigir outro serviço)
CREATE TABLE imagens (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  dados TEXT NOT NULL,
  tamanho INTEGER NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Controle de tentativas de login erradas (proteção contra adivinhar a senha)
CREATE TABLE login_falhas (
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_login_falhas ON login_falhas(ip, ts);
