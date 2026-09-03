# 0134 — Dev agents executam DENTRO do container real do projeto, e o terminal ganha um piso de auto-aprovação lá dentro

## Context

O ADR 0133 (PR 1.5) fechou o caminho `container_start` (`proposed_action` →
aprovação → broker → `project_containers`) de ponta a ponta e declarou, com
todas as letras: "os dev agents AINDA não trabalham dentro do container que
sobe [...] o que roda dentro do container, por enquanto, é só o que o broker
sobe — sem consumidor ainda." Este é o PR que dá o consumidor.

Hoje, mesmo com um container real de pé, `Engine.Actions.TerminalExecutor`
continua rodando TODO comando de terminal de dev agent via `System.cmd`
DENTRO do processo do próprio engine, contra a pasta compartilhada
(`PROJECT_WORKSPACES_ROOT`) — exatamente como sempre fez. O container fica
ocioso: nada nele nunca é `docker exec`ado.

## Decision

**Quando o projeto está em `execution_mode: container` com uma linha
REGISTRADA `running` em `project_containers`, o comando de terminal do dev
agent passa a rodar DENTRO do container, via `docker exec` (pelo broker) —
não mais via `System.cmd` local.**

### A quinta saída de `decisao_de_execucao/1`

`Engine.Actions.TerminalExecutor` já tinha QUATRO saídas (RN-423, ADR 0104,
o roteamento pro runner local). Ganha uma quinta, `:executar_no_container`,
condicionada a `execution_mode == "container"` E
`Engine.Containers.ProjectContainerLifecycle.running?/1` — uma leitura
read-only nova, direto na tabela `project_containers` (mesmo padrão de
`Engine.Projects.Project` lendo `projects`: o engine lê a coluna que a api
escreve, sem duplicar a derivação).

`mounted` NUNCA cai nessa saída: o broker recusa subir container pra esse
modo (`ModoDeExecucaoNaoSuportadoError`, política deliberada até o PR 1.7
revisitar os três modos), então a pergunta nem faz sentido pra ele.

### A nova perna: engine → api → broker.exec

`ContainerBrokerPort.exec` (ADR 0130) já existia, com a validação de escopo
inteira do lado do broker (`DiretorioForaDoEscopoError` fora de `/work`) —
mas tinha ZERO chamadores. Fecha-se com:

1. Rota interna nova, `POST internal/projects/:projectId/container-exec`, no
   `InternalProjectsController` (não no `InternalContainersController` — ver
   "Por que não no controller do broker", abaixo) — mesmo `EngineServiceGuard`
   de sempre, chamada pelo ENGINE, não pelo broker.
2. `ExecutarComandoNoContainerUseCase`: chama `ContainerBrokerPort.exec` e
   trata `BrokerRecusouError`/`BrokerIndisponivelError` devolvendo um
   resultado TIPADO de falha (`{ sucesso: false, motivo }`) — nunca deixa a
   exception vazar pela rota HTTP. Qualquer OUTRO erro (defeito real)
   continua propagando — não é disfarçado de falha de comando.
3. `Engine.Sessions.EngineApiClient.executar_comando_no_container/4` — o
   checklist de sempre (callback + delegator + impl `Req.post` + fake de
   teste), chamando a rota nova.
4. `Engine.Actions.TerminalExecutor` ganha `run_no_container/4` (molde:
   `run_via_runner/4`), que chama o cliente acima e mapeia o resultado pra
   `build_result`/`failed_result`.

**Falha do broker.exec NUNCA vira crash nem fallback silencioso pro
`System.cmd` fora do container.** `sucesso: false` (o broker recusou ou não
respondeu) e falha de transporte engine→api viram `failed_result` normal —
mensagem clara, `exit_code: nil`, exatamente como qualquer outro comando que
falhou. Um container morto ou removido por fora entre o `running`
registrado e o momento da chamada (RN-486: registrado e observado nunca se
fundem) É esse caso — não é bug, é o preço de "registrado" nunca ser
garantia. Cair de volta pro `System.cmd` fora do container reabriria
exatamente o vetor de fuga de isolamento que este PR existe para fechar.

### Por que não no controller do broker

