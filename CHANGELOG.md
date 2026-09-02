# Changelog

Gerado dos conventional commits por `scripts/changelog.mjs`.

## Unreleased

### Novidades

- **web**: configurar o runner local pelo navegador passa a começar pela
  **pasta**. A ordem era `chave → registro → binário → pasta`, e o download do
  binário — o único passo que depende de uma release publicada no GitHub — vinha
  ANTES do seletor de pastas. Com a release atual sem asset para nenhuma
  plataforma, esse passo devolve 502, a exceção subia, e o seletor **nunca
  chegava a abrir**: o botão parecia não fazer nada, e a pasta ficava
  inalcançável. Agora `showDirectoryPicker` é a primeira linha (o que também é
  mais correto do lado do navegador, que exige ativação transitória do usuário e
  não sobrevive a três `await` de rede antes dela), e o binário é o **último**
  passo e **best-effort**: quando ele falha, os dois arquivos de que o runner
  realmente precisa — `brabo-runner.config.json` e a chave de dispositivo — já
  estão gravados na pasta escolhida, a tela **diz o motivo** e a instrução final
  troca para o caminho de distribuição alternativo (`npm install -g
  @brabo/runner && brabo-runner`, que roda sem flag nenhuma porque lê a config
  do `cwd`). Antes, uma falha ali descartava tudo, inclusive a escolha da pasta.
  O fallback fora do Chromium ganhou a mesma régua: o **kit** (configuração +
  chave privada) é baixado primeiro, e a falha do binário não impede mais que
  ele saia. Cancelar o seletor voltou a ser o que é — mudar de ideia, não erro:
  nada é registrado e o botão fica pronto de novo, sem alerta vermelho. O passo
  do terminal continua **humano e declarado**: uma página web não executa
  binário na máquina de ninguém, e a File System Access API não preserva o bit
  de execução — o que dá para fazer é encolhê-lo a UMA linha copiável em um
  clique, e é isso que a tela faz (RN-473)
- **web**: depois da instrução, a tela **espera o runner aparecer** em vez de
  deixar a pessoa adivinhar se deu certo. O sinal é o que já existia —
  `workspaceVerifiedAt`, o carimbo que o `ConfirmProjectWorkspaceUseCase` grava
  quando o runner conecta e que o engine usa como portão —, e quando ele chega a
  tela mostra o **caminho que o runner reportou**, que é o que passa a valer
  (ele sobrescreve o que foi digitado). São **três estados que não colapsam**:
  procurando, conectado e sem resposta. E a espera **não é eterna**: para em 3
  minutos dizendo o que faz falta e o que ela **não** sabe — reconectar com uma
  pasta já confirmada não regrava o carimbo, então ausência aqui não é prova de
  ausência, e quem sabe do agora é a aba **Código**. Um botão recomeça a busca
  sem refazer a configuração (RN-474)
- **web**: em **Configurações**, a coluna **Origem** de **Modelos por agente**
  deixa de imprimir o enum cru do banco (`agent`, `workspace`, em inglês) e
  passa a mostrar a **cascata inteira como cadeia**: `workspace › projeto ›
  área › agente`, com o nível vigente destacado. Não é tradução — é uma
  distinção que a tela não fazia. `agent` significava **duas coisas
  diferentes**: o agente tem modelo próprio, ou ninguém escolheu nada e o
  produto herdou o do **Criativo** (o agente de start, para não deixar uma
  sessão nova nascer no modelo local pequeno do workspace). Num projeto com
  três linhas de agente no banco, os doze agentes mostravam a mesma palavra. Na
  cadeia os dois casos são visivelmente diferentes: no primeiro o nó `agente` é
  o vigente; no segundo ele fica **vazio**, o `workspace` aparece como
  "tem valor, mas perdeu" — porque o modelo do workspace **não** é o que vale —
  e um nó extra `↳ Criativo` fecha a cadeia. Cada nó tem `title` dizendo o
  modelo daquele nível. **A api não mudou**: `origin: 'agent'` está certo (o
  valor veio mesmo de um agente), e o cliente deduz o resto do que já tinha em
  mãos, sem endpoint novo. Um caso não é dedutível — agente com modelo próprio
  igual ao do Criativo, sem padrão de área nem de projeto — e é por isso que
  "voltar a herdar" continua aparecendo em toda origem `agent`: a ação segue
  disponível justamente onde a cadeia não prova, e nele ela ainda muda o futuro.
  O aviso de **nível descartado** (modelo que sumiu do provider, ou que não faz
  tool calling) era um segundo badge ao lado da origem, competindo com ela;
  virou um nó **riscado dentro da cadeia**. **Modelo por área** ganhou a mesma
  cadeia no lugar do enum — e ali `agent` só podia ser o Criativo, o que a tela
  agora diz em vez de exibir a palavra "agente" no cartão de uma área. Por fim,
  os **três `—`** dessas duas seções diziam três coisas com o mesmo símbolo e
  passam a dizer cada uma a sua: `sem modelo em nenhum nível`, `sem gasto ainda`
  (diferente de `US$ 0,00`, que é ter rodado de graça) e `sem padrão em nenhum
  nível` (RN-470)
- **web**: em **Configurações**, **Paralelismo por área** e **Teto de gasto por
  área** passam a ter **um botão de salvar da seção**, no lugar de um botão por
  linha. Revisar o teto de dev quase nunca é revisar só o de dev, e N botões
  idênticos pediam N cliques para uma decisão só. Em troca a seção passa a dever
  duas coisas. A primeira é **dizer quantas linhas estão pendentes** — "2
  alterações não salvas nesta seção", ao lado do botão: até aqui a única pista
  de trabalho não salvo em toda a aba era o botão desabilitado do Modo de
  execução, um sinal por negação que some justamente quando passa a haver algo a
  salvar. "Sujo" é comparação por **valor**, não por texto: voltar o campo a
  `20.0` onde o servidor tem `20` limpa a marca em vez de mandar uma chamada que
  a api trata como no-op. Valor inválido **substitui** a contagem pela mensagem
  que explica o bloqueio, em vez de somar um segundo número sobre o mesmo
  conjunto. A segunda é **não mentir sobre o desfecho**: salvar a seção são N
  chamadas (uma por área — não existe endpoint transacional e nenhum foi
  inventado), em série, na ordem da tela, e **uma falha não interrompe as
  seguintes**. Só o rascunho que a api confirmou é descartado; o que falhou fica
  no campo com o que você digitou, a seção continua marcada por ele, e clicar
  Salvar de novo tenta **só** as linhas que faltaram. Os três desfechos são
  distintos: todas passaram → sucesso; nenhuma passou → a mensagem que a API
  deu, como antes; algumas passaram → aviso que diz **quantas de quantas** e
  **nomeia** as que ficaram — "salvo" e "não salvo" seriam as duas mentira aí
  (RN-469). **Três seções ficaram de fora, e por motivos diferentes**: Promoção
  de história, Modelos por agente e Modelo por área salvam no `onChange` **de
  propósito** e continuam assim (a confirmação existe para campo digitado, onde
  salvar a cada tecla mandaria `1` a caminho de `12`; escolher de uma lista de
  valores nomeados não precisa dela). E **Credenciais** mantém o botão por
  linha apesar de parecer o mesmo problema: a chave é write-only e nunca volta
  do servidor, então não há valor com que comparar para decidir "sujo"; o botão
  alterna entre "Salvar" e "Trocar" conforme o provider já tenha chave, o que um
  botão só não diz; e ele divide o card com "Testar" e "Remover", que agem sobre
  aquele provider
- **web**: a tela de **login** deixa de ser um card de 412px sozinho no meio
  da tela e passa a ter **duas colunas**: identidade e ambiente à esquerda, o
  formulário à direita. À esquerda, sob a marca, uma frase do que o Brabo é e
  um bloco **Ambiente** com o estado da **api** e do **engine** — os dois
  `/health` que já eram públicos nos dois serviços e que a página `/status` já
  consumia; nenhuma rota nova, nenhum campo novo no payload. Cada linha tem os
  **três estados separados** (`verificando…` num anel vazado, `respondendo` em
  verde, `sem resposta` em vermelho) e a sonda tem **teto de 6s**, para uma api
  que aceita a conexão e nunca responde não deixar a linha em "verificando…"
  para sempre. A **versão continua com uma fonte só**: ela segue no rodapé da
  página, não foi duplicada no bloco. E o **formulário nunca espera pela
  sonda** — o estado é local ao bloco, que é irmão do card, então a api fora do
  ar muda um texto e não atrasa nem esconde um pixel do login, que é
  exatamente o momento em que alguém mais precisa que a tela ao menos abra
  (dois testes cobrem os dois modos de falha: a sonda que rejeita e a que
  nunca volta). **Runner e modelos locais NÃO aparecem aqui, e a tela diz por
  quê**: presença de runner é chaveada por `{user_id, project_id}` e a lista
  de modelos é `projects/:projectId/models` com papel `viewer` — antes do
  login não existe nenhum dos dois sujeitos, e uma tela pré-identidade que
  simplesmente os omitisse deixaria o usuário achando que a plataforma não os
  tem. Só `/login` usa as duas colunas; as outras três telas de auth são
  passagens de um fluxo já iniciado e ficam como estavam. Abaixo de 900px de
  janela o modo se desfaz e volta a pilha de sempre. Nada na coluna nova é
  focável, de propósito: ela vem antes do card no DOM, e um botão ali roubaria
  a primeira parada de `Tab` do campo de e-mail
- **web**: a **Visão geral do projeto** ganha, no topo da coluna lateral, o
  bloco **Ambiente** — a metade dos sinais que só é verdade depois do login.
  Ele diz **onde o código roda** (container gerenciado, pasta montada ou pasta
  na sua máquina, com o caminho), quantos **modelos locais do Ollama** estão
  ativos no workspace, e — só em projeto no modo `runner` — o estado do
  **runner**. Esse último é o ponto: o dado é `workspaceVerifiedAt`, o carimbo
  que o runner grava ao conectar e confirmar a pasta, e ele **não é
  batimento**. A tela diz "pasta confirmada em `<data>`" com a ressalva de que
  isso é o registro da confirmação e não um sinal de que o runner está rodando
  agora — nunca "de pé", nunca "online", nunca bolinha verde. São duas razões
  independentes: não há processo sendo observado, e reconectar reportando o
  mesmo caminho nem regrava o carimbo, então nem a data é recência. Quem sabe
  do agora é o socket do terminal, na aba Código, e a ressalva aponta para lá.
  Nos modos `container`/`mounted` a linha do runner nem existe: o campo é nulo
  por definição, e "nunca confirmada" ali seria uma ausência inventada.
  **Nenhuma requisição a mais**: as duas consultas reusam as chaves que a
  página já busca (`['project', id]` e `['models', id]`), então saem do cache
- **web**: em **Configurações**, "este ajuste não tem valor próprio" passa a
  ser dito de UM jeito só. Eram quatro: `"Sem valor próprio — usa o default
  (3)"` na Execução, `"Sem teto"` como placeholder no Teto de gasto por área,
  `"voltar a herdar"` em Modelos por agente e `"Voltar a herdar"` em Modelo
  por área — quatro redações, quatro chaves de tradução independentes, e nada
  impedindo a quinta seção de inventar a quinta. Agora há **dois polos e um
  verbo**, de uma fonte só: **"Sem valor próprio"**, **"Valor próprio"** e
  **"Voltar a herdar"**. O rótulo diz o ESTADO e o detalhe ao lado diz a
  CONSEQUÊNCIA — "usa o default (3)", "sem teto" —, que é o que de fato muda
  de seção para seção: o circuit breaker cai numa constante do produto, o teto
  de gasto simplesmente não existe, e o modelo cai na cascata `workspace →
  project → area → agent → session`. **Nenhum rótulo diz "Herdado"** de
  propósito: nos dois primeiros isso afirmaria uma cascata que não existe (o
  teto de gasto é ADITIVO aos budgets de projeto e sessão, nunca herdado
  deles). O que se unificou é o VOCABULÁRIO, não a forma: a marca só entra
  onde o controle não mostra o estado sozinho — o campo da Execução vem
  pré-preenchido com o default e portanto não distingue nada —, e a tabela de
  Modelos por agente consome só o verbo, porque a coluna **Origem** já é a
  marca de estado daquela linha. No Teto de gasto por área o placeholder
  deixou de ser o único enunciado do estado (ele some assim que alguém digita,
  não se lê sem olhar dentro do campo, e não tem como dizer o polo positivo
  "esta área TEM teto próprio") e ficou só com o trabalho de texto-fantasma.
  O verbo aparece nos dois registros tipográficos que a aba usa — botão na
  seção de área, link discreto em mono na célula da tabela — derivados da
  MESMA chave, e não de duas. Nenhum ajuste mudou de comportamento: nada
  salva, herda ou reverte diferente
- **web**: a aba **Configurações** ganha um **sumário ancorado**. Ela sempre
  teve 17 seções numa rolagem só, e nenhum mapa: sem índice, sem âncora, sem
  nenhum sinal de onde se está — quem procurava "Teto de gasto por área"
  rolava até achar. Agora um sumário lista as seções agrupadas em quatro
  blocos (**projeto e execução**, **modelos**, **pessoas e acesso**,
  **avançado**), clicar leva à seção, e a entrada da seção em que você está
  fica marcada enquanto você rola (`IntersectionObserver` sobre a faixa
  superior da área visível). Os grupos são uma LEITURA da ordem que a aba já
  tinha — os quatro caem contíguos sobre ela e nenhuma seção mudou de lugar,
  o que um teste fixa. **O sumário não cria uma quarta faixa de moldura**: ele
  mora DENTRO da área de conteúdo, repartindo os 1040px que ela já tinha, e a
  moldura à esquerda continua exatamente nos 444px medidos (sidebar 264 +
  trilho do projeto 180) que o ADR 0126 deixou — uma coluna por fora custaria
  mais 208px antes do conteúdo, e esse preço já foi pago uma vez na aba
  Código. Abaixo de 1200px de janela o sumário não some: ele deita numa faixa
  horizontal acima das seções. **Só aparece o que está na tela**: sete das 17
  seções não montam em condição normal (sem repositório provisionado, sem
  papel de `owner` — RN-060, sem catálogo), e a entrada correspondente não
  existe — um mapa que aponta para uma sala fechada é pior que nenhum mapa.
  Toda seção virou um `<section>` com `id` e nome acessível (uma `region` para
  leitor de tela, com o mesmo título que a tela mostra), e a URL passou a
  aceitar `?section=` — `?section=budget` abre Configurações já na seção, e
  `?section=` sozinho abre Configurações em vez de cair calado na Visão geral.
  A rolagem é INSTANTÂNEA, como a de um link de âncora, e isso foi medido:
  dentro do container desta aba a rolagem suave é cancelada pelo próprio
  polling da página e o `scrollTop` fica onde estava
- **web**: um chip **"Precisa de você"** no topo do projeto abre um painel com
  as CINCO filas de decisão num lugar só (RN-467). O que faltava não era mais
  um número: as cinco já tinham contador próprio no trilho, e quem abria o
  projeto via cinco números espalhados por cinco abas e nenhuma frase dizendo o
  que espera por ele. O painel lista as cinco SEPARADAS — cabeçalho e total por
  fila, na ordem de urgência (aprovações, merges de PR, promoções de história,
  pendências de arquitetura, hipóteses do Psicólogo) e, dentro de cada uma,
  quem espera há mais tempo primeiro. **Nada é somado**: nem entre filas, nem
  no chip, que anuncia PRESENÇA com um ponto e nunca uma quantidade — somar
  apagaria qual fila está pedindo atenção, a mesma decisão que já mantinha os
  contadores do trilho separados (ADR 0126). Aprovações e merges são
  DECIDÍVEIS ali mesmo, pelo `ApprovalCard` com `variant="queue"` que a aba
  de PRs já usava fora do chat; promoções, arquitetura e hipóteses levam à aba
  onde a decisão mora. O painel é atalho para a decisão, **nunca substituto**:
  os botões chamam os mesmos endpoints, e o teto de merge em branch protegida
  (`decide.ts`, `require_approval` incondicional) continua valendo inteiro —
  "Modo automático" nem aparece aqui, porque ligar autonomia é mudar política,
  não decidir a ação da frente. Zero requisição a mais: as cinco consultas já
  rodavam para os contadores, e o painel lê o mesmo cache. A pendência de
  arquitetura **não tem data nenhuma** (`ArchitecturePendency` é visão
  derivada, nunca gravada): ela EMPRESTA a data da história relacionada e a
  tela diz que emprestou ("história atualizada há 18 min"); sem a história
  carregada, mostra "sem data" e vai para o fim da fila — em nenhum caso um
  instante inventado. A gramática visual vem do `NotificationBell`, mas a
  mecânica é nova porque lá não existia: `role="dialog"`/`aria-modal` com
  rótulo, `aria-expanded` no chip, foco levado ao painel e devolvido ao chip,
  `Tab` preso dentro dele, `Esc` e clique-fora fechando
- **web**: a navegação do projeto vira um TRILHO VERTICAL à esquerda do
  painel, e a régua horizontal de dois níveis sai (ADR 0126). O motivo é um
  só: 12 abas em 3 grupos não cabem numa barra desenhada para meia dúzia de
  itens — agrupar comprava espaço ESCONDENDO 9 das 12 atrás de um clique, e
  em janela estreita a linha de topo já rolava na horizontal. Os TRÊS grupos
  ficam abertos ao mesmo tempo: é isso que a mudança compra, e é por isso que
  o grupo deixou de ser botão selecionável para virar CABEÇALHO. Os cinco
  contadores (Insights, PRs, Aprovações, Backlog, Arquitetura) continuam
  SEPARADOS e o grupo não soma mais nada — com as filhas todas visíveis a
  soma não teria o que resumir, e somar filas diferentes esconde qual delas
  pede atenção. A geometria é a do trilho da aba Código (`CodeShell`, o único
  trilho do repositório com estado ativo desenhado), não a da trilha da
  sidebar, que não tem item ativo nem teclado; a única divergência declarada
  é a largura (180px em vez de 48px, porque este carrega rótulo e cabeçalho,
  não ícone). A navegação por seta foi PORTADA, não descartada:
  `ArrowUp`/`ArrowDown`/`Home`/`End` com volta, agora sobre refs próprias em
  vez da correlação posicional por `[role="tab"]` que a régua antiga
  precisava usar. **A aba Código deixa de recolher a sidebar sozinha**
  (revisão da RN-201): com um trilho de projeto sempre presente, o
  auto-colapso poria a trilha de ícones do Shell encostada nele — dois
  trilhos verticais adjacentes, permanentes, na aba mais pesada do produto.
  O custo é real e está declarado: o Código passa a abrir com 492px de
  moldura à esquerda (sidebar 264 + trilho do projeto 180 + trilho do
  `CodeShell` 48), medidos no navegador, contra ~110px antes. O que se compra é que recolher volta a
  ser decisão do USUÁRIO — o colapso manual continua funcionando e continua
  persistido. `components/ui/GroupedTabs` é apagado com o teste dele;
  `components/ui/Tabs` FICA, sem chamador no app, porque é primitiva
  publicada do design system (`ds-bundle/components/primitivas/Tabs`) e uma
  peça de DS sem consumidor é estoque, não código morto
- **engine,api**: golden-set de regressão (ADR 0123) para o julgamento
  SEMÂNTICO do QA de Automação — o item que a própria ADR 0020 já deixava
  documentado como aberto: com modelo local, cruzar regra de negócio com
  teste fechou só na 10ª de 11 rodadas. Seis casos rodam
  `Engine.Gates.QaAutomacaoAgent.run/5` isolado (mesmo padrão de
  `qa_automacao_agent_test.exs`), mas contra o cliente REAL de LLM —
  `apps/api/scripts/seed-golden-set-qa.ts` (chamado via `System.cmd`, novo
  neste repositório) provisiona projeto/sessão/binding de modelo reais e faz
  o próprio checkout do worktree. `mix test --only golden_set_qa` (ou `mix
  golden_set.qa`) roda deliberadamente, nunca em CI — excluído por tag
  PERMANENTE em `test_helper.exs`, não por detecção de Ollama disponível.
  Piso ratchet em `floor.json` (mesmo padrão de `coverage-floor.ts`), medido
  de verdade contra os dois modelos Ollama já puxados nesta sessão:
  `qwen2.5-coder:latest` fechou 1 a 4 dos 6 casos em quatro rodadas (o
  gargalo dominante foi o modelo chamar `terminal` com o argumento de
  comando vazio), contra `gpt-oss:20b` fechando 4-5/6 em duas rodadas
  (~4x mais lento por caso) — `gpt-oss:20b` é o modelo recomendado daqui
  pra frente para quem depende deste julgamento ser confiável. Wiring em
  CI segue `TODO(humano)`: falta segredo de LLM de API ou infra nova
  (runner com GPU, passo de pull do Ollama).
- **api**: `apps/api/src/db/schema.ts` deixa de ser um arquivo de 2 452 linhas
  com 51 tabelas e 34 enums — o mais alterado do repositório, e uma dívida já
  DECLARADA na tabela do `architecture.md`, cuja consequência escrita era
  "conflito garantido com mais de uma pessoa": toda mudança de schema, de
  qualquer área do produto, caía no mesmo arquivo. Agora são 16 arquivos sob
  `db/schema/`, um por AGREGADO de domínio, espelhando as pastas de
  `src/domain/*` em vez de inventar taxonomia — a que o arquivo já mantinha à
  mão nos comentários `// --- seção ---` (ADR 0121). O caminho antigo vira um
  barrel de `export *`, então os 144 módulos que importam de
  `db/schema` (46 em `src/`, 98 em `test/` e `scripts/`) não mudaram uma linha, o `import * as schema` do `drizzle-client.ts` enxerga o
  mesmo conjunto de exports e o `drizzle.config.ts` continua apontando pro
  barrel (o `drizzle-kit` segue a cadeia de `export *` — verificado, não
  suposto). Movimento PURAMENTE mecânico: nenhuma tabela, coluna, valor de
  enum, nome de índice ou expressão de CHECK mudou, e a barra de aceite foi o
  `db:generate` de diff ZERO — mais estrito que a suíte, porque o Drizzle
  compara o SQL inferido e pegaria até um `notNull` invertido. Enum mora com a
  tabela que o CHAMA, não com o assunto: FK entre arquivos é segura num ciclo
  (`.references()` é callback preguiçoso), enum entre arquivos não é (roda na
  avaliação do módulo), então `project_execution_mode`/`story_promotion` ficam
  em `iam.ts` com seu único consumidor e `failure_origin` em `backlog.ts` — o
  grafo de imports é um DAG. O `docs/.docmap.yml` ganha `schema/**` ao lado do
  barrel: sem isso a regra ficaria CEGA para constraint nova, que é exatamente
  o que ela existe pra vigiar.
- **docs**: `business-rules.md` deixa de ser uma página de 644 KB — as duas
  seções que sozinhas eram metade dela saem para arquivos próprios
  (`business-rules/custo.md` e `business-rules/autenticacao.md`), e o índice
  cai para 335 KB. Divisão por TAMANHO, não por assunto: nenhuma vírgula de
  conteúdo mudou e nenhuma âncora `{#rn-NNN}` mudou de nome — só o arquivo
  que as hospeda. Os 293 links que apontavam para as RNs movidas foram
  reescritos, incluindo os da tradução pt-BR, e o build do Docusaurus (que
  reprova âncora quebrada) passa nos dois idiomas. O `docs/.docmap.yml` ganha
  `docs_alternativos`, uma DISJUNÇÃO ao lado da conjunção que já existia: uma
  RN mora em um dos três arquivos, e cobrar os três ensinaria a usar o escape
  hatch — regra que ensina a ignorar check é pior que regra nenhuma.
- **docs**: o `docs:check` passa a conferir TRÊS famílias de número escrito em
  prosa, não só a de ADR: a contagem de RNs (fonte: os cabeçalhos `### RN-NNN`
  do `business-rules.md`) e a de providers de LLM (fonte: os literais
  `capabilities` que a tabela gerada de `llm-providers.md` já lê) entram na
  mesma aferição. O gatilho foi medido, não previsto: o README anunciava "as
  158 RNs" com 331 escritas — errado por mais do dobro, na tabela que
  apresenta o repositório —, e corrigir à mão só reinicia o relógio. Número
  que não bate REPROVA com o valor certo na mensagem; frase alterada reprova
  como `CEGO`, de propósito, porque check que parou de achar a frase fica
  verde para sempre dizendo que conferiu algo que não olhou.
- **ci,k8s**: as quatro imagens de produção passam a ser PUBLICADAS no GHCR
  a cada tag final (`ghcr.io/<dono>/brabo-{api,engine,web,backup}`, públicas),
  fechando a dívida declarada mais cara dos ADRs 0025/0027 — até aqui o
  `release.yml` construía com `push: false` só pra provar que a tag era
  construível, e o overlay de produção apontava pra `ghcr.io/OWNER/*` com um
  `newTag: REPLACE_WITH_DIGEST` que nenhum passo substituía (ADR 0119). O
  login usa o `GITHUB_TOKEN` do próprio job (`packages: write`): nenhum
  segredo novo pra rotacionar. O que cada tag publicou fica registrado POR
  DIGEST em `.release/images.json` — anexado à GitHub Release no mesmo
  instante da tag e versionado pela PR do CHANGELOG que o release já abria,
  SEM abrir uma terceira exceção de push direto. O overlay continua guardando
  o marcador, e `make imagens-do-release OVERLAY=prod|staging` aplica o digest
  com `kustomize edit set image` — quem faz o deploy decide qual release está
  em produção, não a tag. Achado no caminho: os overlays listavam TRÊS
  imagens, não quatro — o CronJob de backup herdava `brabo-backup:prod`, nome
  que não resolve em registry nenhum, então o backup do ambiente que mais
  precisa dele nunca subiria. Nada passa a fazer deploy sozinho: `DEPLOY_ENABLED`
  continua não existindo, e assinatura/atestação das imagens segue de fora,
  junto com o code-signing dos binários do runner.
- **api,web,runner**: configurar o `brabo-runner` na máquina do usuário
  deixa de exigir juntar id do projeto, caminho da pasta e um Personal
  Access Token à mão em três telas diferentes (RN-464..466, ADR 0118). O
  navegador gera um par de chaves Ed25519 (Web Crypto), registra a chave
  pública como uma nova `runner_device_keys`, baixa o binário certo
  (proxy da api para o asset já publicado em GitHub Releases, sem build
  nem cópia nova) e grava tudo já configurado numa pasta escolhida via
  File System Access API (Chrome/Edge/Opera) — fora do Chromium, cai para
  dois downloads comuns que o usuário move à mão. `POST .../runner-ticket`
  passa a aceitar essa chave de dispositivo (JWT EdDSA de vida curtíssima,
  ≤60s) como segunda forma de credencial, ADITIVA ao PAT — nunca o
  substitui, e nunca vira dual-auth com o JWT de sessão (RN-439 continua
  de pé). `--project`/`--dir`/`--token` do CLI ficam OPCIONAIS quando a
  pasta já tem a config local: `./brabo-runner` sem flag nenhuma passa a
  funcionar. Limitação aceita: o navegador não preserva o bit de execução,
  então `chmod +x` em Linux/macOS continua manual (mostrado pronto pra
  copiar). Corte de escopo explícito: o runner descobrir sozinho um
  container Docker/Kubernetes local e conectar por SSH foi considerado e
  REJEITADO nesta rodada — reabriria a FASE 25b, que segue cortada.
- **api,web**: Project/Workspace Settings ganha um navegador do Hugging
  Face Hub para puxar modelos GGUF para dentro do Ollama local (RN-461..
  463, ADR 0115). Busca filtra para publishers OFICIAIS por padrão
  (allowlist curada à mão); incluir a comunidade exige ligar um toggle
  desligado por padrão, que mostra um aviso de segurança persistente
  enquanto ligado. Puxar um modelo exige DUAS etapas explícitas — pedir
  (`pending_confirmation`) e confirmar (dispara o download de verdade) —
  nunca um pull automático e silencioso; falha termina o pedido em
  `failed` com a origem declarada (infra/modelo), e sucesso ativa o
  modelo no catálogo só para o workspace que pediu.
- **scripts,docker**: o bootstrap de dev detecta um Ollama nativo já
  rodando na porta 11434 (mesmo default de uma instalação fora do
  Docker), pergunta uma ÚNICA vez se é para usar essa instância e grava a
  resposta em `.env` (`OLLAMA_MODE=host|container`) — nunca pergunta de
  novo depois disso (RN-461, ADR 0114). `ollama`/`ollama-model-loader`
  entram sob `profiles: ["local-llm"]` no compose, ligado/desligado em
  tempo de execução por `scripts/dev/perfil-ollama.sh` — inclusive em
  "Docker › Destroy", que agora derruba exatamente o que o `up`
  correspondente subiu, sem deixar container ou rede órfãos. Novo item de menu
  "Docker › Reconfigurar Ollama" esquece a decisão gravada, forçando a
  pergunta de novo na próxima subida.
- **scripts**: o menu `pnpm bootstrap` ganha a tecla `c` nas telas de
  execução (comando rodando ou já concluído) para copiar o comando real
  para a área de transferência via OSC 52, com o texto sempre também
  gravado no log como segunda via — não há como confirmar de dentro do
  bash que a transferência funcionou, então quem estiver num terminal sem
  suporte a OSC 52 ainda sai com o comando para copiar à mão.
- **engine,web**: a tela de Sessão ganha uma faixa de atividade do turno
  ACIMA do composer — narra em linguagem humana o que um agente
  conversacional (Criativo, PO, Arquiteto, Dev Lead, UX Designer, Staff)
  está fazendo ENQUANTO o turno roda (referência visual: a linha de status
  do Claude Code), com o texto sendo digitado e, ao chamar uma ferramenta,
  arquivando a narração corrente e mostrando "Fazendo X" (dicionário das
  19 ferramentas em `lib/narracao-de-ferramentas.ts`). O fio só recebe a
  bolha de resposta DEPOIS que o turno termina — a bolha de streaming
  antiga fica exclusiva do chat consultivo sem agente ativo (SSE). Os seis
  servers passam a rebroadcastar `tool.call` EFÊMERO (sem `args`, RN-096)
  pelo canal Phoenix; `Disclosure`s expandem o passo-a-passo, e
  `agruparNarracoesDoTurno` colapsa `agent.response` consecutivas do mesmo
  turno no histórico ("Passos do turno · N"), deixando só a última bolha
  intacta (RN-460). Achado no caminho: quatro dos seis servers
  (Arquiteto, Dev Lead, UX Designer, Staff) terminavam CALADOS no teto de
  iterações — agora emitem `toolloop.limit_reached`, mesmo evento do PO
  (RN-459)
- **ci**: toda branch cujo PR é mergeado passa a ser arquivada
  automaticamente (`.github/workflows/archive-merged-branch.yml`) — move
  de `refs/heads/<nome>` para `refs/archive/<nome>`, nunca apaga:
  histórico intacto, recuperável a qualquer momento. Exceções: `dev`,
  `qa`, `main` (aparecem como `head` de todo PR de promoção), `gh-pages`
  (deploy do site de docs, não é branch de feature) e branch de fork. A
  decisão (quem entra, quem fica de fora) mora em
  `scripts/ci/archive-branch.ts`, testado. Ver
  docs/explanation/branching-policy.md, seção "Merged branches get
  archived".
