# 0152 — Backup e restore de volumes, contra compose

## Status

**Proposed.** Existe porque a [FASE 29](../explanation/fase-29-instalacao-de-uma-linha.md)
precisa migrar uma instalação anterior, e o caminho que a documentação
apontava para isso não serve.

## Context

O backup atual cobre **um** banco e roda **num** lugar:

- `docker/backup/backup.sh` faz `pg_dump --format=custom | aws s3 cp -`
  (`:124-140`), direto para S3 sem tocar disco, com retenção por contagem
  (`:160-182`) e uma linha em `backup_runs` a cada execução, sucesso ou falha
  (`trap registrar EXIT`, `:44-80`).
- `docker/backup/restore.sh` restaura num banco **de teste**
  (`brabo_restore_test`, `:18`), valida três coisas — lista de tabelas,
  contagem das críticas na janela do backup, e a continuidade densa da `seq` de
  `session_events` (`:139-224`) — e **nunca toca a origem** (`:8-9`).
- `make test-restore` → `deploy/k8s/test-restore.sh`, que exige `kubectl`, um
  cluster e o CronJob `brabo-backup` no namespace (`:56-58`).

Três consequências, todas medidas:

1. **A migração de uma instalação por compose não tem caminho.** `test-restore`
   é Kubernetes; não existe alvo equivalente contra compose, e o
   `docker-compose.prod.yml` **não tem serviço `backup`** (a imagem é
   construída pelo bake e usada só no k8s).
2. **O backup cobre só o Postgres.** Nada em `docker/backup/` toca
   `neo4j_data`, `git_local_repos`, `project_workspaces`, `ollama_data` ou
   `brabo_projects_base` (`docker-compose.prod.yml:474-486`).
3. Ele também exige **S3** — cinco variáveis obrigatórias (`backup.sh:11-15`).
   Numa instalação de máquina única, exigir um bucket para poder migrar é
   exigir infraestrutura que o instalador acabou de dizer que não precisa.

## Decision

### 1. Classificar os volumes antes de copiá-los

O erro fácil é "fazer backup de todos os volumes". Os sete não são a mesma
coisa, e tratá-los igual custa espaço e esconde o que importa:

| volume | natureza | decisão |
|---|---|---|
| `pgdata` | **fonte de verdade** — event log, ações, tudo | já coberto por `pg_dump`; continua sendo o dump lógico, não cópia de arquivo |
| `git_local_repos` | **fonte de verdade** — os bare repos do `LocalGitProvider` | **entra**, e é o achado deste ADR |
| `neo4j_data` | **derivado** — o grafo é memória projetada do event log ([ADR 0099](0099-neo4j-grafo-de-conhecimento-e-templates.md)), nunca fonte de verdade | **não entra**: o que falta é **reprojeção**, não backup |
| `project_workspaces` | **derivado** — worktrees que o `WorktreeManager` recria do bare | não entra |
| `ollama_data` | **re-obtenível** — modelos que se baixam de novo | não entra |
| `brabo_projects_base` | **do usuário**, não do produto | não entra, e o instalador nunca a apaga ([ADR 0150](0150-instalador-de-uma-linha.md)) |

**`git_local_repos` é o buraco real.** Um projeto com provider `local` tem o
repositório *bare* ali dentro; perder esse volume é perder o código que os
agentes produziram, e hoje **nenhum backup o cobre**. Ele não é reconstruível a
partir do Postgres — o event log guarda a narrativa, não os objetos do git.

### 2. Destino local, S3 opcional

O backup passa a aceitar **destino em disco** além de S3. Numa instalação de
máquina única, um diretório é o destino honesto; exigir bucket para migrar
seria exigir infraestrutura que o instalador não pede.

As cinco variáveis de S3 deixam de ser obrigatórias e passam a ser o que já
eram na prática: a configuração de **um** dos destinos.

### 3. Um caminho de restore que roda contra compose

Nasce o equivalente de `test-restore` **sem cluster**: sobe a imagem de backup
com `docker compose run`, restaura num banco de teste e roda **as mesmas três
validações** de `restore.sh:139-224`. Nada de lógica de validação nova — o que
muda é o invólucro, não o julgamento.

`deploy/k8s/test-restore.sh` fica **intacto**: são dois ambientes com dois
invólucros, e unificá-los faria o de compose depender de `kubectl`.

### 4. A reprojeção do grafo é a resposta para o Neo4j

Restaurar `neo4j_data` de um backup restauraria uma projeção possivelmente
velha ao lado de um Postgres restaurado noutro ponto — dois estados derivados
de instantes diferentes, sem nada que os concilie. A resposta certa para
memória derivada é reprojetar a partir da fonte.

Esta fase **não constrói** a reprojeção: declara que ela é o caminho e que, até
existir, uma instalação migrada nasce com o grafo **vazio** — o que é
degradação conhecida (o RAG continua no pgvector, que vive no Postgres e vem no
dump), não perda de dado.

### 5. O instalador usa isto, e não adivinha

O caminho de migração do ADR 0150 é: **backup → confirmar → deleção →
instalação → restore**, com o restore provado pela decisão 3. Sem backup bom,
o instalador **não** prossegue para a deleção.

## O que este ADR recusa explicitamente

- **Copiar todos os volumes.** Pela decisão 1: três dos sete são derivados ou
  re-obteníveis, e copiá-los dá a impressão de cobertura sem acrescentar
  recuperação.
- **Cópia de arquivo do `pgdata`.** Copiar o diretório de dados de um Postgres
  em execução produz um backup que pode não restaurar; o dump lógico continua.
- **Restaurar `neo4j_data`.** Pela decisão 4.
- **Fazer o restore contra o banco de origem.** `restore.sh` nunca toca a
  origem (`:8-9`), e essa propriedade não se negocia por conveniência de
  migração.
- **Unificar com `deploy/k8s/test-restore.sh`.**

## Consequences

- A migração de uma instalação existente passa a ter caminho **provado**, e o
  instalador ganha o direito de apagar volumes — porque provou que consegue
  trazê-los de volta.
- **`git_local_repos` entra no backup**, e essa é a diferença que este ADR faz
  fora do escopo da instalação: hoje qualquer perda daquele volume é perda de
  código, em qualquer ambiente, e ninguém tinha registrado.
- Instalação migrada nasce com **grafo vazio** até a reprojeção existir.
  Declarado, com o efeito nomeado: as leituras que dependem do grafo degradam;
  o RAG não é afetado.
- O backup ganha um segundo destino, e com ele um segundo caminho de falha —
  disco cheio. A linha em `backup_runs` continua sendo escrita nos dois casos,
  pelo `trap` que já existe.
