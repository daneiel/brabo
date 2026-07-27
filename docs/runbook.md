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
| custo por hora disparou | [Incidente de custo](#incidente-de-custo) |
| painel vazio, sem trace, sem log | [Observabilidade](#observabilidade) |
| agente respondendo vazio, truncado ou lentíssimo | [Ambiente de inferência](#ambiente-de-inferencia) |

Duas coisas que valem antes de qualquer procedimento:

- **Silêncio não é saúde.** As regras de alerta são do Grafana, não do
  Prometheus ([ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md)):
  Grafana fora do ar significa nenhum aviso, não nenhum problema.
- **Matar o pod não fecha sessão.** `kubectl delete pod` sem drain cria órfã.
  O caminho é sempre a transição normal.

---

## Deploy local {#deploy-local}

Sobe o Brabo inteiro num cluster local e valida com teste de fumaça. Decisões
em [ADR 0025](adr/0025-fase5-deploy-kubernetes-kustomize.md).

### Pré-requisitos

Obrigatórios no PATH: `docker`, `kubectl`, `kustomize`, `jq`, `openssl`.

`k3d` e `helm` **não** precisam estar instalados — o bootstrap os instala em
`~/.local/bin`, com versão pinada e checksum conferido. Garanta que esse
diretório esteja no PATH.

Recursos: o stack completo (Postgres, Keycloak, Prometheus, dois operadores e
os três apps) pede em torno de **4 GiB** livres.

### Subir

```bash
make deploy-local           # constrói as imagens, sobe o cluster, instala, valida
make deploy-local-clean     # o mesmo, sem reconstruir as imagens
```

Ao fim: web em <http://localhost:8088>, api em `:3000`, engine em `:4000`,
Keycloak em `:8080` — **as mesmas portas do `docker-compose.prod.yml`**, de
propósito (ADR 0025, decisão 10). Login `admin` / `admin123`.

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
3. Login por password grant no Keycloak.
4. `workspace → projeto → sessão`. Este passo atravessa as NetworkPolicies
   inteiras: criar sessão faz a api pedir token client-credentials ao Keycloak
   **e** chamar o engine por HTTP interno.
5. Probes distintas (`/live` e `/ready` do engine, `/live` da api) e o
   `/config.js` do web apontando para as URLs do cluster.
6. `oban_queue_depth` com os rótulos `queue` e `state` em `/metrics`.
7. `external.metrics.k8s.io` servindo a métrica — o modo de falha do
   prometheus-adapter é silencioso, então perguntamos direto à API agregada.

### Diagnóstico do deploy {#diagnostico-do-deploy}

#### Pods presos em `Init:CrashLoopBackOff` (Keycloak)

```bash
kubectl -n brabo logs keycloak-0 -c render-realm
```

O initContainer falha de propósito se sobrar marcador não substituído no realm
— um realm importado pela metade sobe verde e só quebra no login. Verifique se
o Secret `keycloak-secrets` foi materializado:

```bash
kubectl -n brabo get externalsecret
kubectl -n brabo describe externalsecret keycloak-secrets
```

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

O padrão é External Secrets Operator. Onde ele não for viável, substitua os
dois `ExternalSecret` de `deploy/k8s/base/common/externalsecrets.yaml` por
`SealedSecret`, **mantendo os mesmos nomes de Secret (`brabo-secrets`,
`keycloak-secrets`) e as mesmas chaves** — nada mais no deploy precisa mudar,
porque tudo consome via `secretRef`.

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
- **Keycloak em `start-dev`**, sem rootfs read-only (a augmentação do Quarkus
  escreve no filesystem no boot). Herdado do
  [ADR 0024](adr/0024-fase5-imagens-producao-ci.md), limitação 4.
- **Sem pgvector** no Postgres do CloudNativePG. Hoje nenhuma migration cria a
  extensão e nenhuma coluna `vector` existe.

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
- **Keycloak** tem banco próprio e não entra neste backup: usuários e realm são
  recriados pelo import do realm.
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

### Quando não há trace nenhuma

Na ordem, do mais provável ao menos:

**1. A variável não está definida.** Sem `OTEL_EXPORTER_OTLP_ENDPOINT` a
instrumentação é desligada de propósito, nos dois serviços.

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

## Ambiente de inferência {#ambiente-de-inferencia}

Quando o agente responde vazio, truncado, lentíssimo, ou "esquece" as próprias
instruções, o problema quase nunca está no código de domínio — está aqui. Estas
cinco causas foram levantadas em nove execuções seguidas do demo de gates e
estão registradas no
[ADR 0020](adr/0020-destravar-gates-qa-secops.md); todas as variáveis estão
expostas no `docker-compose.yml`.

| variável | sintoma quando errada |
|---|---|
| **GPU** | o serviço `ollama` sem device reservado deixa a GPU ociosa e roda 100% em CPU: um prompt de ~7.000 tokens leva ~50 s só de ingestão. O override é opt-in (`docker-compose.gpu.yml`, `pnpm dev:gpu`), fora do compose principal porque sem o `nvidia-container-toolkit` no host a reserva **faz o serviço falhar ao subir** |
| `OLLAMA_CONTEXT_LENGTH` | o default de 4096 trunca **em silêncio** um prompt montado para 128k. O agente perde as próprias instruções e passa a imitar o schema das ferramentas, que é o que sobra no fim do contexto |
| `OLLAMA_MAX_LOADED_MODELS` | com `OLLAMA_KEEP_ALIVE` alto os modelos acumulam: 15,2 GB de pesos residentes numa máquina de 15 GB, e o agente respondendo vazio por falta de memória |
| `OLLAMA_REQUEST_TIMEOUT_MS` | timeout curto demais para um modelo grande num prompt longo |
| `START_OUTBOX_DRAIN` / `START_ANAMNESE` | Psicólogo e Anamnese consomem turnos de LLM em paralelo com os agentes de execução e derrubam a conexão do dev no meio do ciclo |

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
