# Brabo — Plataforma de engenharia orquestrada por agentes

## O que é
Sistema que gerencia o ciclo completo de uma aplicação: provisionamento de
repositório, Gitflow, agentes de IA especializados (Criativo, PO, Arquiteto,
Devs, Infra, QA, SecOps, Psicólogo, Anamnese), controle de custos de token
e pipeline de aprovação de ações com autoridade final do usuário.

## Status
- FASE 1 (MVP) — CONCLUÍDA: IAM/RBAC, sessões com event log imutável,
  chat com roteador de LLM (Ollama + APIs), metering/budget de tokens,
  pipeline de proposed_actions + permissions.json, motor Elixir/OTP com
  supervisão e evento de término.
- FASE 2 — CONCLUÍDA: GitProvider (Local/GitHub/GitLab) com suite de
  contrato e capabilities, credenciais criptografadas, bootstrap de
  Gitflow idempotente e retomável via pipeline, wizard com progresso
  ao vivo.
- FASE 3 — CONCLUÍDA: Harness (PromptAssembler, ToolLoop,
  ContextManager, InstructionFiles, Hooks), handoffs explícitos,
  agentes Criativo, PO e Arquiteto com artefatos e validações no
  domínio.
- FASE 4 — CONCLUÍDA: agentes de execução (devs dinâmicos por módulo
  em worktrees isolados, QA e SecOps como gates de PR, Infra
  propositivo), trava de merge protegido, painel do time ao vivo;
  Psicólogo real e Anamnese com loop fechado. Gates validados por
  execução real (ADR 0020).
- FASE 5 — CONCLUÍDA: imagens de produção non-root e CI (ADR 0024),
  Kubernetes com Kustomize, HPA por fila do Oban, NetworkPolicies e
  ESO (ADR 0025), graceful shutdown + OpenTelemetry + dashboards
  (ADR 0026), backup com restore testado, runbooks e hardening
  (ADR 0027).
- FASE DOC — CONCLUÍDA: docs/ como fonte única com Diátaxis, site
  Docusaurus em website/ lendo de docs/, referências geradas,
  docs/.docmap.yml + drift check (docs:check) no CI, camada de
  comunidade, MIT verificado, mecanismo documentado em
  docs/explanation/documentation-workflow.md.
- FASE 6 — CONCLUÍDA: política de branches mecanizada (ADR 0030) —
  pr-police, approval-ladder com os dois modos, promote/tag-release
  com versão calculada e âncora por árvore, backmerge gate com
  retropropagação automática, rulesets versionados. Esteira exercitada
  de ponta a ponta (v0.1.0 → v0.2.0) e a cadeia de hotfix validada por
  execução real.
