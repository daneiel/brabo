# Brabo — Plataforma de engenharia orquestrada por agentes

## O que é
Sistema que gerencia o ciclo completo de uma aplicação: provisionamento de
repositório, Gitflow, agentes de IA especializados (Criativo, PO, Arquiteto,
Devs, Infra, QA, SecOps, Psicólogo, Anamnese), controle de custos de token
e pipeline de aprovação de ações com autoridade final do usuário.

## Histórico

A narrativa completa de cada fase — o que entregou, o que cortou, os achados
e por quê — mora em `docs/explanation/historico-de-fases.md`. Este índice
existe para localizar; a regra que sobreviveu de cada fase está em
Convenções, nas RNs e nos ADRs. **Nada aqui é lacuna aberta** — o que segue
aberto está na seção "Estado atual e aberto", logo abaixo.

| Fase / Programa | Uma linha | Detalhe |
|---|---|---|
| FASE 1 (MVP) | IAM/RBAC, event log imutável, roteador de LLM, metering, proposed_actions, engine OTP | histórico |
| FASE 2 | GitProviders (Local/GitHub/GitLab) + bootstrap de Gitflow idempotente | histórico |
| FASE 3 | Harness completo + Criativo/PO/Arquiteto | histórico |
| FASE 4 | Agentes de execução, QA/SecOps como gates, trava de merge | ADR 0020 |
| FASE 5 | Imagens prod, K8s, observabilidade, backup com restore testado | ADR 0024–0027 |
| FASE DOC | docs/ Diátaxis + Docusaurus + docmap/drift check | documentation-workflow.md |
| FASE 6 | Política de branches mecanizada, approval-ladder, promote/tag | ADR 0030 |
| FASE 7 | Auth first-party, Keycloak removido, OpenAPI nos 23 controllers | ADR 0031–0033 |
| FASE 8 | Hierarquia de áreas com lead único e delegação privada | ADR 0038 |
| FASE 9 | Contrato de LLMProvider + catálogo com curadoria e preço congelado | ADR 0041–0042 |
| FASE 10 | Primeiro dogfooding; Bitbucket + GenericGitProvider | primeiro-dogfooding.md |
| FASE 11 | 9 providers de LLM sobre a base comum | ADR 0043 |
| FASE 12 | Operabilidade pós-dogfooding (adoção, reagendamento, promoção manual) | ADR 0044–0047 |
| FASE 13 | Validação REAL ponta a ponta + medição por script; 7 P1 fechados | validacao-real.md |
| FASE 14 | Correções da execução real; 14d: paralelismo pelo Lead, Dev Lead | ADR 0052–0053 |
| FASE 15 | gates.yml como registro declarativo | ADR 0054 |
| PÓS-15 | RN-088 (três estados), read model do dashboard, CSP, OAuth state | ADR 0058–0059 |
| PROGRAMA 16–26 | Handoff de design adotado; 8 telas; kind de sessão; eventos paginados; Gastos; modelo por área; container por projeto (25b cortada); aba Code | ADR 0060–0072 |
| PÓS-PROGRAMA 16–26 | Carrossel de promoções pendentes, execution_mode Local/Container, diagrama C4 do Arquiteto | RN-148, ADR 0068/0072 |
| RODADAS exp001/exp003 | ~30 correções achadas por uso real (fio, PO, Criativo, painel) | RN-150..181, ADR 0069 |
| PROGRAMA 28 (Ondas 1–5) | Tema claro real, sidebar, gasto por provider, RAG pipeline+aba, project_containers, login social | ADR 0074–0084 |
| Modelo de time / auditoria fluxo.yml | fluxo.yml v3; 6 ondas da auditoria fechadas | ADR 0085–0086, 0094–0095, auditoria-fluxo-vs-codigo.md |
| Agentes antecipados | UX Designer, Staff, qa-estratégia/appsec, analytics, secops-runtime, platform, dbre | ADR 0087–0093 |
| Correções pós-uso (ago/2026) | GOVERNANCE.md, SMTP real, "N agentes online", sessão não fecha com dev pendente, workspace pessoal automático, 413 nas PRs/Executores | RN-408..412, ADR 0096–0098 |
| Neo4j | Grafo como memória derivada + templates versionados + rag_search | ADR 0099–0101 |
| Runner local | execution_mode, PAT, npm, binário, conversão de modo, folder browser | ADR 0102–0106, 0108, 0111–0112 |
| Abas agrupadas / PRs project-wide / carrossel do PO | Régua de abas agrupada, aba PRs project-wide, aba Arquitetura extraída, bug do carrossel do PO corrigido | RN-421..424 |
| Handoff manual / budget por área / pasta local no RAG | Fecham itens do backlog antigo | ADR 0109–0110, 0113 |
| pnpm bootstrap | Menu de terminal sobre comandos existentes; Reset total | histórico |
| Faixa de atividade do turno | Narração em tempo real do turno dos 6 conversacionais; teto de iterações não termina mais calado | RN-459/460 |
| Ollama nativo / pull de Hugging Face | Bootstrap dev pergunta uma vez e persiste o modo do Ollama em `.env`; navegador de modelos do Hub com pull em duas etapas e allowlist de publisher oficial | RN-461..463, ADR 0114–0115 |
| Lockfile próprio do website | `website/` sai do workspace pnpm da raiz — lockfile e overrides de segurança isolados, `pnpm audit` do produto para de reportar a árvore do Docusaurus | ADR 0117 |
| Configuração automática do runner pelo navegador | Chave de dispositivo Ed25519 gerada no navegador, aditiva ao PAT; proxy do binário via GitHub Releases; File System Access API grava a pasta configurada, com fallback de download fora do Chromium; `--project/--dir/--token` viram opcionais no CLI | RN-464..466, ADR 0118 |
| Imagens publicadas no GHCR | `release.yml` publica as quatro imagens a cada tag final e registra os digests em `.release/images.json`; overlay de produção deixa de apontar para um placeholder | ADR 0119 |
| Schema por agregado | `db/schema.ts` vira barrel; as 51 tabelas e 34 enums viram 16 arquivos sob `db/schema/`, um por agregado de `domain/*` | ADR 0121 |
| `SessionPage.tsx` em 5 PRs mecânicos | 3 807 → 2 661 linhas; timeline/turno, `StorySlide`, `StructuredQuestionCard`, árvore de backlog + `ContextAside`, hook `useSessionReadiness` — cluster do canal de turno e `ProjectSettingsTab.tsx` seguem fora, declarado | ADR 0122 |
| Hook do canal de turno do `SessionPage.tsx` | 2 661 → 2 479 linhas; PR mecânica de dedup (`iniciarTurnoDoAgente`/`finalizarTurnoDoAgente`/`cancelarTurnoOtimista`) seguida da extração de estado + efeito do canal Phoenix para o hook `useTurnoDoAgente` (`lib/session-turno.ts`) — fecha o item que a ADR 0122 deixou declarado em aberto; `ProjectSettingsTab.tsx` segue fora, decisão separada | ADR 0124 |
| `ProjectSettingsTab.tsx` por seção | 2 532 → 77 linhas; as 17 seções viram um arquivo cada sob `routes/settings/` (+ `shared.ts` com os DOIS helpers de mais de um chamador), e o arquivo antigo fica no caminho como entrada e barrel — caminho e os 11 nomes exportados são contrato de 3 testes. Fecha a ÚLTIMA metade da linha de dívida de `docs/architecture.md` | ADR 0125 |
| Trilho vertical de navegação do projeto | A régua horizontal de dois níveis (`GroupedTabs`) vira um trilho vertical com os TRÊS grupos abertos ao mesmo tempo; geometria do trilho do `CodeShell`, teclado portado, os 5 contadores seguem separados. Revisa a RN-201: a aba de Código não recolhe mais a sidebar sozinha | ADR 0126, RN-201 |
| Sumário ancorado de Configurações | As 17 seções da aba ganham `id`, `<section>` com nome acessível e um sumário em quatro grupos DENTRO da área de conteúdo — sem faixa vertical nova, moldura segue nos 444px do ADR 0126. Registro em `routes/settings/sumario.ts` (terceira lista do mesmo desenho de `project-tabs.ts`), deep-link `?section=`, spy por `IntersectionObserver`; só entra no sumário a seção que MONTOU | CHANGELOG |
| Padrão único de valor herdado | As QUATRO redações de "não tem valor próprio" da aba Configurações viram dois polos e um verbo, de uma fonte só (`routes/settings/heranca.tsx`): rótulo diz o ESTADO, detalhe diz a CONSEQUÊNCIA. Vocabulário unificado, forma não — a marca só entra onde o controle não mostra o estado sozinho | CHANGELOG |
| Salvar por seção em Configurações | Paralelismo e Teto de gasto trocam N botões de linha por UM da seção (`settings/secao-salvavel.tsx`), com contagem de linhas pendentes e desfecho POR LINHA — salvar é N chamadas, não uma transação, e a tela nunca afirma o que não obteve. As três seções de autosave e Credenciais ficam de fora, cada uma por um motivo declarado | RN-469 |
| Painel "precisa de você" | Chip no topo do projeto abre as CINCO filas de decisão num lugar só — separadas, ordenadas por urgência, sem soma nenhuma (nem no chip). Aprovações e merges decidem ali pelo `ApprovalCard`; as outras três levam à aba. Pendência de arquitetura empresta a data da história e DIZ que emprestou | RN-467 |
| Cascata de modelo como cadeia visível | A coluna Origem para de imprimir o enum do banco e vira `workspace › projeto › área › agente` com quatro estados por nó (`settings/cascata.tsx`) — separando os DOIS sentidos de `origin: 'agent'` sem tocar na api. O aviso de nível descartado entra na cadeia; os três `—` ganham três textos. Fecha o canvas de melhorias de UI (7 de 7 itens tomados) | RN-470 |
| Pasta antes do runner | A configuração do runner pelo navegador (ADR 0118) inverte a ordem: `showDirectoryPicker` é o PRIMEIRO passo e o binário o ÚLTIMO, best-effort — a release sem asset devolvia 502 antes do seletor abrir, e a pasta ficava inalcançável. Falha do binário mantém os dois arquivos gravados e troca a instrução pelo caminho `npm install -g @brabo/runner`. Depois da instrução, `EsperaDoRunner` sonda `workspaceVerifiedAt` com três estados e teto | RN-473/474 |
| O `kid` na chave de dispositivo | O modo automático do ADR 0118 NUNCA autenticou: o navegador descartava o `id` que o registro devolvia, e a JWK gravada nascia sem `kid` — o CLI a recusava sempre. Registro e exportação viram UMA função (`registrarChaveEExportarPrivada`), nos DOIS caminhos; e a recusa do CLI deixa de ser indistinguível de "não há chave". O teste que deixou passar afirmava que o arquivo fora ABERTO, nunca o conteúdo | RN-475 |
| Provisionamento que não fica calado | Duas falhas não viravam estado nenhum — `step.check` fora do `try` e a recusa de `createRepo` ANTES de a linha de bootstrap existir —, e a tela pollava "Iniciando…" para sempre sem botão. Causa raiz de tudo: `/data/git-repos` e `/data/project-workspaces` nasciam `root` nas imagens de DEV, que o `Dockerfile.prod` já sabia criar antes do `USER` | RN-477 |
| O arquivo de política e o escopo do terminal | `projectScopeRoot` tinha DOIS consumidores com necessidades opostas, e o modo `runner` (sem bind-mount) os separou: o escopo segue apontando para o HOST, o `permissions.json` passa a morar na raiz GERENCIADA. A ativação da execução devolvia 500 (`mkdir '/home/<usuario>'`), e a LEITURA degradava calada — em projeto `runner` o arquivo nunca existiu. Junto: erro tipado com 400 em vez de `Error` cru, a Visão geral parando de engolir a mensagem da api, e a anotação de OpenAPI que prometia 409 para dois casos que nunca foram 409 | RN-478 |
| Aviso do passo humano antes do clique | O passo de terminal do runner era anunciado só no estado de sucesso; passa a ser dito também no inicial, e o comando final ganha `cd <caminho>` quando dá para afirmar que a pasta escolhida é a do projeto. Rótulo do botão NÃO muda — ele fala da pasta, que é automática mesmo | RN-473/477 |
| Um modelo para todos os agentes | A tabela `Modelos por agente` ganha uma barra que aplica UM modelo aos 17 de uma vez, gravando no nível do AGENTE (pelo projeto seria `maintainer`, e mexeria no default de sessão). Primeira EXCEÇÃO à régua "valor nomeado salva no `onChange`" da RN-469 — o seletor é argumento de ação, não configuração —, com o desfecho em três estados da própria RN-469 | RN-476 |
| Tetos de rebaixamento em `project_members` | A sobreposição `projectRole ?? workspaceRole` FICA nos dois sentidos (é capacidade, não bug); o que entra são dois tetos de 403 no caso de uso — ninguém rebaixa o `owner` do workspace, ninguém rebaixa a si mesmo. As três descrições de OpenAPI que a RN-471 declarou falsas passam a descrever o código; o gate do `Select` é PR à parte, por a tela não ter como calcular o primeiro teto | ADR 0127, RN-472 |
| Telemetria de busca do RAG | A busca híbrida deixa rastro: `rag_searches` (com os pesos CONGELADOS na linha) e `rag_feedback` (o voto útil/irrelevante, o único sinal de verdade). TABELA e não só evento, porque `session_events.session_id` é `NOT NULL` e a busca da aba não tem sessão — o evento `rag.search`/`rag.feedback` é NARRAÇÃO, só quando há sessão. Ferramenta `rag_feedback` (`:direct`) nos seis agentes que já tinham `rag_search`, e `medir:rag` para ler. NADA calibrado — esta etapa só instrumenta | RN-479..481 |
| Broker de container | Nasce `apps/broker`, o ÚNICO processo que fala com um daemon Docker no servidor — e ele NÃO aceita especificação: recebe `projectId` + operação, LÊ a decisão do Arquiteto da api e COMPÕE imagem, rede, recursos e o único mount. A porta do ADR 0128 MOVE de `apps/runner/src/` para `packages/docker-port` (os dois consumidores a empacotam; a api não pode consumi-la). A rota de ciclo de vida passa a devolver observado ao lado de registrado, sem fundir | ADR 0130, RN-485/486 |
| Golden-set de acerto do RAG | Molde do golden-set do QA (ADR 0123) aplicado à busca híbrida: como o julgamento não mora no engine (é `HybridSearchUseCase`, na api), `seed-golden-set-rag.ts` provisiona UM projeto com corpus real curado (22 arquivos de `docs/`) E roda a busca para 17 perguntas compostas de RNs/ADRs reais; `rag_golden_test.exs` só invoca o script e aplica o piso. Critério de acerto — caminho de arquivo, top-5, nunca chunk exato/rank 1 — é função pura testada. Gate novo `rag-acertivo`, `warn` (sem CI com LLM). Medido de verdade, duas vezes, deterministicamente: 17/17 no top-5 | ADR 0132, RN-490 |

