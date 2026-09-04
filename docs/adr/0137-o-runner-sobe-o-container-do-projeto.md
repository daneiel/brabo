# 0137 — O `brabo-runner` sobe o container do projeto na máquina do usuário

## Context

O portão da imagem (RN-105) passou a valer nos TRÊS modos de execução desde
a RN-494 (ADR 0135): `mounted`/`runner` precisam de `artifact.project_image`
decidido para a aba Code abrir, exatamente como `container`. O que a RN-494
deixou declarado, com todas as letras: "o que não sobe é o container em
si — `mounted`/`runner` continuam sem container próprio no servidor." Este é
o PR que fecha essa metade, mas não do lado do SERVIDOR — do lado do
USUÁRIO.

Hoje, projeto em modo `runner`/`mounted` executa TODO comando de terminal
direto na máquina do usuário (`child_process`, sem isolamento nenhum) — o
mesmo `brabo-runner` que já mantém o canal Phoenix `terminal:<projectId>`
(ADR 0103/0104) e já sabe FALAR com o Docker DELE (`@brabo/docker-port`,
provado por `--self-test-docker` desde o ADR 0128, sem consumidor real até
agora). O broker (`apps/broker`, ADR 0130) já dá esse isolamento pro modo
`container`, subindo container no SERVIDOR — mas ele NUNCA vai subir
container pra `mounted`/`runner`: o código deles mora numa pasta do USUÁRIO
que o servidor não enxerga (`ModoDeExecucaoNaoSuportadoError`,
`apps/broker/src/operacoes.ts`). O único processo que enxerga essa pasta é
o próprio runner, na máquina de quem tem a pasta.

## Decision

**`container_start`/`container_stop`/`container_remove` ganham um SEGUNDO
caminho de execução, ramificado pelo `executionMode` do projeto — `container`
continua pelo broker, `mounted`/`runner` passam a pedir ao RUNNER conectado,
via o MESMO canal Phoenix que já existe.**

### Reuso do par exec/exec_result, três vezes

`apps/runner/src/channel.ts` já tinha o padrão exato para "servidor pede
algo ao runner, runner responde, correlacionado por `ref`, com timeout":
`exec`/`exec_result`, do lado runner; `Engine.Runners.RunnerRouter.exec/4` +
`EngineWeb.TerminalChannel` (`handle_info({:dispatch_exec, ...})` +
`handle_in("exec_result", ...)`), do lado engine. Este PR REPLICA esse
padrão, três vezes — nunca inventa um novo:

- `container_start`/`container_start_result`
- `container_stop`/`container_stop_result`
- `container_remove`/`container_remove_result`

Do lado engine, `RunnerRouter` ganha `start_container/3`, `stop_container/3`
e `remove_container/3`, fatorados sobre um `dispatch/5` privado comum (as
três divergiam só no átomo de evento e no de resultado — `exec/4` continua
com o próprio código, sem tocar). `TerminalChannel` ganha quatro
`handle_info({:dispatch_container_*, ...})` (`despachar_pedido/6`, molde
comum com `dispatch_exec`) e três `handle_in("container_*_result", ...)`
(`responder_pedido_pendente/3`, que também passa a atender `exec_result` —
mesmo `pending_execs`, um mapa genérico ref→from que não sabe nem precisa
saber QUE pedido está pendente).

Do lado runner, `channel.ts` ganha os três tipos de mensagem +
`enviarContainerStartResult`/`Stop`/`Remove`; `RunnerChannelHandlers` ganha
`onContainerStart`/`onContainerStop`/`onContainerRemove`; `index.ts` ganha
`tratarContainerStart`/`Stop`/`Remove`, que chamam `DockerViaCli` — a MESMA
porta que o broker usa do lado servidor (`packages/docker-port`, ADR 0130),
com o Docker do USUÁRIO.

### O caminho HTTP novo: api → engine → runner

`ApiToEngineClient` (a porta que a api já usa para `executeTerminalAction`,
síncrono) ganha `startContainerViaRunner`/`stopContainerViaRunner`/
`removeContainerViaRunner`. `EngineWeb.ContainerCommandController`
(`POST internal/projects/:projectId/containers/{start,stop,remove}`) é o
único chamador do lado engine — ele repassa pra `RunnerRouter` e nunca
escreve `project_containers` (quem escreve continua sendo
`RegistrarTransicaoDeContainerUseCase`, do lado api, depois que a chamada
volta).

**A resposta do engine é SEMPRE 200** — mesma disciplina de
`ActionCommandController`/`ExecutarComandoNoContainerUseCase` (ADR 0134):
`sucesso: false` no CORPO, nunca um status HTTP de erro, para as duas
causas que são falha NORMAL — sem runner conectado/timeout
(`motivoCodigo`), e o runner tendo tentado e recusado (Docker indisponível
na máquina do usuário, especificação inválida). `HttpApiToEngineClient`
lança `RunnerNaoConectadoError` só no primeiro caso, `RunnerRecusouContainerError`
no segundo — os três casos de uso capturam os DOIS juntos (mesmo raciocínio
de `BrokerRecusouError`/`BrokerIndisponivelError`) e gravam `failed` com o
motivo, nunca deixam propagar.

### A imagem: LIDA, nunca ELEITA de novo

`ExecuteContainerStartUseCase` (ADR 0133) elege uma imagem candidata do
roteamento do Arquiteto e emite uma nova versão de `artifact.project_image`
(`DecidirImagemDoProjetoUseCase`, `decidedBy: 'infra-lead'`) ANTES de pedir
ao broker para subir — isso é específico do caminho `container`, e o
caminho `mounted`/`runner` NÃO repete esse passo. Ele só LÊ a decisão
VIGENTE via `ObterSpecDeContainerUseCase` — o MESMO caso de uso que já
compõe `GET .../container-spec` para o broker (ADR 0130), chamado DIRETO,
sem HTTP, porque `ExecuteContainerStartUseCase` e `ObterSpecDeContainerUseCase`
rodam no mesmo processo da api. Sem imagem decidida (RN-105), falha ANTES
de perguntar ao engine — o mesmo portão que já vale para as três outras
partes do produto.

