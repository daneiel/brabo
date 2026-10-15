> Parte do `CLAUDE.md` da raiz, importada por ele e lida em toda sessão.
> Edite aqui; o `CLAUDE.md` só guarda o índice das partes.

## Stack (decidida — não proponha alternativas)
- `apps/api`: NestJS 11 + Drizzle ORM + PostgreSQL 16 + pgvector;
  `nodemailer` para SMTP real do `MailSender` (ADR 0096), atrás de
  `MAIL_TRANSPORT` — `log` continua o default, inclusive em produção;
  `neo4j-driver` para o grafo de conhecimento (ADR 0099) — memória
  DERIVADA do event log, nunca fonte de verdade, e por isso SEM backup (ADR
  0152): o caminho de volta é `pnpm --filter api grafo:reprojetar` (RN-569),
  que chama o MESMO `GraphEventTranslator` do projetor vivo — tipo novo
  projetado ganha tradução ALI, nunca num segundo tradutor — e não toca a
  outbox dele; `PromptTemplate` não vem do event log e volta por
  `scripts/dev/seed-prompts.ts`; pgvector CONTINUA sendo
  o índice vetorial dos chunks, o grafo não guarda embedding; a pasta `docs/`
  dos artefatos (ADR 0148) é a SEGUNDA projeção derivada e tem o mesmo
  caminho de volta — `pnpm --filter api artefatos:reprojetar` (RN-590), pelo
  MESMO `ArtifactEventTranslator` do `ArtifactProjector`, sem backup, sem tocar
  a outbox e sem apagar nada
