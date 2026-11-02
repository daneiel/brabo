> Parte do `CLAUDE.md` da raiz, importada por ele e lida em toda sessão.
> Edite aqui; o `CLAUDE.md` só guarda o índice das partes.

## Convenções (repositório, dados e domínio)
- Branches permanentes: dev, qa, main — um branch, um ambiente. `rc` saiu
  da política (ADR 0030) e o bootstrap parou de criá-la, mas continua em
  `PROTECTED_BRANCHES` DE PROPÓSITO: a lista decide o que a trava de merge
  RECUSA, e repositórios bootstrapados por versões anteriores ainda têm a
  branch. Proteger uma branch que não existe não custa nada; desproteger
  uma que existe custa caro. Não "limpe" essa lista.
  Trabalho nasce de dev com a taxonomia da política (breaking/,
  feature/, bugfix/, perf/, refactor/, chore/, docs/, test/);
  hotfix/ nasce de main. Os AGENTES seguem a mesma régua desde a RN-664: o
  worktree do dev agent nasce de `dev`, a PR dele e a de ADR miram `dev`, e o
  gate julga o diff contra `dev` — os três juntos, nunca um só (o gate
  julgaria um diff que não é o da PR); repositório sem `dev` falha nomeado,
  sem queda para a default. A PR de INFRA (`open_infra_pr`) segue a
  mesma régua desde a RN-729: `feature/infra-setup` nasce de `dev`, mira `dev`
  e leva o autor `infra[bot]`. Formato funcao/descritivo,
  regex ^.{0,30}/\S{0,32}$. EXCEÇÃO nomeada: `dependabot/…` é branch
  PERMITIDA sem critério de caracteres (sem limite de tamanho, qualquer número
  de barras), mas só quando o AUTOR é o próprio Dependabot
  (`ehBranchDoDependabot` em `scripts/ci/pr-police.ts`) — humano com esse
  prefixo reprova em `FUNCAO-DESCONHECIDA`, senão o prefixo vira a porta para
  escapar do formato. Commits em conventional commits, pt-BR.
  A FUNÇÃO da branch decide a VERSÃO (scripts/ci/version.ts): breaking/
  sobe MAJOR, feature/ sobe MINOR, todo o resto é PATCH. Mudança que
  exige ação do operador antes do deploy nasce em breaking/ mesmo quando
  o conteúdo é correção — o v2.5.1 saiu patch porque a chave obrigatória
  do OAuth nasceu em bugfix/, e um patch diz "atualize sem pensar".
  Versão não se corrige à mão depois: o valor de ela ser calculada vem de
  não ser negociada caso a caso.
- Volume nomeado do Docker nasce com o dono do caminho que existir NA IMAGEM;
  quando o caminho NÃO existe, ele nasce `root` e o processo non-root fica de
  fora. Por isso `/data/git-repos` e `/data/project-workspaces` são criados e
  `chown`-ados ANTES do `USER` nos QUATRO Dockerfiles — os dois de produção e
  os dois de dev (`docker/api/Dockerfile`, `docker/engine/Dockerfile`). Só a
  produção fazia isso, e o preço foi medido: em dev, `git init --bare` do
  `LocalGitProvider` morria com `permissão negada: /data/git-repos/<slug>.git`
  e o `permissions.json` de cada projeto não tinha onde ser escrito — ou seja,
  provisionar repositório era impossível na máquina de quem desenvolve o
  produto. Ao acrescentar volume nomeado novo, crie o diretório na imagem;
  esquecer não dá erro de build, dá 403 em runtime. Vale também para os
  `node_modules` de `api` e `web` (AT-172: `EACCES` no `pnpm install`), e o
  ponto de montagem DENTRO do bind-mount do host o Docker cria como root —
  isso a imagem não alcança, e quem o cria antes é o `preflight.mjs`. Os do
  ENGINE (`_build`/`deps`/`.mix`/`.hex`) já nasciam com o dono certo — medido
  do zero na AT-182, o `docker/engine/Dockerfile` os cria antes do `USER`. Volume JÁ criado continua
  com o dono antigo: a correção vale para volume novo, e destravar um ambiente
  existente exige `docker volume rm` (ou um `chown` pontual como root).
- `docker compose up --wait` só prova o que tem `healthcheck` — para serviço
  sem um, ele espera "running" e segue em frente. Isso já custou duas vezes: o
  broker morrendo em silêncio (corrigido com o healthcheck dele) e o
  `scripts/dev/reset-total.sh` anunciando "reset completo" com a api em
  `Exited (1)`. Os SEIS serviços do compose de DEV têm healthcheck agora, com
  o MESMO teste que as imagens de produção já faziam por `HEALTHCHECK` no
  Dockerfile (`/health` na api e no engine — toca o banco, que é a pergunta
  certa para readiness; `/` no Vite do web). Serviço novo nasce com o dele, e
  `start_period` de DEV é generoso de propósito: o CMD roda
  `pnpm install`/`mix deps.get` antes de o processo escutar.
- Script que apaga o banco PARA antes quem está conectado nele, e a lista é
  `api` e `engine` — nenhum a mais. Os dois mantêm conexão viva com o Postgres
  do compose (pool do Drizzle sobre `public`/`drizzle`; Ecto/Oban sobre
  `engine`), e `DROP SCHEMA` embaixo deles MATA os processos — o engine morre
  dentro do próprio drop, porque o `Rehydrator` consulta `engine.session_states`
  — sem que nada os reerga depois. `web` não fala com banco, `neo4j` é outro
  banco, o `broker` só fala HTTP com a api: parar de mais transforma um reset de
  banco numa derrubada do ambiente. E script que AFIRMA um estado pergunta antes
  de afirmar: `scripts/dev/reset-total.sh` bate em `/health` dos três e imprime
  `ps` antes da frase final, que nomeia o que ficou de pé — e qualquer falha no
  meio sai com o passo nomeado, nunca com a frase de sucesso. O reset NÃO
  remove nem recria volume nenhum (AT-181), e DIZ isso no começo e no fim:
  "total" é o banco e as imagens, e o preço é que ele nunca reproduz um
  PRIMEIRO CLONE — defeito de volume inexistente (AT-172) se prova num projeto
  compose DESCARTÁVEL (`-p <nome> run --rm --no-deps`, `down -v`), nunca nele.
  `scripts/dev/reset-total.spec.ts` reprova linha executável que apague volume.
  E o que o faria morrer DEPOIS do `DROP SCHEMA` por motivo do HOST ou de um
  VOLUME é perguntado ANTES do primeiro efeito (AT-203): as migrations e o seed
  rodam no host, com o `deps`/`_build`/`node_modules` do CHECKOUT, então o
  script roda `mix deps.get` + `mix compile` em `apps/engine` (um `mix.lock`
  novo o derrubava com `lock mismatch` e o banco apagado), confere
  `drizzle-kit`/`ts-node`, e confere a senha do Neo4j contra a do volume (o
  Neo4j só aplica `NEO4J_AUTH` na CRIAÇÃO de `neo4j_data`) — recusando com
  `RESET NÃO COMEÇOU`, e nomeando a senha também se o `up --wait` reprovar por
  ela. Pré-requisito novo de host entra em `scripts/dev/reset-total-lib.sh`,
  antes do `stop`; `reset-total-ordem.spec.ts` roda o script inteiro com
  binários de mentira no PATH e reprova a ordem invertida.
