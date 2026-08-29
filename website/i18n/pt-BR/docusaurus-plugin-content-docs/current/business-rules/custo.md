---
id: custo
title: 'Regras de negócio — Custo'
sidebar_label: Custo e metering
description: 'As RNs de orçamento, metering, relatório de gasto e teto de custo — extraídas do business-rules.md por tamanho.'
keywords: [regras de negócio, custo, orçamento, metering, token]
---

# Custo

> Estas RNs saíram de [`business-rules.md`](../business-rules.md) sem
> mudar uma vírgula do conteúdo: a página única passava de 640 KB e
> estas duas seções sozinhas eram metade dela. As âncoras `#rn-NNN`
> continuam idênticas — só o arquivo que as hospeda mudou.

### RN-017 — Orçamento tem escopo exclusivo: projeto **ou** sessão {#rn-017}

Um `budget` referencia um projeto ou uma sessão, nunca os dois — garantido por
`check` no banco, não só em código.

- **Onde:** `apps/api/src/db/schema.ts` (`budgets_scope_check`)
- **Teste:** a constraint é a garantia

### RN-018 — Notificação de orçamento em 70%, 90% e 100%, sem repetir {#rn-018}

Cada limiar dispara **uma vez**; o último notificado fica persistido em
`budgets.last_threshold_notified`.

- **Onde:** `apps/api/src/domain/llm/budget-threshold.ts:1`
- **Teste:** `test/domain/llm/budget-threshold.spec.ts`

### RN-019 — `policy = 'block'` recusa a chamada; `'allow'` só registra {#rn-019}

- **Onde:** `apps/api/src/domain/llm/budget-threshold.ts:4`
- **Borda:** projeto em `allow` **não para sozinho** no teto. É a causa mais
  comum de "o orçamento não segurou" — ver o [runbook](../runbook.md).

### RN-020 — O modelo é resolvido em cascata, do mais específico ao mais geral {#rn-020}

