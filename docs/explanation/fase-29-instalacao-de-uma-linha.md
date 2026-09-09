---
id: fase-29-instalacao-de-uma-linha
title: FASE 29 — a instalação de uma linha
sidebar_label: FASE 29 — instalação de uma linha
sidebar_position: 16
description: O recorte da FASE 29 — assinatura dos artefatos publicados, um install.sh versionado com fonte escolhida e marcador, backup de volumes e a base consentida do runner. As decisões estão nos ADRs 0149 a 0152.
keywords: [fase 29, instalador, assinatura, cosign, backup, runner, base de projetos]
---

# FASE 29 — a instalação de uma linha

> Este documento é o **recorte** da fase: o que ela persegue, o que ela recusa,
> e em que ordem. As **decisões** moram nos [ADR 0149](../adr/0149-assinatura-dos-artefatos-publicados.md),
> [0150](../adr/0150-instalador-de-uma-linha.md), [0151](../adr/0151-base-consentida-no-runner.md)
> e [0152](../adr/0152-backup-de-volumes-contra-compose.md) — o que estiver
> aqui e não estiver lá é intenção, não decisão.

## O problema

O Brabo se instala hoje em **três gestos desconexos**, e nenhum deles conhece
os outros:

| gesto | onde | o que exige de quem instala |
|---|---|---|
| subir os serviços | `docker compose -f docker/docker-compose.prod.yml` | exportar cinco segredos à mão (RN-114, [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md)) e ter o checkout |
| pôr o runner na máquina | navegador ([ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)) | baixar o binário, `chmod +x` manual (BRB-031), repetir por projeto |
| escolher onde o código mora | `pnpm bootstrap` ([ADR 0146](../adr/0146-base-consentida-no-bootstrap.md)) | ter um checkout de **desenvolvimento** — o menu não existe fora dele |

A FASE 28 **recusou por escrito** o instalador de uma linha, e a razão continua
válida: *"um instalador de uma linha sem assinatura é pior que o download
atual"* ([fase-28-pasta-do-usuario.md](fase-28-pasta-do-usuario.md), BRB-005).
Um `curl | sh` que baixa artefato não assinado transforma qualquer
comprometimento do canal em execução de código na máquina de quem instala — e
o produto hoje **não assina nada** que publica.

É por isso que esta fase começa pela assinatura e não pelo instalador. A ordem
não é preferência: sem o ADR 0149, o ADR 0150 seria a coisa que a FASE 28
recusou.

## O desenho, em quatro camadas

Cada camada com um mecanismo só, e nenhuma inventando autoridade nova:

| camada | onde | mecanismo |
|---|---|---|
| procedência | `release.yml`, `build-runner-binaries.yml` | `cosign` keyless (OIDC do Actions) nas imagens e nos binários; `checksums.txt` assinado |
| instalação | `install.sh` versionado, obtido de GitHub Releases | verifica a própria origem, detecta o que já existe, **pergunta**, grava marcador |
| dados | `docker/backup/` | backup e restore que rodam **contra compose**, sem cluster |
| pasta viva | `guard.ts` do runner | uma base consentida; cada projeto é subpasta dentro dela |

A quarta camada existe por uma razão física que a FASE 28 já tinha nomeado:
bind mount não atravessa rede nem alcança caminho fora do que foi montado. O
`brabo-runner` é o processo que já vive na máquina do usuário — o que falta
não é um agente, é ele **nascer com uma base** em vez de com um caminho solto.

## Consentimento de configuração ≠ aprovação de ação

O ponto que os quatro ADRs precisam declarar, e que decide o desenho do
instalador:

Escolher uma base, gravar um `.env`, criar uma pasta e instalar um serviço são
**configuração consentida pelo usuário no terminal dele** — não são um agente
pedindo para agir. Nada disso vira `proposed_action`, e fazê-lo passar por lá
cairia no escopo de caminho do [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md),
viraria fila de aprovações rotineiras e corroeria justamente o teto que dá
sentido ao clique.

