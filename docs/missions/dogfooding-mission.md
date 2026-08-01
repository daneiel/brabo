# Missão: primeiro dogfooding — Bitbucket e Generic pela mão dos agentes

A Fase 10 entrega dois providers de git do backlog — `BitbucketProvider` e
`GenericGitProvider` — e entrega junto a primeira execução real do Brabo
construindo software de produção. O software é o próprio Brabo.

**O método é parte do escopo.** Este documento não é um plano de implementação:
é o protocolo do experimento. Quem implementa são os agentes, conduzidos dentro
do produto. Quem observa é você. Desvio do protocolo é achado, não atalho.

Este arquivo não é página do site — `docs/missions/**` é excluído do build do
Docusaurus (`website/docusaurus.config.ts:186-187`), mesmo motivo pelo qual
`doc-mission.md` mora aqui. Ele é material de trabalho versionado, lido no
repositório.

---

## O que está sendo medido

Duas coisas ao mesmo tempo, e é importante não confundi-las:

1. **O produto entrega?** Os dois providers existem no fim, passando na suite de
   contrato única?
2. **Como é conviver com ele?** Quantos cliques de aprovação por task. Quantas
   vezes você precisou intervir à mão, e por quê. Quanto custou. Se o parecer
   consolidado do QA Lead dizia algo útil ou era ruído.

A segunda é a que não dá para recuperar depois. Um travamento de agente às 2h da
manhã, destravado no impulso e não anotado, é dado perdido para sempre. A tabela
da Parte 3 existe para isso.

---

## Princípios inegociáveis

1. **Travamento é achado de altíssimo valor.** Se os agentes empacarem, a
   resposta **nunca** é abrir o editor e implementar o provider por fora. É
   registrar o travamento com a origem (`infra` | `modelo` | `código` |
   `política`), destravar por intervenção **documentada** na tabela, e seguir.
   O experimento que nunca trava não mede nada.

2. **Nenhum ajuste de instrução fora do fluxo da Anamnese.** Se um agente está
   se comportando mal, isso é sintoma a ser observado — não bug a ser corrigido
   editando o prompt no meio do caminho. O caminho legítimo é o Psicólogo propor
   hipótese e a Anamnese virar patch, que **você aprova ou nega**. Editar
   instrução por fora invalida o loop inteiro, que é justamente uma das coisas
   sob teste.

3. **Nenhum refactor do produto durante a fase.** Achado vira backlog priorizado
   na colheita (Parte 4), nunca fix embutido. Corrigir enquanto mede destrói a
   medição.

4. **A esteira do repositório vale integralmente para PR de agente.**
   `pr-police`, `approval-ladder`, gates de QA e SecOps. Sem exceção, sem
   bypass, sem "é só um teste".

5. **Merge em branch protegida é sempre seu, manual.** Isso não é regra do
   experimento — é garantia do produto (`decide.ts:149-160`: merge com destino
   protegido nunca é auto-aprovável, nem por `agent_autonomy`, nem por
   `permissions.json`). Está aqui só para deixar claro que não há o que afrouxar.

6. **Não invente número na colheita.** Toda métrica da Parte 4 tem que fechar
   com o event log. O que não fechar entra como "não medido", não como
   estimativa.

---

# PARTE 1 — MONTAGEM

## 1.1 O bloqueio que define a montagem

O plano original era apontar um projeto dentro do Brabo para o repositório do
próprio Brabo. **O produto não sabe fazer isso**, e a descoberta é o primeiro
achado da fase.

`ProvisionRepositoryUseCase` só tem dois caminhos: retomar um repositório já
persistido para aquele projeto, ou chamar `provider.createRepo(...)` — sem
condição, sem alternativa (`provision-repository.use-case.ts:144`). A única rota
de provisionamento é `POST projects/:projectId/git/:provider/repository`
(`git.controller.ts:159`), e o DTO aceita apenas `name`, `visibility` e
`namespace` (`apps/api/src/interfaces/http/git/dto/provision-repository.dto.ts`)
— não há campo para `externalId` nem URL de repositório existente.

O método `getRepo`, que leria um repositório alheio por id, existe no provider
(`github-provider.ts:82`) e **não é chamado por nenhum caso de uso**. É
capability morta para este fluxo.

Contra um repositório que já existe, `createRepo` levanta
`GitRepoAlreadyExistsError` (`github-provider.ts:73`) — tratado como erro, nunca
como oportunidade de adoção.

