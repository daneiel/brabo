---
id: configuration
title: Configuração
sidebar_label: Configuração
sidebar_position: 1
description: Todas as variáveis de ambiente da api, do engine e da web, com default e o que quebra quando estão erradas.
keywords: [configuração, variáveis de ambiente, env, deploy]
---

# Configuração

Toda a configuração é por **variável de ambiente**. Não há arquivo de config da
aplicação — o que existe é o `permissions.json`, que é política de projeto, não
configuração de processo.

Dois arquivos versionados são lidos em runtime e não são configuração, embora
seja fácil confundi-los com ela: o `permissions.json` acima, e `docs/gates.yml`
([ADR 0054](../adr/0054-gates-como-registro-declarativo.md)), o registro
declarativo de gates. Nenhum dos dois tem variável de ambiente para apontar
caminho — o registro é encontrado subindo de `__dirname` — e nenhum muda
comportamento por edição em produção: o registro DESCREVE os gates, não os
aplica. Ele viaja dentro da imagem da api; ver
[runbook](../runbook.md#registro-de-gates).

Os defaults abaixo foram extraídos do código, não de documentação anterior. A
coluna **quando dá errado** é a parte que economiza tempo: quase toda variável
tem um default que funciona em desenvolvimento e um modo de falha específico em
produção.

> **Defaults de desenvolvimento são inseguros de propósito.** Valores como
> `dev-master-key-change-me` existem para o `pnpm dev` subir sem cerimônia. Em
> produção eles precisam ser trocados — e seis deles o processo **recusa**
> subir sem trocar (api ou engine, marcados com 🔒). Cinco seguem o padrão do
> [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md)/[RN-093](../business-rules.md#rn-093):
> ausente, com o literal público de exemplo, ou curto demais derruba o boot.
> Ver [RN-114](../business-rules.md#rn-114) para os quatro que se juntaram ao
> `GIT_OAUTH_STATE_SECRET` original.

## api

### Essenciais

| variável | default | quando dá errado |
|---|---|---|
| `DATABASE_URL` | `postgres://brabo:brabo@localhost:5432/brabo` | sem ela nada sobe |
| `PORT` | `3000` | — |
| `NODE_ENV` | — | `production` liga as validações estritas de CORS e chave |
| `API_PUBLIC_URL` | `http://localhost:3000` | usada nos callbacks de OAuth de git; errada = callback quebrado |
| `ENGINE_URL` | `http://localhost:4000` no código, `http://engine:4000` no Compose | comandos síncronos api→engine falham. **Deixe-a vazia no `.env`**: definida ali, ela vence o default do Compose e a api tenta falar com `localhost:4000` de dentro do próprio container — toda ativação de sessão morre em `ECONNREFUSED` e o front não sai do lugar. Cada ambiente já tem o default certo sem a linha |
| `BRABO_VERSION` | `dev` | vira `service.version` no recurso OpenTelemetry — é como se sabe qual build gerou um trace. A imagem de release injeta a tag via `ARG` do `docker-bake.hcl`; fora do release fica `dev`. **Não** aparece no `/health`, que não devolve versão de propósito (ver o `description` da rota) |
| `MIGRATIONS_FOLDER` | `./src/db/migrations` | — |

### Segurança 🔒

| variável | default | quando dá errado |
|---|---|---|
| `CREDENTIALS_MASTER_KEY` 🔒 | `dev-master-key-change-me` **só fora de produção** | embrulha os DEKs. **Em produção a api recusa subir** ausente, com o default acima (público — está no `.env.example`) ou com menos de 16 caracteres (RN-114). Isso é só a checagem de BOOT: trocar por uma chave **válida, mas diferente**, sem re-embrulhar, ainda torna toda credencial ilegível sem erro nenhum — a falha aparece no primeiro uso. Ver [rotação](../runbook.md#rotacao-da-chave-mestra) |
| `CREDENTIALS_MASTER_KEY_PREVIOUS` | — | só durante a rotação. Presente = a api tenta a chave anterior quando a atual falha |
| `GIT_OAUTH_STATE_SECRET` 🔒 | `dev-oauth-state-secret-change-me` **só fora de produção** | assina o `state` do OAuth; fraco = CSRF no fluxo de conexão de git. **Em produção a api recusa subir** sem ela, com o default acima (que é público — está no `.env.example`) ou com menos de 16 caracteres. Gere com `openssl rand -base64 32`. Ver [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md) e [RN-093](../business-rules.md#rn-093) |
| `WEB_ORIGIN` 🔒 | `http://localhost:${WEB_PORT}` | **em produção a api recusa subir** se estiver ausente ou for `*`. CORS é estrito por ambiente. **A porta faz parte do valor**: a web em `:5174` é outra origem e é barrada — ver [ADR 0037](../adr/0037-cors-do-engine-e-a-porta-como-contrato.md). Nos composes o default **deriva de `WEB_PORT`**, então mudar a porta leva o CORS junto; definir `WEB_ORIGIN` à mão sobrepõe a derivação e volta a ser sua responsabilidade mantê-la coerente |
| `WEB_PORT` | `5173` (dev) · `8088` (prod) | porta publicada do web no host. Não é lida por nenhum serviço — ela **alimenta o default de `WEB_ORIGIN`** nos composes, e é isso que impede porta e CORS de divergirem |

### Auth first-party

O auth no domínio da api, que desde o corte é também o único emissor. Decisões
em [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) e
[ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md).

| variável | default | o que faz |
|---|---|---|
| `AUTH_JWT_SECRET` 🔒 | `dev-auth-jwt-secret-change-me` **só fora de produção** | passphrase de onde o par Ed25519 do access token é **derivado** por scrypt — nenhuma chave privada é commitada. **Em produção a api recusa subir** ausente, com o default acima (público — está no `.env.example`) ou com menos de 16 caracteres (RN-114) |
| `AUTH_JWT_SECRET_PREVIOUS` | — | aceita **só na verificação**, durante a rotação; entra no JWKS e nunca assina |
| `AUTH_TOKEN_PEPPER` | `AUTH_JWT_SECRET` | chave HMAC do hash dos tokens opacos e da chave do balde de lockout |
| `AUTH_ACCESS_TOKEN_TTL_MS` | `900000` | 15 min |
| `AUTH_REFRESH_TOKEN_TTL_MS` | `1209600000` | 14 dias |
| `AUTH_REFRESH_ABSOLUTE_TTL_MS` | `2592000000` | teto absoluto da família, contado do login — sem ele a rotação dá sessão eterna |
| `AUTH_REGISTRATION_ENABLED` | `true` | qualquer valor diferente de `"false"` mantém o cadastro aberto |
| `AUTH_LOCKOUT_ENABLED` | `true` | mesma convenção |
| `AUTH_LOCKOUT_WINDOW_MS` | `900000` | janela deslizante da contagem |
| `AUTH_LOCKOUT_THRESHOLDS` | `5:30,8:300,12:900` | escada do balde de e-mail, `falhas:segundos` |
| `AUTH_LOCKOUT_IP_THRESHOLDS` | `20:30,30:120` | escada do balde de IP, mais permissiva e com teto curto |
| `AUTH_EMAIL_TOKEN_TTL_MS` | `172800000` | verificação de e-mail, 48 h |
| `AUTH_RESET_TOKEN_TTL_MS` | `3600000` | reset de senha, 1 h |
| `AUTH_SET_PASSWORD_TTL_MS` | `604800000` | definição da primeira senha (usuário migrado), 7 dias — mais longo que o reset porque quem recebe não pediu |
| `AUTH_IP_ATTEMPT_THRESHOLD` | `60` | teto de tentativas por IP nas rotas de auth |
| `AUTH_MAIL_LOG_TOKENS` | `false` | **só em dev**: imprime o token de verificação/reset no log |

> **O teto da escada de e-mail é igual à janela de propósito.** Com janela
> deslizante, quem insiste empurra a janela junto e fica bloqueado enquanto
> insistir; quem parou volta com a janela limpa. Um teto **maior** que a janela
> criaria um bloqueio que ela não consegue representar, e exigiria uma coluna
> `locked_until` persistente com fila de destrava. Não mexa em um sem o outro.

> **Rotacionar `AUTH_TOKEN_PEPPER` desloga todo mundo** e invalida os tokens de
> verificação e reset em aberto. Diferente das chaves, o pepper **não** tem
> `_PREVIOUS`. Ver o [runbook](../runbook.md).

### SMTP real (MailSender)

`MailSender` envia e-mail de verdade só quando `MAIL_TRANSPORT=smtp` — o
default é `log` (link/token vão para o log da api, `AUTH_MAIL_LOG_TOKENS`
acima), inclusive em produção: enviar e-mail é opt-in do operador. Decisão
no [ADR 0096](../adr/0096-smtp-real-no-mailsender.md).

| variável | default | o que faz |
|---|---|---|
| `MAIL_TRANSPORT` | `log` | `log` (default) ou `smtp`. Qualquer outro valor cai em `log` |
| `SMTP_HOST` 🔒 | — | host do provedor SMTP. **Só quando `MAIL_TRANSPORT=smtp`**: em produção a api recusa subir ausente, só espaços ou com o valor de exemplo publicado no `.env.example` (RN-114) |
| `SMTP_PORT` | `587` | porta do provedor — `587` é STARTTLS, `465` é TLS implícito (`SMTP_SECURE=true`) |
| `SMTP_SECURE` | `false` | `true` liga TLS implícito na conexão (tipicamente porta 465) |
| `SMTP_USER` 🔒 | — | usuário de autenticação SMTP. Mesma exigência de `SMTP_HOST` em produção |
| `SMTP_PASSWORD` 🔒 | — | senha/token de autenticação SMTP. Mesma exigência de `SMTP_HOST` em produção — **nunca aparece em log** |
| `SMTP_FROM` | — | remetente, formato `"Nome <email@dominio>"` (ou só o e-mail). Mesma exigência de `SMTP_HOST` em produção, mais validação de formato |

> O corpo do e-mail é **texto puro**, sem HTML — a porta `MailSender` não
> carrega estrutura para corpo rico, e um template engine seria superfície de
> injeção sem ganho nenhum. O link usa `WEB_ORIGIN` (acima).

### Seed de desenvolvimento

Consumidas por `pnpm --filter api seed`, não pela api em execução. Sem IdP
externo, é daqui que sai a credencial para entrar na web local e para o smoke.

| variável | default | o que faz |
|---|---|---|
| `BRABO_SEED_PASSWORD` | `brabo12345678` | senha dos usuários semeados (`owner@brabo.dev`, `dev@brabo.dev`), criados com e-mail **já verificado** |
| `BRABO_FORCE_SEED` | — | destrava o seed com `NODE_ENV=production`, onde ele **recusa rodar** por default. Não defina em ambiente real: a conta nasce com senha conhecida e verificada |

> O seed é idempotente e **não mexe na senha** de quem já existe. Rodar de novo
> depois de alguém ter trocado a própria senha não a reverte.

### Rate limit

Janela deslizante em Postgres — não há Redis
([ADR 0027](../adr/0027-fase5-backup-hardening-release.md)).

| variável | default | o que faz |
|---|---|---|
| `RATE_LIMIT_ENABLED` | `true` | qualquer valor diferente de `"false"` mantém ligado |
| `RATE_LIMIT_WINDOW_MS` | `60000` | tamanho da janela |
| `RATE_LIMIT_USER` | `300` | requisições por usuário por janela |
| `RATE_LIMIT_IP` | `600` | requisições por IP por janela |

> Se a tabela de rate limit estiver indisponível, a requisição **passa**. O
> guard protege contra abuso, não contra acesso indevido — quem faz isso é o
> guard de autenticação, que roda antes.

### Tráfego interno 🔒

O segredo compartilhado que autentica api ↔ engine. **A mesma variável nos dois
lados** — cada um envia o atual e aceita ambos, e é isso que torna a rotação
possível sem downtime ([RN-035](../business-rules.md#rn-035)).

| variável | default | o que faz |
|---|---|---|
| `BRABO_SERVICE_TOKEN` 🔒 | `dev-service-token-change-me` **só fora de produção** | vai no cabeçalho `X-Brabo-Service-Token` e é o que o `EngineServiceGuard` compara em tempo constante. **Em produção a api recusa subir** ausente, com o default acima (público — está no `.env.example`) ou com menos de 16 caracteres (RN-114) |
| `BRABO_SERVICE_TOKEN_PREVIOUS` | — | aceito **só na verificação**, durante a rotação |

> Definir só o valor NOVO de um lado (sem passar pela dança do `_PREVIOUS`)
> não quebra o boot de ninguém: o sintoma é `403` no `/internal/*` e `401` nas
> chamadas da api para o engine. Procedimento no
> [runbook](../runbook.md#rotacao-das-chaves-do-auth). A checagem de BOOT
> acima (RN-114) é outra coisa: ela reprova só o default público ou uma
> variável ausente/curta, não uma divergência entre os dois lados.

### Git

| variável | default | nota |
|---|---|---|
| `GIT_LOCAL_REPOS_ROOT` | `/tmp/brabo-git-repos` | provider Local. Em `/tmp` os repos somem no reboot |
| `PROJECT_WORKSPACES_ROOT` | `/tmp/brabo-project-workspaces` | worktrees dos agentes de projeto no modo **Container**. **Precisa ser o mesmo caminho no engine**, e o mesmo volume |
| `GITHUB_OAUTH_CLIENT_ID` / `_SECRET` | vazio | vazio = conexão GitHub por OAuth indisponível (PAT continua) |
| `GITLAB_OAUTH_CLIENT_ID` / `_SECRET` | vazio | idem |

#### Projeto no modo Local: não é variável, é montagem

Desde o [ADR 0072](../adr/0072-projeto-local-ou-container.md), um projeto pode
nascer no modo **Local** — o código mora numa pasta do usuário, de caminho
absoluto livre, e `PROJECT_WORKSPACES_ROOT` **não participa** da raiz dele.

Isso NÃO tem variável de ambiente: o caminho é dado do projeto
(`projects.workspace_path`), escolhido na criação. O que o AMBIENTE precisa
oferecer é a montagem — a mesma pasta, no **mesmo caminho absoluto**, dentro dos
containers da `api` e do `engine`:

```yaml
# docker/docker-compose.yml — nos DOIS serviços
    volumes:
      - /home/voce/projetos/loja:/home/voce/projetos/loja
```

Montar só num dos dois produz um projeto que a api aceita e o engine não
enxerga: a validação da criação ([RN-170](../business-rules.md#rn-170)) confere
o que a **api** vê, e ela não tem como saber o que está montado no outro
container. Sem montagem nenhuma, a criação é recusada com 400 e a mensagem traz
a linha acima — ver [runbook](../runbook.md#projeto-no-modo-local).

### LLM

| variável | default | nota |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | — |
| `OLLAMA_REQUEST_TIMEOUT_MS` | `300000` | teto de **inatividade** do socket do Ollama, não de duração total. Modelo local tem outra ordem de grandeza de latência até o primeiro token, por isso env própria; ver [ambiente de inferência](../runbook.md#ambiente-de-inferencia) |
| `LLM_REQUEST_TIMEOUT_MS` | `300000` | o mesmo teto de inatividade para os providers de API (OpenAI e compatíveis, Anthropic). Vale para "não mandou nem os headers" e para "parou de mandar chunks no meio do stream" — ver [providers de LLM](llm-providers.md#teto-de-inatividade) |

### Grafo de conhecimento (ADR 0099)

| variável | default | nota |
|---|---|---|
| `NEO4J_URI` | — | ex.: `bolt://localhost:7687`. Ausente ou parcial (junto com `NEO4J_USER`/`NEO4J_PASSWORD`) fora de produção = grafo DESLIGADO, rotas dependentes degradam (`GraphUnavailableError`/503) — ninguém precisa de Neo4j local só para rodar a suite. Em produção, ausência de qualquer uma das três derruba o boot |
| `NEO4J_USER` | — | ver `NEO4J_URI` |
| `NEO4J_PASSWORD` 🔒 | — | ver `NEO4J_URI`. Sem default público de propósito — não há um "valor de exemplo" plausível pra uma senha de banco |
| `GRAPH_PROJECTOR_INTERVAL_MS` | `2000` | período do poller que drena a fila `graph_projection` da outbox e escreve handoffs/hipóteses/perfis/interações no grafo (RN-416) |

### Observabilidade

| variável | default | nota |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | **ausente desliga a EXPORTAÇÃO, não a instrumentação** (ADR 0035). Span continua sendo criada e o `trace_id` continua no log — é o que dá correlação em desenvolvimento, sem coletor. Sem ela, a span é descartada no fim em vez de sair do processo |
| `OTEL_SERVICE_NAME` | `brabo-api` | — |
| `OTEL_DIAG_LOG` | — | `1` liga o log de diagnóstico do próprio OTel |
| `LOG_LEVEL` | `info` em produção, `debug` fora | também decide o FORMATO junto com `NODE_ENV`: fora de produção o log sai legível (pino-pretty em processo, com a árvore de camadas); em produção, uma linha de JSON por evento |
| `METRICS_GAUGE_INTERVAL_MS` | `15000` | período de coleta dos gauges de domínio |

---

## engine

### Essenciais

| variável | default | quando dá errado |
|---|---|---|
| `DATABASE_URL` | `ecto://brabo:brabo@localhost:5432/brabo` | note o esquema `ecto://`, não `postgres://` |
| `POSTGRES_HOST` / `_USER` / `_PASSWORD` | `localhost` / `brabo` / `brabo` | usados quando a `DATABASE_URL` não é montada |
| `POOL_SIZE` | — | pool esgotado trava o Oban e a fila para de ser consumida |
| `PORT` | `4000` | — |
| `PHX_HOST` / `PHX_SERVER` | — | `PHX_SERVER=true` é o que faz o release servir HTTP |
| `SECRET_KEY_BASE` 🔒 | — | obrigatória no release (`runtime.exs`, bloco `:prod`, `raise` padrão do Phoenix). Até RN-114, o `docker-compose.prod.yml` supria um literal público como fallback e mascarava esse `raise` — a variável chegava sempre DEFINIDA. O `raise` em si não mudou |
| `API_URL` | `http://localhost:3000` | o engine chama a api de volta por aqui |
| `ECTO_IPV6` | — | — |
| `SKIP_MIGRATIONS` | — | usada pelo Job de migração |

### Cluster e shutdown

| variável | default | nota |
|---|---|---|
| `DNS_CLUSTER_QUERY` | — | o Service headless que forma o cluster Erlang. **Sem ele cada réplica é uma ilha** e todo rollout drena tudo |
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | `45000` | janela do `preStop`. Sobe **junto** com `terminationGracePeriodSeconds`, nunca sozinha |
| `SESSION_HEARTBEAT_TIMEOUT_MS` | `30000` | — |
| `RELEASE_NAME` / `RELEASE_NODE` | — | identidade do nó na distribuição |

### Harness

| variável | default | nota |
|---|---|---|
| `TOOL_LOOP_MAX_ITERATIONS` | `8` | teto de voltas do laço para o agente **conversacional**. Esgotado, o agente encerra com artefato de bloqueio |
| `TOOL_LOOP_MAX_ITERATIONS_EXECUCAO` | `60` | teto dos **dev agents**. Maior porque eles exploram o repositório antes de escrever — e porque o `task_budget_micros` segura o gasto por baixo |
| `TOOL_LOOP_MAX_ITERATIONS_GATE` | `60` | teto dos subagentes de **QA**, pelo mesmo motivo |
| `DEFAULT_CONTEXT_WINDOW` | `8192` | usado quando o modelo não declara a janela |
| `CONTEXT_COMPACTION_THRESHOLD` | `0.7` | fração da janela que dispara compactação |
| `LLM_TURN_TIMEOUT_MS` | `300000` | 5 min por turno |
| `TERMINAL_ACTION_TIMEOUT_MS` | `15000` | teto de um comando de terminal |
| `TERMINAL_OUTPUT_MAX_BYTES` | `32768` | teto de BYTES da saída de um comando ([RN-074](../business-rules.md#rn-074)). A saída fica no histórico do laço e viaja em todo turno seguinte; sem teto, um `find` numa árvore grande derruba a execução inteira com `413` do provider |
| `READ_FILE_MAX_BYTES` | `32768` | teto de BYTES do conteúdo lido por `read_file` ([RN-141](../business-rules.md#rn-141)) — mesma classe de estouro da RN-074, pela porta do `read_file` em vez do terminal; variável independente, mesmo valor por coincidência de contexto |
| `SEARCH_WORKSPACE_MAX_BYTES` | `32768` | teto de BYTES do texto final de `search_workspace` ([RN-150](../business-rules.md#rn-150)) — mesma classe de estouro da RN-074/RN-141, pela porta da busca; variável independente |
| `SEARCH_WORKSPACE_MAX_HITS` | `500` | teto de QUANTIDADE de hits que `search_workspace` coleta antes de montar a resposta ([RN-150](../business-rules.md#rn-150)) — para de escanear/ler conteúdo assim que atinge o teto, evitando pagar I/O de uma árvore com hit demais só para depois truncar por bytes |
| `SECOPS_SCAN_TIMEOUT_MS` | `180000` | 3 min para o scanner do SecOps |
| `TRANSPORT_MAX_BODY_BYTES` | `8388608` (8 MiB) | teto de TRANSPORTE que a compactação de contexto respeita além da janela do modelo ([RN-412](../business-rules.md#rn-412)) — a janela efetiva é `min(context_window, este teto convertido em tokens)`, pra a compactação disparar ANTES do corpo estourar o limite HTTP da api, não só quando o modelo "esqueceria" |
| `GRAPH_INSTRUCTION_TEMPLATES_ENABLED` | `false` | liga a fonte `:graph` de `InstructionFiles` — hoje só a identidade do ux-designer resolve template do grafo antes do texto inline (RN-413). Nome PRÓPRIO, não `GRAPH_TEMPLATES_ENABLED` abaixo — as duas colidiriam com defaults contrários se dividissem a chave |

### Psicólogo

| variável | default | nota |
|---|---|---|
| `PSYCHOLOGIST_ENABLED` | `false` | pausa GLOBAL de rodada NOVA (automática e sob demanda) — decisão de produto do usuário em 2026-08-10, não bug, mesmo padrão de `ANAMNESE_ENABLED` abaixo. Não apaga nada do que já existe. Ligar exige reiniciar o engine ([RN-117](../business-rules.md#rn-117)) |
| `PSYCHOLOGIST_TRIAGE_THRESHOLD` | `20` | eventos na sessão que separam análise **leve** de **pesada** |
| `PSYCHOLOGIST_MAX_ITERATIONS_LEVE` / `_PESADA` | `4` / `8` | — |
| `PSYCHOLOGIST_BUDGET_MICROS_LEVE` / `_PESADA` | `50000` / `300000` | USD 0,05 e USD 0,30 por análise |
| `PSYCHOLOGIST_MAX_PROMPT_EVENTS_LEVE` / `_PESADA` | `50` / `400` | quantos eventos entram no prompt |
| `PSYCHOLOGIST_MAX_PAYLOAD_CHARS` | `600` | truncagem do payload de cada evento |
| `PSYCHOLOGIST_RAG_TOP_K` | `3` | quantos trechos relevantes de `rag_search` entram no contexto, descontados do teto de eventos recentes acima ([RN-417](../business-rules.md#rn-417)) |
| `GRAPH_TEMPLATES_ENABLED` | `false` | liga a resolução de `psychologist-kickoff`/`anamnese-kickoff` como template do grafo — chave COMPARTILHADA entre Psicólogo e Anamnese (RN-417), não confundir com `GRAPH_INSTRUCTION_TEMPLATES_ENABLED` acima |

### Anamnese

| variável | default | nota |
|---|---|---|
| `ANAMNESE_ENABLED` | `false` | pausa GLOBAL de rodada NOVA (periódica e sob demanda) — decisão de produto do usuário em 2026-08-10, não bug. Não apaga nada do que já existe. Ligar exige reiniciar o engine ([RN-115](../business-rules.md#rn-115)) |
| `ANAMNESE_INTERVAL_SECONDS` | `900` | 15 min entre execuções |
| `ANAMNESE_MIN_EVENTS` | `10` | abaixo disso não roda — evita perfilar com ruído |
| `ANAMNESE_INITIAL_WINDOW_DAYS` | `30` | janela da primeira execução |
| `ANAMNESE_MAX_ITERATIONS` | `6` | — |
| `ANAMNESE_BUDGET_MICROS` | `200000` | USD 0,20 por execução |
| `ANAMNESE_MAX_PROMPT_EVENTS` | `500` | — |
| `ANAMNESE_MAX_PAYLOAD_CHARS` | `600` | — |

### Guards de carga

| variável | default | nota |
|---|---|---|
| `START_OUTBOX_DRAIN` | `true` | — |
| `START_ANAMNESE` | `true` | guard de CARGA de teste/dev: impede o `kickoff/0` de sequer ser chamado no boot, mas não decide nada de produto — não confundir com `ANAMNESE_ENABLED` (produto: pausa GLOBAL, sobrevive a qualquer valor deste). Desligar impede **novos** enfileiramentos, **não limpa a fila**. Jobs acumulados rodam no boot seguinte — a fila precisa ser purgada. Ver [ambiente de inferência](../runbook.md#ambiente-de-inferencia) |
| `START_MODEL_SYNC` | `true` | tick periódico do sync de catálogo de modelos. Desligá-lo não congela nada: o botão "Atualizar catálogo" da tela de configurações chama o mesmo caso de uso ([RN-043](../business-rules.md#rn-043)) |
| `MODEL_SYNC_INTERVAL_SECONDS` | `21600` (6h) | catálogo de provider muda em escala de dias, e cada rodada gasta uma chamada de API por provider — daí o default folgado |
| `START_GATE_RESCUE` | `true` | tick periódico do resgate de ciclos de gate (`Engine.Gates.GateRescuer`, [RN-140](../business-rules.md#rn-140)). Desligá-lo não muda o boot: o resgate roda uma vez lá de qualquer forma |
| `GATE_RESCUE_INTERVAL_SECONDS` | `300` (5 min) | um gate preso trava a PR inteira do usuário — intervalo bem menor que o de Anamnese/model sync, e cada tick custa só uma query quase sempre vazia |
| `GATE_RESCUE_STALE_AFTER_SECONDS` | `900` (15 min) | generoso de propósito: o ToolLoop de um subagente de QA pode rodar legitimamente até `TOOL_LOOP_MAX_ITERATIONS_GATE` (60) iterações, e um limiar curto resgataria — e duplicaria — um ciclo só lento |

### Tráfego interno e observabilidade

| variável | default |
|---|---|
| `BRABO_SERVICE_TOKEN` 🔒 | `dev-service-token-change-me` — **o mesmo valor da api**. A checagem de BOOT (RN-114) roda do lado da api; o engine em si sobe com qualquer valor (inclusive vazio), mas nesse cenário a api já recusou subir primeiro |
| `BRABO_SERVICE_TOKEN_PREVIOUS` 🔒 | — aceito só na verificação, durante a rotação |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — o exporter do Elixir fala **HTTP/protobuf na 4318**, não gRPC na 4317. Ausente desliga só a exportação (`traces_exporter: :none`), não a instrumentação — ver ADR 0035 |
| `WEB_ORIGIN` | — **a mesma variável da api**, e ela alimenta DUAS coisas aqui: o `check_origin` do socket Phoenix (o painel do time ao vivo) e o CORS HTTP das rotas de health, que o navegador precisa para ler `/health` ([ADR 0037](../adr/0037-cors-do-engine-e-a-porta-como-contrato.md)). Ausente em produção fecha o CORS e mantém o `check_origin` no default estrito do Phoenix — o engine **sobe** de qualquer forma, diferente da api |
| `PROJECT_WORKSPACES_ROOT` | `/tmp/brabo-project-workspaces` — **igual ao da api, no mesmo volume** |

> `SOME_APP_SSL_CERT_PATH`, `SOME_APP_SSL_KEY_PATH` e `MIX_TEST_PARTITION` são
> restos do scaffold do Phoenix e da configuração de teste. Não configure.

---

## web

A web é estática, servida por nginx. Ela lê a configuração de **duas** fontes,
e a distinção importa:

| fonte | quando | como |
|---|---|---|
| `import.meta.env.VITE_*` | **build** | assado no bundle. Mudar exige rebuild |
| `window.__BRABO_CONFIG__` | **runtime** | servido em `/config.js`, gerado pelo entrypoint do container |

É por isso que a mesma imagem serve todos os ambientes: o `/config.js` é
reescrito no boot. As `VITE_*` são o fallback de desenvolvimento.

| variável | serve para |
|---|---|
| `VITE_API_URL` | endereço da api |
| `VITE_ENGINE_URL` | endereço do engine (canal Phoenix) |
| `VITE_LOG_LEVEL` | nível do logger JSON do browser (default `info`). Em cluster quem manda é a chave `WEB_LOG_LEVEL` do `brabo-config`, que o entrypoint escreve em `/config.js` — `VITE_*` só vale em build local |
| `VITE_BRABO_VERSION` | versão mostrada no rodapé das telas de auth (default `dev`). **A única que é build-time por escolha, não por limitação** — ver abaixo |

Página em branco depois do deploy é quase sempre `/config.js` apontando para
`localhost` — o smoke de deploy verifica exatamente isso.

### Por que a versão não passa pelo `/config.js`

As URLs são propriedade do **ambiente**: a mesma imagem precisa falar com a api
de staging e com a de produção, e é para isso que o `/config.js` existe (ADR
0024). A versão é propriedade do **artefato** — a imagem `brabo-web:1.1.2` não
deve poder reportar outra coisa. Se ela viesse do `/config.js`, o rodapé passaria
a ser um campo editável em vez de uma identidade, e um ConfigMap errado faria a
tela mentir sobre qual build está no ar.

O caminho completo, do commit à tela: `release.yml` calcula `versao=${TAG#v}` →
passa como `VERSION` para o `docker buildx bake` → o alvo `web` do
`docker-bake.hcl` converte em `VITE_BRABO_VERSION` → o `ARG`/`ENV` do
`docker/web/Dockerfile.prod` o expõe ao `pnpm build` → o Vite inlina em
`import.meta.env` → `runtime-config.ts` o lê → `AuthLayout` o mostra. O mesmo
`VERSION` alimenta o `BRABO_VERSION` da imagem da api (ADR 0036).

---

## Backup

Consumidas pelo CronJob, não pelos apps. Detalhes em
[Restore](../runbook.md#restore).

| variável | default | nota |
|---|---|---|
| `BACKUP_S3_ENDPOINT` / `BACKUP_S3_BUCKET` | — | destino S3-compatível |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | — | credencial do bucket |
| `BACKUP_KEEP_DAILY` | `7` | retenção por **contagem**, não por idade |
| `BACKUP_KEEP_WEEKLY` | `4` | — |
| `RESTORE_DB` | — | nome da database de destino do restore |
| `RESTORE_PREFIX` | `daily/` | `weekly/` para restaurar de uma cópia semanal |
| `RESTORE_ADMIN_URL` | — | conexão com permissão de `CREATEDB`; em produção é separada da `DATABASE_URL` |

## Inferência local (containers)

Estas não são lidas pelo nosso código — são do container `ollama`, e estão
aqui porque são a causa mais frequente de agente com comportamento estranho.
A tabela de sintomas está em
[ambiente de inferência](../runbook.md#ambiente-de-inferencia).

| variável | por quê |
|---|---|
| `OLLAMA_CONTEXT_LENGTH` | o default de 4096 trunca **em silêncio** um prompt montado para 128k |
| `OLLAMA_MAX_LOADED_MODELS` | com `OLLAMA_KEEP_ALIVE` alto, os modelos acumulam até estourar a memória |
| `OLLAMA_KEEP_ALIVE` | quanto tempo o modelo fica residente |
| `DEMO_QA_MODEL` | aponta o gate de QA para um modelo de API — o binding por agente vence o do projeto |

---

## Observabilidade local (containers)

Também não são lidas pelo nosso código: são as portas do overlay
`docker/docker-compose.observability.yml`, que sobe Prometheus, Loki e Grafana
ao lado do stack de desenvolvimento (`pnpm dev:obs`). O mecanismo está em
[observabilidade local](../runbook.md#observabilidade-local).

| variável | default | por quê |
|---|---|---|
| `GRAFANA_PORT` | `3001` | mesma porta que o Grafana do cluster usa; os dois **não coexistem**, pela mesma razão que `pnpm dev` e `make deploy-local` não coexistem |
| `PROMETHEUS_PORT` | `9090` | a porta que o runbook já usa no `kubectl port-forward` do cluster |
| `LOKI_PORT` | `3100` | só para consultar direto; o caminho normal é pelo Grafana |

O overlay **não** define `OTEL_EXPORTER_OTLP_ENDPOINT`: sem Collector no meio,
apontar as apps para um endereço que não existe só produz erro de exportação a
cada turno ([ADR 0035](../adr/0035-observabilidade-legivel-e-trace-sem-coletor.md)
separou instrumentar de exportar exatamente por isso). Métrica e log funcionam
sem ele; trace continua sendo o cluster.

---

## Inventário completo

As tabelas acima explicam **o que cada variável faz**. Esta seção é o
**inventário**: extraído do código a cada `pnpm docs:generate`, ele existe para
que uma variável nova não fique documentada em lugar nenhum sem ninguém notar.

<!-- BEGIN:GENERATED:env-inventario -->

> ⚠️ Bloco gerado por `pnpm docs:generate`. Não edite à mão — o próximo build sobrescreve.

Inventário extraído do código: **119 variáveis** lidas em tempo de execução. Todas têm descrição nas tabelas acima.

**api** — 53 variáveis

- `API_PUBLIC_URL` <sub>(apps/api/src/application/use-cases/auth/start-social-login.use-case.ts)</sub>
- `AUTH_ACCESS_TOKEN_TTL_MS` <sub>(apps/api/src/infrastructure/security/ed25519-access-token-issuer.ts)</sub>
- `AUTH_EMAIL_TOKEN_TTL_MS` <sub>(apps/api/src/application/use-cases/auth/auth-config.ts)</sub>
- `AUTH_IP_ATTEMPT_THRESHOLD` <sub>(apps/api/src/application/use-cases/auth/auth-config.ts)</sub>
- `AUTH_JWT_SECRET` <sub>(apps/api/src/infrastructure/security/auth-key-material.ts)</sub>
- `AUTH_JWT_SECRET_PREVIOUS` <sub>(apps/api/src/infrastructure/security/auth-key-material.ts)</sub>
- `AUTH_LOCKOUT_ENABLED` <sub>(apps/api/src/infrastructure/persistence/drizzle/drizzle-login-throttle.ts)</sub>
- `AUTH_LOCKOUT_IP_THRESHOLDS` <sub>(apps/api/src/infrastructure/persistence/drizzle/drizzle-login-throttle.ts)</sub>
- `AUTH_LOCKOUT_THRESHOLDS` <sub>(apps/api/src/infrastructure/persistence/drizzle/drizzle-login-throttle.ts)</sub>
- `AUTH_LOCKOUT_WINDOW_MS` <sub>(apps/api/src/infrastructure/persistence/drizzle/drizzle-login-throttle.ts)</sub>
- `AUTH_MAIL_LOG_TOKENS` <sub>(apps/api/src/infrastructure/mail/log-mail-sender.ts)</sub>
- `AUTH_REFRESH_ABSOLUTE_TTL_MS` <sub>(apps/api/src/application/use-cases/auth/auth-config.ts)</sub>
- `AUTH_REFRESH_TOKEN_TTL_MS` <sub>(apps/api/src/application/use-cases/auth/auth-config.ts)</sub>
- `AUTH_REGISTRATION_ENABLED` <sub>(apps/api/src/application/use-cases/auth/auth-config.ts)</sub>
- `AUTH_RESET_TOKEN_TTL_MS` <sub>(apps/api/src/application/use-cases/auth/auth-config.ts)</sub>
- `AUTH_SET_PASSWORD_TTL_MS` <sub>(apps/api/src/application/use-cases/auth/auth-config.ts)</sub>
- `AUTH_TOKEN_PEPPER` <sub>(apps/api/src/infrastructure/security/auth-key-material.ts)</sub>
- `BRABO_FORCE_SEED` <sub>(apps/api/src/scripts/provisionar-usuario.ts)</sub>
- `BRABO_SEED_PASSWORD` <sub>(apps/api/src/db/seed.ts)</sub>
- `BRABO_SERVICE_TOKEN` <sub>(apps/api/src/infrastructure/security/service-token.ts)</sub>
- `BRABO_SERVICE_TOKEN_PREVIOUS` <sub>(apps/api/src/infrastructure/security/service-token.ts)</sub>
- `CREDENTIALS_MASTER_KEY` <sub>(apps/api/src/infrastructure/security/envelope-encryption.service.ts)</sub>
- `CREDENTIALS_MASTER_KEY_PREVIOUS` <sub>(apps/api/src/infrastructure/security/envelope-encryption.service.ts)</sub>
- `DATABASE_URL` <sub>(apps/api/src/db/migrate.ts)</sub>
- `ENGINE_URL` <sub>(apps/api/src/infrastructure/http-clients/api-to-engine-client.ts)</sub>
- `GIT_LOCAL_REPOS_ROOT` <sub>(apps/api/src/infrastructure/git/local-git-provider.ts)</sub>
- `GIT_OAUTH_STATE_SECRET` <sub>(apps/api/src/infrastructure/security/oauth-state-secret.ts)</sub>
- `GITHUB_OAUTH_CLIENT_ID` <sub>(apps/api/src/infrastructure/git/github-oauth-client.ts)</sub>
- `GITHUB_OAUTH_CLIENT_SECRET` <sub>(apps/api/src/infrastructure/git/github-oauth-client.ts)</sub>
- `GITLAB_OAUTH_CLIENT_ID` <sub>(apps/api/src/infrastructure/git/gitlab-oauth-client.ts)</sub>
- `GITLAB_OAUTH_CLIENT_SECRET` <sub>(apps/api/src/infrastructure/git/gitlab-oauth-client.ts)</sub>
- `GRAPH_PROJECTOR_INTERVAL_MS` <sub>(apps/api/src/application/graph-projection/graph-projector.ts)</sub>
- `LOG_LEVEL` <sub>(apps/api/src/infrastructure/observability/logger.config.ts)</sub>
- `MAIL_TRANSPORT` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `METRICS_GAUGE_INTERVAL_MS` <sub>(apps/api/src/infrastructure/observability/domain-gauges.collector.ts)</sub>
- `MIGRATIONS_FOLDER` <sub>(apps/api/src/db/migrate.ts)</sub>
- `NEO4J_PASSWORD` <sub>(apps/api/src/infrastructure/graph/neo4j-config.ts)</sub>
- `NEO4J_URI` <sub>(apps/api/src/infrastructure/graph/neo4j-config.ts)</sub>
- `NEO4J_USER` <sub>(apps/api/src/infrastructure/graph/neo4j-config.ts)</sub>
- `NODE_ENV` <sub>(apps/api/src/infrastructure/graph/neo4j-config.ts)</sub>
- `OLLAMA_HOST` <sub>(apps/api/src/infrastructure/llm/ollama-provider.ts)</sub>
- `PROJECT_WORKSPACES_ROOT` <sub>(apps/api/src/infrastructure/filesystem/project-workspaces-root.ts)</sub>
- `RATE_LIMIT_ENABLED` <sub>(apps/api/src/interfaces/http/shared/rate-limit.guard.ts)</sub>
- `RATE_LIMIT_IP` <sub>(apps/api/src/interfaces/http/shared/rate-limit.guard.ts)</sub>
- `RATE_LIMIT_USER` <sub>(apps/api/src/interfaces/http/shared/rate-limit.guard.ts)</sub>
- `RATE_LIMIT_WINDOW_MS` <sub>(apps/api/src/infrastructure/observability/domain-gauges.collector.ts)</sub>
- `SMTP_FROM` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `SMTP_HOST` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `SMTP_PASSWORD` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `SMTP_PORT` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `SMTP_SECURE` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `SMTP_USER` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `WEB_ORIGIN` <sub>(apps/api/src/infrastructure/mail/smtp-mail-sender.ts)</sub>

**engine** — 62 variáveis

- `ANAMNESE_BUDGET_MICROS` <sub>(apps/engine/config/runtime.exs)</sub>
- `ANAMNESE_ENABLED` <sub>(apps/engine/config/runtime.exs)</sub>
- `ANAMNESE_INITIAL_WINDOW_DAYS` <sub>(apps/engine/config/runtime.exs)</sub>
- `ANAMNESE_INTERVAL_SECONDS` <sub>(apps/engine/config/runtime.exs)</sub>
- `ANAMNESE_MAX_ITERATIONS` <sub>(apps/engine/config/runtime.exs)</sub>
- `ANAMNESE_MAX_PAYLOAD_CHARS` <sub>(apps/engine/config/runtime.exs)</sub>
- `ANAMNESE_MAX_PROMPT_EVENTS` <sub>(apps/engine/config/runtime.exs)</sub>
- `ANAMNESE_MIN_EVENTS` <sub>(apps/engine/config/runtime.exs)</sub>
- `API_URL` <sub>(apps/engine/config/runtime.exs)</sub>
- `BRABO_SERVICE_TOKEN` <sub>(apps/engine/config/runtime.exs)</sub>
- `BRABO_SERVICE_TOKEN_PREVIOUS` <sub>(apps/engine/config/runtime.exs)</sub>
- `CONTEXT_COMPACTION_THRESHOLD` <sub>(apps/engine/config/runtime.exs)</sub>
- `DATABASE_URL` <sub>(apps/engine/config/dev.exs)</sub>
- `DEFAULT_CONTEXT_WINDOW` <sub>(apps/engine/config/runtime.exs)</sub>
- `DNS_CLUSTER_QUERY` <sub>(apps/engine/config/runtime.exs)</sub>
- `ECTO_IPV6` <sub>(apps/engine/config/runtime.exs)</sub>
- `GATE_RESCUE_INTERVAL_SECONDS` <sub>(apps/engine/config/runtime.exs)</sub>
- `GATE_RESCUE_STALE_AFTER_SECONDS` <sub>(apps/engine/config/runtime.exs)</sub>
- `GRAPH_INSTRUCTION_TEMPLATES_ENABLED` <sub>(apps/engine/config/runtime.exs)</sub>
- `GRAPH_TEMPLATES_ENABLED` <sub>(apps/engine/config/runtime.exs)</sub>
- `LLM_TURN_TIMEOUT_MS` <sub>(apps/engine/config/runtime.exs)</sub>
- `MIX_TEST_PARTITION` <sub>(apps/engine/config/test.exs)</sub>
- `MODEL_SYNC_INTERVAL_SECONDS` <sub>(apps/engine/config/runtime.exs)</sub>
- `OTEL_EXPORTER_OTLP_ENDPOINT` <sub>(apps/engine/config/runtime.exs)</sub>
- `PHX_HOST` <sub>(apps/engine/config/runtime.exs)</sub>
- `PHX_SERVER` <sub>(apps/engine/config/runtime.exs)</sub>
- `POOL_SIZE` <sub>(apps/engine/config/runtime.exs)</sub>
- `PORT` <sub>(apps/engine/config/runtime.exs)</sub>
- `POSTGRES_HOST` <sub>(apps/engine/config/test.exs)</sub>
- `POSTGRES_PASSWORD` <sub>(apps/engine/config/test.exs)</sub>
- `POSTGRES_USER` <sub>(apps/engine/config/test.exs)</sub>
- `PROJECT_WORKSPACES_ROOT` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_BUDGET_MICROS_LEVE` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_BUDGET_MICROS_PESADA` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_ENABLED` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_MAX_ITERATIONS_LEVE` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_MAX_ITERATIONS_PESADA` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_MAX_PAYLOAD_CHARS` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_MAX_PROMPT_EVENTS_LEVE` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_MAX_PROMPT_EVENTS_PESADA` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_RAG_TOP_K` <sub>(apps/engine/config/runtime.exs)</sub>
- `PSYCHOLOGIST_TRIAGE_THRESHOLD` <sub>(apps/engine/config/runtime.exs)</sub>
- `READ_FILE_MAX_BYTES` <sub>(apps/engine/config/runtime.exs)</sub>
- `SEARCH_WORKSPACE_MAX_BYTES` <sub>(apps/engine/config/runtime.exs)</sub>
- `SEARCH_WORKSPACE_MAX_HITS` <sub>(apps/engine/config/runtime.exs)</sub>
- `SECOPS_SCAN_TIMEOUT_MS` <sub>(apps/engine/config/runtime.exs)</sub>
- `SECRET_KEY_BASE` <sub>(apps/engine/config/runtime.exs)</sub>
- `SESSION_HEARTBEAT_TIMEOUT_MS` <sub>(apps/engine/config/runtime.exs)</sub>
- `SHUTDOWN_DRAIN_TIMEOUT_MS` <sub>(apps/engine/config/runtime.exs)</sub>
- `SOME_APP_SSL_CERT_PATH` <sub>(apps/engine/config/runtime.exs)</sub>
- `SOME_APP_SSL_KEY_PATH` <sub>(apps/engine/config/runtime.exs)</sub>
- `START_ANAMNESE` <sub>(apps/engine/config/runtime.exs)</sub>
- `START_GATE_RESCUE` <sub>(apps/engine/config/runtime.exs)</sub>
- `START_MODEL_SYNC` <sub>(apps/engine/config/runtime.exs)</sub>
- `START_OUTBOX_DRAIN` <sub>(apps/engine/config/runtime.exs)</sub>
- `TERMINAL_ACTION_TIMEOUT_MS` <sub>(apps/engine/config/runtime.exs)</sub>
- `TERMINAL_OUTPUT_MAX_BYTES` <sub>(apps/engine/config/runtime.exs)</sub>
- `TOOL_LOOP_MAX_ITERATIONS` <sub>(apps/engine/config/runtime.exs)</sub>
- `TOOL_LOOP_MAX_ITERATIONS_EXECUCAO` <sub>(apps/engine/config/runtime.exs)</sub>
- `TOOL_LOOP_MAX_ITERATIONS_GATE` <sub>(apps/engine/config/runtime.exs)</sub>
- `TRANSPORT_MAX_BODY_BYTES` <sub>(apps/engine/config/runtime.exs)</sub>
- `WEB_ORIGIN` <sub>(apps/engine/config/runtime.exs)</sub>

**web** — 4 variáveis

- `VITE_API_URL` <sub>(apps/web/src/lib/runtime-config.ts)</sub>
- `VITE_BRABO_VERSION` <sub>(apps/web/src/lib/runtime-config.ts)</sub>
- `VITE_ENGINE_URL` <sub>(apps/web/src/lib/runtime-config.ts)</sub>
- `VITE_LOG_LEVEL` <sub>(apps/web/src/lib/runtime-config.ts)</sub>
<!-- END:GENERATED:env-inventario -->

---

> **TODO(humano):** não há validação de schema das variáveis no boot (tipo
> `zod`/`envalid` na api ou `NimbleOptions` no engine). Hoje um valor numérico
> inválido vira `NaN` silenciosamente e um typo em nome de variável cai no
> default sem aviso. As únicas exceções são as marcadas 🔒, que falham
> explicitamente em produção.
