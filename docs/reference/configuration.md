---
id: configuration
title: Configuração
sidebar_label: Configuração
sidebar_position: 1
description: Todas as variáveis de ambiente da api, do engine e do web, com os defaults e o que quebra quando estão erradas.
keywords: [configuração, variáveis de ambiente, env, deploy]
---

# Configuração

Toda a configuração é por **variável de ambiente**. Não há arquivo de
configuração da aplicação — o que existe é o `permissions.json`, que é política
do projeto, não configuração de processo.

Dois arquivos versionados são lidos em tempo de execução e não são
configuração, embora seja fácil confundi-los com ela: o `permissions.json`
acima e o `docs/gates.yml` ([ADR 0054](../adr/0054-gates-como-registro-declarativo.md)),
o registro declarativo de gates. Nenhum dos dois tem variável de ambiente que
aponte um caminho — o registro é achado subindo a partir de `__dirname` — e
nenhum muda comportamento ao ser editado em produção: o registro DESCREVE os
gates, não os aplica. Ele viaja dentro da imagem da api; veja o
[runbook](../runbook.md#registro-de-gates).

O que viaja é o registro e **nada daquilo para que ele aponta**. A `evidencia`
de um gate `teste`/`ci` nomeia arquivos sob `apps/api/test/`, `scripts/ci/` e
`.github/`, e nenhum deles está na imagem. Conferir que esses alvos existem é,
portanto, uma afirmação sobre o repositório, cobrada no CI, nunca pelo processo
que serve `GET /gates` — por isso a api lê o registro sem procurá-los. Ela já
procurou, e respondia `500` em toda instalação
([RN-070](../business-rules/custo.md#rn-070)).

> **`up --wait` só prova o que tem healthcheck.** No compose de
> desenvolvimento, `api`, `engine` e `web` não tinham nenhum, então
> `docker compose up --wait` os dava como prontos no instante em que o
> container subia — antes de o processo escutar. Foi assim que um container
> podia morrer segundos depois com o comando ainda anunciando sucesso. Os três
> agora carregam a mesma checagem que as imagens de produção já declaram no
> Dockerfile (`/health` na api e no engine, que toca o banco; `/` no servidor
> do Vite). O broker de containers ganhou a dele numa mudança à parte;
> `postgres` e `neo4j` sempre tiveram. Nada aqui é variável de ambiente — está
> escrito porque o `--wait` é aquilo em que os scripts confiam, e um serviço
> sem healthcheck o faz mentir.

Os defaults abaixo foram extraídos do código, não de documentação anterior. A
coluna **quando falha** é a parte que economiza tempo: quase toda variável tem
um default que funciona em desenvolvimento e um modo de falha específico em
produção.

> **Uma variável só chega ao processo se o compose a mapear.** O `docker
> compose` não repassa o ambiente do host para dentro do container: a variável
> chega se — e somente se — estiver escrita no `environment:` daquele serviço
> (ou num `env_file`). Isso não é detalhe; foi assim que `ANAMNESE_ENABLED` e
> `PSYCHOLOGIST_ENABLED` ficaram inalcançáveis em silêncio enquanto três
> lugares do código prometiam que a pausa de 2026-08-10 se revertia com
> `X=true` e um reinício. Medidas dentro do container do engine em execução,
> voltaram vazias e o `runtime.exs` caiu em `"false"` — sem erro em lugar
> nenhum. Toda flag booleana que o engine lê está mapeada agora nos três
> arquivos de compose (dev, produção e instalação — o de instalação só desde a
> AT-202), com o default do próprio código, salvo as duas chaves de boot dos
> agentes de fundo que produção e instalação desligam de propósito, e
> `scripts/ci/flags-do-engine-no-compose.spec.ts` reprova o build para a
> próxima que não estiver ([RN-540](../business-rules.md#rn-540)).
> O Kubernetes fica de fora dessa regra de propósito: um Deployment/ConfigMap
> não intercepta nada, então ali não há chave quebrada a consertar.

> **Os defaults de desenvolvimento são inseguros de propósito.** Valores como
> `dev-master-key-change-me` existem para que o `pnpm dev` suba sem cerimônia.
> Em produção eles precisam ser trocados — e para seis deles o processo
> **recusa** subir sem a troca (api ou engine, marcados com 🔒). Cinco seguem o
> padrão do
> [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md)/[RN-093](../business-rules/custo.md#rn-093):
> ausente, igual ao literal público de exemplo ou curto demais derruba o boot.
> Veja a [RN-114](../business-rules/custo.md#rn-114) para as quatro que se
> juntaram ao `GIT_OAUTH_STATE_SECRET` original.

## Compose de instalação (`docker-compose.install.yml`)

O compose que roda numa máquina **instalada** pega as cinco imagens do produto
de **variáveis obrigatórias**, sem default — o `install.sh` as escreve no
`.env`:

| variável | o quê |
|---|---|
| `BRABO_API_IMAGE` | referência completa da imagem da api; `ghcr.io/…@sha256:…` quando a origem é o GHCR, `brabo-api:prod` quando construída localmente |
| `BRABO_ENGINE_IMAGE` | o mesmo, para o engine |
| `BRABO_WEB_IMAGE` | o mesmo, para o web |
| `BRABO_BACKUP_IMAGE` | o mesmo, para o job de backup (sob o profile `backup`) |
| `BRABO_BROKER_IMAGE` | o mesmo, para o broker de containers ([ADR 0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md)). Escrita **esteja ou não** o broker ligado: o Compose interpola o arquivo inteiro antes de filtrar por profile, então um `${VAR:?…}` num serviço desligado ainda recusa o arquivo (medido) |

Elas são `${VAR:?…}` de propósito. Com default, uma variável ausente subiria
metade da stack numa imagem que ninguém escolheu, e o erro apareceria como
comportamento estranho em vez de recusa.

Elas **não** estão no inventário gerado abaixo: o gerador varre `apps/`, e
estas são lidas pelo Compose, não por código do produto
([RN-527](../business-rules.md#rn-527)).

O **broker** está neste compose desde o [ADR 0162](../adr/0162-broker-publicado-e-oferecido-pelo-instalador.md),
**desligado**, sob o profile `container-broker`, e o `install.sh` o liga só
quando pergunta e a resposta é "s" ([RN-575](../business-rules.md#rn-575)).
Então ele escreve quatro linhas, juntas ou nenhuma:

| variável | o que o `install.sh` escreve |
|---|---|
| `COMPOSE_PROFILES` | `container-broker` — lida pelo Compose a partir do `--env-file`, então `up -d --wait` sobe o broker sem flag |
| `BROKER_URL` | `http://broker:8090` — o lado da api; sem ela a api nunca chama o broker |
| `DOCKER_GID` | o gid do socket **visto de dentro de um container**, medido com a própria imagem do broker; falhar na medição é recusa nomeada, nunca o default `999` |
| `PROJECT_WORKSPACES_HOST_ROOT` | `<DockerRootDir>/volumes/brabo_project_workspaces/_data`, calculado antes da subida e conferido contra o `Mountpoint` real do volume depois dela |

`BRABO_PROJECTS_HOST_BASE` não é escrita: o compose a deriva de
`BRABO_PROJECTS_BASE`, como no compose de validação. Ligar ou desligar depois
está no [runbook](../runbook.md#broker-na-instalacao).

Os **modelos locais** (Ollama, o profile `llm`) são perguntados logo depois do
broker ([RN-691](../business-rules.md#rn-691)). Responder "s" mede antes uma
porta livre do host e escreve:

| variável | o que o `install.sh` escreve |
|---|---|
| `OLLAMA_PORT` | `11434`, ou a primeira porta livre até `11443` quando algo (um Ollama nativo) já escuta ali; a faixa inteira ocupada é recusa nomeada, sem escrever nada |
| `COMPOSE_PROFILES` | `llm`, junto com `container-broker` numa linha SÓ quando os dois foram aceitos (`container-broker,llm`) — duas linhas não somam, a última vence |

Sem elas a checagem de duplicata semântica é pulada. Ligar depois está no
[runbook](../runbook.md#modelos-locais-na-instalacao).


## api

### Essenciais

| variável | default | quando falha |
|---|---|---|
| `DATABASE_URL` | `postgres://brabo:brabo@localhost:5432/brabo` | sem ela, nada sobe |
| `PORT` | `3000` | — |
| `API_JSON_BODY_LIMIT` | `10mb` | teto do corpo JSON que a api aceita, aplicado ao parser registrado em `main.ts` antes de qualquer rota. Existe para que uma mudança no teto de transporte do engine (`TRANSPORT_MAX_BODY_BYTES`, 8 MiB) não exija deploy novo — o default guarda folga sobre ele. Pequeno demais, e um turno de contexto grande volta como **413** |
| `NODE_ENV` | — | `production` liga o CORS estrito e a validação das chaves |
| `API_PUBLIC_URL` | `http://localhost:3000` | usada nos callbacks de OAuth de git; errada = callback quebrado |
| `ENGINE_URL` | `http://localhost:4000` no código, `http://engine:4000` no Compose | os comandos síncronos api→engine falham. **Deixe-a vazia no `.env`**: definida ali, ela vence o default do Compose e a api tenta falar com `localhost:4000` de dentro do próprio container — toda ativação de sessão morre com `ECONNREFUSED` e o frontend não sai do lugar. Cada ambiente já tem o default certo sem a linha |
| `ENGINE_PUBLIC_URL` | o mesmo que `ENGINE_URL` | usada só para montar o `engineWsUrl` (WebSocket) devolvido em `POST .../runner-ticket`/`.../terminal-ticket` — o runner e o web podem estar FORA do cluster, então o endereço interno (`http://engine:4000`) não serve; `ENGINE_URL` continua sendo a usada nas chamadas síncronas de sempre api→engine (RN-419) |
| `BRABO_VERSION` | `dev` | vira `service.version` no resource do OpenTelemetry — é como se sabe que build gerou um trace. A imagem de release injeta a tag por um `ARG` do `docker-bake.hcl`; fora de release fica `dev`. **Não** aparece em `/health`, que de propósito não devolve a versão (veja a `description` da rota) |
| `MIGRATIONS_FOLDER` | `./src/db/migrations` | — |

### Segurança 🔒

| variável | default | quando falha |
|---|---|---|
| `CREDENTIALS_MASTER_KEY` 🔒 | `dev-master-key-change-me` **só fora de produção** | embrulha as DEKs. **Em produção a api recusa subir** se ela falta, se é o default acima (público — está no `.env.example`) ou se tem menos de 16 caracteres (RN-114). Essa é só a checagem do BOOT: trocá-la por uma chave **válida mas diferente** sem re-embrulhar ainda deixa toda credencial ilegível sem erro nenhum — a falha aparece no primeiro uso. Veja a [rotação](../runbook.md#rotacao-da-chave-mestra) |
| `CREDENTIALS_MASTER_KEY_PREVIOUS` | — | só durante a rotação. Presente = a api tenta a chave anterior quando a atual falha |
| `GIT_OAUTH_STATE_SECRET` 🔒 | `dev-oauth-state-secret-change-me` **só fora de produção** | assina o `state` do OAuth; fraca = CSRF no fluxo de conexão de git. **Em produção a api recusa subir** sem ela, com o default acima (que é público — está no `.env.example`) ou com menos de 16 caracteres. Gere com `openssl rand -base64 32`. Veja o [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md) e a [RN-093](../business-rules/custo.md#rn-093) |
| `WEB_ORIGIN` 🔒 | `http://localhost:${WEB_PORT}` | **em produção a api recusa subir** se ela falta ou é `*`. O CORS é estrito por ambiente. **A porta faz parte do valor**: o web em `:5174` é outra origem e é bloqueado — veja o [ADR 0037](../adr/0037-cors-do-engine-e-a-porta-como-contrato.md). Nos composes, o default **deriva de `WEB_PORT`**, então mudar a porta leva o CORS junto; definir `WEB_ORIGIN` à mão sobrepõe a derivação e mantê-la coerente passa a ser responsabilidade sua |
| `WEB_PORT` | `5173` (dev) · `8088` (prod) | porta publicada do web no host. Nenhum serviço a lê — ela **alimenta o default de `WEB_ORIGIN`** nos composes, e é isso que impede porta e CORS de divergirem |

### Auth first-party

A auth mora no domínio da api, e desde o corte é também a única emissora.
Decisões no
[ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) e no
[ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md).

| variável | default | o que faz |
|---|---|---|
| `AUTH_JWT_SECRET` 🔒 | `dev-auth-jwt-secret-change-me` **só fora de produção** | frase de onde o par Ed25519 do access token é **derivado** por scrypt — nenhuma chave privada é commitada. **Em produção a api recusa subir** se ela falta, se é o default acima (público — está no `.env.example`) ou se tem menos de 16 caracteres (RN-114) |
| `AUTH_JWT_SECRET_PREVIOUS` | — | aceita **só para verificação**, durante a rotação; entra no JWKS e nunca assina |
| `AUTH_TOKEN_PEPPER` 🔒 | `dev-auth-token-pepper-change-me` **só fora de produção** | chave HMAC do hash dos tokens opacos (refresh, vínculos de conta, PATs) e da chave do balde de bloqueio. **Segredo próprio — não cai mais em `AUTH_JWT_SECRET`** ([RN-613](../business-rules/autenticacao.md#rn-613)). **Em produção a api recusa subir** se ele falta, se é qualquer dos valores de exemplo deste repositório ou se tem menos de 16 caracteres. Instalação que rodou sem ele precisa defini-lo com o `AUTH_JWT_SECRET` **atual**, senão todo mundo é deslogado — veja o [runbook](../runbook.md#rotacao-do-auth-jwt-secret) |
| `AUTH_ACCESS_TOKEN_TTL_MS` | `900000` | 15 min |
| `AUTH_REFRESH_TOKEN_TTL_MS` | `1209600000` | 14 dias |
| `AUTH_REFRESH_ABSOLUTE_TTL_MS` | `2592000000` | teto absoluto da família, contado do login — sem ele a rotação concede sessão eterna |
| `AUTH_REGISTRATION_ENABLED` | `true` | qualquer valor diferente de `"false"` mantém o cadastro aberto |
| `AUTH_LOCKOUT_ENABLED` | `true` | mesma convenção |
| `AUTH_LOCKOUT_WINDOW_MS` | `900000` | janela deslizante da contagem |
| `AUTH_LOCKOUT_THRESHOLDS` | `5:30,8:300,12:900` | escada do balde por email, `falhas:segundos` |
| `AUTH_LOCKOUT_IP_THRESHOLDS` | `20:30,30:120` | escada do balde por IP, mais permissiva e com teto curto |
| `AUTH_EMAIL_TOKEN_TTL_MS` | `172800000` | verificação de email, 48 h |
| `AUTH_RESET_TOKEN_TTL_MS` | `3600000` | redefinição de senha, 1 h |
| `AUTH_SET_PASSWORD_TTL_MS` | `604800000` | definição da primeira senha (usuário migrado), 7 dias — mais longo que a redefinição porque quem recebe não pediu |
| `AUTH_IP_ATTEMPT_THRESHOLD` | `60` | teto de tentativas por IP nas rotas de auth |
| `AUTH_MAIL_LOG_TOKENS` | `false` | **só dev**: imprime no log o token de verificação/redefinição |

> **O teto da escada por email é igual à janela de propósito.** Com janela
> deslizante, quem insiste empurra a janela e fica bloqueado enquanto
> insistir; quem parou volta com a janela limpa. Um teto **maior** que a janela
> criaria um bloqueio que a janela não consegue representar, e exigiria uma
> coluna `locked_until` persistente com fila de desbloqueio. Não mexa num sem o
> outro.

> **Rotacionar o `AUTH_TOKEN_PEPPER` desloga todo mundo** e invalida os tokens
> de verificação e de redefinição pendentes. Diferente das chaves, o pepper
> **não** tem `_PREVIOUS`. Veja o [runbook](../runbook.md).

> **Até onde as variáveis `_PREVIOUS` chegam.** `AUTH_JWT_SECRET_PREVIOUS`,
> `CREDENTIALS_MASTER_KEY_PREVIOUS` e `BRABO_SERVICE_TOKEN_PREVIOUS` estão
> mapeadas no `environment:` dos três composes (dev, produção e instalação)
> como `${X:-}` — a api recebe as três, o engine e o broker recebem
> `BRABO_SERVICE_TOKEN_PREVIOUS` ([RN-595](../business-rules/autenticacao.md#rn-595)).
> Vazio é o mesmo que ausente em todo leitor, então fora de uma rotação nada
> muda; durante uma, basta defini-las no `.env` e recriar o serviço. Antes da
> RN-595 elas não estavam mapeadas em lugar nenhum e o `docker compose` não
> repassa o ambiente do host, então uma rotação virava troca seca em silêncio.
> **No Kubernetes elas chegam aos Pods pelo cofre de segredos** (AT-220): o
> `ExternalSecret` puxa o objeto `brabo` inteiro com `dataFrom.extract`, então
> um `_PREVIOUS` presente ali cai em `brabo-secrets` e um ausente simplesmente
> não está lá. O preço é que toda chave desse objeto vira variável de ambiente
> de api, engine, migrations e backup — o objeto do cofre não pode guardar mais
> nada. O procedimento está no [runbook](../runbook.md#rotacao-no-kubernetes).

### SMTP real (MailSender)

O `MailSender` só manda email de verdade com `MAIL_TRANSPORT=smtp` — o default
é `log` (link/token vão para o log da api, `AUTH_MAIL_LOG_TOKENS` acima),
inclusive em produção: mandar email é opção do operador. Decisão no
[ADR 0096](../adr/0096-smtp-real-no-mailsender.md).

| variável | default | o que faz |
|---|---|---|
| `MAIL_TRANSPORT` | `log` | `log` (default) ou `smtp`. Qualquer outro valor cai em `log` |
| `SMTP_HOST` 🔒 | — | host do provedor SMTP. **Só com `MAIL_TRANSPORT=smtp`**: em produção a api recusa subir se ele falta, se é só espaço ou se é o valor de exemplo publicado no `.env.example` (RN-114) |
| `SMTP_PORT` | `587` | porta do provedor — `587` é STARTTLS, `465` é TLS implícito (`SMTP_SECURE=true`) |
| `SMTP_SECURE` | `false` | `true` liga TLS implícito na conexão (tipicamente a porta 465) |
| `SMTP_USER` 🔒 | — | usuário da auth SMTP. Mesma exigência de `SMTP_HOST` em produção |
| `SMTP_PASSWORD` 🔒 | — | senha/token da auth SMTP. Mesma exigência de `SMTP_HOST` em produção — **nunca aparece em log** |
| `SMTP_FROM` | — | remetente, no formato `"Nome <email@dominio>"` (ou só o email). Mesma exigência de `SMTP_HOST` em produção, mais a validação do formato |

> O corpo do email é **texto puro**, sem HTML — a porta `MailSender` não
> carrega estrutura para corpo rico, e um motor de template seria superfície de
> injeção sem ganho. O link usa `WEB_ORIGIN` (acima).

### Seed de desenvolvimento

Consumidas por `pnpm --filter api seed`, não pela api em execução. Sem IdP
externo, é daqui que vem a credencial para entrar no web local e no smoke.

| variável | default | o que faz |
|---|---|---|
| `BRABO_SEED_PASSWORD` | `brabo12345678` | senha dos usuários semeados (`owner@brabo.dev`, `dev@brabo.dev`), criados com o email **já verificado** |
| `BRABO_FORCE_SEED` | — | destrava o seed com `NODE_ENV=production`, onde por padrão ele **recusa rodar**. Não a defina num ambiente real: a conta nasce com senha conhecida e verificada |

> O seed é idempotente e **não mexe na senha** de quem já existe. Rodá-lo de
> novo depois de alguém trocar a própria senha não a reverte.

### Rate limit

Janela deslizante no Postgres — não há Redis
([ADR 0027](../adr/0027-fase5-backup-hardening-release.md)).

| variável | default | o que faz |
|---|---|---|
| `RATE_LIMIT_ENABLED` | `true` | qualquer valor diferente de `"false"` o mantém ligado |
| `RATE_LIMIT_WINDOW_MS` | `60000` | tamanho da janela |
| `RATE_LIMIT_USER` | `300` | requisições por usuário por janela |
| `RATE_LIMIT_IP` | `600` | requisições por IP por janela |

> Se a tabela do rate limit está indisponível, a requisição **passa**. O guard
> protege contra abuso, não contra acesso não autorizado — esse é o trabalho do
> guard de autenticação, que roda antes.

### Tráfego interno 🔒

O segredo compartilhado que autentica api ↔ engine. **A mesma variável dos dois
lados** — cada um envia o valor atual e aceita os dois, e é isso que torna a
rotação possível sem indisponibilidade ([RN-035](../business-rules/autenticacao.md#rn-035)).

| variável | default | o que faz |
|---|---|---|
| `BRABO_SERVICE_TOKEN` 🔒 | `dev-service-token-change-me` **só fora de produção** | vai no cabeçalho `X-Brabo-Service-Token` e é o que o `EngineServiceGuard` compara em tempo constante. **Em produção a api recusa subir** se ele falta, se é o default acima (público — está no `.env.example`) ou se tem menos de 16 caracteres (RN-114) |
| `BRABO_SERVICE_TOKEN_PREVIOUS` | — | aceito **só para verificação**, durante a rotação. Quando definido, passa pela **mesma** regra do token atual: o espaço em volta é aparado, e em produção a api recusa subir se ele é o default público ou tem menos de 16 caracteres. Diferente do atual, nunca é obrigatório ([RN-598](../business-rules/autenticacao.md#rn-598)) |

> Definir só o valor NOVO de um lado (sem passar pela dança do `_PREVIOUS`) não
> quebra o boot de ninguém: o sintoma é `403` em `/internal/*` e `401` nas
> chamadas da api ao engine. Procedimento no
> [runbook](../runbook.md#rotacao-das-chaves-do-auth). A checagem de BOOT acima
> (RN-114) é outra coisa: ela só falha com o default público ou com a variável
> ausente/curta, não com divergência entre os dois lados.

### Git

| variável | default | nota |
|---|---|---|
| `GIT_LOCAL_REPOS_ROOT` | `/tmp/brabo-git-repos` | provider local. Em `/tmp`, os repositórios somem no reboot |
| `PROJECT_WORKSPACES_ROOT` | `/tmp/brabo-project-workspaces` | worktrees dos agentes de projeto no modo **Container**. **Precisa ser o mesmo caminho no engine**, e o mesmo volume |
| `BRABO_PROJECTS_BASE` | vazio | a pasta única do host sob a qual moram os projetos no modo **Mounted**, montada por identidade em `api` e `engine`. Vazio é estado NORMAL: a api informa `projectsBase: null` e o assistente de projeto nem oferece o modo Mounted |
| `GITHUB_OAUTH_CLIENT_ID` / `_SECRET` | vazio | vazio = conexão OAuth com o GitHub indisponível (o PAT continua funcionando) |
| `GITLAB_OAUTH_CLIENT_ID` / `_SECRET` | vazio | idem |

#### Projeto no modo Mounted: uma base, montada por identidade

Desde o [ADR 0072](../adr/0072-projeto-local-ou-container.md), um projeto pode
nascer no modo **Mounted** (o antigo `local`, renomeado pelo
[ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md))
— o código mora numa pasta do usuário e `PROJECT_WORKSPACES_ROOT` **não
participa** da raiz dele.

O caminho de um projeto é dado do projeto (`projects.workspace_path`),
escolhido na criação e nunca variável de ambiente. O que o AMBIENTE fornece é a
**base** sob a qual essas pastas moram — `BRABO_PROJECTS_BASE`, uma por
instalação
([ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md),
[RN-500](../business-rules.md#rn-500)):

```bash
# .env — ABSOLUTO. `~` não é expandido pelo Compose.
BRABO_PROJECTS_BASE=/home/voce/projetos-brabo
```

Você não precisa escrever essa linha à mão. Desde o
[ADR 0146](../adr/0146-base-consentida-no-bootstrap.md), `pnpm bootstrap` →
**Docker › Base de projetos** roda `scripts/dev/consentir-base.mjs`, que
propõe `$HOME/projetos-brabo`, recusa o que se sobreponha ao checkout do Brabo
ou a `PROJECT_WORKSPACES_HOST_DIR` (duas raízes com donos opostos —
compartilhar uma pasta faria um projeto Mounted chamado `loja` cair em cima de
um projeto Container cujo `workspace_dir_name` também é `loja`), **prova** no
macOS e no Windows que o Docker enxerga mesmo a pasta montando-a, e só então
escreve a variável.

A prova é uma montagem, nunca a leitura do `settings.json` do Docker Desktop:
esse arquivo não é documentado, muda entre versões e plataformas, e descreve o
que o usuário configurou, não o que o daemon vai fazer — a mesma regra que o
produto já aplica aos providers de LLM, onde capability só é declarada quando
provada por execução. Ela tem **três** desfechos e eles não colapsam: provado,
recusado (a variável não é escrita) e *não deu para provar* — sem imagem local
para montar — que escreve a variável e diz em voz alta que a prova não rodou.

Rodado pelo menu, ele só **informa**: todo item do menu do bootstrap roda com
stdin de `/dev/null` de propósito, então não pode perguntar. Para escolher,
rode `node scripts/dev/consentir-base.mjs` no seu próprio terminal.

```yaml
# docker/docker-compose.yml — em `api` E `engine`, já escrito
    volumes:
      - ${BRABO_PROJECTS_BASE:-brabo_projects_base}:${BRABO_PROJECTS_BASE:-/data/brabo-projects-base}
```

O operador define isso **uma vez** e reinicia `api` + `engine`; nada é editado
por projeto, nunca. Antes disso, todo projeto montado precisava de uma linha de
bind-mount escrita à mão nos dois serviços e de um reinício — que mata todo
turno de agente, socket de terminal e chamada de LLM em voo na instalação.

A montagem é por **identidade** (`$X:$X`): o mesmo caminho absoluto no host e
dentro dos dois containers. É isso que mantém honesta a string que o usuário
digita e a tela mostra de volta, e é por isso que `projectScopeRoot` (api) e
`Engine.Actions.Workspace.workspace_dir/2` (engine) não precisam de camada de
tradução.

**Ela não é `PROJECT_WORKSPACES_HOST_DIR`, e nunca pode apontar para a mesma
pasta.** Um workspace gerenciado é nomeado por `workspace_dir_name` (UNIQUE) e
um projeto montado é nomeado pelo usuário, então `<base>/loja` e um projeto
container cuja pasta se chama `loja` colidiriam, com o bootstrap do repositório
rodando `git init` dentro do projeto de outra pessoa. O ADR tem os outros dois
motivos.

Com a variável **não definida**, o modo Mounted não é oferecido — nunca ofereça
um modo que a instalação não consegue honrar. E o `pnpm dev` **recusa subir**
quando a base se sobrepõe ao checkout do Brabo em qualquer sentido; essa
checagem mora no preflight porque ele roda no host, e a api só consegue
comparar com `process.cwd()` (`/workspace` dentro do próprio container). Veja o
[runbook](../runbook.md#projeto-no-modo-local).

### LLM

| variável | default | nota |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | — |
| `NINE_ROUTER_BASE_URL` | `http://host.docker.internal:20128/v1` | URL base do 9Router (provider `9router`, ADR 0222), que roda na máquina do dono, fora do compose. É da INSTALAÇÃO, não do workspace: o padrão só alcança o host porque os composes de instalação e de produção mapeiam `host.docker.internal:host-gateway` na api. Vale para as chamadas de chat, o catálogo e o teste de conexão da credencial |
| `OLLAMA_REQUEST_TIMEOUT_MS` | `300000` | teto de **inatividade** do socket do Ollama, não de duração total. Um modelo local tem latência até o primeiro token de outra ordem de grandeza, daí a variável própria; veja o [ambiente de inferência](../runbook.md#ambiente-de-inferencia) |
| `LLM_REQUEST_TIMEOUT_MS` | `300000` | o mesmo teto de inatividade para os providers de API (OpenAI e compatíveis, Anthropic). Vale para "nem mandou os cabeçalhos" e para "parou de mandar pedaços no meio do stream" — veja [providers de LLM](llm-providers.md#inactivity-ceiling) |
| `HUGGINGFACE_API_TOKEN` | *(não definida)* | token **opcional** do Hugging Face Hub para a busca de modelos (`GET /workspaces/:workspaceId/huggingface/models`). Presente, vai como `Authorization: Bearer …` e sobe o rate limit do Hub; ausente, o cabeçalho simplesmente não é enviado — o Hub aceita busca pública sem credencial, e token ausente nunca é erro |
| `HUGGINGFACE_HUB_URL` | `https://huggingface.co` | URL base do Hub com que a busca fala. Sobreposição para testes (um servidor HTTP falso numa porta efêmera); em produção fica sem definir |
| `HUGGINGFACE_REQUEST_TIMEOUT_MS` | `15000` | teto de **inatividade** da requisição de busca ao Hub, mesma semântica de `LLM_REQUEST_TIMEOUT_MS` (o nome é montado numa constante, então o inventário gerado abaixo não o vê) |

> **TODO(humano):** nenhum arquivo de compose mapeia as três variáveis `HUGGINGFACE_*` no `environment:` do serviço `api`, e o serviço não tem `env_file`, então defini-las no `.env` não tem efeito sob o Compose — `HUGGINGFACE_API_TOKEN` deve ser repassada (ao menos em produção e na instalação)?

### Grafo de conhecimento (ADR 0099)

| variável | default | nota |
|---|---|---|
| `NEO4J_URI` | — | ex.: `bolt://neo4j:7687`. **Esta é a chave**: vazia = grafo DESLIGADO, as rotas dependentes degradam (`GraphUnavailableError`/503) — ninguém precisa de um Neo4j local só para rodar a suíte. Em produção, a ausência de qualquer uma das três derruba o boot. Ligar o grafo em desenvolvimento é esta linha no `.env` e um reinício da api; até 2026-09-04 isso não fazia nada, porque o compose de dev não passava as três variáveis ao serviço `api` e o serviço não tem `env_file` — o `docker-compose.prod.yml` as fornecia desde o primeiro dia, por isso só o desenvolvimento era afetado |
| `NEO4J_USER` | `neo4j` (dev) | chega ao container com o mesmo default que o serviço `neo4j` usa para `NEO4J_AUTH`, então defina-a só para TROCAR o usuário — trocar ali troca os dois lados de uma vez. Dois defaults independentes deixariam a api autenticando com uma credencial que o servidor não tem mais |
| `NEO4J_PASSWORD` 🔒 | `dev-neo4j-password-change-me` (só dev) | mesma regra de pareamento de `NEO4J_USER`. **Sem default público em produção** de propósito — não há "valor de exemplo" plausível para senha de banco, e o `docker-compose.prod.yml` mantém `NEO4J_AUTH` vazio para que o próprio entrypoint da imagem oficial recuse subir em vez de subir com uma senha adivinhável |
| `GRAPH_PROJECTOR_INTERVAL_MS` | `2000` | período do poller que esvazia a fila `graph_projection` da outbox e escreve handoffs/hipóteses/perfis/interações no grafo (RN-416) |
| `CUSTO_RECONCILIACAO_INTERVAL_MS` | `300000` | período do job da api que troca a ESTIMATIVA de custo de uma chamada abortada pelo orçamento de raciocínio pelo custo real do `GET /generation` do OpenRouter ([RN-915](../business-rules/custo.md#rn-915)); `0` desliga |
| `ARTIFACT_PROJECTOR_INTERVAL_MS` | `2000` | período do poller que esvazia a fila `artifact_projection` da outbox e escreve os artefatos de cada agente como Markdown sob a pasta `docs/` do projeto ([RN-523](../business-rules.md#rn-523)). Projeção DERIVADA: o event log continua sendo a fonte, e a pasta pode ser apagada e reconstruída |

### Observabilidade

| variável | default | nota |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | **ausente desliga a EXPORTAÇÃO, não a instrumentação** (ADR 0035). O span continua sendo criado e o `trace_id` continua aparecendo no log — é isso que dá correlação em desenvolvimento, sem coletor. Sem ela, o span é descartado no fim em vez de sair do processo |
| `OTEL_SERVICE_NAME` | `brabo-api` | — |
| `OTEL_DIAG_LOG` | — | `1` liga o log de diagnóstico do próprio OTel |
| `LOG_LEVEL` | `info` em produção, `debug` fora | decide também o FORMATO junto com `NODE_ENV`: fora de produção o log sai legível (pino-pretty no processo, com a árvore de camadas); em produção, uma linha JSON por evento |
| `METRICS_GAUGE_INTERVAL_MS` | `15000` | período de coleta dos gauges de domínio |

---

## engine

### Essenciais

| variável | default | quando falha |
|---|---|---|
| `DATABASE_URL` | `ecto://brabo:brabo@localhost:5432/brabo` | note o esquema `ecto://`, não `postgres://` |
| `POSTGRES_HOST` / `_USER` / `_PASSWORD` | `localhost` / `brabo` / `brabo` | usadas quando o `DATABASE_URL` não é montado |
| `POOL_SIZE` | — | um pool esgotado trava o Oban e a fila para de ser consumida |
| `PORT` | `4000` | — |
| `PHX_HOST` / `PHX_SERVER` | — | `PHX_SERVER=true` é o que faz a release servir HTTP |
| `SECRET_KEY_BASE` 🔒 | — | obrigatória na release (`runtime.exs`, bloco `:prod`, o `raise` padrão do Phoenix). Até a RN-114, o `docker-compose.prod.yml` fornecia um literal público como fallback e mascarava esse `raise` — a variável sempre chegava DEFINIDA. O `raise` em si não mudou |
| `API_URL` | `http://localhost:3000` | o engine chama a api de volta por aqui |
| `ECTO_IPV6` | — | — |
| `SKIP_MIGRATIONS` | — | usada pelo Job de migration |

### Cluster e desligamento

| variável | default | nota |
|---|---|---|
| `DNS_CLUSTER_QUERY` | — | o Service headless que forma o cluster Erlang. **Sem ela cada réplica é uma ilha** e todo rollout drena tudo |
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | `45000` | janela do `preStop`. Sobe **junto** com `terminationGracePeriodSeconds`, nunca sozinha |
| `SESSION_HEARTBEAT_TIMEOUT_MS` | `30000` | quanto a sessão espera pelo heartbeat da aba antes de perguntar à api se há trabalho pendente |
| `SESSION_CONVERSATION_IDLE_TIMEOUT_MS` | `28800000` (8h) | teto de uma **conversa ociosa**: um agente conversacional esperando o usuário segura a sessão além do heartbeat por esse tempo, contado do fim do turno dele; passado isso a sessão fecha como `closed` com a causa `conversation_idle_timeout` ([RN-581](../business-rules.md#rn-581)). Mapeada para o engine nos três composes (dev, produção, instalação) com esse mesmo default; **não** escrita em `deploy/k8s/`, de propósito — nada ali intercepta o ambiente, então a ausência é o default, e mudá-la é um item `env:` no patch do engine do overlay |
| `RELEASE_NAME` / `RELEASE_NODE` | — | identidade do nó na distribuição |

### Harness

| variável | default | nota |
|---|---|---|
| `TOOL_LOOP_MAX_ITERATIONS` | `8` | teto de voltas do laço do agente **conversacional**. Esgotado, o agente termina com um artefato de bloqueio |
| `TOOL_LOOP_MAX_ITERATIONS_EXECUCAO` | `60` | teto dos **dev agents**. Maior porque eles exploram o repositório antes de escrever — e porque o `task_budget_micros` segura o gasto por baixo |
| `TOOL_LOOP_MAX_ITERATIONS_GATE` | `60` | teto dos subagentes de **QA**, pelo mesmo motivo |
| `DEFAULT_CONTEXT_WINDOW` | `128000` | usado quando o modelo não declara a janela (os agentes conversacionais nunca declaram); era `8192` até a RN-702 |
| `CONTEXT_COMPACTION_THRESHOLD` | `0.7` | fração da janela que dispara a compactação |
| `LLM_TURN_TIMEOUT_MS` | `300000` | 5 min por turno |
| `TOOL_ROUTER_TIMEOUT_MS` | `2000` | teto, em ms, de UMA chamada ao roteador de ferramentas Jev ([ADR 0179](../adr/0179-o-laco-pergunta-ao-jev-qual-ferramenta.md), [RN-625](../business-rules.md#rn-625)). Lida pela **api**, não pelo engine. Passado o teto, o passo cai no catálogo inteiro de ferramentas com `motivoDaQueda: timeout`; o turno nunca falha por causa do Jev. 0 de 328 requisições medidas passou de 2 000 ms. A chave liga/desliga é por workspace (`PUT workspaces/:id/tool-router`), não variável de ambiente |
| `TERMINAL_ACTION_TIMEOUT_MS` | `120000` | teto de um comando de terminal (2 min desde a [RN-757](../business-rules.md#rn-757): um `npm install` simples não cabia nos 15 s antigos). O engine espera esse valor + 90 s no `container-exec` e + 120 s no `propose_action` de uma ação `terminal`; acima de ~180 s a espera de fora passa do limite de 300 s de cabeçalhos do `fetch` do Node que a api usa para chamar `/internal/actions/execute` |
| `TERMINAL_OUTPUT_MAX_BYTES` | `32768` | teto em BYTES da saída de um comando ([RN-074](../business-rules/custo.md#rn-074)). A saída fica no histórico do laço e viaja em todo turno seguinte; sem teto, um `find` numa árvore grande derruba a execução inteira com um `413` do provider |
| `READ_FILE_MAX_BYTES` | `32768` | teto em BYTES do conteúdo lido por `read_file` ([RN-141](../business-rules/autenticacao.md#rn-141)) — a mesma classe de estouro da RN-074, pela porta do `read_file` em vez do terminal; variável independente, mesmo valor por coincidência de contexto |
| `SEARCH_WORKSPACE_MAX_BYTES` | `32768` | teto em BYTES do texto final de `search_workspace` ([RN-150](../business-rules/autenticacao.md#rn-150)) — a mesma classe de estouro da RN-074/RN-141, pela porta da busca; variável independente |
| `SEARCH_WORKSPACE_MAX_HITS` | `500` | teto do NÚMERO de ocorrências que `search_workspace` coleta antes de montar a resposta ([RN-150](../business-rules/autenticacao.md#rn-150)) — para de varrer/ler conteúdo assim que bate o teto, evitando pagar I/O numa árvore com ocorrências demais só para truncar por bytes depois |
| `SECOPS_SCAN_TIMEOUT_MS` | `180000` | 3 min para o scanner do SecOps |
| `TRANSPORT_MAX_BODY_BYTES` | `8388608` (8 MiB) | teto de TRANSPORTE que a compactação de contexto respeita por cima da janela do modelo ([RN-412](../business-rules.md#rn-412)) — a janela efetiva é `min(context_window, este teto convertido em tokens)`, então a compactação dispara ANTES de o corpo estourar o limite HTTP da api, não só quando o modelo "esqueceria" |
| `GRAPH_INSTRUCTION_TEMPLATES_ENABLED` | `false` | liga a fonte `:graph` de `InstructionFiles` — hoje só a identidade do ux-designer resolve um template do grafo antes do texto inline (RN-413). Nome PRÓPRIO, não o `GRAPH_TEMPLATES_ENABLED` abaixo — as duas colidiriam com defaults opostos se dividissem a chave |

### Psicólogo

| variável | default | nota |
|---|---|---|
| `PSYCHOLOGIST_ENABLED` | `false` | pausa GLOBAL de rodadas NOVAS (automáticas e sob demanda) — decisão de produto do usuário em 2026-08-10, não bug, mesma forma de flag de `ANAMNESE_ENABLED` abaixo (que foi religada na [RN-680](../business-rules.md#rn-680); esta não). Não apaga nada que já exista. Ligá-la exige reiniciar o engine ([RN-117](../business-rules/autenticacao.md#rn-117)). Nenhuma chave de boot faz par com ela: o gatilho automático do Psicólogo é o fechamento da sessão, não um tick |
| `PSYCHOLOGIST_TRIAGE_THRESHOLD` | `20` | eventos na sessão que separam a análise **leve** da **pesada** |
| `PSYCHOLOGIST_MAX_ITERATIONS_LEVE` / `_PESADA` | `4` / `8` | — |
| `PSYCHOLOGIST_BUDGET_MICROS_LEVE` / `_PESADA` | `50000` / `300000` | USD 0,05 e USD 0,30 por análise |
| `PSYCHOLOGIST_MAX_PROMPT_EVENTS_LEVE` / `_PESADA` | `50` / `400` | quantos eventos entram no prompt |
| `PSYCHOLOGIST_MAX_PAYLOAD_CHARS` | `600` | truncamento do payload de cada evento |
| `PSYCHOLOGIST_RAG_TOP_K` | `3` | quantos trechos relevantes do `rag_search` entram no contexto, descontados do teto de eventos recentes acima ([RN-417](../business-rules.md#rn-417)) |
| `GRAPH_TEMPLATES_ENABLED` | `false` | liga a resolução de `psychologist-kickoff`/`anamnese-kickoff`/`context-manager-summarize` como template do grafo — chave COMPARTILHADA entre Psicólogo, Anamnese e o prompt de sumarização do `ContextManager` ([RN-417](../business-rules.md#rn-417)), não confundir com `GRAPH_INSTRUCTION_TEMPLATES_ENABLED` acima. Desligada (o default) quer dizer que a API do grafo nem é chamada; ligada, qualquer falha cai no texto inline sem erro |

### Anamnese

| variável | default | nota |
|---|---|---|
| `ANAMNESE_ENABLED` | `true` | flag de produto: pode acontecer uma rodada NOVA (periódica e sob demanda). `false` é uma pausa GLOBAL que não apaga nada ([RN-115](../business-rules/autenticacao.md#rn-115)); mudá-la exige reiniciar o engine. Foi `false` de 2026-08-10 (a pausa do usuário) até o dono religar a Anamnese com correções em 2026-10-01 ([RN-680](../business-rules.md#rn-680)): rodada sem sujeito elegível — membro efetivo do projeto com interação própria na janela — não faz chamada de LLM. **Sozinha não basta para a rodada PERIÓDICA**: `START_ANAMNESE` (chave de boot, abaixo) também precisa ser `true`, e as duas respondem perguntas diferentes |
| `ANAMNESE_INTERVAL_SECONDS` | `900` | 15 min entre rodadas |
| `ANAMNESE_MIN_EVENTS` | `10` | abaixo disso não roda — evita traçar perfil sobre ruído |
| `ANAMNESE_INITIAL_WINDOW_DAYS` | `30` | janela da primeira rodada |
| `ANAMNESE_MAX_ITERATIONS` | `6` | — |
| `ANAMNESE_BUDGET_MICROS` | `200000` | USD 0,20 por rodada |
| `ANAMNESE_MAX_PROMPT_EVENTS` | `500` | — |
| `ANAMNESE_MAX_PAYLOAD_CHARS` | `600` | — |

### Guardas de carga

| variável | default | nota |
|---|---|---|
| `START_OUTBOX_DRAIN` | `true` | chave de boot do drain da outbox (`Engine.Workers.OutboxDrainWorker`, a cada 2s) — o ÚNICO consumidor dos eventos `session`/`task`/`container` que a api escreve na outbox — mais a poda de worktree órfão e a adoção de sessão órfã. Desligada, ninguém entrega esses eventos: sessão que a api fechou continua com o processo e os agentes conversacionais rodando ([RN-581](../business-rules.md#rn-581)), e dev agent esperando decisão de ação, gate, a PR dele ou o container chegar a `running` nunca acorda. Ela NÃO liga o Psicólogo: o drain só o enfileira com `PSYCHOLOGIST_ENABLED=true`. `false` só no compose de produção (`docker-compose.prod.yml`), de propósito; o compose de instalação usa o `true` do código desde a AT-219 |
| `START_ANAMNESE` | `true` | guarda de CARGA de teste/dev: impede que `kickoff/0` sequer seja chamado no boot, mas não decide nada de produto — não confundir com `ANAMNESE_ENABLED` (produto: pausa GLOBAL, sobrevive a qualquer valor desta). Desligá-la impede enfileiramentos **novos**, **não limpa a fila**. Os jobs acumulados rodam no próximo boot — a fila precisa ser expurgada. Veja o [ambiente de inferência](../runbook.md#ambiente-de-inferencia) |
| `START_MODEL_SYNC` | `true` | tick periódico da sincronização do catálogo de modelos. Desligá-lo não congela nada: o botão "Atualizar catálogo" da página Providers chama o mesmo caso de uso ([RN-043](../business-rules/custo.md#rn-043)) |
| `MODEL_SYNC_INTERVAL_SECONDS` | `21600` (6h) | o catálogo de um provider muda em escala de dias, e cada rodada gasta uma chamada de API por provider — daí o default generoso |
| `START_GATE_RESCUE` | `true` | tick periódico do resgate de ciclo de gate (`Engine.Gates.GateRescuer`, [RN-140](../business-rules.md#rn-140)). Desligá-lo não muda o boot: o resgate roda ali uma vez de qualquer jeito |
| `GATE_RESCUE_INTERVAL_SECONDS` | `300` (5 min) | um gate travado bloqueia a PR inteira do usuário — intervalo bem mais curto que o da Anamnese/sincronização de modelos, e cada tick custa só uma consulta quase sempre vazia |
| `GATE_RESCUE_STALE_AFTER_SECONDS` | `900` (15 min) | generoso de propósito: o ToolLoop de um subagente de QA pode legitimamente rodar até `TOOL_LOOP_MAX_ITERATIONS_GATE` (60) iterações, e um limiar curto resgataria — e duplicaria — um ciclo apenas lento |

### Tráfego interno e observabilidade

| variável | default |
|---|---|
| `BRABO_SERVICE_TOKEN` 🔒 | `dev-service-token-change-me` **só fora de produção** — **o mesmo valor da api**. O espaço em volta é aparado, e um valor só de espaço conta como ausente. Numa release `:prod` o engine recusa subir se ele falta, se é o default público acima ou se tem menos de 16 caracteres, nomeando a variável — a mesma regra da api ([RN-601](../business-rules/autenticacao.md#rn-601)) |
| `BRABO_SERVICE_TOKEN_PREVIOUS` 🔒 | — aceito só para verificação, durante a rotação. Aparado; numa release `:prod` o engine recusa subir se ele é o default público ou tem menos de 16 caracteres. Nunca obrigatório, e igual ao atual quer dizer que não há rotação ([RN-601](../business-rules/autenticacao.md#rn-601)) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — o exportador Elixir fala **HTTP/protobuf na 4318**, não gRPC na 4317. Ausente desliga só a exportação (`traces_exporter: :none`), não a instrumentação — veja o ADR 0035 |
| `WEB_ORIGIN` | — **a mesma variável da api**, e aqui ela alimenta DUAS coisas: o `check_origin` do socket Phoenix (o painel do time ao vivo) e o CORS HTTP das rotas de saúde, que o navegador precisa para ler `/health` ([ADR 0037](../adr/0037-cors-do-engine-e-a-porta-como-contrato.md)). Ausente em produção fecha o CORS e mantém o `check_origin` no default estrito do Phoenix — o engine **sobe mesmo assim**, diferente da api |
| `PROJECT_WORKSPACES_ROOT` | `/tmp/brabo-project-workspaces` — **a mesma da api, no mesmo volume** |

> `SOME_APP_SSL_CERT_PATH`, `SOME_APP_SSL_KEY_PATH` e `MIX_TEST_PARTITION`
> são sobras do scaffold do Phoenix e da configuração de teste. Não as
> configure.

---

## web

O web é estático, servido pelo nginx. Ele lê a configuração de **duas**
fontes, e a distinção importa:

| fonte | quando | como |
|---|---|---|
| `import.meta.env.VITE_*` | **build** | embutida no bundle. Mudar exige rebuild |
| `window.__BRABO_CONFIG__` | **runtime** | servida em `/config.js`, gerado pelo entrypoint do container |

Por isso a mesma imagem serve todo ambiente: o `/config.js` é reescrito no
boot. As `VITE_*` são o fallback de desenvolvimento.

| variável | serve para |
|---|---|
| `VITE_API_URL` | endereço da api |
| `VITE_ENGINE_URL` | endereço do engine (canal Phoenix) |
| `VITE_LOG_LEVEL` | nível do logger JSON do navegador (default `info`). Num cluster manda a chave `WEB_LOG_LEVEL` do `brabo-config`, que o entrypoint escreve no `/config.js` — `VITE_*` só conta num build local |
| `VITE_BRABO_VERSION` | versão mostrada no rodapé das telas de auth (default `dev`). **A única que é de build por escolha, não por limitação** — veja abaixo |

Página em branco depois do deploy é quase sempre o `/config.js` apontando para
`localhost` — o smoke do deploy confere exatamente isso.

### Por que a versão não passa pelo `/config.js`

URLs são do **ambiente**: a mesma imagem precisa falar com a api de staging e
com a de produção, e é para isso que o `/config.js` existe (ADR 0024). A versão
é do **artefato** — a imagem `brabo-web:1.1.2` não deveria conseguir informar
outra coisa. Se viesse do `/config.js`, o rodapé viraria um campo editável em
vez de uma identidade, e um ConfigMap errado faria a tela mentir sobre qual
build está rodando.

O caminho inteiro, do commit à tela: o `release.yml` calcula
`versao=${TAG#v}` → passa como `VERSION` ao `docker buildx bake` → o alvo
`web` do `docker-bake.hcl` a converte em `VITE_BRABO_VERSION` → o
`ARG`/`ENV` do `docker/web/Dockerfile.prod` a expõe ao `pnpm build` → o Vite a
embute em `import.meta.env` → o `runtime-config.ts` a lê → o `AuthLayout` a
mostra. O mesmo `VERSION` alimenta o `BRABO_VERSION` da imagem da api
(ADR 0036).

---

## Backup

Consumidas pela imagem de backup, não pelas apps — como CronJob no Kubernetes e
como `docker compose run --rm backup …` numa instalação por compose. Detalhes
em [Restauração](../runbook.md#restore); o raciocínio está no
[ADR 0152](../adr/0152-backup-de-volumes-contra-compose.md).

**O destino é um de dois, e a escolha é `BACKUP_DIR`.** Defina-a e o backup vai
para disco; deixe-a vazia e ele vai para o S3, que é o que o CronJob do
Kubernetes faz. As cinco variáveis `BACKUP_S3_*` deixaram de ser obrigatórias
incondicionalmente: elas são a configuração de *um* destino, e exigir um bucket
antes de poder migrar exige uma infraestrutura que uma instalação de máquina
única nunca pediu.

| variável | default | nota |
|---|---|---|
| `BACKUP_DIR` | — (S3) | **diretório** de destino. Definida ⇒ disco; vazia ⇒ S3. No serviço do compose o default é `/backups` |
| `BRABO_BACKUP_HOST_DIR` | `backup_local` (volume nomeado) | caminho do host montado em `/backups`. O default de volume nomeado serve para verificar um backup; é o destino **errado** para migrar, porque `docker compose down -v` o apaga junto com o que ele devia salvar |
| `BACKUP_S3_ENDPOINT` / `BACKUP_S3_BUCKET` | — | destino compatível com S3; obrigatórias só quando `BACKUP_DIR` está vazia |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | — | credencial do bucket |
| `BACKUP_KEEP_DAILY` | `7` | retenção por **contagem**, não por idade |
| `BACKUP_KEEP_WEEKLY` | `4` | — |
| `GIT_REPOS_DIR` | `/data/git-repos` | os repositórios bare dos projetos do provider `local`. Ausente ⇒ o passo é **pulado e dito** (o CronJob do Kubernetes não monta esse volume) |
| `RESTORE_DB` | — | nome do banco de destino da restauração |
| `RESTORE_PREFIX` | `daily/` | `weekly/` para restaurar de uma cópia semanal |
| `RESTORE_GIT_PREFIX` | `git-daily/` | `git-weekly/` para a cópia semanal dos repositórios bare |
| `RESTORE_GIT_FORCE` | — | `1` permite extrair **por cima** de repositórios bare existentes. Desligada por padrão: sobrepor dois estados de repositório produz uma mistura de que nenhum `git` reclama |
| `RESTORE_ADMIN_URL` | — | conexão com permissão `CREATEDB`; em produção é separada do `DATABASE_URL` |

Quatro prefixos, não dois: `daily/` e `weekly/` guardam os dumps do Postgres,
`git-daily/` e `git-weekly/` os arquivos dos repositórios bare. Ficam separados
porque a retenção é por **contagem** — duas espécies de arquivo sob um prefixo
fariam "guardar 7" significar três backups e meio.

## Inferência local (containers)

Estas não são lidas pelo nosso código — são do container `ollama`, e estão aqui
porque são a causa mais frequente de um agente se comportar de forma estranha.
A tabela de sintomas está no
[ambiente de inferência](../runbook.md#ambiente-de-inferencia).

| variável | por quê |
|---|---|
| `OLLAMA_CONTEXT_LENGTH` | o default de 4096 trunca **em silêncio** um prompt montado para 128k |
| `OLLAMA_MAX_LOADED_MODELS` | com `OLLAMA_KEEP_ALIVE` alto, os modelos se acumulam até a memória estourar |
| `OLLAMA_KEEP_ALIVE` | quanto tempo o modelo fica residente |
| `DEMO_QA_MODEL` | aponta o gate de QA para um modelo de API — o binding por agente vence o do projeto |

> **A versão da imagem `ollama` não é variável — é digest.** Como toda imagem
> de terceiro em `docker/`, ela é pinada como
> `ollama/ollama:0.40.6@sha256:…`
> ([ADR 0159](../adr/0159-imagem-de-terceiro-por-digest.md), tag inline desde o
> [ADR 0178](../adr/0178-tag-inline-na-imagem-de-terceiro.md)), e o mesmo
> digest é usado por `ci.yml`/`golden-set-rag.yml`, porque o piso do
> golden-set do RAG é chaveado pelo modelo e não pelo ambiente
> ([ADR 0138](../adr/0138-golden-set-do-rag-em-ci-agendado.md)). Então um
> comportamento de inferência que mudou entre dois `docker compose pull` deixou
> de ser causa possível: nada se move a não ser que alguém edite o digest.
> Subir a versão é [um procedimento do runbook](../runbook.md#subindo-imagem-de-terceiro),
> e o `scripts/ci/imagens-pinadas.ts` recusa uma subida que alcance só parte
> dos lugares onde a tag aparece.

---

## Observabilidade local (containers)

Também não lidas pelo nosso código: são as portas do overlay
`docker/docker-compose.observability.yml`, que sobe Prometheus, Loki e Grafana
ao lado da stack de desenvolvimento (`pnpm dev:obs`). O mecanismo está em
[observabilidade local](../runbook.md#observabilidade-local).

| variável | default | por quê |
|---|---|---|
| `GRAFANA_PORT` | `3001` | a mesma porta que o Grafana do cluster usa; os dois **não coexistem**, pelo mesmo motivo de `pnpm dev` e `make deploy-local` não coexistirem |
| `PROMETHEUS_PORT` | `9090` | a porta que o runbook já usa no `kubectl port-forward` do cluster |
| `LOKI_PORT` | `3100` | só para consultar direto; o caminho normal é pelo Grafana |

O overlay **não** define `OTEL_EXPORTER_OTLP_ENDPOINT`: sem um Collector no
meio, apontar as apps para um endereço que não existe só produz um erro de
exportação a cada turno
([ADR 0035](../adr/0035-observabilidade-legivel-e-trace-sem-coletor.md)
separou instrumentar de exportar exatamente por isso). Métricas e logs
funcionam sem ela; traces ainda exigem o cluster.

---

## Broker de containers

O broker ([ADR 0130](../adr/0130-broker-de-container.md)) é o único processo do
produto que fala com um daemon Docker no servidor, e o único serviço com
`/var/run/docker.sock` montado. **Localmente ele sobe com o `pnpm dev`; em
produção fica sob `profiles: ["container-broker"]`.** Os dois arquivos de
compose divergem de propósito ([ADR 0146](../adr/0146-base-consentida-no-bootstrap.md),
ponto 3) — não os uniformize.

Ele já foi desligado por padrão nos dois, sob o argumento de que nada o chamava
ainda. Essa premissa morreu: ele tem quatro chamadores reais, e o
[ADR 0144](../adr/0144-a-segunda-raiz-do-broker.md) fez o modo **Mounted** subir
o container pelo broker — então, com o profile desligado, o modo local padrão
terminava em `BrokerIndisponivelError`. O que sustenta a assimetria é o que o
socket significa de cada lado: quem roda `pnpm dev` já o tem (está rodando
`docker compose`), enquanto em produção ele é uma fronteira real de privilégio e
o operador não é o desenvolvedor.

Isso muda **quando** o broker roda, nunca **o que** ele aceita: as cinco
camadas de contenção estão intactas, e ele continua recebendo um `projectId`
mais uma de cinco operações, sem parâmetro em lugar nenhum onde escrever
`privileged` ou um `-v` livre.

Subir por padrão foi o que expôs um defeito que nunca tinha importado: a imagem
local instalava as dependências no START, e a única rede do broker é
`internal: true`, então não há registry a alcançar — o container morria com
`getaddrinfo EAI_AGAIN registry.npmjs.org`, e sem healthcheck o `up --wait`
ainda imprimia `Healthy`. As dependências agora se instalam no BUILD e o
serviço tem healthcheck; a rede não foi tocada, e não deve ser. O detalhe
operacional mora no [runbook](../runbook.md#broker-de-container).

Em produção, suba-o explicitamente:

```bash
docker compose -f docker/docker-compose.prod.yml \
  --profile container-broker up -d broker
```

| variável | default | quando falha |
|---|---|---|
| `BROKER_URL` | `http://broker:8090` no compose de **dev**; vazia em produção e na instalação (lida pela **api**) | Vazia é estado NORMAL: quem lê o estado observado de um container diz então "não observado" em vez de herdar o registrado ([RN-486](../business-rules.md#rn-486)), e a api responde `brokerConfigurado: false`, então a criação de projeto só oferece `runner` ([RN-573](../business-rules.md#rn-573)). Localmente o broker sobe por padrão, então o compose de dev a aponta por default para o serviço que ele sobe ([RN-599](../business-rules.md#rn-599)) — um valor no `.env` ainda vence. Os composes de produção e de instalação não têm default de propósito: ali o broker fica sob profile, e quem o liga escreve a URL |
| `BROKER_PORT` | `8090` | Porta em que o broker escuta. Ele NÃO publica nada no host — só a api o alcança, pela rede `internal: true` do compose |
| `BRABO_SERVICE_TOKEN` 🔒 | `dev-service-token-change-me` em desenvolvimento | O MESMO segredo de api ↔ engine, no mesmo cabeçalho. Com `NODE_ENV=production` o broker recusa subir quando ele está vazio, quando é o literal público do repositório ou com menos de 16 caracteres — a regra da RN-114, que aqui guarda um processo que fala com o Docker do host. `BRABO_SERVICE_TOKEN_PREVIOUS`, quando definido, passa pela mesma regra salvo a obrigatoriedade: aparado, e em produção o broker recusa subir se ele é o literal público ou tem menos de 16 caracteres ([RN-601](../business-rules/autenticacao.md#rn-601)) |
| `API_URL` | `http://api:3000` | De onde o broker LÊ a decisão do Arquiteto. Ele não recebe uma especificação de container; ele vem buscá-la ([RN-485](../business-rules.md#rn-485)) |
| `PROJECT_WORKSPACES_HOST_ROOT` | — | A raiz das pastas de projeto **no HOST**, não dentro de container nenhum. Sem ela, `start` recusa nomeando esta variável e as outras quatro operações continuam funcionando. Não a confunda com `PROJECT_WORKSPACES_ROOT`, que é o caminho dentro dos containers: o `-v` é resolvido pelo DAEMON contra o sistema de arquivos do host, e um caminho de dentro da api o faria criar e montar uma pasta VAZIA |
| `DOCKER_GID` | `999` (compose) | O gid do grupo `docker` do host (`getent group docker \| cut -d: -f3`). O socket é `root:docker` e o broker roda sem root, então o compose usa `group_add`. O default é o mais comum e está errado em várias distribuições. Desde o [ADR 0146](../adr/0146-base-consentida-no-bootstrap.md) isso importa em TODA máquina de desenvolvimento, não só onde alguém ligou o profile — errar não quebra o boot, quebra o uso: toda operação morre com "permission denied" no socket, e isso só aparece quando alguém propõe `container_start`. O `pnpm dev` informa o estado desta variável a cada execução ([RN-512](../business-rules.md#rn-512)), e diz "não se aplica" numa máquina sem grupo `docker` em vez de acusá-la |

`PROJECT_WORKSPACES_HOST_ROOT` não pode ser derivada de um volume Docker
gerenciado. No compose de **dev** ela deriva de `PROJECT_WORKSPACES_HOST_DIR`
(acima) — então deixar essa sem definir, o estado de um `.env.example` recém
copiado, deixa o broker sem raiz e o modo `container` sem container: a stack
sobe saudável e o `container_start` termina recusado. O `pnpm dev` informa isso
a cada execução, no mesmo molde do `DOCKER_GID`, e nunca recusa subir
([RN-599](../business-rules.md#rn-599)). Ele informa também o caso do `~`: o
Compose expande `~` na origem do bind-mount que `api`/`engine` usam, mas NÃO na
variável que o broker recebe (medido com `docker compose config`), então
escreva o caminho JÁ EXPANDIDO. E um `PROJECT_WORKSPACES_HOST_ROOT` explícito
que difere da pasta que `api`/`engine` montam é informado como divergente — o
container receberia uma pasta em que os agentes nunca escreveram. Trocar o
volume gerenciado por uma pasta do host não migra o que já está no volume
`project_workspaces`: os dados ficam lá, só deixam de ser o que `api` e
`engine` enxergam.

`BRABO_PROJECTS_HOST_BASE` é a SEGUNDA raiz do broker — a base dos projetos
**Mounted**, também no host
([ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md),
[ADR 0144](../adr/0144-a-segunda-raiz-do-broker.md)). Diferente da de cima, ela
não precisa ser preenchida: o compose a deriva de `BRABO_PROJECTS_BASE`, que já
é um caminho do host por definição (é o que `api` e `engine` montam por
identidade). Defina-a explicitamente só se o daemon Docker alcança essa pasta
por outro caminho.

É ela que permite a um projeto **Mounted** ter container
([RN-503](../business-rules.md#rn-503)): a api envia um localizador
discriminado (`localizacao.tipo` — `gerenciada` ou `montada`) mais o segmento
relativo, e o broker o resolve contra a raiz correspondente. As duas raízes
nunca se substituem. Faltar esta faz o `start` de um projeto `mounted` recusar
com **503**, NOMEANDO a variável, sem tocar em container — cair em
`PROJECT_WORKSPACES_HOST_ROOT` montaria a pasta de outro projeto, porque a raiz
gerenciada é nomeada por `workspace_dir_name` e a base é nomeada pelo usuário.


---

## Usuário dos containers de dev (build) {#dev-container-user-build-time}

Também não lidas pelo nosso código, e nem são variável de ambiente de
*runtime*: são `build.args` do Docker para as três imagens de dev
(`docker/api/Dockerfile`, `docker/web/Dockerfile`, `docker/engine/Dockerfile`),
consultados uma vez no `docker compose build` e embutidos no `USER` com que
cada container roda. Existem para que os containers rodem com o **mesmo
UID/GID do seu usuário do host** em vez de root — tudo o que é escrito num bind
mount (`apps/api/dist`, um workspace de projeto no modo de execução `mounted`)
já é seu, sem `sudo chown` depois.

| variável | default | por quê |
|---|---|---|
| `DEV_UID` | `1000` | o seu `id -u`. NÃO é lido do `${UID}` do shell — ele é somente leitura no bash e não é exportado para o ambiente por padrão, então o arquivo de compose sempre o veria vazio |
| `DEV_GID` | `1000` | o seu `id -g`, mesmo raciocínio |

`1000`/`1000` casa com a configuração Linux mais comum de um desenvolvedor só e
com o usuário `node` que o `node:26-alpine` (a imagem base de `api`/`web`) já
traz — quando o seu par casa, os Dockerfiles reaproveitam esse usuário em vez
de criar um novo. Um ambiente que já tem containers rodando como root de antes
dessa mudança precisa de um `chown` único dos volumes nomeados
`node_modules`/`_build`/`deps`/`.mix`/`.hex` (ou de `docker compose down -v`
para deixá-los ser recriados) — veja a nota em
[Primeiros passos](../getting-started.md).

Os composes de produção e de instalação são diferentes: o engine roda da
imagem de produção como o usuário fixo `engine` (uid/gid `1000`, sem
`DEV_UID`), com `read_only: true` e um tmpfs em `/home/engine`. Esse tmpfs é
declarado `uid=1000,gid=1000,mode=0700` — não é variável — porque o semgrep (o
gate de SecOps) escreve `~/.semgrep` ali; criado como root, o scan não devolve
nada e o gate aprova sem análise estática
([RN-707](../business-rules.md#rn-707), runbook
[O gate de SecOps está preso em "SAST não rodou"](../runbook.md#semgrep-do-gate)).

As duas imagens do engine pinam o semgrep com o argumento de build
`SEMGREP_VERSION` (`1.171.0`, o mesmo em `docker/engine/Dockerfile` e
`Dockerfile.prod`, mantidos iguais por `scripts/ci/semgrep-do-engine.spec.ts`).
É argumento de build, não variável de runtime — nada vai no `.env`. Sem pin, o
pip pegou a 1.179.0, que não publica wheel `musllinux`: na imagem Alpine o
pacote vinha do sdist sem `semgrep-core` e todo scan falhava. Subir a versão é
escolher uma release com wheel `musllinux` no PyPI e mudar os dois Dockerfiles
no mesmo PR.

As imagens do engine rodam **Elixir 1.20.4 / OTP 29.1.1** sobre Alpine 3.24
(builder `hexpm/elixir:1.20.4-erlang-29.1.1-alpine-3.24.2`, runtime
`alpine:3.24.3`, as duas por digest — [ADR 0209](../adr/0209-engine-em-otp-29.md)).
OTP abaixo de 29.1 aborta no boot sob a musl 1.2.6 do Alpine 3.24 em hosts
cuja CPU tem AMX (`sys_sigaltstack(): Internal error`); não desça o OTP sem
descer a musl. Nada vai no `.env`.

Nenhum dos seis Dockerfiles usa corepack (o Node 25+ não o traz mais, AT-360):
o build instala o pnpm do tarball do registry, conferido contra um sha512
escrito no próprio Dockerfile — os argumentos de build `PNPM_VERSION`
(`11.3.0`, o mesmo do `packageManager` em `package.json`, para o pnpm nunca
tentar baixar outra versão em runtime) e `PNPM_SHA512`. São argumentos de
build, não variáveis de runtime, e não há nada a definir no `.env`: subir o
pnpm é mudar o `packageManager`, o `PNPM_VERSION` dos workflows e os dois
argumentos nos seis Dockerfiles no mesmo PR — veja a seção do runbook sobre a
imagem do broker.

---

## Variáveis de ferramenta (não do produto)

Tudo acima é **produto**: o que quem opera uma instalação define no `.env` do
deploy. O que segue é **ferramenta** — lido só pelo CI e por quem desenvolve o
Brabo. Nada disso pertence ao `.env` de um operador, e essa distinção é o
motivo de o inventário abaixo marcar cada fonte.

### Scripts de demonstração e seed — `apps/api/scripts/`

Eles conduzem agentes reais contra um Ollama local, então o que recebem é um
**nome de modelo** e um **prazo**. Todos têm default e nenhum é obrigatório.

| variável | default | o que muda |
|---|---|---|
| `DEMO_MODEL` | `qwen2.5-coder:7b` | o modelo que todo script de demonstração usa, a não ser que um dos abaixo o sobreponha para um papel específico |
| `DEMO_QA_MODEL` | `DEMO_MODEL` | só o agente de QA, nas demonstrações dos gates de PR — para julgar com um modelo diferente do que escreveu o código |
| `DEMO_WORKFLOWS_MODEL` | `DEMO_MODEL` | só o agente de Infra na demonstração de workflows do GitHub |
| `DEMO_MODEL_LEVE` | `qwen2.5-coder:7b` | o modelo **leve** do Psicólogo (o que a passada barata usa) |
| `DEMO_MODEL_PESADO` | `qwen-psicologo-pesado:latest` | o modelo **pesado** do Psicólogo. É uma variante de `Modelfile` local, não uma tag publicada — daí a de baixo |
| `DEMO_OLLAMA_COPY_FROM` | `qwen2.5-coder:7b` | a base de que a demonstração copia quando precisa criar o modelo pesado no Ollama local |
| `DEMO_TIMEOUT_MS` | `1800000` (30 min); `900000` na demonstração de dev agent | quanto o script espera a execução terminar antes de desistir |
| `DEMO_ANAMNESE_TIMEOUT_MS` | `900000` (15 min) | o mesmo prazo, para a demonstração da Anamnese |
| `DEMO_PSICOLOGO_TIMEOUT_MS` | `600000` (10 min) | o mesmo prazo, para a demonstração do Psicólogo |
| `GOLDEN_SET_QA_MODEL` | `qwen2.5-coder:latest` | o modelo que `seed-golden-set-qa.ts` registra como juiz do golden-set de QA ([ADR 0123](../adr/0123-golden-set-regressao-qa-automacao.md)) |

`NOME`, que o inventário abaixo lista sob esta fonte, **não é variável**: é o
literal `process.env.NOME` dentro de uma string de prompt em
`demo-pr-gates.ts`, ensinando o agente a substituir um segredo fixo no código.
O inventário extrai por padrão e não tem como distinguir uma menção de uma
leitura — ele está listado aqui em vez de filtrado na fonte, porque uma lista
de ignorados nome a nome é um segundo lugar a manter em dia.

### E2E de navegador — `e2e/`

`e2e/` não é membro do workspace ([ADR 0120](../adr/0120-e2e-de-navegador-contra-o-compose-de-producao.md)) e roda contra o
**compose de produção**, por isso os endereços dele são as portas publicadas e
não as de dev. As credenciais são as da conta do seed — as mesmas que o
`docker/smoke.sh` cria. O inventário varre todo `.ts` sob `e2e/`, **inclusive
os specs do Playwright** — ali o spec é o código que lê o ambiente, não um
teste unitário ao lado dele (AT-124).

| variável | default | o que muda |
|---|---|---|
| `E2E_API_URL` | `http://localhost:3000` | onde o suporte HTTP da suíte bate na api |
| `E2E_WEB_URL` | `http://localhost:8088` | o `baseURL` que o Playwright abre, e a origem de que depende a asserção de CSRF |
| `E2E_USER` | `owner@brabo.dev` | a conta com que a suíte entra |
| `E2E_PASSWORD` | a senha do seed fixa em `e2e/suporte/api.ts` | a senha dessa conta. É a senha de um **seed local**, nunca uma real — não é repetida aqui para que a única cópia continue sendo a do código |


### Cluster local e provas agendadas — `deploy/k8s/`

O bootstrap (`make deploy-local`) e as provas de propriedade que o
`.github/workflows/propriedades.yml` roda toda semana leem estas do ambiente.
Todas têm default; nenhuma pertence ao `.env` de uma instalação. O inventário
varre todo `deploy/k8s/*.sh` e casa só a expansão com default (`${X:-…}`), que
é como um script de shell lê uma variável de fora (AT-212).

| variável | default | o que muda |
|---|---|---|
| `BRABO_CLUSTER_NAME` | `brabo` | o nome do cluster k3d/kind que o bootstrap cria ou reaproveita |
| `BRABO_CLUSTER_TOOL` | `k3d` | `kind` troca o bootstrap para o kind — que ignora NetworkPolicy em silêncio, daí o k3d como default |
| `BRABO_KEEP_CLUSTER` | não definida | `1` reaproveita um cluster existente com o mesmo nome em vez de apagá-lo e recriá-lo |
| `BRABO_SKIP_BUILD` | não definida | `1` pula o build das imagens de produção e usa as que já estão no daemon Docker |
| `BRABO_SKIP_OBSERVABILITY` | não definida | `1` pula Tempo, Loki, Collector, Alloy e Grafana (Prometheus e o adapter ficam: o HPA do engine os lê). Só o `propriedades.yml` a define (AT-177) |
| `TAG` | não definida | uma tag de release (`vX.Y.Z-qa.N`) para o bootstrap fazer checkout e deploy em vez da árvore de trabalho; exige árvore limpa |
| `BRABO_NAMESPACE` | `brabo` | o namespace com que todo script de prova fala |
| `API_URL` / `ENGINE_URL` / `WEB_URL` | `http://localhost:3000` / `:4000` / `:8088` | onde os scripts de prova alcançam os serviços do cluster — as portas que o load balancer do k3d publica. Mesmos nomes das variáveis de produto acima, outro leitor: aqui são só o alvo dos scripts |
| `SMOKE_USER` | `owner@brabo.dev` | a conta com que o smoke e as provas entram |
| `BRABO_SMOKE_PASSWORD` | a senha local do seed, fixa nos scripts | a senha dessa conta — também o que o bootstrap passa ao pod do seed como `BRABO_SEED_PASSWORD` |
| `HPA_JOBS` | `60` | quantos jobs de sonda o `make hpa-test` enfileira para fazer o engine escalar |
| `HPA_TIMEOUT` | `240` | segundos que o `make hpa-test` espera pelo scale-up |
| `ROLLOUT_SESSIONS` | `5` | quantas sessões o `make rollout-test` abre antes do rollout |
| `ROLLOUT_CONVERGENCE_SECONDS` | `120` | o teto para toda sessão ser adotada ou drenada depois do rollout. Não o suba para virar verde uma rodada vermelha (veja a lacuna da sessão órfã no `CLAUDE.md`) |
| `ROLLOUT_EVIDENCE_DIR` | um `mktemp -d` | onde o `make rollout-test` escreve a evidência (logs dos pods, eventos, amostras de réplicas); o `propriedades.yml` a define e sobe a pasta |
| `EVIDENCIA_INTERVALO` | `2` | segundos entre as amostras dos coletores de evidência; o spec o encurta (AT-174) |
| `RESTORE_MUTACAO` | não definida | `tabela-faltando` transforma o `make test-restore` no `make test-restore-mutacao`, a quebra deliberada que ele precisa pegar (AT-126) |
| `RESTORE_KEEP_JOB` | não definida | `1` mantém os Jobs de backup/restauração depois do `make test-restore`, para inspeção |
| `PROJECT_WORKSPACES_ROOT_NO_POD` | `/data/project-workspaces` | onde o `make test-reprojecao-artefatos-k8s` procura a pasta de artefatos dentro do pod da api |
| `KUBE_VERSION` | `1.31.0` | a versão do Kubernetes contra a qual o `make k8s-validate` valida os overlays renderizados |

---

## Inventário completo

As tabelas acima explicam **o que cada variável faz**. Esta seção é o
**inventário**: extraído do código a cada `pnpm docs:generate`, ele existe para
que uma variável nova não fique sem documentação em lugar nenhum sem que
ninguém perceba.

<!-- BEGIN:GENERATED:env-inventario -->

> ⚠️ Bloco gerado por `pnpm docs:generate`. Não edite à mão — o próximo build o sobrescreve.

Inventário extraído do código: **182 variáveis** lidas em tempo de execução. Todas têm descrição nas tabelas acima.

Cada fonte é marcada **produto** — o que quem opera a instalação configura no `.env` do deploy — ou **ferramenta**, lida só pelo CI e por quem desenvolve o produto. Variável de ferramenta nunca pertence ao `.env` de um operador.

**api** — 67 variáveis · produto

- `API_JSON_BODY_LIMIT` <sub>(apps/api/src/main.ts)</sub>
- `API_PUBLIC_URL` <sub>(apps/api/src/application/use-cases/auth/start-social-login.use-case.ts)</sub>
- `ARTIFACT_PROJECTOR_INTERVAL_MS` <sub>(apps/api/src/application/artifact-projection/artifact-projector.ts)</sub>
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
- `BRABO_PROJECTS_BASE` <sub>(apps/api/src/infrastructure/filesystem/project-workspaces-root.ts)</sub>
- `BRABO_SEED_PASSWORD` <sub>(apps/api/src/db/seed.ts)</sub>
- `BRABO_SERVICE_TOKEN` <sub>(apps/api/src/infrastructure/security/service-token.ts)</sub>
- `BRABO_SERVICE_TOKEN_PREVIOUS` <sub>(apps/api/src/infrastructure/security/service-token.ts)</sub>
- `BRABO_VERSION` <sub>(apps/api/src/tracing.ts)</sub>
- `BROKER_URL` <sub>(apps/api/src/infrastructure/http-clients/container-broker.client.ts)</sub>
- `CREDENTIALS_MASTER_KEY` <sub>(apps/api/src/infrastructure/security/envelope-encryption.service.ts)</sub>
- `CREDENTIALS_MASTER_KEY_PREVIOUS` <sub>(apps/api/src/infrastructure/security/envelope-encryption.service.ts)</sub>
- `CUSTO_RECONCILIACAO_INTERVAL_MS` <sub>(apps/api/src/application/use-cases/llm/reconciliar-custo-estimado.use-case.ts)</sub>
- `DATABASE_URL` <sub>(apps/api/src/db/migrate.ts)</sub>
- `ENGINE_PUBLIC_URL` <sub>(apps/api/src/application/use-cases/runner/request-runner-ticket.use-case.ts)</sub>
- `ENGINE_URL` <sub>(apps/api/src/application/use-cases/runner/request-runner-ticket.use-case.ts)</sub>
- `GIT_LOCAL_REPOS_ROOT` <sub>(apps/api/src/infrastructure/git/local-git-provider.ts)</sub>
- `GIT_OAUTH_STATE_SECRET` <sub>(apps/api/src/infrastructure/security/oauth-state-secret.ts)</sub>
- `GITHUB_OAUTH_CLIENT_ID` <sub>(apps/api/src/infrastructure/git/github-oauth-client.ts)</sub>
- `GITHUB_OAUTH_CLIENT_SECRET` <sub>(apps/api/src/infrastructure/git/github-oauth-client.ts)</sub>
- `GITLAB_OAUTH_CLIENT_ID` <sub>(apps/api/src/infrastructure/git/gitlab-oauth-client.ts)</sub>
- `GITLAB_OAUTH_CLIENT_SECRET` <sub>(apps/api/src/infrastructure/git/gitlab-oauth-client.ts)</sub>
- `GRAPH_PROJECTOR_INTERVAL_MS` <sub>(apps/api/src/application/graph-projection/graph-projector.ts)</sub>
- `HUGGINGFACE_API_TOKEN` <sub>(apps/api/src/infrastructure/huggingface/huggingface-client.ts)</sub>
- `HUGGINGFACE_HUB_URL` <sub>(apps/api/src/infrastructure/huggingface/huggingface-client.ts)</sub>
- `LOG_LEVEL` <sub>(apps/api/src/infrastructure/observability/logger.config.ts)</sub>
- `MAIL_TRANSPORT` <sub>(apps/api/src/infrastructure/mail/smtp-config.ts)</sub>
- `METRICS_GAUGE_INTERVAL_MS` <sub>(apps/api/src/infrastructure/observability/domain-gauges.collector.ts)</sub>
- `MIGRATIONS_FOLDER` <sub>(apps/api/src/db/migrate.ts)</sub>
- `NEO4J_PASSWORD` <sub>(apps/api/src/infrastructure/graph/neo4j-config.ts)</sub>
- `NEO4J_URI` <sub>(apps/api/src/infrastructure/graph/neo4j-config.ts)</sub>
- `NEO4J_USER` <sub>(apps/api/src/infrastructure/graph/neo4j-config.ts)</sub>
- `NINE_ROUTER_BASE_URL` <sub>(apps/api/src/infrastructure/llm/nine-router-provider.ts)</sub>
- `NODE_ENV` <sub>(apps/api/src/infrastructure/graph/neo4j-config.ts)</sub>
- `OLLAMA_HOST` <sub>(apps/api/src/infrastructure/llm/ollama-provider.ts)</sub>
- `OTEL_DIAG_LOG` <sub>(apps/api/src/tracing.ts)</sub>
- `OTEL_EXPORTER_OTLP_ENDPOINT` <sub>(apps/api/src/tracing.ts)</sub>
- `OTEL_SERVICE_NAME` <sub>(apps/api/src/tracing.ts)</sub>
- `PORT` <sub>(apps/api/src/main.ts)</sub>
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

**engine** — 63 variáveis · produto

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
- `SESSION_CONVERSATION_IDLE_TIMEOUT_MS` <sub>(apps/engine/config/runtime.exs)</sub>
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

**web** — 4 variáveis · produto

- `VITE_API_URL` <sub>(apps/web/src/lib/runtime-config.ts)</sub>
- `VITE_BRABO_VERSION` <sub>(apps/web/src/lib/runtime-config.ts)</sub>
- `VITE_ENGINE_URL` <sub>(apps/web/src/lib/runtime-config.ts)</sub>
- `VITE_LOG_LEVEL` <sub>(apps/web/src/lib/runtime-config.ts)</sub>

**broker** — 7 variáveis · produto

- `API_URL` <sub>(apps/broker/src/config.ts)</sub>
- `BRABO_PROJECTS_HOST_BASE` <sub>(apps/broker/src/config.ts)</sub>
- `BRABO_SERVICE_TOKEN` <sub>(apps/broker/src/config.ts)</sub>
- `BRABO_SERVICE_TOKEN_PREVIOUS` <sub>(apps/broker/src/config.ts)</sub>
- `BROKER_PORT` <sub>(apps/broker/src/config.ts)</sub>
- `NODE_ENV` <sub>(apps/broker/src/config.ts)</sub>
- `PROJECT_WORKSPACES_HOST_ROOT` <sub>(apps/broker/src/config.ts)</sub>

**api/scripts** — 15 variáveis · ferramenta

- `DATABASE_URL` <sub>(apps/api/scripts/demo-repo-bootstrap.ts)</sub>
- `DEMO_ANAMNESE_TIMEOUT_MS` <sub>(apps/api/scripts/demo-anamnese.ts)</sub>
- `DEMO_MODEL` <sub>(apps/api/scripts/demo-anamnese.ts)</sub>
- `DEMO_MODEL_LEVE` <sub>(apps/api/scripts/demo-psicologo.ts)</sub>
- `DEMO_MODEL_PESADO` <sub>(apps/api/scripts/demo-psicologo.ts)</sub>
- `DEMO_OLLAMA_COPY_FROM` <sub>(apps/api/scripts/demo-psicologo.ts)</sub>
- `DEMO_PSICOLOGO_TIMEOUT_MS` <sub>(apps/api/scripts/demo-psicologo.ts)</sub>
- `DEMO_QA_MODEL` <sub>(apps/api/scripts/demo-pr-gates-area-qa.ts)</sub>
- `DEMO_TIMEOUT_MS` <sub>(apps/api/scripts/demo-dev-agent-real.ts)</sub>
- `DEMO_WORKFLOWS_MODEL` <sub>(apps/api/scripts/demo-infra-workflows-github.ts)</sub>
- `GIT_LOCAL_REPOS_ROOT` <sub>(apps/api/scripts/demo-repo-bootstrap.ts)</sub>
- `GOLDEN_SET_QA_MODEL` <sub>(apps/api/scripts/seed-golden-set-qa.ts)</sub>
- `NOME` <sub>(apps/api/scripts/demo-pr-gates.ts)</sub>
- `OLLAMA_HOST` <sub>(apps/api/scripts/demo-psicologo.ts)</sub>
- `RATE_LIMIT_WINDOW_MS` <sub>(apps/api/scripts/relatorio-seguranca-runtime.ts)</sub>

**e2e** — 4 variáveis · ferramenta

- `E2E_API_URL` <sub>(e2e/suporte/api.ts)</sub>
- `E2E_PASSWORD` <sub>(e2e/suporte/api.ts)</sub>
- `E2E_USER` <sub>(e2e/suporte/api.ts)</sub>
- `E2E_WEB_URL` <sub>(e2e/playwright.config.ts)</sub>

**deploy/k8s** — 22 variáveis · ferramenta

- `API_URL` <sub>(deploy/k8s/rollout-test.sh)</sub>
- `BRABO_CLUSTER_NAME` <sub>(deploy/k8s/bootstrap.sh)</sub>
- `BRABO_CLUSTER_TOOL` <sub>(deploy/k8s/bootstrap.sh)</sub>
- `BRABO_KEEP_CLUSTER` <sub>(deploy/k8s/bootstrap.sh)</sub>
- `BRABO_NAMESPACE` <sub>(deploy/k8s/hpa-test.sh)</sub>
- `BRABO_SKIP_BUILD` <sub>(deploy/k8s/bootstrap.sh)</sub>
- `BRABO_SKIP_OBSERVABILITY` <sub>(deploy/k8s/bootstrap.sh)</sub>
- `BRABO_SMOKE_PASSWORD` <sub>(deploy/k8s/bootstrap.sh)</sub>
- `ENGINE_URL` <sub>(deploy/k8s/smoke.sh)</sub>
- `EVIDENCIA_INTERVALO` <sub>(deploy/k8s/rollout-evidencia.sh)</sub>
- `HPA_JOBS` <sub>(deploy/k8s/hpa-test.sh)</sub>
- `HPA_TIMEOUT` <sub>(deploy/k8s/hpa-test.sh)</sub>
- `KUBE_VERSION` <sub>(deploy/k8s/validate.sh)</sub>
- `PROJECT_WORKSPACES_ROOT_NO_POD` <sub>(deploy/k8s/test-reprojecao-artefatos.sh)</sub>
- `RESTORE_KEEP_JOB` <sub>(deploy/k8s/test-restore.sh)</sub>
- `RESTORE_MUTACAO` <sub>(deploy/k8s/test-restore.sh)</sub>
- `ROLLOUT_CONVERGENCE_SECONDS` <sub>(deploy/k8s/rollout-test.sh)</sub>
- `ROLLOUT_EVIDENCE_DIR` <sub>(deploy/k8s/rollout-test.sh)</sub>
- `ROLLOUT_SESSIONS` <sub>(deploy/k8s/rollout-test.sh)</sub>
- `SMOKE_USER` <sub>(deploy/k8s/bootstrap.sh)</sub>
- `TAG` <sub>(deploy/k8s/bootstrap.sh)</sub>
- `WEB_URL` <sub>(deploy/k8s/smoke.sh)</sub>
<!-- END:GENERATED:env-inventario -->

---

> **TODO(humano):** não há validação de esquema das variáveis no boot
> (algo como `zod`/`envalid` na api ou `NimbleOptions` no engine). Hoje um
> valor numérico inválido vira `NaN` em silêncio e um erro de digitação no
> nome de uma variável cai no default sem aviso. As únicas exceções são as
> marcadas com 🔒, que falham explicitamente em produção.
