# 0147 — Um agente local, capacidades declaradas na conexão

## Context

O `brabo-runner` (ADR 0104/0105) nasceu para uma coisa só: executar, na máquina
do usuário, comando já aprovado pelo pipeline de `proposed_action`. Desde então
ele acumulou funções sem que o protocolo dissesse nada sobre isso — PTY
interativo (`apps/runner/src/pty.ts`), navegação de pasta
(`apps/runner/src/fs-browser.ts`), e desde o ADR 0137 o ciclo de vida de um
container Docker DA MÁQUINA DO USUÁRIO. A FASE 28 quer acrescentar mais uma: um
**espelho**, que copia o trabalho dos agentes para uma pasta que o usuário
escolheu, fora da base montada.

A tentação é um segundo binário. Ela se paga mal: seriam duas instalações, dois
modelos de autenticação, duas revogações, e duas coisas para o usuário parar
quando quisesse parar. E o produto já tem o processo vivo na máquina do usuário
— o problema não é falta de agente, é que o agente atual não sabe dizer o que
sabe fazer.

**Hoje o `join` é mudo dos dois lados.** O runner manda params vazios —
`socket.channel(\`terminal:${projectId}\`, {})` (`apps/runner/src/channel.ts:304`)
— e o servidor os ignora literalmente: `def join("terminal:" <> project_id,
_params, socket)` (`apps/engine/lib/engine_web/channels/terminal_channel.ex:99`).
Toda a identidade vem do ticket: o papel (`:runner` ou `:web`) sai do `kind`
(`terminal_channel.ex:110`, `papel_do_kind/1`), e o servidor não tem como saber
se o binário do outro lado é de uma versão que entende `mirror_sync` ou de uma
que vai ignorar a mensagem em silêncio. O único dado que o runner declara sobre
si é o `workspace_confirm` empurrado depois do join (`apps/runner/src/index.ts:530`).

Um agente que ganha capacidades sem negociá-las degrada da pior forma possível:
a mensagem chega, o handler não existe, e nada acontece — sem erro, sem log, sem
ninguém saber que o espelho nunca rodou.

## Decision

**Um agente local, com capacidades declaradas no `join` e concedidas pelo
servidor.** Três capacidades para começar: `exec`, `pty`, `espelho`.

### 1. Onde se declara e onde se concede

O runner **declara** no lugar hoje vazio: os params do `join`
(`channel.ts:304`). O servidor **concede** em `autorizar_por_papel/2`
(`terminal_channel.ex:110-138`) — o mesmo ponto que já monta `socket.assigns`
com `:role`, `:pending_execs` e `:open_pty_refs` —, calculando a **interseção**
entre o que o runner declarou e o que o `execution_mode` do projeto exige.

