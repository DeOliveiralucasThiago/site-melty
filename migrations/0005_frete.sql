-- Frete: medidas por produto (embalado) e a escolha de entrega gravada no pedido

ALTER TABLE produtos ADD COLUMN altura_cm REAL;        -- vazio = usar a caixa padrão (config embalagem_padrao)
ALTER TABLE produtos ADD COLUMN largura_cm REAL;
ALTER TABLE produtos ADD COLUMN comprimento_cm REAL;

ALTER TABLE pedidos ADD COLUMN frete_id TEXT NOT NULL DEFAULT '';
ALTER TABLE pedidos ADD COLUMN pacote_json TEXT;                          -- peso e medidas do pacote (usados na cotação e na etiqueta)
ALTER TABLE pedidos ADD COLUMN me_ordem_id TEXT NOT NULL DEFAULT '';      -- etiqueta no Melhor Envio
ALTER TABLE pedidos ADD COLUMN me_estado TEXT NOT NULL DEFAULT '';        -- '', carrinho, paga, gerada
ALTER TABLE pedidos ADD COLUMN me_erro TEXT NOT NULL DEFAULT '';
ALTER TABLE pedidos ADD COLUMN me_rastreio TEXT NOT NULL DEFAULT '';
ALTER TABLE pedidos ADD COLUMN me_travado_em TEXT;                        -- trava contra duas gerações ao mesmo tempo
ALTER TABLE pedidos ADD COLUMN retirada INTEGER NOT NULL DEFAULT 0;     -- 1 = retirada no local (sem endereço de entrega)
ALTER TABLE pedidos ADD COLUMN frete_prazo_dias INTEGER;   -- previsão de entrega em dias úteis (transporte + margem), contada a partir do envio

-- Cotações recentes do Melhor Envio (10 min): preço mostrado = preço cobrado, e menos chamadas à API
CREATE TABLE cotacoes_cache (
  chave TEXT PRIMARY KEY,
  resposta TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