- O compose de DEV é o projeto Docker `brabo-dev` e o de INSTALAÇÃO é `brabo`
  (ADR 0170, AT-173) — containers `brabo-dev-api-1` × `brabo-api-1`, volumes
  `brabo-dev_pgdata` × `brabo_pgdata`. Até ali os dois eram `brabo`, UM projeto
  numa máquina com os dois: o banco da instalação recebeu migration do dev, e o
  `DROP SCHEMA` do reset cairia nele. NÃO renomeie o de instalação (desligaria
  as instalações existentes dos próprios volumes) e NÃO volte o de dev a
  `brabo`; o overlay de observabilidade repete `brabo-dev` porque o `name:` do
  último `-f` vence. Comando ou doc de DEV cita `brabo-dev-*`; o que fala da
  INSTALAÇÃO (o `brabo_project_workspaces` que o `install.sh` mede) continua
  `brabo`. O `preflight.mjs` e o `reset-total.sh` RECUSAM enquanto houver na
  máquina container do compose de instalação — pelo ARQUIVO do rótulo
  `com.docker.compose.project.config_files`, em qualquer estado e qualquer
  `-p` — ou se o dev resolver o projeto `brabo`; no reset é o PRIMEIRO passo,
  antes do preflight. A régua mora em DOIS lugares de propósito
  (`scripts/dev/instalacao-na-maquina.mjs` e `recusar_se_ha_instalacao` em
  `reset-total-lib.sh`, porque o spec do reset roda com `node` de mentira). Os
  volumes `brabo_*` do dev antigo só geram AVISO, derivado das chaves que SÓ o
  compose de dev declara; nenhum script apaga volume, e o procedimento de cópia
  está no runbook ("Moving a dev environment to brabo-dev"). Prova de guarda ou
  de subida se faz num projeto DESCARTÁVEL (`-p <nome>`), nunca contra o
  `brabo-dev` corrente nem contra uma instalação real.
- `apps/api/src/db/seed.ts` é IDEMPOTENTE, e rodá-lo de novo é o caso normal
  (o `bootstrap.sh` do k8s o chama com `BRABO_FORCE_SEED=1` contra um cluster
  que pode já estar semeado, e quem vê o reset falhar tenta rodar só o seed).
  Registro de demonstração novo entra REAPROVEITANDO o que já existe, nunca
  com `create` puro — antes, workspace, projeto e sessão eram os três que não
  reaproveitavam, e a segunda rodada escrevia metade e morria em
  `duplicate key ... "workspaces_slug_unique"`. Sessão reencontrada NÃO é
  reativada nem ganha os 5 eventos de novo: eles são append-only, e uma
  timeline que existe para demonstrar cinco não pode crescer a cada reseed.
- Criar usuário tem UM núcleo (`ProvisionarUsuarioUseCase`) e DUAS portas com
  regras diferentes, e a diferença é o que cada uma protege (RN-546, ADR 0155).
  `provisionarUsuario` (seed/smoke) MANTÉM a recusa de `NODE_ENV=production` e
  ela fica no SCRIPT, não no núcleo: o que ela protege é senha CONHECIDA criada
  SEM interação humana, e não o trio de escritas — **não use `BRABO_FORCE_SEED`
  para atravessá-la**. `POST /internal/first-account` roda em produção de
  propósito (é onde o instalador roda), e é outra categoria: senha DIGITADA no
  TTY por quem está na máquina. E a régua de senha é UMA só, a
  `exigirSenhaValida` do domínio — por isso o DTO dessa rota NÃO repete um
  `@MinLength`, que cobriria só uma das cinco recusas e divergiria da do
  registro no primeiro dia em que uma das duas mudasse.
- Toda mudança entra por PR — push direto em permanente é bloqueado;
  únicas exceções de push: tags (bot de release) e .release/gate.json
  (bot do gate).
- PR do Dependabot entra pela `dev`, nunca direto na `main` — chega lá pela
  promoção, como o resto. `target-branch: dev` cobre atualização de VERSÃO;
  SECURITY update o GitHub abre sempre contra a branch default (`main`), e
  `.github/workflows/dependabot-para-dev.yml` FECHA o que a `dev` já corrige
  (versão resolvida >= primeira corrigida do ALERTA, nunca o "to" do PR, que é
  a mais nova e não a mínima) e REDIRECIONA o resto — na dúvida redireciona,
  nunca fecha. O gatilho que vale é `push` na `dev`: `pull_request_target` e
  `pull_request` não enxergam workflow que só existe na `dev`. Medido na 1ª
  execução: o `GITHUB_TOKEN` NÃO lê os alertas, então hoje a decisão compara com
  o destino do PR e o redundante é REDIRECIONADO, não fechado. Depois de
  redirecionar, os checks da `dev` só rodam com `@dependabot rebase` de quem
  tem escrita (evento do `GITHUB_TOKEN` não dispara workflow).
  PR do Dependabot que SÓ troca pin de action (SHA do `uses:` + comentário de
  versão, mesma action, mesma indentação) ganha `docs-not-needed:` escrito
  pelo BOT, num passo do job `Drift, gerados e build` antes do drift
  (`scripts/ci/dependabot-justifica-pin.ts`, AT-094) — autor E diff, as duas;
  qualquer outra linha e nada é escrito. NÃO mova isso para workflow irmão: o
  `GITHUB_TOKEN` não dispara `edited`, re-executar o job reusa o corpo ANTIGO
  do payload (medido, run 34898913072) e `pull_request_target` só roda o
  workflow da `main`. É por isso que o drift lê `PR_BODY_FILE` antes de
  `PR_BODY`. A linha do bot é marcada e sai sozinha se o diff deixar de ser
  pin; a de humano nunca é tocada.
