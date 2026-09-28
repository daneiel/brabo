# 0169 — O destino S3 do overlay local deixa de ser o MinIO e passa a ser o SeaweedFS

## Status

**Accepted.** Decidido em 2026-09-27 (AT-200, issue #633), por medição, sob a
delegação do mantenedor ("você mede e escolhe"). Referencia o
[ADR 0027](0027-fase5-backup-hardening-release.md) (o backup em S3 e a troca
do `mc` pelo `aws-cli`) e o [ADR 0159](0159-imagem-de-terceiro-por-digest.md)
(imagem de terceiro por digest do índice). Não edita nenhum dos dois.

## Context

O overlay local do Kubernetes sobe um servidor S3 dentro do namespace `brabo`
para que o backup exercitado localmente seja o MESMO de produção: o script fala
S3 sempre e só o endpoint muda. Esse servidor era o MinIO, preso desde o
ADR 0159 em `quay.io/minio/minio@sha256:a1ea29fa…  # RELEASE.2025-04-22T22-12-26Z`.

A MinIO deixou de publicar a imagem comunitária. Medido em 2026-09-27, sem
autenticação:

| referência | resposta |
|---|---|
| `quay.io/v2/minio/minio/manifests/sha256:a1ea29fa…` | **401** |
| `quay.io/v2/minio/minio/tags/list` | **401** |
| `registry-1.docker.io/v2/minio/minio/manifests/RELEASE.2025-04-22T22-12-26Z` | **401** `UNAUTHORIZED` (repositório inexistente para anônimo) |
| `hub.docker.com/v2/repositories/minio/minio/tags` | **404** `object not found` |

A consequência era total, não parcial: o `deploy/k8s/bootstrap.sh` espera
`rollout status deployment/minio` ANTES de semear e de criar o bucket, então o
`propriedades.yml` morria no bootstrap e **nenhuma** das provas de propriedade
rodava — nem as que não tocam backup (`rollout-test`, `hpa-test`,
`test-reprojecao-k8s`).

O digest cumpriu o que o ADR 0159 prometeu — ninguém trocou os bytes por baixo
— e isso não bastou: **digest garante imutabilidade, não disponibilidade.** Um
pin sobrevive ao dono da tag mover a tag; não sobrevive ao dono do registro
apagar o repositório.

### O que depende desse S3 (mapeado)

- **Servidor:** `deploy/k8s/overlays/local/minio/{minio,netpol}.yaml`, listado
  no `kustomization.yaml` do overlay local. Só o overlay local; staging e prod
  apontam para um bucket externo.
- **Cliente:** NÃO é imagem da MinIO. O `mc` saiu na Fase 5 (ADR 0027, decisão
  1b); o backup, o restore e a criação de bucket usam o `aws-cli` do apk dentro
  da `brabo-backup` (`docker/backup/Dockerfile.prod`), pelo adaptador
  `docker/backup/lib.sh`. As operações S3 que ele faz são sete: `s3 ls`,
  `s3 cp -` (stdin, multipart), `s3 cp` (download), `s3api head-object`,
  `s3 cp` bucket→bucket (cópia do lado do servidor), `s3api list-objects-v2` e
  `s3 rm` — mais o `s3 mb` do bootstrap.
- **Credenciais:** `BACKUP_S3_ACCESS_KEY`/`BACKUP_S3_SECRET_KEY` do Secret
  `brabo`, materializado pelo ESO em `brabo-secrets`. O servidor lê o MESMO par.
- **Bootstrap:** o `BACKUP_S3_ENDPOINT`, o `rollout status`, a espera pelo
  `Endpoints` e o pod efêmero que cria o bucket.
- **Rede:** duas NetworkPolicies no overlay (entrada no servidor, saída de
  backup/restore), casando a porta do POD.
- `make test-restore` (`deploy/k8s/test-restore.sh`) e o CronJob de backup só
  enxergam o endpoint. O compose (`docker/backup/test-restore-compose.sh`) usa
  disco, não S3, e não é afetado.

## Decision

**O servidor passa a ser o SeaweedFS, `docker.io/chrislusf/seaweedfs` 4.47,
preso pelo digest do ÍNDICE
(`sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882`),
rodando `server -s3 -s3.port=9000`.** Os recursos passam a se chamar
`s3-local` (Deployment, Service, PVC `s3-local-data`, rótulo
`app.kubernetes.io/name`) e a pasta, `overlays/local/s3/`.

### As candidatas, pelos critérios na ordem que o mantenedor deu

| candidata | 1. oficial, anônima, índice amd64+arm64 | 2. fluxo real do backup | 3. menor mudança | 4. licença | desfecho |
|---|---|---|---|---|---|
| **SeaweedFS 4.47** (`chrislusf/seaweedfs`) | **sim** — Docker Hub do autor (o README do `seaweedfs/seaweedfs` aponta para ele; rótulos OCI com `source`/`revision`), 200 anônimo, índice OCI com `amd64`, `arm64`, `arm/v7`, `386`; as tags têm assinatura cosign (`.sig`) publicada | **sim**, medido (abaixo) | servidor troca; cliente, script, Secret e porta ficam | Apache-2.0 | **escolhida** |
| Garage v2.1.0 (`dxflrs/garage`) | sim — 200 anônimo, índice com `amd64`, `arm64`, `arm`, `386` | não medido | exige arquivo de configuração (ConfigMap com `rpc_secret`) e, DEPOIS do boot, `garage layout assign` + `layout apply` e `garage key import <key-id> <secret>` — um passo de administração novo no bootstrap. O Garage documenta um formato próprio de key-id (`GK…`), o que obrigaria a trocar o `BACKUP_S3_ACCESS_KEY=brabo-backup` (não medido aqui) | AGPL-3.0 (sem problema para uso não modificado num overlay de teste, mas mais pesada que a primeira) | descartada no critério 3 |
| MinIO de outra fonte: `bitnami/minio` | **não** — 404 anônimo (a Bitnami também encerrou o catálogo gratuito) | — | — | — | descartada no critério 1 |
| MinIO de outra fonte: `bitnamilegacy/minio` | **não** como publicação viva — repositório CONGELADO, última atualização 2025-08-19; é espelho sem patch e sem publicador ativo | — | — | — | descartada no critério 1 |
| MinIO de outra fonte: `cgr.dev/chainguard/minio` | parcial — índice amd64+arm64, anônimo, mas só `:latest` é gratuito: não há tag estável para o comentário do pin, e o publicador é quem recompila o fonte, não a MinIO | — | — | AGPL-3.0 | descartada no critério 1 (sem tag fixa; publicador não oficial) |
| MinIO original (`quay.io`/`docker.io`) | **não** — 401/404 (Context) | — | — | — | é o problema |

"Fique com a primeira que cumprir tudo": o SeaweedFS cumpriu os quatro, então o
Garage não foi levado ao fluxo real — a medição parou onde a regra manda parar,
e a coluna diz isso em vez de preenchê-la.

### A medição do critério 2

A `brabo-backup` construída deste checkout (`aws-cli/2.15.57`, Alpine 3.20)
rodou o adaptador **real** (`docker/backup/lib.sh`, `destino_preparar` e as
funções `destino_*`) contra `weed server -s3` num container como uid 1000, com
o par de credenciais no ambiente e `/data` limitado a 4 GiB (o tamanho do PVC):

- segredo errado → `aws s3 ls` **recusado** (a autenticação vale);
- `s3 mb` do bootstrap → criou o bucket;
- `destino_enviar` de 30 MiB por stdin (multipart) → `head-object` devolveu
  31457280, o download bateu no sha256;
- `destino_tamanho` de objeto inexistente → `0`;
- `destino_copiar` (cópia do lado do servidor), `destino_listar` (3 chaves,
  prefixo vazio sem saída) e `destino_remover` → corretos;
- `/healthz` na porta S3 → 200 em ~1 s, sem autenticação (é o que as probes
  usam); memória ~470 MiB depois do upload, dentro do limite de 1 GiB.

E no cluster, duas vezes:

- **CI**, `propriedades.yml` por `workflow_dispatch` na branch, run
  `36362479629`: bootstrap, `smoke-k8s`, `hpa-test`, `rollout-test`,
  `test-restore`, `test-restore-mutacao` e `test-reprojecao-k8s` — todos
  `success`, sem nenhuma prova alterada.
- **Local**, k3d nesta máquina: `deploy/k8s/bootstrap.sh` saiu com 0 (o
  `rollout status deployment/s3-local` e a criação do bucket passaram), e
  `make test-restore` subiu o dump de 183 KB para
  `s3-local…/brabo-backups/daily/…`, baixou e restaurou 55 tabelas idênticas
  (saída 0); `make test-restore-mutacao` reprovou a quebra nomeando
  `zz_mutacao_restore` (saída 0). Um detalhe ALHEIO ao S3, registrado para não
  ser confundido com ele: na primeira rodada local o seed perdeu a ativação da
  sessão numa corrida com o engine (`ECONNREFUSED …:4000`), o dump saiu sem
  nenhum `session_event` e a prova reprovou por isso, como deve; com três
  eventos gravados pela rota interna que a própria mensagem da prova indica, ela
  passou. No CI o seed ativou a sessão na primeira.

### Por que `server -s3` e não `mini`

A imagem nasce com `mini`, que acrescenta WebDAV, Admin UI e um catálogo
Iceberg. `server -s3` sobe mestre, volume, filer e gateway S3 — o mínimo que
responde S3. O resto seria superfície e memória sem consumidor.

### Por que a porta 9000

A NetworkPolicy casa a porta do POD, não a do Service. Com `-s3.port=9000` o
gateway escuta onde o MinIO escutava, e as duas políticas e o
`BACKUP_S3_ENDPOINT` mudam só de NOME. Mestre (9333), volume (8080) e filer
(8888) escutam dentro do pod e continuam negados pela baseline.

### Por que o nome é neutro

Chamar de `minio` um Service que roda SeaweedFS pouparia três linhas do
bootstrap e ensinaria errado a quem abrisse o cluster. O que o backup consome é
o PROTOCOLO; nomear pelo produto atrás dele é o que faria a próxima troca
repetir esta.

## Consequences

- O bootstrap volta a passar do S3, e as provas de propriedade voltam a rodar
  (run `36362479629`, as seis verdes).
- **O cliente não mudou.** Nenhuma linha de `docker/backup/` foi tocada, e o que
  as provas aferem (`test-restore`, `test-restore-mutacao`) é o mesmo.
- **Preço declarado: o `readOnlyRootFilesystem` continua falso**, como era com
  o MinIO — o `weed` grava o socket do filer em `/tmp`. Componente de teste
  local, sem equivalente em produção.
- **Preço declarado: o SeaweedFS não é o MinIO.** Compatibilidade S3 é um
  contrato por operação, não um selo. As oito que o produto usa foram medidas;
  uma operação NOVA no `lib.sh` (lifecycle, versionamento, object lock) precisa
  ser medida contra ele antes de entrar, porque é aqui que ela seria exercitada
  primeiro. Produção continua falando com o bucket real, que não muda.
- **O pin por digest não protege contra o publicador sumir** — nem este. O
  sinal, se acontecer de novo, é o mesmo: o bootstrap morre no `rollout
  status` do S3 com `ImagePullBackOff`. A lição foi para
  [`cadeia-de-suprimentos-do-ci.md`](../explanation/cadeia-de-suprimentos-do-ci.md).
- A contagem de imagens de terceiro presas por digest não muda (uma sai, uma
  entra): 39.
- Não nasce RN: é infraestrutura de validação local, sem regra de negócio.
