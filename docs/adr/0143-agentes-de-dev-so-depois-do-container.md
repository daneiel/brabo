# 0143 — Agentes de dev só depois do container

## Status

Aceito — 2026-09-04

## Context

Numa execução real do projeto `exp001` (2026-09-04), o fio andou longe:
bootstrap de Gitflow, `product_brief`, `module_map` e, às 18:00, o Arquiteto
entregando `project_image`, `module_routing` e o diagrama C4. Duas ADRs
viraram PR, três merges passaram. E então **dez tasks de dev travaram de uma
vez**, todas com o mesmo desfecho: o working tree do dev agent não tinha onde
nascer.

O achado que importa aqui não é a causa daquela pasta específica — é que
**nada ordenava container antes de dev agent**. Nenhum `container_start` foi
proposto, e os dez dev agents começaram assim mesmo, para travar dez vezes.

Havia um segundo defeito, mais silencioso, na mesma linha do fluxo. O
[ADR 0134](0134-dev-agents-executam-dentro-do-container.md) (RN-492) fez o
comando de terminal do dev agent atravessar engine → api → broker e rodar
DENTRO do container real — **quando havia um**. Quando não havia,
`Engine.Actions.TerminalExecutor.decisao_de_execucao/1` caía em
`:caminho_de_sempre`, isto é, `System.cmd` dentro do processo do engine — o
mesmo processo que fala com o banco, com a api e com todos os outros projetos
da instalação. O isolamento que o ADR 0134 existe para criar valia só no
caminho feliz, e a ausência dele não recusava: degradava, e degradava calada.

Este ADR fecha as duas metades.

## Decision

### 1. A guarda mora no `try_claim`, não só na fronteira HTTP

`Engine.Dev.AgentIo.try_claim/2` — o ponto ÚNICO de claim — consulta
`Engine.Containers.ProjectContainerLifecycle.running?/1` **antes** de chamar
`claim_task/1`. Sem uma linha REGISTRADA `running` em `project_containers`
([ADR 0081](0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)), o agente cai em
`:idle`, persiste e emite `dev.blocked_by_container` — sem chamar a api.

O predicado **já existia**: é o mesmo que o `TerminalExecutor` consulta desde
o ADR 0134. Nada novo foi construído para responder à pergunta; o que mudou
foi quem a faz, e quando.

O gate equivalente na api (`ActivateExecutionUseCase` recusando com 400 sem
`ciclo?.status === 'running'`) é decisão do PR irmão, e é ele que dá o **aviso
ao humano** no momento do clique. Ele não substitui esta guarda, porque o
claim tem um caminho que rota nenhuma cobre: a **reidratação**.
`Engine.Dev.DevRehydrator` não faz cast `:work`; quem claima depois de um
restart do engine é `DevAgentServer.init/1` → `finish_restart_recovery/1` →
`try_claim/2`, sem passar por nenhum endpoint. Um gate só na fronteira HTTP
deixaria todo agente reidratado voltar a trabalhar sem container — e o
restart é exatamente a situação em que ninguém está olhando.

A guarda vem **antes** de `claim_task/1`, e não depois: reivindicar para
devolver logo em seguida deixaria a task marcada e sem dono vivo, que é o
estado que `AgentIo.block_task/4` existe para nunca produzir.

### 2. `:idle`, e não um status novo

O docblock da cláusula `{:error, reason}` do próprio `try_claim/2` já
registrava a razão, escrita quando um travamento permanente de agente foi
corrigido na Fase 12b: *"`:idle` é o único estado do qual um wake ainda
resgata"*. Todos os guards de `handle_info/2` estão casados com ele —
`{:wake, :became_claimable}` exige `:idle`, `:rearm` exige `:idle_tripped`,
`{:gate_resolved, …}` exige `task_id` batendo.

Um `:blocked_by_container` inventado aqui seria um estado do qual **nada**
resgata: o agente ficaria parado para sempre, recriando o sintoma que a Fase
12b existiu para eliminar. Quem distingue "parei porque a fila esvaziou" de
"parei porque não há container" é o EVENTO (`dev.idle` ×
`dev.blocked_by_container`), não o status — e o evento é durável, no padrão da
RN-059.

### 3. O wake vem pelo outbox, num agregado próprio

Leitura não avisa ninguém. Um agente já parado em `:idle` continuaria parado
até um evento não relacionado passar por perto — o que é, na prática, "até
alguém reativar a execução na mão".

Então `RegistrarTransicaoDeContainerUseCase` publica: ao gravar a chegada em
`running`, ele acrescenta, **na mesma transação**, uma linha de outbox
`container.running`. `Engine.Outbox.Drain` passa a drenar um terceiro
`aggregate_type` (`"container"`, ao lado de `"session"` e `"task"`), e
`Engine.Workers.DevAgentWakeWorker` entrega a mensagem aos agentes do projeto.