- Toda branch cujo PR é mergeado é ARQUIVADA automaticamente 7 DIAS depois
  do merge, por checagem DIÁRIA (`.github/workflows/archive-merged-branch.yml`,
  AT-557): sem PR aberta e sem commit depois do merge; branch sem PR mergeada
  não é tocada — move de
  `refs/heads/<nome>` para `refs/archive/<nome>`, nunca apaga: histórico
  intacto, recuperável com um `git push` de volta. Exceções: dev/qa/main
  (aparecem como `head` de todo PR de promoção), `gh-pages` (deploy do
  site, não é branch de feature) e branch de fork. A política mora em
  `scripts/ci/archive-branch.ts` (testado), ver
  docs/explanation/branching-policy.md, seção "Merged branches get
  archived".
- Comunicação api ↔ engine: eventos via Postgres (transactional outbox
  na api, Oban no engine) + HTTP interno com service token para
  comandos síncronos.
- O schema do Postgres mora em `apps/api/src/db/schema/`, UM arquivo por
  AGREGADO de domínio, espelhando `apps/api/src/domain/*` (ADR 0121);
  `db/schema.ts` é só o BARREL de `export *` que todo mundo importa, e é para
  onde `drizzle.config.ts` aponta. Tabela nova entra no arquivo do agregado
  dela — arquivo novo só quando o agregado é novo, e aí entra também no
  barrel, na posição do ASSUNTO e não no fim. Enum mora com a tabela que o
  CHAMA, não com o assunto: FK entre arquivos é segura num ciclo
  (`.references()` é callback preguiçoso), enum entre arquivos NÃO é (roda na
  avaliação do módulo) — o grafo de imports é um DAG e continuar assim é
  invariante que ninguém testa, só quebra no boot.
- Todo evento de domínio é imutável: nunca UPDATE em tabelas de eventos.
- História ARQUIVADA é a coluna `stories.archived_at`, nunca um valor de
  `story_status` (o status é o que decide o claim) — ADR 0212, RN-727. Toda
  leitura que DECIDE (backlog, cobertura, fila de promoção, plano do Dev Lead,
  claim e a contagem dele) filtra `archived_at IS NULL`, e as tarefas saem
  junto pela história. Editar e arquivar têm UMA régua
  (`recusaDeCorrecaoDeHistoria`): só `draft` e sem tarefa
  `in_progress`/`in_review`; quem pode é o PO (`update_story`/`archive_story`)
  e o usuário (`developer`, aba Histórias). Corrigir a história é o caminho —
  o PO não a recria.
- Estados de sessão são máquina de estados explícita:
  created → active → closing → closed | closed_abnormally
  Estado TERMINAL recusa CONVERSA com 409 nomeado (`sessao_encerrada`,
  RN-581), e "conversa" é TIPO de conversa OU ATOR conversacional — nunca uma
  lista de permitidos por tipo: o Psicólogo e a Anamnese escrevem numa sessão
  fechada com o MESMO vocabulário do Criativo, e a decisão humana sobre ação
  pendente continua entrando. O heartbeat não fecha sessão com conversacional
  esperando o usuário, mas essa é a ÚNICA pendência com teto (8h do fim do
  turno, causa `conversation_idle_timeout`); os outros sinais da RN-064
  continuam sem teto e vencem. Fechar a sessão PARA os conversacionais dela
  em todos os nós (`SessionLifecycleWorker`), sem gravar o turno em curso —
  e, desde a RN-763, os dev agents dela e os gates do projeto, com a task em
  curso bloqueada e o worktree preservado (`Engine.Dev.EncerramentoDaSessao`);
  "Parar execução" na aba Executores é esse MESMO fechamento, sem estado novo.
  Os terminais têm UMA saída desde o ADR 0183 (RN-649/650): a REABERTURA,
  para `active`, por rota e checagem PRÓPRIAS (`reopen`, `canReopen`) — a
  transição genérica continua recusando `closed → active`, e `closing →
  active` segue proibido por qualquer caminho. Não ponha `active` em
  `ALLOWED_TRANSITIONS` dos terminais. O fechamento anterior vira o evento NOVO
  `session.reopened` (a coluna é limpa, o evento guarda quando e por quê), o
  `kind` não muda, e sessão com `execution.activated` NÃO reabre (409
  `sessao_com_execucao`); papel `developer` (o mesmo de encerrar), sem prazo e
  essa recusa são decisão do dono desde o ADR 0184 (AT-337), não mais padrão
  provisório. O `SessionLifecycleWorker` ignora o
  fechamento que a reabertura já desfez (lê o `status` da sessão).
- A sessão tem DUAS classificações, e elas não se sobrescrevem: `kind`
  (`consultiva|criativa`) é a INTENÇÃO de criação, gravada e imutável; o
  evento `execution.activated` é o ESTADO de execução, e continua sendo
  ele que `findActiveExecutionSession` procura. `execution.activated` em
  sessão consultiva é 409, nunca conversão silenciosa (ADR 0061, RN-097).
  Não faça a derivação por evento olhar `kind`