- **api,web**: anexar uma pasta LOCAL da própria máquina do usuário a um
  projeto como referência de leitura para os agentes (RN-455..457,
  ADR 0113) — sem o CLI `brabo-runner`, diferente de `execution_mode:
  runner`. O navegador lê o conteúdo dos arquivos (`File.text()`) e envia
  como texto puro; nenhum caminho de host atravessa a rede. `chunks.scope`
  ganha um quarto valor, `'local'`, reusando o pipeline de indexação/busca
  híbrida do Chat RAG já existente (ADR 0079/0080) em vez de um mecanismo
  paralelo. Botão "Anexar pasta local" na aba Chat RAG (`maintainer`);
  teto de arquivos/bytes REJEITA o upload inteiro em vez de truncar em
  silêncio; reanexar é o único mecanismo de resincronizar — nunca o
  "Reindexar agora" genérico.
- **scripts,api**: `Docker › Reset total` (`pnpm bootstrap`,
  `scripts/dev/reset-total.sh`) soma numa folha só o que antes era manual —
  rebuild das imagens, apagar o banco, subir até tudo saudável (`--wait`),
  migrar (api + engine) e semear — com tela de confirmação própria (exige
  digitar `RESET`). O seed ganhou um passo que ativa credencial de provider
  já salva em `.env`, reaproveitando as MESMAS variáveis `<PROVIDER>_TEST_KEY`
  que os smokes de LLM já usam; provider sem variável definida não entra,
  sem erro.
- **ci,k8s**: as GitHub Actions dos 15 workflows que o #408 deixou de fora
  passam de tag mutável para commit SHA — 49 `uses:`, com a versão preservada
  em comentário. O #408 pinou o `ci.yml` e o backlog registrou o item como
  fechado; o que sobrou em tag foi justamente onde há credencial:
  `release.yml` (empurra as quatro imagens no GHCR), `publish-runner.yml`
  (publica no npm), `tag-release.yml` (cria tag) e `docs-deploy.yml` (empurra
  na `gh-pages`). Tag é ponteiro que o dono da action move sem aviso, e quem a
  move executa código no runner que tem o checkout e os segredos daquele
  workflow. `scripts/ci/actions-pinadas.ts` (passo novo no job `lint`) reprova
  qualquer `uses:` fora de SHA e qualquer SHA sem o comentário de versão — que
  é obrigatório porque é a única coisa que diz a um humano, e ao Dependabot,
  que versão aquele hash é. Referência local (`./.github/...`) passa. Provado
  por mutação: devolver uma tag ao `backmerge-gate.yml` reprova com o arquivo e
  a linha na mensagem. `ollama/ollama:latest` sobrevivia num QUINTO lugar que a
  revisão não citou (`deploy/k8s/base/ollama/job-model-loader.yaml`), fora dos
  quatro composes que o #401 pinou — vai para `0.33.1`, a mesma versão. O
  mecanismo inteiro, que até aqui só existia em comentário de workflow, virou
  `docs/explanation/cadeia-de-suprimentos-do-ci.md`, com o que segue confiado
  na fé DECLARADO: sem Dependabot (os SHAs se atualizam à mão), sem
  proveniência das dependências npm, sem assinatura dos artefatos que
  publicamos, e imagem de terceiro presa por tag e não por digest.
- **e2e,ci**: a pirâmide de testes ganha a camada que faltava em cima — um
  E2E de NAVEGADOR (`e2e/`, Playwright, só chromium; ADR 0120). As três
  camadas de baixo eram fortes (142 specs na api, 126 no engine, componente a
  componente no web, mais o smoke HTTP das imagens de produção) e nenhuma
  exercitava um navegador — justamente onde os últimos bugs de cookie, CORS e
  socket apareceram, todos achados à mão. O que só existe aqui: o refresh em
  cookie `httpOnly` (garantia do BROWSER — em jsdom o cookie seria legível e a
  asserção passaria mentindo), o CSRF em origem cruzada `:8088`→`:3000` com
  preflight de verdade (o `main.ts` da api já registrava "teste não faz
  preflight"), a sessão que sobrevive ao reload (único jeito de provar que o
  access em memória foi RECONSTRUÍDO do cookie) e o ticket de uso único do
  socket da sessão (RN-108) num handshake real contra o engine, numa TERCEIRA
  origem. Roda contra o compose de PRODUÇÃO que o CI já sobe (`smoke.sh` com
  `SMOKE_KEEP_UP=1`) e no MESMO job `images`: as quatro imagens são a maior
  parte do relógio daquele job, e um job separado as reconstruiria para chegar
  ao mesmo stack. `e2e/` NÃO é membro do workspace — lockfile próprio, mesmo
  desenho do `website/` (ADR 0117), porque a árvore do Playwright não chega a
  imagem nenhuma e não tem o que fazer no `pnpm audit` do produto; da raiz é
  `pnpm e2e`, nunca `pnpm --filter`. Seletor é ESTRUTURAL e nunca texto (o
  idioma da interface é decisão do servidor), e a asserção é sobre MECANISMO e
  nunca sobre tela. Provado por mutação nos dois specs: senha errada deixa a
  autenticação vermelha, e apontar a asserção do socket para um caminho que
  não existe falha com "nenhum WebSocket foi aberto contra o engine". NÃO
  coberto, declarado: diferença entre navegadores, aprovação inline e
  streaming. Achado ao rodar de verdade, e que virou desenho: a suite tem
  ORÇAMENTO DE LOGIN. A api defende `/auth/login` com lockout progressivo por
  IP que responde com o MESMO 401 uniforme de senha errada — distinguir os
  dois diria ao atacante quando ele acertou o e-mail —, então repetir a suite
  dentro da janela de 15 minutos derruba o login e a falha passa a acusar
  justamente onde o defeito não está. O navegador entra UMA vez por execução
  (um projeto `setup` guarda o estado; só o spec de autenticação abre mão
  dele, porque provar login exige origem limpa), e a semeadura reconhece esse
  401 e diz o que provavelmente é. Afrouxar o teto do compose para a suite
  poder logar à vontade foi rejeitado: enfraqueceria o que está sendo testado
  para deixar o teste confortável.

- **runner**: o acesso a Docker passa a existir atrás de uma **porta** com
  exatamente **cinco operações** (`start`, `stop`, `remove`, `inspect`, `exec`),
  e **nada sobe container ainda** — este é o alicerce, não a feature. O que
  decidiu a implementação foi uma **prova de empacotamento** que **falhou**:
  `dockerode` foi instalado, importado, instanciado e exercitado (`ping()`) por
  uma flag de auto-teste rodada contra os artefatos de verdade — nunca por um
  `import` que o bundler pudesse apagar. O `tsup` passou (ele deixa
  `dependencies` como `require` externo, então `dockerode` nem entrava no
  bundle); o `bun build --compile` do binário standalone **reprovou**, com
  `Could not resolve: "../build/Release/cpufeatures.node"`. A cadeia é
  obrigatória e foi lida no código, não suposta: `docker-modem` faz
  `require('./ssh')` na primeira linha do módulo, `ssh2` pede `cpu-features`, e
  esse binding nativo opcional é envolvido por um `try/catch` que existe em
  **runtime** e não no **bundler**. Mesma classe do achado do ADR 0112 com
  `node-pty`, com a diferença que decide: lá o binding é essencial, aqui ele
  acelera um transporte **SSH que este runner nunca usa** (ele fala com o socket
  unix local). Então o runner usa `execFile('docker', …)`, e `dockerode` saiu do
  lockfile. Medido e **não** adotado, para ninguém refazer a investigação:
  `--external cpu-features` compila e funciona, ao custo de +1,7 MB por binário
  vezes cinco plataformas — é exatamente o workaround que a decisão excluía de
  antemão. **A contenção é o tipo, não a disciplina de quem chama**: não existe
  campo para `privileged` nem `cap_add`, a rede é a união `'none' | 'egress'`
  (então `network: host` não é uma frase que se possa dizer), e não há **lista**
  de mounts — há UMA pasta, com destino constante (`/work`) e um tipo de
  **marca** que só uma função de validação produz, recusando caminho relativo,
  `..`, NUL, a raiz do filesystem e as pastas de sistema. Nenhuma operação
  recebe id de container: todas derivam `brabo-<workspace_dir_name>` e resolvem
  filtrando por nome **e** pelo rótulo `brabo.managed=true` — homônimo sem o
  rótulo **recusa**, em vez de ler como ausente. Falha é **nomeada**: daemon
  fora e executável `docker` ausente são erros **diferentes** (instalar o Docker
  e subir o daemon são consertos diferentes — a lição da RN-475 um andar
  abaixo), e o erro de comando recusado **não** declara origem, porque escolher
  uma para "No such image" seria o diagnóstico por eliminação que o ADR 0020
  proíbe. Tamanhos medidos: `dist/index.cjs` 91 843 → 106 221 bytes, binário
  82 777 288 → 82 789 576 bytes — o crescimento é código, não dependência
  (ADR 0128)

### Correções

- **web, runner**: o **modo automático** do runner local — configurar a pasta
  pelo navegador e rodar `brabo-runner` sem flag nenhuma — **nunca funcionou**,
  desde que nasceu. O navegador gerava o par de chaves, registrava a metade
  pública no projeto e gravava a privada na pasta, mas **descartava o `id` que
  a api devolvia no registro** — nos dois caminhos, o automático e o kit
  manual. Esse `id` é o **`kid`** da JWK, e é o único vínculo entre o arquivo
  em disco e a chave pública guardada no servidor: sem ele, o CLI recusa a
  chave (ele só repassa `jwk.kid`, nunca inventa um id) e a api não teria como
  achar a pública para verificar a assinatura. O resultado era uma pasta com
  aparência de configurada, uma chave inerte no projeto, e o CLI caindo no
  modo manual sem dizer por quê. Agora o registro e a exportação da privada
  acontecem **numa função só**, com o `id` fluindo dentro dela — descartá-lo
  de novo exigiria apagar código, não esquecer uma linha. E o teste que
  deixou isso passar mudou de pergunta: ele afirmava que o arquivo tinha sido
  **aberto**, e passa a afirmar **o que foi escrito nele** (RN-475)
- **runner**: a recusa da chave de dispositivo **diz o que houve**. Um arquivo
  `brabo-runner-device-key.jwk.json` **presente e inválido** produzia
  exatamente a mesma saída de um arquivo **ausente** — o bloco de uso, que
  fala de `--project`/`--dir`/`--token` e não menciona o arquivo —, porque a
  leitura devolve `null` nos dois casos (de propósito: ela nunca lança, e a
  ausência é o caminho normal de quem usa flags). Quem tinha uma pasta
  configurada era mandado investigar a configuração, que estava certa. A
  leitura continua não lançando; o que mudou é que o CLI passa a **distinguir
  os quatro estados** (ausente, JSON inválido, sem `kid`, válida) e a imprimir
  a recusa **nomeada** — o arquivo, o motivo e as duas saídas (regravar a
  pasta pelo navegador, ou usar `--token` enquanto isso) — em vez do texto
  sobre flags. Ausente segue caindo no bloco de uso, que é a resposta certa
  para quem não configurou nada (RN-475)
- **api**: associar alguém a um projeto (`POST projects/:projectId/members`)
  passa a recusar com **403** os **dois movimentos de rebaixamento** que
  produziam estado sem volta. Um `maintainer` podia (1) rebaixar o **`owner` do
  workspace** a `viewer` num projeto — o dono perdia o próprio projeto, e
  restaurar exigia o `maintainer` que ele acabara de perder ali — e (2) **se
  rebaixar sem poder desfazer**, porque desfazer é a mesma rota, que pede
  `maintainer`. Agora: **ninguém rebaixa quem é `owner` do workspace** (lido de
  `workspace_members.role`, nunca de `workspaces.created_by`) e **ninguém
  rebaixa a si mesmo** (sem limiar; **subir** o próprio papel segue passando).
  A **sobreposição continua valendo nos dois sentidos** — restringir um
  `developer` de workspace a `viewer` num projeto sensível é capacidade
  deliberada e não foi tocada. As **três descrições de OpenAPI** que prometiam
  "the higher of this one and what the person already has" e "includes whoever
  inherits access from the workspace" passam a descrever o que o código faz.
  A tela ainda oferece o rebaixamento que a api recusa (ela não tem como
  calcular o primeiro teto), mas **a recusa aparece** no toast, com a frase da
  api — o gate do `Select` é PR à parte.
  Ver [ADR 0127](docs/adr/0127-tetos-de-rebaixamento-em-project-members.md) e
  RN-472.
- **web**: em **Configurações**, a seção **Membros e papéis** passa a
  **respeitar o papel de quem está olhando**, e suas duas ações caladas passam a
  ter desfecho. Ela não checava papel nenhum: **convidar**, **trocar o papel de
  alguém** e **remover** apareciam ativas para todo mundo, **`viewer`
  incluído**, e a api recusava com 403 — e duas delas nem diziam isso, porque
  não tinham tratamento de erro: a recusa virava silêncio na tela e ruído no
  console. Remover um membro em silêncio era o pior dos três, por ser ação
  consequente e sem volta pela tela. O mínimo **não** foi copiado da seção de
  modelos logo acima: **Modelos por agente** exige `developer` e as três ações
  daqui exigem `maintainer`, porque a régua é do **endpoint**, nunca da tela ao
  lado. E o papel usado é o **efetivo do projeto**, não o do workspace — o
  limite que a correção anterior tinha declarado. Não é uma lacuna nova nem uma
  segunda: é a **mesma**, vista da seção que tem como fechá-la, porque esta já
  busca a lista de membros do projeto e daí sai o papel de quem olha, composto
  exatamente como a api o compõe. Quem não pode editar **continua lendo tudo** —
  o papel de cada membro segue visível no seletor apagado —, e o motivo é dito
  **uma vez, em texto**, na legenda. A legenda também passa a dizer **duas
  coisas que a tela afirmava sem querer**: que o papel desta tabela **substitui**
  o do workspace neste projeto, **nos dois sentidos** (pôr `viewer` aqui rebaixa
  de verdade, inclusive quem é `owner` do workspace — o seletor não é uma
  sugestão inofensiva), e que quem alcança o projeto **só pelo workspace não
  aparece na lista**. **Convidar** manteve de propósito a dica fixa em vez da
  frase da api: ali o ID é digitado à mão, e o erro que se alcança de verdade
  responde `500`, cuja frase seria pior que a dica (RN-471)
- **web**: em **Configurações**, a tabela **Modelos por agente** passa a
  **respeitar o papel de quem está olhando**. Ela não checava papel nenhum: o
  seletor de modelo e o "voltar a herdar" de cada linha apareciam clicáveis para
  todo mundo, **`viewer` incluído**, e a api recusava com 403. Desde as
  correções acima esse 403 pelo menos vira mensagem — o que não bastava:
  oferecer um controle que só existe para ser recusado é a tela mentindo sobre o
  que a pessoa pode fazer. O mínimo **não** foi copiado da seção irmã logo
  abaixo: **Modelo por área** exige `maintainer` e **Modelos por agente** exige
  `developer`, porque o vínculo da área alcança o lead e todos os subagentes de
  uma vez e o do agente alcança um agente (RN-102). Copiar teria trocado o
  defeito pelo **inverso**, e o inverso é pior — oferecer o que será recusado ao
  menos termina numa mensagem, enquanto trancar quem podia editar é invisível
  para quem perdeu a capacidade. Quem não pode editar **continua vendo tudo**: o
  modelo vigente no gatilho, a cadeia de origem inteira e o próprio "voltar a
  herdar", que é o que diz que aquele agente divergiu — some o controle, nunca a
  informação. O motivo é dito **uma vez, em texto**, na legenda da seção, e não
  como dica em cada linha: dica de mouse em controle desabilitado não abre no
  Chromium, e explicação que não aparece é a mesma ausência com mais código. A
  comparação de papéis saiu das telas e virou `roleAtLeast` sobre a hierarquia
  que já existia — **Modelo por área** passou a usá-lo com o mesmo mínimo de
  antes. Nada disso é fronteira de segurança: quem recusa continua sendo a api
  (RN-102)
- **web**: em **Configurações**, o seletor de modelo de **Modelos por agente** e
  o de **Modelo por área** passam a abrir com o filtro **"aptos para agentes"
  já marcado**. O filtro existe desde a Fase 9c e **nenhuma tela o ligava** — o
  seletor abria oferecendo modelos sem *tool calling*, cujo clique a api recusa
  com 422, e a frase da recusa manda a pessoa justamente para o filtro que
  ninguém tinha ligado. Quem passa a ligá-lo não é escolhido por tela e sim pelo
  **escopo do vínculo**: `assertModelFitsBindingScope` exige *tool calling* em
  `agent` e em `area` e em mais nenhum, então as duas telas que gravam nesses
  escopos abrem filtradas e o **seletor da sessão continua sem filtro** — ali a
  api aceita modelo de conversa de propósito, e marcar esconderia o que o
  domínio permite. Isto torna **improvável a causa mais comum** de recusa, nunca
  impossível: as outras duas (modelo desativado no workspace, modelo sumido do
  provider — RN-043) continuam alcançáveis daqui, o modelo indisponível segue
  **listado e marcado**, e a mensagem de falha da correção anterior continua
  sendo o que conta o desfecho. É o **estado inicial** de uma caixa de seleção,
  não uma trava: desmarcar volta a listar o catálogo inteiro. Como consequência,
  o seletor passa a **dizer quando o filtro esconde o modelo vigente** — o
  vínculo herdado do projeto ou do workspace pode ser de conversa (esses dois
  níveis nunca exigiram *tool calling*), e sem o aviso o gatilho mostrava um
  nome que a lista aberta não continha, sem nada marcado. A causa é nomeada
  porque só existe um filtro ali; quando a lista inteira fica vazia, quem fala
  continua sendo o texto de lista vazia, que já manda desmarcar (RN-040)
- **web**: em **Configurações**, escolher um modelo no seletor de uma linha de
  **Modelos por agente** e ter o pedido recusado não produzia nada na tela: a
  pessoa clicava, o dropdown fechava, a linha continuava no modelo antigo e o
  erro só existia no console. Mesma classe de defeito da correção logo abaixo, e
  na função vizinha do mesmo arquivo — `handleModelChange` não tinha `try/catch`
  e era chamada do `onSelect` do seletor, então toda recusa da api virava
  *unhandled promise rejection*. A recusa é alcançável de dentro do próprio
  seletor: o modelo que sumiu do provider aparece na lista **marcado** em vez de
  escondido (senão o vínculo que aponta para ele ficaria sem explicação), e a
  lista é cacheada, então o modelo pode ter sido desligado no catálogo depois da
  última leitura — nos dois casos a api recusa com 422. Agora a falha aparece,
  com a mensagem da api e tom de falha. **O 404 aqui NÃO ganha desfecho
  próprio**, ao contrário da correção de "voltar a herdar": aquele endpoint tem
  **uma** causa de 404 e por isso o cliente pôde nomeá-la; este recusa por sete
  caminhos e nenhum status identifica um deles sozinho — o 404 sozinho tem duas
  causas ("Modelo não encontrado" e "Projeto não encontrado"), e escolher uma das
  frases seria a tela afirmando o que não sabe. O contraste está comentado no
  código, ao lado das duas funções. Nada de otimista foi introduzido: a coluna
  **Modelo vigente** continua exibindo o vínculo que a api confirmou, e a linha
  só é relida no sucesso — na recusa nada mudou no banco (RN-470)
- **web**: em **Configurações**, clicar em "voltar a herdar" numa linha de
  **Modelos por agente** que já herdava não fazia nada visível — nem confirmava,
  nem reclamava. O botão aparece em toda origem `agent` de propósito (RN-470): a
  cadeia do cliente não consegue separar o agente com modelo próprio daquele que
  herdou o do **Criativo**, e nesse caso não há linha para apagar, então a api
  responde 404 — ela está certa, "apaguei o que não existia" e "apaguei" não são
  a mesma resposta. O que faltava era do lado do cliente: a função não tinha
  `try/catch` e era chamada de um `onClick`, então toda recusa virava *unhandled
  promise rejection* — silêncio na tela e ruído no console. Agora os três
  desfechos são distintos, na gramática que **Modelo por área** já usava. O 404
  ganhou desfecho **próprio** e não o das outras falhas, porque para quem clicou
  ele não é falha: o estado pedido — o agente herda — **já é verdade**. A tela
  diz isso na língua de quem está lendo, em vez de repassar a frase pt-BR que a
  api crava no código (o idioma default do web é `en`), e ela pode dizer porque
  este endpoint tem **uma** causa de 404: papel insuficiente é 403 e `scope_id`
  malformado não é 404. Nos dois desfechos a linha é relida — se a api diz que
  não havia binding, quem estava desatualizada era a tela. Qualquer outro status
  continua sendo erro de verdade, com a mensagem da api e tom de falha
- **engine,api,web**: a aba Insights, com zero hipóteses, mostrava "Sem
  hipóteses ainda — o Psicólogo analisa cada sessão encerrada" mesmo com
  `PSYCHOLOGIST_ENABLED=false` — indistinguível de "ainda ativo, só não
  rodou". A tela nunca chegava perto do botão "Reanalisar" (só existe com
  uma rodada de análise já feita), então nunca esbarrava no 503 que
  denunciava a pausa. `GET /projects/:projectId/psychologist/status`
  (`role:viewer`, sem efeito colateral) lê a flag global de antemão; a
  tela agora diz "O Psicólogo está pausado — nenhuma sessão é analisada
  até ser reativado" quando é o caso, e mantém a frase original quando de
  fato ainda está ativo (RN-454)
- **web**: a aba PRs mostrava o 409 do portão do container (RN-105 — o
  Arquiteto ainda não decidiu qual imagem sobe para o projeto) como erro
  transitório genérico, com botão "Tentar de novo" — a afordância errada
  para um estado estável que só se resolve quando o Arquiteto decide, nunca
  clicando de novo. A apresentação dedicada que a aba Code já tinha
  (RN-107) foi extraída para `ContainerImageGateNotice`
  (`components/ContainerImageGate.tsx`) e a aba PRs (`code/PrListAndDiff.tsx`)
  passou a reconhecer o mesmo 409 (`isContainerImageGateError`,
  `lib/api-client.ts`) e mostrar o mesmo estado. Placeholder truncado no
  campo "Já sabe o id?" corrigido junto (largura do input de 200px para
  260px).
- **docker,scripts,deploy**: `gemma:1b` não existe no registry da Ollama
  (`manifest unknown`) — só `gemma3:1b` existe. `ollama-model-loader`
  sempre falhava e travava qualquer `docker compose up --wait`. Corrigido
  em `docker-compose.yml`/`.prod.yml`, `.env.example`,
  `docker/ollama/pull-models.sh`, `scripts/dev/verificar-modelos-ollama.sh`
  e `deploy/k8s/base/ollama/job-model-loader.yaml` (RN-415).
- **scripts**: `Database › Delete` nunca dropava de verdade — `DROP SCHEMA
  public CASCADE` não alcança `engine.*` (Ecto/Oban vive em schema PRÓPRIO)
  nem `drizzle.__drizzle_migrations` (controle do drizzle-kit, também em
  schema próprio). Resultado real: `mix ecto.migrate` batia em
  `duplicate_table` e `pnpm db:migrate` — sem erro nenhum — não recriava
  NENHUMA tabela da api, porque via o controle do drizzle-kit intacto e
  concluía que já tinha rodado tudo. `Delete`/`Reset total` agora dropam
  `engine` e `drizzle` também.

- **api,web**: converter `execution_mode` de um projeto EXISTENTE, sem
  recriá-lo — fecha a correção que a Onda 1 do runner (ADR 0104) já tinha
  registrado em `docs/explanation/backlog.md` (o item 4 daquele ADR dizia
  que a conversão já era possível, e não era). Rota dedicada, `PUT
  projects/:projectId/execution-mode` (`maintainer`), que orquestra a
  migração em vez de um `PATCH` que só trocaria a coluna: relocaliza o
  `permissions.json` para o novo escopo (o CONTEÚDO não muda), encerra o
  ciclo de vida do container ao SAIR de `container` (ADR 0081), zera
  `workspaceVerifiedAt` em toda conversão real e recusa com 409 enquanto
  qualquer dev agent do projeto estiver trabalhando ou travado — ele não
  re-resolve o worktree sozinho por baixo da troca. Nova seção em
  Configurações do projeto, com o mesmo aviso e a mesma copy dos três
  modos do wizard de criação (RN-447..450, ADR 0111)
- **api,web**: handoff manual a agente à escolha (ADR 0109), fechando item
  de backlog aberto desde a FASE 13c. `SessionPage.tsx` ganha um seletor
  ("Endereçar handoff a...") sobre `addressableAgents()` (lead de área ∪
  agente conversacional solo), que POSTa em `POST
  .../sessions/:sessionId/handoffs` — mesmo `CreateHandoffUseCase` que um
  agente já usa para oferecer handoff, com `actor: {kind:'user'}`
  registrando que quem decidiu foi um humano. O caso real que motivou:
  Staff (ADR 0088) e `ux-designer` (ADR 0087) tinham plumbing de engine
  pronto e NENHUM caminho humano até eles — os dois entram em
  `AGENTES_DE_CHAT` na mesma mudança (RN-440/RN-441)
- **api,web**: budget por ÁREA (`agent_areas.budget_micros`/`spent_micros`)
  fecha o item do backlog do ADR 0038 — teto de gasto opcional, configurável
  por lead em Configurações (`maintainer`), ADITIVO aos budgets de projeto
  e sessão que já existiam (nunca cascata: os três são checados
  independentemente, e qualquer um bloqueado já recusa a chamada). `null`
  é o default (sem teto); o gasto acumulado da área soma SEMPRE, com ou sem
  teto configurado, o que já mostra o gasto real por área antes de alguém
  configurar um limite. Rota `PUT projects/:projectId/agent-areas/:key/budget`
  (`maintainer`), e a rota `GET agent-areas` já existente passa a devolver
  `budgetMicros`/`spentMicros` (RN-443, ADR 0110)
- **runner**: binário standalone do `@brabo/runner` — download direto de
  `dist-bin/brabo-runner-<plataforma>-<arquitetura>[.exe]` numa GitHub
  Release, sem Node/npm/node-gyp instalado na máquina. `bun build --compile`
  empacota o CLI num único executável, com o `.node` nativo do `node-pty`
  embutido (`with { type: 'file' }`) e extraído pra um diretório real em
  runtime — o mecanismo completo, e o que ficou VALIDADO por execução real
  em cada plataforma (só `linux-x64` neste sandbox; as outras quatro por
  reasoning + a primeira execução real de CI na próxima tag), está no ADR
  0112. Cinco plataformas (`linux-x64`, `linux-arm64`, `darwin-x64`,
  `darwin-arm64`, `win32-x64`), cada uma construída no seu runner NATIVO
  (`build-runner-binaries.yml`, mesmo gatilho de tag final de
  `publish-runner.yml`) e anexada à Release já existente. Fecha o item de
  backlog do ADR 0104 ("binário standalone (pkg/bun build --compile)"),
  companion do ADR 0106 (RN-451/452)
- **web**: `FolderBrowserModal` vira um explorador de três colunas —
  atalhos ("Pasta pessoal", "Raiz"), lista central com breadcrumb e um
  painel de detalhes —, seguindo a referência visual do dono do produto
  (picker estilo GNOME Files/GTK). Um clique agora SELECIONA (destaca e
  atualiza os detalhes) e duplo clique ENTRA — antes um único clique já
  navegava. A lista deixou de esconder arquivos: eles aparecem visualmente
  apagados e sem gesto nenhum, só pasta continua navegável/selecionável. O
  botão final foi renomeado para "Usar esta pasta" (RN-436)
- **api,web**: no modo de projeto `runner`, "Procurar pasta..." passa a
  criar o projeto ANTECIPADAMENTE — ao clicar, não só na confirmação —
  fechando a lacuna que o ADR 0107 já tinha declarado (o ticket do canal do
  Runner precisa de um `projectId` real). Reuso por SNAPSHOT de identidade
  (nome/repositório a adotar), nunca pelo caminho digitado: clicar de novo
  sem mudar a identidade reabre o MESMO projeto, e a confirmação final
  reusa em vez de criar de novo. O modo `mounted` não muda — continua sem
  projeto até a confirmação, porque ali a validação de caminho toca disco
  na criação (RN-437, ADR 0108)
- **web**: `fs-browser-channel.ts` tinha o mesmo bug de path duplicado que a
  RN-433 já tinha corrigido no `terminal-channel.ts` irmão (concatenava
  `/runner/websocket` a um `engineWsUrl` que já vem pronto), então a
  navegação de pasta contra um engine real caía direto em "a conexão com o
  runner caiu". Achado ao verificar a RN-437 ponta a ponta — o módulo não
  tinha teste próprio até agora (RN-438)
- **api,web**: `maintainer` passa a revogar o Personal Access Token de
  QUALQUER usuário do projeto — resposta a incidente (dev desligado com
  token vazando), item declarado fora de escopo pelo ADR 0105. Rotas
  separadas (`GET .../personal-access-tokens/all`,
  `DELETE .../personal-access-tokens/:tokenId/admin`, ambas
  `@RequireRole('maintainer')`), escopo por `projectId` em vez de
  `userId` — a autorevogação de cada usuário não muda. Sub-lista nova em
  Configurações do projeto, visível só para `owner`/`maintainer`, com o
  e-mail do dono de cada token (RN-427, extensão do ADR 0105)
- **runner**: `@brabo/runner` publicado no npm — `npm install -g
  @brabo/runner` instala o CLI sem precisar clonar o monorepo. `tsup`
  empacota `apps/runner` num `dist/index.cjs` único (`node-pty`
  continua dependência separada, é binding nativo); publicação a cada
  tag final via workflow próprio (`publish-runner.yml`), paralelo ao
  `release.yml`. Fecha o backlog do ADR 0104 (ADR 0106)
- **api,web,runner**: Personal Access Token (`brb_…`) pro `brabo-runner`,
  fechando o item de backlog do ADR 0104 que bloqueava
  `npm publish @brabo/runner`. `apps/runner/src/auth.ts` deixa de
  replicar login (e-mail/senha interativos, cookies persistidos em
  `~/.brabo/runner-credentials.json`) — o CLI passa a receber um token
  de longa duração via `--token`/`BRABO_ACCOUNT_TOKEN`, emitido em
  Configurações do projeto, revogável, com expiração opcional, escopado
  a UM projeto. O token nunca autentica fora de
  `POST /projects/:projectId/runner-ticket`, por construção
  (`IS_PAT_ROUTE_KEY`/`@RequirePatAuth()` + `PatAuthGuard` de rota, nunca
  um branch no `JwtAuthGuard` global) — nem sob papel elevado, nem em
  nenhuma outra rota (RN-424/425/426, ADR 0105)
- **api,engine,web,runner**: `execution_mode` do projeto passa a ter TRÊS
  valores — `container` (default, inalterado), `mounted` (o antigo `local`,
  renomeado) e `runner` (novo: pasta do usuário SEM bind-mount, confirmada
  por um `brabo-runner` conectado). Reconcilia os ADRs 0072 e 0103: antes,
  o roteamento pro runner reusava a mesma flag do modo `local`, então
  usar o runner de verdade exigia passar pela validação de bind-mount que
  ele não precisa. Criação de projeto `runner` valida só o caminho
  (léxico, sem tocar disco); o runner confirma o caminho de verdade ao
  conectar (`POST /internal/projects/:projectId/workspace-verification`,
  novo), sobrescrevendo o que foi digitado — ele é a fonte da verdade.
  Comando de agente roteado a um projeto `runner` sem workspace verificado
  ou sem runner conectado é RECUSADO explicitamente, nunca cai no
  fallback de container (RN-421/422/423, ADR 0104)
- **runner**: no Linux, `brabo-runner --dir` só aceita um caminho dentro do
  `$HOME` do usuário (o próprio home ou uma subpasta dele) — caminho fora
  dessa árvore (`/etc`, `/root`, outra conta em `/home`, etc.) é recusado
  na inicialização do CLI, com mensagem explicando o motivo. Fora do
  Linux o comportamento não muda (RN-434, ADR 0104)
