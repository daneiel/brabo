---
paths:
  - "apps/runner/**"
  - "packages/docker-port/**"
  - "apps/engine/lib/engine/runners/**"
  - "install.sh"
---

> Regra de CAMINHO: o Claude Code a carrega só quando a sessão lê arquivo
> que casa com `paths:` acima. Saiu de `.claude/contexto/stack.md` (Stack) porque o contexto lido em
> toda sessão passava do teto de 150 mil caracteres. Edite AQUI.

## Stack: `apps/runner`
- `apps/runner`: workspace novo, Node/TS — CLI (`brabo-runner`) que roda
  na máquina do usuário, conectando ao engine via canal Phoenix (`phoenix`,
  embutido no bundle) para executar comandos aprovados e terminal
  interativo (`node-pty`, único `external` do build `tsup` — binding
  nativo, resolvido via `node_modules` de quem instalou o pacote) — ver
  "Runner local" (ADR 0103). Desde a RN-514 (ADR 0147 ponto 1) o `join`
  desse canal NÃO é mais mudo: o runner DECLARA nos params o que sabe
  fazer (`CAPACIDADES_DO_RUNNER` em `channel.ts` — desde a RN-516 as TRÊS,
  `exec`, `pty` e `espelho`, e só o que ele implementa de verdade) e o
  servidor CONCEDE a interseção com o vocabulário que conhece
  (`Engine.Runners.Capacidades`), guardando o conjunto em `socket.assigns`
  e NUNCA em tabela. Params ausentes/vazios são o binário LEGADO e valem
  `{exec, pty}` — fato, não suposição —, nome desconhecido é IGNORADO, e
  capacidade EXIGIDA e não declarada recusa o join NOMEANDO a que falta.
  Quem exige: o `execution_mode` (`runner` exige `exec`;
  `container`/`mounted` não exigem nada) e, desde a RN-516, o DADO
  `projects.mirror_path` — destino de espelho declarado EXIGE `espelho`,
  em qualquer modo. Essa é a primeira exigência que DISPARA de verdade, e
  o custo está declarado no ADR: binário velho num projeto com destino
  deixa de conectar (recusa nomeada, fatal, sem retry), e é opt-in.
  Mensagem cuja capacidade não foi concedida é RECUSADA com resposta
  nomeada — nunca entregue a um handler que não existe do outro lado, que
  era o defeito silencioso que o ADR 0147 nomeia. A resposta do `join`
  também deixou de ser vazia para o `:runner`: é por ela, e SÓ por ela,
  que o DESTINO do espelho chega (`%{espelho: %{destino: ...}}`, ADR 0147
  ponto 4) — nunca configuração local nem variável de ambiente, e o runner
  recusa `mirror_sync` para destino que não lhe foi concedido NAQUELA
  conexão; trocar o destino com o runner de pé exige reconectá-lo. O
  espelho em si (`espelho.ts`/`espelho-guard.ts`) copia a LISTA DO GIT
  numa direção só e NUNCA apaga — arquivo apagado na origem permanece no
  destino —, com guarda IRMÃ de `guard.ts` (mesma dupla passada, mesma
  ressalva de TOCTOU), e é disparado por MOMENTO NOMEADO do engine
  (`mirror_sync`, hoje o commit), nunca por watcher. TRÊS caminhos de
  distribuição: clonar o
  monorepo (dev), `npm install -g @brabo/runner` via `tsup` + `npm publish`
  (ADR 0106), e binário standalone via `bun` (`bun build --compile`, ADR
  0112) — o `.node` nativo do `node-pty` embutido por `with { type: 'file'
  }` e extraído para um diretório real em runtime, já que `node-pty`
  resolve seu próprio addon por um `require()` de caminho COMPUTADO que o
  Bun não consegue embutir sozinho. Desde a RN-518 (ADR 0147 ponto 5) ele
  também se INSTALA — `brabo-runner service install|uninstall|status`, nível
  de USUÁRIO sempre (`systemd --user`/`LaunchAgent`), com root RECUSADO e
  Windows recusado por NOME; `Restart=on-abnormal` e
  nunca `on-failure` (exit 1 é recusa fatal de join ou teto esgotado, e
  reiniciar seria o laço que o CLI recusa fazer), autenticação por CHAVE DE
  DISPOSITIVO e nunca por token (uma unit com token o deixaria em disco), e
  `status` com QUATRO estados e quatro códigos de saída — a primeira resposta
  vem do DISCO, então ela continua certa numa máquina sem gerenciador. Desde a
  RN-545 (ADR 0154 ponto 4) são DUAS ESPÉCIES de unit e elas CONVIVEM: a de
  PROJETO (`brabo-runner-<projectId>.service`/`dev.brabo.runner.<projectId>`,
  byte a byte como sempre) e a de MÁQUINA (`brabo-runner.service`/
  `dev.brabo.runner`, sem sufixo), que roda o modo de N conexões da RN-544. Os
  nomes não colidem por CONSTRUÇÃO (`projectId` nunca é vazio, então o de
  projeto sempre tem um `-` onde o de máquina termina), e isso é travado por
  teste. O discriminador é a flag `--machine` e NUNCA a ausência de
  `--project` — o ADR dizia o contrário e foi MEDIDO: `resolverProjeto` tem
  DUAS fontes, e o caminho normal é rodar `install` sem flag de dentro da pasta
  que o navegador configurou, então a letra do ADR converteria em silêncio a
  instalação de quem já usa o produto. `install --machine` RECUSA sem base
  consentida, sem chave, e quando a pasta tem `brabo-runner.config.json` (o
  serviço subiria em modo de PROJETO, em silêncio, atendendo um só), e a unit
  congela `XDG_CONFIG_HOME` mas NUNCA o valor da base — trocar a base é editar
  o arquivo e reiniciar, nunca reinstalar. `install` também RECUSA quando a
  OUTRA espécie já está instalada, nomeando o `uninstall` de cada unit, sem
  remover nem gravar nada e sem `--force`: as duas juntas seriam dois processos
  disputando o mesmo projeto. `status` responde sobre a espécie PERGUNTADA (os
  quatro códigos NÃO viram oito nem se somam) e diz em TEXTO que a outra
  existe, como presença lida do DISCO; sem `--machine` e sem projeto resolvível
  ele cai na MÁQUINA. `uninstall` NÃO herda esse default e recusa listando o
  que existe — ler a espécie errada custa uma linha, remover a errada custa um
  serviço e uma chave.
  Desde a RN-529 (ADR 0151 pontos 1 e 2) ele também pode nascer com uma
  BASE — a pasta da máquina do usuário sob a qual cada projeto é uma
  SUBPASTA. Ela é LOCAL e NUNCA chega pela rede (o desenho do broker, ADR
  0144: quem tem a raiz é quem executa, e o que viaja é o SEGMENTO
  relativo), vem de `--base` ou de `$XDG_CONFIG_HOME/brabo/runner.json`
  (senão `~/.config/brabo/runner.json`, a precedência que `servico.ts` já
  usa) — nunca do `brabo-runner.config.json`, que é POR PROJETO e escrito
  pelo navegador, e nunca de variável de ambiente, que colidiria com
  `BRABO_PROJECTS_BASE` (a base do lado SERVIDOR, ADR 0141) e não
  sobreviveria a uma unit de serviço. `--dir` NÃO muda de significado e a
  base NÃO entra na validação dele: é a proibição de
  `project-workspaces-root.ts` transposta — projeto legado fora da base
  segue válido, e a base é regra de CRIAÇÃO. `base-guard.ts` é o TERCEIRO
  irmão de `guard.ts`, reusando os três helpers, a dupla passada e
  `validarDirDentroDoHomeNoLinux` inteira, e o laço dele é ASSIMÉTRICO (a
  pasta do projeto dentro da base é o arranjo normal; a base dentro da
  pasta do projeto é o defeito). Recusa vinda da FLAG sai com código 2;
  vinda do ARQUIVO é dita e o runner segue SEM base. Ausente é o estado
  normal. Desde a RN-532 (ADR 0151 pontos 3–6) a base tem CONSUMIDOR: o par
  `workspace_create`/`workspace_create_result`, no molde de PEDIDO COM
  RESPOSTA de `exec`/`exec_result` — e nunca no de `workspace_confirm`, que
  é UNIDIRECIONAL. O engine manda `projectId` e o SEGMENTO relativo (nunca
  caminho absoluto); o runner faz `mkdir -p` e `git init`/clone, e a
  confirmação REUSA o `workspace_confirm` que já existia — **nenhuma rota
  nova de gravação nasce**, o engine continua não escrevendo a tabela, e o
  único caminho que carimba `workspace_verified_at` continua sendo um só.
  A ORDEM é o mecanismo (confirm ANTES do resultado: os dois chegam ao mesmo
  processo de canal em ordem, e o handler do confirm é síncrono). A QUARTA
  capacidade, `workspace`, é a única cuja declaração depende do ESTADO da
  execução e não da versão do binário — só é declarada com base consentida,
  e é por ela, e por mais nada, que o servidor sabe que existe base; ninguém
  a EXIGE no join (runner sem base conecta normalmente e só perde essa
  mensagem, recusada com resposta NOMEADA). `estado.dir` NÃO muda com isso:
  trocar em runtime a raiz que `guard.ts` usa moveria uma fronteira de
  contenção por causa de uma mensagem de rede. Criar a pasta NÃO é
  `proposed_action` — é configuração consentida (a linha da RN-516).
  `--project`/`--dir`/`--token` são
  OPCIONAIS quando a pasta tem `brabo-runner.config.json` e a chave de
  dispositivo (RN-464..466, ADR 0118) — gravados, até o ADR 0203, pelo fluxo
  do navegador, que gerava o par Ed25519 (Web Crypto), registrava a pública
  como `runner_device_keys` e gravava os três arquivos via File System Access
  API. Esse fluxo foi APOSENTADO (ADR 0203, RN-687), mas a LEITURA da pasta
  continua: quem a configurou assim segue funcionando —
  `POST .../runner-ticket` aceita essa chave como segunda credencial de
  dispositivo, ADITIVA ao PAT (ADR 0105), nunca um substituto. Desde a RN-551
  (ADR 0155 ponto 4) o gerador é o TERMINAL: `brabo-runner
  device-key create` gera o par NA MÁQUINA e `device-key finish --id <id>`
  carimba o `kid`. São DOIS comandos porque o `kid` É o id do registro no
  SERVIDOR (RN-475) e só existe depois dele — o `create` grava um `.parcial`
  que `lerChaveDeDispositivo` NÃO procura, então o arquivo que o runner lê
  nunca existe sem `kid`. O CLI NÃO fala com a api, e a razão é de SEGREDO:
  quem registra é o instalador, com o `BRABO_SERVICE_TOKEN` — cada lado guarda
  UM segredo e nenhum vê o do outro; o que atravessa é a JWK PÚBLICA e o id.
  Destino padrão `$XDG_CONFIG_HOME/brabo/` (senão `~/.config/brabo/`), modo
  600, REUSANDO a precedência de `base.ts` (`pastaDeConfiguracaoDoBrabo`,
  extraída e nunca copiada) — e isso não reabre a porta do ADR 0104 Onda 2:
  `device-key.ts` continua lendo só do `cwd` que o chamador passar, e quem
  aponta para lá é o `--dir` da unit de máquina. `stdout` carrega UM valor numa
  linha (a pública no `create`, o caminho no `finish`) e todo o resto é
  `stderr` — é o contrato do `$(...)` do instalador. Sobrescrever chave
  COMPLETA é recusado, sem `--force`. Desde a
  RN-544 (ADR 0154) `--project` é opcional por um SEGUNDO caminho, e só por
  ele: o agente de MÁQUINA roda SEM `--project`, consulta
  `GET /runner/projects` e abre **UMA conexão por projeto** listado, cada uma
  em `<base>/<workspaceDirName>` pelas guardas de sempre
  (`resolverPastaDoProjetoNaBase` + RN-434/435 — nenhuma régua nova). Ele exige
  as DUAS coisas, credencial de MÁQUINA e BASE consentida, e sem base rodar sem
  `--project` continua caindo em `uso()`; o modo com `--project` fica BYTE A
  BYTE. Nada no engine muda (tópico, socket id e ticket descrevem uma CONEXÃO),
  e o espelho/`workspace_create` também não — os dois já viajavam na concessão
  do `join` DAQUELA conexão, que é o que os torna corretos com N. O que MUDA de
  comportamento é o laço: o teto de tentativas e a recusa de join deixam de ser
  do PROCESSO e passam a ser do PROJETO — um projeto que recusa ou esgota
  encerra sozinho e NOMEADO, os demais seguem, e só quando NENHUM sobra o
  processo sai com 1, listando o desfecho de cada um. A lista é consultada UMA
  vez, no start — MAS só COM conexão viva (RN-550, ADR 0155 ponto 5): a regra é
  ASSIMÉTRICA de propósito. Com conexão de pé, repesquisar faria uma lista que
  volta MENOR (apagado? convertido? 500 transitório?) derrubar conexão VIVA por
  ambiguidade; com ZERO conexões não há nada a derrubar nem ambiguidade
  nenhuma, então lista VAZIA deixou de SAIR com 0 e passou a ESPERAR —
  reconsulta a 15s/30s/60s (o último se repete), PARA na primeira lista
  não-vazia, sem teto de espera e com teto de DEZ falhas seguidas (saída 1
  nomeando o número; qualquer resposta, vazia inclusive, zera o contador). É o
  caso da instalação nova, e o argumento do `exit 0` caiu junto com a premissa
  dele ("um serviço ativo que não faz nada"): ele reconsulta e DIZ isso, com
  batimento a cada 30 consultas. `Restart=on-abnormal` NÃO muda em unit nenhuma
  (ele nunca olhou código de saída) — o efeito é a unit de MÁQUINA ficar
  `active (running)` de verdade. Exceção declarada: lista NÃO-vazia com TODOS
  os projetos recusados continua saindo com 1, porque ali cada recusa nomeia um
  defeito local com conserto próprio. N conexões exigem N
  `EstadoDoRunner`, e o motivo é medido: quatro campos dele são POR PROJETO
  (`dir`, `canalAtual`, `containerAtivo`, `destinoDoEspelho`) mais o
  `gerenciadorPty`, que nasce de `dir` — um estado compartilhado faria o
  `docker exec` de um projeto rodar no container de OUTRO; `docker` e `base`
  são da MÁQUINA e entram como o MESMO valor em todos, nunca cópias. E o runner
  NÃO adivinha a espécie da própria chave (em disco as duas são o mesmo
  arquivo, uma JWK com `kid`): quem sabe é o SERVIDOR, e o 403 dele é repassado
  NOMEADO, com o conserto. Desde a
  RN-543 (ADR 0154) essa chave tem DUAS espécies, numa tabela só:
  `runner_device_keys.project_id` preenchido é a chave de PROJETO do fluxo
  acima, e NULO é a chave de MÁQUINA, que vale para qualquer projeto em que
  o DONO dela alcance o papel que a rota já exige. A comparação que impede
  a chave do projeto A servir o projeto B NÃO foi apagada — ela some SÓ
  para `null`, onde não há o que comparar, e aí o papel se resolve contra
  o projeto PEDIDO. Nenhum teto novo, nenhum afrouxado: a chave de máquina
  não dá ao runner nada que o dono dela já não tivesse. `user_id` continua
  `NOT NULL` (o ADR recusa chave que atravesse usuários), e `GET
  runner/projects` — a PRIMEIRA rota de credencial de dispositivo SEM
  `:projectId` no caminho, e por isso exclusiva da espécie de máquina — é
  como o agente DESCOBRE os projetos que atende, em vez de adivinhar por
  nome de pasta. Nada no engine mudou: o tópico, o socket id e o ticket
  descrevem uma CONEXÃO, e N conexões os satisfazem byte a byte. O `id` do
  registro vai gravado DENTRO da JWK privada, no `kid` (RN-475): é o único
  vínculo entre o arquivo em disco e a pública do servidor, e a cadeia
  inteira só o REPASSA — o runner lê `jwk.kid`, o JWT de ticket o leva no
  header, o `PatAuthGuard` acha a pública por ele. Ninguém deriva esse id
  de outra coisa. E o CLI distingue chave AUSENTE (caminho normal de quem
  usa flags, cai no bloco de uso) de chave PRESENTE e recusada (mensagem
  própria, nomeando arquivo e motivo) — colapsar os dois é o que fez um
  bug de uma linha custar uma caçada. Docker mora atrás de uma PORTA de
  CINCO operações (`packages/docker-port`, ADR 0130 — ela NASCEU em
  `apps/runner/src/` e MOVEU quando o broker virou o segundo consumidor:
  `start`/`stop`/`remove`/`inspect`/`exec`), implementada sobre
  `execFile('docker', …)` do `node:child_process`
  — ZERO dependência nova, e por decisão medida, não por gosto (ADR 0128):
  `dockerode` foi instalado e provado contra os artefatos, e o
  `bun build --compile` reprovou resolvendo o `.node` de `cpu-features`, que
  a árvore SSH de `docker-modem` arrasta mesmo quando só se fala com o
  socket unix. O broker NÃO herdou a escolha por herança técnica (ele nunca
  vira binário) e sim por decisão: um mecanismo, não dois. A contenção é o
  TIPO: sem campo para `privileged`/`cap_add`, rede é a união
  `'none' | 'egress'`, e o bind é UMA pasta de tipo MARCADO com destino
  constante — não há lista de mounts. O `docker run` composto por `DockerViaCli` leva `--init` como CONSTANTE (RN-738):
  o `sleep infinity` de espera (ou, com `comandoDoApp`, o supervisor do ADR 0228 — o runner ainda NÃO liga esses campos, que ficam ausentes e byte a byte) é PID 1 e não recebe SIGTERM sem init, e `stop`
  levava 10 s até o kill (`Exited (137)`); e `--restart unless-stopped`, também
  CONSTANTE (RN-820): daemon reiniciado religa o container, `stop` explícito não —
  nunca `always`. `pidsLimit` entrou na spec no ADR 0130,
  porque o artefato do Arquiteto sempre teve três números e descartar um faria
  ele prometer um teto que o container não recebe. Do lado do RUNNER, essa
  porta deixou de ser só provada por `--self-test-docker` (ADR 0112/0128) e
  ganhou uso real:
  `container_start`/`container_stop`/`container_remove` (ADR 0137,
  RN-497), três pares novos no canal Phoenix (mesmo molde de
  `exec`/`exec_result`), fazem `DockerViaCli.start/stop/exec` de
  verdade, com o Docker do PRÓPRIO usuário — para projeto
  `mounted`/`runner`, que o broker nunca alcança (a pasta mora numa
  máquina que o servidor não enxerga). Desde a RN-507 (ADR 0145), Docker é
  PRÉ-REQUISITO real do modo `runner` — sem container `running`
  REGISTRADO, `TerminalExecutor` recusa e nem chega a mandar comando pro
  canal — e o par `exec`/`exec_result` ganha um campo `env` opcional
  (`Record<string,string>`) para a credencial de git (ADR 0056) viajar
  no ambiente do processo filho que `apps/runner/src/exec.ts` spawna no
  HOST do usuário: mesclado sobre `process.env` (nunca substitui —
  perderia PATH), nunca repassado ao `docker exec` (a porta de Docker não
  ganhou campo de `env`, de propósito) e nunca logado. Desde o ADR 0193
  (RN-676, decisão do dono) o git CREDENCIADO roda no HOST e o código no
  container: o engine marca o `git fetch` autenticado de `RunnerGit` com
  `gitCredenciado: true` — por UM ponto, `RunnerRouter.exec_git_credenciado/5`
  — e o runner, com a marca E `env` não vazio, roda o comando no host mesmo
  com container ativo (a mesma pasta: `estado.dir` é o bind-mount de `/work`).
  O discriminador é a MARCA, nunca o `env`: `env` sem a marca, com container
  ativo, segue RECUSADO pela RN-558 (`MARCA_DE_CREDENCIAL_NAO_ENTREGUE`, par
  de protocolo com `Engine.Runners.CredencialDeGit`, guarda em
  `scripts/ci/marca-de-credencial-do-runner.spec.ts`) — senão o `env` viraria
  a porta de saída do container. Na prática essa recusa só aparece com runner
  ANTERIOR ao ADR 0193. Quem decide host×container continua sendo o RUNNER
  (`containerAtivo` nasce `null` a cada execução): não suba isso para
  `RunnerReadiness`, que fica byte a byte, e não dê `env` à `DockerPort`
