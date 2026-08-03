# Changelog

Gerado dos conventional commits por `scripts/changelog.mjs`.

## Unreleased

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

- **api**: Ollama e Anthropic passam a declarar `listModels` e a ter o catálogo
  descoberto pelo sync — o backlog que o ADR 0042 deixou aberto. Os dois
  formatos foram verificados na doc oficial antes de uma linha de código: o
  Anthropic pagina **por cursor** (`has_more`/`last_id`, percorrido pela
  auto-paginação do SDK oficial) e o Ollama lê `GET /api/tags` no host de
  `OLLAMA_HOST`. Nenhum dos dois informa preço, então o modelo entra no catálogo
  **sem preço** em vez de com preço inventado

### Correções

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