## Estado atual e aberto

O que segue é OPERATIVO — decide comportamento de sessão hoje. Fechou? Sai
daqui e o fechamento vai para o histórico.

**Decisões de produto abertas (não são bugs; não corrigir de passagem):**
- Z/AD: allowlist de verbos não converge (verbo/forma/invocação são espaços
  distintos) — `docs/explanation/achados-execucao-real.md`
- AE: agente de QA tenta consertar o código que julga; contido por duas
  barreiras independentes
- Botão "Ativar execução" mudar de dono continua fora de escopo, por decisão
  declarada (ADR 0053 item 5) — só a metade da delegação Dev Lead →
  `dev-<modulo>` fechou (ADR 0094); a execução segue no caminho atual

**Cortes e pausas vigentes:**
- FASE 25b segue cortada NO QUE IMPORTA: **nenhum container sobe**. Não há
  laço, fila nem `proposed_action` de `container_start`; `project_containers` só
  grava estado, o worktree segue fora do container e o ADR 0055 vale como está.
  O que mudou é que já EXISTE quem chame Docker: o broker (`apps/broker`, ADR
  0130), o único processo do produto com o socket, sobre a mesma `DockerPort` de
  cinco operações do ADR 0128 — hoje movida para `packages/docker-port`. Das
  cinco, só `inspect` tem chamador (a rota de ciclo de vida, que passou a mostrar
  o observado ao lado do registrado); as outras quatro são efeito externo e
  esperam o `proposed_action` que o Infra Lead vai propor. O broker sobe sob
  `profiles: ["container-broker"]` e portanto não sobe por padrão
