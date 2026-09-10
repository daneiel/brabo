# Brabo — Revisão externa e melhorias priorizadas

**Data:** 2026-08-28 · **Base:** working tree local (`~/dev/brabo`, v3.1.0)
**Escopo lido:** estrutura completa do monorepo; README, AGENTS/CLAUDE.md, `docs/architecture.md` (incl. dívida declarada), `docs/explanation/backlog.md`, `ci.yml`, `release.yml`, composes de dev/prod, os quatro `Dockerfile.prod`, `pnpm-workspace.yaml`, `mix.exs`, `main.ts`/`app.module.ts` da api, `auth.ts`/`guard.ts`/`index.ts` do runner, `packages/shared`, `.env*`, `.gitleaks.toml`, `.trivyignore.yaml`, manifests k8s.

## Leitura geral

O repositório está num nível de disciplina raro: dívida técnica declarada em tabela própria, backlog triado com critério explícito, RNs com `arquivo:linha` e teste, CI que se defende de falso-verde, imagens non-root com rootfs read-only, segredos que recusam boot com valor de exemplo, e comentários que registram o *porquê* de cada decisão. As melhorias abaixo não são correções de descuido — são o próximo degrau de um projeto que já subiu os anteriores.

Separei em dois grupos: **achados novos** (o que uma revisão de fora enxerga e os docs ainda não registram) e **dívidas já declaradas repriorizadas** (onde só acrescento urgência/ordem). Custo na escala do próprio backlog: **P** (uma sessão), **M** (fase pequena), **G** (fase própria, com ADR).

---

## Ranking

| # | Melhoria | Tipo | Impacto | Custo |
|---|---|---|---|---|
| 1 | Checksum nos binários baixados pelo CI + actions pinadas por SHA | novo | alto (supply chain) | P |
| 2 | Pinar `ollama/ollama:latest` nos dois composes | novo | alto | P |
| 3 | Publicar imagens em registry → deploy prod executável ponta a ponta | declarada (ADR 0027) | alto | M |
| 4 | Gerar os tipos do web a partir do OpenAPI que a api já exporta | novo (ataca dívida declarada) | alto | M |
| 5 | E2E de navegador (Playwright) do fluxo crítico | novo | alto | M |
| 6 | Decompor `SessionPage.tsx` (173 KB) e `ProjectSettingsTab.tsx` (92 KB) | novo | médio-alto | G |
| 7 | Dividir `schema.ts` por agregado | declarada | médio | M |
| 8 | Asserção de versões pinadas: `ci.yml` ↔ `Dockerfile.prod` | novo | médio | P |
| 9 | Piso de cobertura de teste no CI | novo | médio | P–M |
| 10 | Dividir `business-rules.md` (650 KB) e gerar as contagens em prosa | novo | médio | M |
| 11 | Unificar AGENTS.md/CLAUDE.md por geração ou symlink + check | novo | médio | P |
| 12 | Higiene: Keycloak no `.env`, `spike/`, `design_handoff_brabo/`, Neo4j exposto | novo | baixo | P |
| 13 | Dev containers sem root (uid mapeado) | novo | baixo | M |
| 14 | Isolar `website/` do audit do produto (lockfile próprio) | novo | baixo | M |
| 15 | Reafirmação do backlog vivo (itens que valem puxar já) | declarada | — | — |

---

## Achados novos

### 1. Cadeia de suprimentos do CI: binários sem checksum, actions por tag

O `Dockerfile.prod` do engine baixa binários "com checksum verificado" — mas o `ci.yml` não: gitleaks, hadolint, actionlint, kustomize e kubeconform entram por `curl` direto do GitHub Releases sem verificação de SHA-256. Um release comprometido upstream entra no runner que tem acesso ao código e (no `release.yml`) a credenciais. Pelo mesmo raciocínio, as actions estão pinadas por tag (`actions/checkout@v4`, `aquasecurity/trivy-action@v0.36.0`) — tag é mutável; SHA não. É exatamente a disciplina que o repo já aplica em pnpm (`allowBuilds`, overrides com faixa) e que falta só aqui. Custo P: uma tabela `VERSÃO → SHA256` no topo do workflow e `sha256sum -c` após cada download; `pin-github-action` ou Dependabot para os SHAs das actions.

