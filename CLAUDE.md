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

**Fora do escopo, por decisão declarada** (ADR 0053 item 5): o botão
"Ativar execução" mudar de dono. A delegação Dev Lead → `dev-<modulo>`
pela tabela `delegations` com `area = "dev"`, que este mesmo item também
declarava, DEIXOU de estar fora de escopo — fechada pelo ADR 0094
(Auditoria fluxo.yml × código, Onda 2, RN-405). O botão continua
reversível; a execução continua no caminho atual, e a correção pós-gate
continua indo direto ao dev que abriu a PR.

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
31. NÃO ENTREGUE À ÉPOCA, declarado: ciclo de vida por projeto (provisionar,
    reciclar, limpar, teto de recursos aplicado de verdade), com o worktree
    do agente vivendo dentro do container. Estado de container é MUTÁVEL e
    pedia tabela própria — improvisá-lo no event log só para não esperar o
    slot de migration produziria a correção logo depois.
    PARCIALMENTE REVOGADO pela Onda 4/frente F1 do PROGRAMA 28: a TABELA de
    estado (`project_containers`, ADR 0081) chegou. O que continua faltando,
    sem atenuar, é a metade que fazia a tabela valer alguma coisa: nenhum
    orquestrador real chama Docker ainda, e o worktree do agente segue fora
    do container. A metade "dentro o agente é livre" da política de terminal
    AINDA NÃO mudou — o ADR 0055 continua valendo como está até o container
    subir de verdade.
32. CONCLUÍDO À ÉPOCA, REVISADO pelo runner local (ADR 0102/0103, RN-418):
    a fronteira de efeito externo. `git push`, PR e deploy não saem pelo
    terminal — nem dentro do escopo do projeto —, e a regra ERA `deny`
    (não `require_approval`, por causa do "sempre permitir"), com a
    mensagem redirecionando para a ação TIPADA (`git_push`/`git_merge`/
    `pr_open`), que nasce `proposed_action` (RN-106, revisada). O `deny`
    virou TETO ABSOLUTO (`require_approval` incondicional, nunca
    auto-aprovável) — decisão do dono do produto, "sempre permitir" fechado
    na fonte para não virar decorativo (ver a seção do runner local). Merge em protegida
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
    Virtualização de linha também ficou de fora à época — o próprio handoff
    chama a aba de código "a mais custosa do programa"; o teto de 512 KB por
    arquivo (`GIT_BLOB_MAX_BYTES`) limitava o pior caso até então. FECHADA
    pela Onda 4/frente E2 do PROGRAMA 28 (RN-239..242): só a janela visível
    vira nó de DOM, e o minimapa reusa a mesma tokenização sem segundo
    passe.

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

## PROGRAMA 28 — Onda 1, frente D0: gasto por provider (RN-186..188)
**A contenção mudou de natureza, e é isso que importa — não o eixo novo.**
`provider` voltou a ser dimensão de `sumGroupedBy`, revisando o ADR 0063 por
decisão do dono do produto. Antes, o membro não alcançava a quebra por
CREDENCIAL porque ela não existia — o ADR 0063 escreveu "não há argumento a
passar". Agora existe, e quem contém é o TIPO: duas sobrecargas, e o escopo que
carrega `actor` (o único da visão do membro) só aceita
`Exclude<SpendDimension, 'provider'>`. A garantia passou de "impossível de
expressar" para "impossível de compilar", que é mais fraca — e é por isso que as
barreiras são DUAS e independentes: a rota do membro também não tem parâmetro de
dimensão nenhum. Nenhum `if` sobre a combinação, de propósito (mesma lição da
RN-153/154), e a prova foi por INVERSÃO: sem o `@ts-expect-error` o `tsc` acusa
`TS2769` na linha exata.

`porOwner`/`porAgente` são partição de `porAtor` por `actor_kind`, sem consulta a
mais; `system` fica fora dos dois e continua no total. O índice em
`token_usage(created_at)` que o ADR 0063 mediu e adiou entrou na migração `0044`.
A TELA não mudou — é onda posterior.