- Anamnese e Psicólogo PAUSADOS desde 2026-08-10 (`ANAMNESE_ENABLED=false`),
  aguardando spec; Staff dormente para disparo automático (acionável manual)
- `appsec run_design/2` acionável, nada aciona sozinho (gatilho:
  `assess_implementability`, fora de escopo à época)
- `context-manager-summarize` é o único template da leva sem consumidor
- `DEPLOY_ENABLED` não existe: trava `platform` em `planned` e mantém
  `secops-runtime` sem detecção/resposta/postmortem de incidente (mesmo
  gatilho ausente para os dois — ADR 0091/0092)
- UX Designer: `teste-de-usabilidade` (exige usuário humano real) e
  `métricas-de-uso` (o funil mede sessão→commit→PR→merge, não adoção de
  feature pelos usuários finais do produto construído) ficam fora de
  alcance, declarado (ADR 0087/0089)

**Lacunas aceitas e declaradas:**
- Restart do engine com Dev Lead suspenso perde a inscrição no Wake (decisão
  segue visível em Aprovações) — ADR 0086
- A aba de Código abre com 492px de moldura à esquerda (sidebar 264 + trilho
  do projeto 180 + trilho do `CodeShell` 48), contra ~110px antes do ADR
  0126 — preço MEDIDO e aceito por remover o auto-colapso da RN-201.
  Recolher manualmente continua funcionando e ainda produz trilho do Shell
  ao lado do trilho do projeto: essa é uma escolha do USUÁRIO, não do
  sistema, e é a diferença que o ADR compra
- A navegação por abas do projeto existe em DOIS lugares — o trilho e a
  lista por projeto da sidebar (`LinhaDeAba`, RN-196). Pré-existente (a
  régua horizontal duplicava a mesma lista), só ficou visualmente paralela;
  reconciliar é decisão de produto à parte, não tomada no ADR 0126
- `gatesEverOpened` sofre da classe de defeito da janela de 200 eventos —
  declarado, não corrigido (exigiria mudar assinatura de `deriveAgentRoster`)
- O ENGINE tem o mesmo defeito que a RN-478 fechou na api, e ele segue ABERTO:
  `Engine.Actions.Workspace.ensure!/4` faz `File.mkdir_p!` do caminho do HOST
  em projeto `runner`, e o working tree do dev agent não tem onde nascer. Não
  vira 500 (o `rescue` de `ensure_remoto/2` devolve `{:error, …}`), vira dev
  agent que não trabalha — a mensagem NOMEIA a causa desde a RN-478. Corrigir
  isolado seria materializar worktree no host por um caminho que a execução em
  container substitui; a decisão é esperar por ela
- Conversão de `execution_mode` nunca migra diff NÃO commitado — órfão no
  disco antigo (RN-447..450, ADR 0111)
- Mirror web de `SOLO_CONVERSATIONAL_AGENTS` sem teste cruzado com a api
  (pior caso: opção velha que o backend recusa com 400)
- `ExecutionModeSection` (converter projeto existente para modo `runner`) é o
  ÚNICO dos cinco lugares sem `RunnerOnboardingPanel` nem navegador de pastas —
  digita-se o caminho no escuro. Ficou fora da RN-473 de propósito: onboardar
  ANTES de a conversão salvar registra chave num projeto que ainda não é
  `runner`, e `ConfirmProjectWorkspaceUseCase` recusa a confirmação com 400 —
  a ordem "converte, depois onboarda" é decisão de produto à parte
- Chave de dispositivo órfã (aba fechada no meio do fluxo da RN-473) é INERTE,
  mas invisível: `RunnerDeviceKeysController` tem `POST`/`DELETE` e nenhuma
  rota de LISTAGEM, então não há tela onde revogá-la
- `guard.ts` do runner é best-effort por invariante, não lacuna
- Exclusividade por `{project_id, machine_id}` adiada até segundo dev
  simultâneo real
- dbre: `plano-de-capacidade` e `tuning` sem prazo (exigem volume real)
- Métricas permanentemente "não medido": funil ideação→commit, adoção por
  feature, MTTR/change failure rate (ADR 0089/0091/0092)
- Dívida de contraste do tema ESCURO travada por número (ADR 0074)
- Gasto de embedding fora do metering (corte declarado do ADR 0075)
- Painel de Problemas/lint/testes na aba Código segue pendência declarada da
  FASE 26 — nunca entrou (terminal, blame, lista de PRs e virtualização já
  fecharam depois)
- Chunking do RAG (1200 caracteres/150 de sobreposição) e pesos da busca
  híbrida (0.6/0.4, limiar 0.2) seguem sendo PONTO DE PARTIDA — ainda NÃO
  calibrados (ADR 0080). O que mudou desde a Etapa 1 é que agora dá para
  calibrar: a busca deixa rastro (`rag_searches`/`rag_feedback`, RN-479/480) e
  `pnpm --filter api medir:rag` lê esse rastro. O que mudou desde a Etapa 2
  (ADR 0132) é que existe um corpo de 17 perguntas medindo ACERTO de
  retrieval — mas é um corpus CURADO (22 arquivos, não os 130+ ADRs reais) e
  mede se o arquivo certo aparece, não se os PESOS estão certos; mexer nos
  quatro números antes de acumular medição de verdade continuaria destruindo
  a linha de base que os dois instrumentos juntos existem para criar (Etapa 5
  é a única que calibra, e só se a medição comprovar que ajuda)
- `rc/rcfix` (ADR 0030) e preferência de moeda com taxa manual seguem no
  backlog original da FASE 13c, sem revisão desde então
- Pull de modelo Hugging Face roda o download inteiro de forma SÍNCRONA
  dentro do request HTTP — a api não tem fila própria; corte declarado,
  candidato a ADR quando o volume de pulls justificar (ADR 0115)

**Pendências com dono humano (TODO(humano) vivos):**
- Smokes de LLM: 5 de 6 providers sem credencial no ambiente (só OpenRouter
  rodou real); `GITHUB_TEST_TOKEN`/`GITLAB_TEST_TOKEN` idem para git
- `NPM_TOKEN` não configurado — `publish-runner.yml` avisa e pula
- Binário standalone: só `linux-x64` executado de verdade; as outras 4
  plataformas estreiam na próxima tag
- i18n Onda 6b NÃO fechou: corpo de `docs/business-rules.md` 100% pt-BR +
  fatia residual de `.tsx`; ao fechar, revisar Stack/Documentação deste
  arquivo para inglês como idioma primário
- Golden-set de regressão do julgamento semântico do QA de Automação (ADR
  0123) existe e roda manualmente (`mix golden_set.qa`, dentro de
  `apps/engine`) contra Ollama local — nunca em CI. Ligar em CI exige
  segredo de LLM de API OU infra nova (runner com GPU, passo de pull do
  Ollama): decisão de um humano, não algo que se constrói escolhendo
