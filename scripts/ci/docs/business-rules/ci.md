---
id: rn-ci
title: 'Regras de negócio — CI'
sidebar_label: CI
description: 'As RNs hospedadas na raiz ci.'
keywords: [regras de negócio, ci]
---

# CI

## PR Gates

### RN-037 — Infra becomes an area: Workflows generates CI per provider, Lead consolidates into a single PR {#rn-037}

Second instance of the ADR 0038 model, after the QA area (RN-036) — with
one structural difference: the Infra area's two delegations ALWAYS run
(Dockerfiles/compose by the Lead itself — "delegates to itself"; CI
pipeline by the Workflows subagent), never is one dispensed. `Workflows`
decides the pipeline format from the context's `gitProvider`
(`GetInfraContextUseCase`, read from `project_repositories.provider` —
**not** from `GitProvider` `capabilities`, which are the SAME for GitHub
and GitLab): `"gitlab"` generates `.gitlab-ci.yml`; any other value
(`"github"`, `"local"`, or unknown) generates `.github/workflows/ci.yml`.
Each file goes through `validate_infra_file` before finishing — hadolint
for Dockerfile, `actionlint` for GitHub Actions workflow
([ADR 0039](../adr/0039-actionlint-e-validacao-do-pipeline-de-ci-gerado.md);
`.gitlab-ci.yml` has no local validation, a documented gap, not a
half-solution).

Consolidation: the two delegates' files are merged by `path` (Workflows'
wins on collision) into a SINGLE PR — the mechanism to propose the PR
(`propose_infra_pr`) changes from "the tool calls the api directly" to
"the tool signals the Lead, which consolidates and calls once" — the
`open_infra_pr` the api receives is the SAME as always, byte for byte
(`ExecuteInfraPrUseCase` untouched). Failure of any delegate (origin
`infra`/`modelo`/`codigo`/`politica`) NEVER opens a partial PR — the same
rule as RN-036, one level up again.

Each delegate (even the Lead, on itself) is tracked as a `delegations`
row — reused exactly as RN-036 left it, with ONE correction: the
`task_id` column became NULLABLE (the Infra area delegates on the
SESSION, with no backlog task behind an infra PR), and the route
`POST /internal/sessions/:sessionId/delegations` stopped being nested
under `/tasks/:taskId` — `taskId` now goes in the body, optional. Cycle K
and budget have no dedicated column in the Infra area (the original
InfraAgent never had per-task budget, and this work didn't introduce
one).

- **Where:** `apps/engine/lib/engine/infra/infra_lead.ex` (`consolidar/2`),
  `infra_lead_server.ex` (the wiring), `workflows_agent.ex`,
  `tools/validate_infra_file.ex` (dispatch by extension),
  `apps/api/src/application/use-cases/execution/get-infra-context.use-case.ts`
  (`gitProvider`), `record-delegation.use-case.ts` (`taskId` optional)
- **Test:** `apps/engine/test/engine/infra/infra_lead_test.exs` (the merge
  and the block, pure), `infra_lead_server_test.exs` (the wiring: single
  PR with both file sets, two delegations, `gitProvider: "gitlab"` →
  `.gitlab-ci.yml`, Workflows failure → no PR), `workflows_agent_test.exs`
  — and the proof that the `ExecuteInfraPrUseCase`/`InfraGateRunner`
  contract didn't change: `execute-infra-pr.use-case.spec.ts` and
  `infra_gate_runner_test.exs` pass **with no change at all**
- **Origin:** [ADR 0038](../adr/0038-hierarquia-de-agentes.md), [ADR 0039](../adr/0039-actionlint-e-validacao-do-pipeline-de-ci-gerado.md)

On the `apps/web` side (Phase 8d): the team panel groups `infra`/
`infra-workflows` the same way as QA (RN-036), and the feed narrates the
area's delegations — the same `AREAS`/`areaFor` registry from
`apps/web/src/lib/agents.ts`, with no Infra-specific code in the UI.

---

## O papel `dbre` vira dois scripts mecânicos (RN-400..403, ADR 0093)

### RN-401 — O linter não é gate de CI: varre o repositório inteiro, não o diff da PR {#rn-401}

Rodar `pnpm --filter api lint:migracao` contra as migrations reais do
repositório ACHA três ocorrências em migrations já mergeadas e aceitas
(`0006_whole_princess_powerful.sql:22` e `0034_quick_saracen.sql:33` —
`DROP COLUMN`; `0007_groovy_bullseye.sql:2` — `ALTER COLUMN ... SET DATA
TYPE`). Isso não é defeito a corrigir de passagem (mesma regra do
CLAUDE.md que protege os achados Z/AD/AE): são migrations já aceitas, e
apagá-las apagaria a evidência de por que a decisão foi tomada. É também
por isso que o script sai `!= 0` mas **não** está wireado em
`.github/workflows/ci.yml` — um gate que reprova o repositório inteiro
reprovaria toda PR para sempre, por um achado que não é dela. Virar gate
de bloqueio de verdade exige escopar ao DIFF contra a base do PR (a mesma
técnica de `scripts/ci/pr-police.ts`), deixado para quando `dbre` precisar
BLOQUEAR merge — hoje ele é parecer manual, não veredito automático.

- **Onde:** `apps/api/scripts/lint-migracao.ts` (`principal`, exit code no
  fim do arquivo); decisão documentada no cabeçalho do arquivo e no ADR
- **Teste:** não aplicável a CI (não há step); a execução manual contra o
  repositório real está registrada no ADR 0093, seção Consequências
- **ADR:** [0093](../adr/0093-dbre-linter-de-migracao-e-relatorio-de-backup.md)

## "N agentes online" no dashboard — status AO VIVO, nunca presença histórica (RN-409, ADR 0097)

### RN-411 — O quarto sinal de trabalho pendente: dev agents falam `dev.*`, não `agent.status` {#rn-411}

