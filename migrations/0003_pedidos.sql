-- Pedidos, itens, histórico e limite de requisições

CREATE TABLE pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,                  -- 32 caracteres aleatórios: é o "link secreto" de acompanhamento
  status TEXT NOT NULL CHECK (status IN ('aguardando_pagamento','pago','em_producao','enviado','entregue','cancelado','reembolsado')),
  cliente_nome TEXT NOT NULL,
  cliente_email TEXT NOT NULL,
  cliente_telefone TEXT NOT NULL,
  cliente_cpf TEXT NOT NULL,
  end_cep TEXT NOT NULL, end_rua TEXT NOT NULL, end_numero TEXT NOT NULL, end_complemento TEXT NOT NULL DEFAULT '',
  end_bairro TEXT NOT NULL, end_cidade TEXT NOT NULL, end_uf TEXT NOT NULL,
  subtotal_centavos INTEGER NOT NULL,
  desconto_centavos INTEGER NOT NULL DEFAULT 0,
  frete_centavos INTEGER NOT NULL DEFAULT 0,
  total_centavos INTEGER NOT NULL,
  cupom_codigo TEXT NOT NULL DEFAULT '',
  frete_servico TEXT NOT NULL DEFAULT '',
  rastreio TEXT NOT NULL DEFAULT '',
  revisao TEXT NOT NULL DEFAULT '',            -- motivos que pedem atenção humana (vazio = tudo certo)
  provedor TEXT NOT NULL DEFAULT '',
  pagamento_ref TEXT NOT NULL DEFAULT '',
  pagamento_url TEXT NOT NULL DEFAULT '',
  expira_em TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  pago_em TEXT, enviado_em TEXT, entregue_em TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pedidos_status ON pedidos(status, criado_em);

CREATE TABLE pedido_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  qtd INTEGER NOT NULL CHECK (qtd > 0),
  unitario_centavos INTEGER NOT NULL,
  cheio_centavos INTEGER NOT NULL,
  promocao INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_itens_pedido ON pedido_itens(pedido_id);

CREATE TABLE pedido_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  detalhe TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_eventos_pedido ON pedido_eventos(pedido_id);

-- Limite de requisições por visitante (contra abuso: criar pedidos em massa, adivinhar cupom etc.)
CREATE TABLE limites (
  chave TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_limites ON limites(chave, ts);