- Golden-set de acerto do RAG (ADR 0132, RN-490) — mesma régua do de cima,
  mesmo motivo: roda manualmente (`mix golden_set.rag`) contra Ollama local
  (`nomic-embed-text`), nunca em CI. Medido de verdade nesta sessão (17/17,
  duas rodadas, determinístico), piso gravado em `floor.json` — mas contra um
  corpus CURADO (22 arquivos), não os 130+ ADRs reais do produto; ampliar o
  corpus é decisão de custo de embedding numa rodada manual, não escolhida
  aqui

**Backlog vivo:** `docs/explanation/backlog.md` (fonte única de priorização).

## Stack (decidida — não proponha alternativas)
- `apps/api`: NestJS 11 + Drizzle ORM + PostgreSQL 16 + pgvector;
  `nodemailer` para SMTP real do `MailSender` (ADR 0096), atrás de
  `MAIL_TRANSPORT` — `log` continua o default, inclusive em produção;
  `neo4j-driver` para o grafo de conhecimento (ADR 0099) — memória
  DERIVADA do event log, nunca fonte de verdade; pgvector CONTINUA sendo
  o índice vetorial dos chunks, o grafo não guarda embedding
- `apps/engine`: Elixir/OTP + Phoenix (canais) + Oban (filas no Postgres)
- `apps/web`: React 19 + Vite + TanStack Query/Router; `react-i18next`+
  `i18next` (fundação de i18n, RN-425) atrás de `lib/i18n.ts`/`lib/idioma.ts`
  — `en` é o idioma default, `pt-BR` mantido, servidor é a fonte de verdade
  (`localStorage` só evita flash no primeiro paint); `mermaid` (runtime,
  ADR 0068) para o diagrama C4 do Arquiteto, isolado atrás de
  `lib/mermaid-render.ts` com `import()` dinâmico; `@xterm/xterm` +
  `@xterm/addon-fit` (ADR 0103) para o terminal interativo do runner
  local, isolado atrás de `lib/xterm-runtime.ts` com `import()` dinâmico
- `apps/runner`: workspace novo, Node/TS — CLI (`brabo-runner`) que roda
  na máquina do usuário, conectando ao engine via canal Phoenix (`phoenix`,
  embutido no bundle) para executar comandos aprovados e terminal
  interativo (`node-pty`, único `external` do build `tsup` — binding
  nativo, resolvido via `node_modules` de quem instalou o pacote) — ver
  "Runner local" (ADR 0103). TRÊS caminhos de distribuição: clonar o
  monorepo (dev), `npm install -g @brabo/runner` via `tsup` + `npm publish`
  (ADR 0106), e binário standalone via `bun` (`bun build --compile`, ADR
  0112) — o `.node` nativo do `node-pty` embutido por `with { type: 'file'
  }` e extraído para um diretório real em runtime, já que `node-pty`
  resolve seu próprio addon por um `require()` de caminho COMPUTADO que o
  Bun não consegue embutir sozinho. `--project`/`--dir`/`--token` são
  OPCIONAIS quando a pasta tem `brabo-runner.config.json` e a chave de
  dispositivo gravados pelo fluxo do navegador (RN-464..466, ADR 0118):
  o navegador gera um par Ed25519 (Web Crypto), registra a chave pública
  como `runner_device_keys` e grava os três arquivos numa pasta via File
  System Access API (fallback de dois downloads fora do Chromium) —
  `POST .../runner-ticket` aceita essa chave como segunda credencial de
  dispositivo, ADITIVA ao PAT (ADR 0105), nunca um substituto. O `id` do
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
  constante — não há lista de mounts. `pidsLimit` entrou na spec no ADR 0130,
  porque o artefato do Arquiteto sempre teve três números e descartar um faria
  ele prometer um teto que o container não recebe
- `apps/broker`: workspace novo, Node/TS — o ÚNICO processo do produto que
  fala com um daemon Docker no SERVIDOR (ADR 0130), e o único serviço com
  `/var/run/docker.sock` montado. Não monte esse socket em mais nenhum. Sem
  framework web (são seis rotas, `node:http` puro), imagem própria em
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
  uma pasta VAZIA): o broker compõe com `PROJECT_WORKSPACES_HOST_ROOT`, e recusa
  `start` nomeando a variável quando ela falta. Contenção em cinco camadas
  independentes — sem porta publicada, rede `internal: true` que só a api
  alcança, `BRABO_SERVICE_TOKEN` em tempo constante, cinco operações, spec
  computada. Sobe sob `profiles: ["container-broker"]` nos dois composes e
  NÃO sobe por padrão; a imagem dele NÃO é publicada no GHCR (as quatro do ADR
  0119 seguem sendo quatro)
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
  produto da árvore do Docusaurus, que nunca chega a imagem nenhuma
- Auth: first-party no domínio da api (argon2id + access JWT curto +
  refresh opaco com rotação); autorização RBAC no domínio da api
  (inalterada desde a Fase 1)
- LLM: roteador na api com suite de contrato; base OpenAI-compatível
  sobre node:http (timeout de inatividade, erro por `code`,
  capabilities em duas camadas — ADR 0041); catálogo com curadoria e
  preço congelado no metering (ADR 0042); 9 providers (ADR 0043)
- Deploy: Kubernetes (k3d/kind em validação local). As quatro imagens de
  produção são PUBLICADAS no GHCR a cada tag final, públicas e por digest
  (ADR 0119) — `.release/images.json` registra o que cada tag publicou, e
  `make imagens-do-release` aplica no overlay. O overlay do repositório
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
  todo `curl` de binário passa por `sha256sum -c`. Ver
  docs/explanation/cadeia-de-suprimentos-do-ci.md, que também DECLARA o que
  segue confiado na fé (sem Dependabot, sem proveniência de dependência npm,
  sem assinatura dos artefatos, imagem de terceiro por tag e não por digest)

## Convenções
- Branches permanentes: dev, qa, main — um branch, um ambiente. `rc` saiu
  da política (ADR 0030) e o bootstrap parou de criá-la, mas continua em
  `PROTECTED_BRANCHES` DE PROPÓSITO: a lista decide o que a trava de merge
  RECUSA, e repositórios bootstrapados por versões anteriores ainda têm a
  branch. Proteger uma branch que não existe não custa nada; desproteger
  uma que existe custa caro. Não "limpe" essa lista.
  Trabalho nasce de dev com a taxonomia da política (breaking/,
  feature/, bugfix/, perf/, refactor/, chore/, docs/, test/);
  hotfix/ nasce de main. Formato funcao/descritivo,
  regex ^.{0,30}/\S{0,32}$. Commits em conventional commits, pt-BR.
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
  esquecer não dá erro de build, dá 403 em runtime. Volume JÁ criado continua
  com o dono antigo: a correção vale para volume novo, e destravar um ambiente
  existente exige `docker volume rm` (ou um `chown` pontual como root).
- Toda mudança entra por PR — push direto em permanente é bloqueado;
  únicas exceções de push: tags (bot de release) e .release/gate.json
  (bot do gate).
- Toda branch cujo PR é mergeado é ARQUIVADA automaticamente
  (`.github/workflows/archive-merged-branch.yml`) — move de
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
- Estados de sessão são máquina de estados explícita:
  created → active → closing → closed | closed_abnormally
