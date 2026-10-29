> Parte do `CLAUDE.md` da raiz, importada por ele e lida em toda sessão.
> Edite aqui; o `CLAUDE.md` só guarda o índice das partes.

## Stack (decidida — não proponha alternativas)
- `apps/api`: NestJS 11 + Drizzle ORM + PostgreSQL 16 + pgvector;
  `nodemailer` para SMTP real do `MailSender` (ADR 0096), atrás de
  `MAIL_TRANSPORT` — `log` continua o default, inclusive em produção;
  `neo4j-driver` para o grafo de conhecimento (ADR 0099) — memória
  DERIVADA do event log, nunca fonte de verdade, e por isso SEM backup (ADR
  0152): o caminho de volta é `pnpm --filter api grafo:reprojetar` (RN-569),
  que chama o MESMO `GraphEventTranslator` do projetor vivo — tipo novo
  projetado ganha tradução ALI, nunca num segundo tradutor — e não toca a
  outbox dele; `PromptTemplate` não vem do event log e volta por
  `scripts/dev/seed-prompts.ts`; pgvector CONTINUA sendo
  o índice vetorial dos chunks, o grafo não guarda embedding; a pasta `docs/`
  dos artefatos (ADR 0148) é a SEGUNDA projeção derivada e tem o mesmo
  caminho de volta — `pnpm --filter api artefatos:reprojetar` (RN-590), pelo
  MESMO `ArtifactEventTranslator` do `ArtifactProjector`, sem backup, sem tocar
  a outbox e sem apagar nada