- `apps/engine`: Elixir/OTP + Phoenix (canais) + Oban (filas no Postgres) —
  Elixir 1.20.4 / OTP 29.1.1 sobre Alpine 3.24.2 em dev, produção e CI (ADR
  0209): OTP abaixo de 29.1 aborta no boot sob musl ≥ 1.2.6 em host com AMX
  (`sys_sigaltstack`, erlang/otp#11349) — não desça o OTP sem descer a musl
- `apps/web`: React 19 + Vite + TanStack Query/Router; `react-i18next`+
  `i18next` (fundação de i18n, RN-425) atrás de `lib/i18n.ts`/`lib/idioma.ts`
  — `en` é o idioma default, `pt-BR` mantido, servidor é a fonte de verdade
  (`localStorage` só evita flash no primeiro paint); `mermaid` (runtime,
  ADR 0068) para o diagrama C4 do Arquiteto, isolado atrás de
  `lib/mermaid-render.ts` com `import()` dinâmico; `@xterm/xterm` +
  `@xterm/addon-fit` (ADR 0103) para o terminal interativo do runner
  local, isolado atrás de `lib/xterm-runtime.ts` com `import()` dinâmico.
  `motion` (ADR 0210) para a animação de texto em curso, isolado atrás
  de `components/ui/Shimmer.tsx` (`LazyMotion` + `domAnimation`, nenhum
  outro arquivo o importa) e em grupo de vendor próprio `vendor-motion` em
  `codeSplitting.groups`, fora da carga inicial.
  Toda TELA é chunk próprio (`lazyRouteComponent` no `router.tsx`, com o
  `.preload` que o router espera), e os painéis das abas do projeto também
  (`React.lazy` em `project-tabs.ts`) — o `Shell` fica estático. Vendors de
  toda tela vão em `codeSplitting.groups` do `vite.config.ts` por lista de
  PERMITIDOS: um grupo genérico de `node_modules` puxaria `mermaid`/`xterm`
  para o bundle inicial (AT-300)
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
  o `sleep infinity` de espera é PID 1 e não recebe SIGTERM sem init, e `stop`
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
- `apps/broker`: workspace novo, Node/TS — o ÚNICO processo do produto que
  fala com um daemon Docker no SERVIDOR (ADR 0130), e o único serviço com
  `/var/run/docker.sock` montado. Não monte esse socket em mais nenhum. Sem
  framework web (são seis rotas, medido em 2026-09-25, `node:http` puro), imagem própria em
  `docker/broker/`, e o binário `docker` DENTRO da imagem (`docker-cli`, só o
  cliente) — preço declarado da decisão de usar um mecanismo só dos dois lados.
  **Ele não aceita especificação de container**: recebe um `projectId` e uma
  das cinco operações da `DockerPort`, vai à api LER a decisão do Arquiteto
  (`GET /internal/projects/:projectId/container-spec`) e COMPÕE imagem, rede,
  recursos e o único mount. Não existe campo em que se escreva `privileged`,
  `cap_add`, `network: host` ou um `-v` livre — se a spec viajasse no corpo, a
  contenção de um processo root-equivalente no host dependeria de o CHAMADOR
  estar correto. A api NÃO manda caminho nenhum (o `-v` é resolvido pelo daemon
  contra o filesystem do HOST; um caminho de dentro do container da api montaria
  uma pasta VAZIA). Desde o ADR 0144 (RN-503) ele tem DUAS raízes —
  `PROJECT_WORKSPACES_HOST_ROOT` (a pasta GERENCIADA, modo `container`) e
  `BRABO_PROJECTS_HOST_BASE` (a base dos projetos MONTADOS, derivada de
  `BRABO_PROJECTS_BASE` no compose, ADR 0141) — e ele NÃO adivinha qual usar: a
  api manda um localizador DISCRIMINADO (`localizacao`: `gerenciada` |
  `montada` | `indisponivel`) dizendo contra qual raiz o SEGMENTO relativo
  vale. O invariante é o mesmo de sempre — o que atravessa a rede continua
  sendo só a metade que a raiz do broker não cobre. `start` recusa NOMEANDO a
  raiz que falta, e NUNCA cai na outra: a gerenciada é nomeada por
  `workspace_dir_name` e a base é nomeada pelo usuário, então o mesmo nome
  aponta para pastas diferentes e o container subiria com o código de outro
  projeto. Ele atende `container` E `mounted`, e recusa `runner` (a pasta mora
  numa máquina que este host não enxerga); a lista é de PERMITIDOS, então modo
  novo no enum nasce recusado com mensagem. Contenção em cinco camadas
  independentes — sem porta publicada, rede `internal: true` que só a api
  alcança, `BRABO_SERVICE_TOKEN` em tempo constante, cinco operações, spec
  computada. Desde a RN-512 (ADR 0146) sobe POR PADRÃO no compose local e
  permanece sob `profiles: ["container-broker"]` no de produção e no de
  INSTALAÇÃO — a divergência entre o de dev e os outros dois é a decisão, não
  descuido; no de instalação quem liga o profile é o `install.sh`, perguntando
  (ADR 0162, RN-575). A imagem de PRODUÇÃO (`docker/broker/Dockerfile.prod`) é
  a QUINTA publicada no GHCR desde o ADR 0162, com os mesmos gates das outras
  quatro (Trivy, non-root, healthy read-only sem rede no `ci.yml`; digest,
  assinatura e verificação no `release.yml`) — e o Kubernetes NÃO a conhece, de
  propósito: não há Deployment de broker, e `argumentosDeSetImage` emite só as
  quatro que a base do kustomize declara. A imagem de
  DEV instala as dependências no BUILD e NUNCA em runtime, e isso é
  consequência direta da rede: sem egress não há registry alcançável, e a
  resposta a "o pnpm não baixa" é SEMPRE tirar o registry do caminho quente
  (o pnpm instalado no build em `/usr/local/bin`, do tarball do registry
  conferido contra o sha512 gravado no Dockerfile, na MESMA versão do
  `packageManager` — sem corepack, que o Node 25+ não traz (AT-360); `pnpm
  install` como passo de build), NUNCA dar rede ao serviço. Os TRÊS
  volumes nomeados de `node_modules` são montados por cima do que a imagem
  instalou, e o Docker só semeia volume VAZIO — então
  `docker/broker/entrypoint.sh` reconcilia os três contra uma cópia guardada
  FORA de `/workspace`, carimbada com o sha256 do `pnpm-lock.yaml` do build:
  mexer numa dependência do broker exige `up -d --build broker`, e o
  entrypoint AVISA quando a imagem ficou para trás em vez de recusar subir. O
  serviço tem healthcheck (`wget` contra `127.0.0.1:8090/health`, de DENTRO —
  ele não publica porta): sem ele, `up --wait` dava `Healthy` a um container
  que morria cinco segundos depois, e foi assim que a queda chegou a ser
  anunciada como "reset completo"
- `packages/docker-port`: a porta de Docker e o adaptador de CLI, consumidos
  por `apps/runner` e `apps/broker`. Runtime, e por isso NÃO cabe em
  `packages/shared` (100% tipo, invariante travado por teste). Sem passo de
  build: os dois consumidores o EMPACOTAM (`tsup`, `bun build --compile`), e é
  por isso que a api não pode consumi-lo — `pnpm deploy` copia o pacote de
  verdade e o Node recusa type stripping dentro de `node_modules`
- `e2e/`: E2E de NAVEGADOR (Playwright, só chromium — ADR 0120), a quarta
  camada da pirâmide. Roda contra o compose de PRODUÇÃO (`docker/smoke.sh`
  com `SMOKE_KEEP_UP=1`), nunca contra o `vite dev`: o que ele prova —
  refresh em cookie `httpOnly`, CSRF em origem cruzada `:8088`→`:3000`,
  ticket de uso único do socket (RN-108) contra o engine numa TERCEIRA
  origem — só existe quando as três origens são distintas, e jsdom não
  alcança nenhuma delas. NÃO é membro do workspace (mesmo desenho do
  `website/`, ADR 0117): lockfile próprio, `pnpm --dir e2e`, nunca
  `pnpm --filter`. Seletor é ESTRUTURAL, nunca texto (o idioma é decisão do
  servidor), e a asserção é sobre MECANISMO, nunca sobre tela
- Monorepo pnpm (TS) com apps/engine Elixir ao lado; Docker Compose para dev.
  `website/` NÃO é membro do workspace (ADR 0117) — lockfile próprio em
  `website/pnpm-workspace.yaml`/`website/pnpm-lock.yaml`, instalado com
  `pnpm install` de DENTRO de `website/`, nunca `pnpm --filter website` (usa
  `pnpm --dir website` nos scripts `docs:*`). Isola o `pnpm audit` do
  produto da árvore do Docusaurus, que nunca chega a imagem nenhuma.
  Dependência vulnerável TRANSITIVA se fecha por `overrides` — e eles moram em
  `pnpm-workspace.yaml` (raiz) e `website/pnpm-workspace.yaml`, NUNCA em
  `package.json`: já são vinte na raiz e dezessete no website, cada um com o
  advisory e o caminho do `pnpm why` no comentário ao lado. Duas disciplinas,
  escritas no topo do arquivo: a chave é a FAIXA VULNERÁVEL do aviso (nunca a
  versão instalada hoje) e a faixa é presa à LINHA MAIOR afetada. Faixa que já
  existe e ganha advisory nova sobe de TETO — não nasce entrada nova —, e sobe
  nos DOIS arquivos junto quando é MISTA, senão o lado esquecido volta a
  resolver a faixa vulnerável em silêncio. O painel do Dependabot mede a
  branch DEFAULT (`main`); quem mede a `dev` é o `pnpm audit` local, e ele já
  achou advisory que o painel ainda não tinha aberto — leia os dois, nessa
  ordem. Override que QUEBRA o consumidor não entra: mede-se e declara-se.
  Foi o caso do `@faker-js/faker@5.5.3`, pinado EXATO pelo `postman-collection`
  do plugin OpenAPI, sem versão de saída (medido na AT-359): a saída foi trocar
  o plugin pelo Redocusaurus (ADR 0206), não forçar o override
- Auth: first-party no domínio da api (argon2id + access JWT curto +
  refresh opaco com rotação); autorização RBAC no domínio da api
  (inalterada desde a Fase 1)
- LLM: roteador na api com suite de contrato; base OpenAI-compatível
  sobre node:http (timeout de inatividade, erro por `code`,
  capabilities em duas camadas — ADR 0041); catálogo com curadoria e
  preço congelado no metering (ADR 0042) — que desde o ADR 0188 só é o
  número quando a resposta NÃO traz o custo real: o `usage.cost` do
  OpenRouter vence, com `price_implicit` marcando a linha (a MESMA coluna
  do Jev) e o do catálogo ao lado em `catalog_cost_micros`, RN-665; 9 providers (ADR 0043); o Jev
  (`typesafe/jev-1.13`, Decisions API do OpenRouter) escolhe o menu de
  ferramentas de cada passo por uma porta PRÓPRIA, `ToolRouter`, fora do
  `LLMProviderRegistry` e do catálogo `models` (ADR 0179, RN-625): só com
  provider OpenRouter, só RESTRINGE (P3), ligado por padrão por workspace, e
  qualquer falha dele deixa o catálogo inteiro — o turno nunca falha por causa
  dele, e ele não aprova, não nega nem escolhe modelo
- Deploy: Kubernetes (k3d/kind em validação local). As cinco imagens de
  produção são PUBLICADAS no GHCR a cada tag final, públicas e por digest
  (ADR 0119; a quinta, o broker, desde o ADR 0162) — `.release/images.json`
  registra o que cada tag publicou, e `make imagens-do-release` aplica no
  overlay as QUATRO que o kustomize conhece (o broker fica fora do k8s). O overlay do repositório
  guarda o MARCADOR, nunca uma release congelada; nada disso faz deploy
  sozinho (ver `DEPLOY_ENABLED` acima, que continua não existindo)
- Docs: Docusaurus 3.x em website/ lendo de docs/; Mermaid; busca local
- CI/CD de release: GitHub Actions com lógica em scripts testáveis
  (scripts/ci/, vitest). Todo `uses:` de terceiro é preso a COMMIT SHA, com
  a versão num comentário ao lado (`@<sha>  # v4`) — tag é ponteiro que o
  dono da action move sem aviso, e quem move executa código no runner que
  tem o checkout e os segredos daquele workflow. O comentário é obrigatório:
  é o que diz a um humano, e ao Dependabot, que versão é aquele hash.
  `scripts/ci/actions-pinadas.ts` reprova no job `lint` quem esquecer, e
  todo `curl` de binário passa por `sha256sum -c`. Desde o ADR 0159 essa
  regra tem uma IRMÃ, e o argumento é o mesmo palavra por palavra: toda
  IMAGEM de terceiro é presa por DIGEST, e o digest é o do ÍNDICE, nunca o de
  uma plataforma — pinar o manifesto de `linux/amd64` quebraria `linux-arm64`
  sem aviso. Desde o ADR 0178 (AT-139) a TAG mora DENTRO da referência, antes
  do digest — `neo4j:5.26-community@sha256:…`, e no Dockerfile
  `FROM node:26.10.0-alpine3.24@sha256:… AS deps` —, e NÃO num comentário, que
  era a forma do ADR 0159: o Dependabot não lê comentário em formato nenhum e
  atualiza pin só de digest para o digest da `latest`, com o comentário
  mentindo e o lint verde. Com os dois, o Docker puxa pelo digest. Comentário
  ao lado é PERMITIDO só se disser a MESMA tag (um token com dígito que
  diverge reprova), e em DOCKERFILE comentário no FIM da linha do `FROM`
  continua proibido: o parser do Docker só reconhece `#` no INÍCIO da linha,
  então `FROM x@sha256:… # tag` é um `FROM` com TRÊS argumentos e o build
  morre — aprendido errando, e o `hadolint` tinha passado (parser próprio;
  linter concordar não é build concordar). Vale nas TRÊS árvores onde imagem de terceiro entra: `docker/`
  (compose E `FROM` de Dockerfile), `deploy/k8s/` e `.github/workflows/` —
  esta última é `services:` de job, ou seja, o MESMO runner que a regra das
  actions protege, alcançado pela outra porta, e foi o lugar que o próprio
  levantamento do `BRB-004` não tinha visto. E desde o ADR 0197 (AT-246) os
  workflows NÃO têm literal de imagem nenhum: o `image:` dos `services:` é
  `${{ needs.imagens.outputs.<imagem> }}`, de um job `imagens` que chama o
  reutilizável `.github/workflows/imagens-do-compose.yml`, que lê o serviço do
  compose de DEV (`scripts/ci/imagens-do-compose.ts`, tabela
  `IMAGENS_DOS_WORKFLOWS`). Serviço novo de workflow entra por ESSE caminho —
  imagem no compose, linha na tabela, output no reutilizável (o spec reprova
  se divergirem) —, nunca com um literal. Job EXIGIDO que dependa de `imagens`
  leva `if: ${{ !cancelled() }}`, senão `imagens` vermelho o deixaria
  `skipped`, que conta como verde. `scripts/ci/imagens-pinadas.ts`
  reprova no job `lint`, e reprova: referência mutável, digest sem a tag
  INLINE (inclusive a forma antiga, tag só no comentário), comentário que
  diverge da tag inline, comentário no fim do `FROM`, a MESMA tag inline com
  dois digests diferentes, e — num WORKFLOW — imagem literal (mesmo por
  digest), expressão que não seja EXATAMENTE `${{ needs.<job>.outputs.<x> }}`
  (literal na expressão, `||`, `env.`, `vars.`, `format()` são onde um literal
  mutável se esconde) e `needs` de job que não chama o reutilizável. A regra
  dos dois digests nasceu da promessa do `golden-set-rag.yml` de rodar a
  mesma versão do compose de dev (o piso do golden-set é chaveado por MODELO,
  não por ambiente); desde o ADR 0197 essa promessa é CONSTRUÇÃO, e a regra
  segue guardando composes × Dockerfiles × manifests. São DOIS
  scripts e não um: `uses:` mora em YAML de workflow com uma sintaxe, imagem
  mora em compose, manifest do kustomize e Dockerfile com outras três. O
  check NÃO cobre as imagens que o PRODUTO publica, e isso é decisão com três
  razões — não há terceiro que as mova; `brabo-api:prod` é tag LOCAL cujo
  digest não existe antes do build; e onde elas atravessam registry o ADR
  0119 já as resolve, com o overlay guardando o MARCADOR de propósito, então
  cobrar digest literal ali reprovaria o estado CERTO. Também ficam fora
  referência interpolada (`${BRABO_API_IMAGE:?…}`) e estágio de multi-stage.
  A lista de exceções é por NOME e falha fechado: imagem de terceiro nova
  nunca casa com `brabo-`. Preço DECLARADO e não pago aqui: digest congela, e
  imagem congelada não recebe correção de segurança até alguém trocá-lo — e
  desde o ADR 0197 o Dependabot `docker-compose` (`/docker`) e `docker`
  (`/docker/*` e `/deploy/k8s/**`, NUNCA `/docker` sem o `/*`: o `docker`
  também lê YAML e abriria um segundo PR para os composes) estão LIGADOS,
  `target-branch: dev`, cada um com UM grupo — sem grupo, a mesma tag em três
  pastas de Dockerfile viraria três PRs vermelhos. Segue DECLARADO: `neo4j` e
  `ollama` moram também em `deploy/k8s/base/`, os dois ecossistemas nunca
  dividem um PR, e uma re-publicação da MESMA tag faz os dois PRs nascerem
  vermelhos pela regra dos dois digests até um humano juntá-los — não afrouxe
  a regra para eles passarem. O `imageName` do CNPG e a
  `IMAGEM_DO_GOLDEN_SET_QA` ficam no procedimento manual em qualquer caso. Subir um digest é procedimento de runbook, e a regra NÃO tem RN,
  pelo mesmo motivo que a irmã não tem: as duas moram aqui e em
  docs/explanation/cadeia-de-suprimentos-do-ci.md, e pôr uma delas em
  business-rules.md daria dois endereços à mesma política. E desde a RN-524 (ADR
  0149) a esteira também ASSINA o que publica: `cosign` keyless (OIDC do
  Actions) nas imagens publicadas (cinco desde o ADR 0162) por DIGEST — nunca por tag, que é ponteiro
  móvel — e UM `checksums.txt` assinado cobrindo os binários do runner
  (quatro alvos desde o ADR 0174), não uma assinatura por binário. Os dois workflows VERIFICAM o que
  assinaram no mesmo run, porque assinatura que ninguém tenta verificar é
  arquivo a mais e a falha apareceria só na máquina de quem instala. E desde
  o ADR 0172 (AT-179) o `release.yml` ESCANEIA o que publica antes de
  assinar: Trivy sobre o DIGEST de cada imagem do `.release/images.json`
  (`--image-src remote`), entre o registro e o `cosign sign` — imagem
  reprovada não é assinada, e o `install.sh` não instala imagem sem
  assinatura. Até ali só o `ci.yml` escaneava, e ele escaneia um build LOCAL do
  PR, enquanto a tag constrói FRIA noutra execução (AT-110). O portão usa as
  flags do `ci.yml` BYTE A BYTE (`--severity HIGH,CRITICAL --ignore-unfixed
  --exit-code 1`, o MESMO `.trivyignore.yaml`) e o veredito é o código de
  saída do Trivy, nunca uma régua em TS; o que NÃO tem correção é RELATADO
  (resumo do job e asset `trivy-sem-correcao.md`, por
  `scripts/ci/trivy-do-release.ts`) e não bloqueia. Sem allowlist nova — não
  acrescente `--ignorefile`, `--skip-*` nem `--vex` ao release para uma tag
  passar. Versão, `sha256` e flags do Trivy existem nos DOIS workflows, de
  propósito (`env:` não se importa), e `scripts/ci/trivy-do-release.spec.ts`
  reprova a divergência e o portão depois da assinatura: quem sobe o Trivy sobe
  nos dois no mesmo PR. Preço declarado: o push vem antes do scan, então tag
  reprovada deixa imagem SEM assinatura no GHCR e sem Release. Desde a
  RN-525 o proxy `GET /runner-releases/binary` VERIFICA — mas só o sha256
  contra o `checksums.txt` da mesma release, nunca a ASSINATURA dele: é
  INTEGRIDADE e não procedência, e está escrito assim no docblock, na
  OpenAPI, na mensagem de recusa e na RN. As duas formas de a api verificar
  assinatura foram MEDIDAS e recusadas — `cosign` na imagem custa 155 MB
  contra um runtime Alpine+Node, e `@sigstore/verify` (2,5 MB, barato) faria
  uma rota `@Public()` depender de um SEGUNDO host de terceiro
  (`tuf-repo-cdn.sigstore.dev`) para verificar algo que nenhuma Release
  carrega ainda, o que a régua dos ADRs 0041/0042 proíbe declarar sem prova.
  Quem verifica assinatura é o `install.sh`, com `cosign` pinado — e ele roda
  na máquina DOS OUTROS, então não assume ferramenta que o SO possa não ter:
  hash é UMA função com DUAS ferramentas aceitas (`sha256sum` **ou**
  `shasum -a 256`), resolvidas ANTES do primeiro download e nunca no meio de
  uma verificação, pela mesma disciplina que já fez o `case` de
  `sha_do_cosign` recusar array associativo (bash 3.2 do macOS) e
  `comparar_versoes` recusar `sort -V`. Faltar as DUAS é recusa PRÓPRIA, que
  nomeia a ferramenta — NUNCA a de hash divergente, que é a de INCIDENTE
  (*"pare e investigue"*): o script chamava `sha256sum` direto nos cinco
  pontos de verificação, o macOS não o traz, e o `command not found` chegava
  como acusação de adulteração, bloqueando toda instalação na plataforma que
  ele mesmo suporta e ensinando a ignorar a frase no dia em que ela for
  verdade (AT-091, RN-526). Ferramenta ausente e hash divergente são recusas
  DIFERENTES, com textos diferentes — não as colapse. Fica FORA,
  declarado: code-signing de SO dos binários (notarização, Authenticode) e a
  metade de PROCEDÊNCIA do proxy — BRB-005 segue aberto só nela. E desde a
  RN-565 o manifesto NÃO é mais refém da matriz: o job `checksums` perdeu o
  `needs: build` e passou a esperar os ASSETS da Release, com teto, em vez do
  JOB mais lento — que podia nem começar. O número é medido nas três tags que
  existem: `darwin-x64` ficava 24h00m01s na fila e era cancelado, o MESMO
  valor nas três, enquanto os outros quatro terminavam em no máximo 4m18s (o
  alvo saiu da matriz depois, no ADR 0174; a correção vale para qualquer alvo
  sem runner). `always()`
  cobria dependência CANCELADA e por isso o job RODAVA; o que ele nunca
  cobriu foi QUANDO, e um manifesto que chega um dia depois é, para quem
  instala, um manifesto ausente (RN-525/526 recusam sem ele, em TODA
  plataforma, inclusive as que anexaram). O teto dos binários é 1200s porque
  é o `timeout-minutes: 20` do próprio job `build` — o máximo que um alvo COM
  runner demora depois de começar; não cobrir tempo de FILA é o ponto. Ver
  docs/explanation/cadeia-de-suprimentos-do-ci.md, que também DECLARA o que
  segue confiado na fé (sem proveniência de dependência npm; o Dependabot e a
  imagem de terceiro por tag saíram dessa lista, e o que ficou no lugar do
  segundo é o preço do pin — digest não recebe correção sozinho).
  E há UM workflow que NÃO roda em `pull_request` e não pode passar a rodar:
  `install-e2e.yml` (RN-534/RN-549). O instalador verifica a própria origem
  contra o `checksums.txt` ASSINADO de uma Release, que só existe depois de uma
  tag final — fazê-lo rodar em PR exigiria dar-lhe uma porta para PULAR a
  verificação, que é a porta que o ADR 0150 recusa e que, aberta, vale para
  qualquer um. A consequência é DECLARADA e não escondida: **PR que mexe nesse
  workflow não o executa**, e verde ali não significa provado. O que roda em PR
  é `scripts/dev/install-e2e.spec.ts`, e ele guarda as duas formas de o E2E
  apodrecer calado — o gatilho afrouxado, e uma frase do `install.sh` reescrita
  (que não faz as asserções falharem: faz elas SUMIREM). Mesma decisão, mesmo
  motivo, do golden-set do RAG (ADR 0138) e do golden-set do QA
  (`golden-set-qa.yml`, SEMANAL, ADR 0168 — api, engine e broker nativos no
  runner, o socket do Docker só no broker, e a imagem dos casos lida do
  próprio seed, nunca de um segundo literal no workflow). E ele guarda uma TERCEIRA, medida na
  AT-083: o instrumento que não mede. O passo "com TTY" rodava
  `script -qec "… < respostas"`, o `<` ficava DENTRO do `script`, e o
  instalador nunca viu terminal — o comentário afirmava o contrário. Quem roda o
  instalador agora é um driver de pty em Python, e o spec EXTRAI esse driver do
  workflow e o roda contra um instalador de mentira; lógica de workflow que só
  roda em tag se prova assim, em PR, nunca por leitura. A forma de instalar é
  BAIXAR e rodar um arquivo (`curl -fsSLO … && bash install.sh`, RN-526) — o
  `sh -c "$(curl …)"` antigo nunca funcionou, porque a autoverificação calcula o
  hash de `$0`; não reabra essa forma nem dê à verificação uma porta de pular
