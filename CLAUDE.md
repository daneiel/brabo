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
100% do event log que a tela já busca. Ativos abrem sozinhos; quem terminou
nasce fechado. O feed cronológico continua, na coluna de atividade: ele
responde "o que aconteceu", a árvore responde "quem está fazendo o quê".

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

### FASE 16 — Fundações (destravar o paralelismo)
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
   regra `warn` no docmap — hoje ele tem ZERO cobertura.

### FASE 17 — As 8 telas conforme o handoff
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

### FASE 18 — A área existe no banco (defeito, corrigido antes)
10. `AgentAreaRepository.upsert` não tem NENHUM chamador, então quatro casos
    de uso operam sobre tabela vazia. Provisionar na criação do projeto +
    backfill, com teste que prova que projeto recém-criado TEM áreas — é a
    mesma falha da FASE 14d: testar a peça não é testar o caminho até ela.
11. Colapsar as TRÊS cópias da lista de áreas (api, web, engine) em uma fonte.

### FASE 19 — Aprovação que se lê
12. Matar o fallback genérico do `ApprovalCard`, que despeja
    `chave: JSON.stringify(valor)` — a causa provável do "difícil de ler".
    Todo tipo ganha FRASE em pt-BR; tipo sem frase mostra verbo + "ver
    detalhes" e o payload cru nasce COLAPSADO, nunca despejado.
13. Colapso nos TRÊS lugares: Aprovações, Insights e o card no chat, com verbo
    e frase saindo de UM módulo.
14. Restrição de projeto: o colapso NÃO introduz prop nova obrigatória em
    `ApprovalCard`. É isso que mantém `SessionPage.tsx` intocado e tira a
    aresta com a FASE 20.

### FASE 20 — A sessão ganha identidade
15. `sessions` ganha `kind` e `name` na MESMA migration — duas migrations
    sobre a mesma tabela colidem no journal e nos snapshots.
16. Reconciliar com a derivação por evento: `kind` classifica a INTENÇÃO de
    criação, `execution.activated` continua classificando ESTADO de execução,
    e nenhum reescreve o outro. `execution.activated` em sessão consultiva é
    erro explícito, não conversão silenciosa.
17. Renomear preservando a hashtag; sem nome, degrada para ela sozinha.
18. Botão de voltar ao dashboard — hoje `SessionPage.tsx` não importa `Link`
    nem `useNavigate`, e NENHUMA navegação sai da tela.

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

### FASE 23 — Modelo herdável por área
25. Escopo `area` na cascata de binding, entre `agent` e `project`.
26. Incoerência a resolver ANTES de codar: o binding de agente é GLOBAL por
    decisão intencional, e área é por projeto. Ou o binding de agente passa a
    ser por projeto, ou a área fica abaixo dele — e isso contraria "padrão
    herdável". Decisão de produto, com ADR.
27. A UI mostra quem HERDA e quem DIVERGIU; voltar a herdar é APAGAR o binding
    do agente, não gravar o modelo da área nele. Papel mínimo `maintainer`,
    pelo mesmo motivo do teto de paralelismo: mudar o modelo é decidir gasto.

### FASE 24 — Chat e Criativo como lugares
28. Duas abas na tela de PROJETO, cada uma listando as sessões do seu `kind`.
    A Sessão continua tela própria — a aba não vira contêiner de chat.
29. Colisão de produto: a aba "Sessões" já existe. Ou ela sai, ou o produto
    ganha três entradas para a mesma lista.

### FASE 25 — Container por projeto (a fronteira deixa de ser só política)
A maior mudança arquitetural do programa, e a que paga a dívida que as Fases B
e F já apontavam separadamente.
30. O ARQUITETO decide qual imagem sobe para o projeto, como artefato dele —
    versionado e auditável, não configuração escondida. Enquanto ele não
    decidir, o container não sobe e a aba Code não libera.
31. Ciclo de vida por projeto (provisionar, reciclar, limpar, teto de
    recursos), com o worktree do agente vivendo dentro do container.
32. DENTRO, o agente é livre — e é isto que fecha os achados Z e AD, o
    allowlist de verbos que não converge porque verbo, forma e invocação são
    espaços distintos. FORA continua humano: `git push`, PR e deploy nascem
    `proposed_action`, e merge em protegida segue manual (RN-014). Rede e
    gasto merecem veredito próprio: sair para a internet não é "dentro".

### FASE 26 — Code, só leitura
33. `GitProviderContract` não tem `listTree` nem diff de PR. Entram como
    capability, declarada SÓ quando provada pela suite, e método de contrato
    sem chamador reprova o CI.
34. Superfície de leitura contida pela checagem CENTRALIZADA da RN-092, não
    por validação nova em cada rota. Buscar em repositório grande GASTA: teto
    e cache, senão a aba vira amplificador de tráfego.
35. A UI conforme `Brabo Code.dc.html`. Destaque de sintaxe é dependência
    nova — não instalar sem justificar. Terminal INTERATIVO só depois da 25.

**Congelamento do programa:** cada fase declara o que não faz, e o mais duro é
o da 26 — SÓ LEITURA de código, nenhum salvamento pela aba. A edição é fase
seguinte, e quando vier, escrita é efeito externo: nasce `proposed_action`.

## Stack (decidida — não proponha alternativas)
- `apps/api`: NestJS 11 + Drizzle ORM + PostgreSQL 16 + pgvector
- `apps/engine`: Elixir/OTP + Phoenix (canais) + Oban (filas no Postgres)
- `apps/web`: React 19 + Vite + TanStack Query/Router
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
- Branches permanentes: dev, qa, main — um branch, um ambiente.
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
- Agentes rodam SEMPRE dentro de um Harness; nenhuma chamada de LLM ou
  ferramenta fora dele.
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
- O produto NUNCA sobrescreve configuração de repositório do usuário
  (proteções, branches) sem plano aprovado explicitamente (regra da
  FASE 12, origem no ADR 0028).
- Commits de agentes usam identidade "<agente>[bot]" com o usuário
  como co-author.
- Todo desfecho de falha de agente registra a ORIGEM da falha
  (infra | modelo | código | política) — nunca diagnóstico por
  eliminação (lição do ADR 0020). Falha NUNCA vira resposta vazia no
  event log, e o motivo NUNCA fica só em broadcast: `agent.error` é
  durável e o agente diz o que houve no fio (RN-059).
- A chave de LLM que um agente gasta é a do OWNER do workspace
  (RN-058); o relatório desse gasto é do owner e só dele (RN-060). O
  membro vê o PRÓPRIO consumo por ATOR, em tokens e custo estimado, e
  NUNCA quebrado por provider ou credencial — as duas leituras respondem
  perguntas diferentes e nenhuma é recorte da outra (RN-101/ADR 0063).
- Métrica de execução de agentes é extraída do event log/token_usage
  por script, nunca anotada manualmente (lição da Fase 10/13).
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
- Não corrigir de passagem os 19 achados abertos, hoje em
  docs/explanation/achados-execucao-real.md — cada um espera a fase que
  o endereça, e corrigir fora dela apaga a evidência de por que existia
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