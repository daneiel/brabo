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
| a api ou o engine saem no boot reclamando de `AUTH_JWT_SECRET`, `BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY` ou `SECRET_KEY_BASE` | [Os quatro segredos irmãos também não sobem com o default](#segredos-irmaos-no-boot) |
| agente respondendo vazio, truncado ou lentíssimo | [Ambiente de inferência](#ambiente-de-inferencia) |
| agente parando com `limite de iterações atingido` sem ter entregado | [Ambiente de inferência](#ambiente-de-inferencia) |
| quero acrescentar um provider de LLM compatível com a OpenAI | [Adicionando um provider compatível](#adicionando-um-provider-compativel) |
| quero migrar meus workspaces do volume Docker para uma pasta real | [Migrar workspaces para pasta local](#migrar-workspaces-pasta-local) |
| criar projeto **Local** recusa dizendo que a pasta não existe | [Projeto no modo Local](#projeto-no-modo-local) |

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

### Projeto no modo Local {#projeto-no-modo-local}

**Sintoma:** ao criar o projeto escolhendo **Local**, a api responde `400`
dizendo que a pasta *não existe do lado de dentro da api*.

Isso é a guarda funcionando ([RN-170](business-rules.md#rn-170)), não um bug: o
caminho que você digitou existe no seu computador e **não** dentro do container.
Um projeto criado assim travaria depois, na primeira ferramenta do primeiro
agente, longe da tela onde a decisão foi tomada — por isso ele não nasce.

**O que fazer.** Montar a pasta nos **dois** serviços, no **mesmo caminho
absoluto** dos dois lados:

```yaml
# docker/docker-compose.yml
services:
  api:
    volumes:
      # ... as linhas que já existem
      - /home/voce/projetos/loja:/home/voce/projetos/loja

  engine:
    volumes:
      # ... as linhas que já existem
      - /home/voce/projetos/loja:/home/voce/projetos/loja
```

```bash
docker compose -f docker/docker-compose.yml up -d api engine
```

Confira antes de tentar de novo — a api valida o que **ela** vê, e não tem como
saber o que está montado no outro container:

```bash
docker compose -f docker/docker-compose.yml exec api  ls -la /home/voce/projetos/loja
docker compose -f docker/docker-compose.yml exec engine ls -la /home/voce/projetos/loja
```

**Por que o mesmo caminho dos dois lados.** O caminho é gravado UMA vez em
`projects.workspace_path` e lido pelos dois processos
([RN-169](business-rules.md#rn-169)). Montar em lugares diferentes faria o
engine escrever onde a api não lê — a divergência que a derivação única existe
para impedir.

**Outros modos de recusa, e o que cada um quer dizer:**

| a mensagem diz | o que fazer |
|---|---|
| *não existe do lado de dentro da api* | montar, como acima |
| *existe mas não é uma pasta* | o caminho aponta para um arquivo; use a pasta |
| *o processo não pode escrever nela* | dono/permissão da pasta no host. As imagens rodam non-root ([ADR 0024](adr/0024-fase5-imagens-producao-ci.md)); ajuste o dono ou o modo da pasta |
| *Caminho inválido para um projeto Local* | é raiz do sistema, pasta de sistema, relativo, tem `..`, ou se sobrepõe ao checkout do Brabo — escolha uma pasta sua, fora dessas ([ADR 0072](adr/0072-projeto-local-ou-container.md)) |

**Não confunda com o modo Container.** Projeto no modo Container (o default)
continua usando `PROJECT_WORKSPACES_ROOT` e o procedimento de migração acima;
o modo Local não passa por essa raiz em momento nenhum.

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

> **O seed não é idempotente.** `createWorkspace` não faz upsert, então numa
> segunda execução (`BRABO_KEEP_CLUSTER=1`) o pod termina em erro por
> `workspaces_slug_unique` — e está certo assim: o usuário já existe desde a
> primeira vez, o login é verificado do mesmo jeito, e o pod é removido ao
> final para não reprovar o passo 1 do `smoke.sh`, que exige todos os pods
> saudáveis.

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
  fora da interface (`SESSION_HEARTBEAT_TIMEOUT_MS`).

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

### Os quatro segredos irmãos também não sobem com o default {#segredos-irmaos-no-boot}

Sintoma: com `NODE_ENV=production`, a api (ou, para `SECRET_KEY_BASE`, o
engine) morre no start com uma mensagem sobre `AUTH_JWT_SECRET`,
`BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY` ou `SECRET_KEY_BASE` —
ausente, com o valor de exemplo do repositório, ou curta demais.

**Mesma causa do segredo de OAuth acima, e mesma orientação: não é regressão,
e não contorne.** O [ADR 0059](adr/0059-segredo-do-state-de-oauth-sem-default.md)
já declarava esses quatro como pendência — o mesmo padrão, só ainda não
replicado — e a [RN-114](business-rules.md#rn-114) fechou. Cada um protege
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

Trocar `AUTH_JWT_SECRET` ou `BRABO_SERVICE_TOKEN` sem a dança do `_PREVIOUS`
tem o mesmo efeito que já era documentado em
[Rotação das chaves do auth](#rotacao-das-chaves-do-auth); trocar
`CREDENTIALS_MASTER_KEY` sem re-embrulhar tem o mesmo efeito já documentado em
[Rotação da chave mestra](#rotacao-da-chave-mestra). Esta checagem de BOOT não
muda nenhum dos dois procedimentos — ela só impede que a chave chegue à
produção sendo o literal público deste repositório.

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

### Última execução verificada

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
   só a nova **assina**. A api emite um `WARN` no boot enquanto isso durar.
3. Passados 15 minutos (o TTL do access token), nenhum token da chave antiga
   sobrevive. **Remova `AUTH_JWT_SECRET_PREVIOUS`** e reinicie.

Ninguém é deslogado: os refresh tokens não dependem desta chave.

### `AUTH_TOKEN_PEPPER` — logout global, sem meio-termo

É a chave HMAC do hash dos refresh tokens e dos tokens de conta. Trocá-la
invalida, de uma vez:

- **todos** os refresh tokens em circulação — todo mundo é deslogado;
- **todos** os links de verificação de e-mail e de reset de senha em aberto.

Não existe `AUTH_TOKEN_PEPPER_PREVIOUS`, e é decisão consciente: aceitar dupla
verificação em todo refresh, para sempre, por um cenário que roda uma vez a
cada nunca, não paga. Se for preciso trocar — suspeita de vazamento do banco,
por exemplo — avise antes: o sintoma para o usuário é ser deslogado sem motivo
aparente e ver o link de reset "expirado".

> A api **não** falha ao subir com um pepper novo. Ela simplesmente não
> reconhece nenhum token antigo. Se o suporte relatar "todo mundo deslogado ao
> mesmo tempo", esta variável é o primeiro lugar a olhar.

### `BRABO_SERVICE_TOKEN` — rotação sem downtime, nos dois lados

É o segredo compartilhado que autentica o tráfego api ↔ engine
([RN-035](business-rules.md#rn-035)). Não tem nada a ver com sessão de usuário:
trocá-lo errado não desloga ninguém, derruba a comunicação interna.

A dança é a mesma do `AUTH_JWT_SECRET`, com a diferença de que ela roda nas
**duas** cargas — e a ordem importa, porque cada lado envia o atual e aceita
ambos:

1. `BRABO_SERVICE_TOKEN_PREVIOUS` recebe o valor antigo em **api e engine**;
   `BRABO_SERVICE_TOKEN` recebe o novo nos dois. Reinicie os dois.
2. Enquanto os dois estiverem de pé com a variável nova, o tráfego funciona em
   qualquer combinação de pods velhos e novos — é isso que torna o rollout
   seguro no meio do caminho.
3. Concluído o rollout dos dois Deployments, **remova
   `BRABO_SERVICE_TOKEN_PREVIOUS`** e reinicie.

Pular a etapa 1 e trocar só o valor atual produz `403`/`401` durante toda a
janela em que sobrar um pod antigo de qualquer lado — o sintoma do
[diagnóstico acima](#diagnostico-do-deploy).

```bash
# gere um valor com entropia suficiente; ele nunca precisa ser digitado
openssl rand -base64 48
```

### Migração dos usuários do Keycloak {#migracao-dos-usuarios-do-keycloak}

Roda **uma vez**, no release do corte. Senhas não migram — é inviável e
indesejável ([ADR 0032](adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)): o
que o script faz é emitir, para cada usuário que veio do Keycloak e ainda não
tem credencial, um token de **definição de senha** de uso único.

Ele **não conecta no Keycloak**. Desde a Fase 1 a api já mantinha a linha em
`users` e os vínculos de RBAC no próprio banco; o Keycloak era só o emissor.

```bash
pnpm --filter api migrate:keycloak-users
```

Ele imprime uma linha por usuário — `emitido <email> — expira em <ISO>` ou
`pulado <email> — já tem link válido em aberto` — e o total ao fim.

É idempotente em duas camadas: pula quem já tem linha em `auth_credentials` e
pula quem já tem um token `set_initial_password` vivo — senão a segunda
execução invalidaria (por supersede) os links já enviados.

> **O `MailSender` é log-only, e por default NÃO imprime o token.** Log de
> aplicação vai para o Loki e fica retido por semanas; um token de definição de
> senha ali é credencial de takeover em texto claro. O que sai é tipo,
> destinatário e expiração.
>
> Sem SMTP configurado, a única forma de extrair os links é ligar
> `AUTH_MAIL_LOG_TOKENS=true` na api, rodar o script, e **desligar em
> seguida** — a api emite um `WARN` no boot enquanto a variável estiver ligada,
> justamente para ela não sobreviver a um ambiente copiado:
>
> ```bash
> kubectl -n brabo logs deploy/api | grep set_initial_password
> ```
>
> Enquanto os links estiverem vivos, trate esse log como segredo: quem o lê
> pode definir a senha daquelas contas.

Um usuário migrado que tentar logar antes de definir a senha recebe **o mesmo
401 de sempre**, indistinguível de senha errada ou e-mail inexistente
([RN-032](business-rules.md#rn-032)) — e, em silêncio, um novo e-mail de
definição de senha, sob o mesmo throttle do reset. Não há resposta que
confirme "esta conta é legada": seria o sinal de enumeração mais valioso do
sistema.

### Conta travada por lockout

O bloqueio é curto (30 s a 15 min) e se resolve sozinho: a janela deslizante
drena. **Não existe endpoint de destrava**, de propósito — ver
[RN-031](business-rules.md#rn-031). Se for preciso destravar alguém agora:

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

O `wrapped_dek` gravado no banco **não identifica qual chave o embrulhou**.
Consequência direta: trocar a variável e reiniciar a api torna ilegível toda
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

```bash
kubectl -n brabo rollout restart deployment/api
kubectl -n brabo rollout status  deployment/api
```

Confirme que a api está no modo de rotação — ela avisa no log, de propósito:

```bash
kubectl -n brabo logs -l app.kubernetes.io/name=api --tail=50 \
  | grep CREDENTIALS_MASTER_KEY_PREVIOUS
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

- **Idempotente.** Rodar de novo conta os já convertidos em `já na chave atual`
  e não reescreve nada. Interrompeu? Rode outra vez.
- **Só o envelope muda.** O texto cifrado do segredo permanece byte a byte o
  mesmo, então parar no meio deixa o acervo consistente: parte na chave nova,
  parte na antiga, e as duas legíveis enquanto a PREVIOUS existir.
- **`falhas > 0` bloqueia a etapa 3.** São registros que não abrem com nenhuma
  das duas chaves — normalmente vindos de outro ambiente, ou de uma rotação
  anterior interrompida com a chave já descartada. O script identifica cada um
  por id. Não remova a PREVIOUS: sem ela você perde também o que ainda abria.

### 3. Descartar a chave antiga

Só depois de `falhas=0`:

```bash
# remova CREDENTIALS_MASTER_KEY_PREVIOUS do provider e então
kubectl -n brabo rollout restart deployment/api
```

Verifique que o aviso de rotação sumiu do log e que uma credencial existente
ainda funciona (o caminho mais direto é a tela de credenciais do projeto, ou
qualquer turno de agente que use chave de LLM).

### Verificar sem esperar um incidente

O `rewrap` roda em qualquer ambiente. Num de teste, o ciclo completo cabe em
poucos minutos e é o que valida o procedimento — a mesma lógica está coberta em
`test/infrastructure/security/envelope-encryption.service.spec.ts`, inclusive o
caso em que nenhuma das duas chaves serve.

### Interação com o restore

**Restaurar um dump num ambiente com master key diferente devolve o banco
íntegro e as credenciais inúteis.** O dump carrega os DEKs embrulhados, não a
chave. Se você restaurou um backup de produção num ambiente de teste e as
credenciais não abrem, não há corrupção: é a chave errada. Ver
[Restore](#restore).

Por isso a chave mestra faz parte do plano de recuperação: um backup do banco
sem a chave correspondente não recupera os segredos do usuário.

### Quando algo dá errado

| sintoma | causa |
|---|---|
| api sobe sem aviso de rotação, mas o script exige a PREVIOUS | a variável não chegou ao pod; o ESO só ressincroniza a cada `refreshInterval` (1 h) |
| `falhas` igual ao total | a PREVIOUS publicada não é a chave que embrulhou o acervo |
| `já na chave atual` igual ao total, sem ter rodado antes | as duas variáveis têm o mesmo valor — o serviço ignora a PREVIOUS nesse caso |
| credencial para de funcionar DEPOIS da etapa 3 | algum registro ficou para trás; republique a PREVIOUS imediatamente e rode o script de novo |

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
([RN-019](business-rules.md#rn-019)).

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
update agent_autonomy set mode = 'manual' where project_id = '<projeto>';
```

**b) Trocar o binding de modelo para um local.** Ollama custa zero; a qualidade
cai, o gasto para na hora:

```sql
-- veja o binding em vigor e o escopo que o resolve
select scope, scope_id, model_id from model_bindings where scope_id = '<projeto>';
```

Depois aponte o binding do projeto para um modelo `local` pela tela de
configuração (o escopo mais específico vence: sessão > agente > projeto >
workspace — [RN-020](business-rules.md#rn-020)).

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

Provisionados e visíveis em **Alerting → Alert rules** (pasta Brabo):

| alerta | o que investigar |
|---|---|
| Fila do Oban crescendo sem consumo | nenhuma réplica do engine Ready; pool do Postgres esgotado; worker travado num job |
| Sessão presa em `closing` | [o drain não completou](#quando-a-sessao-escapa), ou a transição para `closed` falhou |
| Custo por hora acima do limite | [qual projeto e qual agente](#incidente-de-custo); o orçamento do domínio continua sendo o controle rígido |
| Última execução do backup falhou | [o backup existe mas é velho](#restore) — o caso perigoso |

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
| `TOOL_LOOP_MAX_ITERATIONS*` | teto BAIXO demais e o agente para sem entregar, com `limite de iterações atingido` e origem `modelo` — que engana, porque o modelo não errou julgamento nenhum, ele não chegou a julgar. O teto é por TIPO ([RN-085](business-rules.md#rn-085)): `8` para quem conversa, `60` para dev agent e QA. Antes de subir, confira se o agente TEM `token_budget_micros`; sem ele o teto é a única trava de custo que existe |
| `TERMINAL_OUTPUT_MAX_BYTES` | subir demais traz de volta o modo de falha que o teto existe para impedir: a saída de cada comando fica no histórico do laço e viaja em TODO turno seguinte, até o provider recusar a requisição com **HTTP 413** (`request entity too large`). O sintoma engana — parece o modelo travando, e é o corpo da requisição estourando. Não é janela de contexto: a maior chamada bem-sucedida da execução que morreu assim tinha só 28.993 tokens de entrada ([RN-074](business-rules.md#rn-074)) |

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
interessa pela tela de curadoria ([RN-043](business-rules.md#rn-043)).

Se o catálogo do provider publicar **modalidade** (aceita imagem, gera imagem)
ou `reasoning`, emita-as no `parseCatalogo` dele — e só quando a doc oficial
disser. Campo que o provider não declara fica **omitido**, nunca `false`:
`undefined` preserva o que já estava gravado, e `false` apagaria curadoria feita
à mão ([RN-056](business-rules.md#rn-056)).

### 6. Verifique com credencial real

```bash
# na tela de configurações do projeto: cadastre a credencial, depois
# "Atualizar catálogo" e confira o relatório por provider.
```

O relatório mostra **todo** provider, inclusive o pulado, com o motivo e a
origem da falha. `sem_credencial` significa que a chave não chegou;
`falha · origem infra` significa que nem se conseguiu falar com o provider;
`falha · origem modelo` significa que ele respondeu recusando.
