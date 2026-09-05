# 0145 — Docker vira pré-requisito real do modo `runner`

## Context

O modo `runner` (ADR 0104) existe para código que mora numa pasta do usuário
SEM bind-mount para o servidor, confirmada por um CLI (`brabo-runner`) rodando
na máquina dela. Desde o ADR 0137 (RN-497), esse mesmo CLI também sobe um
container Docker DA MÁQUINA DO USUÁRIO, e `Engine.Actions.TerminalExecutor`
roteia todo comando de terminal aprovado para o runner sempre que workspace
está VERIFICADO e o runner está CONECTADO — sem checar se há container
`running` nenhum. A escolha host-vs-container era inteiramente INTERNA ao
runner (`EstadoDoRunner.containerAtivo`): com container de pé, ele rodava via
`docker exec`; sem ele, caía silenciosamente no HOST puro, executando o
comando fora de qualquer isolamento.

Isso deixava `runner` inconsistente com `container`/`mounted`, que desde o
ADR 0143 (RN-502) já RECUSAM rodar terminal sem container `running` registrado
— nunca degradam para `System.cmd` local. Para `runner`, o "local" era o
próprio host do usuário: o mesmo fallback silencioso que o ADR 0143 fechou
para os outros dois modos continuava aberto aqui, do lado de fora do
servidor.

Um segundo defeito, declarado desde a RN-478 e nunca corrigido: a
materialização do working tree do dev agent
(`Engine.Actions.Workspace.ensure!/4`) tentava `File.mkdir_p!`/
`System.cmd("git", ...)` LOCAL, dentro do processo do engine, contra um
caminho que só existe fisicamente na máquina do usuário — o processo do
engine não tem bind-mount nenhum para lá. A correção anterior só melhorou a
MENSAGEM de uma falha inevitável; o dev agent continuava sem onde trabalhar.

Um terceiro ponto, achado durante a investigação: `container_start` (a ação
que sobe o container de verdade, ADR 0130/0133) também atendia `runner`, mas
o payload dela (`imagem`/`network`/`resources`/`rationale` — a Infra ELEGE
uma candidata do roteamento do Arquiteto) nunca fazia sentido para esse
caminho: o broker nunca alcança a pasta de um projeto `runner`, então não há
roteamento contra o qual eleger, e a imagem que sobe é simplesmente a que já
estiver decidida.

## Decision

**Docker vira pré-requisito real do modo `runner`, sem fallback para o
host.** As três pré-condições que `runner` precisa ter para qualquer comando
alcançar a máquina do usuário — workspace CONFIRMADO, runner CONECTADO e
container REGISTRADO `running` (`ProjectContainerLifecycle.running?/1`, o
MESMO predicado de `container`/`mounted`) — vivem numa função só,
`Engine.Runners.RunnerReadiness`, com dois consumidores: `TerminalExecutor`
(que já checava as duas primeiras) e o módulo novo abaixo.

**A materialização do worktree passa a acontecer DENTRO do container real do
projeto, na máquina do usuário — pelo MESMO canal que já executa terminal.**
`Engine.Actions.Workspace.ensure!/4` bifurca por `execution_mode`: local para
`container`/`mounted` (inalterado), via `Engine.Actions.Workspace.RunnerGit`
(novo) para `runner`. `RunnerGit` faz `git init`/`remote add`/`fetch`/
`checkout`, e os equivalentes de `File.dir?`/`ls`/`rm_rf` que
`Engine.Dev.WorktreeManager` precisa, como comandos de shell normais,
entregues por `Engine.Runners.RunnerRouter.exec/5` — nunca um mecanismo novo,
sempre depois de `RunnerReadiness.verificar/1` confirmar as três
pré-condições. `WorktreeManager` (`create/3`, `remove/2`, `list/1`,
`cleanup_orphans/2`) bifurca pelo mesmo critério, e o job periódico
`Engine.Dev.WorktreeCleanup` passa a PULAR (não falhar) um projeto `runner`
sem runner pronto AGORA, continuando normalmente para os demais.

