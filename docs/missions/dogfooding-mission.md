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
da Parte 4 existe para isso.

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
   na colheita (Parte 5), nunca fix embutido. Corrigir enquanto mede destrói a
   medição.

4. **A esteira do repositório vale integralmente para PR de agente.**
   `pr-police`, `approval-ladder`, gates de QA e SecOps. Sem exceção, sem
   bypass, sem "é só um teste".

5. **Merge em branch protegida é sempre seu, manual.** Isso não é regra do
   experimento — é garantia do produto (`decide.ts:149-160`: merge com destino
   protegido nunca é auto-aprovável, nem por `agent_autonomy`, nem por
   `permissions.json`). Está aqui só para deixar claro que não há o que afrouxar.

6. **Não invente número na colheita.** Toda métrica da Parte 5 tem que fechar
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
- [ ] Definir os dois tetos do critério de encerramento (4.4)
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

# PARTE 3 — CONDUÇÃO (10b)

A ordem das sessões dentro do produto. Cada seção diz o que o produto **de fato**
faz — em vários pontos isso diverge do que o `CLAUDE.md` descrevia, e a
divergência está registrada na tabela de achados no fim deste documento.

## 3.0 Antes da sessão 0 — smoke da stack

Não gaste sessão real num ambiente que não fecha o ciclo. Rode primeiro:

```bash
pnpm --filter api demo:pr-gates-area-qa
```

Ele exercita a área de QA inteira (delegação às duas subespecialidades,
consolidação num veredito só) contra o servidor falso. Se ele não fecha, nenhuma
sessão vai fechar.

Dois guards do engine importam aqui:

- **`START_OUTBOX_DRAIN=true` é obrigatório.** É o drain que entrega
  `session.closed` ao `PsychologistWorker`
  (`apps/engine/lib/engine/outbox/drain.ex:58-61`). Sem ele o Psicólogo nunca
  roda e o passo 3.6 não acontece. O compose de dev já traz `true`.
- **`START_ANAMNESE`** vale desligar durante a execução e ligar entre as
  tandas. O `docs/runbook.md#ambiente-de-inferencia` registra que Psicólogo e
  Anamnese consomem turnos de LLM em paralelo com os agentes de execução e
  chegam a derrubar a conexão no meio do ciclo. Atenção ao aviso de lá: **o
  guard não purga a fila** — jobs antigos rodam no boot seguinte de qualquer
  jeito.

Confira também o resto daquela seção do runbook (`OLLAMA_CONTEXT_LENGTH`,
modelos residentes, GPU). São as cinco causas que o ADR 0020 levou nove
execuções para isolar.

## 3.1 Sessão 0 — Criativo

**Esta sessão não estava no plano original, e é obrigatória.** O motivo está no
achado #9: sem o Criativo, nenhuma story chega a `ready` e nenhum dev pega task.
O Criativo é o único agente com `emit_artifact`, e regra de negócio é
pré-requisito de prontidão.

1. Abra uma sessão nova. O Criativo é quem conduz.
2. Cole o texto de `docs/missions/inputs/00-handoff-criativo.md`.
3. Converse até ele ter emitido **uma `business_rule` por semântica a cobrir**.
4. **Critério de saída, não negociável:** confira que as regras existem antes de
   seguir. Elas aparecem no fio da sessão como artefatos emitidos. Se você
   avançar sem elas, a sessão 1 nasce morta e você só descobre nas sessões 3+,
   quando nenhum dev conseguir pegar task.
5. Clique **"Estou pronto para produzir"**. O Criativo oferece o handoff ao PO.
6. Aceite o handoff (**"Aceitar handoff e iniciar po"**).

Não peça a ele para decidir semântica do Bitbucket — isso é do Arquiteto, contra
a doc oficial, na sessão 2.

## 3.2 Sessão 1 — PO

O PO **não espera instrução**: na ativação ele faz um `:kickoff` automático e
gera o backlog inteiro de uma vez, a partir do brief e das regras que o Criativo
deixou no event log (`apps/engine/lib/engine/agents/po_server.ex:68-80`).

O que o produto faz, e que difere do plano original:

- **Não existe "promover a ready".** A promoção é automática na criação, se a
  story já nascer com DoD, DoR, ≥1 RF e ≥1 regra vinculada
  (`create-story.use-case.ts:75-78`). O que você controla é a qualidade da
  entrada, não um portão no meio.
- **Não existe devolução ao PO.** Não há botão, estado nem evento. Rejeição é
  conversa no fio — então **só existe na tabela se você anotar**. Anote: é dado
  do experimento, e é o único registro que vai sobrar.
