# Checklist da loja Melty

Marque cada item com `[x]` ao concluir. **Vocês** = itens que dependem de você e da sua esposa. **Claude** = itens que eu faço depois que os seus estiverem prontos.

Tokens e chaves **nunca** vão no chat: use o formulário seguro que eu abrir, ou cadastre como segredo no Cloudflare.

## Contas e acessos

_Bloqueiam as integrações. Tokens e chaves nunca vão no chat: use o formulário seguro que eu abrir ou cadastre como segredo no Cloudflare._

- [x] Mercado Pago: aplicação de teste criada (API de Orders) e Access Token de teste informado. Falta, para produção: conta de vendedora real verificada e credenciais de produção. _(bloqueia a publicação)_
- [ ] Ativar o plugin do Mercado Pago no Claude, com acesso limitado. A titular da conta autoriza. Leia a tela de permissões antes de aceitar. _(bloqueia a publicação)_
- [ ] Conferir as taxas e escolher as formas de pagamento (Pix, cartão, parcelamento). _(bloqueia a publicação)_
- [ ] Melhor Envio: criar a conta de testes (sandbox) e gerar um token de acesso. Contas de teste e de produção são separadas. _(bloqueia a publicação)_
- [ ] Colocar saldo na carteira do Melhor Envio (no teste e, depois, em produção). _(bloqueia a publicação)_
- [ ] Decidir quais serviços oferecer (PAC, SEDEX, Jadlog…) e se vão gerar etiquetas pelo painel.
- [ ] Resend (e-mails): criar a conta gratuita e verificar o domínio de envio. Exige adicionar registros SPF e DKIM no DNS do domínio. _(bloqueia a publicação)_
- [ ] Registrar meltyvelas.com.br e ter acesso ao DNS. Cerca de R$ 40 por ano no Registro.br. _(bloqueia a publicação)_
- [ ] Cloudflare: fazer a publicação com a minha orientação. A conta já existe. Falta o banco, os segredos (inclusive a senha forte do painel), o repositório e o domínio. _(bloqueia a publicação)_

## Dados e conteúdo

_Hoje o site tem fotos, descrições e textos provisórios._

- [ ] **Caixas e velas (medir e pesar antes de implementar o frete por caixa).** _(bloqueia a publicação)_
  - Caixas: uma montada de cada tamanho (para 1–2 velas, 3–4 e mais), com enchimento, como seria enviada. Anotar medidas **externas** (comprimento × largura × altura, em cm, arredondando para cima), peso da caixa vazia, peso da caixa cheia e quantas velas cabem de verdade.
  - Velas: peso de cada modelo/tamanho já embalado, medidas externas (diâmetro ou largura × altura) e se há mais de um tamanho à venda.
  - Decidir: faixas por quantidade (ex.: 1–2, 3–4, 5+; hoje “3 a 4” e “4+” se sobrepõem no 4) e o que fazer acima da maior caixa (dois volumes ou limite por pedido).
  - Conferir os limites dos Correios (mínimo 11 × 16 × 2 cm; maior lado até 105 cm; soma das três medidas até 200 cm).
  - Depois disso: implementar o cadastro de caixas no painel, escolha automática da menor caixa e cotação por caixa. O Melhor Envio não guarda caixas, então o cadastro é no painel da Melty.
- [ ] Fotos reais das velas, logo e banners. O banner atual é de teste e tem marca d’água. _(bloqueia a publicação)_
- [ ] Descrições reais das velas, estoque real e preços finais. Hoje as descrições dizem “Descrição completa em breve”. _(bloqueia a publicação)_
- [ ] Texto do “Quem somos” com a história real e, se houver, depoimentos reais. A seção de depoimentos fica escondida enquanto estiver vazia.
- [ ] Definir as categorias do lançamento (Wax Melts, Home Spray etc.) ou só velas.
- [ ] Confirmar os benefícios da faixa do topo (“Pix e cartão”, “Envio para todo o Brasil”). Só prometer o que valerá.
- [ ] Confirmar WhatsApp, Instagram e e-mail que aparecem no site.

## Decisões de funcionamento

- [ ] Definir os dias de margem somados ao transporte (hoje 3) e o prazo para enviar o pedido (hoje 2 dias úteis).
- [ ] Frete grátis a partir de algum valor? Quanto?.
- [ ] Retirada no local: oferecer ou não, e com qual endereço, horário e CEPs. Considerem se querem exibir o endereço de casa antes do pagamento.
- [ ] Escolher até 3 e-mails da loja para os avisos de pedido e se querem aviso também antes do pagamento.
- [ ] Se for usar frete por tabela de região (reserva ou no lugar do Melhor Envio): preços e prazos por estado.

## Jurídico e fiscal

- [ ] Revisar com contador ou advogado as páginas Política de Privacidade, Trocas e Devoluções e Prazos e Envio. São texto-base meu. _(bloqueia a publicação)_
- [ ] Formalização (MEI/CNPJ) e nota fiscal: conversar com um contador. Vender com regularidade como pessoa física tem implicações de imposto. Nota fiscal não está no site.

## Depois de publicado

- [ ] Fazer uma compra de teste completa e conferir se os e-mails chegam na caixa de entrada (não no spam). _(bloqueia a publicação)_
- [ ] Criar o hábito de baixar a cópia de segurança toda semana (botão no painel, aba Pedidos).

## Depende de mim

_Só começo depois que os itens acima estiverem prontos._

- [ ] Mercado Pago: **Pix pronto e testado na API de testes** (order, QR, expiração, cancelamento, webhook com assinatura, conferência de reserva). Falta o **cartão** (precisa da Public Key de teste e da biblioteca do Mercado Pago no navegador), configurar a URL e a chave secreta do webhook depois do deploy (`MERCADOPAGO_WEBHOOK_SECRET`) e conferir as taxas. _(Claude / você)_
- [ ] Validar o Melhor Envio no sandbox: documento da pessoa física, envio sem nota fiscal, link de impressão e rastreio. Depende de: token e saldo de teste. _(Claude)_
- [ ] Validar o envio real de e-mails com a chave do Resend. Depende de: conta e domínio verificado. _(Claude)_
- [ ] Conferir as faixas de CEP por estado com fonte oficial e o link de rastreio com um código real. _(Claude)_
- [ ] Publicar: banco, tabelas, dados iniciais, segredos, repositório e domínio; confirmar o tamanho das fotos no banco e os limites gratuitos. Depende de: domínio, Cloudflare e segredos. _(Claude)_
- [ ] Teste final no site publicado e revisão de segurança. _(Claude)_

## Limitações conhecidas (não bloqueiam)

- O reembolso é feito no painel do Mercado Pago; o botão do painel da loja só registra que foi feito.
- A aprovação de um Pix no ambiente de testes não pode ser simulada sem um pagador de teste real; o caminho “pago” é coberto por testes automáticos com a resposta simulada da API. A primeira compra real vai confirmar o fluxo ponta a ponta.
- Alterações no painel podem levar até 20 segundos para aparecer na loja (cache).
- Fora do escopo por enquanto: nota fiscal, newsletter, conta de cliente com “Meus pedidos”, WhatsApp automático e etiquetas de outras transportadoras fora do Melhor Envio.

## Ordem sugerida

1. Em paralelo: conta e aplicação de teste do Mercado Pago, token e saldo do Melhor Envio, registro do domínio, conta no Resend, medidas da caixa, fotos, logo e textos.
2. Quando as contas chegarem: integrações reais, com ambientes de teste.
3. Por último: contador, publicação, compra de teste real e abertura da loja.