O corolário vale nos dois sentidos, e é o que separa esta fase de um
instalador comum: **consentimento não dispensa verificação**. O usuário
consente com a base e com a instalação; ele não tem como consentir com a
procedência de um binário que não pode inspecionar. Por isso a verificação de
assinatura é do **mecanismo**, nunca uma pergunta na tela — e falhar nela é
recusa nomeada, jamais um aviso que se possa aceitar clicando.

## Numeração — contada, não herdada

> As contagens em prosa do repositório seguem em deriva conhecida: o
> frontmatter de `docs/adr/index.md` anuncia um número de ADRs que o disco não
> confirma. Nenhuma sessão desta fase confia em número escrito em prosa.

O método, que toda sessão desta fase repete antes de reservar qualquer número —
e que a FASE 28 já executava, **acrescido de uma segunda metade que faltava**:

```bash
# ADRs e RNs em dev — o piso
git ls-tree --name-only dev docs/adr/ | grep -oE '^[0-9]{4}' | sort -n | tail -1
git grep -h -E '^### RN-' dev -- 'docs/business-rules.md' 'docs/business-rules/*.md' \
  | grep -oE 'RN-[0-9]+' | sed 's/RN-//' | sort -n -u | tail -1

# o que está EM VOO — branches locais e remotas ainda não mergeadas
for b in $(git branch --format='%(refname:short)'; git branch -r --format='%(refname:short)'); do
  git merge-base --is-ancestor "$b" dev 2>/dev/null && continue
  echo "$b: $(git ls-tree --name-only "$b" docs/adr/ | grep -oE '^[0-9]{4}' | sort -n | tail -1)"
done
```

Medido no início da sessão 1, contra `dev`: **147 ADRs** (maior `0147`) e
**382 RNs** (maior `521`). E em voo, no mesmo instante: o **ADR 0148 alocado
por duas branches ao mesmo tempo**, e as **RNs 510, 522 e 523** — a 522 e a 523
também duplicadas entre duas branches cada.

**A faixa reservada para a fase é RN-524 a RN-538**, e os ADRs são **0149,
0150, 0151 e 0152**. O salto sobre 510/522/523 e sobre o 0148 é deliberado.

Registrar as três colisões observadas é o ponto, não um detalhe: a FASE 28
escreveu que contar apenas `dev` devolveria um número já alocado, e essa
sessão **encontrou o mesmo modo de falha acontecendo três vezes ao mesmo
tempo**. Contar `dev` é condição necessária e não suficiente; a segunda metade
do comando acima é o que faltava, e é por isso que ela entra aqui.

Vale repetir por que uma colisão sobrevive tanto tempo: **`docs:build` não pega
âncora duplicada.** `onBrokenAnchors: 'throw'` reprova link para âncora que
*não existe*; com duas âncoras iguais o Docusaurus resolve a primeira e a
segunda fica inalcançável, em silêncio.

## O que a medição corrigiu no recorte

O plano desta fase nasceu de um recorte escrito antes da medição. Cinco pontos
dele não sobreviveram ao disco, e ficam registrados porque um plano que se
reescreve para bater com o resultado deixa de ensinar:

- **`workspace.verified` não existe** — nem como evento, nem como mensagem de
  canal, nem como rota. O que existe é `workspace_confirm`, e ele é
  **unidirecional**: `terminal_channel.ex:356-373` responde `{:noreply,
  socket}` e não empurra nada de volta ao runner. Um par com resposta tem outro
  molde no repositório, o de `exec`/`exec_result`.
- **O ponto 5 do ADR 0146 não versiona nenhum `install.sh`** — ele versiona
  `scripts/dev/consentir-base.mjs`. O princípio ("nunca gerado pela api, nunca
  baixado em tempo de execução", com o corolário de que a api não ganha rota
  que emita script de host) é generalizável, e o ADR 0150 o **estende**; mas
  citá-lo como se já falasse do instalador seria atribuir ao ADR uma frase que
  ele não tem.
