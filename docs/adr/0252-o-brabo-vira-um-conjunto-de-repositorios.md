# ADR 0252 — O Brabo vira um conjunto de repositórios em `viralabs-dev`

- **Status:** aceito
- **Data:** 2026-11-04
- **Referencia:** os ADRs [0030](0030-politica-de-branches-mecanizada.md), [0117](0117-lockfile-proprio-para-o-website.md), [0119](0119-imagens-publicadas-no-ghcr-por-digest.md), [0120](0120-e2e-de-navegador-contra-o-compose-de-producao.md), [0130](0130-broker-de-container.md), [0149](0149-assinatura-dos-artefatos-publicados.md), [0162](0162-broker-publicado-e-oferecido-pelo-instalador.md), [0202](0202-o-indice-de-adr-por-tema.md) e [0235](0235-a-qa-e-aposentada-e-a-esteira-fica-dev-e-main.md). Nenhum deles é editado: cada um segue valendo para o repositório que herda o assunto, e o caminho do arquivo muda sem mudar a decisão.

## Contexto

O monorepo reúne api, engine, web, runner, broker, infraestrutura, documentação e E2E num só histórico, com uma só versão e um só pipeline. O dono decidiu em 02/11/2026 (EP-033, AT-688) separá-lo em repositórios na organização `viralabs-dev`. O levantamento está na nota AT-688 do vault; este ADR registra a decisão e o mapa. **Estado: decidido, em migração (onda A). Nada está separado ainda.**

## Decisão

1. **Repositórios novos, todos PÚBLICOS, com o prefixo `brabo-`:** `brabo-api`, `brabo-engine`, `brabo-web`, `brabo-runner`, `brabo-broker`, `brabo-contracts`, `brabo-ci`, `brabo-infra`, `brabo-qa` e `brabo-workspace`. Nenhum aproveita o `infra-viralabs`.
2. **O que cada um leva:**
   - `brabo-api`: `apps/api`, `gates.yml`, `openapi.json`; `brabo-engine`: `apps/engine`, `prompts/`, fixtures dos golden-sets; `brabo-web`: `apps/web`, `design/`; `brabo-runner`: `apps/runner` e o build e a publicação dos binários; `brabo-broker`: `apps/broker`.
   - `brabo-contracts`: `packages/shared`, `packages/docker-port`, a fonte de `agent-areas` e `fluxo.yml`, consumido como dependência git por TAG.
   - `brabo-ci`: política de PR e de branch, escada, arquivamento, Dependabot e os modelos de comunidade, como workflows reutilizáveis (`workflow_call`).
   - `brabo-infra`: composes, `deploy/k8s`, `Makefile`, `scripts/dev`, backup e o orquestrador dos clones locais.
   - `brabo-qa`: `e2e/`, golden-sets, `scripts/jev`, `scripts/idioma` e o roteiro do TP-01.
   - `brabo-workspace`: a pasta-mãe, com o `CLAUDE.md`, os scripts de clone e os atalhos.
3. **Porta de entrada: `viralabs-dev/brabo`** (o repositório vazio que já existe, tornado público). Leva a documentação inteira (site e README), o `install.sh`, a RELEASE do produto e o CHANGELOG do produto. O site fica em `viralabs-dev.github.io/brabo`. Quem instala só precisa conhecer esse repositório.
4. **Cada repositório tem a própria doc, e a cobra no mesmo PR do código:** a `docs/` e as RNs moram no repositório dono do código, o `docs:check` de cada um confere a sua, e o `brabo` só junta as pastas e publica o site.
5. **Versões:** cada repositório tem a sua, e o produto tem a dele, no `brabo`. Todos recomeçam em **1.0.0**.
6. **Histórico:** extração COM histórico (`git filter-repo`); `#NNN` vira `daneiel/brabo#NNN`.
7. **Legado:** o `daneiel/brabo` é TRANSFERIDO para a org como `viralabs-dev/brabo-legacy`; localmente, o antigo checkout vai para `~/dev/brabo/brabo-old`.
8. **Bot:** um GitHub App da organização, desde já, no lugar do token pessoal (gesto do dono na AT-689).
9. **AT-662** (site sem Docusaurus) roda ANTES da separação.
10. **Ordem das ondas:** A (ADR e contexto, dono fixo fora do código, contratos isolados, AT-662) → B (doc dentro de cada área, `brabo-contracts`, `brabo-ci`) → C (api, engine, web, runner, broker, workspace) → D (infra, `brabo`, qa, CLAUDE.md por repo, vault) → E (release coordenada 1.0.0, transferência do legado, instalação local) → F (migração da pasta local, sozinha).

## O que NÃO muda

Nenhum comportamento do produto, nenhuma regra de negócio e nenhum teto absoluto (RN-418, merge manual em branch protegida, `decide.ts`). A regra "não versionar à mão" vale por repositório. A esteira `dev → main` (ADR 0235) vale por repositório.

## Consequências

- Regras de documentação do `CLAUDE.md` mudam de natureza na migração: o docmap deixa de ser conferido no mesmo PR entre repositórios, e as contagens e frases ancoradas leem o layout reconstruído. Cada onda ajusta o que toca.
- A cadeia de suprimentos (namespace do GHCR, identidade do cosign, `images.json`) muda de dono junto com o repositório da release.
- O `CLAUDE.md` e as memórias passam a ser partidos por repositório (AT-708); até lá, valem os da raiz.