- O repositório de projeto CRIADO nasce no aceite do handoff ao ARQUITETO
  (RN-582, ADR 0165), dentro de `AcceptHandoffUseCase`, ANTES de
  `activateAgent` — criar projeto não provisiona (RN-541). O aceite ao Dev Lead
  repete a chamada como SEGUNDA PORTA idempotente (a saída do projeto que
  passou pelo Arquiteto sem repositório); não a remova. E
  `execution/activate` sem repositório é 409 antes de qualquer efeito —
  RECUSA, nunca provisiona: provisionar ali esconderia um efeito de git na
  ativação e deixaria Arquiteto e Infra, que trabalham antes dela, sem onde
  escrever. Desde o ADR 0186 (RN-660) esse aceite tem um SEGUNDO autor: a
  oferta `po → arquiteto` é aceita pelo SISTEMA quando o backlog está coberto
  (≥ 1 regra, nenhuma sem história, a mesma `computeCoverage` da aba Backlog),
  o repositório é `local` e o projeto não tem conexão de git — sempre por
  `AcceptHandoffUseCase` e com o ator `handoff-auto-accept` no log. Não
  estenda a outro par de agentes nem a repositório remoto sem ADR
- O `permissions.json` mora onde a API ALCANÇA, e o ESCOPO do terminal aponta
  para o HOST — são DUAS derivações desde a RN-478, não uma. Elas nasceram
  como uma só (`projectScopeRoot`), e isso estava certo enquanto os dois modos
  com pasta de usuário eram bind-mount; deixou de estar quando o `runner`
  nasceu, deliberadamente SEM bind-mount. O escopo do ADR 0055 quer o caminho
  do HOST (é lá que o comando roda, pelo runner); o arquivo de política quer um
  caminho que a api ALCANCE, porque ela o lê e o ESCREVE de dentro do container
  dela — daí o 500 da ativação (`mkdir '/home/<usuario>'`) e, pior, o arquivo
  que NUNCA existiu em projeto `runner`, com `decide()` caindo sempre em
  `require_approval`. `permissionsFilePath` mora ao lado de `projectScopeRoot`,
  no MESMO arquivo, porque a fonte continua única: o que se separou foi a
  pergunta, não a autoridade. No modo `runner` o arquivo vai para a raiz
  GERENCIADA, chaveado pelo `workspace_dir_name` da RN-109 — política é da api,
  não do disco do usuário: guardá-la lá a tornaria editável por quem ela
  restringe e ilegível com o runner desconectado. `container` e `mounted` não
  mudam (em `mounted` a pasta É bind-mount). NÃO "unifique" as duas de volta:
  há teste de não-regressão, e escopo apontando para a raiz gerenciada
  autorizaria comando numa pasta que não é a do projeto. O ENGINE não lê nem
  escreve esse arquivo em ponto nenhum — todas as menções nele são comentário
- Toda ação com efeito externo (git, terminal, gasto) nasce como
  proposed_action e respeita permissions.json; deny sempre vence allow.
  LER não é efeito externo e NÃO vira proposed_action — encheria a fila de
  ruído até ninguém mais ler as de verdade. O que a leitura deve é ser
  CONTIDA e ter TETO: caminho vindo do cliente passa pela checagem central
  (RN-092/RN-095), e leitura composta que chama o provider N vezes tem
  orçamento e cache, senão vira amplificador de tráfego (ADR 0060).
- `agent_autonomy` aceita `actionType: "*"` — "auto mode" (RN-153):
  autonomia pra QUALQUER tipo de ação do agente, ligada pelo `ApprovalCard`
  ("Modo automático") e desligada pelo mesmo toggle manual/auto do card do
  agente na Visão Geral/Executores. Regra específica sempre vence a
  curinga; a resolução mora no repositório (`resolve`, com `findMode` como
  leitura dele), nunca em `decide()`, que recebe o modo E a ORIGEM
  (`autonomyOrigin`). O teto de ESCOPO DE CAMINHO (ADR 0055) NÃO vale em auto
  mode (RN-603, ADR 0167, decisão do dono): ligar o modo automático é o
  usuário decidindo de uma vez que aquele agente roda qualquer comando,
  inclusive fora da pasta — medido no `exp001`, 47 de 51 pedidos vinham só do
  escopo, porque o dev agent roda no container (`/work`) e o escopo compara
  com a raiz do HOST. Só a curinga em `auto_approve` tem esse poder; regra
  ESPECÍFICA (`terminal: auto_approve`) segue com o escopo, e o toggle
  "manual" o restaura. Desde a RN-670 (ADR 0189, decisão do dono de 01/10, que
  MANTEVE a RN-603) isso é o PILOTO AUTOMÁTICO: `git commit` e branch LOCAL
  passam, e a específica `auto_approve` SOB a curinga `auto_approve` — o que
  "Sempre permitir" de dev agent grava — resolve COMO a curinga no repositório,
  então o clique não desliga mais o piloto; não "conserte" isso deixando de
  gravar a específica (ela é o que vale quando o toggle volta a manual). E fora
  do piloto o escopo compara com a pasta REAL de execução (RN-669): com
  container `running` em `container`/`mounted`, `/work` + o `/tmp` do
  container, com o `cwd` de host traduzido como o engine traduz; sem ele, a
  pasta do host, com o `/tmp` do host fora. `runner` fica na raiz do host, de
  propósito (a api não sabe se o runner roteia para o container). Os DEMAIS tetos continuam absolutos MESMO com auto
  mode ligado, e não têm exceção configurável em lugar nenhum — merge em
  branch protegida,
  `instruction_patch`, `parallelize`/`raise_max_parallel` (RN-154), e o
  teto de efeito externo/comando privilegiado — deploy e sudo/doas (git
  push e PR saíram dele PARA O MODO AUTOMÁTICO desde a RN-713/ADR 0204) —
  que revisou a RN-106 (RN-418, ADR 0102): antes era `deny`
  incondicional, agora é `require_approval` incondicional, com a mesma
  garantia de nunca ser auto-aprovável; "sempre permitir" foi fechado na
  fonte pra esse teto não virar decorativo (`ApproveAlwaysActionUseCase`
  recusa gravar padrão pra esses comandos). O teto vale pelas DUAS portas
  desde a RN-689: o COMANDO de terminal e as ações TIPADAS `git_push` e
  `pr_open`. Desde a RN-713 (ADR 0204, decisão do dono de 02/10) a curinga
  em `auto_approve` — e SÓ ela, o modo automático — promove `git_push`/
  `pr_open`, tipados ou pelo terminal; regra específica, "sempre permitir" e
  `permissions.json` não, e a ativação segue semeando só `git_commit` para
  os dev agents (fora do modo automático, push e PR do dev passam pela sua
  aprovação, RN-050). `git_merge` tem o
  teto próprio; `open_adr_pr`/`open_infra_pr` ficam fora por decisão. Desde a RN-661 a aba Executores
  OFERECE a curinga em lote para o time — mesmo endpoint, um PUT por agente,
  só com o clique, e dizendo o que o modo automático não libera; nunca a grave
  sem clique. E desde a RN-675 (ADR 0189, fecha a AT-170) o padrão que "sempre
  permitir" grava em `permissions.json` é VERBO + SUBCOMANDO, um por SEGMENTO
  (`patternsForAction`), nunca o comando inteiro: verbo + flag fica exato e
  unidade que é prefixo de um teto da RN-418 (`git remote`, `gh pr`) também —
  não troque isso por uma lista de verbos (é o espaço dos achados Z/AD).