- `apps/engine`: Elixir/OTP + Phoenix (canais) + Oban (filas no Postgres) —
  Elixir 1.20.4 / OTP 29.1.1 sobre Alpine 3.24 (builder 3.24.2, runtime 3.24.3, a mesma musl 1.2.6) em dev, produção e CI (ADR
  0209): OTP abaixo de 29.1 aborta no boot sob musl ≥ 1.2.6 em host com AMX
  (`sys_sigaltstack`, erlang/otp#11349) — não desça o OTP sem descer a musl
- `apps/web`: React 19 + Vite + TanStack Query/Router; `react-i18next`+
  `i18next` (fundação de i18n, RN-432) atrás de `lib/i18n.ts`/`lib/idioma.ts`
  — `pt-BR` é o padrão, o `fallbackLng` e a FONTE da paridade (ADR 0216,
  RN-891), com os quatro locales `pt-BR`, `en`, `ru` e `zh-Hans` (os catálogos
  de `ru`/`zh-Hans` chegam em rodada própria; sem pasta, a tela cai no pt-BR),
  servidor é a fonte de verdade
  (`localStorage` só evita flash no primeiro paint); `mermaid` (runtime,
  ADR 0068) para o diagrama C4 do Arquiteto, isolado atrás de
  `lib/mermaid-render.ts` com `import()` dinâmico; `@xterm/xterm` +
  `@xterm/addon-fit` (ADR 0103) para o terminal interativo do runner
  local, isolado atrás de `lib/xterm-runtime.ts` com `import()` dinâmico.
  `motion` (ADR 0210) para a animação de texto em curso, isolado atrás
  de `components/ui/Shimmer.tsx` (`LazyMotion` + `domAnimation`, nenhum
  outro arquivo o importa) e em grupo de vendor próprio `vendor-motion` em
  `codeSplitting.groups`, fora da carga inicial.
  Toda TELA é chunk próprio (`lazyRouteComponent` no `router.tsx`, com o
  `.preload` que o router espera), e os painéis das abas do projeto também
  (`React.lazy` em `project-tabs.ts`) — o `Shell` fica estático. Vendors de
  toda tela vão em `codeSplitting.groups` do `vite.config.ts` por lista de
  PERMITIDOS: um grupo genérico de `node_modules` puxaria `mermaid`/`xterm`
  para o bundle inicial (AT-300)
- `apps/runner`: CLI `brabo-runner` na máquina do usuário (ADR 0103). As regras
  dele moram em `.claude/rules/runner.md`, carregadas quando a sessão lê `apps/runner/`,
  `packages/docker-port/`, `apps/engine/lib/engine/runners/` ou o `install.sh`.
- `apps/broker` e `packages/docker-port`: o único processo com o socket do Docker
  no servidor (ADR 0130). As regras moram em `.claude/rules/broker-e-containers.md`.
- `e2e/`: E2E de NAVEGADOR (Playwright, só chromium — ADR 0120), a quarta
  camada da pirâmide. Roda contra o compose de PRODUÇÃO (`docker/smoke.sh`
  com `SMOKE_KEEP_UP=1`), nunca contra o `vite dev`: o que ele prova —
  refresh em cookie `httpOnly`, CSRF em origem cruzada `:8088`→`:3000`,
  ticket de uso único do socket (RN-108) contra o engine numa TERCEIRA
  origem — só existe quando as três origens são distintas, e jsdom não
  alcança nenhuma delas. NÃO é membro do workspace (mesmo desenho do
  `website/`, ADR 0117): lockfile próprio, `pnpm --dir e2e`, nunca
  `pnpm --filter`. Seletor é ESTRUTURAL, nunca texto (o idioma é decisão do
  servidor), e a asserção é sobre MECANISMO, nunca sobre tela
- Monorepo pnpm (TS) com apps/engine Elixir ao lado; Docker Compose para dev.
  `website/` NÃO é membro do workspace (ADR 0117) — lockfile próprio em
  `website/pnpm-workspace.yaml`/`website/pnpm-lock.yaml`, instalado com
  `pnpm install` de DENTRO de `website/`, nunca `pnpm --filter website` (usa
  `pnpm --dir website` nos scripts `docs:*`). Isola o `pnpm audit` do
  produto da árvore do Docusaurus, que nunca chega a imagem nenhuma.
  Dependência vulnerável TRANSITIVA se fecha por `overrides` — e eles moram em
  `pnpm-workspace.yaml` (raiz) e `website/pnpm-workspace.yaml`, NUNCA em
  `package.json`: já são vinte e cinco na raiz e vinte e seis no website, cada um com o
  advisory e o caminho do `pnpm why` no comentário ao lado. Duas disciplinas,
  escritas no topo do arquivo: a chave é a FAIXA VULNERÁVEL do aviso (nunca a
  versão instalada hoje) e a faixa é presa à LINHA MAIOR afetada. Faixa que já
  existe e ganha advisory nova sobe de TETO — não nasce entrada nova —, e sobe
  nos DOIS arquivos junto quando é MISTA, senão o lado esquecido volta a
  resolver a faixa vulnerável em silêncio. O painel do Dependabot mede a
  branch DEFAULT (`main`); quem mede a `dev` é o `pnpm audit` local, e ele já
  achou advisory que o painel ainda não tinha aberto — leia os dois, nessa
  ordem. Override que QUEBRA o consumidor não entra: mede-se e declara-se.
  Foi o caso do `@faker-js/faker@5.5.3`, pinado EXATO pelo `postman-collection`
  do plugin OpenAPI, sem versão de saída (medido na AT-359): a saída foi trocar
  o plugin pelo Redocusaurus (ADR 0206), não forçar o override
- Auth: first-party no domínio da api (argon2id + access JWT curto +
  refresh opaco com rotação); autorização RBAC no domínio da api
  (inalterada desde a Fase 1)
- LLM: roteador na api com suite de contrato; base OpenAI-compatível
  sobre node:http (timeout de inatividade, erro por `code`,
  capabilities em duas camadas — ADR 0041); catálogo com curadoria e
  preço congelado no metering (ADR 0042) — que desde o ADR 0188 só é o
  número quando a resposta NÃO traz o custo real: o `usage.cost` do
  OpenRouter vence, com `price_implicit` marcando a linha (a MESMA coluna
  do Jev) e o do catálogo ao lado em `catalog_cost_micros`, RN-665; 11 providers (ADR 0043); o 10º é o 9Router (ADR 0222) e o 11º o OpenCode Zen (ADR 0227); o Jev
  (`typesafe/jev-1.13`, Decisions API do OpenRouter) escolhe o menu de
  ferramentas de cada passo por uma porta PRÓPRIA, `ToolRouter`, fora do
  `LLMProviderRegistry` e do catálogo `models` (ADR 0179, RN-625): só com
  provider OpenRouter, só RESTRINGE (P3), ligado por padrão por workspace, e
  qualquer falha dele deixa o catálogo inteiro — o turno nunca falha por causa
  dele, e ele não aprova, não nega nem escolhe modelo
- Deploy: Kubernetes (k3d/kind em validação local). As cinco imagens de
  produção são PUBLICADAS no GHCR a cada tag final, públicas e por digest
  (ADR 0119; a quinta, o broker, desde o ADR 0162) — `.release/images.json`
  registra o que cada tag publicou, e `make imagens-do-release` aplica no
  overlay as QUATRO que o kustomize conhece (o broker fica fora do k8s). O overlay do repositório
  guarda o MARCADOR, nunca uma release congelada; nada disso faz deploy
  sozinho (ver `DEPLOY_ENABLED` acima, que continua não existindo)
- Docs: Docusaurus 3.x em website/ lendo de docs/, que é a FONTE em pt-BR e o
  locale padrão (ADR 0216); `en`, `ru` e `zh-Hans` moram em
  `website/i18n/<locale>/`, e página sem tradução cai na fonte; Mermaid; busca
  local (`pt`, `en`, `ru`, `zh`)
- CI/CD de release e cadeia de suprimentos (pin por SHA/digest, assinatura,
  Trivy, `install-e2e.yml`): as regras moram em
  `.claude/rules/ci-e-cadeia-de-suprimentos.md`, carregadas quando a sessão lê
  `.github/`, `scripts/ci/`, `docker/`, `deploy/` ou o `install.sh`.
