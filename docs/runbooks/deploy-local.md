# Runbook — deploy local em Kubernetes

Sobe o Brabo inteiro num cluster local e valida com teste de fumaça. Decisões
de arquitetura em [ADR 0025](../adr/0025-fase5-deploy-kubernetes-kustomize.md).

## Pré-requisitos

Obrigatórios no PATH: `docker`, `kubectl`, `kustomize`, `jq`, `openssl`.

`k3d` e `helm` **não** precisam estar instalados — o bootstrap os instala em
`~/.local/bin`, com versão pinada e checksum conferido. Garanta que esse
diretório esteja no PATH.

Recursos: o stack completo (Postgres, Keycloak, Prometheus, dois operadores e
os três apps) pede em torno de **4 GiB** livres.

## Subir

```bash
make deploy-local           # constrói as imagens, sobe o cluster, instala, valida
make deploy-local-clean     # o mesmo, sem reconstruir as imagens
```

Ao fim: web em <http://localhost:8088>, api em `:3000`, engine em `:4000`,
Keycloak em `:8080` — **as mesmas portas do `docker-compose.prod.yml`**, de
propósito (ver ADR 0025, decisão 10). Login `admin` / `admin123`.

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

## k3d é o padrão mesmo com kind instalado

Não é preferência. O k3s traz controlador de NetworkPolicy embutido; o
**kindnet do kind não implementa NetworkPolicy** e ignora os manifests em
silêncio. Num cluster kind, as políticas desta fase existem no etcd sem efeito
nenhum, e o deploy pareceria validado sem ter validado metade do item 4 do
escopo. O smoke avisa quando o cluster não faz enforcement.

## O que o smoke cobre

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

## Diagnóstico

### Pods presos em `Init:CrashLoopBackOff` (Keycloak)

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

### `ExternalSecret` não fica Ready

O `SecretStore` lê o Secret-fonte `brabo`, criado imperativamente pelo
bootstrap. Confirme que ele existe e que o RBAC está no lugar:

```bash
kubectl -n brabo get secret brabo
kubectl -n brabo describe secretstore brabo-secret-store
```

### HPA do engine em `<unknown>`

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

### Job de migração não reaplica

`Job` tem spec imutável: com o Job anterior ainda no cluster, reaplicar com uma
imagem nova falha. O bootstrap já apaga os dois antes do apply; manualmente:

```bash
kubectl -n brabo delete job migrate-api migrate-engine --ignore-not-found
kubectl apply -k deploy/k8s/overlays/local
```

### `bin/engine rpc` responde `eaddrinuse`

A faixa de portas da distribuição Erlang (`ERL_AFLAGS`) precisa ter mais de uma
porta: o nó em execução ocupa a primeira e o `rpc` sobe um nó oculto que
precisa de outra. A faixa configurada é 9100–9110, liberada na NetworkPolicy.

### Conferir que as réplicas do engine estão em cluster

Sem cluster Erlang, o `:global.trans` do `Workspace.ensure!` não serializa nada
e duas réplicas fazem `git init` concorrente no mesmo diretório compartilhado:

```bash
kubectl -n brabo exec deploy/engine -- /app/bin/engine rpc 'IO.inspect(Node.list())'
```

Deve listar os outros pods. Lista vazia com mais de uma réplica é defeito.

## Segredos: fallback para sealed-secrets

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

## Limites conhecidos deste ambiente

- **RWO em vez de RWX.** Funciona porque o cluster tem um nó só, e RWO
  significa "um NÓ", não "um pod". Num cluster real esta configuração colocaria
  api e engine em nós diferentes e o `git push` do dev agent falharia com
  `remote unpack failed`.
- **Keycloak em `start-dev`**, sem rootfs read-only (a augmentação do Quarkus
  escreve no filesystem no boot). Herdado do ADR 0024, limitação 4.
- **Sem pgvector** no Postgres do CloudNativePG. Hoje nenhuma migration cria a
  extensão e nenhuma coluna `vector` existe.
- **Sem drenagem de sessões no shutdown** — item 4 da Fase 5. Um scale-down do
  engine ainda encerra as sessões que a réplica hospedava.
