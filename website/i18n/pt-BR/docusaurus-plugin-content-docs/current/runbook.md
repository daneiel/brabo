---
id: runbook
title: Runbook operacional
sidebar_label: Runbook
sidebar_position: 4
description: Procedimentos operacionais do Brabo — deploy, rollout, restore, rotação de chave, incidente de custo e observabilidade.
keywords: [runbook, operação, incidente, restore, rollout, kubernetes]
---

# Runbook operacional

Um documento só, porque numa madrugada ninguém abre um diretório para escolher
arquivo. Comece pela triagem.

<!--
  Os links `pathname://../<página>` desta página apontam para a versão em
  INGLÊS (o locale default, um nível acima de `/pt-BR/`): as RNs que eles citam
  não existem na tradução pt-BR de `business-rules.md`, e o checador de links do
  build de um locale não enxerga as rotas do outro. `pathname://` pula o
  checador e, com caminho relativo, não ganha o baseUrl do locale — medido no
  HTML gerado (AT-209). Quando a RN chegar à tradução, volte ao link `.md`.
-->

> **Esta tradução está atrás da versão em inglês.** Medido em 2026-09-26
> (AT-209): a [versão em inglês](pathname://../runbook) é a fonte, e as seções
> abaixo **só existem nela** — numa madrugada, vá direto para lá:
>
> - na triagem: *The container broker*, *The runner's base of projects*, *The
>   machine agent*, *The unit is `bad-setting` and never starts*, *Device key
>   from the terminal*, *When the installer does not close the installation*,
>   *The project folder never appears on the user's machine*, *Authenticated
>   clone in Runner mode is refused while the container is up*, *Dev containers
>   write as your user, not root* e *Total reset of the dev environment*;
> - no deploy local: *Deploying a release's images* e *The Terminal tab is
>   stuck on "Opening terminal..." forever*;
> - no restore: *What is backed up, and what deliberately is not*, *What the
>   bare-repo archive guarantees*, *Recovering the bare repos*, *Losing the
>   graph (Neo4j)*, *Losing the artifact folder (`docs/`)* e *Last verified run
>   — compose, disk destination*;
> - *Verifying a published artifact* e *Bumping a third-party image*.
>
> Estão alinhadas ao inglês de 2026-09-26: [Instalando](#instalando),
> [Provas de propriedade agendadas](#provas-de-propriedade-agendadas), a
> [rotação das chaves do auth](#rotacao-das-chaves-do-auth), a
> [rotação da chave mestra](#rotacao-da-chave-mestra) e o
> [incidente de custo](#incidente-de-custo). As demais seções existem aqui, mas
> podem estar mais curtas que as do inglês; na dúvida, o inglês vale.

## Triagem — do sintoma ao procedimento

| o que você está vendo | vá para |
|---|---|
| quero subir tudo do zero | [Deploy local](#deploy-local) |
| pods presos, `ExternalSecret` não fica Ready, HPA em `<unknown>` | [Diagnóstico do deploy](#diagnostico-do-deploy) |
| vou dar rollout no engine | [Rollout do engine](#rollout-do-engine) |
| sessão `active` sem processo, ou presa em `closing` | [Quando a sessão escapa](#quando-a-sessao-escapa) |
| perdi dados / quero verificar o backup | [Restore](#restore) |
| credencial de LLM ou git parou de decriptar | [Rotação da chave mestra](#rotacao-da-chave-mestra) |
| todo mundo deslogado de uma vez, ou conta travada no login | [Rotação das chaves do auth](#rotacao-das-chaves-do-auth) |
| custo por hora disparou | [Incidente de custo](#incidente-de-custo) |
| painel vazio, sem trace, sem log | [Observabilidade](#observabilidade) |
| não sei que versão está rodando | [Que versão está no ar](#que-versao-esta-no-ar) |
| `blocked by CORS policy` no console do navegador | [Erro de CORS](#erro-de-cors) |
| ativar sessão não faz nada, ou `transition` responde `500` com `ECONNREFUSED` | [A sessão não sai de `created`](#sessao-nao-ativa) |
| a api sai no boot reclamando de `GIT_OAUTH_STATE_SECRET` | [A api recusa subir por segredo de OAuth](#segredo-de-oauth-no-boot) |
| "Entrar com GitHub/GitLab" volta do provider com erro de `redirect_uri` | [O provider recusa o callback do login social](#callback-login-social-nao-registrado) |
| a api ou o engine saem no boot reclamando de `AUTH_JWT_SECRET`, `BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY`, `SECRET_KEY_BASE` ou `NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD` | [Os quatro segredos irmãos também não sobem com o default](#segredos-irmaos-no-boot) |
| quero ligar SMTP real, ou a api sai no boot reclamando de `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` | [SMTP real no `MailSender`](#smtp-real) |
| agente respondendo vazio, truncado ou lentíssimo | [Ambiente de inferência](#ambiente-de-inferencia) |
| agente parando com `limite de iterações atingido` sem ter entregado | [Ambiente de inferência](#ambiente-de-inferencia) |
| quero acrescentar um provider de LLM compatível com a OpenAI | [Adicionando um provider compatível](#adicionando-um-provider-compativel) |
| quero migrar meus workspaces do volume Docker para uma pasta real | [Migrar workspaces para pasta local](#migrar-workspaces-pasta-local) |
| criar projeto **Local** recusa dizendo que a pasta não existe | [Projeto no modo Local](#projeto-no-modo-local) |
| a web começa a responder **429 (limite de requisições)** sem motivo aparente, ou um projeto no modo `runner` aparece "sem agente local" com o `brabo-runner` rodando | [O runner inunda a api com um ticket morto](#runner-com-ticket-morto) |

Duas coisas que valem antes de qualquer procedimento:

- **Silêncio não é saúde.** As regras de alerta são do Grafana, não do
  Prometheus ([ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md)):
  Grafana fora do ar significa nenhum aviso, não nenhum problema.
- **Matar o pod não fecha sessão.** `kubectl delete pod` sem drain cria órfã.
  O caminho é sempre a transição normal.

### Migrar workspaces para pasta local {#migrar-workspaces-pasta-local}

Definir `PROJECT_WORKSPACES_HOST_DIR`/`GIT_LOCAL_REPOS_HOST_DIR`
([Primeiros passos](getting-started.md#pasta-local-dos-workspaces)) troca o
volume Docker pela pasta indicada — mas **não copia** o que já existia no
volume antigo. Quem já tem projetos criados e não quer perder o trabalho
precisa copiar o conteúdo antes de trocar:

```bash
pnpm dev:down
docker run --rm \
  -v brabo_project_workspaces:/de \
  -v "$(realpath ~/brabo-projetos)":/para \
  alpine sh -c 'cp -a /de/. /para/'
docker run --rm \
  -v brabo_git_local_repos:/de \
  -v "$(realpath ~/brabo-projetos-bare)":/para \
  alpine sh -c 'cp -a /de/. /para/'
# defina as duas variáveis no .env, depois:
pnpm dev
```

O nome do volume (`brabo_project_workspaces`) tem o prefixo do projeto
Compose (`name: brabo` em `docker/docker-compose.yml`) — confirme com
`docker volume ls` se você renomeou o projeto. O volume antigo continua
existindo depois (Compose não apaga volume que saiu de uso); remova com
`docker volume rm` se tiver certeza de que a cópia funcionou.

### Projeto no modo Pasta montada: a base de projetos {#projeto-no-modo-local}

**Sintoma:** o assistente de criação não oferece **Pasta montada**; ou oferece,
e a api responde `400` dizendo que a pasta *não existe do lado de dentro da
api*.

Os dois vêm do mesmo fato: um projeto no modo Pasta montada guarda o código
numa pasta **sua**, e a api e o engine só a alcançam se ela estiver montada nos
containers deles. O que mudou
([ADR 0141](adr/0141-base-unica-dos-projetos-montados.md),
RN-500) é quem faz essa montagem, e com que
frequência: agora existe **uma base**, configurada uma vez pelo operador, e
todo projeto montado mora dentro dela. Você nunca mais edita o compose por
projeto.

**O que fazer — uma vez, para a instalação inteira:**

```bash
# .env — caminho ABSOLUTO. O `~` NÃO é expandido pelo Compose.
BRABO_PROJECTS_BASE=/home/voce/brabo
```

```bash
docker compose -f docker/docker-compose.yml --env-file .env up -d api engine
```

Pronto. Daqui em diante, um projeto no modo Pasta montada vai para algum lugar
dentro de `/home/voce/brabo` e não precisa de mais nada.

**Projeto montado ganha container de verdade, e ele roda NO SERVIDOR**
([ADR 0144](adr/0144-a-segunda-raiz-do-broker.md),
RN-503). Como a base é alcançável
pelo daemon Docker do host, o `container_start` de um projeto montado vai para
o **broker**, exatamente como no modo Container — ele deixou de exigir um
`brabo-runner` conectado. Só o modo **Runner** continua indo pelo runner, na
máquina do próprio usuário, porque aquela pasta está num lugar que este
servidor não enxerga. Localmente o broker já está de pé — ele vem com
`pnpm dev` desde o [ADR 0146](adr/0146-base-consentida-no-bootstrap.md),
justamente por ser o caminho do modo padrão; em produção ele ainda pede
`--profile container-broker`. Ele
tem DUAS raízes e nenhuma substitui a outra: `PROJECT_WORKSPACES_HOST_ROOT`
(modo Container) e `BRABO_PROJECTS_HOST_BASE` (modo Pasta montada, derivada de
`BRABO_PROJECTS_BASE` no compose). A que faltar é NOMEADA na recusa, sem tocar
container nenhum — cair na outra montaria a pasta de outro projeto, porque a
raiz gerenciada é nomeada por `workspace_dir_name` e a base é nomeada por você.

**Por que o assistente esconde o modo Pasta montada.** Sem
`BRABO_PROJECTS_BASE`, a api reporta `projectsBase: null` e a opção não é
oferecida. É deliberado: oferecer um modo que a instalação não honra produz um
projeto que trava depois, na primeira ferramenta do primeiro agente, longe da
tela onde a decisão foi tomada. Os modos Container (o default) e Runner não são
afetados e continuam funcionando sem esta variável.

**Por que o mesmo caminho dos dois lados.** A base é montada por
**identidade** — `/home/voce/brabo:/home/voce/brabo` — tanto na `api` quanto no
`engine`. O caminho é gravado UMA vez em `projects.workspace_path` e lido pelos
dois processos ([RN-169](business-rules/autenticacao.md#rn-169)); ele também é a
string que a tela mostra de volta para você. Montar em outro lugar faria o
engine escrever onde a api não lê, e faria a tela mostrar um caminho que não
existe nem na sua máquina nem na deles.

**Confira o que os containers realmente enxergam:**

```bash
docker compose -f docker/docker-compose.yml exec api    ls -la /home/voce/brabo
docker compose -f docker/docker-compose.yml exec engine ls -la /home/voce/brabo
```

**Não aponte a base para o checkout do próprio Brabo.** O `pnpm dev` recusa
subir quando `BRABO_PROJECTS_BASE` contém, ou está contida por, o repositório
que você clonou — ele nomeia os dois caminhos e para. Essa checagem mora no
preflight e em nenhum outro lugar, de propósito: a api compara o caminho de um
projeto contra `process.cwd()`, que dentro do container dela é `/workspace`, e
não tem como enxergar o seu checkout de verdade. Sem a guarda, clonar o Brabo
em `$HOME/brabo` e apontar a base para a mesma pasta passa por toda validação e
faz os agentes de dev rodarem dentro da árvore do próprio produto — a falha que
o [ADR 0055](adr/0055-escopo-de-caminho-em-comando-de-agente.md) existe para
impedir.

**Escolha uma pasta dedicada.** Tudo que estiver sob a base é alcançável de
dentro dos containers do produto. Não aponte para o seu `$HOME` inteiro, nem
para uma pasta que guarde outros segredos seus.

**Outros modos de recusa, e o que cada um quer dizer:**

| a mensagem diz | o que fazer |
|---|---|
| o modo Pasta montada nem aparece | `BRABO_PROJECTS_BASE` não está definida — defina e rode `up -d api engine` |
| *não existe do lado de dentro da api* | a pasta não está sob a base, ou a base não está montada; confira com o `exec ls` acima |
| *existe mas não é uma pasta* | o caminho aponta para um arquivo; use a pasta |
| *o processo não pode escrever nela* | dono/permissão da pasta no host. As imagens rodam non-root ([ADR 0024](adr/0024-fase5-imagens-producao-ci.md)); ajuste o dono ou o modo da pasta |
| *Caminho inválido para um projeto Local* | é raiz do sistema, pasta de sistema, relativo, tem `..`, ou se sobrepõe ao checkout do Brabo — escolha uma pasta sua, fora dessas ([ADR 0072](adr/0072-projeto-local-ou-container.md)) |

**Limites conhecidos, declarados em vez de escondidos.** Um symlink sob a base
apontando para fora dela resolve diferente dentro dos containers, porque o alvo
não está montado — o navegador de pastas recusa descer em symlink, e a checagem
de disco pega a divergência como uma falha nomeada. E esta versão suporta
**uma** base: código que more em outro lugar precisa ser movido para dentro
dela.

**Migrando dos mounts por projeto.** Se você tem linhas
`- /home/voce/projetos/loja:/home/voce/projetos/loja` escritas à mão na `api` e
no `engine`, elas continuam funcionando e nada as remove — nenhum projeto
existente quebra com esta mudança. O caminho suportado daqui em diante é a
base; mova essas pastas para dentro dela e apague as linhas quando puder.

**Não confunda com o modo Container.** Projeto no modo Container (o default)
continua usando `PROJECT_WORKSPACES_ROOT` e o procedimento de migração acima; o
modo Pasta montada não passa por essa raiz em momento nenhum, e a base nunca é
a mesma pasta que essa raiz — o
[ADR 0141](adr/0141-base-unica-dos-projetos-montados.md) explica por que
conflá-las deixaria dois projetos caírem na mesma pasta.

---

## Deploy local {#deploy-local}

Sobe o Brabo inteiro num cluster local e valida com teste de fumaça. Decisões
em [ADR 0025](adr/0025-fase5-deploy-kubernetes-kustomize.md).

### Pré-requisitos

Obrigatórios no PATH: `docker`, `kubectl`, `kustomize`, `jq`, `openssl`.

`k3d` e `helm` **não** precisam estar instalados — o bootstrap os instala em
`~/.local/bin`, com versão pinada e checksum conferido. Garanta que esse
diretório esteja no PATH.

Recursos: o stack completo (Postgres, Prometheus, dois operadores e os três
apps) pede em torno de **4 GiB** livres.

### Subir

```bash
make deploy-local           # constrói as imagens, sobe o cluster, instala, valida
make deploy-local-clean     # o mesmo, sem reconstruir as imagens
```

Ao fim: web em <http://localhost:8088>, api em `:3000`, engine em `:4000` —
**as mesmas portas do `docker-compose.prod.yml`**, de propósito (ADR 0025,
decisão 10). O bootstrap roda o seed, que cria `owner@brabo.dev` já verificado
com a senha de `BRABO_SMOKE_PASSWORD` (default `brabo12345678`) — é com ela
que se entra no login próprio da web.

O seed roda **depois** dos rollouts (o último passo dele ativa uma sessão, o
que faz a api chamar o engine) e o bootstrap só segue adiante depois de
**verificar que o login responde 200**. Essa checagem é de resultado, não de
processo, e existe porque a anterior não era: `wait --for=condition=Ready=false`
é satisfeito por um pod que nunca chegou a rodar, e por isso o bootstrap
anunciava "usuário do smoke pronto" enquanto o login devolvia 401.

> **O seed é idempotente.** Rodá-lo de novo sobre um banco já semeado é o
> caso normal (`BRABO_KEEP_CLUSTER=1`): o workspace, o projeto e a sessão de
> demonstração são reencontrados e reaproveitados, nunca duplicados, e a sessão
> reencontrada não ganha os cinco eventos de novo (`apps/api/src/db/seed.ts`, o
> docblock do topo). A segunda execução não morre mais em
> `workspaces_slug_unique`. O bootstrap continua decidindo pelo **login**, não
> pela fase do pod, e continua removendo o pod ao final para não reprovar o
> passo 1 do `smoke.sh`, que exige todos os pods saudáveis.

> **Isto ocupa as portas do `pnpm dev`.** Manter as portas iguais é o que faz o
> `smoke.sh` valer nos dois modos, e o preço é que eles não
> coexistem: com o cluster de pé, o `pnpm dev` não publica a porta do `api` e a
> **5173 nunca abre**. Repare que o web muda de porta entre os modos — 8088
> aqui, 5173 lá. Para voltar ao desenvolvimento:
>
> ```bash
> make k8s-down && pnpm dev
> ```
>
> `pnpm dev:preflight` diz em qual modo você está, sem adivinhação. Os dois
> estão na [Primeiros passos](getting-started.md#os-dois-modos-locais-não-coexistem).

Outros alvos:

```bash
make smoke-k8s        # só o teste de fumaça, contra o cluster de pé
make hpa-test         # prova que o HPA do engine escala por fila
make k8s-validate     # monta os overlays e valida contra o schema (não precisa de cluster)
make k8s-logs         # últimas linhas de api, engine e web
make k8s-down         # remove o cluster
```

Variáveis: `BRABO_SKIP_BUILD=1` (usa as imagens do daemon), `BRABO_KEEP_CLUSTER=1`
(reaproveita o cluster), `BRABO_CLUSTER_TOOL=kind`.

### Validar uma tag da esteira

```bash
make deploy-local TAG=v0.2.0-qa.1
```

A esteira da FASE 6 **não faz deploy** — ela termina na tag. `TAG=` é como se
olha, no cluster local, o que aquela tag carimbou: o bootstrap faz checkout
destacado da tag e constrói as imagens daquele commit.

Ele **recusa** rodar com a árvore suja, em vez de adivinhar o que fazer com o
seu trabalho em andamento. Ao terminar você fica em HEAD destacado; o comando
para voltar aparece no log.

### Que versão está no ar {#que-versao-esta-no-ar}

Três lugares dizem a mesma coisa, e a resposta é a versão **assada no artefato**
— não uma configuração que alguém possa ter trocado por acidente ([ADR 0036](adr/0036-telas-de-auth-fieis-ao-design-e-fontes-auto-hospedadas.md)):

1. **A tela de login**, no rodapé. É o caminho mais rápido e não precisa de
   acesso ao cluster: abra `/login` e leia o primeiro item do rodapé.
2. **A tag da imagem**, se você tem `kubectl`:

   ```bash
   kubectl -n brabo get deploy -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.template.spec.containers[0].image}{"\n"}{end}'
   ```

3. **`service.version` nos spans** da api, no Tempo. É o único dos três que
   liga uma requisição específica a um build.

`dev` nos três não é falha: é o que uma imagem construída fora do `release.yml`
reporta, porque não nasceu de tag nenhuma. `docker compose`, `make deploy-local`
sem `TAG=` e build local caem todos aí.

**Divergência entre os três é o achado.** O rodapé vindo de uma versão e a tag da
imagem de outra significa cache de bundle no navegador ou no nginx, não deploy
errado — o bundle e a imagem saem do mesmo build. Recarregue ignorando cache
antes de suspeitar do cluster.

### Erro de CORS {#erro-de-cors}

A mensagem do navegador nomeia o **destino** da chamada, nunca a causa. Leia
primeiro a **origem** que ela cita, que é a informação útil
([ADR 0037](adr/0037-cors-do-engine-e-a-porta-como-contrato.md)):

```
Access to fetch at 'http://localhost:3000/health' from origin
'http://localhost:5174' has been blocked by CORS policy
                     ^^^^ esta parte é o diagnóstico
```

**Se a origem não é a que você espera** (`:5174` em vez de `:5173`, host
diferente, `https` em vez de `http`), o problema é a origem, não o CORS.

Nos composes, `WEB_ORIGIN` **deriva** de `WEB_PORT` — mudar
`WEB_PORT` no `.env` (a orientação de [primeiros passos](getting-started.md) para
porta ocupada) já move a origem aceita junto, então essa divergência específica
não acontece mais. O que ainda causa isso: alguém passou `--port` direto ao Vite
por fora do compose (o ADR 0037 fez o Vite recusar subir nesse caso, com
`strictPort`, em vez de subir silenciosamente noutra porta), a web é servida por
outro caminho, ou `WEB_ORIGIN` foi definida à mão e sobrepôs a derivação.
Conserte a origem, ou acrescente-a a `WEB_ORIGIN` — **nos dois serviços**, que
leem a mesma variável.

**Se a origem está certa**, confirme o que cada serviço responde. `curl` não faz
CORS, então ele mostra o cabeçalho cru — que é exatamente o que o navegador olha:

```bash
# api — espera-se access-control-allow-origin + allow-credentials
curl -sI http://localhost:3000/health -H "Origin: http://localhost:5173" \
  | grep -i access-control

# engine — espera-se access-control-allow-origin + vary: origin
curl -sI http://localhost:4000/health -H "Origin: http://localhost:5173" \
  | grep -i access-control

# preflight, que é onde falta de allow-headers aparece
curl -sI -X OPTIONS http://localhost:3000/auth/login \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,x-csrf-token" \
  | grep -i access-control
```

**Saída vazia é o achado**: o serviço não reconheceu a origem. `WEB_ORIGIN`
errada, ausente, ou com a porta trocada.

**Preflight sem o cabeçalho que a web manda** é o outro modo de falha, e o mais
enganoso: a lista de `allowedHeaders` da api é explícita e **nenhum teste faz
preflight**, então um cabeçalho novo no cliente passa no CI e quebra só no
navegador. Hoje a lista é `Content-Type`, `Authorization`, `X-CSRF-Token`,
`traceparent`.

Três coisas que **não** são problema de CORS, por mais que pareçam:

- **api ↔ engine**. CORS é mecanismo de navegador; ali quem chama é cliente HTTP
  de servidor, que ignora esses cabeçalhos. Falha nesse caminho é service token
  (`401`/`403` — ver [rotação](#rotacao-das-chaves-do-auth)) ou endereço errado
  (`ECONNREFUSED` — ver [a sessão não sai de `created`](#sessao-nao-ativa)).
- **O canal Phoenix ficar mudo.** WebSocket não passa por CORS. Quem recusa é o
  `check_origin` do endpoint, também alimentado por `WEB_ORIGIN`, e a recusa
  aparece no log do engine — não no console do navegador como erro de CORS.
- **`/metrics` do engine bloqueado no navegador.** É deliberado: métrica interna
  não é legível por JavaScript de página. Use `curl`.

### A sessão não sai de `created` {#sessao-nao-ativa}

Sintoma: ativar sessão não faz nada. "Abrir sessão criativa" cria a sessão e a
tela não muda de lugar; "Ativar sessão" também não. No log da api,
`POST /projects/:id/sessions/:id/transition` responde `500`:

```
TransitionSessionUseCase.activate ✗ TypeError
  ↳ HttpApiToEngineClient.startSession ✗ TypeError: fetch failed
      caused by: AggregateError [ECONNREFUSED]
```

Ativar sessão é o primeiro passo que **atravessa** para o engine (a api pede a
sessão supervisionada por HTTP interno), então é aqui que um `ENGINE_URL` errado
aparece — e não antes, porque nada mais no caminho de criação sai da api.

Confirme de **dentro** do container, que é onde o endereço vale:

```bash
docker exec brabo-api-1 node -e '
for (const u of ["http://engine:4000/health", "http://localhost:4000/health"]) {
  fetch(u, { signal: AbortSignal.timeout(5000) })
    .then((r) => console.log(u, "->", r.status))
    .catch((e) => console.log(u, "-> FALHOU:", e.cause?.code ?? e.message));
}'
docker exec brabo-api-1 sh -c 'echo $ENGINE_URL'
```

`engine:4000` respondendo `200` enquanto `localhost:4000` dá `ECONNREFUSED`, com
`ENGINE_URL=http://localhost:4000`, é o diagnóstico fechado: **dentro do
container, `localhost` é a própria api**.

A causa costuma ser o `.env`, não o compose. O `pnpm dev` passa o `.env` como
`--env-file`, e um valor ali **vence** o `${ENGINE_URL:-http://engine:4000}` do
compose. Correção: remover (ou comentar) a linha `ENGINE_URL` do seu `.env` e
recriar a api —

```bash
docker compose -f docker/docker-compose.yml --env-file .env up -d api
```

— porque cada ambiente já traz o default certo sem ela: o compose aponta para o
serviço `engine`, e a api rodando no host cai no `http://localhost:4000` do
próprio código. Preencher a variável só faz sentido para apontar para um engine
que não é nenhum dos dois. Vale para o compose de **produção** também, que usa a
mesma interpolação; em Kubernetes o valor vem do ConfigMap e sempre foi
`http://engine:4000`.

Duas checagens antes de culpar o endereço, se o `ENGINE_URL` estiver correto:

- **O engine está de pé?** `docker compose ps engine` e
  `curl -sI http://localhost:4000/health`. `ECONNREFUSED` com endereço certo é
  serviço fora do ar, não configuração.
- **Sessão que ativa e fecha sozinha ~30s depois** não é este problema. Olhe
  `termination_reason`: `heartbeat_timeout` significa que a ativação funcionou e
  ninguém entrou no canal Phoenix — comportamento esperado quando se ativa por
  fora da interface (`SESSION_HEARTBEAT_TIMEOUT_MS`). `conversation_idle_timeout`
  é o outro: um agente conversacional esperou o usuário por mais tempo que
  `SESSION_CONVERSATION_IDLE_TIMEOUT_MS` (8h), contado do fim do turno dele
  ([RN-581](pathname://../business-rules#rn-581)). Para mudar esse teto, defina a variável
  no `.env` (os três composes a mapeiam para o engine) ou, no Kubernetes,
  acrescente um item `env:` ao patch do engine no overlay: `deploy/k8s/` não a
  escreve de propósito, porque ali a variável ausente já é o default de 8h do
  código (AT-153). Um `409` com `reason: "sessao_encerrada"` depois disso é a
  sessão fechada recusando conversa — abra uma sessão nova.

### O runner inunda a api com um ticket morto {#runner-com-ticket-morto}

Sintoma: a web passa a responder **429** às requisições da própria pessoa, sem
atividade incomum da parte dela; e/ou um projeto no modo `runner` aparece como
se não tivesse agente local (tasks de dev presas em
`dev.blocked_by_container`, `RunnerReadiness` recusando) com o `brabo-runner`
visivelmente rodando na máquina dela.

**Como confirmar.** No log do engine, procure o MESMO ticket sendo recusado
repetidamente, numa cadência fixa de aproximadamente **5,13 s**:

```bash
docker logs brabo-engine-1 2>&1 | grep 'REFUSED CONNECTION TO EngineWeb.RunnerSocket' | tail -20
```

Dezenas dessas em poucas horas, todas carregando a mesma string de ticket, é a
assinatura. Os ~5,13 s não são arbitrários — são o teto do backoff interno do
`reconnectAfterMs` do `phoenix.js`.

**Causa.** O ticket do socket é de **uso único**
([RN-108](business-rules/autenticacao.md#rn-108)); o auto-reconnect embutido da
biblioteca repete os MESMOS `params`, então ele tenta de novo um ticket que foi
consumido na primeira conexão e nunca mais será aceito. Uma versão do
`apps/runner/src/channel.ts` foi publicada com esse auto-reconnect LIGADO — e o
docblock do próprio módulo afirmava o contrário. Somado à política PRÓPRIA de
reconexão do runner (que está correta: ticket fresco por rodada, backoff, teto
de tentativas seguidas), o resultado medido foram **530 requisições num
minuto** contra o teto de 300 req/min do `RATE_LIMIT_USER`, quatro minutos
seguidos acima do limite. O limite é **por usuário**, e é por isso que o 429
aparecia no navegador do dono da conta, longe do runner.

A segunda consequência é a pior: enquanto está preso nesse laço o runner **não
está conectado**, então `RunnerReadiness` (RN-507) recusa e o projeto parece não ter agente local — parte do que se lê como "o
container não sobe" é isto.

**Correção.** Atualize o binário do `brabo-runner` (ou reinstale pela tela do
projeto). Nada a mudar no servidor: o rate limiter fez o trabalho dele, e o
engine estava certo em recusar cada um daqueles tickets. Se a enxurrada ainda
estiver em curso, parar o runner a encerra na hora, e os 429 somem conforme a
janela deslizante drena (um minuto).

### A api recusa subir por segredo de OAuth {#segredo-de-oauth-no-boot}

Sintoma: com `NODE_ENV=production`, a api morre no start com uma mensagem sobre
`GIT_OAUTH_STATE_SECRET` — ausente, com o valor de exemplo do repositório, ou
curta demais.

**Não é regressão, e não contorne.** Essa chave assina o `state` do OAuth de
git, e o `state` é o que impede o callback público de ser forjado. Antes do
[ADR 0059](adr/0059-segredo-do-state-de-oauth-sem-default.md) a api subia com um
default que está publicado neste repositório — quem vê este erro estava, até
agora, com o fluxo de conexão de git aberto a qualquer um. O boot falhar é o
aviso chegando, tarde.

```bash
export GIT_OAUTH_STATE_SECRET="$(openssl rand -base64 32)"
```

Em Kubernetes o valor vem de `brabo-secrets`, pela chave de mesmo nome já
declarada em `deploy/k8s/base/common/externalsecrets.yaml` — se o erro apareceu
lá, o problema é o cofre não estar entregando a chave, e o caminho é o
[Diagnóstico do deploy](#diagnostico-do-deploy).

Trocar a chave **invalida os `state` em voo**: quem estiver no meio de um
"conectar GitHub" naquele instante recebe recusa e refaz o fluxo. Como o TTL do
`state` é de 10 minutos, a janela é essa — não há migração a fazer, e nenhuma
conexão **já estabelecida** é afetada (o token guardado não depende desta
chave).

### O provider recusa o callback do login social {#callback-login-social-nao-registrado}

Sintoma: clicar em "Entrar com GitHub"/"Entrar com GitLab" na tela de login
leva ao provider e volta com um erro do TIPO DELE (`redirect_uri_mismatch` no
GitHub, "The redirect URI included is not valid" no GitLab) — nunca chega a
`/auth/oauth/:provider/callback`.

**Não é bug do produto — é registro faltando no lado do provider.** O login
social ([ADR 0084](adr/0084-login-social-github-e-gitlab.md)) reusa o MESMO
OAuth App que a conexão de git já usa (`GITHUB_OAUTH_CLIENT_ID`/
`GITLAB_OAUTH_CLIENT_ID`, sem variável nova), mas cada FLUXO tem seu próprio
`redirect_uri`, e o provider exige que TODOS os que a api pode pedir estejam
cadastrados de antemão:

- Conexão de git (já existia): `${API_PUBLIC_URL}/git/oauth/<provider>/callback`
- Login social (novo): `${API_PUBLIC_URL}/auth/oauth/<provider>/callback`

Cadastre o segundo na configuração do OAuth App (GitHub: Settings → Developer
settings → OAuth Apps; GitLab: Settings → Applications) — GitHub aceita várias
callback URLs no mesmo App, GitLab também. Não precisa de App separado nem de
client id/secret novo.

### Os quatro segredos irmãos também não sobem com o default {#segredos-irmaos-no-boot}

Sintoma: com `NODE_ENV=production`, a api (ou, para `SECRET_KEY_BASE`, o
engine) morre no start com uma mensagem sobre `AUTH_JWT_SECRET`,
`BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY` ou `SECRET_KEY_BASE` —
ausente, com o valor de exemplo do repositório, ou curta demais.

**Mesma causa do segredo de OAuth acima, e mesma orientação: não é regressão,
e não contorne.** O [ADR 0059](adr/0059-segredo-do-state-de-oauth-sem-default.md)
já declarava esses quatro como pendência — o mesmo padrão, só ainda não
replicado — e a [RN-114](business-rules/custo.md#rn-114) fechou. Cada um protege
algo diferente:

- `AUTH_JWT_SECRET` público = qualquer um deriva o par que assina o access
  token e forja um token válido.
- `BRABO_SERVICE_TOKEN` público = qualquer um chama `/internal/*` sem passar
  pelo `EngineServiceGuard`.
- `CREDENTIALS_MASTER_KEY` público = qualquer um decripta o acervo de
  credenciais do usuário (chaves de LLM, tokens de git).
- `SECRET_KEY_BASE` (engine) já tinha `raise` no `runtime.exs` — o defeito era
  só o compose mascarar esse `raise` com um fallback público.

```bash
export AUTH_JWT_SECRET="$(openssl rand -base64 32)"
export BRABO_SERVICE_TOKEN="$(openssl rand -base64 32)"
export CREDENTIALS_MASTER_KEY="$(openssl rand -base64 32)"
export SECRET_KEY_BASE="$(openssl rand -base64 64)"
```

Em Kubernetes nada muda, pelo mesmo motivo do `GIT_OAUTH_STATE_SECRET`: os
quatro já vinham de `brabo-secrets`, pela chave de mesmo nome, em
`deploy/k8s/base/common/externalsecrets.yaml`.

**O grafo de conhecimento (`NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD`,
[ADR 0099](adr/0099-neo4j-grafo-de-conhecimento-e-templates.md)) segue a
mesma régua, com uma diferença**: `NEO4J_URI` e `NEO4J_USER` têm default de
desenvolvimento seguro (`bolt://neo4j:7687`, `neo4j` — não são segredo, e o
`docker-compose.prod.yml` já os supre); só `NEO4J_PASSWORD` fica sem
default público, pelo mesmo motivo dos quatro acima — e sem ela o boot da
api falha em `GraphStore.onModuleInit` (`neo4j-config.ts`) ANTES mesmo de o
próprio Neo4j recusar subir (o entrypoint da imagem oficial exige senha com
8+ caracteres; `NEO4J_AUTH` vazio derruba o container `neo4j` primeiro).

```bash
export NEO4J_PASSWORD="$(openssl rand -base64 32)"
```

**Em desenvolvimento o interruptor é `NEO4J_URI`, e ele é vazio por padrão.**
O serviço `neo4j` sobe no profile default do compose de dev, então o servidor
fica de pé converse alguém com ele ou não; a api só conecta quando `NEO4J_URI`
está definida. Descomente no `.env` (`bolt://neo4j:7687`) e recrie a api — o
`GraphStore` passa a registrar `Neo4j conectado — constraints do grafo
garantidas` em vez de `NEO4J_URI/NEO4J_USER/NEO4J_PASSWORD ausentes`. Usuário e
senha chegam ao container com os mesmos defaults que o serviço `neo4j` usa no
`NEO4J_AUTH`, então defina os dois só para TROCAR a senha — e trocando ali você
troca dos dois lados de uma vez.

Até isto ser ligado, o `docker-compose.yml` não repassava as três variáveis ao
serviço `api` de forma nenhuma, e o serviço não tem `env_file` — então o bloco
que o `.env.example` documenta desde que o grafo nasceu não alcançava nada, e
descomentar não ligava coisa alguma. O `docker-compose.prod.yml` as supria
desde o primeiro dia (é por isso que só desenvolvimento era afetado): um Neo4j
saudável ficava ao lado de uma api relatando as variáveis ausentes,
indefinidamente.

`docker/smoke.sh` já gera as cinco variáveis efêmeras acima (as quatro
irmãs e `NEO4J_PASSWORD`) a cada execução — é assim que o job "Build, scan e
smoke das imagens de produção" do CI sobe o `docker-compose.prod.yml` sem
segredo nenhum commitado.

Trocar `AUTH_JWT_SECRET` ou `BRABO_SERVICE_TOKEN` sem a dança do `_PREVIOUS`
tem o mesmo efeito que já era documentado em
[Rotação das chaves do auth](#rotacao-das-chaves-do-auth); trocar
`CREDENTIALS_MASTER_KEY` sem re-embrulhar tem o mesmo efeito já documentado em
[Rotação da chave mestra](#rotacao-da-chave-mestra). Esta checagem de BOOT não
muda nenhum dos dois procedimentos — ela só impede que a chave chegue à
produção sendo o literal público deste repositório.

### SMTP real no `MailSender` {#smtp-real}

`MailSender` envia e-mail de verdade só quando `MAIL_TRANSPORT=smtp` — o
default é `log` (o comportamento de sempre), **inclusive em produção**:
enviar e-mail é opt-in do operador ([ADR 0096](adr/0096-smtp-real-no-mailsender.md)).
Ver [Configuração](reference/configuration.md#api) para a tabela completa
de `SMTP_*`.

Sintoma de configuração incompleta: com `NODE_ENV=production` e
`MAIL_TRANSPORT=smtp`, a api morre no start reclamando de `SMTP_HOST`,
`SMTP_USER`, `SMTP_PASSWORD` ou `SMTP_FROM` — mesmo padrão de mensagem dos
[quatro segredos irmãos](#segredos-irmaos-no-boot) ([RN-408](business-rules.md#rn-408)),
mas SEM o default público que eles têm: aqui a régua só entra quando o
operador optou por `smtp`.

```bash
export MAIL_TRANSPORT=smtp
export SMTP_HOST=smtp.seu-provedor.com
export SMTP_PORT=587
export SMTP_USER=usuario-do-provedor
export SMTP_PASSWORD="$(sua-credencial-do-provedor)"
export SMTP_FROM="Brabo <nao-responda@seu-dominio.com>"
```

`SMTP_PASSWORD` é segredo de INFRAESTRUTURA do serviço (env var simples,
como `AUTH_JWT_SECRET`), não segredo de USUÁRIO — não passa por envelope
encryption, e não tem procedimento de rotação próprio além de trocar a
variável e reiniciar (o provedor SMTP é quem decide a política de rotação
da credencial dele). Em Kubernetes, a chave entra em `brabo-secrets` como
qualquer outra, referenciada em
`deploy/k8s/base/common/externalsecrets.yaml`.

Se o e-mail não chega mesmo sem erro de boot: confira o log da api por
`falha ao enviar e-mail via SMTP` (`tipo`/destinatário aparecem, o corpo e o
token NUNCA aparecem — mesma régua do `LogMailSender`), e teste a
credencial com o cliente SMTP do provedor antes de suspeitar do Brabo.

### k3d é o padrão mesmo com kind instalado

Não é preferência. O k3s traz controlador de NetworkPolicy embutido; o
**kindnet do kind não implementa NetworkPolicy** e ignora os manifests em
silêncio. Num cluster kind, as políticas desta fase existem no etcd sem efeito
nenhum, e o deploy pareceria validado sem ter validado metade do item 4 do
escopo. O smoke avisa quando o cluster não faz enforcement.

### O que o smoke cobre

1. Todos os pods **Ready** — não só `Running`. Um pod cujo readiness falha fica
   `Running` para sempre sem receber tráfego.
2. Nenhum container com `runAsUser: 0`.
3. Login em `POST /auth/login` com o usuário do seed — exercita argon2id,
   emissão do access token e os cookies de sessão.
4. `workspace → projeto → sessão`. Este passo atravessa as NetworkPolicies
   inteiras: criar sessão faz a api chamar o engine por HTTP interno, com o
   service token. A sessão é criada com `kind: consultiva` — obrigatório desde
   a FASE 20 ([RN-097](business-rules.md#rn-097)) — e é `consultiva` de
   propósito: o smoke exercita criar → ativar → encerrar e nunca ativa
   execução, que numa consultiva responde `409`.

   **É este passo que prova que a rota tem consumidor fora do web.** Quando o
   `kind` nasceu obrigatório, a suite da api passou com 1562 testes e foi o
   smoke que reprovou, porque é o único que chama a rota como cliente externo,
   sem mock e contra a imagem de produção.
5. Probes distintas (`/live` e `/ready` do engine, `/live` da api) e o
   `/config.js` do web apontando para as URLs do cluster.
6. `oban_queue_depth` com os rótulos `queue` e `state` em `/metrics`.
7. `external.metrics.k8s.io` servindo a métrica — o modo de falha do
   prometheus-adapter é silencioso, então perguntamos direto à API agregada.

### Diagnóstico do deploy {#diagnostico-do-deploy}

#### `403` no `/internal/*`, ou `401` nas chamadas da api para o engine

Os dois sintomas têm a mesma causa: o service token não bate entre os lados
(a api recusa com `403`, o plug do engine com `401`). Confira que as duas
cargas leem o **mesmo** valor:

```bash
kubectl -n brabo get secret brabo-secrets -o jsonpath='{.data.BRABO_SERVICE_TOKEN}' | base64 -d | sha256sum
kubectl -n brabo exec deploy/engine -- sh -c 'printf %s "$BRABO_SERVICE_TOKEN" | sha256sum'
```

Comparar o hash em vez do valor evita imprimir o segredo no terminal. Se
divergirem, o pod do engine está com uma versão antiga do Secret: `kubectl -n
brabo rollout restart deploy/engine`. Se baterem, o cabeçalho não está
chegando: confira `BRABO_SERVICE_TOKEN` definido nas **duas** cargas — o engine
tem um default de desenvolvimento (`dev-service-token-change-me`), então
esquecer a variável só nele produz exatamente este sintoma, sem erro no boot —
e que nenhum proxy no caminho esteja removendo cabeçalhos desconhecidos.

#### Login devolvendo `401` para todo mundo depois de um deploy

Quase sempre é `AUTH_JWT_SECRET` novo sem a etapa de coexistência: o access
token some junto, mas o sintoma aparece no refresh. O procedimento correto está
em [Rotação das chaves do auth](#rotacao-das-chaves-do-auth).

#### `ExternalSecret` não fica Ready

O `SecretStore` lê o Secret-fonte `brabo`, criado imperativamente pelo
bootstrap. Confirme que ele existe e que o RBAC está no lugar:

```bash
kubectl -n brabo get secret brabo
kubectl -n brabo describe secretstore brabo-secret-store
```

#### HPA do engine em `<unknown>`

Na ordem, do mais provável ao menos:

```bash
# 1. o engine está expondo a métrica?
kubectl -n brabo exec deploy/engine -- wget -qO- http://127.0.0.1:4000/metrics | grep oban_queue_depth

# 2. o Prometheus está coletando?
kubectl -n monitoring port-forward svc/prometheus-server 9090:80
# depois: http://localhost:9090 -> Status -> Targets

# 3. o adapter está servindo?
kubectl get --raw "/apis/external.metrics.k8s.io/v1beta1/namespaces/brabo/oban_queue_depth?labelSelector=state%3Davailable"
```

Se (1) responde e (3) não, o problema é a regra em
`deploy/k8s/helm/prometheus-adapter-values.yaml`.

#### Job de migração não reaplica

`Job` tem spec imutável: com o Job anterior ainda no cluster, reaplicar com uma
imagem nova falha. O bootstrap já apaga os dois antes do apply; manualmente:

```bash
kubectl -n brabo delete job migrate-api migrate-engine --ignore-not-found
kubectl apply -k deploy/k8s/overlays/local
```

#### `bin/engine rpc` responde `eaddrinuse`

A faixa de portas da distribuição Erlang (`ERL_AFLAGS`) precisa ter mais de uma
porta: o nó em execução ocupa a primeira e o `rpc` sobe um nó oculto que
precisa de outra. A faixa configurada é 9100–9110, liberada na NetworkPolicy.

#### Conferir que as réplicas do engine estão em cluster

Sem cluster Erlang, o `:global.trans` do `Workspace.ensure!` não serializa nada
e duas réplicas fazem `git init` concorrente no mesmo diretório compartilhado:

```bash
kubectl -n brabo exec deploy/engine -- /app/bin/engine rpc 'IO.inspect(Node.list())'
```

Deve listar os outros pods. Lista vazia com mais de uma réplica é defeito.

### Segredos: fallback para sealed-secrets

O padrão é External Secrets Operator. Onde ele não for viável, substitua o
`ExternalSecret` de `deploy/k8s/base/common/externalsecrets.yaml` por
`SealedSecret`, **mantendo o mesmo nome de Secret (`brabo-secrets`) e as mesmas
chaves** — nada mais no deploy precisa mudar, porque tudo consome via
`secretRef`.

```bash
kubectl create secret generic brabo-secrets \
  --dry-run=client -o yaml \
  --from-literal=DATABASE_URL=... \
  --from-literal=SECRET_KEY_BASE=... \
  | kubeseal --format yaml > deploy/k8s/overlays/<env>/sealed-brabo-secrets.yaml
```

O `SealedSecret` é cifrado para a chave pública daquele cluster e pode ser
versionado. Um Secret plano **nunca** pode.

### Limites conhecidos deste ambiente

- **RWO em vez de RWX.** Funciona porque o cluster tem um nó só, e RWO
  significa "um NÓ", não "um pod". Num cluster real esta configuração colocaria
  api e engine em nós diferentes e o `git push` do dev agent falharia com
  `remote unpack failed`.
- **Sem pgvector** no Postgres do CloudNativePG. Hoje nenhuma migration cria a
  extensão e nenhuma coluna `vector` existe.
- **`.gitlab-ci.yml` sem validação estática local** (Fase 8c, ADR 0039). O
  subagente Workflows da área de Infra valida workflow do GitHub Actions com
  `actionlint` (pinado em `docker/engine/Dockerfile(.prod)`, mesmo padrão de
  `hadolint`/`gitleaks`); não existe binário offline equivalente pro GitLab
  CI — o linter oficial precisa de uma instância viva. Gap documentado, não
  meia-solução inventada.

---

## Rollout do engine {#rollout-do-engine}

Decisões em [ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md).

O engine hospeda os processos de sessão. Derrubar uma réplica sem cuidado
deixava, antes da Fase 5, **toda** sessão daquele pod pendurada em `active` sem
processo nenhum — nunca mais avançava e nunca fechava.

### O que acontece num rollout, em ordem

| fase | quanto | o que ocorre |
|---|---|---|
| `preStop` | até 45 s (`SHUTDOWN_DRAIN_TIMEOUT_MS`) | `Engine.Shutdown.drain/1`: `/ready` passa a 503, `/internal/sessions` recusa sessão nova, e cada sessão deste nó é oferecida a um par vivo |
| handoff por sessão | 5 s (`@handoff_timeout_ms`) | `:erpc.call` para outro nó assumir o processo |
| não adotadas | — | viram `closing` com causa `node_shutdown` e depois `closed_abnormally` |
| SIGTERM | resto dos 90 s (`terminationGracePeriodSeconds`) | a árvore de supervisão desce |

Os 90 s são deliberados: 45 s de drain + folga para o teardown do BEAM. Baixar
`terminationGracePeriodSeconds` sem baixar o timeout do drain faz o kubelet
matar o pod **no meio** do handoff — que é a forma de recriar exatamente o bug
que o drain existe para evitar.

### Fazer o rollout

```bash
kubectl -n brabo rollout restart deployment/engine
kubectl -n brabo rollout status  deployment/engine --timeout=300s
```

Com uma réplica só, não há par para adotar: **toda** sessão ativa vai terminar
como `closed_abnormally / node_shutdown`. Isso é correto, não é falha — mas se
o objetivo era não interromper ninguém, escale para 2 antes:

```bash
kubectl -n brabo scale deployment/engine --replicas=2
```

### Provar que não sobrou órfã

```bash
make rollout-test
```

Abre 5 sessões ativas, faz o rollout e exige que **cada uma** esteja num de dois
estados: `active` com dono `:global` vivo (adotada), ou `closed_abnormally` com
`node_shutdown` (drenada). Qualquer outra combinação reprova — em especial
`active` sem dono, que é a definição operacional de órfã.

**Ele guarda a evidência que os pods antigos levam junto** (AT-078). Antes do
`rollout restart`, `deploy/k8s/rollout-evidencia.sh` passa a gravar em
`ROLLOUT_EVIDENCE_DIR` (um `mktemp -d` se ausente; o caminho sai no fim) o log
de **todo** pod do engine — os de pé, desde o boot, que o rollout mata, e os
que nascerem —, `kubectl get events -w` do namespace, as réplicas do
Deployment e do HPA a cada 2s e cada leitura de dono (`donos.log`). Numa
órfã, a falha cita toda linha que menciona a sessão em todos esses arquivos,
o log do pod antigo inclusive, e diz se ela ficou sem dono **ANTES ou DEPOIS
do primeiro scale-down do HPA** — o confundidor conhecido: o `hpa-test` deixa
três réplicas e, uns 75s depois do rollout, o HPA desce para uma. Nada disso
muda o que conta como adotada ou drenada, nem o teto de 120s. A rodada
agendada sobe o diretório como artefato `rollout-evidencia`.

**Causa corrigida, sem confirmação no k3d** (AT-078, RN-588). A órfã que esta
prova pegou (~3 em 13 rodadas: sem linha em `session_states` e um segundo pod
ANTIGO em `donos-durante-rollout.log`) vinha do `Monitor` do pod antigo apagando
a linha depois de o par regravá-la durante o repasse. O drain agora marca o
repasse e o Monitor mantém a linha. Isso foi provado por um teste ExUnit
determinístico, não por esta prova, que falha 1 em 4-6 e não prova correção. Se
uma órfã aparecer de novo, o log do pod que repassou a sessão traz uma linha
`Monitor: session_state <id> mantido|apagado em <nó>` por sessão: sem linha, o
Monitor não chegou a processar o `:DOWN` (o pod morreu antes).

Manualmente, a mesma pergunta:

```sql
-- sessões ativas segundo a api
select id, status, updated_at from sessions where status = 'active';
```

```bash
# donos vivos segundo o engine
kubectl -n brabo exec deploy/engine -- \
  /app/bin/engine rpc ':global.registered_names() |> Enum.filter(&match?({:brabo_session, _}, &1)) |> length()'
```

Ativa na api sem dono no engine = órfã.

### Quando a sessão escapa {#quando-a-sessao-escapa}

**Sessão presa em `closing`.** `closing` é estado de passagem; parado ali
significa que o drain começou e não completou. O alerta *Sessão presa em
closing* dispara em 15 min. Investigue o log do pod que estava saindo — se ele
já sumiu, o `Adopter` (varredura a cada 30 s) deveria ter reassumido; se não
reassumiu, veja se a linha ainda existe em `engine.session_states`.

**Órfã depois de `kill -9` / OOMKill.** O `preStop` não roda nesses casos, por
definição. Quem cobre é o `SessionAdoptionWorker`, que a cada 30 s procura
linha em `session_states` sem dono `:global` e reassume. Se ele não está
rodando, a fila do Oban está parada — e aí o problema é outro (ver o alerta de
fila sem consumo em [Observabilidade](#observabilidade)).

**Rollout que trava em `preStop`.** Sintoma: pod em `Terminating` por 90 s
exatos, sempre. Quase certamente um `:erpc.call` esperando um nó que já morreu
mas ainda está em `Node.list()`. O timeout de 5 s por sessão limita o estrago;
90 s cheios significam ~18 sessões em sequência ou um handoff que não retorna.

**Nada é adotado, mesmo com 2 réplicas.** Os nós não estão se enxergando.
Confira o cluster Erlang:

```bash
kubectl -n brabo exec deploy/engine -- /app/bin/engine rpc 'Node.list()'
```

Lista vazia = o DNSCluster não resolveu o Service headless, ou a NetworkPolicy
está bloqueando a faixa de distribuição (9100–9110). Sem cluster, cada réplica
é uma ilha e todo rollout drena tudo.

### Aumentar a janela de drain

Se as sessões forem longas e o drain de 45 s não bastar, os dois valores sobem
**juntos** — e nesta ordem de raciocínio: escolha o drain, depois dê folga:

```yaml
# deploy/k8s/base/engine/deployment.yaml
terminationGracePeriodSeconds: 150   # drain + ~30s de teardown
# env SHUTDOWN_DRAIN_TIMEOUT_MS: "120000"
```

Mexer só no `terminationGracePeriodSeconds` não alonga o drain; mexer só no
drain faz o kubelet matar no meio.

---

## Restore {#restore}

Decisões em [ADR 0027](adr/0027-fase5-backup-hardening-release.md).

> **Testado.** O procedimento abaixo é exatamente o que `make test-restore`
> executa, e ele é rodado contra o cluster local. Não existe aqui nenhum passo
> que ninguém nunca exercitou. O registro da última execução está no fim.

### Onde está o backup

| o quê | onde |
|---|---|
| agendamento | CronJob `brabo-backup`, 03:17 UTC, diário |
| destino | bucket S3-compatível — `BACKUP_S3_ENDPOINT` / `BACKUP_S3_BUCKET` no Secret `brabo-secrets` |
| layout | `daily/brabo-<ISO>.dump` e `weekly/brabo-<ISO>.dump` |
| retenção | 7 diários + 4 semanais, por CONTAGEM (`BACKUP_KEEP_DAILY` / `BACKUP_KEEP_WEEKLY`) |
| formato | `pg_dump --format=custom --compress=9` |
| histórico | tabela `backup_runs` |

No cluster local o destino é um MinIO dentro do namespace `brabo`; em
staging/prod é o bucket real. O procedimento não muda — só o endpoint.

### Antes de restaurar: o backup existe e presta?

```sql
select finished_at, kind, status, object_key,
       pg_size_pretty(size_bytes) as tamanho, error_message
  from backup_runs
 order by finished_at desc
 limit 10;
```

Três coisas nessa saída importam mais que a última linha:

- **`status = 'failed'` recente com sucesso antigo** é o caso perigoso: existe
  backup, ele só é velho. O alerta *Última execução do backup falhou* cobre
  exatamente isso.
- **Queda brusca de `size_bytes`** entre execuções sugere dump truncado, e o
  tamanho sozinho não denuncia — o `pg_restore --list` do script é quem pega.
- **Nenhuma linha** significa que o CronJob nunca rodou com sucesso. Aí o
  problema não é o restore.

### O caminho automatizado (o mesmo que o teste roda)

```bash
make test-restore
```

Dispara um backup real, restaura em `brabo_restore_test`, valida e derruba a
database. Use quando o objetivo é **verificar** o backup, não recuperar dados.

### Restaurar de verdade, num incidente

O script `brabo-restore` restaura numa database NOVA e nunca toca na de origem
— de propósito. Restaurar por cima do banco vivo é irreversível e quase sempre
a decisão errada nos primeiros minutos de um incidente.

**1. Suba um Job de restore apontando para o nome de database que você quer:**

```bash
kubectl -n brabo create job restore-manual --from=cronjob/brabo-backup \
  --dry-run=client -o yaml \
| sed -e 's|\["brabo-backup"\]|["brabo-restore"]|' \
| kubectl -n brabo apply -f -

kubectl -n brabo set env job/restore-manual RESTORE_DB=brabo_recuperado
kubectl -n brabo logs -f job/restore-manual
```

Para restaurar de uma cópia semanal em vez da última diária:
`RESTORE_PREFIX=weekly/`.

**2. Confira o que voltou** — as mesmas perguntas que o script faz, agora com
os seus olhos:

```sql
-- quantas tabelas vieram (compare com a origem, não com um número fixo:
-- toda migration nova muda esta contagem)
select count(*) from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE';

-- o event log é denso por sessão: esta consulta tem que voltar VAZIA
select session_id, count(*), min(seq), max(seq)
  from session_events
 group by session_id
having count(*) <> max(seq) - min(seq) + 1 or min(seq) <> 1;
```

**3. Promova a database recuperada** apontando a `DATABASE_URL` para ela e
reiniciando api e engine. É a última etapa e a única destrutiva:

```bash
kubectl -n brabo patch secret brabo-secrets --type merge \
  -p "{\"data\":{\"DATABASE_URL\":\"$(printf '%s' "$NOVA_URL" | base64 -w0)\"}}"
kubectl -n brabo rollout restart deployment/api deployment/engine
```

> O Secret é materializado pelo External Secrets a partir do provider. Um
> `patch` direto é sobrescrito no próximo `refreshInterval` (1 h): mude
> **também** o valor no provider, ou o sistema volta sozinho para o banco
> antigo dentro de uma hora — em plena recuperação.

### O que o restore NÃO cobre

- **Credenciais de usuário ficam ilegíveis se a `CREDENTIALS_MASTER_KEY` for
  outra.** O dump traz os DEKs embrulhados, não as chaves. Restaurar num
  ambiente com master key diferente devolve o banco íntegro e as credenciais de
  LLM e git inúteis. Ver [Rotação da chave mestra](#rotacao-da-chave-mestra).
- **Nada de usuários fica de fora.** Desde o corte do Keycloak
  ([ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)) não existe
  banco de IdP separado: identidades, credenciais argon2id, refresh tokens e o
  event log do auth vivem no mesmo Postgres e entram neste dump. O que **não**
  sobrevive é a leitura deles se `AUTH_TOKEN_PEPPER` for outro — mesmo
  raciocínio da master key acima.
- **PVCs** (`/data/git-repos`, worktrees dos agentes) não são copiados. Os
  repositórios de verdade vivem no GitHub/GitLab; o que se perde é cache de
  trabalho em andamento.
- **Não é PITR.** A granularidade é o último dump; tudo escrito depois dele se
  perde. Se isso não for aceitável, o caminho é WAL archiving no CloudNativePG,
  que está fora do escopo desta fase.

### Quando o restore falha

| sintoma | causa provável |
|---|---|
| `nenhum backup em .../daily/` | bucket errado, credencial errada, ou o CronJob nunca rodou |
| `não é um dump custom íntegro` | upload interrompido; use o objeto anterior ou o `weekly/` |
| `pg_restore falhou` com erro de extensão | a database de destino precisa das mesmas extensões (`pgvector`); em CNPG elas vêm do cluster, não do dump |
| `faltam tabelas na restaurada` | dump de uma versão de schema diferente — o script diz QUAIS faltam; confira a data do objeto contra a migration mais recente |
| `fora da janela` numa tabela crítica | contagem incompatível com o instante do dump: investigue antes de promover |
| `server version mismatch` | o `pg_dump` do Job é 16; um cluster em major diferente recusa a conexão |
| timeout no Job | banco grande demais para `activeDeadlineSeconds`; suba o valor no Job, não no CronJob |

### Provas de propriedade agendadas {#provas-de-propriedade-agendadas}

`make test-restore`, `make rollout-test` e `make hpa-test` provam
**propriedades**, não configuração — um backup que roda toda noite e não
restaura passa nos cinco alertas de `brabo-alerts.yaml`. Até o BRB-009 elas só
rodavam quando alguém as digitava. `.github/workflows/propriedades.yml` agora
as roda por agendamento, num cluster k3d num runner hospedado pelo GitHub:

1. instala `k3d`, `helm` e `kubectl` por checksum pinado;
2. roda `deploy/k8s/bootstrap.sh` — o mesmo bootstrap que o
   `make deploy-local` roda, construindo as quatro imagens de produção a partir
   da árvore do checkout (sem registry, sem segredo);
3. roda `make smoke-k8s`, depois `make hpa-test`, `make rollout-test` e
   `make test-restore`, na ordem do `Makefile`, cada um mesmo quando um
   anterior falhou (um HPA quebrado não pode esconder um restore quebrado);
4. roda `make test-restore-mutacao` (AT-126, BRB-009), a prova **da** prova:
   ele tira um backup de verdade, depois cria na origem uma tabela
   (`zz_mutacao_restore`) que o dump não tem — exatamente "um dump sem uma
   tabela" — e roda o mesmo `brabo-restore`. Só passa se o restore o
   **recusar** nomeando essa tabela (a linha de log
   `faltando: zz_mutacao_restore`); se o restore aprovar, ou recusar por outro
   motivo, o passo falha e abre issue própria. Um `make test-restore` verde diz
   que o backup restaura; este diz que a prova ainda perceberia se não
   restaurasse. A tabela é apagada na saída, mesmo em falha. Roda mesmo quando
   o `make test-restore` falhou (uma prova cega e um restore quebrado são dois
   defeitos, e os dois precisam aparecer);
5. roda `make test-reprojecao-k8s` (AT-127, BRB-018): o grafo não entra no
   backup ([ADR 0152](adr/0152-backup-de-volumes-contra-compose.md)) porque é
   reprojetado a partir do event log, então o workflow prova isso também — ele
   cria um projeto próprio com uma sessão fechada e dois eventos, o reprojeta,
   **apaga esse subgrafo** no Neo4j, reprojeta e exige as mesmas contagens de
   nós e arestas, e então reprojeta mais uma vez. Não usa estado deixado pelos
   outros alvos e **não** está acoplado ao `test-restore` (o grafo não depende
   de backup);
6. só quando **ambos**, o restore e a quebra proposital, passaram na mesma
   rodada, escreve `ultima-execucao-boa.json` (data, rodada, commit, duração do
   restore), o sobe como o artefato `restore-ultima-execucao-boa` (guardado 90
   dias) e acrescenta a linha *Última execução boa do restore* ao resumo da
   rodada;
7. escreve a duração de cada passo no resumo da rodada.

| gatilho | quando |
|---|---|
| `schedule` | semanal, domingo 04:00 UTC |
| `workflow_dispatch` | sob demanda, pela aba Actions (`gh workflow run propriedades.yml`) |

**Uma falha abre issue** com o título `Prova de propriedade falhou: <alvo>`,
uma por alvo, e a falha repetida do mesmo alvo **comenta na issue aberta** em
vez de abrir outra. O bootstrap tem título próprio: com o cluster fora do ar,
os três alvos ficam `skipped`, e uma rodada agendada pulada é justamente o
silêncio que isto existe para quebrar. Feche a issue quando a prova voltar a
passar. **Não** é gate nem check obrigatório — nada espera por ela.

Medido nas rodadas que construíram o workflow (4 vCPUs, 15 GiB de RAM, 87 GB de
disco livre no `ubuntu-latest`):

| passo | duração |
|---|---|
| bootstrap (build das imagens + cluster + operadores + app) | 705 s |
| `make smoke-k8s` | 1 s |
| `make hpa-test` | 19 s |
| `make rollout-test` | 24 s |
| `make test-restore` | 21 s |
| `make test-restore-mutacao` | 31 s (rodada `35473548113`) |
| `make test-reprojecao-k8s` | 16 s (rodada `35471428634`) |
| job inteiro | 12 min 56 s |

(Primeira rodada toda verde, `34784563928`, em 2026-09-13.)

A cadência acompanha esse custo. Quase tudo é o bootstrap, que uma rodada
noturna pagaria sete vezes por semana para reprovar propriedades cujo código
muda bem menos que isso; semanal mantém o alarme dentro de uma sprint, e o
`workflow_dispatch` cobre o "acabei de mexer no backup". O timeout do job é de
90 minutos e só o passo do restore tem teto de 20 — ver o comentário naquele
passo para o porquê de o teto ser do passo e não do script.

**O que as primeiras rodadas encontraram**, cada coisa invisível ao
`kubeconform` e a todo check de PR, e cada uma corrigida na mesma mudança que
criou o workflow — o `make deploy-local` estava quebrado na `dev` havia semanas
sem ninguém rodá-lo:

1. O `imageName` do cluster CNPG pinado só por digest
   ([ADR 0159](adr/0159-imagem-de-terceiro-por-digest.md)) é recusado pelo
   webhook do operador — *"Can't use just the image sha as we can't detect
   upgrades"*. Agora ele leva `:16.10@sha256:…`.
2. O Secret-fonte do bootstrap não tinha `NEO4J_PASSWORD`, que o
   `ExternalSecret` da base lê desde o grafo
   ([ADR 0099](adr/0099-neo4j-grafo-de-conhecimento-e-templates.md)): o
   `brabo-secrets` nunca materializou e todo pod ficou em
   `CreateContainerConfigError`.
3. A api não recebia nem `NEO4J_URI` nem `NEO4J_USER` no cluster, e em modo de
   produção ela recusa subir sem os três.
4. O StatefulSet do Neo4j exportava `NEO4J_USER`/`NEO4J_PASSWORD`, que o
   entrypoint da imagem transforma em chaves de configuração e recusa
   (*"Unrecognized setting"*) — o próprio defeito de que um comentário duas
   linhas abaixo avisava. Esses manifests nunca tinham rodado num cluster.
5. O `migrate-api` não conseguia `CREATE EXTENSION vector` (o papel da
   aplicação não é superusuário), então a api subia sem tabelas. O cluster CNPG
   local agora a cria como superusuário, na database da aplicação e no
   `template1`.
6. `deploy/k8s/smoke.sh` e `rollout-test.sh` nunca mandavam o `kind` da sessão,
   que virou obrigatório na FASE 20 (o `docker/smoke.sh` o ganhou então), então
   os dois falhavam com 400 antes de provar qualquer coisa.
7. O `make test-restore` morria no `pg_restore` com *"permission denied to
   create extension vector"* — o caso que a tabela acima já nomeia — porque
   nada no cluster local fornecia a extensão à database que o restore cria.
8. Com a extensão fornecida, o `pg_restore` ainda morria — agora com *"must be
   owner of extension vector"*, no `COMMENT ON EXTENSION` do dump: só o dono da
   extensão pode comentá-la, e onde o papel da aplicação não é superusuário
   (CNPG, qualquer Postgres gerenciado) a extensão pertence a outro papel.
   **Este não é local ao cluster**: o mesmo `brabo-restore` é o procedimento de
   incidente, então um restore real num Postgres assim teria falhado igual. O
   `restore.sh` agora restaura a partir do índice do dump menos o comentário da
   extensão — uma string de descrição que a extensão instala, da qual nenhum
   dado e nenhuma validação dependem. Reproduzido contra um container
   `pgvector` simples com papel não-superusuário antes e depois da mudança.
9. `deploy/k8s/test-restore.sh` esperava com `kubectl wait
   --for=condition=complete`, que nunca vê um Job que **falhou**, então o
   restore quebrado acima gastou o teto inteiro de 20 minutos do passo para
   relatar o que o log do Job dizia em segundos (o teto do próprio script era
   30). Agora ele sonda as duas condições e falha assim que o Job fica
   `Failed`.
10. `rollout-test.sh` procurava órfãs depois de um `sleep 15` fixo, que não
    distingue *ainda assentando* de *órfã de vez*. Agora sonda até um teto
    (`ROLLOUT_CONVERGENCE_SECONDS`, default 120) e registra, antes do rollout,
    em que réplica cada sessão morava — os pods antigos levam os logs com eles.

**Medido, e a causa provável já corrigida** (AT-078,
[RN-588](pathname://../business-rules#rn-588)) — o `Monitor` do pod antigo apagando a
linha de `session_states` que o par acabara de regravar; ver
[Provar que não sobrou órfã](#rollout-do-engine) para o que uma órfã nova
registraria no log. O que segue é o registro de antes da correção. **A prova de
rollout tinha falhado uma vez em quatro rodadas que chegaram a ela** (duas em
dez até a rodada `35448353884`, 2026-09-19, em que as cinco sessões moravam no
mesmo pod antigo, quatro foram adotadas e uma terminou sem dono e sem drenagem;
os únicos logs que a nomeavam morreram com esse pod — é por isso que a prova
agora os guarda, ver [Provar que não sobrou órfã](#rollout-do-engine)). Com o
mesmo script e a mesma espera fixa, a rodada `34773908653` passou e a
`34775712706` relatou uma órfã — uma sessão `active` na api sem dono em nenhuma
das três réplicas do engine, 15 s depois de o `rollout status` retornar. As
duas rodadas com a espera limitada passaram, e as duas convergiram em **3 s**,
as cinco sessões adotadas. Uma convergência normal de 3 s torna "a órfã só
precisava de mais que 15 s" a leitura menos provável; a mais provável é uma
corrida intermitente na adoção ou na drenagem que a espera fixa por acaso
pegou. Fica como está de propósito: o workflow existe para pegar exatamente
isso, e a próxima ocorrência agora vai falhar com o teto que esperou, onde cada
sessão morava antes do rollout e as linhas do engine que nomeiam a órfã. A
correção é do engine, não desta prova.

### Última execução verificada

> **A data desta seção deixou de ser mantida à mão** (AT-126). A rodada mais
> recente de `propriedades.yml` que tem o artefato `restore-ultima-execucao-boa`
> é a última vez em que o restore passou no Kubernetes **e** uma quebra
> proposital dele (`make test-restore-mutacao`) foi pega na mesma rodada:
> `gh run list --workflow propriedades.yml --status success --limit 1` e
> `gh run download <run> -n restore-ultima-execucao-boa` (guardado por 90 dias).
> É artefato de workflow, não métrica. O registro abaixo é o histórico da
> primeira verificação.

<!-- Atualize esta seção sempre que rodar o teste num ambiente novo. -->

| campo | valor |
|---|---|
| data | 2026-07-27 |
| ambiente | cluster local k3d, PostgreSQL 16.10 (CloudNativePG), MinIO |
| comando | `make test-restore` |
| RTO observado | ~40 s do disparo do backup ao veredito (banco de ~108 KB) |

Saída:

```
[restore]   ok    dump íntegro (108127 bytes)
[restore] restaurando em brabo_restore_test
[restore]   ok    pg_restore concluído
[restore]   ok    35 tabelas restauradas, idênticas à origem
[restore]   ok    users: 2 linhas (janela 2–2)
[restore]   ok    projects: 2 linhas (janela 2–2)
[restore]   ok    sessions: 2 linhas (janela 2–2)
[restore]   ok    session_events: 7 linhas (janela 7–7)
[restore]   ok    proposed_actions: 0 linhas (janela 0–0)
[restore]   ok    event log íntegro: 7 eventos em 2 sessões, seq densa a partir de 1
[restore] RESTORE VALIDADO — todas as verificações passaram
```

O RTO acima é de um banco vazio de produção — serve para provar o
PROCEDIMENTO, não para dimensionar uma recuperação real. Meça de novo com um
dump representativo antes de prometer RTO a alguém.

#### O que essa execução encontrou (e que o teste agora impede)

1. **Divergência de major do Postgres.** O CloudNativePG local subia 17.4
   enquanto o compose diz 16; o `pg_dump` recusou a conexão com "server version
   mismatch". O `imageName` do cluster foi pinado em 16.10.
2. **Falso verde por banco vazio.** Com zero linhas, toda comparação de
   contagem vira `0 == 0` e a checagem de `seq` não olha nada. Hoje o script
   reprova explicitamente nos dois casos.
3. **Contagem fixa de tabelas envelhece.** A validação comparava com um número
   escrito no script, que ficou desatualizado na mesma sessão. Agora compara a
   LISTA de tabelas contra a origem e diz qual falta.
4. **A imagem de backup carregava 48 CVEs HIGH/CRITICAL** vindas do `mc` (Go
   congelado desde setembro/2025) e do `gosu` da base `postgres:16-alpine`.
   Trocada por `alpine` + `postgresql16-client` + `aws-cli`, tudo do apk e
   portanto patchável: 48 → 0. Ver a decisão 1b do ADR 0027.

---

## Rotação das chaves do auth {#rotacao-das-chaves-do-auth}

Decisões em
[ADR 0031](adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) e
[ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md).

O auth first-party tem **três** segredos, com consequências bem diferentes ao
serem trocados. Confundir os dois primeiros é o erro caro aqui.

### `AUTH_JWT_SECRET` — rotação sem downtime

Dela é derivado o par Ed25519 que assina o access token. A rotação é a mesma
dança em três etapas da chave mestra (abaixo):

1. `AUTH_JWT_SECRET_PREVIOUS` recebe o valor antigo; `AUTH_JWT_SECRET` recebe o
   novo. Reinicie a api.
2. As duas chaves aparecem no `/.well-known/jwks.json` e as duas verificam;
   só a nova **assina**. A api emite um `WARN` uma vez por processo, na
   primeira verificação ou leitura do JWKS depois do boot (a chave anterior é
   derivada sob demanda, não na subida), enquanto isso durar.
3. Passados 15 minutos (o TTL do access token), nenhum token da chave antiga
   sobrevive. **Remova `AUTH_JWT_SECRET_PREVIOUS`** e reinicie.

Ninguém é deslogado — **desde que `AUTH_TOKEN_PEPPER` esteja definido**. Os
refresh tokens são hasheados com o pepper, não com esta chave; mas um pepper
ausente cai no `AUTH_JWT_SECRET`, e aí rotacionar esta chave é também rotacionar
o pepper, com o logout global descrito abaixo
([RN-597](pathname://../business-rules/autenticacao#rn-597)). O Kubernetes define o pepper
à parte; o `docker-compose.prod.yml` e o `docker-compose.install.yml` não o
repassam à api.

Verificação: `apps/api/test/infrastructure/security/ed25519-access-token-issuer.spec.ts`
(describe "rotação de chave") e, para a condição do pepper,
`apps/api/test/application/use-cases/auth/rotacao-dos-segredos.spec.ts`.

### `AUTH_TOKEN_PEPPER` — logout global, sem meio-termo

É a chave HMAC do hash dos refresh tokens e dos tokens de conta. Trocá-la
invalida, de uma vez:

- **todos** os refresh tokens em circulação — todo mundo é deslogado;
- **todos** os links de verificação de e-mail e de reset de senha em aberto;
- **todos** os personal access tokens (PAT) — um runner iniciado com `--token`
  para de autenticar (chaves de dispositivo não são afetadas);
- os contadores de lockout: toda conta travada é destravada.

As senhas sobrevivem (argon2id, sem pepper): as pessoas entram de novo
normalmente. Um refresh recusado assim aparece como `refresh_unknown` em
`auth_events`, não como `refresh_reuse_detected`.

Não existe `AUTH_TOKEN_PEPPER_PREVIOUS`, e é decisão consciente: aceitar dupla
verificação em todo refresh, para sempre, por um cenário que roda uma vez a
cada nunca, não paga. Se for preciso trocar — suspeita de vazamento do banco,
por exemplo — avise antes: o sintoma para o usuário é ser deslogado sem motivo
aparente e ver o link de reset "expirado".

> A api **não** falha ao subir com um pepper novo. Ela simplesmente não
> reconhece nenhum token antigo. Se o suporte relatar "todo mundo deslogado ao
> mesmo tempo", esta variável é o primeiro lugar a olhar — e, se ela nunca foi
> definida, o `AUTH_JWT_SECRET`.

Verificação: `apps/api/test/application/use-cases/auth/rotacao-dos-segredos.spec.ts`
([RN-597](pathname://../business-rules/autenticacao#rn-597)).

### `BRABO_SERVICE_TOKEN` — rotação sem downtime, nos dois lados

É o segredo compartilhado que autentica o tráfego api ↔ engine
([RN-035](business-rules/autenticacao.md#rn-035)). Não tem nada a ver com sessão de usuário:
trocá-lo errado não desloga ninguém, derruba a comunicação interna.

A dança é a mesma do `AUTH_JWT_SECRET`, com a diferença de que ela roda nas
**duas** cargas — e a ordem importa, porque cada lado envia o atual e aceita
ambos:

1. `BRABO_SERVICE_TOKEN_PREVIOUS` recebe o valor antigo em **api e engine**;
   `BRABO_SERVICE_TOKEN` recebe o novo nos dois. Reinicie os dois. Em produção
   a api confere o valor antigo com a mesma régua do novo, então se o antigo
   for o default público ou tiver menos de 16 caracteres, a api recusa subir
   nesta etapa e nomeia a variável
   ([RN-598](pathname://../business-rules/autenticacao#rn-598)). Sair de um token fraco,
   portanto, significa pular o `_PREVIOUS` e pagar com a janela de `403`/`401`
   descrita abaixo.
2. Enquanto os dois estiverem de pé com a variável nova, o tráfego funciona em
   qualquer combinação de pods velhos e novos — é isso que torna o rollout
   seguro no meio do caminho.
3. Concluído o rollout dos dois Deployments, **remova
   `BRABO_SERVICE_TOKEN_PREVIOUS`** e reinicie.

Pular a etapa 1 e trocar só o valor atual produz `403`/`401` durante toda a
janela em que sobrar um pod antigo de qualquer lado — o sintoma do
[diagnóstico acima](#diagnostico-do-deploy).

Verificação: na api, `apps/api/test/infrastructure/security/service-token.spec.ts`
(describe "rotação do BRABO_SERVICE_TOKEN") e
`apps/api/test/interfaces/engine-service.guard.spec.ts`; no engine,
`apps/engine/test/engine_web/plugs/verify_service_token_test.exs`.

> **Onde as variáveis `_PREVIOUS` chegam ao processo.** Nos três composes
> (`docker-compose.yml`, `docker-compose.prod.yml`,
> `docker-compose.install.yml`) todas estão mapeadas no `environment:` do
> serviço que as lê, vazias por padrão — definir uma no `.env` e recriar o
> serviço basta ([RN-595](pathname://../business-rules/autenticacao#rn-595); guardado por
> `scripts/ci/previous-nos-composes.spec.ts`, que deriva a lista do código).
> **No Kubernetes ainda não**: os Pods leem `envFrom: brabo-secrets`, e o
> `ExternalSecret` (`deploy/k8s/base/common/externalsecrets.yaml`) só
> materializa as chaves que lista. Elas não estão listadas de propósito — uma
> entrada de `data` cuja propriedade falta no provider reprova a
> sincronização do Secret inteiro, e `_PREVIOUS` ausente é o estado normal.
> Como elas chegam ao Pod é decisão aberta sobre o cofre de segredos; até lá,
> uma rotação no cluster exige a variável definida à mão no Deployment. Nos
> dois casos, confirme dentro do container (`printenv`) antes de contar com a
> etapa 2.

```bash
# gere um valor com entropia suficiente; ele nunca precisa ser digitado
openssl rand -base64 48
```

### Conta travada por lockout

O bloqueio é curto (30 s a 15 min) e se resolve sozinho: a janela deslizante
drena. **Não existe endpoint de destrava**, de propósito — ver
[RN-031](business-rules/autenticacao.md#rn-031). Se for preciso destravar alguém agora:

```sql
-- A chave é um HMAC do e-mail, não o e-mail. Encontre pelo evento recente:
select subject_key, count(*), max(occurred_at)
  from auth_events
 where kind in ('login_failure', 'login_blocked_user')
   and occurred_at > now() - interval '30 minutes'
 group by subject_key order by 3 desc;

delete from auth_lockout_hits where bucket_key = '<subject_key>';
```

Um reset de senha bem-sucedido também destrava a conta.

> **A trilha nunca é apagada.** `auth_lockout_hits` é contador efêmero;
> `auth_events` é append-only e sobrevive a tudo, inclusive à remoção do
> usuário (não há chave estrangeira, de propósito).

## Rotação da chave mestra {#rotacao-da-chave-mestra}

Decisões em [ADR 0027](adr/0027-fase5-backup-hardening-release.md).

A `CREDENTIALS_MASTER_KEY` embrulha os DEKs que cifram os segredos do usuário:
chaves de API de LLM e tokens de git. Ela é rotacionada periodicamente e,
obrigatoriamente, depois de qualquer suspeita de vazamento.

### O que está em jogo

Trocar a variável e reiniciar a api com uma chave só torna ilegível toda
credencial existente, de uma vez, sem erro no boot — a falha só aparece no
primeiro uso, como "não foi possível decriptar", e não há caminho de volta a não
ser restaurar a chave antiga.

Por isso a rotação tem três etapas e não uma. Durante a do meio, as duas chaves
coexistem:

| variável | papel |
|---|---|
| `CREDENTIALS_MASTER_KEY` | chave ATUAL — usada sempre para cifrar |
| `CREDENTIALS_MASTER_KEY_PREVIOUS` | chave anterior — tentada só quando a atual falha |

Duas tabelas guardam envelopes: `user_credentials` e `project_git_connections`.

Desde a [RN-563](pathname://../business-rules#rn-563) cada envelope carrega também um
**`key_id`** — a impressão digital da chave que o embrulhou. É ele que torna o
progresso da etapa 2 respondível em SQL. Duas coisas sobre ele importam às 3h
da manhã:

- **Ele nunca decide se uma linha abre.** A leitura continua tentando a chave
  atual e caindo para a anterior; o AES-GCM autentica, e é ele a autoridade. O
  rótulo é metadado, e uma linha cujo rótulo discorda do envelope continua
  sendo re-embrulhada corretamente
  ([ADR 0158](adr/0158-o-id-da-chave-mestra-gravado-no-envelope.md)).
- **`key_id IS NULL` quer dizer "gravada antes de a coluna existir", nunca "na
  chave atual".** Numa instalação anterior a ela, tudo é `NULL` até a primeira
  rotação, e as consultas abaixo contam isso como pendente — que é a resposta
  honesta.

Pegue a impressão digital atual do próprio log da api; ela imprime uma linha no
boot:

```bash
kubectl -n brabo logs -l app.kubernetes.io/name=api --tail=200 \
  | grep 'chave mestra corrente'
# chave mestra corrente: key_id=4f2b91c0a77e13d5
```

### Antes: dimensione

```sql
select 'user_credentials' as tabela, count(*) from user_credentials
union all
select 'project_git_connections', count(*) from project_git_connections;
```

O re-embrulho é um UPDATE por registro. Milhares de linhas levam segundos; é
bom saber a ordem de grandeza antes de começar.

### 1. Publicar as duas chaves

Gere a nova e publique **as duas** no provider de segredos, mantendo a antiga
em `CREDENTIALS_MASTER_KEY_PREVIOUS`:

```bash
openssl rand -hex 32   # a chave nova
```

No cluster local o Secret-fonte é criado pelo bootstrap; em staging/prod o valor
vai no provider que o External Secrets lê. Depois, reinicie a api para que ela
carregue as duas:

> Publicar `CREDENTIALS_MASTER_KEY_PREVIOUS` no provider **não** a coloca no
> Pod: o `ExternalSecret` não a lista (ver a nota no fim de
> [Rotação das chaves do auth](#rotacao-das-chaves-do-auth)). Até essa decisão
> ser tomada, defina-a à mão no Deployment da api durante a rotação e remova-a
> na etapa 3. Nos composes ela já está mapeada — é o `.env` mais recriar a api.

```bash
kubectl -n brabo rollout restart deployment/api
kubectl -n brabo rollout status  deployment/api
```

Confirme que a api está no modo de rotação — ela avisa no log, de propósito, e o
aviso nomeia **as duas** impressões digitais, que é contra o que as consultas
abaixo comparam:

```bash
kubectl -n brabo logs -l app.kubernetes.io/name=api --tail=50 \
  | grep CREDENTIALS_MASTER_KEY_PREVIOUS
# ... rotação em andamento (atual key_id=<NOVA>, anterior key_id=<ANTIGA>). ...
```

> A partir daqui **nada quebra**: segredo novo já nasce na chave nova, segredo
> antigo continua legível pela anterior. Você pode parar neste estado por horas
> se precisar — mas não por semanas: aceitar duas chaves dobra a superfície de
> uma chave vazada, que é justamente o motivo da rotação.

### 2. Re-embrulhar o acervo

```bash
kubectl -n brabo exec deploy/api -- node scripts/rewrap-deks.js
```

Saída esperada:

```
[rewrap] resultado

  user_credentials         total=12  re-embrulhados=12  já na chave atual=0  falhas=0
  project_git_connections  total=3   re-embrulhados=3   já na chave atual=0  falhas=0

[rewrap] concluído. Agora remova CREDENTIALS_MASTER_KEY_PREVIOUS e reinicie a api.
```

Propriedades que importam se algo interromper o script:

- **Idempotente.** Rodar de novo conta os já convertidos em
  `já na chave atual` e não reescreve nada. Interrompeu? Rode outra vez.
- **Só o envelope muda.** O texto cifrado do segredo permanece byte a byte o
  mesmo, então parar no meio deixa o acervo consistente: parte na chave nova,
  parte na antiga, e as duas legíveis enquanto a PREVIOUS existir.
- **`falhas > 0` bloqueia a etapa 3.** São registros que não abrem com nenhuma
  das duas chaves — normalmente vindos de outro ambiente, ou de uma rotação
  anterior interrompida com a chave já descartada. O script identifica cada um
  por id, e nomeia POR QUE falhou — uma linha de outro ambiente ("embrulhado
  pela chave `<kid>`"), uma linha cujo rótulo discorda do envelope ("rótulo
  incoerente ou registro adulterado") e uma linha sem rótulo nenhum são três
  diagnósticos diferentes com três respostas diferentes. Não remova a
  PREVIOUS: sem ela você perde também o que ainda abria.

**Interrompeu e quer saber onde parou?** Pergunte ao banco em vez de rodar o
script de novo pelo contador — com `<NOVA>` sendo a impressão digital atual do
log acima:

```sql
select 'user_credentials' as tabela, count(*) as pendentes
  from user_credentials       where key_id is distinct from '<NOVA>'
union all
select 'project_git_connections', count(*)
  from project_git_connections where key_id is distinct from '<NOVA>';
```

`is distinct from`, nunca `<>`: linhas com `key_id IS NULL` precisam contar
como pendentes, e o `<>` as descartaria em silêncio.

### 3. Descartar a chave antiga

Só depois de `falhas=0` **e** de a consulta acima responder `0` nas duas
tabelas. As duas dizem coisas diferentes e você quer as duas: `falhas=0`
significa que nada recusou abrir nesta rodada, e a consulta significa que nada
ficou para trás — inclusive linhas que uma rodada anterior, interrompida, nunca
alcançou.

```bash
# remova CREDENTIALS_MASTER_KEY_PREVIOUS do provider e então
kubectl -n brabo rollout restart deployment/api
```

Verifique que o aviso de rotação sumiu do log e que uma credencial existente
ainda funciona (o caminho mais direto é a tela de credenciais do projeto, ou
qualquer turno de agente que use chave de LLM).

### Verificar sem esperar um incidente

**O ciclo inteiro tem verificação nomeada, e ela roda no CI**
([RN-562](pathname://../business-rules#rn-562)):

```bash
pnpm --filter api test -- test/scripts/rewrap-deks.spec.ts
```

Esse spec percorre a sequência desta página contra um Postgres de verdade e
**as duas** tabelas: cifra com K1, publica K2, re-embrulha, descarta K1 e ainda
decifra. Ele também fixa as duas propriedades em que este procedimento se
apoia — idempotência (uma segunda rodada relata `re-embrulhados=0`) e a linha
ilegível contada e nomeada sem abortar as outras.

Cobertura mais estreita, em memória, das mesmas primitivas — inclusive o caso
em que nenhuma das duas chaves serve, e o caso em que o rótulo `key_id` mente —
mora em `test/infrastructure/security/envelope-encryption.service.spec.ts`.

O `rewrap` também roda em qualquer ambiente: num de teste, o ciclo completo à
mão cabe em poucos minutos.

> **TODO(humano):** esta rotação já foi executada de verdade, em algum
> ambiente? Nenhuma fonte registra uma execução com data, e isso muda se o spec
> acima é rede de segurança ou a primeira prova.

### Interação com o restore

**Restaurar um dump num ambiente com master key diferente devolve o banco
íntegro e as credenciais inúteis.** O dump carrega os DEKs embrulhados, não a
chave. Se você restaurou um backup de produção num ambiente de teste e as
credenciais não abrem, não há corrupção: é a chave errada — e desde a
[RN-563](pathname://../business-rules#rn-563) dá para confirmar isso numa comparação em vez
de por eliminação, lendo o `key_id` de qualquer linha e pondo-o ao lado da
linha `chave mestra corrente` do log de boot da api. Ver
[Restore](#restore).

Por isso a chave mestra faz parte do plano de recuperação: um backup do banco
sem a chave correspondente não recupera os segredos do usuário.

### Quando algo dá errado

| sintoma | causa |
|---|---|
| api sobe sem aviso de rotação, mas o script exige a PREVIOUS | a variável não chegou ao pod; o ESO só ressincroniza a cada `refreshInterval` (1 h) |
| `falhas` igual ao total | a PREVIOUS publicada não é a chave que embrulhou o acervo |
| `já na chave atual` igual ao total, sem ter rodado antes | as duas variáveis têm o mesmo valor — o serviço ignora a PREVIOUS nesse caso |
| credencial para de funcionar DEPOIS da etapa 3 | algum registro ficou para trás; republique a PREVIOUS imediatamente e rode o script de novo. A consulta de progresso da etapa 2 é o que evita isso, e é a primeira checagem a fazer |
| a consulta de pendentes responde o total inteiro, num banco que ninguém rotacionou ainda | esperado: o `key_id` é gravado da próxima escrita em diante, então uma instalação anterior à [RN-563](pathname://../business-rules#rn-563) o tem `NULL` em tudo até a primeira rotação. `NULL` conta como pendente de propósito — "não sei qual chave" não é "já na atual" |
| o `rewrap` diz que uma linha está numa chave que não é nem a atual nem a anterior | a linha veio de outro ambiente — quase sempre um dump restaurado entre instalações. Ver [Interação com o restore](#rotacao-da-chave-mestra) acima; o `key_id` da linha contra o do log de boot da api diz de relance |

---

## Incidente de custo {#incidente-de-custo}

Os agentes gastam token a cada turno, e um agente em laço gasta rápido. Esta
seção é para o momento em que o custo por hora dispara e alguém precisa decidir
o que cortar.

### Sinal

O alerta *Custo por hora acima do limite* dispara com gasto projetado acima de
USD 5/hora em qualquer projeto:

```promql
max(sum by (project) (rate(brabo_llm_cost_micros_total[10m])) * 3600 / 1000000)
```

O alerta é **aviso**, não freio. O freio de verdade é o `budgets` do domínio, e
ele age por projeto/sessão, não globalmente
([RN-019](business-rules/custo.md#rn-019)).

### 1. Qual projeto, qual agente

Grafana → dashboard **Brabo · visão executiva** → painel de custo por projeto.
Ou direto no banco, que dá também o agente e o modelo:

```sql
select s.project_id,
       tu.actor_id                             as agente,
       tu.model_name,
       count(*)                                as chamadas,
       sum(tu.cost_micros) / 1e6               as usd,
       round(avg(tu.latency_ms))               as latencia_media_ms
  from token_usage tu
  join sessions s on s.id = tu.session_id
 where tu.created_at > now() - interval '1 hour'
 group by 1, 2, 3
 order by usd desc
 limit 20;
```

Duas leituras mudam a ação:

- **Um agente dominando a lista** com muitas chamadas curtas é laço: o ToolLoop
  repetindo a mesma ferramenta sem convergir.
- **Poucas chamadas e custo alto** é modelo caro num trabalho barato — binding
  errado, não laço.

### 2. Ver o orçamento

```sql
select b.project_id, b.session_id,
       b.limit_micros / 1e6  as limite_usd,
       b.spent_micros / 1e6  as gasto_usd,
       round(100.0 * b.spent_micros / nullif(b.limit_micros, 0)) as pct,
       b.policy
  from budgets b
 order by pct desc nulls last;
```

`policy` decide o comportamento no teto:

- **`block`** — a chamada é recusada. É o default e o que se quer em produção.
- **`allow`** — o teto vira apenas registro; o gasto continua. Um projeto em
  `allow` gastando muito **não vai parar sozinho**. Confira isto antes de
  qualquer outra coisa: é a causa mais comum de "o orçamento não segurou".

### 3. Cortar o gasto

Em ordem de reversibilidade, do mais brando ao mais drástico.

**a) Tirar os agentes da autonomia automática.** Eles param de agir sozinhos e
voltam a exigir aprovação por ação, sem perder contexto:

```sql
update agent_autonomy
   set mode = 'require_approval', updated_at = now()
 where project_id = '<projeto>'
   and mode = 'auto_approve';
```

`agent_autonomy.mode` é o enum `permission_policy`
(`auto_approve | require_approval | deny`) — não existe valor `manual`, e uma
versão anterior deste passo o usava e falhava na hora. O
`and mode = 'auto_approve'` é de propósito: sem ele, o update transformaria
toda linha `deny` do projeto em `require_approval`, afrouxando justamente o que
alguém tinha fechado. As linhas `"*"` (modo automático, RN-153) entram no mesmo
update.

O que este passo **não** corta: um padrão em `allow` no `permissions.json` do
projeto continua auto-aprovando o que casa — `decide()` lê o arquivo depois de
`agent_autonomy`, e o arquivo pode subir a decisão de volta para
`auto_approve` (`apps/api/src/domain/actions/decide.ts`, `decide`). Se o gasto
vem de comandos que o arquivo permite, vá para o (c).

Os blocos SQL desta seção são executados contra o schema migrado por
`apps/api/test/runbook/sql-do-incidente-de-custo.spec.ts`, que também confere
que o (a) muda `auto_approve` e deixa `deny` como está — valor inválido ou
coluna renomeada aqui reprova a suíte da api, não o incidente.

**b) Trocar o binding de modelo para um local.** Ollama custa zero; a qualidade
cai, o gasto para na hora:

```sql
-- veja o binding em vigor e o escopo que o resolve
select scope, scope_id, model_id from model_bindings where scope_id = '<projeto>';
```

Depois aponte o binding do projeto para um modelo `local` pela tela de
configuração (o escopo mais específico vence: sessão > agente > projeto >
workspace — [RN-020](business-rules/custo.md#rn-020)).

**c) Baixar o teto e garantir `block`.** Faz o próprio domínio recusar as
próximas chamadas:

```sql
update budgets
   set policy = 'block',
       limit_micros = least(limit_micros, spent_micros + 1000000)  -- +1 USD
 where project_id = '<projeto>';
```

**d) Encerrar as sessões do projeto.** Último recurso: interrompe o trabalho em
andamento. Use a transição normal (`closing`), nunca `kill` no pod — matar o
pod não fecha sessão, só cria órfã (ver
[Rollout do engine](#rollout-do-engine)).

### 4. Depois

- **O Psicólogo já tem a evidência.** Se a causa foi laço de agente, a análise
  dele aponta o agente-alvo e a Anamnese pode propor um patch de instrução.
  Corrigir a instrução é o que impede a repetição; mexer no orçamento só
  compra tempo.
- **Confira se o alerta chegou.** As regras são do Grafana, não do Prometheus:
  se o Grafana estava fora do ar, não houve aviso, e o silêncio não significou
  saúde.

### O que esta seção não resolve

O custo já incorrido. O metering é registro, não estorno: `token_usage` conta o
que foi gasto, e nada aqui devolve dinheiro ao provedor. A única prevenção real
é `policy = 'block'` com teto sensato **antes** do incidente.

---

## Observabilidade {#observabilidade}

Como seguir uma sessão, achar custo e diagnosticar quando não há dado.
Decisões em [ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md).

### Observabilidade local, sem cluster {#observabilidade-local}

Tudo abaixo desta subseção pressupõe o cluster de pé. Para métrica e log sem
subir Kubernetes, existe um overlay do Compose
([ADR 0070](adr/0070-observabilidade-no-compose-local.md)):

```bash
pnpm dev:obs     # sobe o stack de dev + Prometheus, Loki, Alloy e Grafana
pnpm obs:down    # derruba só os quatro, deixando as apps de pé
```

O comando termina verificando o que subiu — se ele diz `ok` em todas as linhas,
o painel tem dado; se reclama, ele diz qual peça faltou.

| ferramenta | endereço | serve para |
|---|---|---|
| Grafana | <http://localhost:3001> | dashboards e logs, sem login |
| Logs | <http://localhost:3001/d/brabo-logs> | um serviço por vez, ou os três juntos |
| Prometheus | <http://localhost:9090> | conferir target e série crua |
| Loki | <http://localhost:3100> | consulta direta (o caminho normal é o Grafana) |

**Os dashboards são os MESMOS do cluster** — o Compose monta
`deploy/k8s/observability/dashboards/` direto, e os UIDs de datasource
(`brabo-prometheus`, `brabo-loki`) são iguais. Dashboard novo vale nos dois
ambientes sem cópia.

**O que este overlay não faz:** trace. Sem OpenTelemetry Collector no meio não
há Tempo, e é decisão, não esquecimento ([ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md),
decisão 9). O `trace_id` continua no log e serve para cruzar api e engine à mão.

Três coisas que confundem, e valem antes de abrir issue:

1. **Painel de custo/tokens vazio é o esperado num banco novo.** Aquelas
   métricas têm rótulo (`project`, `provider`), e no `prom-client` uma métrica
   rotulada não existe antes da primeira observação. Uma chamada de LLM e a
   série aparece.
2. **Só `api`, `engine` e `web` vão para o Loki.** Postgres e Ollama ficam de
   fora por ruído; o próprio stack de observabilidade fica de fora porque, no
   mesmo projeto do Compose, ele ingeriria o próprio log num laço.
3. **O nível `OUTRO`** é a linha de continuação da árvore do `pino-pretty`, que
   não tem nível próprio. Não é log perdido.

### Onde está o quê

| ferramenta | endereço local | serve para |
|---|---|---|
| Grafana | <http://localhost:3001> | dashboards, traces, logs, alertas |
| Prometheus | `kubectl -n monitoring port-forward svc/prometheus-server 9090:80` | conferir target e série crua |
| Tempo | datasource do Grafana | traces |
| Loki | datasource do Grafana | logs |

Dois dashboards na pasta **Brabo**: *visão executiva* (custo/hora e tokens/min
por projeto, sessões ativas, decisões de ação) e *visão operacional* (fila do
Oban por estado, latência p50/p95 de LLM por provider, tasks bloqueadas, sessões
por réplica).

### Seguir uma sessão da raiz até um tool call

1. Pegue o `trace_id` da sessão. Ele é o campo do meio do `traceparent`
   persistido em `sessions.trace_parent`:

   ```bash
   # 00-<trace_id>-<span_id>-01
   curl -sS -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/projects/$PROJ/sessions/$SESS | jq -r .traceParent
   ```

2. No Grafana → **Explore** → datasource **Tempo** → aba **TraceQL**, cole o
   `trace_id`. A árvore vem com `session.create` (api) na raiz e, abaixo,
   `agent.turn` → `tool.call` / `llm.turn` / `gate.scanner` (engine).

3. Estando num span, o botão **Logs for this span** salta para as linhas do Loki
   com aquele `trace_id`. O caminho inverso — de uma linha de log para a trace —
   é o link **TraceID** que aparece no detalhe da linha.

4. Custo daquela sessão: o dashboard *visão executiva* filtra por projeto. Para
   um valor exato por sessão, a fonte é o banco (`token_usage.cost_micros`), não
   a métrica — a métrica é agregada por projeto e provider de propósito, para
   não criar uma série por sessão.

### Quando não há trace no Tempo {#quando-nao-ha-trace-no-tempo}

O nome desta seção mudou junto com o comportamento (ADR 0035), e a distinção é o
primeiro passo do diagnóstico: **span sempre é criada, em qualquer ambiente.** O
que `OTEL_EXPORTER_OTLP_ENDPOINT` controla é a EXPORTAÇÃO. Então "não vejo trace
no Grafana" e "não existe trace" são problemas diferentes.

Antes de qualquer coisa, veja de que lado está a falha — o log responde sozinho:

```bash
kubectl -n brabo logs -l app.kubernetes.io/name=api --tail=20 | grep -o '"trace_id":"[^"]*"' | head
```

- **Tem `trace_id` no log, não tem trace no Tempo** → o problema é exportação:
  siga de 1 a 4 abaixo.
- **Não tem `trace_id` no log** → o problema é contexto, e é mais raro: ou o
  `startTracing()` da api não rodou (ver `apps/api/src/tracing-boot.ts` — tem que
  ser o primeiro import de `main.ts`), ou o `Engine.Telemetry.Otel.setup/0` não
  foi chamado antes da árvore de supervisão.

Na ordem, do mais provável ao menos:

**1. A variável não está definida.** Sem `OTEL_EXPORTER_OTLP_ENDPOINT` a span é
criada e descartada no fim, então há `trace_id` no log e nada no Tempo. Em
desenvolvimento isso é o esperado (não há coletor); em cluster, é defeito.

```bash
kubectl -n brabo exec deploy/api -- printenv OTEL_EXPORTER_OTLP_ENDPOINT
kubectl -n brabo exec deploy/engine -- printenv OTEL_EXPORTER_OTLP_ENDPOINT
```

**2. A NetworkPolicy está bloqueando.** É a falha mais silenciosa de todas: os
spans são criados, o envio falha, e todo o resto fica verde.

```bash
kubectl -n brabo get networkpolicy allow-otlp-egress
kubectl -n brabo logs -l app.kubernetes.io/name=engine --tail=50 | grep -i "error exporting"
```

**3. Protocolo errado.** O exporter do Elixir fala **HTTP/protobuf (4318)**, não
gRPC. Apontá-lo para 4317 dá `socket_closed_remotely` a cada batch.

**4. O Collector não está recebendo.**

```bash
kubectl -n monitoring logs deploy/otel-collector-opentelemetry-collector --tail=30
```

### Quando um painel está vazio

Quase sempre é **nome de métrica**. Os nomes são referenciados por string em
três lugares que não se enxergam: os dashboards, as regras de alerta e este
runbook. Confira contra o que o serviço realmente expõe:

```bash
curl -sS http://localhost:3000/metrics | grep '^brabo_' | cut -d'{' -f1 | sort -u
kubectl -n brabo exec deploy/engine -- wget -qO- http://127.0.0.1:4000/metrics | grep -E '^(brabo|oban)_'
```

E se o serviço expõe mas o Prometheus não tem, o problema é scrape:

```bash
kubectl -n monitoring port-forward svc/prometheus-server 9090:80
# depois: http://localhost:9090/targets — os jobs são `brabo-api` e `brabo-engine`
```

### Quando não há log no Loki

O Alloy é DaemonSet e lê `/var/log/pods` do nó, filtrando pelo namespace
`brabo`.

```bash
kubectl -n monitoring logs -l app.kubernetes.io/name=alloy --tail=30 | grep -i error
```

Avisos de `tailer stopped ... pods not found` são normais depois de um rollout —
o Alloy insiste em pods que já foram removidos.

As apps **não** conseguem falar com o Loki diretamente, e isso é intencional: a
`allow-otlp-egress` libera só 4317/4318. Para consultar de fora:

```bash
kubectl -n monitoring port-forward svc/loki 3100:3100
curl -sS -G http://localhost:3100/loki/api/v1/query_range \
  --data-urlencode '{app="api"} | json | trace_id != ""' --data 'limit=5'
```

### Alertas

Provisionados e visíveis em **Alerting → Alert rules** (pasta Brabo), a partir
de `deploy/k8s/observability/alerts/brabo-alerts.yaml`:

| alerta | severidade | dispara após | o que investigar |
|---|---|---|---|
| Fila do Oban crescendo sem consumo | `critical` | 10 min | nenhuma réplica do engine Ready; pool do Postgres esgotado; worker travado num job |
| Sessão presa em closing | `warning` | 15 min | [o drain não completou](#quando-a-sessao-escapa), ou a transição para `closed` falhou |
| Custo por hora acima do limite | `warning` | 5 min | [qual projeto e qual agente](#incidente-de-custo); o orçamento do domínio continua sendo o controle rígido |
| Backup do Postgres atrasado | `critical` | na hora | o último backup bom tem mais de 26 h: o CronJob não rodou, ou rodou e falhou — `brabo_backup_last_status` separa os dois; ver [Restore](#restore). "Nunca houve backup" (`-1`) **não** o dispara |
| Última execução do backup falhou | `warning` | na hora | ainda pode existir um backup bom de ontem, e é por isso que esta falha passaria despercebida por dias; a causa fica em `backup_runs.error_message` |

São regras do **Grafana**, não do Prometheus (desvio registrado no ADR 0026):
deixam de ser avaliadas se o Grafana cair. Não há Alertmanager nem destino de
notificação configurado.

### Limites conhecidos

- Nenhuma trace de agente **real** foi observada ponta a ponta: verificar isso
  exige LLM configurado (Ollama ou chave de API). O mecanismo foi validado
  emitindo spans na trace da sessão diretamente.
- A web não exporta spans próprios — ela **gera** o `traceparent` e o manda no
  header, e a api o adota como parent. Os logs do browser saem no console, não
  no Loki.
- Retenção curta: Tempo 24h, Loki 24h, Prometheus 2h. É ambiente local.

---

## Registro de gates {#registro-de-gates}

Os gates do fluxo são declarados em `docs/gates.yml`
([ADR 0054](adr/0054-gates-como-registro-declarativo.md)). Duas coisas de
operação valem saber.

**O arquivo viaja dentro da imagem.** `docker/api/Dockerfile.prod` o copia nos
dois estágios, como faz com as migrations, e `.dockerignore` o reinclui
explicitamente — `docs/` inteiro é ignorado, e este é o único arquivo de lá que
é dado de produção, não documentação. Em runtime ele fica em
`/app/docs/gates.yml`; o loader sobe de `__dirname` até achá-lo, sem variável
de ambiente.

**Arquivo ilegível não derruba a api.** A carga é preguiçosa: quem pedir
`GET /internal/gates` recebe o erro, e o resto do processo segue. Se a rota
responder erro, confira que o arquivo chegou:

```bash
kubectl -n brabo exec deploy/api -- cat /app/docs/gates.yml | head -5
```

Vazio ou ausente quer dizer que a imagem foi construída sem ele — provável
`.dockerignore` mexido, ou build a partir de um contexto que não tem `docs/`.

**O registro viaja; o que ele aponta, não.** Gate de `teste`/`ci` nomeia
arquivos em `apps/api/test/`, `scripts/ci/` e `.github/`, e nenhum deles está
na imagem. Até isto ser separado, o loader exigia esses arquivos em runtime e
a rota respondia `500` em toda instalação — medido na v6.1.0 como doze 5xx em
cerca de 55 minutos, com `RegistroDeGatesInvalido` listando os onze alvos como
"não existe". Reproduza a falha antiga com:

```bash
docker exec <api> node -e "require('/app/infrastructure/gates/gate-registry.loader').carregarRegistro()"
```

Numa imagem corrigida isso não imprime nada. Se lançar
`RegistroDeGatesInvalido` nomeando um `.spec.ts` ou um workflow, a imagem é
anterior à correção ([RN-070](business-rules/custo.md#rn-070)); se lançar
nomeando o *conteúdo* de um gate (um `block` sem `script`, um `active` sem
evidência), o registro é que está errado e o conserto é no repositório.

A tela não mostra essa falha: o `PrGateTimeline` cai na esteira completa
quando `GET /gates` falha ([RN-084](business-rules/custo.md#rn-084)), então o
único sinal era o log da api. O `docker/smoke.sh` passou a chamar as duas rotas
que servem o registro contra a imagem de produção, `GET /gates` com o bearer do
usuário e `GET /internal/gates` com o service token. Uma função confere o corpo
das duas, e reprova no `500`, na lista vazia e no registro sem
`merge-protegida`. É isso que impede a volta silenciosa. O token chega ao `curl`
pelo stdin (`--config -`), nunca pelo argv, então não aparece no `ps` nem no log
do CI.

Para ver o registro como a api o enxerga, já validado:

```bash
kubectl -n brabo exec deploy/api -- \
  curl -sH "x-brabo-service-token: $BRABO_SERVICE_TOKEN" localhost:3000/internal/gates
```

A medição de passagem NÃO roda em produção: é
`pnpm --filter api validacao:gates`, do repositório, contra o banco. Ver
[docs/explanation/gates.md](explanation/gates.md).

---

## Ambiente de inferência {#ambiente-de-inferencia}

Quando o agente responde vazio, truncado, lentíssimo, ou "esquece" as próprias
instruções, o problema quase nunca está no código de domínio — está aqui. As
cinco primeiras causas foram levantadas em nove execuções seguidas do demo de
gates e estão registradas no
[ADR 0020](adr/0020-destravar-gates-qa-secops.md); todas as variáveis estão
expostas no `docker-compose.yml`.

| variável | sintoma quando errada |
|---|---|
| **GPU** | o serviço `ollama` sem device reservado deixa a GPU ociosa e roda 100% em CPU: um prompt de ~7.000 tokens leva ~50 s só de ingestão. O override é opt-in (`docker-compose.gpu.yml`, `pnpm dev:gpu`), fora do compose principal porque sem o `nvidia-container-toolkit` no host a reserva **faz o serviço falhar ao subir** |
| `OLLAMA_CONTEXT_LENGTH` | o default de 4096 trunca **em silêncio** um prompt montado para 128k. O agente perde as próprias instruções e passa a imitar o schema das ferramentas, que é o que sobra no fim do contexto |
| `OLLAMA_MAX_LOADED_MODELS` | com `OLLAMA_KEEP_ALIVE` alto os modelos acumulam: 15,2 GB de pesos residentes numa máquina de 15 GB, e o agente respondendo vazio por falta de memória |
| `OLLAMA_REQUEST_TIMEOUT_MS` | timeout curto demais para um modelo grande num prompt longo |
| `START_OUTBOX_DRAIN` / `START_ANAMNESE` | Psicólogo e Anamnese consomem turnos de LLM em paralelo com os agentes de execução e derrubam a conexão do dev no meio do ciclo |
| `TOOL_LOOP_MAX_ITERATIONS*` | teto BAIXO demais e o agente para sem entregar, com `limite de iterações atingido` e origem `modelo` — que engana, porque o modelo não errou julgamento nenhum, ele não chegou a julgar. O teto é por TIPO ([RN-085](business-rules/custo.md#rn-085)): `8` para quem conversa, `60` para dev agent e QA. Antes de subir, confira se o agente TEM `token_budget_micros`; sem ele o teto é a única trava de custo que existe |
| `TERMINAL_OUTPUT_MAX_BYTES` | subir demais traz de volta o modo de falha que o teto existe para impedir: a saída de cada comando fica no histórico do laço e viaja em TODO turno seguinte. Não é janela de contexto: a maior chamada bem-sucedida da execução que primeiro revelou isso tinha só 28.993 tokens de entrada ([RN-074](business-rules/custo.md#rn-074)) |
| `API_JSON_BODY_LIMIT` (api) / `TRANSPORT_MAX_BODY_BYTES` (engine) | o `413 request entity too large` no gate de QA/SecOps tinha causa na própria api do Brabo, nunca no provider — o Express nunca configurou limite de body e valia o default de 100 KB, contra os 8 MB que o Phoenix aceita no sentido engine→api mais pesado (`POST .../llm-turn`, que reenvia o histórico inteiro a cada iteração). `API_JSON_BODY_LIMIT` (default 10 MB) fecha essa ponta; `TRANSPORT_MAX_BODY_BYTES` (default 8 MiB) é o teto que a compactação de contexto do engine respeita ALÉM da janela do modelo, pra disparar antes do corpo estourar o limite HTTP ([RN-412](business-rules.md#rn-412), [ADR 0098](adr/0098-limites-de-transporte-e-janela-efetiva-de-compactacao.md)) |

> **Atenção — o guard não limpa a fila.** `START_ANAMNESE=false` impede
> **novos** enfileiramentos, não os antigos. Chegou a haver 20 `AnamneseWorker`
> em `executing` acumulados de execuções anteriores, que rodam no boot seguinte
> independentemente do guard. A fila precisa ser **purgada**, não só o guard
> desligado.

### Gate semântico num modelo pequeno

O QA é o papel que menos cabe num 7B local: o julgamento varia entre execuções,
o que torna o demo um critério de aceite executável e **não** um teste de
regressão. Para torná-lo confiável, aponte `DEMO_QA_MODEL` para um modelo de
API — o binding por agente (escopo `agent`, que vence `project`) existe
exatamente para isso.

A máquina de gates em si não varia: ordem imutável, devolução na mesma branch,
teto de correções, pareceres como artefato e `awaiting_user` terminal são
verificados por ExUnit ([RN-014](business-rules.md#rn-014),
[RN-015](business-rules.md#rn-015)).

---

## Instalando {#instalando}

```sh
curl -fsSLO https://github.com/daneiel/brabo/releases/latest/download/install.sh && bash install.sh
```

**Baixe um arquivo e depois rode-o com `bash`.** As duas formas mais curtas que
parecem equivalentes não são, e o script recusa as duas **pelo nome**, antes de
baixar qualquer coisa, imprimindo a linha acima:

- **Nunca `curl … | sh`.** O motivo é mecânico, não de estilo: com o script
  chegando pelo pipe, o `stdin` do processo **é** o download, então qualquer
  `read` lê bytes do próprio script ou bate em EOF. Um instalador que não pode
  perguntar teria de escolher sozinho onde ficam as pastas na máquina de outra
  pessoa ([RN-526](pathname://../business-rules#rn-526)).
- **Nem `sh -c "$(curl …)"`** — essa foi a forma documentada até a AT-083, e ela
  nunca funcionou. O script confere **o próprio hash** contra o manifesto
  assinado, e sob `X -c "…"` não há arquivo para calcular hash: `$0` é o nome
  do shell. Com `dash` como `sh` (Debian, Ubuntu) ele morria ainda antes, no
  `set -o pipefail`. Não existe chave para pular essa autoverificação, e não vai
  existir ([ADR 0150](adr/0150-instalador-de-uma-linha.md)) — o conserto é
  existir um arquivo. Rodá-lo sob um shell que não é bash também é recusa
  nomeada própria.

O script verifica **a própria origem** antes de fazer qualquer coisa — a
assinatura do `checksums.txt` da Release, e depois o próprio hash dentro desse
manifesto verificado. Falhar em qualquer das duas etapas é **recusa nomeada**,
nunca aviso.

Ele precisa de **uma** entre `sha256sum` (coreutils, Linux) ou `shasum -a 256`
(vem com o macOS) para fazer qualquer disso, e resolve qual **antes do primeiro
download** — não no meio de uma verificação. Faltar as duas é recusa **própria**,
que nomeia as duas ferramentas e diz que nada foi baixado; é uma dependência
ausente do sistema operacional, e de propósito *não* tem a redação das recusas
de hash abaixo. As duas são desfechos diferentes pedindo coisas diferentes — um
se resolve instalando, o outro **parando** — e foi a medição da AT-091 que pôs a
linha entre eles: `sha256sum: command not found` no macOS aparecia como *"o
cosign baixado NÃO bate com o hash pinado neste script. Isso não é um aviso:
pare e investigue."*, o que bloqueava toda instalação no macOS e ensinava quem
lê a ignorar essa frase. O `--print-plan` não precisa de nenhuma das duas e
declara quais o script aceita (`conferir-hash`).

A detecção tem **teto de 5 s** na chamada ao Docker que faz (`docker compose ls`
fala com o daemon, e um daemon lento ou parado atrás de um socket vivo travaria
tudo *antes da primeira pergunta*). Bater no teto não é erro — é o mesmo
desfecho de não haver Docker nenhum, e os demais sinais continuam sendo lidos.

Sem TTY ele **relata e sai com 0**: imprime o que encontrou e o comando para
rodar num terminal. É de propósito, e é a mesma forma que o
`consentir-base.mjs` já tem.

**O que ele nunca apaga:** sua base de projetos e sua pasta de espelho. Volumes
nomeados só saem com confirmação, listados um a um antes.

Ele sobe a stack a partir do **próprio compose**
(`docker/docker-compose.install.yml`), que pega as imagens de variáveis e não
constrói nada — e ele **baixa esse compose da Release**
([RN-570](pathname://../business-rules#rn-570),
[ADR 0160](adr/0160-o-compose-do-instalador-viaja-assinado.md)). Quatro arquivos
viajam com o instalador como assets `brabo-install-*`, no **mesmo**
`checksums.txt` assinado que cobre o binário do runner: o compose, o
`postgres/init.sql` e o `ollama/pull-models.sh` que ele monta por bind-mount, e
o `backup/test-restore-compose.sh` que a migração roda. Logo depois de se
verificar — antes de qualquer pergunta, antes de gravar qualquer coisa — o
script baixa os quatro e confere cada hash contra esse manifesto. Três recusas
nomeadas, todas numa máquina intocada:

| a mensagem começa com | significa | faça |
|---|---|---|
| *"a Release não publica …"* | a Release é anterior ao ADR 0160, ou o passo de publicação falhou no meio | instale a partir de um checkout do repositório naquela tag, ou espere a próxima release |
| *"o manifesto assinado não cobre …"* | o manifesto existe mas não tem linha para aquele asset | o mesmo de cima — a Release está incompleta |
| *"… NÃO bate com o manifesto assinado"* | o arquivo baixado não é o que o manifesto assinado descreve | **pare e trate como incidente**; não tente contornar repetindo |

As cópias verificadas são gravadas sob `docker/` na pasta de onde você rodou o
script — a mesma pasta do `.env` — só quando são necessárias pela primeira vez.
O que já estava lá (o compose da versão anterior, numa atualização) é
**substituído, nunca lido**, e o script nomeia o que substituiu; de dentro de um
checkout git em outro commit, isso deixa o `git status` sujo.

> **Releases publicadas antes do ADR 0160 não carregam esses assets.** O
> instalador delas ainda usa o caminho relativo, e a linha acima falha numa
> pasta vazia com *"no such file or directory"* depois de gravar o `.env` (a
> lacuna que a [RN-549](pathname://../business-rules#rn-549) mediu). Para essas tags, rode
> o instalador a partir de um checkout do repositório na tag que você está
> instalando.

> No caminho de *migração* a prova de restauração (`test-restore-compose.sh`)
> recebe o `.env` da instalação por `BRABO_ENV_FILE` (repassado ao Compose como
> `--env-file`), porque o Compose procura o `.env` ao lado do arquivo de compose
> — não na pasta de onde você roda. Se você rodar a prova à mão contra uma
> instalação, exporte `BRABO_ENV_FILE=/caminho/do/.env` antes; um caminho que não
> existe é recusado, nunca trocado por outro arquivo. Uma prova que falha
> continua sem apagar nada ([RN-530](pathname://../business-rules#rn-530)).

Duas fontes:

```sh
install.sh                  # --source=ghcr (padrão): por digest, assinatura verificada
install.sh --source=local   # buildx bake; exige árvore limpa numa tag
```

Os segredos são gerados uma vez e persistidos no `.env` com modo **600** — o
arquivo é criado vazio e travado *antes* de receber conteúdo, porque uma janela
em que os segredos ficam legíveis por todos é exatamente o que este arquivo não
pode ter.

**Não há passo de migração**, e não deve haver: o compose encadeia `api` →
`migrate-api` com `service_completed_successfully`, então o `up --wait` espera
as migrations. Um segundo lugar ordenando migrations seria uma segunda fonte da
mesma verdade.

Depois de a stack subir ele **pergunta antes de afirmar**: `/health` na api e no
engine, e só então diz que instalou.

Ele **instala o agente local** — o binário é verificado contra o manifesto
assinado e posto com `install -m 0755`, então não há `chmod` manual
([RN-531](pathname://../business-rules#rn-531)) — e pergunta UMA base, gravando-a nos dois
lados: `BRABO_PROJECTS_BASE` no `.env` e `base` no `runner.json` do runner. Uma
Release sem binário para esta plataforma não interrompe a instalação: ele diz
isso e aponta para `npm install -g @brabo/runner`.

Sobre uma instalação existente ele **migra ou para** — um `up` sobre volumes de
outra versão é dano que não avisa. A ordem é backup → **PROVAR** que restaura →
perguntar → apagar → instalar → restaurar, e a prova no meio é o que dá ao
instalador o direito de apagar ([RN-530](pathname://../business-rules#rn-530)).

E ele sabe **qual** versão está substituindo ([RN-542](pathname://../business-rules#rn-542)).
As imagens são resolvidas **antes** de a detecção rodar, então a pergunta nunca
é cega: o marcador registra a `versao` instalada, o manifesto traz a que está
para ser instalada, e a oferta é específica da relação entre as duas.

| relação | o que ele oferece | padrão |
|---|---|---|
| mais nova | *"Atualizar 5.0.0 → 5.1.0?"* | **sim** — é o que você veio fazer, e o backup provado a torna reversível |
| a mesma | *"Já é a 5.0.0. Reinstalar do zero mesmo assim?"* | não — não há ganho a oferecer |
| mais antiga | a chama de **downgrade**, avisando que migrations do banco não rodam de trás para a frente | não — pode não ter volta |
| desconhecida | um marcador do schema 1 não tem versão; ele diz isso, e não adivinha | não |

Seja qual for o ramo, a instalação é **apagada e recriada do zero** em vez de
subir por cima dos volumes antigos. Meia migração é pior que nenhuma.

Um `install.sh` chamado pelo menu do `pnpm bootstrap` (*Docker › Instalar*) só
**relata** o plano. Isso é mecânico, não preferência: um item de menu roda com
o stdin em `/dev/null` para que o menu continue lendo teclas do mesmo terminal,
e este instalador foi feito para *perguntar*. A nota do item traz o comando de
uma linha que instala de verdade.

> **O que ele não faz:** ligar o **broker** de container sem perguntar — ver
> [o broker numa instalação](#broker-na-instalacao) logo abaixo. O agente local
> ele **pareia**, desde a [RN-547](pathname://../business-rules#rn-547): cria a primeira
> conta, gera a chave de dispositivo de máquina na máquina, registra a metade
> pública, carimba o `kid` e instala a unit de **máquina**
> ([ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md)) — e quando um
> elo falha ele nomeia o comando a repetir, ver a seção *When the installer
> does not close the installation* (`#instalador-nao-fecha`), que só existe na
> versão em inglês desta página. O que continua na tela do projeto é um
> pareamento **preso ao projeto**: essa chave de dispositivo e o
> `brabo-runner.config.json` continuam vindo de lá
> ([ADR 0118](adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)).
> Inspecione tudo com `install.sh --print-plan`, que não toca em nada.

### O broker de container numa instalação {#broker-na-instalacao}

Projetos nos modos **Container** e **Pasta montada** rodam dentro de um
container, e quem sobe esse container é o **broker**
([ADR 0144](adr/0144-a-segunda-raiz-do-broker.md)). Sem ele nenhum dos dois modos
chega a executar: o `container_start` termina `failed` com
`BrokerIndisponivelError` e os dev agents ficam em `dev.blocked_by_container`. O
modo **Runner** não depende dele — ali o agente local usa o Docker da sua
máquina.

Desde o [ADR 0162](adr/0162-broker-publicado-e-oferecido-pelo-instalador.md) o
broker é a **quinta imagem publicada** (`ghcr.io/daneiel/brabo-broker`, por
digest, assinada como as outras quatro) e o compose de instalação tem o
serviço — **desligado por padrão**, sob o mesmo profile `container-broker` do
compose de validação. O instalador **pergunta** (*"Ligar o broker de container?
[s/N]"*), logo depois da base de projetos, e diz em texto o que ligá-lo
concede: o broker recebe **o socket do Docker desta máquina**, e quem comanda o
broker comanda o seu Docker. O que o contém são as cinco camadas do
[ADR 0130](adr/0130-broker-de-container.md): nenhuma porta publicada, uma rede
(`internal: true`, sem internet) que só a api alcança, o service token, cinco
operações sobre o container de UM projeto, e uma spec que o broker compõe a
partir do que o Arquiteto decidiu — não existe pedido que ligue `privileged`,
rede do host ou um `-v` livre.

| resposta | o que acontece |
|---|---|
| **`s`** / **`sim`** | ele mede o grupo do socket **de dentro de um container** (a própria imagem do broker, sem rede, somente leitura, o socket montado com `--mount` para que um socket ausente seja erro em vez de uma pasta vazia criada no seu host), calcula onde o Docker guarda o volume da pasta gerenciada, e grava `COMPOSE_PROFILES=container-broker`, `BROKER_URL=http://broker:8090`, `DOCKER_GID` e `PROJECT_WORKSPACES_HOST_ROOT` no `.env` — as quatro juntas |
| Enter, `n`, qualquer outra coisa | desligado. O `.env` não recebe nenhuma das quatro linhas, e o resumo final diz *"Broker de container: DESLIGADO"* |
| sem terminal | desligado, e ele diz isso — nenhuma pergunta é feita onde ninguém pode responder |

**Duas recusas e duas pendências, todas nomeadas:**

- *"não consegui medir o grupo do socket do Docker…"* — a medição falhou
  (Docker rootless ou remoto: o socket não está em `/var/run/docker.sock`, que
  é o caminho que o compose monta). Nada foi gravado. Rode de novo e responda
  **não**, ou conserte o que a mensagem cita do Docker. Ele nunca grava um
  `999` de palpite no lugar.
- *"… não é um socket …"* — mesmo desfecho, mesmo conserto.
- pendência *"a raiz da pasta gerenciada…"* — o
  `<DockerRootDir>/volumes/brabo_project_workspaces/_data` calculado não bateu
  com o `Mountpoint` real do volume depois de a stack subir (ou o `docker info`
  não disse onde os volumes moram). Projetos em **Pasta montada** funcionam;
  projetos em **Container** não, até você corrigir
  `PROJECT_WORKSPACES_HOST_ROOT` — a mensagem traz o valor que o daemon
  informou e o comando para recriar o broker.
- pendência *"o broker de container: a api NÃO o alcançou…"* — o serviço subiu
  healthy, mas a api não conseguiu alcançá-lo pela rede interna.
  `docker compose -f docker/docker-compose.install.yml logs broker` diz por quê.

O `COMPOSE_PROFILES` no `--env-file` é o que faz o `up -d --wait` subir o broker
sem flag nenhuma na linha de comando — medido no Compose v5.5.1. A variável da
imagem, `BRABO_BROKER_IMAGE`, é gravada **ligado ou não**: o Compose interpola o
arquivo inteiro antes de filtrar por profile, então uma variável obrigatória
num serviço desligado ainda recusa o arquivo.

**Ligar depois** (na mesma pasta do `.env`):

```bash
# 1. o grupo do socket COMO UM CONTAINER O VÊ — com a própria imagem do broker,
#    sem rede; é esse o número de que o compose precisa
docker run --rm --network none --read-only --entrypoint stat \
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
  "$(grep '^BRABO_BROKER_IMAGE=' .env | cut -d= -f2)" -c '%F %g' /var/run/docker.sock
# esperado: socket <gid>

# 2. onde o Docker guarda o volume da pasta gerenciada
docker volume inspect --format '{{.Mountpoint}}' brabo_project_workspaces

# 3. acrescente ao .env (as quatro — nunca uma sem as outras)
#    COMPOSE_PROFILES=container-broker
#    BROKER_URL=http://broker:8090
#    DOCKER_GID=<gid do passo 1>
#    PROJECT_WORKSPACES_HOST_ROOT=<caminho do passo 2>

# 4. recrie — a api também, para ela pegar o BROKER_URL
docker compose -f docker/docker-compose.install.yml --env-file .env up -d --wait

# 5. pergunte antes de afirmar
docker compose -f docker/docker-compose.install.yml --env-file .env exec -T api \
  node -e "fetch('http://broker:8090/health').then(r=>r.text()).then(console.log)"
# esperado: {"status":"ok","servico":"broker"}
```

**Desligar:** tire as quatro linhas do `.env`, depois remova o container do
broker e recrie a api sem `BROKER_URL`:

```bash
docker compose -f docker/docker-compose.install.yml --env-file .env \
  --profile container-broker rm -sf broker
docker compose -f docker/docker-compose.install.yml --env-file .env up -d --wait
```

O `up --remove-orphans` **não** faz o primeiro passo — medido: um serviço sob
profile desligado continua *definido* no arquivo, então o container dele não é
órfão e continua rodando. Nada nos seus projetos é apagado; projetos em
Container e Pasta montada param de executar, e a tela do projeto para de
oferecê-los
([ADR 0161](adr/0161-a-tela-so-oferece-o-modo-que-a-instalacao-executa.md)).

---

## Adicionando um provider compatível {#adicionando-um-provider-compativel}

Vale para qualquer provider que fale o dialeto `/chat/completions` da OpenAI —
que é o caso de praticamente todo hub e de todo serviço de inferência gerenciada.
A base já existe ([ADR 0041](adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md));
o que se escreve é **configuração**, não parsing.

### 1. Leia a doc oficial antes de escrever a primeira linha

Quatro coisas precisam sair da documentação do provider, não de suposição:
`baseUrl`, o header de auth, o formato de `usage` no stream e as
particularidades de streaming. Registre no cabeçalho do arquivo de config a URL
consultada e a data — é a única forma de saber, meses depois, se a config está
velha.

O que divergir do padrão OpenAI vira **flag na base**, nunca `if` espalhado. Se
a divergência não couber numa flag existente, acrescente uma — e só porque este
provider real precisa dela.

### 2. Escreva a config

```ts
// apps/api/src/infrastructure/llm/<provider>-provider.ts
export function meuProviderConfig(baseUrl = BASE_URL): OpenAICompatibleConfig {
  return {
    name: 'meu-provider',
    baseUrl,
    capabilities: { streaming: true, toolCalling: true, listModels: true },
    authHeaders: (apiKey) => ({ Authorization: `Bearer ${apiKey ?? ''}` }),
    flags: { streamOptionsIncludeUsage: true, maxTokensField: 'max_tokens' },
    // Só se o catálogo dele devolver mais que `{ data: [{ id }] }`:
    // parseCatalogo: (corpo) => ...,
    // Só se for HUB (informa quem serviu de fato):
    // extrairUpstreamProvider: (frame) => ...,
  };
}
```

Exporte a função de config, não só a classe: é ela que a suite de contrato
aponta para o servidor falso. Uma cópia da config escrita dentro do teste
passaria verde mesmo se a de produção divergisse.

### 3. Rode a suite de contrato contra ele

```ts
runLLMProviderContract('meu-provider', () => ({
  dialeto: dialetoOpenAI, // reaproveite o da base se o formato for o mesmo
  criar: (baseUrl) =>
    new OpenAICompatibleProvider(meuProviderConfig(baseUrl), new GptTokenizerEstimator()),
  usageFallback: 'estimated',
  timeoutEnv: 'LLM_REQUEST_TIMEOUT_MS',
  temFerramentasNoPedido: (body) => Array.isArray(body.tools),
  modelo: 'algum-modelo',
}));
```

Herda de graça: stream com frame partido, usage presente e ausente, tool
calling, os quatro erros normalizados, o catálogo e o servidor mudo.

### 4. Registre o provider e o kind de credencial

1. **dois lugares, de propósito**: o tipo `LLMProviderName` em
   `packages/shared/src/index.ts` (a web também o usa) e a lista em runtime
   `LLM_PROVIDER_NAMES` em `apps/api/src/domain/llm/llm-provider-names.ts`.
   Elas não podem morar juntas: `packages/shared` é 100% tipo — um valor
   exportado de lá derruba a imagem de produção da api no boot com
   `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, e
   `apps/api/test/packages-shared-so-tipos.spec.ts` reprova antes de chegar
   lá. Esquecer a lista não passa em silêncio: a checagem de exaustividade
   nos dois sentidos quebra o typecheck, assim como o `Record` exaustivo de
   `ROTULO_DO_PROVIDER` na web quebra até o provider ganhar rótulo;
2. se for hub, acrescente o nome a `HUBS` em `apps/web/src/lib/models.ts` para
   ele cair no grupo certo do seletor;
3. o registry de providers da api (`llm-infrastructure.module.ts`);
4. `pgEnum` de provider no schema + migração, se o nome for novo.

### 5. Semeie os modelos com preço da doc

Preço digitado entra com `manual_pricing: true`. Isso protege a linha do sync de
preço: para provider que não expõe preço no catálogo, o número manual é o único
que existe.

Se o provider expõe `GET /models`, **não semeie o catálogo inteiro** — deixe o
sync descobrir. Ele grava os modelos desativados, e o owner ativa o que
interessa pela tela de curadoria ([RN-043](business-rules/custo.md#rn-043)).

Se o catálogo do provider publicar **modalidade** (aceita imagem, gera imagem)
ou `reasoning`, emita-as no `parseCatalogo` dele — e só quando a doc oficial
disser. Campo que o provider não declara fica **omitido**, nunca `false`:
`undefined` preserva o que já estava gravado, e `false` apagaria curadoria feita
à mão ([RN-056](business-rules/custo.md#rn-056)).

### 6. Verifique com credencial real

```bash
# na tela de configurações do projeto: cadastre a credencial, depois
# "Atualizar catálogo" e confira o relatório por provider.
```

O relatório mostra **todo** provider, inclusive o pulado, com o motivo e a
origem da falha. `sem_credencial` significa que a chave não chegou;
`falha · origem infra` significa que nem se conseguiu falar com o provider;
`falha · origem modelo` significa que ele respondeu recusando.

### Volume novo de `node_modules` nasce root e a `api`/`web` não sobem {#volume-novo-de-node-modules}

**Sintoma:** com os volumes de `node_modules` inexistentes (primeiro clone, ou
máquina que só rodou o instalador, que não os define), `api` e `web` saem com
`EACCES: permission denied, mkdir '/workspace/node_modules/.pnpm'` (AT-172).

**Causa:** volume novo herda o dono do caminho que existir NA IMAGEM, e o
caminho não existia — nascia `root:root`. `docker/api/Dockerfile` e
`docker/web/Dockerfile` agora criam e dão `chown` nos três pontos de montagem
de `node_modules` antes do `USER`.

**A outra metade:** o ponto de montagem DENTRO do bind mount, no seu disco, o
Docker cria como `root` quando falta (ex.: `packages/shared/node_modules`), e
imagem nenhuma muda isso. O `pnpm dev` roda `scripts/dev/preflight.mjs`, que
cria essas pastas como você antes; `docker compose up` rodado à mão pula o
preflight, então rode `pnpm dev:preflight` uma vez antes do primeiro `up`.
