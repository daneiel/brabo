# ADR 0024 — Fase 5 (sessão 1): imagens de produção, compose.prod, CI e teste de fumaça

- Status: aceito
- Data: 2026-07-26
- Fase: 5 (sessão 1 — itens 1 a 5 do enunciado)

## Contexto

Até aqui, tudo que existia de Docker no repositório era **exclusivamente de
desenvolvimento**. As três imagens eram single-stage, rodavam como **root**, sem
`USER`, `EXPOSE` ou `HEALTHCHECK`, e nenhuma delas copiava código: todas
dependiam de bind mount do repositório e instalavam dependências no start do
container. O `web` era um `vite dev` — não havia nginx nem build estático em
lugar nenhum. O engine não tinha configuração de `mix release`.

E **não havia CI**: os dois workflows em `.github/workflows/` são helpers do
Claude Code, nenhum roda teste, lint ou build.

Esta sessão entrega os itens 1–5 da Fase 5. Fora do escopo (itens 6+):
Kubernetes/Helm, graceful shutdown com preStop, OpenTelemetry/Prometheus,
backup/restore, rate limit.

## Decisões

### 1. `.dockerignore` antes de qualquer imagem: 742 MB → 5,2 MB de contexto

Não existia `.dockerignore` nenhum, e os dois contextos de build eram a raiz do
repositório. Todo build mandava `node_modules` (543 MB), `.pnpm-store` (220 MB),
`.git` e os `.env` para o daemon.

Medido com uma imagem-sonda (`FROM alpine` + `COPY . /ctx`), porque script de
estimativa erra: as duas primeiras medições que fiz estavam erradas por bugs
meus de prefixo, não por bug do `.dockerignore`. Com o arquivo: **5,2 MB**.

Duas exceções que o build quebrou até serem descobertas, e que valem registro
porque contradizem o que os nomes sugerem:

- **`design/tokens.css` é input de build, não documentação.** O
  `apps/web/src/index.css` faz `@import '../../../design/tokens.css'` e o Vite
  resolve no filesystem. Excluir `design/` inteiro quebra o `vite build`. Só os
  `.md` de lá são documentação.
- **`docker/web/` precisa entrar no contexto.** A imagem do web copia dali o
  `nginx.conf` e o entrypoint, ao contrário das outras duas.

### 2. Um bug latente na build da api que nunca tinha sido exercitado

`apps/api/tsconfig.build.json` não tinha `include`. Sem ele o `tsc` também
compilava `drizzle.config.ts`, `vitest.config.ts` e `scripts/`, inferia a raiz
do pacote como `rootDir` e emitia **`dist/src/main.js`** — enquanto
`start:prod` é `node dist/main`. O comando de produção estava quebrado desde
sempre e ninguém viu, porque desenvolvimento usa `start:dev`. A primeira imagem
de produção foi o que expôs.

### 3. Migração é serviço one-shot, não passo de boot

Se cada réplica migrasse ao subir, duas subindo juntas competiriam pela mesma
migration. No `docker-compose.prod.yml` são dois serviços que rodam uma vez e
terminam, com os apps dependendo por `service_completed_successfully`.

São dois porque são dois donos de schema em imagens diferentes:

- **api**: `drizzle-kit` é `devDependency` e a imagem de produção não carrega
  nenhuma. Criamos `src/db/migrate.ts`, que usa o migrador programático do
  `drizzle-orm` (dependência de runtime) — o mesmo mecanismo que o
  `globalSetup` do vitest já usava.
- **engine**: um release não tem Mix; `mix ecto.migrate` não existe na imagem.
  `Engine.Release` (padrão canônico do Ecto) é chamado com
  `bin/engine eval "Engine.Release.migrate()"`.

Verificado que não há referência cruzada entre as migrations dos dois, então
rodam em paralelo.

### 4. Na imagem de produção, instalar scanner é FAIL-HARD

Em desenvolvimento a instalação de gitleaks/hadolint/semgrep é best-effort
(`|| echo`) de propósito: o detector percebe a ausência e o gate pula. Em
produção isso é inaceitável, e o motivo está escrito nos próprios ADRs
anteriores: **sem hadolint o gate de QA de infra aprova qualquer Dockerfile**
(ADR 0021) e **sem gitleaks o gate de SecOps roda sem verificação de segredo**
(ADR 0020). Uma falha de rede no build produziria uma imagem verde cujo gate de
segurança é no-op.