- **runner**: `brabo-runner --dir` apontando para uma pasta que ainda não
  existe deixa de ser erro fatal — a pasta é criada automaticamente
  (`mkdir -p`), sempre DEPOIS de passar pela checagem do `$HOME` no Linux
  (RN-434), então um caminho fora do home continua recusado mesmo quando
  ainda não existe. `--dir` apontando para um arquivo já existente
  continua erro real — nunca sobrescrito silenciosamente (RN-435, ADR
  0104)
- **api,web**: fundação de i18n — coluna `locale` em `users` (`'pt-BR'|'en'`,
  default `'pt-BR'`), embutida no corpo de `/auth/login`/`/auth/refresh` (sem
  chamada extra) via `EmitirSessaoUseCase`; `GET/PATCH /users/me/preferences`
  como via redundante para a `AccountPage` nova (`/account`, fora do escopo
  de projeto, link no rodapé da sidebar). `react-i18next`+`i18next` como
  dependência nova de `apps/web`, isolada atrás de `lib/i18n.ts`/
  `lib/idioma.ts` (mesmo desenho de `tema.ts` — servidor é a fonte de
  verdade, `localStorage` só evita flash no primeiro paint). `en` é o idioma
  default do app a partir de agora; `pt-BR` continua disponível. Docusaurus
  (`website/`) ganhou `i18n.defaultLocale: 'en'`/`locales: ['en', 'pt-BR']`,
  com o snapshot pt-BR atual de `docs/` preservado em
  `website/i18n/pt-BR/docusaurus-plugin-content-docs/current/` antes de
  `docs/` virar a fonte em inglês, e uma regra `warn` nova no docmap
  (`traducao-pt-br`) cobrindo o drift entre as duas árvores. Extração em
  massa do resto da interface e tradução de `docs/` são a próxima etapa,
  em andamento (RN-432)
- **web**: navegação por abas agrupadas — a régua de 11 abas do projeto vira
  6 no topo (Visão geral, Agentes ▾, Dev ▾, Documentação ▾, Gastos,
  Configurações), com `GroupedTabs` novo por cima do `Tabs` existente. Chat
  e Chat RAG viram UMA aba com um controle segmentado interno
  ("Conversar"/"Buscar") — a distinção de negócio entre os dois (RN-202)
  não muda, só o contêiner de UI
- **api,web**: aba **PRs** — listagem de pull requests do PROJETO inteiro,
  direto do provider de git (nunca escopada a uma sessão), resolvendo o bug
  em que a revisão de uma PR proposta numa sessão antiga sumia da tela assim
  que uma sessão nova nascia. Novo cruzamento project-wide de ações
  pendentes (`GET /projects/:id/actions?status=pending&actionType=`) acha a
  proposta de merge correspondente independente de qual sessão a criou, e a
  decisão usa o `sessionId` da própria ação. Botão "Merge" propõe
  `git_merge` (primeira produtora real pela UI), desabilitado quando o gate
  do dev agent bloqueou a task; a trava de branch protegida continua
  absoluta (RN-154). `git_merge` ganhou corpo próprio no card de aprovação
  em vez do despejo de JSON cru (RN-430)
- **web**: aba própria **Arquitetura**, extraída da Visão Geral (module_map,
  diagrama C4, ADRs, pendências de validação cruzada); a Visão Geral passa a
  mostrar um resumo condensado com link "Ver arquitetura completa →".
  Primeiro lightbox do design system: `C4DiagramView` ganha botão de
  ampliar por diagrama, abrindo o SVG em tela cheia sobre `Modal`
  (`size="full"`, novo) (RN-431)
- **api,web,engine,runner**: navegação de pasta local via o Runner — dois
  eventos novos no MESMO canal `terminal:<projectId>` (`fs_list_dir`/
  `fs_home_dir`), relay puro do engine, exatamente como o PTY.
  `FolderBrowserModal` (breadcrumb, subpastas, `..`, "Selecionar esta
  pasta") integrado à criação de projeto e reaproveitável onde o projeto já
  existe; sem runner conectado, `RunnerOnboardingPanel` (novo, compartilhado
  com a aba Terminal) explica a instalação em vez de travar carregando. A
  api continua sem enumerar filesystem nenhum — nenhuma rota nova (RN-429,
  ADR 0107, revisa a ADR 0072)
- **web**: corrigido o carrossel de promoção de histórias do PO, que
  degradava silenciosamente para card único (ou sumia) em sessão longa —
  a leva pendente agora vem de `useBacklog` (completo, sem janela) em vez
  de um scan sobre os últimos 200 eventos, mesma classe de bug que a
  RN-180 já corrigiu em `ContextAside` (RN-427)
- **api,engine,web,runner**: execução de agente na máquina do usuário —
  `apps/runner` (workspace novo, CLI `brabo-runner`) conecta ao engine
  por canal Phoenix com ticket de uso único, executa comando de agente
  já aprovado no `$SHELL` do usuário e abre terminal PTY interativo na
  aba Code. Roteamento sempre acontece depois do pipeline de aprovação
  normal; sem runner conectado, o comportamento de sempre (container)
  continua. Junto: `git push`/PR/deploy e `sudo`/`doas` saem de `deny`
  incondicional e viram teto absoluto — sempre pedem aprovação humana,
  nunca auto-aprováveis mesmo com modo automático ligado, decisão
  global do dono do produto (RN-418/419/420, ADR 0102/0103)
- **api,engine**: consumo do grafo de conhecimento — ux-designer,
  Psicólogo e Anamnese passam a resolver o kickoff/identidade a partir de
  um template versionado do grafo (com fallback obrigatório pro texto
  inline, atrás de duas flags separadas, default desligadas). Psicólogo e
  Anamnese ganham uma segunda fonte de contexto: `rag_search` busca
  trechos RELEVANTES ao gatilho da análise, compondo (nunca substituindo)
  a leitura de eventos recentes/janela temporal existente, sempre dentro
  do orçamento de tokens já declarado. O grafo passa a se escrever
  sozinho — `GraphProjector` drena uma fila própria da outbox
  transacional e projeta handoffs, hipóteses do Psicólogo, perfis da
  Anamnese e fechamento de sessão, sem o engine nunca escrever no grafo
  diretamente (RN-416/417, ADR 0101)
- **api,engine**: fundação do grafo de conhecimento — Neo4j (`neo4j-driver`
  na api, memória DERIVADA do event log, nunca fonte de verdade) para
  templates de prompt versionados (idempotentes por hash) e memória
  relacional (interações, hipóteses do Psicólogo, perfis da Anamnese,
  handoffs). pgvector continua sendo o índice vetorial dos chunks — sem
  duplicar embedding em dois bancos. Tool nova `rag_search` para os
  agentes do engine, fechando o maior vão do RAG existente (nenhum agente
  o consultava até agora); `ollama-model-loader` garante `gemma:1b`,
  `yi-coder:1.5b` e `nomic-embed-text` no boot, fechando um bug real
  separado (`nomic-embed-text` nunca era puxado automaticamente).
  Primeira leva de templates extraída para `prompts/*.md`, sem editar
  nenhum `.ex` ainda. Padrão inspirado no repositório
  [ErickWendel/neo4j-ai-experiments](https://github.com/ErickWendel/neo4j-ai-experiments)
  (RN-413/414/415, ADR 0099/0100)
- **web,design**: o tema claro deixa de ser inalcançável — `public/theme-boot.js` aplica `data-theme` a partir de `localStorage['brabo.theme']` antes do primeiro paint (arquivo, não script inline, porque a imagem serve sob `script-src 'self'`), e `src/lib/tema.ts` é a API que o shell consome para alternar (ADR 0074, RN-182/RN-183)
- **design**: os tokens que faltavam do handoff — escala `--fs-*`, raios `--r-xs`/`--r-sm` (mais alias para `--r-md`/`--r-lg`/`--r-pill`), métricas do shell (`--sidebar-w`, `--sidebar-w-collapsed`, `--header-h`, `--tabs-h`) e os nomes `--font-display`/`--shadow-modal` como ALIAS dos existentes
- **design**: a paleta de realce passa a ter os oito papéis do handoff com prefixo `--syntax-*`, valor próprio por tema e 4,5:1 contra `--code-bg` nos dois — cinco dos oito valores do handoff foram recusados por medição (RN-185)
- **web**: scrollbar customizada em `--border-strong`, raio 6px e borda na cor da superfície, nos dois temas
- **api**: o relatório de gasto do workspace (`GET
  /workspaces/:id/spend-report`, papel `owner`) ganhou a quebra por
  **provider** e blocos separados de **pessoa** e **agente** — `porProvider`,
  `porOwner` e `porAgente` (ADR 0076, RN-186/188). O relatório do membro
  (`GET /projects/:id/spend/me`) **não mudou**: continua sem provider e sem
  credencial, e agora a garantia é do TIPO — pedir a dimensão com escopo de
  ator não compila (RN-187).
- **web**: a aba Configurações ganha "Melhores modelos por capacidade" —
  para código, documentação, análise, imagem e conversa, mostra o modelo mais
  usado pelos agentes deste projeto entre os que a curadoria do workspace
  marcou para aquele uso, com custo como desempate. Sem coluna de "nota":
  o handoff pedia um score por capacidade, mas é dado fictício do mock — o
  produto não mede qualidade de modelo em lugar nenhum (ADR 0077, RN-210)
- **web**: a sidebar recolhe (264px ↔ 62px, trilha de ícones por projeto)
  com preferência persistida; projetos ficam expansíveis (N ao mesmo tempo)
  revelando as abas de cada um; nova seção **Atividades**, agrupada por
  agente e, quando o módulo tem paralelização, por INSTÂNCIA real
  (`dev-<modulo>`/`dev-<modulo>-2`, nunca um contador inventado); botão de
  tema no rodapé; os dois itens globais sem rota ("Chat global"/
  "Configurações") saem — só Projetos e Atividades são globais. A aba
  Código recolhe a sidebar automaticamente, sem gravar a preferência
  (RN-195..201)
- **web**: moldura de tela conforme o handoff — cabeçalho do projeto com
  `--header-h` (piso de 60px, sem cortar o alerta de orçamento), régua de abas
  com `box-shadow: inset 0 -2px 0 var(--accent)` em vez de `border-bottom`,
  rolagem horizontal em telas estreitas, e container de conteúdo com largura
  máxima de 1040px. O rótulo "Code" virou "Código" (ADR 0078).
- **web**: aba de Gastos ganha quebra por provider (Ranking, RN-211), bloco
  de orçamento por projeto com o `TokenMeter` existente (RN-212) e alerta
  de custo lido do orçamento (RN-213). KPI de economia com modelo local
  fica de fora, declarado — falta preço contrafactual defensável (RN-214)
- **web**: o painel inferior da aba Código ganha as quatro abas do handoff
  (Terminal, Problemas, Diff de PR, Saída) — Problemas e Saída nascem com
  estado vazio honesto, sem lint/teste ou stream de comando inventados
  (RN-215/216) — e a status bar de 24px passa a mostrar `↑N ↓M` real da
  branch e a linguagem do arquivo ativo (RN-217); abas do painel ganham
  foco visível (RN-218)
- **web**: a aba Criativo ganhou os 4 KPIs do handoff (sessões no projeto,
  ativas agora, taxa ideação→commit, custo do mês), filtros pill
  (todas/ativas/fechadas/abortadas) e selos de status para os 5 estados
  reais da sessão — `closing` com selo próprio "encerrando", nunca fundido
  com "fechada" (RN-227..230)
- **api**: pipeline de indexação (`docs`/`adr`/`session`, chunking por
  heading/parágrafo com 1200 caracteres e 150 de sobreposição) e busca
  híbrida (vetor + léxico, pesos 0.6/0.4, limiar 0.2) do Chat RAG, com
  degradação honesta quando o provider de embedding está indisponível e
  três rotas novas (`POST .../rag/search`, `POST .../rag/reindex`,
  `GET .../rag/coverage`) — RN-231..238, ADR 0080
- **web**: virtualização de linha na aba Código — arquivo de 5.000 linhas
  renderiza uma janela pequena de nós de DOM, não o arquivo inteiro — e
  minimapa em `<canvas>` reaproveitando a tokenização já feita pelo realce
  de sintaxe, sem segundo passe sobre o arquivo (RN-239..242)
- **api**: ciclo de vida do container como tabela de estado
  (`project_containers`, migração `0046`), sem orquestrador — máquina de
  estados pura (`provisioning → running ⇄ stopped`, `failed`, `removed`),
  primeira transição exigindo a imagem já decidida pelo Arquiteto e
  congelando versão/recursos; nenhuma chamada real a Docker ainda
  (RN-243..248, ADR 0081)
- **web**: a aba **Chat RAG** (`key: 'rag'`), separada da aba Chat
  (`sessions`, que continua sendo conversa com agente ativado) — busca com
  filtro de escopo (docs/ADR/sessões), citações navegáveis (origem de
  sessão leva ao evento exato; origem de arquivo mostra caminho/heading,
  sem link — a aba Código não tem deep-link por caminho ainda), painel de
  cobertura do índice com contagem REAL (nunca "reindexado há Xmin"
  inventado) e botão de reindexar restrito a `maintainer`/`owner`. Avisa
  quando a busca degradou para só léxica por falta de embedding
  (RN-252..254, ADR 0082)
- **api,web**: primeira exposição HTTP do ciclo de vida do container
  (`GET .../container/lifecycle`, role:viewer) e a aba Terminal passa a
  mostrar esse estado real (status, motivo de falha) sob o texto
  explicativo que já existia — nunca um terminal simulado, porque não há
  container real rodando ainda (FASE 25b segue cortada) (RN-267/268,
  ADR 0083)
- **api,web**: login social via GitHub/GitLab — revoga a proibição do
  backlog do ADR 0031 só para esta capacidade. Reusa o mesmo app OAuth da
  conexão de git (zero variável de ambiente nova) e a emissão de sessão do
  login por senha; vincular a conta existente exige e-mail verificado pelo
  provider, contra account takeover; conta provisionada nasce sem senha.
  Branch `breaking/`: o operador precisa cadastrar um segundo callback
  OAuth no provider antes do deploy (RN-272..283, ADR 0084)
- **api,engine**: o plano de execução do Dev Lead (quantos agentes por
  módulo e por quê) vira uma decisão real em Aprovações — antes só narrava
  no fio, sem pipeline de aprovação nenhum. Enquanto ela não é decidida, a
  conversa com o Dev Lead PAUSA: é a primeira vez que um agente
  conversacional suspende esperando aprovação humana no meio do turno
  síncrono (RN-284, ADR 0086)
- **engine,web**: o UX Designer entra como o quinto agente conversacional
  (Criativo, PO, Arquiteto, Dev Lead e agora ele), SOLO e sem área —
  antecipado pelo dono do produto antes do gatilho de separação declarado
  em `docs/fluxo.yml` ter disparado. Kickoff a partir do product brief do
  Criativo; a única ferramenta, `propose_prototype`, registra personas,
  jornadas e o protótipo navegável (`artifact.prototipo_navegavel`, sem
  tabela nem rota nova na api) e oferece o mesmo artefato como handoff ao
  PO e ao Dev Lead. `teste-de-usabilidade` fica fora de alcance (exige
  usuário humano real); `metricas-de-uso` segue lacuna declarada
  (RN-285..287, ADR 0087)
- **engine,api,web**: o Staff/Principal Engineer ganha CÓDIGO — sexto
  agente conversacional solo (`propose_rfc`: problema, opções com
  trade-offs, recomendação e PoC descartável, devolvido ao Arquiteto por
  handoff no mesmo tool call), acionável MANUALMENTE por handoff aceito
  endereçado a "staff" (caminho genérico, sem entrar em
  `USER_STARTED_AGENTS`). O gatilho AUTOMÁTICO (a Anamnese notando um
  problema sistêmico recorrente) segue pendente enquanto
  `ANAMNESE_ENABLED=false` — dormente para disparo automático, não para
  acionamento manual (RN-305/306, ADR 0088)
- **api,engine**: o gate `implementavel` sai de `planned` para `active` — o
  Dev Lead ganha `assess_implementability`, o parecer de implementabilidade
  de uma story (viável/inviável, com justificativa), a partir do plano de
  teste que a QA-estratégia produz. A QA-estratégia deixa de ser papel
  `proposto` em `docs/fluxo.yml`: é o próprio `qa-lead`, num SEGUNDO
  momento (mesmo processo, entregável separado do veredito de PR) — sem
  worktree, sem task, PRE-DEV. O parecer nasce `proposed_action`, mesmo
  padrão do plano de execução (RN-340/341, ADR 0090)
- **engine**: o papel `appsec` (`docs/fluxo.yml`) ganha o segundo momento do
  secops — threat model de DESIGN (checklist STRIDE-lite) sobre a story e o
  module_map vigente, ANTES de existir código ou PR. Roda no MESMO processo
  do `SecOpsAgentServer` (`run_design/2`, sem worktree/task_id), termina
  emitindo `artifact.threat_model` e criando handoff para arquiteto, dev-lead
  e o lead de Infra. `run_design/2` já é acionável, mas nenhum caminho aciona
  sozinho ainda — o gatilho automático fica para a frente `qa-estrategia`
  (RN-360/361, ADR 0090)
- **api**: novo script `pnpm --filter api analise:funil -- --projeto
  <uuid> [--json]` — os papéis `analytics`/`delivery-metricas` de
  `docs/fluxo.yml` (antes `status: proposto`) viram `active`, entregues
  como RELATÓRIO puro (mesmo formato de `medir-execucao.ts`, sem agente,
  sem GenServer). Mede funil real sessão → commit → PR → merge, lead time
  real e deployment frequency real em branch protegida, todos extraídos
  de `proposed_actions.execution_result`. Declara, de propósito, três
  métricas sem caminho para existir hoje: funil de produto completo
  (ideação → commit), evidência de adoção por feature e MTTR/change
  failure rate (RN-320..322, ADR 0089)
- **api**: `pnpm --filter api relatorio:seguranca-runtime` — o papel
  `secops-runtime` (`docs/fluxo.yml`) antecipado como SCRIPT, não agente,
  sobre o dado que o `RateLimitGuard` já coleta hoje (`rate_limit_hits`):
  ranking de baldes (usuário/IP) com mais hits e distribuição temporal dos
  picos, com a janela de retenção (curta, poucos minutos) sempre declarada.
  Detecção automática de incidente, resposta a incidente e postmortem de
  segurança seguem FORA — dependem de tráfego de produção real, que não
  existe — e o relatório lista essa lacuna, sem simular incidente de
  exemplo (RN-375..377, ADR 0091)
- **api**: o papel `platform` (`docs/fluxo.yml`, `status: planned` —
  ativação ainda pendente de `DEPLOY_ENABLED`, que não existe) ganha uma
  primeira entrega honesta: `pnpm --filter api relatorio:telemetria
  [--projeto <uuid>] [--json]`, um SCRIPT (não agente) que lê sob demanda as
  mesmas fontes do `DomainGaugesCollector` — sessões ativas/closing e tasks
  bloqueadas por projeto, estado do último backup — e linka para os
  dashboards/alertas/runbook já versionados, sem duplicar. A saída declara
  explicitamente o que NÃO mede: SLO numérico (nenhum definido), postmortem
  (sem incidente real) e telemetria automática em loop fechado
  (RN-385/386, ADR 0092)
- **api**: o papel `dbre` vira dois scripts mecânicos —
  `lint:migracao` varre `apps/api/src/db/migrations/*.sql` e sinaliza
  `DROP TABLE`/`TRUNCATE`/`DROP COLUMN`/`ALTER COLUMN ... TYPE`/`ADD
  COLUMN ... NOT NULL` sem `DEFAULT` (informativo, não bloqueia CI ainda);
  `relatorio:backup` lê `backup_runs` sob demanda com a mesma lógica do
  `DomainGaugesCollector`, citando o procedimento de restore já testado
  em `docs/runbook.md`. Plano de capacidade e tuning seguem declarados
  como lacuna — exigem volume real de dados, que não existe hoje
  (RN-400..403, ADR 0093)
- **api**: a delegação Dev Lead → `dev-<modulo>` vira DADO auditável em
  `delegations` (`area: 'dev'`), fechando o item que o ADR 0053 (item 5)
  tinha declarado fora de escopo. `status: 'completed'` é redefinido para
  esta área — significa "o agente foi ativado", não "parecer emitido" como
  em QA/Infra —, e `parecerArtifactId` aponta para o `artifact.module_map`
  mais recente do projeto, o artefato que justificou a decisão de delegar
  (RN-405, ADR 0094, auditoria fluxo.yml × código, item B1)
- **api,web**: o gate `necessidade-validada` (Criativo → PO) ganha um
  terceiro botão dedicado, "Confirmar necessidade validada", no mesmo
  padrão de "Confirmar arquitetura pronta" — confirmação humana SEPARADA
  do Criativo, nunca o modelo se autovalidando. Habilita só depois de
  `confirm_readiness` já ter consolidado o `product_brief`; grava
  `necessity.validated` sem sinalizar o engine, porque o handoff
  Criativo→PO já aconteceu antes. `docs/gates.yml` ganha o gate
  correspondente (`active`, `warn`) (RN-406, ADR 0095, auditoria
  fluxo.yml × código, item B2 — última onda do plano)
- **api,engine**: o PO ganha a terceira ferramenta de leitura,
  `listar_metricas_de_produto` — o mesmo relatório de funil de entrega e
  DORA parcial do script `analise:funil` (ADR 0089), agora legível dentro
  do turno (`GET /internal/projects/:projectId/product-metrics`). As
  funções de cálculo puras e a query migraram para
  `apps/api/src/application/services/funil-metrics.ts`, reexportadas pelo
  script sem mudar comportamento. Fecha o item B4 — a ÚLTIMA pendência da
  auditoria fluxo.yml × código (RN-407)
- **api,web**: SMTP real no `MailSender`, fechando o item de backlog aberto
  desde o corte do Keycloak. `MAIL_TRANSPORT=smtp` (default continua `log`,
  inclusive em produção) liga o envio de verdade via `nodemailer`, com
  `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` validados no boot em
  produção pelo mesmo padrão da RN-114 (RN-408, ADR 0096). A investigação
  achou uma lacuna real: `email_verification` não tinha rota web — nova tela
  `/verificar-email` fecha isso, espelhando `/definir-senha`
- **api,web**: o card do dashboard mostra "N online" — quantos agentes estão
  trabalhando ou com pendência esperando decisão AGORA, nunca tamanho de
  equipe ou presença histórica. Soma dev agents (`engine.dev_agent_states`,
  agregado em lote) e agentes conversacionais (último `agent.status` da
  sessão mais recente); QA/SecOps nunca contam, porque não emitem
  `agent.status` (veredito único por invocação). Fecha o item de backlog
  "N agentes online" no dashboard (RN-409, ADR 0097)

### Documentação

- **docs**: CLAUDE.md tinha ~170 KB, ~70% narrativa histórica de fase
  CONCLUÍDA, sem prejuízo pra sessões que só precisam do estado vigente —
  ele é lido em TODA sessão. A narrativa (`## Status` até o bloco anterior
  a `## Stack`, todas as FASES 1–26b, PROGRAMA 16–26/28, RODADAS
  exp001/exp003, agentes antecipados e o resto) foi MOVIDA, verbatim, para
  `docs/explanation/historico-de-fases.md` — recorte mecânico, nenhuma
  frase resumida, reescrita ou perdida (prova por reconstrução byte-a-byte
  no PR). No lugar entram duas seções novas: "Histórico" (índice de uma
  linha por fase/programa, com link pro arquivo novo) e "Estado atual e
  aberto" (decisões de produto em aberto, cortes/pausas vigentes, lacunas
  aceitas e pendências com dono humano — sem duplicar o que já fechou).
  CLAUDE.md cai para a faixa de 30–45 KB.

### Correções

- **api,engine**: corrigido o `413 request entity too large` que estourava
  em PRs legítimas no gate de QA/SecOps — causa era da própria api do
  Brabo, nunca do provider de LLM. A api nunca configurava limite de body
  do Express (valia o default de 100 KB contra os 8 MB que o Phoenix
  aceita); `API_JSON_BODY_LIMIT` (default 10 MB) fecha essa ponta. No
  engine, a compactação de contexto era estruturalmente inalcançável antes
  do estouro — a estimativa de tokens não contava `toolCalls` e a janela
  usava só a janela do modelo (128k, ~350 KB antes de compactar); a janela
  efetiva agora é `min(context_window, teto_de_transporte)`, com corte
  sempre em fronteira de iteração do `ToolLoop` (RN-412, ADR 0098)
- **api,web**: a aba Executores/Visão Geral não fica mais vazia com
  execução real rolando — `executionActivated` era derivado da janela dos
  últimos 200 eventos, e `execution.activated` (um dos primeiros eventos
  da sessão) saía dessa janela em qualquer execução longa, apagando o
  roster inteiro. As duas telas passam a usar o valor agregado sobre
  TODOS os eventos que o resumo do workspace já calculava (RN-090). A
  régua de trabalho pendente (`DEV_PENDING_TYPES`) ganhou
  `dev.awaiting_gate`/`dev.awaiting_approval` — o heartbeat não fecha mais
  a sessão com dev agent esperando o gate ou uma aprovação (RN-412,
  estende a RN-411)
- **api**: sessão de execução não fecha mais por baixo de dev agent
  trabalhando ou travado esperando desbloqueio — o heartbeat de 30s só
  enxergava `agent.status` (vocabulário dos conversacionais), e dev agents
  usam vocabulário próprio (`dev.*`). Quarto sinal em
  `GetSessionPendingWorkUseCase`: último evento `dev.working`/`dev.blocked`/
  `dev.idle_tripped` de qualquer `dev-<modulo>` segura a sessão; `dev.idle`
  não. Achado numa sessão de execução real com cinco dev agents em
  `idle_tripped` (RN-411)
- **api**: toda conta NOVA (registro por e-mail/senha ou login social)
  ganha um workspace pessoal automático, na mesma transação que cria a
  conta — antes `RegisterUseCase`/`SocialLoginCallbackUseCase` criavam
  usuário e credencial mas nenhum workspace, e o botão "Novo projeto" do
  dashboard silenciosamente não fazia nada. Nome/slug saem de uma função
  única, `nomeESlugDoWorkspacePessoal`, e o slug leva sempre um sufixo do
  id do usuário para ser único sem round-trip ao banco (RN-410)
- **api**: "Confirmar arquitetura pronta" (RN-160) agora é revalidado no
  BACKEND — antes só a UI desabilitava o botão sem história promovida do
  backlog, e uma chamada HTTP direta a `POST
  /agents/arquiteto/handoff-infra` ignorava a regra por completo. Recusa
  ANTES de gravar qualquer evento ou sinalizar o engine (RN-404, ADR 0094,
  auditoria fluxo.yml × código, item B6)

- **web**: os seis colapsos ad-hoc restantes migram para o `Disclosure`
  compartilhado (`ModelCatalogSection`, `AgentTimelineTree`,
  `code/CodeExplorer.tsx`, `code/CodeShell.tsx`) — o marco com detalhe de
  `AgentTimelineTree` tinha alvo de clique de 20px, abaixo do piso de 24px
  do WCAG 2.2 AA (2.5.8); a faixa de arquivo do diff em `ApprovalCard` NÃO
  migrou (animação própria de chevron que o componente genérico não
  replica) e ganhou só o `aria-controls` que faltava (RN-249..251)
- **web**: fecha o resto da varredura de acessibilidade — alvos de toque
  abaixo do piso de 32px do handoff em botões de ícone da sidebar
  (colapsada e expandida), ações destrutivas de Aprovações/Configurações e
  o botão de fechar do `Toast` (que não tinha tamanho explícito nenhum, e
  também ganhou `:focus-visible`); quatro alvos abaixo do piso de 24px do
  WCAG corrigidos em telas reais. `aria-expanded` da sidebar auditado e já
  estava correto nos dois controles

- **web**: os valores de espaçamento da régua de abas do projeto, que viviam
  como override de CSS de descendente em `ProjectPage.module.css` desde a
  FASE 16, migraram para `Tabs.module.css` — pendência declarada fechada
- **web**: a régua de abas do projeto (`Tabs.module.css`) ganhou
  `:focus-visible` — navegar por Tab não mostrava indicação de foco nenhuma;
  achado pela frente de acessibilidade, corrigido no mesmo padrão de
  `Input.module.css` (ADR 0036), com anel `inset` (a régua rola
  horizontalmente e um anel para fora seria cortado)

- **design**: seis tokens do tema claro corrigidos até passarem AA — `--accent` 3,56 → 4,81:1, `--warning` 3,15 → 4,98:1, `--success` 3,89 → 5,12:1, `--violet` 4,16 → 4,95:1 e `--text-muted` 2,76 → 5,17:1 contra o fundo que os cobrava, mais `--accent-hover` um degrau abaixo; o tema escuro não mudou nenhum valor e a dívida dele segue travada nos mesmos cinco números (ADR 0074, RN-184)
- **web**: o contraste passa a ser medido nos DOIS temas nos três arquivos que o medem — o teste que afirmava que "nada na app define `data-theme=light`" e que três pares reprovavam foi invertido junto com o produto
- **web**: cor de agente e o `#fff` do botão `.success` saem de token (`var(--violet)`, `var(--on-accent)`); três cores de agente sem contraparte semântica ficam declaradas no arquivo, não inventadas
- **web**: `Select`, `Modal` (botão de fechar) e `ProjectCard` ganham
  `:focus-visible` no mesmo tratamento calibrado de `Input.module.css`
  (ADR 0036, incluindo o bloco de `forced-colors`) — nenhum dos três tinha
  indicação de foco própria alcançável só por teclado. O botão de fechar do
  `Modal` também sobe de 30px para 32px, o piso de alvo de toque em desktop.
  `Table` e `Badge` foram auditados e não precisaram de mudança: nenhum dos
  dois expõe afordância interativa própria — linha de `Table` é apresentação
  pura (quem precisa de linha clicável já usa `<button>`/`<a>` dentro da
  célula, via `render`) e `Badge` não é usado com `onClick` em lugar nenhum
  do produto hoje.

### Correções

- **docker,web**: o terminal do runner local (Code → Dev → Terminal, ADR
  0103/0104) ficava preso em "Abrindo terminal..." para sempre em projeto
  no modo `runner`, com o socket falhando em loop no console do browser.
  Três causas empilhadas: `ENGINE_PUBLIC_URL` não tinha default nenhum em
  `docker/docker-compose.yml` — o fallback do código caía em `ENGINE_URL`
  (`http://engine:4000`, hostname que só resolve DENTRO da rede do
  Compose, inalcançável pelo browser); `apps/web/src/lib/terminal-channel.ts`
  nunca desligava a reconexão automática do `phoenix.js`, então um socket
  que nunca abre (URL errada, engine fora do ar) girava sozinho pra sempre
  em silêncio em vez de mostrar erro; e o mesmo módulo concatenava
  `/runner/websocket` a um `engineWsUrl` que a api já devolve PRONTO
  (`ws://host:porta/runner`) — o `Socket` do `phoenix.js` ainda acrescenta
  `/websocket` sozinho, e o path duplicado (`/runner/runner/websocket/
  websocket`) era recusado pelo engine (`NoRouteError`), o defeito que de
  fato impedia a conexão, só visível depois de corrigir os dois primeiros.
  Compose ganhou o mesmo default que `VITE_ENGINE_URL` já usa
  (`http://localhost:4000`); o canal do terminal ganhou timeout próprio de
  8s que chama `onErro` e desconecta, em vez de depender do backoff nativo
  do Phoenix; e parou de concatenar path no `engineWsUrl`. Verificado
  ponta a ponta contra o engine real (RN-433)
- **api**: `POST .../runner-ticket` (autenticação por Personal Access
  Token, ADR 0105) sempre respondia `403 "Não autenticado"`, mesmo com um
  PAT válido — o runner local nunca conseguia conectar por essa via.
  `RolesGuard`, guard GLOBAL, rodava antes de `PatAuthGuard`, guard local
  da rota (ordem do Nest, não configurável pelo controller), e recusava
  toda chamada com `request.user` ainda vazio antes do `PatAuthGuard`
  sequer autenticar. Um segundo defeito, escondido atrás do primeiro:
  `PatAuthGuard` comparava o token bruto direto contra o hash gravado no
  banco, em vez de hashear antes de comparar — nunca teria funcionado
  mesmo sem o problema de ordem. `RolesGuard` passa a se abster em rota
  `@RequirePatAuth()` (mesmo desvio que `JwtAuthGuard` já tinha) e
  `PatAuthGuard` passa a autenticar E autorizar (`@RequireRole`) no MESMO
  guard. Verificado com o `brabo-runner` conectando de verdade a um
  projeto real (RN-439)

### Desempenho

- **api**: índice `token_usage(created_at)` (migração `0044`). Medido pelo ADR
  0063 a 525 mil linhas: o relatório do workspace sai de 55 ms para 32 ms e o
  do membro de 38 ms para 19 ms — os dois planos deixam de ser *seq scan*.

### Documentação

- **docs,web,api**: Onda 6b (i18n) — a extração em massa da interface e a
  tradução de `docs/` que a Onda 6a (RN-432) tinha deixado como "próxima
  etapa" avançaram bastante, em quatro frentes paralelas:
  - **web**: mais 14 componentes convertidos pra `react-i18next`
    (`ActivityFeed`, `AgentTimelineTree`, `ApprovalCard`, `PrGateTimeline`,
    `ProjectApprovalsTab`, `ProjectPrsTab`, `ProjectSettingsTab`,
    `ProjectPage`, `ProvisioningPage`/`BootstrapSteps`, `AdoptionPlanPage`,
    `Carousel`, `NewProjectWizard`, `SessionPage`), com 6 namespaces novos
    (`activity`, `approvals`, `adoptionPlan`, `newProject`, `projectPage`,
    `provisioning`). Os 80 arquivos `.tsx` não-teste do app foram varridos;
    sobra só 1 string literal fora de UI (fallback de payload interno em
    `ProjectPrsTab.tsx`, nunca renderizada) e dois módulos de biblioteca
    (`fs-browser-channel.ts`/`terminal-channel.ts`) deixados de propósito
    fora do escopo por estarem sendo mexidos por outra frente concorrente.
  - **api → docs/reference/api**: as descrições Swagger/OpenAPI (`@ApiOperation`,
    `@ApiResponse`, `@ApiProperty` etc.) de 123 arquivos de controller/DTO
    sob `apps/api/src/interfaces/http/**` viraram inglês, regerando 186 dos
    191 `.mdx` gerados (os 5 restantes — `runner-tickets`/
    `personal-access-tokens` — ficaram de fora de propósito, mesmo motivo
    do item anterior). `route-surface.spec.ts` atualizado pra cobrar as
    tags novas em inglês.
  - **docs/reference (hand-written)**: os 9 arquivos que não são gerados
    (`artifacts.md`, `configuration.md`, `events.md`, `git-providers.md`,
    `internal-api.md`, `llm-providers.md`, `permissions.md`, `rulesets.md`)
    mais `scripts.md` — que É gerado por inteiro, então a tradução certa
    foi na FONTE (`scripts/docs/generate.mjs`, `Makefile`), nunca no
    arquivo, que seria sobrescrito no próximo `docs:generate`.
  - **docs/adr, docs/explanation, raiz**: os 7 ADRs, 3 `explanation/` e os
    resíduos de `docs/security-surface.md`/`docs/runbook.md` que ainda
    restavam viraram inglês — 101 dos 108 ADRs traduzidos agora.

  `docs/business-rules.md` (o arquivo mais pesado — só o front-matter tinha
  sido traduzido até aqui, o corpo com as centenas de RNs continua em
  português) e uma fatia de componentes `.tsx` menores seguem como o que
  falta pra fechar a onda por completo — ver o CLAUDE.md pro estado
  atualizado.

### CI

- **ci,docker**: endurece a cadeia de suprimentos do CI (achados #1 e #8 da
  revisão externa de 2026-08-28, `docs/explanation/backlog.md`). Todo
  binário baixado por `curl` num release do GitHub (gitleaks, hadolint,
  actionlint, kustomize, kubeconform em `ci.yml`; gitleaks, hadolint,
  actionlint em `docker/engine/Dockerfile`, o de DEV — o `.prod` já fazia
  isto) passa por `sha256sum -c` antes de ser usado — sem isto, um release
  comprometido ou MITM entregaria um binário diferente do esperado, em
  silêncio. As 9 GitHub Actions do workflow (`actions/checkout`,
  `pnpm/action-setup`, `actions/setup-node`, `erlef/setup-beam`,
  `actions/cache`/`cache/restore`, `docker/setup-buildx-action`,
  `docker/bake-action`, `aquasecurity/trivy-action`) passam de tag mutável
  para commit SHA fixo, com a versão preservada em comentário. Um passo
  novo e barato no job `lint` compara `GITLEAKS_VERSION`/
  `HADOLINT_VERSION`/`ACTIONLINT_VERSION` entre `ci.yml` e
  `docker/engine/Dockerfile.prod` e falha se divergirem — o comentário que
  prometia isso não era garantido por nada até agora.

### Manutenção

- **docker**: os containers de dev de `api`, `web` e `engine` param de rodar
  como root — item #13 da revisão externa de 2026-08-28
  (`docs/explanation/backlog.md`). `DEV_UID`/`DEV_GID` (build args, default
  `1000`/`1000`, nunca `${UID}` do shell — somente-leitura e não exportado
  por padrão no bash) mapeiam o container pro MESMO usuário do host, em vez
  de rodar como root e corrigir depois com `sudo chown`. Grupo/usuário só é
  criado quando o par pedido diverge do que a imagem já traz (`node:24-alpine`
  já tem `node` em 1000:1000); no `engine`, `_build`/`deps`/`.mix`/`.hex`
  ganham `chown` ANTES do `USER`, pra um volume nomeado novo herdar o dono
  certo já no primeiro mount. `Dockerfile.prod` não muda — já era non-root
  desde o ADR 0024.
- **web**: `ActionType` deixa de ser cópia à mão em `lib/api-types.ts` —
  passa a ser gerado por `openapi-typescript` a partir de
  `docs/reference/openapi.json` (`lib/api-types.generated.ts`, novo
  `pnpm --filter web run openapi:types`, checado no CI contra o mesmo
  `openapi.json` já validado por `docs:check`). Fecha item de
  `docs/explanation/backlog.md` e o débito descrito em `architecture.md`:
  a cópia manual já divergiu duas vezes em produção sem o compilador
  notar (os três tipos do bootstrap de Gitflow; depois
  `parallelize`/`raise_max_parallel`) — agora `Record<ActionType, ...>`
  em `lib/aprovacoes.ts` reprova a compilação quando um tipo novo falta
  (ADR 0116). Só `ActionType` migrou; o resto de `api-types.ts` segue
  manual.

- **ci,deps**: `website/` sai do workspace pnpm da raiz e ganha
  `pnpm-lock.yaml` próprio (ADR 0117) — item "website lockfile" da revisão
  externa de 2026-08-28 (`docs/explanation/backlog.md`). `pnpm audit` da
  raiz para de reportar a árvore inteira do Docusaurus, que nunca chega a
  nenhuma imagem. Auditar os 13 overrides de segurança com `pnpm why
  <pacote> -r` (em vez de reler os comentários) achou a maioria MISTA, não
  exclusiva do `website` como a revisão original supôs: `mermaid`/
  `dompurify`/`uuid` também resolvem por `apps/web` (dependência de
  runtime, ADR 0068), `postcss`/`nanoid` por `apps/web` via `vite`,
  `js-yaml`/`fast-uri`/`lodash` por `apps/api` via `eslint`/`ajv`/
  `@nestjs/swagger` — essas ficam na raiz E são duplicadas no novo
  `website/pnpm-workspace.yaml`; só `serialize-javascript` e a faixa
  `yaml@1.x` eram exclusivas do `website` e saíram de vez da raiz;
  `esbuild` ficou só na raiz, ausente da árvore do `website`. Scripts
  `docs:*` e os workflows `docs-deploy.yml`/`docs-check.yml` trocam
  `pnpm --filter website` (exige membership) por `pnpm --dir website`
  (aponta o diretório); os dois workflows ganham um segundo `pnpm install`
  escopado a `website/`
- **web**: PR 1 de 5 da decomposição mecânica de `SessionPage.tsx`
  (ADR 0122) — arquivo de 3 807 linhas/169 KiB, o mais disputado do
  repositório, 25 arquivos de teste importando dele, sob churn ativo (50
  commits, zero tentativa de extração até aqui). As cinco funções PURAS de
  timeline/turno (`aberturasDeTurno`, `turnoDoSeq`, `afundarDesfechos`,
  `pontoDaSessao`, `ordemDaAcaoNaTimeline`, e o tipo `TimelineEntry` que
  várias delas usam) saem para `apps/web/src/lib/session-timeline.ts`.
  `agruparNarracoesDoTurno`, na mesma região do arquivo, FICA — produz JSX
  e lê classes de `SessionPage.module.css`, e movê-la junto decidiria de
  passagem que `lib/` aceita seu primeiro arquivo `.tsx`, precedente que
  este PR não toma sozinho. ZERO mudança de comportamento observável: os
  mesmos 25 arquivos `SessionPage.*.test.tsx` passam SEM EDIÇÃO nenhuma —
  essa é a prova. Restam 4 PRs no plano declarado pelo ADR 0122
  (`StorySlide`, `StructuredQuestionCard`, helpers de árvore de backlog +
  `ContextAside`, e um hook `useSessionReadiness`), cada um mergeado antes
  do próximo começar
- **web**: PR 2 de 5 da decomposição mecânica de `SessionPage.tsx`
  (ADR 0122) — `StorySlide`, o slide do carrossel de histórias aguardando
  promoção (RN-148), sai para `apps/web/src/routes/StorySlide.tsx`, sibling
  de `SessionPage.tsx` e não subpasta (o único precedente de subpasta em
  `routes/` é `routes/code/`, para uma feature bem maior). Primeiro
  componente JSX a sair do arquivo, e o mais simples: um leaf sem filhos que
  também precisassem mover. Continua importando `SessionPage.module.css`
  direto — a única importadora do módulo CSS até aqui, decisão já escrita
  no ADR 0122 pra não relitigar em cada uma das três PRs de componente.
  Nenhum tipo, helper ou constante compartilhada precisou mover junto nem
  reexportar: `StorySlide` não é importado por nome em nenhum teste (só
  renderizado dentro de `<SessionPage>`), diferente das cinco funções da
  PR 1. ZERO mudança de comportamento observável: os mesmos 24 arquivos
  `SessionPage.*.test.tsx` (o `SessionPage.ponto.test.ts` da contagem
  original da ADR já tinha migrado para `session-timeline.test.ts` na PR 1)
  passam SEM EDIÇÃO nenhuma. Restam 3 PRs no plano declarado pelo ADR 0122
  (`StructuredQuestionCard`, helpers de árvore de backlog + `ContextAside`,
  e o hook `useSessionReadiness`)
- **web**: PR 3 de 5 da decomposição mecânica de `SessionPage.tsx`
  (ADR 0122) — `StructuredQuestionCard`, o formulário de `chat.
  structured_question` (RN-162/RN-171), sai para `apps/web/src/routes/
  StructuredQuestionCard.tsx`, sibling de `SessionPage.tsx`, mesmo padrão
  da `StorySlide` na PR 2. `permiteOutra` — o predicado puro do RN-171 que
  decide se um `select` ganha a opção "Outra (escrever)" — vai JUNTO,
  porque quem o chama é só o próprio card: um helper cujo único chamador
  está de saída não justifica ficar órfão em `SessionPage.tsx`. O
  sentinela `OUTRA_RESPOSTA`, que também só o card usa, moveu pela mesma
  razão, ainda que não estivesse nomeado no ADR. Continua importando
  `SessionPage.module.css` direto, mesma decisão da PR 2. Nenhuma
  reexportação precisou ficar: nem `StructuredQuestionCard` nem
  `permiteOutra` são importados por nome em teste nenhum (só renderizados
  dentro de `<SessionPage>`), como já valia pra `StorySlide`. ZERO mudança
  de comportamento observável: os mesmos 24 arquivos
  `SessionPage.*.test.tsx` passam SEM EDIÇÃO nenhuma, incluindo
  `SessionPage.perguntas-estruturadas.test.tsx`, que exercita o card
  ponta a ponta. Restam 2 PRs no plano declarado pelo ADR 0122 (helpers
  de árvore de backlog + `ContextAside`, e o hook `useSessionReadiness`)
- **web**: PR 4 de 5 da decomposição mecânica de `SessionPage.tsx`
  (ADR 0122) — a fatia maior do plano, duas peças que se movem juntas
  porque uma depende da outra. As quatro funções PURAS de árvore de
  backlog (`urlDaPr`, `vinculoDeBacklog`, `montarArvoreDeBacklog`,
  `totalDeDescendentes`, com o tipo `NoDeBacklog` que várias delas usam)
  saem para `apps/web/src/lib/session-backlog-tree.ts`, mesmo raciocínio
  da PR 1: sem JSX, sem `styles`, natural em `lib/`. `ItemDeBacklog` (o
  nó recursivo do backlog na tela) e `ContextAside` (a sidebar inteira —
  banner de prontidão, painel de artefatos RN-159, árvore de backlog,
  paginação de regra de negócio, log de eventos) saem juntos para
  `apps/web/src/routes/ContextAside.tsx`, `ItemDeBacklog` continua
  privado do arquivo (não exportado), consumindo os quatro helpers do
  novo módulo de `lib/`. Continua importando `SessionPage.module.css`
  direto, mesma decisão da PR 2. `ArtefatoGerado` e
  `CHAVE_TITULO_PADRAO_POR_TIPO_DE_PR` — só usados dentro de
  `ContextAside` — moveram junto pela mesma razão do sentinela da PR 3:
  helper cujo único chamador está de saída não fica órfão em
  `SessionPage.tsx`. Nenhuma reexportação precisou ficar: nem os quatro
  helpers nem `ContextAside`/`ItemDeBacklog` são importados por nome em
  teste nenhum (só renderizados dentro de `<SessionPage>`). ZERO mudança
  de comportamento observável: os mesmos 24 arquivos
  `SessionPage.*.test.tsx` passam SEM EDIÇÃO nenhuma, incluindo
  `SessionPage.painel-e-agrupamento.test.tsx` e
  `SessionPage.artefatos-gerados.test.tsx`, que exercitam este trecho
  ponta a ponta — mais checagem visual manual da sidebar renderizada, já
  que é a extração mais visível das cinco. Resta 1 PR no plano declarado
  pelo ADR 0122 (o hook `useSessionReadiness`)
- **web**: PR 5 de 5, e ÚLTIMO, da decomposição mecânica de `SessionPage.tsx`
  (ADR 0122) — a única fatia do plano que não é um move de arquivo. As seis
  derivações de "prontidão" (RN-160/RN-161) — `criativoActive`,
  `arquitetoActive`, `hasBusinessRule`, `hasPromotedStory`,
  `hasProductBrief` e `activeAgent`, cada uma um `useMemo` lendo direto do
  closure do componente — viram um hook com contrato explícito de
  parâmetros, `useSessionReadiness(events, backlogData)` em
  `apps/web/src/lib/session-readiness.ts`: `events` no mesmo tipo que
  `SessionPage.tsx` já usa (`SessionEvent[]`), `backlogData` já
  DESEMBRULHADO (`backlogQuery.data`, `Epic[] | undefined`) — `SessionPage.
  tsx` continua sendo o único dono da chamada `useBacklog(projectId)`, o
  hook fica função pura dos dois parâmetros, sem acoplar a nenhum client de
  query. `AGENTES_DE_CHAT` move junto (só ela era usada dentro do loop de
  `activeAgent`) e `SessionPage.tsx` importa de volta o mesmo símbolo para
  o único outro consumidor que sobrava, `offeredHandoff` — fonte única, sem
  cópia. `activeFor`, o helper de uma linha que alimentava
  `criativoActive`/`arquitetoActive`, virou uma cópia local dentro do hook
  E continua, também local, em `SessionPage.tsx`: o original já alimentava
  DOIS outros pontos fora desta extração (`offeredHandoff` e o filtro do
  seletor de handoff manual), então duplicar uma linha pura evitou
  acoplar esses dois ao hook por um parâmetro que não precisariam do resto
  do contrato. Corpo dos seis `useMemo` movido VERBATIM — mesmas dependências,
  mesma lógica. Primeiro hook do repositório testado isolado
  (`renderHook`, `@testing-library/react`, sem `QueryClientProvider`
  porque o hook não usa `useQuery`) — `apps/web/src/lib/
  session-readiness.test.ts`, caminho feliz + 1 caso de borda por grupo.
  ZERO mudança de comportamento observável: os mesmos 24 arquivos
  `SessionPage.*.test.tsx` passam SEM EDIÇÃO nenhuma, incluindo
  os quatro que exercitam prontidão diretamente
  (`SessionPage.readiness-exige-regra`,
  `SessionPage.readiness-arquitetura-exige-historia`,
  `SessionPage.validar-necessidade`,
  `SessionPage.readiness-turno-preso`). `SessionPage.tsx` termina o plano
  em 2 661 linhas, descendo de 3 807 antes da PR 1. Fecha o plano de 5 PRs
  do ADR 0122 — PARCIALMENTE: as cinco extrações nomeadas fecham, mas o
  cluster de estado do canal de turno
  (`turnoViaCanal`/`statusAgent`/`pensandoVisivel`/`atividadeDoTurno`) e
  `ProjectSettingsTab.tsx` seguem exatamente tão em disputa quanto antes,
  por decisão declarada no próprio ADR — nenhum dos dois é tocado aqui
- **web**: PR final do cluster de canal de turno de `SessionPage.tsx`
  (ADR 0124) — o item que o ADR 0122 tinha deixado declarado em aberto,
  fecha aqui. Uma releitura linha a linha achou a própria contagem da ADR
  0122 desatualizada (falava em quatro handlers de turno; são sete pontos
  reais de escrita, incluindo `handleReturnStory`/RN-174, nunca citado
  lá). Duas PRs: a primeira, mecânica, terminou uma deduplicação que tinha
  ficado pela metade — `handleSend`/`handleReadiness`/
  `handleArchitectureReadiness` duplicavam inline as mesmas linhas que
  `iniciarTurnoDoAgente`/`finalizarTurnoDoAgente` (já existentes como par
  `useCallback`) já cobriam, e ganha o parâmetro `{ comStatus }` pra
  preservar a assimetria de `handleAcceptHandoff` (kickoff assíncrono no
  engine); introduz `cancelarTurnoOtimista`. Esta PR, a extração de
  verdade: o estado (`streaming`/`streamingText`/`streamingAgent`/
  `turnoViaCanal`/`statusAgent`/`pensandoVisivel`/`atividadeDoTurno`/
  `optimisticUser`), o efeito do canal Phoenix
  (`connectSessionHeartbeat`, conferido por completo como 100%
  maquinário de ciclo de vida de turno) e as três funções migram para um
  hook novo, `useTurnoDoAgente` (`apps/web/src/lib/session-turno.ts`) —
  primeiro hook do repositório com estado E API imperativa juntos (sem
  precedente local: `useAutoCollapseSidebar` devolve `void`,
  `useSessionReadiness` é função pura sem `useState`). Retorno em OBJETO,
  não tupla (13 campos) — `SessionPage.tsx` desestrutura tudo sob o MESMO
  nome de antes, então todo lugar que lê o estado continua igual.
  `cancelarTurnoOtimista` cobre só dois dos cinco formatos de "desfazer o
  arme" encontrados no arquivo (os blocos idênticos de
  `handleReadiness`/`handleArchitectureReadiness`) — NÃO o de
  `handleAcceptHandoff` (nunca armou `streaming`/`statusAgent`, então
  chamá-la ali acoplaria em silêncio dois campos que o handler nunca
  tocou — a mesma armadilha que a ADR 0122 já tinha apontado) nem os dois
  formatos distintos de `handleSend` (`optimisticUser` pertence ao ciclo
  de vida dele, não ao par arme/desarme). ZERO mudança de comportamento
  observável: os mesmos 25 (24) arquivos `SessionPage.*.test.tsx` passam
  SEM EDIÇÃO nenhuma, incluindo os nove que exercitam este cluster
  diretamente. `SessionPage.tsx` termina em 2 479 linhas, descendo de
  2 661. Fecha, especificamente, o item de canal de turno que a ADR 0122
  tinha deixado em aberto — `ProjectSettingsTab.tsx`, o outro arquivo da
  mesma linha de dívida, segue intocado, decisão de escopo separada