O payload que viaja pro runner (`EspecificacaoDeContainerParaRunner`) é os
MESMOS campos de `EntradaDeEspecificacao` (`packages/docker-port`) MENOS
`raizDoProjeto` — o runner enche esse campo sozinho, com `estado.dir`. Isso
não é economia de banda: é a decisão de que NENHUM caminho de host viaja do
servidor pro runner, pelo mesmo motivo que nenhum viaja do servidor pro
broker (`apps/broker`, ADR 0130) — quem sabe o caminho de VERDADE é quem
está na máquina.

### `Engine.Actions.TerminalExecutor` NÃO ganhou saída nova

Achado confirmado lendo o código: `decisao_de_execucao/1` já roteia
INCONDICIONALMENTE todo comando de projeto `runner` VERIFICADO e CONECTADO
para `RunnerRouter.exec/4` (RN-423, ADR 0104) — ela não pergunta "tem
container?", só "tem runner?". A decisão "rodar no host ou dentro do
container que subi" é INTERNA ao runner, não ao engine, e por isso o engine
não precisa saber que ela existe.

O que muda é só `apps/runner/src/index.ts`: `EstadoDoRunner` ganha
`containerAtivo: string | null` (o NOME do container que ESTE runner subiu
— `brabo-<workspaceDirName>` — ou `null`); `tratarExec` passa a checar esse
campo — com container ativo, roda via `DockerViaCli.exec(nome, { comando,
cwd })`; sem, cai no caminho de sempre (`executarComando` direto no host).
`cwd` (já validado por `validarCwdDentroDaRaiz` contra a raiz do projeto) é
traduzido pra dentro de `/work` por troca de PREFIXO
(`cwdParaContainer(raiz, cwd, pontoDeMontagem)`, `guard.ts`) — mesmo
raciocínio de `cwd_para_container/2` do lado engine (RN-492, ADR 0134): a
raiz vira o ponto de montagem, o resto do caminho segue igual.

`containerAtivo` sobrevive a reconexões do canal (ele é parte de `estado`,
que persiste através do `while` de `main()`) — o container Docker em si não
cai quando o WebSocket cai, e o runner não deveria "esquecer" dele por causa
de uma reconexão.

### `guard.ts`/RN-434 já cobre o mount, sem código novo

O plano original registrou a pergunta: o bind-mount do container precisa de
uma segunda validação de "caminho de mount válido"? **Confirmado que não,
lendo `guard.ts` inteiro.** `estado.dir` JÁ é a raiz confirmada — validada
por `validarDirDentroDoHomeNoLinux` (RN-434, recusa `--dir` fora do `$HOME`
no Linux) e por `garantirDiretorio` (RN-435), as duas no STARTUP da CLI,
ANTES de qualquer canal conectar ou qualquer container subir. O mount do
container É `estado.dir`, ponto — não existe (nem precisa existir) uma
segunda checagem tipo `caminhoDeWorkspaceLocalValido` do lado runner. RN-434
"passa a cobrir também o caminho montado" só porque o mount usa a MESMA
variável que ela já validou, não porque algo novo foi escrito.

## Consequences

**`packages/docker-port` ganha USO REAL do lado runner** — antes só provado
por `--self-test-docker` (ADR 0112/0128); agora `DockerViaCli.start/stop/
exec` são chamados de verdade, com o Docker do usuário.

**As CINCO operações da `DockerPort` continuam sem sexta** — `start`/
`stop`/`remove`/`inspect`/`exec` seguem sendo as mesmas cinco; este PR só
lhes dá um SEGUNDO consumidor (o runner, além do broker), nunca um campo
novo na especificação.

**`mounted` ganha o MESMO caminho que `runner`** — a ramificação nos três
casos de uso é por `executionMode !== 'container'`, não por
`executionMode === 'runner'`; `mounted` também passa a poder subir
container próprio, desde que tenha um runner conectado (o `brabo-runner`
roda igual nos dois modos, RN-169/RN-421/RN-422).

**A contenção estrutural do `join` (broker, ADR 0055) continua ausente para
`mounted`/`runner`** — o vetor de symlink que o ADR 0055 já registrava
segue aberto; o que este PR fecha é a FALTA de isolamento nenhum, não uma
fronteira tão forte quanto a do servidor. `guard.ts` continua sendo
best-effort, por invariante — não lacuna deste PR.

**Exclusividade por `{project_id, machine_id}` segue adiada** (lacuna já
declarada em CLAUDE.md, ADR 0104) — dois runners conectados ao mesmo
projeto continuam impossíveis pela exclusividade do `Registry` (`:global`),
não por uma checagem de container.

**Alternativa considerada e descartada: reeleger a imagem no caminho
`mounted`/`runner` também, chamando `DecidirImagemDoProjetoUseCase`.**
Faria os dois caminhos simétricos na aparência, mas obrigaria o payload de
`container_start` a carregar `network`/`resources`/`rationale` mesmo quando
ninguém os usa (o runner não precisa deles: ele só lê a decisão vigente).
Descartada: o caminho `mounted`/`runner` já tem a decisão de imagem —
alguém decidiu ANTES, pelo Arquiteto ou pela Infra, do jeito de sempre — e
reeleger aqui duplicaria uma decisão que já existe, sem nenhuma candidata
nova para eleger entre.