- A aba **Backlog** é somente leitura. Serve para revisar depois do fato.

Duas instruções deliberadas ao refinar com ele:

- **Muitos módulos, poucas tasks cada.** Pelo achado #10, cada dev agent processa **uma**
  task por ativação. O paralelismo real vem de módulos distintos, não de fila de
  tasks. Um backlog com 3 módulos × 2 tasks anda muito melhor que 1 módulo × 6.
- **Ao menos uma story com RNF de performance**, escrito com uma das
  palavras-chave que o QA Lead reconhece (`apps/engine/lib/engine/gates/qa_lead.ex:20-28`):
  `performance`, `desempenho`, `latência`, `throughput`, `vazão`,
  `tempo de resposta`, `escalabilidade`. A checagem é substring, não semântica —
  "precisa ser rápido" **não** casa. Sem isso, o QA Lead dispensa a
  subespecialidade de Performance/Segurança em toda task e o experimento nunca
  exercita a segunda delegação.

## 3.3 Sessão 2 — Arquiteto

O Arquiteto valida as stories contra o `module_map` e produz o ADR das
semânticas via PR real, com gates. É a sua primeira leitura de parecer de agente
na fase.

Três coisas que só aparecem aqui e travam a execução se passarem batido:

- **`assign_story_modules` é o que põe `module_ids` na story.** O SQL do claim
  casa `s.module_ids ? module`
  (`apps/api/src/infrastructure/persistence/drizzle/backlog.repository.ts:189`).
  Story sem módulo atribuído é invisível para todo dev, mesmo `ready`.
- **Publicar um `module_map` novo rebaixa story `ready` órfã para `draft`**
  (`create-module-map.use-case.ts:63-82`), com ator
  `system/module-map-revalidation`. Se o Arquiteto republicar o mapa depois de o
  PO ter fechado o backlog, parte dele volta para `draft` sem aviso.
- **A ativação da execução exige `module_map` vigente.** Sem ele a resposta é
  400 com a mensagem "Projeto sem module_map vigente"
  (`activate-execution.use-case.ts:88-92`) — não 409.

## 3.4 Sessões 3+ — Devs, em tandas