E forçar o caminho seria pior do que não conseguir. O passo `protect_branches`
do bootstrap roda `updateBranchProtection` com `enforce_admins: true` e
`required_approving_review_count: 1` (`github-provider.ts:170-175`), sobre as
quatro branches de `PROTECTED_BRANCH_NAMES` (`bootstrap-steps.ts:94`:
`main`, `rc`, `qa`, `dev`). Isso **sobrescreveria as proteções da Fase 6** e
pode bloquear o seu próprio merge manual num repositório de dono único — risco
que o `docs/adr/0028-protecao-de-branch-divergencia-entre-providers.md:83-84` já
documenta em prosa. O bootstrap ainda criaria uma branch `rc`
(`bootstrap-steps.ts:195`) que a política de branches do Brabo não usa.

## 1.2 O procedimento: fork, seed manual, sem bootstrap

**Decisão:** o experimento roda contra um **fork** do `brabo`, e as linhas de
repositório provisionado são inseridas à mão, marcadas como convergidas. O
bootstrap de Gitflow **não roda**.

Por que fork e não repositório novo pelo wizard: um repositório novo nasce vazio.
Os agentes precisam do código do Brabo para implementar os providers dentro dele,
e precisam dos workflows de `pr-police`/`approval-ladder`/gates para que o
princípio 4 seja verdade. O fork traz as três coisas de graça — histórico,
`dev`/`qa`/`main`, e `.github/workflows/`.

Por que não rodar o bootstrap: os seis passos são idempotentes e a maioria sairia
`skipped` contra um fork (as branches já existem), mas dois **agiriam** —
`create_rc_branch` criaria a `rc`, e `protect_branches` sobrescreveria a proteção
herdada. Nenhum dos dois é desejado, e "skip é sucesso" (RN-029) não ajuda
quando o passo não é skip.

Passos:

1. Fork do `brabo` na sua conta. Anote o `owner/repo` resultante.
2. Registre o PAT do GitHub por `POST users/me/git-credentials`. O token é
   testado **antes** de ser cifrado (`register-git-credential.use-case.ts:23`),
   então token inválido não chega a gravar nada.
3. Crie o projeto no Brabo pela UI normalmente, **sem** provisionar repositório.
4. Insira à mão a linha de `provisioned_repositories` apontando para o fork
   (`provider: 'github'`, `external_id: '<owner>/<repo>'`, `default_branch:
   'dev'`), e a linha de `repo_bootstraps` correspondente marcada como
   convergida — para o produto não tentar retomar bootstrap nenhum.
5. Registre isso como a **entrada #1** da tabela de observação. É a primeira
   intervenção manual do experimento, e ela aconteceu antes de o experimento
   começar.

> **TODO(humano):** qual `owner/repo` do fork? O procedimento acima precisa do
> valor literal para a linha de `provisioned_repositories` — e a colheita vai
> querer citá-lo.

## 1.3 Pré-condições — status real

Levantado contra o código, não contra o CLAUDE.md.

| # | pré-condição | status | evidência |
|---|---|---|---|
| 1 | Projeto apontando para o repositório do Brabo | ⛔ **bloqueado** — contornado pelo fork (1.2) | `provision-repository.use-case.ts:144` |
| 2 | Credencial do GitHub válida | ✅ pronto — rota existe e testa a conexão antes de cifrar | `register-git-credential.use-case.ts:23` |
| 3 | Áreas de QA e Infra ativas | ➖ **não aplicável** — não há o que ativar (ver 1.3.1) | `apps/api/src/db/schema.ts:781-786` |
| 4 | Bindings de modelo por agente | ✅ pronto — `PUT projects/:projectId/agent-bindings/:agentSlug` | `model-bindings.controller.ts:153` |
| 5 | Budget por task | ✅ pronto — `projects.task_budget_micros`, via `POST .../execution/activate` | `apps/api/src/db/schema.ts:288` |
| 5b | Budget por área | ⛔ **não existe** — só desenhado no ADR 0038 | ver 1.3.1 |
| 6 | Catálogo de modelos sincronizado | ⚠️ **parcial** — só o OpenAI lista catálogo (ver 1.3.2) | `openai-provider.ts:22` |
| 7 | Autonomia manual em tudo | ✅ pronto **por default** — nada a configurar (ver 2.1) | `decide.ts:125-128` |
| 8 | Seed base | ⚠️ parcial — cria workspace, projeto e 7 modelos; sem git, sem budget, sem execução | `apps/api/src/db/seed.ts` |