`InternalContainersController` (a rota `container-spec`) tem um comentário
explícito: "sem `@Post` aqui, e isso não é esquecimento" — porque quem
ESCREVE o ciclo de vida do container é `RegistrarTransicaoDeContainer`, e
dar ao BROKER autoridade de escrita ali confundiria quem decide o estado. A
rota nova é diferente nos dois eixos que aquele comentário protege: quem
CHAMA é o engine (não o broker lendo da api), e o que ela faz não é
escrever `project_containers` — é rodar um comando e devolver o resultado.
Por isso mora em `InternalProjectsController`, ao lado de
`confirm-workspace-verification` (outra rota que o engine chama, não o
broker).

### O worktree do dev agent JÁ aparece em `/work` — sem mudar `Workspace.ensure!/4`

Hipótese verificada: **confirmada.** `apps/broker/src/operacoes.ts`,
`especificacaoDoProjeto/2`, compõe `raizDoProjeto` como
`${PROJECT_WORKSPACES_HOST_ROOT}/${workspaceDirName}` — a MESMA raiz
(`workspace_dir_name`, RN-109) que `Engine.Actions.Workspace.workspace_dir/2`
já usa para resolver `<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>` dentro
do processo do engine. `packages/docker-port/src/docker-cli.ts` monta essa
`raizDoProjeto` como o ÚNICO bind (`${spec.raizDoProjeto}:${PONTO_DE_MONTAGEM}:rw`,
`PONTO_DE_MONTAGEM = '/work'`). Ou seja: **é o MESMO diretório físico**, só
alcançado por dois caminhos — de dentro do engine, via
`PROJECT_WORKSPACES_ROOT` (um bind/volume do lado do engine); de dentro do
container recém-subido, via `/work` (um bind resolvido pelo daemon contra
`PROJECT_WORKSPACES_HOST_ROOT` no HOST). O worktree que o dev agent já usa
hoje — criado do jeito de sempre, `Workspace.ensure!/4` rodando
`System.cmd("git", ...)` dentro do processo do engine, escrevendo no volume
compartilhado — já aparece DENTRO do container em `/work`, sem
`Workspace.ensure!/4`/`ensure_remoto/2` mudarem em NADA. O container é só
mais um observador do MESMO diretório.

Isso depende de `PROJECT_WORKSPACES_HOST_ROOT` estar configurada
corretamente para apontar pro caminho de HOST que faz a MESMA pasta física
que `PROJECT_WORKSPACES_ROOT` resolve dentro do container do engine — é
responsabilidade do operador (já documentada nos comentários de
`docker-compose.yml`), e continua sendo: nada muda aqui.

### `cwd`: tradução de HOST pra `/work`

`opts[:cwd]` chega em `TerminalExecutor.run/3` como caminho ABSOLUTO DO
HOST (dentro de `project_workspaces_root` — a raiz compartilhada, ou o
subdiretório `.worktrees/<agent_id>` de um dev agent específico, via
`Engine.Dev.WorktreeManager`). `run_no_container/4` traduz esse caminho pra
dentro de `/work` ANTES de mandar pro broker: troca o prefixo
`<project_workspaces_root>/<workspace_dir_name>` por `/work`, preservando o
sufixo. `cwd` ausente (roda na raiz do workspace) vira `nil` — o broker
default para `/work`. Um `cwd` que não estiver dentro dessa raiz (não
deveria acontecer para `execution_mode: container`) é enviado como veio,
sem tentativa de adivinhar — o broker recusa com `DiretorioForaDoEscopoError`
se não estiver dentro de `/work`, defesa em profundidade em vez de um
caminho fabricado silenciosamente.

### Decisão 3: autonomia dentro do container

**Comando de terminal cujo escopo é a pasta do projeto DENTRO do container
real auto-aprova — mas isso é um PISO, não um teto novo, e os cinco tetos
absolutos de `decide.ts` ficam byte a byte como estavam.**

Mecanismo: `ProposeActionUseCase.execute` consulta o MESMO
`ObterCicloDeVidaDoContainerUseCase` que a execução usa (só quando
`actionType === 'terminal' && project.executionMode === 'container'` —
poupando a query em todo o resto) e monta `containerExecutionActive` no
`DecideContext`. Dentro de `decide()` (que continua PURA — zero IO), o
valor INICIAL de `current` deixa de ser sempre `{ policy:
'require_approval', reason: 'default' }` e passa a ser `{ policy:
'auto_approve', ... }` quando `action.actionType === 'terminal' &&
ctx.containerExecutionActive`.

