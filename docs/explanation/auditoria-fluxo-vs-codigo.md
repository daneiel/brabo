---
sidebar_position: 13
---

# Auditoria: fluxo.yml × código (v3, ADR 0085)

Sessão de auditoria isolada — **só leitura**. Cruza `docs/fluxo.yml` (o
modelo-alvo declarado pelo ADR 0085) com o código real, para responder duas
perguntas: o que falta para o código honrar tudo que o fluxo declara como
`active`, e o que está genuinamente escadeado atrás de cada gatilho da
[tabela de ativação](modelo-de-time.md#tabela-de-gatilhos-de-ativação) do
`modelo-de-time.md`. Nenhuma linha de código de produção foi alterada nesta
sessão; nenhum dos três documentos-modelo (`fluxo.yml`, `gates.yml`,
`agent-areas.ts`) foi editado — cada divergência encontrada entre eles é
tratada como **achado**, não como licença para corrigir de passagem.

> Doutrina do ADR 0085: papel `proposto` declara quem o absorve hoje e o
> critério objetivo de separação — o organograma-alvo é sequência de
> ativação, nunca aspiração. Esta auditoria não antecipa nenhum papel
> `proposto`/`planned`; onde encontrou algo além do que deveria existir,
> está marcado explicitamente como achado.

## Como ler este documento

- **Seção A — Divergências.** O fluxo declara X, o código (ou o `gates.yml`
  irmão) faz Y. É conflito entre fontes e exige decisão do dono do produto —
  nenhuma foi corrigida aqui.
- **Seção B — Lacunas de papéis ativos.** Trabalho declarado (nunca
  "proposto") sobre papéis que já operam hoje — implementável já, sem
  esperar gatilho nenhum.
- **Seção C — Escadeado por gatilho.** O que cada gatilho da tabela de
  ativação destravaria, com estimativa de escopo, e se ele já disparou.
- **Seção D — Plano de ondas.** Proposta de sequenciamento, ordenada do
  gate mais barato de verificar por script para o mais caro (o que exige
  ADR e decisão de produto).

---

## A. Divergências

| # | Severidade | Item | Evidência |
|---|---|---|---|
| A1 | **Crítica** | `gate_saida: paralelismo-autorizado` do `dev-lead` — `docs/fluxo.yml` (papel `dev-lead`) declara `status: ativo`; `docs/gates.yml:239-248` declara `status: planned`, com o comentário "FASE 14d — entra active quando ela fechar". A FASE 14d fechou em 2026-08-07 (mesmo dia da FASE 15, que criou o `gates.yml`) e o mecanismo está ativo, testado e em produção desde então — `gates.yml` nunca foi atualizado depois. | Mecanismo real: `apps/api/src/application/use-cases/execution/request-parallelization.use-case.ts:35-78` (acima do teto, cria `proposed_action` tipo `parallelize`); trava contra auto-aprovação em `apps/api/src/domain/actions/decide.ts:266-276` (`parallelize`/`raise_max_parallel` nunca saem de `require_approval`); testes: `apps/api/test/application/use-cases/execution/request-parallelization.use-case.spec.ts:97`, `apps/api/test/domain/actions/decide.spec.ts:273-303`. O próprio `docs/fluxo.yml` já registra esse gate como `ativo` — a divergência é `gates.yml` × (fluxo.yml + código), não fluxo.yml × código. |
| A2 | Alta | Saída `plano-de-paralelismo` do `dev-lead`, declarada `via: proposed_action` (RN-083/154). O que o código produz é o evento simples `execution.plan_proposed` (`apps/engine/lib/engine/agents/dev_lead_tools.ex:14-18,60-77`), **sem** pipeline de aprovação — decisão deliberada, documentada no próprio comentário do código ("transformar a proposta em ação a decidir faria o usuário decidir duas vezes"). O `proposed_action` tipo `parallelize` que de fato existe (mesma peça do A1) é disparado por **ação do usuário na UI** pedindo reforço acima do teto (`apps/web/src/routes/ProjectOverviewTab.tsx:361` → `POST /sessions/:sessionId/execution/parallelize`), não pela saída inicial do plano do dev-lead. `fluxo.yml` funde dois mecanismos distintos numa única saída. | `apps/engine/lib/engine/agents/dev_lead_tools.ex:14-18,60-77`; `apps/web/src/routes/ProjectOverviewTab.tsx:361`; `apps/engine/lib/engine_web/router.ex:57`. |
| A3 | Média | Máquina de estados do `dev` — `fluxo.yml:134` declara 4 estados (`working\|awaiting_gate\|idle\|idle_tripped`); o código real tem **5**: acrescenta `:awaiting_approval` (Fase 12e, ADR 0052), estado persistido com transições próprias, não transitório. | `apps/engine/lib/engine/dev/dev_agent_server.ex:17-18,300-333,622-654`. |
| A4 | Baixa | Citação de RN-160 anexada à entrada `backlog-promovido` (origem `po`) do Arquiteto. A RN-160 real trata do gate "Confirmar arquitetura pronta" do lado de **saída** (Arquiteto → Dev Lead), não da entrada PO → Arquiteto. | `docs/business-rules.md:5606-5622` vs. `docs/fluxo.yml` (papel `arquiteto`, entradas). |
| A5 | Baixa | Citação de RN-161 anexada à saída `handoff-duplo` do Arquiteto. A RN-161 real (ADR 0069) trata do passo **seguinte** — aceitar o handoff pro Dev Lead encadeia a ativação de execução —, não do duplo handoff em si. | `docs/business-rules.md:5624-5644` vs. `docs/fluxo.yml` (papel `arquiteto`, saídas). |
| A6 | Baixa | O gate "Confirmar arquitetura pronta" (RN-160, ≥1 história promovida) só é garantido no **cliente** (`SessionPage.tsx`, `hasPromotedStory`); o backend (`OfferInfraHandoffUseCase`) não revalida. Uma chamada direta à rota interna, sem passar pela UI, ignoraria a regra. Não é uma divergência declarada em `fluxo.yml` — é achado adicional da auditoria. | `apps/api/src/application/use-cases/agents/offer-infra-handoff.use-case.ts:19-38`. |
| A7 | Informativa | O artefato de saída do Criativo é `artifact.product_brief` no código, não literalmente `necessidade-de-negocio` — é o mesmo conceito com nome de evento diferente; imprecisão terminológica, não estrutural. | `apps/engine/lib/engine/agents/criativo_server.ex:396-420`. |
| A8 | Baixa | Entrada `worktree-por-agente` do `dev` rotulada "origem: harness"; `WorktreeManager` vive em `Engine.Dev`, não é um dos 4 componentes listados para o papel `harness` (`PromptAssembler`, `ToolLoop`, `ContextManager`, `Hooks`, `fluxo.yml:244`). | `apps/engine/lib/engine/dev/worktree_manager.ex:19-49` vs. `docs/fluxo.yml` (papel `harness`, componentes). |
| A9 | Nuance (não-divergência) | Saída `pr-remota` do `dev` declara destino simultâneo `[area-qa, secops]`; o mecanismo real é sequencial e ordenado por máquina de estados — QA sempre antes de SecOps, nunca em paralelo. Não chega a contradizer o fluxo.yml (os dois são de fato destinos finais), mas pode induzir leitura de fan-out simultâneo. | `apps/api/src/domain/execution/pr-gate-state-machine.ts:21-30`. |

**Achado do sub-agente descartado por verificação.** Uma exploração inicial
apontou o rótulo `achado_aberto: AE` (`fluxo.yml:158`, papel `area-qa`) como
"referência órfã". Verificação: **é referência real e documentada** —
`docs/explanation/achados-execucao-real.md:618` (`### AE. O agente de QA
tenta consertar o código que julga (P2)`) e `docs/explanation/backlog.md:40`.
Sem divergência aqui; registrado para não repetir a busca.

---

## B. Lacunas de papéis ativos (trabalho implementável já)

Todos os itens abaixo estão sobre papéis com `status: active` — nenhum
depende de um papel `proposto`/`planned` existir primeiro.

| # | Lacuna | Onde no modelo | O que falta, concretamente |
|---|---|---|---|
| B1 | **Delegação Dev Lead → dev** (ADR 0053 item 5) | `fluxo.yml`, saída `delegacao` do `dev-lead`, `status: lacuna` | Confirmado ausente: `dev_lead_server.ex` só registra `DevLeadTools.spec()` (`apps/engine/lib/engine/agents/dev_lead_server.ex:75`); a tabela `delegations` já aceita `area: text` genérico (`apps/api/src/db/schema.ts:1051-1091`), mas os únicos chamadores de `RecordDelegationUseCase` são `qa_lead_server.ex` e `infra_lead_server.ex` — nenhum com `area = 'dev'`. O padrão a copiar já existe duas vezes (QA e Infra); falta reproduzi-lo no Dev Lead. |
| B2 | **Gate `necessidade-validada`** (Criativo → PO) | `modelo-de-time.md`, "Estado da malha" — "gate novo = ADR" | Não existe em `gates.yml`, nem em código. `modelo-de-time.md` já lista uma proposta em aberto ("Anti-padrão do Criativo como validação real do gate") — falta a decisão do critério objetivo, o ADR e o registro em `gates.yml` (pode nascer `warn`, como `implementavel`/`operavel`). |
| B3 | **Gate `implementavel`** (gate_futuro do dev-lead) | `docs/gates.yml:250-259`, `status: planned`, dono `dev-lead` | O dev-lead já é papel ativo; o gate não depende de `qa-estrategia`/`appsec` existirem — é o contrário: é a CRIAÇÃO deste gate que os ativa (ver C1). Falta o critério de "implementável" (ex.: história com critério de aceite mínimo, sem dependência bloqueante) e o registro em `gates.yml`. |
| B4 | **Métricas de produto → PO** | `fluxo.yml`, entrada `metricas-de-produto` do `po`, `status: lacuna`; saída_alvo do `analytics` (proposto) | `po_server.ex` não tem nenhuma ferramenta de métricas de produto (`apps/engine/lib/engine/agents/po_server.ex:86-99`). `modelo-de-time.md:21-25` já registra o princípio: "analytics nasce como saída nova do `medicao` antes de ser papel" — ou seja, isto NÃO precisa esperar o papel `analytics` separar; é uma extensão do `medicao` (já ativo, com `sumGroupedBy` em produção) que, ao existir, é o próprio ato de cruzar o gatilho "métricas de produto viram entrada do PO" (ver C2). |
| B5 | **`docs/gates.yml` desatualizado** (mesmo achado A1) | — | Corrigir `status: planned` → `active` para `paralelismo-autorizado`, com evidência `event_log`/`proposed_action.created` filtrado por `actionType: parallelize`, `onde: request-parallelization.use-case.ts`. É correção de metadado, verificável instantaneamente por `pnpm --filter api validacao:gates` — o script já teria evidência real para citar. |
| B6 | **RN-160 sem revalidação no backend** (achado A6) | — | Hardening opcional: `OfferInfraHandoffUseCase` passa a exigir ≥1 história promovida antes de emitir o handoff duplo, hoje só a UI barra o botão. |
| B7 | **Relatório DORA via `medicao`** | `fluxo.yml`, papel `delivery-metricas` (proposto, `status: — (nunca)` na tabela de gatilhos — "vira RELATÓRIO do medicao, nunca agente") | Como o papel nunca vira agente, este item não está atrás de gatilho nenhum — é trabalho disponível hoje sobre o `medicao` já ativo: lead time, deployment frequency, MTTR e change failure rate extraídos do event log + `gates.yml`, no mesmo padrão de `medir:execucao`/`sumGroupedBy`. |

---

## C. Escadeado por gatilho

Tabela de ativação (`modelo-de-time.md:52-62`), cada linha com o estado real
verificado nesta auditoria.

| Gatilho | Papéis que ativa | Disparou? | Escopo estimado, se cruzado |
|---|---|---|---|
| Gate `implementavel` criado | `qa-estrategia` + `appsec` — "segundo momento" dos agentes **existentes** (`qa-lead`/`secops` ganham modo "design", sem agente novo) | **Não.** `implementavel` segue `planned`, sem nenhuma rota/caso de uso consumindo-o (busca exaustiva: zero ocorrências fora de `gates.yml`) | **M.** Depende de B3 fechar primeiro. Depois: `dev-lead` invoca `qa-lead`/`secops` num modo "design" (plano-de-teste, threat-model) antes de propor paralelismo — reusa os agentes, sem tabela nova nem worker novo. |
| Métricas de produto viram entrada obrigatória do PO | `analytics` separa do `medicao` | **Não** — mas o trabalho de cruzá-lo é B4, já ao alcance hoje | **P/M** para produzir a métrica (B4); a separação do papel `analytics` em si fica atrás de outro critério subjetivo ("quando virar entrada obrigatória", ainda proposta em aberto no `modelo-de-time.md`) — decisão de produto, não escopo técnico adicional. |
| `DEPLOY_ENABLED` flipa | `platform` ativa → depois `secops-runtime` | **Não.** Nenhuma leitura real de `DEPLOY_ENABLED` em código de aplicação — só menções em comentários/docs; `tag-release.yml` documenta explicitamente que não há job de deploy escondido | **G.** Programa próprio: ambiente de deploy real, GitHub Environments, pipeline verde consumido por `platform`, SLO/dashboard/runbook — e só depois `secops-runtime` (detecção com tráfego real). Maior item do backlog do fluxo. |
| Anamnese sai do refinamento | Gatilho do `staff` volta a ter dono | **Não — e foi na direção contrária.** `ANAMNESE_ENABLED=false` desde 2026-08-10, decisão explícita do usuário ("hoje ele não está trazendo dados de muito valor", RN-115, `docs/business-rules.md:4597-4655`) | A pendência "autor-da-proposta-de-teto (RN-086)" citada em `fluxo.yml:263` está **implementada e testada em código** (`ProposeMaxParallelUseCase`, ator hardcoded `anamnese`; `apps/engine/lib/engine/workers/anamnese_worker.ex:270-286`; testes em `anamnese_worker_test.exs:387-411`) — só **dormente por flag**. Não é lacuna de engenharia; é decisão de produto pausada, aguardando o "refinamento futuro do que a Anamnese deriva" (`docs/explanation/backlog.md:349`). |
| Projeto gerenciado com UI própria | `ux-designer` separa do Criativo | **Não.** Busca por artefato de protótipo/design entregue a projeto-cliente (fora de `design_handoff_brabo/`, que é do próprio Brabo): zero ocorrências | **G.** Depende da aba Code ganhar capacidade de EDIÇÃO/design de UI — hoje é declaradamente só-leitura (FASE 26). |
| Volume real de dados | `dbre` separa de Dev Lead/Platform | **Não.** Nenhuma métrica de carga/volume de produção real referenciada em código | **G.** Depende de operação em produção real com escala, fora do controle do time hoje. |
| — (nunca) | `delivery-metricas` vira relatório, não agente | N/A por desenho | Ver B7 — o relatório em si não espera gatilho. |

---

## D. Plano de ondas proposto

Ordenado do gate mais barato de verificar por script (metadado puro, sem
lógica nova) para o mais caro (exige ADR e decisão de produto). Cada onda é
uma sessão futura com um entregável único — **nenhuma foi iniciada nesta
sessão**.

| Onda | Entregável único | Itens | Custo | Verificação |
|---|---|---|---|---|
| **1** | `fluxo.yml`/`gates.yml` em dia | A1/B5 (status do gate `paralelismo-autorizado`), A3–A5, A8 (citações de RN e máquina de estados do `dev` corrigidas) | P | `pnpm docs:check` verde; `pnpm --filter api validacao:gates` citando evidência real para `paralelismo-autorizado` |
| **2** | Dev Lead delega ao dev; arquitetura pronta se prova no backend | B1 (ferramenta de delegação privada no dev-lead, mesmo padrão de `qa_lead_server.ex`/`infra_lead_server.ex`), B6 (RN-160 revalidada em `OfferInfraHandoffUseCase`) | M | Teste que prova `delegations` gravado com `area='dev'`; teste que a rota interna recusa handoff duplo sem história promovida |
| **3** | `medicao` fala de produto | B7 (relatório DORA), B4 (métricas-de-produto como entrada do PO — cruza o gatilho C2) | M | Script extrai as 4 métricas DORA de fixture conhecida; teste que o PO lê `metricas-de-produto` quando presente |
| **4** | O gate `implementavel` nasce | B3 (critério de "implementável" no dev-lead, registro em `gates.yml` — pode nascer `warn`) | M, com ADR | ADR aceito; `validacao:gates` cobrindo a evidência nova |
| **5** | QA e SecOps ganham o segundo momento | C1 (`qa-lead`/`secops` em modo "design": plano-de-teste, threat-model) — depende da Onda 4 fechada | M | Teste que o dev-lead recebe plano-de-teste e threat-model antes de propor paralelismo |
| **6** | Gate `necessidade-validada` | B2 (critério objetivo de validação de necessidade, ADR, registro em `gates.yml`) | M, com ADR e decisão prévia | ADR aceito; `validacao:gates` cobrindo a evidência nova |

**Fora de onda** (backlog registrado, sem estimativa de sessão — dependem de
decisão de escala/infra real ou de o dono do produto religar algo, não de
engenharia agendável): `DEPLOY_ENABLED`/`platform`/`secops-runtime` (C3, G,
programa próprio), reativação de Anamnese/gatilho do `staff` (C4, decisão do
usuário), `ux-designer` (C5, depende da aba Code ganhar edição — congelada
como só-leitura pela FASE 26), `dbre` (C6, depende de volume real de dados
em produção).

---

## Nota de infraestrutura de documentação (fora do escopo desta auditoria)

`docs/explanation/modelo-de-time.md` existe e está completo, mas **não está
listado em `website/sidebars.ts`** — só é alcançável por link direto, não
pelo menu do site. Não é um achado de `fluxo.yml` × código; é uma lacuna de
publicação pré-existente, sinalizada aqui para não se perder, sem correção
nesta sessão (fora do escopo declarado: "nenhuma mudança de código").

---

## Resumo

- **9 divergências** (A1–A9): 1 crítica (gate mal marcado `planned` num
  documento que já opera `active`), 1 alta (mecanismo de aprovação do plano
  de paralelismo não bate com o declarado), 2 médias, 4 baixas, 1
  informativa, 1 nuance sem contradição real.
- **7 lacunas de papéis ativos** (B1–B7), todas implementáveis sem esperar
  gatilho.
- **7 gatilhos da tabela de ativação**, nenhum disparado — um deles
  (Anamnese) andou na direção contrária desde a última leitura do fluxo.yml.
- **Zero achados de código antecipando papel `proposto`/`planned`** — as
  lacunas declaradas estão genuinamente vazias em todos os papéis
  auditados.