### 1.3.1 Sobre o item 3: a tabela `agent_areas` não existe

O aparato genérico de áreas do ADR 0038 foi cortado de escopo na Fase 8. O
comentário no schema diz isso literalmente
(`apps/api/src/db/schema.ts:781-786`): *"Sem `agent_areas`/`agent_area_members`
(o aparato genérico do ADR 0038)"*.

O que existe é a tabela `delegations` (`apps/api/src/db/schema.ts:791-831`), com
`area` como TEXT livre — hoje só `"qa"` e `"infra"`. Área, lead e membros são
**hardcoded**: `apps/web/src/lib/agents.ts:167-180` no front, e comportamento
fixo em `apps/engine/lib/engine/gates/qa_lead_server.ex` e
`apps/engine/lib/engine/infra/infra_lead_server.ex` no engine.

Consequência prática: **não existe rota para ativar uma área num projeto**. A
área entra em cena quando o Dispatcher aciona QA ou Infra — sempre. Não é
configuração pendente; é configuração inexistente porque não é configurável.

Como `agent_areas.budget_micros` também não existe, **não há teto de orçamento
por área**. Os tetos disponíveis são: projeto e sessão (tabela `budgets`), e
task (`projects.task_budget_micros`). O CLAUDE.md descreve orçamento no nível da
área como parte da Fase 8 concluída — não está implementado.

### 1.3.2 Sobre o item 6: quais providers de LLM existem de fato

`LLM_PROVIDER_NAMES` tem três entradas —  `ollama`, `anthropic`, `openai`
(`apps/api/src/domain/llm/llm-provider-names.ts`). Os seis providers descritos na
Fase 9b (OpenRouter, NVIDIA NIM, Together, Deep Infra, Bitdeer, Vultr) **não
entraram**; o `docs/adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md:147-156`
os registra como "o que fica para depois".

Além disso, só o OpenAI declara `listModels: true` (`openai-provider.ts:22`).
Ollama (`ollama-provider.ts:34-40`) e Anthropic (`anthropic-provider.ts:48-53`)
declaram `false` e são pulados pelo sync — honestamente, com o motivo no
comentário. Ou seja: "catálogo sincronizado" só tem efeito para OpenAI; para
Anthropic os modelos vêm do seed (`apps/api/src/db/seed.ts` semeia
`claude-opus-4-8`, `claude-sonnet-5` e `claude-haiku-4-5-20251001`).

Isso não bloqueia o experimento — Anthropic e OpenAI bastam para os bindings de
API. Mas muda o que o item 6 significa: não há catálogo a sincronizar para o
provider que você provavelmente vai usar no dev.

## 1.4 O que depende de você antes de começar

- [ ] Criar o fork e anotar o `owner/repo`
- [ ] Registrar o PAT do GitHub (escopo `repo`)
- [ ] Inserir as linhas de `provisioned_repositories` e `repo_bootstraps`
- [ ] Escolher o modelo do dev e preencher a tabela de 2.2
- [ ] Definir os dois tetos do critério de encerramento (3.4)
- [ ] Registrar a entrada #1 da tabela de observação

> ⛔ **PARE AQUI.** A Parte 2 só começa com os seis itens acima fechados. Montar
> pela metade e descobrir na terceira sessão que o binding do gate estava num
> modelo local de 7B contamina tudo que veio antes.

---

# PARTE 2 — REGRAS DO EXPERIMENTO

## 2.1 Autonomia manual: não configurar, e não relaxar

**Aprovação explícita de tudo já é o comportamento padrão.** Sem nenhuma
configuração, `decide()` cai em `require_approval` com motivo `"default (sem
regra aplicável)"` (`decide.ts:125-128`), e o `permissions.json` de um projeto
novo nasce vazio (`permissions-file.ts:14-18`). Não há nada a ligar.

A regra do experimento é o oposto de configurar: **não afrouxar**.

- Nunca usar `approve_always` — ele grava padrão no `allow` e o clique deixa de
  existir a partir dali. Os cliques são o dado; gastá-los é apagar a medição.
- Nunca popular `allow` à mão no `permissions.json`.
- Nunca gravar linha em `agent_autonomy`.

