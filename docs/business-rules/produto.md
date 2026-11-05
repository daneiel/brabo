---
id: rn-produto
title: 'Regras de negócio — Produto'
sidebar_label: Produto
description: 'As RNs hospedadas na raiz produto.'
keywords: [regras de negócio, produto]
---

# Produto

## Backlog

### RN-012 — A module removed from `module_map` demotes the story {#rn-012}

A story linked to a module that ceased to exist goes back to `draft`, with
a `backlog.story_demoted` event.

- **Where:** `apps/api/src/domain/architecture/module-resolution.ts`; the
  event is emitted in
  `application/use-cases/architecture/create-module-map.use-case.ts:73`
- **Test:** `test/domain/architecture/module-resolution.spec.ts`

## Painel de projetos

### RN-096 — Toda decisão diz em português o que acontece; o payload cru nasce colapsado {#rn-096}

Todo tipo de `proposed_action` tem uma **frase em português** que descreve o
efeito de aprovar, e ela é a primeira coisa visível no card — antes de qualquer
detalhe, nas três telas onde uma decisão é pedida (a fila de Aprovações, o card
dentro do chat da sessão e a aba Insights). O payload cru continua acessível,
**dentro de um colapso que nasce fechado**, e nunca é despejado na tela.

**O que existia era um despejo.** Todo tipo sem corpo visual próprio caía num
`Object.entries(payload).map(([k, v]) => k + ': ' + JSON.stringify(v))`, sempre
aberto. Quem abria a fila lia `worktree: /workspaces/dev-api`,
`coAuthor: Brabo User <user@brabo.dev>` e `proposto: 4` — e tinha de deduzir o
que ia acontecer se clicasse em Aprovar. Aprovação que exige dedução é
aprovação que se dá no automático, e o produto inteiro se apoia em o usuário
ser a autoridade final.