## PROGRAMA 28 — Onda 2, frente H2: ranking de modelos sem nota inventada (RN-210, ADR 0077)
O handoff pedia duas coisas que dependiam do MESMO dado que o produto não
tem: uma nota de qualidade por capacidade (mock: "código → claude-sonnet-4 /
qwen2.5-coder:14b (9.4)") e um badge "ideal" no `ModelPicker` quando o
modelo cobre "todas as capacidades exigidas pelo agente". A investigação
confirmou duas vezes que esse segundo dado não existe: o próprio
`ModelsSection` já tinha renomeado a coluna "Agente · capacidades" para só
"Agente" por essa razão, e o `ModelPicker` de binding de agente lê
`GET /projects/:id/models` (papel `viewer`) — a curadoria (`uses`, ADR 0051)
só existe em `ModelComCuradoria`, de uma rota `maintainer`-only. O badge NÃO
foi construído; a tabela "Melhores modelos por capacidade" FOI, com dois
sinais reais: quantos agentes do projeto já resolvem, pela cascata, para
cada modelo curado, e o custo do catálogo como desempate — nunca nota
calculada.
## PROGRAMA 28 — Onda 2, frente B: sidebar recolhe (RN-195..201)
264px/62px com trilha de ícones no colapso; projetos expansíveis revelando as
abas (lidas de `project-tabs.ts`, nunca hardcoded); seção Atividades agrupada
por agente-base/instância REAL — sufixo `-2` de `extraDevAgentId`, nunca um
contador `-01/-02` inventado (achado da Onda 1/frente B0) —, escopada ao
projeto da rota atual, não a todos, para não abrir N+1 de eventos. Botão de
tema no rodapé; os dois itens globais inertes saem, só Projetos e Atividades
são globais; auto-collapse da aba Código via `AutoCollapseContext`
(`sidebar-state.ts`), sem gravar preferência. Persistência centralizada em
`sidebar-state.ts`, as seis chaves `brabo.*` do handoff.

Duas divergências do handoff documentadas e NÃO resolvidas (RN-197): o badge
do projeto continua `pendingApprovalsCount` (RN-151 vence, é mais recente) e a
cor de identidade do handoff só aparece na trilha recolhida — a linha
expandida mantém só o dot de status existente (RN-039), dois dots seria ruído.
## PROGRAMA 28 — Onda 2, frente C: moldura de tela (RN-202/203, ADR 0078)
As quatro correções literais do checklist "moldura de tela" do handoff:
`.headerTop` ganhou `min-height: var(--header-h)` — PISO, não teto, porque o
cabeçalho do projeto (identidade + `TokenMeter` compacto) é mais rico que o
cabeçalho genérico das 6 telas internas do handoff, e forçar 60px cortaria o
alerta de orçamento, a mesma classe de erro que a RN-088 proíbe; aba ativa com
`box-shadow: inset 0 -2px 0 var(--accent)` em vez de `border-bottom`; rolagem
horizontal na régua; container de conteúdo com `max-width: 1040px` nas abas em
forma de documento (não nas `semRespiro`). Os valores de espaçamento da régua
que viviam como override de CSS de descendente em `ProjectPage.module.css`
desde a FASE 16 migraram para `Tabs.module.css`, agora com o mesmo dono.

A parte que exigia decisão, não só CSS: o handoff lista 7 abas de projeto e o
registro (`project-tabs.ts`) tem 10. `executores` (RN-121), `backlog`
(RN-048) e `insights` (hipóteses do Psicólogo) nasceram DEPOIS do handoff, com
dado real e RN própria, e FICAM — o handoff é referência de fidelidade VISUAL,
não teto de quantas abas o produto tem (RN-203, ADR 0078). E a chave
`sessions` continua rotulada "Chat", nunca "Chat RAG" como o handoff mais
recente pede (RN-202): "Chat RAG" descreveria uma funcionalidade que não
existe — o contrato de embeddings está pronto (ADR 0075) mas nada ainda o
consome, sem pipeline de indexação e sem UI de citação — e renomear a aba
hoje seria o mesmo erro que o ADR 0042 já recusa para modelo de catálogo:
anunciar uma capacidade antes dela existir. Nenhuma FORMA de export mudou
(`AbaDoProjeto`, `ABAS_DO_PROJETO`); só o rótulo de `code` foi de "Code" para
"Código".

## PROGRAMA 28 — Onda 2, frente H1: foco visível (ADR 0036)
`Select`, `Modal` (botão de fechar) e `ProjectCard` ganharam `:focus-visible`
no mesmo tratamento calibrado de `Input.module.css`, incluindo o bloco de
`forced-colors`: nenhum dos três tinha indicação de foco alcançável só por
teclado. O botão de fechar do `Modal` subiu de 30px para 32px, o piso de alvo
de toque em desktop. `Table` e `Badge` foram auditados e NÃO precisaram de
mudança — nenhum dos dois expõe afordância interativa própria: linha de
`Table` é apresentação pura (quem precisa de linha clicável já usa
`<button>`/`<a>` dentro da célula, via `render`) e `Badge` não é usado com
`onClick` em lugar nenhum do produto.

## PROGRAMA 28 — Onda 3, frente H3: a aba Criativo ganha KPIs sem fingir dado que não existe (RN-227..230)
O handoff pede 4 selos de status para os 5 estados reais da sessão
(`created/active/closing/closed/closed_abnormally`). `closed_abnormally`→
abortada e `created`→aguardando são diretos; `closing` NÃO foi fundido com
"fechada" — ganha selo próprio ("encerrando", tom `accent`, pulsante),
porque em `closing` o desfecho ainda não é conhecido e chamá-la de "fechada"
mentiria sobre isso. Os filtros pill (só 4, pelo mesmo motivo) agrupam
`created` e `closing` por TRAJETÓRIA, não aparência: `created` cai em
"Ativas" (ainda em jogo), `closing` cai em "Fechadas" (a caminho de fechar
sem erro) — o selo da linha nunca é reescrito pelo filtro, só o agrupamento
muda. Dos 4 KPIs, dois são honestos por dado ausente: "custo do mês"
REAPROVEITA `getMySpend` (mesma `queryKey` da aba Gastos, visão do
membro/RN-101) e nunca mostra o total do projeto — que é dado do owner
(`porProjeto`), e a aba Criativo é vista por qualquer membro; "taxa ideação
→ commit" é DECLARADA ausente (mostra "—"), porque não existe vínculo entre
sessão e commit no produto hoje — inventar o cálculo seria a mesma classe
de erro que o ADR 0042 já recusa para nota de modelo.

## PROGRAMA 28 — Onda 4, frente G2: o Chat RAG ganha pipeline de indexação e busca híbrida (RN-231..238, ADR 0080)
Sobre a tabela `chunks` da Onda 3 (ADR 0079): indexação MANUAL (sem
watcher, `POST .../rag/reindex`, full rebuild idempotente — apaga o
escopo/sessão antes de recriar) dos três escopos honestos — `docs`/`adr`
via `ReadProjectCodeUseCase` (mesma credencial/portão/checagem de caminho
da aba Code) e `session` só de `chat.message`/`agent.response`. Chunking
por heading/parágrafo, 1200 caracteres com 150 de sobreposição —
documentado como ponto de partida, não calibração contra dado real (não
existe, ainda, corpo de perguntas rodado contra o índice). Busca híbrida
é DUAS consultas independentes (vetor via HNSW, léxico via GIN),
fundidas por soma ponderada (0.6/0.4) e cortadas num limiar (0.2) —
números também ponto de partida. Quando o provider de embedding (fixo:
`ollama`) não responde, o pipeline grava os chunks SEM vetor e declara a
lacuna no relatório — nunca finge indexação completa, e a busca degrada
para léxico-only avisando. A tela (Chat RAG como aba própria) é da Onda
5; esta frente é só o backend.

## PROGRAMA 28 — Onda 4, frente F1: ciclo de vida do container vira tabela, sem orquestrador (RN-243..248, ADR 0081)
Ver item 31 da FASE 25 (PARCIALMENTE REVOGADO): `project_containers`
(migração `0046`) grava o ESTADO mutável — `provisioning → running ⇄
stopped`, `failed` alcançável dos três, `removed` só sai reprovisionando
— distinto de `artifact.project_image` (a DECISÃO imutável do
Arquiteto). Confirmado por investigação (grep, zero ocorrências):
NENHUM serviço do produto monta `/var/run/docker.sock` nem roda
`privileged` — os dois casos de uso só GRAVAM e LEEM, nenhuma chamada
real a Docker. A primeira transição exige a imagem já decidida (RN-105)
e CONGELA versão/recursos na linha; projeto `local` (ADR 0072) é
recusado, porque não sobe container próprio. Teto de recursos
(`cpus`/`memory_mb`/`pids_limit`) é DECLARADO, não aplicado — nenhuma
tela afirma "o container está limitado a X", só "a intenção registrada
era X". Nenhuma rota HTTP nova à época: sem consumidor real ainda, expor
uma seria adivinhar contrato — fechado pela Onda 5/frente F2 logo abaixo.

## PROGRAMA 28 — Onda 5, frente G3: o Chat RAG ganha aba própria (RN-252..254, ADR 0082)
A tela que RN-202 (Onda 2/C) tinha adiado — "Chat RAG" descreveria uma
capacidade que ainda não existia — chega junto com o backend da Onda
4/G2: `key: 'rag'`, aba NOVA (`ordem: 28`, entre Código e Backlog),
NUNCA renomeando `sessions`. A distinção continua a mesma, só a razão
mudou: `sessions` é conversa com agente ATIVADO (gasta a chave do owner
por turno, RN-058); `rag` é busca sobre um índice já construído, sem
agente nenhum no meio, read-only por natureza. A tela consome os três
contratos do ADR 0080 sem adivinhar forma e mostra as duas degradações
honestas que o backend já declarava e nenhuma tela lia — `vectorAvailable:
false` vira aviso visível, e a cobertura nunca inventa "reindexado há
Xmin". Citação de origem `session` navega até o EVENTO exato, reusando o
mecanismo que os chips de evidência do Psicólogo já usam; origem `file`
mostra caminho/heading como texto, sem link — a aba Código não tem
deep-link por caminho hoje, fora de escopo aqui.

## PROGRAMA 28 — Onda 5, frente F2: o consumidor real do ciclo de vida do container (não o terminal) (RN-267/268, ADR 0083)
O plano original desta frente era o terminal interativo completo. A
investigação confirmou que a FASE 25b continua cortada: nenhum serviço
monta `/var/run/docker.sock`, e mesmo depois do ADR 0081 nada em
produção transiciona `project_containers` — não existe container real
para abrir um terminal DENTRO dele. Implementar um terminal fingido, ou
rodando no mesmo container do monorepo do Brabo (a dívida que o ADR 0055
já descreve como política, não isolamento), inventaria capacidade — o
mesmo erro que os ADRs 0041/0042 recusam para provider de LLM e modelo
de catálogo. A entrega real: `GET /projects/:projectId/container/lifecycle`
(role:viewer), primeira exposição HTTP do ciclo de vida (revisa o ADR
0081, que tinha adiado a rota por falta de consumidor), e a aba Terminal
mostrando esse estado — badge traduzido, motivo de falha — SOB o texto
explicativo que já existia, nunca no lugar dele, buscado só enquanto a
aba está aberta. `null` (nunca provisionado) é o resultado honesto e
mais comum hoje.

## PROGRAMA 28 — Onda 5, frente I: login social revoga a proibição do backlog do ADR 0031 (RN-272..283, ADR 0084)
Pedido explícito do dono do produto, ciente das consequências de
segurança — a proibição sai só para GitHub/GitLab; MFA, OIDC provider e
federação genérica continuam fora de escopo (ver "O que NÃO fazer").
`SocialLoginCallbackUseCase` termina no MESMO `EmitirSessaoUseCase` do
login por senha — nenhum segundo formato de sessão. Reusa o cliente
OAuth existente, mas o `state` tem propósito PRÓPRIO
(`purpose: 'social_login'`, checado ANTES de qualquer outro campo):
nunca aceita o `state` do fluxo de CONEXÃO de git a um projeto, o que
seria escalação de privilégio. Tabela nova `social_identities` (migração
`0047`), chave `(provider, provider_user_id)` — nunca e-mail/login.
Decisão em três passos: identidade conhecida → login; e-mail bate com
conta existente E verificado pelo provider → vincula (e verifica o
e-mail da conta se ainda não estava); e-mail bate mas NÃO verificado →
recusa — um e-mail digitado não é prova de posse, aceitar abriria
account takeover; sem conta correspondente → provisiona conta nova sem
senha, mesmo estado "pendente" da migração do Keycloak. Reusa o MESMO
app OAuth da conexão de git — zero variável de ambiente nova, só
`redirect_uri`/`scope` diferentes por fluxo; a ação do OPERADOR de
cadastrar o segundo callback no provider é o que justifica o branch
`breaking/`.

## Auditoria fluxo.yml × código — o plano do Dev Lead vira aprovação de verdade (RN-284, ADR 0086)
Não é fase planejada: fecha a divergência que uma auditoria só-leitura de
`docs/fluxo.yml` × código encontrou (achado A2,
`docs/explanation/auditoria-fluxo-vs-codigo.md`) — o fluxo já declarava a
saída `plano-de-paralelismo` do `dev-lead` como `via: proposed_action`
desde o ADR 0085, e o código nunca foi ajustado para bater. O dono do
produto decidiu que o código errava.

`propose_execution_plan` entrou em `decide.ts` (papel mínimo
`maintainer`), DELIBERADAMENTE fora do bloco de tetos absolutos — pode ser
configurado para auto-aprovar, ao contrário de
`parallelize`/`raise_max_parallel`. O Dev Lead é o PRIMEIRO agente
conversacional (todos rodam turno síncrono via `GenServer.call` de até
180s) a suspender esperando uma decisão humana — o padrão já existia para
o dev agent (ADR 0052) e os gates de QA/Infra (ADR 0057), mas os dois são
disparados por `cast` e nunca precisaram lidar com um `from` síncrono
pendente. `TurnoAssincrono.tratar_resultado/2` ganhou um ramo: presente a
chave `:aguardando_aprovacao` (checada pelo VALOR, não pela presença —
o Dev Lead a carrega `nil` desde o `init/1`), responde ao `from` do mesmo
jeito e na mesma hora de sempre, mas emite só `agent.status:
awaiting_approval` em vez de `agent.done` — o turno não terminou.
`LiveBroadcast.agent_status/4` ganhou o status novo na guarda. A retomada
usa o MESMO `Engine.Dev.Wake` que `QaLeadServer` já reusa para os
subagentes de QA (a entrega é por AGENTE, não por tipo).

**Lacuna aceita, declarada**: sem tabela de estado própria, um restart do
engine enquanto o Dev Lead está suspenso perde a inscrição — a decisão
continua registrada e visível em Aprovações, mas ele não narra o desfecho
sozinho. Fechar isto exigiria o mesmo mecanismo de persistência do ADR
0052; fora do escopo desta correção, que só alinha o comportamento ao que
`docs/fluxo.yml` já declarava.

## UX Designer — o quinto agente conversacional, antecipado (RN-285..287, ADR 0087)
Não é gatilho de separação disparado — `docs/fluxo.yml` sempre declarou
"quando o projeto GERENCIADO tiver interface própria a desenhar" como
critério, e ele não disparou: o design system continua insumo estático.
Decisão CONSCIENTE do dono do produto de antecipar o papel mesmo assim.

`Engine.Agents.UxDesignerServer` espelha o `DevLeadServer` — GenServer por
sessão, teto de 14 iterações, ativado por handoff `accepted` endereçado a
"ux-designer" pelo mecanismo GENÉRICO já existente (nenhuma linha mudou em
`ActivateAgentUseCase`). SOLO: sem área, sem subagentes. O kickoff lê a
`artifact.product_brief` mais recente — a MESMA "necessidade de negócio"
que o Criativo produz, sem artefato novo — e o sistema de design
(`design/tokens.css`, `design/COMPONENTS.md`) é DESCRITO na identidade do
agente (`Engine.Harness.Agents`), texto estático: os agentes conversacionais
não têm ferramenta de leitura de arquivo do repositório.

`propose_prototype` é a ÚNICA ferramenta (`personas`, `jornadas`,
`prototipo` com `telas`/`anotacoes`, `resumo`). Grava
`artifact.prototipo_navegavel` **sem caso de uso dedicado na api** —
diferente de `choose_project_image`/`create_c4_diagram`, que precisam de um
porque têm conteúdo DERIVADO de outro artefato ou recusa de domínio
compartilhada; nenhum dos dois motivos vale aqui, então a validação de forma
mora no engine (`ArtifactSchemas`) e a gravação usa o `append_event_returning`
genérico que a api já expõe, mesmo caminho do `artifact.product_brief`. Um
artefato só, dois handoffs sobre ele — para "po" e para "dev-lead" — nunca
um segundo artefato para "spec-visual": o protótipo (telas + anotações) É a
spec visual, e duplicá-lo arriscaria as duas cópias divergirem depois. Reusa
a metade do desenho do ADR 0086 que sobrevive sem a suspensão dele:
`propose_prototype` bem-sucedido encerra o turno, para o modelo não propor
de novo e duplicar o artefato — sem o "aguardando_aprovacao", porque propor
um protótipo não tem efeito externo.

`apps/web/src/lib/agents.ts` ganhou a entrada (`color: var(--accent)`, o
token semântico menos reusado do roster; `icon: PencilIcon`).
`uxDesignerActive` entrou no roster nas DUAS fontes que a RN-090 exige em
sincronia — o painel do time (`agent-status.ts`) e o card do dashboard
(`projects-summary.repository.ts`, mesma consulta de `infraActive`
ampliada, sem query nova).

**Fora de alcance, declarado**: `teste-de-usabilidade` exige usuário humano
real — nenhum agente substitui isso. `metricas-de-uso` segue lacuna mesmo
com `analytics` `active` (ADR 0089): o relatório de funil mede
sessão→commit→PR→merge, não adoção de feature pelos usuários FINAIS do
projeto que o Brabo constrói — "evidência de adoção por feature" está
DECLARADA como métrica sem caminho para existir hoje, não pendência a
fechar na próxima rodada.

## Staff — código pronto, dormente para disparo automático (RN-305/306, ADR 0088)
Não é fase planejada: `docs/fluxo.yml` declara o Staff/Principal Engineer
como `status: planned` desde o ADR 0085 ("contrato pronto, ativação
decidida, aguarda gatilho"). Decisão CONSCIENTE do dono do produto:
antecipar o CÓDIGO mesmo sabendo que o gatilho AUTOMÁTICO (a Anamnese
notando um problema sistêmico RECORRENTE) não vai disparar — a Anamnese
está pausada (`ANAMNESE_ENABLED=false`, decisão de 2026-08-10). Dormente
para disparo automático, não para acionamento MANUAL.

Sexto agente conversacional solo (`Engine.Agents.StaffServer`), ao lado de
Criativo/PO/Arquiteto/Dev Lead/UX Designer, espelhando o Arquiteto (laço
bounded teto 14) com duas diferenças: SEM `kickoff/1` (não há artefato de
sessão para resumir — sobe e fica ocioso até a primeira `user_message`,
que é como quem endereçou o handoff explica o problema) e ativado pelo
caminho GENÉRICO de `canActivateAgent` (handoff `accepted` endereçado a
"staff"), sem entrar em `USER_STARTED_AGENTS` — investigação confirmou que
nenhuma mudança de domínio na api era necessária, porque
`assertHandoffTargetAllowed` só recusa subagente de área e o Staff não tem
área. A única ferramenta, `propose_rfc` (problema, opções com trade-offs,
recomendação, PoC descartável), grava `artifact.rfc_staff` DIRETO via
`append_event_returning` — mesmo padrão sem tabela de `emit_insight`, e
não o de `artifact.c4_diagram` (que deriva o Container level do
module_map na api) — e devolve o handoff ao Arquiteto no MESMO tool call,
sem `proposed_action` (registrar um documento não é efeito externo).

`staffActive` entrou na roster do painel do time e no card do dashboard
(`ProjectCardSummary.roster`), mesmo critério de `infraActive`, para não
abrir a divergência que o comentário de `RosterFacts` já alertava.
**Declarado, não escondido**: `SessionPage.tsx`/`AGENTES_DE_CHAT` não
foram tocados — mesmo padrão já aceito para `infra` (um lead REAL e ATIVO
também fora dessa lista). O caminho ponta a ponta de uso hoje é a rota
interna (`POST .../agent/message`, `agent: "staff"`), não a tela de
Sessão; a UI genérica de "handoff manual a agente à escolha" segue no
backlog.

## O gate `implementavel` ativo — QA-estratégia como segundo momento do qa-lead (ADR 0090)
Decisão consciente do dono do produto de antecipar o gatilho que
`docs/fluxo.yml` já previa ("quando o gate implementavel ativar") — o
gatilho AQUI é o próprio trabalho de construir o mecanismo, não um sintoma
de uso esperando para acontecer. `docs/gates.yml`, `implementavel`:
`status: planned` → `active` (dono `dev-lead`, `severidade: warn`
intocada — o registro já dizia "nasce warn mesmo quando ativar").

**QA-estratégia deixa de ser papel `proposto`**: é o PRÓPRIO `qa-lead`, num
segundo MOMENTO — mesmo processo, entregável separado do veredito de PR,
exatamente como `docs/fluxo.yml` já declarava ("pode ser o próprio qa-lead
em segundo MOMENTO, não necessariamente agente novo: a separação é de
entregável"). `Engine.Gates.QaLeadServer.run_design/3` é um ponto de
entrada NOVO e ADITIVO (sem tocar `run/2`, o caminho de sempre, amarrado a
`DevAgentState.find_by_task_id`), acionado por
`Engine.Gates.Dispatcher.run_qa_estrategia/3` (mesma indireção trocável em
teste que `run_qa/2`/`run_secops/2` já usam).

`Engine.Gates.QaEstrategiaAgent` é módulo SEM ESTADO (não `GenServer`),
mesma forma de `QaPerformanceSegurancaAgent` — registro sem `Terminal`
(`ReadFile`, `SearchWorkspace`, `EmitPlanoDeTeste`) —, mas o CONTEXTO é
outro: `Engine.Gates.QaEstrategiaContext.fetch/3` busca SÓ story (de
`list_backlog`) e `module_map` vigente (de `get_infra_context`, reusado só
pelo campo `moduleMap` — zero rota nova), sem `dev_state` nem
`worktree_path`, porque o gate roda PRE-DEV: não há dev agent, worktree
nem `task_id` ainda. Nenhuma das três ferramentas passa pelo
`ActionPipeline` (só `terminal`/`write_file` passam), então este agente
NUNCA suspende — `run_design/3` roda síncrono dentro do próprio
`handle_cast`. O teto de iterações fica em 8 (conversacional), não 60
(gate) — DE PROPÓSITO: sem `token_budget_micros` por baixo (não há task,
PRE-DEV), a mesma razão pela qual `infra-workflows` fica em 8 mesmo usando
ferramenta (RN-085). O entregável (`emit_plano_de_teste`: síntese,
critérios executáveis, estratégia de automação GENÉRICA e sem framework)
vira `artifact.plano_de_teste` no event log da sessão que chamou.

`assess_implementability`, ferramenta nova do Dev Lead, lê o
`artifact.plano_de_teste` mais recente da story no histórico da PRÓPRIA
sessão: sem plano ainda, dispara a avaliação e devolve erro pedindo
retentativa (erro de ferramenta é ENTRADA do laço, não fim de linha —
RN-163); com plano, propõe o parecer (`implementavel`/`inviavel` +
justificativa, plano embutido no payload) como `proposed_action`, MESMO
padrão de três desfechos de `propose_execution_plan` (ADR 0086) —
`maintainer`, DELIBERADAMENTE fora do bloco de tetos absolutos de
`decide.ts`.

**`appsec` deixa de ser `proposto`** — o segundo momento do SecOps entra na
seção seguinte.

## O appsec ganha o segundo momento do secops (RN-360/361, ADR 0090)
`docs/fluxo.yml` (`id: appsec`, camada_seguranca) declarava por antecipação
"mesmo padrão do QA: dois MOMENTOS, não dois agentes por ora" — decisão
consciente do dono do produto de antecipar a ativação, sem esperar o gate
`implementavel` (frente `qa-estrategia`, mesmo ADR conceitual 0090) que o
próprio registro citava como gatilho.

`Engine.Gates.SecOpsAgentServer.run_design/2` roda no MESMO processo do
secops de PR (mesma chave de `Registry`), sem `Diff`/`Scanner`/
`DevAgentState` nenhum: busca a story no backlog + o `module_map` vigente
(`Engine.Gates.AppSecContextBuilder`, sem `dev_state`/`worktree_path`) e
chama `Engine.Gates.AppSecAgent.run/3` — módulo SEM ESTADO (não é GenServer,
mesma forma de `QaPerformanceSegurancaAgent`), registro de ferramentas SEM
`Terminal`, rodando um checklist STRIDE-lite via `ToolLoop.run/1` sobre o
DESENHO da story, nunca sobre código. Termina emitindo `artifact.threat_model`
e criando handoff para os três leads declarados (arquiteto, dev-lead,
`infra` — o AGENTE endereçável do id `area-infra`, RN-361).

**Lacuna declarada, não bug**: `run_design/2` é ACIONÁVEL, mas nada aciona
sozinho ainda — o gatilho natural é `assess_implementability` do Dev Lead
(frente `qa-estrategia`), fora do escopo desta entrega, que foi mantida
autocontida (`decide.ts`/`docs/gates.yml`/`dev_lead_tools.ex` intocados).

## `analytics`/`delivery-metricas` viram relatório (RN-320..322, ADR 0089)
Decisão consciente do dono do produto de ANTECIPAR dois papéis do
modelo-alvo (`docs/fluxo.yml`, `status: proposto`) sem esperar o gatilho
orgânico que cada um já declarava. A forma é a que o próprio fluxo
prescrevia: `analytics` "absorvido por `medicao`" até métrica de PRODUTO
virar entrada obrigatória do PO, `delivery-metricas` "nunca vira agente —
vira RELATÓRIO do `medicao`". Os dois viram um SCRIPT só —
`apps/api/scripts/analise-funil.ts` (`pnpm --filter api analise:funil --
--projeto <uuid> [--json]`), no MESMO formato de `medir-execucao.ts`
(Fase 13b): leitura pura via Drizzle, zero escrita, sem GenServer, sem
agente de LLM.

Mede DE VERDADE, sobre `proposed_actions.execution_result` das três ações
git do dev agent (`git_commit`/`pr_open`/`git_merge`, só `status:
'executed'`): funil real (quantas sessões produziram commit / PR aberta /
PR mergeada, e a conversão entre etapas — conta SESSÃO, não ação), lead
time real (primeiro commit ao primeiro merge da sessão, por `updated_at`
da EXECUÇÃO, não da proposta) e deployment frequency real (merge em
branch `PROTECTED_BRANCHES`, por dia, cruzando por referência com o gate
`backmerge` de `docs/gates.yml` — cuja evidência é CI, fora do alcance de
um script que só lê o banco).

Três métricas ficam numa seção "Não medido, de propósito" — declaração
PERMANENTE, não lacuna a fechar na próxima rodada: **funil de produto
completo ideação → commit** (`sessions` sem `storyId`, RN-230, exigiria
schema novo — nenhuma migration nesta frente); **evidência de adoção por
feature** (não é dado que falta coletar — o Brabo não instrumenta os
projetos que ele CONSTRÓI, sem caminho nenhum para essa telemetria
existir hoje); **MTTR e change failure rate** (exigem sinal de INCIDENTE
de produção real, a mesma dependência de `secops-runtime`/`platform` —
outra frente).

## `secops-runtime` como script de relatório (RN-375..377, ADR 0091)
Antecipação decidida do dono do produto do papel `secops-runtime`
(`docs/fluxo.yml`, `camada_seguranca`, antes `proposto`), sem esperar o
gatilho declarado ("produção com tráfego real, pós `DEPLOY_ENABLED` +
`platform` ativo"). Só o que o gatilho NÃO exige entra: `pnpm --filter api
relatorio:seguranca-runtime` lê `rate_limit_hits` — o dado que o
`RateLimitGuard` do ADR 0027 já grava, inclusive sob tráfego de dev/CI — e
produz ranking de baldes (`user:<uuid>`/`ip:<endereço>`, os dois únicos
formatos gravados; sem rota nem motivo, que a tabela nunca guardou) e
distribuição temporal em fatias fixas. É SCRIPT, não agente LLM nem
`GenServer`: não há decisão a tomar sobre o dado, só agregação.

Detecção automática de incidente, resposta a incidente e postmortem de
segurança continuam FORA — dependem do mesmo gatilho que não disparou — e
o relatório os lista numa seção "não medido" PERMANENTE, sem simular
incidente de exemplo nem inventar número (mesmo princípio dos ADRs
0041/0042/0077). A janela retida é curta por desenho
(`DomainGaugesCollector.pruneRateLimit` apaga hits com mais de
`2 × RATE_LIMIT_WINDOW_MS`, 240s por padrão), e o relatório declara as duas
janelas — CONFIGURADA e OBSERVADA — nunca deixando a segunda passar por um
histórico maior do que é.

## `platform` ganha uma primeira entrega: relatório de telemetria sob demanda (RN-385/386, ADR 0092)
Decisão consciente do dono do produto de antecipar parte do papel `platform`
(`docs/fluxo.yml`, `camada_plataforma`) — cujo `status` continua `planned` e
cuja `ativacao` continua sincronizada com `DEPLOY_ENABLED`, que não existe.
`pnpm --filter api relatorio:telemetria [--projeto <uuid>] [--json]` é um
SCRIPT (não agente LLM, não `GenServer`) que lê, sob demanda, as MESMAS
perguntas que o `DomainGaugesCollector` já coleta para o scrape do
Prometheus — sessões ativas/closing por projeto, tasks bloqueadas por
projeto, estado do último backup (sempre GLOBAL, nunca por projeto, porque o
produto faz backup do banco inteiro) — e termina depois de imprimir. As
consultas SQL são REPLICADAS, não importadas do coletor: os métodos dele são
privados e terminam escrevendo num gauge Prometheus, sem metade pura de "só
a query" para reusar sem acoplar um script de CLI ao ciclo de vida de um
`@Injectable`.

A saída sempre traz "onde ver mais" (os dashboards versionados em
`deploy/k8s/observability/dashboards/*.json`, os alertas em
`deploy/k8s/observability/alerts/brabo-alerts.yaml`, `docs/runbook.md
#observabilidade`, `pnpm dev:obs` para observabilidade local) — link, nunca
duplicação — e uma seção "não medido" que DECLARA, sem inventar: nenhum SLO
numérico está definido no produto, postmortem depende de incidente real que
não aconteceu, e telemetria de volta ao produto em loop fechado é o que
tornaria `platform` `active` — o gatilho (`DEPLOY_ENABLED`) segue ausente. O
`gate_saida: { id: operavel, status: planned }` do papel não muda;
`docs/fluxo.yml` só ganha uma `nota` na saída `telemetria-consolidada`
dizendo que a versão manual/sob-demanda já é real.

## dbre vira dois scripts mecânicos (RN-400..403, ADR 0093)
Do papel `dbre` do fluxo.yml, só dois dos quatro entregáveis dependem de
volume real de dados (`plano-de-capacidade`, `tuning` — seguem lacuna,
sem prazo). Os outros dois não precisam de carga real: `parecer-de-
migracao` é reconhecimento de padrão em texto SQL
(`apps/api/scripts/lint-migracao.ts`, varre `apps/api/src/db/migrations/
*.sql`, sinaliza `DROP TABLE`/`TRUNCATE`/`DROP COLUMN`/`ALTER COLUMN ...
TYPE`/`ADD COLUMN ... NOT NULL` sem `DEFAULT`, `!= 0` se achar algo — hoje
acha 3 ocorrências em migrations já mergeadas e aceitas, informativo, não
corrigidas de passagem); `backup-restore-testado` já era real desde a
Fase 5 (CronJob + `backup_runs` + `make test-restore` executado, RTO
~40s) — faltava só um relatório sob demanda (`relatorio:backup`, mesma
leitura do `DomainGaugesCollector.collectBackup()`). Nenhum dos dois
entra em CI ainda: o linter varre o repositório inteiro, não o diff de
uma PR, e viraria gate que reprova PR por achado que não é dela — ver o
ADR 0093 para a técnica de escopo (`pr-police.ts`) quando isso mudar. A
regra de "uma migration por onda" (`meta/_journal.json`) deixou de ser
chamada de "versão mecanizada" deste papel: ela evita conflito de
snapshot entre agentes em paralelo, preocupação ortogonal a "este SQL
tem um padrão arriscado".

## Auditoria fluxo.yml × código — Onda 1: fluxo.yml/gates.yml em dia
Primeira das seis ondas do plano da auditoria (seção D,
`docs/explanation/auditoria-fluxo-vs-codigo.md`) a fechar — as Ondas 3, 4 e
5 já tinham sido antecipadas fora de ordem (analytics/DORA, gate
`implementavel`, QA-estratégia/appsec); esta é só metadado, sem ADR, sem
linha de código de produção.

`docs/gates.yml` (`paralelismo-autorizado`): `status: planned` → `active`,
com `evidencia` no MESMO formato do gate `implementavel` vizinho —
`event_types: [proposed_action.created/approved/denied]`, `filtro: {
actionType: parallelize }`, `onde:
request-parallelization.use-case.ts` (achado A1/B5 — o `fluxo.yml` já
dizia `ativo` desde o ADR 0053/FASE 14d, só o `gates.yml` ficou para trás).
`docs/fluxo.yml` ganhou mais três correções da auditoria, todas de citação
ou rótulo, nenhuma de comportamento: a máquina de estados do `dev` passou
de 4 para 5 estados (`awaiting_approval` entrou, Fase 12e/ADR 0052 — A3); a
citação de RN-160 saiu da entrada `backlog-promovido` do Arquiteto e foi
para onde ela realmente se aplica, a saída `handoff-duplo` (o botão
"Confirmar arquitetura pronta" que ela trava — A4); a citação de RN-161
saiu de `handoff-duplo` e virou nota na entrada do Dev Lead (é o passo de
ACEITAR o handoff que encadeia ativação de execução, não o duplo handoff
em si — A5); e a origem de `worktree-por-agente` do `dev` deixou de dizer
`harness` (`Engine.Dev.WorktreeManager` não é um dos 4 componentes do
papel `harness` — A8). `docs/explanation/backlog.md` também foi
atualizado: a linha do `gates.yml` desatualizado saiu da tabela de
pendências (fechada aqui), junto com o gate `implementavel` (B3, já
fechado pelo ADR 0090 antes desta onda, sem ninguém ter tirado da tabela)
e a parte de B7 (deployment frequency/lead time) que o `analise:funil`
(ADR 0089) já entrega de verdade — MTTR/change failure rate continuam de
fora, mas como lacuna PERMANENTE já declarada em `fluxo.yml`, não
pendência de engenharia.

Verificação: `pnpm --filter api validacao:gates -- --sem-banco` (registro
válido, sem `ativo-sem-evidencia`) e `pnpm docs:check` verdes. A fase 3 do
script (evidência real no event log) exige `--projeto <uuid>` contra um
banco com dados — fora do alcance desta correção, que é só de metadado.

**Pendentes do mesmo plano, não desta onda**: Onda 2 (delegação Dev Lead →
dev, RN-160 revalidada no backend) e Onda 6 (gate `necessidade-validada`,
que exige ADR e decisão de produto antes de codar).

## Auditoria fluxo.yml × código — Onda 2: RN-160 no backend e delegação Dev Lead → dev (RN-404/405, ADR 0094)
Segunda das seis ondas do plano da auditoria (seção D), os DOIS itens de
maior escopo depois da Onda 1 — os outros quatro (3, 4, 5 antecipadas fora
de ordem; 6 ainda pendente, exige ADR e decisão de produto). Os dois vivem
exclusivamente em `apps/api`; nenhuma mudança em `engine`/`web` foi
necessária.

**B6 — RN-160 revalidada no backend.** A regra ("Confirmar arquitetura
pronta" exige ao menos 1 história promovida) só era garantida no CLIENTE
(`SessionPage.tsx`, `hasPromotedStory`) — uma chamada HTTP direta a
`POST /agents/arquiteto/handoff-infra` ignorava a regra por completo.
`OfferInfraHandoffUseCase.execute` agora consulta
`StoryRepository.findByProject` e recusa com `BadRequestException` ANTES
de gravar o evento ou chamar o engine, quando nenhuma história tem
`status !== 'draft'`.

**B1 — a delegação Dev Lead → dev vira dado.** O ADR 0053 (item 5) já
previa isto e declarou fora de escopo à época — CLAUDE.md listava como
corte reversível. Fechado aqui: `AcceptParallelizationUseCase.execute`
(lado API, cobre os caminhos direto E aprovado de graça, porque os dois já
convergem nele) grava `delegations` com `area: 'dev'`, `leadAgent:
'dev-lead'`, `subagent` = o id do `dev-<modulo>` recém-ativado. Diferente
de QA/Infra (que gravam do lado ENGINE, porque é lá que o subagente produz
um parecer), `status: 'completed'` foi REDEFINIDO para esta área: significa
"a delegação foi EFETIVADA" (o agente subiu), não "parecer emitido" — e
`parecerArtifactId` aponta para o `artifact.module_map` mais recente do
projeto (via `SessionEventRepository.listByTypeForProject`, método já
existente, sem consulta nova). Sem module_map no projeto — não deveria
acontecer —, a delegação não é gravada com id falso: só loga o estado
inesperado e segue, porque a ativação do dev agent já é sucesso quando essa
gravação é tentada; falha em `RecordDelegationUseCase` também não derruba a
ativação, pela mesma razão. Decisão registrada no ADR 0094, que também
revoga o corte do ADR 0053 item 5.

`docs/fluxo.yml` (`dev-lead`, saída `delegacao`): `status: lacuna` →
`status: ativo, regra: RN-405`.

## Auditoria fluxo.yml × código — Onda 6 (última): o gate `necessidade-validada` (RN-406, ADR 0095)
Fecha a ÚLTIMA das seis ondas do plano da auditoria (seção D,
`docs/explanation/auditoria-fluxo-vs-codigo.md`) — as seis fecharam: a 3,
4 e 5 tinham sido antecipadas fora de ordem (analytics/DORA, gate
`implementavel`, QA-estratégia/appsec, ADRs 0089/0090); a 1 e a 2
fecharam nos PRs anteriores (fluxo.yml/gates.yml em dia; RN-160 no
backend + delegação Dev Lead → dev). Esta é a 6ª: o gate
`necessidade-validada` (Criativo → PO), declarado `proposto` desde o ADR
0085 sem mecanismo nenhum atrás.

`modelo-de-time.md` já registrava por que ele ficou parado: o Criativo (o
modelo) decidir sozinho que a necessidade que ele mesmo produziu está
validada seria autovalidação, não gate de verdade. A decisão do dono do
produto foi confirmação humana SEPARADA — um terceiro botão em
`SessionPage.tsx`, "Confirmar necessidade validada", no MESMO padrão de
"Confirmar arquitetura pronta" (RN-160): rota dedicada
(`POST .../agents/criativo/validate-necessity`), caso de uso dedicado
(`ValidateNecessityUseCase`), evento próprio (`necessity.validated`).
Nunca reaproveitou `confirm_readiness`/RN-142 (que continua sendo só o
piso estrutural, "≥1 regra capturada") nem o aceite do handoff pelo PO
(`AcceptHandoffUseCase`, estrutural, sem julgamento de conteúdo).

O encadeamento escolhido: o botão só habilita DEPOIS que `confirm_readiness`
já consolidou o `artifact.product_brief` (`hasProductBrief`) — não faz
sentido "validar" um resumo que ainda não existe, e é a leitura mais
consistente com `docs/fluxo.yml` (o gate é de SAÍDA do Criativo, o
momento em que o trabalho dele já entregou um artefato concreto).
Diferente de `OfferInfraHandoffUseCase`, esta confirmação NÃO sinaliza o
engine — o handoff Criativo→PO já aconteceu dentro do próprio
`confirm_readiness`, então o evento novo é só o registro do MÉRITO, sem
gatilho nenhum esperando por ele.

`docs/gates.yml` ganha o gate `necessidade-validada`: `active`,
`aprovacao_humana: true`, mas `severidade: warn` — nada no produto hoje
CONSULTA a passagem deste gate antes de deixar o PO seguir, diferente dos
`block` de `story-promovida`/`plano-de-adocao`, que têm trava real de
código por trás. `docs/fluxo.yml` (`criativo`, `gate_saida`): `status:
proposto` → `status: ativo, regra: RN-406`.

## Auditoria fluxo.yml × código — B4 (a ÚLTIMA pendência): o PO lê métricas de produto (RN-407)
Fecha o item B4 — a última linha da tabela "Backlog do modelo de time
(ADR 0085)" em `docs/explanation/backlog.md`; a tabela fica VAZIA depois
desta correção, e a auditoria fluxo.yml × código termina aqui. Sem ADR
novo: segue o mesmo padrão já estabelecido pela RN-164 (leitura de agente
escopada ao projeto, sem efeito externo, sem `proposed_action`), só com
uma RN nova. `docs/fluxo.yml` (papel `po`, entrada `metricas-de-produto`):
`status: lacuna` → `regra: RN-407`.

O DADO já existia desde o ADR 0089 (`analise:funil` — funil real
sessão → commit → PR → merge, lead time real, deployment frequency real);
faltava só o PO conseguir LER esse relatório dentro do turno. Terceira
ferramenta de leitura do PO, `listar_metricas_de_produto`
(`GET .../product-metrics`), mesmo desenho exato das duas irmãs da
RN-164 — `:direct`, sem parâmetro, escopo fechado no projeto. As funções
de CÁLCULO puras e a query (`calcularFunil`/`calcularLeadTimes`/
`leadTimeMedioMs`/`deploymentFrequencyPorDia`/`buscarAcoesGitDoFunil`)
migraram de `apps/api/scripts/analise-funil.ts` para
`apps/api/src/application/services/funil-metrics.ts` — refatoração
MECÂNICA e necessária (`scripts/` não pode viver em `src/`, e `src/` não
importa de `scripts/`): o script passou a REEXPORTAR dali, sem mudar
assinatura nem comportamento, e o teste de regressão do script continua
verde sem ser tocado. O corpo JSON não tem campo para as três ausências
permanentes que o script já declarava só em texto (funil de produto
completo ideação → commit, evidência de adoção por feature, MTTR/change
failure rate) — a ferramenta do PO as cita pelo nome no TEXTO que devolve
ao modelo, sempre, para ele nunca concluir por omissão dos números que
não há lacuna.

## GOVERNANCE.md — o critério do modo `community`, não o mecanismo dele
Item do backlog anterior ("Modo community do approval-ladder") virou correção
de registro, não implementação: investigação confirmou que o modo `community`
já existe em código desde a FASE 6 (`scripts/ci/approval-ladder.ts`), testado
nos dois lados, só desligado por `APPROVAL_MODE=solo` (default). A frase do
backlog ("vira mudança de `aprovacao_humana` no registro de gates") vinha de
uma linha ESPECULATIVA do ADR 0054 — não editada, por regra, mas a imprecisão
está registrada em `docs/explanation/backlog.md`: `aprovacao_humana` do gate
`aprovacoes-da-escada` já é `true` fixo nos dois modos, sem campo nenhum no
schema do `Gate` que reaja a `APPROVAL_MODE`.

O que faltava de verdade era outro `TODO(humano)`, em
`docs/explanation/branching-policy.md`: o critério de quem entra em cada
lista de aprovadores (`devs`/`po`/`gestão`) — quem entra, quem sai, com base
em quê. `GOVERNANCE.md` (raiz do repo, novo) fecha isso: MECANISMO continua
em `branching-policy.md` (a escada, pessoas distintas, o passo a passo da
troca de variável), CRITÉRIO passa a morar em `GOVERNANCE.md`. É proposta,
não comitê em funcionamento — o projeto continua com um mantenedor só, e o
documento é explícito sobre isso: a maior parte dele descreve o que passa a
valer QUANDO houver mais gente, não uma estrutura já ativa. Regra `warn` nova
no docmap (`governanca`) cobra revisão quando `approval-ladder.ts`/
`branching-policy.md` mudam — separada da regra `block` existente
(`politica-de-branches`) pelo mesmo motivo que `checks-e-rulesets` é separada
dela: MECANISMO decorre do código, CRITÉRIO é decisão humana.

## SMTP real no MailSender (RN-408, ADR 0096)
Fecha o item de backlog aberto desde o corte do Keycloak (ADR 0032, "SMTP
real continua sendo config futura"). `nodemailer` sobre transporte SMTP
puro (protocolo de LINHA com estado/MIME/STARTTLS/AUTH, diferente das APIs
JSON HTTP que o resto do produto integra), atrás de `MAIL_TRANSPORT` — `log`
(default, INCLUSIVE em produção: enviar e-mail de verdade é opt-in do
operador) ou `smtp`, selecionado por `useFactory` em `AuthUseCasesModule`
sem tocar nenhum caso de uso (`RegisterUseCase`,
`RequestPasswordResetUseCase`, `LoginUseCase`, o script
`migrate-keycloak-users.ts` continuam só injetando `MailSender`).
`SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` seguem o padrão RN-114
em produção quando o modo é `smtp` — mas SEM o default público que as
quatro RN-114 originais têm, então a régua só entra quando o operador optou
por `smtp`; a validação roda no construtor de `SmtpMailSender`, exercitado
pelo `useFactory` na montagem do grafo de providers (mesmo desenho de
`CREDENTIALS_MASTER_KEY`), não por chamada eager em `main.ts`. Corpo em
TEXTO PURO, nunca HTML — a porta não carrega estrutura para corpo rico, e
um template engine seria superfície de injeção sem ganho nenhum.

Investigação achou uma lacuna real antes de codar: `email_verification` não
tinha rota web nenhuma — `verificarEmail` existia em
`apps/web/src/lib/auth.ts` desde a Fase 7a sem NENHUM chamador, então o
link do e-mail de verificação levaria a lugar nenhum assim que SMTP
passasse a mandar e-mail de verdade. `/verificar-email`
(`VerifyEmailPage.tsx`) fecha isso, espelhando `SetPasswordPage.tsx` — mesmo
padrão de `validateSearch` no `router.tsx`, mesma resposta única para link
inexistente/expirado/já usado — com uma diferença: sem formulário, a
confirmação dispara sozinha ao montar, então a tela precisa dos três
estados da RN-088 (carregando/erro/sucesso), não só dois.
## "N agentes online" no dashboard — status AO VIVO, nunca presença histórica (RN-409, ADR 0097)
Item do backlog anterior fechado. Investigação prévia confirmou que não
existia agregado de liveness nenhum, nem por projeto nem por workspace — só
presença HISTÓRICA (`RosterFacts`, "já apareceu alguma vez") e status ao
vivo de verdade só no cliente, derivado do event log, só quando um projeto
está ABERTO. `ProjectCardSummary.onlineAgentCount` soma dois mecanismos pela
MESMA régua ("não ocioso, não travado"): dev agents
(`engine.dev_agent_states.status NOT IN ('idle', 'idle_tripped')`,
agregado em lote no engine) e agentes conversacionais (último `agent.status`
da sessão mais recente com `status !== 'idle'`, `payload` que só aceita
`working`/`idle`/`awaiting_approval`). QA/SecOps nunca contam — não emitem
`agent.status`, veredito único por invocação, sem noção de "ocioso" entre
chamadas.

A decisão de arquitetura que vale registrar: a consulta lê
`engine.dev_agent_states` DIRETO, via SQL cru batelado por workspace, dentro
do MESMO `Promise.all` que já soma onze consultas do read model de RN-090
(DOZE → CATORZE, ainda CONSTANTE) — em vez de abrir uma rota HTTP interna
nova no engine. `api` e `engine` compartilham o MESMO banco físico,
separados só por schema Postgres, e já havia precedente
(`apps/api/scripts/medir-execucao.ts` já lê `engine.oban_peers`); esta
decisão eleva o padrão de script manual para código de produção TESTADO
(fixture mínima e declarada da tabela do engine em
`test/support/global-setup.ts`). Consequência aceita e declarada no ADR
0097: a consulta pressupõe que quem opera o produto migra os dois lados
juntos (`db:migrate` E `engine:migrate`), e falha alto/visível se só a api
migrou — sem try/catch escondendo o erro.

## Sessão de execução não fecha mais com dev agent pendente (RN-411)
Correção de defeito achado numa sessão de execução REAL, não item de
roteiro: cinco dev agents subiram, ficaram `idle_tripped` (RN-047, o
circuit breaker) travados esperando o usuário desbloquear tarefa a
tarefa, e o heartbeat de 30s da sessão (`Engine.Sessions.SessionServer`)
fechou a sessão por baixo enquanto o desbloqueio manual continuava. O
terceiro sinal de `GetSessionPendingWorkUseCase` (RN-064) só lê
`agent.status`, vocabulário dos agentes conversacionais — dev agents
falam `dev.*` (`Engine.Dev.AgentIo`) e nunca emitem `agent.status`, então
nenhum dev agent jamais segurava a sessão por esse sinal. O quarto sinal
lê o último evento `dev.*` de cada `dev-<modulo>`/`dev-<modulo>-2` na
sessão: `dev.working`/`dev.blocked`/`dev.idle_tripped` seguram a sessão
(travado esperando decisão humana É trabalho pendente); só `dev.idle`
(drenado de verdade) não segura. `dev.awaiting_gate`/`dev.awaiting_approval`
ENTRARAM na régua pela RN-412 — ver abaixo; a lacuna residual que este
parágrafo descrevia foi fechada.
## Workspace pessoal automático no cadastro (RN-410)
Achado navegando: o botão "Novo projeto" do dashboard não fazia NADA, sem
erro. Causa raiz: `RegisterUseCase` e `SocialLoginCallbackUseCase` (no ramo
que provisiona conta nova) criavam usuário e credencial mas NUNCA um
workspace — TODO cadastro novo caía nessa parede, e só não aparecia antes
porque `seed.ts` sempre cria um workspace junto dos dados de demonstração.
Os dois pontos agora criam o workspace e adicionam o usuário como `owner`
na MESMA transação que já cria a conta. Nome/slug saem de uma função pura
única, `nomeESlugDoWorkspacePessoal` (`domain/auth/personal-workspace.ts`),
para a regra não divergir em dois arquivos; o slug é sempre sufixado com
`userId.slice(0, 8)` (mesmo padrão de `extraDevAgentId`) para ser único
sem round-trip ao banco (RN-410).

## 413 nas PRs e Executores "sem execução" — as duas pontas e o encadeamento (RN-412, ADR 0098)
Não é fase planejada: correção pedida por USO real ("nas PRs sempre está
estourando entity too large") mais o defeito irmão da aba Executores
aparecer vazia com trabalho real rolando. Investigação achou os dois
encadeados: o gate morre com `413` → devs ficam presos em
`dev.awaiting_gate` → esse estado não segurava a sessão (lacuna da
RN-411) → o heartbeat de 30s fecha a sessão por baixo → a aba exige
sessão ativa e some com o roster inteiro.

**A causa do 413 era da API do Brabo, não do provider de LLM** — os
comentários que atribuíam o erro ao provider (`runtime.exs`,
`terminal_executor.ex`, `docker-compose.yml`) estavam errados;
`FalhaDeTurno.origem({413, _})` já classificava como `"codigo"`, e
estava certo. `apps/api/src/main.ts` nunca configurou limite de body do
Express — valia o default de 100 KB, muito abaixo dos 8 MB que o
Phoenix aceita, no sentido mais pesado do transporte (engine → api,
`POST /internal/sessions/:sessionId/llm-turn`, que reenvia o histórico
INTEIRO a cada iteração do ToolLoop). `API_JSON_BODY_LIMIT` (default
10 MB) fecha a ponta do transporte.

A segunda ponta, sem a qual subir o limite só adiaria o estouro: o
`ContextManager` do engine (ADR 0098) tinha DOIS defeitos que
mantinham a compactação inalcançável antes do corpo estourar —
`estimate/1` contava só `content`, então mensagens de `assistant`
cheias de `toolCalls` custavam ~zero tokens na estimativa; e a janela
de compactação usava só `context_window` (128.000 tokens nos agentes
de gate), o que dava ~350 KB antes de compactar — bem depois de
qualquer teto de transporte razoável. A janela EFETIVA agora é
`min(context_window, teto_de_transporte)`, com o corte sempre em
FRONTEIRA DE ITERAÇÃO do ToolLoop (nunca separando um `assistant` com
`toolCalls` dos `role: "tool"` que o respondem — quebraria o protocolo
de tool-use do provider).

**RN-412** estende a RN-411: `DEV_PENDING_TYPES` ganhou
`dev.awaiting_gate` (o argumento original — gate pode morrer e travar
o dev agent nesse estado indefinidamente) e também
`dev.awaiting_approval`, por um argumento novo achado na investigação:
a decisão de aprovação grava `proposed_actions.status` de forma
SÍNCRONA, mas a retomada do dev agent via outbox/Oban é ASSÍNCRONA —
na janela entre as duas, nada segurava a sessão, o mesmo defeito da
RN-411 um nível mais fundo.

**A aba Executores/Visão Geral** tinham o defeito irmão do lado web:
`executionActivated` era derivado de `events.some(...)` sobre a janela
de só 200 eventos de `useSessionEvents` — `execution.activated` é dos
PRIMEIROS eventos de uma sessão e saía da janela em qualquer execução
real, apagando o roster inteiro. O valor correto já existia, agregado
sobre TODOS os eventos, no resumo do workspace (RN-090,
`projects-summary.repository.ts`) — as duas telas passaram a consumir
esse valor. Achado de bônus no caminho: `ExecutionSection` (Visão
Geral) recalculava `activated` de novo, independentemente, sobre a
mesma janela — uma execução longa voltava a oferecer "Ativar execução"
como se nunca tivesse começado; corrigido junto. `gatesEverOpened`
sofre da MESMA classe de defeito e ficou DECLARADO como limitação
conhecida, não corrigido aqui — corrigi-lo exigiria mudar a assinatura
de `deriveAgentRoster`/`rosterFactsFromEvents`, fora do escopo desta
correção pontual.

## Neo4j como grafo de conhecimento — a fundação (RN-413/414/415, ADR 0099/0100)
Pedido do dono do produto: Neo4j + `ollama-model-loader` (gemma:1b,
yi-coder:1.5b, nomic-embed-text), inspirado explicitamente no repositório
[ErickWendel/neo4j-ai-experiments](https://github.com/ErickWendel/neo4j-ai-experiments)
— agradecimento registrado no ADR 0099 e em `prompts/README.md`, pela
inspiração concreta do padrão "prompt como arquivo versionado, não string
presa no código" e do grafo como memória de agentes.

Duas responsabilidades, uma fundação: **templates de prompt versionados**
(`PromptTemplate`/`PromptVersion`, idempotente por hash — RN-413) e
**memória relacional** (interações, hipóteses do Psicólogo com evidência,
perfis da Anamnese, handoffs — consumo real é onda futura, esta entrega
só constrói o mecanismo). O grafo é memória DERIVADA, nunca fonte de
verdade; pgvector continua sendo o índice vetorial dos chunks, sem
duplicar embedding em dois bancos. Driver `neo4j-driver` na api (não no
engine) — a api já é dona de toda persistência e do RAG, o engine
consome por HTTP interno com service token, como sempre.

`rag_search` (RN-414) fecha o maior vão do RAG existente: nenhum agente o
consultava, só a aba web "Chat RAG". Tool nova no engine, tetos próprios
(RN-150), degradação sempre visível no início do texto ao modelo.
`ollama-model-loader` (RN-415) fecha um bug real separado: `nomic-embed-text`
nunca era puxado automaticamente e o RAG degradava pra léxico-only em
silêncio em qualquer ambiente limpo.

Primeira leva de templates extraída para `prompts/*.md` (ux-designer,
Psicólogo, Anamnese, sumarização do `ContextManager`).

## Consumo do grafo — templates sem tocar GenServers, relevância sem substituir recência (RN-416/417, ADR 0101)
`InstructionFiles` ganhou fonte `:graph` (`db > graph > dir > root` —
o `instruction_patch` do usuário continua vencendo tudo), e TRÊS agentes
passaram a TENTAR resolver template do grafo antes do texto inline, que
virou fallback obrigatório: ux-designer (`graph_instruction_templates_enabled?`),
Psicólogo e Anamnese (`graph_templates_enabled?`, mesma chave pros
dois). Duas flags, não uma — colidiriam com defaults CONTRÁRIOS entre
frentes paralelas se dividissem a chave; os dois defaults são `false`.
Só `context-manager-summarize` (dos quatro templates da leva) ainda não
tem consumidor.

`Psychologist.ContextBuilder`/`Anamnese.ContextBuilder` ganharam uma
SEGUNDA fonte de contexto — `rag_search`, com query derivada do gatilho
da análise — em COMPOSIÇÃO com a leitura de recentes/janela temporal de
sempre, nunca em substituição: sem hit, o comportamento é idêntico ao de
antes. Os trechos entram no orçamento EXISTENTE de `Triage`, e
`degraded: true` do RAG é sempre visível no contexto, nunca escondido.

O grafo se escreve sozinho: `GraphProjector` (api) drena uma SEGUNDA
linha de outbox (`aggregateType: 'graph_projection'`, mesma transação,
valor que o filtro do engine — `IN ('session', 'task')` — nunca casa,
evitando a corrida com o `Engine.Outbox.Drain` que já drena `'session'`
em ~2s) e chama os casos de uso de gravação já existentes. O engine
NUNCA escreve no grafo direto — preserva o event log como única fonte de
verdade; o grafo é reconstruível por replay.

**Achado real durante a verificação, registrado porque ensina**: o teste
de body limit da RN-412 (`apps/api/test/main.spec.ts`) tinha um bug
LATENTE — `AppModule` importado ESTATICAMENTE no topo do arquivo avalia
`DrizzleModule` (que cria seu pool de conexão em escopo de MÓDULO, não
numa factory do Nest) ANTES do `beforeAll` conseguir apontar
`DATABASE_URL` pra base de teste. Ficou mascarado enquanto a base de dev
local também estava migrada (mesma tabela, então a query "achava" mesmo
apontando pro lugar errado); destravou assim que a base de dev foi
recriada vazia (pelo teste de fumaça real desta própria onda contra
Neo4j+Postgres). Corrigido com `await import(...)` DINÂMICO dentro do
`beforeAll`, depois do `DATABASE_URL` já setado — é o padrão a seguir
sempre que um teste precisa redirecionar `DATABASE_URL` para um
`AppModule` real.

## Runner local — execução na máquina do usuário (RN-418/419/420, ADR 0102/0103)
Pedido do dono do produto: agente rodando na MÁQUINA DO USUÁRIO, na pasta
local do projeto, pelo terminal padrão do usuário — mais terminal
interativo de verdade na aba Code. Duas mudanças, uma dependendo da outra.

**Política (ADR 0102 — decisão GLOBAL, confirmada explicitamente pelo dono
do produto depois de um aviso automático de segurança sobre a mudança)**:
`git push`/PR/deploy (RN-106) e `sudo`/`doas` (novos) saem de `deny`
incondicional e viram TETO ABSOLUTO — `require_approval` incondicional,
no MESMO bloco e MESMO padrão dos tetos vizinhos (`current.policy ===
'auto_approve'`), nunca auto-aprovável por `agent_autonomy`(curinga `"*"`)
nem por `permissions.json`. A fresta que o `deny` original tapava à força
foi fechada na FONTE: `ApproveAlwaysActionUseCase`/`patternForAction`
recusam gravar padrão em `allow` pra ação com efeito externo git ou
comando privilegiado — "sempre permitir" aprova só a instância, nunca o
padrão, pra esses dois casos. Sem essa segunda metade, o teto seria
decorativo. `sudo`/`doas` casam por VERBO em `comandoPrivilegiadoNoComando`
(`external-effect.ts`), varrendo todos os segmentos do comando, mesmo
princípio de `efeitoExternoNoComando`.

**Runner (`apps/runner`, novo workspace Node/TS, ADR 0103)**: CLI
(`brabo-runner --project <id> --dir <pasta> --token brb_...`) que o
usuário roda na própria máquina, conecta no ENGINE via canal Phoenix NOVO
(`/runner`,
tópico `terminal:<projectId>`) autenticado por ticket de USO ÚNICO (mesmo
padrão RN-108, mas ticket EMITIDO PELO ENGINE — schema `"engine"`,
migration própria — e pedido pela api via rota HTTP interna, invertendo o
fluxo do ticket de sessão). Executa `exec` (comando de agente JÁ APROVADO
— o roteamento em `TerminalExecutor` só acontece DEPOIS do pipeline de
`decide()`/`proposed_action` de sempre, nunca antes) no `$SHELL` do
usuário, e um modo PTY interativo pra aba Terminal (`pty_open`/`pty_data`/
`pty_input`/`pty_resize`/`pty_close` — o engine faz RELAY puro, nunca
interpreta os bytes). Só UM runner por projeto (`Engine.Runners.Registry`,
`:global`, exclusividade de `:global.register_name/3`); modo `runner` SEM
workspace verificado ou SEM runner conectado RECUSA explicitamente — nunca
cai no `System.cmd`/bind-mount, que não existe pra um projeto `runner`
(revisado pelo ADR 0104/RN-423, ver acima; o fallback pro caminho de
sempre continua valendo, mas só pra `container`/`mounted`). PTY é ação do
USUÁRIO autenticado, não passa por `proposed_action`, mas audita
(`terminal.session.started`/`ended` no event log, inclusive quando a aba
cai sem `pty_close` explícito).

A fronteira de segurança do runner NÃO é sandboxing — é autenticação
(o CLI apresenta um Personal Access Token da CONTA do usuário) + o
pipeline de aprovação de sempre + o consentimento de o usuário rodar o
CLI na própria máquina, com os privilégios dele. `apps/runner/src/guard.ts`
valida `cwd` dentro da raiz por resolução léxica, mas é declarado
BEST-EFFORT, não a garantia real.

**PAT fechou a lacuna de token de automação (ADR 0105/RN-424..426).** O
achado real da Onda 1 — "o produto não tem mecanismo de token de conta de
LONGA DURAÇÃO pra automação, então o runner replica o login do browser
(cookie/CSRF persistidos em `~/.brabo/runner-credentials.json`)" — foi
fechado na Onda 2: `personal_access_tokens` (`brb_…`, hash HMAC-SHA256+
pepper via `hashDeToken()`, nunca argon2 — errado pra segredo de ALTA
entropia) é emitido em Configurações do projeto, escopado a UM projeto,
revogável, com expiração opcional. `apps/runner/src/auth.ts` perdeu por
completo login interativo, cookies e o arquivo de credenciais — só
valida formato e repassa `--token`/`BRABO_ACCOUNT_TOKEN`, NUNCA gravado
em disco pelo CLI. O PAT nunca autentica fora de
`POST .../runner-ticket`, por CONSTRUÇÃO (`IS_PAT_ROUTE_KEY`/
`@RequirePatAuth()` + `PatAuthGuard`) — nunca um branch no `JwtAuthGuard`
global, que deixaria `RolesGuard` autorizar o PAT pra qualquer rota do
papel do usuário.

**`maintainer` revoga PAT de outro usuário (RN-427)**, fechando o item
que o ADR 0105 tinha declarado fora de escopo por ora (resposta a
incidente — dev desligado com token vazando). Extensão do mesmo modelo,
sem ADR novo: rotas SEPARADAS (`GET .../personal-access-tokens/all`,
`DELETE .../personal-access-tokens/:tokenId/admin`), escopo por
`projectId` em vez de `userId` — a autorevogação de cada usuário
(RN-426) não muda.

`@xterm/xterm`/`@xterm/addon-fit` (web) e `phoenix`/`node-pty` (runner)
são as quatro dependências novas — mesma régua de exceção do `mermaid`
(ADR 0068): `import()` dinâmico, sem `eval`/`new Function` confirmado por
grep no pacote instalado (não é garantia formal contra ofuscação, só
evidência forte — declarado como incerteza, não afirmado como certeza).

**ADR 0104 — Onda 1 CONCLUÍDA (RN-421/422/423):** os ADRs 0072 e 0103
nunca se falaram — RN-170 exigia bind-mount na criação, e o roteamento pro
runner (RN-420) reusava a mesma flag `workspace_mode == 'local'` sem
bind-mount nenhum, então usar o runner de verdade continuava obrigado a
passar pela validação de pasta montada. `workspace_mode` (2 valores) virou
`execution_mode` (`container`/`mounted`/`runner`, migração `0048`) —
RN-170 (agora RN-422) passa a valer só para `mounted`; `runner` nasce com
caminho validado só LEXICAMENTE (sem I/O) e `workspaceVerifiedAt: null`,
promovido a verificado quando um runner conecta e confirma o caminho no
HOST (`POST /internal/projects/:projectId/workspace-verification`, RN-423)
— o runner é a FONTE DA VERDADE do caminho, sobrescrevendo o que foi
digitado no wizard. `Engine.Actions.TerminalExecutor.decisao_de_execucao/1`
ganhou QUATRO saídas: roteia só com workspace verificado E runner
conectado; sem qualquer um dos dois, RECUSA explicitamente — nunca cai no
`System.cmd`/bind-mount de `mounted`, que não existe pra um projeto
`runner`.

**Achado da implementação, corrigindo o ADR (que não é editado — a
correção mora aqui e em
[backlog.md](docs/explanation/backlog.md#backlog-of-the-runnerexecution_mode-adr-0104)):**
a frase do ADR 0104 de que a conversão entre os três modos de projeto
existente "passa a ser permitida sem recriar o projeto" está INCORRETA.
`UpdateProjectDto` continua excluindo `executionMode`/`workspacePath` de
propósito — não é PATCH trivial (worktree, permissions.json e cache do
engine apontam pro escopo antigo). A Onda 1 entregou só o campo de três
valores na CRIAÇÃO; conversão de projeto existente é onda futura, com
desenho próprio, ainda não planejada. Backlog do runner: a Onda 2 (PAT,
ADR 0105) fechou o item que bloqueava `npm publish @brabo/runner`, e a
Onda 3 (ADR 0106) entregou a distribuição em si — `tsup` empacota
`apps/runner` num `dist/index.cjs` único (`node-pty` como `external`
obrigatório, binding nativo), publicado a cada tag final por um workflow
próprio (`publish-runner.yml`), paralelo a `release.yml`. Achado real
testado empiricamente: a guarda de auto-run de `index.ts` precisou de
`realpathSync` em `process.argv[1]` — sem isso, `main()` nunca rodava
quando o CLI era invocado pelo `bin` instalado via `npm install -g`
(symlink, que `process.argv[1]` nunca resolve por realpath mas
`import.meta.url` sempre resolve). Pendência operacional declarada: a
publicação de verdade exige o dono do produto criar o Automation Token do
npm e configurar o secret `NPM_TOKEN` — sem ele, o workflow avisa e pula,
nunca falha. Exclusividade por `{project_id, machine_id}` continua adiada
até segundo dev simultâneo real; `guard.ts` best-effort é invariante
REAFIRMADO, não lacuna. Ver
[ADR 0104](docs/adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)/
[ADR 0105](docs/adr/0105-personal-access-token-do-runner-escopado-por-construcao.md)/
[ADR 0106](docs/adr/0106-distribuicao-do-runner-via-tsup-e-npm-publish.md).

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

## Abas agrupadas, PRs project-wide, pasta local via Runner, carrossel do PO (2026-08-20)
Cinco ondas independentes, rodadas em paralelo por arquivo disputado, vindas
de uso real da tela de projeto — nenhuma planejada de antemão. A sexta onda
do mesmo programa (tradução completa de produto e documentação, i18n) é
maior que as cinco juntas; a FUNDAÇÃO dela (Onda 6a — mecanismo, sem
tradução de conteúdo ainda) já fechou: `react-i18next`+`i18next` na web
(`en` virou idioma default do app, `pt-BR` mantido — RN-425), coluna
`locale` em `users` embutida no payload de login/refresh, `AccountPage`
nova (`/account`) provando o mecanismo, e Docusaurus com
`i18n.defaultLocale: 'en'`/`locales: ['en', 'pt-BR']` — o snapshot pt-BR
atual de `docs/` já está preservado em
`website/i18n/pt-BR/docusaurus-plugin-content-docs/current/`. A Onda 6b
(extração em massa da interface + tradução de `docs/`) avançou bastante em
2026-08-22, em quatro frentes paralelas — ver CHANGELOG.md (Unreleased/
Documentação) para o detalhe de cada uma — mas AINDA NÃO fechou: faltam
`docs/business-rules.md` (só o front-matter foi traduzido; o corpo, com
centenas de RNs, continua 100% em português — é o maior arquivo da doc
inteira e cresce mais rápido do que dá pra traduzir de passagem) e uma
fatia residual de componentes `.tsx` menores. Quando fechar de verdade,
esta seção ganha o resumo final e o restante do CLAUDE.md (Stack,
"Documentação") é revisado por completo para registrar inglês como idioma
primário de verdade.

- **Régua de abas agrupada**: 11 abas soltas viraram 6 no topo — Visão
  geral, **Agentes ▾** (Executores, Criativo, Chat, Insights), **Dev ▾**
  (Código, PRs, Aprovações), **Documentação ▾** (Backlog, Arquitetura),
  Gastos, Configurações — via `GroupedTabs` novo (`apps/web/src/components/
  ui/GroupedTabs.tsx`), construído POR CIMA do `Tabs` genérico, que
  continua sem grupo pras outras telas. `ChaveDeAba` continua flat — só a
  apresentação ficou agrupada, pra não mexer no deep-link `?tab=`. Chat e
  Chat RAG viram UMA aba (`ProjectChatShell.tsx`) com controle segmentado
  interno ("Conversar"/"Buscar") — a distinção de negócio entre os dois
  (RN-202: conversar ativa agente e gasta a chave do owner por turno; RAG é
  leitura sobre índice, sem agente) não mudou, só o contêiner de UI.
- **Aba PRs, project-wide**: `ProjectApprovalsTab` escopava "PRs em
  revisão" à sessão mais recente — a revisão de uma PR de sessão anterior
  sumia da tela assim que uma sessão nova propunha outra. A aba `prs` nova
  lista direto do provider de git (nunca por sessão) e cruza com
  `proposed_action` pendente via `findPendingByProject`, novo, ao lado do
  método já existente escopado por sessão — decisão usa o `sessionId` da
  PRÓPRIA ação, nunca `latestSession` (RN-423). É a primeira produtora real
  de `git_merge` pela UI; a trava de branch protegida (RN-154) continua
  absoluta e intocada — botão "Merge" só PROPÕE, a aprovação humana
  continua sendo o único jeito de executar.
- **Aba Arquitetura**: extraída da Visão Geral (module_map, diagrama C4,
  ADRs, pendências), que fica com um resumo condensado + link. Primeiro
  lightbox do design system — `Modal` ganhou `size="full"` — pra ampliar o
  diagrama C4 (SVG, sem perda de qualidade) (RN-424).
- **Navegação de pasta local via o Runner (RN-422, ADR 0104)**: revisa a
  ADR 0072 (que tinha recusado seletor de pasta explicitamente) SEM
  editá-la — a navegação existe, mas pelo Runner, que já roda com o
  privilégio real do usuário na máquina dele, nunca pela api enumerando o
  filesystem do container. Dois eventos novos no canal já existente
  (`fs_list_dir`/`fs_home_dir`), relay puro do engine, mesmo padrão do PTY.
  `FolderBrowserModal` funciona onde o projeto já existe. Na criação
  (`NewProjectWizard.tsx`), o gap ficou declarado até o ADR 0108: no modo
  `mounted` o projeto ainda só nasce na confirmação (a validação de caminho
  toca disco ali), mas no modo `runner` "Procurar pasta..." passa a criar o
  projeto ANTECIPADAMENTE — reusado por snapshot de identidade em vez de
  duplicado a cada clique — pra poder ancorar o ticket do canal antes da
  confirmação (RN-437, ADR 0108). `RunnerOnboardingPanel` novo
  (compartilhado com a aba Terminal) substitui o `<code>` cru de antes.
  `apps/runner` ganhou README — publicar de verdade no npm/empacotar
  binário assinado continua fora do escopo, declarado no README.
  O explorador de pasta em si virou três colunas (atalhos, lista com um
  clique seleciona/duplo clique entra, painel de detalhes — RN-436),
  seguindo a referência visual do dono do produto.
- **Bug do carrossel do PO corrigido (RN-421)**: a leva de promoções
  pendentes dependia de scan sobre os últimos 200 eventos
  (`useSessionEvents`) — numa sessão longa, a proposta saía da janela e o
  carrossel degradava pra card único ou sumia. Mesma classe de bug que a
  RN-180 já tinha corrigido pra `ContextAside`; a fonte agora é
  `useBacklog` (completo, sem janela), com fallback por história quando o
  backlog ainda não respondeu.

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
  interativo (`node-pty`, único `external` — binding nativo) — ver
  "Runner local" (ADR 0103). Publicado como `@brabo/runner` via `tsup` +
  `npm publish` (ADR 0106)
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
  `decide()`. Tetos continuam absolutos MESMO com auto mode ligado, e não
  têm exceção configurável em lugar nenhum — merge em branch protegida,
  `instruction_patch`, `parallelize`/`raise_max_parallel` (RN-154), e o
  teto de efeito externo/comando privilegiado — git push/PR/deploy e
  sudo/doas — que revisou a RN-106 (RN-418, ADR 0102): antes era `deny`
  incondicional, agora é `require_approval` incondicional, com a mesma
  garantia de nunca ser auto-aprovável; "sempre permitir" foi fechado na
  fonte pra esse teto não virar decorativo (`ApproveAlwaysActionUseCase`
  recusa gravar padrão pra esses comandos).
- O projeto escolhe ONDE o código mora, na criação (RN-169/RN-421/RN-422,
  ADR 0072/0104): `container` (DEFAULT — a pasta gerenciada em
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
  (`project_containers`, ADR 0081, RN-243..248) — mas nenhuma linha dela
  chama Docker: provisionar/reciclar/limpar DE VERDADE ainda não existe,
  então a política de terminal do ADR 0055 (escopo de caminho, allowlist
  estreito) segue valendo como está até o container subir de verdade.
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
  linha; teto esgotado é narrado, nunca silêncio; e o agente não anuncia
  ação que o código não vá executar — o que se promete é decidido pelo
  teto, nunca por texto fixo (RN-163). O Staff é o único SEM `kickoff/1`
  — sobe e fica ocioso até a primeira `user_message`, porque não há
  artefato de sessão para sintetizar uma abertura (ADR 0088).
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