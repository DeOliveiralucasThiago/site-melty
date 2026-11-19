# Loja Melty

Loja de velas aromáticas: site público + painel de administração, rodando no Cloudflare Pages (gratuito).

- `public/` — site (HTML, CSS, JS) e painel (`public/admin/`).
- `functions/` — código de servidor (Cloudflare Pages Functions): API pública e API do painel.
- `migrations/` — estrutura do banco de dados (Cloudflare D1).
- `seed/` — dados iniciais (as 11 velas, categoria, banner provisório e textos) e o gerador do `seed.sql`.

## O que o painel controla (`/admin/`)
Produtos (preço, estoque, descrição com formatação — negrito, itálico, listas, subtítulo, link e as cores da marca —, fotos, categoria, "novidade" e "mais vendida"), categorias (viram menu),
banners do carrossel, **preço promocional** (por produto, com datas, ou em porcentagem para uma categoria inteira), **cupons de desconto**, textos e contato, benefícios, "Quem somos" e depoimentos. As fotos são reduzidas no
navegador e guardadas no próprio banco (sem serviço extra, sem cartão cadastrado).

## Preços e cupons (regras no servidor)
`functions/_lib/cupons.js` calcula o pedido: o navegador só diz quais produtos, quantas unidades e o cupom; o servidor
recalcula tudo. Regras: 1 cupom por pedido; 1 uso por CPF (o próprio banco impede repetição, mesmo em
pedidos simultâneos); limite total de usos; reserva por 30 min enquanto o pagamento está pendente (vence sozinha);
"primeira compra" = CPF que ainda não pagou nenhum pedido; cupom não vale sobre item já em promoção
(salvo opção marcada). O controle é só pelo CPF (e-mail e endereço não bloqueiam: CPFs diferentes são pessoas diferentes),
guardado só como código embaralhado (HMAC com `HASH_SECRET`), nunca aberto.
Na Fase 3, o pedido deve chamar `calcularPedido` → `reservarCupom` ao criar e `confirmarUso`/`liberarUso` ao pagar/cancelar.

## Pedidos e pagamento (Fase 3)
Fluxo: carrinho → `checkout.html` (dados, endereço, cupom) → `POST /api/pedidos` → cliente vai pagar no provedor → o provedor avisa → `aplicarPagamento()`.
- O servidor recalcula tudo (preço, promoção, cupom, frete) e **reserva o estoque e o cupom por 30 min**. Se não pagar, o pedido vence e tudo volta
  (a limpeza roda sozinha quando alguém acessa a loja ou o painel). O estoque nunca fica negativo (o banco recusa) mesmo com compras simultâneas.
- Cliente acompanha em `pedido.html?t=<código secreto de 32 caracteres>` (sem CPF, e-mail, telefone ou endereço completo na tela).
- Painel > Pedidos: lista, dados de entrega, etapas (em preparo → enviado com rastreio → entregue), cancelar/reembolsado e alertas de conferência
  (CPF de quem pagou diferente, valor menor, pagamento depois de vencer).
- **Provedor de pagamento** (`functions/_lib/pagamento.js`): `PAGAMENTO_PROVEDOR=teste` ativa um pagamento simulado (só desenvolvimento, nunca em produção).
  **Mercado Pago (API de Orders):** `PAGAMENTO_PROVEDOR=mercadopago` + segredos `MERCADOPAGO_ACCESS_TOKEN` e `MERCADOPAGO_WEBHOOK_SECRET`.
  O cliente paga na página `/pagar` do próprio site. **Pix** pronto e validado na API de testes (QR e copia e cola, vale 30 min, cancelado junto com o pedido vencido).
  O aviso (`/api/mercadopago/webhook`) tem a assinatura conferida e o estado vem sempre de uma consulta à API, nunca do corpo do aviso. Como reserva, abrir o
  acompanhamento do pedido também confere o pagamento. **Cartão de crédito** pelo formulário do Mercado Pago (os dados do cartão vão direto a ele; o servidor só recebe um código de uso único e usa valor, CPF e e-mail do pedido salvo). Recusa vem como HTTP 402 com a order dentro e vira mensagem amigável. Variáveis: `MERCADOPAGO_PUBLIC_KEY` (chave pública, não secreta; sem ela o cartão some) e `MERCADOPAGO_PARCELAS_MAX` (padrão 1). Só crédito, sem débito.
- **Frete (Fase 4, parte sem Melhor Envio):** o cliente informa o CEP e escolhe a entrega; o servidor monta o pacote a partir dos produtos (peso e medidas, ou a
  caixa padrão; itens empilhados) e cota por região (valor fixo por estado, configurado em Painel > Textos e contato), com opção de frete grátis acima de um valor.
  O estado vem do CEP (faixas em `functions/_lib/frete.js`, conferir antes de publicar). O prazo mostrado ao cliente é **único**: transporte + uma margem de dias (configurável, somada pelo sistema), **contado a partir do envio** (postagem). Não se fala em "produção" nem em prazo desde o pagamento para o cliente.
  O **Melhor Envio** entra no mesmo encaixe (`cotarFrete`), devolvendo opções no mesmo formato. Falta o token e conferir a documentação.

