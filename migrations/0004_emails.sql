-- E-mails automáticos (fila) e endereço do site usado nos links

ALTER TABLE pedidos ADD COLUMN url_base TEXT NOT NULL DEFAULT '';

CREATE TABLE emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,                              -- recebido, pago, enviado, pronto_retirada, entregue, cancelado, expirado, reembolsado, loja_novo, loja_pago
  para TEXT NOT NULL,
  responder_para TEXT NOT NULL DEFAULT '',          -- quem recebe a resposta (nos avisos à loja, o cliente)
  assunto TEXT NOT NULL,
  html TEXT NOT NULL,
  texto TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','enviando','enviado','simulado','falhou','descartado')),
  tentativas INTEGER NOT NULL DEFAULT 0,
  versao INTEGER NOT NULL DEFAULT 1,               -- sobe a cada "reenviar" (parte da chave que evita envio duplicado)
  erro TEXT NOT NULL DEFAULT '',
  provedor TEXT NOT NULL DEFAULT '',
  provedor_ref TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  enviado_em TEXT
);
-- Cada tipo de e-mail sai uma vez por pedido e destinatário (avisos repetidos do provedor de pagamento não duplicam)
CREATE UNIQUE INDEX idx_emails_pedido_tipo ON emails(pedido_id, tipo, para);
CREATE INDEX idx_emails_status ON emails(status, atualizado_em);