Então: sem `|| echo`, com **checksum SHA256 verificado** (o checksum garante que
o binário é o esperado, não só que baixou), versões pinadas em `ARG`, e um passo
final de verificação que executa cada binário — inclusive um `semgrep scan` de
verdade, não só `--version`. Esse passo pagou por si: ver decisão 8.

### 5. Volumes graváveis do engine (item 2 do enunciado)

Dois mount points declarados com `VOLUME` e com dono ajustado no build:

| caminho | o que grava |
|---|---|
| `/data/project-workspaces` | working tree por projeto e os worktrees por agente em `<workspace>/.worktrees/<agent_id>`; também o `permissions.json` |
| `/data/git-repos` | bare repos locais, escritos pelo `git push` do dev agent |

Mais `/tmp` (4 detectors e a árvore temporária do `InfraGateRunner`) e `$HOME`
(o semgrep baixa e cacheia regras do registry na primeira execução) — esses dois
como `tmpfs`, já que o rootfs é read-only.

**Os dois caminhos precisam ser IDÊNTICOS na api e no engine.** A api persiste o
path absoluto do bare repo no banco e o engine o usa literalmente; montar em
lugares diferentes quebra o push com `remote unpack failed`.

Corolário que só aparece rodando: os diretórios precisam **existir nas duas
imagens, com o dono certo**. Quando um volume nomeado nasce vazio, o Docker
copia conteúdo e ownership do caminho na imagem — se o caminho não existir, o
volume nasce root e o processo non-root não escreve. Por isso a imagem da api
também cria `/data` e faz `chown node:node`; `node` e `engine` são ambos uid
1000, então os dois containers compartilham os volumes sem conflito
(verificado nos dois sentidos).

### 6. `check_origin` do Phoenix quebrava o painel do time em produção

Em `:prod` o default do Phoenix é comparar a origem do websocket com
`url: [host: ...]`, que é `PHX_HOST`. O painel do time ao vivo (Fase 4a item 7)
fala por canal Phoenix a partir do web, servido de **outra** origem — o
handshake seria recusado e o painel ficaria mudo, sem erro visível no servidor.

`runtime.exs` passou a aceitar `WEB_ORIGIN` (lista separada por vírgula, a mesma
variável que a api já usa pro CORS). Sem ela, mantém o default estrito.

### 7. nginx: os headers de segurança sumiam na rota que serve o app

O `add_header` do nginx **descarta todos os headers herdados** quando o bloco
filho declara qualquer `add_header`. Como a política de cache exigia um
`add_header Cache-Control` dentro de `location = /index.html`, os headers de
segurança do `server` desapareciam exatamente em `/` — o CSP existia no arquivo
e não chegava no browser. Encontrado com `curl -D-`, não por leitura.

Correção: a política de cache virou um `map $uri`, os headers ficam declarados
**uma vez** no `server`, e nenhum bloco filho usa `add_header`. O `/healthz` usa
`default_type` em vez de `add_header Content-Type` pelo mesmo motivo.

Verificado por rota: `/`, rota do router (fallback), `/assets/<hash>.js`,
`/healthz` e 404 de asset inexistente (que precisa ser 404 e não `index.html`,
senão um asset faltando chega no browser como HTML e o erro aparece como
sintaxe inválida).

Além disso, o entrypoint oficial da imagem nginx **não serve** aqui: ele só roda
os scripts de `/docker-entrypoint.d` quando o processo é root (rodando como
`nginx` ele imprime "skipping auto-configuration" e a substituição de variáveis
nunca acontece) e escreve o conf renderizado em `/etc/nginx`, que é read-only.
Daí `docker/web/entrypoint.sh`, que renderiza para `/tmp` e valida com
`nginx -t` antes de subir.

### 8. Segurança das imagens: o que foi corrigido e o que foi aceito

O `trivy` com `--severity HIGH,CRITICAL --ignore-unfixed` começou reportando
achados nas três imagens. Um `exit-code: 1` no CI teria nascido vermelho; a
resposta **não** foi afrouxar o gate, foi corrigir:

| correção | efeito |
|---|---|
| `apk upgrade --no-cache` nas três (a tag pinada congela também os patches do Alpine) | zerou os CVEs de pacote de sistema; o **web ficou com 0 achados** |
| remover o npm/npx/corepack empacotados na imagem base do Node | zerou os **24 achados** da api — todos vinham de `/usr/local/lib/node_modules/npm`, **nenhum das nossas dependências**. O runtime executa `node main.js`; gerenciador de pacote ali é só superfície de ataque |
| pin do gitleaks 8.21.2 → **8.30.1** | o binário do 8.21.2 é compilado com Go 1.23.2 e carregava 15 CVEs de stdlib, 1 CRITICAL. Verificado que `mix test --only gitleaks` continua passando |

Restou o que **não é corrigível por nós**, aceito em `.trivyignore.yaml` com três
condições obrigatórias por entrada — binário de terceiro que não compilamos, já
no último release publicado, e **`expired_at`** (2026-10-31), para a dívida
voltar a quebrar o CI em vez de apodrecer em silêncio:

- Go stdlib e `golang.org/x/crypto` dentro do binário oficial do gitleaks;
- `mcp` 1.23.3, dependência **fixa** (`mcp==1.23.3`, não range) do semgrep
  1.171.0, que já é o último release. Tentamos remover o pacote, já que os gates
  só chamam `semgrep scan` e nunca `semgrep mcp`: **não funciona** — o
  `semgrep/cli.py` importa `semgrep.commands.mcp` incondicionalmente e o binário
  morre em `ModuleNotFoundError`. Quem pegou isso foi o `semgrep scan` de
  verdade no passo de verificação do Dockerfile (decisão 4), não a suite.

### 9. Lint em modo verificação expôs 31 erros acumulados

Os scripts de lint do repositório rodam com `--fix`/`--write`, então ninguém
nunca tinha visto o modo verificação. Em check mode: 31 erros. Trinta eram
formatação (auto-corrigidos) e um era `no-unnecessary-type-assertion`. Restaram
dois `no-unused-vars`: um import morto (removido) e um `_modules` de
rest-destructuring onde **a variável existir sem uso é o ponto** — resolvido
configurando `argsIgnorePattern: '^_'` no eslint, que é a convenção já usada no
repositório. Suite da api re-rodada depois: 508 passando.

### 10. O formatador do host não era o formatador do projeto

`mix format --check-formatted` sob o Elixir **1.17.3** pinado (Dockerfiles e CI)
reprovou **11 arquivos já commitados**. Não era drift de descuido: as regras do
formatador mudaram entre versões, e o código estava formatado por um Elixir mais
novo — o do host de desenvolvimento (1.20.2 nesta máquina). Rodar `mix format`
no host "consertava" os arquivos para uma versão e quebrava para a outra, em
looping.

Como a versão pinada é a declarada em toda a infraestrutura, ela é a fonte de
verdade: os 11 arquivos foram formatados **dentro do container 1.17.3**, e o
README passou a instruir a formatar por lá quando o host divergir. Foi o
primeiro achado do CI antes mesmo de ele existir remotamente.

Nota de método: a primeira leitura desse check me pareceu verde, porque o
wrapper mascarou o exit code e o `grep | head` truncou a lista de arquivos.
Só um `echo $?` explícito mostrou o que estava acontecendo.

### 11. O guard de falso-verde no CI

`test_helper.exs` exclui as tags `:gitleaks`/`:hadolint`/`:yamllint` quando o
binário falta na máquina — e esses três módulos são exatamente as regressões que
provam que os gates não aprovam vazio (ADR 0020/0021). Num runner pelado eles
somem em silêncio e o CI fica verde sem nunca ter testado os gates de segurança.

O job `test-engine` instala os três nas **mesmas versões pinadas do
Dockerfile.prod** e, depois do `mix test`, falha explicitamente se a saída
contiver qualquer teste excluído. Localmente, antes: `254 passed, 9 excluded`.
Com os binários presentes: **`263 passed`, 0 excluded**.

Pelo mesmo motivo o `gitleaks` do repositório roda com histórico completo
(`fetch-depth: 0`): um segredo removido no último commit continua recuperável.
Os 3 achados eram dois PATs sintéticos que existem **para serem encontrados**
(os fixtures das regressões) e um placeholder do boilerplate do NestJS —
allowlistados em `.gitleaks.toml` escopados por **regra e caminho exato**, nunca
por padrão amplo, porque allowlist larga é o mesmo no-op que os ADRs anteriores
descrevem.