- A sessão tem DUAS classificações, e elas não se sobrescrevem: `kind`
  (`consultiva|criativa`) é a INTENÇÃO de criação, gravada e imutável; o
  evento `execution.activated` é o ESTADO de execução, e continua sendo
  ele que `findActiveExecutionSession` procura. `execution.activated` em
  sessão consultiva é 409, nunca conversão silenciosa (ADR 0061, RN-097).
  Não faça a derivação por evento olhar `kind`
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
  curinga; a resolução mora no repositório (`findMode`), nunca em
  `decide()`. Tetos continuam absolutos MESMO com auto mode ligado, e não
  têm exceção configurável em lugar nenhum — merge em branch protegida,
  `instruction_patch`, `parallelize`/`raise_max_parallel` (RN-154), e o
  teto de efeito externo/comando privilegiado — git push/PR/deploy e
  sudo/doas — que revisou a RN-106 (RN-418, ADR 0102): antes era `deny`
  incondicional, agora é `require_approval` incondicional, com a mesma
  garantia de nunca ser auto-aprovável; "sempre permitir" foi fechado na
  fonte pra esse teto não virar decorativo (`ApproveAlwaysActionUseCase`
  recusa gravar padrão pra esses comandos).
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
  ator↔alvo. Segue possível e declarado: rebaixar outro `maintainer`,
  auto-PROMOÇÃO, o `POST workspaces/:id/members` (sem teto nenhum) e o
  auto-rebaixamento pela REMOÇÃO — remover a própria linha é benigno quando o
  papel de workspace segura a queda e irreversível quando não segura.
- O projeto escolhe ONDE o código mora, na criação (RN-169/RN-421/RN-422,
  ADR 0072/0104) — e pode CONVERTER depois, sem recriar o projeto, por
  `PUT projects/:projectId/execution-mode` (`maintainer`, RN-447..450, ADR
  0111): `container` (DEFAULT — a pasta gerenciada em
  `PROJECT_WORKSPACES_ROOT`, o comportamento de sempre), `mounted` (o antigo
  `local`, renomeado — uma pasta do USUÁRIO montada por bind-mount, caminho
  absoluto livre em `projects.workspace_path`) ou `runner` (uma pasta do
  USUÁRIO SEM bind-mount, confirmada por um CLI — `brabo-runner` — rodando na
  máquina dela, RN-423). O par (modo, caminho) é amarrado por CHECK no banco
  (`execution_mode <> 'container'`), e `projectScopeRoot` continua sendo a
  derivação ÚNICA da raiz — não duplique validação nos chamadores. Caminho
  `mounted` é validado na CRIAÇÃO e RECUSADO com mensagem que ensina a montar
  (RN-422/histórico RN-170): absoluto, sem `..`, existente, gravável de
  dentro do container, nunca raiz/pasta de sistema nem sobreposto ao
  checkout do Brabo. `runner` valida só o LÉXICO na criação (sem I/O) e
  nasce `workspaceVerifiedAt: null` — o runner confirma o caminho de verdade
  quando conecta, sobrescrevendo o que foi digitado. O portão da imagem
  (RN-105) NÃO vale para projeto `mounted`/`runner`, que não sobem
  container. Consequência declarada no ADR: a contenção estrutural do `join`
  some para esses projetos, e o vetor de symlink do ADR 0055 continua
  aberto. No LINUX, o próprio CLI `brabo-runner` recusa `--dir` fora do
  `$HOME` do usuário (RN-434, ADR 0104) — checagem de startup do processo
  local, não a fronteira de segurança (essa continua sendo autenticação +
  pipeline de aprovação, ver `apps/runner/src/guard.ts`); fora do Linux a
  restrição não se aplica.
- A imagem de container de um projeto é ARTEFATO do ARQUITETO
  (`artifact.project_image`, versionado, sem tabela), nunca configuração
  escondida. Enquanto ele não decide, a aba Code responde 409 (RN-105) —
  exceto em projeto nos modos `mounted`/`runner` (RN-169/RN-421).
  `git push`, abertura de PR e deploy NÃO saem pelo terminal — a regra é
  `require_approval` INCONDICIONAL (teto absoluto, revisado de `deny` pela
  RN-418/ADR 0102 — decisão GLOBAL do dono do produto: nunca auto-aprovável,
  mesmo dentro do escopo do projeto, mesmo com auto mode ligado, mesmo com
  "sempre permitir", que foi fechado na fonte pra não reabrir a porta).
  `sudo`/`doas` entram na MESMA régua. O ciclo de vida do container tem
  TABELA de estado desde a Onda 4/frente F1 do PROGRAMA 28
  (`project_containers`, ADR 0081, RN-243..248) — e quem ESCREVE nela continua
  sem chamar Docker: provisionar/reciclar/limpar DE VERDADE ainda não existe,
  então a política de terminal do ADR 0055 (escopo de caminho, allowlist
  estreito) segue valendo como está até o container subir de verdade. O que a
  leitura ganhou (ADR 0130) foi o estado OBSERVADO ao lado do registrado,
  perguntado ao broker — os dois nunca se fundem, e "não consegui olhar" tem
  motivo próprio em vez de herdar o registrado (RN-486).
- O diagrama C4 (Context + Container) também é ARTEFATO do ARQUITETO
  (`artifact.c4_diagram`, versionado, sem tabela — RN-149, ADR 0068),
  mesmo desenho do `artifact.project_image`. O Container level é DERIVADO
  do `module_map` vigente pelo caso de uso, nunca redigitado pelo modelo
  na ferramenta `create_c4_diagram` — só o Context (nome do sistema e
  atores externos) vem do tool call.
- Agentes rodam SEMPRE dentro de um Harness; nenhuma chamada de LLM ou
  ferramenta fora dele.
- Agente que ESCREVE tem de poder LER o que já existe, e tem de poder
  PERGUNTAR quando falta informação. As duas são a mesma lição (RN-164/165):
  um agente só com ferramenta de escrita age sobre um retrato tirado uma vez,
  no kickoff, e diante de uma lacuna escolhe entre inventar e parar. Leitura
  de agente é escopada ao PROJETO quando o recurso é do projeto, e CONTIDA
  (ADR 0060): sem parâmetro onde o modelo escreva o que quiser, custo constante
  por chamada, teto de linhas declarando o total real quando trunca.
- Laço de agente NÃO termina calado. O teto de iterações emite
  `toolloop.limit_reached` — o mesmo tipo para o `ToolLoop` e para os agentes
  conversacionais, que têm laço próprio (RN-166) — e obrigação não cumprida
  vira desfecho explícito no padrão da RN-059, durável e com origem.
- Handoff externo endereça só LEAD de área ou agente sem área;
  delegação interna é privada da área; falha de subagente NUNCA é
  silenciosa — reporta origem ao lead, que decide e registra evento.
- O contrato externo dos gates é estável: quem consome vê um veredito
  por gate, independente da estrutura interna da área.
- A lista de áreas tem UMA fonte —
  `apps/api/src/domain/agents/agent-areas.ts`. As cópias do web e do
  engine são GERADAS por `pnpm --filter api gerar:areas` e reprovam em
  teste se estiverem velhas; nunca as edite à mão (FASE 18). Área nova
  continua sendo decisão de produto, com ADR. A lista é o CATÁLOGO; a
  tabela `agent_areas` é o ESTADO por projeto, e nasce com ele (RN-094).
- `docs/fluxo.yml` é a terceira peça do modelo de time, ao lado do
  CATÁLOGO (`agent-areas.ts`) e do CONTROLE (`docs/gates.yml`, ADR
  0054): declara as RELAÇÕES entre papéis — quem entrega o quê a quem
  (ADR 0085). Papel `proposto` diz quem o absorve hoje e o critério
  objetivo de separação; o docmap cobre mudança em `agent-areas.ts`/
  `gates.yml` só em `warn`, até existir o teste de cruzamento entre os
  três (backlog).
- Merge em branch protegida (dev/qa/main) é SEMPRE manual do
  usuário — sem opção de automatizar, garantido por teste.
- Socket Phoenix da sessão (`session:<id>`) exige ticket opaco de uso
  único (TTL de 30s, `POST .../sessions/:sessionId/socket-ticket`) em
  `connect/3` — NÃO o JWT reaproveitado. O engine consome o ticket lendo
  `session_socket_tickets` direto (mesmo padrão de `outbox_events`);
  reconexão, inclusive automática, sempre busca ticket novo (RN-108).
