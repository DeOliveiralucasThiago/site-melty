# Loja Melty

Loja de velas aromáticas: site público + painel de administração, rodando no Cloudflare Pages (gratuito).

- `public/` — site (HTML, CSS, JS) e painel (`public/admin/`).
- `functions/` — código de servidor (Cloudflare Pages Functions): API pública e API do painel.
- `migrations/` — estrutura do banco de dados (Cloudflare D1).
- `seed/` — dados iniciais (as 11 velas, categoria, banner provisório e textos) e o gerador do `seed.sql`.

## O que o painel controla (`/admin/`)
Produtos (preço, estoque, descrição, fotos, categoria, "novidade" e "mais vendida"), categorias (viram menu),
banners do carrossel, textos e contato, benefícios, "Quem somos" e depoimentos. As fotos são reduzidas no
navegador e guardadas no próprio banco (sem serviço extra, sem cartão cadastrado).

## Rodar no computador (teste)
```bash
npm install
cp .dev.vars.example .dev.vars      # edite a senha e o segredo
npm run db:local                    # cria o banco local e carrega os dados iniciais
npm run dev                         # http://localhost:8788  (painel em /admin/)
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
   e `SESSION_SECRET` (texto aleatório com 32+ caracteres).
5. Domínio: Pages > Domínios personalizados > `meltyvelas.com.br`.

## Segurança do painel
- Senha única guardada como segredo (nunca no código); sessão em cookie assinado, `HttpOnly`, `SameSite=Strict`, 12 h.
- Bloqueio de 15 min após 5 senhas erradas seguidas.
- Alterações exigem cabeçalho próprio e mesma origem (contra requisições forjadas).
- Fotos validadas pelo conteúdo (JPG/PNG/WebP, até 1 MB); SVG é recusado.
- Painel com política de conteúdo restrita (`public/_headers`).

## Próximas fases
Pagamento (Fase 3), frete pelo Melhor Envio (Fase 4), e-mails automáticos (Fase 5).