- O papel de PROJETO sobrepõe o de workspace nos DOIS sentidos —
  `ResolveEffectiveRoleUseCase.forProject` é `projectRole ?? workspaceRole`, e
  NÃO é "o maior dos dois" (RN-471). Restringir alguém num projeto sensível é
  capacidade deliberada; não "corrija" isso. O que a sobreposição não pode
  fazer são DOIS movimentos, e eles são teto (ADR 0127, RN-472): ninguém
  rebaixa quem é `owner` do WORKSPACE, e ninguém rebaixa a SI MESMO — 403 nos
  dois, sem chave de configuração. `owner` aqui é `workspace_members.role`,
  NUNCA `workspaces.created_by`: criador não é dono corrente, e o papel é o que
  a autorização usa em todo o resto do sistema. Os tetos moram no CASO DE USO
  com a regra pura em `domain/iam/tetos-de-rebaixamento.ts`, não no
  `RolesGuard` — o guard autoriza o CHAMADOR contra o `@RequireRole` da rota e
  não vê corpo nem alvo, e estes tetos são sobre o ALVO e sobre a relação
  ator↔alvo. O teto 2 vale por DUAS portas desde o ADR 0156 (RN-556): a
  REMOÇÃO da própria linha também é 403 quando o efeito líquido é rebaixamento
  — remover não apaga um papel, TROCA o efetivo pelo do workspace, que pode ser
  menor (ou não existir). `remocaoEhAutoRebaixamento` DELEGA a
  `ehAutoRebaixamento` passando o papel de workspace como o papel pedido — não
  escreva uma segunda régua. O teto 1 NÃO tem par na remoção, de propósito:
  `owner` é o topo do `ROLE_ORDER`, então tirar a linha de um `owner` de
  workspace só pode ELEVAR o efetivo dele, e é a única forma de desfazer a
  restrição que o teto 1 impede de criar. Desde o ADR 0157 (RN-557) o teto 2
  vale por QUATRO portas e nos DOIS SENTIDOS: `POST workspaces/:id/members`
  deixou de ser upsert sem teto (era passa-adiante sem ator, num escopo onde
  não há nível acima para segurar a queda — e, até o ADR 0173, nem rota que
  removesse membro), e a
  auto-PROMOÇÃO — que o ADR 0127 declarou como capacidade que ficava — é
  BRECHA e fecha, nas duas rotas de associação: é a única metade do movimento
  que ESCALA privilégio. A comparação virou UM classificador
  (`autoMovimentoDoProprioPapel`, devolve o SENTIDO porque a mensagem depende
  dele); `ehAutoRebaixamento` sobreviveu como LEITURA dele, de propósito — é
  por ela que `remocaoEhAutoRebaixamento` segue vendo só a metade de baixo, e
  alargá-la faria a REMOÇÃO recusar o movimento benigno que o ADR 0156
  protegeu. O teto 1 também NÃO tem par no workspace, e foi considerado, não
  espelhado: ele é regra sobre INVERSÃO DE HIERARQUIA, e o
  `@RequireRole('owner')` da rota já a impede — pô-lo faria de `owner` um
  estado absorvente, do qual ninguém sai por HTTP. E o teto NÃO conta owners:
  a cláusula já garante que um workspace nunca chega a zero, porque tirar o
  último exigiria que ele mesmo o fizesse. Desde o ADR 0173 (RN-615) há a
  QUINTA porta, `DELETE workspaces/:id/members/:userId` (`owner`, 204), e ela
  também não tem régua nova: é `remocaoEhAutoRebaixamento` com o papel de
  WORKSPACE como o efetivo de hoje e `null` como o de depois — no workspace
  não há nível acima, então remover a SI MESMO é sempre 403 (frase própria,
  `MENSAGEM_TETO_AUTO_REMOCAO_DO_WORKSPACE`). O ÚLTIMO owner fica protegido
  por essa MESMA cláusula, sem contagem: só `owner` chama a rota e ninguém se
  remove, então toda remoção deixa ao menos o chamador — o mínimo `owner` da
  rota é METADE da prova, e está asserido em teste; não o baixe. Remover OUTRO
  `owner` passa (é como se revoga propriedade), e o teto 1 segue sem par. A
  remoção CASCATEIA numa transação — as linhas de `project_members` do
  removido nos projetos do workspace (sem isso a sobreposição o manteria
  dentro), as chaves de dispositivo de PROJETO e os PATs dele ali — e depois
  derruba o runner vivo dele em cada projeto pelo caminho da RN-520, sem
  derrubar a remoção se o engine falhar. Fica de fora, declarado: chave de
  MÁQUINA, socket de sessão já conectado, terminal `:web`. O TITULAR
  (`workspaces.created_by`, de quem é a credencial que os agentes gastam,
  RN-058, e o relatório de gasto, RN-060) NÃO sai: 409 `criador_do_workspace`
  até `PUT workspaces/:id/owner-of-record` (`owner`, destino JÁ `owner`, senão
  409 `titular_precisa_ser_owner`) passar a titularidade (RN-616). Titular não
  é autorização — quem autoriza continua sendo o papel —, e a transferência
  não confere se o novo titular tem credencial: sem ela, o turno termina com o
  desfecho de sempre ("Nenhuma credencial cadastrada"). Não há tela de membros
  de workspace; as rotas são de API. A LEITURA (`GET workspaces/:id/members`,
  RN-655) é `viewer`, e não o `owner` das escritas: ler não é manter, e é por
  ela que o fio da sessão nomeia quem entra só pelo papel de workspace. Segue possível e declarado:
  rebaixar outro `maintainer`; um `owner` rebaixando OUTRO `owner` no
  workspace (única forma de revogar propriedade, reversível pela mesma rota);
  reescrever o próprio papel com o MESMO valor (upsert idempotente não é
  movimento); a auto-promoção pela REMOÇÃO da linha de projeto; e a
  auto-remoção quando o workspace segura o MESMO papel — essa é benigna e
  continua passando.