- O produto NUNCA sobrescreve configuração de repositório do usuário
  (proteções, branches) sem plano aprovado explicitamente (regra da
  FASE 12, origem no ADR 0028).
- Commits de agentes usam identidade "<agente>[bot]" com o usuário
  como co-author.
- Todo desfecho de falha de agente registra a ORIGEM da falha
  (infra | modelo | código | política) — nunca diagnóstico por
  eliminação (lição do ADR 0020). Falha NUNCA vira resposta vazia no
  event log, e o motivo NUNCA fica só em broadcast: `agent.error` é
  durável e o agente diz o que houve no fio (RN-059). Falha de UMA
  ferramenta no meio do laço segue a mesma régua (RN-163).
- Os seis agentes conversacionais rodam laço bounded de tool use, com
  teto PRÓPRIO no servidor de cada um (Criativo e PO 12, Arquiteto, Dev
  Lead, UX Designer e Staff 14 — raciocínio, não conversa leve) — não o
  teto do `ToolLoop` (`Engine.Harness.Iteracoes`), que é dos agentes de
  execução e de gate. Erro de ferramenta é ENTRADA do laço, não fim de
  linha; teto esgotado é narrado, nunca silêncio, nos SEIS (RN-163;
  RN-459 fechou os quatro que ainda terminavam calados — só PO e
  Criativo tinham corrigido antes); e o agente não anuncia ação que o
  código não vá executar — o que se promete é decidido pelo teto, nunca
  por texto fixo (RN-163). O Staff é o único SEM `kickoff/1` — sobe e
  fica ocioso até a primeira `user_message`, porque não há artefato de
  sessão para sintetizar uma abertura (ADR 0088). Durante o turno, a
  tela de Sessão narra em tempo real o que o agente está fazendo numa
  faixa acima do composer — o fio só recebe a bolha de resposta depois
  que o turno termina (RN-460).
- O turno de um agente conversacional pode SUSPENDER esperando aprovação
  humana (ADR 0086, RN-284) — hoje só o Dev Lead, no `propose_execution_plan`.
  `Engine.Agents.TurnoAssincrono` responde ao `from` síncrono na hora
  (rompendo o bloqueio do `GenServer.call` de até 180s), mas emite
  `agent.status: awaiting_approval` em vez de `agent.done` quando o `state`
  devolvido carrega `:aguardando_aprovacao` com valor não-nulo. Enquanto
  suspenso, `user_message` não inicia turno novo — vira `agent.error`
  explicando a pendência. Sem tabela de estado própria: restart do engine
  durante a espera perde a inscrição no `Engine.Dev.Wake`, lacuna aceita e
  declarada (a decisão continua registrada em Aprovações).
- A chave de LLM que um agente gasta é a do OWNER do workspace
  (RN-058); o relatório desse gasto é do owner e só dele (RN-060). O
  membro vê o PRÓPRIO consumo por ATOR, em tokens e custo estimado, e
  NUNCA quebrado por provider ou credencial — as duas leituras respondem
  perguntas diferentes e nenhuma é recorte da outra (RN-101/ADR 0063).
- Métrica de execução de agentes é extraída do event log/token_usage
  por script, nunca anotada manualmente (lição da Fase 10/13). A busca do RAG
  segue a mesma régua e acrescenta uma (RN-479..481): quando o instrumento de
  medição não cabe no event log, ele vira TABELA, e a tabela — nunca o evento —
  é a fonte. `session_events.session_id` é `NOT NULL`, e a busca vinda da aba é
  de PROJETO: medir pelo evento perderia justamente as buscas com julgamento
  humano. O evento (`rag.search`/`rag.feedback`, só quando há sessão) é
  NARRAÇÃO da timeline. E o que o instrumento mede vai CONGELADO na linha — os
  pesos da busca, como o preço no metering (ADR 0042) e a `image_version` em
  `project_containers` —, senão a primeira calibração reescreve calada o
  significado de toda medição anterior. Gravar medição NUNCA derruba o que ela
  mede, e também não falha calada: origem `infra` no log e um `null` explícito
  na resposta, que a tela distingue de "não achei nada".
- As CINCO filas de decisão do projeto (aprovações, merges de PR, promoções
  de história, pendências de arquitetura, hipóteses do Psicólogo) nunca são
  SOMADAS — nem nos contadores do trilho (ADR 0126) nem no painel "precisa de
  você" que as reúne (RN-467), cujo chip anuncia PRESENÇA e não quantidade.
  Somar apaga qual fila está pedindo atenção. E o painel é ATALHO para a
  decisão, nunca substituto: ele renderiza o mesmo `ApprovalCard` e chama os
  mesmos endpoints, sem tocar em teto nenhum — em especial o de merge em
  branch protegida (`decide.ts`, `require_approval` incondicional). Tela que
  não tem a data de um registro DIZ de onde tirou a que mostra, ou não mostra
  data: a pendência de arquitetura não tem instante gravado e a linha declara
  que a data é da história relacionada.
- Tela que mostra um RECORTE diz que é recorte (RN-180). Toda leitura tem
  teto — `limit: 200` nos eventos e nas ações —, e teto silencioso faz a
  tela afirmar sobre o que não leu. O número que falta sai de SUBTRAÇÃO
  sobre o `seq` (gapless, por sessão), nunca de uma requisição a mais:
  é o mesmo mecanismo do sino (RN-100). Quando houver como carregar o
  resto, o controle mora onde o corte aparece.
- Ação de UI que vira N chamadas não é transação, e a tela DIZ isso (RN-469).
  Salvar uma seção de Configurações é um PUT por linha suja — em série, na
  ordem da tela, sem abortar na primeira recusa. O desfecho é POR LINHA: só o
  rascunho que a api confirmou some, o que falhou fica no campo e a seção
  continua marcada por ele, e os três desfechos não se disfarçam um do outro —
  todas passaram, NENHUMA passou (a mensagem da API, nunca uma contagem),
  ALGUMAS passaram (quantas de quantas, nomeando as que ficaram). Botão de
  seção deve a contagem do que está pendente, senão "Salvar" diz o mesmo com
  uma linha suja e com cinco. E a régua de quando o botão existe é o CONTROLE,
  não a seção: campo DIGITADO precisa de confirmação, escolha de valor NOMEADO
  salva no `onChange` — não converta as seções de autosave. O que essa régua
  mede é de QUEM é o valor, e há UMA exceção, declarada (RN-476): o seletor que
  aplica um modelo a TODOS os agentes tem botão, porque o valor dele não é
  configuração de nada — é o ARGUMENTO de uma ação sobre 17 linhas que a pessoa
  não estava editando, e no `onChange` um clique exploratório num dropdown as
  reescreveria. Ela grava no nível do AGENTE de propósito: pelo projeto os 17
  herdariam, mas o endpoint de projeto pede `maintainer` onde o de agente pede
  `developer`, e o binding de projeto é também o default de SESSÃO, que a RN-040
  deixa livre. O preço — as 17 linhas divergem, com origem `agent` — é
  declarado, não escondido.
- Tela NUNCA repete o enum do banco como se fosse resposta, e não colapsa
  dois estados por eles compartilharem um valor (RN-470). `origin: 'agent'`
  da cascata de modelo quer dizer DUAS coisas — o agente tem binding próprio,
  ou a cascata pousou em `workspace` e `herdarModeloDeStart` trocou o valor
  pelo do Criativo. A api está certa em devolver `agent` nos dois (o valor
  veio mesmo de um agente): quem separa é a TELA, e ela separa mostrando a
  cascata inteira como cadeia — `workspace › projeto › área › agente`, com
  `vigente`/`definido`/`vazio`/`pulado` por nó, o nível que a cascata alcançou
  marcado como definido-e-não-vigente quando o Criativo entrou, e um nó extra
  nomeando o Criativo. A derivação é do CLIENTE, sem endpoint novo; o que ela
  NÃO consegue provar (agente com linha própria igual à do Criativo) fica
  declarado, e a ação que só importa nesse caso continua acionável. Vazio tem
  texto próprio e vazios diferentes têm textos diferentes — um traço que serve
  a três significados não é neutro, é a tela recusando nomear o que sabe.
