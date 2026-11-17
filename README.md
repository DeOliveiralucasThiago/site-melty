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
- Painel > Pedidos: lista, dados de entrega, etapas (produção → enviado com rastreio → entregue), cancelar/reembolsado e alertas de conferência
  (CPF de quem pagou diferente, valor menor, pagamento depois de vencer).
- **Provedor de pagamento** (`functions/_lib/pagamento.js`): `PAGAMENTO_PROVEDOR=teste` ativa um pagamento simulado (só desenvolvimento, nunca em produção).
  **Mercado Pago ainda não está ligado**: falta validar na documentação oficial, com credenciais de teste, a assinatura do aviso (webhook),
  o formato do pagamento (inclui CPF do pagador?) e qual API usar (Preferences x Orders). Sem provedor, a loja mantém o botão de WhatsApp.
- Frete: valor fixo provisório (Painel > Textos e contato) até o cálculo por CEP da Fase 4.

## E-mails automáticos (Fase 5)
Cada mudança do pedido grava um e-mail numa **fila** (`emails`) e o envio acontece em seguida, com nova tentativa se falhar (a cada 5 min, até 5 vezes;
e-mail com mais de 1 dia é descartado). Uma falha de e-mail nunca derruba o pedido. Cada tipo sai **uma vez por pedido**.
Tipos: recebido, pago, enviado (com rastreio), entregue, cancelado, expirado e reembolsado. Em produção ("em produção") não há e-mail.
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
1. Criar o banco: `npx wrangler d1 create melty` e colocar o `database_id` no `wrangler.toml`.
2. Criar as tabelas e os dados iniciais no banco real:
   ```bash
   npx wrangler d1 migrations apply melty --remote
   npx wrangler d1 execute melty --remote --file seed/seed.sql
   ```
3. No Cloudflare: Workers e Pages > Criar > Pages > conectar este repositório (branch `main`).
   Comando de build: vazio. Pasta de saída: `public`.
4. Em Configurações > Variáveis e segredos (como **segredos**): `ADMIN_PASSWORD` (mínimo 8 caracteres, use uma senha forte)
   `SESSION_SECRET` e `HASH_SECRET` (textos aleatórios diferentes, com 32+ caracteres cada).
5. Domínio: Pages > Domínios personalizados > `meltyvelas.com.br`.

## Segurança do painel
- Senha única guardada como segredo (nunca no código); sessão em cookie assinado, `HttpOnly`, `SameSite=Strict`, 12 h.
- Bloqueio de 15 min após 5 senhas erradas seguidas.
- Alterações exigem cabeçalho próprio e mesma origem (contra requisições forjadas).
- Descrições passam por uma limpeza no servidor (`functions/_lib/html.js`): só formatações permitidas e as cores exatas da marca; scripts, estilos e links que não sejam https são removidos.
- Fotos validadas pelo conteúdo (JPG/PNG/WebP, até 1 MB); SVG é recusado.
- Painel com política de conteúdo restrita (`public/_headers`).

## Próximas fases
Ligar o Mercado Pago (Fase 3, pendente de credenciais e conferência da documentação), frete pelo Melhor Envio (Fase 4), e-mails automáticos (Fase 5).