- **web**: `ProjectSettingsTab.tsx` deixa de ser um arquivo de 2 532
  linhas/89,9 KiB — a ÚLTIMA metade em aberto da linha de dívida declarada
  em `docs/architecture.md`, que as ADRs 0122 e 0124 nomearam e adiaram
  duas vezes de propósito. As 17 seções viram um arquivo cada sob
  `apps/web/src/routes/settings/`, e o arquivo antigo CONTINUA no mesmo
  caminho como entrada e barrel, com 77 linhas (ADR 0125). O barrel é
  estrutural, não cosmético: `ProjectSettingsTab.test.tsx` importa 11 nomes
  daquele caminho e `ProjectPage.test.tsx`/`project-tabs.test.tsx` fazem
  `vi.mock` DO CAMINHO — mover ou renomear quebraria os três sem que nada
  do produto mudasse. UMA PR e não cinco (como foi a decomposição do
  `SessionPage.tsx`) porque este arquivo nunca teve aquele formato: o pai
  não guardava NADA (17 filhos JSX, sem hook, sem query, sem `t`, sem
  checagem de papel), nenhuma seção recebe mais que `{projectId}` (duas não
  recebem prop nenhuma) e 11 das 17 já eram exportadas. Dos doze helpers de
  escopo de módulo, só DOIS tinham mais de um chamador e foram para
  `settings/shared.ts` (`ORIGIN_TONE`, `formatarCustoMicros`); os outros
  dez foram para o arquivo do seu único chamador — a checagem por grep
  corrigiu uma expectativa de passagem, `iniciaisDe`/`gradienteDe` são só
  do `MembersSection`, nunca do `ProficiencySection`. As 6 seções privadas
  ganham `export` no PRÓPRIO arquivo (consequência mecânica: o barrel
  precisa importá-las), mas NÃO são reexportadas pelo barrel — a superfície
  pública da aba fica idêntica em formato, porque um move mecânico não
  alarga contrato. `ProjectSettingsTab.module.css` segue um módulo CSS
  ÚNICO e compartilhado, agora com 15 importadoras, mesma resposta que a
  ADR 0122 deu para `SessionPage.module.css` e pelo mesmo motivo: nunca
  houve segunda cópia, então não há para onde derivar. ZERO mudança de
  comportamento observável: a suíte inteira do web (142 arquivos, 1 537
  testes) passa com ZERO arquivo de teste editado, incluindo
  `ProficiencySection.test.tsx`, o único que renderiza as 17 seções de uma
  vez. Fecha a linha de dívida nas DUAS metades

## v3.1.0 — 2026-08-13

### Novidades

- **docs**: publicação simétrica por degrau, com raiz que escolhe (cec7d367)
- **docker**: observabilidade local — Prometheus, Loki e Grafana no Compose (124d909c)
- **scripts**: menu de terminal para operar o repositório (ccfa746e)

### Correções

- **scripts**: teste da landing deixa de depender das tags do clone (f2d20287)
- **scripts**: bootstrap.sh se auto-cura de permissão e corrige bugs de TUI (77005575)
- **docs**: regenera scripts.md contra a dev atual (659c5415)

### Documentação

- atualiza README, CLAUDE.md e onboarding até o estado de hoje (285db8cd)
- **changelog**: v3.0.0 (5b14cd57)

## v3.0.0 — 2026-08-13

### ⚠ Mudanças incompatíveis

- registra a quebra que o container por projeto introduz (54408462)

### Novidades

- **engine,api,web**: Criativo pode fazer perguntas estruturadas (RN-162) (14b2636f)
- **web**: gate de história promovida no botão do Arquiteto e fusão condicional handoff+execução (RN-160, RN-161) (a5433682)
- **web**: markdown leve no chat com highlight (RN-158) e artefatos gerados agrupados por agente (RN-159) (f3bc4e03)
- **api,web**: "auto mode" no ApprovalCard — autonomia pra qualquer ação de um agente (RN-153/154) (4cdb5e8e)
- **code**: vincula branch de dev agent ao módulo dono (RN-152) (ee870790)
- **api,engine,web**: diagrama C4 do Arquiteto na Visão Geral do projeto (61fc8af3)
- **web**: carrossel de histórias com promoção pendente no fio do PO (80ad9003)
- **web,api,engine**: botão de prontidão do Arquiteto, modelo no agent.response e ícone no grupo colapsado (ee338c40)
- **engine**: gate sobrevive a restart no meio do ciclo (ADR 0067, RN-136) (ee919d3e)
- **web**: botão volta ao projeto e promoção de história inline no fio (b9add0ea)
- **web**: handoff aceito inline no fio, com link do PO pro Backlog (d53ac38e)
- **engine,api,web**: botão Parar cancela de verdade o turno do agente (RN-121) (55979ca1)
- **web**: aba Executores separa dev agent e QA do time misturado (76e3b56c)
- **web**: árvore do time abre os 5 últimos e expande detalhe de execução (8f1e12c8)
- **web**: permite renomear sessão direto da lista do projeto (da8ccde3)
- **api,engine,web**: desativa o Psicólogo globalmente por decisão do usuário (9016a3d3)
- **engine,api,web**: a Anamnese pode ser pausada globalmente (100dc51d)
- **web**: lista navegável de PRs no painel de diff da aba Code (fedaef2d)
- **web**: dropdown rico de branches na aba Code (baf8edd8)
- **web**: blame no editor da aba Code, sob demanda (RN-113) (7ffe472b)
- **api**: fundação de blame, PRs navegáveis e branch rica na aba Code (11594f05)
- **api,engine**: a pasta do workspace do projeto ganha nome legível (4cda77a9)
- **api,engine,web**: o socket da sessão exige ticket opaco de uso único (fc0b24d4)
- **docker**: PROJECT_WORKSPACES_HOST_DIR aponta o workspace para pasta real (36c1690c)
- **web**: a aba Code, só leitura — explorador, busca, editor com realce de sintaxe e diff de PR (9cea55e4)
- **api,web**: modelo de LLM vira padrão herdável por área (bd7f69a7)
- **api,engine**: container por projeto — o Arquiteto decide a imagem, a fronteira deixa de ser só política (7014d722)
- **web**: o tipo da sessão vira lugar — abas Criativo e Chat (0dde807a)
- **api,web**: o mesmo gasto para duas audiências (506f39b9)
- **web,api**: Atividades pagina por cursor e o sino ordena do mais recente (4d8a7b8a)
- **api,web**: a sessão nasce com tipo, ganha nome e uma saída (a42cb53f)
- **web**: toda aprovação diz o que faz, e o payload cru nasce colapsado (d247cd85)
- **api**: a superfície de leitura de código da aba Code, contida e com orçamento (55ace0cb)
- **api,shared**: arvore e diff de PR no contrato de git, provados pela suite (2c8ea308)

### Correções

- **engine,docs**: mix format + regenera inventário de eventos (dd3a52fa)
- **business-rules**: corrige link relativo do ADR 0069 na RN-161 (200af4f5)
- **web**: corrige ordenação da timeline, indicador de 5s e aviso do PO (f88589fe)
- **api,web**: badge da sidebar mostra aprovações pendentes, não atividade não lida (RN-151) (28ae04c6)
- **engine**: search_workspace trunca por quantidade de hits e por bytes (RN-150) (479eb3de)
- **api**: CodeQL reconhece a sanitização de segmento de URL interna (RN-128) (acadfe46)
- **api**: amplia allowlist de terminal do dev agent para subcomandos git de leitura (c13f0100)
- **engine,web**: Criativo recusa handoff ao PO sem regra de negócio nenhuma (7f0a4b6d)
- **engine**: read_file trunca conteúdo grande, evitando 413 do provider (2cb84851)
- **web**: aba Criativo não lista mais a sessão de execução vigente (39390472)
- **api,web**: aba Executores lê a sessão de execução vigente, não a mais recente do projeto (ba9f7dfa)
- **web**: prioridade do handoff pro Dev Lead, ativação inline e colapso por agente no fio (d9ebaae2)
- **api**: ativar execução fecha a sessão de chat que originou o pedido (7947cc83)
- **api**: sessão do bootstrap de Git nasce com nome default "git-bootstrap" (34139d19)
- **web**: três corridas confirmadas ao vivo em SessionPage.tsx (RN-129) (ec35d232)
- **web**: write_file mostra corpo próprio na aprovação, e payload vazio vira mensagem clara (04c1f7ea)
- **engine**: ToolLoop nunca grava agent.response vazio, estende RN-059 (2833f326)
- **api**: valida query array e segmento de URL interna (CodeQL crítico) (ac55537a)
- **ci**: libera git log/blame/show pro claude-review não travar em permissão (336e03b6)
- **docs**: regenera events.md com o arquivo certo pro agent.done/status (ec66743d)
- **api,web**: sessão de chat consistente — modelo, duplicata, ideação e roteamento (5762dc39)
- **api**: heartbeat não fecha sessão com agente em turno após handoff (a2e75275)
- **web**: pista no convite perdido e indicador de agente trabalhando (5de8c6db)
- **web**: marca "Brabo" da sidebar navega para o dashboard (8aa31f02)
- **engine**: perform/1 do scheduler da Anamnese confere a flag global (ef07468c)
- **web**: reconcilia turno do agente mesmo sem agent.done do canal (dbeddc97)
- **api**: lint (prettier + type assertion desnecessária) e docs vale-revisar (29fba8ea)
- **api,engine**: os quatro segredos irmãos do GIT_OAUTH_STATE_SECRET também recusam o default em produção (0df9047c)
- **docker**: o smoke manda o kind, que a rota de sessão passou a exigir (7a9c5c0c)
- **web**: o typecheck do CI inclui os testes, e o do editor não (069325db)
- **api**: a área de agentes nasce com o projeto, e o backfill alcança os antigos (5ccbb861)

### Refatorações

- **web**: o teto do nome da sessão vive num lugar só (87c4530b)
- **web**: o metadado truncado da sessão fica legível no hover (133fd31d)
- **web**: Aprovações e Configurações conforme o handoff (6b7cb551)
- **web**: Projeto e Sessão conforme o handoff de design (b1ba2a71)
- **web,design**: login e lista de projetos conforme o handoff (f96f7a63)
- **web**: rótulo de sessão vira helper e os cinco inline migram (00b4529a)
- **web**: Disclosure no design system, sem migrar call site nenhum (70b76829)
- **web**: as abas do projeto derivam de um registro só (2a699882)

### Documentação