Se a fadiga de aprovação ficar insuportável, **isso é o resultado**, não um
problema de setup. Anote na coluna de nota livre e continue.

Dois tetos permanecem ativos independentemente de qualquer coisa, e é bom saber
que existem para não confundi-los com bug: merge em branch protegida
(`decide.ts:149-160`) e patch de instrução (`decide.ts:166-175`) nunca são
auto-aprováveis. Há também um conjunto de padrões sempre negados
(`decide.ts:84`).

## 2.2 Bindings fixados antes de começar, e não tocados depois

Trocar modelo no meio invalida a comparação de custo e de qualidade entre
sessões. Fixe uma vez, registre aqui, e se precisar mudar — anote como
intervenção manual com motivo.

Os slugs abaixo são os reais, de `apps/web/src/lib/agents.ts:25-38`. Note que o
lead de QA é `qa` (não `qa-lead`; esse nome só existe como ator interno do
engine), e que não há slug genérico `dev-<modulo>` no roster fixo — os devs
dinâmicos por módulo são derivados do `module_map` em tempo de execução.

| agente | papel na fase | modelo | por quê |
|---|---|---|---|
| `po` | estrutura épico e stories | | |
| `arquiteto` | ADR das semânticas, valida module_map | | |
| `dev-backend` | implementa os dois providers | | |
| `qa` | lead da área, consolida o veredito | | |
| `qa-automacao` | suite + coverage matrix | | |
| `qa-performance-seguranca` | RNFs e apoio ao checklist | | |
| `secops` | gate próprio, determinístico | — | não usa LLM |
| `infra` | lead da área de infra | | |
| `infra-workflows` | pipeline de CI | | |
| `psicologo` | hipóteses sobre a sessão | | |
| `psicologo-leve` | passo barato | | |
| `anamnese` | perfil e patches de instrução | | |
| `criativo` | **dispensado** — escopo conhecido | — | |

> **TODO(humano):** qual modelo em cada linha? Duas restrições que a fase impõe:
> o dev precisa de modelo forte de API (o trabalho é implementar contra contrato,
> não completar boilerplate), e **nenhum gate pode ficar num 7B local no passo
> semântico** — foi exatamente essa combinação que o
> `docs/adr/0020-destravar-gates-qa-secops.md` levou nove execuções para
> diagnosticar.

Todo modelo vinculado a agente precisa de `supports_tool_calling`; o domínio
recusa o binding com 422 se não tiver (RN-040). Modelo descoberto por sync entra
inativo e precisa de curadoria antes de aparecer para binding.

## 2.3 Instruções: o único caminho é a Anamnese

Reafirmando o princípio 2 com o mecanismo: patch de instrução nasce como
`proposed_action` e **nunca** é auto-aprovável (`decide.ts:166-175`). Você vê o
diff e decide.

A regra do experimento: **negue ao menos um patch de propósito**. É o que
exercita a RN-026 — patch negado não é reproposto, e a comparação é sobre o
conteúdo normalizado, então reindentar o mesmo patch não o transforma em
proposta nova. Se a Anamnese repropuser um patch que você negou, isso é um
achado grande, e é o tipo de coisa que só aparece em execução real.

---

# PARTE 3 — OBSERVAÇÃO

## 3.1 A tabela

Uma linha por sessão. Preencher **durante**, não depois — a coluna de
intervenções é a que evapora.

| # | sessão | task | cliques de aprovação | intervenções manuais + motivo | custo | veredito dos gates | nota livre |
|---|---|---|---|---|---|---|---|
| 1 | — (pré-experimento) | — | 0 | Seed manual de `provisioned_repositories`/`repo_bootstraps` apontando para o fork. Motivo: o produto não sabe adotar repositório existente (`provision-repository.use-case.ts:144`) | 0 | — | Primeiro achado da fase, antes da primeira sessão. Vira P1 na colheita |
| 2 | | | | | | | |

Convenções de preenchimento:

- **cliques de aprovação** — conta bruta de decisões suas na tela de Aprovações
  naquela sessão, aprovadas e negadas somadas. É proxy de fadiga, então a conta
  bruta importa mais que a proporção.
- **intervenções manuais** — qualquer coisa que você fez que o agente deveria ter
  feito, ou que o produto deveria ter permitido. Sempre com motivo. Se o motivo
  for "travou", registre a **origem** (`infra` | `modelo` | `código` |
  `política`) — nunca por eliminação.