**A frase degrada, e é isso que a torna confiável.** Nenhuma delas assume que
uma chave do payload existe: com payload vazio a frase continua sendo uma frase
verdadeira, só menos específica ("Registra um commit no repositório do
projeto."). O payload vem do engine e de dez casos de uso diferentes, e nenhum
deles promete um formato — frase que só funciona com a fixture certa é frase
que quebra na primeira aprovação real.

**Tipo que o web ainda não conhece não é caso teórico.** A união `ActionType`
do web já ficou defasada duas vezes: primeiro com os três tipos do bootstrap de
Gitflow, e de novo com `parallelize`/`raise_max_parallel`, que entraram na FASE
14d. O compilador não pega: a lista canônica está em `apps/api`, que o web não
importa. Por isso duas coisas ao mesmo tempo — o card **degrada** (verbo neutro
+ "ver detalhes", com o payload colapsado, em vez do `undefined` no mapa de
ícones que derrubava a árvore inteira do React), e o **teste lê o `decide.ts`
do backend** e reprova quando um tipo entra sem frase.

**O default de aberto/fechado é derivado, não configurado.** A regra é uma só —
abre o que ainda espera decisão de quem está olhando: no chat, ação `pending`;
na fila, nunca (são N cards, e N detalhes abertos são a mesma parede de texto);
em Insights, hipótese `proposed`. E o payload CRU não abre em variante nenhuma.
A consequência de projeto é que `ApprovalCard` **não ganhou prop nova
obrigatória**: o default sai de `variant` e `status`, que já existiam.

**Verbo e frase saem de um módulo só**, consumido pelas três telas. A hipótese
do Psicólogo usa literalmente o verbo do `instruction_patch` em vez de um
vocabulário paralelo — e a frase dela diz o que o accept faz de verdade
(enfileira para a Anamnese, que **pode** propor o ajuste, que ainda vem para
aprovação), nunca "a instrução será alterada".

**`write_file` tinha frase, mas não corpo.** Ele nasceu de fora de
`COM_CORPO_PROPRIO`: a frase mostrava só o `path`, e o detalhe caía no mesmo
despejo de JSON cru colapsado que esta RN existe para evitar — então um write
que genuinamente pedia aprovação (fora do prefixo `dev-`, ou caminho fora do
escopo do agente) exigia um clique a mais para ver o `content`. Entrou em
`COM_CORPO_PROPRIO` com corpo próprio: `path` e um preview do `content` (até
25 linhas/4.000 caracteres, com aviso de truncamento — nunca o arquivo
inteiro, mesma regra do payload cru), aberto por padrão no chat enquanto
pendente, igual `terminal`.

**Payload vazio não é payload ausente.** `command` (terminal) ou
`path`/`content` (write_file) chegando como string vazia — tool-call
malformada do modelo, não bug de renderização — degradava para um prompt
`$ ` ou um preview em branco, que o usuário lia como defeito da tela. Os dois
corpos agora distinguem os dois casos e mostram "o modelo não produziu um
X válido para esta ação" em vez de um branco.

- **Onde:** `apps/web/src/lib/aprovacoes.ts` (`VERBO_DA_ACAO`, `fraseDaAcao`,
  `descreverAcao`, `descreverHipotese`), consumido por
  `apps/web/src/components/ApprovalCard.tsx` (Aprovações + chat da sessão,
  `COM_CORPO_PROPRIO`, `previewConteudo` para o `content` de `write_file`) e
  `apps/web/src/components/HypothesisCard.tsx` (Insights); colapso pelo
  `Disclosure` de `apps/web/src/components/ui/Disclosure.tsx`
- **Teste:** `apps/web/src/lib/aprovacoes.test.ts` (lê `ACTION_TYPES` de
  `apps/api/src/domain/actions/decide.ts` e exige verbo + frase para cada tipo,
  com payload vazio); `apps/web/src/components/ApprovalCard.test.tsx`
  (`frase e colapso` — payload colapsado nas duas variantes, JSON legível ao
  abrir, tipo desconhecido não derruba a tela, `write_file` com corpo próprio
  aberto por padrão e truncamento do preview, `command`/`path`/`content`
  vazios mostrando a mensagem de fallback);
  `apps/web/src/components/HypothesisCard.test.tsx` (`frase e colapso`)
- **Origem:** FASE 19 do programa 16–26, do pedido "hoje está muito difícil a
  leitura" na primeira navegação real depois do reset do banco

---

## "N agentes online" no dashboard — status AO VIVO, nunca presença histórica (RN-409, ADR 0097)

Item do backlog anterior. Investigação prévia (`docs/explanation/backlog.md`)
confirmou que não existia agregado de liveness nenhum — nem por projeto, nem
por workspace: o que existia era só presença HISTÓRICA
(`RosterFacts` — "já apareceu na sessão alguma vez") e status ao vivo de
VERDADE só no cliente, derivado do event log, e só quando um projeto está
ABERTO (`deriveAgentRoster`). O card do dashboard hoje forçava
`() => 'ocioso'` porque não desenhava status nenhum — este é o hardcode que
a RN substitui.

### RN-409 — "N online" soma dois mecanismos pela MESMA régua: não ocioso, não travado {#rn-409}

`ProjectCardSummary.onlineAgentCount` (`GET /workspaces/:workspaceId/
projects-summary`) é a contagem de agentes ONLINE agora — trabalhando ou com
uma pendência esperando decisão —, nunca tamanho de equipe. Chamar de
"online" um número que na verdade é "já apareceu alguma vez" seria enganoso
(mesmo princípio dos [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)/
[0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)/
[0077](../adr/0077-ranking-de-modelos-por-capacidade-sem-nota-inventada.md) contra dado
fingido).

Duas FONTES, uma régua:

- **Dev agents** — `engine.dev_agent_states.status`, agregado em lote por
  `project_id` (`status NOT IN ('idle', 'idle_tripped')`). `working`,
  `awaiting_gate` e `awaiting_approval` contam (RN-047/ADR 0052 — os cinco
  estados da máquina do dev); `idle`/`idle_tripped` não. `dev-<modulo>` e
  `dev-<modulo>-2` são chaves DISTINTAS (`agent_id` na tabela), então contam
  separado sem esforço nenhum — é a própria chave primária que já separa.
- **Agentes conversacionais** (criativo/po/arquiteto/dev-lead/ux-designer/
  staff/infra) — último evento `agent.status` de cada `actor_id`, na sessão
  MAIS RECENTE do projeto (mesmo escopo de sessão que o resto de `RosterFacts`
  usa, RN-090). `agent.status` só tem três valores possíveis
  (`Engine.Sessions.LiveBroadcast.agent_status/4` recusa qualquer outro):
  `working`/`awaiting_approval` contam, `idle` não.

**QA/SecOps NUNCA contam** — não é filtro, é AUSÊNCIA de dado: nenhum dos
dois emite `agent.status` (rodam veredito único por invocação, sem noção de
"ocioso" entre chamadas — o status deles vem de `pr.gate_changed`/
`infra.gate_changed`, um mecanismo à parte que `deriveAgentRoster` já trata
separado). Não precisou de exclusão explícita: a consulta só soma o que tem
o tipo de evento certo.

A régua é a MESMA que `deriveAgentRoster` já aplicaria se o projeto estivesse
aberto (`'trabalhando'`/`'aguardando'` no cliente ≅ `working`/
`awaiting_gate`/`awaiting_approval` no backend) — os DOIS caminhos calculam
"online" a partir do mesmo eventual estado (event log/tabela de estado
persistida), só que por MECANISMOS diferentes (agregação SQL no backend,
dobra sobre eventos já buscados no cliente), no mesmo espírito de
`infraActive`/`uxDesignerActive`/`staffActive` (RN-090/RN-287: duas fontes,
uma régua). Não há função compartilhada entre `apps/api` e `apps/web` para
isto — os dois já divergem de linguagem/runtime para o resto de `RosterFacts`
também, e introduzir um pacote compartilhado só para uma contagem seria
peso maior que o problema.

**Consulta nova contra schema que a api não migra.** `engine.dev_agent_states`
é tabela do ENGINE (Ecto, schema Postgres `"engine"`), mesmo banco físico,
mesma conexão — não uma segunda fonte de dados, um segundo NAMESPACE no
mesmo Postgres. O precedente já existia: `apps/api/scripts/medir-execucao.ts`
já lê `engine.oban_peers` pelo mesmo caminho (raw SQL via Drizzle), só que
como SCRIPT manual, nunca testado. Esta RN eleva o padrão para código de
PRODUÇÃO testado — ver o [ADR 0097](../adr/0097-leitura-direta-do-schema-do-engine-para-online-agent-count.md)
para a decisão de NÃO expor isto como rota HTTP interna no engine.

**Custo medido, não fingido grátis.** As duas consultas novas levam o total
do read model de DOZE para CATORZE (RN-090 continua valendo — catorze é
CONSTANTE, provado por `projects-summary.repository.spec.ts` contando idas
ao banco com 2 e com 20 projetos). Nenhuma tem `WHERE` por tempo — a de
`agent.status` escaneia os mesmos `session_events` das sessões mais recentes
que `lastEvents`/`marcos` já escaneiam ao lado dela, então o custo marginal é
o de mais um filtro de `type` sobre um plano de consulta que já ia acontecer,
não uma tabela nova sendo varrida do zero. Lacuna DECLARADA: não há execução
real recente (dogfooding) com volume de produção para medir `ms` de verdade
contra a régua da Fase 22 (525 mil linhas, `EXPLAIN ANALYZE`) — as duas
consultas novas ficam sem número medido, só o argumento estrutural acima.

- **Onde:** `apps/api/src/application/ports/projects-summary-repository.port.ts`,
  `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`,
  `apps/api/src/interfaces/http/iam/dto/iam.response.dto.ts`,
  `apps/web/src/lib/api-types.ts`, `apps/web/src/components/ProjectCard.tsx`,
  `apps/web/src/routes/Dashboard.tsx`
- **Teste:** `apps/api/test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  (`describe('onlineAgentCount (RN-409)')` — dev agent working/idle/
  idle_tripped, awaiting_gate/awaiting_approval, duas instâncias do mesmo
  agente-base, agente conversacional working/idle/awaiting_approval, só o
  ÚLTIMO `agent.status` conta, QA/SecOps nunca contam, soma entre as duas
  fontes, isolamento entre projetos);
  `apps/api/test/support/global-setup.ts` (`ensureEngineFixture` — a tabela
  do engine criada como fixture MÍNIMA e declarada, só para o teste acima
  poder existir);
  `apps/web/src/components/ProjectCard.test.tsx` (badge "N online" some com
  `0`/`undefined`, aparece com `onlineAgentCount > 0`)
- **Origem:** `docs/explanation/backlog.md` (item herdado da FASE 13c/
  colheita do dogfooding); decisão de produto de que o número tinha de ser
  liveness de verdade, não presença histórica, registrada no prompt que
  encomendou esta correção

---

## O explorador de pasta do Runner vira três colunas, e a criação de um projeto `runner` deixa de esperar o passo final (RN-436/436)

### RN-451 — Smoke do binário standalone roda o SUBPROCESSO real, nunca mock {#rn-451}

O mesmo padrão de disciplina que `smoke-dist.mjs` (ADR 0106) já aplica ao
`dist/index.cjs` publicado no npm passa a valer também para
`dist-bin/brabo-runner-<platform>-<arch>[.exe]` (ADR 0112): nenhuma suíte
prova que um artefato EMPACOTADO funciona lendo o código-fonte dele — só
executando o artefato de verdade, como subprocesso, e observando saída
real. `scripts/smoke-bin.mjs` roda o binário COMPILADO (nunca
`node src/index.ts` nem qualquer forma não-compilada) com `--self-test-pty`
— uma flag interna, não documentada em `uso()` — que resolve `node-pty`
exatamente como produção e spawna um PTY real via `GerenciadorDePty`,
escrevendo e lendo dele. Só a linha `node-pty carregado com sucesso` +
`SELF_TEST_PTY_OK:` no stdout do processo real conta como prova; nenhum
mock de `node-pty` nem de `child_process` é aceitável para este teste
específico, porque o que ele existe para provar é justamente que o `.node`
nativo embutido (`with { type: 'file' }`, `native-pty-embed.generated.ts`)
carrega e funciona DENTRO do binário — mockar qualquer peça do caminho
apagaria a única coisa que o teste precisa provar.

- **Onde:** `apps/runner/scripts/smoke-bin.mjs`; `apps/runner/src/index.ts`
  (`rodarAutoTestePty`, a implementação de `--self-test-pty`)
- **Teste:** o próprio `smoke-bin.mjs` — não há teste unitário que o
  substitua, de propósito (é o mesmo desenho de `smoke-dist.mjs`, que
  também não tem par unitário)
- **ADR:** [0112](../adr/0112-binario-standalone-do-runner-via-bun-build-compile.md)
- **Origem:** requisito explícito do dono do produto para este item de
  backlog ("no mocking")

---

## Terminal do runner local preso em "Abrindo terminal..." para sempre (RN-433)

### RN-453 — `--dir` relativo do runner local resolve contra `INIT_CWD`, não contra o cwd rebaseado do pnpm {#rn-453}

`resolve(dirBruto)` em `lerArgumentos()` resolvia `--dir` relativo contra
`process.cwd()` — correto quando o CLI roda direto (binário standalone,
`npm install -g @brabo/runner`), mas ERRADO no único caminho de invocação
que existe hoje sem publicação real no npm (achado real, ADR 0106/backlog):
`pnpm --filter runner start` REBASEIA `process.cwd()` para a pasta do
PACOTE (`apps/runner`), não a pasta de onde o usuário digitou o comando.
`pnpm --filter runner start -- --dir ../exp001`, rodado de `~/dev/brabo`,
criava `~/dev/brabo/apps/exp001` em vez de `~/dev/exp001` — silenciosamente,
sem erro, porque RN-435 já faz `--dir` inexistente ser criado em vez de
recusado.

`resolverDir()` (`apps/runner/src/guard.ts`) resolve contra `INIT_CWD`
quando presente — a variável que npm/pnpm SEMPRE define com a pasta
original de invocação, existente só quando o processo nasce de um script
do `package.json` — e cai em `process.cwd()` quando ausente (binário
direto, onde já é a pasta certa). `resolve()` do Node já ignora a base
quando `dirBruto` é absoluto, então caminho absoluto (o caso documentado no
README) não muda de comportamento.

- **Onde:** `apps/runner/src/guard.ts` (`resolverDir`), `apps/runner/src/index.ts` (`lerArgumentos`)
- **Teste:** `apps/runner/src/guard.spec.ts` (`describe('resolverDir', …)`
  — relativo contra `INIT_CWD` quando presente, cai no cwd do processo
  quando ausente, absoluto ignora as duas bases)
- **ADR:** [0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
  (extensão aditiva, mesma categoria de RN-435 — reduz atrito de invocação,
  não muda o runner como fonte da verdade do caminho)
- **Origem:** achado em uso real, rodando `pnpm --filter runner start --
  dir ../exp001` de dentro do checkout do monorepo — o único caminho de
  invocação disponível hoje, porque `@brabo/runner` ainda não foi publicado
  de verdade no npm (`NPM_TOKEN` pendente, ver backlog do ADR 0106)

---

## A busca do RAG deixa rastro, e o rastro congela os pesos (RN-479..481)

### RN-481 — `rag.search`/`rag.feedback` são NARRAÇÃO da timeline, e só existem quando há sessão {#rn-481}

Os dois eventos entram no event log **apenas no caminho do agente** — a busca
da aba é de projeto e não tem sessão onde narrar. Isso é assimetria declarada,
não lacuna: **a tabela é a fonte da medição, o evento é narração**. Medir pelo
event log perderia metade das buscas, e justamente a metade com julgamento
humano.

Falha de narração não derruba nem a busca nem o voto: a linha da tabela já está
gravada, e é ela que a medição lê. A falha vira log com origem `infra`, nunca
silêncio.

`'rag'` entra em `PREFIXOS_DE_EVENTO` (`scripts/docs/generate.mjs`) no mesmo
commit — sem isso o inventário gerado de `docs/reference/events.md` não enxerga
os dois tipos, e `pnpm docs:check` ficaria verde sobre uma lista incompleta:
uma doc que passa mentindo é pior que uma doc que reprova.

- **Onde:** `apps/api/src/domain/rag/rag-telemetry.ts`
  (`EVENTO_RAG_SEARCH`/`EVENTO_RAG_FEEDBACK`),
  `apps/api/src/application/use-cases/rag/hybrid-search.use-case.ts`,
  `apps/api/src/application/use-cases/rag/record-rag-feedback.use-case.ts`,
  `scripts/docs/generate.mjs` (`PREFIXOS_DE_EVENTO`)
- **Teste:**
  `apps/api/test/application/use-cases/rag/hybrid-search.use-case.spec.ts`
  (narra com sessão; NÃO narra sem sessão),
  `apps/api/test/application/use-cases/rag/record-rag-feedback.use-case.spec.ts`
  (o mesmo par, para o voto)
- **ADR:** [0129](../adr/0129-telemetria-de-busca-do-rag-como-tabela.md)
- **Origem:** plano do dono do produto, Parte 2 / Etapa 1

### RN-485 — O broker de container não aceita especificação: ele recebe um projeto e COMPÕE {#rn-485}

O broker (`apps/broker`) é o único processo do produto com acesso a um daemon
Docker no servidor. A regra que o torna não-arbitrário não é um allowlist: é a
**forma da entrada**.

**Ele recebe `projectId` e uma das cinco operações — nada mais.** As cinco são as
da `DockerPort` do [ADR 0128](../adr/0128-porta-de-docker-e-a-prova-de-empacotamento.md)
(`start`, `stop`, `remove`, `inspect`, `exec`), e uma sexta é decisão de produto
com ADR, nunca um parâmetro a mais. `start`, `stop` e `remove` têm corpo VAZIO;
`exec` leva comando e `cwd`, e mais nada.

**A especificação é lida da api e COMPOSTA aqui.** O broker chama
`GET /internal/projects/:projectId/container-spec`, que devolve identidade do
projeto, modo de execução e a decisão de imagem vigente do Arquiteto. Imagem,
rede, recursos e o único mount saem daí. Não existe campo em que se escreva
`privileged`, `cap_add`, `network: host` ou um `-v` livre — porque não existe
campo. Se a especificação viajasse no corpo, a contenção de um processo
root-equivalente no host dependeria de o CHAMADOR estar correto, e contenção que
depende do chamador não é contenção.

**Ele revalida o que a api devolveu, e as duas validações não são a mesma.**
`validarDecisaoDeImagem` (api) pergunta "esta decisão de arquitetura é
revisável?" — exige `rationale`, recusa `latest`, aplica `RECURSOS_MAXIMOS` e
devolve a recusa ao MODELO pelo tool-result (RN-061). `especificacaoValidada`
(broker) pergunta "posso entregar isto ao daemon?" — é o PARSE de um JSON não
confiável para dentro do tipo fechado. Os tetos daqui são os do BROKER, o último
recurso que ele nunca ultrapassa venha o pedido de onde vier; hoje os números
coincidem com os da api de propósito, e se um dia divergirem o menor vence sem
nada quebrar, porque nenhum dos dois afirma ser o outro. Uma checagem existe só
deste lado: referência de imagem que começa com `-` seria lida pelo CLI como
FLAG, e `execFile` sem shell resolve injeção de COMANDO, não de ARGUMENTO.

**A api não manda CAMINHO nenhum.** O `-v` de um `docker run` é resolvido pelo
DAEMON, contra o filesystem do HOST — um caminho de dentro do container da api
faria o daemon criar e montar uma pasta VAZIA, com o dev agent trabalhando num
diretório sem código e nada indicando por quê. O broker compõe o caminho com
`PROJECT_WORKSPACES_HOST_ROOT`, configuração DELE, mais o `workspaceDirName`
congelado na criação (RN-109). Sem essa variável, `start` RECUSA nomeando-a; as
outras quatro operações continuam funcionando. Recusar é a regra: adivinhar
produziria o mount vazio em silêncio.

**Projeto `mounted`/`runner` é recusado com 409**, porque a pasta deles mora na
máquina do usuário e o host do broker não a enxerga — lá quem sobe container é o
runner. É a mesma política que `RegistrarTransicaoDeContainerUseCase` já aplica
na api, dita onde o broker consegue dizê-la.

**Nada dispara subida.** Não há laço, não há fila, não há `proposed_action` de
`container_start`: o broker age quando chamado, e o único chamador que existe
hoje faz LEITURA. Efeito externo continua exigindo aprovação.

- **Onde:** `apps/broker/src/operacoes.ts` (as cinco, e a composição em
  `especificacaoDoProjeto`), `apps/broker/src/servidor.ts` (a lista fechada de
  rotas e a tabela de status),
  `packages/docker-port/src/spec-de-container.ts` (o parse e os tetos),
  `apps/api/src/application/use-cases/containers/obter-spec-de-container.use-case.ts`
  (o que a api devolve, e o caminho que ela não devolve),
  `apps/api/src/interfaces/http/internal/internal-containers.controller.ts`
- **Teste:** `apps/broker/src/servidor.spec.ts` (imagem, rede, recursos e mount
  mandados no corpo são IGNORADOS; artefato com imagem que começa com `-` é 422
  e nada é tocado; uma sexta operação é 404; `cwd` fora de `/work` é recusado,
  inclusive `/workspace`; sem `PROJECT_WORKSPACES_HOST_ROOT` o `start` recusa
  dizendo qual variável falta),
  `packages/docker-port/src/spec-de-container.spec.ts` (o parse campo a campo),
  `apps/api/test/application/use-cases/containers/spec-e-observacao-de-container.use-case.spec.ts`
  (a api não devolve caminho nenhum, nem `rationale`),
  `apps/api/test/infrastructure/http-clients/container-broker.client.spec.ts`
  (`start` manda corpo vazio)
- **ADR:** [0130](../adr/0130-broker-de-container.md)

### RN-497 — O `brabo-runner` sobe o container do projeto NA MÁQUINA DO USUÁRIO, com o Docker DELE {#rn-497}

Fecha a metade que a RN-494 (ADR 0135) deixou declarada: `mounted`/`runner`
passaram a EXIGIR imagem decidida (o portão da RN-105 vale nos três modos),
mas continuavam sem subir container NENHUM — só `execution_mode: container`
tinha alguém (o broker, `apps/broker`) capaz de chamar Docker de verdade.
`container_start`/`container_stop`/`container_remove` (RN-491/495) agora têm
um SEGUNDO caminho de execução, ramificado pelo `executionMode` do projeto
dentro de `ExecuteContainerStartUseCase`/`ExecuteContainerStopUseCase`/
`ExecuteContainerRemoveUseCase` — nunca na PROPOSTA nem na APROVAÇÃO da
ação, que continuam agnósticas de modo (`decide.ts` não muda).

**`container` segue pelo broker, sem mudança nenhuma.** `mounted`/`runner`
pedem ao ENGINE (`ApiToEngineClient.startContainerViaRunner`/
`stopContainerViaRunner`/`removeContainerViaRunner`, síncrono como
`executeTerminalAction`) para repassar ao RUNNER conectado — o CLI que já
mantém o canal `terminal:<projectId>` (ADR 0103/0104) ganha TRÊS pares de
evento novos, `container_start`/`_result`, `container_stop`/`_result`,
`container_remove`/`_result` (`apps/runner/src/channel.ts`), no MESMO molde
de `exec`/`exec_result`: `Engine.Runners.RunnerRouter` despacha pro canal
correlacionado por `ref` e fica bloqueado em `receive`, o runner chama
`DockerViaCli.start/stop/remove` (`@brabo/docker-port`, ADR 0128) com o
DOCKER DO USUÁRIO — não o do servidor — e responde. `EngineWeb.
ContainerCommandController` (rotas `POST internal/projects/:projectId/
containers/{start,stop,remove}`) é o único chamador; nenhum outro caminho
alcança essas três operações do lado engine.

**A imagem que sobe não é ELEITA de novo** — ao contrário do caminho
`container`, que reusa `DecidirImagemDoProjetoUseCase` para gravar uma nova
versão de `artifact.project_image`. O caminho `mounted`/`runner` só LÊ a
decisão VIGENTE (`ObterSpecDeContainerUseCase`, o MESMO caso de uso que já
compõe `GET .../container-spec` para o broker — chamado direto, sem HTTP,
porque os dois rodam no processo da api) e a manda ao runner; sem imagem
decidida (RN-105), falha ANTES de perguntar ao engine.

**"Sem runner conectado" é FALHA NORMAL, nunca exceção genérica** — mesma
disciplina de `BrokerIndisponivelError`/`BrokerRecusouError` do caminho
`container`. `RunnerNaoConectadoError` (sem runner, ou timeout) e
`RunnerRecusouContainerError` (o runner respondeu e RECUSOU — Docker
indisponível na máquina do usuário, especificação inválida) são as duas
classes que `HttpApiToEngineClient` lança; os três casos de uso as capturam
e gravam `failed` com o motivo, nunca deixam propagar. Do lado engine, a
resposta é SEMPRE 200 — `sucesso: false` no corpo, com `motivoCodigo`
("not_connected"/"timeout") só quando o engine NEM CHEGOU a perguntar ao
runner (`RunnerRouter` devolveu `{:error, _}`), nunca um status HTTP de erro
para o que é falha normal do comando.

**`Engine.Actions.TerminalExecutor` NÃO ganhou saída nova.** A decisão
"rodar o comando no host ou dentro do container que este runner subiu" é
INTERNA ao runner — `decisao_de_execucao/1` já roteia INCONDICIONALMENTE
todo comando de projeto `runner` conectado para `RunnerRouter.exec/4`
(RN-423). O que muda é só `apps/runner/src/index.ts`: `EstadoDoRunner` ganha
`containerAtivo` (o NOME do container que ESTE runner subiu, ou `null`), e
`tratarExec` passa a rotear pra `DockerViaCli.exec` (via `docker exec`)
quando há container ativo, ou pro caminho de sempre (`executarComando`
direto no host) quando não há — o `cwd`, já validado por
`validarCwdDentroDaRaiz` contra a raiz do projeto, é traduzido pra dentro de
`/work` por troca de PREFIXO (`cwdParaContainer`, `guard.ts`), mesmo
raciocínio de `cwd_para_container/2` do lado engine (RN-492).

**`guard.ts` (contenção em `$HOME` no Linux, RN-434) passa a cobrir também o
caminho montado, sem NENHUMA validação nova.** O bind-mount do container É
`estado.dir` — a mesma raiz que `validarDirDentroDoHomeNoLinux` já validou
no startup da CLI, antes de qualquer container subir. Não existe uma
segunda checagem de "caminho de mount válido" porque não precisa existir: o
mount É a raiz confirmada, ponto.

- **Onde:** `apps/runner/src/channel.ts`, `apps/runner/src/index.ts`
  (`EstadoDoRunner.containerAtivo`, `tratarContainerStart/Stop/Remove`,
  `tratarExec`), `apps/runner/src/guard.ts` (`cwdParaContainer`),
  `apps/engine/lib/engine/runners/runner_router.ex`
  (`start_container/stop_container/remove_container`),
  `apps/engine/lib/engine_web/channels/terminal_channel.ex`,
  `apps/engine/lib/engine_web/controllers/container_command_controller.ex`,
  `apps/engine/lib/engine_web/router.ex`,
  `apps/api/src/application/ports/api-to-engine-client.port.ts`
  (`RunnerNaoConectadoError`, `RunnerRecusouContainerError`),
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`,
  `apps/api/src/application/use-cases/actions/execute-container-start.use-case.ts`,
  `apps/api/src/application/use-cases/actions/execute-container-stop.use-case.ts`,
  `apps/api/src/application/use-cases/actions/execute-container-remove.use-case.ts`
- **Teste:**
  `apps/runner/src/channel.spec.ts` (roundtrip dos três pares novos),
  `apps/runner/src/index-handlers.spec.ts` (`tratarExec` roteia host vs.
  container; `tratarContainerStart/Stop/Remove` nunca lançam),
  `apps/runner/src/guard.spec.ts` (`cwdParaContainer`),
  `apps/engine/test/engine/runners/runner_router_test.exs`,
  `apps/engine/test/engine_web/channels/terminal_channel_test.exs`,
  `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts`,
  `apps/api/test/application/use-cases/actions/execute-container-start.use-case.spec.ts`,
  `apps/api/test/application/use-cases/actions/execute-container-stop.use-case.spec.ts`,
  `apps/api/test/application/use-cases/actions/execute-container-remove.use-case.spec.ts`
  (os três com describe "mounted/runner (ADR 0137)")
- **Decisão arquitetural:** [ADR 0137](../adr/0137-o-runner-sobe-o-container-do-projeto.md)
- **Origem:** plano do dono do produto, Parte 1 / PR 1.3

## FASE 29 — a instalação de uma linha: assinar o que se publica

### RN-525 — O proxy do binário confere o hash contra o manifesto da mesma release, recusa quando não pode conferir, e DIZ que isso é integridade e não procedência {#rn-525}

`GET /runner-releases/binary` é `@Public()`, sem autenticação, e é o passo 4 do
fluxo de configuração pelo navegador ([RN-473](web.md#rn-473),
[ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)). Até a
sessão 3 da FASE 29 ele validava a ENTRADA (`platform` contra uma allowlist
fechada) e transmitia os bytes do GitHub direto para o cliente, **sem verificar
nada** — é o consumidor que o [ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md)
nomeia e a [RN-524](ci.md#rn-524) deixou pendente.

Agora ele **confere o sha256 dos bytes contra o `checksums.txt` da MESMA
release** antes de responder qualquer coisa, e o header `Content-Digest`
(RFC 9530) repete o hash conferido, para quem receber poder refazer a conta.

**O que esta verificação NÃO faz, e está escrito onde ela é feita.** Ela **não
verifica a assinatura** do manifesto (`checksums.txt.bundle`). Isto é
**integridade contra o manifesto, não procedência**: quem consiga reescrever a
Release reescreve os dois arquivos e passa. As duas formas de fechar isso foram
MEDIDAS nesta sessão, e as duas foram recusadas:

| caminho | medido | por que não |
|---|---|---|
| `cosign` na imagem da api | **155 MB** (`cosign-linux-amd64` v2.6.1) | quase dobra a imagem de runtime (Alpine + Node), publicada por digest no GHCR ([ADR 0119](../adr/0119-imagens-publicadas-no-ghcr-por-digest.md)), para verificar um download opcional |
| `@sigstore/verify` + `@sigstore/tuf` | **2,5 MB, 12 pacotes** | o tamanho não é o custo. `getTrustedRoot()` refresca metadados TUF contra `tuf-repo-cdn.sigstore.dev` (o `seeds.json` do pacote só semeia o `root.json`), então uma rota pública que hoje depende de UM host de terceiro passaria a depender de dois. E, pela régua dos ADRs [0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)/[0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md) — capability só é declarada quando **provada** —, não há como provar o caminho hoje: **nenhuma Release tem `checksums.txt.bundle`**, porque o job `checksums` nasceu na sessão 2 e só roda numa tag final, lacuna que a própria [RN-524](ci.md#rn-524) já declara do lado de quem assina |

Quem verifica a ASSINATURA é o `install.sh` (sessão 4/7), que tem `cosign` de
verdade e o baixa pinado com `sha256sum -c` (decisão 4 do ADR 0149). **BRB-005
segue aberto para a metade de procedência desta rota**, e
[o registro](../reference/brb.md) diz isso — não é rodapé, é o limite do que a rota
prova.

**Release sem `checksums.txt` é RECUSA, nunca "sirvo avisando".** Um aviso que
se aceita clicando é uma verificação que não existe (ADR 0149, decisão 3) — e
seria o downgrade mais barato possível: apagar 400 bytes da Release desligaria a
conferência de todo mundo. O custo está medido e é pequeno: na v5.0.0 há dois
binários (`linux-x64`, `linux-arm64`) e nenhum manifesto, e o passo do binário é
**best-effort** no fluxo do navegador ([RN-473](web.md#rn-473), passo 4) — ele cai em
`npm install -g @brabo/runner`, que não depende de release nenhuma. Toda release
anterior à primeira tag depois do ADR 0149 cai nesse caminho, por construção.

**Os seis desfechos de 502 não colapsam.** O status sozinho não os separa e
eles pedem ações diferentes de quem chamou, então a recusa carrega um `motivo`
no corpo — `plataforma_nao_publicada`, `release_sem_manifesto`,
`manifesto_nao_cobre_a_plataforma`, `manifesto_ilegivel`, `download_falhou`,
`hash_divergente`. É a régua da [RN-470](web.md#rn-470) numa resposta de api: "essa
plataforma não saiu ainda" manda esperar a próxima release, "release sem
manifesto" manda usar o npm, e "hash divergente" é incidente. Em especial,
"manifesto não listado na release" e "manifesto listado que falhou ao baixar"
são desfechos DIFERENTES — confundi-los mandaria a pessoa instalar pelo npm por
causa de uma falha de rede momentânea.

**Conferir hash exige ler todos os bytes, e isso passa pelo disco.** Bufferizar
os ~79 MB do binário em memória seria exaustão trivial numa rota pública (o pod
da api tem `limits.memory: 512Mi`), e cachear os bytes seria pior — cinco
plataformas × 79 MB. Os bytes descem em **stream** para um arquivo temporário em
`/tmp` (um `emptyDir` montado justamente porque o rootfs da api é read-only), com
o hash calculado no caminho, e o arquivo é relido em stream para o cliente **só
depois** de o hash bater: memória constante, e nenhum byte não conferido chega
ao cliente. Um teto de 256 MiB aborta resposta absurda antes de encher o `/tmp`.
O cache existente (URLs, 5 min) **fica**, e passa a guardar também o manifesto
já parseado — centenas de bytes de TEXTO, nunca bytes de binário —, na MESMA
entrada e nunca num cache próprio: em janelas diferentes, uma release publicada
no meio faria o hash novo ser conferido contra o binário velho, e o desfecho
seria um `hash_divergente` que pareceria adulteração.

- **Onde:** `apps/api/src/interfaces/http/runner/runner-releases.controller.ts`
  (a verificação, o teto de bytes, o arquivo temporário e o `Content-Digest`),
  `apps/api/src/interfaces/http/runner/checksums.ts` (a leitura pura do
  manifesto e a união de `MotivoDaRecusa`),
  `apps/web/src/lib/runner-bootstrap.ts` (`baixarBinario` passa a ler `message`
  e `motivo` do corpo, e a frase chega em `falhaDoBinario`)
- **Teste:** `apps/api/test/interfaces/runner-releases.controller.spec.ts`
  (caminho feliz com `Content-Digest`; hash divergente sem NENHUM byte nem
  header no corpo; release sem manifesto recusando antes de baixar o binário;
  manifesto que não cobre a plataforma; manifesto ilegível; download falhado; e
  o cache guardando release e manifesto juntos) e o `describe('parsearChecksums')`
  do mesmo arquivo; `apps/web/src/lib/runner-bootstrap.test.ts` (a frase da api
  e o `motivo` chegando ao chamador, e corpo não-JSON não virando segunda
  exceção)
- **Origem:** FASE 29, sessão 3. [ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md),
  o terceiro consumidor da tabela da decisão 3 — pela METADE que a api pode
  provar hoje, com a outra metade nomeada em vez de fingida
| `BACKUP_DIR` aponta para um diretório que existe e NÃO aceita escrita | o backup recusa ANTES do `pg_dump`, dizendo que é ESCRITA — um destino read-only passaria num teste de existência e falharia depois, com o diagnóstico apontando para o lugar errado (RN-528) |
| `git gc` concorrente apaga um packfile no meio do `tar` dos bare repos | a execução vira **`failed`** em `backup_runs`, com o status do `tar` nomeado — nunca um arquivo parcial que se anuncia como bom, porque só a falha vira alerta (RN-528) |
| Volume `git_local_repos` não montado no container de backup (o CronJob do k8s) | o passo é **PULADO e dito no log** — e "não montado" nunca é colapsado com "montado e vazio", que é estado normal de instalação sem projeto `local` (RN-528) |
| Há bare repos no volume e NENHUM arquivo no prefixo `git-daily/` | `brabo-restore-git` **reprova** dizendo que este volume está sem cobertura — ausente-e-vazio é outro desfecho, e sai com sucesso (RN-528) |
| Arquivo dos bare repos truncado | reprova ao ser **LIDO** (`tar -tzf`), nunca pelo tamanho: um tar cortado tem bytes de sobra. É o `pg_restore --list` do lado do git (RN-528) |
| `brabo-restore-git --restaurar` num volume que já tem bare repos | recusado: sobrepor dois estados de repositório não levanta erro nenhum e só aparece num `fetch` com história errada. `RESTORE_GIT_FORCE=1` para quem quer mesmo (RN-528) |
| `brabo-restore-git --restaurar` sem poder escrever no volume (uid 70 × dono da api) | recusa **ANTES** do `tar`, nomeando `--user 0:0` — descobrir no meio da extração deixaria o volume pela metade. E o que é extraído como root volta para o dono do DIRETÓRIO (RN-528) |

### RN-526 — O instalador verifica a própria origem, NOMEIA o que achou antes de perguntar, e nunca apaga pasta de usuário {#rn-526}

`install.sh` (raiz do repositório, versionado e publicado como asset da Release)
é a porta única de instalação. Quatro garantias, e cada uma existe contra um
defeito concreto:

**A invocação preserva o stdin e deixa um ARQUIVO.** A forma documentada é
`curl -fsSLO …/install.sh && bash install.sh` — baixar e rodar um arquivo com
`bash` —, e **nunca** `curl … | sh`: com o script chegando pelo pipe, o `stdin`
do processo É o download, e qualquer `read` lê bytes do próprio script ou
encontra EOF. Um instalador que não consegue perguntar escolheria sozinho onde
criar pastas no computador de alguém — o oposto da régua que a RN-511 já aplica
ao consentimento da base. Até a AT-083 a forma documentada era
`sh -c "$(curl -fsSL …)"`, e ela **nunca funcionou**: a verificação da própria
origem (o parágrafo seguinte) calcula o hash de `$0`, e em `X -c "…"` o `$0` é o
nome do shell, não um arquivo; com `dash` como `sh` o script morria antes, no
`set -o pipefail`. A decisão do mantenedor (18/09) foi mudar a DOC e manter a
verificação por `$0`, **sem** porta de pular (ADR 0150). As formas erradas
viraram **recusas nomeadas**, antes do primeiro download, que imprimem a forma
certa: rodar sob um shell que não é bash (bloco POSIX no topo, antes do
`set -o pipefail`) e rodar sem arquivo (`exigir_o_proprio_arquivo`, que exige o
`BASH_SOURCE` do nível de cima **e** um `$0` legível — `/bin/bash -c` deixa
`$0=/bin/bash`, que existe, e sem a primeira metade o hash dele iria ao
manifesto e a pessoa leria a frase de adulteração). A forma é UMA constante
(`COMO_RODAR`), usada pelas recusas e pelo relato sem TTY.

**Ele verifica a própria origem antes de agir**, e a cadeia tem dois elos: a
assinatura do `checksums.txt` da Release (RN-524), e o hash **deste arquivo**
dentro do manifesto verificado. O `cosign` que faz a verificação é ele mesmo
pinado por versão e conferido por hash contra o valor escrito no script — quem
confia no `install.sh` o bastante para executá-lo confia no hash que ele
carrega, e a cadeia não fica mais frágil que o elo que a inicia. Falha em
qualquer elo é **recusa nomeada, nunca aviso**.

**Calcular hash tem UMA função e DUAS ferramentas aceitas** — `sha256sum` ou
`shasum -a 256` —, resolvidas **antes do primeiro download** e nunca no meio de
uma verificação: a máquina que não tem com que conferir não deve chegar a ter o
que conferir. Faltar as duas é **recusa PRÓPRIA**, que nomeia as duas
ferramentas, diz onde cada uma mora e afirma que nada foi baixado — nunca a
recusa de hash divergente, que é a de **incidente** (*"pare e investigue"*). A
distinção não é estilo: o script chamava `sha256sum` direto nos cinco pontos de
verificação, o macOS não o traz, e o `command not found` chegava a quem
instalava como acusação de adulteração — bloqueando toda instalação na
plataforma que o próprio script suporta (há `cosign` `darwin-*` pinado nele) e
ensinando a ignorar a frase no dia em que ela for verdade. `--print-plan` roda
sem nenhuma das duas e declara qual o script aceita (`conferir-hash`). E há uma
TERCEIRA recusa, desde a AT-083: a ferramenta existe mas **não consegue ler o
arquivo**. Sem ela, `hash_sha256` devolvia vazio de dentro da substituição de
comando (o `errexit` não chega ao subshell) e a comparação seguinte falhava com
o texto de incidente do chamador — a acusação de adulteração da AT-091 por outro
caminho. Agora é `falha_ao_calcular_hash`, que nomeia o arquivo e diz que não
houve o que comparar.

**A detecção nomeia o que achou.** Pelo marcador
(`$XDG_STATE_HOME/brabo/install-state.json`) quando ele existe; por sinais
(projeto de compose `brabo*`, units `brabo-runner-*`, binário no PATH) quando
não — e a lista é impressa **antes** de qualquer pergunta. Não existe o caminho
"achei algo e decido sozinho". Sem TTY o script **relata e sai 0**, como
`consentir-base.mjs` já faz.

**Ele nunca apaga pasta de usuário.** A base de projetos e a pasta de espelho
estão fora do alcance de qualquer confirmação — a mesma régua do espelho
(RN-516): pasta de usuário é acúmulo, não estado do produto. Volume nomeado só
sai com confirmação, e listado um a um antes de perguntar.

O marcador mora no `$XDG_STATE_HOME` e **não** em `~/.brabo/`, que é onde o
runner guarda coisa por PROJETO: estado de instalação e configuração de projeto
são vidas diferentes, e juntá-los faria a remoção de um apagar o outro.

**Onde:** `install.sh` (raiz).
**Teste:** `scripts/dev/install.spec.ts` — os modos `--print-state` e
`--print-plan` provam a DECISÃO sem TTY, sem rede e sem efeito, no molde de
`bootstrap.spec.ts`; e o bloco *"o hash num PATH sem sha256sum"* roda as
funções de hash no shell de verdade, com o `PATH` montado ferramenta por
ferramenta, conferindo as DUAS recusas (ferramenta ausente × hash divergente)
e que a primeira nunca usa o vocabulário da segunda;
`scripts/dev/install-invocacao.spec.ts` roda o script pelas formas erradas
(`bash -c`, `/bin/bash -c`, pipe, `dash -c`, `dash install.sh`) e cobra a recusa
nomeada com a forma certa antes de qualquer download, a terceira recusa de hash,
e que runbook, bootstrap e cabeçalho ensinam a MESMA forma.
**Origem:** FASE 29, sessão 3 ([ADR 0150](../adr/0150-instalador-de-uma-linha.md)).
Nesta sessão o script **não instala nada** — subir o compose, gerar segredos e
instalar o runner são as sessões 4 e 7, e ele **diz isso** na saída em vez de
terminar em silêncio.

### RN-531 — O instalador consente UMA base para os dois lados e instala o agente local já executável {#rn-531}

**Uma base, consentida uma vez.** O `install.sh` pergunta onde os projetos vão
morar e grava o mesmo caminho nos DOIS lugares: `BRABO_PROJECTS_BASE` no `.env`
(o servidor, [ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md)) e o
campo `base` do `runner.json` (o agente local,
[RN-529](runner.md#rn-529)). O que difere entre `mounted` e `runner` é **quem executa**,
não onde o código mora — duas bases diferentes para a mesma pasta seriam a
colisão de namespace que o ADR 0141 recusou por escrito.

A base é recusada quando não é absoluta, quando fica **dentro** do checkout do
Brabo e quando **contém** o checkout — os dois sentidos, como o `preflight.mjs`
já faz do lado do servidor. O `~` não é expandido de propósito: o valor vai
para um arquivo de configuração, e um `~` gravado ali é lido literalmente.

**O agente local é instalado já executável.** O binário é baixado, conferido
contra o **mesmo** `checksums.txt` assinado que o script já verificou para
conferir a si mesmo (RN-524) — baixá-lo duas vezes seriam duas chances de pegar
manifestos diferentes, e a segunda não seria verificada — e instalado com
`install -m 0755`, que põe o bit de execução no mesmo ato em que copia.

**Isso fecha o BRB-031.** O `chmod +x` manual sobreviveu à FASE 28 porque a
instalação como serviço não vinha de um artefato versionado: quem chegava a
rodar `brabo-runner service install` já precisara tornar o binário executável
para chegar ao comando. Vindo do instalador, o passo desaparece — a File System
Access API do navegador não preserva o bit, um script preserva.

Release sem o binário da plataforma **não interrompe a instalação**: o resto já
está de pé, e a mensagem aponta `npm install -g @brabo/runner`. É a mesma
disposição do passo do binário na configuração pelo navegador (RN-473), e a
razão é a mesma — o agente local é a última etapa, não um pré-requisito.

**Onde:** `install.sh`, `consentir_base` e `instalar_o_runner`.
**Teste:** `scripts/dev/install.spec.ts` — `install -m 0755` presente, a
instrução de `chmod` dirigida ao usuário ausente, e a conferência contra o
manifesto assinada nomeada.
**Origem:** FASE 29, sessão 7 ([ADR 0150](../adr/0150-instalador-de-uma-linha.md),
[ADR 0151](../adr/0151-base-consentida-no-runner.md)).

### RN-534 — O instalador entra no manifesto assinado, e é exercitado numa máquina limpa {#rn-534}

Duas metades da mesma garantia.

**O `install.sh` entra no `checksums.txt` e na Release.** Sem isso a verificação
que ele faz de si mesmo (RN-526) seria letra morta: ele confere o próprio hash
contra o manifesto assinado, e o manifesto não o cobria. O arquivo vem do
**checkout da tag**, não de download — é o mesmo commit que produziu tudo o mais
que está sendo assinado no mesmo job.

**E ele é exercitado numa máquina limpa**, que é o que o runner efêmero do
Actions é: host recém-criado, sem Brabo, sem `.env`, sem marcador. O E2E prova,
nessa ordem: o **plano** não deixou de prometer o que nunca apaga; o **estado**
numa máquina limpa não inventa marcador nem sinais; **sem TTY** o instalador
relata, sai 0 e **não grava**; e, com um TTY de verdade (não um pipe — o pipe é
justamente o que mataria o consentimento), a instalação completa verifica
assinatura, confere o próprio hash, grava o marcador e deixa o `.env` em modo
**600**.

**Correção (AT-083):** o "TTY simulado por `script -qec`" que este parágrafo
afirmava **nunca foi TTY para o instalador**. O passo rodava
`script -qec "… ./install.sh … < respostas"`, com o `<` DENTRO do comando do
`script`: o stdin do instalador era o arquivo, `[ -t 0 ]` era sempre falso, e o
fluxo interativo nunca foi exercitado. Hoje quem roda o instalador é um driver
de PTY em Python (`python3 -I`, sem dependência nova), que o põe no lado
escravo do pty e ESPERA cada pergunta antes de responder — e, para as duas de
senha, espera o eco estar DESLIGADO, o que prova o "sem eco" da RN-547 e impede
a senha de aparecer na saída. O E2E também baixa e roda o instalador pela MESMA
forma que o runbook manda (`curl -fsSLO` + `bash install.sh`, RN-526), e
reprova de cara se o instalador disser "Sem terminal interativo". Como o
workflow segue sem rodar em PR, o driver é extraído dele e exercitado em
`scripts/dev/install-e2e.spec.ts` contra um instalador de mentira (terminal
visto, respostas em ordem, senha fora da saída, e as duas paradas nomeadas),
com a forma antiga fixada como a que NÃO dava terminal.

**Ele não roda em `pull_request`**, e o motivo é o mesmo da assinatura: o
manifesto assinado só existe depois de uma tag final. Fazer o script rodar em PR
exigiria dar-lhe uma porta para PULAR a verificação — a porta que o ADR 0150
recusa, e que uma vez aberta valeria para qualquer um, não só para o CI. É a
decisão que o golden-set do RAG já tinha tomado pelo mesmo raciocínio
([ADR 0138](../adr/0138-golden-set-do-rag-em-ci-agendado.md)): o que não é
exercitável em PR roda em cadência própria, e o workflow **diz por quê** em vez
de fingir cobertura.

**Onde:** `.github/workflows/install-e2e.yml`;
`.github/workflows/build-runner-binaries.yml`, job `checksums`.
**Teste:** o próprio workflow — e `scripts/dev/install.spec.ts` continua
cobrindo a decisão sem rede; `scripts/dev/install-e2e.spec.ts` (bloco *"o TTY
do E2E é um TTY para o INSTALADOR"*) exercita o driver de PTY em PR.
**Origem:** FASE 29, sessão 10 ([ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md),
[ADR 0150](../adr/0150-instalador-de-uma-linha.md)).

> **TODO(humano):** as RNs acima foram extraídas do código e dos testes. Falta
> confirmar se existe regra de negócio **não implementada** que deveria estar
> aqui — algo combinado e ainda não codificado não aparece nesta varredura.

---

## Os artefatos dos agentes viram arquivo, em `docs/` (RN-523)

### RN-542 — O instalador compara a versão instalada com a que vai instalar, e a oferta é específica por relação {#rn-542}

O `install.sh` detectava instalação anterior desde a [RN-530](infra.md#rn-530) e
oferecia migrar com backup provado. O que ele **não** sabia era **qual** versão
estava lá: o marcador (`$XDG_STATE_HOME/brabo/install-state.json`) gravava
`schemaVersion`, `instaladoEm`, plataforma, fonte, digests e caminhos — e nada
que dissesse 5.0.0. A pergunta *"migrar esta instalação?"* era cega nos dois
lados, e quem respondia não tinha como saber se aquilo subia, descia ou repetia.

A informação sempre esteve à mão e era ignorada: `images.json` da Release traz
`"versao"` ao lado de `commit` e `publicadoEm`, e `resolver_imagens_do_ghcr` lia
só `repositorio` e `digest`. Pela outra ponta, `--source=local` já exige árvore
**limpa e em tag** — então `git describe` é uma versão confiável ali, pelas duas
recusas que já aconteceram antes.

**A ordem é a decisão.** As imagens passam a ser resolvidas **antes** da
detecção: saber o que entra é pré-requisito de perguntar se o que existe sai.
O marcador sobe para `schemaVersion: 2` e grava `versao` e `commit` — os dois
juntos, porque um marcador novo sem o campo passaria por antigo.

Com as duas versões em mãos, a oferta deixa de ser uma pergunta e vira quatro,
uma por relação:

| relação | oferta | default |
|---|---|---|
| maior | `Atualizar 5.0.0 → 5.1.0?` | **sim** — é o que a pessoa veio fazer, e o backup provado torna reversível |
| igual | `Já é a 5.0.0. Reinstalar do zero mesmo assim?` | não — não há ganho a oferecer |
| menor | nomeia **rebaixamento**, avisando que migração de banco não anda para trás | não — pode não ter volta |
| desconhecida | marcador de schema 1 não tem versão: diz isso, e **não adivinha** | não |

O ramo `maior` é o **único** com default sim, e é o único que pode tê-lo: o
passo é reversível pelo backup que acabou de ser provado. Os outros três exigem
um `s` digitado.

**Em qualquer ramo a instalação é apagada e recriada do zero**, nunca subida por
cima — decisão do dono do produto, e a mesma razão da RN-530: um `up` sobre
volumes de outra versão é estrago que não avisa, e meia migração é pior que
nenhuma. A cadeia backup → **PROVAR** → perguntar → apagar → instalar →
restaurar não muda em nenhum deles.

`comparar_versoes` é implementada à mão e **não** com `sort -V`: o BSD `sort` do
macOS ganhou `-V` tarde, e este script roda na máquina dos outros — a mesma
disciplina que já fez `sha_do_cosign` recusar array associativo por causa do
bash 3.2. Ela ecoa o veredito em vez de devolver código de saída, porque sob
`set -e` um `return 1` legítimo mataria o script.

No menu do `pnpm bootstrap`, *Docker › Instalar (install.sh)* **relata** o plano
e não instala — mecânica, não preferência: item de menu roda com stdin em
`/dev/null` para o menu seguir lendo teclas do mesmo terminal, e este instalador
existe para PERGUNTAR (é o motivo de o [ADR 0150](../adr/0150-instalador-de-uma-linha.md)
recusar `curl | sh`). É o mesmo desenho do item *Base de projetos*
([RN-511](infra.md#rn-511)), e a nota do item carrega o comando que instala de verdade.

- **Código:** `install.sh` (`comparar_versoes`, `campo_do_marcador`,
  `resolver_imagens_do_ghcr`, `resolver_imagens_locais`, `main`);
  `scripts/dev/bootstrap.sh` (item `1.7`)
- **Teste:** `scripts/dev/install.spec.ts` — *"a comparação de versões"* e
  *"o marcador registra a versão"*; a função é extraída do script e rodada por
  `bash`, nunca reimplementada em TS (uma cópia continua passando depois que o
  shell quebra)
- **Achado rodando, não lendo:** `cut -d.` sobre uma string **sem ponto**
  devolve a linha inteira, não vazio — então `5.0.0` vs `5` respondia `menor`.
  Normalizado com `.0.0` no fim, com teste de regressão.
- **ADR:** [0150](../adr/0150-instalador-de-uma-linha.md)
- **Origem:** pedido do dono do produto — *"o sh deve ser inteligente de
  entender que já há uma versão e verificar se será uma nova versão a ser
  executada ou não... caso seja uma nova ou escolhido isso pelo usuário deverá
  deletar a anterior e instalar do zero para evitar possíveis erros"*

## A chave de dispositivo passa a poder ser da MÁQUINA (RN-543, FASE 30)

### RN-543 — `runner_device_keys.project_id` nulo é a chave de MÁQUINA: vale para os projetos do DONO, resolvida contra o projeto pedido {#rn-543}

A identidade do agente local era por PROJETO. Uma máquina com três projetos em
modo `runner` tinha três chaves, três pastas com
`brabo-runner-device-key.jwk.json` e três units de serviço — e a pessoa passava
três vezes pelo mesmo fluxo de navegador ([RN-464](api.md#rn-464)..[466](runner.md#rn-466),
[RN-475](web.md#rn-475)) para descrever **uma** máquina. É o item 4 dos cinco
acoplamentos que o [ADR 0154](../adr/0154-chave-de-dispositivo-de-maquina.md)
mediu; os itens 1, 2 e 3 (tópico, socket id, ticket) descrevem uma **conexão**
e N conexões os satisfazem byte a byte, então **nada no engine muda aqui**.

**Uma tabela, duas espécies.** `project_id` preenchido = a chave de PROJETO de
sempre. `project_id` NULL = a chave de MÁQUINA. Tabela irmã foi considerada e
recusada no ADR: `PatAuthGuard` acha a pública pelo `kid` e não precisa saber a
espécie, e duas tabelas fariam duas buscas — a segunda esquecida exatamente uma
vez. NULL e não sentinela: a FK é real, e `project_id = '00000000-…'` exigiria
uma linha falsa em `projects`. `user_id` continua `NOT NULL` — o ADR recusa
chave que atravesse usuários, porque a credencial descreve **quem** age.

**O ponto que decide tudo é um só.** `PatAuthGuard.autorizarPapel` recusava
quando o projeto da credencial diferia do projeto da rota. Essa comparação
**não** foi apagada: ela é o que impede a chave do projeto A servir o projeto
B, e ela some **só** para `project_id` nulo, porque aí não há o que comparar. O
papel passa a se resolver contra o projeto **PEDIDO**, que é o ADR 0154 ponto 2
ao pé da letra — *"a autorização continua sendo a de sempre, resolvida contra o
projeto pedido"*. **Nenhum teto novo e nenhum afrouxado**: a chave de máquina
não dá ao runner nada que o DONO dela já não tivesse, e papel insuficiente no
projeto pedido continua 403. O ramo do PAT não muda —
`personal_access_tokens.project_id` continua `NOT NULL`.

**O agente PERGUNTA quais projetos atende.** `GET runner/projects` devolve os
projetos em `execution_mode: 'runner'` nos quais o dono da credencial alcança
pelo menos `developer` — o MESMO mínimo de `runner-ticket`, porque listar
projeto cujo ticket seria recusado é prometer o que a rota seguinte nega. Ele
pergunta em vez de varrer o disco: a base da máquina é do usuário e pode ter
pasta que não é projeto nenhum, e adivinhar por nome de pasta é a classe de
erro que o [ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md) recusou.
O que viaja é o SEGMENTO (`workspaceDirName`, [RN-109](api.md#rn-109)) e nunca um
caminho absoluto — o mesmo invariante do broker.

É a **primeira rota `@RequirePatAuth()` sem `:projectId` no caminho**, e as
duas consequências são travadas por teste: só credencial de MÁQUINA entra
(uma de projeto descreve um projeto só e não tem o que descobrir — 403 com
mensagem PRÓPRIA, nunca a de "projeto errado", que mentiria sobre o motivo), e
não há `@RequireRole`, porque não há projeto contra o que resolvê-lo. O mínimo
é aplicado por **LINHA**, com a régua ÚNICA do produto
(`ResolveEffectiveRoleUseCase.forProject`, `projectRole ?? workspaceRole` —
[RN-471](web.md#rn-471)); a consulta de candidatos em SQL é `alcança`, nunca `tem
papel`, e reescrever o `??` ali seria uma segunda régua. Por isso
`route-surface.spec.ts` a classifica como `jwt` — o classificador lê
`@RequireRole` e não enxerga mecanismo — e `docs/security-surface.md` corrige a
leitura em prosa, exatamente como já faz para `runner-ticket`.

**A listagem da [RN-519](api.md#rn-519) passa a dizer a ESPÉCIE.** Uma chave de
máquina serve todo projeto do dono, então ela entra na listagem de todos —
marcada (`especie: 'maquina'`, `projectId: null`). As duas metades são
obrigatórias: sem entrar na lista ela seria invisível e permanente em toda
tela, que é o defeito que a RN-519 fechou renascido na espécie nova; sem a
marca, a mesma linha apareceria em N projetos parecendo N chaves diferentes. A
espécie é DERIVADA de `project_id` num lugar só — não há coluna para ela, e não
deve haver.

**E a revogação passa a ter alvo PLURAL.** [RN-520](api.md#rn-520) derruba a conexão
viva de `{projeto, usuário}`, e uma chave de máquina não nomeia projeto nenhum.
Não derrubar reabriria exatamente o que a RN-520 fechou — a chave morre para
ticket NOVO e as conexões vivas seguem executando comando aprovado —, agora em
N conexões em vez de uma. Então revogar uma chave de máquina pede um
`disconnectRunnerOfUser` **por projeto** em modo `runner` que o dono alcança. É
a consequência que o ADR declarou por antecipação (*"revogar passará a derrubar
todos os projetos daquela máquina"*), e ela cabe **sem tocar o engine**: a
assinatura `{projeto, usuário}` fica byte a byte, só é chamada N vezes. A lista
vem dos CANDIDATOS, sem filtro de papel, e isso é deliberado — desconectar não
é decisão de autorização, e faltar um projeto deixaria de pé o que a revogação
existe para matar.

- **Código:** `apps/api/src/db/schema/auth.ts` (`runnerDeviceKeys.projectId`,
  sem `.notNull()`); `apps/api/src/db/migrations/0058_public_war_machine.sql`;
  `apps/api/src/interfaces/http/auth/pat-auth.guard.ts` (`autorizarPapel`);
  `apps/api/src/interfaces/http/runner/runner-projects.controller.ts`;
  `apps/api/src/application/use-cases/runner/list-runner-projects.use-case.ts`;
  `apps/api/src/infrastructure/persistence/drizzle/project.repository.ts`
  (`listRunnerModeReachableBy`);
  `apps/api/src/infrastructure/persistence/drizzle/runner-device-key.repository.ts`;
  `apps/api/src/application/use-cases/auth/revoke-runner-device-key.use-case.ts`
- **Teste:** `apps/api/test/interfaces/pat-auth.guard.spec.ts` — *"chave de
  MÁQUINA"*, com os DOIS sentidos travados (a de máquina vale em qualquer
  projeto; a de PROJETO continua recusada em projeto diferente) e a rota sem
  `:projectId`; `apps/api/test/application/use-cases/runner/list-runner-projects.use-case.spec.ts`
  (papel abaixo de `developer` fica de fora);
  `apps/api/test/infrastructure/persistence/drizzle/runner-device-key.repository.spec.ts`
  e `.../project-runner-mode.repository.spec.ts` (contra o Postgres — o que
  mudou é um `NOT NULL` e um `WHERE`, e fake nenhum prova qualquer um dos
  dois); `apps/api/test/application/use-cases/auth/revoke-runner-device-key.use-case.spec.ts`
  (*"o alvo da desconexão vira PLURAL"*);
  `apps/api/test/interfaces/http/runner/runner-projects.controller.spec.ts`
- **Lacuna DECLARADA, e FECHADA pela [RN-552](api.md#rn-552):** quando esta RN
  fechou, nenhuma rota da api **criava** chave de máquina — a rota nasceria no
  PR que tivesse o primeiro chamador real, o `install.sh`
  ([ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) ponto 4), nunca
  antes. Foi o que aconteceu: `POST /internal/machine-device-keys`. O tipo da porta já é o da COLUNA
  (`projectId: string | null`), para o consumidor futuro não ter o que mudar
  ali. E o web continua sem tela onde listar ou revogar chave de dispositivo
  (a metade aberta da RN-519): a espécie nova torna a lacuna maior, e ela fica
  declarada, não fechada aqui. **FECHADA depois pela [RN-561](web.md#rn-561)**, que é
  a tela — e a marca de espécie criada aqui é o que ela usa para não mentir
  sobre o alcance de revogar.
- **ADR:** [0154](../adr/0154-chave-de-dispositivo-de-maquina.md)
- **Origem:** FASE 30, sessão 2 —
  [o recorte da fase](../explanation/fase-30-runner-por-maquina.md)

## A primeira conta de uma instalação nasce no terminal (RN-546)

### RN-546 — Rota interna cria a PRIMEIRA conta, já verificada, e recusa quando existe qualquer usuário {#rn-546}

Sessão 5 da [FASE 30](../explanation/fase-30-runner-por-maquina.md), decidida pelo
[ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md). É a metade de api
do passo que fecha a instalação de uma linha; o `install.sh` que consome esta
rota é a sessão 6, e ele chegou na [RN-547](#rn-547).

**O buraco, medido.** Numa instalação nova ninguém consegue entrar. O `.env`
que o instalador gera não tem **nenhuma** variável de e-mail, `MAIL_TRANSPORT`
cai no default `log` (`docker/docker-compose.install.yml`), e o registro normal
exige verificar e-mail — que por um canal desligado não fecha. A instalação
termina dizendo "Pronto" e a única saída é pescar o link em
`docker compose logs api`.

**A rota.** `POST /internal/first-account`, `engine-service` — autenticada pelo
`BRABO_SERVICE_TOKEN`, no mesmo cabeçalho e com a mesma comparação em tempo
constante das outras rotas internas. Corpo `{ email, senha, nome? }`, resposta
`{ userId, email, workspaceId }`, `201`.

**Por que interna, e nunca pública.** Uma rota pública de "criar o primeiro
owner" é uma corrida entre quem instalou e quem escaneou a porta, e quem perde
a corrida perde a instalação: `owner` do primeiro workspace não é papel que se
recupere por HTTP. O service token fecha a corrida no lugar certo — ele é
gerado pelo próprio `install.sh` e escrito no `.env` com modo `600`, então
apresentá-lo prova controle da **máquina**, que é a credencial que este passo
realmente quer.

**A conta nasce VERIFICADA, e é a única coisa que esta rota afrouxa.** O que a
verificação de e-mail prova é *"esta pessoa controla esta caixa"*; quem roda o
instalador já provou algo mais forte — a máquina, o `.env` com os cinco
segredos e o daemon do Docker. Exigir dela a prova mais fraca, por um canal que
a instalação sabe estar desligado, é teatro. O **registro normal fica byte a
byte**: o ADR cria um caminho para um caso nomeado, não mexe no outro.

**A recusa é sobre a INSTALAÇÃO, não sobre o e-mail.**
`UserRepository.existeAlgumUsuario()` (`SELECT 1 … LIMIT 1`, nunca `count(*)`),
e `409` havendo qualquer usuário. A pergunta é sobre `users` e não sobre
`auth_credentials`, porque conta provisionada por login social
([RN-278](api.md#rn-278)) nasce sem credencial e perguntar pela credencial diria "não
há ninguém" numa instalação povoada. Herdar a idempotência por e-mail de
`provisionarUsuario` transformaria a rota num criador de contas com nome
enganoso — bastaria variar o endereço. Numa migração
([RN-530](infra.md#rn-530)) os usuários vêm no restore e o passo se cala pelo mesmo
critério.

**Workspace pessoal na MESMA transação** ([RN-410](api.md#rn-410)). Este é o TERCEIRO
ponto de criação de conta, e ele não ganha regra de nome/slug própria: chama a
mesma `nomeESlugDoWorkspacePessoal` dos outros dois. Sem isso a instalação
fecharia com um login que atravessa e um dashboard onde "Novo projeto" não tem
onde criar — a metade do buraco que esta fase veio tapar, não a outra.

**A extração, e por que não `BRABO_FORCE_SEED`.** `provisionarUsuario` recusa
rodar com `NODE_ENV=production`, e o instalador roda exatamente em produção. O
que a recusa protege está escrito no docblock dela: senha **conhecida** criada
**sem interação humana**. A rota é outra categoria — a senha é escolhida por um
humano no TTY, lida sem eco e confirmada, atrás do service token, e só quando
não há usuário nenhum. Então o núcleo (o trio de escritas que faz a conta
nascer verificada) virou `ProvisionarUsuarioUseCase`, e **a recusa ficou no
script**, que é quem ela protege. Mandar o instalador se declarar "seed
forçado" o faria atravessar uma regra que nunca falou dele, e afrouxaria a
recusa justamente onde ela vale.

**Uma régua de senha, não duas.** `exigirSenhaValida` do domínio, chamada pelo
MESMO código que o registro chama — e por isso o DTO desta rota **não** repete
um `@MinLength`: a chamada cobre as CINCO recusas da política, não só o
comprimento. O `@MaxLength` fica, porque não é política: é proteção de
argon2id, que copia a entrada antes de derivar. `PoliticaDeSenhaError` é
`Error` de domínio e não tem filtro global, então o caso de uso **traduz** para
`400` — sem isso o instalador leria "erro do servidor" onde a resposta certa é
"escolha outra senha". Traduzir ali não toca o registro normal.

**Kind próprio na trilha de auth.** `first_account_created`, e não
`register_created`: a conta nasce verificada sem e-mail nenhum ter sido
enviado, e quem audita depois precisa ver isso escrito, não deduzir pela
ausência de um `email_verified` ao lado. União fechada no TypeScript, coluna
`text` no banco — kind novo não custa migração.

**Sem `GET`.** "Existe algum usuário?" é pergunta que ninguém precisa fazer de
fora: o `POST` responde `201` ou `409`, e o `409` já é a resposta. Uma rota de
leitura publicaria o mesmo fato com uma superfície a mais, e a resposta dela
seria o sinal exato que um scanner quer.

**A superfície nova está declarada, não escondida.** Passa a existir um segundo
caminho de criação de usuário que funciona em PRODUÇÃO. Ele é estreito em três
contagens independentes (primeira conta, rota interna, service token) e some
assim que a instalação tem gente. Está no
[`security-surface.md`](../security-surface.md), nas Consequences do ADR e aqui.

**Uma janela declarada, não fechada.** A checagem de "existe algum usuário" roda
DENTRO da transação, mas `READ COMMITTED` não impede duas chamadas concorrentes
com e-mails diferentes de passarem juntas. Fechá-la exigiria lock consultivo
sobre a ausência de linhas, e não é onde a contenção mora: quem alcança a rota
já tem o service token, ou seja, já controla a instalação inteira. O que a
condição impede é a rota VIRAR superfície permanente de criação de conta, e
isso ela impede.

**O que NÃO entrou, por decisão do ADR:** rota pública de primeiro owner; senha
gerada pelo código ou default (a senha nunca é gravada — nem no `.env`, nem no
marcador, nem em log); SMTP ligado sozinho (`MAIL_TRANSPORT=log` continua o
default declarado); credencial de LLM (é de quem vai gastar,
[RN-058](api.md#rn-058)); e qualquer mudança no registro normal.

- **Código:** `apps/api/src/application/use-cases/auth/criar-primeira-conta.use-case.ts`
  (a recusa por instalação povoada, a régua de senha, o workspace pessoal e o
  evento), `apps/api/src/application/use-cases/auth/provisionar-usuario.use-case.ts`
  (o núcleo extraído, sem a recusa de produção),
  `apps/api/src/scripts/provisionar-usuario.ts` (só a recusa, mais a
  delegação), `apps/api/src/interfaces/http/internal/internal-first-account.controller.ts`,
  `apps/api/src/interfaces/http/internal/dto/first-account-internal.dto.ts` e
  `…/first-account-internal.response.dto.ts`,
  `apps/api/src/application/ports/user-repository.port.ts` e
  `apps/api/src/infrastructure/persistence/drizzle/user.repository.ts`
  (`existeAlgumUsuario`), `apps/api/src/domain/auth/auth-event.ts`
  (`first_account_created`),
  `apps/api/src/domain/auth/password-policy.ts` (INTOCADO — é a régua reusada)
- **Teste:** `apps/api/test/application/use-cases/auth/criar-primeira-conta.use-case.spec.ts`
  (caminho feliz com conta verificada e workspace pessoal, o kind próprio, o
  `409` com instalação povoada, o `400` por comprimento e o `400` por motivo
  que NÃO é comprimento, e o fallback de nome);
  `apps/api/test/interfaces/http/internal/internal-first-account.controller.spec.ts`
  (o repasse ao caso de uso, o `nome` ausente virando `null`, e as três
  recusas do guard: cabeçalho ausente, token errado, token certo);
  `apps/api/test/scripts/provisionar-usuario.spec.ts` (a recusa de produção
  FICOU no script, e a delegação);
  `apps/api/test/interfaces/route-surface.spec.ts` (a rota classificada)
- **ADR:** [0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md), que depende
  do [0154](../adr/0154-chave-de-dispositivo-de-maquina.md)

## O `install.sh` fecha a instalação (RN-547, FASE 30)

### RN-547 — O instalador cria a primeira conta, registra a chave desta máquina e sobe o agente como serviço — e o que falha no meio é RELATADO, nunca desfeito nem engolido {#rn-547}

Sessão 6 da [FASE 30](../explanation/fase-30-runner-por-maquina.md), decidida pelo
[ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md). A sessão tocaria
três workspaces de uma vez e foi **dividida em três**: as duas peças do agente
e da api já fecharam ([RN-546](#rn-546), [RN-551](runner.md#rn-551), [RN-552](api.md#rn-552),
sobre a unit da [RN-545](runner.md#rn-545)), e o que sobrou aqui é o `install.sh` como
**orquestrador e nada mais** — nenhuma linha de `apps/` foi tocada, e nenhuma
rota nasceu.

**O buraco que fecha.** Uma instalação nova terminava dizendo "Pronto" com um
login que NINGUÉM atravessava: o `.env` gerado não tem variável de e-mail
nenhuma, `MAIL_TRANSPORT` cai no default `log`, e o registro normal exige
verificar e-mail. A única saída era pescar o link em
`docker compose logs api`. E o agente local ficava instalado sem credencial,
esperando que alguém voltasse ao navegador para parear uma pasta.

**A cadeia, e cada elo já existia.** `POST /internal/first-account`
([RN-546](#rn-546)) → `brabo-runner device-key create` ([RN-551](runner.md#rn-551)) →
`POST /internal/machine-device-keys` ([RN-552](api.md#rn-552)) → `device-key finish
--id <id>` → `brabo-runner service install --machine`
([RN-545](runner.md#rn-545)). O `id` que a api devolve no registro é o que vira o `kid`
da privada, e a cadeia inteira só o REPASSA — ninguém o deriva de outra coisa
([RN-475](web.md#rn-475)). O `--dir` do serviço sai do CAMINHO que o `finish`
imprimiu, não de uma segunda conta do script sobre onde a pasta de configuração
fica.

**O que acontece quando um elo do meio falha: nada é desfeito, tudo é
RELATADO, e o script sempre sai 0.** É a decisão desta entrega, e o argumento é
que os elos já cumpridos são úteis por si — com a conta criada a pessoa entra,
com a chave registrada a máquina está pareada, e o serviço é o único passo que
ela repete à mão com um comando que o script imprime. Desfazer exigiria apagar
conta e revogar chave, e não há rota para isso nem deveria haver uma que o
instalador chame sozinho. O preço é que uma instalação pode terminar pela
metade; o que ela nunca faz é terminar pela metade em SILÊNCIO — cada falha
vira uma linha nomeada num bloco **"O que ficou pendente"**, no fim, onde quem
instalou ainda está olhando. Derrubar a instalação inteira por causa do último
passo trocaria meia instalação por nenhuma.

**Idempotência é o CÓDIGO HTTP, e `409` não é falha.** As duas rotas respondem
`409` quando a instalação já tem gente — uma segunda execução, ou uma migração
([RN-530](infra.md#rn-530)) cujo restore trouxe os usuários. Esse é o desfecho
ESPERADO: o passo se cala dizendo por quê, e **não** entra nas pendências.
Qualquer outro código é falha, e aparece com o código e a resposta da api ao
lado. `000` — o curl que não chegou a falar com a api — tem tratamento próprio
pelo mesmo motivo: colapsá-lo com um código de resposta faria "a api não subiu"
ser lida como "a api recusou". E o passo do agente só roda quando ESTA execução
criou a conta: com usuário preexistente, registrar uma chave de máquina
cunharia credencial duradoura para alguém que não pediu nada nesta rodada.

**A senha não toca disco nem `argv`.** Lida no TTY sem eco (`stty -echo`, com o
modo do terminal restaurado no fim), confirmada, e enviada à api pelo **STDIN**
do `curl` — nunca por `--data` em linha de comando, que `/proc/<pid>/cmdline`
publica para qualquer usuário da máquina, e nunca por arquivo. O cabeçalho com
o `BRABO_SERVICE_TOKEN` vai num `--config` de modo 600, apagado em seguida: ele
é segredo também, e esse segredo já mora em disco, no `.env`, com o mesmo modo.
Sem `stty` na máquina o passo é **recusado**, nunca degradado para perguntar
com eco — prometer sem eco e entregar com eco é pior que não perguntar. A senha
não vai para o `.env`, não vai para o marcador e não vai para log nenhum; o
marcador ganha o **e-mail**, que identifica e não é segredo, e o
`MARCADOR_SCHEMA` sobe para **3** junto com o campo, pela mesma régua que o fez
subir para 2 ao ganhar a `versao`.

**A recusa de senha é repetível, e o teto é 3.** A política é a do domínio
([RN-546](#rn-546)), a mesma do registro normal, e só é conhecida DEPOIS do
POST. Abortar a instalação ali deixaria alguém com o compose de pé e a segunda
execução caindo no caminho de migração — então o laço é do par
pergunta+resposta, e esgotar o teto vira pendência nomeada em vez de recusa.
Senha digitada diferente da confirmação não chega a sair da máquina.
Tabulação no que foi digitado é **recusada** e nunca removida em silêncio: um
instalador que reescreve a senha produz uma conta cuja senha não é a que a
pessoa digitou.

**A recusa do `service install --machine` é o caso COMUM numa máquina de
desenvolvedor, e ela chega com as palavras dela.** `install --machine` recusa
quando há unit por PROJETO instalada, sem `--force` ([RN-545](runner.md#rn-545):
*"instalar e avisar deixaria a instalação errada de pé"*). O instalador
repassa a saída do CLI INTEIRA em vez de resumi-la — é ela que nomeia o
`uninstall` de cada unit encontrada, que é o gesto — e a pendência carrega o
comando exato para repetir depois.

**O `name` da chave é o `hostname`, e a escolha é deste script.** A
[RN-551](runner.md#rn-551) declara por escrito que o CLI **não** nomeia: o `name` é
campo do registro, e quem nomeia é quem registra. Quem abrir a lista de chaves
de dispositivo precisa saber a QUAL máquina ir, e o hostname é o nome que a
pessoa já usa para falar das máquinas dela — é o que o prompt do shell mostra.
Não é segredo, não é único, e a api não deriva nada dele. Aspa e barra saem
(sairiam do lugar dentro do JSON), o corte é em 80 (o `@MaxLength(80)` do DTO,
aplicado aqui para a recusa não vir da api) e a ausência total de `hostname` e
`uname` devolve um nome fixo — vazio viraria `400` pelo `@MinLength(1)`, depois
de a conta já existir.

**O `.parcial` que sobra quando o registro não fecha FICA onde está, e é
nomeado.** O `create` grava a privada num arquivo com sufixo `.parcial` que o
runner ignora por construção ([RN-551](runner.md#rn-551)), e se o registro falhar ele
sobra. Apagá-lo seria o instalador decidir que sabe algo que não sabe: um
timeout depois de a api gravar é indistinguível de um timeout antes, e o
arquivo pode ser a única cópia da metade privada de uma chave já registrada. Ele
é inerte, o próximo `device-key create` o nomeia e o substitui, e a mensagem
diz as duas coisas.

**O que este script NÃO faz, e agora diz certo.** A última linha da saída
anunciava, meses depois de as funções existirem, que ele *"não pareia o agente
local"* e que a chave *"continua vindo da tela do projeto"*. O texto foi
reescrito: SMTP continua desligado por decisão (`MAIL_TRANSPORT=log`, aqui como
em produção — e a conta criada nasce verificada justamente por isso), credencial
de LLM continua sendo de quem vai gastar
([RN-058](api.md#rn-058)), e o pareamento pela tela do projeto
([ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md))
continua existindo para quem quiser — o que mudou é que ele deixou de ser
obrigatório. O `--help` sofria do mesmo defeito num lugar que nenhum teste
alcançava (ele imprime o CABEÇALHO, que é comentário, e a regra que proíbe falar
de "sessões de fase" só lia linhas de código): ele dizia *"ESTA VERSÃO NÃO
INSTALA NADA"*. Corrigido, e o intervalo fixo de linhas que o cortava em
silêncio virou "até a primeira linha que não é comentário".

**O que NÃO entrou:** rota nova de qualquer espécie (a sessão é orquestração —
se faltasse algo do outro lado, o gesto era parar e relatar); SMTP; credencial
de LLM; senha gravada em qualquer lugar; e qualquer caminho que crie conta sem
TTY — sem terminal interativo o script relata e **sai 0**, no passo que já
existia, antes de qualquer escrita.

- **Código:** `install.sh:1664` (`fechar_a_instalacao`, o encadeamento e o
  "sempre 0"), `:1463` (`perguntar_e_criar_a_conta`, o consentimento, o laço e
  o teto), `:1563` (`parear_esta_maquina`, o `id` virando `--id`), `:1640`
  (`subir_o_agente_como_servico`, a recusa repassada inteira), `:1366`
  (`post_interno`, o corpo pelo stdin e o cabeçalho pelo `--config` 600),
  `:1385` (`criar_primeira_conta`) e `:1426` (`registrar_chave_de_maquina`) —
  os vereditos das duas rotas —, `:1441` (`ler_sem_eco`), `:1345`
  (`nome_da_maquina`), `:1586` (`avisar_chave_parcial`), `:1208`/`:1215`
  (`escapar_json`/`sem_controle`), `:108` (`MARCADOR_SCHEMA=3`), `:1871` (a
  chamada, depois do runner e antes do marcador), `:1882` (o `ownerEmail`).
  Números relidos pelo símbolo em 18/09 (AT-096), em 27/09 (AT-065, que
  acrescentou o ramo do Mac Intel em `instalar_o_runner`) e em 01/10 (AT-122);
  os de `:966`/`:682` já não batiam em 17/09
- **Teste:** `scripts/dev/install-fechamento.spec.ts` — as funções de shell
  rodadas DE VERDADE (o script inteiro carregado por `source`, menos a chamada
  de `main`) contra um servidor `node:http` real e um `brabo-runner` dublê: o
  caminho feliz da conta (corpo, service token e senha chegando), `409`/`400`/
  `500`/sem-resposta com vereditos DIFERENTES, o laço de senha e o teto de 3, a
  ordem `create → registrar → finish → service install` com o `--id` sendo o
  `id` da api, a recusa do `service install` repassada com as palavras dela, o
  `.parcial` que fica quando o registro falha, o `create` que recusa sem nada
  ser registrado, e o fechamento sem binário do agente; `scripts/dev/install.spec.ts`
  (o plano imprimível, e o `--help` que deixou de mentir)
- **Lacuna DECLARADA:** a instalação de ponta a ponta numa máquina limpa —
  compose de verdade, api de verdade, binário do runner de verdade, unit escrita
  e agente esperando o primeiro projeto — é o **E2E** da sessão 8 da fase, e só
  ele pode provar. Aqui o `brabo-runner` é um dublê de shell e a api é um
  servidor de teste; o que se prova é o ENCADEAMENTO, nunca a integração. E o
  fluxo principal do `install.sh` (verificar a própria origem contra o
  `checksums.txt` assinado) continua sem cobertura, pelo motivo que
  `install.spec.ts` já registrava: nenhuma Release tem esse asset até a próxima
  tag final
- **ADR:** [0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md)
- **Origem:** FASE 30, sessão 6 —
  [o recorte da fase](../explanation/fase-30-runner-por-maquina.md)

## O teto de auto-movimento no upsert de WORKSPACE, e a auto-promoção que fecha (RN-557)

### RN-557 — Mudar o PRÓPRIO papel é recusado com 403 nas duas rotas de associação, nos dois sentidos {#rn-557}

> **Estendida pela [RN-615](api.md#rn-615) (ADR 0173):** a rota de remoção de membro de
> workspace que abaixo se diz inexistente passou a existir, com o MESMO teto
> (remover a si mesmo é 403) — e é essa cláusula que segura o último owner, sem
> contar. O raciocínio abaixo sobre o teto 1 continua valendo.

Terceira e última porta da linha aberta pela [RN-472](api.md#rn-472) e continuada pela
[RN-556](api.md#rn-556). O [ADR 0127](../adr/0127-tetos-de-rebaixamento-em-project-members.md)
declarou esta por escrito — *"`POST workspaces/:workspaceId/members` continua um
upsert sem teto nenhum — mesma classe de defeito, escopo acima"* — e o
[ADR 0156](../adr/0156-teto-de-auto-rebaixamento-na-remocao.md) a reafirmou como
"escopo diferente, decisão separada". É o `BRB-002`, P1 de segurança.

**O defeito, medido.** `AddWorkspaceMemberUseCase.execute` recebia
`(workspaceId, userId, role)` e chamava `workspaces.addMember` — **não recebia o
ator** —, e o controller (`@Post(':workspaceId/members')`,
`@RequireRole('owner')`) chamava com o corpo puro, sem `@CurrentUser()`. Não
havia com o que aplicar teto nenhum.

**Por que é mais grave um escopo acima.** Duas coisas que existem no projeto não
existem aqui: (a) **não há nível acima para segurar a queda** — no projeto,
rebaixar-se derruba o efetivo para o papel de workspace, que muitas vezes o
segura; no workspace o papel é o papel, e um `owner` que se grava `viewer` perde
o workspace inteiro, com todos os projetos e a própria capacidade de convidar
quem o reponha; (b) **não existe rota de remoção de membro** —
`WorkspacesController` não tem `@Delete` de membro (medido, e o ADR 0156 já
tinha usado esse fato). Desfazer é esta mesma rota, que pede o `owner` recém
abandonado.

**A auto-PROMOÇÃO era brecha, e fecha.** O ADR 0127 registrou nas Consequences
que ela ficava: *"Um `maintainer` pode se gravar como `owner` do projeto (…) os
tetos são sobre descer"*. Esta RN **revisa** essa frase. As duas metades são o
mesmo movimento — uma pessoa decidindo sozinha qual autoridade tem — e a de cima
é a única que **escala privilégio**: o ADR 0127 pôde dizer que os tetos dele não
eram sobre escalação ("ninguém ganha papel que não tinha"), e sobre a promoção
isso é falso.

| movimento | desfecho |
|---|---|
| mudar o próprio papel no PROJETO, para baixo | **403** — [RN-472](api.md#rn-472), inalterada |
| mudar o próprio papel no PROJETO, para cima | **403** — era permitido, e é o que muda |
| mudar o próprio papel no WORKSPACE, em qualquer sentido | **403** — a porta nova |
| reescrever o próprio papel com o MESMO valor | passa — upsert idempotente não é movimento |
| um `owner` rebaixando OUTRO `owner` no workspace | passa — é a única forma de revogar propriedade |
| associar/rebaixar OUTRA pessoa, em qualquer escopo | passa — capacidade legítima de sempre |
| auto-promoção pela REMOÇÃO da linha de projeto | passa — protegida pelo ADR 0156, ponto 3 |

**O teto NÃO conta owners.** Recusar só quando o chamador for o último dono foi
considerado e recusado pelo critério literal do ADR 0127: *"se enuncia numa
cláusula, não tem número para envelhecer"*. Uma contagem acrescenta uma leitura
que pode sair de fase com a escrita, tem de julgar se um segundo dono inativo
conta, e faz a mesma chamada com o mesmo corpo passar hoje e recusar amanhã sem
que nada do que o chamador controla tenha mudado. E a cláusula **já produz o
invariante que a contagem existiria para garantir**: um workspace nunca fica sem
`owner`, porque tirar o último exigiria que ele mesmo o fizesse.

**O teto 1 não tem par neste escopo, e foi considerado, não espelhado.**
Diferente da remoção ([RN-556](api.md#rn-556)), aqui o movimento EXISTE — um `owner`
pode rebaixar outro. A recusa vem de o teto 1 ser regra sobre **inversão de
hierarquia**: no projeto a linha sobrepõe a de workspace ([RN-471](web.md#rn-471)) e
um `maintainer` alcança quem está ACIMA dele; no workspace o
`@RequireRole('owner')` já garante que ninguém alcança alguém maior que si — a
precondição está ausente. Pôr o par, somado à ausência de rota de remoção, faria
de `owner` um **estado absorvente**: ninguém sairia dele por HTTP, e offboarding,
rotação de propriedade e correção de convite errado passariam a exigir escrita
direta no banco — a classe de estado que o ADR 0127 nasceu para eliminar, com o
sinal trocado.

**A régua não é copiada: a comparação vira UM classificador.**
`autoMovimentoDoProprioPapel` devolve o SENTIDO
(`'rebaixamento' | 'promocao' | null`) em vez de um booleano, porque quem chama
precisa dele para escolher a mensagem. `ehAutoRebaixamento` continua existindo
como uma LEITURA do classificador, e por motivo de comportamento e não de
compatibilidade: `remocaoEhAutoRebaixamento` delega a ela, e alargá-la faria a
REMOÇÃO recusar também a auto-promoção — tirar a própria linha que restringia
alguém é justamente como se desfaz a restrição que o teto 1 impede de criar,
movimento que o ADR 0156 protegeu por escrito.

**Quatro mensagens, uma por SENTIDO e por ESCOPO.** Quem tentou se promover não
recebe a frase de rebaixamento (não foi o que fez), e quem esbarra no teto do
workspace não é mandado falar com um `maintainer` — lá o papel que desfaz é
`owner`. Mesma disciplina do ponto 5 da [RN-556](api.md#rn-556) e da
[RN-470](web.md#rn-470).

**O papel do ator vem do repositório, não do `ResolveEffectiveRoleUseCase`** —
o inverso da escolha da RN-556, pela mesma razão que ela deu: nos casos de uso
de projeto o outro entra para o papel do ator não virar uma segunda composição
de `projectRole ?? workspaceRole` escrita à mão; no workspace não há composição
a proteger (`forWorkspace` É `workspaces.findMemberRole`), e este caso de uso já
tem o repositório na mão.

**A metade de PROMOÇÃO no workspace é inalcançável por HTTP, e é aplicada mesmo
assim.** Com `@RequireRole('owner')` o ator já está no topo e não há para onde
subir. Ela entra e é testada pelo motivo que o teto 2 sempre teve para não ter
limiar: o caso de uso não presume o guard, e é ele que fica certo no dia em que
a rota mudar de mínimo. Mesmo desenho da recusa por capacidade da
[RN-514](engine.md#rn-514), implementada antes de ter disparo.

**Nenhuma linha de web muda, e não é omissão:** `POST /workspaces/:workspaceId/members`
não tem chamador em `apps/web` — medido; a única ocorrência é o tipo gerado em
`api-types.generated.ts`. Não há toast para ajustar nem `Select` para fechar.

- **Código:** `apps/api/src/domain/iam/tetos-de-rebaixamento.ts`
  (`autoMovimentoDoProprioPapel`, o tipo `SentidoDoAutoMovimento`, as três
  mensagens novas e o `ehAutoRebaixamento` que passou a ser leitura do
  classificador),
  `apps/api/src/application/use-cases/iam/add-workspace-member.use-case.ts`
  (a assinatura com `atorId`, a leitura do papel do ator e os dois 403),
  `apps/api/src/application/use-cases/iam/add-project-member.use-case.ts`
  (a troca de `ehAutoRebaixamento` pelo classificador, que é o que fecha a
  auto-promoção lá),
  `apps/api/src/interfaces/http/iam/workspaces.controller.ts`
  (`@CurrentUser()`, o `@ApiForbiddenResponse` e a descrição),
  `apps/api/src/interfaces/http/iam/dto/add-member.dto.ts` e
  `apps/api/src/interfaces/http/iam/projects.controller.ts` (as descrições que
  prometiam "sem teto nenhum" e "downgrading yourself"),
  `apps/api/src/db/seed.ts` (o `owner.id` como ator),
  `apps/api/src/application/use-cases/iam/resolve-effective-role.use-case.ts`
  (INTOCADO, terceiro ADR seguido)
- **Teste:** `apps/api/test/application/use-cases/iam/tetos-de-rebaixamento.use-case.spec.ts`,
  bloco *"Teto de auto-movimento no WORKSPACE — a quarta porta"* (a recusa com
  outro dono presente, a recusa do dono único, a promoção inalcançável, a
  mensagem por escopo, o upsert idempotente, o `owner` rebaixando outro `owner`
  e a associação de terceiros), mais os três casos no bloco do teto 2 — o teste
  da auto-promoção INVERTIDO, com o nome guardando a origem, a asserção de que
  cada sentido tem sua frase, e o upsert idempotente no projeto
- **ADR:** [0157](../adr/0157-teto-de-auto-movimento-no-upsert-de-workspace.md),
  que referencia o [0127](../adr/0127-tetos-de-rebaixamento-em-project-members.md)
  e o [0156](../adr/0156-teto-de-auto-rebaixamento-na-remocao.md), e revisa a frase
  do primeiro sobre a auto-promoção
- **Origem:** `BRB-002`, P1 de Segurança do registro do mantenedor — o último
  movimento que os dois ADRs anteriores deixaram declarado

---

## A chave de dispositivo ganha tela, e a tela diz o alcance de revogar (RN-561)

### RN-570 — O instalador sobe a instalação só com arquivos que a Release assinou, conferidos antes de perguntar ou gravar qualquer coisa {#rn-570}

A [RN-549](ci.md#rn-549) mediu, na primeira vez que o instalador rodou numa máquina
limpa, que o `install.sh` publicado **não subia nada sozinho**: ele chamava
`docker compose -f docker/docker-compose.install.yml`, um caminho RELATIVO ao
diretório de onde rodava, e esse arquivo não era asset da Release, não entrava
no `checksums.txt` assinado e não era baixado em lugar nenhum. Quem seguia o
one-liner do runbook morria em *"no such file or directory"* DEPOIS de o script
ter gravado o `.env` com os segredos. O mantenedor decidiu a saída em
2026-09-13 — asset assinado, e não clone ([ADR 0160](../adr/0160-o-compose-do-instalador-viaja-assinado.md)).

**A regra:**

1. **Quatro arquivos viajam com o instalador, no MESMO manifesto.** O compose de
   instalação e os três que a instalação usa por caminho relativo — o
   `postgres/init.sql` e o `ollama/pull-models.sh` que o compose bind-monta, e o
   `backup/test-restore-compose.sh` que a migração ([RN-530](infra.md#rn-530)) executa —
   são publicados como assets `brabo-install-*` pelo job `checksums` e entram no
   `sha256sum` que gera o `checksums.txt` assinado. O quarto não estava no
   contorno do E2E e foi achado ao implementar: numa pasta sem checkout a
   migração morreria ali. O job confere cada linha do manifesto contra o arquivo
   (`sha256sum -c --strict`) antes de anexar.
2. **A tabela tem dois lados e um guarda.** Quem publica lê
   `scripts/ci/assets-do-instalador.ts`; quem baixa lê o `case` de
   `destino_do_asset_do_instalador` no `install.sh` (bash 3.2, sem Node). O spec
   reprova a divergência entre os dois E deriva do compose todo bind-mount `./…`
   que não estiver na tabela — que é exatamente como o defeito nasceu.
3. **Verificar vem logo depois da própria origem, e antes de tudo.** O
   instalador baixa os quatro e compara cada sha256 contra o `checksums.txt` que
   `verificar_a_si_mesmo` já verificou (nunca um segundo download), por
   igualdade EXATA de nome. As três recusas são distintas — asset não publicado,
   manifesto que não o cobre, hash que não bate — e todas acontecem com a
   máquina intocada.
4. **Nunca cai no relativo.** `COMPOSE_DE_INSTALACAO` nasce VAZIO e só ganha um
   caminho absoluto quando as cópias verificadas são postas sob a pasta da
   instalação, no primeiro instante em que são precisas (a migração ou a
   subida). O que já estiver lá é SUBSTITUÍDO, nunca lido — com `rm` antes do
   `cp`, para um symlink não levar a escrita para fora.

**O que esta regra NÃO fecha:** a prova ponta a ponta só acontece na primeira
tag final depois do merge — o `install-e2e.yml` não roda em PR (ADR 0150) —, e
nenhuma Release já publicada ganha os assets: elas seguem com o instalador
antigo e o contorno de rodá-lo de dentro de um checkout na tag. A adjacência
que o ADR 0160 declarou — `test-restore-compose.sh` chamava o Compose sem
`--env-file`, e o Compose procura o `.env` na pasta do compose — fechou na
AT-102: o instalador passa `BRABO_ENV_FILE` (`--env-file`, e não
`--project-directory`, que também mudaria o nome do projeto e a base dos
caminhos relativos) e o compose de instalação declara o volume `backup_local`
que o serviço `backup` referencia, cuja falta recusava o arquivo inteiro com o
profile ligado. Coberto por `scripts/dev/prova-de-restauracao-env.spec.ts`.

- **Código:** `install.sh:128` (`COMPOSE_DE_INSTALACAO` vazio até materializar),
  `:587` (`ASSETS_DO_INSTALADOR`), `:589` (`destino_do_asset_do_instalador`, a
  tabela do lado que baixa), `:614` (`baixar_e_verificar_os_arquivos_da_instalacao`),
  `:607`/`:615`/`:617` (as três recusas), `:648`
  (`materializar_os_arquivos_da_instalacao`), `:1573` (a migração materializa
  antes do backup), `:1677` (a verificação logo depois da própria origem),
  `:1831` (a subida materializa antes do `up`);
  `scripts/ci/assets-do-instalador.ts:55` (a tabela do lado que publica), `:93`
  (`problemasDoMapeamento`), `:135` (`prepararAssets`);
  `.github/workflows/build-runner-binaries.yml:468` (os assets preparados do
  checkout da tag), `:494` (no mesmo `sha256sum`), `:520` (a conferência
  `--strict`), `:527` (anexados junto do manifesto)
- **Teste:** `scripts/dev/install-arquivos-da-instalacao.spec.ts:144` (caminho
  feliz contra uma Release de mentira), `:162` (asset ausente, `.env` nunca
  gravado — caso de falha), `:179` (hash que não bate — caso de falha), `:191`
  (manifesto que não cobre), `:202` (nome parecido não cobre), `:217`
  (materializar sem verificar é recusa), `:225` (o que já estava é substituído,
  e o symlink não leva a escrita para fora), `:258`/`:273`/`:280` (a ordem em
  `main` e na migração); `scripts/ci/assets-do-instalador.spec.ts:89` (todo
  bind-mount relativo é asset), `:114` (o `case` do shell é a tabela do
  TypeScript), `:148`/`:152`/`:161` (a esteira assina, confere e anexa);
  `scripts/dev/install-e2e.spec.ts:247` (o contorno manual não volta, e o E2E
  afirma que o instalador os baixou), `:295` (o token que baixa o manifesto não
  está no ambiente do instalador)
- **Origem:** AT-026 — o achado da AT-008 (RN-549), decidido pelo mantenedor em
  2026-09-13

## O broker de container na instalação, com consentimento (RN-575)

### RN-575 — O instalador só liga o broker de container com um "s" digitado, mede o grupo do socket de dentro de um container, e grava as quatro linhas juntas ou nenhuma {#rn-575}

Numa instalação por Release, projeto `container` ou `mounted` nunca executava:
quem sobe o container desses dois modos é o broker ([ADR 0144](../adr/0144-a-segunda-raiz-do-broker.md)),
e a instalação não tinha o serviço porque a imagem não era publicada (ADR 0150,
decisão 7). O [ADR 0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)
publica a imagem como a quinta e põe o serviço no compose de instalação,
DESLIGADO; esta regra é o que decide quando ele liga, porque ligar entrega o
socket do Docker da máquina a um serviço da instalação.

**A regra:**

1. **Só um "s"/"sim" digitado liga.** A pergunta vem depois da base (a segunda
   raiz do broker deriva dela) e antes do `.env`, e DIZ em texto o que concede —
   o socket do Docker desta máquina, e que quem comanda o broker comanda o
   Docker — e o que o contém. Enter, qualquer outra resposta e a falta de
   terminal deixam desligado, e a falta de terminal é DITA, nunca decidida em
   silêncio. Enquanto a resposta não é sim, o Docker não é tocado.
2. **O grupo do socket é MEDIDO, de dentro de um container**, com a própria
   imagem do broker, sem rede, rootfs read-only e o socket montado por
   `--mount type=bind` — que recusa uma origem inexistente em vez de criar uma
   pasta no host, como `-v` faria. É o gid visto de dentro que o `group_add`
   precisa (no Docker Desktop o do host não diz nada). Medição que falha, caminho
   que não é socket ou gid que não é número são RECUSA nomeada, que ensina a
   rodar de novo respondendo não — nunca o `999` do default do compose.
3. **As quatro linhas vão juntas ou nenhuma vai:** `COMPOSE_PROFILES=container-broker`,
   `BROKER_URL=http://broker:8090`, `DOCKER_GID` e `PROJECT_WORKSPACES_HOST_ROOT`.
   Profile sem URL sobe um broker que ninguém chama; URL sem profile aponta a
   api para um serviço que não sobe. `escrever_env` recusa gravar o bloco sem o
   gid medido — defeito do script, não da máquina. `BRABO_BROKER_IMAGE` é
   gravada SEMPRE, ligado ou não: o Compose interpola o arquivo inteiro antes de
   filtrar por profile.
4. **A raiz da pasta gerenciada é CALCULADA e depois CONFERIDA.** Antes da
   subida, `<DockerRootDir>/volumes/brabo_project_workspaces/_data`; depois,
   comparada com o `Mountpoint` do volume. Divergir, ou a api não alcançar o
   broker pela rede interna, vira PENDÊNCIA nomeada no fim — nunca recusa, que
   derrubaria uma instalação de pé por um passo que se conserta editando o
   `.env`.
5. **A decisão aparece no resumo final**, nos dois sentidos, e a frase do que
   o instalador NÃO faz deixa de dizer que só a Pasta montada fica sem
   container: `container` também fica.

**O que esta regra NÃO fecha:** o `DOCKER_GID` e a raiz calculada não foram
medidos no Docker Desktop do macOS, e o E2E da tag roda a metade interativa só
no Linux. Docker rootless ou remoto não tem o socket em `/var/run/docker.sock`,
que é o caminho que o compose monta, e cai na recusa do item 2 — ligar o broker
ali não é oferecido por outro caminho.

- **Código:** `install.sh:1050` (`consentir_broker`), `:1002`
  (`medir_gid_do_socket`), `:1037` (`calcular_raiz_gerenciada`), `:1034`
  (`conferir_o_broker`), `:792` (`escrever_env_do_broker`), `:855` (o broker no
  manifesto), `:1812` (a ordem: depois da base, antes do `.env`);
  `docker/docker-compose.install.yml` (o serviço `broker` e a rede `broker`)
- **Teste:** `scripts/dev/install-broker.spec.ts:158` (sem terminal: desligado,
  dito, Docker intocado — caso de falha), `:169` (Enter), `:179` (`n`), `:187`
  (`s` liga, com `--mount` e sem rede), `:208`/`:221`/`:229` (as três recusas),
  `:237` (a raiz como pendência), `:248` (a frase final);
  `scripts/dev/install-env.spec.ts:250`/`:259` (as quatro linhas juntas ou
  nenhuma), `:270` (a guarda do gid), `:291`/`:307` (o `.env` contra o parser do
  Compose: o broker sobe sem flag, com o token, as duas raízes e o gid, e a api
  aponta para ele — ou nada disso); `scripts/dev/composes-em-conformidade.spec.ts:114`
  (as camadas do ADR 0130 no arquivo que viaja)
- **ADR:** [0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)
- **Origem:** AT-097 — decidido pelo mantenedor em 2026-09-18

---

## O instalador oferece os modelos locais, e não confunde o dev com uma instalação (RN-691, RN-692)

### RN-691 — O `install.sh` PERGUNTA se liga os modelos locais (profile `llm`), mede a porta do Ollama antes de gravar, e compõe UMA linha de `COMPOSE_PROFILES` {#rn-691}

Medido numa instalação real da v7.0.0 (AT-351): toda regra de negócio gravava
`backlog.semantic_duplicate_check_skipped` com `getaddrinfo EAI_AGAIN ollama`,
porque a instalação por Release sobe sem o profile `llm` e o instalador nunca
perguntava; ligá-lo à mão esbarrava em `address already in use` na 11434, a
porta de um Ollama NATIVO no host.

**A regra:** depois da pergunta do broker ([RN-575](#rn-575)), o instalador diz
o CUSTO (disco da imagem e dos modelos que o `ollama-model-loader` baixa, RAM
com modelo carregado) e o que se PERDE sem ele (a checagem semântica de
duplicata da [RN-681](api.md#rn-681) e modelo local para os agentes), e só um "s"
digitado liga; sem terminal fica desligado DIZENDO isso. Ligar MEDE a porta do
host antes de gravar qualquer coisa — a 11434, ou a primeira livre até a 11443,
pelo `/dev/tcp` do próprio bash (3.2 incluso) — e a faixa inteira ocupada é
recusa NOMEADA, sem nada gravado, nunca um `address already in use` na subida.
O `.env` ganha `OLLAMA_PORT` e o profile `llm`; os profiles consentidos saem
numa ÚNICA linha `COMPOSE_PROFILES` (`container-broker,llm`), porque duas
linhas não somam — a última venceria e o broker sumiria calado.

Fica FORA, declarado: a sessão dizer UMA vez que a checagem semântica foi
pulada (lado da api, outra frente); e o E2E da tag responde NÃO (ligar
baixaria GBs de modelo), então a subida com o profile `llm` não é provada ponta
a ponta.

- **Onde:** `install.sh:1128` (`consentir_llm`), `:1113`
  (`escolher_porta_do_ollama`), `:1103` (`porta_em_uso`), `:800`
  (`escrever_env_do_llm`), `:821` (`escrever_env_dos_profiles`)
- **Teste:** `scripts/dev/install-llm.spec.ts` (sem terminal fica desligado
  dizendo o custo; 11434 ocupada escolhe a próxima; faixa inteira ocupada falha
  — caso de falha; um servidor escutando é medido como em uso; broker e modelos
  numa linha só); `scripts/dev/install-e2e.spec.ts` (a resposta da pergunta nova
  está na lista do driver de TTY, na ordem)
- **Origem:** AT-351

### RN-692 — Só o projeto compose `brabo` é instalação anterior, e a migração oferece reinstalar DO ZERO depois do backup provado {#rn-692}

`detectar_por_sinais` casava `"Name":"brabo[^"]*"`, e o compose de DEV
(`brabo-dev`, ADR 0170) contava como instalação anterior — o instalador
oferecia migrar o ambiente de desenvolvimento. Agora casa só o nome EXATO
`brabo`.

E a confirmação da migração ganha uma terceira resposta: `z` reinstala DO
ZERO. A ordem do ADR 0150 não muda — backup, PROVA, pergunta, apaga, instala —,
mas os dados antigos NÃO são restaurados: o backup provado fica na pasta, e
restaurá-lo depois é o `#restore` do runbook. `s` segue restaurando, e Enter
continua não apagando nada.

Junto, o fechamento deixa de dizer que parear uma pasta pela tela do projeto
"continua existindo (ADR 0118)": esse fluxo saiu no ADR 0203 ([RN-687](web.md#rn-687)).

- **Onde:** `install.sh:370` (`detectar_por_sinais`), `:1694`
  (`migrar_instalacao_anterior`)
- **Teste:** `scripts/dev/install-llm.spec.ts` (`brabo-dev` não conta e `brabo`
  conta; `z` apaga depois da prova e deixa `MIGRAR_DE` vazio; Enter não apaga —
  caso de falha; a frase do ADR 0118 não volta)
- **Origem:** AT-358