- **`docker-compose.prod.yml` não consome o GHCR.** Todos os serviços apontam
  para `brabo-*:prod` com bloco `build:` local, e o cabeçalho do arquivo diz de
  si mesmo: *"o que este arquivo NÃO é: um manifesto de produção endurecido"*.
  O único consumidor de `.release/images.json` é o kustomize.
- **`make test-restore` é caminho de Kubernetes** (exige `kubectl` e o CronJob
  `brabo-backup`), e `docker/backup/backup.sh` cobre **só o Postgres**. Tratá-lo
  como "a prova da migração" numa instalação por compose seria prometer o que o
  disco não sustenta — daí o ADR 0152 existir.
- **O registro de BRB não é do repositório.** Ele vive no vault do mantenedor,
  com 33 itens e critério de pronto por item; aqui só dois ids apareciam, em
  prosa. Medindo os seis que a fase herdou: **BRB-032 e BRB-033 descrevem
  defeitos que já não reproduzem**, e **BRB-004 não é o que o id sugere** — pede
  imagem de terceiro por *digest*, não a tag que o #419 fixou. Daí
  [o registro deste repositório](../reference/brb.md) guardar a **evidência**
  (estado medido, `arquivo:linha`) e não a finding.
- **"Um runner por projeto" está imposto em cinco lugares independentes**, não
  só no `Registry`: o tópico `terminal:<projectId>`, o socket id
  `runner_socket:<kind>:<project_id>:<user_id>`, o ticket escopado por projeto,
  a coluna `runner_device_keys.project_id NOT NULL` e o nome da unit de
  serviço. Por isso o runner **por máquina** saiu desta fase.

## As sessões

Uma entregável cada. A tabela é leitura, não precedência — a coluna "depende
de" é que ordena, e a FASE 28 registrou o caso em que a ordem real divergiu.

| # | entregável | depende de | proibições próprias |
|---|---|---|---|
| 1 | este documento, os ADRs 0149-0152, [o registro de BRB](../reference/brb.md) e a faixa de RN | — | não toca `apps/`, `docker/`, `scripts/`, `.github/`, `deploy/`; não edita ADR aceito |
| 2 | assinatura em `release.yml` e `build-runner-binaries.yml`; `checksums.txt`; verificação no runbook | 1 | não escreve `install.sh`; não muda o que as imagens contêm; **não toca o proxy da api** (ver abaixo) |
| 3 | `install.sh`: verificação de origem, detecção, pergunta, marcador — **e o proxy `GET /runner-releases/binary` passa a verificar** | 2 | **não sobe nada** — nem compose, nem migrate, nem runner |
| 4 | `install.sh`: fonte GHCR × build local, segredos, compose de instalação, subida verificada | 3 | não instala runner; não migra instalação anterior |
| 5 | backup e restore de volumes, rodando contra compose | 1 | não toca o CronJob do k8s nem `deploy/k8s/test-restore.sh` |
| 6 | `install.sh`: migração de instalação anterior, provada com a sessão 5 | 4, 5 | não apaga a base do usuário nem a pasta de espelho, em hipótese nenhuma |
| 7 | runner: base consentida no `guard.ts`; o `install.sh` instala o runner | 4 | não mexe no pareamento por projeto; não cria credencial nova |
| 8 | protocolo: capacidade e mensagem de criação de pasta, predicado próprio | 7 | não altera `RunnerReadiness`; não introduz `proposed_action` |
| 9 | web: picker via `fs_list_dir` no modo `runner`, espera com três estados (RN-474) | 8 | não toca o caminho do modo `mounted` (RN-504, pela api) |
| 10 | E2E em máquina limpa (Linux e macOS), docmap para o `install.sh`, `docs:check`, CHANGELOG | 6, 9 | não afrouxa gate para o E2E passar |