- **business-rules**: RN-162 — perguntas estruturadas do Criativo (PR #292) (eafccac2)
- **internal-api**: documenta que RN-162 reusa /sessions/:id/agent/message (345bbe0e)
- **business-rules**: RN-160 e RN-161 — gate do Arquiteto e fusão handoff/execução (PR #290) (423d38bc)
- **business-rules**: RN-158 e RN-159 — markdown e artefatos gerados (PR #288) (cb1f468e)
- **business-rules**: RN-155 a RN-157 — ordenação da timeline (PR #286) (93f550c0)
- **changelog**: consolida a onda 1 do exp003 (5 PRs) (87f473e3)
- **security-surface,internal-api**: documenta a curinga do agent_autonomy de verdade (6a706576)
- **business-rules**: corrige colisão de numeração RN-141 -> RN-144 (b85a0e21)
- **business-rules**: corrige colisão de numeração RN-141 -> RN-142 (ad7273c1)
- **business-rules**: corrige colisão de numeração RN-141 -> RN-143 (f353770a)
- **api**: documenta os subcomandos git de leitura na allowlist do dev agent (6281cd1e)
- **business-rules**: corrige colisão de numeração RN-136 -> RN-139 (c2ec03a1)
- **business-rules**: corrige colisão de numeração RN-136 -> RN-140 (12c0f3d8)
- **security-surface,internal-api**: documenta originSessionId da ativação de execução (4f5b7696)
- **business-rules**: corrige colisão de numeração RN-129 -> RN-131 (9166452d)
- **web**: documenta write_file no corpo próprio da aprovação (RN-096) (fcf19253)
- **engine,api**: documenta a rota interna de cancelamento (RN-121) (b326001c)
- **business-rules**: renumera RN-114 da Anamnese para RN-115 (edc96dab)
- **business-rules**: renumera RN-110 dos segredos irmãos para RN-114 (b7f1d34c)
- **runbook,getting-started**: dono root no bind mount, e como migrar workspaces existentes (7919e897)
- **architecture**: a aba Code entra na descricao do contrato web-api (e577700f)
- contagem de ADRs pos-merge de origin/dev (64) e manifesto regenerado (86ae1043)
- **reference**: a cascata de binding ganha área, na página de providers (b3c026de)
- **runbook**: o smoke cria sessão consultiva, e por que é ela que prova a rota (63d1883a)
- **referencia**: a trava do tipo de sessão na api interna e nos artefatos (3864a4a1)
- **architecture**: lib/aprovacoes.ts e a união ActionType que envelhece (4b604731)
- **validacao**: 9ª e 10ª execuções, as de dois módulos, e o achado AF (3426928c)
- **changelog**: a entrada vai para a secao Unreleased que ja existia (13b00324)
- **business-rules,architecture**: as quatro capabilities de git na RN-028 (be746d7d)
- **claude**: o programa 16-26, e o CLAUDE.md na definição de pronto (023b7940)
- **claude**: o estado das fases depois da 15, e o que o uso ensinou (24cbb48c)
- **changelog**: v2.5.1 (0e7072d3)

### Testes

- **web**: a sigla do conector conferida na tela, não na função (b806d810)

### CI

- recarrega o corpo da PR (a dispensa do drift estava entre crases, de novo) (7a91b96d)
- recarrega o corpo da PR (a dispensa do drift estava entre crases) (fa408874)

### Manutenção

- **web**: árvore de Executores porta o skin de bolha do chat do Criativo (56b84620)
- **docs**: renumera RN-123 do handoff inline pra RN-125 (e4fbeca5)
- **docs**: desfaz colisão de RN-118 entre PR #247 e #248 (40332299)
- **docs**: renumera RN-121 do cancelamento de turno para RN-122 (9162f8cf)
- **design**: o handoff entra no repo e os tokens fecham contra ele (05e02860)

## Unreleased

### Novidades

- **docs**: `business-rules.md` deixa de ser uma página de 644 KB — as duas
  seções que sozinhas eram metade dela saem para arquivos próprios
  (`business-rules/custo.md` e `business-rules/autenticacao.md`), e o índice
  cai para 335 KB. Divisão por TAMANHO, não por assunto: nenhuma vírgula de
  conteúdo mudou e nenhuma âncora `{#rn-NNN}` mudou de nome — só o arquivo
  que as hospeda. Os 293 links que apontavam para as RNs movidas foram
  reescritos, incluindo os da tradução pt-BR, e o build do Docusaurus (que
  reprova âncora quebrada) passa nos dois idiomas. O `docs/.docmap.yml` ganha
  `docs_alternativos`, uma DISJUNÇÃO ao lado da conjunção que já existia: uma
  RN mora em um dos três arquivos, e cobrar os três ensinaria a usar o escape
  hatch — regra que ensina a ignorar check é pior que regra nenhuma.
- **docs**: o `docs:check` passa a conferir TRÊS famílias de número escrito em
  prosa, não só a de ADR: a contagem de RNs (fonte: os cabeçalhos `### RN-NNN`
  do `business-rules.md`) e a de providers de LLM (fonte: os literais
  `capabilities` que a tabela gerada de `llm-providers.md` já lê) entram na
  mesma aferição. O gatilho foi medido, não previsto: o README anunciava "as
  158 RNs" com 331 escritas — errado por mais do dobro, na tabela que
  apresenta o repositório —, e corrigir à mão só reinicia o relógio. Número
  que não bate REPROVA com o valor certo na mensagem; frase alterada reprova
  como `CEGO`, de propósito, porque check que parou de achar a frase fica
  verde para sempre dizendo que conferiu algo que não olhou.
- **ci,k8s**: as quatro imagens de produção passam a ser PUBLICADAS no GHCR
  a cada tag final (`ghcr.io/<dono>/brabo-{api,engine,web,backup}`, públicas),
  fechando a dívida declarada mais cara dos ADRs 0025/0027 — até aqui o
  `release.yml` construía com `push: false` só pra provar que a tag era
  construível, e o overlay de produção apontava pra `ghcr.io/OWNER/*` com um
  `newTag: REPLACE_WITH_DIGEST` que nenhum passo substituía (ADR 0119). O
  login usa o `GITHUB_TOKEN` do próprio job (`packages: write`): nenhum
  segredo novo pra rotacionar. O que cada tag publicou fica registrado POR
  DIGEST em `.release/images.json` — anexado à GitHub Release no mesmo
  instante da tag e versionado pela PR do CHANGELOG que o release já abria,
  SEM abrir uma terceira exceção de push direto. O overlay continua guardando
  o marcador, e `make imagens-do-release OVERLAY=prod|staging` aplica o digest
  com `kustomize edit set image` — quem faz o deploy decide qual release está
  em produção, não a tag. Achado no caminho: os overlays listavam TRÊS
  imagens, não quatro — o CronJob de backup herdava `brabo-backup:prod`, nome
  que não resolve em registry nenhum, então o backup do ambiente que mais
  precisa dele nunca subiria. Nada passa a fazer deploy sozinho: `DEPLOY_ENABLED`
  continua não existindo, e assinatura/atestação das imagens segue de fora,
  junto com o code-signing dos binários do runner.
- **engine,api,web**: o Criativo pode emitir perguntas estruturadas
  (`ask_structured_questions`) quando faz várias perguntas de uma vez — o
  usuário responde por um formulário em vez de texto livre item por item
  (RN-162).
- **web**: Markdown leve (negrito, cabeçalho, lista, link, fence de código
  com highlight) nas respostas dos agentes no chat da Sessão, e prompt de
  terminal para blocos ```sh/```bash (RN-158).
- **web**: painel "Artefatos gerados" da Sessão agora inclui PR de ADR e
  épico/história do PO, agrupados por agente (RN-159).
- **web**: "Confirmar arquitetura pronta" nasce desabilitado até existir
  pelo menos 1 história promovida no backlog (RN-160); aceitar o handoff
  pro Dev Lead encadeia a ativação de execução automaticamente quando quem
  aceita já é `maintainer`/`owner` (RN-161, ADR 0069).
- **api,web**: aba Code — o dropdown de branches (`CodeBranchPicker`) mostra
  qual dev agent/módulo produziu cada branch de task
  (`feature/task-XXXXXXXX`), com ícone e cor do agente (RN-152) —
  `ReadProjectCodeUseCase.branches` resolve pelo prefixo do uuid da task
  contra `TaskRepository.findByProjectAndIdPrefix` e o `module_map`
  vigente, sem chamada extra ao provider de git
- **api,web**: `agent_autonomy` ganha a curinga `actionType: "*"` — "modo
  automático" (RN-153) — autonomia pra QUALQUER tipo de ação de um agente,
  ligada pelo botão "Modo automático" no `ApprovalCard` (exige
  `maintainer`). Regra específica sempre vence a curinga; os três tetos
  absolutos — merge em branch protegida, `instruction_patch`,
  `parallelize`/`raise_max_parallel` — continuam bloqueando mesmo com o
  modo ligado (RN-154)
- **api,engine,web**: o Arquiteto ganha um diagrama C4 (Context + Container,
  modelo de Simon Brown), renderizado na Visão Geral do projeto (RN-149,
  ADR 0068) — nova ferramenta `create_c4_diagram`, que gera as duas sintaxes
  Mermaid a partir do `module_map` vigente (o Container level é DERIVADO
  dele pelo caso de uso, nunca redigitado pelo modelo, para não abrir uma
  segunda fonte que diverge da primeira); artefato `artifact.c4_diagram`
  versionado no event log, sem tabela, mesmo desenho de
  `artifact.project_image` (ADR 0065). `mermaid` entra como dependência de
  RUNTIME nova do `apps/web` — a primeira do tipo — isolada atrás de
  `lib/mermaid-render.ts` com `import()` dinâmico (só quem abre um diagrama
  gerado paga o bundle); os três estados de sempre (carregando, erro,
  vazio — RN-088), com a sintaxe crua acessível quando o Mermaid não
  consegue desenhar. CSP fechado do ADR 0058 confirmado intacto, sem
  mudança de configuração
- **web**: histórias com promoção pendente ao mesmo tempo (2+) viram um
  CARROSSEL no fio da sessão do PO, em vez de N cards avulsos disputando o
  mesmo espaço (RN-148) — `Carousel`, primeiro componente de navegação
  item-por-item do design system, com setas, dots e teclado (ARIA
  `role="group"`/`aria-roledescription`). Cada slide mostra a mesma frase
  do card avulso, com Promover/Devolver daquela história específica; o
  cabeçalho ganha "Aprovar todas", que promove o lote inteiro numa chamada
  só (`promoteStories` já era lote, RN-048). Uma única história pendente
  continua o card simples de sempre — carrossel de um slide só não ganha
  nada
- **api,engine,web**: o Arquiteto ganha o botão "Confirmar arquitetura
  pronta" (RN-145) — `OfferInfraHandoffUseCase` já existia e já oferecia o
  handoff ao Infra e ao Dev Lead na mesma confirmação, mas nenhum lugar do
  frontend chamava o endpoint. Separadamente, `agent.response` passa a
  carregar o nome do MODELO que gerou a resposta (RN-146) — antes só existia
  em `token_usage`, sem vínculo com o evento específico; `SessionPage.tsx`
  mostrava a string fixa "modelo" e agora mostra o nome real, com fallback
  para evento gravado antes desta mudança. E o cabeçalho do grupo de
  mensagens colapsado (RN-138) ganha o ÍCONE do agente ao lado do nome
  (RN-147), reusando a mesma fonte do indicador de streaming
- **engine**: um ciclo de gate (QA/SecOps) morto no meio — por um restart do
  processo, entre o veredito já gravado na api e a chamada em processo que
  aplicaria o próximo passo — não prendia mais a PR pra sempre (RN-140).
  `gate_states` grava o ciclo em voo nos mesmos pontos onde as transições já
  aconteciam, e `Engine.Gates.GateRescuer` (chamado no boot e por um tick
  Oban a cada 5 min) reinicia a área do zero ou reenvia exatamente a chamada
  perdida — sem intervenção manual. Fecha o limite que o ADR 0057 já
  declarava ("restart no meio da espera perde o laço"); ver ADR 0067
- **web**: o botão "Voltar" da sessão passa a levar de volta ao PROJETO
  (`/projects/:projectId`), não mais ao dashboard raiz — a sessão sempre
  nasce dentro de um projeto, e é lá que quem sai dela quer estar.
  Separadamente, a promoção de história (RN-048) ganha um segundo lugar
  pra ser decidida: `backlog.story_promotion_proposed` vira um card
  acionável INLINE no fio da sessão do PO, com os botões "Promover" e
  "Devolver" chamando os mesmos endpoints que a aba Backlog já usa
  (RN-126); "Devolver" pede o motivo e a devolução narra no fio, com o
  motivo, quando decidida
- **web**: o aceite de handoff passa a viver DENTRO do fio da sessão
  (RN-125) — o divisor "X passou o bastão ao Y" vira um card acionável,
  com o botão embutido, quando representa a oferta pendente ATUAL; o
  botão da topbar saiu, pra não duplicar o mesmo texto na tela. O card
  pro **Dev Lead** ganha um link extra, "Acompanhe a execução em
  Executores". Separadamente, criar épico ou história pelo PO
  (`backlog.epic_created`/`backlog.story_created`) passa a narrar no
  fio, com um link "Ver no Backlog" (RN-124) — antes, criar história não
  deixava rastro nenhum na conversa
- **api,engine,web**: botão **"Parar"** no composer da sessão cancela DE
  VERDADE o turno em curso do agente conversacional (RN-122) — não só para de
  renderizar no cliente. O engine parava de atender qualquer mensagem
  (inclusive cancelar) enquanto processava um turno, porque o turno inteiro
  rodava dentro de um `GenServer.call` síncrono; os quatro agentes
  conversacionais (Criativo, PO, Arquiteto, Dev Lead) passaram a rodar o
  turno numa Task supervisionada (`Engine.Agents.TurnoAssincrono`), liberando
  o processo pra atender `:cancel` enquanto o turno roda. Cancelar mata a
  Task (`Task.shutdown/2`, `:brutal_kill`), o que derruba a conexão SSE com a
  api no meio — é isso que economiza token de verdade — e grava um
  `agent.error` terminal com origem "politica"

- **api,engine,web**: o Psicólogo pode ser pausado GLOBALMENTE
  (`PSYCHOLOGIST_ENABLED`, default `false` a partir de agora) — mesma
  decisão de produto já aplicada à Anamnese ("hoje ele não está trazendo
  dados de muito valor"), não bug, e não apaga nada do que já existe
  (RN-117). O gatilho automático (fechamento de sessão) para de enfileirar
  rodada nova; a rota "Reanalisar" na aba Insights responde 503; os botões
  correspondentes descobrem o estado no primeiro clique e mantêm a
  explicação visível na tela

- **web**: a aba **Code** — leitura do repositório do projeto no padrão IDE
  (explorador de arquivos carregado por diretório, busca no conteúdo, abas de
  editor com realce de sintaxe sem dependência nova, e diff de PR por id
  conhecido). Um QUARTO estado, além dos três da RN-088, aparece quando o
  Arquiteto ainda não decidiu a imagem do container: "bloqueada por decisão
  pendente" (RN-107), nem carregando, nem erro, nem vazio. Terminal
  interativo, blame e lista rica de branches ficam de fora, declarados como
  pendência — dependem de fases que ainda não subiram (FASE 26, item 35)
  interativo, blame e lista de PRs ficam de fora, declarados como pendência —
  dependem de fases que ainda não subiram (FASE 26, item 35)

- **web**: a aba Code ganha o dropdown rico de branches (`CodeBranchPicker`),
  substituindo o campo de texto simples — cada linha mostra `ahead`/`behind`
  relativos à branch default e a PR associada, quando houver (RN-112). Ref
  fora da lista (tag ou sha) continua alcançável por um campo manual no
  rodapé do dropdown

- **api**: fundação de blame, PRs navegáveis e branch rica para a aba Code —
  `GET /projects/:id/code/{blame,pull-requests,branches}`. `GitProviderContract`
  ganha a 13ª/14ª/15ª operação, provadas pela suite de contrato nos três
  providers (RN-110/111/112)

- **web**: o painel "Diff de PR" da aba Code ganha lista navegável de pull
  requests (id, título, autor, estado, branches, filtro por estado),
  consumindo `listPullRequests` (RN-111); clicar num item abre o mesmo fluxo
  de diff por id que já existia. Quem já sabe o id continua podendo colar
  direto
- **web**: o editor da aba Code ganha anotação de blame — toggle "Blame" no
  breadcrumb liga a anotação linha a linha (commit, autor e data) SOB
  DEMANDA, nunca em toda leitura de arquivo; linhas consecutivas do mesmo
  commit não repetem o texto, e os três estados (carregando, erro com
  "tentar de novo", vazio) seguem a RN-088 (RN-113)

- **api,web**: aba de Gastos com duas audiências — o owner vê a quebra do workspace por modelo, projeto, ator e dia (mais a fatura por credencial, que já existia); o membro vê só o próprio consumo, por sessão e por dia, sem provider e sem credencial (ADR 0063, RN-101)

- **api,web**: a sessão nasce com tipo escolhido (`consultiva` ou `criativa`),
  pode ser renomeada preservando a hashtag, e a tela dela tem um caminho de
  volta ao dashboard. `execution.activated` numa sessão consultiva passa a
  responder 409 em vez de convertê-la em silêncio (ADR 0061, RN-097/098)

- **web**: o projeto ganha duas abas de sessão, **Criativo** e **Chat**, cada
  uma listando e criando o seu tipo sem perguntar de novo; a aba "Sessões" sai,
  e `?tab=sessions` de um link antigo abre no Chat. "Iniciar ideação" passa a
  morar dentro do convite enquanto ele está na tela — antes o convite apontava
  para a topbar (RN-104)

- **api,web**: o modelo de LLM virou padrão herdável por ÁREA — a cascata
  ganha o nível `sessão > agente > área > projeto > workspace`, o lead e os
  subagentes de uma área compartilham o mesmo modelo até um agente divergir
  explicitamente, e "voltar a herdar" apaga o binding do agente em vez de
  copiar o da área. O binding de agente, que era GLOBAL, passou a ser POR
  PROJETO — pré-condição para a área não competir com um escopo mais amplo
  que ela mesma (ADR 0064, RN-102/103)

- **api,engine**: o Arquiteto decide qual imagem de container sobe para cada
  projeto — artefato versionado no event log (`artifact.project_image`), tag
  OCI explícita obrigatória (`latest` recusado) e teto de recursos que recusa
  em vez de rebaixar em silêncio. Enquanto ele não decide, a aba Code responde
  409 (RN-105). Dentro do container o agente é livre; `git push`, PR e deploy
  continuam nascendo `proposed_action` mesmo pelo terminal, agora garantido por
  `deny` — não só combinado (RN-106). Corte declarado: o ciclo de vida do
  container (provisionar, reciclar, limpar) fica para a fase seguinte, que tem
  o slot de migration desta onda (ADR 0065, revisa o ADR 0055)

- **api,engine**: a pasta do workspace de um projeto NOVO nasce com nome
  legível (`<slug>-<8 chars do id>`) em vez do UUID puro — mais fácil de
  reconhecer abrindo `PROJECT_WORKSPACES_HOST_DIR` no disco. Congelado na
  criação: editar o slug depois não renomeia a pasta. Projeto criado antes
  desta mudança mantém a pasta física que já tinha, sem nenhum rename (ADR
  0066, revisa o ADR 0055, RN-109)

- **api,engine,web**: a Anamnese pode ser pausada GLOBALMENTE
  (`ANAMNESE_ENABLED`, default `false` a partir de agora) — decisão de
  produto do usuário ("hoje ele não está trazendo dados de muito valor"),
  não bug, e não apaga nada do que já existe (RN-115). O scheduler
  periódico para de agendar rodada nova; a rota "reanalisar agora" responde
  503 (distinto do 409 de "projeto sem sessão"); o botão correspondente nas
  Configurações do projeto descobre o estado no primeiro clique e mantém a
  explicação visível na tela

### Correções

- **engine**: `search_workspace` devolvia TODOS os resultados da busca, sem
  teto nenhum — segunda causa real do `413` em revisões de PR, atrás de dev
  agents e dos agentes de QA/gate. Dois tetos independentes: por
  QUANTIDADE de hits (`SEARCH_WORKSPACE_MAX_HITS`, default 500) e por
  BYTES do texto final (`SEARCH_WORKSPACE_MAX_BYTES`, default 32768), cada
  um com sua própria marca de truncagem dirigida ao modelo (RN-150)
- **api,web**: o badge de projeto na sidebar mostrava `latestSeq - seen`
  (atividade não lida) em vez de aprovações pendentes — um projeto de teste
  chegava a mostrar "392" enquanto a aba Aprovações do MESMO projeto
  mostrava "8" (RN-151). O read model do dashboard ganha
  `pendingApprovalsCount` (`COUNT(*)` de `proposed_actions` com
  `status='pending'`, agregado por projeto, sem N+1); o card do Dashboard
  ganha o mesmo número — fio antes morto (`unreadCount` nunca tinha
  chamador)
- **api**: CodeQL marcava "Server-side request forgery" em
  `reanalyzeSession`/`runAnamnese` de `HttpApiToEngineClient`, apesar da
  validação de segmento de URL interna (RN-128) já rodar antes do `fetch` —
  falso-negativo de reconhecimento: o analisador de taint só trata uma
  função como sanitizadora quando o valor validado é REATRIBUÍDO a partir
  do retorno dela, e a chamada existente descartava o retorno de
  `garantirSegmentoDeUrlInterna`, usando a função só pelo efeito colateral
  de lançar. `sessionId`/`projectId` passam a ser reatribuídos a partir do
  retorno; nenhuma mudança de comportamento (a função já devolvia o mesmo
  valor recebido)
- **api**: consultando o banco de uma sessão real, dev agents gastavam
  dezenas de aprovações manuais em subcomandos de exploração — `git branch
  -a`, `git remote -v`, `git worktree list`, `git show`, `git for-each-ref`,
  `git ls-tree`, `git rev-parse`, `git config --get` —, nenhum coberto pela
  allowlist que já libera `git status`/`diff`/`log` (RN-068). Como o
  casamento por prefixo de token exige que TODO segmento de um comando
  composto esteja em `allow`, uma cadeia de exploração longa caía inteira em
  aprovação assim que UM desses subcomandos aparecia no meio.
  `DEV_TERMINAL_ALLOW_PATTERNS` ganha os oito, cada um ANCORADO pela flag
  que torna a leitura inequívoca — nunca pelo verbo pelado — pra não abrir a
  mesma forma truncada que os irmãos MUTANTES aceitam (`git branch -D`, `git
  remote add`, `git worktree add`, `git config <chave> <valor>` continuam
  exigindo aprovação) (RN-143)
- **web**: a aba Criativo listava a sessão de execução VIGENTE misturada com
  ideações de verdade — ela nasce `kind: 'criativa'` (RN-097 exige isso para
  `execution.activated` ser aceito), então o filtro por `kind` sozinho não
  bastava. Abrir essa sessão mostrava uma timeline inteira de tool-calls de
  dev agent, parecendo "o dev escrevendo no chat do Criativo" — achado ao
  vivo numa sessão com 35+ eventos. A aba Criativo agora exclui da lista a
  sessão que `useActiveExecutionSession` devolve (RN-139); a aba Chat nunca
  chama essa busca. Escopo deliberado: execuções ANTIGAS já `closed` não são
  filtradas — o badge `closed` já deixa a diferença clara (RN-144)
- **api,web**: a aba Executores lia a sessão `createdAt` mais recente do
  projeto (`useLatestSession`) para buscar os eventos de dev agent/QA — que
  É a sessão de execução só por COINCIDÊNCIA. Qualquer sessão nova depois
  (uma ideação, um chat) fazia a aba passar a olhar, em silêncio, uma sessão
  vazia de eventos de execução. `GET /projects/:projectId/execution/session`
  (`role:viewer`) expõe por HTTP o MESMO critério que `ActivateExecutionUseCase`
  já usava internamente (`active` com `execution.activated` gravado, ou
  `null`); a aba troca de fonte (`useActiveExecutionSession`) e ganha um
  indicador de QUAL sessão está sendo exibida, nos três estados da RN-088 —
  carregando, erro (com `trace_id`) e "nenhuma execução ativa" (RN-139)
- **web**: três correções no fio da sessão, achadas por investigação de
  código + teste ao vivo no Chrome. (1) O card ACIONÁVEL de handoff
  resolvia sempre pro `offered` mais antigo — como o Arquiteto oferece o
  handoff pro Infra ANTES do Dev Lead na mesma confirmação, e Infra não é
  conversacional nesta tela, o card do Dev Lead nunca ficava acionável na
  prática; agora só handoffs endereçados a quem conversa aqui
  (`AGENTES_DE_CHAT`) viram card, e o de Infra continua narrado como
  divisor mudo (RN-136). (2) O card de aceite do handoff pro Dev Lead
  ganha um botão "Ativar execução" ao lado do link pra Executores — mesma
  `activateExecution` da Visão Geral, agora com `originSessionId` (fecha o
  chat de origem, RN-135); a rota continua exigindo `maintainer`, decisão
  mantida por causa do papel que os dev agents herdam pra abrir PR
  (RN-137). (3) Mensagens consecutivas do mesmo agente colapsam num
  cabeçalho com nome + contagem depois que ele passa o bastão e não tem
  ação pendente — `Disclosure` do design system, fechado por padrão
  (RN-138)
- **api**: `ActivateExecutionUseCase` nunca fechava a sessão de CHAT que
  originou o pedido de ativação — ela ficava `active` para sempre, mesmo
  com a execução já correndo sozinha numa sessão SEPARADA. `execute()`
  ganha `originSessionId` opcional (chamador antigo, sem o parâmetro,
  continua idêntico); informado, fecha a sessão de origem ao final, mas
  nunca a própria sessão de execução, e só quando
  `GetSessionPendingWorkUseCase` — a mesma trava do heartbeat de
  inatividade — confirma que não há handoff/ação/turno pendurado ali
  (RN-135)
- **api**: a sessão que o bootstrap de Git abre automaticamente (Fase 2 —
  criar repositório, `dev`/`qa`, os dois primeiros commits) nasce com o nome
  default `"git-bootstrap"` (RN-130), em vez de `null`. Antes, a lista de
  sessões do Criativo degradava pra hashtag sozinha e não dava pra distinguir
  a sessão automática das abertas pelo usuário sem abrir cada uma. Sessão
  criada manualmente continua sem nome quando o campo vem em branco.
- **api**: quatro alertas CRÍTICOS do CodeQL, duas classes reais de
  vulnerabilidade. `@Query('ref')`/`@Query('path')` da aba Code (RN-095)
  chegam sem DTO no meio, e o `ValidationPipe` global não protege tipo
  primitivo nativo — `?ref=a&ref=b` vira ARRAY no Express, e um array
  escapava de `.includes('..')`/`REF_VALIDO.test(ref)` por ter semântica
  diferente de string; `garantirQueryEscalar` recusa array ANTES de
  qualquer outra checagem, reusada nos dois pontos que tratavam query como
  string (RN-127). Em paralelo, `sessionId`/`projectId`/`agent`/`agentId`
  viravam segmento de URL de requisição interna ao engine sem forma
  validada — `garantirSegmentoDeUrlInterna`, aplicada dentro de
  `postCommand` (cobrindo onze métodos, não só os dois que o CodeQL
  reportou) e nos dois que não passam por ele (RN-128)
- **web**: dois defeitos de UX em `SessionPage.tsx`. Mandar mensagem antes de
  clicar "Iniciar ideação" fazia o convite do Criativo (título, papel, nota)
  sumir PRA SEMPRE — `conviteVisivel` depende de `conversaComecou`, que não
  volta a `false` —, deixando só um botão pelado na topbar sem explicação
  nenhuma; agora uma pista (ícone e nota do Criativo, mesma cor da bolha dele
  no fio, `title` no hover) fica ao lado dele. O contador de regras de
  negócio no painel de contexto passa a usar o mesmo `<Disclosure
  trailing={n}>` do Log de eventos, em vez de um cabeçalho mudo. E entre
  aceitar um handoff e o próximo agente responder a tela não mostrava nada —
  o kickoff do agente no engine é um `GenServer.cast` assíncrono, e o
  `agent.status` "working" que ele já emitia nunca estava plugado
  (`onAgentStatus` existia em `session-channel.ts` desde a RN-108/Fase 4a mas
  nenhum handler de `SessionPage` o usava); agora ele reaproveita o indicador
  de digitação já existente, identificando o agente pelo handoff que acabou
  de ser aceito
- **web**: `write_file` ganha corpo próprio no card de aprovação (RN-096) —
  antes caía no fallback genérico e despejava `path`/`content` como JSON cru
  COLAPSADO, então um write que genuinamente pedia aprovação (fora do
  prefixo `dev-`, ou caminho fora do escopo do agente) exigia um clique
  extra pra ver o que seria escrito. Agora mostra o `path` e um preview do
  `content` (até 25 linhas/4.000 caracteres, com aviso de truncamento),
  aberto por padrão no chat enquanto pendente — mesmo comportamento que
  `terminal` já tinha. Separadamente, `command` (terminal) ou
  `path`/`content` (write_file) vazios — tool-call malformada do modelo —
  agora mostram "o modelo não produziu um X válido para esta ação" em vez
  de um prompt `$ ` ou preview em branco, que lia como bug de renderização

- **engine**: `Engine.Harness.ToolLoop` (o loop compartilhado por dev agents,
  QA Automação/Performance-Segurança, Infra-Workflows, Anamnese e Psicólogo)
  gravava `agent.response` com conteúdo VAZIO — iteração que só chamava
  ferramenta sem texto, ou turno que terminava sem produzir nada — e a tela
  mostrava o balão de compatibilidade da RN-059 como se fosse evento ANTIGO,
  achado ao vivo numa sessão de execução real com dev agents rodando. Falha
  de transporte (provider fora do ar) tinha o mesmo sintoma: virava
  `agent.response` sem `content` em vez de `agent.error`. Estende a RN-059
  (que já cobria os quatro agentes conversacionais, que não passam pelo
  ToolLoop) para este ponto estrutural comum: conteúdo vazio nunca vira
  `agent.response`, e falha de transporte grava `agent.error` durável com a
  origem, pelo mesmo `FalhaDeTurno.origem/1` (RN-129)

- **engine**: `AnamneseSchedulerWorker.perform/1` não conferia a flag
  `ANAMNESE_ENABLED` — só `kickoff/0` (a inserção inicial do job no boot)
  conferia. Uma corrente já agendada ANTES de alguém desativar a flag (ou de
  antes de ela existir) se reagendava pra sempre e rodava rodadas reais da
  Anamnese com a flag dizendo `false`. `perform/1` agora confere `enabled?/0`
  a cada tick: desativado, nem enfileira rodada por projeto nem se reagenda,
  e a corrente morre ali — job antigo que ainda dispara uma vez se auto-cura
  sozinho, sem intervenção manual (RN-115). Conferido: o Psicólogo
  (`PSYCHOLOGIST_ENABLED`) não tem esse problema — o gate dele fica no
  roteamento do evento pelo `Engine.Outbox.Drain`, não numa corrente que se
  reagenda sozinha
- **web**: mensagem duplicada e "Iniciar ideação" preso na topbar depois de
  enviar a primeira mensagem a um agente ativo (Criativo/PO/Arquiteto). A
  conexão do canal Phoenix (ticket + join, RN-108) é assíncrona e podia não
  ter terminado quando o turno acabava — o `agent.done` que a tela dependia
  para resetar `streaming`/a mensagem otimista se perdia sem ninguém ouvindo
  do outro lado, e como nada mais reconciliava esse caminho, o cliente ficava
  preso. `handleSend` passa a reconciliar o mesmo estado quando a própria
  chamada `POST .../agents/:agent/message` resolve — ela só retorna depois
  que o engine termina o turno inteiro (`GenServer.call` síncrono no
  `CriativoServer.user_message/2`), sinal de conclusão tão confiável quanto
  `agent.done`, e idempotente com ele

- **api,engine,web**: o socket Phoenix da sessão (`session:<id>`) exigia só o
  `session_id` existir — quem descobrisse o UUID entrava no canal e recebia
  todos os broadcasts ao vivo. `connect/3` passa a exigir um ticket opaco de
  uso único (TTL de 30s, `POST .../sessions/:sessionId/socket-ticket`),
  consumido atomicamente pelo engine contra o `session_id` do tópico pedido, e
  o join confere também o `project_id` — reconexão (inclusive automática)
  sempre busca um ticket novo (RN-108)

- **api**: o heartbeat podia fechar a sessão com um agente ativado por handoff
  ainda no meio do turno — `AcceptHandoffUseCase` ativa o próximo agente por
  `GenServer.cast` fire-and-forget, e entre a ativação e o agente oferecer o
  handoff seguinte (ou terminar), nem handoff `offered` nem `proposed_action`
  pendente existiam para segurar a sessão. Na cadeia Criativo→PO→Arquiteto
  isso quebrava o encadeamento: o handoff PO→Arquiteto acabava sendo oferecido
  numa sessão já `closed`, que o front não deixa mais aceitar.
  `GetSessionPendingWorkUseCase` ganha um terceiro sinal — o último
  `agent.status` (persistido no event log) de cada ator é `working` sem `idle`
  posterior — genérico por tipo de agente, não hardcoded pro PO (RN-064)

- **api,web**: cinco defeitos de consistência em `SessionPage.tsx`, achados na
  mesma investigação. **(1)** a topbar continuava mostrando o modelo do
  CRIATIVO mesmo depois de um handoff pro PO/Arquiteto/Dev Lead — a rota de
  model-binding da sessão não recebia agente nenhum e caía sempre no fallback
  fixo do Criativo; agora manda `agentId` (o agente REALMENTE ativo) e a
  cascata completa `sessão→agente→área→projeto→workspace` roda pra ele
  (RN-119). **(2/7)** mensagem do usuário e resposta do agente apareciam
  DUPLICADAS quando o poll de 3s de `useSessionEvents` caía no meio de um
  turno em streaming; o hook ganha `pausarPoll` (default `false`, sem afetar
  os outros consumidores), pausado só enquanto o turno está em curso — a
  invalidação explícita no fim do turno continua buscando o dado fresco
  (RN-120). **(3)** sessão criativa exigia o clique separado em "Iniciar
  ideação" antes da primeira mensagem, e digitar direto caía num chat SSE
  genérico sem histórico nem regra de negócio — a primeira mensagem agora
  ativa o Criativo sozinha, pelo caminho real (RN-123). **(9)** depois de
  aceitar um handoff pro Dev Lead, a mensagem seguinte continuava indo pro
  Arquiteto — `activeAgent` usava uma cadeia de precedência FIXA
  (arquiteto > po > criativo) que nunca "desligava"; agora é sempre o
  `agent.activated` mais RECENTE, sem ordem fixa nenhuma (RN-119). **(10)**
  sessão com histórico abria no TOPO (mensagens mais antigas primeiro), sem
  nenhum scroll automático — agora abre sempre no fim

- **web**: três corridas confirmadas AO VIVO navegando `SessionPage.tsx` no
  Chrome (RN-131). **(1)** o convite de boas-vindas do Criativo reaparecia
  por cima de sessões com histórico real — `conversaComecou` olhava só
  `chat.message`/`agent.response`, então uma sessão criada pelo
  `git-bootstrap` (ações de commit/branch já aprovadas) ou a sessão que a
  ativação de execução usa (dezenas de `tool.call`/`tool.result`) mostravam
  o convite por cima do que já tinha acontecido; agora o critério é
  "existe QUALQUER evento". Separadamente, `conviteVisivel` ganha o gate
  `!eventsQuery.isPending`, fechando uma race de cache frio em que o convite
  piscava antes do primeiro fetch de eventos resolver. **(2)** o indicador
  de "pensando" (bolha com os 3 pontinhos) ligava imediatamente a cada
  turno, mesmo nos que respondiam em menos de um segundo — agora só aparece
  depois de 5s sem nenhum texto chegar, e desarma na hora assim que o
  primeiro delta chega ou o turno termina antes do prazo; texto de verdade
  continua aparecendo sem esperar. **(3)** `handleReadiness` (o clique em
  "Estou pronto para produzir") podia deixar a bolha do agente presa vazia
  pra sempre se o canal Phoenix não entregasse `agent.done` a tempo — o
  mesmo bug que `handleSend` já corrigira ganhando uma rede de segurança
  equivalente: chamar `finalizarTurnoDoAgente()` assim que
  `confirmReadiness` resolve, independente do canal
- **engine**: `read_file` lia o arquivo INTEIRO, sem teto de bytes — a
  RN-074 travou a saída do terminal contra `{413, "request entity too
  large"}`, mas deixava essa porta aberta. Confirmado ao vivo no event log
  de uma execução real: os 4 dev agents de um projeto e os QA de
  Automação/Performance-Segurança bloqueados com o mesmo `413`, e sem
  saída pro QA de Performance/Segurança — que só tem `ReadFile`/
  `SearchWorkspace` (sem `Terminal`, de propósito) pra investigar uma PR
  com arquivo grande (lockfile, bundle, gerado). O conteúdo agora corta em
  `READ_FILE_MAX_BYTES` (default 32 KiB), com marca dizendo o arquivo e os
  dois tamanhos (RN-141)

### Correções

- **engine,web**: confirmar prontidão ("Estou pronto para produzir") numa
  conversa sem NENHUMA regra de negócio capturada criava o `product_brief`
  e oferecia o handoff ao PO mesmo assim (RN-142). `CriativoServer` agora
  recusa a confirmação ANTES de subir o turno de consolidação — sem brief,
  sem handoff —, narrando o motivo como `agent.error` durável no fio da
  sessão (origem "politica"), já que a rota HTTP sempre responde 202
  (mesmo padrão do cancelamento, RN-122). O botão nasce `disabled` com a
  dica do porquê, lendo a mesma fonte que já alimenta o painel "Regras de
  negócio"

### Refatorações

- **web**: a árvore de Executores (`AgentTimelineTree`, detalhe expandido de
  `tool.call`/`tool.result`/`agent.response`) passa a usar o mesmo skin
  visual do chat do Criativo — avatar do agente e bolha de mensagem, em vez
  de texto cru num `<pre>`. `ChatBubble.module.css` e `AvatarDoAgente.tsx`
  (novos, em `components/ui/`) viram fonte única dos valores, compostos por
  `SessionPage.module.css`/`AgentTimelineTree.module.css` (mesmo padrão de
  `Textarea.module.css`/`Input.module.css`). Mudança puramente visual: a
  estrutura de árvore (ramo por agente, marco por linha) e o comportamento
  de expandir/colapsar não mudam

### Correções

- **web**: Timeline da sessão: ordenação de cards de aprovação misturados
  com eventos (RN-155), texto do indicador de espera de 5s (RN-156), e
  formato de aviso da criação de épico/história pelo PO (RN-157)

## v2.5.1 — 2026-08-08

### Correções

- **api,docker**: a chave que assina o state do OAuth perde o default (ce212fc5)
- **scripts**: o fixture do teste de promoção sem o campo `branch` (2298a284)
- **api**: CSP fechado na api e escopo de projeto contido na raiz (3ec2cb37)

### Documentação

- **branching**: a ordem do escape da célula, na política (06e3d61c)
- **changelog**: v2.5.0 (b3cc60e6)

## v2.5.0 — 2026-08-08

### Novidades

- **engine,api**: o Dev Lead existe, e e o unico endereco externo da execucao (ba62b6eb)
- **api,engine**: a Anamnese propoe subir o teto, e gastar nunca se auto-aprova (73fb8426)
- **api,web**: o teto de paralelismo configuravel, e enfim consultado (44cdc2f1)
- **api**: o lead decide o paralelismo, e acima do teto você autoriza (daa3ab3f)
- **api,web**: o painel deriva a esteira do registro de gates (d55ccd7d)

### Correções

- **api,docs**: lint da api e o contrato web na arquitetura (87a2d701)
- **web**: renumera as regras para RN-088 e RN-089 (24c168b7)
- **web**: 429 virava tela branca, e a app respondia com mais tráfego (7dfdd8e6)
- **engine**: a corrida do worktree entre dois dev agents (58be13d1)
- **validacao**: a assercao afirma a REGRA, e o Arquiteto decide os modulos (93e4e753)
- **validacao**: --historias nao chegava ao resto do script (a214f593)
- **engine**: o plano do Dev Lead encerra o turno (9bd97241)
- mix format no tool_loop e o inventario de variaveis regenerado (9d34d4da)
- **engine**: o teto de iteracoes e por TIPO de agente (fb3a1975)

### Desempenho

- **web,api**: o sino manda onde parou de ler, e pergunta uma vez só (0eeb87be)
- **web,api**: o dashboard lê o workspace, não um projeto de cada vez (a3cee5ab)

### Documentação

- registra o achado AE e corrige a contabilidade do backlog (6663209c)
- CLAUDE.md com o estado real das fases 14 e 15 (97fa990a)
- a rota de handoff ao Dev Lead na api interna (4ab8e3a8)
- regenera a referencia OpenAPI (43042a88)
- as rotas de area e a assimetria do parallelize (f77bb229)
- **runbook**: o sintoma de teto de iteracoes baixo demais (18ee7233)
- a rota publica de gates e a RN-084 da esteira derivada (88e68500)
- architecture.md registra agent_areas no modelo de dados (04bd39b9)
- permissions.md documenta o tipo de ação parallelize (86e4090b)
- CLAUDE.md com o estado real das fases depois da v2.4.0 (457af4f7)
- **changelog**: v2.4.0 (d266af6e)

### Testes

- **validacao**: --modulos 2, para o paralelismo FAZER sentido (510c5855)
- **validacao**: duas historias no mesmo modulo, e o teto exercitado (80287a06)
- **engine**: restaurar env com nil apagava o default (de0ab417)

### Manutenção

- **deps**: fecha 5 alertas do Dependabot com overrides escopados (50efe887)

## Unreleased

### Novidades

- **docs**: `business-rules.md` deixa de ser uma página de 644 KB — as duas
  seções que sozinhas eram metade dela saem para arquivos próprios
  (`business-rules/custo.md` e `business-rules/autenticacao.md`), e o índice
  cai para 335 KB. Divisão por TAMANHO, não por assunto: nenhuma vírgula de
  conteúdo mudou e nenhuma âncora `{#rn-NNN}` mudou de nome — só o arquivo
  que as hospeda. Os 293 links que apontavam para as RNs movidas foram
  reescritos, incluindo os da tradução pt-BR, e o build do Docusaurus (que
  reprova âncora quebrada) passa nos dois idiomas. O `docs/.docmap.yml` ganha
  `docs_alternativos`, uma DISJUNÇÃO ao lado da conjunção que já existia: uma
  RN mora em um dos três arquivos, e cobrar os três ensinaria a usar o escape
  hatch — regra que ensina a ignorar check é pior que regra nenhuma.
- **docs**: o `docs:check` passa a conferir TRÊS famílias de número escrito em
  prosa, não só a de ADR: a contagem de RNs (fonte: os cabeçalhos `### RN-NNN`
  do `business-rules.md`) e a de providers de LLM (fonte: os literais
  `capabilities` que a tabela gerada de `llm-providers.md` já lê) entram na
  mesma aferição. O gatilho foi medido, não previsto: o README anunciava "as
  158 RNs" com 331 escritas — errado por mais do dobro, na tabela que
  apresenta o repositório —, e corrigir à mão só reinicia o relógio. Número
  que não bate REPROVA com o valor certo na mensagem; frase alterada reprova
  como `CEGO`, de propósito, porque check que parou de achar a frase fica
  verde para sempre dizendo que conferiu algo que não olhou.
- **ci,k8s**: as quatro imagens de produção passam a ser PUBLICADAS no GHCR
  a cada tag final (`ghcr.io/<dono>/brabo-{api,engine,web,backup}`, públicas),
  fechando a dívida declarada mais cara dos ADRs 0025/0027 — até aqui o
  `release.yml` construía com `push: false` só pra provar que a tag era
  construível, e o overlay de produção apontava pra `ghcr.io/OWNER/*` com um
  `newTag: REPLACE_WITH_DIGEST` que nenhum passo substituía (ADR 0119). O
  login usa o `GITHUB_TOKEN` do próprio job (`packages: write`): nenhum
  segredo novo pra rotacionar. O que cada tag publicou fica registrado POR
  DIGEST em `.release/images.json` — anexado à GitHub Release no mesmo
  instante da tag e versionado pela PR do CHANGELOG que o release já abria,
  SEM abrir uma terceira exceção de push direto. O overlay continua guardando
  o marcador, e `make imagens-do-release OVERLAY=prod|staging` aplica o digest
  com `kustomize edit set image` — quem faz o deploy decide qual release está
  em produção, não a tag. Achado no caminho: os overlays listavam TRÊS
  imagens, não quatro — o CronJob de backup herdava `brabo-backup:prod`, nome
  que não resolve em registry nenhum, então o backup do ambiente que mais
  precisa dele nunca subiria. Nada passa a fazer deploy sozinho: `DEPLOY_ENABLED`
  continua não existindo, e assinatura/atestação das imagens segue de fora,
  junto com o code-signing dos binários do runner.
- **api,shared**: o contrato de git ganha `listTree` e `getPullRequestDiff`, a
  11ª e a 12ª operações, que a aba Code (FASE 26) vai precisar. Entram como
  capability, e são `true` nos três providers só porque a **suite de contrato
  única as prova nos três** — o critério dos ADRs 0041/0042, que vale para git:
  sem prova, declara-se `false` e degrada. São LEITURA e só: `listTree` devolve
  UM nível da árvore, nunca a árvore inteira, e `getPullRequestDiff` normaliza o
  diff de uma PR (`status`, `additions`, `deletions`, `patch`). As duas cortam
  com teto e avisam por `truncated`, para a aba não virar amplificador de
  tráfego; os números moram em `apps/api/src/domain/git/git-read-limits.ts`, e
  não no `packages/shared`, que é 100% tipo. Ausência é `null`, o mesmo
  vocabulário de `getFileContent`. Junto vem a trava do item 33 da fase:
  **operação de contrato sem consumidor em `src/` reprova o CI**, com uma saída
  estreita e nomeada para as duas — ela se fecha sozinha, porque passa a
  reprovar assim que a rota da 26b existir. Uma degradação declarada: o GitLab
  não traz tamanho de arquivo na árvore, então `size` vem `null` ali.
- **api**: a superfície HTTP de **leitura** de código que a aba Code consome —
  árvore, arquivo, busca e diff de PR, em quatro `GET` sob
  `/projects/:projectId/code/`, todas `role:viewer`. **Nenhuma escreve, e o
  controller não tem um único verbo de escrita**: ler não é efeito externo e não
  vira `proposed_action`; escrita é fase seguinte, e vai nascer como uma. A
  trava da 26a fechou junto — `listTree` e `getPullRequestDiff` deixaram de
  estar na lista de operações sem consumidor, porque agora têm um.
  **Contenção (RN-095)**: todo caminho vindo do cliente passa por UMA função, no
  mesmo arquivo do `projectScopeRoot` da RN-092, reusando as primitivas de
  escopo do ADR 0055 — `../`, absoluto e byte NUL são recusados com 400
  **antes** de o provider ser chamado, e o que volta é o caminho normalizado,
  porque conferir uma string e mandar outra é o jeito de a contenção existir e
  não valer. Não é sobre ler o arquivo errado: em GitHub/GitLab o caminho vira
  segmento de URL da API do provider, e um `..` troca de **endpoint** com o
  token do owner do workspace na mão. **Teto**: a busca não é operação do
  contrato de git (nenhum dos três providers a tem) — é composta sobre a árvore
  e o conteúdo, com três orçamentos que a param, cache de TTL curto e
  `truncated`/`filesScanned` na resposta, senão a aba viraria a mesma família de
  defeito dos 3.824 req/min do dashboard. A credencial gasta é a do **owner**
  (RN-058/RN-082), como na escrita. Ver [ADR
  0060](docs/adr/0060-superficie-de-leitura-de-codigo.md).

### Correções

- **api,docker**: `GIT_OAUTH_STATE_SECRET` deixa de ter default em produção — a
  api **não sobe** sem ela, com a chave de exemplo do repositório, ou com menos
  de 16 caracteres. Essa chave assina o `state` do OAuth de git, e o `state` é o
  que impede o callback de ser forjado; o default era público (está no
  `.env.example`), e o `docker-compose.prod.yml` o supria como fallback, então
  esquecer a variável subia produção assinando com uma chave conhecida — sem
  nenhum sinal. Rejeitar só o valor vazio não resolveria: no caminho real de
  erro a variável estava definida. **Quebra deliberada**: quem sobe o compose de
  produção precisa exportar a variável (o README mostra como; o `smoke.sh` gera
  a dele). Em Kubernetes nada muda. Ver ADR 0059 e RN-093

- **api**: a api passa a mandar `Content-Security-Policy` em toda resposta, e em
  produção ele nega tudo (`default-src 'none'`, mais `frame-ancestors`,
  `base-uri` e `form-action` em `'none'`). Antes o cabeçalho não era mandado —
  o argumento registrado no ADR 0027 era que o CSP é da web, o que continua
  verdade e não é o ponto: uma rota da api aberta DIRETO no browser (link
  colado, redirect) é renderizada na origem da api, onde o CSP da web não vale,
  e `frame-ancestors` só tem efeito no documento emoldurado. Fora de produção o
  perfil afrouxa apenas o que o Swagger UI de `/docs` exige. Nada muda para a
  web, que consome JSON: `Cross-Origin-Resource-Policy` segue permitindo outra
  origem, agora dito (`cross-origin`) em vez de omitido. Ver ADR 0058

- **api**: um `projectId` malformado deixa de escapar da raiz dos workspaces. O
  id chega do parâmetro de rota já com o percent-encoding decodificado pelo
  Express, então `..%2F..%2Fetc` chegava como `../../etc` e o caminho resolvia
  para fora — o que atingia tanto a leitura e ESCRITA do `permissions.json`
  quanto o escopo que autoriza comando de terminal (ADR 0055), isto é, a
  política de aprovação apontando para o lugar errado. Agora a raiz do escopo
  recusa o que não for segmento de caminho simples. O caminho feliz não muda:
  todo id real é UUID vindo do banco

- **ci**: o corpo do PR de promoção não quebra mais a tabela quando um título de
  PR termina em contrabarra antes de um pipe — escapar só o pipe produzia
  `\\|`, que o GFM lê como contrabarra escapada seguida de delimitador de coluna

- **web,api**: o dashboard não derruba mais a si mesmo quando o workspace tem
  muitos projetos. Cada card pedia sete coisas à api por conta própria e ficava
  repetindo o pedido a cada poucos segundos; com 23 projetos isso dava quase
  3.900 requisições por minuto contra um limite de 300, e a tela voltava cheia
  de erro antes de terminar de carregar — o mesmo valia para a barra lateral,
  que fazia isso em toda tela do app, não só no dashboard. Agora a grade
  inteira chega numa resposta só, e o custo deixa de crescer com o número de
  projetos: medido no navegador, caiu de 3.824 para 12 requisições por minuto.
  A tela mostra exatamente o que mostrava. A gaveta do sino passa a buscar as
  notificações quando você a abre, em vez de o tempo todo

- **web,api**: o painel de notificações também deixa de perguntar um projeto de
  cada vez. Com a gaveta aberta num workspace de 23 projetos ele fazia 286
  requisições por minuto, contra um limite de 300 — passava por pouco, e sumia
  com um projeto a mais. Agora o navegador diz de uma vez até onde já leu cada
  projeto e recebe tudo numa resposta: 12 requisições por minuto, sem mudar nem
  o conteúdo da gaveta nem a rapidez com que ele se atualiza

- **deps**: cinco alertas do Dependabot fechados por `pnpm.overrides` em
  `pnpm-workspace.yaml` — todos transitivos, nenhum tocado por bump direto de
  `package.json`. `js-yaml` (HIGH, GHSA-5p4m-2wfm-xmqj, DoS em `!!omap`) teve
  a faixa existente ampliada de `<4.3.0` para `<4.3.1`; `mermaid` (3
  MODERATE + 1 LOW, via `@docusaurus/theme-mermaid`); `postcss` (MODERATE,
  CVE-2026-69153, via a árvore `@csstools/postcss-*`); `fast-uri` (HIGH,
  CVE-2026-18446, via `ajv`/`@redocly/ajv`); `undici` (HIGH + 3 MODERATE,
  via `cheerio` e `jsdom`). Nenhum dos cinco chega no runtime da api ou do
  web em produção — são tooling do `website` (Docusaurus) e devDependency de
  teste (`jsdom`). Ver `pnpm-workspace.yaml` para o detalhe de cada faixa.

- **deps**: mais dois alertas fechados pelo mesmo mecanismo. `nanoid` (HIGH,
  CVE-2026-67213 — laço infinito com `size` zero), que entra por `postcss`; e
  `dompurify` (MODERATE — `IN_PLACE` deixa subárvore destacada executável,
  reabrindo XSS), que entra por `mermaid`. Os dois pais já eram alvo de override
  próprio. Segue aberto `image-size` (2 HIGH, DoS nos parsers ICNS/JXL/HEIF):
  não há versão corrigida publicada, a última do registry é a vulnerável — entra
  por `@docusaurus/mdx-loader` e só lê imagens versionadas neste repositório

- **api**: as áreas de agentes (`dev`, `qa`, `infra`) passam a existir de fato
  em cada projeto — antes a tabela nunca era gravada. A tela de Configurações
  listava vazio, a proposta da Anamnese para subir o teto de paralelismo era
  recusada com "área não existe neste projeto" em TODO projeto, e o teto que
  decide quantos agentes o produto sobe sem perguntar caía num default que
  ninguém tinha escolhido. Agora a área nasce junto com o projeto, na mesma
  transação, e a ativação da execução acrescenta os membros da área de dev (um
  por módulo). Projetos criados antes disso são corrigidos por migração, sem
  ação sua e sem mexer em teto que você já tenha alterado. Junto vai o fim de
  uma duplicação que sustentava o defeito: a lista de áreas existia escrita à
  mão em três lugares (api, web e engine), e agora tem uma fonte só, com as
  outras duas geradas por `pnpm --filter api gerar:areas`. Ver RN-094

- **web**: a aba Insights deixa de dizer "sem hipóteses ainda" quando a busca
  FALHOU. Era o mesmo `data ?? []` seguido de `length === 0` que a RN-088
  descreve: uma api respondendo 429 ficava indistinguível de um projeto que o
  Psicólogo nunca analisou. Agora a aba distingue carregando, erro (com a frase
  da api, o `trace_id` e o botão de tentar de novo) e vazio — nessa ordem, com o
  erro ANTES do vazio. A aba Aprovações ganha o mesmo tratamento nos seus quatro
  blocos, e o mais caro deles é a fila: "Tudo limpo — nenhuma aprovação
  pendente" sobre uma busca que falhou é a mentira mais cara que essa tela pode
  contar. A busca de regras que não acha nada agora diz "nenhuma regra
  corresponde à busca" em vez de "nenhuma regra configurada ainda"

- **web**: no card de hipótese, a confiança ("62% de confiança") vazava para
  fora do card e era desenhada por cima do card vizinho quando a coluna da grade
  ficava estreita. Achado pela validação visual no navegador, não por teste —
  jsdom não mede layout. Junto, dois alvos de clique que estavam abaixo do piso
  de 24px da WCAG 2.2 AA (os chips de evidência da hipótese e o de diff no
  histórico de instruções)
### Refatorações

- **web**: as telas de **Projeto** e **Sessão** passam a seguir o handoff de
  design (`design_handoff_brabo/`, seções 4 e 5). Nenhuma regra de negócio
  muda, e nenhuma tela ganha ou perde informação — o que muda é a forma. No
  Projeto: cabeçalho e régua de abas viram uma faixa só, com uma divisória em
  vez das duas que apareciam empilhadas; o repositório se apresenta em um chip
  (`local · privado`) e a branch padrão ganha o ícone e o destaque que o desenho
  pede; e a coluna de Atividade deixa de ser um card boiando a 24px da borda
  para virar o trilho de 360px do desenho, com rolagem própria — antes a página
  rolava inteira e o feed sumia de vista assim que a lista de agentes crescia.
  Na Sessão: a barra de topo ganha o fundo que a distinguia do chat, o balão de
  mensagem ganha contorno, o avatar ganha o anel na cor do agente, e a marca de
  passagem de bastão vira a frase que o desenho escreve (`Criativo → passou o
  bastão ao PO`) em vez do `handoff → po` cru — os dois nomes já estavam no
  evento, e metade se perdia. O painel de contexto se nomeia ("Contexto da
  sessão") e separa as seções por divisória. Três correções vieram junto, todas
  achadas ao comparar com o desenho: o **ponto de estado** era verde fixo, então
  uma sessão encerrada exibia o mesmo sinal de "ao vivo" de uma em curso (agora
  ele acompanha a máquina de estados e tem rótulo para quem não vê cor); o
  agente respondendo aparecia pelo **id** (`criativo`) depois de o evento
  persistir e pelo **nome** (`Criativo`) enquanto falava; e o título do convite
  do Criativo pedia `--font-display`, que não existe em `design/tokens.css`, e
  caía na fonte do navegador. Botão "Encerrar" passa a ter a aparência
  destrutiva que o desenho lhe dá. Verificado no navegador com
  `scripts/dev/validacao-visual.js`: nenhum achado de layout nas duas telas

### Manutenção

- **design**: o handoff de design passa a viver no repositório
  (`design_handoff_brabo/`: especificação + 8 telas de alta fidelidade), e
  `design/tokens.css` fecha contra ele. Entra `--violet` (`#9c7be0`, agentes/IA)
  — a última cor do handoff sem token, já hard-coded em quatro lugares do web
  justamente porque não havia o que referenciar — e `--shadow-lg`, a sombra
  grande do login, que cada tela que precisasse dela ia acabar escrevendo por
  conta. **Mudança visível**: `--shadow` estava mais rasa que a especificada
  (`0 8px 24px` a .35) e passa ao valor do handoff (`0 12px 32px` a .45), o que
  aprofunda a sombra de todo card, modal e dropdown. O teste de contraste cobre
  `--violet` nos quatro fundos em que ele é usado e ganha uma trava nova de
  paridade entre os temas: token semântico de cor declarado só no escuro não
  some no claro — ele VAZA, e o defeito aparece longe do commit que o causou. A
  dívida conhecida de contraste segue intocada, nos mesmos 4 pares. As fontes
  continuam **auto-hospedadas**: é a única divergência deliberada em relação ao
  handoff, que pede o `<link>` do Google Fonts — seguir esse item reintroduz a
  falha que o ADR 0036 fechou, porque a CSP do nginx bloqueia a folha e os
  arquivos

- **web**: **Aprovações** e **Configurações** passam a seguir o handoff
  versionado (`design_handoff_brabo`, seções 6 e 7). Só aparência: quem pode
  aprovar, o que a política decide e o pipeline de `proposed_action` não mudam.
  No card de aprovação, o card recorta e cada região traz a sua divisória —
  cabeçalho, corpo e ações deixam de flutuar dentro de uma moldura de 16px; o
  nome do agente ganha peso de título, a faixa que abre o diff vai para
  `--surface-2`, e o resumo da PR sai da caixa de código onde não deveria estar.
  Na fila, o vazio vira a moldura tracejada do desenho e a barra de seleção em
  lote sobe para o cabeçalho da seção, com "Limpar" — a faixa antiga empurrava a
  lista 44px a cada primeiro clique. Em Configurações, o repositório vira um
  card com o caminho em mono, as credenciais viram o **grid de conectores**
  (borda esquerda na cor do provider, sigla de duas letras, tipo e status
  pulsante) e o seletor de modelo ocupa a célula inteira da tabela, com o nome
  completo no `title` porque ali ele elipsa. `--violet` deixa de estar
  hard-coded no card de hipótese. **O que NÃO foi feito, e por quê**: a chave
  mascarada do desenho (é write-only, ADR 0050), "Selecionar todas" na fila
  (transformar aprovação em massa num clique é decisão de produto), a
  ordenação por urgência (nada no domínio classifica urgência de uma ação) e a
  seção "Melhores modelos por capacidade" (não há métrica de qualidade por
  modelo). Estão escritas em `design/SCREENS.md`
- **web**: o login e a lista de projetos passam a seguir o handoff, e o produto
  volta a ter **uma** marca só. A sidebar exibia um cubo isométrico enquanto as
  telas de auth exibiam o monograma B: o símbolo trocava exatamente na passagem
  do login para o app, e agora é o monograma nos dois lugares (o cubo continua
  disponível como ícone genérico, dito no código que não é a marca). No login, o
  campo de e-mail e senha afunda em `--code-bg` como na referência — divergência
  que o ADR 0036 registrara e que não se sustentava, já que afundar separa o
  campo do card igual e ainda melhora o contraste —, o card e o selo passam à
  sombra grande (`--shadow-lg`, que a FASE 16 trouxe justamente para isso) e o
  botão "Entrar" ganha os 44px que o handoff pede para a ação principal de uma
  tela; ele media 33px. Na lista de projetos, o medidor de tokens de cada card
  deixa de ter o mesmo fundo do card que o contém — a caixa desaparecia e
  sobrava a borda —, a última atividade ganha o fio que a separa do medidor e sai
  de `--text-muted` (3.89:1, a dívida conhecida) para `--text-secondary`, e o
  respiro do card, o raio dos avatares e o título da barra de topo (que virou um
  `<h1>` de verdade) alinham com a referência. Nenhuma regra de negócio muda; os
  três estados da RN-088 e a economia de requisições da RN-090/091 seguem como
  estavam. Duas coisas do handoff **não** entraram porque são comportamento e
  não pintura, e seguem declaradas: o "Continuar com GitHub" do login e o
  indicador "N agentes online"

## v2.4.0 — 2026-08-07

### Novidades

- **engine,api**: existe um **Dev Lead**. Quando você confirma que a
  arquitetura está pronta, ele recebe o trabalho junto com o Infra e propõe o
  plano de execução: quantos agentes em cada módulo e por quê. Antes, o
  Arquiteto terminava e a execução subia por um botão, sem ninguém no meio
  avaliando quanto trabalho havia — o teto de agentes já existia, mas a frase
  "quem decide é o lead" não tinha a quem se referir. Ele não escreve código.
  Como consequência, os dev de módulo deixam de receber handoff direto: quem
  fala com a execução de fora passa a ser o lead, como já acontecia com QA e
  Infra


- **engine**: quantas voltas um agente pode dar antes de desistir deixa de ser
  um número só para todos e passa a depender do trabalho que ele faz. O limite
  de 8 tinha nascido para agente de conversa, e era o mesmo do dev agent: numa
  execução real ele gastou as oito procurando onde ficava o projeto num
  repositório recém-criado e não chegou a escrever nada, terminando com uma
  mensagem que culpava o modelo por algo que o modelo nunca teve chance de
  fazer. Agora quem escreve código e quem revisa PR têm folga, e quem conversa
  continua no mesmo lugar — subir o limite de todo mundo teria feito o agente
  de conversa gastar mais sem motivo. Quem ganha folga é só quem já tem um
  teto de custo próprio por baixo

- **api,engine**: a Anamnese passou a reparar quando autorizar mais um agente
  virou rotina. Se você aprovou o mesmo pedido três vezes na janela e não negou
  nenhuma, ela propõe subir o teto daquela área — com o número de aprovações
  como justificativa. Uma única negação derruba a proposta: se você recusou
  alguma vez, o teto está fazendo o trabalho dele. A proposta **nunca se aprova
  sozinha**, e nem a de ultrapassar o teto: as duas ações que mexem em quanto o
  produto gasta sem perguntar agora são intocáveis por qualquer configuração de
  autonomia. Sem isso, um `permissions.json` permissivo tornaria o limite
  decorativo — e o produto poderia elevar o próprio teto de gasto


- **api,web**: o teto de agentes de cada área virou configurável em
  Configurações, e — mais importante — passou a valer de verdade. A regra do
  teto tinha entrado antes, mas nenhuma tela a consultava: o botão de subir mais
  um agente ainda ia direto, sem passar por ela. Agora o pedido passa, e quando
  ele estoura o teto a tela diz que **nada subiu** e que a decisão está
  esperando você em Aprovações — antes ela teria dito que o agente entrou, e
  você só descobriria que não pelo trabalho que não anda

- **api,web**: a esteira de gates no painel deixa de repetir a lista de etapas
  e passa a derivá-la do registro. O ganho não é visual: gate que sai do
  registro sai da tela sozinho — antes, desativar um deixava uma etapa morta
  até alguém lembrar de editar o código, que é exatamente o envelhecimento que
  o registro existe para impedir. A rota nova é do usuário logado e separada da
  interna, que serve o script de medição; ela devolve só os gates ativos,
  porque um gate planejado numa tela que mostra o agora apareceria como se
  estivesse acontecendo

- **api**: quantos agentes sobem numa sessão deixa de ser um número fixo no
  código e passa a ser decisão do lead da área — com um teto acima do qual você
  autoriza. Até o teto (2 por padrão) ele sobe e segue; acima disso vira uma
  ação pendente de aprovação, como toda ação com efeito externo, e a decisão
  fica registrada com o seu nome. O teto é da SESSÃO e não do módulo: contar
  por módulo permitiria muitos agentes sem autorização nenhuma, que era o
  buraco anterior com outro nome. As áreas de agente viram dado por projeto,
  no lugar da lista fixa em código — o que forçou a mudança foi a área de dev,
  cujos membros são um por módulo decidido pelo Arquiteto e portanto
  diferentes em cada projeto

- **engine**: o agente de gate espera a aprovação, como o dev espera (95ae7074)

### Documentação

- **changelog**: v2.3.0 (6f6f5be4)

## v2.3.0 — 2026-08-07

### Novidades

- **api**: amplia o allowlist do roteiro com critério explícito (a2d92a61)
- **api**: as fases backlog e execucao da validação real (e5d0edc9)
- **api**: a validação REAL da 13b começa, e a adoção remota está provada (f2882efa)
- reconhecer a falha ao proteger branches e seguir (Fase D, achado D) (82ef9a7e)
- o engine trabalha em repositório remoto (ADR 0056, achado N) (5efbbc6f)
- **api**: escopo de caminho na política de terminal (ADR 0055, achado U) (7c743982)
- **api**: sem escolha explícita, o modelo é o do Criativo (50ea7136)
- **api**: GET /internal/gates, e o registro dentro da imagem (1422629e)
- **api**: loader e medidor dos gates, com RN-070 e RN-071 (815af274)
- **docs**: os gates de CI no registro, e infra partido em dois (505ed78e)
- **api,docs**: FASE 15 e o registro declarativo de gates (7d766c4d)
- **web**: linha do tempo do time em árvore, e a FASE 14 no CLAUDE.md (19c86b5b)
- **web**: validação automática de contraste e de layout (62298567)
- **api,web**: o owner vê quanto as chaves dele gastaram (1ef1e71b)
- **engine,web**: falha de turno vira evento durável, e o agente fala (53bc32ee)

### Correções

- **api**: ReDoS polinomial no escopo de caminho (CodeQL HIGH) (17edbf9d)
- **api**: remove asserção redundante que o lint do CI pegou (9defddf3)
- **api**: redirecionamento não encadeia comando, e /dev/null não é caminho (67736ddd)
- **engine**: ação pendente num gate é origem POLITICA, não infra (b737874f)
- **api**: a credencial de git é do OWNER, não de quem decidiu a ação (c714d986)
- **engine**: a busca dizia a mesma coisa para "não achei" e "não há o que achar" (4f37e5a4)
- **api**: o medidor reprovava execução passada por restart posterior a ela (2bff2d6c)
- **api**: o aceite do OpenRouter rodou com credencial real, e estava podre (106c697d)
- **engine**: dev agent morria em vez de ir para idle quando a fila esvaziava (1a4c6dc5)
- **engine**: o Noop morria ao receber task.pr_settled, e a validação parava na 2ª task (a3874ffb)
- **api,engine**: o instrumento da validação da Fase 12 não conseguia chegar ao fim (a5867502)
- **engine,api**: os artefatos dos agentes param de nascer duplicados e a análise vazia (3c77de14)
- **api**: ação aguardando decisão segura a sessão (Fase H, achado V) (ef922005)
- **web**: remover `allModels`, que ficou órfão ao sair o `selectedModel` (9846410a)
- **web**: o feed narra o bootstrap, e o card para de inventar o modelo (12641ed7)
- **web,engine**: quem fala é o agente, e o convite e o rodapé param de mentir (26bc9ada)
- **engine**: a origem da falha é sempre uma das quatro (Fase G) (02c48dd1)
- **engine**: teto de bytes na saída de terminal, que sem ele mata a execução (445efb1e)
- **api**: o desfecho da ação nascia num agregado que o engine não lê (2ba5d14e)
- **engine**: a espera perdida no restart bloqueava em silêncio (09cd39f7)
- **api,engine**: o dev agent não conseguia explorar nem retentar (73e30e69)
- **api**: sessão criada fora do use case nascia sem processo no engine (6d665b70)
- **api,engine**: o Arquiteto adivinhava nome de módulo por força bruta (a69d6377)
- **web**: ActionType incompleto derrubava a tela da sessão (0d341cd5)
- **engine**: o turno em streaming caía no timeout default do Req (91d801ee)
- **api**: o medidor lia o ator do evento em vez do agente (a5af9765)
- **api**: o Arquiteto reemitia o module_map em laço (9e13020c)
- **api,engine**: heartbeat matava sessão com trabalho pendente (131c7289)
- **engine**: a Anamnese não tinha como dizer "não há nada a emitir" (b673d886)
- **engine**: três defeitos que só a execução real revelou (fae389c2)
- **api**: nenhum agente conseguia usar provider com credencial (376f53a6)
- **api,web**: o bootstrap morria em todo projeto GitHub novo (ee4f5b13)

### Documentação

- achado AD — o allowlist de verbos não converge, e a 13b conclui isso (b8f451a8)
- achado AC — redirecionamento torna qualquer comando inaprovável (f11dc942)
- a PR abriu no GitHub, e o gate não sabe esperar aprovação (5c5eaca6)
- permissions.md diz com qual credencial a ação auto-aprovada executa (d3837829)
- conserta o link do ADR 0052 que eu inventei (781ef443)
- a 5ª execução chega ao GitHub, e o pr_open auto-aprovado não tem credencial (abc25adf)
- o teto era a causa do achado X, e a Fase F não fecha a escada (9f2840f8)
- a correção do achado Y não fechou o X, e isso está registrado (42829b61)
- a validação real da 13b, executada e medida (41e1fb0b)
- o contrato do claim diz que fila vazia é 201 sem corpo (225f50a2)
- a validação da Fase 12 executada, com os event ids do banco (1d051fad)
- o glossário diz o segundo motivo de recusa de um artefato (549d6947)
- gates.md deixa de afirmar uma lacuna que foi fechada (c3217af3)
- a política e o registro de gates apontam a spec do promotion-check (6ad781f0)
- o remoto de trabalho no contrato api↔engine (86962106)
- ADR 0056 — o engine trabalha em repositório remoto (21b07147)
- a Fase A já estava feita, e o backlog não sabia (e71d6274)
- os dois achados que faltavam, e o quadro cobrindo os 19 (436f25ac)
- o 413 que matou a execução, e a origem que continua fora das quatro (d9f1d2eb)
- ADR 0055 — escopo de caminho na política de terminal (b8de978f)
- o wake precisa chegar, e o restart é a exceção que a página não dizia (baeb39a0)
- o que acontece com o agente enquanto a decisão não vem (592a24e2)
- RN-073, o ADR 0052 aceito, e duas frases podres no índice (1f477e03)
- FASE 13c — a triagem dos achados e o backlog consolidado (b4a5087d)
- ADR 0053 — o Dev Lead é agente conversacional na cadeia de handoff (1369969d)
- ADR 0053 — Dev Lead como área, e paralelismo autorizado (c57f3ad8)
- RN-068 e RN-069, e a allowlist do dev em permissions.md (d325c3fc)
- índice e contagens de ADR com o 0052 (cff3bedd)
- ADR 0052 — o dev agent espera a aprovação no meio do laço (985921b0)
- o link do ADR 0041 tinha o nome de arquivo errado (535c4d24)
- a colheita da primeira execução com modelo de API (62d23221)
- **changelog**: a versão do README acompanha o corte da v2.2.0 (6d2fafd6)
- **changelog**: v2.2.0 (5b83391b)

### Testes

- **ci**: spec do promotion-check, o único check required sem teste (9e0d625e)
- **engine**: a corrente do outbox até o agente, provada de ponta a ponta (fdba5f73)
- **engine**: a suspensão e a retomada do laço, provadas (d3e1e11a)

### Manutenção

- **ci**: o teto do nome de função sobe de 15 para 30 caracteres (344f6089)
- **engine**: postgrex 0.22.4 fecha a advisory EEF-CVE-2026-66838 (cea7e837)
- o inventário de config e a formatação que só o CI pegou (21198d6e)
- os achados da execução real em docs/, e quatro deles corrigidos (4dd7a073)
- **engine,docs**: formato do Elixir e as três docs que o drift cobrava (e01ee61f)
- **ci**: o release passa a escrever a versão do README junto do CHANGELOG (41f02548)

## v2.2.0 — 2026-08-04

### Novidades

- **api,web**: facetas de capability lidas do provider e curadoria por uso (e722470b)
- **web**: catálogo agrupa hub por fabricante, com colapso (88a1169a)
- **web,api**: Configurações segue o mockup e ganha custo por agente (ba0f2d3c)
- **api,web**: credencial sempre cifrada; verificar vira ação à parte (99b9fa72)

### Correções

- **engine**: um agente de gate que esbarra numa aprovação pendente deixa de
  matar o gate. Ele agora **espera** — como o dev agent já fazia — e a decisão o
  retoma de onde parou, com o resultado de verdade no lugar onde estava a
  palavra "pendente". Antes a suspensão era classificada como falha de
  infraestrutura, a tarefa era bloqueada por uma decisão que ninguém tinha
  tomado, e o clique do usuário chegava tarde demais para servir. Enquanto está
  esperando, a área de QA não consolida, não emite veredito e não bloqueia nada.
  Recusa também retoma: o motivo entra no lugar do resultado, e o agente aprende
  que aquele caminho fechou em vez de esperar para sempre

- **api**: comando com redirecionamento deixa de exigir aprovação sempre.
  `2>/dev/null` é idioma — modelos o usam o tempo todo para silenciar erro
  esperado —, mas o parser tratava `>` como se encadeasse um comando novo, e o
  alvo virava um segmento cujo "verbo" era o próprio caminho. Como comando
  composto só é auto-aprovado quando todo segmento está liberado, qualquer
  redirecionamento caía em aprovação, e a autonomia ficava inútil na prática.
  Agora `>`, `>>` e `<` não quebram segmento, e os fluxos padrão e o
  `/dev/null` deixam de contar como caminho de usuário. **O que não mudou:**
  redirecionar para fora da pasta do projeto continua barrado, `/dev` não foi
  liberado inteiro, e `&&`, `|` e `;` continuam separando — cada uma dessas
  três garantias tem teste próprio

- **engine**: um agente de gate que esbarra numa ação pendente de aprovação
  deixa de registrar "falha de infraestrutura". Nada quebrou — a decisão apenas
  não foi tomada, e o log agora diz isso, nomeando a ação e a ferramenta para
  que dê para encontrá-la e decidi-la. O gate ainda bloqueia a task: o laço dos
  agentes de gate é síncrono e não sabe retomar de onde parou, ao contrário do
  dev agent. O que muda é parar de culpar a infraestrutura por uma decisão
  pendente

- **api**: nenhum dev agent conseguia abrir PR em repositório remoto quando a
  autonomia estava ligada. A credencial de git vinha de quem DECIDIU a ação — e
  ação auto-aprovada por política não tem decisor, então o token ficava vazio e
  o GitHub recusava. Agora vem do dono do workspace, pela mesma regra que já
  valia para as chaves de modelo. O contraste que expôs o defeito estava dentro
  de uma execução só: o push funcionava e a PR falhava, porque cada um resolvia
  a credencial por um caminho diferente

- **engine**: a busca no workspace deixa de dizer a mesma coisa quando não
  encontra e quando não há o que encontrar. Num projeto novo, o dev agent lia
  "nenhum resultado" como "refine a busca" e repetia buscas até esgotar o teto
  de iterações — bloqueado sem ter rodado um comando nem escrito uma linha.
  Agora um workspace sem arquivo nenhum responde que está vazio e manda criar;
  um workspace com arquivos responde quantos tem, deixando claro que a busca
  funcionou e o termo é que não aparece. A correção é a frase, não o teto: o
  agente não precisava de mais iterações, precisava saber que não havia o que
  procurar

- **api**: o aceite do OpenRouter contra a API real voltou a funcionar. Ele
  nunca tinha rodado — sem chave, a suite inteira é pulada — e por isso tinha
  apodrecido em silêncio contra a mudança que levou a curadoria de modelo para
  o escopo de workspace: afirmava um campo que não existe mais no catálogo
  global e montava dois casos de uso com assinaturas antigas. Nada disso era
  detectável por CI, porque o typecheck da api não cobre os testes. Agora
  afirma a regra pelo caminho certo — modelo descoberto nasce desligado
  naquele workspace, e desligado é a ausência de linha

- **engine**: o dev agent **morria** quando a fila do módulo esvaziava, em vez
  de ficar ocioso. Com nada a reivindicar, a rota de claim responde `201` sem
  corpo — o caso de uso devolve `null`, mas isso vira resposta vazia, e o
  cliente entregava `""` no lugar de `nil`. O agente tratava a string vazia
  como se fosse uma task e estourava, e como o processo não é reiniciável, ele
  morria de vez, com o estado apagado logo atrás. É o oposto do que a Fase 12b
  entregou: em vez de um agente ocioso, supervisionado e acordável por evento,
  processo morto — e no desfecho mais comum que existe, o da fila acabando.
  Nenhum teste pegava porque o dublê da suite devolvia o valor certo; só
  execução real expôs

- **engine**: o dev agent de validação (sem LLM) não abria o gate depois de
  publicar a PR — marcava a tarefa como em revisão e parava aí, deixando o
  gate sem nada para julgar. E morria ao receber o aviso de que a PR foi
  resolvida, quando o gate já estava aberto. As duas coisas faziam a validação
  da Fase 12 travar sem dizer por quê

- **api**: o roteiro de validação da Fase 12 criava o repositório-cobaia num
  diretório temporário local, invisível para o processo que precisa cloná-lo.
  Passa a criá-lo no volume compartilhado, que é o pré-requisito que o próprio
  roteiro já declarava, e limpa os restos das corridas anteriores

- **web**: fixture do ModelPicker sem as facetas novas quebrava o build (00a23381)
- **api,docs**: o DTO da resposta do teste de credencial e a contagem de ADR (5021192c)
- **web**: corpo vazio da api e rolagem da lista de modelos (7be6b29d)
- **api**: o decorator de tracing perdia listModels e matava o sync de catálogo (429a3228)
- **api**: o CSRF nascia em /auth e o refresh nunca funcionou no browser (b5430acf)

### Refatorações

- **web**: as @font-face saem do index.css para um arquivo próprio (59b78632)

### Documentação

- o README anuncia a versão de verdade, e o CI passa a cobrar isso (265055c0)
- CHANGELOG da rodada e o escopo da FASE 13 (5696bdf0)
- **changelog**: v2.1.0 (becec969)

### Manutenção

- **design-sync**: re-sync do design system — 66 componentes no Claude Design (3c9b6ad8)

## v2.1.0 — 2026-08-03

### Novidades

- **web,docs**: aprovações somadas por sessão (achado #16) (3506970)
- **web,docs**: Insights ganham aba própria, com contador (achado #15) (34ba57f)

### Correções

- **api,web,docs**: destrava a esteira — lint, e o gatilho de drift que eu criei à toa (7382203)
- **api,web,docs**: o bootstrap para de criar a branch rc (achado #3) (a989e87)
- **api,docs**: handoff a subagente é recusado, com o lead no erro (achado #12) (dd3de59)
- **api,engine,docs**: reativar a execução volta a ter efeito (achado #11) (39ab1f6)
- **engine,api,docs**: falha de git sem motivo, e dois comentários que mentiam (4b49b15)

### Documentação

- **changelog**: v2.0.0 (9336246)

## v2.0.0 — 2026-08-03

### ⚠ Mudanças incompatíveis

- **api,web**: a curadoria de modelo passa a ser por workspace (aae747d)

### Novidades

- **api**: Ollama e Anthropic descobrem o próprio catálogo (3b8a54e)

### Correções

- **api**: o preço da Vultr é oficial e nenhuma troca de preço escapa da auditoria (acf0ad1)
- **ci**: PR de workflow nascia sem checks, e quebra não chegava ao changelog (44dec9b)
- **scripts,ci**: o CHANGELOG e as notas de release estavam vazios (9976b70)

### Documentação

- **api**: a rota interna de sync não é "do workspace inteiro" (0962c05)
- **branching**: o CHANGELOG volta por PR depois do release (fc570b6)

## Unreleased

### Novidades

- **docs**: `business-rules.md` deixa de ser uma página de 644 KB — as duas
  seções que sozinhas eram metade dela saem para arquivos próprios
  (`business-rules/custo.md` e `business-rules/autenticacao.md`), e o índice
  cai para 335 KB. Divisão por TAMANHO, não por assunto: nenhuma vírgula de
  conteúdo mudou e nenhuma âncora `{#rn-NNN}` mudou de nome — só o arquivo
  que as hospeda. Os 293 links que apontavam para as RNs movidas foram
  reescritos, incluindo os da tradução pt-BR, e o build do Docusaurus (que
  reprova âncora quebrada) passa nos dois idiomas. O `docs/.docmap.yml` ganha
  `docs_alternativos`, uma DISJUNÇÃO ao lado da conjunção que já existia: uma
  RN mora em um dos três arquivos, e cobrar os três ensinaria a usar o escape
  hatch — regra que ensina a ignorar check é pior que regra nenhuma.
- **docs**: o `docs:check` passa a conferir TRÊS famílias de número escrito em
  prosa, não só a de ADR: a contagem de RNs (fonte: os cabeçalhos `### RN-NNN`
  do `business-rules.md`) e a de providers de LLM (fonte: os literais
  `capabilities` que a tabela gerada de `llm-providers.md` já lê) entram na
  mesma aferição. O gatilho foi medido, não previsto: o README anunciava "as
  158 RNs" com 331 escritas — errado por mais do dobro, na tabela que
  apresenta o repositório —, e corrigir à mão só reinicia o relógio. Número
  que não bate REPROVA com o valor certo na mensagem; frase alterada reprova
  como `CEGO`, de propósito, porque check que parou de achar a frase fica
  verde para sempre dizendo que conferiu algo que não olhou.
- **ci,k8s**: as quatro imagens de produção passam a ser PUBLICADAS no GHCR
  a cada tag final (`ghcr.io/<dono>/brabo-{api,engine,web,backup}`, públicas),
  fechando a dívida declarada mais cara dos ADRs 0025/0027 — até aqui o
  `release.yml` construía com `push: false` só pra provar que a tag era
  construível, e o overlay de produção apontava pra `ghcr.io/OWNER/*` com um
  `newTag: REPLACE_WITH_DIGEST` que nenhum passo substituía (ADR 0119). O
  login usa o `GITHUB_TOKEN` do próprio job (`packages: write`): nenhum
  segredo novo pra rotacionar. O que cada tag publicou fica registrado POR
  DIGEST em `.release/images.json` — anexado à GitHub Release no mesmo
  instante da tag e versionado pela PR do CHANGELOG que o release já abria,
  SEM abrir uma terceira exceção de push direto. O overlay continua guardando
  o marcador, e `make imagens-do-release OVERLAY=prod|staging` aplica o digest
  com `kustomize edit set image` — quem faz o deploy decide qual release está
  em produção, não a tag. Achado no caminho: os overlays listavam TRÊS
  imagens, não quatro — o CronJob de backup herdava `brabo-backup:prod`, nome
  que não resolve em registry nenhum, então o backup do ambiente que mais
  precisa dele nunca subiria. Nada passa a fazer deploy sozinho: `DEPLOY_ENABLED`
  continua não existindo, e assinatura/atestação das imagens segue de fora,
  junto com o code-signing dos binários do runner.
- **api,engine**: o dev agent passa a **esperar** a aprovação em vez de queimar
  iterações. Ferramenta pendente suspendia o agente em nada: o `pending` voltava
  como resultado, o modelo lia como resposta do comando, e cada tentativa
  gastava uma iteração até a task morrer no teto sem uma linha escrita — com as
  aprovações do usuário chegando tarde demais para servir. Agora o laço para
  retendo worktree e histórico, e a decisão o retoma com o resultado de verdade
  no lugar certo. Recusa também retoma, com o motivo: o agente aprende que o
  caminho fechou em vez de esperar para sempre

- **api**: sessão nova e dev agent param de nascer no modelo local do
  workspace. Quando ninguém configurou nada para o projeto, o modelo herdado
  passa a ser o do **Criativo** — ele é a porta de entrada, e o binding dele
  representa o modelo que o projeto usa para pensar. A herança ocupa o vazio e
  nunca sobrepõe: escolha explícita de sessão, agente ou projeto continua
  vencendo. Antes era preciso trocar o modelo à mão em toda sessão aberta, e os
  dev agents subiam em `llama3.2:1b`, que o ADR 0020 proíbe no passo semântico

- **api,docs**: os gates do fluxo viram **registro declarativo** em
  `docs/gates.yml` — treze deles, que até agora só existiam espalhados entre
  regra pura, use case, teste e workflow. O registro descreve e não executa:
  trocar um campo nele não muda comportamento nenhum. O que ele compra é os
  gates ficarem enumeráveis, e com isso mensuráveis por
  `pnpm --filter api validacao:gates`, que extrai do event log a última
  passagem de cada um. Cada gate diz ONDE mora a prova dele
  (`event_log | teste | ci`), porque nem toda prova está no log: a trava de
  merge é garantida por teste e o backmerge é CI. Enumerar já rendeu três
  achados antes de medir qualquer coisa — o gate de PR de infra, que ninguém
  tinha listado; um check required sem teste próprio; e um filtro que apontava
  para coluna em vez de payload, fazendo um gate parecer nunca ter passado
- **api**: `GET /internal/gates` devolve o registro validado. O arquivo passa a
  viajar dentro da imagem de produção — sem isso a rota funcionaria em
  desenvolvimento e responderia erro só em produção, porque `docs/` inteiro é
  ignorado no build

### Correções

- **web**: erro de carregamento parou de virar **tela branca**. Abrir um projeto
  com a api limitando por `429` devolvia a área principal inteiramente vazia —
  sem mensagem, sem estado de erro, sem esqueleto —, porque a tela testava
  `if (!project) return null` e com isso tratava "a api recusou" e "ainda não
  chegou" como a mesma coisa. Agora a tela DIZ o que houve, com a frase que a
  api mandou (é ela que sabe a diferença entre "tente em instantes" e "você não
  tem acesso"), o `trace_id` para quem for investigar e um botão de tentar de
  novo. No dashboard o defeito era pior que branco: `!projects` também era
  verdadeiro no erro, então a tela convidava a **criar o primeiro projeto** de
  um workspace que podia ter vinte. A barra lateral também fala, com o texto
  cabendo nos 248px que ela tem (RN-088)
- **web**: a app parou de responder ao rate limit da api com **mais tráfego**.
  Uma sessão real acumulou 1128 erros `429` num console só: o TanStack Query
  retentava três vezes cada falha e os ~25 polls de 3 a 5 segundos seguiam
  batendo na mesma porta, num laço que impedia a janela deslizante do limite de
  se refazer. Agora 4xx não se retenta — 429 é literalmente o servidor pedindo
  para parar, e 401 já renovou a sessão por dentro — e todo poll para quando a
  query erra, voltando sozinho no foco da janela, na remontagem da tela ou no
  botão de tentar de novo. 5xx e falha de rede continuam com as três
  tentativas, que ali é a reação certa
- **web**: projetos de **mesmo nome** deixam de ser indistinguíveis na barra
  lateral. Uma execução de validação criou vinte `validacao-real`, e as vinte
  linhas eram idênticas. Quem repete nome passa a mostrar o id abreviado e a
  data de criação, que já vinham no payload; nome único não ganha legenda
  nenhuma, porque desempate em toda linha seria ruído no lugar com menos espaço
  da tela
- **engine**: o Psicólogo parou de analisar sessão **sem nada a analisar**. Uma
  sessão cujo log inteiro era provisionamento de repositório passava pelo
  critério de tamanho, ganhava a análise, e o modelo — sem evento algum para
  citar — inventava `seq` inexistentes até a validação de evidência rejeitar e
  ele desistir, com o orçamento já gasto. A contagem que decide se vale a pena
  agora desconta os passos de máquina do bootstrap e o rastro que os próprios
  analistas deixam na sessão: contar o turno anterior do Psicólogo fazia uma
  sessão vazia parecer povoada a partir da primeira análise, e cada retentativa
  a enchia mais. Não havendo material, a análise não roda e o desfecho fica no
  log como `psychologist.analysis_skipped` — inclusive no reprocessamento
  manual, onde quem clicou recebe o motivo em vez de uma hipótese inventada

- **engine**: regra de negócio com título já registrado **no projeto** passa a
  ser recusada na emissão. Rodar o Criativo duas vezes deixava as mesmas regras
  duplicadas, metade delas órfãs; como o artefato é um evento de domínio, e
  evento não é apagado nem editado, a entrada é o único momento em que dá para
  recusar. A checagem é por projeto e não por sessão, que é onde a duplicata
  nasce — a segunda rodada abre sessão nova. O erro volta ao modelo, que segue
  para a próxima regra

- **api**: o PO parou de criar história com título idêntico a uma que já existe
  no projeto, e passa a **avisar** quando uma história nova não acrescenta
  cobertura nenhuma — todas as regras que ela cita já estavam cobertas por
  outra. São respostas diferentes de propósito: título repetido é erro e
  bloqueia; justificativa repetida é suspeita e vira
  `backlog.story_overlap_warned`, porque um segundo recorte da mesma regra pode
  ser legítimo e quem julga isso é o usuário. Sobreposição **semântica** — dois
  títulos diferentes para o mesmo endpoint — continua passando, e há teste
  afirmando esse limite em vez de deixá-lo implícito

- **api**: o bootstrap de Gitflow morria no primeiro passo em **todo projeto
  GitHub novo**. Repositório recém-criado não tem commit nenhum, e aí a Git
  Data API inteira do GitHub responde `409 Git Repository is empty` — o
  provider tratava só `404` e nunca alcançava o próprio caminho de "primeiro
  commit" que já tinha escrito. Agora o commit inicial sai pela Contents API,
  que é a única que funciona em repo vazio. O backend falso dos testes também
  foi corrigido: ele respondia `404` onde o GitHub responde `409`, e era por
  isso que a suite ficava verde enquanto o produto quebrava
- **web**: o wizard avisa, ao escolher **repositório privado no GitHub**, que o
  plano gratuito não aceita proteção de branch — antes a limitação só aparecia
  no último passo do bootstrap, com o repositório já criado e a mensagem crua
  da API na tela

- **ci**: a PR de changelog que o release abre passa a trazer junto a versão
  anunciada no `README.md`. Sem isso, o check de versão (novo nesta rodada)
  reprovaria toda PR de release — que é aberta pelo bot e só toca o CHANGELOG,
  então nasceria vermelha esperando uma mão humana que a política não prevê

### ⚠ Mudanças incompatíveis

- **api**: `GET /models` deixou de existir. A lista do seletor virou
  `GET /projects/:projectId/models` porque a curadoria passou a ser **por
  workspace** (ADR 0049): `models.is_active` era uma coluna para a instalação
  inteira, e um owner do workspace A ligando um modelo o ligava para o B — com
  o gasto caindo no orçamento de quem não decidiu nada. O catálogo em si
  continua global (nome, preço e capabilities são fato do provider); só a
  decisão "aparece no seletor?" mudou de lugar, para a tabela nova
  `workspace_models`. A migração `0034` dá a cada workspace existente
  exatamente o que ele enxergava antes, **antes** de derrubar a coluna. Quem
  consome a api por fora precisa trocar a rota; a UI já foi junto

### Novidades

- **api,web**: o catálogo passa a saber **quais modelos leem imagem, quais
  geram imagem e quais fazem thinking**, e a tela filtra por isso. O sync nunca
  consultava o provider sobre modalidade — lia `supports_vision` do que já
  estava gravado, que tinha nascido `false` —, então os 338 modelos do primeiro
  sync real do OpenRouter ficaram todos sem vision, incluindo os 181 que o
  próprio provider declara multimodais. Aceitar imagem e **produzir** imagem
  viraram eixos distintos: quem lê diagrama e quem desenha resolvem problemas
  diferentes. Modalidade que o provider não declara continua omitida em vez de
  virar `false` — silêncio não apaga o que estava lá (ADR 0051)
- **api,web**: **curadoria por uso** — você marca para que este workspace usa
  cada modelo (código, documentação, análise, imagem, conversa) e filtra o
  catálogo por isso. Nenhum provider publica "bom para código"; isso é opinião
  de quem opera, então vale só no seu workspace, como toda curadoria desde o
  ADR 0049. Marcar uso **não liga** o modelo no seletor, e trocar o uso não
  desliga o que já estava ligado — os dois eixos não se misturam
- **web**: um filtro que zera a lista deixa de ser confundido com catálogo
  vazio: antes a tela mandava cadastrar uma credencial que já existia
- **web**: a aba Sessões passa a somar as **aprovações de cada sessão** — o que
  ainda aguarda você, o que você já decidiu e o que a política auto-aprovou —,
  além do total do projeto. Tudo o que existia vinha de `usePendingActions`,
  que exige um `sessionId`, e os três chamadores passavam o da sessão mais
  recente: uma decisão esquecida numa sessão anterior ficava invisível para
  sempre. A separação entre clique humano e política sai de colunas que a
  execução não reescreve (`decidedBy` e `resolvedPolicy`) — contar por `status`
  perderia a ação aprovada que já executou, que é justamente a métrica que a
  Fase 10 não conseguiu colher
- **web**: os Insights do Psicólogo ganham **aba própria**, com contador de
  hipóteses aguardando decisão. Eles moravam no fim da Visão geral, embaixo do
  painel do time, da execução e da arquitetura — quatro assuntos numa coluna
  só, na aba que abre por padrão, e a fila de decisões do Psicólogo ficava
  fora da tela sem nenhum sinal de que existia. Agora ela fica ao lado das
  outras duas filas de decisão do projeto (backlog e aprovações), cada uma com
  seu próprio contador: somá-las esconderia qual está pedindo atenção
- **api**: Ollama e Anthropic passam a declarar `listModels` e a ter o catálogo
  descoberto pelo sync — o backlog que o ADR 0042 deixou aberto. Os dois
  formatos foram verificados na doc oficial antes de uma linha de código: o
  Anthropic pagina **por cursor** (`has_more`/`last_id`, percorrido pela
  auto-paginação do SDK oficial) e o Ollama lê `GET /api/tags` no host de
  `OLLAMA_HOST`. Nenhum dos dois informa preço, então o modelo entra no catálogo
  **sem preço** em vez de com preço inventado

- **api,web**: cadastrar credencial (chave de LLM ou token de git) passa a
  **sempre cifrar e gravar**, e verificar virou ação própria:
  `POST /users/me/credentials/{provider}/test`, que decifra no servidor e
  devolve só o veredito — `ok`, `recusado` (com o motivo do provider) ou
  `nao_suportado`. Antes o cadastro testava a chave antes de persistir e
  recusava a gravação; como o campo é write-only e a tela nunca reexibe o que
  foi digitado, uma recusa deixava o usuário sem credencial **e** sem o texto
  para corrigir. O terceiro estado existe porque `ollama`/`anthropic`/`openai`
  não têm endpoint de teste verificado: num veredito binário eles voltariam
  `ok`, e a tela afirmaria uma verificação que ninguém fez. A tela de
  configurações ganhou junto o campo de **troca** (antes era preciso remover
  para trocar) e o botão **Testar** (ADR 0050, RN-055)
- **api**: credencial passa a ter teto de **512 caracteres** nas duas rotas de
  cadastro. É proteção contra payload absurdo numa rota que cifra (e portanto
  copia) a entrada — mesma natureza do `@MaxLength` da senha —, **não**
  validação de formato: cabe com folga a maior credencial conhecida (~164, a
  project key da OpenAI) e continua aceitando uma chave pela metade, que quem
  desmascara é a rota de teste

- **web,api**: a tela de **Configurações** passa a seguir o mockup do design
  system (`design/SCREENS.md`). "Modelos por agente" ganha as duas colunas que
  faltavam — **FALLBACK** (o nível da cascata que valeria se o vigente sumisse,
  derivado dos bindings de projeto e workspace) e **EST. MÊS** por agente — mais
  o card de **custo estimado do time**, alimentados por
  `GET /projects/:projectId/agent-costs`, agregação nova de `token_usage` numa
  janela deslizante de 30 dias (só `actor_kind = agent`, RN-038). Agente que
  nunca rodou aparece com traço, não com zero. Avatares, badges, densidade de
  tabela, cabeçalhos de seção e a legenda da matriz de papéis passam a usar as
  métricas do desenho. Duas divergências ficam, e por escrito: o custo aparece
  em **USD** (o mockup mostra BRL, mas converter exigiria uma taxa de câmbio, e
  moeda com taxa manual é backlog) e o convite continua pedindo o **ID do
  usuário** (a api não tem rota que resolva e-mail — um campo prometendo e-mail
  seria um formulário que não funciona)

- **web**: o catálogo de modelos passa a **repartir os hubs por fabricante**. Um
  hub devolve o catálogo de dezenas de fabricantes numa lista só — o OpenRouter
  trouxe **338** —, e uma lista plana desse tamanho não é navegável: achar o
  Claude ali era rolagem, não escolha. O fabricante sai do prefixo do id
  (`anthropic/claude-…`), então não houve mudança de banco; os subgrupos vêm do
  maior para o menor (OpenAI 60, Qwen 49, Google 30, Mistral 18, Anthropic 17…)
  e a contagem aparece ao lado de cada rótulo. Modelo sem namespace cai num
  grupo à parte em vez de sumir. APIs diretas não ganham subgrupo — ali o dono
  do modelo já é o provider. Cada fabricante **abre e fecha**, e todos começam
  fechados: 58 subgrupos abertos de saída devolvem a mesma lista quilométrica
  que o agrupamento existe para evitar, enquanto fechados os cabeçalhos com
  contagem viram um índice. Um subgrupo fechado que contenha itens marcados diz
  isso no cabeçalho — sem esse selo a barra de lote contaria "12 selecionados"
  sem que houvesse como ver quais, e a ativação em lote seria às cegas.
  **Local e APIs diretas também colapsam**, e um botão **Minimizar tudo /
  Expandir tudo** fecha ou abre grupos e subgrupos de uma vez (ele mostra a
  AÇÃO, não o estado). O cabeçalho do hub passa a **nomear quem o serve** —
  `Hubs · OpenRouter` —, porque preço, disponibilidade e credencial pertencem ao
  hub e não ao fabricante do modelo; nas APIs diretas isso não se repete, já que
  a própria linha diz o provider

### Correções

- **api**: o **refresh de sessão voltou a funcionar no browser** — na prática,
  nunca funcionou. O cookie `brabo_csrf` era gravado com `Path=/auth`, junto do
  refresh, mas `document.cookie` só expõe cookies cujo path é prefixo do path da
  PÁGINA: a web vive em `/`, `/login` e `/projects/...`, e nunca enxergou o
  cookie que ela precisa ecoar no `X-CSRF-Token`. O cabeçalho ia vazio e todo
  `POST /auth/refresh` morria em 403, então a sessão caía no primeiro reload —
  ou quando o access token de 15 minutos expirava — e o sintoma (voltar para o
  login) não parecia bug de cookie. Agora cada cookie tem o seu path: o CSRF em
  `/` (é um valor aleatório para ecoar, não credencial) e o refresh onde sempre
  esteve, `/auth` e `httpOnly`. Nenhuma proteção foi afrouxada
- **api**: o **sync de catálogo voltou a funcionar** — estava morto para os
  nove providers. `TracedLLMProvider`, o decorator de tracing por onde o
  registry faz TODO provider passar, encaminhava `name`, `capabilities` e
  `chat` e deixava `listModels` de fora. Como o sync exige os dois lados
  (a capability **e** o método), ele pulava cada provider com
  `pulado: 'sem_capability'` — um relatório que mentia, já que a capability
  estava declarada e quem a perdia era o decorator. Efeito prático: nenhum
  modelo de provider remoto jamais entrava no catálogo, e o seletor só
  oferecia os locais mesmo com credencial válida cadastrada. Com o
  encaminhamento no lugar, um sync trouxe 338 modelos do OpenRouter
- **web**: resposta da api **com corpo vazio** deixa de derrubar a tela. O
  cliente tratava só o `204` e fazia `res.json()` em tudo o mais — mas um
  handler que devolve `null` responde **200 sem corpo**, e `null` é o que o
  domínio diz o tempo todo (projeto sem orçamento, agente sem binding, projeto
  sem repositório: seis funções do cliente já declaravam `| null`). O
  `SyntaxError` cru subia até o `QueryCache.onError` e matava a query inteira,
  então a tela de configurações perdia a lista de modelos por causa de um
  agente sem binding
- **web**: a lista de modelos **fecha ao rolar dentro dela**. O listener de
  `scroll` era de captura e não olhava o alvo, então a primeira volta da roda
  do mouse sobre o dropdown o fechava — e a rolagem seguia para a página
  atrás. Com mais modelos do que cabem na altura máxima, os de baixo eram
  inalcançáveis. Rolar a **página** continua fechando, que é o
  comportamento pretendido (o dropdown é `fixed` e descola do gatilho)
- **web**: a tela de catálogo passa a **avisar quando há credencial de um
  provider e nenhum modelo dele**, apontando o botão "Atualizar catálogo".
  Cadastrar a chave não descobre modelo — quem descobre é o sync —, e nada
  ligava as duas coisas: uma chave de OpenRouter válida e testada convivia com
  um seletor que só oferecia modelos locais
- **web**: o botão Salvar da seção de credenciais **parecia não ter ação**. Ele
  tinha: a api respondia `422` e o `ApiError` escapava do `onClick` para o
  `window.onunhandledrejection`, que só escreve no console. Sem `try/catch`,
  sem toast de erro e sem estado de carregando, seis cliques seguidos não
  produziram nenhum sinal na tela. Todo caminho da seção (salvar, testar,
  remover) passa a reportar a mensagem que a api mandou
- **api,web**: o bootstrap para de criar e proteger a branch `rc`, e o
  `branching-policy.md` que ele **commita no repositório do usuário** passa a
  descrever a escada de três degraus. O `rc` saiu da política pelo ADR 0030
  ("sem ambiente e sem gente para exercê-lo, seria degrau cerimonial") e o
  `pr-police` do CI opera com três desde então — o bootstrap era o último lugar
  que ainda ensinava a escada de quatro, dentro do repositório de quem usa o
  produto. São cinco passos agora, não seis. Duas coisas ficam como estão de
  propósito: o valor `create_rc_branch` continua no enum `bootstrap_step`
  (linhas antigas o referenciam, e passo que aconteceu não se apaga), e `rc`
  continua na lista de merge protegido — desproteger uma branch que ainda
  existe em repositórios antigos custaria caro. Efeito na adoção: um repo com
  `rc` passa a vê-la classificada como branch **extra**, descrita no plano e
  nunca tocada, que é o que ela é hoje
- **api**: handoff endereçado a **subagente** passa a ser recusado, com erro
  que nomeia o lead a quem o chamador devia falar. O ADR 0038 pediu essa
  validação nomeando o lugar — `CreateHandoffUseCase` é o único do sistema que
  grava `toAgent` — e ela nunca tinha sido implementada: a `offer_handoff` do
  engine repassa `to_agent` como string livre, então nada impedia um agente de
  se dirigir direto a `qa-automacao` e furar a hierarquia. A recusa acontece
  **antes** do insert, senão sobraria um handoff fantasma e um
  `handoff.offered` — evento imutável — afirmando uma oferta que a política não
  permite. Área/lead/membros continuam hardcoded (o corte de escopo da Fase 8
  segue de pé); o que impede as cópias de divergirem é teste (RN-054)
- **api,engine**: reativar a execução volta a ter efeito. Ativar um projeto que
  já estava executando era **no-op** para todo agente já vivo (`if origin ==
  :started`), então um dev parado em `idle` — fila vazia no claim anterior — só
  voltava a trabalhar por acidente, quando outra task ficasse pegável e o
  outbox o acordasse por outro caminho. Agora ele recebe um wake, e o guard de
  estado decide: `idle` reivindica, `working`/`awaiting_gate` seguem intactos e
  `idle_tripped` continua exigindo rearm explícito (RN-047 preservada). Junto,
  a ativação deixa de abrir uma **sessão órfã** por clique: ela reusa a sessão
  de execução vigente, porque o engine descarta o `session_id` novo quando o
  agente já existe — a sessão nova nascia ativa, recebia o
  `execution.activated` e nunca mais recebia nada, enquanto os eventos dos
  agentes continuavam na anterior (RN-053)
- **engine**: falha de git deixa de chegar **em branco**. `System.cmd/3` com
  `cd:` apontando para diretório inexistente não levanta exceção — devolve
  `{"", 2}` —, e isso virava `{:error, ""}`: o usuário via a ação falhar sem
  motivo nenhum. Era o buraco de diagnóstico que o ADR 0048 fechou pela causa
  raiz (o gate abrindo antes da PR) e deixou registrado como backlog, porque
  vale para **qualquer** falha de diretório, não só aquela. Toda chamada de git
  do engine passa a nomear comando, status e diretório quando o git não diz
  nada; quando ele diz, a saída continua verbatim — quem lia `nothing to
  commit` continua lendo
- **api**: o preço dos três modelos da Vultr passa a ser o **oficial**
  (`$0.55`/1M de entrada, `$2.75`/1M de saída, tarifa única do serviço). A
  estimativa anterior errava na direção perigosa — `400_000` micros de saída em
  dois dos três modelos, contra `2_750_000` reais: o metering subestimava o
  custo de saída em quase **7×**, e é a saída que domina a conta de um agente
  que escreve código. NVIDIA NIM e Bitdeer seguem estimados, e agora com o
  motivo registrado: a NVIDIA **não cobra por token** (prototipagem gratuita +
  licença por GPU/hora) e a Bitdeer monta a tabela de preço no cliente
- **api**: o sync de catálogo parava de sobrescrever preço marcado como
  `manual_pricing`. O schema sempre disse que quem sincroniza não pode
  sobrescrever essa linha sem decisão explícita; o código deixava o remoto
  vencer sempre que trouxesse preço, e o sync seguinte desfazia a correção de
  quem tinha arrumado um número errado (RN-051)
- **api**: toda troca de preço passa a deixar linha em `model_price_changes`.
  A origem `sync` existia no domínio desde a Fase 9c e **nenhuma escrita a
  produzia** — o sync trocava preço por fora do caminho auditado, e o `seed.ts`
  fazia o mesmo sobre banco já semeado (`BRABO_FORCE_SEED=1` no `bootstrap.sh`
  do k8s). Corrigir um preço no seed mudava o número em silêncio (RN-044)
- **ci**: a PR de promoção nascia com os checks **travados**. `promote.yml`
  abria o PR com o `GITHUB_TOKEN`, e evento criado por esse token não dispara
  workflow de PR — os sete checks nasciam em `action_required`, esperando
  aprovação manual. Na prática o PR chegava a `MERGEABLE` com quatro checks
  herdados do push da origem e **sem o Check de promoção ter rodado**: quem
  mergeasse sem reparar promovia sem o portão que valida range limpo, degrau
  carimbado e merge commit possível. Passa a usar `BRABO_BOT_TOKEN`, o mesmo
  remédio que o `tag-release.yml` já aplicava desde a v0.2.0 — cujo aviso diz,
  literalmente, "nem abre PR com checks". O passo do CHANGELOG no `release.yml`
  tinha o mesmo defeito e foi corrigido junto
- **ci**: o `pr-police` passa a exigir que `breaking/` e o marcador de quebra
  no commit (`!` ou `BREAKING CHANGE:`) andem juntos, nas duas direções. Eram
  dois mecanismos para o mesmo fato, soltos: a versão sai da FUNÇÃO da branch,
  e o CHANGELOG detecta quebra pelo MARCADOR. `breaking/fase-7-auth-e-openapi`
  removeu o Keycloak, subiu MAJOR corretamente — e nenhuma das doze versões
  tem seção de "⚠ Mudanças incompatíveis", porque **nenhum commit do histórico
  jamais usou os marcadores**. As versões já lançadas seguem sem a seção: os
  commits são imutáveis e o gerador não tem de onde inferir; a regra vale daqui
  para frente
- **docs**: o `CONTRIBUTING.md` ensinava `fix/<assunto>`, que **não está na
  taxonomia** — o `pr-police` reprova. É o engano mais comum, e a doc o
  induzia

## v1.4.0 — 2026-08-02

### Novidades

- **engine,api,docs**: fechamento da Fase 12 — a prova de que os três achados morreram (12d) (c366f0a)
- **api,engine,web,docs**: promoção de story volta a ser do usuário (12c-3..12c-7) (28317be)
- **api,engine**: create_story respeita o modo do projeto (12c-2) (6d6e791)
- **api**: o modo de promoção de story entra no domínio (12c-1) (7eafdb3)
- **web**: o painel mostra awaiting_gate, travado e não mais fica preso na task antiga (90e7faf)
- **engine**: reidratação retoma os quatro estados (fa36915)
- **api,engine,web**: rearmar o agente travado é um clique (ef35bde)
- **engine,api,web**: circuit breaker por agente vira configurável de ponta a ponta (c79510b)
- **engine**: o dev agent acorda por evento (22e8fca)
- **api**: a outbox conta gate resolvido e task pegável (2be2c2a)
- **engine**: o estado do dev agent vira explícito (2f17b29)
- **web**: o wizard pergunta criar ou adotar, e a tela do plano decide (ed24393)
- **api**: as quatro rotas da adoção, com a superfície documentada junto (4b098f5)
- **api**: o portão do plano — aprovar roda, adotar como está dispensa (0faa6e0)
- **api**: adoção de repositório existente — o fim do seed manual (ac5ab2c)
- **api**: dry-run do bootstrap — o plano que diagnostica sem agir (a33c1ae)
- **api**: origem do repositório e o plano de bootstrap no schema (4b5fbfd)
- **api,docs**: seis providers de LLM sobre a base OpenAI-compatível — Fase 11 completa (862bab3)

### Correções

- **k8s**: o seed do usuário do smoke nunca rodou — cinco defeitos empilhados (7ccd676)
- **web,ci**: o build de produção da web estava quebrado — e o CI não olhava (c8e3080)
- **api,engine,docs**: a decisão no event log, e o gate que abria sem PR (e3acffc)
- **engine,web,docs**: teste do requisito 4, notificação do breaker e o limite aceito (F1, F2, D5) (7baa7cc)
- **engine**: guard do correct, filtro do worker e rearm honesto (D4, D6, D8) (fd0cc48)
- **api**: outbox do reagendamento volta a ser transacional (D7) (db1b3a7)
- **engine,api**: três travamentos críticos do reagendamento (D1, D2, D3) (51eb0ac)
- **infra,deps**: WEB_ORIGIN deriva de WEB_PORT, e brace-expansion sobe (8fc8dad)

### Refatorações

- **api**: o executor do bootstrap vira colaborador próprio (d6bbf3d)

### Documentação

- permissões, runbook e glossário acompanham as mudanças da leva (0ff55d3)
- RN-047, ADR 0045 e o catálogo de eventos do reagendamento (6fcf4db)
- RN-045/046, ADR 0044 e o smoke do aceite da adoção (96de3bc)
- escopo da FASE 12 no CLAUDE.md, e a 11 fecha no Status (706d48b)
- runbook cobre a derivação de WEB_ORIGIN a partir de WEB_PORT (09f5098)

## v1.3.0 — 2026-08-01

### Novidades

- **web,docs**: ModelPicker reagrupado, curadoria de catálogo e fechamento da Fase 9c (a87ec50)
- **api,engine**: sync de catálogo, ciclo de vida do modelo e preço auditável (0dfb227)
- **api,k8s**: metering por provedor subjacente e preço manual (preparo da Fase 9b) (b1c7e4e)
- **api**: base OpenAI-compatível, contrato de LLM providers e capabilities (Fase 9a) (a04454f)
- **web,api**: dashboard de projetos — fidelidade ao design aprovado (f0ba9bd)

### Correções

- **api**: a lista de providers de LLM sai do packages/shared e vai pro domínio (39bd783)

### Documentação

- kit de colheita da 10c — queries validadas, esqueleto e o achado #17 (f35a8eb)
- runbook de condução da 10b e o texto de entrada da sessão 0 (ed2cd39)
- CLAUDE.md admite o que as Fases 8 e 9 não entregaram (b999249)
- missão de dogfooding da Fase 10 e insumos do PO (0e27ecd)

## v1.2.0 — 2026-07-30

### Novidades

- hierarquia de agentes — QA e Infra viram área, com Lead e subagentes (Fase 8) (c04bfc0)
- a versão da tag chega ao artefato, e o contraste das telas de auth passa AA (f8f9336)
- **web**: as quatro telas de auth ganham a moldura do design aprovado (694f3b6)
- **web**: Alert, loading no Button, campo preenchido e revelável, e foco visível (2d64049)
- **web,api**: trace no chat, span própria na retentativa e fim dos silêncios do browser (3e359a4)
- **api,engine**: log legível e o caminho do usuário entre as camadas (07c6b00)

### Correções

- **ci**: actionlint sobe pra 1.7.12 e ganha aceite no trivy, prettier, e o glossário desatualizado (65a9945)
- o CORS que o engine não tinha, e a porta como parte do contrato (4dfa280)
- **ci**: silencia o DL4006 que a contagem de fontes introduziu no hadolint (8646a36)
- **web**: as três fontes do design system não carregavam em produção (2404d0e)
- **api,engine**: trace correlacionado sem coletor, e a correlação assíncrona que estava morta (b504403)

### Documentação

- ADR 0036, a tela de login no design system, e as contagens que estavam erradas (da71efe)
- corrige as duas citações arquivo:linha que o decorator deslocou (79d8596)
- registra que página nova precisa do sidebars.ts, e que o docmap é piso (4e30cd2)
- ADR 0035, a página de observabilidade e as duas frases que estavam falsas (f4a4b68)

### CI

- reaponta o contrato de trace_id do engine e libera o trace id de exemplo da spec (569d89c)

### Manutenção

- senha do seed vira brabo12345678, nos nove lugares que a citam (c62f436)
- **ci**: aceita CVE-2026-56852 no binário do gitleaks, com prazo (c0bd99d)
- **design-sync**: sincroniza o DS com o Input da Fase 7a (752634a)

## v1.1.2 — 2026-07-28

### Documentação

- corrige o que a doc afirmava sobre estado que mudou nesta sessão (1055e5e)

## v1.1.1 — 2026-07-27

### Manutenção

- **ci**: torna a Release republicável e documenta as seis tags órfãs (bb517ee)

## v1.1.0 — 2026-07-27

### Novidades

- **docs**: publica a documentação de cada degrau no Pages (48c17dd)

### Correções

- **ci**: gitleaks varria a gh-pages e reprovava por site construído (73943cf)
- **docs**: referência de API não renderizava nenhuma das 117 rotas (2c73681)

### Desempenho

- **ci**: paraleliza o build da release e conserta o cache do Elixir (13dd7e0)

## v1.0.1 — 2026-07-27

### Correções

- **ci**: drift cobrava documentação em PR de promoção (1245505)
- **ci**: faz o guardião da documentação reavaliar quando a base ou o corpo mudam (d03259c)
- **deps**: fecha 12 dos 13 alertas do Dependabot com overrides escopados (c50c93a)
- **docker**: faz o smoke semear o usuário do jeito que a imagem permite (795ca89)
- **docker**: devolve os defaults de dev às duas variáveis novas do auth (527ce35)
- **deps**: força js-yaml 5.2.2 e fecha a GHSA-pm4m-ph32-ghv5 na imagem (ae2e12d)

### Manutenção

- **ci**: fecha os três checks que a FASE 7 deixou vermelhos (5f75f93)

## v1.0.0 — 2026-07-27

### Novidades

- **api**: 400, 401 e 429 derivados da cadeia de guards no documento (1d7d4cb)
- **docs**: referência da API gerada do OpenAPI no Docusaurus (68225ee)
- **api**: metadados OpenAPI nas 26 rotas internas — varredura completa (0dc10a2)
- **api**: metadados OpenAPI em llm, git, credenciais e infraestrutura (97a9c08)
- **api**: metadados OpenAPI em backlog, agentes, execução, psicólogo e anamnese (37e7f2c)
- **api**: metadados OpenAPI em sessões, ações e IAM (89d51ce)
- **api**: documento OpenAPI, /docs fora de produção e export determinístico (fc48365)
- **web**: login próprio, sessão em cookie e as quatro telas de auth (8ee0270)
- **api**: sessão da web em cookie httpOnly com CSRF por double-submit (fb502e1)
- **api**: migração dos usuários do Keycloak e login de conta pendente (0cc44b2)
- **api,engine**: service token no tráfego interno e emissor próprio no guard (31aa544)
- **api**: casos de uso, controllers e superfície do auth first-party (805c1c5)
- **api**: domínio, portas e repositórios do auth first-party (5b8492c)
- **api**: fundação do auth first-party — argon2id, Ed25519 e as cinco tabelas (b0274b9)

### Correções

- **ci**: claude-review falhava em todo PR de promoção (e3e0f70)

### Documentação

- regra de docmap, ADR 0033 e as docs afetadas pela referência gerada (4fba9f6)
- ADR 0032 e a documentação do corte do Keycloak (063520a)
- ADR 0031, RN-030..033 e a documentação da Fase 7a (724771c)
- ativar FASE 7 (auth first-party + referência de rotas) no CLAUDE.md (f079258)

### Testes

- **api**: o teste de tabela passa a exigir os metadados de OpenAPI (77cdded)
- **api**: suite de ataque do auth e as duas correções que ela encontrou (f0ca194)

### Manutenção

- remove o Keycloak do compose, dos manifests e dos scripts (796e133)

## v0.3.1 — 2026-07-27

### Correções

- **dev**: pnpm dev explica a colisão de portas em vez de só falhar (c93ab44)

### Documentação

- CI confere as contagens de ADR escritas em prosa (3efb89a)

## v0.3.0 — 2026-07-27

### Novidades

- **ci**: backmerge gate e fechamento da FASE 6 (ADR 0030) (50d7b16)

### Correções

- **ci**: promote tinha o mesmo ciclo vazio do tag-release (39119ed)
- **ci**: ciclo vazio quando o PR entra por merge commit (227769c)

### Documentação

- **pages**: link para o site publicado e um build de site por PR (a05518b)

## v0.2.0 — 2026-07-27

### Novidades

- **ci**: esteira de promoção e versionamento calculado (FASE 6, itens 4 e 5) (#47) (0fdd422)
- **ci**: approval-ladder com os dois modos (FASE 6, item 3) (#45) (7f440a2)
- **ci**: política de branches escrita e aplicada pelo pr-police (FASE 6, itens 1 e 2) (#44) (9d08dff)

### Correções

- **ci**: âncora da tag final era impossível de passar com merge commit (#53) (4e81a75)
- **ci**: promotion-check tratava "não consegui ler" como "está desabilitado" (#49) (996c634)
- **deps**: sobe brace-expansion para 5.0.8 (GHSA-mh99-v99m-4gvg) (#41) (9f36351)

### Documentação

- **policy**: registra a execução da esteira de ponta a ponta (#50) (0307075)
- **security**: volta ao canal privado do GitHub, agora que o repo é público (#43) (1a72fad)
- código de conduta e canal de segurança que existe de verdade (#40) (e5cc19b)
- documentação completa e mecanismo de sincronização contínua (#39) (b57329a)

### CI

- constrói as quatro imagens de produção em paralelo com buildx bake (#42) (e4cd944)

### Manutenção

- **ci**: escada de três degraus e CI sem gatilho de push (#46) (b52bf00)

## v0.1.0 — 2026-07-26

### Novidades

- **k8s,api,docs**: backup testado, hardening da api e release (Fase 5, item 6 e 7) (7794b29)
- **design-sync**: importa os 57 componentes do apps/web para o Claude Design (f340416)
- **api,engine,web**: OpenTelemetry, logs JSON correlacionados e dashboards (Fase 5) (3f6781b)
- **api,engine**: métricas Prometheus de custo, sessões, ações e latência (Fase 5) (e76c74b)
- **k8s**: stack de observabilidade local — Tempo, Loki, Alloy, Collector e Grafana (Fase 5) (9efd832)
- **engine,api,k8s**: graceful shutdown com handoff de sessão e propriedade única no cluster (Fase 5) (8b4614a)
- **k8s**: deploy Kubernetes com Kustomize, HPA por fila do Oban e overlay local (Fase 5) (ec47864)
- **docker,ci**: imagens de produção non-root, compose.prod, CI e smoke test (Fase 5) (6ffac72)
- **api,docs**: critério de aceite executável da Anamnese e ADR 0023 (0bf764c)
- **api,engine,web**: rodada da Anamnese sob demanda e os testes que faltavam (Fase 4b) (5a84add)
- **engine,api**: NoopDevAgent como modo de execução permanente (Fase 4a) (f93e2ef)
- **api,engine,web**: Anamnese — perfil de proficiência e patches de instrução (Fase 4b, sessão 2) (0e23bed)
- **api,engine,web**: Psicólogo real substitui o stub (Fase 4b, sessão 1) (9fa8b68)
- **api,engine,web**: InfraAgent e painel do time ao vivo (fechamento Fase 4a) (fb2513c)
- **api,engine,web**: gates de QA e SecOps pra PR de dev agent (Fase 4a) (c7a8937)
- **api,engine,web**: DevAgent real via ToolLoop, substitui o NoopDevAgent (Fase 4a) (82918aa)
- **api,engine,web**: infraestrutura dos dev agents com NoopDevAgent (Fase 4a) (f1247ca)
- **api,engine,web**: Agente Arquiteto — ADRs via PR real, module_map, validação cruzada (Fase 3b) (3b9a82b)
- **api,engine,web**: Agente PO + backlog + rastreabilidade (Fase 3b) (72b6c01)
- **api,engine,web**: Agente Criativo conversacional + handoffs (Fase 3b) (c97b2c4)
- **engine,api**: ToolLoop, ferramentas, ContextManager e EchoAgent (Fase 3a) (77c05cc)
- **engine,api**: harness de agentes — montagem determinística de contexto (Fase 3a) (f9a6e4e)
- **web,api**: wizard de novo projeto ligado ao fluxo real + tela de progresso do bootstrap (c2a5b05)
- **api,shared**: bootstrap de Gitflow idempotente e retomável (ProvisionRepositoryUseCase) (5d31d4f)
- **api,shared**: credenciais de git, GithubProvider/GitlabProvider completos e suite de contrato mockada (d858982)
- **api,shared**: fundação do contrato normalizado GitProvider (Fase 2) (935f55b)
- **web,api**: implementa apps/web completo e endpoints de suporte (fb630ab)
- **api,engine**: endurece o pipeline de acoes propostas com decide(), permissions.json fisico, agent_autonomy e executor de terminal (d581c88)
- **engine**: endurece o motor de sessoes com persistencia, heartbeat, outbox via Oban e PsychologistStub (74b0c46)
- **api**: abstracao GitProvider + LocalGitProvider/GithubProvider/GitlabProvider e provisionamento de repositorio (02302af)
- **engine**: motor de sessoes em Elixir/OTP com supervisao e evento de termino (e258558)
- **api**: adiciona pipeline de acoes propostas e permissions.json por projeto (5e86ee7)
- **api**: camada de LLM — providers, binding em cascata, metering e budget (b3972b7)
- **api**: núcleo de domínio — auth, IAM, sessões, event log e outbox (968c150)
- **design**: extrai tokens do design system para design/tokens.css (f797899)

### Correções

- **scripts**: changelog perdia os commits de revert, contando meia história (23dc8b2)
- **docker**: troca mc por aws-cli na imagem de backup — 48 CVEs para 0 (533862b)
- **ci**: pina o trivy na versão que a action realmente instala (f7875a1)
- **ci**: mix deps.get antes do format e tag válida do trivy-action (e45cf6a)
- **web**: dropdown de modelo era recortado pela tabela nas últimas linhas (a3fe71c)
- **engine**: janela da Anamnese truncava pra segundo e pulava a rodada calada (4a2bb45)
- **api,web**: perfil de proficiência identifica a pessoa por e-mail (7f11f89)
- **api,web**: três defeitos que só a passada visual pegaria (Fase 4b) (58220b6)
- **api,engine,web**: destrava a Anamnese num projeto real (Fase 4b, sessão 2) (3deaef5)
- **api,docker**: ajusta o demo do Psicólogo ao que a stack local aguenta (Fase 4b) (da25bb3)
- **api,engine,web**: fecha os desvios do Psicólogo e roda o critério de aceite (Fase 4b, sessão 1) (3571634)
- **engine,api,web**: gate de infra que valida e painel que diz a verdade (Fase 4a) (df2573a)
- **engine,api**: destrava os gates de QA e SecOps e roda o critério de aceite (Fase 4a) (5d721bd)
- **engine,api,web**: destrava o DevAgent real e fecha os desvios do enunciado (Fase 4a) (15dc967)
- **engine,api**: corrida do workspace, monitor de dev agents e tetos (Fase 4a) (391f992)

### Documentação

- **adr**: promove a divergência de proteção de branch GitHub×GitLab a ADR (486f402)
- **adr**: registra a verificação executada do fechamento da 4b (5ca75ea)

### Testes

- **ci**: planta CVE crítica para provar o gate de auditoria (77f6b03)

### Revertidos

- **ci**: remove a CVE plantada e corrige a formatação do prettier (64f5ccf)

### Manutenção

- scaffold do monorepo (api, engine, web, packages/shared, docker) (0827e80)