### 2. `ollama/ollama:latest` é a única imagem sem pin

Dev e prod-compose sobem `ollama/ollama:latest` — num repositório onde até a versão do formatador Elixir é load-bearing, é a exceção que contradiz a regra. `latest` muda o comportamento do provider local silenciosamente entre `docker compose pull`s. Custo P: pinar tag (e idealmente digest), com o mesmo comentário-padrão do resto.

### 3. Gerar `api-types.ts` do OpenAPI em vez de copiar à mão

A dívida declarada ("o contrato api↔engine está em 4 arquivos"; "a union `ActionType` é uma cópia, e cópia envelhece — já divergiu duas vezes em produção") tem uma saída que o repo já pagou metade: `apps/api/src/scripts/export-openapi.ts` existe e os 23 controllers estão anotados. Gerar os tipos consumidos pelo web (`openapi-typescript` ou similar) num passo `pnpm --filter api openapi:types`, com um check no CI que reprova drift (mesmo padrão do `gerar:areas`), elimina a classe inteira de bug em vez de detectá-la caso a caso via `aprovacoes.test.ts`. O lado engine (contrato interno) pode entrar depois, com um JSON de contrato versionado — mas só o lado web já paga o investimento.

### 4. Não há E2E de navegador

A pirâmide está forte embaixo (142 specs na api, 126 no engine, componente a componente no web) e no smoke de API (`smoke.sh` faz login → workspace → projeto → sessão por HTTP). O que nenhuma camada exercita é o navegador de verdade: login com cookie httpOnly + CSRF, o canal Phoenix com ticket de uso único, aprovação inline, streaming. São exatamente as integrações que os testes com jsdom não conseguem provar (o próprio `main.ts` registra: "teste não faz preflight"). Um Playwright mínimo — um fluxo feliz, rodando contra o compose que o CI já sobe no job `images` — fecharia o buraco onde os últimos bugs de CORS/cookie/socket apareceram. Custo M.

### 5. Arquivos-monólito no web

`SessionPage.tsx` tem **173 KB** (com ~25 arquivos de teste apontando para ele), `ProjectSettingsTab.tsx` 92 KB, `api-client.ts` 48 KB. É a mesma anatomia do `schema.ts` que a dívida declarada já reconhece: todo ajuste na tela de sessão passa pelo mesmo arquivo, e conflito é garantido no dia em que houver uma segunda pessoa. Sei da regra "não refatorar fase concluída sem pedido explícito" — por isso a proposta é uma fase própria, com corte declarado: extrair do `SessionPage` as unidades que os próprios testes já nomeiam (carrossel, perguntas estruturadas, handoff/colapso, readiness, painel/agrupamento), sem mudar comportamento, teste a teste. Custo G, mas o custo de esperar cresce com cada RN nova que aterrissa lá.

### 6. Asserção de pin cruzado ci.yml ↔ Dockerfiles

O comentário no `ci.yml` diz "mesmas versões pinadas do docker/engine/Dockerfile.prod — divergir daqui significa testar contra um scanner diferente do que roda em produção". Hoje isso é mantido por disciplina humana; o repo tem vários passos baratos de asserção por grep (HPA, WEB_ORIGIN, métricas) e este está faltando: um passo que extrai `GITLEAKS_VERSION` etc. dos dois lados e reprova divergência. Custo P, no estilo da casa.

### 7. Cobertura sem piso

O CI roda as três suítes mas não mede cobertura. Não proponho meta alta — proponho o mecanismo: `vitest --coverage` + `mix test --cover` com piso no valor **atual** (ratchet), para que regressão de cobertura apareça como diff e não como surpresa. Custo P–M.

### 8. Docs: o monólito de 650 KB e as contagens que envelhecem

`business-rules.md` tem 650 KB e as RNs já passam de 460 — mas o README ainda diz "as 158 RNs" (e "115 decisões" nos ADRs, com ADR 0116 existindo). O repo já resolveu esse problema uma vez: `readme-version.ts` escreve a versão em prosa para ela não envelhecer. Vale estender o mesmo mecanismo às contagens (RNs, ADRs, providers) e dividir `business-rules.md` por domínio (auth, ações, gates, sessões…) mantendo âncoras — o `docmap`/`docs:check` existem justamente para bancar uma divisão dessas sem link quebrado. Também melhora o tempo de build/busca do Docusaurus. Custo M.