- Controle que oferece escolha abre oferecendo o que a api ACEITA naquele
  escopo, e quem decide isso é o ESCOPO, nunca a tela (RN-040). O filtro
  "aptos para agentes" do `ModelPicker` vem MARCADO nas duas telas que gravam
  onde `assertModelFitsBindingScope` exige tool calling — `agent` e `area` — e
  DESMARCADO no seletor de sessão, que grava num escopo livre de propósito:
  marcar ali esconderia o que o domínio permite, que é o defeito inverso. É
  estado INICIAL de um checkbox, nunca trava — desmarcar volta a listar tudo —,
  e não elimina o 422: cobre UMA das três causas, e a tela continua devendo o
  desfecho de recusa. Filtro ligado por padrão cria uma dívida própria: o
  vigente que ele esconde da LISTA (herdado de `project`/`workspace`, níveis que
  nunca exigiram tool calling) precisa ser DITO, com o nome do modelo e a causa
  — o gatilho mostrando um nome que a lista não contém é a tela se contradizendo.
- E o controle só é oferecido a QUEM a api deixa usar — a régua acima decide o
  QUE se oferece, esta decide a QUEM. O mínimo é do ENDPOINT, nunca da seção
  (RN-102): modelo por AGENTE pede `developer`, modelo por ÁREA pede
  `maintainer`, e as duas seções são vizinhas na mesma tela. Copiar o gate da
  vizinha por parecerem iguais produz o defeito INVERSO do que corrige, e o
  inverso é PIOR — oferecer o que será recusado ao menos termina num toast,
  enquanto trancar quem podia é invisível para quem perdeu a capacidade. A
  comparação sai de `roleAtLeast` (`apps/web/src/lib/roles.ts`, sobre
  `ROLE_ORDER`; mesmo nome da função do backend porque é a mesma regra dos dois
  lados), nunca de `role === 'x' || role === 'y'` à mão: a lista à mão acerta por
  acidente enquanto o mínimo é alto e erra calada quando é baixo. Papel AUSENTE
  não alcança nada. O que se tira é o CONTROLE, nunca a INFORMAÇÃO (ADR 0064):
  quem não pode editar continua vendo o valor vigente e a cadeia inteira, o
  controle fica inerte no lugar, e o motivo é dito UMA vez em TEXTO na seção —
  `title` em elemento `disabled` não abre no Chromium, então explicar por tooltip
  é não explicar. Nada disso é fronteira de segurança (quem recusa é o
  `RolesGuard`). O papel a LER é o EFETIVO do projeto — `projectRole ??
  workspaceRole`, uma SOBREPOSIÇÃO nos dois sentidos, e nunca "o maior dos dois"
  que três descrições de OpenAPI ainda prometem (RN-471). Onde a tela já busca
  `project_members` ele é DERIVÁVEL e a lacuna se FECHA (a seção de Membros, que
  compõe da lista que já carrega); onde não busca, lê-se o do WORKSPACE e a
  lacuna se DECLARA (as duas seções de modelo). É UMA lacuna vista de dois
  lados, não uma por seção — não a declare de novo onde os dados estão à mão,
  nem invente uma segunda fonte de papel onde não estão.
- Sinal de ambiente diz o que SABE, e proxy nunca vira garantia (RN-468).
  A tela de login é PRÉ-identidade: só cabem ali os dois `/health`, que já
  são públicos nos dois serviços — presença de runner
  (`{user_id, project_id}`) e modelos locais (`projects/:projectId/models`)
  não têm sujeito antes do login, e a tela DECLARA essa ausência em vez de
  omiti-la. Sonda tem TETO, e os três estados (`verificando`/`respondendo`/
  `sem resposta`) nunca colapsam — RN-088 vale aqui também. O formulário
  NUNCA espera pela sonda. Pós-login, `workspaceVerifiedAt` é registro de
  uma confirmação, não batimento: reconectar com o mesmo caminho nem
  regrava o carimbo, então a tela diz "pasta confirmada em <data>" com a
  ressalva, e nunca "de pé" nem bolinha verde. Quem sabe do AGORA é o
  socket do terminal, na aba Código.
- Evento tem DUAS classificações no cliente, e elas não se substituem:
  `ActivityKind` (assunto — decide ícone e cor) e `OrigemDeEvento`
  (camada — `eventos|sistema|llm|harness|agente|usuario`, RN-177). A
  origem tem UMA fonte, `apps/web/src/lib/activity.ts`, consumida pelo
  painel de log E pelo fio; a precedência dos `if` é a regra (mecanismo
  vence ator, ator vence prefixo de agente) e tipo desconhecido cai em
  `eventos` — nunca some nem abre categoria nova.
- Testes: vitest (api/web/scripts de CI), ExUnit (engine). Nenhuma
  feature sem teste do caminho feliz + 1 caso de falha. Providers de
  git e de LLM validados por suas suites de contrato únicas. A quarta
  camada é o E2E de navegador em `e2e/` (ADR 0120) e ela responde uma
  pergunta que as outras três NÃO respondem — "um navegador de verdade,
  em outra origem, entra e fica dentro?". Ela não substitui nenhuma:
  comportamento continua sendo coberto embaixo, e teste que caberia na
  suite do web não sobe para cá.
- Capability só é declarada quando provada pela suite; sem prova,
  declara-se false e degrada (regra dos ADRs 0041/0042, vale para git
  e LLM).
- O contrato de LLMProvider tem DUAS operações opcionais, e as duas seguem a
  mesma regra de dois lados: `listModels` (Fase 9c) e `embed` (ADR 0075,
  RN-189..191). Embedding é LOTE e devolve **um vetor por entrada ou erro** —
  nunca lista mais curta, porque a ordem é o único vínculo entre entrada e
  vetor e uma resposta parcial é indetectável depois. O erro LANÇA normalizado
  por `code` em vez de virar chunk: não há turno em andamento cujo gasto
  precise sobreviver. A capability tem duas camadas como as outras, com uma
  diferença que precisou ser nomeada: tool calling é GRADIENTE (modelo sem
  ferramenta ainda conversa) e embedding é EXCLUSÃO — modelo de chat não
  vetoriza e modelo de embedding não conversa (RN-190), conjuntos disjuntos.
  Só o `ollama` declara `embeddings: true`, provado contra o daemon real; os
  outros oito degradam com `false` (RN-191), e virar essa flag exige smoke com
  credencial, nunca leitura de doc. O gasto de embedding NÃO passa pelo
  metering ainda — corte declarado do ADR 0075, porque `token_usage.session_id`
  é `NOT NULL` e indexar repositório não acontece dentro de sessão.
- UI: fidelidade estrita ao design system em design/ (tokens, tipografia
  Space Grotesk/Archivo/IBM Plex Mono, dark mode primário). Contraste é
  medido por teste sobre os tokens e layout é verificado no navegador
  por scripts/dev/validacao-visual.js — as duas validações estão
  explicadas em design/README.md.
- Os DOIS temas são alcançáveis e os DOIS são medidos (ADR 0074,
  RN-182/184). `data-theme` é escrito por `apps/web/public/theme-boot.js`,
  ARQUIVO e não script inline — a imagem serve sob `script-src 'self'`, e
  inline passa em dev e é bloqueado em produção. A preferência mora em
  `localStorage['brabo.theme']` e a API é `apps/web/src/lib/tema.ts`;
  nenhum componente escreve o atributo por conta própria. Dívida de
  contraste é do tema ESCURO e está travada por número — não afrouxe um
  piso para passar, e não deixe o claro nascer pior que o primário.
