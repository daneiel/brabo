---
id: rn-contracts
title: 'Regras de negócio — Contratos'
sidebar_label: Contratos
description: 'As RNs hospedadas na raiz contracts.'
keywords: [regras de negócio, contracts]
---

# Contratos

## Git

### RN-028 — Capability decide, não o nome do provider {#rn-028}

Operação não suportada (proteção de branch no provider local) é declarada em
`capabilities` e rejeitada com `GitNotSupportedError` — nunca falha silenciosa.

São **quatro** capabilities: `protectBranch` e `pullRequests` desde a Fase 2, e
`listTree` e `pullRequestDiff` desde a FASE 26 (aba Code, só leitura). A regra
não mudou com elas — mudou o alcance. E o critério de declarar continua sendo
prova: capability só é `true` quando a suite a exercita naquele provider; sem
prova, declara-se `false` e degrada (mesmo critério dos ADRs 0041/0042).

- **Onde:** `packages/shared/src/index.ts` (`GitProviderCapabilities`); os
  tetos das duas operações de leitura em
  `apps/api/src/domain/git/git-read-limits.ts`, fora do shared porque ele é
  100% tipo
- **Teste:** suite de contrato única, `test/contract/git-provider.contract.ts`,
  rodada contra os três providers
- **Origem:** [ADR 0001](../adr/0001-git-provider-contract-shape.md)

### RN-087 — O Dev Lead é o único endereço externo da execução {#rn-087}

