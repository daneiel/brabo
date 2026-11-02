# ADR 0025 — Fase 5 (sessão 2): deploy Kubernetes com Kustomize, métrica de fila e overlay local

- Status: aceito
- Data: 2026-07-26
- Fase: 5 (sessão 2 — item 3 do escopo, mais a métrica que o HPA exige)
- Sucede: [ADR 0024](0024-fase5-imagens-producao-ci.md), que entregou as
  imagens de produção e o CI e registrou cinco limitações — a primeira delas
  ("`VITE_*` é compile-time; resolver isso é pré-requisito para o Kubernetes da
  sessão seguinte") é resolvida aqui.

## Contexto

Depois da sessão 1 existia caminho de produção para as três imagens e CI que o
exercitava, mas **nenhum artefato de deploy**: nem manifesto, nem chart, nem
`docs/runbooks/`. O item 3 da Fase 5 pede o deploy em Kubernetes com HPA do
engine por profundidade de fila do Oban, e o critério de aceite é executável —
`make deploy-local` num cluster limpo termina com todos os pods Ready, smoke
verde, e encher a fila artificialmente dispara o HPA.

A parte difícil não foi escrever YAML. Foi que **escalar o engine para mais de
uma réplica é uma operação que o código das Fases 1–4 não suportava**, e três
dos cinco impedimentos abaixo só existem porque esta sessão introduz um HPA.

## Decisões

### 1. Kustomize base+overlays, não Helm

Os critérios pedidos no enunciado, respondidos:

- **Templating necessário**: baixo. São quatro componentes nossos, sem
  condicionais, sem laços, sem sub-charts. O que varia entre ambientes é
  valor (URL, StorageClass, réplica, CIDR), não estrutura. Uma linguagem de
  template pagaria por flexibilidade que não é usada.
- **Overlays por ambiente**: é a forma nativa do Kustomize, e overlays são
  YAML válido — `kubectl apply --dry-run=server` e `kubeconform` os checam
  antes de existir cluster. `values.yaml` de Helm só vira YAML depois de
  renderizado; revisar um diff de values é revisar um input, não o resultado.
- **Experiência de upgrade**: `kubectl apply -k` mais `kubectl rollout undo`
  por workload, com o git como fonte de verdade. Abrimos mão de `helm
  rollback` e do conceito de release conscientemente: em troca não existe
  estado de release para divergir do repositório, que é o modo de falha mais
  comum do Helm operado por várias pessoas.

**Terceiros continuam vindo por Helm.** External Secrets Operator,
CloudNativePG, Prometheus, prometheus-adapter e metrics-server são instalados
pelo `deploy/k8s/bootstrap.sh` com `helm upgrade --install` e versão pinada em
`deploy/k8s/helm/charts.env`. Reescrevê-los em Kustomize seria manter um fork
de manifesto upstream — trabalho puro sem ganho. A divisão é: **operadores por
Helm, aplicação por Kustomize.**

### 2. Engine é Deployment, não StatefulSet

Um StatefulSet oferece duas coisas, e nenhuma serve aqui:

**PVC por réplica seria ativamente errado.** Os worktrees dos dev agents ficam
em `<PROJECT_WORKSPACES_ROOT>/<project_id>/.worktrees/<agent_id>`, dentro do
**mesmo volume que a api monta** — a api cria o bare repo, grava o path
absoluto no Postgres, e o engine lê esse path do banco e o usa literalmente no
`git push` (ADR 0024, decisão 5). Dar a cada réplica seu próprio volume quebra
a identidade de caminho de que o push depende. Worktree não é estado por
réplica: é estado do projeto, guardado pelo lock de workspace (ADR 0017).

**Identidade de rede estável não é necessária.** O tráfego HTTP entra por
Service, que balanceia; e o `DNSCluster` descobre os pares por um Service
headless (`engine-headless`), que funciona igual sobre Deployment.

Consequência: o PVC compartilhado é **ReadWriteMany**. Não é preferência, é
requisito — api e engine escrevem no mesmo volume e podem cair em nós
diferentes.

### 3. prometheus-adapter, não KEDA

Mantém HPA nativo do Kubernetes e um operador a menos. O custo é real: uma
regra de discovery (`deploy/k8s/helm/prometheus-adapter-values.yaml`) e um
APIService agregado, que é a peça mais frágil do arranjo.

O que torna o custo aceitável é o teste: **o modo de falha do adapter é
silencioso.** Se a regra não casar, o HPA fica em `<unknown>` e simplesmente
não escala, com pods Ready e tudo mais verde. Por isso o `deploy/k8s/smoke.sh`
não confia no HPA — consulta `external.metrics.k8s.io` diretamente e falha se
ela não servir a métrica.

### 4. Cinco impedimentos que precisaram ser corrigidos no código

Não são refatoração eletiva das Fases 1–4. São a diferença entre "o YAML
aplica" e "o sistema funciona", e três deles só existem por causa do HPA.

#### 4.1. `force_ssl` redirecionava as probes

`apps/engine/config/prod.exs` tinha `paths: ["/health"]` **comentado** na lista
de exclusão do `force_ssl`. O kubelet chama a probe pelo **IP do pod**, não por
`localhost`, então a exclusão por host não o cobria: `/live` e `/ready`
responderiam **301** para `https://` e o pod nunca ficaria Ready. Um deploy
inteiro travaria numa linha comentada.

#### 4.2. A poda de worktree apagava trabalho vivo de outra réplica

`Engine.Dev.WorktreeCleanup.live_agents/1` consultava o `Engine.Dev.Registry`,
que é **local ao nó**. Enquanto o engine era réplica única, "vivo no Registry"
e "vivo" eram sinônimos. Com o volume compartilhado entre réplicas, a réplica A
varre os worktrees dos agentes da réplica B, não os encontra no próprio
Registry e **os remove como órfãos** — com o dev agent ainda escrevendo neles.

Correção: a fonte de verdade passou a ser `dev_agent_states`, que é global por
construção (é dela que a reidratação parte) e cuja linha é deletada quando o
agente termina. O conjunto é equivalente num nó só e correto em N nós.

#### 4.3. `Engine.Sessions.Monitor` apagava `session_states` em qualquer `:DOWN`

O `Engine.Dev.Monitor` já distinguia nó descendo de agente terminando
(`forget?/1`); o monitor de sessões não. E o efeito era pior do que uma corrida:
como a ordem de shutdown da árvore derruba o `SessionSupervisor` **antes** do
Monitor, ele fica vivo para processar cada `:DOWN`, apagar toda sessão ativa
**e ainda reportá-la à api como `closed_abnormally`**. Todo rollout e todo
scale-down marcaria como anormal exatamente as sessões saudáveis.

A correção não é cópia do `Dev.Monitor`: lá `{:shutdown, _}` sempre significa nó
descendo, aqui `{:shutdown, :heartbeat_timeout}` é término legítimo e a linha
**precisa** sair, senão a sessão reidrata para sempre.

#### 4.4. `:global.trans` sem cluster Erlang não serializa nada

`Engine.Actions.Workspace.ensure!` serializa a inicialização do workspace por
projeto com `:global.trans`, que só é global se os nós estiverem em cluster.
Sem isso, duas réplicas fazem `git init` concorrente no mesmo diretório do
volume compartilhado. O `DNSCluster` já estava na árvore de supervisão desde a
Fase 1, governado por `DNS_CLUSTER_QUERY` — faltava apontá-la para o Service
headless e fixar a porta da distribuição (`inet_dist_listen_min/max`) para a
NetworkPolicy poder liberá-la.

#### 4.5. As URLs da web eram compile-time

Dívida registrada no ADR 0024. O Vite inlina `import.meta.env.VITE_*` no
bundle, então cada ambiente exigia sua própria imagem — o oposto de promover o
artefato que passou no CI. Agora o entrypoint do nginx gera `/config.js` a
partir do ambiente do container e `apps/web/src/lib/runtime-config.ts` o lê,
mantendo as `VITE_*` como fallback para `pnpm dev:web`, onde não há nginx.

Dois detalhes que decidiram a implementação:

- O `Cache-Control: no-store` do `config.js` entra no `map $uri`, **nunca** num
  `add_header` de bloco filho — a armadilha do nginx que a decisão 7 do ADR
  0024 documenta (um `add_header` no filho descarta todos os headers herdados).
- Valor vazio conta como ausente. `envsubst` escreve `""` para variável não
  definida, e `'' ?? default` é `''` em JavaScript: sem esse tratamento, uma
  chave faltando no ConfigMap faz a app apontar para a origem vazia e falhar
  com erro de CORS que não diz nada sobre a causa.

### 5. Probes: três perguntas diferentes

Havia um único `/health` nos dois serviços, e ele consulta o banco. Isso é
readiness correto e liveness **errado**: sob Postgres lento, um liveness ligado
ao banco reinicia todas as réplicas ao mesmo tempo — degradação vira queda
total, executada pelo próprio kubelet.

| | startup | liveness | readiness |
|---|---|---|---|
| api | `/live` | `/live` | `/health` (banco) |
| engine | `/live`, janela larga | `/live` | `/ready` (banco + reidratação) |
| web | `/healthz` | `/healthz` | `/healthz` |
| keycloak | `:9000/health/started` | `:9000/health/live` | `:9000/health/ready` |

**"Readiness só após a reidratação" deixou de ser propriedade emergente.** A
garantia existia, mas implicitamente: os dois reidratadores ficam antes do
`Endpoint` na árvore de supervisão, e `Supervisor.start_link/2` é sequencial.
Isso basta no Docker; não basta em Kubernetes, porque o probe precisa
**distinguir** "ainda reidratando" de "pronto", e sem sinal observável a única
diferença seria a porta fechada — que o kubelet lê como pod morto. Agora
`Engine.Readiness` marca cada estágio em `:persistent_term` e `/ready` o lê, o
que também torna a regra testável em vez de dependente de uma ordem que
qualquer reordenação futura quebraria em silêncio.

### 6. A métrica: `oban_queue_depth`, dimensionada por `state`

Exposta em `/metrics` do engine via `telemetry_metrics_prometheus_core` — só o
agregador mais `scrape/1`, servido pelo router que já existe. PromEx traria
plug e servidor HTTP próprios mais um uploader de dashboards do Grafana, que é
trabalho do item 5.

A medição é uma agregação SQL em `engine.oban_jobs`, não `Oban.check_queue/1`:
esta última devolve o estado do produtor **local**, e a pergunta do HPA é
quanto trabalho existe esperando no cluster inteiro — propriedade da tabela,
não do nó.

**O filtro `state="available"` é obrigatório.** Três workers se auto-reagendam
(`OutboxDrainWorker` a cada 2s, `WorktreeCleanupWorker` a cada 60s,
`AnamneseSchedulerWorker`), inserindo o próprio sucessor: em regime normal a
tabela **nunca** está vazia, sempre há jobs em `scheduled`. Um HPA que contasse
a tabela leria o sistema ocioso como saturado e manteria o engine no máximo de
réplicas para sempre.

A métrica também **zera explicitamente** as filas que esvaziaram. Sem isso o
gauge fica pegajoso: uma fila que drenou some da consulta, o Prometheus segue
servindo o último valor e o HPA mantém réplicas de pé por backlog inexistente.

### 7. Rede: a lista do enunciado está incompleta

O escopo pede "web→api, api→db, engine→api, engine→db; nada mais". Aplicada
literalmente, essa lista deixa o sistema no ar e quebrado. Implementamos
`default-deny` de ingress e egress mais **exatamente os fluxos que o sistema
exerce**, que são:

| fluxo | por que está aqui |
|---|---|
| api → keycloak | criar sessão pede token client-credentials. **Ausente da lista** |
| api → engine | criar sessão chama o engine por HTTP interno. **Ausente da lista** |
| engine → keycloak | valida o token recebido contra o JWKS |
| engine → api | grava evento, cria tarefa, reporta término |
| engine ↔ engine | distribuição Erlang (ver 4.4) |
| prometheus → engine:4000 | **sem isso o HPA nunca recebe métrica** |
| todos → kube-dns | sem DNS nada resolve e o resto é irrelevante |
| api/engine → db | por rótulo `brabo.dev/role: database`; em prod, por `ipBlock` |

E `web→api` **não é um fluxo de pod**: o web é nginx servindo estático, e quem
chama a api é o browser, de fora do cluster. Dar egress ao pod do web afrouxaria
a política sem habilitar nada.

Ressalva de enforcement: NetworkPolicy só vale se a CNI a implementar. O k3s
traz o controlador embutido; o **kindnet do kind não implementa NetworkPolicy**
e ignora os manifests em silêncio. Por isso o bootstrap usa k3d por padrão
mesmo quando só o kind está instalado, e o smoke reporta quando o cluster não
faz enforcement.

### 8. Postgres externo por padrão, CloudNativePG para dev/staging

A base não sabe onde o banco está: a conexão chega só pelo `DATABASE_URL` do
Secret. O overlay local sobe um `Cluster` do CloudNativePG **num namespace
próprio** (`brabo-db`), porque o `default-deny` do namespace da aplicação
exigiria regras de egress específicas do operador — que não têm nada a ver com
a aplicação. A regra `allow-db-egress` atravessa namespaces por casar por
rótulo, não por nome.

### 9. Secrets: ESO por padrão, sealed-secrets como fallback

Nenhum segredo em manifesto versionado. Os `ExternalSecret` da base são
idênticos em todo ambiente; muda só o `SecretStore`, que é o único recurso do
caminho de segredo declarado por overlay. No local o store lê de um
Secret-fonte que o `bootstrap.sh` cria **imperativamente** com `openssl rand`.

Corolário: o `realm.json` do Keycloak virou **template**. O original traz os
secrets dos clients em plaintext, e pô-lo num ConfigMap seria exatamente o
"secret em manifesto plano" que o escopo proíbe. Um initContainer o renderiza
com os valores do ESO para um `emptyDir` de memória, e **falha alto** se sobrar
qualquer marcador — um realm importado pela metade sobe verde e só quebra no
login.

### 10. Overlay local sem ingress: NodePorts nas portas do compose

O overlay local mapeia NodePorts para **3000/4000/8080/8088**, exatamente as
portas do `docker-compose.prod.yml`. Isso mantém válidos o realm de
desenvolvimento e os defaults do `docker/smoke.sh` sem tradução, e dispensa
ingress controller e resolução de DNS — que custariam memória numa máquina de
desenvolvimento e trariam uma classe inteira de falha offline (`nip.io` e
similares precisam de internet). Ingress existe só em staging/prod.

Pelo mesmo motivo o Prometheus é o chart do servidor sozinho, sem Alertmanager,
Pushgateway, node-exporter ou Grafana: o kube-prometheus-stack não cabe, e
dashboards provisionados como código são o item 5.

### 11. Como o critério de aceite do HPA é exercitado

`make hpa-test` insere jobs em `available` numa fila **que não está declarada
na configuração do Oban**. Sem produtor configurado ninguém os consome: ficam
em `available` até serem removidos, que é a condição a observar. As
alternativas foram descartadas por efeito colateral — inserir na fila `default`
faria o engine executá-los (mediria drenagem, não backlog), pausar a fila
mudaria o comportamento do sistema durante o teste, e criar um worker no-op
colocaria código de teste dentro do domínio.

## Consequências

- Existe deploy Kubernetes real, validável com um comando, e a distância entre
  "a imagem sobe no compose" e "o sistema funciona num cluster" deixou de ser
  invisível — foram cinco defeitos, todos silenciosos.
- O engine passou a suportar mais de uma réplica de fato, não só no manifesto.
- A mesma imagem do web serve qualquer ambiente; a dívida nº 1 do ADR 0024
  está paga.
- `bandit` subiu de 1.12.0 para 1.12.3 (dentro do `~> 1.5` já declarado):
  o `mix deps.get` desta sessão acusou EEF-CVE-2026-65623 (HIGH, blow-up
  quadrático de CPU em WebSocket fragmentado) — e o engine serve os canais
  Phoenix por websocket.

## Limitações conhecidas (registradas, não resolvidas)

1. **Não há drenagem de sessões no shutdown.** É o item 4 da Fase 5 e não
   estava entre os seis desta sessão. Os manifests já reservam
   `terminationGracePeriodSeconds` e o ponto de enganche do `preStop`, e a
   correção 4.3 impede que scale-down destrua estado — mas uma réplica que
   desce ainda encerra as sessões que hospedava sem a transição `closing` com
   causa `node_shutdown`. Por isso `scaleDown.stabilizationWindowSeconds` é 600
   no engine: descer é assimetricamente mais caro que manter.
2. **Nenhuma imagem é publicada em registry.** O CI usa `load: true` com tags
   fixas `:prod`. Os overlays de staging/prod já trazem o campo `images:`
   pronto, com `REPLACE_WITH_DIGEST` — publicar por digest é pré-requisito
   deles, não do local.
3. **Keycloak segue em `start-dev`**, herdado do ADR 0024 (limitação 4). O que
   mudou é que os segredos deixaram de ser plaintext. Modo produção, banco
   externo e hostname fixo continuam fora de escopo.
4. **O overlay local usa ReadWriteOnce**, não RWX. Funciona porque o cluster é
   de um nó só e RWO significa "um NÓ", não "um pod". A base continua RWX, que
   é o correto; quem afrouxa é o overlay, e num cluster de verdade essa
   configuração colocaria api e engine em nós diferentes e o push falharia com
   `remote unpack failed`.
5. **Os overlays de staging e prod não são exercitados** por nenhum teste além
   de `kustomize build` + `kubeconform`. Dependem de Postgres gerenciado,
   StorageClass RWX, provider de segredos e registry — nada disso existe numa
   máquina de desenvolvimento. Os marcadores `REPLACE_ME` são deliberados:
   um default plausível ali seria pior que um marcador, porque passaria
   despercebido.
6. **`k3d image import` não importa o busybox do initContainer.** Falha com
   `content digest ... not found` — o `docker pull` produz um índice
   multi-arquitetura com manifesto de atestação, que o `ctr` do nó rejeita. O
   bootstrap trata a importação dessa imagem como opcional e deixa o kubelet
   puxá-la do registry (já dependemos de internet para os charts). Para as
   NOSSAS imagens a importação continua obrigatória: elas não existem em
   registry nenhum, e falhar ali é erro de verdade — o script passou a
   inspecionar a saída porque o `k3d` sai com código 0 mesmo quando falha.
7. **pgvector não está no Postgres do overlay local.** A extensão só é criada
   pelo `docker/postgres/init.sql`, nunca por migration (verificado); nenhuma
   coluna `vector` existe hoje. Quando a primeira existir, o CloudNativePG
   precisará de imagem com a extensão.