## Melhor Envio (frete e etiquetas)
Ligar em Painel > Textos e contato > "Melhor Envio" e preencher o **remetente** (o CEP de origem é usado na cotação; o resto, nas etiquetas). Variáveis (segredos no Cloudflare):
`MELHORENVIO_TOKEN` (token gerado no painel do Melhor Envio) e `MELHORENVIO_AMBIENTE` (`sandbox` = testes, padrão; `producao` = valendo). O botão **"Testar conexão"**
faz uma cotação de teste (não gasta nada) e mostra os serviços/preços ou o motivo do erro (ex.: token vencido).
- **Cotação:** o pacote real (peso e medidas do carrinho) é cotado como um só volume; usa `custom_price` e `custom_delivery_time` (conforme a documentação). O prazo mostrado
  = transporte + margem configurada, contado após o envio. Cotações ficam 10 min em cache (preço mostrado = preço cobrado). Se o Melhor Envio falhar, usa a tabela por região
  (se houver); sem tabela, o cliente é avisado e **nunca** recebe "frete grátis" por engano.
- **Etiquetas:** no detalhe do pedido pago (entrega Melhor Envio): "Gerar etiqueta" faz carrinho → **compra (debita o saldo da carteira)** → geração → rastreio; guarda o andamento, não
  compra duas vezes (trava contra clique duplo) e, se faltar saldo, continua de onde parou. Há "Imprimir" (link privado), "Buscar rastreio" e "Cancelar etiqueta" (estorno em até 12 h,
  segundo a documentação). Ao marcar como enviado, o rastreio da etiqueta vai no e-mail. A geração só funciona com "Permitir gerar etiquetas" ligado.
- **Validado no sandbox real (token de teste):** a cotação (resposta 200, campo `error` por serviço, `custom_price`/`custom_delivery_time`) funciona pelo código da loja. Descobertas:
  o sandbox/Melhor Envio **não aceita CEP genérico de cidade** (ex.: 29100-000) na origem nem no destino (use CEP de rua) e o token precisa das permissões de **carrinho**, compra,
  geração, impressão, rastreio e cancelamento (sem a de carrinho a criação da etiqueta dá 403). `node scripts/validar-melhorenvio.mjs` roda o fluxo completo no sandbox.
- **Status da validação (etiquetas):** escrito conforme a documentação oficial e testado com um servidor simulado; **ainda não validado no sandbox do Melhor Envio com token real**. Pontos a conferir
  lá: como pessoa física informa documento (`document` x `company_document`), `non_commercial`, e o formato da URL de impressão. O token do painel pode vencer: se aparecer
  "token recusado", gere outro.