Aqui a realidade diverge bastante do plano original, por causa do achado #10: **um
dev agent processa exatamente uma task e para.** Não há reagendamento após o
gate; nenhum worker redispara. Reativar a execução também não resolve — o
supervisor devolve o agente existente, `:work` não é disparado, e ainda nasce uma
sessão a mais sem agentes vinculados (achado #11).

O ciclo de uma **tanda**:

1. Ativar a execução (`maintainer`). Isso cria a sessão, sobe um dev agent por
   módulo e dispara uma task para cada.
2. Opcionalmente aceitar a paralelização (ver abaixo) — soma `dev-<módulo>-2`,
   que faz mais uma task naquele módulo.
3. Acompanhar os gates (3.5) e mergear no GitHub — o merge é fora do
   produto, ver 3.5.
4. **Reiniciar o engine.** Os dev agents são `restart: :temporary`
   (`dev_agent_server.ex:16`): morrem e não voltam.
5. Reativar a execução. Agora o registro está vazio, os agentes sobem de novo e
   pegam a próxima task.

Anote a contagem de restarts na tabela. **É a métrica mais honesta da fase**: o
número de reinícios manuais por task entregue diz mais sobre convivência do que
qualquer outra coluna.

**Paralelização.** A sugestão é calculada **uma vez, na ativação**, para cada
módulo com ≥2 tasks pegáveis (`activate-execution.use-case.ts:159-172`) — ela vai
estar lá desde o primeiro minuto, não aparece "quando o sistema achar". Serial é
o default por você **não** clicar em "Aceitar". Aceite na segunda metade e
compare as medições, como planejado.

**Ciclo K.** `DEFAULT_MAX_GATE_CORRECTIONS = 3`
(`record-gate-verdict.use-case.ts:21`), configurável na ativação. Esgotado, a
task vira `blocked`, perde o dono e **sai do claim automático**; o destrave é
manual, por `POST .../sessions/:sessionId/tasks/:taskId/unblock`, com botão na
seção "Tasks bloqueadas" da Visão geral.

> **Nota para não confundir com a regra 2.1:** a ativação **escreve sozinha** os
> `DEV_TERMINAL_ALLOW_PATTERNS` no `permissions.json` do projeto
> (`activate-execution.use-case.ts:115-118`). Isso é mecanismo do produto — sem
> ele todo `terminal` do dev cairia em aprovação e nenhuma suite fecharia. Não é
> violação do "nunca popular `allow`", que continua valendo **para você**.

## 3.5 Gates em toda PR

Onde olhar: aba **Aprovações** do projeto, componente de linha do tempo da PR.
Cada parecer é um card expansível; dentro dele ficam os itens, a
`coverageMatrix`, os **sub-vereditos por subespecialidade** e as **dispensas**
com justificativa.

- **QA Lead** consolida. A dispensa nunca é silêncio: vira
  `delegation.dispensed` com `justification`.
- **SecOps** é determinístico, sem LLM — roda semgrep e gitleaks sobre o diff.
  Scanner ausente é pulado e registrado no resumo, nunca quebra o gate.
- A ordem é imutável: `awaiting_qa → awaiting_secops → awaiting_user`. Tentar
  pular etapa é recusado no domínio.

**O merge não é etapa do produto.** `awaiting_user` é terminal de propósito — o
engine não conhece `git_merge` nem `awaiting_user`. Você lê o parecer
consolidado, clica em "ver PR" e **mergeia no GitHub**. Isso é desenho, não
lacuna (RN-014).

## 3.6 Fim de cada sessão — ordem obrigatória

Nesta ordem, sem pular:

1. **Encerrar pelo botão "Encerrar"** no topo da sessão. Ele dispara `closing` e
   depois `closed` (`apps/web/src/routes/SessionPage.tsx:271-276`).
2. **Deixar o Psicólogo processar.** Ele roda sozinho em ~2s, pelo drain do
   outbox — não há botão a apertar. É idempotente e só reage aos dois eventos
   terminais.
3. **Preencher a linha da tabela ANTES de abrir a próxima sessão.** A coluna de
   intervenções é a que evapora.
4. **Não ler as hipóteses.** Elas são lidas em lote, só na colheita.

O protocolo anti-contaminação, concreto — porque o painel do time que você
precisa e as hipóteses que você deve evitar moram na **mesma aba** (achado #15):

- No feed de **Atividade**, fixe o filtro de tipo em "Delegações". Ele é
  exclusivo: mostra só o tipo escolhido, e some com as hipóteses.
- **Não role até a seção Insights** da Visão geral. Ela não tem colapso.
- **Não clique em chip de evidência** de hipótese: além de te fazer ler a
  hipótese, o link abre a sessão analisada já com o log de eventos expandido.
- Dentro do fio de uma sessão você está seguro: o "Log de eventos" nasce
  colapsado.

---

# PARTE 4 — OBSERVAÇÃO

## 4.1 A tabela

Uma linha por sessão. Preencher **durante**, não depois — a coluna de
intervenções é a que evapora.

| # | sessão | task | cliques de aprovação | intervenções manuais + motivo | restarts do engine | custo | veredito dos gates | nota livre |
|---|---|---|---|---|---|---|---|---|
| 1 | — (pré-experimento) | — | 0 | Seed manual de `provisioned_repositories`/`repo_bootstraps` apontando para o fork. Motivo: o produto não sabe adotar repositório existente (`provision-repository.use-case.ts:144`) | 0 | 0 | — | Primeiro achado da fase, antes da primeira sessão. Vira P1 na colheita |
| 2 | | | | | | | | |

Convenções de preenchimento:

- **cliques de aprovação** — conta bruta de decisões suas na tela de Aprovações
  naquela sessão, aprovadas e negadas somadas. É proxy de fadiga, então a conta
  bruta importa mais que a proporção. Nenhuma tela soma isso para você (achado #16): a
  conta sai do event log, na colheita.
- **intervenções manuais** — qualquer coisa que você fez que o agente deveria ter
  feito, ou que o produto deveria ter permitido. Sempre com motivo. Se o motivo
  for "travou", registre a **origem** (`infra` | `modelo` | `código` |
  `política`) — nunca por eliminação.
- **restarts do engine** — quantas vezes você precisou reiniciar o engine para a
  tanda seguinte andar (3.4). Conte separado das outras intervenções: é a
  métrica que mede o gargalo do achado #10, e a que vale mais na colheita.
- **custo** — em USD, do `TokenMeter` da sessão. A conferência contra o event log
  fica para a colheita.
- **veredito dos gates** — `approved` ou `changes_requested` por gate, e se houve
  ciclo de correção, quantos.

## 4.2 Onde cada coluna se valida no event log

A tabela é anotação humana; o event log é a prova. Na colheita (Parte 5), cada
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

## 4.3 O loop Psicólogo → Anamnese

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

## 4.4 Critério de encerramento

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

# PARTE 5 — COLHEITA (10c)

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

## Achados do levantamento da condução (Parte 3)

Estes saíram ao verificar se os passos da 10b eram executáveis. Quatro não eram.
Nenhum foi corrigido, pelo mesmo princípio 3.

| # | achado | onde | prio |
|---|---|---|---|
| 9 | **O Criativo não pode ser dispensado.** O claim exige story `ready`; `ready` exige ≥1 regra de negócio; o id da regra é validado contra um evento real; e só o Criativo tem `emit_artifact` — o PO não tem. Sem Criativo, nenhum dev pega task | `backlog.repository.ts:188`, `story-readiness.ts:46`, `create-story.use-case.ts:55-59`, `po_server.ex:18` | **P1** |
| 10 | **Um dev agent processa UMA task e para.** `:work` só é disparado na ativação e no aceite de paralelização; o `report_done` abre o gate e não se reagenda; nenhum worker do Oban redispara. Teto por módulo: 1 task, ou 2 com paralelização | `execution_command_controller.ex:35,75`, `dev_agent_server.ex:76-91,306-327` | **P1** |
| 11 | Reativar a execução não redispara `:work` (o supervisor devolve `:existing`) e ainda cria uma sessão a mais sem agentes vinculados. O 409 "execução já ativa" que o Swagger promete **não existe** no use-case | `execution.controller.ts:50-52`, `dev_agent_supervisor.ex:33-52` | P2 |
| 12 | Não existe handoff manual para um agente à sua escolha — só Criativo→PO (botão) e Arquiteto→Infra (rota sem botão na web). E a validação de alvo do ADR 0038 (`assertHandoffTargetAllowed`, `HandoffToSubagentError`) **nunca foi implementada**; o `toAgent` é string livre | `SessionPage.tsx:403-407,476-478` | P2 |
| 13 | Não existe "promover a ready": a promoção é automática na criação. `TransitionStoryUseCase` valida e emite `backlog.story_transitioned`, mas **não está ligado a rota nenhuma** — é código morto. A aba Backlog é somente leitura | `create-story.use-case.ts:75-78` | P2 |
| 14 | Não existe devolução ao PO — nenhum estado, evento ou botão. `backlog.story_demoted` é outra coisa (revalidação de `module_map`). Rejeição só existe se o humano anotar | `create-module-map.use-case.ts:63-82` | P2 |
| 15 | O painel do time e as hipóteses do Psicólogo dividem a mesma aba, que é a default do projeto — o protocolo de leitura em lote depende de disciplina de filtro, não do produto | `ProjectOverviewTab.tsx:227-263,278-285,576-714` | P2 |
| 16 | Nenhuma tela soma aprovações por sessão; a Anamnese sob demanda não tem botão (só rota) | `hooks.ts:153-160`, `anamnese.controller.ts:71-81` | P3 |

Dois deles não são defeito, e entram só como registro para a colheita não os
confundir com lacuna: o **merge fora do produto** (`awaiting_user` é terminal de
propósito, RN-014 — o engine sequer conhece `git_merge`), e a **dispensa do QA
por palavra-chave** no RNF (`qa_lead.ex:20-28`), que é heurística declarada, não
NLP.

---

# Os insumos

Ninguém parte do zero na 10b. Os quatro arquivos em `docs/missions/inputs/` são o
material de entrada:

| arquivo | para quem | o que é |
|---|---|---|
| `inputs/00-handoff-criativo.md` | você, na sessão 0 | o **texto literal** para colar no Criativo, mais os prompts de refino do PO |
| `inputs/01-contrato-gitprovider.md` | PO e Arquiteto | o que já existe: as 10 operações, as capabilities, os erros normalizados, a suite única |
| `inputs/02-bitbucket-cloud-a-investigar.md` | Arquiteto | **perguntas**, não respostas — o que verificar na doc oficial do Bitbucket Cloud antes de codar |
| `inputs/03-escopo-do-generic.md` | Arquiteto | o que "capabilities mínimas" significa, e como degradar honestamente |

O Criativo **não** é dispensado, ao contrário do que o plano original previa: ele
é o único caminho até o PO e o único agente capaz de emitir as regras de negócio
que destravam a execução (achado #9). O escopo continua conhecido — o que muda é
que ele passa pelo Criativo em vez de entrar direto no PO.