Achado por USO real, não por teste: numa sessão de execução, cinco dev
agents subiram, ficaram `idle_tripped` (o circuit breaker da
[RN-047](engine.md#rn-047), travados esperando o usuário desbloquear uma task
manualmente), e o heartbeat de 30 segundos
(`Engine.Sessions.SessionServer.handle_info(:heartbeat_timeout, state)`)
fechou a sessão por baixo enquanto o trabalho — e a espera por decisão
humana — continuava.

`GetSessionPendingWorkUseCase` já tinha um terceiro sinal
([RN-064](web.md#rn-064)) para o mesmo problema: agente ativado, sem `idle`
posterior, segura a sessão. Mas esse sinal só lê `agent.status`, o
vocabulário dos agentes CONVERSACIONAIS (Criativo/PO/Arquiteto/Dev
Lead/UX Designer/Staff/Infra). `Engine.Dev.DevAgentServer` (via
`Engine.Dev.AgentIo`) nunca emite `agent.status` — usa vocabulário
PRÓPRIO no event log da sessão: `dev.started`, `dev.working`,
`dev.awaiting_gate`, `dev.awaiting_approval`, `dev.idle`,
`dev.idle_tripped`, `dev.blocked`, `dev.blocked_by_container`,
`dev.error`. Uma sessão de execução
com dev agent trabalhando OU travado sempre devolvia `pending: false`
pelo terceiro sinal, porque nenhum `agent.status` existe para ele.

O QUARTO sinal busca o ÚLTIMO evento `dev.*` de cada `actor.id`
(`dev-<modulo>`/`dev-<modulo>-2`, a mesma chave da
[RN-195](web.md#rn-195)) que já apareceu na sessão — igual ao terceiro sinal,
mas sobre múltiplos tipos de evento em vez de um só, porque o estado do
dev agent não é UM tipo com um `payload.status` variável, são tipos DE
evento distintos por transição. A régua: `pending: true` quando o
último for `dev.working`, `dev.blocked` ou `dev.idle_tripped` — os três
significam "tem trabalho rolando ou um humano precisa agir", e travado
esperando desbloqueio É trabalho pendente (é literalmente o que o
usuário estava fazendo quando a sessão fechou na execução real). Só
`dev.idle` (sem tarefa nenhuma pra pegar, drenado de verdade) não
conta.

`dev.awaiting_gate` e `dev.awaiting_approval`, como último evento, NÃO
disparavam este sinal originalmente — ficaram de fora da régua tal como
decidida à época. `awaiting_gate` era uma lacuna residual CONHECIDA; a
[RN-412](api.md#rn-412) a fechou, junto com `awaiting_approval` (por um
argumento novo, não o original — ver RN-412).

`dev.blocked_by_container` entrou DEPOIS, pelo mesmo argumento e por um
achado igualmente real. O tipo nasceu com a
[RN-502](engine.md#rn-502)/[ADR 0143](../adr/0143-agentes-de-dev-so-depois-do-container.md) — o dev
agent não reivindica task antes de o projeto ter container `running`
registrado — e a lista `DEV_EVENT_TYPES` do caso de uso não acompanhou.
Como é a lista que o caso de uso CONSULTA, o evento ficou invisível: a
api não o via nem para ignorá-lo. Na execução real do `exp004` (sessão
`f782257e`) cinco dev agents emitiram `dev.started` e
`dev.blocked_by_container` às 22:41:38, o engine fechou por
`heartbeat_timeout` às 22:42:07 — 30 segundos cravados —, e eventos
daquela sessão continuaram chegando 13 e 32 minutos depois. O último
evento VISÍVEL por agente era `dev.started`, que está deliberadamente
fora da régua. Os cinco esperavam um HUMANO subir o container, que é a
definição de trabalho pendente que os outros sinais já usam.

A afirmação de que a lista era "o vocabulário completo, confirmado por
leitura direta do código do engine" era verdadeira quando foi escrita —
e foi ela que envelheceu calada. O que a mantém verdadeira agora é
MECANISMO: `scripts/ci/vocabulario-de-eventos-dev.spec.ts` extrai os
tipos `dev.*` de `apps/engine/lib/**/*.ex` e reprova quando divergirem
das duas listas do caso de uso, nomeando o tipo que falta. Ele COMPARA
em vez de GERAR (o precedente de `agent-areas.ts`) porque só metade do
par é derivável: `DEV_EVENT_TYPES` é mecânica, `DEV_PENDING_TYPES` é
julgamento — quais estados significam "um humano precisa agir".

A MESMA deriva tinha uma terceira instância, no WEB, e o mecanismo
passou a cobri-la. `DEV_STATUS_EVENTS`
(`apps/web/src/lib/agent-status.ts`), que o painel do time consulta para
dizer o estado de cada dev agent, também não conhecia
`dev.blocked_by_container` nem `dev.awaiting_approval` — e ali a
consequência não era invisibilidade, era MENTIRA: os dois caíam no
`default: return 'trabalhando'` do `switch`, então no `exp004` o painel
dizia que cinco dev agents parados havia HORAS, esperando um humano
subir o container, estavam trabalhando. Os dois mapeiam para
`aguardando`, o mesmo estado que `dev.awaiting_gate` já usava (o agente
não segue até que algo FORA dele aconteça), sem estado novo em
`AgentStatus`; `dev.error`, que não estava em lista nenhuma e por isso
fazia o painel voltar ao `dev.working` anterior, mapeia para `falhou`.
A lista deixou de ser lista: virou MAPA `tipo -> AgentStatus`, o que
apaga o `default` e torna impossível acrescentar um tipo sem responder o
que ele significa. E o teste cruzado ganhou o par engine × web, com uma
exigência que a api não tem — DECISÃO explícita por tipo, mapeado OU
declarado em `DEV_STATUS_EVENTS_FORA` (`tipo -> motivo`, vazio hoje) —,
porque no painel um tipo `dev.*` PODE legitimamente não interessar; o
que não pode é ficar de fora por esquecimento.

- **Onde:** `apps/api/src/application/use-cases/sessions/get-session-pending-work.use-case.ts`
- **Teste:** `apps/api/test/application/use-cases/sessions/get-session-pending-work.use-case.spec.ts`
  (dev agent `dev.working`/`dev.blocked`/`dev.idle_tripped`/`dev.blocked_by_container`
  como último evento → `pending: true`, inclusive os cinco agentes do
  cenário `exp004` e com `dev.blocked_by_container` vencendo um
  `dev.idle` anterior; `dev.idle` → `pending: false`; sessão sem
  evento `dev.*` preserva o comportamento anterior; só o ÚLTIMO evento de
  cada agente importa; `dev-<modulo>-2` também segura; isolamento entre
  sessões), `scripts/ci/vocabulario-de-eventos-dev.spec.ts` (o
  vocabulário `dev.*` do engine × as duas listas da api E × o mapa do
  painel, mais os três casos fabricados que provam a válvula
  `DEV_STATUS_EVENTS_FORA`, que nenhum dado real exercita hoje) e
  `apps/web/src/lib/agent-status.test.ts` (`dev.blocked_by_container` e
  `dev.awaiting_approval` → `aguardando`, `dev.error` → `falhou`, nunca
  `trabalhando`; e o evento mais recente continuando a mandar)
- **Origem:** achado por uso real — sessão de execução real com cinco dev
  agents em `idle_tripped` fechada pelo heartbeat enquanto o usuário
  ainda desbloqueava tarefas manualmente; e, mais tarde, cinco dev agents
  em `blocked_by_container` no `exp004`, pelo mesmo mecanismo

---

## A busca do RAG deixa rastro, e o rastro congela os pesos (RN-479..481)

### RN-498 — O golden-set do RAG roda em CI de verdade, AGENDADO — e o gate continua `warn` {#rn-498}

A RN-490 registrou o golden-set do RAG (ADR 0132) nascendo `mix
golden_set.rag` manual, "nunca em CI", pelo mesmo motivo do golden-set do
QA (ADR 0123): sem segredo de LLM de API ou infra nova, não havia como
rodar Ollama de verdade em um runner de CI. Esta RN fecha essa metade —
só para o RAG, nunca para o QA — com um workflow dedicado
(`.github/workflows/golden-set-rag.yml`, `schedule` + `workflow_dispatch`)
que puxa `nomic-embed-text` num serviço Ollama real (mesma versão pinada
do resto do produto, hoje `0.34.4`) e roda `mix golden_set.rag` de verdade.

**A diferença que torna isto tratável para o RAG e não para o QA:** o
golden-set do RAG só chama o modelo de EMBEDDING — CPU, determinístico,
sem amostragem — nunca um modelo de CHAT fazendo julgamento, que é o que o
golden-set do QA exige (caro, mede algo não-determinístico por natureza,
como o próprio ADR 0123 registra com rodadas reais variando 1 a 5 acertos
em 6). `ubuntu-latest`, sem GPU nenhuma, basta aqui — não bastaria para o
QA. O golden-set do QA **não muda nada** com esta RN: continua inteiramente
manual, `TODO(humano)` no CLAUDE.md.

**`severidade: warn` (`apps/api/config/gates.yml`) CONTINUA `warn`, e o motivo mudou.**
Não é mais "não há CI com LLM" — passa a ser cadência: o workflow é
AGENDADO (noturno + disparo manual), nunca roda por `pull_request`. `block`
prometeria um travamento de merge que não existe — o mesmo raciocínio que
já valia na Etapa 2, aplicado à razão certa agora. Uma regressão de acerto
de busca vira sinal de tendência visível em até 24h (ou na hora, via
`workflow_dispatch`), nunca um gate que bloqueia PR — trade-off aceito
explicitamente pelo dono do produto, dado o custo de puxar o modelo e
rodar 17 buscas (alguns minutos) em toda janela.

**Nenhum segredo precisa ser gerado no workflow.** `seed-golden-set-rag.ts`
nunca define `NODE_ENV`, e os quatro segredos que a api recusaria com
literal de exemplo em produção (RN-114) só são checados quando
`NODE_ENV === 'production'` — o script cai no ramo de desenvolvimento e usa
os literais de dev sem reclamar, diferente de `docker/smoke.sh`, que sobe
com `NODE_ENV=production` de propósito e por isso gera os seus com
`openssl rand`.

**A exclusão permanente da tag `:golden_set_rag` em `test_helper.exs`
(RN-490) não muda.** Ela protege o `mix test` comum — inclusive na máquina
de qualquer desenvolvedor com Ollama de pé — nunca o novo workflow, que
invoca `mix golden_set.rag` explicitamente, do mesmo jeito que sempre foi
preciso rodar manual.

**Corrigido depois de medir: o workflow acima nunca rodou verde uma vez.**
Cinco execuções agendadas seguidas (05 a 09/09/2026) falharam, e havia
**três** defeitos empilhados, cada um escondendo o seguinte:

1. **`mix golden_set.rag` é um alias que chama `test`, e o Mix recusa isso
   fora do ambiente `:test`** — `** (Mix) "mix test" is running in the "dev"
   environment` —, antes de rodar coisa alguma. `def cli` em
   `apps/engine/mix.exs` passa a declarar `preferred_envs` para as DUAS
   tasks de golden-set: é o que faz o comando curto, o único documentado em
   toda parte, funcionar sem prefixo de ambiente. Exigir `MIX_ENV=test` de
   quem chama seria transferir a correção para toda a prosa que ensina o
   comando — e para quem esquecesse, de novo.
2. **O job nunca subiu a api**, e o teste PULA quando `API_URL` não responde
   (pré-condição de ambiente declarada no ADR 0132). Corrigido o item 1, o
   job ficaria verde sem medir nada. Passa a subir a api de verdade (build,
   `node dist/main.js`, espera do `/health`) — satisfazer a pré-condição, e
   nunca afrouxar o teste, que seria mudar o julgamento para caber no CI.
   Quem faz o trabalho continua sendo `seed-golden-set-rag.ts`, que sobe o
   próprio contexto Nest; a instância existe para responder ao `/health`.
3. **O seed morria em 409 no portão da imagem.** Ele criava o projeto como
   `runner` justamente para ESCAPAR do portão (RN-105), apoiado na isenção
   que a RN-169/RN-421 davam a `mounted`/`runner` — isenção **revogada pela
   RN-494** (ADR 0135), com o comentário do script continuando a citá-la.
   Agora o seed ATRAVESSA o portão pelo caminho real: decide a imagem por
   `DecidirImagemDoProjetoUseCase`, o mesmo caso de uso do
   `choose_project_image` do Arquiteto, numa sessão `consultiva` que ele
   abre (o evento de decisão exige `session_id`, que é `NOT NULL`) — nunca
   um INSERT de artefato à mão, que faria o golden-set medir contra um
   estado que a produção não sabe produzir.

**E o job passa a exigir que o golden-set tenha MEDIDO.** A guarda é a linha
de resultado (`N/N casos acertaram`), que só é impressa depois de os 17
casos rodarem; sem ela o passo reprova nomeando o motivo. Ela é necessária
porque o `{:skip, motivo}` que o teste devolve do CORPO **é inerte** — não
existe skip em runtime no ExUnit, e o que se vê é `Result: 1 passed`. Foi
exatamente o que aconteceu ao medir: com o seed morrendo em 409, o teste
passou. `excluded` NÃO serve de sinal aqui, ao contrário do que a guarda
irmã de `ci.yml` verifica: a saída legítima traz mais de mil excluídos, que
são todos os outros testes do engine, fora pela tag.

Medido depois das três correções, nesta máquina, pelo caminho que o job
passa a percorrer: **17/17 no top-5**, igual às duas rodadas manuais que
gravaram o piso.

- **Onde:** `.github/workflows/golden-set-rag.yml`, `apps/api/config/gates.yml`
  (`rag-acertivo`), `apps/engine/mix.exs`,
  `apps/api/scripts/seed-golden-set-rag.ts`
- **ADR:** [0138](../adr/0138-golden-set-do-rag-em-ci-agendado.md)
- **Origem:** plano do dono do produto, Parte 2 / Etapa 3

## FASE 29 — a instalação de uma linha: assinar o que se publica

| situação | o que o sistema faz |
|---|---|
| Transição de estado inválida | erro tipado (`InvalidSessionTransitionError` etc.), traduzido para 4xx — nunca grava estado inconsistente |
| Agente estoura o teto de iterações ou tokens | encerra e registra artefato de bloqueio com a origem da falha |
| Task esgota o ciclo K | bloqueada com motivo, não gira para sempre (RN-015) |
| Provider de LLM cai no meio | registrado como falha de **infra**, nunca "o modelo parou" (RN-023) |
| Duas decisões concorrentes na mesma hipótese | conflito explícito (RN-022) |
| Réplica do engine cai | sessão é adotada por outra ou encerra como `closed_abnormally / node_shutdown` — nunca fica órfã |
| `QaLeadServer`/`SecOpsAgentServer` cai no meio de um ciclo de gate | `Engine.Gates.GateRescuer` retoma sozinho — reinicia a área (nenhum veredito gravado) ou reenvia a chamada perdida (veredito já gravado) — sem intervenção manual (RN-140) |
| Rate limit indisponível | a requisição **passa**: o guard protege contra abuso, não contra acesso indevido |
| Rate limit **estourado** (429) | a tela diz o que a api respondeu e o poll para; a app nunca responde ao limite com mais tráfego (RN-088) |
| Credencial errada, conta inexistente ou conta bloqueada | **a mesma** resposta 401, com o mesmo custo de argon2 (RN-032) |
| Refresh já usado reapresentado | família revogada e evento de segurança; o usuário legítimo também é deslogado (RN-030) |
| Tráfego interno sem o segredo de serviço | 403 na api, 401 no engine — nunca alcança o controller (RN-035) |
| Provider recusa a chave durante o sync de catálogo | provider **pulado** com a origem da falha; nenhum modelo é marcado como sumido (RN-041) |
| Modelo do binding some do provider | a cascata cai para o nível de baixo e AVISA qual escopo pulou — nunca troca o modelo em silêncio (RN-041) |
| Preço do modelo muda | vale daqui em diante; o custo gravado e o preço que o produziu ficam intocados (RN-042) |
| Criar o handoff falha (Criativo→PO, Arquiteto→Infra/Dev Lead) | `agent.error` durável, o processo do agente CONTINUA vivo; o que já foi gravado antes (product_brief, regras) não se perde (RN-116) |
| Caminho de projeto **Pasta montada** fora de `BRABO_PROJECTS_BASE` | a criação é **recusada** (400) nomeando a base e sugerindo `<base>/<nome>` — o projeto não nasce para travar depois (RN-170/RN-501) |
| Pasta de projeto **Pasta montada** inalcançável quando a Infra sobe o container | `container_start` termina `failed` NOMEADO (variável, caminho, dono da pasta, próximo passo) e o ciclo de vida **não** chega a `provisioning` (RN-501) |
| `BRABO_PROJECTS_BASE` ausente | a api responde `projectsBase: null` e a criação de projeto **não oferece** o modo Pasta montada — nunca oferecer um modo que a instalação não honra (RN-500) |
| Navegador de pastas recebe um `path` fora da base (inclusive a armadilha de prefixo `<base>2`) | **400** que nomeia a base — malformado, e não 403: nenhum papel navega fora dela (RN-504) |
| Navegador de pastas recebe um `path` dentro da base que a api não consegue abrir | **404** dizendo QUAL dos dois é (não existe / existe e não dá para ler) — nunca 500 com mensagem de `fs` (RN-504) |
| Pasta navegada só tem arquivos, symlinks, ou mais de 500 subpastas | a listagem volta com `arquivos`/`simbolicos`/`truncado` e a tela DIZ o que ficou de fora — pasta cheia de código nunca se apresenta como vazia (RN-504) |
| `BRABO_PROJECTS_BASE` sobreposta ao checkout do Brabo (nos dois sentidos) | `pnpm dev` **recusa subir**, nomeando os dois caminhos. Nenhuma validação da api pega isso: ela compara contra `process.cwd()`, que dentro do container dela é `/workspace` (RN-500) |
| `BRABO_PROJECTS_HOST_BASE` ausente no broker e `container_start` de projeto `mounted` | recusa **nomeando a variável** (503, origem `infra`), sem tocar container nenhum — nunca cai na outra raiz, que apontaria para a pasta de outro projeto (RN-503) |
| Projeto `mounted` LEGADO, com a pasta fora da base | a spec devolve `localizacao.tipo: 'indisponivel'` com o motivo nomeando a base e o caminho; o broker recusa com 409 e o conserto é **mover a pasta**, não trocar de modo (RN-503) |
| Broker fora do ar (ele sobe sob `profiles` e NÃO sobe por padrão) e `container_start` de projeto `mounted` | a ação termina `failed` com o motivo do `BrokerIndisponivelError`, nunca exceção — e nada transiciona no ciclo de vida (RN-503) |
| Localização de projeto incoerente no banco (par modo/caminho gravado por fora da criação) | a ativação da execução recusa com **400** e o motivo em pt-BR, nunca 500 sem corpo (RN-478) |
| Login social: e-mail do provider bate com conta existente mas NÃO verificado | recusado com 403, nenhum vínculo gravado — e-mail não verificado não é prova de identidade (RN-274) |
| Login social: `state` inválido/expirado, ou de outro PROPÓSITO (fluxo de conexão de git) | recusado, nenhuma chamada ao provider nem escrita no banco (RN-273) |
| Validar a necessidade sem `product_brief` nenhum na sessão | recusado (400) ANTES de gravar qualquer evento — não há o que validar ainda (RN-406) |
| Converter `execution_mode` com dev agent trabalhando ou travado | recusado (409) ANTES de mexer no permissions.json ou no ciclo de vida do container — nunca migra um agente vivo (RN-447) |
| Pasta local anexada estoura o teto de arquivos ou de bytes somados | recusado (400), o lote inteiro — nunca trunca em silêncio (RN-456) |
| Arquivo individual da pasta local é grande demais ou de extensão não reconhecida | só PULADO (`filesSkipped`), nunca derruba o upload inteiro (RN-456) |
| Confirmar um pedido de pull de modelo que já não está `pending_confirmation` | recusado (409) — a confirmação não é reexecutável (RN-462) |
| Pull de modelo Hugging Face falha no Ollama | pedido termina `failed` com a origem declarada (infra/modelo), nada é ativado no catálogo (RN-462) |
| Binário do runner indisponível (release sem asset, GitHub fora) durante a configuração pelo navegador | a pasta escolhida e os dois arquivos de configuração FICAM; a tela diz o motivo e troca a instrução pelo caminho `npm install -g @brabo/runner` (RN-473) |
| Runner não conecta dentro do teto da espera | a tela diz que não viu, declara que isso não é prova de ausência e aponta a aba Código — nunca "verificando" para sempre (RN-474) |
| Pasta do runner com chave de dispositivo presente e inválida (JSON quebrado, ou sem `kid`) | o CLI recusa NOMEANDO o arquivo e o motivo, e oferece as duas saídas — nunca o bloco de uso, que é a resposta de quem não configurou nada (RN-475) |
| Criar o repositório falha antes de existir linha de bootstrap | o endpoint de status reporta `provision_failed` com o motivo lido da `proposed_action`, e `failedStep` fica NULO — nenhum passo do Gitflow foi tentado, e nomear um seria inventar (RN-477) |
| `step.check` do bootstrap falha (token expirado, 403, timeout) | vira `status: 'failed'` + `lastError` na linha e `bootstrap.step_failed` no event log — antes subia sem tocar em nada e a tela pollava para sempre (RN-477) |
| Provisionamento não converge dentro do teto da tela | a espera PARA em 3 minutos, declara que isso não prova fracasso e oferece procurar de novo — sem disparar um segundo POST (RN-477) |
| Aplicar um modelo a todos os agentes e a api recusar PARTE deles | as linhas que passaram ficam gravadas e são relidas; o aviso diz quantas de quantas e NOMEIA as que ficaram — nunca "salvo" nem "não salvo", que seriam as duas mentira (RN-476) |
| INSERT da telemetria de busca do RAG falha | a busca **responde assim mesmo**, com `searchId: null`, e a falha vira log com origem `infra` — o instrumento de medição não derruba o que ele mede, e também não some calado (RN-479) |
| Voto num `searchId`/`chunkId` que aquela busca não devolveu | 400 que ensina, nada gravado — voto sem rank não distingue "índice pobre" de "pesos errados", e número sem significado é pior que número nenhum (RN-480) |
| `medir:rag` numa janela em que `vector_available` foi `false` o tempo todo | **reprova (exit 1)**: o que foi medido não é a busca híbrida, é a metade léxica dela, e calibrar peso de vetor contra isso seria calibrar contra outro sistema (RN-479) |
| `route_modules_to_infra` chamado sem `module_map` vigente, com lista vazia, módulo repetido, módulo fora do mapa, ou imagem inválida (`latest`/sem tag/`rationale` curto) | 400 nomeando o que falta ou o que está errado — pelo agente, tool-result de erro que o modelo corrige, nunca crash (RN-487) |
| `container_start` elege uma imagem fora das candidatas do roteamento vigente do Arquiteto | ação vira `failed` nomeando a imagem recusada e listando as candidatas válidas — nem a imagem é decidida nem o broker é chamado (RN-491) |
| Broker recusa ou está indisponível ao subir o container (`BrokerRecusouError`/`BrokerIndisponivelError`) | ação vira `failed` com a mensagem do broker — nunca propaga, nunca fica pendente (RN-491) |
| `emit_artifact` com `type: decision_record` faltando `context`/`options`/`choice`/`consequences` | tool-result de erro nomeando a(s) chave(s) que faltam — o modelo corrige na próxima volta do laço, nunca crash (RN-505) |
| Terminal/worktree num projeto `runner` verificado e conectado, mas SEM container `running` | recusa NOMEADA (`RunnerReadiness`), nunca cai no host puro — Docker é pré-requisito real, sem fallback (RN-507) |
| `RunnerGit` tenta materializar o worktree sem as três pré-condições da RN-507 | levanta com mensagem nomeada ANTES de qualquer `exec` — nunca tenta às cegas e deixa o timeout do canal explicar (RN-507) |
| Job periódico de limpeza de worktree encontra um projeto `runner` sem runner conectado ou sem container `running` | PULA o projeto nesta rodada, em silêncio — nunca um erro, nunca deixa de podar os demais projetos (RN-507) |
| `container_start_via_runner` proposto para projeto `container`/`mounted`, ou `runner` sem runner conectado | o Infra Lead RECUSA localmente, nomeando o motivo, sem chamar `propose_action` nenhuma vez (RN-508) |
| `container_start_via_runner` aprovado sem imagem decidida (RN-105) | ação vira `failed` nomeando a ausência de decisão — nunca chama o engine (RN-508) |
| Runner conectado a um projeto cujo `execution_mode` exige uma capacidade que ele não declarou no `join` | join **recusado** nomeando a capacidade e mandando atualizar o binário — recusa fatal, sem retry, nunca degradação silenciosa (RN-514) |
| Runner que declara uma capacidade que ESTE servidor não conhece | o nome é **ignorado** e o join passa — runner mais novo que o engine conecta (RN-514) |
| `exec` despachado a um runner que não declarou a capacidade `exec` | responde ao chamador no mesmo formato de `exec_result`, com `exitCode` 126 e a causa no `output` — nunca deixa o `RunnerRouter` esperar até o timeout (RN-514) |
| `pty_*` relayado a um runner que não declarou a capacidade `pty` | a mensagem NÃO é entregue e a `:web` recebe `pty_error` nomeado — nunca "carregando" para sempre (RN-514) |
| Destino de espelho dentro do `workspacePath` do projeto, ou contendo ele | **400** nomeando o sentido do laço — os dois são a mesma recusa, e a comparação é por SEGMENTO, então `/base-outra` NÃO conta como dentro de `/base` (RN-515) |
| Destino de espelho declarado num projeto `execution_mode: container` | **400** NOMEANDO o motivo (a origem é um volume do servidor, o agente local não a enxerga) — nunca aceitar e nunca copiar (RN-515) |
| `PUT .../mirror-path` sem a chave `mirrorPath` no corpo | **400** — omitir seria indistinguível de pedir para LIMPAR, e limpar em silêncio é o defeito; limpar é `null` explícito (RN-515) |
| `brabo-runner service install` rodado como root | **recusa nomeada**, sem escrever arquivo nem rodar comando — o serviço é de usuário por desenho, e um root quebraria a premissa das três fronteiras do produto (RN-518) |
| `brabo-runner service <qualquer>` no Windows (ou em qualquer plataforma fora de Linux/macOS) | **recusa nomeando a plataforma**, dizendo que a decisão é declarada e apontando o primeiro plano — nunca falha muda, nunca um "instalado" que não instalou (RN-518) |
| `service install` numa pasta sem chave de dispositivo válida | **recusa nomeando o arquivo** — um serviço autentica por chave, nunca por token, que ficaria em disco dentro da unit (RN-518) |
| `systemctl`/`launchctl` indisponível durante o `service install` | o arquivo de unit **FICA**, e a resposta diz que não ativou, nomeando o comando pendente — apagá-lo viraria "não aconteceu nada", que é falso (RN-518) |
| `service uninstall` sem unit instalada e sem `--dir` | responde NÃO INSTALADO e **não toca em arquivo nenhum**: sem o registro da unit, adivinhar pelo `cwd` apagaria a chave de outro projeto (RN-518) |
| `service status` numa máquina sem o gerenciador de serviços no PATH | responde "instalado, e NÃO consegui perguntar" com código próprio — "não sei" nunca vira "parado" (RN-518) |
| Projeto do workspace que NUNCA provisionou container, na página `/containers` | aparece na lista com `registrado: null` e o texto **"nunca provisionado"** — nunca `stopped`, nunca "não observado", e nunca gasta uma das 20 verificações do broker (RN-521) |
| "Subir" clicado num projeto sem `artifact.project_image` decidido | o botão nem fica ativo: a tela DIZ que falta decidir a imagem, em texto, em vez de propor uma ação que já se sabe que termina em falha (RN-521/RN-105) |
| "Subir" num projeto `runner` cujo `workspaceVerifiedAt` é nulo | botão inerte com motivo PRÓPRIO ("nenhum agente local jamais confirmou a pasta") — nunca colapsado com "sem imagem decidida" (RN-521) |
| "Subir" num projeto `runner` com pasta confirmada mas runner possivelmente desligado | a tela OFERECE e escreve a ressalva: confirmação de pasta não é presença de agente (RN-468), e a ação falha ao ser aprovada se ele não estiver de pé (RN-521) |
| Papel abaixo de `maintainer` na página `/containers` | controles inertes com o motivo dito UMA vez em texto; estado, imagem e recursos continuam VISÍVEIS (RN-521/RN-102, ADR 0064) |
| `brabo-runner --base <caminho>` com caminho relativo, com `..`, igual a `/`, apontando para um arquivo, ou (no Linux) fora do `$HOME` | **recusa nomeando o motivo** e sai com código 2 — pedido explícito digitado agora que não dá para honrar, a mesma disposição de `--dir` recusado (RN-529) |
| `--base` DENTRO da pasta deste projeto, ou igual a ela | recusa `base-dentro-da-raiz`: todo projeto novo nasceria dentro deste. O sentido CONTRÁRIO (a pasta do projeto dentro da base) é o arranjo normal e passa (RN-529) |
| `$XDG_CONFIG_HOME/brabo/runner.json` corrompido, ou com uma base que a guarda recusa | a recusa é DITA em `stderr`, nomeia o que se perde, e o runner **segue sem base** — derrubar um agente que atende um projeto por uma configuração que ele ainda não usa seria desproporcional (RN-529) |
| Arquivo de base que existe e não declara `base` | é **ausência**, não recusa: configuração sem base consentida, não configuração quebrada — o runner roda como sempre (RN-529) |
| Projeto cuja pasta (`--dir`) está FORA da base configurada | segue **válido**, sem aviso: a base é regra de criação, e o léxico de `--dir` é para sempre — a mesma proibição escrita em `project-workspaces-root.ts` (RN-529/RN-501) |
| Segmento de projeto ABSOLUTO, com `..`, apontando para a própria base, ou escapando dela por symlink | recusa nomeada por motivo próprio, na dupla passada (léxica e por `realpath`) — nunca aceito e reinterpretado, porque o que atravessa a rede é o SEGMENTO (RN-529, ADR 0130) |

## Quando dá errado

A [FASE 28](../explanation/fase-28-pasta-do-usuario.md) recusou por escrito o
instalador de uma linha enquanto os artefatos não fossem assinados (BRB-005), e
é por isso que a [FASE 29](../explanation/fase-29-instalacao-de-uma-linha.md)
assina **antes** de instalar. Sessão 2, [ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md).

### RN-524 — Artefato publicado é assinado por identidade de workflow, verificado no mesmo run, e a verificação recusa em vez de avisar {#rn-524}

Toda tag final assina o que publica, e **verifica o que assinou antes de
publicar a Release**:

- as **cinco imagens** são assinadas **por DIGEST** (eram quatro quando esta
  regra foi escrita; a quinta, o broker, entrou com o
  [ADR 0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)), lido de
  `.release/images.json` — nunca por tag. Tag é ponteiro móvel: assinar
  `:5.0.0` atestaria o que aquela tag apontava no instante da assinatura, e não
  o que ela aponta quando alguém baixa. O digest é o que o manifesto já registra
  e o que o overlay de produção já aplica (ADR 0119);
- os **binários** do runner (cinco alvos quando esta regra nasceu, **quatro**
  desde o [ADR 0174](../adr/0174-runner-sem-binario-darwin-x64.md), que tirou o
  `darwin-x64`) são cobertos por **UM** `checksums.txt` assinado, e não por
  uma assinatura por binário — quem verifica três e esquece o quarto não tem
  como saber que esqueceu;
- a assinatura é **keyless** (OIDC do GitHub Actions): a identidade que assina é
  o próprio workflow, e não existe chave privada em custódia. Um par de chaves
  próprio significaria mais um segredo de CI, e este repositório já viu um PAT
  expirar em silêncio e reprovar duas runs do `tag-release`
  ([ADR 0139](../adr/0139-o-alarme-de-esteira-ganha-destinatario.md));
- **falha de verificação é recusa nomeada, nunca aviso.** Um aviso que se aceita
  clicando é uma verificação que não existe.

O manifesto **declara o que cobre**. A matriz é `fail-fast: false` de propósito,
então um alvo que não construiu não impede os outros quatro de terem manifesto —
mas o job nomeia no log os alvos que ficaram de fora, porque um `checksums.txt`
que lista quatro e cala sobre o quinto é pior que nenhum: quem verifica os
quatro conclui que verificou a release. Esta metade era **intenção escrita e
mecanismo que não a cumpria**: com `needs: build`, um alvo que não constrói não
impedia, ele ATRASAVA um dia — ver [RN-565](#rn-565), que a torna verdadeira e
mede o número.

**Onde:** `.github/workflows/release.yml` (passos "Instalar o cosign" e "Assinar
as imagens publicadas", com `id-token: write` no bloco de `permissions`);
`.github/workflows/build-runner-binaries.yml` (job `checksums`, **sem** `needs:`
desde a [RN-565](#rn-565) — a espera é pelos assets, com teto).

**Teste:** `scripts/ci/actions-pinadas.spec.ts` cobre o pin por SHA do
`sigstore/cosign-installer` (com o comentário de versão ao lado, que é o que
diz a um humano e ao Dependabot qual versão é aquele hash). A assinatura em si
só se prova numa tag real — declarado, como o resto da esteira de release.

**Origem:** FASE 29, sessão 2. Fecha **BRB-005** para imagens e binários. NÃO
cobre o *code-signing* de sistema operacional dos binários (notarização do
macOS, Authenticode do Windows), que exige identidade paga e segue no backlog.

## O `install.sh` fecha a instalação (RN-547, FASE 30)

### RN-549 — O E2E em máquina limpa prova a instalação INTEIRA: os cinco elos, o agente de pé esperando, e o primeiro projeto pego sem ninguém voltar ao terminal {#rn-549}

Sessão 8 da [FASE 30](../explanation/fase-30-runner-por-maquina.md), a última — e a
única que podia responder a pergunta que a fase inteira persegue: *numa máquina
limpa, o `install.sh` termina com o agente local de pé e pareado, e a pessoa cria
o primeiro projeto em modo Runner sem voltar ao terminal?* Até aqui a resposta era
uma intenção escrita: a [RN-547](produto.md#rn-547) encadeou os cinco comandos e declarou,
por escrito, que nos testes dela o `brabo-runner` é um dublê de shell e a api é um
`node:http` — *"o que se prova é o ENCADEAMENTO, nunca a integração"*.

**O harness não nasceu aqui: ele foi ESTENDIDO.** `.github/workflows/install-e2e.yml`
existe desde a FASE 29 ([RN-534](produto.md#rn-534)) e já roda o instalador publicado num
runner efêmero do Actions — que é literalmente uma máquina limpa, sem Brabo, sem
`.env`, sem marcador. O que ele provava parava no `.env`: plano, estado, as três
promessas de nunca apagar, o caminho sem TTY, e a subida com TTY simulado. Um
segundo workflow duplicaria o lado caro (esperar a Release, baixar, verificar
assinatura) para medir o lado barato.

**Ele NÃO roda em `pull_request`, e a consequência é declarada em vez de
escondida.** O instalador verifica a própria origem contra o `checksums.txt`
**assinado** de uma Release ([RN-526](produto.md#rn-526)), que só existe depois de uma tag
final; a única forma de fazê-lo rodar em PR seria dar-lhe uma porta para PULAR a
verificação — a porta que o [ADR 0150](../adr/0150-instalador-de-uma-linha.md)
recusa, e que uma vez aberta valeria para qualquer um, não só para o CI. Logo: **o
PR que escreveu este E2E não o executou**, e os checks dele passaram sem exercitar
uma linha do que ele acrescentou. É a mesma decisão do golden-set do RAG
([ADR 0138](../adr/0138-golden-set-do-rag-em-ci-agendado.md)), pelo mesmo motivo.

**Daí a metade que RODA em PR, e é a razão de ela existir.** Workflow que só roda
em tag é workflow cujo erro aparece na tag, quando o release já está saindo e
ninguém olha mais o PR que o quebrou. `scripts/dev/install-e2e.spec.ts` mede as
duas maneiras conhecidas de este E2E apodrecer calado: alguém **afrouxar** o gate
(pôr `pull_request` no gatilho, ou passar uma flag de pular verificação), e alguém
**reescrever uma frase** do `install.sh` — com o que todo `grep` do workflow passa
a não casar nada, e as asserções não falham, elas SOMEM. O canário de prompts é
derivado, não decorado: as respostas do TTY vão por arquivo, **em ordem**, e um
`read -r` novo no instalador desalinha todas as seguintes — a base viraria a
senha —, então o teste conta os prompts e manda olhar o arquivo de respostas.

**O que o E2E passou a provar, e cada asserção tem um dono.** Os cinco elos da
[RN-547](produto.md#rn-547), um a um, contra api e binário de VERDADE — a conta
([RN-546](produto.md#rn-546)), o par gerado na máquina e o `kid` carimbado
([RN-551](runner.md#rn-551)), o registro da pública ([RN-552](api.md#rn-552)) e a unit por
máquina ([RN-545](runner.md#rn-545)). Mais o invariante da [RN-475](web.md#rn-475) medido no
DISCO e não na saída (o arquivo que o runner lê tem `kid`, tem `d`, e o
`.parcial` sumiu quando o `finish` fechou), a senha ausente do `.env`, do
marcador e do log, e o `ownerEmail` presente no marcador.

**A prova NEGATIVA é a que mais vale, e é a ausência do bloco de pendências.** A
[RN-547](produto.md#rn-547) manda relatar cada elo que falha num bloco final nomeado — e
sair **0** do mesmo jeito. Um E2E que olhasse o código de saída daria verde com
quatro dos cinco elos quebrados. *"Nenhuma pendência"* é a única forma de afirmar
que os cinco fecharam, inclusive os que o workflow não sabe nomear.

**O sinal de que o agente está DE PÉ esperando é a LINHA, nunca o estado do
gerenciador — e essa escolha é a decisão central deste E2E.**
`perguntarEstado` mapeia `activating` para `rodando` ([RN-088](web.md#rn-088), com
razão: "subindo" não é "parado"), então tanto `systemctl is-active` quanto
`brabo-runner service status --machine` respondem *de pé* para um processo que vai
morrer dois segundos depois. É exatamente a corrida que um `sleep` fixo esconde, e
medir o artefato errado aqui — um binário no disco, uma unit escrita — é o jeito
mais fácil de um E2E dar verde sem provar nada. O sinal escolhido é a linha que o
processo escreve ao ENTRAR na espera ([RN-550](runner.md#rn-550)): ela só existe depois de
o agente ter lido a chave de máquina do disco, tirado ticket, falado com a api de
verdade e recebido uma lista VAZIA — prova pareamento e espera de uma vez. E não é
amostragem de estado: é um fato já gravado no journal, que não se desfaz. Por isso
esperar por ela com teto não é corrida — ou ela aparece, ou o teto estoura e o
passo reprova mostrando o journal inteiro. `service status --machine` entra
**depois** dela, como confirmação de que o código de saída responde o que o
operador vai ver, nunca no lugar dela.

**O desfecho da fase é medido pela API, e não pelo NAVEGADOR.** O sujeito da
afirmação é o AGENTE, não a página: o que ele observa é `GET /runner/projects`
([RN-543](produto.md#rn-543)), um fato da api. Um navegador criaria o projeto pela MESMA
rota com uma camada a mais que falha por motivos alheios à promessa — e não
tornaria a asserção mais forte, porque ela continua sendo a linha do journal do
agente. A camada de navegador existe (`e2e/`,
[ADR 0120](../adr/0120-e2e-de-navegador-contra-o-compose-de-producao.md)), responde
outra pergunta (três origens, cookie `httpOnly`, CSRF), tem lockfile próprio e
assume o compose de produção de pé: arrastá-la para cá faria o E2E do instalador
depender de um segundo harness instalado numa máquina que deveria estar limpa.
Provar o wizard é trabalho da suíte do web, e ele já é coberto lá. O que o passo
mede é a cadeia inteira: a conta nascida no terminal **atravessa o login** sem
link de verificação nenhum, o workspace pessoal da [RN-410](api.md#rn-410) existe, o
projeto nasce `runner`, e o agente o pega sozinho dentro da cadência de
15s/30s/60s da [RN-550](runner.md#rn-550).

**A idempotência é medida pela metade que o E2E alcança sem reinstalar.** A api
responde `409` de verdade a uma segunda `first-account` — com senha GERADA, nunca
constante, porque `exigirSenhaValida` roda ANTES do conflito e uma senha fraca
daria `400`, medindo a coisa errada. O que o instalador FAZ com esse `409`
(calar-se, e não virar pendência) é classificação de código HTTP, coberta em
`install-fechamento.spec.ts` contra um servidor de teste: repeti-la aqui exigiria
uma segunda instalação inteira, que passa pelo caminho de MIGRAÇÃO
([RN-530](infra.md#rn-530)) — backup provado, apagar, recriar — e é entrega própria.

**A única divergência entre este runner e uma máquina limpa é do AMBIENTE, e está
nomeada.** Numa máquina de verdade quem instala tem sessão de login e o
`systemd --user` já está de pé; o job do Actions roda não-interativo, sem sessão, e
sem ela `systemctl --user` não tem barramento a que falar — o `service install
--machine` viraria pendência por um motivo que não é do produto, e o E2E
"provaria" uma falha de laboratório. `loginctl enable-linger` põe o gerenciador de
usuário de pé; ele não é flag do instalador, não pula verificação nenhuma e não
muda o que a unit faz.

**Dois defeitos apareceram ao escrever isto, e os dois eram invisíveis porque o
workflow nunca rodou.** O primeiro estava no próprio harness: o arquivo de
respostas começava por `nao-migrar`, que numa máquina limpa cai na pergunta do
MARCADOR — ela não casa `s|S|sim|SIM`, o script dizia *"Nada foi gravado"* e saía
0, e a asserção do marcador logo abaixo teria reprovado. A pergunta de migração
está sob `if [ -n "$marcador" ] || [ -n "$sinais" ]`, e numa máquina limpa os dois
são vazios: ela não acontece. Corrigido para as SETE respostas reais.

**O segundo é ACHADO e não foi corrigido aqui, de propósito.** O `install.sh`
publicado **não consegue subir nada sozinho numa máquina limpa**: ele sobe a pilha
com `docker compose -f docker/docker-compose.install.yml`, um caminho RELATIVO ao
diretório de onde roda — e esse arquivo **não é asset da Release, não entra no
`checksums.txt` assinado ([RN-524](#rn-524)), e o script não o baixa em lugar
nenhum** (as únicas descargas dele são o `cosign`, o manifesto, o próprio hash e o
binário do runner). O compose ainda bind-monta `./postgres/init.sql`, então são
TRÊS arquivos e não um. Quem segue o `sh -c "$(curl … install.sh)"` do runbook
morre em *"no such file or directory"* **depois** de já ter verificado assinatura,
escolhido a base e gravado o `.env`. Consertar é decidir se o compose vira asset
assinado ou se o instalador passa a clonar — entrega própria, não algo a fazer de
passagem dentro do E2E que descobriu o buraco. O workflow traz os três à mão, pela
tag, num passo que DIZ que é achado; o teste em PR cobra as duas metades (o passo
existe, e o instalador continua usando o compose sem baixá-lo), e o dia em que o
instalador os buscar sozinho o teste reprova — e o certo então é apagar o passo,
não relaxar o teste.

**O que NÃO entrou:** porta nenhuma para pular a verificação de origem; `apps/`
intocado (o achado virou relato, não correção de passagem); nenhum segundo
workflow de E2E de instalador; e nenhum gate afrouxado — em particular, o E2E
continua fora de `pull_request`.

- **Código:** `.github/workflows/install-e2e.yml:16` (o gatilho que segue sem
  `pull_request`), `:111` (o passo do achado — os três arquivos que o instalador
  não baixa), `:172` (a sessão de usuário do systemd, a divergência declarada),
  `:204` (a instalação completa com as SETE respostas), `:241`–`:245` (os cinco
  elos da RN-547, um por linha), `:253` (a prova negativa — nenhuma pendência),
  `:267`–`:274` (o `kid`, o `d` e o `.parcial`, medidos no DISCO e não na
  saída), `:278` (a senha que não vazou), `:307` (o
  agente de pé, pela linha do journal e não pelo gerenciador), `:354` (o primeiro
  projeto pela api, e o agente pegando-o), `:415` (o `409` da segunda conta)
- **Teste:** `scripts/dev/install-e2e.spec.ts` — a metade que roda em PR: o
  gatilho lido do DOCUMENTO (não do texto, que casaria com o comentário que
  explica por que `pull_request` não está lá), a ausência de flag de pular
  verificação nos dois arquivos, o contrato de frases entre workflow e
  `install.sh` (os cinco elos mais as quatro de sempre), as duas linhas do
  `apps/runner` de que as asserções dependem, o canário de prompts interativos, a
  ORDEM entre a linha do journal e o `service status --machine`, e as duas metades
  do achado do compose. Verificado por mutação: reescrever uma frase do
  instalador e pôr `pull_request` no gatilho reprovam
- **Lacuna DECLARADA:** este E2E **não roda no PR que o escreveu**, e nenhum
  check dele prova uma linha do que foi acrescentado — a primeira execução real é
  a próxima tag final. Fica também fora, e não por esquecimento: a segunda
  execução do instalador pelo caminho de MIGRAÇÃO ([RN-530](infra.md#rn-530)) — backup,
  prova de restauração, apagar e recriar —, o macOS (o passo completo é Linux:
  `launchd`, e o Docker que o runner hospedado não tem), e o navegador
- **ADR:** [0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md)
- **Origem:** FASE 30, sessão 8 —
  [o recorte da fase](../explanation/fase-30-runner-por-maquina.md)

## A chave de dispositivo ganha tela, e a tela diz o alcance de revogar (RN-561)

### RN-565 — O manifesto assinado sai com o que a Release TEM, e não espera a plataforma que nunca constrói {#rn-565}

O `checksums.txt` assinado ([RN-524](#rn-524)) é a pré-condição de duas outras
regras: sem ele, `GET /runner-releases/binary` recusa com
`release_sem_manifesto` ([RN-525](produto.md#rn-525)) e o `install.sh` recusa a si mesmo
([RN-526](produto.md#rn-526)) — **em todas as plataformas, inclusive as que anexaram
binário direito**. Um manifesto que atrasa não é um manifesto atrasado: para
quem instala nesse intervalo, é um manifesto ausente.

**A medição, contra as três tags que existem.** Em `v4.0.0`, `v4.0.1` e
`v5.0.0`, o alvo `darwin-x64` (`macos-13`) ficou **24h00m01s** na fila e foi
cancelado pelo teto do Actions — o MESMO número nas três, o que diz que ele
nunca chega a ser agendado. Os outros quatro jobs terminam em no máximo
**4m18s** (`linux-x64` na `v4.0.1`, 17:38:28Z → 17:42:44Z). O job `checksums`
tinha `needs: build`: o `always()` garantia que ele RODASSE (dependência
cancelada está coberta), nunca QUANDO.

**A regra:** o job do manifesto **não depende da matriz**. Ele espera os
**ASSETS** da Release, não os **JOBS** — com teto —, e publica o que existir,
nomeando no log o que não cobre. A ausência de um alvo é desfecho previsto
(`::notice::`), nunca erro; a ausência da **Release** continua sendo erro
nomeado, porque este workflow só ANEXA e nunca cria; e **nenhum** binário
anexado continua sendo erro, porque um `checksums.txt` vazio afirmaria que a
release não tem binários quando o que houve foi a matriz inteira falhar.

**O teto dos binários é 1200s, e o número não é arbitrário:** é o
`timeout-minutes: 20` do próprio job `build` — o máximo que um alvo **com
runner** pode demorar depois de começar. O que ele deliberadamente não cobre é
o tempo de **fila**, e não cobrir tempo de fila é o ponto inteiro. O laço sai
cedo quando todos os alvos chegam, que é o caminho feliz.

**Nada do que o job FAZ muda.** Ele continua montando o manifesto a partir dos
assets (e não de `dist-bin/`, vazio ali), assinando com `cosign` keyless e
verificando antes de anexar — [RN-524](#rn-524) intacta, um manifesto e não
cinco assinaturas. E um alvo que anexe DEPOIS do teto não fica órfão: o
`--clobber` já existia para isso, e refazer o manifesto é um
`workflow_dispatch` com a mesma tag.

**O que esta regra NÃO faz:** `darwin-x64` continua não construindo. Trocar o
label, tirar a plataforma ou pagar runner é decisão de dono, e o manifesto não
pode depender dela — é justamente por depender dela que ele não saía.

> Medido depois, na AT-065 (2026-09-13, por `workflow_dispatch` em ensaio):
> `macos-13` é label sem runner (imagem aposentada pelo GitHub em dez/2025;
> 30min na fila, cancelado, run `34769280227`). `macos-15-intel` agenda em
> 3–22s e constrói, mas reprova no `--self-test-pty` porque, sob o Bun, o
> `onData` do `node-pty` não entrega a saída do filho (oven-sh/bun#25822,
> aberto); a mesma prova passa sob Node no mesmo runner (run `34770476634`).
> A decisão pendente deixou de ser de runner e passou a ser esperar o Bun ou
> tirar a plataforma. A regra acima não muda com isso.

> **Decidido em 2026-09-27 ([ADR 0174](../adr/0174-runner-sem-binario-darwin-x64.md), AT-065):
> a plataforma saiu.** A matriz passou a QUATRO alvos, e `ALVOS_ESPERADOS`
> acompanhou — é contra ele que a ausência é declarada, e deixar `darwin-x64`
> ali faria todo manifesto anunciar, para sempre, uma falta que é decisão. O
> Mac Intel fica com `npm install -g @brabo/runner` (sob Node, onde a mesma
> prova passa): o `install.sh` diz isso sem tentar baixar, o proxy
> `GET /runner-releases/binary` recusa `darwin-x64` com 400 próprio que aponta
> o npm, e o painel do navegador nem pede o download. A regra desta RN não
> muda: ela continua valendo para qualquer alvo que fique sem runner, e
> `scripts/ci/alvos-do-runner.spec.ts` reprova quando a matriz, a lista da api,
> o `case` do instalador e a do navegador divergem.

- **Código:** `.github/workflows/build-runner-binaries.yml:283` (o job, agora
  sem `needs:`), `:318` (`timeout-minutes: 40`, que cabe as duas esperas),
  `:335` (`ALVOS_ESPERADOS` no JOB, para os dois passos lerem a mesma lista),
  `:397` (o passo que espera), `:401`/`:402` (os dois tetos), `:410` (a Release
  ausente, que é erro), `:433` (o teto dos binários, que é `notice`), `:499` (o
  manifesto nomeando o que não cobre)
- **Teste:** `scripts/ci/checksums-nao-espera-a-matriz.spec.ts` — que o job não
  tem `needs:`, que os dois tetos existem, que o teto dos binários é derivado
  do `timeout-minutes` do `build` (e não copiado), que ele cabe no
  `timeout-minutes` do próprio job, que ausência de alvo é `notice` e ausência
  de Release é `error`, que `ALVOS_ESPERADOS` bate com a matriz, e as quatro
  garantias do ADR 0149 que esta mudança não toca (uma assinatura, verificar
  antes de anexar, `id-token: write`, o `install.sh` no manifesto). É ESTÁTICO,
  e o limite é declarado no topo do arquivo: o job só se prova numa tag final,
  e nunca rodou em nenhuma
- **Lacuna DECLARADA:** a matriz é de TRÊS alvos desde o
  [ADR 0187](../adr/0187-runner-sem-binario-win32-x64.md) (o `win32-x64` saiu pelo
  mesmo molde do ADR 0174, e `ALVOS_ESPERADOS` acompanhou) e a Release
  continua recebendo **dois** — o `darwin-arm64` está provado em ensaio
  ([RN-688](runner.md#rn-688)) e só falta uma tag final exercitá-lo. O manifesto vai nascer cobrindo dois e vai
  **dizer** isso, que é a diferença entre parcial e silencioso. E, com a matriz
  falhando inteira, o job gasta as duas esperas antes de recusar
- **ADR:** [0149](../adr/0149-assinatura-dos-artefatos-publicados.md)
- **Origem:** AT-051 (EP-009/HS-035)
