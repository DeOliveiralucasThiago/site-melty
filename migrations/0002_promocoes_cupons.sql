-- Promoções por produto e motor de cupons

ALTER TABLE produtos ADD COLUMN preco_promo_centavos INTEGER CHECK (preco_promo_centavos IS NULL OR preco_promo_centavos > 0);
ALTER TABLE produtos ADD COLUMN promo_inicio TEXT;   -- AAAA-MM-DD (horário de Brasília), opcional
ALTER TABLE produtos ADD COLUMN promo_fim TEXT;      -- AAAA-MM-DD, inclusive, opcional

CREATE TABLE cupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,                       -- sempre em maiúsculas
  tipo TEXT NOT NULL CHECK (tipo IN ('percentual', 'valor', 'frete')),
  valor INTEGER NOT NULL DEFAULT 0,                  -- percentual: 1 a 100; valor: centavos; frete: 0
  limite_total INTEGER CHECK (limite_total IS NULL OR limite_total > 0),   -- vazio = sem limite
  so_primeira_compra INTEGER NOT NULL DEFAULT 0,
  valor_minimo_centavos INTEGER NOT NULL DEFAULT 0,
  inicio TEXT,
  fim TEXT,
  escopo TEXT NOT NULL DEFAULT 'todos' CHECK (escopo IN ('todos', 'categorias', 'produtos')),
  escopo_ids TEXT NOT NULL DEFAULT '[]',
  acumula_promocao INTEGER NOT NULL DEFAULT 0,       -- 0: o cupom não vale sobre itens já em promoção
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cada uso de cupom. O controle é só pelo CPF, guardado apenas como código embaralhado (HMAC), nunca aberto.
CREATE TABLE cupom_usos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cupom_id INTEGER NOT NULL REFERENCES cupons(id),
  cpf_hash TEXT NOT NULL,
  pedido_ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reservado', 'consumido', 'liberado')),
  desconto_centavos INTEGER NOT NULL DEFAULT 0,
  reservado_em TEXT NOT NULL DEFAULT (datetime('now')),
  expira_em TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
-- O próprio banco impede o mesmo CPF de ter dois usos ativos do mesmo cupom
CREATE UNIQUE INDEX idx_uso_cpf ON cupom_usos (cupom_id, cpf_hash) WHERE status IN ('reservado', 'consumido');
CREATE INDEX idx_uso_pedido ON cupom_usos (pedido_ref);

-- Quem já comprou (para o cupom de primeira compra). Preenchido quando um pedido é pago.
CREATE TABLE compradores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cpf_hash TEXT NOT NULL,
  pedido_ref TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_comp_cpf ON compradores (cpf_hash);