> **Os dois lados da verificação não entram juntos, e a divisão é a dependência
> real.** A sessão 2 entrega quem **produz** a assinatura; os consumidores
> entram na 3, porque os dois que existem — o `install.sh` conferindo o próprio
> hash, e o proxy `GET /runner-releases/binary` conferindo o binário que serve —
> leem o **mesmo** `checksums.txt` assinado e só podem ser escritos depois que
> ele existe. Enquanto a 3 não fecha, o proxy continua servindo bytes do GitHub
> sem verificar nada, exatamente como antes: a sessão 2 **não piora** esse
> caminho, e também não o conserta.

> **A sessão 4 não chama o `docker/smoke.sh`, e a mudança é deliberada.** O
> plano dizia "migrate, smoke". Nenhum dos dois sobreviveu ao contato com o
> disco, e por motivos opostos: **migrate** não é passo porque o compose já o
> encadeia (`api` depende de `migrate-api` com
> `service_completed_successfully`, e `up --wait` espera) — um segundo lugar
> mandando migrar seria a segunda fonte da mesma verdade; e o **`smoke.sh`**
> constrói as imagens (`--build`) e derruba a stack no fim, que é o oposto do
> que uma instalação quer. No lugar dele, o instalador **pergunta antes de
> afirmar**: bate no `/health` da api e do engine e só então diz que instalou —
> a régua que o `reset-total.sh` aprendeu na marra (BRB-033).

## O que esta fase NÃO toca

Declarado nos quatro ADRs, e repetido aqui porque é o que dá sentido ao resto:

- `decide.ts` e os tetos absolutos da política de permissões — nenhum ganha
  exceção, nem configurável
- `proposed_action` como origem de todo efeito externo de agente
- a imutabilidade do event log
- o portão da imagem nos três modos ([ADR 0135](../adr/0135-portao-de-imagem-nos-tres-modos.md))
- o espelho (RN-515/516/517) — o binding de pasta é outra coisa, com outra
  mensagem; não fundir
- as cinco camadas de contenção do broker ([ADR 0130](../adr/0130-broker-de-container.md))
- o `docker-compose.prod.yml`, que continua sendo o compose de **validação** das
  imagens

## Lacunas que a fase encosta e não resolve

- **O runner por máquina** — os cinco acoplamentos acima. Fica declarado como
  escopo da fase seguinte, com a medição já feita.
- **Credencial de git descartada no `docker exec` em modo `runner`** —
  [ADR 0130](../adr/0130-broker-de-container.md)/[0145](../adr/0145-docker-pre-requisito-do-runner.md).
  O clone inicial pela mensagem nova roda no **HOST**, pelo caminho que já
  carrega credencial, e portanto **não** é afetado; a lacuna continua onde
  estava.
- **A revogação alcança `{projeto, usuário}`, nunca `{chave}`** (RN-520). Com o
  pareamento por projeto preservado nesta fase, o custo não muda — mas quando a
  FASE 30 fizer o runner por máquina, revogar passará a derrubar **todos** os
  projetos daquela máquina. Custo declarado aqui para não ser descoberto lá.
- **O broker não é publicado** — `docker-bake.hcl` tem quatro alvos e
  `scripts/ci/images-manifest.ts` aceita quatro. Numa instalação por GHCR o
  profile `container-broker` é inalcançável, e o modo `mounted` sobe container
  **pelo broker** ([ADR 0144](../adr/0144-a-segunda-raiz-do-broker.md)).
  O ADR 0150 decide o que o instalador faz com isso.
- **BRB-017** (obrigação GPL das ferramentas embutidas na imagem do engine,
  **P1**) fica onde estava — e a fase o torna mais concreto, não menos: o
  instalador distribui essa imagem para máquinas de terceiros.
- **BRB-004** (imagens de terceiro por **digest**) é encostado: o instalador
  resolve as imagens PRÓPRIAS por digest, enquanto `neo4j`, `pgvector` e
  `ollama` seguem por tag. Ver [o registro de BRB](../reference/brb.md).
