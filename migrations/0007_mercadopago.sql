-- Mercado Pago (API de Orders): dados do Pix guardados no pedido e controle da conferência de pagamento.
ALTER TABLE pedidos ADD COLUMN pix_codigo TEXT NOT NULL DEFAULT '';
ALTER TABLE pedidos ADD COLUMN pix_qr TEXT NOT NULL DEFAULT '';
ALTER TABLE pedidos ADD COLUMN pix_expira_em TEXT;
ALTER TABLE pedidos ADD COLUMN mp_checado_em INTEGER NOT NULL DEFAULT 0;