**O protocolo `exec`/`exec_result` ganha um campo `env` opcional.** O `git
fetch` autenticado precisa da credencial do provider (ADR 0056), que só pode
viajar no ambiente do processo filho — nunca argv, nunca arquivo. Como esse
processo filho agora nasce na máquina do usuário, `env` (um
`Record<string,string>`) entra no payload que o engine despacha; o runner
MESCLA esse `env` em cima de `process.env` antes do `spawn` (nunca substitui
— perderia PATH) e nunca o repassa ao caminho `docker exec` (sem suporte a
`env` em `packages/docker-port`, de propósito — ver Consequences) nem o
imprime em log nenhum.

**`container_start` migra inteiro para exclusivo de `container`/`mounted`
(os dois pelo broker, RN-503). Nasce `container_start_via_runner`, tipo de
ação novo, exclusivo de `runner`.** Mesmo calibre de `container_start`
(`maintainer`, `require_approval` por padrão, configurável em
`permissions.json`) — mas o schema só tem `rationale` opcional: não elege
candidata nenhuma, sobe a imagem já DECIDIDA
(`ObterSpecDeContainerUseCase`). `Engine.Infra.Tools.
ProposeContainerStartViaRunner`, a tool nova do Infra Lead, é interceptada
pelo `InfraLeadServer` ANTES de chamar `propose_action` — consulta
LOCALMENTE (`Project.get/1` + `Engine.Runners.Registry.connected?/1`, sem
HTTP, no mesmo processo BEAM) o `execution_mode` e a presença de um runner
conectado, recusando com motivo nomeado em vez de propor às cegas.

## Consequences

- **Projeto `runner` sem container `running` perde terminal e worktree de dev
  agent até alguém propor e aprovar `container_start_via_runner`.** Custo
  aceito e MEDIDO contra o precedente real: a mudança irmã para
  `container`/`mounted` (ADR 0143, RN-502) já tinha o mesmo formato — "passa
  a exigir onde antes não exigia" — e saiu `feature/`, MINOR, sem branch
  `breaking/`. Nenhum projeto `runner` existente tinha isolamento garantido
  antes desta entrega (o fallback silencioso para o host é exatamente o que
  se fecha), então não há comportamento correto anterior sendo retirado —
  só um comportamento inseguro deixando de existir.
- **`env` só chega ao `git fetch` quando o runner escolhe o caminho HOST.**
  Se o runner já tem um container ativo (`EstadoDoRunner.containerAtivo`),
  `tratarExec` roteia TODO `exec` — incluindo os de `RunnerGit` — via `docker
  exec`, que não tem campo de `env` (decisão medida do ADR 0130: manter a
  porta de Docker com tipo fechado, sem `-e` livre). Um `git fetch`
  despachado nesse estado perde a credencial silenciosamente para repositório
  privado. Não resolvido nesta entrega — estender `packages/docker-port`
  para aceitar `env` tocaria os DOIS consumidores dela (runner e broker) e
  ficou fora do escopo; declarado para quando o volume de projetos `runner`
  com repositório privado justificar.
- **`RunnerReadiness.verificar/1` roda de novo a cada chamada de
  `RunnerGit`** (uma consulta a mais por operação de git/worktree) — aceitável
  porque nenhuma função deste módulo está no hot path (mesma régua que já
  valia para `Engine.Actions.Workspace.ensure!/4` antes desta entrega).
- **A lacuna que a RN-494 declarou para `propose_container_start`** (nem ele
  nem `GetInfraContextUseCase` restringem por `executionMode` — o Infra Lead
  pode propor às cegas) **continua exatamente como estava para aquela tool.**
  A tool NOVA (`container_start_via_runner`) nasce sem essa lacuna porque
  nasce sabendo negar — mas isso não retroage: `propose_container_start`
  segue sem saber distinguir modo, decisão separada, fora do escopo de
  API/domínio.
