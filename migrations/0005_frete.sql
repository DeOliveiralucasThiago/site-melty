-- Frete: medidas por produto (embalado) e a escolha de entrega gravada no pedido

ALTER TABLE produtos ADD COLUMN altura_cm REAL;        -- vazio = usar a caixa padrão (config embalagem_padrao)
ALTER TABLE produtos ADD COLUMN largura_cm REAL;
ALTER TABLE produtos ADD COLUMN comprimento_cm REAL;

ALTER TABLE pedidos ADD COLUMN frete_id TEXT NOT NULL DEFAULT '';
ALTER TABLE pedidos ADD COLUMN retirada INTEGER NOT NULL DEFAULT 0;     -- 1 = retirada no local (sem endereço de entrega)
ALTER TABLE pedidos ADD COLUMN frete_prazo_dias INTEGER;   -- previsão de entrega em dias úteis (transporte + margem), contada a partir do envio