Existe um agente `dev-lead`, conversacional, que recebe o handoff do Arquiteto
(desde a [RN-672](api.md#rn-672), da Infra, com o container do
projeto `running`) e propõe o **plano de execução**: quantos agentes por módulo e por quê. Ele não
escreve código — distribui trabalho e responde por ele.

**Antes dele, a frase "quem decide é o lead" da [RN-083](api.md#rn-083) não tinha
dono.** O Arquiteto terminava e a execução subia por um botão, sem ninguém no
meio para avaliar quanto trabalho havia.

**Os `dev-<modulo>` deixaram de ser endereçáveis por handoff.** Isso não é
exceção nova: é a regra do [ADR 0038](../adr/0038-hierarquia-de-agentes.md) —
handoff externo endereça só lead de área ou agente sem área — passando a valer
para o dev como já valia para QA e Infra. Enquanto não havia Dev Lead, eles
eram agentes SEM área e por isso alvos válidos; virando membros, deixam de ser.

**A área de `dev` é a primeira DINÂMICA**, e é o que forçou o predicado: os
membros são um por módulo do `module_map`, decididos pelo Arquiteto e
diferentes em cada projeto, então não há lista a enumerar. `dev-lead` casa com
o mesmo prefixo `dev-` dos membros, e quem o exclui é a regra genérica **o lead
nunca é membro da própria área** — que vale para qualquer área e vive num lugar
só. A primeira versão repetia essa exclusão em três pontos, e a verificação por
mutação mostrou que nenhuma das cópias era alcançável por teste: cada uma
sobrevivia à mutação da outra.

**O plano é `proposed_action` (revisado pelo [ADR 0086](../adr/0086-dev-lead-plano-suspende-para-aprovacao.md), [RN-284](engine.md#rn-284)).**
Até essa mudança o plano virava EVENTO simples, sem aprovação: o argumento era
que propor não tem efeito externo — o gasto acontece quando os agentes sobem,
e é lá que o teto cobra autorização; transformar a proposta em ação a decidir
faria você decidir duas vezes a mesma coisa. Uma auditoria de
`packages/contracts/fluxo.yml` × código encontrou que o fluxo já declarava esta saída como
`via: proposed_action` desde o ADR 0085, e o código nunca foi ajustado para
bater — o dono do produto decidiu que o código errava: o plano é a PRIMEIRA
decisão real de quanto a sessão vai gastar com paralelismo, e o usuário passou
a decidir ativar a execução tendo VISTO uma aprovação de verdade, não só lido
uma linha no fio. A lição antiga não desapareceu — é o motivo pelo qual
`propose_execution_plan` NÃO entrou no bloco de tetos absolutos de
`decide.ts` (ver RN-284).

**O plano BEM-SUCEDIDO encerra o turno — no caminho SEM suspensão.** Na
primeira execução real o Dev Lead registrou **dois** `execution.plan_proposed`
na mesma sessão — textos diferentes, mesmo total —, porque o laço voltava ao
modelo e ele propunha de novo. O event log é imutável: ficaram duas propostas
e nada dizendo qual valia. A instrução "use uma vez" no spec da ferramenta é
pedido, não garantia; quem garante é o laço parar. Desde o ADR 0086, quando a
proposta fica `pending`, quem encerra o turno é a PARADA por suspensão
(RN-284) — o sucesso imediato (`auto_approved`/`executed`/`approved`, ver
RN-284) continua fechando o laço do mesmo jeito de sempre.

**Bem-sucedido, e não "chamou a ferramenta"**: um plano recusado (vazio, ou com
zero agente num módulo) deixa o laço seguir, senão a recusa vira fim de turno e
o modelo nunca chega a corrigir. A primeira versão desta guarda olhava só o
nome da ferramenta e tinha esse defeito — encontrado pelo teste comportamental,
não pela leitura.

Um plano vazio, ou com zero agente num módulo, é recusado **antes de propor
qualquer coisa** — a proposta, uma vez criada, é decisão real do usuário, e um
plano meio proposto não teria como ser retratado.

- **Onde:** `apps/engine/lib/engine/agents/dev_lead_server.ex` e
  `dev_lead_tools.ex`; a regra de endereçamento em
  `apps/api/src/domain/agents/agent-areas.ts`; o handoff em
  `application/use-cases/agents/offer-infra-handoff.use-case.ts`
- **Teste:** `apps/engine/test/engine/agents/dev_lead_tools_test.exs`,
  `dev_lead_server_test.exs` (`o plano ENCERRA o turno`, `o plano recusado NÃO
  encerra o turno`),
  `apps/api/test/domain/agents/agent-areas.spec.ts` (`o dev de módulo DEIXOU de
  ser endereçável`, `` `dev-lead` É endereçável, apesar do prefixo ``) e
  `test/application/use-cases/agents/offer-infra-handoff.use-case.spec.ts`
- **Origem:** [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md), FASE 14d;
  o mecanismo de aprovação revisado pelo [ADR 0086](../adr/0086-dev-lead-plano-suspende-para-aprovacao.md)

### RN-110 — `blame` é a 13ª operação do `GitProviderContract`, com o mesmo vocabulário de ausência das outras leituras {#rn-110}

Fundação da pendência de blame declarada na FASE 26 (nenhuma tela consome
ainda — vem na onda seguinte). `blame(ref, path)` devolve `GitBlame | null`,
`null` significando exatamente o que já significa em `getFileContent`/
`listTree`: arquivo ausente naquela ref, ou ref inexistente. Dois vocabulários
de "não existe" para a mesma aba fariam a tela tratar o mesmo caso de duas
formas — a mesma razão que já valia para as duas operações anteriores.

Cada provider computa por meios PRÓPRIOS, porque não há endpoint comum: o
GitHub não tem blame na REST (só GraphQL — a única operação do provider que
fala GraphQL), o GitLab tem `repository/files/:path/blame`, e o local sai de
`git blame --porcelain`, o único dos três testado contra um repositório de
verdade nesta sessão (os outros dois só contra os backends fake do teste de
contrato — sem `GITHUB_TEST_TOKEN`/`GITLAB_TEST_TOKEN` no ambiente, quem prova
contra a API real é o smoke manual). `GIT_BLAME_LINE_LIMIT` (2000) corta
arquivo genuinamente enorme — já cortado por bytes na rota de conteúdo, mas
`blame` lê o arquivo inteiro do provider antes de decidir.

- **Onde:** `packages/shared/src/index.ts` (`BlameInput`, `GitBlame`,
  `GitBlameLine`, capability `blame`),
  `apps/api/src/infrastructure/git/{github,gitlab,local}-provider.ts`,
  `apps/api/src/domain/git/git-read-limits.ts` (`GIT_BLAME_LINE_LIMIT`),
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (método `blame`), `apps/api/src/interfaces/http/git/code.controller.ts`
  (`GET /projects/:id/code/blame`)
- **Teste:** `apps/api/test/contract/git-provider.contract.ts` (bloco "blame"),
  exercitado pelos três specs de provider — o do `local` contra git de
  verdade — e `read-project-code.use-case.spec.ts` (bloco "blame")
- **Origem:** FASE 26b (fundação das pendências declaradas da FASE 26/
  [ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md))

### RN-111 — `listPullRequests` é a 14ª operação do `GitProviderContract`; a lista navegável abre o mesmo diff por id {#rn-111}

`CodeDiffPanel.tsx` consome `listPullRequests(state?)` numa lista clicável
(id/número/título/autor/estado/branches, com filtro por estado); clicar num
item reusa o MESMO fluxo de diff por id que já existia — não há caminho novo
de leitura, só como CHEGAR ao id sem precisar saber de cor. Quem já sabe o id
(ex.: veio de Aprovações) continua podendo colar direto.

`listPullRequests(state?)` devolve um RESUMO por PR
(`GitPullRequestSummary`: id, número, título, autor, estado, branches,
`updatedAt`) — não `GitPullRequest`, que é o tipo de ESCREVER (abrir/mesclar) e
nunca teve título nem autor porque nenhuma das duas operações precisava. Um
tipo próprio evita que a escrita ganhe campos que só a leitura usa.

O `local` TEM PR — o store sidecar da Fase 4a já é a fonte, e a suposição do
enunciado ("PR não existe no conceito de repositório local puro") não se
sustentou: o self-contained dos dev agents criou PR local desde então. As três
capabilities são `true`. `GIT_PR_LIST_LIMIT` (100) é uma página só, sem
paginação de seguimento — navegação humana, não sincronização de histórico.

- **Onde:** `packages/shared/src/index.ts` (`ListPullRequestsInput`,
  `GitPullRequestSummary`, `GitPullRequestList`, capability
  `pullRequestsList`), `apps/api/src/infrastructure/git/{github,gitlab,
  local}-provider.ts`, `apps/api/src/domain/git/git-read-limits.ts`
  (`GIT_PR_LIST_LIMIT`), `read-project-code.use-case.ts` (método
  `pullRequests`), `code.controller.ts` (`GET /projects/:id/code/pull-requests`),
  `apps/web/src/routes/code/CodeDiffPanel.tsx` (lista clicável, filtro por
  estado, reuso do fluxo de diff por id)
- **Teste:** `git-provider.contract.ts` (bloco "listPullRequests"),
  `read-project-code.use-case.spec.ts` (bloco "lista de PRs"),
  `apps/web/src/routes/code/CodeDiffPanel.test.tsx`
- **Origem:** FASE 26b

### RN-112 — `listBranchesDetailed` é operação PRÓPRIA, separada de `listBranches` {#rn-112}

Fundação do dropdown rico, agora consumida por `CodeBranchPicker.tsx`
(`ahead`/`behind`, badge de PR — a onda seguinte à FASE 26b fechou a
pendência que `CodeShell.tsx` declarava). A decisão foi NÃO estender `listBranches` — a
13ª operação original, que o bootstrap de Gitflow chama sem precisar de nada
disso: enriquecer custa uma chamada extra ao provider POR BRANCH (duas no
GitLab, que não tem endpoint que devolva os dois lados de uma comparação numa
chamada só, ao contrário de `compareCommitsWithBasehead` do GitHub e de `git
rev-list --left-right --count` no local). Encostar esse custo em toda
adoção/criação de branch transformaria o bootstrap numa varredura cara. As
duas operações convivem no contrato: `listBranches` pro bootstrap,
`listBranchesDetailed` (a 15ª) pra aba Code — `GitBranchDetail` estende
`GitBranch` só na FORMA, nunca no CONTRATO de quem chama.

`ahead`/`behind` são sempre relativos à branch DEFAULT do repositório
(`ListBranchesDetailedInput.defaultBranch`, que o chamador já sabe — pedi-la
de novo ao provider seria uma chamada a mais só pra redescobrir o que já
tinha). `null` nos dois quando o provider não consegue computar (branch órfã,
histórico não relacionado) é degradação honesta, nunca um número inventado.
`GIT_BRANCH_DETAIL_LIMIT` (30) corta pelas mesmas razões de tráfego do item 34
da FASE 26 — sem ele, um repositório com centenas de branches viraria centenas
de chamadas por abertura do dropdown.

- **Onde:** `packages/shared/src/index.ts` (`ListBranchesDetailedInput`,
  `GitBranchDetail`, `GitBranchDetailList`, `GitBranchPullRequestRef`,
  capability `branchesDetailed`), `apps/api/src/infrastructure/git/{github,
  gitlab,local}-provider.ts`, `git-read-limits.ts`
  (`GIT_BRANCH_DETAIL_LIMIT`), `read-project-code.use-case.ts` (método
  `branches`), `code.controller.ts` (`GET /projects/:id/code/branches`);
  no web, `apps/web/src/lib/api-client.ts` (`getCodeBranches`) e
  `apps/web/src/routes/code/CodeBranchPicker.tsx` — o dropdown em si, aberto
  a partir de `CodeShell.tsx`
- **Teste:** `git-provider.contract.ts` (bloco "listBranchesDetailed"),
  `read-project-code.use-case.spec.ts` (bloco "branches detalhadas"),
  `apps/web/src/routes/code/CodeBranchPicker.test.tsx`
- **Borda:** o método `branches()` mora no MESMO caso de uso das outras seis
  leituras (`ReadProjectCodeUseCase`), não perto do bootstrap — é uma LEITURA
  da aba Code, com a mesma resolução de credencial e o mesmo portão de
  container (RN-105) que as demais; tratá-la como operação de bootstrap
  duplicaria os dois. Uma ref fora da lista de branches (tag ou sha) segue
  alcançável — o rodapé do dropdown tem um campo manual, porque
  `listBranchesDetailed` não enumera essas duas coisas.
- **Origem:** FASE 26b (fundação); onda seguinte fechou a UI

## O gate `implementavel` ativa — QA-estratégia como segundo momento do qa-lead (RN-340/341, ADR 0090)

### RN-341 — A QA-estratégia é o segundo MOMENTO do qa-lead, e nunca suspende {#rn-341}

`packages/contracts/fluxo.yml` declarava o papel `qa-estrategia` como `proposto`, com o
critério de separação escrito no próprio registro: "pode ser o próprio
qa-lead em segundo MOMENTO, não necessariamente agente novo — a separação é
de entregável". O [ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md)
constrói exatamente isso: `Engine.Gates.QaEstrategiaAgent` é módulo SEM
ESTADO (não é `GenServer`), acionado por `Engine.Gates.QaLeadServer.run_design/3`
— um ponto de entrada NOVO e ADITIVO no MESMO processo `qa-lead`, sem tocar
`run/2` (o caminho de sempre, revisão de PR, amarrado a
`DevAgentState.find_by_task_id`).

**O contexto é LEVE, e é aí que a separação de entregável aparece.**
`Engine.Gates.QaEstrategiaContext.fetch/3` busca SÓ story (de
`EngineApiClient.list_backlog/1`, a árvore que o PO já lê — [RN-164](engine.md#rn-164))
e `module_map` vigente (de `EngineApiClient.get_infra_context/2`, o MESMO
`GetInfraContextUseCase` que o Infra Lead consome, aqui só pelo campo
`moduleMap`) — SEM `dev_state`, SEM `worktree_path`: o gate `implementavel`
roda PRE-DEV, antes de existir dev agent, worktree ou `task_id`. Nenhuma
rota nova na api — as duas funções já existiam.

**Nunca suspende.** O registro de ferramentas (`ReadFile`, `SearchWorkspace`,
`EmitPlanoDeTeste`) não inclui `terminal` nem `write_file` — as DUAS únicas
tools que `Engine.Harness.Hooks.ActionPipeline` intercepta para criar
`proposed_action`. Sem chamada nenhuma passando pelo pipeline de ações, o
`ToolLoop` deste agente nunca produz `:pending`, e `run_design/3` roda
SÍNCRONO dentro do próprio `handle_cast` — sem mecanismo de
suspensão/retomada, ao contrário do resto da área de QA.

**O teto de iterações fica em 8 (conversacional), não 60 (gate) — de
propósito, não lacuna.** Este agente roda SEM `token_budget_micros` — não há
task nem budget de task ainda. O critério da [RN-085](engine.md#rn-085) não é "quem
trabalha muito": é "o que segura o gasto além do teto de iterações". Sem
budget por baixo, subir o teto multiplicaria o pior caso sem nada para
conter — a MESMA razão pela qual `infra-workflows` fica em 8 mesmo usando
ferramenta. `"qa-estrategia"` NÃO ganhou cláusula própria em
`Engine.Harness.Iteracoes.tipo/1`: cair no default é a decisão certa.

O entregável — `emit_plano_de_teste` (síntese, critérios executáveis
verificáveis, estratégia de automação GENÉRICA e sem framework — decisão de
escopo desta frente, na `spec/0` que o modelo lê, não uma validação em
código) — vira o artefato `artifact.plano_de_teste`
(`ArtifactEmitter.emit/5`, schema validado, `criteriosExecutaveis` não pode
ser vazio), no event log da MESMA sessão que chamou `run_design/3` — é lá
que `assess_implementability` ([RN-340](api.md#rn-340)) o lê depois. Falha
(limite de iterações, orçamento, modelo que para sem emitir) NUNCA é
silenciosa: `agent.error` durável com origem, mesma régua da
[RN-059](engine.md#rn-059).

**Desde a [RN-674](engine.md#rn-674) (ADR 0192) o MOMENTO mudou.** O segundo momento
continua sendo do `qa-lead`, sem agente novo, e continua nunca suspendendo;
mas roda DEPOIS da entrega, no começo do ciclo de `run/2`, com o worktree do
dev e os arquivos do diff — `run_design/3` e `QaEstrategiaContext` saíram, e
o artefato ganhou `taskId`. O teto continua 8, agora COM o orçamento da task
por baixo.

- **Onde:** `apps/engine/lib/engine/gates/qa_estrategia_agent.ex`,
  `qa_lead_server.ex` (`run_area/3`, desde a [RN-674](engine.md#rn-674)),
  `tools/emit_plano_de_teste.ex`, `hooks/termination_plano_de_teste.ex`;
  `apps/engine/lib/engine/harness/artifact_schemas.ex` (`plano_de_teste`);
  `apps/engine/lib/engine/harness/iteracoes.ex` (SEM cláusula nova, ver
  acima); `packages/contracts/fluxo.yml` (`qa-estrategia`, `status: active`)
- **Teste:** `apps/engine/test/engine/gates/qa_estrategia_agent_test.exs`,
  `qa_lead_server_test.exs` (describe "plano de teste da entrega (ADR 0192)"), `apps/engine/test/engine/harness/artifact_schemas_test.exs`
  (describe "plano_de_teste"), `iteracoes_test.exs` ("qa-estrategia é
  conversacional DE PROPÓSITO")
- **Origem:** [ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md)

---

## `secops-runtime` — relatório de abuso sobre `rate_limit_hits` (RN-375..377, ADR 0091)

### RN-377 — A seção "não medido" é permanente, e cita as três lacunas por nome {#rn-377}

`montarRelatorio` sempre inclui `naoMedido`: detecção automática de
incidente, resposta a incidente e postmortem de segurança. As três dependem
do mesmo gatilho que `packages/contracts/fluxo.yml` já declarava para `secops-runtime` —
tráfego de produção real — e nenhuma delas é simulada com incidente de
exemplo nem número inventado (mesmo princípio dos ADRs 0041/0042/0077: sem o
dado real, a lacuna fica visível em vez de fingida). A seção só sai da lista
quando o produto tiver tráfego real para medir contra ela — não é um TODO a
apagar na próxima limpeza.

- **Onde:** `apps/api/scripts/relatorio-seguranca-runtime.ts`,
  `apps/api/package.json` (`relatorio:seguranca-runtime`)
- **Teste:** `apps/api/test/scripts/relatorio-seguranca-runtime.spec.ts`
- **ADR:** [0091](../adr/0091-secops-runtime-relatorio-de-abuso.md)

---

## `platform` ganha uma primeira entrega: relatório de telemetria sob demanda (RN-385/386, ADR 0092)

### RN-385 — O papel `platform` nasce como SCRIPT de leitura pontual, sobre as mesmas fontes do `DomainGaugesCollector` {#rn-385}

`packages/contracts/fluxo.yml` descreve `platform` (`camada_plataforma`) como "SRE / Platform
— dono do loop de retorno", `status: planned`, com ativação sincronizada a
`DEPLOY_ENABLED` — que não existe. O dono do produto decidiu antecipar a
metade que já tem dado real por trás: `pnpm --filter api relatorio:telemetria
[--projeto <uuid>] [--json]` lê, sob demanda, as MESMAS perguntas que o
`DomainGaugesCollector` já responde a cada `METRICS_GAUGE_INTERVAL_MS` para o
scrape do Prometheus — sessões ativas/closing por projeto, tasks bloqueadas
por projeto, estado do último backup (idade, status, tamanho, sempre GLOBAL,
nunca por projeto, porque o produto tem um backup só). Não é agente LLM nem
`GenServer`: é leitura avulsa, sem estado, que termina depois de imprimir.

As consultas SQL são REPLICADAS, não importadas do coletor — os métodos dele
(`collectSessions`/`collectBlockedTasks`/`collectBackup`) são privados e
terminam escrevendo num gauge Prometheus (`this.metrics.*.set(...)`); não há
uma metade pura de "só a query" para reusar sem acoplar um script avulso ao
ciclo de vida de um `@Injectable` do NestJS. O script também NÃO é um segundo
coletor: não registra métrica nenhuma, não roda em `setInterval`.

A saída sempre traz "onde ver mais" (os três dashboards versionados em
`deploy/k8s/observability/dashboards/*.json`, os alertas em
`deploy/k8s/observability/alerts/brabo-alerts.yaml`, `docs/runbook.md
#observabilidade` e `pnpm dev:obs` para observabilidade local) — o script
LINKA para o que já existe, nunca duplica.

- **Onde:** `apps/api/scripts/relatorio-telemetria.ts`; espelha
  `apps/api/src/infrastructure/observability/domain-gauges.collector.ts`
- **Teste:** `apps/api/test/scripts/relatorio-telemetria.spec.ts` (funções
  puras — `parseArgs`, `formatarIdade`, `formatarBytes` — mesmo recorte de
  `medir-execucao.spec.ts`: a parte que fala com o banco é exercitada rodando
  o script contra um banco real)
- **ADR:** [0092](../adr/0092-platform-relatorio-de-telemetria-sob-demanda.md)

### RN-386 — O relatório de telemetria declara, sem inventar, o que NÃO mede {#rn-386}

O gatilho real do papel `platform` (`DEPLOY_ENABLED`) não existe: não há
ambiente de produção com tráfego real, não há SLO numérico definido em lugar
nenhum do produto, e não há postmortem possível sem incidente de verdade.
`relatorio-telemetria.ts` diz isso na PRÓPRIA saída, numa seção "não medido",
em vez de fingir cobertura que não tem — a mesma disciplina do ADR 0042 para
nota de modelo e do ADR 0077 para qualidade de código: sem o dado real, o
produto DECLARA a lacuna, nunca inventa o número.

Três lacunas, todas explícitas: **SLO numérico formal** (nenhum está
definido); **postmortem** (depende de incidente real que não aconteceu); e
**telemetria de volta ao produto em loop fechado** (o script é leitura
pontual sob demanda — observar, decidir e agir sozinho é o que tornaria
`platform` `active` em `packages/contracts/fluxo.yml`, e por isso o `gate_saida: { id:
operavel, status: planned }` do papel permanece `planned`, intocado por esta
mudança).

- **Onde:** `apps/api/scripts/relatorio-telemetria.ts` (função `imprimir`,
  seção "Não medido"); `packages/contracts/fluxo.yml` (`camada_plataforma › platform ›
  saidas_alvo`, artefato `telemetria-consolidada`, campo `nota`)
- **Teste:** cobertura indireta — a seção é texto fixo verificado por leitura
  do arquivo; não há verdade condicional a testar aqui (nada a errar entre
  "medido" e "não medido" além do texto em si)
- **ADR:** [0092](../adr/0092-platform-relatorio-de-telemetria-sob-demanda.md)

---

## Auditoria fluxo.yml × código — Onda 2: RN-160 no backend e delegação Dev Lead → dev (RN-404/405, ADR 0094)

### RN-405 — A delegação Dev Lead → dev vira dado em `delegations`, com `parecerArtifactId` redefinido para "o que justificou a decisão" {#rn-405}

O ADR 0053 (FASE 14d) já previa a delegação Dev Lead → `dev-<modulo>` como
"o mesmo caminho de QA e Infra" (`delegations`, `area = 'dev'`), mas
declarou isso fora de escopo. `dev_lead_server.ex` nunca gravava a tabela —
só QA (`qa_lead_server.ex`) e Infra (`infra_lead_server.ex`) gravavam, e os
dois do lado ENGINE, porque é lá que o subagente produz um PARECER (veredito
de rodada única) que justifica `parecerArtifactId`.

O Dev Lead não tem esse padrão: a ativação de um `dev-<modulo>` acontece do
lado API, em `AcceptParallelizationUseCase.execute` — chamada tanto pelo
caminho direto (`RequestParallelizationUseCase`, abaixo do teto de sessão da
[RN-083](api.md#rn-083)) quanto pelo aprovado (`ExecuteParallelizationUseCase`,
depois que o usuário aprova a `proposed_action` tipo `parallelize`). A
gravação entrou DENTRO desse método — cobre os dois caminhos de graça,
porque os dois já convergem ali —, com `status: 'completed'` REDEFINIDO para
esta área: significa "a delegação foi EFETIVADA" (o agente subiu), não "o
subagente terminou e emitiu parecer" como em QA/Infra (decisão registrada no
[ADR 0094](../adr/0094-delegacao-dev-lead-vira-dado.md)).

`parecerArtifactId` aponta para o `id` do evento `artifact.module_map` mais
recente e vigente do projeto — obtido de
`SessionEventRepository.listByTypeForProject(projectId, 'artifact.module_map')`
(método genérico já existente, usado por `computeCoverage` para
`artifact.business_rule`; nenhuma consulta nova foi escrita, só uma chamada a
mais dele — o último item da lista é o mais recente, porque a função ordena
por `createdAt` ASC) — o artefato que justificou a decisão de delegar.
`area: 'dev'`, `leadAgent: 'dev-lead'`, `subagent` é o id exato do agente
ativado (`extraDevAgentId(module)`, a MESMA função que constrói o id em todo
o resto do use case — nenhum formato novo). Sem `artifact.module_map` no
projeto (não deveria acontecer — é entrada obrigatória do Dev Lead em
`packages/contracts/fluxo.yml`), a delegação NÃO é gravada com um id inventado: só loga o
estado inesperado, pela mesma lição da RN-059 (nunca falha silenciosa, mas
também nunca finge uma justificativa que não existe). E falha de
`RecordDelegationUseCase.execute` (ex.: banco fora do ar) é capturada e
logada, nunca propagada — a ativação do dev agent já é sucesso quando a
tentativa de gravar a delegação acontece, e não pode ser derrubada por uma
gravação auxiliar.

- **Onde:** `apps/api/src/application/use-cases/execution/accept-parallelization.use-case.ts`
  (`recordDevDelegation`, chamado ao fim de `execute`)
- **Teste:** `apps/api/test/application/use-cases/execution/accept-parallelization.use-case.spec.ts`,
  describe "delegação Dev Lead → dev (área dev, ADR 0094)" — grava com
  `area: 'dev'` apontando pro module_map mais recente; sem module_map não
  grava (e não lança); `RecordDelegationUseCase` falhando não derruba a
  ativação
- **ADR:** [0094](../adr/0094-delegacao-dev-lead-vira-dado.md)

---

## Auditoria fluxo.yml × código — Onda 6 (última): o gate `necessidade-validada` (RN-406, ADR 0095)

Fecha o último achado do plano da auditoria (seção D,
`docs/explanation/auditoria-fluxo-vs-codigo.md`) — B2. As outras cinco
ondas já tinham fechado (a 3, 4 e 5 antecipadas fora de ordem pelos ADRs
0089/0090; a 1 e a 2 nos PRs anteriores). `packages/contracts/fluxo.yml` (papel
`criativo`) declarava `gate_saida: { id: necessidade-validada, status:
proposto }` desde o ADR 0085 sem mecanismo nenhum atrás — e
`modelo-de-time.md` já registrava por que: o Criativo (o modelo) decidir
sozinho que a necessidade que ele mesmo produziu está validada seria
autovalidação, não gate de verdade.

### RN-406 — O gate `necessidade-validada` se fecha com um clique SEPARADO do usuário, nunca com o Criativo se autovalidando {#rn-406}

> **Revista pelo [ADR 0185](../adr/0185-estou-pronto-fecha-os-dois-gates.md)
> ([RN-657](api.md#rn-657)), por decisão do dono em 30/09.** O clique deixou de ser
> SEPARADO: "Estou pronto — a necessidade está validada" grava
> `readiness.confirmed` e `necessity.validated` no mesmo POST, com o
> `product_brief` produzido DEPOIS do clique (`productBriefId: null`). O botão
> "Confirmar necessidade validada" saiu da tela. O que desta regra continua
> valendo: quem valida é sempre uma PESSOA, nunca o Criativo; o gate segue
> `warn`. `POST .../agents/criativo/validate-necessity` continua na api, sem
> consumidor na tela — é o caminho de uma sessão cujo "Estou pronto" é
> anterior ao ADR 0185. O texto abaixo é o desenho do ADR 0095, mantido como
> histórico.

`SessionPage.tsx` ganha um terceiro botão de confirmação, no MESMO padrão
interacional de "Estou pronto para produzir" (RN-142) e "Confirmar
arquitetura pronta" ([RN-160](web.md#rn-160)): "Confirmar necessidade validada"
(`handleValidateNecessity`) chama `POST
.../agents/criativo/validate-necessity`, que grava `necessity.validated`
com `payload.productBriefId` apontando para o `artifact.product_brief`
mais recente da sessão.

O botão só habilita DEPOIS que `confirm_readiness` já consolidou o
`product_brief` (`hasProductBrief`, `events.some(e => e.type ===
'artifact.product_brief')`) — não faz sentido "validar" um resumo
executivo que ainda não foi produzido, e é essa a leitura mais
consistente com `packages/contracts/fluxo.yml`: `necessidade-validada` é gate de SAÍDA
do Criativo, o momento em que o trabalho dele já entregou um artefato
concreto. `ValidateNecessityUseCase` revalida a mesma pré-condição no
BACKEND (`SessionEventRepository.listByTypeInSession(sessionId,
'artifact.product_brief')`, pega o último por `seq`) — a UI desabilitada
sozinha não bastaria, mesma lição da [RN-404](api.md#rn-404).

Diferente de `OfferInfraHandoffUseCase` (RN-160), esta confirmação NÃO
sinaliza o engine: o handoff Criativo→PO já aconteceu dentro do próprio
`confirm_readiness`
(`CriativoServer.executar_confirm_readiness/1`), então não há agente
nenhum esperando por este evento — ele é só o registro de que um humano
validou o MÉRITO do que já foi entregue. `ValidateNecessityUseCase` não
recebe `ApiToEngineClient` no construtor.

`apps/api/config/gates.yml` ganha o gate `necessidade-validada`: `status: active`,
`aprovacao_humana: true` (é literalmente um clique humano),
`verificacao: script`, mas `severidade: warn` — nada no produto hoje
CONSULTA a passagem deste gate antes de deixar o PO seguir (diferente de
`story-promovida`/`plano-de-adocao`, que são `block` porque uma trava
real de código os impede de serem pulados). `packages/contracts/fluxo.yml` (papel
`criativo`) passa `status: proposto` → `status: ativo`.

- **Onde:** `apps/api/src/application/use-cases/agents/validate-necessity.use-case.ts`;
  `apps/api/src/interfaces/http/agents/agents.controller.ts`
  (`validateNecessityHandoff`); `apps/web/src/routes/SessionPage.tsx`
  (`hasProductBrief`, `necessidadeJaValidada`, `handleValidateNecessity`)
- **Teste:** `apps/api/test/application/use-cases/agents/validate-necessity.use-case.spec.ts`
  — sem `product_brief`, recusa ANTES de gravar qualquer evento; com um ou
  mais, grava referenciando o MAIS RECENTE;
  `apps/web/src/routes/SessionPage.validar-necessidade.test.tsx` — botão
  desabilitado sem `product_brief`, habilitado com ele, some depois de
  `necessity.validated`
- **ADR:** [0095](../adr/0095-gate-necessidade-validada.md)

---

### RN-407 — O PO lê o funil de entrega e DORA parcial, terceira leitura escopada ao projeto {#rn-407}

O PO ganhou uma TERCEIRA ferramenta de leitura — `listar_metricas_de_produto`
(`:direct`, sem parâmetro nenhum) — servida por
`GET /internal/projects/:projectId/product-metrics`, mesmo desenho das duas
irmãs da [RN-164](engine.md#rn-164): escopo fechado no projeto, sem termo de busca,
sem paginação.

`packages/contracts/fluxo.yml` (papel `po`, entrada `metricas-de-produto`) declarava
`status: lacuna` desde o [ADR 0089](../adr/0089-analytics-e-delivery-metricas-como-relatorio.md),
que já tinha entregue o DADO — o script `pnpm --filter api analise:funil`
mede o funil real sessão → commit → PR → merge, o lead time real e a
deployment frequency real a partir de `proposed_actions`. O que faltava era
só o MECANISMO: o PO nunca tinha como reler esse relatório dentro do turno.
Fecha o item B4 da auditoria `fluxo.yml` × código
([docs/explanation/auditoria-fluxo-vs-codigo.md](../explanation/auditoria-fluxo-vs-codigo.md)) —
a ÚLTIMA pendência da tabela "Backlog do modelo de time"
(docs/explanation/backlog.md), que fica vazia depois desta.

O CÁLCULO é o MESMO do script, nunca duplicado: as funções puras
(`calcularFunil`/`calcularLeadTimes`/`leadTimeMedioMs`/
`deploymentFrequencyPorDia`) e a query que monta `AcaoGit[]`
(`buscarAcoesGitDoFunil`) foram extraídas de `apps/api/scripts/analise-funil.ts`
para `apps/api/src/application/services/funil-metrics.ts` — um caso de uso em
`src/` não pode importar de `scripts/`, e o script passou a REEXPORTAR dali
em vez de definir localmente, sem mudar assinatura nem comportamento (o
teste de regressão do script continua verde sem ser tocado).

O corpo JSON que a rota devolve **não tem campo nenhum** para as três
ausências permanentes que o script já declarava em texto ("Não medido, de
propósito": funil de produto completo ideação → commit, evidência de adoção
por feature, MTTR/change failure rate) — o shape do relatório nunca reservou
espaço para elas. A ferramenta do PO cita as três pelo NOME no TEXTO que
devolve ao modelo, sempre, e não só quando o número dá zero: sem essa
seção o PO leria só os números do funil e concluiria por omissão que não há
lacuna nenhuma.

- **Onde:** `apps/api/src/application/services/funil-metrics.ts`;
  `apps/api/scripts/analise-funil.ts` (reexporta);
  `apps/api/src/application/use-cases/backlog/list-product-metrics.use-case.ts`;
  `apps/api/src/interfaces/http/internal/internal-projects.controller.ts`;
  `apps/api/src/interfaces/http/internal/dto/product-metrics.response.dto.ts`;
  `apps/engine/lib/engine/harness/tools/listar_metricas_de_produto.ex`;
  `apps/engine/lib/engine/agents/po_server.ex`;
  `apps/engine/lib/engine/sessions/engine_api_client.ex`
- **Teste:** `apps/api/test/application/use-cases/backlog/list-product-metrics.use-case.spec.ts`;
  `apps/api/test/scripts/analise-funil.spec.ts` (regressão — continua
  importando de `scripts/analise-funil.ts`, sem alteração);
  `apps/engine/test/engine/harness/tools/listar_metricas_de_produto_test.exs`;
  `apps/engine/test/engine/agents/po_server_test.exs`
- **Origem:** mesmo padrão da [RN-164](engine.md#rn-164) (leitura de agente escopada
  ao projeto, sem efeito externo, sem `proposed_action`); o dado é do
  [ADR 0089](../adr/0089-analytics-e-delivery-metricas-como-relatorio.md) — esta RN só
  fecha o mecanismo de leitura que faltava.

## O repositório nasce no aceite do handoff ao Arquiteto, e a execução não começa sem ele (RN-582)

### RN-605 — O pull de imagem é um passo NOMEADO do `start`, sob o teto de controle, e o estouro diz que imagem grande não sobe {#rn-605}

O `start` da porta de Docker não fazia pull: o `docker run` fazia, por dentro,
sob o `TIMEOUT_DE_CONTROLE_MS` (30 s). Reproduzido na AT-234 com um duplo do
daemon (imagem ausente, pull de 45 s, sem dormir e sem rede): o estouro saía
como `ComandoDeDockerFalhouError` — "`docker run …` terminou com código -1:
(sem saída de erro)" —, virava 502 com `origem: null` no broker e chegava à api
sem nome. E matar o CLI CANCELA o pull (medido no Docker 29.8.0, containerd):
a imagem continuou ausente nos 60 s seguintes, então a frase "o pull pode
seguir no daemon" não valia.

Das quatro saídas medidas (teto próprio de ~300 s, `start` assíncrono, pull
antecipado na decisão de imagem, só dar nome), o mantenedor decidiu a **D —
só dar nome** (2026-09-27). A regra:

1. **O pull é explícito.** Antes do `run`, `image inspect`; imagem presente
   não é baixada de novo (o mesmo `--pull missing` do `run`). Ausente, `docker
   pull` sob o MESMO teto de controle de 30 s — nenhum teto maior.
2. **O estouro tem nome.** `PullExcedeuTetoError`, origem `infra`, com a
   imagem, o teto e a consequência inteira: o pull foi cancelado, a imagem
   continua ausente, imagem grande não sobe por este caminho, e o conserto é
   baixá-la antes no host. Antes de afirmar isso, o adaptador confere o daemon
   (`docker version`): daemon fora continua sendo `DockerIndisponivelError`.
   Pull que falha por outro motivo segue o caminho de sempre
   (`ComandoDeDockerFalhouError`, sem origem, ADR 0128).
3. **O nome atravessa.** O broker responde 504 com `origem: 'infra'`, e a api
   o repassa em `BrokerRecusouError` — `origem` preenchida, nunca `null`. No
   modo `runner` o mesmo adaptador roda na máquina do usuário e a mensagem
   chega no `container_start_result`.
4. **Os tetos de quem espera o `start` contam o pior caso inteiro**: os dois
   `ps` de `resolver`, `image inspect`, `pull`, `run` e o `docker version` de
   diagnóstico — seis chamadas de controle (`CHAMADAS_DE_CONTROLE_NO_START`).
   A api espera 10 + 6 × 30 + 5 = **195 s** (`TETO_DE_MUTACAO_MS`); o engine,
   no `RunnerRouter`, 6 × 30 + 5 = **185 s** no `start` e 4 × 30 + 5 =
   **125 s** no `stop`/`remove` (eram 60 s, menos que o `resolver` mais a
   operação).
5. **O `propose_action` do engine espera a execução que a api faz dentro
   dele.** `container_start`, `container_start_via_runner` e `container_stop`
   auto-aprovados são EXECUTADOS na mesma requisição
   (`ProposeActionUseCase`), e a chamada caía no default de 15 s do Req — um
   `start` longo voltava como timeout de transporte mesmo sem pull. Agora ela
   leva `receive_timeout` de **225 s** (o teto da api + 30 s), espelhado na api
   como `TETO_DO_PROPOSE_ACTION_DE_CONTAINER_NO_ENGINE_MS`; os testes dos dois
   lados conferem broker < api < engine e runner < engine. `container_remove`
   fica fora: nunca nasce auto-aprovado.

Nenhuma dependência nova ([ADR 0128](../adr/0128-porta-de-docker-e-a-prova-de-empacotamento.md)), nenhum campo
que o chamador escreva ([ADR 0130](../adr/0130-broker-de-container.md)): a imagem
continua vindo da decisão do Arquiteto, e `pull` não é operação nova do broker
— é um passo do `start`.

**Declarado, não fechado:**

- **Imagem grande não sobe na primeira tentativa**, pelo broker nem pelo
  runner — decisão D do mantenedor. O desfecho agora é nomeado; o conserto é
  baixar a imagem antes no host.
- **No pior caso de falha, a aprovação fica presa por até ~195 s**:
  `ExecuteContainerStartUseCase` roda dentro do `POST` de aprovação, e nem a
  web nem o servidor HTTP têm teto próprio.
- Não foi medido se as camadas baixadas antes do cancelamento são
  reaproveitadas na tentativa seguinte.

- **Código:**
  `packages/docker-port/src/docker-cli.ts:202` (`PullExcedeuTetoError`),
  `:586` (`garantirImagem`), `:125` (`CHAMADAS_DE_CONTROLE_NO_START`),
  `:116` (`TIMEOUT_DE_CONTROLE_MS`);
  `apps/broker/src/servidor.ts:231` (`PullExcedeuTetoError`);
  `apps/api/src/infrastructure/http-clients/container-broker.client.ts:241` (`TETO_DE_MUTACAO_MS`),
  `:205` (`CHAMADAS_DE_CONTROLE_NO_START`),
  `:264` (`TETO_DO_PROPOSE_ACTION_DE_CONTAINER_NO_ENGINE_MS`);
  `apps/engine/lib/engine/sessions/engine_api_client.ex:1945` (`opcoes_do_propose_action`),

  `apps/engine/lib/engine/sessions/engine_api_client.ex:1945` (`opcoes_do_propose_action`),
  `:1649` (`@teto_do_propose_action_de_container_ms`);
  `apps/engine/lib/engine/runners/runner_router.ex:52` (`@timeout_do_start_ms`)
- **Teste:** `packages/docker-port/src/docker-cli.spec.ts:425` (describe da
  reprodução, "(AT-234)": o pull de 45 s termina NOMEADO, `:457`; daemon fora
  continua daemon fora, `:481`; o pull que cabe sobe, `:493`; imagem presente
  não é baixada, `:508`; as seis chamadas, `:520`);
  `apps/broker/src/servidor.spec.ts:317` (504 com origem `infra`);
  `apps/api/test/infrastructure/http-clients/container-broker.client.spec.ts:144`
  (chega com `origem`), `:362` e `:377` (a conta e a ordem);
  `apps/runner/src/index-handlers.spec.ts:420` (o nome no
  `container_start_result`);
  `apps/engine/test/engine/sessions/engine_api_client_propose_action_test.exs:67`
  (HTTP real: a api que demora 16 s é esperada), `:82` e `:95` (as ações e a
  ordem, lendo o espelho da api);
  `apps/engine/test/engine/runners/runner_router_test.exs:183`
- **Origem:** AT-234

## Decidir no chat, onde o dono está (RN-626)

### RN-627 — O container do projeto roda com o dono da pasta, medido pela api {#rn-627}

Sob `--cap-drop ALL` o root do container não tem `CAP_DAC_OVERRIDE` e não
escreve na pasta do projeto, que é do uid do operador: `npm install` dava
`EACCES` para todo dev agent (AT-247, [ADR 0180](../adr/0180-container-com-o-dono-da-pasta.md)).

1. **A api mede, o broker compõe.** `container-spec` devolve `usuarioDaPasta`
   (`stat` da pasta dos modos `container`/`mounted`; `null` se a pasta não é
   alcançada, se o dono é root ou se o projeto é `runner`). O broker o copia
   para `spec.usuario` e o adaptador emite `--user uid:gid` e `--env HOME=/tmp`.
2. **Nunca vem de quem pede.** `start` não tem corpo e o corpo de `exec` ignora
   campo extra; `exec` herda o usuário do container.
3. **O broker revalida.** Inteiros em 1..2^31-1; `0` é recusado nomeando
   `usuario.uid`/`usuario.gid` (root é o ausente, "como sempre").
4. **Não afrouxa contenção**: `--cap-drop ALL`, um bind, rede de dois valores
   e cinco operações continuam. Container já criado só muda ao ser recriado.

- **Onde:** `packages/docker-port/src/docker-cli.ts:785` (`argsDeCriacao`),
  `packages/docker-port/src/spec-de-container.ts:136` (`usuarioValidado`),
  `apps/broker/src/operacoes.ts:427` (`especificacaoDoProjeto`),
  `apps/api/src/application/use-cases/containers/obter-spec-de-container.use-case.ts:124`
  (`ObterSpecDeContainerUseCase`)
- **Teste:** `packages/docker-port/src/docker-cli.spec.ts` (o `run` leva
  `--user` e continua sem campo livre), `packages/docker-port/src/spec-de-container.spec.ts`
  (`usuario`), `apps/broker/src/operacoes.spec.ts` ("o usuário do container"),
  `apps/api/test/application/use-cases/containers/spec-e-observacao-de-container.use-case.spec.ts`
- **Origem:** AT-247

## A Anamnese não paga duas vezes pela mesma janela, e o resgate de gate não reinicia ciclo que espera alguém (RN-722)

### RN-738 — Parar container de projeto é imediato, e a linha da `/containers` relê ao decidir {#rn-738}

- **Regra:** todo container de projeto sobe com `--init` — CONSTANTE da
  composição do `docker run` em `DockerViaCli`, nunca campo da spec (a
  contenção é o tipo, ADR 0130); vale para o broker e para o runner, que usam
  a mesma porta. O comando de espera (`sleep infinity`) era PID 1 sem handler
  de SIGTERM, e o kernel não entrega sinal de ação padrão a PID 1: `docker
  stop` esperava os 10 s e matava (`Exited (137)`). Medido em container
  descartável: 10,25 s sem `--init`, 0,20 s com. Na página `/containers`,
  decidir a ação pendente (aprovar, negar, sempre permitir) invalida
  `['containers-overview']` e `['container-lifecycle', projectId]` no
  `finally` — também quando a chamada falha ou cai —, e devolve a promessa ao
  card. Nenhum poll novo (RN-579/632).
- **Onde:** `packages/docker-port/src/docker-cli.ts:785` (`argsDeCriacao`),
  `apps/web/src/components/AcoesDoContainer.tsx:61` (`invalidateContainers`), `:172`
  (`aprovar`)
- **Teste:** `packages/docker-port/src/docker-cli.spec.ts` (`run` leva
  `--init` antes do comando), `apps/broker/src/contencao-do-brabo.spec.ts`
  (os dois modos sobem com `--init`), `apps/web/src/routes/ContainersPage.test.tsx`
  (aprovar relê visão geral e ciclo de vida; aprovação recusada ainda relê)
- **Origem:** AT-422 (instalação local, 03/10: três paradas `executed` com a
  linha em "rodando" e `Exited (137)`)

### RN-807 — O `exec` que estoura o teto volta como estouro, e o comando morre dentro do container {#rn-807}

- **Regra:** o estouro do teto do `exec` da `DockerPort` é decidido pelo
  RELÓGIO (decorrido ≥ teto) além do `killed`, porque o cliente `docker exec`
  captura o SIGTERM do `timeout` do `execFile` e sai com código 0 — medido:
  `sleep 30; echo FIM` sob teto de 3s voltava `erro: null`, `stdout: ""`, e o
  adaptador devolvia `exitCode: 0`. Comando de agente que estourava os 120s
  voltava "exit 0", e o QA aprovou suíte que trava. O estouro agora devolve
  `exitCode: -1`, `timedOut: true` e a marca de timeout. E matar o cliente não
  mata o comando: o `exec` embrulha o comando (que segue inteiro e não
  interpretado; o canal é `-e BRABO_EXEC_CMD`, [RN-947](#rn-947)) num `sh` que grava o próprio PID — líder de grupo e de sessão,
  porque o runtime faz `setsid` em todo `docker exec` — em `/tmp` do container;
  no estouro o adaptador mata o GRUPO por esse PID (SIGKILL), numa chamada
  interna, sem operação nova na porta (ADR 0130). Medido e recusado: `timeout`
  do busybox dentro do `sh -c` — o vigia morre com o cliente e o `sleep`
  sobrevive. Se a morte falhar (`/tmp` sem escrita, por exemplo), a marca diz
  que o processo pode ter sobrevivido.
- **Onde:** `packages/docker-port/src/docker-cli.ts:279` (`estourouOTeto`),
  `packages/docker-port/src/docker-cli.ts:506` (`matarExecEstourado`)
- **Teste:** `packages/docker-port/src/docker-cli.spec.ts` ("erro nulo depois do
  teto É estouro"; "no estouro mata o grupo do comando DENTRO do container";
  "o comando que estoura volta timedOut e MORRE dentro do container", contra
  Docker real, pulado sem daemon)
- **Origem:** AT-482

### RN-820 — O container de projeto volta sozinho quando o daemon reinicia {#rn-820}

- **Regra:** o `docker run` composto pelo `DockerViaCli` leva
  `--restart unless-stopped` como CONSTANTE, ao lado do `--init` da
  [RN-738](#rn-738) — a spec não ganha campo, e a contenção do ADR 0130 não
  muda. Um daemon reiniciado (atualização do sistema) religa o container de
  projeto; um `docker stop` explícito (o `container_stop` do ciclo de vida) NÃO
  é desfeito, porque `unless-stopped` não religa o que foi parado à mão — nunca
  `always`. Medido: container `unless-stopped` parado com `docker stop` segue
  `exited` com `RestartCount=0`.
- **Onde:** `packages/docker-port/src/docker-cli.ts:785` (`argsDeCriacao`)
- **Teste:** `packages/docker-port/src/docker-cli.spec.ts` ("cria o container
  com rótulo gerenciado, UM bind e as capabilities derrubadas")
- **Origem:** AT-494 (o daemon reiniciado deixou todo container de projeto
  `Exited (143)` com o registro `running`)

### RN-928 — O comando do app é argumento de um supervisor constante, e sem ele o container é o de sempre {#rn-928}

- **Regra:** `EspecificacaoDeContainer.comandoDoApp` (opcional, até 300 caracteres, sem `\n`, `\r` nem NUL) troca o `sleep infinity` pelo supervisor CONSTANTE `SUPERVISOR_DO_APP`, que recebe o comando como `$1` (molde da [RN-807](#rn-807)) e nunca o concatena: aspas, `;` e `$()` do comando não escapam. O app sobe em background (log em `/tmp/brabo-app.log`, código em `/tmp/brabo-app.exit`) e o PID 1 segue `sleep infinity`. Ausente ou `null`, o `docker run` é byte a byte o anterior. O broker lê o campo SÓ da `container-spec` da api. ([ADR 0228](../adr/0228-comando-do-app-e-rede-do-container.md).)
- **Onde:** `packages/docker-port/src/spec-de-container.ts:351` (`comandoDoAppValidado`), `packages/docker-port/src/docker-cli.ts:380` (`SUPERVISOR_DO_APP`), `packages/docker-port/src/docker-cli.ts:785` (`argsDeCriacao`)
- **Teste:** `packages/docker-port/src/docker-cli.spec.ts:657` (`NÃO-REGRESSÃO`), `packages/docker-port/src/docker-cli.spec.ts:676` (comando com `'`, `;` e `$()` fica como argumento)
- **Origem:** AT-610 (EP-030).

### RN-929 — Porta publicada vai só ao loopback, e DNS e `extra_hosts` são IP literal e nome de lista fechada {#rn-929}

- **Regra:** `portas` vira sempre `-p 127.0.0.1:H:C` (TCP; interface constante, sem opção), host de 1024 a 65535 fora de 3000, 4000, 5173, 5432, 7474, 7687, 8088, 8090 e 11434, no máximo 10 e sem duplicata. `dns` é IP literal v4/v6 (até 3). `hostsExtras` é `{ nome, ip }` (até 10) com nome em `[a-z0-9.-]` de até 253 caracteres, nunca `localhost`, `host.docker.internal` nem nome de serviço da instalação, e IPv4 literal. Os três são recusados com rede `none`. `inspect` devolve `portasPublicadas` lidas de `NetworkSettings.Ports`, separadas do declarado ([RN-468](web.md#rn-468)). ([ADR 0228](../adr/0228-comando-do-app-e-rede-do-container.md).)
- **Onde:** `packages/docker-port/src/spec-de-container.ts:384` (`portasValidadas`), `packages/docker-port/src/spec-de-container.ts:405` (`dnsValidado`), `packages/docker-port/src/spec-de-container.ts:415` (`hostsExtrasValidados`), `packages/docker-port/src/docker-cli.ts:358` (`portasPublicadasDe`)
- **Teste:** `packages/docker-port/src/spec-de-container.spec.ts:237` (recusas), `packages/docker-port/src/docker-cli.spec.ts:688` (`-p 127.0.0.1`, `--dns`, `--add-host`), `apps/broker/src/operacoes.spec.ts:289` (vem da api)
- **Origem:** AT-608 (EP-030), fatia do contrato.

### RN-930 — A instância de QA é efêmera, só mexe no que tem `brabo.papel=qa` e sobe os serviços que a Infra declarou por digest {#rn-930}

- **Regra:** a spec com `qa: { chave, servicos }` sobe `brabo-qa-<workspace_dir_name>-<chave>` sem `--restart`, com `brabo.papel=qa` e `brabo.qa.instancia`, sem app nem porta. `stop`, `remove`, `inspect` e `exec` com `alvo` de QA filtram `brabo.papel=qa`; homônimo sem o papel é "não gerenciado" e nada é removido. Cada serviço (até 6, imagem por digest `@sha256:` obrigatório, `env` de chaves `[A-Z_][A-Z0-9_]*`) sobe com `--network container:<qa>`, `--cap-drop ALL`, sem privilégio nem porta publicada, tetos constantes e `--tmpfs`; serviço compartilhado vive na rede privada `--internal` do projeto. O broker expõe `/containers/:projectId/qa/:chave/{start,remove,exec}` e lê os serviços da api, conferindo a chave. ([ADR 0229](../adr/0229-instancia-de-qa-efemera-com-servicos-declarados-pela-infra.md).)
- **Onde:** `packages/docker-port/src/docker-cli.ts:572` (`iniciarQa`), `packages/docker-port/src/docker-cli.ts:880` (`argsDeServicoDeQa`), `packages/docker-port/src/spec-de-container.ts:439` (`instanciaDeQaValidada`), `apps/broker/src/operacoes.ts:212` (`startQa`), `apps/broker/src/servidor.ts:135` (`rotaDeContainer`)
- **Teste:** `packages/docker-port/src/docker-cli.spec.ts:756` (remove só alcança o papel `qa`), `packages/docker-port/src/spec-de-container.spec.ts:256` (digest, chave, env), `apps/broker/src/operacoes.spec.ts:321` (lista da api e chave da rota), `apps/broker/src/servidor.spec.ts:405` (roteador fechado)
- **Origem:** AT-612 (EP-030).

### RN-941 — O serviço de QA roda com usuário e comando declarados, nunca como root, e leva o nome da instância mais o do serviço {#rn-941}

- **Regra:** revisa a RN-930 e a RN-935 depois da prova com Docker real de 29/10/2026 (AT-612), que achou três defeitos. (1) O serviço PRÓPRIO era criado com o nome da própria instância (`Conflict`): agora é `<instância>-<serviço>`, o que `removerServicosDeQa` e o rótulo `brabo.qa.dono` já esperavam. (2) Postgres sob `--cap-drop ALL` sai com `chown`/`chmod` negados: o serviço ganha `user` (`"<uid>:<gid>"`, inteiros diferentes de 0, sem zero à esquerda, nunca root) que vira `--user`, e os caminhos `tmpfs` montam com `uid=`, `gid=` e `mode=0700` do mesmo dono. (3) Imagens que não sobem sozinhas: o serviço ganha `command` (1 a 16 argumentos de até 200 caracteres, sem `\0`, `\n` ou `\r`), passado como argumentos DEPOIS da imagem, nunca por shell. `null` equivale a ausente. A contenção não muda (`--cap-drop ALL`, sem `--privileged`/`--cap-add`, sem porta publicada, tetos constantes). A régua mora nos três lugares (docker-port, api, engine) e nenhum deles aceita `0`.
- **Onde:** `packages/docker-port/src/spec-de-container.ts:453` (`usuarioDeServicoValidado`), `packages/docker-port/src/docker-cli.ts:880` (`argsDeServicoDeQa`), `apps/api/src/domain/infra/run-instructions.ts:160` (`recusaDoQa`), `apps/engine/lib/engine/infra/instrucoes_de_execucao.ex:133` (`qa`).
- **Teste:** `packages/docker-port/src/docker-cli.spec.ts` (nome, `--user`, dono do tmpfs, comando), `packages/docker-port/src/spec-de-container.spec.ts` (recusa de `0:0`, `70:0`, `70`, comando grande/com quebra), `apps/broker/src/operacoes.spec.ts`, `apps/api/test/domain/infra/run-qa.spec.ts`, `apps/engine/test/engine/infra/instrucoes_de_execucao_test.exs`; prova com Docker real: `postgres:17-alpine` com `70:70` aceita conexão em `localhost:5432` e `busybox httpd` responde em `localhost:9000` de dentro da instância.
- **Origem:** AT-612 (EP-030), ADR 0229.

### RN-947 — O comando do agente no `exec` não aparece na linha de comando de nenhum processo do container {#rn-947}

- **Regra:** o comando do `exec` da `DockerPort` viaja por `-e BRABO_EXEC_CMD=<comando>` e não mais no argv: o embrulho da [RN-807](#rn-807) o lê, faz `unset` e `set --`, e o roda por `(eval "$c")` em subshell (mesmo grupo, mesmo PID gravado, `exit` e `set -e` contidos, exit code preservado). O argv do container fica só `/bin/sh -c <embrulho> brabo-exec <marcador>`. Medido no uso real: os 36 comandos do QA de automação com `pkill -f` morriam com 143, porque o padrão casava o argv do próprio `sh`. Fora, declarado: o runner no host (`apps/runner/src/exec.ts`), que a [RN-507](runner.md#rn-507) já condiciona a container `running`.
- **Onde:** `packages/docker-port/src/docker-cli.ts:299` (`EMBRULHO_DO_EXEC`).
- **Teste:** `packages/docker-port/src/docker-cli.spec.ts` ("o comando que estoura volta timedOut e MORRE dentro do container", contra Docker real: auto-`pkill -f` sobrevive, `exit 3` volta 3, o comando não aparece no `ps`).
- **Origem:** AT-622 (EP-030).