`sessão > agente > área > projeto > workspace`. O primeiro que existir vence.
`área` entrou na FASE 23 — ver [RN-102](#rn-102) para a posição dela e o que
muda em quem já lia esta cascata.

- **Onde:** `apps/api/src/domain/llm/binding-resolver.ts`
- **Teste:** `test/domain/llm/binding-resolver.spec.ts`

### RN-040 — Binding de agente exige tool calling nativo {#rn-040}

Vincular um modelo a um **agente** (`scope = 'agent'`) só é permitido se o
modelo tiver `supports_tool_calling`. Um agente só existe dentro do ToolLoop, e
o ToolLoop só funciona se o modelo souber **pedir** ferramentas; sem isso a
falha apareceria lá na frente como "o agente parou sem concluir", que é
exatamente o diagnóstico por eliminação que o [ADR 0020](../adr/0020-destravar-gates-qa-secops.md)
proibiu. A recusa é 422 e a mensagem aponta o filtro **"aptos para agentes"** —
sem esse ponteiro a regra vira beco sem saída.

O `ToolCallRecovery` do engine recupera chamadas que o modelo escreveu em prosa,
mas é **resgate, não licença**: depende de o modelo acertar o formato por acaso.

Só `agent` valida. `workspace` e `project` são o fallback do chat humano e
`session` é conversa — nenhum roda ToolLoop, e travá-los proibiria modelo
chat-only no produto. O agente `context-manager` é coberto por construção: é um
slug **dentro** do escopo `agent`, não um escopo próprio.

- **Onde:** `apps/api/src/domain/llm/model-capabilities.ts:38`
- **Teste:** `test/domain/llm/model-capabilities.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`
- **Origem:** [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)

### RN-041 — Contagem de token que o provider não deu é marcada como estimada {#rn-041}

Quando a resposta do provider não traz `usage`, a base OpenAI-compatível conta
localmente com o tokenizer e emite o chunk com `estimated: true`. O número
continua servindo para cobrar, mas a marca preserva a diferença entre **"o
provider disse zero"** e **"o provider não disse nada"** — e é ela que permite
à UI qualificar o custo em vez de exibir um valor sem procedência.

Os outros dois providers divergem, e a divergência é normalizada, não escondida:
o Ollama simplesmente não emite `usage` sem a linha `done`; o Anthropic não sabe
omitir contagem, porque `usage` é obrigatório no `message_start` do protocolo
dele. As três respostas estão em
[docs/reference/llm-providers.md](../reference/llm-providers.md#normalized-divergences).

- **Onde:** `apps/api/src/infrastructure/llm/openai-compatible-provider.ts:150`
- **Teste:** `test/contract/llm-provider.contract.ts` (cenário `sem_usage`,
  rodado contra os três providers)
- **Origem:** [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)

### RN-042 — O metering registra quem SERVIU a chamada, não só por onde ela entrou {#rn-042}

Quando a chamada passa por um hub que informa o provedor real, `token_usage`
grava esse provedor em `upstream_provider` além do provider de entrada. Sem hub
— ou com hub que não informou — o campo fica **`null`**, nunca string vazia: a
consulta de custo por provedor precisa distinguir "não passou por hub" de
"passou e o hub não disse".

Nas métricas o rótulo `upstream_provider` repete o próprio provider quando não
há hub, para que `sum by (upstream_provider)` continue somando o custo inteiro.

- **Onde:** `apps/api/src/application/use-cases/llm/record-llm-usage.use-case.ts:58`
- **Teste:** `test/application/use-cases/llm/record-llm-usage.use-case.spec.ts`
- **Origem:** [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)

### RN-043 — Modelo descoberto entra desligado; modelo que some é marcado, nunca apagado {#rn-043}

O sync de catálogo tem três desfechos, e nenhum deles é destrutivo:

1. **Modelo novo** entra **sem linha de curadoria em workspace nenhum**, e
   ausência de linha É o desligado. Um catálogo de provider tem centenas de
   linhas — despejá-las ativas tornaria a escolha impossível e ligaria modelo
   caro sem ninguém decidir. Ativar é curadoria do owner, e vale só no
   workspace dele ([RN-052](#rn-052)).
2. **Modelo que sumiu do catálogo remoto** recebe `availability = 'unavailable'`
   e **permanece na tabela**: `model_bindings` e `token_usage` apontam para a
   linha, e apagá-la levaria junto o histórico de custo.
3. **Modelo que voltou** volta a `available` com a curadoria **intocada** — a
   escolha do owner sobrevive a uma ausência temporária do provider.

Os dois eixos são independentes de propósito: a curadoria é decisão de pessoa,
`availability` é observação do provider. Nenhum dos dois escreve no outro — e
desde o [ADR 0049](../adr/0049-curadoria-de-modelo-por-workspace.md) eles nem
moram na mesma tabela, então o sync não tem campo de curadoria para atropelar
nem se quisesse.

Três consequências no resto do sistema:

- **binding NOVO** para modelo inativo ou indisponível é recusado no domínio
  (`ModelNotBindableError`, 422). Os bindings que já existem ficam de pé;
- **a cascata** de `resolveBinding` pula o candidato indisponível, registra o
  que pulou em `skipped`, e — quando o turno carrega ferramentas — revalida
  `supports_tool_calling` em TODO nível. Sem isso o fallback pousaria um agente
  num modelo chat-only e violaria a [RN-040](#rn-040) em silêncio;
- **provider que falhou não indisponibiliza nada**: um 401 é "não sei o que tem
  lá", não "não tem nada lá". O provider é pulado, com a ORIGEM da falha
  (`infra` | `modelo`) no relatório — nunca diagnóstico por eliminação.

- **Onde:** `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts:160`,
  `apps/api/src/domain/llm/binding-resolver.ts:63`,
  `apps/api/src/domain/llm/model-capabilities.ts:49`
- **Teste:** `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`,
  `test/domain/llm/binding-resolver.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`
- **Origem:** [ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)

### RN-044 — Preço vale daqui em diante, e o custo antigo continua batendo {#rn-044}

Cada linha de `token_usage` grava o preço que produziu o `cost_micros` dela.
Trocar o preço de um modelo **não reprecifica consumo passado** — e mais que
isso: o custo antigo continua **reproduzível**, porque `tokens × preço gravado`
fecha com o custo gravado mesmo depois de três correções na tabela `models`.

Toda mudança de preço grava uma linha em `model_price_changes`, append-only,
com o par antes/depois e a origem (`manual` | `sync`). O par é gravado junto de
propósito: reconstruir o "antes" a partir da linha anterior dependeria de
nenhuma escrita ter escapado do caminho auditado, que é o que a auditoria
existe para provar. Preço igual ao vigente é no-op — uma linha "mudou de 10
para 10" transformaria o log em ruído.

A regra vale para **todo** caminho que troca preço, não só o da tela. Duas
escritas escapavam dela: o sync de catálogo (que trocava preço pelo `upsert`,
sem nunca produzir a origem `sync` que o domínio declarava desde a Fase 9c) e o
`seed.ts` (que roda sobre banco já semeado — `BRABO_FORCE_SEED=1` no
`bootstrap.sh` do k8s — e portanto corrigia preço em silêncio). Os dois passaram
a auditar, o seed reusando o próprio `UpdateModelPricingUseCase`.

- **Onde:** `apps/api/src/application/use-cases/llm/update-model-pricing.use-case.ts:44`,
  `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts:213`,
  `apps/api/src/db/seed.ts:376`
- **Teste:** `test/application/use-cases/llm/update-model-pricing.use-case.spec.ts`,
  `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`
- **Origem:** [ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)

### RN-189 — Embedding devolve um vetor por entrada, ou erro {#rn-189}

`embed` é operação de LOTE: recebe N textos e devolve N vetores, **na mesma
ordem**. A ordem é o único vínculo entre entrada e vetor, e por isso uma
resposta mais curta não é aproveitável — o i-ésimo vetor passaria a ser de
outra frase, e o índice ficaria errado em silêncio, com o sintoma aparecendo na
BUSCA, semanas depois e longe da causa.

Então o contrato recusa, em vez de degradar, três coisas: lote incompleto,
vetor vazio e dimensões diferentes na mesma resposta. Lista de entradas vazia
também é recusada antes de sair pela rede — responder `[]` a ela faria quem
chama gravar um índice vazio achando que indexou.

O resultado carrega quatro campos, e cada um responde a uma pergunta que já
custou caro em outro lugar do produto: `dimensions` é conferido contra o que
VEIO (nunca copiado do catálogo); `model` é o que o provider **disse** ter
usado, porque um alias resolve para uma versão datada e é esse nome que vai ao
metering, pelo mesmo motivo do preço congelado ([RN-044](#rn-044)); e
`inputTokens` vem com `estimated`, preservando a distinção "o provider disse
zero" × "o provider não disse nada" da [RN-041](#rn-041).

O erro **lança** normalizado por `code`, em vez de virar chunk como no `chat`.
A razão do chunk é preservar o gasto de um turno em andamento; aqui não há nada
a preservar — ou o provider devolveu os vetores e cobrou, ou não devolveu e não
cobrou. É a mesma escolha de `listModels`, e a taxonomia é a mesma: nenhum
`LLMErrorCode` novo.

- **Onde:** `apps/api/src/application/ports/llm-provider.port.ts:61`,
  `apps/api/src/infrastructure/llm/embedding-result.ts:26`
- **Teste:** `test/contract/llm-provider.contract.ts` (cinco casos, rodados
  contra todo provider que declara a capability)
- **Origem:** [ADR 0075](../adr/0075-embeddings-no-contrato-de-llm-provider.md)

### RN-190 — Embedding tem capability em duas camadas, e a de modelo é exclusão {#rn-190}

Como em tool calling ([RN-040](#rn-040)), a capability tem duas camadas: o
PROVIDER (`capabilities.embeddings`, o teto) e o MODELO
(`supportsEmbeddings` na linha de catálogo). A diferença entre os dois casos é
o que a regra existe para dizer:

- **tool calling é gradiente** — um modelo que não pede ferramentas ainda
  conversa, e por isso só o binding de agente é recusado;
- **embedding é exclusão** — `nomic-embed-text` não responde uma pergunta e
  `llama3.2` não devolve vetor. São conjuntos disjuntos, e o daemon do Ollama
  prova isso respondendo **`501`** ("This server does not support embeddings")
  a um pedido de embedding com modelo de chat.

`assertCanEmbed` confere as duas na ordem em que falham melhor: o provider
primeiro, porque trocar de modelo não resolve provider que não embeda. Modelo
**sem declaração** também é recusado, com mensagem diferente — ausência é "o
provider não disse" ([ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)),
nunca permissão, e a ação de quem lê é sincronizar o catálogo em vez de trocar
de modelo. Deduzir a capability do NOME do modelo é proibido: seria palpite
vestido de dado.

- **Onde:** `apps/api/src/domain/llm/embedding-capability.ts:64`,
  `apps/api/src/infrastructure/llm/ollama-provider.ts:319`
- **Teste:** `test/domain/llm/embedding-capability.spec.ts`,
  `test/infrastructure/llm/ollama-provider.spec.ts`
- **Origem:** [ADR 0075](../adr/0075-embeddings-no-contrato-de-llm-provider.md)

### RN-191 — `embeddings: true` exige execução, não documentação {#rn-191}

A regra da casa ([ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)/[ADR 0043](../adr/0043-seis-providers-de-llm-e-o-fechamento-da-fase-9b.md))
aplicada à capability nova: **só o `ollama` declara `true`**, e a prova é o
`POST /api/embed` rodado contra o daemon 0.32.1 com `nomic-embed-text` — duas
entradas, dois vetores de 768, `prompt_eval_count: 10`.

Os outros oito declaram `false`, por dois motivos distintos:

- **falta de prova** (sete): não há chave deles no ambiente, e o único smoke
  pago que já rodou ([aceite](../explanation/aceite-providers.md)) foi de CHAT —
  num hub, embedding roteia para provedores diferentes dos de chat, e a prova
  de um endpoint não é a do outro;
- **ausência da operação** (Anthropic): não há endpoint de embedding próprio, e
  a doc dela aponta para um terceiro, que é outro provider com outra chave e
  outro dialeto.

O DIALETO da base OpenAI-compatível é provado à parte, com a suite de contrato
rodando uma segunda vez sobre ela com a capability ligada. É isso que torna
barato virar um provider para `true` no dia em que a chave existir: muda uma
linha do literal, e o parsing já está exercitado. Provider que declara `false`
e ainda assim expõe o método **recusa a chamada** antes de tocar a rede.

- **Onde:** `apps/api/src/infrastructure/llm/ollama-provider.ts:73`,
  `apps/api/src/infrastructure/llm/openai-compatible-provider.ts:302`
- **Teste:** `test/contract/llm-provider.contract.ts`,
  `test/infrastructure/llm/openai-compatible-provider.contract.spec.ts`,
  `test/infrastructure/llm/ollama-provider.embeddings.smoke.spec.ts` (manual,
  contra o daemon real)
- **Origem:** [ADR 0075](../adr/0075-embeddings-no-contrato-de-llm-provider.md)

### RN-045 — Repositório adotado só é alterado por plano aprovado {#rn-045}

Adotar um repositório existente **diagnostica sem agir**. A adoção valida o
acesso (`getRepo`), grava as linhas do projeto e produz um **plano**: a lista
serializada do que o bootstrap faria, obtida chamando o `check()` de cada passo
— o mesmo que dá idempotência desde a [RN-029](../business-rules.md#rn-029) — sem nunca executar a
mutação correspondente.

Enquanto `repo_bootstraps.plan_decision` for **nulo**, nenhuma mutação roda. O
portão está **antes** do executor, não dentro dele: o runner do bootstrap é o
mesmo da Fase 2, sem filtro, e simplesmente não é chamado. Somado ao guard que
já pulava branch protegida, não existe caminho de código que proteja uma branch
fora de um plano aprovado.

As duas saídas:

- **aprovar** é tudo-ou-nada (aprovar passos soltos quebraria a cascata
  `dev←main, qa←dev`). O que executa é o plano **re-derivado** no
  momento da execução: igual ou menor que o exibido, **nunca maior** — uma
  branch que tenha virado protegida nesse meio-tempo é pulada;
- **adotar como está** dispensa o bootstrap, registra a decisão e **não
  adultera o cursor** para fingir convergência. O plano fica guardado como
  evidência do que deliberadamente não foi aplicado.

Decidir sobre um plano regerado é recusado (409): a decisão carrega o
`planGeneratedAt` que o usuário viu, e um "sim" dado sobre outra coisa não vale.

O provisionamento normal recusa (409) rodar num repositório adotado — sem essa
guarda, o caminho de retomada rodaria o bootstrap num repositório de terceiro
sem plano nenhum.

**Limite conhecido:** "proteção divergente" aqui é presença × ausência, porque
é só isso que o contrato expõe (`GitBranch.protected` é booleano, e o
[ADR 0028](../adr/0028-protecao-de-branch-divergencia-entre-providers.md) adiou um
`ProtectionPolicy` normalizado). Uma branch com proteção PARCIAL conta como
"sem proteção" e pode ser sobrescrita — mas só dentro de um plano aprovado.

- **Onde:** `apps/api/src/application/use-cases/git/decide-bootstrap-plan.use-case.ts`,
  `apps/api/src/application/use-cases/git/bootstrap-plan.ts`,
  `apps/api/src/application/use-cases/git/bootstrap-steps.ts:112`
- **Teste:** `test/application/use-cases/git/decide-bootstrap-plan.use-case.spec.ts`,
  `test/application/use-cases/git/bootstrap-plan.spec.ts`
- **Origem:** [ADR 0044](../adr/0044-adocao-de-repositorio-existente.md)

### RN-046 — Todo repositório de projeto declara sua origem {#rn-046}

`project_repositories.origin` e `repo_bootstraps.origin` dizem se o Brabo
**criou** o repositório (`created`) ou **adotou** um que já existia (`adopted`).
A origem é gravada explicitamente por quem escreve — não pelo default da coluna
— e não muda depois.

Ela não é decoração: é o que faz o produto tratar como caso legítimo o que a
Fase 10 precisou fazer à mão (inserir linhas em `project_repositories` e
`repo_bootstraps` para apontar um projeto a um fork). Um repositório `adopted`
tem política de branches própria, não passa pelo provisionamento, e só é
alterado conforme a [RN-045](#rn-045).

O backfill da migração `0031` marca tudo que existia como `created`, e pode ser
cego: adoção não existia antes dela, então não há linha adotada para
classificar errado.

- **Onde:** `apps/api/src/db/schema.ts`, `apps/api/src/db/migrations/0031_special_winter_soldier.sql`,
  `apps/api/src/domain/git/repo-bootstrap.entity.ts`
- **Teste:** `test/application/use-cases/git/adopt-repository.use-case.spec.ts`
- **Origem:** [ADR 0044](../adr/0044-adocao-de-repositorio-existente.md)

### RN-047 — Circuit breaker do dev agent: N blocked seguidas param, sem gastar orçamento em loop {#rn-047}

Cada dev agent mantém um contador (`dev_agent_states.consecutive_blocked`)
de quantas tasks TERMINARAM `blocked` em sequência — local (no ToolLoop) ou
remotamente (teto de correções do gate estourado). Ao bater o teto por
projeto (`max_consecutive_blocked`, default 3), o agente para em
`idle_tripped` **sem tentar reivindicar a próxima task**. Um desfecho
terminal aprovado zera o contador; uma task blocked individual continua o
fluxo normal (devolvida com diagnóstico, disponível pra um humano
desbloquear) — o breaker é sobre a SEQUÊNCIA, não sobre a task.

A única saída de `idle_tripped` é o rearm explícito
(`POST .../agents/:agentId/rearm`, role `developer`): zera o contador e o
agente volta a tentar reivindicar. Não existe destrave automático — o
mesmo princípio de `MarkTaskBlockedUseCase`/`unblock`, aplicado à
sequência em vez de à task. Rearmar um agente que **não** está travado é
**409**, não sucesso silencioso: o evento `dev.rearmed` é imutável, e
gravá-lo para um rearm que não aconteceu seria mentira no event log.

Um bloqueio que vem de FORA do agente (o `QaLeadServer` falhando
internamente, por exemplo) também precisa acordá-lo — por isso a emissão
de `task.gate_resolved` fica em `MarkTaskBlockedUseCase`, o funil por
onde TODOS os bloqueios passam, e não no `RecordGateVerdictUseCase`, que
só vê parte deles. Sem isso o agente ficava em `awaiting_gate` para
sempre, com a task morta e o contador do breaker sem incrementar.

Reiniciar o engine com um agente em `working` **não** conta pro contador:
a task retida é bloqueada com diagnóstico do restart, mas esse bloqueio
não é o agente "queimando o teto" — é a infraestrutura caindo. O
contador só sobe quando o próprio ciclo dev↔gate produz um `blocked` de
verdade.

- **Onde:** `apps/engine/lib/engine/dev/dev_agent_server.ex` (`finish_task/2`,
  `resume_state/2`), `apps/api/src/application/use-cases/execution/rearm-dev-agent.use-case.ts`,
  `apps/api/src/db/schema.ts` (`projects.max_consecutive_blocked`)
- **Teste:** `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  (describe `circuit breaker`), `apps/engine/test/engine/dev/dev_rehydrator_test.exs`
  (describe `os quatro estados reidratados`), `test/application/use-cases/execution/rearm-dev-agent.use-case.spec.ts`
- **Origem:** [ADR 0045](../adr/0045-reagendamento-por-evento-do-dev-agent.md)

### RN-053 — Reativar a execução acorda quem está parado, dentro da sessão que já existe {#rn-053}

Ativar a execução de um projeto que **já está executando** é reativação, não
começo: cai na sessão de execução vigente e acorda os agentes que estavam
parados. Duas partes, uma de cada lado do sistema.

**A sessão é reusada.** A ativação usa a sessão `active` do projeto que já
carrega um `execution.activated`; só cria uma quando não há nenhuma. Não existe
coluna dizendo "esta sessão é de execução" — o que distingue uma é o evento que
ela guarda, e é por ele que se pergunta. Fechar a sessão continua sendo o jeito
de recomeçar do zero: a fechada não é candidata, e a próxima ativação abre uma
nova.

Antes o `create` era incondicional, e o engine **descarta** o `session_id` novo
quando o agente já está vivo. Cada clique em "ativar" deixava para trás uma
sessão ativa que recebia o `execution.activated` e mais nada — os eventos dos
agentes continuavam indo para a sessão da ativação anterior.

**O agente é acordado por wake, não por `work`.** Start fresco dispara o ciclo
(`:work` — emite `dev.started` e reivindica). Agente que já estava vivo recebe
`{:wake, :became_claimable}`, e quem decide é o guard de estado do server:

| estado do agente | o que a reativação faz |
|---|---|
| `idle` | reivindica a próxima task |
| `working`, `awaiting_gate`, `awaiting_approval` | nada — a task em curso não é abandonada |
| `idle_tripped` | nada — só o rearm explícito destrava ([RN-047](#rn-047)) |

Disparar `:work` para todos seria pior que o defeito: ele reivindica
incondicionalmente, e sobre um agente `awaiting_gate` significaria largar o
worktree que o gate está varrendo — além de contornar o circuit breaker com um
clique.

- **Onde:** `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts`,
  `apps/api/src/infrastructure/persistence/drizzle/session.repository.ts`
  (`findActiveExecutionSession`),
  `apps/engine/lib/engine_web/controllers/execution_command_controller.ex`
  (`acordar/4`)
- **Teste:** `test/application/use-cases/execution/activate-execution.use-case.spec.ts`
  (describe `reativação não abre sessão órfã`),
  `test/infrastructure/persistence/session-execution.repository.spec.ts`,
  `apps/engine/test/engine_web/controllers/execution_command_controller_test.exs`
  (describe `reativação`)
- **Origem:** achado #11 do
  [primeiro dogfooding](../explanation/primeiro-dogfooding.md)

### RN-048 — Promoção de história é do usuário por default; o modo muda quem dispara, nunca o que é validado {#rn-048}

`projects.story_promotion` escolhe QUEM promove uma história de `draft` para
`ready`:

- **`manual`** (default de projeto novo): o PO deixa a história completa e ela
  fica `draft` com `stories.proposed_ready = true`. **Nenhuma tarefa dela é
  pegável** — `claimNext` exige `story.status = 'ready'` —, e é o usuário que
  promove, individualmente ou em lote, pelo Backlog.
- **`auto`**: o PO promove sozinho ao terminar uma história completa. É o
  comportamento anterior à Fase 12c, preservado como opção explícita.

**O modo muda o gatilho, não o critério.** Os dois caminhos passam por
`assertPromotable` — prontidão (RF/DoD/DoR/regra) e módulos resolvidos contra o
`module_map` vigente —, e é isso que o teste de simetria em
`story-promotion.spec.ts` fixa: para toda história, `isPromotable` concorda com
o que `assertPromotable` levanta. Antes da fase a validação estava duplicada e
assimétrica (a criação chamava `canBecomeReady`, a transição chamava
`assertReady` + `assertModulesResolved`): duas portas para o mesmo estado, com
fechaduras diferentes. Tornar o gatilho configurável exigia unificá-las
primeiro, senão "promover pela UI" e "promover na criação" seriam regras
distintas com o mesmo nome.

Uma história **incompleta nunca é proposta**. `proposed_ready` só liga quando a
história já passaria na validação — propor o que o domínio recusaria empurraria
o trabalho do PO para o usuário sob o disfarce de uma decisão.

A **recusa** devolve a história ao PO: grava `returned_reason`/`returned_at`,
desliga `proposed_ready`, emite `backlog.story_promotion_returned` e injeta o
motivo como mensagem FIXADA na sessão do PO, com a mesma frase de precedência
da devolução de um gate ao dev (lição do ADR 0020). A recusa é gravada **antes**
de falar com o engine, e o engine falhando não a desfaz — é o inverso da ordem
do rearm da [RN-047](#rn-047), e por um motivo: lá o evento afirma algo SOBRE o
engine, aqui afirma algo sobre o usuário, que é verdade tenha ou não um PO de pé
para ouvir.

Promover **em lote não é all-or-nothing**: cada história é sua própria
transação, e uma que perdeu a prontidão entre a proposta e a decisão volta em
`failed` com o motivo, sem derrubar as outras que o usuário acabou de revisar.

O evento `backlog.story_transitioned` grava o **ator real** — `user` na promoção
manual, `agent/po` na automática. O event log é imutável e é o que a auditoria
lê: registrar o PO numa decisão do usuário apagaria exatamente o passo humano
que a regra existe para devolver.

A migração `0033` faz um backfill **dirigido**, não cego: a coluna nasce
`manual` e todos os projetos que já existiam são movidos para `auto`. O default
novo vale para quem vier depois; um projeto em andamento não pode parar de
produzir por causa de um deploy.

- **Onde:** `apps/api/src/domain/backlog/story-promotion.ts`,
  `apps/api/src/db/migrations/0033_absurd_domino.sql`,
  `apps/api/src/application/use-cases/backlog/promote-stories.use-case.ts`,
  `apps/api/src/application/use-cases/backlog/return-story.use-case.ts`,
  `apps/engine/lib/engine/agents/po_server.ex` (`revision_message/1`)
- **Teste:** `test/domain/backlog/story-promotion.spec.ts` (simetria),
  `test/db/story-promotion-migration.spec.ts` (backfill dirigido),
  `test/application/use-cases/backlog/promote-stories.use-case.spec.ts`,
  `test/application/use-cases/backlog/return-story.use-case.spec.ts`,
  `apps/engine/test/engine/agents/po_server_test.exs` (describe `revise/2`)
- **Origem:** [ADR 0046](../adr/0046-promocao-de-story-com-autoridade-do-usuario.md)

### RN-049 — Toda decisão sobre uma ação proposta fica no event log, com quem decidiu {#rn-049}

`proposed_action.created`, `.approved` e `.denied` são eventos de domínio em
`session_events`, além das linhas de outbox que os transportam ao engine. O
outbox **não** é memória: é drenado, marcado com `processed_at` e podado.

O `actor` é quem realmente decidiu — o **usuário** em `.approved`/`.denied`, o
**agente** que propôs em `.created`. E `created.payload.status` diz como a ação
nasceu (`pending`, `auto_approved`, `denied`).

Disso sai a distinção que dá a métrica: **decisão humana = evento
`proposed_action.approved`**; política decidindo sozinha aparece só no
`.created` com `status: auto_approved` e ator agente, e nunca é confundida com
um clique. Era exatamente essa contagem — "cliques de aprovação" — que a Fase
10 quis medir e não conseguiu, porque a decisão não existia em lugar nenhum
consultável (achado #17). `approve_always` conta como aprovação porque delega
ao mesmo use-case, e emite `permission.granted` por cima.

Fica de fora, por decisão: o `proposed_action.created` que o bootstrap de
repositório emite direto no outbox. Aquelas mutações já são narradas por
`bootstrap.step_*` na mesma sessão, e duplicá-las contaria o mesmo fato duas
vezes numa métrica de aprovação.

- **Onde:** `apps/api/src/application/use-cases/actions/propose-action.use-case.ts`,
  `.../approve-action.use-case.ts`, `.../deny-action.use-case.ts`
- **Teste:** `test/application/use-cases/actions/approve-deny-action.use-case.spec.ts`
  (describe `a decisão no event log`)
- **Origem:** [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md)

### RN-050 — Sem PR aberta não se abre gate {#rn-050}

O dev agent propõe commit, push e PR e **lê o desfecho de cada uma**. Só abre o
gate se as três executaram. Se alguma ficou `pending` — autonomia do agente em
`require_approval` —, ele entra em `awaiting_approval`, **retendo o worktree**,
e não abre gate nenhum.

Sem isso o gate abria de qualquer jeito, e o estrago era silencioso: o QA varre
o **worktree**, não a PR; encontrava os arquivos, aprovava; o SecOps aprovava; a
task fechava como concluída — **sem uma linha commitada e sem PR nenhuma**. Só
depois, ao aprovar o commit, o usuário via a ação falhar (com diagnóstico
vazio, porque `System.cmd` num diretório apagado devolve `{"", 2}`).

Quem solta o agente é `task.pr_settled`, emitido pela api quando o `pr_open`
tem desfecho terminal: `opened: true` abre o gate; `opened: false` (negado ou
falho) devolve a task com diagnóstico, em vez de deixar o agente esperando para
sempre por um gate que ninguém vai abrir.

Uma PR negada **não conta para o circuit breaker** da [RN-047](#rn-047): a
decisão foi do usuário, não o agente queimando o teto — mesmo princípio da
recuperação de restart.

Esta regra também elimina o D5 (worktree reciclado sob aprovação pendente) por
consequência: o worktree só é liberado em `gate_resolved`, o gate só abre depois
da PR, e a PR só abre depois de commit e push.

- **Onde:** `apps/engine/lib/engine/dev/agent_io.ex` (`propose/3`),
  `apps/engine/lib/engine/dev/dev_agent_server.ex` (`abrir_gate/1`,
  `aguardar_aprovacao/2`),
  `apps/api/src/application/use-cases/actions/execute-git-action.use-case.ts`
  (`settlePrOpen`)
- **Teste:** `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  (describe `aprovação pendente não abre gate`)
- **Origem:** [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md)

### RN-051 — Preço digitado à mão vence o catálogo do provider {#rn-051}

Linha de `models` com `manual_pricing = true` tem um número que alguém digitou
lendo a doc do provider. O sync de catálogo **não encosta nele** — nem quando o
catálogo remoto traz preço próprio. É o que o schema sempre disse ("quem
sincroniza preço NÃO pode sobrescrever uma linha marcada aqui sem decisão
explícita") e o que o código não fazia: o remoto vencia sempre que trouxesse
preço, e o sync seguinte desfazia a correção de quem tinha arrumado um número
errado.

A regra existe porque para vários providers o número digitado é o **único que
existe**: NVIDIA NIM e Bitdeer não publicam preço por token em doc alguma
([referência de providers](../reference/llm-providers.md)), e o valor semeado é
aproximação de mercado. Deixar o catálogo remoto sobrescrever isso trocaria uma
aproximação conhecida por outra, sem ninguém decidir.

Modelo NOVO nasce com a marca vinda do catálogo, não de um default fixo:
descoberto **com** preço, `manual_pricing = false` (a origem é o sync, e é ele
quem mantém a linha em dia); descoberto **sem** preço, `true` — a linha está
esperando alguém digitar, e marcá-la já protege esse número do primeiro
catálogo que resolver informar preço.

- **Onde:** `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts`
  (`resolverPreco`), `apps/api/src/db/schema.ts:507`
- **Teste:** `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`
  (`preço digitado à mão vence o catálogo que INFORMA preço`)
- **Origem:** [ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)

### RN-052 — Curadoria de modelo vale só no workspace que decidiu {#rn-052}

Ligar ou desligar um modelo no seletor é decisão **daquele workspace**, e não
alcança o vizinho. O catálogo em si continua global — nome, preço, janela e
capabilities são fato do provider, iguais para todo mundo, e duplicá-los por
workspace criaria N verdades sobre o mesmo modelo além de partir
`token_usage.model_id` ao meio.

Antes disso `models.is_active` era uma coluna para a instalação inteira: quem
clicasse "ativar" decidia por todos os workspaces, e a tela não dava sinal
nenhum disso. O efeito prático era um workspace ligar um modelo caro no seletor
do outro — e o gasto aparecer no orçamento de quem não decidiu nada.

Três regras derivadas:

1. **Ausência de linha é o desligado.** Não existe estado "nunca decidido"
   separado; modelo que o sync descobriu não tem linha e não aparece no seletor
   ([RN-043](#rn-043)).
2. **Desligar é `UPDATE`, não `DELETE`.** Apagar a linha apagaria junto quem
   decidiu e quando. A leitura trata os dois casos como inativo; o registro
   existe para quem for auditar.
3. **Escopos `agent` e `session` não verificam curadoria.** Os dois não têm
   âncora de workspace — binding de agente é por slug global. A verificação
   recebe `null` e checa só a disponibilidade, deixando a lacuna explícita em
   vez de chutar um workspace.

- **Onde:** `apps/api/src/db/schema.ts` (`workspace_models`),
  `apps/api/src/application/use-cases/llm/set-models-active.use-case.ts`,
  `apps/api/src/application/use-cases/llm/set-model-binding.use-case.ts`
  (`workspaceDoEscopo`)
- **Teste:** `test/application/use-cases/llm/set-models-active.use-case.spec.ts`
  (`ativar num workspace NÃO liga o modelo no vizinho`)
- **Origem:** [ADR 0049](../adr/0049-curadoria-de-modelo-por-workspace.md)

### RN-061 — Falha de FERRAMENTA também é evento, e volta para o modelo {#rn-061}

O resultado de uma tool call nunca é descartado. Ele vira `tool.result` no
event log (`ok` e, quando falha, `erro`), o agente **diz** o que houve no fio, e
o motivo **volta ao modelo** no papel `tool` — para ele corrigir e reemitir no
turno seguinte. Erro de ferramenta é entrada do laço, não fim de linha.

O Criativo era o único que descartava (`_ = EmitArtifact.run(args, state)`) — o
PO e o Arquiteto já realimentavam. Numa execução real o modelo emitiu
`titulo`/`descricao` contra um schema que exige `title`/`description`/`origin`:
as **quatro regras de negócio da conversa foram recusadas**, nenhum evento foi
gravado, e ele seguiu dizendo "registrei as regras" com o painel vazio.

A descrição da ferramenta passou a NOMEAR os campos obrigatórios de cada tipo,
em inglês e com exemplo preenchido — inclusive que `business_rule.origin` é uma
**lista não-vazia** de `seq` das mensagens que originaram a regra, não texto
livre. Sem isso o modelo adivinha, e adivinha no idioma da conversa.

É a mesma regra da [RN-059](#rn-059) aplicada ao outro caminho de falha: duas
políticas para o mesmo problema seriam duas chances de engolir o erro.

- **Onde:** `apps/engine/lib/engine/agents/criativo_server.ex` (`dispatch_tool`,
  `realimentar`), `apps/engine/lib/engine/harness/tools/emit_artifact.ex`
  (`descricao/0`), `apps/engine/lib/engine/harness/artifact_schemas.ex`
  (`required/1`)
- **Teste:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  (`ferramenta recusada vira tool.result com erro, e o agente fala`)
- **Origem:** execução real da FASE 13b

### RN-065 — Um module_map por SESSÃO; revisão é outra sessão {#rn-065}

`create_module_map` recusa a segunda emissão **na mesma sessão**, com uma
mensagem que diz o próximo passo. Entre sessões o mapa continua versionando
(`version + 1`, `findCurrent` devolve o maior) — revisar arquitetura é
comportamento desejado.

A distinção é o ponto: entre sessões, uma emissão nova é **revisão**; dentro da
mesma, é o modelo **redecidindo do zero**. Numa execução real o Arquiteto
emitiu quatro mapas seguidos, com nomes e recortes diferentes a cada volta —
`greeting`, `hello_core`, `greeting`, `hello-api-core` — e o laço só terminou
porque a rede caiu (`%Req.TransportError{reason: :timeout}`).

A recusa volta ao modelo pelo tool-result ([RN-061](#rn-061)): ele lê que já
existe e segue para `assign_story_modules`, que é o passo 2 do kickoff dele. Por
isso **não** se encerra o turno ao emitir o mapa — o Arquiteto ainda tem três
passos pela frente (vincular histórias, propor ADR, registrar tensões), e
terminar ali mataria os três.

- **Onde:** `apps/api/src/application/use-cases/architecture/create-module-map.use-case.ts`
- **Teste:** `test/application/use-cases/architecture/create-module-map.use-case.spec.ts`
  (`recusa o SEGUNDO mapa da mesma sessão`; e o versionamento entre sessões
  continua provado ao lado)
- **Origem:** execução real da FASE 13b

### RN-066 — Toda resposta sobre módulos carrega os nomes canônicos {#rn-066}

O Arquiteto **não tem ferramenta para ler** o module_map vigente. Por isso as
três respostas que ele recebe sobre módulos precisam dizer os nomes:

1. `create_module_map` bem-sucedido devolve os módulos **como a api os gravou**
   — não só a versão.
2. `assign_story_modules` recusado lista os módulos **válidos**, além dos
   inexistentes.
3. `create_module_map` recusado por [RN-065](#rn-065) diz **quais** módulos a
   sessão já definiu, não quantos.

Sem mapa nenhum não há nomes a oferecer, e uma lista vazia lê-se como "chute de
novo": esse caminho nomeia o problema real — falta o passo 1 do kickoff.

O motivo é concreto. Numa execução real o Arquiteto emitiu o mapa
(`saudacao`, `api_http`), não conseguiu relê-lo, e partiu para força bruta: 18
chutes em sequência — `api`, `core`, `http`, `greeting`, `domain`, `web`,
`hello-api`, `hello`, `greeting-api`, `saudacao`, `app`, `server`, `publico`,
`public-api`, `api-publica` — até acertar **um por sorte**. Nas palavras dele no
event log: *"vou descobrir os nomes válidos testando candidatos plausíveis"*.

O estrago não foi o desperdício, foi o resultado: as **quatro** histórias
terminaram no mesmo módulo (`saudacao`), inclusive a do endpoint, `api_http`
ficou sem história nenhuma, e o desfecho afirmou *"Todas as 4 histórias foram
vinculadas com sucesso aos módulos"*. Como a execução sobe **um dev agent por
módulo**, a arquitetura desenhada não seria a construída.

O laço de [RN-065](#rn-065) era sintoma disto: o Arquiteto reemitia o mapa
justamente para tentar fixar nomes que não conseguia ler.

- **Onde:** `apps/api/src/application/use-cases/architecture/assign-story-modules.use-case.ts`,
  `apps/api/src/application/use-cases/architecture/create-module-map.use-case.ts`,
  `apps/engine/lib/engine/harness/tools/create_module_map.ex`
- **Teste:** `test/application/use-cases/architecture/assign-story-modules.use-case.spec.ts`
  (`a recusa lista os módulos VÁLIDOS`; `sem module_map, manda criar o mapa`) e
  `create-module-map.use-case.spec.ts` (`a recusa diz QUAIS são os módulos`)
- **Origem:** execução real da FASE 13b

### RN-067 — Toda sessão nasce emitindo `session.created` {#rn-067}

`CreateSessionUseCase` é o **único** lugar que cria sessão. Ele emite
`session.created` no outbox **na mesma transação** do insert, e é esse evento
que faz o engine subir o `SessionServer` da sessão.

Quem chamasse `sessions.create(...)` direto produzia uma sessão que o engine
nunca conhecia. O efeito é uma cascata silenciosa:

- o canal Phoenix responde `REFUSED JOIN` para sempre — a UI só reclama no
  console e segue tentando de 10 em 10 segundos;
- sem canal não há atualização ao vivo: o fio fica preso no indicador de
  digitação, mesmo com o agente já `idle`;
- ninguém bate heartbeat e, como é o heartbeat que encerra a sessão
  ([RN-064](#rn-064)), ela fica `active` **para sempre**.

Três caminhos faziam isso: `provision-repository` (duas chamadas),
`adopt-repository` e `activate-execution` — este último cria a sessão em que os
**dev agents** rodam.

A prova por contraste, de uma execução real: a sessão do wizard não tinha
`session.created`, tinha `engine.session_states` vazia e `REFUSED JOIN`; a
sessão aberta pela rota normal tinha o evento, a linha de estado e `JOINED`.

O teste é sobre a FONTE de propósito: um teste de comportamento provaria um
caminho de cada vez, e o defeito aqui é o caminho em que ninguém pensou.

- **Onde:** `apps/api/src/application/use-cases/sessions/create-session.use-case.ts`
  (o dono), `git/provision-repository.use-case.ts`,
  `git/adopt-repository.use-case.ts`,
  `execution/activate-execution.use-case.ts` (os chamadores)
- **Teste:** `test/application/use-cases/sessions/toda-sessao-emite-created.spec.ts`
  (`só o CreateSessionUseCase chama sessions.create`)
- **Origem:** execução real da FASE 13b

### RN-068 — O dev agent lê o worktree sem pedir licença {#rn-068}

Ativar a execução semeia no `allow` do projeto duas famílias de comando: as de
**leitura do próprio worktree** (`ls`, `pwd`, `find`, `cat`, `head`, `tail`,
`grep`, `wc`, `echo`, `git status`, `git diff`, `git log`) e as de **build e
teste**.

A segunda já existia: `ReportDone` só deixa abrir PR depois de um `terminal`
com `exit 0`. A primeira entrou porque o agente **olha antes de construir**, e
sem ela não conseguia começar.

O motivo é concreto. Ferramenta `:pipeline` pendente devolve
`proposed_action <id> status pending` como RESULTADO — não a saída do comando —
e o ToolLoop segue. Num repositório recém-provisionado, cada `ls -la` do agente
caía em aprovação, não ensinava nada e queimava uma iteração. Numa execução real
o desfecho foi `toolloop.limit_reached {iteration: 8, max_iterations: 8}`, task
bloqueada por "limite de iterações atingido", sem uma linha escrita — e as
aprovações concedidas pelo usuário chegaram depois do laço esgotado.

Liberar leitura não afrouxa o pipeline, e é isso que o teste afirma: `deny`
vence `allow`, os `BUILTIN_DENY_PATTERNS` seguem ativos, o casamento é por
prefixo de TOKEN (`ls` liberado não libera `lsof`) e comando composto exige que
CADA segmento case — `ls && rm -rf /` não passa por causa do `ls`.

A allowlist é mitigação, não solução: é lista de comandos previstos e o modelo
inventa comandos. A correção estrutural — o agente ESPERAR a decisão em vez de
queimar iterações — está no [ADR 0052](../adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md).

- **Onde:** `apps/api/src/domain/actions/dev-terminal-patterns.ts`,
  semeado por `application/use-cases/execution/activate-execution.use-case.ts`
- **Teste:** `test/domain/actions/dev-terminal-patterns.spec.ts`
  (`libera ls -la`; `comando composto não passa carona no segmento liberado`)
- **Origem:** execução real da FASE 13b

### RN-143 — Subcomando git de leitura só entra ancorado pela flag que torna a leitura inequívoca, nunca pelo verbo pelado {#rn-143}

Consultando o banco de uma execução real, dev agents gastaram dezenas de
aprovações manuais em subcomandos de exploração — `git branch -a`, `git
remote -v`, `git worktree list`, `git show origin/dev --stat`, `git log
--all --oneline --graph`, `git for-each-ref`, `git ls-tree -r origin/dev
--name-only`, `git config user.name` — nenhum coberto pela [RN-068](#rn-068),
que só liberava `git status`/`diff`/`log` (sem flags adicionais). Como o
casamento por prefixo de token exige que TODO segmento de um comando composto
esteja em `allow`, uma cadeia de exploração longa caía inteira em
`require_approval` assim que UM desses subcomandos aparecia no meio.

`DEV_TERMINAL_ALLOW_PATTERNS` ganhou `git branch -a/-r/-v/--list/--show-current`,
`git remote -v`/`git remote show`, `git worktree list`, `git show`, `git
for-each-ref`, `git ls-tree`, `git rev-parse` e `git config --get`. `git log`
não precisou de padrão novo: o casamento já é por PREFIXO de tokens (tokens
extras no final são permitidos), então `Terminal(git log)` já cobria `git log
--all --graph --oneline --decorate`.

**O cuidado é o mesmo que a RN-068 já demonstra para `ls`/`lsof`, aplicado a
verbos com irmão MUTANTE que aceita a mesma forma truncada do padrão.**
`Terminal(git branch)` bateria tanto em `git branch -D nome` (apaga) quanto em
`git branch nome-nova` (cria) quanto em `git branch` sozinho — o padrão não
enxerga o que vem DEPOIS do prefixo que ele checou. Por isso nenhum dos quatro
verbos com mutação (`branch`, `remote`, `worktree`, `config`) entrou pelo verbo
pelado; cada um foi ANCORADO pela flag que torna a leitura inequívoca
independente de qualquer coisa que venha depois dela:

- `git branch` — ancorado em `-a`/`-r`/`-v`/`--list`/`--show-current`, nunca
  no verbo sozinho; `-D`/`-d`/`-m`/`-M` (apagar/renomear) e um nome de branch
  solto (criar) continuam fora.
- `git remote` — ancorado em `-v` e `show` (que só aceita nome de remote
  depois, sempre leitura); `add`/`remove`/`set-url` continuam fora.
- `git worktree` — ancorado em `list`; `add`/`remove`/`prune` continuam fora.
- `git config` — só `--get` entrou, porque é a única flag que o próprio git
  garante ser leitura independente do que vier depois (chave, ou chave +
  padrão de valor). `git config user.name`/`git config user.email` SEM
  `--get` ficaram de fora de propósito: um segundo token depois da chave
  (`git config user.name "novo valor"`) é ESCRITA, e o casamento por prefixo
  não distingue "sem mais tokens" de "com mais um token" sem inventar um
  parser de contagem de argumentos novo — a mesma limitação que já
  impede um `git branch` pelado. `--global`/`--system` nunca foram ancorados.

- **Onde:** `apps/api/src/domain/actions/dev-terminal-patterns.ts`
- **Teste:** `test/domain/actions/dev-terminal-patterns.spec.ts` (describe
  `subcomandos git de leitura (achado ao vivo)` — cobre a cadeia composta
  observada ao vivo auto-aprovando, e cada variante mutante com a MESMA
  palavra de comando — `git branch -D`, `git remote add`, `git worktree add`,
  `git config --global user.name` — continuando em `require_approval`)
- **Origem:** consulta ao banco de uma sessão real, achado durante uso

### RN-069 — Retentar uma task recria a branch, não falha {#rn-069}

`WorktreeManager.add_worktree/3` usa `git worktree add -B` (cria **ou**
redefine), não `-b`. Ele já removia o diretório do worktree anterior, mas
deixava a branch para trás — e como o nome dela vem do slug da task, a segunda
tentativa da MESMA task caía sempre em
`fatal: a branch named 'feature/<slug>' already exists`.

O efeito era permanente: destravar a task não adiantava, reativar a execução não
adiantava, e o circuit breaker desarmava sem saída. Numa execução real só saiu
com `git worktree prune` manual no workspace do projeto.

Redefinir é o certo: o worktree anterior já foi removido, o trabalho daquela
tentativa não vale (a task voltou para a fila) e a branch renasce do ponto atual
do work_dir.

- **Onde:** `apps/engine/lib/engine/dev/worktree_manager.ex`
- **Teste:** `apps/engine/test/engine/dev/worktree_manager_test.exs`
  (`retentar a MESMA task recria o worktree em vez de falhar`)
- **Origem:** execução real da FASE 13b

### RN-070 — Todo gate declarado aponta para a evidência que o prova {#rn-070}

Nenhuma entrada de `docs/gates.yml` existe sem `evidencia`, e o registro não
pode afirmar mais do que verifica: gate `block` exige `verificacao: script`, e
gate `planned` não carrega evidência de algo que ainda não aconteceu.

A evidência é um **localizador**, não prosa: `event_log` traz os tipos de evento
e o filtro de payload que os distingue dos vizinhos; `teste` e `ci` trazem o
caminho, e alvo que sumiu REPROVA. É o mesmo modo de falha que o docmap chama de
glob morto — regra que nunca dispara e finge cobertura.

Três tipos porque nem todo gate mora no event log:
[`merge-protegida`](../business-rules.md#rn-014) é um teto em regra pura que não emite evento
próprio (o que o garante é teste) e `backmerge` é CI com estado em
`.release/gate.json`. Rebaixá-los a `warn` por isso mentiria sobre as travas
mais duras do produto.

O filtro importa tanto quanto o tipo: `qa-verificada` e `secops-segura` gravam o
MESMO `pr.gate_changed`, e o mesmo tipo sai na ABERTURA do gate sem `veredito` —
sem o filtro, abertura contaria como passagem. Vale igual para os dois gates de
PR de infra. Por isso nenhum par (`event_types` + `filtro`) pode se repetir.

O filtro só alcança o PAYLOAD, de propósito: aceitar coluna arbitrária abriria a
consulta inteira. Quem promoveu uma story (humano ou o PO) vive na coluna
`actor_kind` e fica fora do vocabulário declarativo.

- **Onde:** `apps/api/src/domain/gates/gate-registry.ts`, registro em
  `docs/gates.yml`, medição em `apps/api/scripts/validacao-gates.ts`
- **Teste:** `apps/api/test/domain/gates/gate-registry.spec.ts`
  (`é válido: nenhum problema acumulado`; `nenhum par (event_types + filtro) se
  repete entre gates`)
- **Origem:** FASE 15a (ADR 0054)

### RN-071 — Os quatro gates de autoridade do usuário não podem ser declarados automáticos {#rn-071}

`acao-aprovada`, `story-promovida`, `plano-de-adocao` e `merge-protegida` têm
`aprovacao_humana: true` por construção. A lista mora no DOMÍNIO
(`GATES_HUMANOS_IMUTAVEIS`), não no teste: mexer nela tem que ser ato
deliberado, revisado como código.

`aprovacao_humana: true` quer dizer que a decisão é do usuário — direta no
clique, ou delegada por política que ele mesmo escreveu no `permissions.json`. É
isso que deixa `acao-aprovada` conviver com `status: auto_approved`: a política
decidindo sozinha é o usuário decidindo antes. `merge-protegida` é o caso onde
nem a delegação existe — o teto rebaixa `auto_approve` para `require_approval`
mesmo com autonomia ligada.

O contrário também reprova: id na lista sem gate correspondente é regra morta,
apontando para o vazio.

- **Onde:** `apps/api/src/domain/gates/gate-registry.ts`
  (`GATES_HUMANOS_IMUTAVEIS`); o teto em
  `apps/api/src/domain/actions/decide.ts`
- **Teste:** `apps/api/test/domain/gates/gate-registry.spec.ts`
  (`%s não pode ter aprovacao_humana false`); o teto em
  `apps/api/test/domain/actions/decide.spec.ts`
- **Origem:** FASE 15a (ADR 0054)

### RN-072 — Sem escolha explícita, o modelo é o do Criativo {#rn-072}

Quando a cascata de binding pousa no default do **workspace** — isto é, ninguém
decidiu nada para este projeto —, o modelo herdado é o do **Criativo**, e não o
default global.

O Criativo é sempre a porta de entrada de um projeto: é com ele que a primeira
conversa acontece, e é o binding dele que representa "o modelo que este projeto
usa para pensar".

A herança ocupa o **vazio**, nunca sobrepõe: binding de sessão, de agente ou de
projeto são escolhas explícitas de alguém e continuam vencendo. É por isso que
ela é um passo DEPOIS da cascata e não um escopo novo dentro dela — não compete
por precedência. E o modelo herdado passa pelos mesmos filtros: sumido do
catálogo ou sem tool calling não é herdado, pelo mesmo motivo que a cascata os
pula ([RN-043](#rn-043)).

O que isso conserta: o default de workspace é global e costuma ser um modelo
local pequeno. Sessão nova e dev agent — que não têm binding próprio — nasciam
nele, e o [ADR 0020](../adr/0020-destravar-gates-qa-secops.md) proíbe modelo local
pequeno no passo semântico. Numa execução real foi preciso trocar o modelo à
mão em toda sessão aberta, e os três dev agents subiram em `llama3.2:1b` sem
ninguém pedir.

- **Onde:** `apps/api/src/domain/llm/binding-resolver.ts`
  (`herdarModeloDeStart`), aplicado em
  `application/use-cases/llm/resolve-model-binding.use-case.ts`
- **Teste:** `apps/api/test/domain/llm/binding-resolver.spec.ts`
  (`ocupa o vazio`; `NÃO sobrepõe escolha explícita de %s`)
- **Origem:** achados B e O da execução real (FASE 13c, fase A)

### RN-073 — Aprovação pendente SUSPENDE o laço, não o gasta {#rn-073}

Quando uma ferramenta de pipeline volta `pending`, o ToolLoop **para** e o dev
agent entra em `:awaiting_approval` retendo task, worktree e o histórico do
laço. A decisão do usuário emite `task.action_settled`, que o acorda: o
resultado de verdade ocupa o lugar onde estaria a palavra "pending", e o laço
retoma do ponto em que parou.

Duas propriedades que o teste fixa:

- **Nada é gravado enquanto se espera.** O lugar da mensagem de ferramenta fica
  vago. Gravar "pending" ali seria dizer ao modelo que o comando respondeu
  isso — que era exatamente o defeito.
- **Recusa é resposta.** O motivo entra no lugar do resultado e o agente aprende
  que aquele caminho fechou, em vez de esperar para sempre por algo que ninguém
  vai aprovar. É o mesmo princípio do `pr_settled` com `opened: false`
  ([RN-047](#rn-047)), um nível abaixo.
- **O wake precisa CHEGAR.** `task.action_settled` nasce no agregado `task`, e
  não no `proposed_action` que o nome da tabela sugere: o dreno do engine lê uma
  lista fechada de agregados (`session` e `task`). Emitido fora dela, o evento é
  gravado com sucesso, fica com `processed_at` nulo e nunca é sequer lido —
  nenhum job, nenhum erro, nenhum log, e o agente espera para sempre. O contrato
  atravessa duas linguagens e por isso é fixado dos dois lados.

Se o engine **reiniciar** durante a espera, a regra não vale mais para aquela
task: o laço suspenso só existe em memória, então ela volta para a fila
bloqueada com origem `infra`, e a decisão tomada depois não tem onde ser
aplicada. Bloquear com diagnóstico é deliberado — a alternativa era a espera
eterna silenciosa, que é o que esta regra existe para acabar.

O que isso conserta: `pending` voltava como RESULTADO da ferramenta e o laço
seguia. O modelo lia aquilo como resposta do comando, não aprendia nada, tentava
outra coisa — e cada tentativa queimava uma iteração até
`toolloop.limit_reached {iteration: 8, max_iterations: 8}`, com a task bloqueada
por "limite de iterações atingido" sem uma linha escrita. As aprovações
concedidas chegavam depois do laço esgotado e eram inúteis.

A allowlist de terminal ([RN-068](#rn-068)) continua valendo, mas deixa de ser a
única defesa: ela é lista de comandos previstos, e o modelo inventa comandos.

- **Onde:** `apps/engine/lib/engine/harness/hooks/action_pipeline.ex`,
  `harness/tool_loop.ex`, `dev/dev_agent_server.ex`,
  `workers/dev_agent_wake_worker.ex`; emissão em
  `apps/api/src/application/use-cases/actions/{approve,deny}-action.use-case.ts`
- **Teste:** `apps/engine/test/engine/dev/dev_agent_awaiting_approval_test.exs`
  (`ação pendente PARA o agente`; `aprovada: retoma o laço com a saída REAL`;
  `restart durante a espera BLOQUEIA a task`) e
  `apps/engine/test/engine/dev/wake_do_outbox_ao_agente_test.exs`, que percorre
  a corrente inteira — outbox, dreno, fila e processo — porque os testes por
  elo ficavam todos verdes com a entrega quebrada; o agregado é fixado do lado
  da api em
  `apps/api/test/application/use-cases/actions/approve-deny-action.use-case.spec.ts`
- **Origem:** [ADR 0052](../adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md),
  fase A da triagem

### RN-135 — Ativar execução fecha a sessão de CHAT que originou o pedido {#rn-135}

`ActivateExecutionUseCase` sempre resolvia a sessão de EXECUÇÃO
(`findActiveExecutionSession`, ou cria uma nova `criativa`), mas nunca
transicionava a sessão de CHAT de onde partiu o clique em "ativar
execução" — o Dev Lead/PO conversando numa sessão separada. Ela ficava
`active` para sempre, mesmo com a execução já correndo sozinha em outra
sessão, e continuava aparecendo como conversa em aberto na lista.

`execute()` ganhou `originSessionId`, opcional e por último — chamador
antigo (hoje só a ativação pela Visão Geral, sem contexto de sessão)
continua funcionando IDÊNTICO, sem fechar nada. Informado, ao FINAL do
método (depois de tudo o resto ter acontecido: module_map, áreas,
autonomia, `startExecution`, `execution.activated`):

- **nunca fecha a própria sessão de execução** — se `originSessionId` for
  igual à sessão que acabou de receber `execution.activated`, o fechamento
  é pulado, porque fechá-la destruiria o processo que os dev agents
  acabaram de ganhar;
- **só fecha o que está `active`** — mesma cautela de
  `decide-bootstrap-plan.use-case.ts#fecharSessao`, nada a fazer se a
  sessão já não existir ou já não estiver aberta;
- **reusa `GetSessionPendingWorkUseCase`** ([RN-073](#rn-073)) — a MESMA
  trava que segura o fechamento por heartbeat de inatividade: handoff
  `offered`, `proposed_action` pendente ou agente `working` sem `idle`
  posterior impedem o fechamento;
- passa por `closing` antes de `closed` — a máquina de estados
  (`active -> closing -> closed`) não permite o salto direto.

Falha ou pendência aqui NUNCA propaga para quem chamou `execute()`: a
ativação da execução já aconteceu e é o efeito principal; fechar o chat de
origem é um efeito colateral *best-effort*.

- **Onde:** `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts`
  (`closeOriginSession`), `apps/api/src/interfaces/http/execution/dto/activate-execution.dto.ts`
  (`originSessionId`), `apps/api/src/interfaces/http/execution/execution.controller.ts`
- **Teste:** `apps/api/test/application/use-cases/execution/activate-execution.use-case.spec.ts`,
  describe `fecha a sessão de origem (RN-135)` — fecha sem pendência,
  NÃO fecha com pendência, NÃO fecha sessão já não-`active`, chamador
  antigo sem o parâmetro não fecha nada, e nunca fecha a própria sessão de
  execução mesmo se `originSessionId` coincidir com ela
- **Origem:** achado de investigação de código — sessão criativa com
  execução ativada continuava `active` na lista mesmo com 35 eventos de
  dev agents dentro dela

### RN-074 — A saída de terminal tem teto de bytes {#rn-074}

A saída de um comando é cortada em `TERMINAL_OUTPUT_MAX_BYTES` (default 32 KiB)
antes de virar resultado da ferramenta, e o corte deixa uma **marca** dizendo os
dois tamanhos e o que fazer:

```
[saída truncada: 32768 de 1048576 bytes. Refine o comando (head, grep,
-maxdepth) para ver o que falta.]
```

Três propriedades que o teste fixa:

- **O teto é `>`, não `>=`.** Saída que cabe exatamente no limite passa
  intacta — marcá-la faria o modelo refinar um comando que já deu tudo.
- **O corte não parte caractere multibyte.** `binary_part/3` corta por byte;
  cair no meio de um `é` produz binário inválido que quebra a serialização
  JSON antes de o resultado chegar ao modelo.
- **`raw_bytes` continua sendo o tamanho REAL produzido**, não o truncado. É
  medição, e mentir nela esconderia justamente o comportamento que motivou o
  teto. Quem quiser detectar truncagem compara `byte_size(stdout)` com
  `raw_bytes`.

O que isso conserta: a saída de cada comando fica no histórico do laço e viaja
em **todo** turno seguinte. Sem teto, um `find` numa árvore grande basta — a
execução do `hello-limpo` morreu com `{413, "request entity too large"}` no
turno 18, sem uma linha escrita. O estouro é de **bytes da requisição**, não de
janela de contexto: a maior chamada bem-sucedida tinha 28.993 tokens de entrada.

A marca é endereçada ao **modelo**, não ao humano — sem dizer o que fazer, ele
tende a repetir o mesmo comando.

- **Onde:** `apps/engine/lib/engine/actions/terminal_executor.ex`
  (`truncate/2`), teto em `apps/engine/config/runtime.exs`
- **Teste:** `apps/engine/test/engine/actions/terminal_executor_test.exs`
  (describe `teto de bytes da saída`)
- **Origem:** achado S de
  [achados-execucao-real.md](../explanation/achados-execucao-real.md), Fase F do
  [backlog](../explanation/backlog.md)

### RN-075 — Comando de terminal é avaliado por onde toca, não só pelo verbo {#rn-075}

A pasta do projeto (`<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>` — o
UUID puro num projeto de antes do [RN-109](../business-rules/autenticacao.md#rn-109), `<slug>-<8 chars do
id>` num projeto novo) é o **escopo**.
Um comando de `terminal` que toca qualquer caminho fora dela **nunca** é
auto-aprovado, por mais que o verbo esteja em `allow`. Dentro dela, `cd` deixa
de exigir permissão — ele é a declaração de escopo, não um verbo.

Quatro propriedades que os testes fixam:

- **Aperta:** `Terminal(cat)` liberado deixa de auto-executar
  `cat /workspace/apps/engine/.../git_executor.ex`. Era o achado U: o
  casamento é por VERBO, então o agente lia o código da plataforma que o
  executava, e alcançava o worktree de outros projetos.
- **Afrouxa:** `cd <dentro> && cat README.md` vira `auto_approve`. Era o
  defeito mais caro da escada — o dev agent emite sempre `cd <caminho> &&
  <verbo>`, `cd` não estava em `allow` nenhum, e comando composto exige que
  TODOS os segmentos casem.
- **Permite sem isentar:** dentro do escopo, verbo fora do `allow` continua
  pedindo. Estar na pasta do projeto não torna `curl … | sh` seguro.
- **Fora do escopo é `require_approval`, nunca `deny`:** o agente pode ter
  razão legítima para olhar fora, e a decisão continua sendo do usuário.

`deny` continua vencendo primeiro, e os dois tetos ([RN-006](../business-rules.md#rn-006),
[RN-007](../business-rules.md#rn-007)) seguem intocados. Sem raiz informada ao `decide()`, o
veredito é o de antes desta regra — nenhum chamador tem comportamento alterado
por omissão.

A normalização é **léxica**, não `realpath`: `<raiz>/../..` é resolvido e
reprovado, mas link simbólico de dentro apontando para fora não é detectado.
`decide()` é puro por contrato e resolver symlink exigiria IO no domínio.
Escopo é política; isolamento é outro problema, declarado em aberto no ADR.

**Sem regex sobre a entrada, de propósito.** Tirar as barras finais da raiz era
`.replace(/\/+$/, '')`, e o CodeQL apontou ReDoS polinomial
(`js/polynomial-redos`, HIGH): o padrão obriga o motor a tentar cada posição
inicial e varrer até o fim, degradando em O(n²). Hoje é varredura O(n),
equivalente inclusive no caso degenerado — a raiz `/` vira string vazia nos
dois, e é isso que faz `startsWith('/')` valer para todo caminho absoluto.
Quem for "simplificar" de volta para regex reabre o alerta.

- **Onde:** `apps/api/src/domain/actions/path-scope.ts`,
  `domain/actions/decide.ts` (teto do escopo e o `cd` no escopo),
  raiz derivada em
  `infrastructure/filesystem/project-workspaces-root.ts`
- **Teste:** `apps/api/test/domain/actions/path-scope.spec.ts` e
  `apps/api/test/domain/actions/decide.spec.ts`
  (describe `decide — escopo de caminho`)
- **Origem:** [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md),
  achado U, Fase F do [backlog](../explanation/backlog.md)

O escopo só vale enquanto ele próprio estiver dentro da raiz — quem garante isso
é a [RN-092](#rn-092).

### RN-092 — O `projectId` é segmento de caminho, e o escopo nunca sai da raiz {#rn-092}

`projectScopeRoot()` **recusa** um `projectId` que não seja segmento de caminho
simples (`^[A-Za-z0-9_-]{1,64}$`), lançando em vez de montar o caminho.

O motivo é que o id chega de `@Param('projectId')` sem pipe de validação, e o
Express **decodifica o percent-encoding do segmento antes de entregá-lo**: um
`..%2F..%2Fetc` chega como `../../etc`, e o `join` resolveria para fora da raiz
sem reclamar. Os dois consumidores da função sofrem, e o segundo é o grave:

- o `permissions.json` seria lido **e escrito** em caminho arbitrário;
- o escopo da [RN-075](#rn-075) autoriza comando de `terminal` sob essa pasta.
  Um escopo que escapa da raiz é a política de aprovação apontando para o lugar
  errado — falha de SEGURANÇA, não de arquivo não encontrado.

A checagem é deliberadamente **mais larga que UUID** (aceita letra, dígito,
hífen e sublinhado) para não amarrar o formato do id, e estreita o bastante para
que o resultado nunca escape. E fica **onde a raiz é derivada**, não em cada
chamador, pela mesma razão que fez a função existir: as duas derivações têm que
concordar, e checagem duplicada é checagem que um dia diverge.

O caminho feliz não muda — todo id real é UUID vindo do banco.

- **Onde:** `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`projectScopeRoot`)
- **Teste:** `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
- **Origem:** [ADR 0058](../adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md),
  alertas `js/path-injection` do CodeQL

### RN-095 — A leitura de repositório é contida ao projeto e limitada {#rn-095}

A superfície de leitura de código (`GET /projects/:projectId/code/{tree,file,search}`
e o diff de PR) tem **duas** garantias, e as duas são do mesmo tipo: o produto
recusando fazer o que o cliente pediu.

**Contenção.** Todo caminho de arquivo vindo do cliente passa por
`caminhoDeRepositorioContido()`, que ancora o pedido na pasta do projeto e
recusa o que sair dela — `../`, absoluto, ou byte NUL. Ela é uma função só, no
mesmo arquivo do `projectScopeRoot` da [RN-092](#rn-092), reusando as primitivas
do escopo de terminal (`normalizarCaminho`/`dentroDoEscopo`). **Nenhuma rota
valida caminho por conta própria**, e é isso que a regra afirma: quatro
implementações da mesma contenção seriam quatro chances de divergir, e o
CLAUDE.md já registra que a decisão foi manter a checagem central e pagar o
preço no painel do CodeQL (barreira em outra função ele não enxerga).

Ela devolve o caminho **normalizado**, e o chamador usa o que voltou. Devolver o
original permitiria conferir `b` e mandar `a/../b` ao provider — a forma mais
comum de a contenção existir e não valer.

O vetor não é "ler o arquivo errado". Em `github`/`gitlab` o caminho vira
segmento de URL da API do provider, então um `../` **troca de endpoint** com a
credencial do owner do workspace na mão ([RN-058](#rn-058)/[RN-082](#rn-082)).
Em `local` ele vira o lado direito de `git show <ref>:<path>`. A `ref` é
conferida no mesmo lugar, pelo mesmo motivo, e `..` nela é recusado porque para
o git `dev..main` é intervalo de commits, não revisão.

**Limite.** Árvore e diff já vêm cortados pelo contrato
(`GIT_TREE_ENTRY_LIMIT`, `GIT_DIFF_FILE_LIMIT`, FASE 26a). A **busca** não: ela
não é operação do contrato — é composta sobre `listTree` e `getFileContent`, e
é a única leitura cujo custo cresce com o TAMANHO do repositório em vez do
tamanho do pedido. Três orçamentos a param (diretórios percorridos, arquivos
abertos, casamentos devolvidos), um cache de TTL curto evita repetir as mesmas
chamadas, e `truncated` diz que o corte aconteceu. Sem eles, um `viewer`
gastaria a credencial e o rate limit do owner à vontade — a mesma família de
defeito dos 3.824 req/min do dashboard ([RN-090](../business-rules.md#rn-090)).

Cortar é sempre **visível**: toda resposta que pode ter sido cortada diz isso
num campo. `filesScanned` vai junto na busca porque o custo que ninguém vê é o
que ninguém corrige.

**Ler não vira `proposed_action`.** Leitura não é efeito externo, e transformá-la
em ação de aprovação encheria a fila de ruído até ninguém mais ler as de
verdade. O congelamento da fase é o outro lado disso: a aba é só leitura, e
escrita — quando vier — nasce `proposed_action`.

- **Onde:**
  `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`caminhoDeRepositorioContido`),
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`,
  `apps/api/src/domain/git/git-read-limits.ts`,
  `apps/api/src/domain/git/git-read-cache.ts`,
  `apps/api/src/interfaces/http/git/code.controller.ts`
- **Teste:**
  `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (a contenção isolada),
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (o caminho malicioso recusado nas três rotas **antes** de o provider ser
  chamado, e cada um dos três orçamentos parando a busca),
  `apps/api/test/domain/git/git-read-cache.spec.ts`
- **Origem:** FASE 26b, item 34 do programa 16–26; a contenção estende a
  [RN-092](#rn-092) ([ADR 0058](../adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md))

### RN-127 — `ref`/`path` da aba Code recusam chegar como ARRAY, não só como caminho fora do escopo {#rn-127}

`@Query('ref') ref?: string` e `@Query('path') path?: string`
(`code.controller.ts`) extraem o valor cru sem DTO/`class-validator` no
meio, e o `ValidationPipe` global (`main.ts`) não ajuda: ele pula tipo
primitivo nativo (`String`) por desenho do Nest, então nada intercepta
`ref`/`path` antes de chegarem como argumento de método. O Express entrega
`?ref=a&ref=b` como **array**, não string — a anotação `string` do
TypeScript só existe em compile-time.

Um array escapava das DUAS checagens que a [RN-095](#rn-095) já fazia
tratando o valor como string: `ref.includes('..')` tem semântica de
ELEMENTO EXATO (não substring) em array, e `REF_VALIDO.test(ref)` chama
`.toString()` no array antes de casar — um valor como `['x/../y']`
continha `..` e ainda assim passaria pelas duas.

`garantirQueryEscalar(valor, criarErro)` recusa o array ANTES de qualquer
outra checagem, num lugar só, reusado pelos DOIS pontos que tratavam query
como string: `caminhoDeRepositorioContido` (mesmo arquivo da RN-092/095) e
`ReadProjectCodeUseCase.alvo` (`ref`). O erro concreto (`CaminhoForaDoEscopoError`
ou `BadRequestException`) é decidido por quem chama, passado como fábrica —
a função central não decide o tipo de erro, só a forma da checagem.

O caminho feliz não muda: todo `ref`/`path` legítimo já era string.

- **Onde:** `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`garantirQueryEscalar`, usada em `caminhoDeRepositorioContido`),
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (`alvo`, `ref`)
- **Teste:**
  `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (`garantirQueryEscalar` isolada e `caminhoDeRepositorioContido` recusando
  array), `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (`ref`/`path` como array são 400 em `tree`, que todas as outras rotas
  reusam via `alvo`)
- **Origem:** alerta CRÍTICO do CodeQL (confusão de tipo em query param HTTP)
  bloqueando a promoção qa→main, achado durante a PR #256; estende a
  [RN-095](#rn-095)

### RN-093 — Em produção, a api não sobe com a chave de exemplo do `state` de OAuth {#rn-093}

`resolveOauthStateSecret()` **derruba o boot** quando `NODE_ENV === 'production'`
e `GIT_OAUTH_STATE_SECRET` está ausente, é igual ao literal de exemplo do
repositório, ou tem menos de 16 caracteres. Fora de produção o default de
desenvolvimento continua valendo.

Essa chave assina o `state` do OAuth de git, e o `state` é o único que impede o
callback `GET /git/oauth/:provider/callback` — rota pública, por necessidade —
de ser forjado. Com a chave conhecida, qualquer um assina um `state` para
`{projectId, userId, provider}` à escolha e faz o callback gravar, no projeto
apontado por esse payload, o token de git obtido do provider.

**Por que rejeitar o literal, e não só o vazio.** O default estava no
`.env.example` de um repositório open source — é segredo publicado, não segredo
fraco. E o `docker-compose.prod.yml` o supria como fallback, então no caminho
real de erro a variável estava **definida**: uma verificação de "não vazia"
passaria por cima do defeito inteiro.

A resolução fica em função única, e não em cada chamador, pela mesma razão da
[RN-092](#rn-092) — eram duas cópias do mesmo literal, e cópias divergem.
Divergindo aqui, o callback recusaria todo `state` legítimo.

- **Onde:** `apps/api/src/infrastructure/security/oauth-state-secret.ts`
  (`resolveOauthStateSecret`), chamada no boot em `apps/api/src/main.ts`
- **Teste:** `apps/api/test/infrastructure/security/oauth-state-secret.spec.ts`
- **Origem:** [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md)

### RN-114 — Os quatro segredos irmãos do `GIT_OAUTH_STATE_SECRET` também não sobem em produção com o valor de exemplo {#rn-114}

O [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md) fechou o
padrão para `GIT_OAUTH_STATE_SECRET` e deixou declaradamente aberto que o
mesmo modo de falha valia para quatro segredos irmãos, todos com default de
desenvolvimento no `docker-compose.prod.yml`: `AUTH_JWT_SECRET`,
`BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY` e `SECRET_KEY_BASE`. Esta RN
fecha os quatro, replicando exatamente a mesma regra — não é decisão nova,
é a mesma decisão aplicada aos irmãos.

Em produção (`NODE_ENV === 'production'`), cada resolutor **derruba o boot**
quando a variável está ausente/só com espaços, é igual ao literal de exemplo
do repositório (que é público — está no `.env.example`), ou tem menos de 16
caracteres. Fora de produção o default de desenvolvimento continua valendo,
porque `docker compose up` sem `.env` tem que funcionar.

- `AUTH_JWT_SECRET` — deriva o par Ed25519 que assina o access token. Com o
  default público, qualquer um forja um access token válido.
- `BRABO_SERVICE_TOKEN` — autentica o tráfego interno api ↔ engine. Com o
  default público, qualquer um chama as rotas `/internal/*` sem passar pelo
  `EngineServiceGuard`.
- `CREDENTIALS_MASTER_KEY` — embrulha os DEKs que cifram as credenciais do
  usuário (chaves de LLM, tokens de git). Com o default público, qualquer um
  decripta o acervo. **Fora de escopo aqui**: qualquer mecanismo de rotação —
  esse já existe (`CREDENTIALS_MASTER_KEY_PREVIOUS` +
  `src/scripts/rewrap-deks.ts`) e não muda; esta é só a checagem de BOOT.
- `SECRET_KEY_BASE` (engine) — já derrubava o boot sem a variável
  (`runtime.exs`, bloco `:prod`, boilerplate padrão do Phoenix). O defeito
  real não era falta de checagem no Elixir: era o `docker-compose.prod.yml`
  suprir o literal público como fallback, o que fazia a variável chegar
  sempre DEFINIDA e mascarava o `raise` que já existia. A correção aqui foi
  só remover o fallback do compose — nenhuma linha de Elixir mudou.

Vale a mesma razão do ADR 0059 para rejeitar o literal, e não só o vazio: o
`docker-compose.prod.yml` supria os quatro literais como fallback, então no
caminho real de erro as variáveis estavam **definidas** — uma verificação de
"não vazia" passaria por cima do defeito inteiro.

- **Onde:** `apps/api/src/infrastructure/security/auth-key-material.ts`
  (`passphraseAtual`), `apps/api/src/infrastructure/security/service-token.ts`
  (`tokenDeServicoAtual`) e
  `apps/api/src/infrastructure/security/envelope-encryption.service.ts`
  (`EnvelopeEncryptionService`, checagem no construtor) — os dois primeiros
  chamados no boot em `apps/api/src/main.ts`, o terceiro exercitado quando o
  `NestFactory.create` monta o grafo de providers. `SECRET_KEY_BASE` em
  `apps/engine/config/runtime.exs` (inalterado) com o fallback removido de
  `docker/docker-compose.prod.yml`
- **Teste:** `apps/api/test/infrastructure/security/auth-key-material.spec.ts`,
  `apps/api/test/infrastructure/security/service-token.spec.ts` e o describe
  `validação de produção` em
  `apps/api/test/infrastructure/security/envelope-encryption.service.spec.ts`
- **Origem:** [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md)

### RN-076 — A credencial de git nunca é escrita em arquivo {#rn-076}

O engine trabalha em repositório remoto pedindo o **remoto de trabalho** à api
(`GET /internal/projects/:projectId/git-remote`), que devolve a origem **limpa**
e o token do owner à parte. O token entra na invocação do git pelo **ambiente do
processo filho** e em nenhum outro lugar:

- **não no `origin`** — é a URL limpa que fica gravada no `.git/config`;
- **não em argv** — `ps` mostra a linha de comando de qualquer processo;
- **não em arquivo** — nem helper persistido, nem `~/.git-credentials`.

O helper de credencial é passado por `-c`, vale só para aquele processo, e vem
depois de um `credential.helper=` vazio: helpers são acumulativos e o primeiro a
responder ganha, então sem zerar antes um helper do host responderia no lugar.

**Por que isso é regra e não preferência.** Escrever
`https://x-access-token:TOKEN@github.com/…` no `origin` — o que quase todo
tutorial ensina — grava a credencial em texto puro **dentro da pasta do
projeto**, exatamente onde a [RN-075](#rn-075) dá ao dev agent leitura
**auto-aprovada**. Um `cat .git/config` devolveria o token sem passar por
aprovação nenhuma, e ele viajaria ao provider de LLM no histórico do laço. O
escopo de caminho protege contra o agente ler para FORA do projeto; não tem como
proteger contra um segredo que o próprio produto colocou DENTRO.

A credencial é a do **owner do workspace**, pelo mesmo resolvedor da
[RN-058](#rn-058) — duas regras de "de quem é a credencial" divergiriam.
Provider `local` não tem token nem consulta a api: é resolvido direto do banco,
e é o caminho que o `pnpm dev` e a suite inteira exercitam.

- **Onde:** `apps/engine/lib/engine/actions/git_auth.ex`,
  `engine/projects/project_repository.ex` (`remoto_de_trabalho/1`),
  `apps/api/src/application/use-cases/git/get-project-git-remote.use-case.ts`
- **Teste:** `apps/engine/test/engine/actions/git_auth_test.exs` (o token não
  aparece em argv nem no helper) e
  `apps/api/test/application/use-cases/git/get-project-git-remote.use-case.spec.ts`
  (a origem devolvida não contém o token nem `@`)
- **Origem:** [ADR 0056](../adr/0056-o-engine-trabalha-em-repositorio-remoto.md),
  achado N, Fase B do [backlog](../explanation/backlog.md)

### RN-077 — A origem da falha é sempre uma das quatro {#rn-077}

Todo desfecho de falha nomeia a ORIGEM no vocabulário **fechado** do
[ADR 0020](../adr/0020-destravar-gates-qa-secops.md) —
`infra | modelo | codigo | politica`. Não há quinto valor: `null` e
`"indeterminada"` deixaram de ser possíveis.

Duas garantias estruturais, e nenhuma depende de alguém lembrar:

- **`AgentIo.block_task/4` não tem default para a origem.** Ela era
  "obrigatória em espírito", com `"indeterminada"` de default — e o desfecho
  mais caro da execução real saiu exatamente assim, porque o call site não
  passou nada. Sem default, esquecer vira erro de compilação.
- **`FalhaDeTurno.origem/1` sempre devolve uma das quatro**, e há teste de
  tabela que falha se alguma entrada — inclusive uma forma nunca vista —
  produzir outra coisa.

**Por que `indeterminada` saiu.** Ela existiu com um argumento razoável: não
chutar seria mais honesto que escolher no escuro. O efeito real foi o oposto —
`indeterminada` **não aponta ação nenhuma**, e quem triava a rodada seguinte
recomeçava a investigação do zero. O que ela significava de fato era *o
classificador não reconheceu esta forma*, que é lacuna do nosso código: `codigo`
é a origem que aponta a ação certa (acrescentar a cláusula que falta). O
diagnóstico continua indo verbatim, então nada se perde.

**As origens não são chute.** Cada desfecho do ToolLoop diz quem decidiu parar:
`report_blocked` e teto de iterações são do **modelo** (ele decidiu, ou gastou o
que tinha); orçamento e PR não aprovada são **política** (foi uma decisão, nada
quebrou); restart e falha ao montar contexto são **infra**; e quando há
`last_error`, a origem sai do MESMO erro que o diagnóstico narra — era esse par
que se contradizia, com `diagnosis` dizendo `{413, …}` e `origem` dizendo
"indeterminada" na mesma linha.

- **Onde:** `apps/engine/lib/engine/agents/falha_de_turno.ex`,
  `engine/dev/agent_io.ex` (`block_task/4`, sem default),
  `engine/dev/dev_agent_server.ex` (`origem_da_parada/1`)
- **Teste:** `apps/engine/test/engine/agents/falha_de_turno_test.exs`
  (`o vocabulário é fechado`) e
  `apps/engine/test/engine/dev/dev_agent_server_test.exs`, que afirma a origem
  no evento emitido
- **Origem:** achados P, Q e T de
  [achados-execucao-real.md](../explanation/achados-execucao-real.md), Fase G do
  [backlog](../explanation/backlog.md)

### RN-078 — Falha em proteger branches pode ser reconhecida, e só ela {#rn-078}

`protect_branches` falha em repositório privado no plano gratuito do GitHub — e
o wizard **avisa isso antes de começar**. O usuário pode reconhecer a falha e
seguir; o bootstrap fecha e o projeto passa a ser alcançável.

**O que isso destrava é maior do que parece.** O único botão oferecido depois da
falha era "Tentar novamente", que falha sempre pelo mesmo motivo. E
`provision_failed` faz o dashboard **redirecionar o clique do projeto de volta
para a página de provisionamento** — o projeto ficava inalcançável para sempre,
preso num passo que não tem como suceder.

**Só a proteção pode ser reconhecida.** Ela é o ÚLTIMO passo e a única cuja
falha deixa um repositório utilizável: o repo existe, os arquivos foram
commitados, as branches foram criadas. Falhar em criar o repositório ou em
commitar é outra coisa — ali "seguir" produziria um projeto sem onde trabalhar,
e o botão seria uma segunda mentira em cima da primeira. A recusa diz isso, em
vez de só negar.

**A garantia do produto não muda.** A trava de merge ([RN-006](../business-rules.md#rn-006)) é
aplicada em `decide.ts`, não pela proteção do provider. Seguir sem ela remove a
segunda camada, a do GitHub — não a do Brabo. É o que torna esta saída honesta
em vez de um atalho.

A decisão vai para o event log com o **usuário** como ator e o erro original no
payload: seguir sem proteção é escolha dele, e quem ler depois precisa saber o
que exatamente foi dispensado.

- **Onde:** `apps/api/src/application/use-cases/git/acknowledge-protection-failure.use-case.ts`,
  rota em `interfaces/http/git/git.controller.ts`, botão em
  `apps/web/src/routes/ProvisioningPage.tsx`
- **Teste:** `apps/api/test/application/use-cases/git/acknowledge-protection-failure.use-case.spec.ts`
  (destrava; a decisão no log com o ator; e a recusa para falha anterior)
- **Origem:** achado D, Fase D do [backlog](../explanation/backlog.md)

### RN-079 — O Psicólogo não analisa sessão sem evento analisável {#rn-079}

Antes de gastar um turno de modelo, a análise pergunta se há o que analisar. Não
havendo, ela **não roda** e o desfecho vira `psychologist.analysis_skipped`.

**Analisável exclui duas coisas, por motivos diferentes:**

- **o rastro dos próprios analistas.** O Psicólogo grava o turno dele no log da
  sessão que está analisando (`agent.response`, `tool.call`, `tool.result`, a
  hipótese). Contar isso faria uma sessão vazia parecer povoada **a partir da
  primeira análise**, e cada retentativa a encheria mais — o critério nunca mais
  reprovaria. Vale igual para a Anamnese;
- **`bootstrap.*`**, que é provisionamento de repositório rodando sozinho: nove
  passos de máquina não dizem nada sobre a pessoa.

Tudo o mais conta, inclusive `proposed_action.*` — o usuário aprovando e negando
sem escrever mensagem nenhuma **é** comportamento, lição que a Anamnese já tinha
aprendido ([RN-063](#rn-063)).

**São duas contagens, e elas não se substituem.** A crua dimensiona o trabalho
(quanto log ler, logo qual tier de triagem, leve ou pesado); a analisável decide
se há trabalho. Confundi-las é o defeito: uma sessão só de bootstrap passava por "20
eventos" sem ter nenhum, ganhava a análise, e o modelo — sem nada para citar —
inventava `seq` inexistentes até a validação de evidência rejeitar e ele
desistir, com o orçamento já gasto.

**Pular vale também para reprocessamento manual.** Reprocessar não fabrica
material: quem clicou recebe o motivo no log em vez de uma hipótese inventada
sobre um log que não existe.

O skip vira **evento**, ao contrário do da Anamnese, que é só log — aquele roda
a cada 15 min e viraria ruído, este roda uma vez por fechamento de sessão, e uma
análise ausente sem nada narrado é indiagnosticável.

- **Onde:** `apps/engine/lib/engine/session_events/event.ex` (`count_analisaveis/1`),
  `apps/engine/lib/engine/psychologist/triage.ex` (`should_run?/1`),
  `apps/engine/lib/engine/workers/psychologist_worker.ex`
- **Teste:** `apps/engine/test/engine/session_events/event_analisaveis_test.exs`
  (inclui a reprodução da sessão do achado: 14 eventos, nenhum analisável),
  `apps/engine/test/engine/workers/psychologist_worker_test.exs`
- **Origem:** achado J, Fase E do [backlog](../explanation/backlog.md)

### RN-080 — Regra de negócio duplicada é recusada na entrada {#rn-080}

`business_rule` cujo título já existe **no projeto** não é gravada. A recusa
volta ao modelo pelo mesmo caminho de um payload inválido, e ele segue para a
próxima regra em vez de parar.

**Na entrada porque não há outro lugar.** Não existe tabela de regras: o
artefato É o evento `artifact.business_rule`, e evento de domínio não é apagado
nem editado. Deixar entrar significa conviver com a duplicata para sempre.

**Escopo de projeto, não de sessão** — é entre sessões que a duplicata nasce.
Rodar o Criativo de novo abre sessão nova, e uma checagem por sessão não veria a
rodada anterior, que é exatamente o caso do achado.

A comparação normaliza caixa, acento e espaço redundante; pontuação fica.
**Duplicata semântica continua passando, e isso é declarado, não esquecido:**
"Saudação com nome" e "Quem chama pode se identificar" seguem sendo duas regras,
porque separá-las é julgamento e não cabe num `if`.

- **Onde:** `apps/engine/lib/engine/harness/artifact_dedupe.ex`,
  `apps/engine/lib/engine/harness/tools/emit_artifact.ex`,
  `apps/engine/lib/engine/session_events/event.ex` (`titulos_de_regras/1`)
- **Teste:** `apps/engine/test/engine/harness/artifact_dedupe_test.exs`,
  `apps/engine/test/engine/harness/emit_artifact_dedupe_test.exs`
- **Origem:** achado K, Fase E do [backlog](../explanation/backlog.md)

### RN-081 — História repetida: título igual recusa, justificativa igual avisa {#rn-081}

Duas respostas diferentes para dois problemas diferentes:

- **título idêntico** no projeto é erro, não escolha: a história é **recusada** e
  nada é criado;
- **mesma justificativa** — todas as regras de negócio que a história cita já
  estavam cobertas por outra — é suspeita, não erro. A história **é criada** e
  sai um `backlog.story_overlap_warned`. Um segundo recorte da mesma regra pode
  ser legítimo, então quem julga é o usuário; o produto só se recusa a deixar
  passar despercebido.

**Contido, não intersecção.** Duas histórias compartilharem uma regra é normal, e
avisar disso viraria ruído que ninguém lê. O sinal só existe quando a nova não
acrescenta cobertura nenhuma. História que não cita regra alguma não gera aviso:
tratar o conjunto vazio como subconjunto de tudo acusaria todas.

**O limite é o mesmo da [RN-080](#rn-080), e o par do achado o atravessa:**
"Endpoint público de saudação determinística" e "Endpoint público GET /hello que
responde saudação imediata" cobrem o mesmo endpoint com títulos e justificativas
diferentes — nada mecânico os liga, e eles continuam passando. Há teste
afirmando isso, para o limite ficar visível em vez de implícito.

- **Onde:** `apps/api/src/domain/backlog/story-overlap.ts`,
  `apps/api/src/application/use-cases/backlog/create-story.use-case.ts`
- **Teste:** `apps/api/test/domain/backlog/story-overlap.spec.ts`,
  `apps/api/test/application/use-cases/backlog/create-story.use-case.spec.ts`
- **Origem:** achado R, Fase E do [backlog](../explanation/backlog.md)

### RN-082 — A credencial de git de uma ação é a do OWNER do workspace {#rn-082}

Quando a api executa uma ação de git contra provider remoto (`pr_open`,
`git_merge`), o token vem do **owner do workspace** — o mesmo resolvedor da
[RN-058](#rn-058), não de quem decidiu a ação.

**Resolver por quem decidiu só funcionava com clique humano.** Ação
auto-aprovada por política não tem decisor: `decided_by` fica `NULL`, o token
fica `undefined`, e o GitHub responde `Requires authentication`. Na prática,
com autonomia ligada — que é o modo que o ADR 0055 existe para viabilizar —
**nenhum dev agent conseguia abrir PR em provider remoto**.

**O contraste que expôs o defeito** aconteceu dentro de uma execução só: no
mesmo run, `git_push` passou e `pr_open` falhou. O push é executado pelo
ENGINE, que já injetava a credencial do owner
([RN-076](#rn-076)); a PR é aberta pela API, que estava fora de simetria.

Não apareceu antes porque toda validação anterior usou o `LocalGitProvider`,
onde o token nem é consultado.

O princípio é o mesmo da RN-058, e vale repetir porque é o que impede as duas
regras de divergirem com o tempo: **quem banca a conta banca os agentes**, e
isso não muda conforme quem clica. Por isso o resolvedor é REUSADO em vez de
reimplementado.

- **Onde:** `apps/api/src/application/use-cases/actions/execute-git-action.use-case.ts`,
  reusando `application/use-cases/llm/resolve-credential-owner.use-case.ts`
- **Teste:** `apps/api/test/application/use-cases/actions/execute-git-action.use-case.spec.ts`
  (`pr_open` auto-aprovado, com `decidedBy: null`, pede a credencial do owner)
- **Origem:** achado AA, [validação real da 13b](../explanation/validacao-real.md)

### RN-083 — O lead decide o paralelismo; acima do teto, você autoriza {#rn-083}

Quantos agentes sobem deixa de ser um número no código: quem avalia é o **lead
da área**. Mas a decisão dele não é soberana sobre GASTO — até
`agent_areas.max_parallel` (default **2**) ele sobe e segue; **acima disso vira
`proposed_action` do tipo `parallelize`**, pelo mesmo pipeline de toda ação com
efeito externo.

**O teto é da SESSÃO, não do módulo.** É a única parte da regra que não é
óbvia, e a que um refactor desatento desfaz: contar por módulo permitiria N
módulos × 2 agentes sem autorização nenhuma — o buraco anterior com outro nome.
Há teste afirmando exatamente isso.

**Teto zero ou negativo é configuração inválida, não "sem limite".** Tratá-lo
como ilimitado transformaria um erro de digitação em gasto irrestrito, que é o
oposto do que o pipeline existe para fazer.

**Quem PEDE é o lead; quem DECIDE é você.** A `proposed_action` nasce com o
lead como ator, e a decisão fica no event log com o seu nome — é essa distinção
que faz a história ser reconstituível depois ([ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md)).

O motivo viaja no payload IMUTÁVEL, com os três números (quantos há, quantos
pede, qual o teto): quem ler daqui a seis meses precisa entender o que foi
autorizado sem reconstruir o estado da sessão.

`AcceptParallelizationUseCase` não muda: ele continua sendo quem EXECUTA, tanto
no caminho direto quanto quando a ação é aprovada. Absorvê-lo por dentro, em vez
de reescrevê-lo, é o que mantém a suite da Fase 4 verde sem modificação — que é
a prova de que a troca não vazou para o contrato externo.

**O teto é configurável por área, e só por você.** `PATCH
/projects/:projectId/agent-areas/:key/max-parallel` exige `maintainer` — o mesmo
papel de ativar a execução, e pelo mesmo motivo: mudar o teto é decidir quanto o
produto pode gastar sem perguntar. Não existe caminho automático de subi-lo. A
Anamnese pode PROPOR, quando notar que a autorização virou rotina, e a proposta
continua passando por esta rota depois que você aceita — um produto que eleva o
próprio teto de gasto é exatamente o que o pipeline de aprovação existe para
impedir.

Mudar o teto vale para os PRÓXIMOS pedidos. O que já está aguardando decisão
continua aguardando: a ação carrega no payload o teto vigente quando foi criada,
e reinterpretá-la sob o teto novo mudaria o que você está prestes a decidir
depois de ler.

- **Onde:** `apps/api/src/domain/execution/paralelismo.ts` (a regra pura),
  `application/use-cases/execution/request-parallelization.use-case.ts`,
  `application/use-cases/execution/set-area-max-parallel.use-case.ts`,
  exposto em `interfaces/http/execution/execution.controller.ts` e configurado
  em `apps/web/src/routes/ProjectSettingsTab.tsx` (`ParallelismSection`)
- **Teste:** `apps/api/test/domain/execution/paralelismo.spec.ts`,
  `test/application/use-cases/execution/request-parallelization.use-case.spec.ts`,
  `test/application/use-cases/execution/set-area-max-parallel.use-case.spec.ts`
  e `apps/web/src/routes/ProjectSettingsTab.test.tsx` (`ParallelismSection`)
- **Gate:** `docs/gates.yml` (`paralelismo-autorizado`) — `status: active`
  desde a auditoria fluxo.yml × código (achado A1/B5); o mecanismo em si não
  mudou, só o registro que ficou `planned` por engano desde a FASE 14d, ver
  [gates.md](../explanation/gates.md#um-registro-pode-envelhecer-para-o-lado-errado--desatualizado-não-inativo)
- **Origem:** [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md), FASE 14d

### RN-094 — A área de agentes nasce com o projeto {#rn-094}

Criar um projeto grava as três áreas (`dev`, `qa`, `infra`) em `agent_areas`,
com o lead de cada uma e os membros **enumeráveis** em `agent_area_members` —
na MESMA transação da criação. Se o seeding falha, o projeto não nasce: projeto
sem área é projeto onde a RN-083 lê tabela vazia e cai no default sem que
ninguém tenha decidido nada.

**Isto é a correção de um defeito, não uma capacidade nova.** `agent_areas`
existe desde a FASE 14d e nunca foi gravada — `AgentAreaRepository.upsert`
tinha teste e não tinha NENHUM chamador. Em produção a tabela estava vazia,
`GET /projects/:projectId/agent-areas` devolvia `[]`, e os quatro casos de uso
que a leem operavam sobre o nada. É a mesma falha da própria FASE 14d, escrita
no CLAUDE.md: **testar a peça não é testar o caminho até ela**. Por isso o
teste desta regra entra pelo caso de uso que a rota chama, com repositório
real: um fake aqui provaria exatamente o que já estava provado e quebrado.

**Semeia em DOIS lugares, e cada um responde uma pergunta diferente.** A
criação do projeto faz a área EXISTIR — a tela de Configurações lê num projeto
que nunca executou. A ativação da execução diz quem são os MEMBROS da área de
`dev`: um `dev-<modulo>` por módulo do `module_map`, que não existia quando o
projeto nasceu. Enquanto não há membros gravados, quem sustenta a regra de
endereçamento (RN-087) é o predicado `ehDevDeModulo`, que não consulta o banco.

**O seeding nunca manda `max_parallel`.** A ativação é repetível, e mandar o
default faria um teto que você subiu para 5 voltar para 2 em silêncio — o
produto desfazendo a sua decisão. O mesmo vale para a migração de backfill: ela
faz a área existir e para aí.

Projetos criados antes disto são cobertos pela migração `0038`, com `ON
CONFLICT DO NOTHING` nas duas tabelas. Sem ela, o defeito ficaria corrigido só
para quem começasse do zero.

- **Onde:**
  `apps/api/src/application/use-cases/agents/seed-agent-areas.use-case.ts`,
  chamado por `application/use-cases/iam/create-project.use-case.ts` e
  `application/use-cases/execution/activate-execution.use-case.ts`;
  lista canônica em `apps/api/src/domain/agents/agent-areas.ts`;
  backfill em `apps/api/src/db/migrations/0038_wandering_lila_cheney.sql`
- **Teste:**
  `test/application/use-cases/iam/create-project-semeia-areas.spec.ts` (o
  caminho, contra o banco, incluindo a falha que derruba a criação),
  `test/db/agent-areas-backfill.spec.ts` (a migração rodada de verdade, duas
  vezes) e `test/application/use-cases/execution/activate-execution.use-case.spec.ts`
  (os membros de dev, e o teto nunca enviado)
- **Origem:** FASE 18, defeito achado na investigação do programa 16–26;
  a tabela vem do [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md)

### RN-084 — A esteira exibida deriva do registro de gates {#rn-084}

O painel do time mostra a etapa em que uma PR está **derivando-a de
`docs/gates.yml`**, não de uma lista escrita na tela. Gate que sai do registro
some da esteira; gate `planned` nunca aparece.

**A regra existe por uma forma específica de envelhecimento.** Antes da FASE
15b a tela tinha as etapas fixas no componente, e o registro (FASE 15a)
descrevia os gates em outro lugar. Nada ligava os dois: acrescentar um gate ao
YAML não mudava a tela, e remover um deixava a tela mostrando uma etapa que já
não existia — sem nenhum teste falhar, porque as duas fontes estavam certas
cada uma por si. É o mesmo apodrecimento que o `docs/.docmap.yml` existe para
impedir, e a resposta é a mesma: uma fonte só, com o consumo cobrado.

Três decisões de borda, todas para a tela **degradar** em vez de sumir:

- gate de PR que a tela ainda não sabe desenhar é **ignorado**, não quebra o
  render — o registro pode ganhar um gate antes de a tela ganhar o rótulo;
- os **rótulos são de tela**, não do registro: o YAML descreve engenharia, e a
  tela fala com quem espera uma PR;
- **sem registro** (a rota falhou), mostra a esteira completa em vez de vazia —
  uma esteira genérica informa mais que nada.

- **Onde:** `apps/web/src/components/PrGateTimeline.tsx` (`etapasDaEsteira`),
  lendo `GET /gates` (`apps/api/src/interfaces/http/gates/gates.controller.ts`)
- **Teste:** `apps/web/src/components/PrGateTimeline.test.ts`
  (`gate que SAI do registro some da tela`, `gate de PR que a tela ainda não
  sabe desenhar é IGNORADO`, `sem registro, mostra a esteira completa`)
- **Origem:** [ADR 0054](../adr/0054-gates-como-registro-declarativo.md), FASE 15b

### RN-085 — O teto de iterações é por TIPO de agente {#rn-085}

Quantas voltas um agente pode dar no laço de ferramenta depende do trabalho que
ele faz: **8** para quem conversa, **60** para o dev agent e para os subagentes
de QA. Não há mais um número único.

**O teto de 8 nasceu de agente conversacional e foi herdado por quem trabalha.**
Na validação real da 13b isso apareceu como bloqueio: o dev agent gastou as
oito voltas explorando um repositório recém-provisionado e **nunca escreveu um
arquivo**; com 25, escreveu três e rodou os testes. O desfecho registrado era
`limite de iterações atingido` com origem `modelo` — tecnicamente verdade e
praticamente inútil, porque o modelo nunca chegou a julgar nada.

**Subir o default global seria a correção errada**, e é isso que a regra
protege: o Criativo não precisa de 60 voltas para conversar, e o teto também é
a trava contra laço infinito.

**Quem pode subir não é "quem trabalha muito", é quem tem trava de gasto por
baixo.** O teto de iterações protege contra laço infinito; quem protege o
BOLSO é o `token_budget_micros`. Dev agents e subagentes de QA rodam com o
`task_budget_micros` da task, então afrouxar as voltas não afrouxa a conta.
`infra-workflows` usa ferramenta pesada e mesmo assim **fica em 8**: ele roda
sem budget, e para ele o teto é a única trava que existe.

Duas bordas com teste próprio:

- **`dev-lead` é conversacional**, apesar do prefixo `dev-` que identifica os
  dev agents (`dev-<modulo>`, `dev-<modulo>-2`). O lead decide e delega, e sem
  a cláusula explícita nasceria com o teto do trabalho pesado por acidente de
  nomenclatura.
- **Agente desconhecido cai no teto mais baixo.** Errar para o lado barato:
  quem precisa de mais voltas aparece como `limite de iterações atingido` e é
  corrigido; quem ganha 60 por engano gasta calado.

- **Onde:** `apps/engine/lib/engine/harness/iteracoes.ex`, aplicado em
  `apps/engine/lib/engine/harness/tool_loop.ex` (`init/1`)
- **Teste:** `apps/engine/test/engine/harness/iteracoes_test.exs` e
  `apps/engine/test/engine/harness/tool_loop_test.exs`
  (`o teto vem do TIPO do agente quando o chamador não passa um`,
  `teto explícito do chamador VENCE o do tipo`)
- **Origem:** achado X, [validação real da 13b](../explanation/validacao-real.md);
  [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md), FASE 14d

### RN-086 — Gastar com mais agentes nunca se auto-aprova {#rn-086}

As duas ações que mexem em **quanto o produto pode gastar sozinho** —
`parallelize` (ultrapassar o teto agora) e `raise_max_parallel` (mudar o teto)
— nunca são auto-aprováveis. Nem por `agent_autonomy`, nem por
`permissions.json`. É a mesma classe de garantia da trava de merge e do teto do
patch de instrução.

**Sem isto o teto da [RN-083](#rn-083) seria decorativo.** Um `permissions.json`
com `Parallelize()` no `allow` faria toda ultrapassagem se aprovar sozinha — a
regra que existe para EXIGIR a decisão do usuário passaria a dispensá-la. E
`raise_max_parallel` é o caso mais grave: seria o produto elevando o próprio
limite de gasto, exatamente o que o pipeline de aprovação existe para impedir.

**A Anamnese pode PROPOR, e é isso que ela faz.** Quando autorizar mais um
agente vira rotina, o teto está errado, e quem percebe primeiro é quem lê o
histórico. O sinal já chegava a ela: as decisões do usuário na janela vêm de
`proposed_actions`, com `actionType` e `status`.

O limiar é **três aprovações e nenhuma negação**, e as duas metades importam:

- **duas não são rotina — são duas.** Três é o que separa "aconteceu" de "está
  acontecendo sempre";
- **uma negação derruba o sinal inteiro**, por mais aprovações que haja. Se o
  usuário recusou alguma vez, o teto está fazendo o trabalho dele, e propor
  subi-lo seria ler o sinal ao contrário.

Propor um teto **igual ou menor** que o vigente é recusado pela api: a Anamnese
roda periodicamente e reproporia a mesma coisa a cada rodada, enchendo de ruído
uma fila que o usuário precisa ler.

Aprovar aplica o valor do **payload**, não um recalculado na hora — é o número
que você leu ao decidir.

- **Onde:** `apps/api/src/domain/actions/decide.ts` (o teto),
  `application/use-cases/execution/propose-max-parallel.use-case.ts`,
  `execute-max-parallel-raise.use-case.ts`,
  `apps/engine/lib/engine/anamnese/tools/propose_max_parallel.ex` e o limiar em
  `apps/engine/lib/engine/workers/anamnese_worker.ex` (`nota_de_paralelismo/1`)
- **Teste:** `apps/api/test/domain/actions/decide.spec.ts`
  (`decide — teto do paralelismo`),
  `test/application/use-cases/execution/propose-max-parallel.use-case.spec.ts`,
  `execute-max-parallel-raise.use-case.spec.ts`,
  `apps/engine/test/engine/anamnese/tools_test.exs` e
  `test/engine/workers/anamnese_worker_test.exs` (`duas aprovacoes NAO sao
  rotina`, `uma NEGACAO derruba o sinal`)
- **Origem:** [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md), FASE 14d

### RN-087 — O Dev Lead é o único endereço externo da execução {#rn-087}

Existe um agente `dev-lead`, conversacional, que recebe o handoff do Arquiteto
e propõe o **plano de execução**: quantos agentes por módulo e por quê. Ele não
escreve código — distribui trabalho e responde por ele.

**Antes dele, a frase "quem decide é o lead" da [RN-083](#rn-083) não tinha
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

**O plano é `proposed_action` (revisado pelo [ADR 0086](../adr/0086-dev-lead-plano-suspende-para-aprovacao.md), [RN-284](../business-rules.md#rn-284)).**
Até essa mudança o plano virava EVENTO simples, sem aprovação: o argumento era
que propor não tem efeito externo — o gasto acontece quando os agentes sobem,
e é lá que o teto cobra autorização; transformar a proposta em ação a decidir
faria você decidir duas vezes a mesma coisa. Uma auditoria de
`docs/fluxo.yml` × código encontrou que o fluxo já declarava esta saída como
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

### RN-064 — Heartbeat não encerra sessão com trabalho pendente {#rn-064}

O timeout de heartbeat mede inatividade da **aba**, não do **trabalho**. Antes
de encerrar, o `SessionServer` pergunta à api se sobrou trabalho
(`GET /internal/sessions/:id/pending-work`); havendo, reagenda o timeout e
registra o motivo no log em vez de matar a sessão.

O default são **30 segundos**. Sair da sessão para a aba de Backlog já bastava
para matá-la — e numa execução real isso prendeu um handoff `offered` para o
Arquiteto dentro de uma sessão fechada: épico e quatro histórias prontos, e a
cadeia sem como seguir, porque não existe onde aceitar handoff de sessão morta.

Fechar sessão é sobre o trabalho ter acabado, não sobre quem está olhando.

**A api fora do ar NÃO impede o encerramento**: `{:error, _}` encerra assim
mesmo, com aviso no log. Trocar sessão órfã por sessão imortal seria trocar um
defeito por outro.

"Trabalho pendente" são **três** sinais — o segundo entrou pelo achado V, o
terceiro pelo bug real do Criativo→PO→Arquiteto:

1. **handoff `offered`** — o caso original acima;
2. **`proposed_action` com status `pending`** — alguém está esperando a SUA
   decisão, e um agente pode estar suspenso esperando o desfecho
   ([RN-073](#rn-073));
3. **agente ATIVADO ainda em turno** — o último `agent.status` de cada ator
   que já falou na sessão é `working` sem um `idle` posterior.

O segundo é o mesmo defeito do primeiro um nível abaixo, e a execução do
`hello-limpo` mostrou o custo: a sessão nasceu 23:34:12, uma ação ficou
`pending` às 23:34:13, e o heartbeat a fechou às **23:34:42 — exatamente os 30s
do timeout**. O dev agent seguiu trabalhando por mais de uma hora numa sessão
que o banco dava por encerrada, e isso envenena toda métrica por sessão:
duração, custo e "quantas terminaram bem" passam a ler um estado que não
descreve o que houve.

O terceiro é a mesma janela, um passo antes de qualquer um dos dois primeiros
existir: `AcceptHandoffUseCase` marca o handoff antigo como `accepted` e ativa
o próximo agente na hora, mas a ativação no engine é `GenServer.cast`
fire-and-forget — responde 201 antes de o agente sequer começar. O PO ativado
pelo handoff do Criativo roda um kickoff de até 12 iterações de LLM usando só
ferramentas `category: :direct` (`create_epic`/`create_story`/`create_task`),
que nunca geram `proposed_action`, e só oferece o handoff seguinte (o sinal 1)
no FIM do turno inteiro. Entre a ativação e esse fim, nem o sinal 1 nem o sinal
2 existiam — só o ping do canal Phoenix a cada 10s segurava a sessão, e
qualquer atraso maior que os 30s do timeout fechava a sessão com o PO ainda
gerando o backlog, quebrando a cadeia de handoff pela raiz: o handoff seguinte
acabava sendo oferecido numa sessão já `closed`, que não aceita mais nada.

`agent.status` (`working`/`idle`) é o que todo agente conversacional
(Criativo/PO/Arquiteto/Dev Lead/Infra) já narra nos limites de turno, e é
PERSISTIDO no event log, não só broadcastado no canal
(`Engine.Sessions.LiveBroadcast.agent_status/4`, [ADR 0021](../adr/0021-fechamento-4a-infra-e-painel.md))
— o mesmo sinal que o painel do time já lê para derivar o roster
(`conversationalStatus` em `apps/web/src/lib/agent-status.ts`). Reaproveitá-lo
aqui não exigiu evento novo nenhum: o terceiro sinal é o último `agent.status`
de CADA ator que já falou na sessão, e é genérico por tipo de evento — cobre
qualquer agente ativado por handoff, não só o PO.

A versão anterior desta regra dizia, por escrito, que incluir trabalho de agente
"sem um teste que prove a interação seria adivinhar". A execução produziu a
prova, e o teste agora existe.

**O que continua fora:** task `in_progress` sem ação pendente nem handoff nem
turno em aberto. O dev agent tem máquina de estados própria e retém o worktree
por conta dele; o sinal que a api possui e que a execução comprovou é a ação
pendente. Incluir a task exigiria a api ler `dev_agent_states`, que é do
engine — decisão de fronteira, não conserto de passagem. Os dev agents também
não emitem `agent.status` (rodam com máquina de estados própria, não com o
loop conversacional de turno) — o terceiro sinal não os cobre, e não precisa:
a ação pendente já cobre o caminho deles.

- **Onde:** `apps/api/src/application/use-cases/sessions/get-session-pending-work.use-case.ts`,
  `apps/api/src/application/ports/session-event-repository.port.ts`
  (`listByTypeInSession`), `apps/engine/lib/engine/sessions/session_server.ex`
  (`handle_info(:heartbeat_timeout, …)`)
- **Teste:** `apps/engine/test/engine/sessions/session_lifecycle_test.exs`
  (`heartbeat NÃO encerra sessão com trabalho pendente` e o caso oposto) e
  `apps/api/test/application/use-cases/sessions/get-session-pending-work.use-case.spec.ts`
  (os três sinais, a ação já decidida que NÃO segura, o `idle` que libera, o
  isolamento por ator, a genericidade por tipo de agente e o escopo por
  sessão)
- **Origem:** execução real da FASE 13b; achado V, Fase H do
  [backlog](../explanation/backlog.md); bug real do encadeamento
  Criativo→PO→Arquiteto

### RN-063 — Encerrar sem produzir é desfecho, não falha {#rn-063}

A Anamnese tem uma ferramenta para dizer **"não há nada a emitir, e este é o
motivo"** (`skip_proficiency`). A rodada encerra com `anamnese.run_skipped` e o
motivo no payload — nunca com `anamnese.run_failed`.

Antes ela não tinha esse verbo. A única ferramenta era `emit_proficiency`, que
recusa lista vazia (com razão: perfil vazio não é perfil). Numa janela sem
membro elegível a Anamnese descobria isso na PRIMEIRA iteração, escrevia em
prosa "não há membros elegíveis", chamava `emit_proficiency` com `profiles: []`,
era recusada — e repetia até o teto de iterações. Cada volta reenvia o
histórico, que cresce a cada volta.

Numa execução real isso custou **145 mil tokens de entrada e 4× o gasto do
Criativo e do PO somados**, sem produzir nada. E voltava a cada tick do
agendador, a cada 15 minutos, para sempre.

O teto de iterações funcionava — não era laço infinito. O desperdício era **por
rodada, repetido indefinidamente**, que é pior: um laço trava e alguém percebe;
este sangrava devagar.

Narrar `run_failed` para uma rodada que fez a coisa certa também é defeito: quem
lê o log aprende a ignorar o evento de falha.

- **Onde:** `apps/engine/lib/engine/anamnese/tools/skip_proficiency.ex`,
  `apps/engine/lib/engine/anamnese/hooks/termination.ex`,
  `apps/engine/lib/engine/workers/anamnese_worker.ex` (`handle_outcome`)
- **Teste:** `apps/engine/test/engine/workers/anamnese_worker_test.exs`
  (`encerrar sem perfis é DESFECHO: narra run_skipped com o motivo, não falha`)
- **Origem:** execução real da FASE 13b

### RN-062 — Mensagem a agente conversacional REIDRATA o processo {#rn-062}

Uma mensagem endereçada a Criativo, PO ou Arquiteto sobe o processo se ele não
estiver de pé, antes de entregar. O `init` de cada servidor já reconstrói o
histórico do event log; faltava quem o chamasse.

Antes, um restart do engine matava a conversa em silêncio: a sessão sobrevivia
como `active`, o processo do agente não, e a próxima mensagem morria com
`GenServer.call ... exited` — sem evento, sem erro na tela, sem nada. O usuário
via a própria mensagem aparecer e nenhuma resposta chegar, para sempre.

O comentário de `revise/2` dizia que agente morto nesta rota "é um bug". É — e
basta o engine reiniciar para acontecer. É a mesma garantia que a Fase 12b deu
aos dev agents, aplicada aos conversacionais.

- **Onde:** `apps/engine/lib/engine_web/controllers/agent_command_controller.ex`
  (`message/2`)
- **Teste:** coberto pela suite de agentes; a prova de execução está em
  docs/explanation/validacao-real.md
- **Origem:** execução real da FASE 13b

### RN-060 — O gasto das chaves é do owner, e só ele vê {#rn-060}

O relatório de consumo por credencial (`GET /workspaces/:id/credential-spend`)
exige **`owner`** no workspace. Não é `maintainer`: desde a
[RN-058](#rn-058) os agentes de todos os projetos gastam a credencial do dono,
e a fatura dele não é assunto de quem só opera um projeto.

O relatório agrupa por **provider**, porque é essa a unidade da credencial —
uma chave por provider, por pessoa. Um total único não bateria com fatura
nenhuma.

E separa **agente** de **pessoa**: as duas coisas saem da mesma chave desde a
RN-058, e "meus agentes estão caros?" é uma pergunta diferente de "eu uso muito
o chat?". Por isso este é o único agregado de custo do produto **sem** o filtro
`actor_kind = 'agent'` da [RN-038](#rn-038) — aqui a pergunta é quanto saiu da
chave, e o chat do próprio owner sai dela.

Gasto de credencial **já removida** continua no relatório, marcado: o consumo
aconteceu, e escondê-lo daria um total que não fecha com o extrato do provider.

Nenhum segredo atravessa: a resposta tem provider, tokens e custo — nunca a
chave, nem cifrada ([ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md)).

- **Onde:**
  `apps/api/src/application/use-cases/llm/get-credential-spend.use-case.ts`,
  `apps/api/src/interfaces/http/llm/budgets.controller.ts`,
  `apps/web/src/components/CredentialSpendSection.tsx`
- **Teste:** `test/application/use-cases/llm/get-credential-spend.use-case.spec.ts`
  (agrupa por provider; separa agente de pessoa; chave removida fica marcada);
  `apps/web/src/components/CredentialSpendSection.test.tsx`
- **Origem:** decisão do usuário junto com a RN-058

### RN-101 — O mesmo gasto, duas audiências: a fatura é do owner, o consumo é de quem gastou {#rn-101}

O produto responde **duas perguntas diferentes** sobre `token_usage`, e nenhuma
é recorte da outra.

**A do owner é por CREDENCIAL.** `GET /workspaces/:id/credential-spend` continua
como a [RN-060](#rn-060) o deixou — por provider, exigindo `owner`, respondendo
"quanto saiu da minha chave". Junto dele, `GET /workspaces/:id/spend-report`
(também `owner`) quebra o workspace por **modelo, provider, projeto, ator e
dia** — o eixo de provider entrou pela [RN-186](#rn-186). O owner vê os dois
porque é a única pessoa que pode ver os dois.

**A do membro é por ATOR.** `GET /projects/:id/spend/me` (papel `viewer`)
devolve, em tokens e custo **estimado**, o que **quem chamou** consumiu naquele
projeto, por sessão e por dia. Ela **não quebra por provider nem por
credencial** — a chave que rodou é a do owner ([RN-058](#rn-058)), e uma fatia
da fatura dele não é o que o membro está perguntando.

O ator **não é parâmetro**: sai do usuário autenticado, e não existe onde
escrever o id de outra pessoa. "Membro não vê linha de outro ator" é propriedade
da assinatura do caso de uso, não uma checagem que alguém pode esquecer de
chamar.

**Agente não entra na conta do membro.** `token_usage` registra quem GASTOU, não
quem mandou gastar; atribuir o agente a quem o iniciou seria inventar um dado
que a tabela não tem. Gasto de agente aparece no relatório do owner, de quem é a
chave.

**O eixo de `provider` existe, e o membro não o alcança.** Até o
[ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md) ele simplesmente
não existia na agregação, e era a ausência que continha a visão do membro. Hoje
`sumGroupedBy` tem seis dimensões (`model`, `provider`, `project`, `actor`,
`session`, `day`) e a contenção mudou de forma, não de força: quem contém é o
TIPO — ver [RN-186](#rn-186) e [RN-187](#rn-187). O que não mudou é que dois
providers servindo o mesmo nome de modelo continuam caindo numa linha só na
dimensão `model`.

- **Onde:**
  `apps/api/src/application/use-cases/llm/get-my-spend.use-case.ts`,
  `apps/api/src/application/use-cases/llm/get-workspace-spend-report.use-case.ts`,
  `apps/api/src/application/ports/token-usage-repository.port.ts`,
  `apps/api/src/interfaces/http/llm/spend.controller.ts`,
  `apps/web/src/routes/ProjectSpendTab.tsx`
- **Teste:** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  (o membro não enxerga linha de outro ator, nem de agente, nem do owner; o
  filtro é pelo par `(kind, id)`; a resposta não carrega provider);
  `apps/web/src/routes/ProjectSpendTab.test.tsx`
- **Origem:** [ADR 0063](../adr/0063-duas-audiencias-para-o-mesmo-gasto.md) (FASE 22),
  revisto pelo [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-186 — `provider` é dimensão do relatório do owner, e só dele {#rn-186}

`sumGroupedBy` aceita `provider` como dimensão, e
`GET /workspaces/:id/spend-report` devolve a lista `porProvider` ao lado de
modelo, projeto, ator e dia. O [ADR 0063](../adr/0063-duas-audiencias-para-o-mesmo-gasto.md)
tinha deixado o eixo de fora; o [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)
o devolveu **sem revogar o argumento**: quebrar gasto por provider continua
sendo quebrar por CREDENCIAL, e por isso o eixo mora numa rota que já exige
`owner` ([RN-060](#rn-060)) — a mesma régua de `credential-spend`, que segue
respondendo a pergunta da FATURA (por mês, com o vínculo à chave que existe
hoje).

`GET /projects/:id/spend/me` **não ganhou nada**. A assimetria é o desenho: as
duas respostas continuam não sendo recorte uma da outra ([RN-101](#rn-101)).

A dimensão `model` **não mudou**: dois providers servindo o mesmo nome de modelo
continuam numa linha só. Quem quer a quebra por credencial tem a lista própria,
e cruzar as duas dimensões multiplicaria as linhas do ranking sem responder
pergunta que as duas listas separadas já não respondam.

- **Onde:** `apps/api/src/application/ports/token-usage-repository.port.ts:123`
  (`SpendDimension`),
  `apps/api/src/infrastructure/persistence/drizzle/token-usage.repository.ts:245`
  (o `GROUP BY`), `apps/api/src/application/use-cases/llm/get-workspace-spend-report.use-case.ts:112`,
  `apps/api/src/interfaces/http/llm/spend.controller.ts:56`
- **Teste:** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  ("quebra por PROVIDER, e o mesmo nome de modelo em dois providers segue UMA
  linha")
- **Origem:** [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-187 — A visão do membro não alcança `provider`, e quem garante é o TIPO {#rn-187}

Enquanto o eixo não existia, o que continha a visão do membro era a **ausência**
de argumento a passar. Com o eixo de volta, a contenção passou a ser da
assinatura: `sumGroupedBy` tem **duas sobrecargas**, e a que aceita um escopo com
`actor` — o da audiência do membro, e o único que ele tem — só recebe
`SpendDimensionDoAtor`, que é `Exclude<SpendDimension, 'provider'>`.
`sumGroupedBy('provider', escopoComAtor)` **não compila**.

Nem o repositório nem o caso de uso têm `if` sobre essa combinação, de
propósito: uma checagem em tempo de execução daria a impressão de que a garantia
é dinâmica, quando quem a sustenta é o compilador — e um `if` é o tipo de coisa
que a próxima refatoração remove sem que nenhum teste fique vermelho.

A barreira é dupla e as duas metades são independentes: a rota do membro
**também não tem parâmetro de dimensão** (só `projectId` e `dias`), então uma
query inventada como `?dimensao=provider` é descartada pelo Nest antes de
chegar ao handler.

`Exclude` em vez de uma segunda lista escrita à mão é deliberado: dimensão nova
nasce alcançável pelas duas audiências, e tirá-la do alcance do membro vira ato
explícito **neste ponto** — nunca um esquecimento em outro arquivo.

- **Onde:** `apps/api/src/application/ports/token-usage-repository.port.ts:107`
  (as duas sobrecargas), `:138` (`SpendDimensionDoAtor`), `:154`/`:164` (os dois
  escopos), `apps/api/src/application/use-cases/llm/get-my-spend.use-case.ts:73`,
  `apps/api/src/interfaces/http/llm/spend.controller.ts:98`
- **Teste:** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  ("não compila pedir `provider` com escopo de ator" — um `@ts-expect-error` que
  o `tsc` reprova como diretiva NÃO USADA se a barreira cair; e "só pede as
  dimensões `session` e `day`"),
  `apps/api/test/interfaces/spend.controller.spec.ts` (a rota do membro aceita
  `dias` e mais nada)
- **Origem:** [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-188 — Pessoa e agente são partição da lista por ator, sem consulta a mais {#rn-188}

O relatório do owner traz `porOwner` (linhas de `actor_kind = 'user'`) e
`porAgente` (`actor_kind = 'agent'`) além de `porAtor`, que continua inteira.
Os dois blocos são **derivados** de `porAtor` no caso de uso — `actorKind` já
vem na linha desde a FASE 22 —, e não duas consultas com `where actor_kind`.
O motivo é medido: o [ADR 0063](../adr/0063-duas-audiencias-para-o-mesmo-gasto.md)
mostrou que o custo destas consultas cresce com o tamanho de `token_usage` e
não com o do pedido, então varrer a janela duas vezes a mais para separar o que
já está separado em memória seria caro pelo motivo errado.

`actor_kind` que não seja pessoa nem agente (hoje, `system`) **não entra em
nenhum dos dois blocos** e continua visível em `porAtor` e no total. Abrir um
terceiro bloco para ele diria que o produto tem uma audiência que ele não tem.

O rótulo "Por owner" é do handoff de design e vale pela [RN-058](#rn-058) — é a
chave do owner que todas essas linhas gastam. Quem é o dono do workspace
continua sendo o campo `ownerId`, não o `actorKind` de cada linha.

- **Onde:** `apps/api/src/application/use-cases/llm/get-workspace-spend-report.use-case.ts:120`
- **Teste:** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  ("separa PESSOA de AGENTE em dois blocos, sem perder a lista por ator")
- **Origem:** [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-102 — O modelo da área é padrão herdável; divergir é decisão do agente, e voltar a herdar apaga a decisão {#rn-102}

A cascata de binding ganhou um nível: `sessão > agente > **área** > projeto >
workspace`. `area` fica ENTRE agente e projeto — é o PADRÃO que o lead e os
subagentes de uma área compartilham (`qa`/`qa-automacao`/
`qa-performance-seguranca`, `infra`/`infra-workflows`, `dev`/`dev-<módulo>`), e
o binding do próprio agente é a DIVERGÊNCIA que o sobrepõe. Se a área viesse
ACIMA do agente ela venceria sempre, e "padrão herdável" seria, na prática,
"padrão imposto" — nenhum agente conseguiria escolher outro modelo.

O nível novo entra na MESMA revalidação de capability da
[RN-041](#rn-041)/[RN-043](#rn-043): modelo da área que sumiu do provider ou
que não faz tool calling é PULADO e registrado em `skipped`, exatamente como
`agent` já era. `assertModelFitsBindingScope` (RN-040) passou a exigir
`supports_tool_calling` também no escopo `area` — ela nunca é lida por chat
humano, só por agente, então deixá-la passar adiaria a mesma falha silenciosa
em um nível.

**"Voltar a herdar" apaga o binding, nunca copia o modelo do nível de baixo
para o de cima.** Gravar no agente o modelo que a área decidiu pareceria igual
na tela e não é: viraria uma CÓPIA, e a próxima mudança da área deixaria esse
agente para trás sem ninguém notar. Herdar é a AUSÊNCIA de decisão própria, e
desfazer uma divergência é remover a linha — `DELETE
/projects/:id/agent-bindings/:slug` e `DELETE
/projects/:id/area-bindings/:key`, ambos 204, ambos 404 quando o escopo já
herda (idempotência que MENTIRIA se fosse 204 silencioso: apagar o que não
existia e apagar de verdade são respostas diferentes para a mesma tela).

Mudar o modelo da ÁREA exige `maintainer`, e não `developer` como o do agente
individual — pelo mesmo motivo do teto de paralelismo
([RN-083](#rn-083)): o binding da área alcança o lead e TODOS os subagentes de
uma vez, e escolher modelo é decidir quanto o produto gasta sem perguntar.

- **Onde:** `apps/api/src/domain/llm/binding-resolver.ts` (precedência),
  `apps/api/src/domain/llm/model-capabilities.ts` (capability de `area`),
  `apps/api/src/application/use-cases/llm/resolve-model-binding.use-case.ts`
  (a área do agente sai do catálogo `agent-areas.ts`, sem round-trip ao
  banco), `apps/api/src/application/use-cases/llm/clear-model-binding.use-case.ts`,
  `apps/api/src/interfaces/http/llm/model-bindings.controller.ts`
  (`area-bindings`, `DELETE` em `agent-bindings` e `area-bindings`),
  `apps/web/src/routes/ProjectSettingsTab.tsx` (`AreaModelsSection`, coluna
  Origem com "voltar a herdar")
- **Teste:** `test/domain/llm/binding-resolver.spec.ts`,
  `test/domain/llm/model-capabilities.spec.ts`,
  `test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`,
  `test/application/use-cases/llm/clear-model-binding.use-case.spec.ts`,
  `apps/web/src/routes/ProjectSettingsTab.test.tsx`
- **Origem:** [ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md) (FASE 23)

### RN-103 — O binding de agente é POR PROJETO, não mais global {#rn-103}

Até a FASE 23, `scope = 'agent'` guardava um SLUG global
(`scope_id = 'qa'`), e `PUT /projects/:id/agent-bindings/:slug` recebia
`:projectId` na rota e o DESCARTAVA de propósito — escolher o modelo do
Arquiteto na tela de um projeto mudava o modelo dele em TODOS os projetos.
Isso deixou de se sustentar quando a área virou padrão herdável (RN-102): a
área é por projeto, e um binding de agente global ACIMA de um padrão por
projeto faria o mesmo agente resolver modelos diferentes só onde existisse
área — e faria "voltar a herdar" apagar uma decisão que alcançava projetos
que ninguém está olhando.

A saída foi tornar `agent` por projeto também, e não rebaixar a área para
abaixo do agente: `scope_id` de `agent` e de `area` virou COMPOSTO —
`<projectId>:<slug do agente|chave da área>` — em vez de inventar uma tabela
nova só para guardar um projeto por binding. UUID de projeto e slug de agente
nunca contêm `:`, o que torna o primeiro `:` um separador não ambíguo; a
leitura corta nele, e não em todos, para um slug com `:` (nenhum existe hoje,
mas nada impede) não virar três pedaços.

`scope_id` sem o projeto (o formato antigo) é RECUSADO na escrita, não aceito
e ignorado: gravá-lo criaria um binding que a cascata nunca mais encontraria
— invisível, e não um erro. A migração 0040 espalha cada binding de agente
global existente para uma linha por projeto (preservando o que cada projeto
resolvia antes da mudança) e apaga o formato antigo; é ESPALHAR e não
apagar porque a linha global nunca guardou informação de a quem "pertencia" —
inventar um projeto dono seria inventar dado que não existia.

- **Onde:** `apps/api/src/domain/llm/binding-scope-id.ts` (formato e
  validação), `apps/api/src/application/use-cases/llm/set-model-binding.use-case.ts`
  (`workspaceDoEscopo` passou a derivar o workspace de `agent`/`area` também —
  a curadoria da RN-043 não era verificável neles antes), `apps/api/src/db/migrations/0040_tearful_night_nurse.sql`
- **Teste:** `test/domain/llm/binding-scope-id.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`,
  `test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`
  ("o binding de agente é POR PROJETO: o vizinho não o enxerga")
- **Origem:** [ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md) (FASE 23)

### RN-059 — Falha de turno é evento durável com origem, e o agente fala {#rn-059}

Quando um turno de LLM falha, o agente grava **`agent.error`** no event log
com três campos: `origem` (vocabulário do ADR 0020), `mensagem` em português e
o `reason` bruto. E a mensagem aparece **no fio da conversa**, não só no log.

Era o contrário, e o desfecho era o pior possível: os quatro agentes
conversacionais gravavam `agent.response` com conteúdo **vazio** —
indistinguível de sucesso no log imutável — e mandavam o motivo por
`broadcast`, que é efêmero. Quem não estivesse com a aba aberta naquele
segundo nunca saberia que houve erro; quem estivesse, via um balão em branco.

Havia um segundo caminho, pior ainda: quando a api narrava a falha no PRÓPRIO
frame final (budget, credencial ausente, binding faltando), o turno não caía no
ramo de erro e **não emitia evento nenhum** — silêncio absoluto.

Esse mesmo ramo, uma vez corrigido, custou uma segunda rodada: no PO, no
Arquiteto e no Dev Lead ele devolvia `{state, ""}` — uma TUPLA onde todos os
outros ramos de `run_turn` devolvem o `state` (um mapa). O `Map.put/3` de
`TurnoAssincrono.tratar_resultado/2` levantava `BadMapError` dentro do
`handle_info`, e como os quatro conversacionais são `restart: :temporary`, o
agente MORRIA e não voltava. A falha deixava de ser silenciosa e virava uma
queda — com os gatilhos mais corriqueiros que existem. A regra vale inteira: o
agente narra a falha **e continua de pé**. Por isso `tratar_resultado/2` tem
uma segunda barreira, no ponto compartilhado pelos quatro: resultado de turno
que não é mapa vira `agent.error` com origem `codigo`, nunca um processo morto.

A origem NUNCA é adivinhada: cada padrão em `FalhaDeTurno.origem/1` tem um
motivo escrito, e o que não casa com nenhum sai como **`codigo`** — a lacuna é
do nosso classificador, e essa é a origem que aponta a ação certa (ADR 0020).

Os eventos já gravados não se apagam — a tela os NOMEIA como resposta vazia
anterior a esta regra, em vez de mostrar branco.

- **Onde:** `apps/engine/lib/engine/agents/falha_de_turno.ex`,
  `criativo_server.ex`, `po_server.ex`, `arquiteto_server.ex`,
  `dev_lead_server.ex`, `infra_lead_server.ex` (`emit_falha/2`),
  `turno_assincrono.ex` (`tratar_resultado/2`, a segunda barreira),
  `apps/web/src/lib/session-falha.ts`
- **Teste:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  (evento durável com origem; nunca grava resposta vazia; erro narrado no frame
  final também vira evento); `po_server_test.exs` (o frame final com erro não
  derruba o agente — GenServer de VERDADE, com `Process.alive?/1`);
  `arquiteto_server_test.exs` e `dev_lead_server_test.exs` (mesmo caminho, ciclo
  completo); `turno_assincrono_test.exs` (a segunda barreira narra em vez de
  derrubar); `apps/web/src/lib/session-falha.test.ts`
- **Origem:** execução real da FASE 13b

### RN-116 — Falha ao CRIAR um handoff não derruba o agente {#rn-116}

`confirm_readiness` (Criativo → PO) e `offer_infra_handoff`/`offer_dev_handoff`
(Arquiteto → Infra/Dev Lead) chamam a api pra criar o handoff DEPOIS de o
turno já ter rodado — no caso do Criativo, depois de o `product_brief` já
estar gravado no event log. Se essa chamada falhar (api fora, 5xx, etc.), o
handoff não existe, mas isso NUNCA derruba o GenServer do agente: a falha vira
`agent.error` durável, com `origem` (`FalhaDeTurno.origem/1`) e uma mensagem
que diz o que JÁ foi salvo (o product_brief, as regras) e o que não foi (o
handoff) — para o usuário saber que confirmar de novo é seguro, não repete
trabalho.

Era o oposto: as três chamadas usavam `{:ok, _handoff} = EngineApiClient.create_handoff(...)`
— um match rígido. `{:error, _}` virava `MatchError`, e como os três agentes
sobem com `restart: :temporary` num `DynamicSupervisor` `:one_for_one`, o
processo simplesmente SUMIA — sem `agent.error`, sem resposta no fio, só
silêncio. Do lado de quem observava: a informação (regras, product brief)
parecia ter "passado" (estava gravada), mas nada iniciava do lado do agente
seguinte, porque o handoff nunca chegou a existir. Reabrir a conversa não
resolvia sozinho — só uma NOVA mensagem reativa o processo (rehidratando do
event log), e só uma nova confirmação de prontidão tenta o handoff de novo.

A mensagem NÃO reusa `FalhaDeTurno.mensagem/1` (a de `RN-059`, "não consegui
completar este turno... nada foi gasto"): nos três call sites o trabalho já
rodou (ou nem precisava rodar, no caso de `offer_dev_handoff`) — dizer "nada
foi gasto" seria falso quando tokens já tinham sido gastos no turno de
consolidação. Reusa só `FalhaDeTurno.origem/1`, que classifica pelo FORMATO
do motivo (status HTTP, exceção de transporte), não por ser turno de LLM.

O `Engine.Harness.Tools.OfferHandoff` (a ferramenta que o PO usa via tool
call, dentro do ToolLoop) já tratava `{:error, reason}` sem crashar — o
defeito era só nestes três handlers server-driven, que chamam
`EngineApiClient.create_handoff/5` DIRETO em vez de passar pela ferramenta.

- **Onde:** `apps/engine/lib/engine/agents/criativo_server.ex`
  (`handle_call(:confirm_readiness, ...)`, `emit_falha_handoff/3`),
  `apps/engine/lib/engine/agents/arquiteto_server.ex`
  (`handle_call(:offer_infra_handoff, ...)`, `handle_call(:offer_dev_handoff, ...)`,
  `emit_falha_handoff/3`)
- **Teste:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  ("prontidão: falha ao criar o handoff NÃO derruba o processo, e vira
  agent.error durável"); `apps/engine/test/engine/agents/arquiteto_server_test.exs`
  (as quatro variantes de `offer_infra_handoff`/`offer_dev_handoff`, sucesso e
  falha)
- **Origem:** relato de uso real no projeto `exp-001` (Criativo → PO); a
  mesma falha estrutural foi achada por leitura de código nos dois handoffs
  do Arquiteto, sem reprodução separada para eles

### RN-058 — A chave que o AGENTE gasta é a do owner do workspace {#rn-058}

Credencial de LLM pertence a uma pessoa (`user_credentials.user_id`), e agente
não é pessoa. O turno de agente resolve a chave pelo **owner do workspace**
(`workspaces.created_by`), não por quem abriu a sessão nem por quem criou o
projeto: quem banca a conta banca os agentes, e isso não muda quando outra
pessoa da equipe começa a sessão.

`created_by` e não `workspace_members.role = 'owner'`: pode haver vários
owners, e "qualquer um deles" faria a chave usada variar sem ninguém decidir.

Antes disto o turno passava o **slug do agente** (`agentId ?? sessionId`) na
coluna de usuário. A consulta ia ao banco com `user_id = 'criativo'`, o
Postgres recusava o UUID inválido, e o erro virava **resposta vazia** no fio —
sem métrica, sem evento de falha, sem nada na tela. O efeito prático, que só
uma execução real revelou: **nenhum agente jamais usou um provider com
credencial**. Só `ollama` funcionava, porque para ele a busca é pulada — e foi
com modelo local que a Fase 4, o dogfooding da Fase 10 e todas as demos
rodaram.

O chat humano nunca teve o defeito: ele usa `actor.id`, que é o usuário de
verdade.

- **Onde:**
  `apps/api/src/application/use-cases/llm/resolve-credential-owner.use-case.ts`,
  `apps/api/src/application/use-cases/llm/stream-llm-turn.use-case.ts`,
  `apps/api/src/application/use-cases/llm/run-llm-turn.use-case.ts`
- **Teste:** `test/application/use-cases/llm/resolve-credential-owner.use-case.spec.ts`
  (o owner vence quem criou o projeto; a chave encontrada é a dele; projeto
  inexistente é 404 e não erro de banco)
- **Origem:** execução real da FASE 13b

### RN-056 — Faceta de capability vem do provider; silêncio preserva o que estava {#rn-056}

`supports_vision`, `supports_reasoning` e `generates_image` são **fato do
provider**, não opinião: saem do catálogo remoto no sync, com o mesmo fallback
de `supports_tool_calling` — remoto, depois local, depois `false`.

No OpenRouter (o único que publica isso hoje) as três saem de:
`architecture.input_modalities` contém `image`,
`supported_parameters` contém `reasoning`, e
`architecture.output_modalities` contém `image`. Aceitar imagem e **produzir**
imagem são eixos distintos: fundi-los mandaria o usuário para o modelo errado.

Antes, o sync lia `supportsVision` do que já estava GRAVADO e nunca consultava
o remoto — a coluna nascia `false` e não havia caminho para virar verdadeira.
Os 338 modelos do primeiro sync real ficaram todos `false`, incluindo 181 que o
provider declara como multimodais.

**Ausência de declaração não é declaração de ausência**
([ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)): o
parser OMITE o campo quando o provider se cala, e `undefined` preserva o valor
local. Por isso a tela usa as facetas só como filtro POSITIVO e nunca escreve
"não lê imagem" — `false` aqui quer dizer "o provider não declarou".

- **Onde:** `apps/api/src/infrastructure/llm/openrouter-provider.ts`
  (`temModalidade`, `parseCatalogoOpenRouter`),
  `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts`,
  `apps/api/src/db/schema.ts` (`models`)
- **Teste:**
  `test/infrastructure/llm/openrouter-provider.contract.spec.ts`
  (`modalidade não declarada OMITE o campo em vez de afirmar false`);
  `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`
  (`catálogo que se cala sobre modalidade preserva a faceta gravada`)
- **Origem:** [ADR 0051](../adr/0051-facetas-de-capability-e-curadoria-por-uso.md)

### RN-057 — "Para que serve" é curadoria do workspace, e marcar uso não liga o modelo {#rn-057}

Nenhum catálogo de provider publica "bom para código". Isso é **opinião de quem
opera**, descoberta usando — então mora em `workspace_models.uses`, ao lado da
outra decisão do workspace ([RN-052](#rn-052)), e não em `models`.

Vocabulário FECHADO — `codigo`, `documentacao`, `analise`, `imagem`,
`conversa` —, com prova de exaustividade em tempo de compilação nos dois lados.
Texto livre daria `code`, `coding` e `código` no mesmo filtro em uma semana.

Duas regras que mantêm os eixos separados:

1. **Marcar uso não liga o modelo.** `workspace_models.is_active` tem DEFAULT
   `true`, então a linha criada por uma marcação de uso é inserida com
   `is_active = false` explícito. Sem isso, opinar sobre um modelo o autorizaria
   a gastar, contra a [RN-043](#rn-043).
2. **Trocar o uso não desliga o que estava ligado.** `is_active` fica fora do
   `SET` do `ON CONFLICT`.

A lista de usos **substitui** a anterior, não soma: lista vazia é como se
desmarca tudo, e é um estado legítimo — "ninguém opinou" não é "não serve".

- **Onde:** `apps/api/src/domain/llm/model-uses.ts`,
  `apps/api/src/db/schema.ts` (`workspace_models.uses`),
  `apps/api/src/infrastructure/persistence/drizzle/workspace-model.repository.ts`
  (`setUses`),
  `apps/api/src/application/use-cases/llm/set-model-uses.use-case.ts`
- **Teste:** `test/application/use-cases/llm/set-model-uses.use-case.spec.ts`
  (`marcar uso NÃO liga o modelo — a linha nova nasce inativa`,
  `trocar o uso não desliga o que já estava ligado`,
  `o uso vale só neste workspace`)
- **Origem:** [ADR 0051](../adr/0051-facetas-de-capability-e-curadoria-por-uso.md)

### RN-038 — Agente contado no resumo do workspace = gastou tokens este mês {#rn-038}

O resumo do dashboard de projetos ("N projetos ativos · M agentes · gasto
este mês") conta como "agente" quem tem pelo menos uma linha em
`token_usage` com `actor_kind = 'agent'` no mês corrente, somando todos os
projetos do workspace. Sem o filtro de `actor_kind`, um `user` mandando
chat ou um `system` registrando uso inflaria a contagem — `token_usage`
grava para qualquer tipo de ator, não só agente. O corte por mês usa
`created_at >= date_trunc('month', now())`; um agente que trabalhou só no
mês anterior não conta, mesmo que ainda apareça no roster de alguma
sessão. A contagem naturalmente inclui as subespecialidades de área da
Fase 8 (`qa-automacao`, `qa-performance-seguranca`, `infra-workflows`):
cada uma tem seu próprio `actor_id` quando gasta tokens.

- **Onde:** `apps/api/src/infrastructure/persistence/drizzle/token-usage.repository.ts`
  (`summarizeForWorkspaceThisMonth`)
- **Teste:** `test/application/use-cases/iam/get-workspace-summary.use-case.spec.ts`

---