O conjunto concedido vive em `socket.assigns`, **nunca em tabela**. É o mesmo
raciocínio que mantém `containerAtivo` do lado cliente
(`apps/runner/src/index.ts:270-277`: *"a decisão é INTERNA ao runner, o engine
não sabe disso e não precisa saber"*) e que faz a entrada `:global` do
`Engine.Runners.Registry` morrer junto com o pid: capacidade é propriedade
**daquela conexão**, não do projeto nem do usuário. Uma tabela criaria a
possibilidade de o banco afirmar que um runner sabe fazer algo que o processo
conectado agora não sabe.

**Capacidade exigida e não declarada recusa o `join`.** O runner já trata
`JoinRecusadoError` como fatal sem retry (`index.ts:725-732`, com o comentário
que explica por quê: *"Recusa não é transitória… encerra com mensagem clara, SEM
laço automático"*), e é exatamente a forma certa — um runner velho demais para o
projeto não deve ficar em backoff tentando de novo com o mesmo binário. É também
onde o `Registry` já recusa o segundo runner do mesmo projeto
(`terminal_channel.ex:126-135`), então a recusa por capacidade nasce ao lado de
uma recusa que o usuário já conhece.

**Por que no `join` e não num push depois, como o `workspace_confirm`.** Aquele
fala do *workspace*, que muda entre execuções e é confirmado pelo runner que tem
autoridade sobre o disco (RN-423). Capacidade fala do *binário*, que é fixo no
instante da conexão. Declarar depois do join significaria uma janela em que o
servidor já aceitou a conexão e ainda não sabe o que ela sabe fazer — e é nessa
janela que a primeira mensagem chega.

### 2. Espelho: uma direção, nunca apaga, escopo próprio

`apps/runner/src/espelho-guard.ts` (novo), **irmão de `guard.ts`, não uma
extensão dele**. Reusa `realpathMaisProximo` e a dupla passada
léxica-depois-realpath de `validarCwdDentroDaRaiz` (`guard.ts:134-170`) — a
segunda passada é o que hoje pega symlink num segmento do meio, com a ressalva
de TOCTOU já escrita ali.

Recusa três coisas:

1. symlink que escape do destino;
2. destino que **contenha** o workspace;
3. destino **dentro** do workspace.

As duas últimas são o mesmo laço, em sentidos opostos: com o bind por identidade
do ADR 0141, escrever o espelho dentro da origem faz o espelho copiar o próprio
espelho.

**Uma direção só** — workspace → destino. **Nunca `--delete`, nunca `unlink`.**
Arquivo apagado no workspace permanece no destino. Isso é decisão, não descuido:
a pasta do usuário não é réplica, é acúmulo — e um agente que apaga arquivo na
pasta pessoal de alguém por causa de um `git clean` do outro lado é exatamente o
tipo de surpresa que o produto inteiro existe para não produzir.

### 3. O espelho não exige Docker

`Engine.Runners.RunnerReadiness` fica **byte a byte como está**
(`apps/engine/lib/engine/runners/runner_readiness.ex:44-61`), com seus dois
consumidores de sempre (`TerminalExecutor` e `Engine.Actions.Workspace.RunnerGit`).

O espelho ganha **predicado próprio**, com as duas pré-condições que ele de fato
precisa — workspace confirmado e runner conectado — e **nunca** um
`RunnerReadiness` com parâmetro. Uma função compartilhada com flag "pula
container" é precisamente o mecanismo pelo qual a terceira pré-condição cai por
acidente para o `exec` numa refatoração futura, e o ADR 0145 existe para essa
terceira pré-condição não cair.

Por que o espelho legitimamente não precisa dela: a terceira existe porque
comando sem container **caía no HOST em silêncio** (ADR 0145) — havia duas
execuções possíveis e a errada era invisível. O espelho não tem essa ambiguidade:
é cópia de arquivo na máquina do usuário por definição, sem container de onde
cair. Exigir Docker ali seria importar uma pré-condição sem o defeito que a
justifica, e o custo seria real — o espelho é justamente a capacidade que deve
funcionar para quem não quer Docker.

### 4. Consentimento por projeto e por destino

O destino é **por projeto**, declarado pelo usuário, e viaja ao runner **dentro
da capacidade concedida no join**. O runner recusa `mirror_sync` para destino que
não lhe foi concedido naquela conexão.

Nunca configuração global no runner, nunca variável de ambiente: um destino
global faria o artefato do projeto B aterrissar na pasta do projeto A, e o
usuário descobriria isso pelo conteúdo, não por um erro.

### 5. Serviço de usuário

**Nível de usuário, sempre**: `systemd --user` no Linux, `LaunchAgent` no macOS.
**Nunca serviço de sistema, nunca root.** O runner roda com os privilégios do
usuário *por desenho* — `guard.ts:9-31` declara isso como premissa da guarda
inteira (*"O runner roda NA máquina do usuário, com os privilégios DELE"*) — e um
serviço root quebraria o invariante em que as três fronteiras reais daquele
docblock se apoiam.

Subcomandos `brabo-runner service install | uninstall | status`. Remoção é
completa: unit file, `brabo-runner.config.json` e
`brabo-runner-device-key.jwk.json`.

**O precedente é zero**: não há nenhuma menção a `systemd`, `launchd` ou
`LaunchAgent` em `apps/runner/`; o modelo hoje é foreground, encerrado por
SIGINT/SIGTERM (`index.ts:709-717`). Windows fica **fora de escopo, declarado** —
a matriz de build já produz o binário (ADR 0112), mas serviço de usuário no
Windows é um terceiro mecanismo, não uma variação dos dois.

Efeito colateral desejado: **BRB-031** (o `chmod +x` manual que sobrou do ADR
0118) morre se a instalação passar a vir do bootstrap versionado do ADR 0146.

### 6. Revogação deixa de ser cega, e passa a alcançar a conexão viva

A revogação existe: `DELETE /projects/:projectId/runner-device-keys/:deviceKeyId`
(`apps/api/src/interfaces/http/runner/runner-device-keys.controller.ts:82-83`,
`developer`, 204, idempotente). **Mas não há como enxergar o que se revoga.**

O docblock do controller (`:39-40`) declara o corte como *"sem a visão de
`maintainer` (listar/revogar de qualquer usuário) que o PAT tem"* — e o corte
real é maior do que ele diz. O `PersonalAccessTokensController` tem **cinco**
rotas: `@Post()`, `@Get()` e `@Delete(':tokenId')` para o próprio usuário
(`developer`), mais `@Get('all')` e `@Delete(':tokenId/admin')` para `maintainer`
(`personal-access-tokens.controller.ts:63,86,97,113,127`). O controller de chave
de dispositivo tem **duas**: `@Post()` e `@Delete(':deviceKeyId')`. Não falta só
a visão de `maintainer` — falta a listagem do **próprio dono**. Ninguém revoga o
que não consegue ver, e uma chave órfã (aba fechada no meio do fluxo do ADR 0118)
é hoje invisível e permanente.

O ADR fecha com `@Get()` no mesmo formato que o PAT já tem, papel `developer`. A
visão de `maintainer` continua fora de escopo, agora por decisão e não por
omissão.

Segundo buraco, do mesmo tamanho: **revogar hoje só impede ticket novo.** Um
runner já conectado mantém o canal até cair sozinho, com a chave revogada. A
revogação passa a **derrubar a conexão viva** — `Engine.Runners.Registry.whereis/1`
(`apps/engine/lib/engine/runners/registry.ex:45`) já entrega o pid, e não é
preciso mecanismo novo para alcançá-lo.

### 7. Estado visível

O runner empurra o estado no canal, na mesma forma do `workspace_confirm`
(`index.ts:530`) — o único precedente de o runner contar algo sobre si mesmo.

Guardado junto dos outros fatos de runner do projeto, **não no event log**: é
telemetria de conexão, não evento de domínio de sessão, e
`session_events.session_id` é `NOT NULL`. É o mesmo raciocínio que fez
`rag_searches` virar tabela em vez de evento (RN-479): quando o que se quer medir
não tem sessão, o event log é o lugar errado.

Três campos — última sincronização, contagem, último erro — e **"nunca olhei"
nunca colapsa em "olhei e não achei nada"**, os três estados da RN-088. Um
espelho que nunca rodou e um espelho que rodou e não copiou nada são situações
diferentes, e a tela precisa poder dizer qual das duas.

### 8. Gatilho por evento, nunca watcher

O engine empurra `mirror_sync` em **momentos nomeados** — fim de turno de agente,
commit. **Nunca `fs.watch`.**

Watcher é trabalho ilimitado disparado por qualquer coisa: por uma instalação de
dependências, por um build, e — pior — pelas escritas do próprio espelho, que é
laço. Além disso rodaria continuamente na máquina do usuário sem ninguém ter
pedido, que é o oposto do que "agente local" deve significar.

## Consequences

- **Consentimento de configuração não é aprovação de ação, e o espelho fica do
  lado da configuração.** A escrita do espelho **não** passa por
  `proposed_action`: não é um agente pedindo para agir, é o sistema escrevendo
  num caminho que o usuário declarou ao configurar o projeto. O contrário —
  sincronizar por comando de terminal — cairia no escopo de caminho do ADR 0055,
  viraria fila de aprovações rotineiras e corroeria justamente o teto que dá
  sentido ao clique: uma fila em que quase tudo é rotina treina a pessoa a
  aprovar sem ler.
- **Invariantes que este ADR não toca**, e declara não tocar: `decide.ts` e os
  tetos absolutos; `proposed_action` como origem de todo efeito externo de
  agente; a imutabilidade do event log; o portão da imagem nos três modos (ADR
  0135); as cinco operações e a spec computada do broker (ADR 0128/0130).
- **Um runner velho conectado a um projeto que exige `espelho` deixa de
  conectar.** É recusa explícita no `join`, com mensagem — não degradação
  silenciosa. O custo é real: atualizar o binário passa a ser pré-requisito de
  usar a capacidade nova, e quem instalou pelo fluxo do ADR 0118 não tem
  atualização automática (BRB-005/BRB-031 tocam o mesmo ponto).
- **O destino do espelho acumula.** Sem `--delete`, arquivo removido no
  workspace permanece lá para sempre, e nenhum mecanismo automático limpa. É o
  preço direto de "nunca apaga na pasta do usuário", e a alternativa é pior.
- **Lacunas assumidas, não fechadas aqui:**
  - credencial de git descartada quando o `exec` roteia por `docker exec` —
    `apps/runner/src/index.ts:311-320`; `packages/docker-port` não tem campo
    `env`, de propósito (ADR 0130), e o ADR 0145 já declarou o custo;
  - symlink de dentro do projeto apontando para fora não é detectado pela
    decisão de política (ADR 0055), e `guard.ts:9-31` é best-effort por
    invariante — o `espelho-guard.ts` herda a mesma ressalva de TOCTOU;
  - exclusividade por `{project_id, machine_id}` segue adiada (ADR 0137), então
    o mesmo projeto em duas máquinas continua sendo um runner de cada vez pelo
    `Registry`, não uma identidade por máquina;
  - **BRB-005**: nem as imagens nem os binários do runner são assinados. Um
    agente local que ganha capacidade de escrever fora da base torna a
    procedência do binário mais importante, não menos.
- **Irmão desta fase**: o [ADR 0146](0146-base-consentida-no-bootstrap.md) decide
  a base consentida no bootstrap e `mounted` como padrão local. Os dois se
  dividem assim: o 0146 cobre a pasta que o bind alcança, este cobre o destino
  que ele não alcança.