## Retirada no local e avisos para a loja
- **Retirada:** Painel > Textos e contato > "Retirada no local" (ligar, endereço, instruções, e CEPs que podem retirar, se quiser limitar). No fechamento aparece como uma opção
  grátis; ao escolher, o cliente **não informa endereço**. Etapas: pago → em preparo → **pronto para retirada** (o painel envia o e-mail "sua encomenda está pronta para retirada
  no seguinte endereço…") → retirado. Pedido de retirada não pode ser "enviado" e pedido de entrega não pode ser "pronto para retirada".
- **Aviso para a loja:** Painel > Textos e contato > "Avisos por e-mail para a loja" (até 3 e-mails; ao pagar e, opcionalmente, ao criar o pedido). O e-mail traz cliente, telefone
  (link do WhatsApp), itens, entrega e total, e **responder vai direto para o cliente** (reply-to). Não leva CPF. Depende do envio de e-mails estar ativo (`EMAIL_PROVEDOR`).

## E-mails automáticos (Fase 5)
Cada mudança do pedido grava um e-mail numa **fila** (`emails`) e o envio acontece em seguida, com nova tentativa se falhar (a cada 5 min, até 5 vezes;
e-mail com mais de 1 dia é descartado). Uma falha de e-mail nunca derruba o pedido. Cada tipo sai **uma vez por pedido**.
Tipos: recebido, pago ("seu pedido será enviado em até X dias úteis", configurável), enviado (com rastreio), entregue, cancelado, expirado e reembolsado. "Em preparo" não envia e-mail.
Os e-mails não levam CPF nem endereço completo. No painel (Pedidos > detalhe) dá para ver, pré-visualizar e reenviar.
- `EMAIL_PROVEDOR=teste`: não envia, só marca "simulado". `EMAIL_PROVEDOR=resend`: usa o Resend (precisa de `RESEND_API_KEY` como **segredo**,
  `EMAIL_REMETENTE`, ex.: `Melty <pedidos@mail.meltyvelas.com.br>`, e um **domínio verificado** no Resend com registros SPF/DKIM). O plano gratuito
  do Resend tem 3.000 e-mails/mês e 100/dia (conferir na página de preços). O adaptador segue a documentação pública, mas **ainda não foi testado com chave real**.
- `SITE_URL` (opcional): endereço do site para os links dos e-mails; se faltar, usa o endereço em que o pedido foi feito.

## Rodar no computador (teste)
```bash
npm install
cp .dev.vars.example .dev.vars      # edite a senha e o segredo
npm run db:local                    # cria o banco local e carrega os dados iniciais
npm run dev                         # http://localhost:8788  (painel em /admin/)
npx wrangler pages dev --port 8788 --binding PAGAMENTO_PROVEDOR=teste --binding EMAIL_PROVEDOR=teste   # pagamento e e-mails simulados
npm test                            # testes do limpador de texto e do motor de preços/cupons (zera o banco local)
```

## Publicar no Cloudflare (quando o domínio estiver pronto)
1. Criar o banco: `npx wrangler d1 create melty` e colocar o `database_id` no `wrangler.toml` (hoje há um marcador).
2. Criar as tabelas e os dados iniciais no banco real:
   ```bash
   npx wrangler d1 migrations apply melty --remote
   npx wrangler d1 execute melty --remote --file seed/seed.sql
   ```
3. No Cloudflare: Workers e Pages > Criar > Pages > conectar este repositório (branch `main`). Comando de build: vazio. Pasta de saída: `public`.
   (A pasta `functions/` é detectada sozinha. O build das funções foi validado com `npx wrangler pages functions build functions`.)
4. Em Configurações > Variáveis e segredos, como **segredos**: `ADMIN_PASSWORD` (mín. 8 caracteres, forte), `SESSION_SECRET` e `HASH_SECRET`
   (textos aleatórios diferentes, 32+ caracteres cada) e, quando for o caso, `RESEND_API_KEY`. Como variáveis comuns: `SITE_URL` (ex.: `https://www.meltyvelas.com.br`),
   `EMAIL_PROVEDOR=resend`, `EMAIL_REMETENTE`. **Nunca** definir `PAGAMENTO_PROVEDOR=teste` nem `EMAIL_PROVEDOR=teste` em produção.
5. Domínio: Pages > Domínios personalizados > `meltyvelas.com.br`. Depois, no Resend, verificar o domínio de envio (registros SPF/DKIM no DNS).

### Checklist antes de abrir a loja
- [ ] Painel > Textos e contato: **regiões de entrega e preços**, prazo de produção, caixa padrão (e medidas dos produtos), WhatsApp, e-mail
- [ ] Painel > Páginas: revisar Privacidade, Prazos e Trocas e Devoluções (idealmente com contador/advogado)
- [ ] Fotos reais, logo, descrições, "Quem somos"
- [ ] Mercado Pago ligado e testado com credenciais de teste (compras aprovada, recusada, Pix pendente) antes de usar a conta real
- [ ] E-mails: domínio verificado e um pedido de teste recebido na caixa de entrada (não no spam)
- [ ] Conferir as faixas de CEP por estado (`functions/_lib/frete.js`) e o link de rastreio (Melhor Rastreio) com um código real
- [ ] Fazer um backup (Painel > Pedidos > Cópia de segurança) e combinar uma rotina semanal
- [ ] Formalização (MEI) e emissão de nota fiscal, conforme orientação do contador

## Compartilhamento e Google
O servidor monta as tags de pré-visualização (nome, preço e foto) para `/` e `/produto?id=...`, além de `sitemap.xml` e `robots.txt`, porque WhatsApp,
Instagram e Google não executam o JavaScript do site. Há também dados estruturados (Produto/Organização) para o Google.

## Segurança do painel
- Senha única guardada como segredo (nunca no código); sessão em cookie assinado, `HttpOnly`, `SameSite=Strict`, 12 h.
- Bloqueio de 15 min após 5 senhas erradas seguidas.
- Alterações exigem cabeçalho próprio e mesma origem (contra requisições forjadas).
- Descrições passam por uma limpeza no servidor (`functions/_lib/html.js`): só formatações permitidas e as cores exatas da marca; scripts, estilos e links que não sejam https são removidos.
- Fotos validadas pelo conteúdo (JPG/PNG/WebP, até 1 MB); SVG é recusado.
- Painel com política de conteúdo restrita (`public/_headers`).

## Próximas fases
Conferir o formulário de cartão no navegador após a publicação (Fase 3; Pix e cartão já passam nos testes do servidor), frete pelo Melhor Envio (Fase 4), e-mails automáticos (Fase 5).