- O handoff estabelece a INTENÇÃO; a medição estabelece o NÚMERO, e o
  produto estabelece o MECANISMO. Já valeu três vezes: as fontes (ADR
  0036), o boot de tema inline e cinco dos oito `--syn-*` que reprovam
  4,5:1 contra o próprio `--code-bg` do handoff (ADR 0074). Nome do
  handoff que já existe com outro nome entra como ALIAS, nunca
  renomeação — `--font-display`, `--shadow-modal` e `--r-md`/`--r-lg`/
  `--r-pill`; e `--r-sm` (7px) NÃO é sinônimo de `--radius-sm` (4px).
- Tipo novo de `proposed_action` nasce com FRASE em pt-BR em
  `apps/web/src/lib/aprovacoes.ts` — verbo e frase têm UMA fonte, e as
  três telas de decisão (Aprovações, chat da sessão, Insights) a
  consomem. `apps/web/src/lib/aprovacoes.test.ts` lê `ACTION_TYPES` do
  `decide.ts` e reprova tipo sem frase; payload cru nunca é despejado,
  nasce colapsado (RN-096).
- Segredos de usuário (API keys de LLM e tokens de git) criptografados
  com envelope encryption; nunca em plaintext no banco ou em logs.
- Decisões arquiteturais relevantes registradas em docs/adr/.

## Documentação é parte da definição de pronto (permanente)
- Ao alterar código, consulte docs/.docmap.yml e atualize os docs
  mapeados NA MESMA mudança, mostrando o diff da doc junto com o do
  código. Não pergunte se deve fazer — faça.
- Fonte de verdade do Markdown: docs/ na raiz. NUNCA crie website/docs/
  — o site lê de docs/ via path.
- Arquivos generated: true no docmap são gerados por pnpm docs:generate
  — nunca editados à mão (o próximo build sobrescreve). Se o gerador
  marcar algo como "sem descrição acima", é lacuna real: escreva a
  descrição na prosa.
- Mudança de comportamento observável → entrada em CHANGELOG.md
  (Unreleased).
- Mudança estrutural (fronteira de camada, banco, modelo de
  consistência, dependência pesada) → ADR novo com o próximo número.
  ADR aceito NUNCA é editado: o novo referencia o antigo.
- Regra de negócio nova → RN-XXX com arquivo:linha e o teste que a cobre,
  em docs/business-rules.md — EXCETO as duas famílias que saíram dele por
  TAMANHO (não por assunto): custo/orçamento/metering vai em
  docs/business-rules/custo.md e auth first-party em
  docs/business-rules/autenticacao.md. As três contam para a mesma numeração
  (nunca reinicie por arquivo) e para a mesma contagem, que o docs:check afere
  somando os três por glob. Âncora `{#rn-NNN}` é o contrato: ela não muda
  quando uma RN muda de arquivo, e link de fora aponta para o arquivo que a
  hospeda hoje.
- TODA mudança verifica se ESTE arquivo precisa mudar — Stack, Convenções,
  "O que NÃO fazer" e o estado das fases. Não pergunte se deve: verifique.
  O gatilho é o mesmo do docmap, e o motivo é que este arquivo é o único
  documento lido em TODA sessão: desatualizado, ele não é neutro, ele
  ensina errado. Ele tem regra `warn` no docmap (não `block`, porque não
  mora sob docs/ e o checker valida glob e link dentro de docs/ — promover
  sem estender o checker criaria regra que se burla com `docs-not-needed`).
- A documentação publica um site por branch permanente, e o CAMINHO nomeia o
  AMBIENTE, não a branch (ADR 0073): `main` → `/brabo/prd/`, `qa` → `/brabo/qa/`,
  `dev` → `/brabo/dev/`, com a raiz sendo o índice gerado por
  `scripts/docs/landing.mjs`. O mapa branch→caminho existe num ponto por
  processo (o passo do `docs-deploy.yml`, `DEGRAUS` no `docusaurus.config.ts` e
  no `landing.mjs`) — nunca interpole `$GITHUB_REF_NAME` num caminho.
- A versão anunciada em PROSA é verificada por `pnpm docs:check` em DOIS
  arquivos, contra o primeiro `## vX.Y.Z` do CHANGELOG: `README.md` e
  `docs/intro.md` (a primeira página do site). Quem escreve os dois é
  `scripts/ci/readme-version.ts`, no mesmo commit do corte do CHANGELOG —
  cobrar o que o gerador não escreve faria todo release nascer vermelho numa
  PR do bot. Frase alterada sem ajustar o padrão reprova como `CEGO`, de
  propósito.
- Antes de finalizar: pnpm docs:check e pnpm docs:build verdes (glob
  morto, gerado fora de dia e link quebrado reprovam).
- Nunca inventar conteúdo de doc: sem informação suficiente, use
  > **TODO(humano):** <pergunta específica>.
- Diagramas em Mermaid no próprio Markdown. Nunca imagem de diagrama.
- O mecanismo inteiro está explicado em
  docs/explanation/documentation-workflow.md — leia antes de desligar
  qualquer peça dele.

## O que NÃO fazer
- Não usar Redis (filas ficam no Postgres via Oban)
- Login social (GitHub/GitLab) deixou de ser proibido e está
  IMPLEMENTADO (ADR 0084, PROGRAMA 28/Onda 5, frente I) — a proibição
  foi revogada só para essa capacidade, por decisão explícita do dono
  do produto. O que continua valendo do backlog do ADR 0031: não
  implementar MFA, OIDC provider (a api virar provedor) nem federação
  genérica
- Dev Lead, áreas dinâmicas via module_map e o aparato genérico de
  áreas (agent_areas) deixaram de ser proibidos e estão IMPLEMENTADOS
  (ADR 0053 aceito, FASE 14d). O que continua valendo é o resto da
  regra: não abra área nova de passagem — área nova é decisão de
  produto, com ADR
- Não versionar à mão: toda tag nasce de workflow
- Não instalar libs sem justificar no plano
- Não refatorar código de fase concluída sem pedido explícito
- Não ativar modelo descoberto automaticamente: curadoria manual
  sempre (ADR 0042)
- Não corrigir de passagem os achados que seguem ABERTOS em
  docs/explanation/achados-execucao-real.md — corrigir fora da fase que os
  endereça apaga a evidência de por que existiam. Os 19 achados do
  dogfooding fecharam (19 de 19, ver a FASE 13c); o que resta aberto é da
  execução real e NÃO é bug a corrigir, é decisão de produto: Z/AD (o
  allowlist de verbos não converge — verbo, forma e invocação são espaços
  distintos) e AE (o agente de QA tenta consertar o código que julga,
  contra o próprio prompt, contido por duas barreiras independentes)
- (FASE 15 — CONCLUÍDA) O congelamento de gates valeu enquanto a fase
  corria — nenhum gate NOVO, nenhuma mudança de comportamento de gate
  existente — e terminou sem exceção nenhuma: a fase só DECLAROU e MEDIU
  o que já existia. Segue valendo a regra permanente de que gate novo é
  decisão de produto, com ADR
- (FASE 13 — CONCLUÍDA) O congelamento valeu enquanto a fase corria, e
  vale registrar como terminou, porque a regra funcionou: quatro exceções,
  todas pelo MESMO critério — só o que impedia a própria medição de
  acontecer. Fase F (achados S e U), achado W, achado Y e achado AB. As
  correções de INSTRUMENTO (o script da validação, o Noop, o medidor) não
  precisaram de exceção, e a distinção entre instrumento e produto se
  provou útil o tempo todo. O que a disciplina evitou está registrado: a
  nona execução podia ter passado liberando `bash` no allowlist, e isso
  teria destruído a garantia para fazer o teste passar