### 9. AGENTS.md e CLAUDE.md são duas cópias do mesmo arquivo

Mesmo tamanho, byte a byte — mantidos em sincronia à mão. O documento que "é o único lido em TODA sessão" é o pior lugar para uma cópia divergir em silêncio. Symlink (se o tooling dos agentes seguir), ou um gerado do outro com check no `docs:check`. Custo P.

### 10. Higiene de repositório

- `.env` local ainda carrega o bloco `KEYCLOAK_*` — Keycloak saiu na Fase 7; e `migrate-keycloak-users.ts` segue em `src/scripts/` (se for manter por história, um comentário de aposentadoria resolve).
- `spike/session-engine` e `design_handoff_brabo/` (31 KB de README + screenshots) na raiz: candidatos a `docs/` ou a arquivamento — a raiz é a primeira impressão do repo.
- `erl_crash.dump` em `apps/engine` no disco (confira se o `.gitignore` do engine cobre).
- No `docker-compose.prod.yml`, o Neo4j publica 7474/7687 no host — nenhum cliente fora da rede do compose precisa; bind em `127.0.0.1:` ou remover o publish.

### 11. Dev containers como root

O README documenta o workaround (`sudo chown -R …`). Mapear o uid do host (`user: "${UID}:${GID}"` + build arg) elimina a classe do problema — inclusive o EACCES que motivou o `verifyDepsBeforeRun: false`. Custo M, qualidade de vida diária.

### 12. `website/` dentro do workspace do produto

Dos 13 overrides de segurança no `pnpm-workspace.yaml`, a maioria vem da subárvore Docusaurus/openapi-docs — dependências que nunca chegam a nenhuma imagem de produto, mas poluem o `pnpm audit` do workspace e exigem manutenção contínua. Um lockfile próprio para `website/` (fora do workspace, instalado só no `docs-deploy`) encolhe o audit do produto para o que de fato embarca. Tradeoff real: perde-se o install único; vale decidir com ADR curto.

---

## Dívidas já declaradas — repriorização

- **Registry de imagens (ADR 0027)** é, na minha leitura, a dívida declarada mais cara: enquanto o overlay prod aponta para `ghcr.io/OWNER/*`, "deploy de produção executável ponta a ponta" continua falso, e tudo que depende dele (rollout real, restore real em prod, code-signing do runner) fica atrás. O `release.yml` já assa `BRABO_VERSION` — publicar no GHCR no mesmo workflow é o passo que falta.
- **`schema.ts` (35 tabelas, arquivo mais alterado do repo)**: o Drizzle aceita schema multi-arquivo com re-export; a migração é mecânica e o risco baixo. Vale antes do segundo colaborador, não depois.
- **Gates sem regressão semântica (ADR 0020)**: continua verdade que o caminho semântico do gate não tem cobertura automatizada. Um golden-set pequeno (5–10 casos com saída esperada frouxa, rodando com modelo pinado, `allow-failure` no começo) transformaria "a demo depende do juízo de um 7B" em sinal de tendência.
- **Do backlog vivo, o que eu puxaria primeiro:** a primeira tag que exercita `build-runner-binaries.yml` nas 4 plataformas restantes (o risco declarado do Windows só se resolve executando); `NPM_TOKEN` (o publish hoje avisa e pula — o canal npm anunciado não existe de fato); e a calibração do chunking/pesos do RAG contra um corpo real de perguntas (ADR 0080 declara que os números atuais são chute inicial).

## O que eu explicitamente NÃO recomendo

Mexer na política de aprovação/tetos (o desenho é o produto), trocar peças da stack (decidida, com ADR), ou "consertar de passagem" os achados Z/AD/AE — o repo tem razão em tratá-los como decisão de produto, e a disciplina de não apagar evidência vem se pagando desde a Fase 10.

---

*Revisão feita por leitura estática (sem executar suítes). Os tamanhos citados são do working tree em 2026-08-28.*