Três escolhas dentro dessa:

- **`aggregateType: 'container'`, e não `'task'`.** O agregado `task` já era
  drenado, e reusá-lo custaria zero linhas no drain — mas o evento não é
  sobre task nenhuma. O `graph_projection` do
  [ADR 0099](0099-neo4j-grafo-de-conhecimento-e-templates.md) já estabeleceu que
  `aggregate_type` é como consumidores diferentes não correm uns contra os
  outros; mentir sobre ele para economizar uma linha de query envelhece mal.
- **`aggregateId` é o PROJETO**, não a linha de `project_containers`: quem
  consome acorda agentes por projeto, e a linha pode ter sido recriada.
- **`{:wake, :became_claimable}`, a mensagem que já existia.** A semântica
  dela já é "pode haver trabalho agora" — o comentário de
  `EngineWeb.ExecutionCommandController.acordar/4` a usa exatamente assim
  para reativação de execução, que também não é sobre uma task específica.
  Uma mensagem nova exigiria cláusula nova de `handle_info/2` nos DOIS
  servers (real e Noop) com guard idêntico ao que já existe, sem nenhuma
  decisão diferente para tomar.

O fan-out é por PROJETO (`DevAgentState.list_by_project/1`), não por módulo:
o container é do projeto, e a api não tem como saber quais módulos existem do
lado do engine.

### 4. O terminal para de degradar calado

`decisao_de_execucao/1` ganha `:recusar_container_ausente`, espelhando o
`:recusar_nao_verificado`/`:recusar_runner_desconectado` que o modo `runner`
já tinha desde o [ADR 0104](0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md). É a mesma
disciplina — "faltou a pré-condição, então não executa em lugar nenhum" —
aplicada ao modo que ainda não a tinha.

`mounted` entra no **mesmo ramo**: com container `running`, atravessa pro
broker igual a `container`; sem ele, recusa. Tratá-lo diferente seria
arbitrário depois que `mounted` passou a subir container de verdade.

E o catch-all `_ -> :caminho_de_sempre` encolhe para o que sempre deveria ter
sido sozinho: **projeto inexistente ou `project_id` malformado**. Nenhum modo
de execução cai nele.

A recusa é `failed_result` normal, nunca crash — mesmo contrato de falha das
outras duas recusas do módulo.

## Consequences

**Projeto sem container de pé para de trabalhar, e diz por quê.** Isso é o que
a decisão existe para fazer, não um efeito colateral. É também por que ela só
pode entrar DEPOIS das mudanças que dão container ao modo `mounted`: sem elas,
projeto `mounted` fica sem dev agent nenhum, com a única saída sendo o modo
`container`.

**Toda spec de dev agent anterior passou a precisar de um container
`running`.** São nove arquivos de teste no engine, e a mudança foi uma linha
de setup em cada (`Engine.DataCase.container_running!/1`) — não um módulo
trocável por config. Foi escolha: um seam de produção que existisse só para a
suite não passar tornaria a guarda inerte justamente onde ela é exercitada.

**Uma pergunta, dois lugares que a fazem.** `AgentIo.try_claim/2` e
`TerminalExecutor.decisao_de_execucao/1` chamam os dois o mesmo
`ProjectContainerLifecycle.running?/1`. Não são duas derivações: é uma
função, com dois chamadores, respondendo perguntas diferentes ("posso
começar?" e "onde isto roda?").

**A entrega do wake continua at-most-once**, como todo `Engine.Dev.Wake`
(o moduledoc dele declara isso desde a Fase 12b). Se o agente estiver
momentaneamente fora do ar quando o broadcast acontece, ele fica `:idle` até
o próximo evento — inclusive uma reativação manual da execução, que entrega
o mesmo `{:wake, :became_claimable}`.

**`running` REGISTRADO continua não sendo `running` OBSERVADO**
([RN-486](../business-rules.md#rn-486)). Um container que morreu por fora
ainda passa por esta guarda; o agente claima, e a falha aparece na primeira
chamada ao broker, como falha normal de comando. Fundir os dois exigiria uma
chamada de rede por claim, e a RN-486 é explícita em não fundi-los.

## Referências

- [ADR 0081](0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md) — a tabela
  `project_containers` e a máquina de estados
- [ADR 0134](0134-dev-agents-executam-dentro-do-container.md) — o comando de
  terminal dentro do container; este ADR é o que faz ele pousar
- [ADR 0135](0135-portao-de-imagem-nos-tres-modos.md) — o portão da imagem
  passou a valer nos três modos
- [ADR 0137](0137-o-runner-sobe-o-container-do-projeto.md) — `mounted`/`runner`
  subindo container na máquina do usuário
- [RN-502](../business-rules.md#rn-502)