- O projeto escolhe ONDE o código mora, na criação (RN-169/RN-421/RN-422,
  ADR 0072/0104) — e pode CONVERTER depois, sem recriar o projeto, por
  `PUT projects/:projectId/execution-mode` (`maintainer`, RN-447..450, ADR
  0111): `container` (DEFAULT — a pasta gerenciada em
  `PROJECT_WORKSPACES_ROOT`, o comportamento de sempre), `mounted` (o antigo
  `local`, renomeado — uma pasta do USUÁRIO montada por bind-mount, caminho
  absoluto livre em `projects.workspace_path`) ou `runner` (uma pasta do
  USUÁRIO SEM bind-mount, confirmada por um CLI — `brabo-runner` — rodando na
  máquina dela, RN-423). Desde o ADR 0141 (RN-500), o bind-mount de `mounted`
  deixa de ser uma linha de compose POR PROJETO e passa a ser UMA base da
  INSTALAÇÃO — `BRABO_PROJECTS_BASE`, montada por IDENTIDADE (`$X:$X`) em `api`
  e `engine`, com todos os projetos montados morando dentro dela. Identidade e
  não mountpoint fixo porque `workspace_path` é digitado pelo usuário e mostrado
  de volta a ele, e é isso que faz `projectScopeRoot` e
  `Engine.Actions.Workspace.workspace_dir/2` continuarem certos sem código novo.
  Variável PRÓPRIA, NUNCA `PROJECT_WORKSPACES_HOST_DIR`: a raiz gerenciada é
  nomeada por `workspace_dir_name` (UNIQUE) e a base é nomeada pelo usuário, e
  apontar as duas para o mesmo lugar faria `init_from_bare!` dar `git init` na
  pasta de outro projeto. `baseDeProjetos()` NUNCA lança e AUSENTE é estado
  normal — `GET workspaces/:workspaceId/projects-base` (`maintainer`) devolve
  `projectsBase: null`, e é assim que a criação aprende a NÃO oferecer o modo —
  o que desde a RN-513 (ADR 0146 ponto 4) é VERDADE no cliente, e não mais
  intenção sem chamador: o assistente consulta a rota ao MONTAR (não no quinto
  passo), só oferece `mounted` com a base CONHECIDA e presente — carregando ou
  consulta FALHADA não viram oferta, "não sei" nunca vira "tem" —, e com base
  ele PRÉ-SELECIONA o modo sugerindo `<base>/<slug>`, sem jamais sobrescrever
  escolha humana nem caminho digitado. Desde a RN-573 (ADR 0161) a
  pré-seleção exige TAMBÉM o broker CONFIRMADO (`brokerConfigurado`, na MESMA
  rota): base não é broker, e `container`/`mounted` só sobem container por ele
  (ADR 0144). Ausência CONFIRMADA deixa os dois cards NA TELA mas inertes, com
  o motivo UMA vez em texto, e pré-seleciona `runner`; broker DESCONHECIDO não
  pré-seleciona `mounted` e também não trava nada nem afirma ausência — são
  três estados, não dois.
  A base NÃO entra em `caminhoDeWorkspaceLocalValido` (que roda em toda LEITURA
  e faria projeto montado legado explodir ao ser lido): é regra de criação e
  conversão. E `pnpm dev` RECUSA subir com a base sobreposta ao checkout do
  Brabo, nos dois sentidos — checagem que só o preflight pode fazer, porque a
  api compara contra `process.cwd()` (`/workspace` dentro do container dela) e
  nunca enxerga o checkout real. O par (modo, caminho) é amarrado por CHECK no banco
  (`execution_mode <> 'container'`), e `projectScopeRoot` continua sendo a
  derivação ÚNICA da raiz — não duplique validação nos chamadores. Desde a
  RN-501 (ADR 0142), `mounted` e `runner` validam na criação a MESMA coisa: só
  o LÉXICO, sem I/O (absoluto, sem `..`, nunca raiz/pasta de sistema nem
  sobreposto ao checkout do Brabo — RN-422/RN-423/histórico RN-170), com
  `mounted` acrescentando estar dentro de `BRABO_PROJECTS_BASE`. Os DOIS
  nascem `workspaceVerifiedAt: null`, e a diferença entre eles é QUANDO/QUEM
  confirma o disco: no `runner` é o CLI conectando (sobrescrevendo o que foi
  digitado); no `mounted` é `materializarWorkspaceMontado` — `mkdir -p` mais
  as três perguntas de disco —, chamada por `ExecuteContainerStartUseCase`
  quando a Infra sobe o container (o requisito "após a decisão do Arquiteto"
  cumprido literalmente; falha vira `failed` NOMEADO e o ciclo de vida NÃO
  chega a `provisioning`) e, como EXCEÇÃO declarada, pela conversão de modo,
  que não tem passo de container onde pendurar o trabalho e move o
  `permissions.json` para dentro da pasta. Adiar a VERIFICAÇÃO não toca o
  invariante de PAREAMENTO: `mounted` segue gravando `workspace_path`
  não-nulo e o CHECK fica intacto, sem migration. O portão da imagem
  (RN-105) VALE para os TRÊS modos desde a RN-494/ADR 0135 — projeto
  `mounted`/`runner` sem `artifact.project_image` decidido também responde
  409 na aba Code; a dispensa antiga foi REVOGADA, não é mais o
  comportamento. Desde o ADR 0144 (RN-503), `mounted` SOBE container no
  SERVIDOR, pelo BROKER — a base única do ADR 0141 tornou a pasta alcançável
  pelo daemon, e a recusa antiga era sobre GEOMETRIA, não sobre o nome do
  modo. A ramificação de `container_start`/`_stop`/`_remove` passa a ser por
  DESTINO: `container` e `mounted` → broker, `runner` → runner (as três mudam
  JUNTAS; subir no servidor e parar na máquina do usuário deixaria de pé, sem
  forma de parar, o que está de pé). `runner` continua sem container PRÓPRIO
  no SERVIDOR — quem sobe container pra ele é o `brabo-runner`, na máquina do
  USUÁRIO, com o Docker dela (ADR 0137, RN-497). Consequência declarada no
  ADR: a contenção estrutural do `join` some para esses projetos, e o vetor
  de symlink do ADR 0055 continua aberto. No LINUX, o próprio CLI
  `brabo-runner` recusa `--dir` fora do
  `$HOME` do usuário (RN-434, ADR 0104) — checagem de startup do processo
  local, não a fronteira de segurança (essa continua sendo autenticação +
  pipeline de aprovação, ver `apps/runner/src/guard.ts`); fora do Linux a
  restrição não se aplica.
  Desde a RN-515 (ADR 0147 ponto 4), `mounted` e `runner` podem ainda declarar
  um DESTINO DE ESPELHO — `projects.mirror_path`/`mirrorPath`, por
  `PUT projects/:projectId/mirror-path` (`maintainer`) —, a pasta da máquina do
  usuário FORA da base para onde o agente local copia o trabalho. É por
  PROJETO e nunca global (destino global aterrissaria o artefato do projeto B
  na pasta do A, descoberto pelo conteúdo e não por um erro), `null` é o estado
  NORMAL, e limpar é `null` EXPLÍCITO — a chave é obrigatória, senão omitir o
  campo limparia em silêncio. `container` é RECUSADO com motivo (a origem é um
  volume do SERVIDOR e quem copiaria está na máquina do usuário), e converter o
  modo ZERA o destino. A api valida SÓ o LÉXICO e DIZ isso, reusando
  `caminhoDeWorkspaceLocalValido` — NÃO escreva uma quarta cópia da régua —
  mais os DOIS sentidos do laço origem↔destino, por SEGMENTO e nunca
  `startsWith`. A metade `realpath` da guarda é do RUNNER
  (`apps/runner/src/espelho-guard.ts`, RN-516): a api impediu o laço ESCRITO,
  nunca o construído por symlink, e o comentário no código diz isso.
  A escrita do espelho NÃO é `proposed_action` — é configuração declarada pelo
  usuário, não agente pedindo para agir.
  Desde a RN-516 (ADR 0147 pontos 2/3/4/8) o espelho EXISTE, e três coisas
  dele são regra: o destino viaja SÓ na concessão do `join` e o runner recusa
  `mirror_sync` para destino não concedido NAQUELA conexão (trocar o destino
  com runner de pé exige reconectá-lo, e destino declarado passa a EXIGIR a
  capacidade `espelho`, recusando binário velho no join); a cópia é numa
  direção e NUNCA apaga — arquivo apagado na origem PERMANECE no destino, que
  é acúmulo e não réplica —, e o que se copia é a LISTA DO GIT (rastreados +
  não-rastreados-não-ignorados), com git que falha virando erro NOMEADO e
  nunca um `cp -r` de plano B; e o gatilho é MOMENTO NOMEADO do engine (hoje
  o commit), NUNCA um watcher, que seria trabalho ilimitado disparado até
  pelas escritas do próprio espelho. O predicado do espelho é PRÓPRIO
  (`Engine.Runners.Espelho`, DUAS pré-condições) — `RunnerReadiness` fica
  byte a byte como está e NUNCA ganha flag "pula container": é por essa flag
  que a terceira pré-condição do ADR 0145 cairia por acidente para o `exec`.