- FASE 7 — CONCLUÍDA: auth first-party substituindo o Keycloak —
  argon2id, access Ed25519, rotação de refresh com revogação de
  família, lockout progressivo, tokens de conta e MailSender log-only
  (ADR 0031, RN-030..033); corte atômico com emissor próprio, RBAC
  intocado, /internal/* com service token, cookie httpOnly + CSRF,
  migração de usuários e remoção total do Keycloak (ADR 0032,
  RN-034/035); OpenAPI nos 23 controllers com DTOs travados por tipo,
  teste de tabela exigindo metadados, docs/reference/api/ gerado com
  manifesto de hashes (ADR 0033).
- FASE 8 — CONCLUÍDA COM CORTE: hierarquia de agentes — áreas com lead
  único como contato externo, delegações internas privadas (tabela
  `delegations`, `area` como TEXT), veredito consolidado com
  rastreabilidade, falha com origem; QA como área (Lead + Automação +
  Performance/Segurança, contrato externo dos gates inalterado — suite
  da Fase 4 verde sem modificação); Infra como área com subagente
  Workflows gerando CI por provider; painel do time por área e
  Psicólogo/Anamnese mirando subagentes (ADR 0038).
  CORTE DE ESCOPO da época, REVOGADO pela FASE 14d:
  `agent_areas`/`agent_area_members` existem desde então, por projeto,
  com `max_parallel` configurável — foi a área de dev, a primeira
  DINÂMICA, que forçou. O que segue cortado é só o **budget por área**
  (tetos de orçamento reais continuam sendo projeto, sessão e task).
  A lista de `apps/web/src/lib/agents.ts` sobreviveu para cor, ícone e
  a REGRA de endereçamento; os membros de dev vêm da tabela.
- FASE 9 — CONCLUÍDA: suite de contrato de LLMProvider rodando
  contra os existentes, base OpenAICompatibleProvider sobre
  node:http com timeout de INATIVIDADE, erro normalizado por `code`,
  capabilities em duas camadas (ADR 0041); sync de catálogo com modelo
  descoberto entrando desativado, modelo sumido marcado em vez de
  apagado, preço congelado em `token_usage` com auditoria append-only
  (ADR 0042); ModelPicker reagrupado por origem com curadoria.
  Os seis providers da 9b entraram pela Fase 11 (ADR 0043).
- FASE 10 — CONCLUÍDA: Bitbucket + GenericGitProvider entregues VIA
  dogfooding (primeira execução real do Brabo construindo o próprio
  Brabo, em fork com seed manual, tandas com restart entre tasks,
  Criativo obrigatório na cadeia). Colheita escrita na Fase 12d, em
  docs/explanation/primeiro-dogfooding.md — os 17 achados com
  arquivo:linha são reais; a metade QUANTITATIVA (restarts,
  intervenções, custo) ficou como `não medido`, porque a tabela de
  observação nunca foi preenchida. Os três P1 de operabilidade foram
  fechados pela Fase 12. Os outros 14 seguem abertos e listados na
  colheita — não corrija de passagem.
- FASE 11 — CONCLUÍDA: os seis providers da Fase 9b como config sobre
  a base, cada um investigado do zero contra a doc oficial (proibido
  herdar quirk); LLM_PROVIDER_NAMES de 3 para 9; DTO de credencial e
  testador de conexão derivando de lista única; capability só
  declarada quando provada, com duas reversões ao vivo (DeepInfra e
  Vultr); único hook novo na base (`parseErrorFrame`, +31 linhas)
  provado necessário pelo OpenRouter (ADR 0043).
  Pendência dos smokes com credencial real: absorvida pela FASE 13.
- FASE 12 — CONCLUÍDA: operabilidade pós-dogfooding, os três achados
  P1 fechados e provados numa execução única (ADR 0047).
  12a — adoção de repositório existente: rota própria, `getRepo`
  validando acesso antes de gravar, `origin` (created|adopted) nas duas
  tabelas, e o PLANO como portão — dry-run que descreve a divergência e
  não altera nada enquanto a decisão for nula; readotar converge
  (ADR 0044, RN-045/046).
  12b — reagendamento do dev agent por evento: máquina de estados
  persistida (working|awaiting_gate|idle|idle_tripped) reagindo a dois
  eventos da outbox existente, `awaiting_gate` retendo o worktree (que
  é por AGENTE, não por task) até o gate terminar, e circuit breaker
  com rearm explícito (ADR 0045, RN-047).
  12c — promoção de story com autoridade do usuário: `story_promotion`
  por projeto com `manual` como DEFAULT NOVO (backfill dirigido põe os
  projetos existentes em `auto`), `proposed_ready` como proposta e não
  estado, promoção reusando o TransitionStoryUseCase (código morto do
  achado #13) e recusa devolvendo ao PO com o motivo fixado na sessão
  dele (ADR 0046, RN-048).
  12d — o Noop entrou na máquina de estados da 12b; script
  `pnpm --filter api validacao:fase-12` que sai != 0 quando o critério
  não fecha e extrai a evidência do banco; colheita da Fase 10
  escrita; docmap cobrindo engine/dev e engine/agents.
  Pendências (execução da validação; limites Local/Noop declarados):
  absorvidas pela FASE 13.
- Não refatore o que está pronto sem pedido explícito.

## FASE 13 — CONCLUÍDA em 2026-08-07 (provar de verdade e triar)
Nenhuma feature nova. A fase fecha as pendências declaradas, prova o
que a validação Local/Noop declaradamente não prova, e transforma os
19 achados abertos em plano priorizado. Lição incorporada: a tabela
manual da Fase 10 nunca foi preenchida — nesta fase TODA métrica é
extraída por script do event log/token_usage, nunca anotada à mão.

### 13a — Fechar as pendências declaradas
1. CONCLUÍDO em 2026-08-07: `pnpm --filter api validacao:fase-12` sai `0`
   e a tabela de event ids está em docs/explanation/validacao-fase-12.md
   (o TODO(humano) saiu). Custou quatro correções — três do INSTRUMENTO
   (a cobaia nascia em /tmp, invisível ao engine; o Noop não abria o
   gate; o Noop morria em `pr_settled`) e uma do PRODUTO (achado W: o
   dev agent morria quando a fila esvaziava).
2. PARCIAL em 2026-08-07: o smoke do **OpenRouter** rodou com credencial
   real e fechou (custo real US$ 0,000005, lido do `token_usage`). Os
   outros cinco seguem pulados — não há chave deles no ambiente. O smoke
   estava apodrecido contra o ADR 0049 e nunca tinha rodado; corrigido
   junto. Resultado datado em docs/explanation/aceite-providers.md

### 13b — CONCLUÍDA em 2026-08-07 (v2.4.0)
A cadeia inteira provada contra GitHub REAL (`daneiel/test`), em dez
execuções: adoção remota → plano com decisão do usuário → promoção
manual de UMA story → dev agent real escrevendo código → commit, push e
PR REMOTA → gate abre → área delega e dispensa com justificativa →
subagente SUSPENDE em aprovação → a recusa do usuário RETOMA o laço →
veredito `changes_requested` por LLM. Zero restart do engine. Merge
fora, por desenho (RN-014).
3. O roteiro é `pnpm --filter api validacao:real`, com fases separadas
   por CUSTO (`--ate adocao|backlog|execucao`) — a barata roda sozinha
   primeiro, e foi assim que erros de configuração apareceram antes de
   custar dinheiro. Exige execução DE DENTRO do container da api: a
   política é arquivo em volume compartilhado, e pelo host ela nasce
   num filesystem que o engine não enxerga.
4. `pnpm --filter api medir:execucao` é o instrumento, e está PROVADO:
   reproduz sozinho os números que o dogfooding anterior anotara à mão
   (18 chamadas, 292.211 tokens, ~US$ 0,03).
5. Resultado em docs/explanation/validacao-real.md, com as dez
   execuções e o que cada uma ensinou.

SETE P1 fechados no caminho, todos achados por EXECUÇÃO e nenhum por
teste: W (dev agent morria com a fila vazia), Y (a busca não distinguia
vazio de não-encontrado), AA (credencial de git resolvida por quem
clica, não por quem paga — RN-082), AB (gate chamava decisão pendente
de falha de infra — ADR 0057), AC (redirecionamento tornava qualquer
comando inaprovável), o ReDoS no escopo de caminho (CodeQL HIGH), e a
CVE do postgrex.

Dos achados que a fase abriu, X fechou depois (FASE 14d, RN-085 — o
teto de iterações virou por TIPO de agente). DOIS seguem abertos, e o
argumento deles vale mais que os números: Z e AD (o allowlist de verbos
NÃO converge: verbo, forma e invocação são espaços distintos, e as
execuções 6/7/8 travaram em um de cada), e AE (o agente de QA tenta
consertar o código que julga, contra o próprio prompt — contido por
duas barreiras independentes, allowlist e escopo). Nenhum dos dois é
bug a corrigir: são decisão de produto, e estão em
docs/explanation/achados-execucao-real.md.

A conclusão que a fase entrega, e que importa mais que a PR: o caminho
para autonomia NÃO passa por afrouxar política. Passa por o agente
ESPERAR a decisão em vez de morrer — o que o ADR 0057 fez para os
gates, estendendo o 0052.

### 13c — CONCLUÍDA: a triagem virou docs/explanation/backlog.md
Os 19 achados estão fechados (19 de 19). O documento segue vivo e
recebeu os achados novos da 13b.
6. Sessão de triagem: ler docs/explanation/primeiro-dogfooding.md e
   classificar os 19 achados em P1/P2/P3 com proposta de agrupamento
   em fases coesas (por tema e dependência entre eles), custo relativo
   estimado (P/M/G) e risco de esperar. A saída é PROPOSTA — a
   decisão de prioridade é do usuário.
7. Consolidar o backlog completo num documento vivo
   (docs/explanation/backlog.md ou equivalente): achados triados +
   itens antigos — budget por área (ADR 0038; o aparato de áreas e o
   Dev Lead saíram do backlog com o ADR 0053, implementado
   pela FASE 14d), handoff manual a agente à escolha,
   MFA/social/OIDC/federação (ADR 0031),
   SMTP real no MailSender, deploy (DEPLOY_ENABLED + Environments),
   volta da rc/rcfix (ADR 0030), modo community do approval-ladder,
   "N agentes online" no dashboard, preferência de moeda com taxa
   manual.

## FASE 14 — CONCLUÍDA em 2026-08-07 (o que a execução real exigiu)
A execução do hello world não passou do primeiro turno e revelou defeitos que
nenhuma suite pegava, porque tudo antes rodou com modelo LOCAL. As correções
já entraram; o que sobra é feature decidida pelo usuário durante a execução.

### 14a — Operabilidade dos agentes (CONCLUÍDA)
- Falha de turno virou `agent.error` DURÁVEL com origem, e o agente FALA no
  fio; os quatro conversacionais paravam de gravar `agent.response` vazio
  (RN-059). O caminho do erro narrado no frame final, que não emitia evento
  nenhum, também fechou.
- O chat do Criativo abre com convite em vez de vazio: ele é ativado e espera
  o usuário falar primeiro, e a tela agora diz isso — incluindo que tecnologia
  e código NÃO são dele.
- A chave que o agente gasta é a do OWNER do workspace (RN-058). Antes o turno
  procurava a credencial pelo SLUG do agente numa coluna UUID: nenhum agente
  jamais usou provider com credencial, e só `ollama` funcionava.
- Relatório de gasto das chaves, só para o owner, com agente separado de
  pessoa (RN-060).
- Bootstrap de Gitflow no GitHub: repo recém-criado responde 409 em toda a Git
  Data API, e o primeiro commit passa pela Contents API. O backend falso dos
  testes mentia (404 onde o GitHub responde 409) — corrigido junto, é o que
  fazia a suite ficar verde com o produto quebrado.

### 14b — Linha do tempo em árvore (CONCLUÍDA)
Um ramo por agente, do primeiro marco ao que ele está fazendo AGORA, derivado
100% do event log que a tela já busca. O feed cronológico continua, na coluna
de atividade: ele responde "o que aconteceu", a árvore responde "quem está
fazendo o quê".

Revisitado depois da FASE 26 (sem fase nova, mesmo espírito de correção
pontual da 12d/PÓS-FASE 15): o critério de abertura padrão passou de só
"ativo/parado" para os 5 agentes de atividade mais RECENTE — ativo continua
com prioridade (RN-118); cada ramo colapsado ganhou contador de NOVIDADE
próprio, com "último visto" por agente em `read-state.ts` (mesmo mecanismo
do sino, agora granular); e `tool.call`/`tool.result`/`agent.response`
passaram a expandir INDIVIDUALMENTE (args, resultado, iteração), agrupados
por fronteira de iteração do ToolLoop.

### 14c — Validação automática de UI (CONCLUÍDA)
Contraste virou teste sobre `design/tokens.css`, com a dívida conhecida medida
e travada; layout (texto cortado, menu fora da viewport, dropdown recortado
por ancestral, alvo < 24px) virou verificador de navegador em
`scripts/dev/validacao-visual.js`. Sem dependência nova.

### 14d — CONCLUÍDA: paralelismo decidido pelo LEAD, autorizado por você
Entregue em quatro PRs (#181, #182, #183, #184). O ADR 0053 passou a
ACEITO, revogando de vez os três cortes (Dev Lead, áreas dinâmicas via
module_map e o aparato genérico de áreas).

1. **Áreas viraram dado**: `agent_areas`/`agent_area_members` por
   projeto, com `max_parallel` default 2. O que forçou foi a área de
   **dev** — a primeira DINÂMICA, cujos membros são um por módulo do
   module_map. O que não é enumerável em código tem de ser dado.
2. **O teto é da SESSÃO, não do módulo** (RN-083). Contar por módulo
   permitiria N módulos × 2 sem autorização nenhuma — o buraco anterior
   com outro nome. Acima do teto vira `proposed_action`.
3. **Configurável por área** em Configurações, exigindo `maintainer`
   pelo mesmo motivo de ativar execução: mudar o teto é decidir quanto
   o produto gasta sem perguntar.
4. **A Anamnese propõe subir** quando autorizar virou rotina — três
   aprovações e NENHUMA negação (RN-086). Uma negação derruba o sinal:
   se você recusou alguma vez, o teto está fazendo o trabalho dele.
5. **O Dev Lead existe** (RN-087), conversacional, recebendo o handoff
   do Arquiteto na mesma confirmação que já entrega ao Infra, e
   propondo o plano: quantos agentes por módulo e por quê. Os
   `dev-<modulo>` deixaram de ser endereçáveis por handoff — a regra do
   ADR 0038 passando a valer para o dev como já valia para QA e Infra.

O **achado X** foi fechado aqui (RN-085): `TOOL_LOOP_MAX_ITERATIONS`
virou teto POR TIPO — 8 conversacional, 60 execução e gate. O critério
de quem sobe NÃO é "quem trabalha muito": é quem tem
`token_budget_micros` por baixo segurando o gasto. `infra-workflows`
usa ferramenta pesada e fica em 8, porque roda sem budget.

**Três lacunas da própria fase, achadas por mim ao escrever a fatia
seguinte, e todas a mesma falha**: a regra do teto entrou com testes
verdes e o produto não a exercitava — nenhuma rota chamava o caso de
uso, aprovar a ação não executava nada, e o tipo podia ser
auto-aprovado por permissions.json (fechado pela RN-086). Testar a peça
não é testar o caminho até ela.

**Fora do escopo, por decisão declarada** (ADR 0053 item 5, não
implementado): o botão "Ativar execução" mudar de dono, e a delegação
Dev Lead → `dev-<modulo>` pela tabela `delegations` com `area = "dev"`.
As duas são reversíveis; a execução continua no caminho atual, e a
correção pós-gate continua indo direto ao dev que abriu a PR.

## FASE 15 — CONCLUÍDA em 2026-08-07 (gates como dado)
Nenhum gate NOVO. A fase extrai para docs/gates.yml os gates que JÁ
existem implícitos no produto, com verificação por script e severidade,
no mesmo espírito do docs/.docmap.yml. Gate de agente que não existe
(dev-lead, platform) entra como `status: planned` referenciando o
backlog — nunca ativo. O contrato externo dos gates NÃO muda.

### 15a — CONCLUÍDA: registro declarativo
1. docs/gates.yml com os gates existentes (ver ADR 0054, que estende o
   ADR 0048 — a decisão no event log é o que torna a passagem de um
   gate mensurável), schema validado por teste.
2. Loader na api lendo o registro; endpoint interno de leitura.
3. Script `pnpm --filter api validacao:gates` que extrai do event log
   a última passagem de cada gate ativo e sai != 0 se algum gate
   `block` não tem evidência de verificação por script.

Nem todo gate tem prova no event log, e o registro diz onde ela mora:
`merge-protegida` é garantido por TESTE (a trava em decide.ts não emite
evento próprio) e `backmerge` é CI, com estado em .release/gate.json.
Por isso cada gate declara `evidencia: event_log | teste | ci` com o
localizador — rebaixá-los a `warn` seria mentir sobre as travas mais
duras do produto.

### 15b — CONCLUÍDA: consumo
4. Painel do time exibe o gate que cada story/PR está aguardando,
   derivado do registro (não hardcoded).
5. docs/explanation/gates.md explicando o mecanismo, no docmap.

## PÓS-FASE 15 — CONCLUÍDO em 2026-08-08 (v2.5.0 e v2.5.1)
Não é fase planejada: é o que o USO encontrou depois da 15, e está aqui
porque a origem de cada item importa. Nada disto veio de roteiro — veio
de navegar a app no Chrome e de ler o painel de segurança.

**Defeitos de UI, achados navegando** (RN-088..091):
- `429` virava TELA BRANCA e a app respondia com mais tráfego. A regra
  virou geral: toda tela distingue TRÊS estados — carregando, erro (com
  `trace_id` e botão) e vazio. `if (!dado) return null` colapsa os três.
- Dashboard fazia uma requisição por projeto: **3.824 → 12 req/min**, com
  `GET /workspaces/:id/projects-summary`. O sino era a metade que
  faltava: **289 → uma** requisição por ciclo (RN-090/091).

**Endurecimento de segurança, com os dois painéis a ZERO**:
- ADR 0058 — CSP fechado na api (`default-src 'none'`), revisando o item
  7 do ADR 0027; e o `projectId` contido na raiz (RN-092), que atingia
  não só o `permissions.json` como o escopo que AUTORIZA terminal.
- ADR 0059 — `GIT_OAUTH_STATE_SECRET` sem default em produção (RN-093).
  O default era PÚBLICO (`.env.example`) e o compose de produção o supria
  como fallback: exigir "não vazia" não teria pego nada, porque no caminho
  real de erro a variável estava DEFINIDA.
- Alerta que não se sustentava foi DISPENSADO com justificativa escrita,
  nunca silenciado — e dispensar é decisão do usuário, não do agente.

**Três lições operacionais que custaram ciclo de CI, e valem como regra:**
1. **CodeQL verde numa PR não prova que alerta antigo fechou** — o check
   de PR reporta alerta NOVO. Alerta fecha na varredura do branch DEFAULT,
   isto é, só depois de a correção chegar em `main`.
2. **Gitleaks varre commits alcançáveis de `refs/heads/*`, não a árvore.**
   Um valor de alta entropia commitado uma vez reprova o CI para sempre
   naquele branch; corrigir por cima NÃO limpa. A saída é o commit deixar
   de ser alcançável (reconstruir a partir de `dev` e APAGAR o branch
   antigo ANTES de abrir a PR nova) — nunca allowlist, que cega o scanner
   naquele caminho para todos os commits. Refs de PR não entram no escopo.
   Fixture que representa segredo nasce SEM entropia.
3. **Barreira que mora em outra função o CodeQL não enxerga** — daí os
   três `js/path-injection` sobreviverem à correção. Manteve-se a checagem
   centralizada (RN-092) e pagou-se o preço no painel: duplicá-la em cada
   chamador seria checagem que um dia diverge.

## PROGRAMA 16–26 — o que a navegação pediu (em execução)
Onze pedidos nascidos da PRIMEIRA navegação real na app depois do reset do
banco. Não é roteiro: é uso. Três descobertas da investigação definiram o
tamanho e a ORDEM do programa, e vale registrar cada uma, porque nenhuma
estava no pedido original:

1. Existe um handoff de design COMPLETO em `design_handoff_brabo/` — 8 telas
   de alta fidelidade, tokens, tipografia e marca. A decisão foi adotá-lo
   INTEIRO e PRIMEIRO: assim os onze pedidos nascem no visual novo em vez de
   serem feitos duas vezes.
2. O terminal da aba Code virou decisão de ARQUITETURA. Cada projeto passa a
   ter container próprio, e é o ARQUITETO quem decide a imagem. Dentro dele o
   agente é livre; `git push`, PR e deploy continuam humanos. Isso paga a
   maior dívida aberta do produto — hoje o agente executa no MESMO container
   que o monorepo do Brabo, e o ADR 0055 diz de si que é política, não
   isolamento.
3. Dois defeitos reais apareceram no caminho, e nenhum foi pedido:
   `agent_areas` NUNCA é gravada (`upsert` sem chamador, a API devolve `[]`),
   e a gaveta do sino ordena `seq ASC` no SQL — mostra os mais ANTIGOS.

Teto de execução: no máximo QUATRO subagentes em paralelo. As fases foram
cortadas por ARQUIVO DISPUTADO, não por tema — é o que torna o paralelismo
possível. O limitador do backend é `apps/api/src/db/migrations/meta/_journal.json`
e os snapshots do drizzle: UMA migration por onda, porque resolver conflito de
snapshot à mão é caminho para schema divergente. Faixas de RN e números de ADR
são PRÉ-ALOCADOS antes de a onda começar: duas fases paralelas escrevendo
`RN-094` fazem uma renumerar no merge, e RN renumerada quebra os links
`#rn-0xx` que o `pnpm docs:check` reprova.

### FASE 16 — CONCLUÍDA: fundações (destravar o paralelismo)
Nenhum dos onze pedidos entrega aqui. A fase existe porque três deles tocam
os MESMOS quatro pontos de `router.tsx`/`ProjectPage.tsx`, e outros três
esbarram na falta de peça comum. Sem ela, as ondas colapsam para execução
serial.
1. `design/tokens.css` recebe `--violet` (agentes/IA) e o que mais o handoff
   define. As fontes CONTINUAM self-hosted — seguir o handoff aí quebraria a
   app sob o CSP do nginx (ADR 0036). O teste de contraste cobre os pares
   novos, e a dívida conhecida de 4 pares segue travada.
2. A aba deixa de ser lista fechada em DOIS lugares: registro único de onde
   `PROJECT_TABS`, `type TabKey`, a régua e o render passam a derivar. Teste
   que reprova chave num lugar e ausente no outro — é o defeito real.
3. `Disclosure` no design system, com a semântica da implementação mais
   completa que já existe (`ModelCatalogSection`). COMPONENTE SÓ: nenhuma das
   seis implementações ad-hoc migra aqui, senão a fase abriria os três
   arquivos mais disputados do programa.
4. Rótulo de sessão vira helper e os cinco `slice(0, 8)` inline migram. É
   esta migração que impede a FASE 20 de colidir com a 19.
5. `CLAUDE.md` entra na definição de pronto (ver a seção de Documentação), com
   regra `warn` no docmap. ENTREGUE: a regra é `claude-md` em
   docs/.docmap.yml, disparada por `package.json`, `pnpm-workspace.yaml`,
   `apps/*/package.json`, `apps/engine/mix.exs`, `docs/adr/*.md` e
   `docs/gates.yml` — a frase "hoje ele tem ZERO cobertura" que estava aqui
   descrevia o estado ANTES da fase e ficou mentindo depois dela.

### FASE 17 — CONCLUÍDA: as 8 telas conforme o handoff
Fidelidade visual ANTES do comportamento, para não refazer trabalho. Nenhuma
regra de negócio muda: se uma tela precisar de dado que não existe, isso vira
pendência declarada, não feature de carona.
6. Login e App/lista de projetos.
7. Projeto e Sessão, preservando os três estados da RN-088 (erro antes de vazio).
8. Aprovações e Configurações — Aprovações é a base visual da FASE 19.
9. Prova de que a fidelidade aconteceu: contraste medido sobre os tokens e
   layout verificado por `scripts/dev/validacao-visual.js` em TODAS as telas
   tocadas. O `.dc.html` é referência, NÃO código para copiar — o próprio
   README do handoff diz isso.

### FASE 18 — CONCLUÍDA: a área existe no banco (defeito, corrigido antes)
10. `AgentAreaRepository.upsert` não tem NENHUM chamador, então quatro casos
    de uso operam sobre tabela vazia. Provisionar na criação do projeto +
    backfill, com teste que prova que projeto recém-criado TEM áreas — é a
    mesma falha da FASE 14d: testar a peça não é testar o caminho até ela.
11. Colapsar as TRÊS cópias da lista de áreas (api, web, engine) em uma fonte.

### FASE 19 — CONCLUÍDA: aprovação que se lê
12. Matar o fallback genérico do `ApprovalCard`, que despeja
    `chave: JSON.stringify(valor)` — a causa provável do "difícil de ler".
    Todo tipo ganha FRASE em pt-BR; tipo sem frase mostra verbo + "ver
    detalhes" e o payload cru nasce COLAPSADO, nunca despejado.
13. Colapso nos TRÊS lugares: Aprovações, Insights e o card no chat, com verbo
    e frase saindo de UM módulo.
14. Restrição de projeto: o colapso NÃO introduz prop nova obrigatória em
    `ApprovalCard`. É isso que mantém `SessionPage.tsx` intocado e tira a
    aresta com a FASE 20.

### FASE 20 — CONCLUÍDA: a sessão ganha identidade
15. `sessions` ganha `kind` e `name` na MESMA migration — duas migrations
    sobre a mesma tabela colidem no journal e nos snapshots.
16. Reconciliar com a derivação por evento: `kind` classifica a INTENÇÃO de
    criação, `execution.activated` continua classificando ESTADO de execução,
    e nenhum reescreve o outro. `execution.activated` em sessão consultiva é
    erro explícito, não conversão silenciosa.
17. Renomear preservando a hashtag; sem nome, degrada para ela sozinha.
18. Botão de voltar ao dashboard — hoje `SessionPage.tsx` não importa `Link`
    nem `useNavigate`, e NENHUMA navegação sai da tela. Destino revisto numa
    rodada posterior: o botão volta ao PROJETO da sessão
    (`/projects/:projectId`), não mais ao dashboard raiz — a sessão sempre
    nasce dentro de um projeto.

### FASE 21 — CONCLUÍDA: o volume de eventos (RN-099/100)
19. `useSessionEvents` continua sendo o ESTADO ATUAL (`latest`, quatro
    consumidores: roster, árvore, execução, Aprovações). O HISTÓRICO virou
    `useSessionEventHistory`, só para as Atividades, com o `afterSeq` que o
    endpoint já devolvia. Nenhuma rota nova, nenhum parâmetro novo.
    A âncora é a CAUDA, e não o começo da sessão: o endpoint pagina para
    frente e não existe `beforeSeq`, mas abrir o feed no evento nº 1 de uma
    sessão de milhares entrega a tela errada. Então a primeira página é a
    mesma leitura `latest` (MESMA `queryKey`, deduplicada) e cada clique desce
    uma janela fixa para trás.
20. O sino ordena `DESC` no SQL. O corte de "lido" NÃO mudou de semântica, e
    por isso não há ADR: um corte por `seq` marca um PREFIXO e a gaveta mostra
    um SUFIXO, então "marcar as 50 exibidas" é inexprimível sem tabela de
    lidos por evento. O que mudou é a gaveta parar de esconder o que o avanço
    engole — total por projeto, `+ N mais antigos`, e o botão dizendo quantas
    marca. O número que falta sai de SUBTRAÇÃO (`latestSeq` menos o corte),
    não de requisição.
21. A economia da RN-090/091 não regrediu: uma requisição por ciclo, e o
    primeiro "carregar mais antigos" custa ZERO — a leitura `latest` traz 200
    e a janela mostra 100. Página antiga tem `staleTime: Infinity` e nenhum
    `refetchInterval`: janela fechada de `seq` sobre evento imutável não muda.

### FASE 22 — CONCLUÍDA em 2026-08-09 (gasto com duas audiências)
Entregue como a aba **Gastos** (ADR 0063, RN-101).
22. As AGREGAÇÕES que faltavam entraram num método só —
    `sumGroupedBy(dimensao, escopo)` com `model`, `project`, `actor`,
    `session` e `day`. `provider` NÃO é dimensão dele, e a ausência é
    estrutural: quebrar por provider é quebrar por CREDENCIAL, e é isso
    que impede a visão do membro de ganhar o eixo por descuido — não há
    argumento a passar.
23. Sem lib de gráficos: barras diárias e ranking em SVG inline. A série
    diária vem DENSA da api (dia sem gasto entra com zero), senão três
    chamadas em três semanas viram três barras coladas.
24. A colisão foi resolvida separando as PERGUNTAS, não os filtros. O
    relatório por CREDENCIAL segue exclusivo do owner (RN-060) e ganhou
    ao lado a quebra do workspace por modelo/projeto/ator/dia, também
    `owner`. A visão do membro é por ATOR, em tokens e custo estimado,
    sem provider e sem credencial — e o ator sai do TOKEN autenticado,
    sem parâmetro onde escrever o id de outra pessoa. Agente não entra na
    conta do membro: `token_usage` registra quem gastou, não quem mandou
    gastar.

Sem migration, mas COM medição: a 525 mil linhas as consultas saem em
55 ms e 38 ms por seq scan, e um índice em `token_usage(created_at)` as
levaria a 32 ms e 19 ms. O número está no ADR; o índice entra na onda que
tiver o slot.

### FASE 23 — CONCLUÍDA em 2026-08-09 (modelo herdável por área)
25. Escopo `area` entrou na cascata (`sessão > agente > área > projeto >
    workspace`), ENTRE agente e projeto: é o padrão que lead e subagentes
    compartilham, e o agente diverge sobrepondo-o (ADR 0064, RN-102).
26. A incoerência resolvida ANTES de codar: o binding de agente era GLOBAL
    (`scope_id` = slug puro, `:projectId` da rota ignorado desde a Fase 9a) e
    área é por projeto desde o ADR 0053. Escopo por projeto acima de escopo
    global faria o mesmo agente resolver modelos diferentes só onde houvesse
    área. Decisão: o binding de agente passou a ser por projeto também —
    `scope_id` de `agent`/`area` virou composto, `<projectId>:<slug|chave>`
    (RN-103) — e não a área abaixo do agente, que contrariaria "padrão
    herdável" (quase todo binding hoje é de agente).
27. A UI mostra quem HERDA e quem DIVERGIU (`AreaModelsSection` e a coluna
    Origem de `ModelsSection`, em `ProjectSettingsTab.tsx`); "voltar a
    herdar" é `DELETE` no binding do agente/área, nunca grava nele o modelo
    do nível de baixo — copiar viraria cópia que diverge sozinha na próxima
    mudança da área. Papel `maintainer` para mudar o modelo da área (mesma
    régua do teto de paralelismo, RN-083); o do agente continua `developer`.

### FASE 24 — CONCLUÍDA: Chat e Criativo como lugares (RN-104)
28. Duas abas na tela de PROJETO, cada uma listando as sessões do seu `kind` e
    criando naquele `kind` sem perguntar de novo. A Sessão continua tela
    própria — a aba não virou contêiner de chat.
29. A colisão foi resolvida com "Sessões" SAINDO da régua. O que ficou dela é
    a CHAVE de deep-link: o Chat carrega `key: 'sessions'`, e é isso que faz um
    `?tab=sessions` antigo abrir no Chat com a aba MARCADA. Alias resolvido só
    no painel abriria o painel certo e deixaria a régua sem seleção, porque
    `Tabs` compara `active` com `key` e quem escreve `active` é o
    `ProjectPage` — um dos dois arquivos que a onda manteve fechados.
30. **Veredito sobre "Iniciar ideação"**: ele FICA. Metade do problema já tinha
    fechado na FASE 20 (o botão sumiu da sessão consultiva, RN-097), e a outra
    metade não era redundância: é ele que traz o Criativo, e é daí em diante
    que a chave do owner é gasta (RN-058). O que estava errado era o LUGAR — o
    convite gastava um parágrafo apontando para a topbar. Agora a ação mora
    DENTRO do convite enquanto ele está na tela, e volta à topbar quando não
    está; `conviteVisivel` é a única pergunta que os dois compartilham, para
    que não apareça em dobro nem desapareça.

### FASE 25 — CONCLUÍDA COM CORTE: Container por projeto (a fronteira deixa de ser só política)
A maior mudança arquitetural do programa, e a que paga a dívida que as Fases B
e F já apontavam separadamente. Entregue 25a (a decisão do Arquiteto e o
portão) e 25c (a fronteira de efeito externo); 25b (o ciclo de vida do
container) ficou CORTADA e declarada — não meio-implementada (ADR 0065, RN-105
e RN-106).
30. CONCLUÍDO: o ARQUITETO decide qual imagem sobe para o projeto, como
    artefato dele (`artifact.project_image` no event log, versionado, sem
    tabela) — auditável, não configuração escondida. Enquanto ele não
    decidir, a aba Code responde 409 e não libera (RN-105).
31. NÃO ENTREGUE, declarado: ciclo de vida por projeto (provisionar, reciclar,
    limpar, teto de recursos aplicado de verdade), com o worktree do agente
    vivendo dentro do container. Estado de container é MUTÁVEL e pede tabela
    própria — improvisá-lo no event log só para não esperar o slot de
    migration produziria a correção logo depois. Consequência honesta: a
    metade "dentro o agente é livre" da política de terminal AINDA NÃO mudou
    — o ADR 0055 continua valendo como está até o container subir de
    verdade.
32. CONCLUÍDO: a fronteira de efeito externo. `git push`, PR e deploy não
    saem pelo terminal — nem dentro do escopo do projeto —, e a regra é
    `deny` (não `require_approval`, por causa do "sempre permitir"), com a
    mensagem redirecionando para a ação TIPADA (`git_push`/`git_merge`/
    `pr_open`), que nasce `proposed_action` (RN-106). Merge em protegida
    segue manual (RN-014), intocado. Rede e gasto têm veredito próprio no
    ARTEFATO da imagem (`network: none`/`egress`, teto de cpus/memória/pids
    que recusa em vez de rebaixar em silêncio) — decidido UMA vez, não
    comando a comando, pelo mesmo motivo que Z e AD provaram que allowlist de
    verbo não converge. O fechamento de Z e AD em si depende de 25b (a
    parede física), que ainda não subiu.

### FASE 26 — CONCLUÍDA: Code, só leitura
33. CONCLUÍDO (26a): `GitProviderContract` ganhou `listTree` e diff de PR
    (11ª/12ª operação), capability declarada SÓ quando provada pela suite.
34. CONCLUÍDO (26b): as quatro rotas de `code.controller.ts` — árvore,
    arquivo, busca e diff — atrás da checagem CENTRALIZADA da RN-092/095, com
    teto e cache na busca (que é COMPOSTA, não operação do contrato).
35. CONCLUÍDO: a tela (`ProjectCodeTab`/`code/*`), registrada em
    `project-tabs.ts` sem tocar `router.tsx`/`ProjectPage.tsx`. Rail
    (Explorador/Buscar — os únicos com dado real), explorador carregado por
    DIRETÓRIO, abas de editor com breadcrumb, busca real com
    `filesScanned`/`truncated`, diff de PR por id conhecido (com
    `patch: null` tratado como "sem texto", nunca "sem mudança"). Realce de
    sintaxe é tokenizer PRÓPRIO por regex (`code/highlight.ts`) — ZERO
    dependência nova, contra os 15-90 KB de Prism/highlight.js/Shiki para o
    que a aba precisa; três tokens novos de cor (`--syntax-function/
    -comment/-operator`) calibrados a 4,5:1 contra `--code-bg` nos DOIS
    temas. O quarto estado da RN-088 — bloqueada por decisão pendente do
    Arquiteto (RN-105) — virou RN-107, perguntado ANTES de tentar ler
    código, com reconsulta própria a cada 15s enquanto bloqueada.

    Pendências DECLARADAS, sem dado real por trás: terminal interativo
    (FASE 25b, que segue cortada — estado vazio honesto na aba), blame,
    lista de PRs dentro da aba (o diff só é alcançável por id
    conhecido, vindo de Aprovações) e painel de Problemas/lint/testes.
    Virtualização de linha também ficou de fora — o próprio handoff chama a
    aba de código "a mais custosa do programa"; o teto de 512 KB por arquivo
    (`GIT_BLOB_MAX_BYTES`) limita o pior caso por ora.

### FASE 26b — CONCLUÍDA: fundação de blame, PRs navegáveis e branch rica
A fase começou como SÓ a camada de API, e a frase "nenhuma UI" que ficou aqui
descrevia o estado da PRIMEIRA leva — envelheceu e passou a ensinar errado. As
TRÊS UIs existem: o dropdown rico de branches (item 38, `CodeBranchPicker.tsx`),
o toggle de blame sob demanda (`CodeEditor.tsx`, RN-113) e a lista de PRs dentro
da aba (`CodeDiffPanel.tsx`), as duas últimas entregues na v3.0.0. As três
pendências declaradas de blame,
dropdown rico de branches e lista de PRs tocariam os MESMOS arquivos
(contrato, os três providers, o caso de uso, o controller, a suite de
contrato) se atacadas separadamente por agentes em paralelo; a decisão foi
entregar as três juntas, de uma vez, e deixar a UI de cada uma para três
agentes seguintes sem risco de colisão.
36. `GitProviderContract` ganhou `blame`, `listPullRequests` e
    `listBranchesDetailed` (13ª, 14ª e 15ª operação — RN-110/111/112),
    capability declarada só quando provada pela suite de contrato contra os
    três providers (`local` contra git de verdade; `github`/`gitlab`
    mockados — os smokes reais seguem pulados sem
    `GITHUB_TEST_TOKEN`/`GITLAB_TEST_TOKEN` no ambiente, mesma situação da
    FASE 13a). `listBranchesDetailed` é operação PRÓPRIA, não extensão de
    `listBranches` (RN-112) — enriquecer custa uma chamada extra ao provider
    POR BRANCH, e `listBranches` continua sendo a do bootstrap de Gitflow,
    que não paga esse custo.
37. Três rotas novas em `code.controller.ts` (`GET .../code/blame`,
    `GET .../code/pull-requests`, `GET .../code/branches`), mesmo `role:
    viewer` e a mesma checagem central de caminho (RN-095) das quatro
    anteriores. `apps/web/src/lib/api-client.ts`/`api-types.ts` ganharam as
    funções e tipos correspondentes (`getCodeBlame`, `getCodePullRequests`,
    `getCodeBranches`) para a onda seguinte consumir — `CodeShell.tsx` e
    `CodeDiffPanel.tsx` NÃO foram tocados além do comentário que documenta
    que a fundação já existe.
38. CONCLUÍDO: o dropdown rico de branches (RN-112) — `CodeBranchPicker.tsx`,
    aberto a partir de `CodeShell.tsx`, troca o campo de texto simples por um
    seletor listando cada branch com `ahead`/`behind` relativos à default e a
    PR associada, quando houver (`aberta`/`mesclada`/`fechada`). Ref fora da
    lista (tag ou sha) continua alcançável — `listBranchesDetailed` não
    enumera essas duas, então o rodapé do dropdown tem um campo manual.

**Congelamento do programa:** cada fase declara o que não faz, e o mais duro é
o da 26 — SÓ LEITURA de código, nenhum salvamento pela aba. A edição é fase
seguinte, e quando vier, escrita é efeito externo: nasce `proposed_action`.

## PÓS-PROGRAMA 16–26 — o que o uso pediu depois (RN-148)
Mesmo espírito da PÓS-FASE 15: não é fase planejada, é o que o USO pediu.
Histórias com promoção pendente ao mesmo tempo (RN-048/RN-126) viravam N
cards avulsos na timeline da sessão do PO quando ele produzia várias numa
leva. `Carousel` (`apps/web/src/components/ui/Carousel.tsx`) é o primeiro
componente de navegação item-por-item do design system — 2+ pendentes
viram UM carrossel navegável (setas, dots, teclado), com "Aprovar todas"
promovendo o lote inteiro numa chamada só (`promoteStories` já era lote,
sem mudança de contrato); 1 pendente continua o card simples de sempre. A
decisão de quando uma "leva" se forma é reavaliada a cada render — o
conjunto das promoções AINDA PENDENTES na sessão, não "criadas em sequência
sem interrupção" — para que resolver uma história no meio do carrossel
recalcule a leva sozinho, sem estado próprio a sincronizar.

**Projeto Local ou Container (RN-169/RN-170, ADR 0072).** Pedido do dono do
produto: "cruzar a fronteira de apenas escrever código no container e poder
escrever código a partir de uma pasta do usuário", com a variante de **caminho
livre digitado** escolhida por ele, ciente de que só funciona montado no
container. `projects` ganha (`workspace_mode`, `workspace_path`) na migração
`0043`, com `container` de default — nada muda para quem não escolhe. O ADR
0072 REVISA parte do 0065 e mexe no terreno do 0055, que decidiram a direção
contrária (a parede de container), e por isso a consequência está escrita sem
atenuar: a contenção ESTRUTURAL do `join(env, coluna)` — nenhuma coluna
corrompida saindo da raiz gerenciada — deixa de existir para projeto Local, e
o que sobra é a guarda da criação mais a revalidação léxica na leitura. A
FASE 25b continua cortada: projeto Local roda no MESMO container de hoje, só
a pasta mudou.

**Diagrama C4 do Arquiteto (RN-149, ADR 0068).** Entregável novo:
`create_c4_diagram` gera Context + Container (Simon Brown) em Mermaid,
renderizado na Visão Geral. O Container level é DERIVADO do `module_map`
vigente pelo caso de uso — nunca redigitado pelo modelo — para não abrir
uma segunda fonte que diverge da primeira; só o Context (nome do sistema e
atores externos) vem do tool call. `artifact.c4_diagram` é artefato sem
tabela, versionado no event log, mesmo desenho do `artifact.project_image`
(ADR 0065). `mermaid` entrou como dependência de RUNTIME nova do
`apps/web` — a primeira do tipo (o site de docs já usa Mermaid, mas em
build-time) — isolada atrás de `apps/web/src/lib/mermaid-render.ts` com
`import()` dinâmico; `vite build` confirmou que só o entrypoint carrega
eager e os chunks pesados do Mermaid ficam sob demanda, e nenhum deles usa
`eval`/`new Function` — o CSP fechado do ADR 0058 seguiu intacto, sem
mudança de configuração.

## RODADA exp003 — CONCLUÍDA (RN-150..162, PRs #278–#293)
Não é fase: são 17 pontos que o USO encontrou numa sessão de teste ao vivo
sobre o projeto `exp003`, corrigidos em cinco ondas sequenciadas por
ARQUIVO DISPUTADO — quatro delas convergindo em `SessionPage.tsx`, o que
obrigou a serializar. Vale a origem: nenhum destes foi achado por teste.

**O que a rodada ensinou, e vale mais que a lista**: a maior correção
(RN-155) era invisível a qualquer suite porque o defeito estava em comparar
dois espaços numéricos DIFERENTES que casualmente são ambos `number` — o
`event.seq` (gapless, por SESSÃO) contra o `action.seq`
(`proposed_actions.seq`, `bigserial` global de TODA a tabela, compartilhado
por todo projeto e toda sessão do sistema, e documentado no schema como
contraste deliberado). A ordem só parecia certa enquanto a tabela era
pequena. A correção não inventou campo: usou o evento
`proposed_action.created` que o `ProposeActionUseCase` já grava na MESMA
transação, com `payload.actionId` apontando de volta.

**Engine e leitura contida (RN-150)** — `search_workspace` devolvia TODOS
os hits, sem teto: a segunda causa real do `413` em revisão de PR, depois
da correção de `read_file`. Dois tetos INDEPENDENTES, porque a busca
estoura de duas formas — quantidade de hits (`SEARCH_WORKSPACE_MAX_HITS`,
500, sobre um `Stream` que PARA de escanear em `max_hits + 1`) e bytes do
texto final (`SEARCH_WORKSPACE_MAX_BYTES`, 32.768). Variáveis próprias, não
reaproveitadas das outras duas: mesma classe de estouro, divergir uma não
deve exigir tocar as outras. A marca de truncagem é dirigida ao MODELO
(manda refinar o termo) e nunca inventa um total, porque contar o total
pagaria de novo o I/O que o teto existe para evitar.

**Números que mentem (RN-151)** — o badge do projeto na sidebar contava
QUALQUER evento não lido: `exp003` mostrava 392 enquanto a aba Aprovações
do mesmo projeto mostrava 8. Um número que não corresponde a nada acionável
ao clicar é pior que nenhum. Virou `pendingApprovalsCount` no read model
que já existia (RN-090), numa agregação a mais no `Promise.all` — nunca
N+1.

**Rastreabilidade do que o agente produziu (RN-152)** — a branch
`feature/task-XXXXXXXX` no dropdown da aba Code passa a dizer de qual dev
agent e módulo ela é. O módulo sai do `module_map` vigente pelas MESMAS
funções que o geraram, nunca por regex reversa sobre o nome; sem vínculo,
degrada para `null` em vez de adivinhar.

**Auto mode (RN-153/154, ver Convenções)** — a curinga `actionType: "*"`.
O que importa é onde ela mora: a resolução é do REPOSITÓRIO (`findMode`),
e `decide.ts` não ganhou uma linha — é isso que torna os três tetos
absolutos verdadeiros por CONSTRUÇÃO, e não por mais um `if` que um dia
alguém esquece.

**O fio da sessão que se lê (RN-155..159)** — ordenação (acima); o
indicador de 5s com texto fixo "Reunindo informações..." em vez de
interpolar o agente, que já aparece no cabeçalho (RN-156); criação de
épico/história do PO virando aviso compacto em vez de bolha com o mesmo
peso visual de uma resposta de verdade (RN-157); Markdown leve com highlight
no chat por parser PRÓPRIO de regex, zero dependência nova e nenhum
`dangerouslySetInnerHTML`, e só a SAÍDA do agente é renderizada — o que o
humano digita fica literal (RN-158); e "Artefatos gerados" agrupado por
agente com o `Disclosure` da RN-138, cada artefato navegando para onde ele
vive (RN-159). O module_map/C4 ficou FORA por decisão registrada: é estado
VIGENTE do projeto, não artefato datado por sessão.

**Ordem de autoridade (RN-160/161, ADR 0069)** — "Confirmar arquitetura
pronta" só habilita com ao menos 1 história PROMOVIDA (não basta ter regra
capturada); e aceitar o handoff pro Dev Lead encadeia a ativação de
execução quando o papel efetivo de quem aceita já autoriza. A fusão é só no
cliente: o backend continua exigindo `maintainer` (RN-137), então ela evita
um clique redundante sem mover a fronteira de autorização.

**Entrada estruturada (RN-162)** — `ask_structured_questions`, do Criativo:
o modelo declara as perguntas em schema, o formulário é renderizado por
`StructuredQuestionCard`, e a resposta REUSA `SendAgentMessageUseCase` em
vez de abrir um segundo caminho de mensagem. Responder é ato único —
reenvio é 409, não sobrescrita.

## RODADA exp001 — o Criativo cumpre a promessa (RN-163)
Mesmo espírito das outras rodadas: veio do USO, não de roteiro. O relato foi
"o Criativo não respondeu depois de dizer que iria corrigir e tentar de novo",
e a frase era literal no código — `run_turn_capturing/1` chamava o modelo UMA
vez, despachava as ferramentas e voltava. O resultado da ferramenta entrava no
histórico em memória e ninguém mais o lia, então a correção prometida só
acontecia se o usuário mandasse outra mensagem.

O Criativo era o único conversacional sem laço de tool use; ganhou o mesmo do
PO, com teto próprio de 12. O que vale além da correção: **quem decide o que se
anuncia passou a ser o teto**, e não um texto fixo — a promessa de retentativa
só entra na frase quando ainda há volta para cumpri-la. Teto esgotado virou
`agent.error` narrado (o `po_server` terminava calado nesse caso, e essa era a
próxima dívida óbvia — fechada logo abaixo pela RN-166), e a falha de
ferramenta deixou de ser `agent.response`
— no event log ela era indistinguível de uma resposta normal e não dizia
origem nenhuma, exatamente o que a RN-059 fechou para a falha de turno.

## RODADA exp001 — o PO lê o que já existe e é cobrado (RN-164..166)
Não é fase: é um defeito achado por USO real, e a origem importa porque
nenhuma suite pegaria. O backlog saiu com épico e **nenhuma história** — logo
sem tarefa, logo a execução travada **sem erro nenhum**. A investigação achou
quatro causas empilhadas, e as três primeiras são a mesma: o PO não tinha como
saber e não tinha como avisar.

1. **O PO tinha quatro ferramentas e todas de ESCRITA.** O contexto era
   montado UMA vez, no kickoff, a partir dos 200 últimos eventos da SESSÃO —
   dali em diante ele nunca mais relia nada: não sabia quais regras existiam,
   quais já cobrira, nem o que ele próprio já criara. Entraram
   `listar_regras_de_negocio` e `listar_backlog` (RN-164), servidas por duas
   rotas internas escopadas ao PROJETO — e o escopo é o ponto: leitura por
   sessão era exatamente o que escondia a regra capturada antes. Reusam o
   encanamento que já existia (`listByTypeForProject`, `ListBacklogUseCase`,
   `computeCoverage`); o que faltava era a rota, o método no cliente e o tool.
2. **Nada cobrava a história depois do épico** e **o laço terminava calado**.
   Épico sem história virou desfecho EXPLÍCITO — `backlog.epic_without_story`,
   durável, no padrão da RN-059 (RN-165) — e o teto de iterações do `PoServer`
   passou a emitir `toolloop.limit_reached`, o MESMO tipo do `ToolLoop`, que
   os agentes conversacionais nunca emitiram por terem laço próprio (RN-166).
3. **A instrução de kickoff não dizia uma palavra sobre o que fazer quando
   falta informação** — e diante de uma lacuna sem instrução um modelo escolhe
   entre inventar e parar. Parar foi o que ele fez. A terceira saída passou a
   estar escrita, com a ferramenta para exercê-la: `ask_structured_questions`,
   a MESMA do Criativo (RN-162), agora advertida também ao PO.

Duas decisões de desenho que valem além deste caso: só o `create_story` que
**deu certo** quita a obrigação do épico (uma história recusada pela api não
cobriu nada, e tratá-la como se tivesse é trocar um silêncio por outro); e a
cobrança é por OCORRÊNCIA, reportada uma vez, nunca alarme que repete a cada
turno até alguém aprender a ignorá-lo.

## RODADA exp001 — o fio se lê como o turno acontece (RN-172/173)
Mesma origem das outras: USO, não roteiro. Quatro queixas sobre a tela da
Sessão — o handoff do PO aparecendo ACIMA da última fala dele, a aprovação
subindo para o meio da resposta do Arquiteto e só descendo quando ele
terminava, o card de aprovação "mal diagramado" e o scroll que não seguia a
conversa.

**A investigação achou que a ordenação estava CERTA**, e é essa a lição da
rodada. A RN-155 é fiel ao event log; o que o log diz é que
`po_server.ex#run_turn/2` emite, na MESMA iteração, o `agent.response`, DEPOIS
o `tool.call` de `offer_handoff` e SÓ ENTÃO recursa para a fala de fechamento
— logo o `seq` do handoff é honestamente MENOR que o da última fala. O mesmo
para `proposed_action.created`. A correção, portanto, não é de ordenação: é
uma regra de APRESENTAÇÃO declarada (RN-172), numa passada separada
(`afundarDesfechos`) DEPOIS do `sort` por `seq` — não um comparador com três
termos que ninguém saberia justificar um ano depois.

O que impede turnos de se misturarem são três barreiras, e cada uma existe
por um caso real: **turno** (a fronteira entre dois turnos pode não ter
entrada VISÍVEL — `agent.activated` abre turno e não vira item do fio),
**autor** (em sessão de execução vários agentes escrevem sem o usuário falar
nenhuma vez, e todos ficam no mesmo turno) e **não-desfecho** (dois desfechos
seguidos preservam a ordem entre si — Infra antes do Dev Lead).

A RN-173 fecha as outras duas queixas, e elas eram a mesma: o efeito de
scroll dependia só de `[events.length, streamingText]`, e `actions` é uma
query SEPARADA — um card chegando empurrava a conversa para fora da tela sem
rolar nada. Dependência corrigida, mais um `ResizeObserver` sobre o conteúdo
para o que NENHUMA lista de dependências alcança (colapso de `Disclosure`,
Markdown reflowando). A guarda dos 120px do fim continua intacta, de
propósito: o fio segue a conversa, não sequestra a leitura de quem subiu.

## RODADA exp001 — o fio diz quem fala, com qual modelo e o que pergunta (RN-171/174/175/176)
Mesma origem: USO. Quatro queixas sobre a tela da Sessão, e três delas
compartilham a mesma lição — **o produto sabia a informação e não a
mostrava**.

**A pergunta ao centro, e com saída (RN-171).** O relato foi literal: "sempre
dê a opção de input do usuário quando ele seleciona Escreva". O modelo
oferecia uma opção do tipo "Escreva você mesmo" e o formulário não tinha onde
escrever — o schema de `ask_structured_questions` não sabia expressar "além
destas, o que você quiser". `allowOther` entrou em `select` com **default
`true`**, e a assimetria é o argumento: lista fechada por ESQUECIMENTO trava a
conversa e o usuário não destrava de fora; lista aberta por engano oferece um
campo a mais. O sentinela de interface nunca viaja pro backend, e o botão de
envio continua exigindo tudo preenchido (o backend recusa com 400 de qualquer
forma). A caixa também virou centralizada com o teto de 560px do
`ApprovalCard` e ganhou avatar: era o único item do fio alinhado a nada.

**Ação que dispara turno arma o indicador (RN-174).** A animação de "pensando"
já existia — o que faltava era COBERTURA. Duas ações da tela disparam turno
síncrono no engine e não ligavam nada: responder o formulário
(`AnswerStructuredQuestionUseCase` reusa `SendAgentMessageUseCase`) e devolver
história ao PO (`ReturnStoryUseCase` chama `reviseStory`, que é
`handle_call({:revise, …})`). O canal Phoenix não cobre o buraco: com o join
ainda em curso (RN-108) o `agent.status` "working" não tem ouvinte e se perde.

**O modelo, para TODOS (RN-175).** A premissa de que o defeito era do PO não se
sustentou: os quatro conversacionais gravam `modelName` desde a RN-146, com
teste verde. Quem nunca gravou foi o **`ToolLoop`** — o caminho de todo agente
de execução e de gate — e o chat sem agente ativo na api. Nenhuma chamada
nova: `RunLlmTurnUseCase` já devolvia o campo no corpo. A tela deixou de
escrever a palavra solta "modelo" (que se lê como se o modelo se chamasse
assim) e virou chip legível; sem o dado, ela DIZ que não foi registrado —
adivinhar pelo binding atual atribuiria a uma resposta antiga um modelo que
talvez nem existisse, o mesmo erro que o preço congelado da RN-044 evita.

**Tabela em Markdown vira tabela (RN-176).** Duas saídas eram possíveis, e a
escolhida foi suportar tabela no Markdown do chat, com o `Table` do design
system. Renderizar `artifact.module_map` no fio foi RECUSADO por uma decisão
já registrada: ele é estado VIGENTE do projeto, não artefato datado por
sessão (RN-159), e vive na Visão Geral. Além disso, o pedido foi sobre a
tabela **dentro da mensagem** — e a correção serve a qualquer agente que
escreva uma, não só ao Mapa de Módulos. A linha separadora continua
obrigatória (GFM), então prosa com `|` nunca vira tabela por engano.

## RODADA exp001 — o painel agrupa, ordena e diz o que não mostra (RN-177..181)
Mesma origem das outras: USO, não roteiro. Cinco queixas sobre o painel de
contexto e o log da Sessão, e a lição da rodada é uma só — **o painel mostrava
um recorte como se fosse o todo, em três dimensões diferentes ao mesmo tempo**:
escondia seis tipos de evento sem oferecer alternativa, lia do mais antigo para
o mais novo, e cortava a sessão em 200 eventos sem dizer.

**Origem como classificação nova (RN-177).** `ActivityKind` responde "de que
ASSUNTO o evento fala" e decide ícone e cor; `origem` responde "de que CAMADA
ele veio", e é ela que torna o histórico legível — `eventos`, `sistema`, `llm`,
`harness`, `agente`, `usuario`, derivadas do dado que EXISTE (`actor.kind` e o
prefixo do `type`). A precedência é o que a torna previsível e está na ordem
dos `if`: mecanismo vence ator (um `tool.call` é do harness seja quem for), e
ator vence prefixo de agente (`chat.message` existe dos dois lados). As 5 mais
recentes ficam abertas e o resto se recolhe por origem, **nos dois lugares** —
no painel de log e no fio, onde o eixo é invertido (o fio é crescente, então o
histórico fica no TOPO). O filtro de ruído de máquina **continua ligado por
padrão**: a razão dele não mudou (116 de 193 eventos reais), o que mudou é ele
ter virado ESCOLHA em vez de fato consumado.

**Ordem e paginação (RN-178).** As quatro seções passaram a decrescentes, e o
botão "Carregar mais antigos" mudou de lado por consequência — o argumento de
antes, com o sinal trocado. Regras de negócio acima de 5 paginam, com a página
resolvida por *clamp* e não por efeito de sincronização.

**A árvore do PO (RN-179).** `backlog.task_created` nunca entrou no painel;
agora épico → história → tarefa formam árvore, pelo VÍNCULO que o evento já
carrega (`epicId`/`storyId`), nunca por vizinhança no log — nó sem pai
carregado sobe para a raiz em vez de ser pendurado por adivinhação.

**O teto que passou a aparecer (RN-180), e é o item que mais valia.** O painel
lia 200 eventos por prop e não tinha como dizer que havia mais. Passou a ler o
histórico paginado da RN-099 (mesma `queryKey` da cauda, ZERO requisição a mais
— RN-090/091), ganhou o pager que o `ActivityFeed` sempre teve e nenhum call
site passava, e a nota conta quantos faltam por SUBTRAÇÃO sobre o `seq`, como o
sino da RN-100. As seções derivadas leem `baixados` (tudo que já veio) e não a
janela do feed, senão passariam a mostrar MENOS do que mostravam antes.

**Delegação no fio (RN-181).** `delegation.completed|failed|dispensed` só
existiam no painel de log: o gate abria e fechava sem sinal nenhum de que houve
uma segunda tentativa por baixo. Viraram aviso compacto no formato da RN-157,
com a frase saindo de `classifyEvent` — a mesma do painel. O contrato externo
da área não muda (ADR 0038): o fio narra o que o lead registrou, não passa a
endereçar subagente.

## PROGRAMA 28 — Onda 1, frente A: o tema deixa de ser inalcançável (RN-182..185)
O tema claro existia em `design/tokens.css`, tinha teste de paridade e estava
descrito no `design/README.md` como se fosse uma tela — e **nada em `apps/web`
escrevia `data-theme`**. O único jeito de vê-lo era digitar o atributo no
DevTools. Os dois testes de contraste sabiam e diziam: um afirmava por `expect`
que TRÊS pares do claro reprovam, "registro do que se herda, não garantia do que
se renderiza". Enquanto durou, o argumento era honesto — medir uma tela que
ninguém pode abrir é medir uma intenção. Com o botão de tema chegando, ele
inverte de sinal.

**O boot é um ARQUIVO** (`apps/web/public/theme-boot.js`), síncrono no `<head>`,
antes do bundle. O handoff manda usar script INLINE; a imagem serve sob
`script-src 'self'` (ADR 0058), então inline funcionaria em `pnpm dev:web` e
seria bloqueado em produção — a falha do ADR 0036 com outro sujeito. `tema.ts`
é a API que o shell consome; o botão não mora nela. `localStorage` que lança
degrada para "pinta e não persiste", e valor desconhecido cai no default.

**Seis tokens do tema claro mudaram de valor** (ADR 0074), porque o fundo mais
exigente do claro é o `--code-bg` de papel: accent 3,56 → 4,81, warning
3,15 → 4,98, success 3,89 → 5,12, violet 4,16 → 4,95, text-muted 2,76 → 5,17,
mais o accent-hover um degrau abaixo. O ESCURO não mudou nenhum, e a dívida dele
segue travada nos mesmos cinco números. Dois efeitos colaterais registrados: os
cinco pares que no escuro são dívida PASSAM no claro, e a "exceção conhecida do
design system" (`--on-accent` sobre `--accent`, 3,20:1) some no claro — o
conserto que o comentário do teste descrevia, escurecer até `--terracota-500`, é
o que o claro passou a fazer.

**Cinco dos oito valores `--syn-*` do handoff foram RECUSADOS por medição** (o
pior, `--syn-cm`, dá 2,32:1 no claro). Onde o handoff reprova, vale o número
medido: é a mesma régua das fontes. Os oito papéis passam a existir com prefixo
`--syntax-*`; os cinco semânticos que ainda pintam vão medidos ao lado deles.

## FERRAMENTA DE DESENVOLVIMENTO — `pnpm bootstrap`
Menu de terminal em `scripts/dev/bootstrap.sh` agrupando o que se faz no
dia a dia: Docker, K8s, Database e Test. Existe porque esses comandos moram
em TRÊS lugares que não conversam — `package.json`, `Makefile` e scripts em
`deploy/k8s/`/`docker/` — e conhecimento decorado apodrece.

Ele **não reimplementa nada**: cada folha chama o comando que já existe. O
modo `--print-commands` resolve a árvore inteira sem TTY e sem executar, e é
sobre ele que roda o teste (`scripts/dev/bootstrap.spec.ts`) — um TUI não se
testa por unidade, mas o mapeamento menu→comando sim, e é ele que erra.
Zero dependência nova; as cores saem de `design/tokens.css` em ANSI 24-bit
com degradação para 256 cores e para nenhuma.

A saída de um comando em execução é ROLÁVEL (roda do mouse em SGR, `j`/`k`,
PageUp/PageDown, `G` para voltar ao fim). O que faltava não era ler a roda: era
DESLOCAMENTO — `tail -n` só sabe mostrar o fim —, então a janela virou recorte
com `sed -n 'a,bp'`, testável sem TTY por `--print-window`. Duas consequências
que o rodapé anuncia: rolar para trás CONGELA a janela (como o `less +F`, senão
o redesenho de 5 Hz desfaz a rolagem) e o rastreio de mouse, ligado só na tela de
execução, é desligado em TODA saída — `\e[?1006l\e[?1000l` em
`restaurar_terminal`, que o trap de EXIT cobre. O parser de escape é CSI
genérico (lê até o byte final): ler dois bytes fixos deixava o resto da sequência
no buffer, e como o menu trata `[1-9]` como escolha, um giro de roda disparava
itens do menu.

Três decisões registradas: `Create` provisiona do zero e `Deploy` publica
num ambiente que já existe (por isso só `Deploy` tem escolha por serviço);
no K8s só `All` funciona, e Api/Engine/Web aparecem DESABILITADOS em vez de
sumirem, porque o menu deve dizer o que o produto não faz; e
`Database › Delete` recria a extensão pgvector, já que
`docker/postgres/init.sql` só roda na primeira inicialização do volume —
um `DROP SCHEMA` puro faria a migração seguinte falhar, e como o engine
divide o mesmo banco, recuperar exige `db:migrate` E `engine:migrate`.

## Stack (decidida — não proponha alternativas)
- `apps/api`: NestJS 11 + Drizzle ORM + PostgreSQL 16 + pgvector
- `apps/engine`: Elixir/OTP + Phoenix (canais) + Oban (filas no Postgres)
- `apps/web`: React 19 + Vite + TanStack Query/Router; `mermaid` (runtime,
  ADR 0068) para o diagrama C4 do Arquiteto, isolado atrás de
  `lib/mermaid-render.ts` com `import()` dinâmico
- Monorepo pnpm (TS) com apps/engine Elixir ao lado; Docker Compose para dev
- Auth: first-party no domínio da api (argon2id + access JWT curto +
  refresh opaco com rotação); autorização RBAC no domínio da api
  (inalterada desde a Fase 1)
- LLM: roteador na api com suite de contrato; base OpenAI-compatível
  sobre node:http (timeout de inatividade, erro por `code`,
  capabilities em duas camadas — ADR 0041); catálogo com curadoria e
  preço congelado no metering (ADR 0042); 9 providers (ADR 0043)
- Deploy: Kubernetes (k3d/kind em validação local)
- Docs: Docusaurus 3.x em website/ lendo de docs/; Mermaid; busca local
- CI/CD de release: GitHub Actions com lógica em scripts testáveis
  (scripts/ci/, vitest)

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
- Toda mudança entra por PR — push direto em permanente é bloqueado;
  únicas exceções de push: tags (bot de release) e .release/gate.json
  (bot do gate).
- Comunicação api ↔ engine: eventos via Postgres (transactional outbox
  na api, Oban no engine) + HTTP interno com service token para
  comandos síncronos.
- Todo evento de domínio é imutável: nunca UPDATE em tabelas de eventos.
- Estados de sessão são máquina de estados explícita:
  created → active → closing → closed | closed_abnormally
- A sessão tem DUAS classificações, e elas não se sobrescrevem: `kind`
  (`consultiva|criativa`) é a INTENÇÃO de criação, gravada e imutável; o
  evento `execution.activated` é o ESTADO de execução, e continua sendo
  ele que `findActiveExecutionSession` procura. `execution.activated` em
  sessão consultiva é 409, nunca conversão silenciosa (ADR 0061, RN-097).
  Não faça a derivação por evento olhar `kind`
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
  `decide()`. Três tetos continuam absolutos MESMO com auto mode ligado, e
  não têm exceção configurável em lugar nenhum — merge em branch
  protegida, `instruction_patch` e `parallelize`/`raise_max_parallel`
  (RN-154).
- O projeto escolhe ONDE o código mora, na criação (RN-169, ADR 0072):
  `container` (DEFAULT — a pasta gerenciada em `PROJECT_WORKSPACES_ROOT`, o
  comportamento de sempre) ou `local` (uma pasta do USUÁRIO, caminho absoluto
  livre em `projects.workspace_path`). O par (modo, caminho) é amarrado por
  CHECK no banco, e `projectScopeRoot` continua sendo a derivação ÚNICA da
  raiz — não duplique validação nos chamadores. Caminho Local é validado na
  CRIAÇÃO e RECUSADO com mensagem que ensina a montar (RN-170): absoluto, sem
  `..`, existente, gravável de dentro do container, nunca raiz/pasta de
  sistema nem sobreposto ao checkout do Brabo. O portão da imagem (RN-105) NÃO
  vale para projeto `local`, que não sobe container. Consequência declarada no
  ADR: a contenção estrutural do `join` some para esses projetos, e o vetor de
  symlink do ADR 0055 continua aberto.
- A imagem de container de um projeto é ARTEFATO do ARQUITETO
  (`artifact.project_image`, versionado, sem tabela), nunca configuração
  escondida. Enquanto ele não decide, a aba Code responde 409 (RN-105) —
  exceto em projeto no modo `local` (RN-169).
  `git push`, abertura de PR e deploy NÃO saem pelo terminal — a regra é
  `deny`, não `require_approval`, mesmo dentro do escopo do projeto e mesmo
  com "sempre permitir" (RN-106, ADR 0065). O ciclo de vida do container
  (provisionar, reciclar, limpar) ainda não existe — corte declarado da
  FASE 25 —, então a política de terminal do ADR 0055 (escopo de caminho,
  allowlist estreito) segue valendo como está até o container subir de
  verdade.
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
- Os quatro agentes conversacionais rodam laço bounded de tool use, com
  teto PRÓPRIO no servidor de cada um (Criativo e PO 12, Arquiteto e Dev
  Lead 14) — não o teto do `ToolLoop` (`Engine.Harness.Iteracoes`), que é
  dos agentes de execução e de gate. Erro de ferramenta é ENTRADA do laço,
  não fim de linha; teto esgotado é narrado, nunca silêncio; e o agente não
  anuncia ação que o código não vá executar — o que se promete é decidido
  pelo teto, nunca por texto fixo (RN-163).
- A chave de LLM que um agente gasta é a do OWNER do workspace
  (RN-058); o relatório desse gasto é do owner e só dele (RN-060). O
  membro vê o PRÓPRIO consumo por ATOR, em tokens e custo estimado, e
  NUNCA quebrado por provider ou credencial — as duas leituras respondem
  perguntas diferentes e nenhuma é recorte da outra (RN-101/ADR 0063).
- Métrica de execução de agentes é extraída do event log/token_usage
  por script, nunca anotada manualmente (lição da Fase 10/13).
- Tela que mostra um RECORTE diz que é recorte (RN-180). Toda leitura tem
  teto — `limit: 200` nos eventos e nas ações —, e teto silencioso faz a
  tela afirmar sobre o que não leu. O número que falta sai de SUBTRAÇÃO
  sobre o `seq` (gapless, por sessão), nunca de uma requisição a mais:
  é o mesmo mecanismo do sino (RN-100). Quando houver como carregar o
  resto, o controle mora onde o corte aparece.
- Evento tem DUAS classificações no cliente, e elas não se substituem:
  `ActivityKind` (assunto — decide ícone e cor) e `OrigemDeEvento`
  (camada — `eventos|sistema|llm|harness|agente|usuario`, RN-177). A
  origem tem UMA fonte, `apps/web/src/lib/activity.ts`, consumida pelo
  painel de log E pelo fio; a precedência dos `if` é a regra (mecanismo
  vence ator, ator vence prefixo de agente) e tipo desconhecido cai em
  `eventos` — nunca some nem abre categoria nova.
- Testes: vitest (api/web/scripts de CI), ExUnit (engine). Nenhuma
  feature sem teste do caminho feliz + 1 caso de falha. Providers de
  git e de LLM validados por suas suites de contrato únicas.
- Capability só é declarada quando provada pela suite; sem prova,
  declara-se false e degrada (regra dos ADRs 0041/0042, vale para git
  e LLM).
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
- Regra de negócio nova → RN-XXX em docs/business-rules.md com
  arquivo:linha e o teste que a cobre.
- TODA mudança verifica se ESTE arquivo precisa mudar — Stack, Convenções,
  "O que NÃO fazer" e o estado das fases. Não pergunte se deve: verifique.
  O gatilho é o mesmo do docmap, e o motivo é que o CLAUDE.md é o único
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
- Não implementar MFA, login social, OIDC provider ou federação
  (backlog do ADR 0031)
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