### 12. Build, scan e smoke no mesmo job

As três imagens somam ~1,3 GB; passá-las entre jobs por artifact custaria mais
tempo de upload/download do que o build inteiro. Ficam no daemon local do
runner. Cache de camadas via `type=gha` com escopo por imagem.

## Limitações conhecidas (registradas, não resolvidas)

1. **`VITE_*` é compile-time.** O Vite inlina `import.meta.env.VITE_*` no bundle,
   então as URLs de api/engine/Keycloak ficam assadas na imagem do web: é **uma
   imagem por ambiente**, não a mesma imagem promovida entre eles. Resolver isso
   (injeção em runtime) é pré-requisito para o Kubernetes da sessão seguinte.
   O `CSP_CONNECT_SRC` do nginx, esse sim, é runtime.
2. **Node continua na imagem do engine**, porque o DevAgent roda a suite do
   projeto gerido lá dentro (`TerminalExecutor`). Não escala para stacks
   arbitrárias; a saída real é um sandbox por projeto, fora do escopo da Fase 5.
3. **`rtk` ficou de fora** da imagem — sem origem verificável para pinar por
   checksum. O detector já degrada e a métrica segue `nil`.
4. **O `docker-compose.prod.yml` não endurece terceiros.** Keycloak segue em
   `start-dev` com realm de desenvolvimento (segredo hardcoded, `admin123`) e
   Postgres em container com senha default. O alvo daquele arquivo são **as
   nossas três imagens**; endurecer Keycloak e Postgres é trabalho de outra
   sessão, e está dito no topo do arquivo.
5. **Proteção de branch não é aplicável neste repositório hoje.** A API do
   GitHub responde 403: *"Upgrade to GitHub Pro or make this repository public
   to enable this feature"*. A configuração alvo está documentada abaixo;
   aplicá-la é passo manual do usuário quando o plano permitir.

## Configuração alvo da proteção da branch `dev`

Aplicar em *Settings → Branches → Add branch protection rule*, `dev`:

- **Require a pull request before merging** — sem push direto.
- **Require status checks to pass before merging**, com *Require branches to be
  up to date*: `Lint`, `Testes TS (api + web)`, `Testes do engine (ExUnit)`,
  `Gitleaks no repositório`, `Build, scan e smoke das imagens de produção`.
- **Require conversation resolution before merging**.
- **Do not allow bypassing the above settings** (inclusive administradores).
- **NÃO** habilitar auto-merge nem merge queue: o CLAUDE.md determina que merge
  em branch protegida é sempre manual do usuário, sem opção de automatizar.

## Consequências

- Existe caminho de produção real para os três apps, validável localmente com
  um comando, e a diferença entre "a suite passa" e "a imagem sobe" deixou de
  ser invisível.
- O CI cobre lint, testes, build, scan de imagem e segredo, e teste de fumaça —
  e **testa os gates de segurança de verdade**, que era o buraco maior.
- As imagens rodam non-root com rootfs read-only, o que também elimina uma
  classe de atrito que já tinha aparecido em desenvolvimento (o `dist/`
  root-owned que precisou de container para remover).
- Fica dívida explícita e datada: `.trivyignore.yaml` expira em 2026-10-31, e as
  cinco limitações acima são entrada da próxima sessão.

## Números

| | antes (dev) | depois (prod) |
|---|---|---|
| contexto de build | 742 MB | **5,2 MB** |
| imagem api | 274 MB | 457 MB¹ |
| imagem engine | 1,17 GB | **796 MB** |
| imagem web | 255 MB | **93,5 MB** |
| suite do engine | 254 passed, **9 excluded** | **263 passed, 0 excluded** |
| trivy HIGH/CRITICAL corrigíveis | — | **0** nas três |

¹ A imagem de produção da api é maior porque a de desenvolvimento **não carrega
código nem dependências**: usa bind mount e volumes. Não são comparáveis como
"antes e depois" da mesma coisa. Dos 457 MB, 165 MB são `node_modules` de
produção (dos quais 51,7 MB é o `gpt-tokenizer`).
