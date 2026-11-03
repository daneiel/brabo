# ADR 0245 — Acesso rápido por papel só no ambiente local

- **Status:** aceito
- **Data:** 2026-11-03
- **Referencia:** os ADRs [0031](0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) e [0032](0032-corte-do-keycloak-e-sessao-em-cookie.md) (a sessão e o cookie), [0073](0073-o-caminho-publicado-nomeia-o-ambiente.md) (o vocabulário `dev`/`prd`), [0119](0119-imagens-publicadas-no-ghcr-por-digest.md) (as imagens publicadas) e [0155](0155-a-primeira-conta-nasce-no-terminal.md) (RN-546). Nenhum deles é editado.

## Contexto

O dono (AT-722, 03/11) pediu uma caixa de diálogo na tela de login em que
escolher um papel já entra, para o desenvolvimento e para o TP-01 na instalação
construída nesta máquina. Produção é tudo que sai por GitHub Actions. Uma porta
que emite sessão sem credencial é fronteira de autenticação: precisa de barreira
que não dependa de lembrar de desligá-la.

## Decisão

1. **Uma variável de ambiente, três valores.** `BRABO_AMBIENTE` na api e
   `VITE_BRABO_AMBIENTE` no web (o Vite só expõe `VITE_*`): `dev` (Actions na
   `dev`), `prd` (Actions na `main` e tags de release) e `local` (só fora das
   Actions). O acesso rápido existe **só com `local`**; ausente, vazio ou
   qualquer outro valor, não existe.
2. **Quatro camadas.**
   - Build: `AMBIENTE` no `docker-bake.hcl` (default vazio) vira build-arg
     `BRABO_AMBIENTE` (api) e `VITE_BRABO_AMBIENTE` (web); no web o ramo morto
     some do bundle, sem chunk.
   - Arquivo da imagem: o Dockerfile da api grava `/app/AMBIENTE_DA_IMAGEM`
     (`environment:` do compose sobrescreve `ENV`, não arquivo).
   - Runtime: o predicado `acessoRapidoLigado` exige a variável `local` E o
     arquivo ausente (`pnpm dev`) ou `local`; o módulo só é registrado assim,
     e fora disso as rotas dão 404. `NODE_ENV` não entra: a instalação roda
     `production`.
   - Provas: spec do predicado, spec do módulo, `scripts/ci/ambiente-nas-actions.spec.ts`
     (nenhum workflow liga `local`), passos do `docker/smoke.sh` e teste do E2E.
3. **Produção é tudo que sai por Actions**: `ci.yml` passa `dev` ou `prd` pela
   base da PR e o `release.yml` passa `prd`. O `install.sh` não muda; o TP-01
   liga o `local` pelo runbook.
4. **Contas `<papel>@brabo.dev`** (`owner`, `maintainer`, `developer`,
   `viewer`, o `ROLE_ORDER`). `POST /auth/dev-login { papel }` resolve só essas
   contas, nunca e-mail livre, e emite a sessão pelo mesmo `EmitirSessaoUseCase`
   do login. Na instalação a rota garante as contas pelo núcleo
   `ProvisionarUsuarioUseCase` com senha ALEATÓRIA descartada, num workspace
   próprio ("acesso rápido (local)"), sem acesso aos projetos reais. A RN-546
   fica intacta: não há senha conhecida e o seed segue recusando produção.
   Sem usuário na instalação, 409 (a `first-account` cria a primeira conta).
5. **Bind em `127.0.0.1`.** Com `local`, as portas da api e do web da
   instalação ficam presas a `127.0.0.1` (`BRABO_BIND`).
6. `dev@brabo.dev` do seed passa a `developer@brabo.dev`.

## Consequências

- Riscos declarados: com `local`, quem alcança a porta entra como qualquer
  papel (por isso o bind); a rota não tem rate limit nem CSRF, como o
  `/auth/login`, e a defesa é ela não existir fora de `local`; imagem
  construída à mão com `AMBIENTE=local` é local por definição; um banco semeado
  antes mantém o `dev@brabo.dev` órfão até o próximo reset.
- A rota não aparece no `route-surface.spec` nem no `openapi.json`; fica na
  prosa de `docs/security-surface.md`.