- A imagem de container de um projeto é ARTEFATO — `artifact.project_image`,
  versionado, sem tabela, nunca configuração escondida —, e desde o ADR 0133
  (RN-491) tem DOIS emissores possíveis, distinguidos por `decidedBy`: o
  ARQUITETO decidindo do zero (`choose_project_image`, `'arquiteto'`) e a
  INFRA elegendo entre as candidatas do próprio roteamento do Arquiteto
  (`container_start`, `'infra-lead'`) — nunca um caminho paralelo, os dois
  passam por `DecidirImagemDoProjetoUseCase`/`validarDecisaoDeImagem`.
  Os RECURSOS que a Infra sobe vêm do `module_map` desde a RN-683 (ADR 0199):
  cada módulo declara `resources` e o mínimo é a SOMA (um container por
  projeto), com piso no padrão de hoje enquanto houver módulo sem declaração —
  nunca um número inventado, nunca o máximo entre módulos. Quem deriva é a
  api (`recursos-minimos.ts`); o engine manda `resources` vazio e não soma.
  Enquanto NENHUM dos dois decide, a aba Code responde 409 (RN-105) — nos
  TRÊS modos de execução desde a RN-494/ADR 0135, que revogou a dispensa
  que `mounted`/`runner` tinham (RN-169/RN-421). `mounted`/`runner`
  continuam sem subir container PRÓPRIO no SERVIDOR — quem sobe pra eles é
  o `brabo-runner`, na máquina do usuário (ADR 0137, RN-497). O que mudou
  aqui foi só a exigência de alguém ter decidido a imagem antes de abrir a
  leitura.
  Deploy e `sudo`/`doas` NÃO saem pelo terminal sem aprovação — a regra é
  `require_approval` INCONDICIONAL (teto absoluto, revisado de `deny` pela
  RN-418/ADR 0102: nunca auto-aprovável, mesmo dentro do escopo do projeto,
  mesmo com auto mode ligado, mesmo com "sempre permitir", que foi fechado na
  fonte). `git push` e abertura de PR seguem a mesma régua, EXCETO com o modo
  automático do agente ligado (a curinga em `auto_approve`), que os
  auto-aprova pelas duas portas — o terminal e as ações TIPADAS
  `git_push`/`pr_open` (RN-713, ADR 0204, revisando a RN-689); "sempre
  permitir" continua fechado na fonte para eles, e merge em branch protegida
  segue sempre manual. O ciclo de vida do container tem
  TABELA de estado desde a Onda 4/frente F1 do PROGRAMA 28
  (`project_containers`, ADR 0081, RN-243..248) — e quem ESCREVE nela, desde o
  ADR 0130/0133, PODE chamar Docker de verdade: `container_start`
  (`proposed_action`, `maintainer`, RN-491) é o primeiro chamador real de
  `ContainerBrokerPort.start`, e transiciona `provisioning → running` pela
  máquina de estados. Desde o ADR 0136 (RN-495), `container_stop`
  (mesmo calibre de `container_start`) e `container_remove` (o mais
  destrutivo — no MESMO teto absoluto de git push/comando privilegiado,
  nunca auto-aprovável) também são `proposed_action`, propostas pela
  página global de containers (`/containers`) — sempre um humano, nunca um
  agente. Desde a RN-521 essa página também SOBE container, e é o único
  caminho humano para isso: ela lista TODO projeto do workspace (`registrado:
  null` é o TERCEIRO estado, "nunca provisionado", e nunca gasta verificação
  do broker) e ramifica por `execution_mode` — `container`/`mounted` propõem
  `container_start`, `runner` propõe `container_start_via_runner`, cada um com
  o payload que o schema dele aceita. Ela RECUSA localmente (botão inerte, com
  o motivo em TEXTO) em `container`/`mounted` numa instalação SEM broker
  (`sem_broker_na_instalacao`, RN-574 — antes da imagem, e `!== true`: "não
  sei" não vira "tem"), sem imagem decidida, em `runner` sem pasta jamais
  confirmada, e para papel abaixo de `maintainer` — o mínimo do ENDPOINT, por
  `roleAtLeast`. Desde a RN-566 o AGENTE também ramifica por modo antes de
  propor: as duas tools do Infra Lead passam por `recusa_local_de_subida/2`
  (`infra_lead_server.ex`), que lê o projeto UMA vez e recusa com motivo
  NOMEADO — a MESMA ramificação por DESTINO, nunca uma segunda régua. Desde
  a RN-610 ele recusa também container já de pé (as duas tools) e, em
  `runner`, imagem não decidida e pasta nunca confirmada; o que ele NÃO
  checa, e a tela checa, é imagem decidida em `container`/`mounted` (eleger
  é o que a proposta faz) e broker/papel/sessão.
  A política de terminal do ADR 0055 (escopo de caminho, allowlist
  estreito) segue valendo como está — mas ela não decide mais ONDE o comando
  roda quando NÃO há container: desde o ADR 0143 (RN-502), `container` e
  `mounted` SEM um `running` registrado RECUSAM (`:recusar_container_ausente`,
  `failed_result` nomeado), em vez de cair no `System.cmd` dentro do processo
  do engine. Desde a RN-507 (ADR 0145), `runner` entrou na MESMA régua —
  workspace verificado e runner conectado deixaram de bastar; sem container
  `running` REGISTRADO (a mesma leitura de `ProjectContainerLifecycle`,
  centralizada em `Engine.Runners.RunnerReadiness`), o comando recusa em vez
  de atravessar pro canal e arriscar cair no HOST puro do usuário — o
  fallback silencioso que essa RN fecha. O catch-all `:caminho_de_sempre` do
  `TerminalExecutor` encolheu para projeto inexistente/id malformado —
  nenhum modo de execução cai nele. Com um `running` registrado, o comando
  de terminal
  passa a rodar DENTRO do container de verdade (`ContainerBrokerPort.exec`,
  ADR 0134, RN-492) e ganha um PISO de auto-aprovação por cima do escopo
  léxico — não no lugar dele (RN-493). Esse PISO é ESPECÍFICO de
  `execution_mode: container` (`ProposeActionUseCase` só o calcula quando
  `project.executionMode === 'container'`): projeto `mounted`/`runner` com
  um container REAL de pé pelo `brabo-runner` (ADR 0137, RN-497) continua
  sob a política de terminal de sempre, sem piso — a decisão host-vs-container
  ali é INTERNA ao runner, o engine não sabe dela, e `decide()` nunca viu
  motivo pra tratar os dois casos como o mesmo. O que a
  leitura ganhou primeiro (ADR 0130) foi o estado OBSERVADO ao lado do
  registrado, perguntado ao broker — os dois nunca se fundem, e "não
  consegui olhar" tem motivo próprio em vez de herdar o registrado (RN-486).
- O diagrama C4 (Context + Container) também é ARTEFATO do ARQUITETO
  (`artifact.c4_diagram`, versionado, sem tabela — RN-149, ADR 0068),
  mesmo desenho do `artifact.project_image`. O Container level é DERIVADO
  do `module_map` vigente pelo caso de uso, nunca redigitado pelo modelo
  na ferramenta `create_c4_diagram` — só o Context (nome do sistema e
  atores externos) vem do tool call.
- O CONTRATO entre módulos também é artefato do ARQUITETO
  (`artifact.module_contracts`, versionado, sem tabela, o vigente substitui —
  RN-684, ADR 0200), e é SEPARADO do `module_map` de propósito: não o
  transforme em campo do mapa. Por módulo ele diz só o que o módulo EXPÕE; o
  que ele consome é o `dependsOn` do mapa, derivado na leitura. O dev agent o
  lê por `listar_contratos_de_modulos` (sem parâmetro, `ctx.module`), e o
  kickoff dele diz que a interface de outro módulo NÃO se lê no worktree alheio.
- `decision_record` é o outro polo do mesmo espectro: reusa o padrão
  GENÉRICO de `emit_artifact`/`ArtifactSchemas` (o de `note`/
  `business_rule`) em vez do dedicado de `project_image`/`c4_diagram` —
  uma decisão é log append-only, nunca um "vigente" que se substitui
  (RN-505). Seis dos SETE conversacionais (Criativo, PO, Arquiteto, Dev
  Lead, UX Designer, Staff — o Infra Lead não tem `emit_artifact`) podem
  emitir; distinto de `open_adr_pr` (só o
  Arquiteto, commit real em `docs/adr/*.md` + PR + aprovação humana) —
  os dois COEXISTEM, para escalas diferentes de decisão, nunca um
  substituindo o outro.