**Por que isso é seguro sem duplicar o mecanismo de tetos que já existe:**
todo estágio que segue (`agent_autonomy`, `permissions.json`) já SUBSTITUI
`current` quando tem uma opinião explícita — é assim que o `require_approval`
default de sempre já podia ser rebaixado por um `deny` explícito ou mantido
por um `ask`. Trocar o valor INICIAL não muda essa propriedade: um
`agent_autonomy: deny` explícito, ou um `permissions.json` com `ask`/`deny`
casando o comando, continuam rebaixando o piso do container exatamente como
já rebaixavam o default `require_approval` — não é um caminho novo, é o
mesmo `current` com um ponto de partida diferente. E os tetos absolutos
(escopo, git push/comando privilegiado, merge protegido, instruction_patch,
paralelismo) continuam rodando DEPOIS, sobre `current.policy ===
'auto_approve'` — inclusive quando esse `auto_approve` veio do piso do
container, não de uma regra explícita.

**A justificativa de segurança é uma troca de fronteira, não a ausência de
uma.** Fora do container, a fronteira do escopo de terminal (`ADR 0055`) é
LÉXICA: `terminalNoEscopo` compara `cwd`/`command` contra
`ctx.projectScopeRoot`, um caminho de HOST — e essa checagem é o que torna
seguro auto-aprovar por `permissions.json allow` hoje. Dentro do container
real, o mount namespace do Docker é uma fronteira MAIS forte: o processo que
roda o comando fisicamente não enxerga nada fora de `/work` (fecha o vetor
de symlink que o comentário de `path-scope.ts` registra como aberto para
`mounted`/`runner`, achado U — lá não há mount namespace nenhum, aqui há). A
validação de `/work` que o broker já faz (`DiretorioForaDoEscopoError`,
`apps/broker/src/operacoes.ts`) é a SEGUNDA camada, sobre o `cwd` já
traduzido. **O teto de escopo léxico (`terminalNoEscopo`) continua rodando
por cima do piso, sem exceção nenhuma** — ele opera sobre os MESMOS
caminhos de HOST de sempre (o `cwd`/`command` que chegam em `decide()`
NUNCA são traduzidos pra `/work`; essa tradução acontece só depois, no
engine, ao montar a chamada pro broker) — é defesa em profundidade, não
substituição: um comando que `decide()` marcaria fora de escopo hoje
continua marcado fora de escopo com o piso ligado, e volta a exigir decisão
humana.

**Por que um PISO e não uma regra `agent_autonomy` seedada:** uma regra
seedada (como o auto mode de `open_adr_pr`) precisaria ser escrita/apagada
toda vez que o container sobe/desce, e divergiria do REGISTRADO em
`project_containers` no instante em que o container caísse por fora — o
mesmo problema de duas fontes de verdade que o ADR 0130 já evita ao nunca
fundir registrado e observado (RN-486). Consultar o ciclo de vida na hora
de decidir é a MESMA fonte que a execução consulta na hora de executar —
zero sincronização entre os dois.

## Consequences

**`ContainerBrokerPort.exec` ganha o PRIMEIRO chamador real** — a última
das cinco operações do ADR 0128/0130 sem um. `stop`/`remove` seguem sem
`proposed_action` própria, inalterado por este PR.

**`mounted`/`runner` continuam sem container nenhum** — RN-421/RN-423
seguem como estavam; o portão de contenção estrutural do `join` continua
ausente pra esses dois modos (achado do ADR 0072, não fechado aqui).

**A pergunta "quantos módulos, um container só" segue como está** —
`project_id UNIQUE` em `project_containers`, sem mudança nesta entrega.

**O escopo de terminal léxico (ADR 0055) não perde nenhum consumidor.**
Continua sendo a única fronteira para `mounted`/`runner` (que não têm mount
namespace nenhum protegendo), e continua rodando em CIMA do piso do
container como segunda camada — não foi substituído em lugar nenhum.

**Alternativa considerada e descartada: tradução do `cwd` também dentro de
`decide()`, pra comparar contra `/work`.** Faria o teto de escopo operar
sobre o caminho FINAL, mais "correto" na aparência — mas moveria uma
decisão de INFRAESTRUTURA (onde o broker montou o volume) para dentro de
uma função que o resto do arquivo mantém deliberadamente pura e sem
conhecimento de container nenhum, e duplicaria a tradução de `cwd` em dois
lugares (`decide.ts` e `TerminalExecutor`) que precisariam concordar para
sempre. Descartada: o teto de escopo continua útil operando sobre os
caminhos de HOST que ele sempre operou — é REDUNDANTE com o mount namespace
por dentro do container, não substituído por ele, e redundância que não
exige sincronia é a defesa em profundidade que este ADR busca.