- **custo** — em USD, do `TokenMeter` da sessão. A conferência contra o event log
  fica para a colheita.
- **veredito dos gates** — `approved` ou `changes_requested` por gate, e se houve
  ciclo de correção, quantos.

## 3.2 Onde cada coluna se valida no event log

A tabela é anotação humana; o event log é a prova. Na colheita (Parte 4), cada
coluna é conferida contra estes tipos — todos existentes, conferidos em
`docs/reference/events.md`:

| coluna | onde confere |
|---|---|
| cliques de aprovação | `proposed_action.created` → `proposed_action.approved` / `proposed_action.denied` |
| custo | tabela `token_usage` — cada linha grava o preço que produziu o custo, então o número de ontem continua reproduzível (RN-044); mais `budget.threshold_crossed` para os limiares |
| veredito dos gates | `pr.gate_changed` e `infra.gate_changed`; o conteúdo do parecer nos artefatos `qa_verdict` / `secops_verdict` |
| qualidade do parecer consolidado | `delegation.completed` / `delegation.failed` / `delegation.dispensed` — um por subespecialidade, com `parecerArtifactId` do parecer INTERNO; a dispensa carrega `justification` |
| intervenções manuais | `chat.message` com ator `user` durante a fase de execução, cruzado com o que você anotou à mão |
| origem de falha | `payload.failureOrigin` em `delegation.failed`, e a classificação determinística de término (RN-023) |
| loop do Psicólogo | `psychologist.hypothesis_proposed` / `_accepted` / `_dismissed` / `_accepted_for_anamnese`, e `anamnese.run_completed` |
| travamento de task | `backlog.task_blocked` — teto de correções esgotado ou impedimento |

Se uma coluna não fechar com o log, ela entra na colheita como **não medida**.
Não estime.

## 3.3 O loop Psicólogo → Anamnese

O loop só é exercitado se as hipóteses forem decididas nos dois sentidos. Um
experimento que aceita tudo não testa nada.

**Regra de leitura:** hipóteses são lidas **em lote, só na colheita**. Ler no
meio muda o seu comportamento como observador e contamina as sessões seguintes.
A exceção é a decisão em si — que precisa acontecer para o loop rodar.

O que decidir de propósito, e o que cada decisão exercita:

| decisão | exercita |
|---|---|
| Aceitar ao menos uma hipótese e encaminhar para a Anamnese | o elo `psychologist.hypothesis_accepted_for_anamnese` — o único caminho que fecha o loop |
| Descartar ao menos uma | RN-022: o ciclo é compare-and-swap, `proposed → accepted \| dismissed` |
| Negar ao menos um patch de instrução resultante | RN-026: patch negado não é reproposto (comparação sobre conteúdo normalizado) |
| Se algum patch for aprovado e piorar o agente, reverter | RN-027: rollback é operação **para frente** — cria versão nova, não apaga histórico |

Vale observar sem intervir: hipótese sem evidência válida não chega a ser gravada
(RN-021, validação atômica por lote). Se o Psicólogo propuser pouca coisa, pode
ser que esteja sendo reprovado nessa porta — o que é informação, não defeito.

## 3.4 Critério de encerramento

A fase termina quando **qualquer um** destes for verdade:

1. **Sucesso** — `BitbucketProvider` e `GenericGitProvider` passam na suite de
   contrato única, e as PRs correspondentes foram mergeadas por você pela esteira
   normal.
2. **Teto de custo** — o gasto acumulado do experimento atinge o valor abaixo.
3. **Teto de tempo** — o experimento atinge o número de dias abaixo.

Os dois tetos existem para o experimento não virar projeto. Atingir um deles
**não é fracasso**: é resultado, e a colheita é escrita do mesmo jeito, com o que
foi obtido até ali.

> **TODO(humano):** qual o teto de custo total do experimento, em USD? Ele deve
> ser um número que você aceita gastar sem retorno nenhum — porque esse é o pior
> caso.

> **TODO(humano):** qual o teto de dias corridos? Contados do início da primeira
> sessão da 10b, não da montagem.

> **TODO(humano):** se a suite fechar nos dois providers antes dos tetos, o
> experimento continua para colher mais dados de convivência, ou encerra na
> hora? As duas respostas servem; a que não serve é decidir isso no calor do
> momento.

---

# PARTE 4 — COLHEITA (10c)

Só começa depois do encerramento. Nesta ordem:

1. **Conferir a tabela contra o event log**, coluna por coluna, pelo mapa de 3.2.
   O que não fechar vira "não medido" — explicitamente, no texto.

2. **Escrever `docs/explanation/primeiro-dogfooding.md`.** Este **é** página do
   site: precisa de frontmatter (`id`, `title`, `sidebar_label`,
   `sidebar_position`, `description`, `keywords`, no padrão de
   `docs/explanation/documentation-workflow.md`) e de entrada em
   `website/sidebars.ts`. Conteúdo: as métricas validadas, o custo real por
   provider, as intervenções, e o diff entre promessa e realidade em prosa
   honesta. Sem número inventado.

3. **Revisar as hipóteses do Psicólogo em lote**, uma a uma, e avaliar os patches
   da Anamnese decorrentes. Aqui é onde se responde se o loop produziu algo útil
   ou só ruído caro.

4. **ADR "primeiro dogfooding"** com o próximo número livre. Aprendizados e
   achados convertidos em **backlog priorizado P1/P2/P3** — nunca fixes
   embutidos. O ADR registra o que foi decidido sobre o que fazer, não faz.

5. **Atualizar o que a fase tornou falso.** Em particular
   `docs/reference/git-providers.md`, que hoje afirma que Bitbucket e Generic
   estão fora de escopo (ver achado #6 abaixo).

---

# Achados já conhecidos, antes da primeira sessão

Estes saíram da preparação (10a) e entram na colheita já com prioridade sugerida.
Nenhum foi corrigido — corrigir durante a fase violaria o princípio 3.

| # | achado | onde | prio |
|---|---|---|---|
| 1 | O produto não sabe apontar um projeto para repositório existente. `createRepo` é incondicional; `getRepo` existe e não é chamado por nenhum caso de uso; o DTO não tem campo para `externalId` | `provision-repository.use-case.ts:144`, `github-provider.ts:82` | **P1** |
| 2 | `protectBranch` no GitHub aplica `enforce_admins: true` + 1 revisor sobre proteção existente, sem ler o estado atual — pode travar o merge manual do dono | `github-provider.ts:170-175`, ADR 0028:83-84 | **P1** |
| 3 | O bootstrap cria e protege uma branch `rc` que a política de branches do Brabo (Fase 6) não usa | `bootstrap-steps.ts:94,195` | P2 |
| 4 | `agent_areas`/`agent_area_members` não existem; áreas, leads e membros são hardcoded em dois lugares que podem divergir (front e engine). Sem orçamento por área | `apps/api/src/db/schema.ts:781-786`, `apps/web/src/lib/agents.ts:167-180` | P2 |
| 5 | Os seis providers de LLM da Fase 9b não entraram, e o CLAUDE.md descreve a Fase 9 como se tivessem entrado | ADR 0042:147-156 | P2 |
| 6 | `docs/reference/git-providers.md:170-174` afirma que Bitbucket e Generic são "fora de escopo — decisão, não backlog esquecido"; o CLAUDE.md marca os dois como fase ativa. É a doc que o PO lê como verdade | `docs/reference/git-providers.md:170-174` | P2 |
| 7 | O comentário de `git-errors.ts` diz "8 operações"; o contrato tem 10 | `apps/api/src/domain/git/git-errors.ts:3` | P3 |
| 8 | O cabeçalho da suite de contrato diz que só o Local a exercita; GitHub e GitLab já a rodam desde a Fase 2 | `apps/api/test/contract/git-provider.contract.ts:12-18` | P3 |

O achado #6 tem um valor extra: corrigi-lo é a primeira mudança de doc que os
agentes vão fazer nesta fase, o que torna a correção um teste do próprio drift
check.

---

# Insumos do PO

O PO não parte do zero na 10b. Os três arquivos em `docs/missions/inputs/` são o
material de entrada:

| arquivo | o que é |
|---|---|
| `inputs/01-contrato-gitprovider.md` | o que já existe: as 10 operações, as capabilities, os erros normalizados, a suite única |
| `inputs/02-bitbucket-cloud-a-investigar.md` | **perguntas**, não respostas — o que verificar na doc oficial do Bitbucket Cloud antes de codar |
| `inputs/03-escopo-do-generic.md` | o que "capabilities mínimas" significa, e como degradar honestamente |

O Criativo é dispensado nesta fase: o escopo é conhecido e está escrito.
