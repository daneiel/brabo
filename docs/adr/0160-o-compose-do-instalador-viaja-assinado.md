# 0160 — O compose do instalador viaja com ele, como asset assinado

## Status

**Accepted.** Decidido pelo mantenedor em 2026-09-13 (AT-026). Estende o
[ADR 0149](0149-assinatura-dos-artefatos-publicados.md) — o `checksums.txt`
assinado passa a cobrir mais que binários — e fecha uma lacuna do
[ADR 0150](0150-instalador-de-uma-linha.md), que desenhou o instalador de uma
linha sem dizer como o compose de instalação chegaria à máquina de quem instala.
Nenhum dos dois é editado; este documento os referencia.

## Context

O E2E do instalador numa máquina limpa rodou pela primeira vez na sessão 8 da
FASE 30 ([RN-549](../business-rules.md#rn-549)) e respondeu **não** à pergunta
que existia para responder. O `install.sh` subia a pilha com
`docker compose -f docker/docker-compose.install.yml` — um caminho **relativo
ao diretório de onde rodava** — usado em sete pontos, incluindo o
`up -d --wait`. Esse arquivo:

- **não era asset da Release**;
- **não entrava no `checksums.txt` assinado**;
- **não era baixado em lugar nenhum** — as únicas descargas do script eram o
  `cosign`, o manifesto e sua assinatura, o `images.json` e o binário do runner.

E o compose bind-monta dois arquivos relativos a ele: `./postgres/init.sql`
(o `postgres`, que cria a extensão pgvector) e `./ollama/pull-models.sh` (o
`ollama-model-loader`, sob o profile `llm`). O passo de contorno do
`install-e2e.yml` trazia exatamente esses **três** da tag, por
`raw.githubusercontent.com`.

**O sintoma era tardio, e é o que o tornava caro.** Quem seguia o one-liner do
runbook numa pasta vazia morria em *"no such file or directory"* **depois** de o
script ter verificado a própria assinatura, detectado a máquina, perguntado a
base e **gravado o `.env` com os cinco segredos**. Metade de uma instalação, e
uma mensagem que não dizia o que fazer.

**Medido ao implementar: são quatro, não três.** O caminho de MIGRAÇÃO
(`migrar_instalacao_anterior`, [RN-530](../business-rules.md#rn-530)) roda
`bash docker/backup/test-restore-compose.sh` — outro caminho relativo, e um
script **executado** no host. O E2E nunca o alcançou porque numa máquina limpa
não há o que migrar, e por isso o contorno não o trazia. Numa pasta sem checkout
a migração morreria ali — antes de apagar qualquer coisa, por construção da
RN-530, mas morreria.

Nenhuma camada abaixo do E2E podia ver isso: cada peça funcionava e tinha a
própria suíte. O defeito estava **entre o artefato publicado e a máquina de
quem instala**, que é a fronteira que só o E2E atravessa — e ele só roda em
tag.

## Decision

**1. Os arquivos viram assets da Release e entram no MESMO `checksums.txt`
assinado.** Quatro, com nomes que não colidem:

| asset na Release | caminho no repositório e sob a pasta da instalação | por quê |
|---|---|---|
| `brabo-install-compose.yml` | `docker/docker-compose.install.yml` | o compose que sobe a instalação |
| `brabo-install-postgres-init.sql` | `docker/postgres/init.sql` | bind-montado pelo `postgres` |
| `brabo-install-ollama-pull-models.sh` | `docker/ollama/pull-models.sh` | bind-montado pelo `ollama-model-loader` |
| `brabo-install-backup-test-restore.sh` | `docker/backup/test-restore-compose.sh` | a prova de restauração da migração |

A Release é **plana** — um asset é um nome, sem pasta — e o manifesto é
indexado por nome. `init.sql` e `pull-models.sh` são genéricos o bastante para
colidir com o próximo asset que alguém anexar, e dois arquivos com o mesmo nome
seriam uma linha só, com a verificação de um passando contra o hash do outro.
Por isso o prefixo `brabo-install-`, que também não casa com o
`--pattern 'brabo-runner-*'` com que o job `checksums` baixa os binários.

A tabela mora em `scripts/ci/assets-do-instalador.ts` (quem PUBLICA) e no `case`
de `destino_do_asset_do_instalador` no `install.sh` (quem BAIXA). São duas
porque o instalador roda com bash 3.2 no macOS e sem Node; a divergência é
reprovada por `assets-do-instalador.spec.ts`, que lê o `case` do shell. O mesmo
spec DERIVA do compose todo bind-mount `./…` e reprova o que não estiver na
tabela — que é exatamente como o defeito nasceu: alguém acrescentou um mount e
ninguém perguntou como ele viajaria.

**2. Quem publica é o job `checksums` de `build-runner-binaries.yml`**, o mesmo
que já publica o `install.sh`: os arquivos vêm do **checkout da tag** (o mesmo
commit que produziu tudo o mais que se assina ali), são copiados sob o nome do
asset pelo script, entram no `sha256sum` que gera o manifesto e são anexados
junto. Nada muda na espera por assets da [RN-565](../business-rules.md#rn-565):
estes não vêm da matriz, então não há o que esperar por eles. O job passa a
conferir também **cada linha do manifesto contra o arquivo** (`sha256sum -c
--strict`) depois de verificar a assinatura e antes de anexar — a assinatura
prova quem escreveu o manifesto; a conferência prova que o que vai ser anexado é
o que ele diz.

**3. O `install.sh` baixa e verifica os quatro ANTES de perguntar ou gravar
qualquer coisa.** Logo depois de `verificar_a_si_mesmo`, e contra o MESMO
`checksums.txt` que aquela função já verificou (nunca um segundo download, pelo
motivo que ela escreve). A comparação é por igualdade exata de campo (`awk`),
não por padrão: o nome tem pontos. Três recusas **nomeadas e distintas**, porque
pedem ações diferentes — a Release não publica o asset (é anterior a este ADR, ou
saiu pela metade), o manifesto não o cobre, o hash não bate (incidente). Todas
dizem *"Nada foi gravado"*, e é verdade: até ali só se escreveu em diretório
temporário.

**4. Nunca cai no caminho relativo.** `COMPOSE_DE_INSTALACAO` deixa de ser a
constante `'docker/docker-compose.install.yml'` e nasce **vazia**; ela só ganha
valor — um caminho **absoluto** — quando `materializar_os_arquivos_da_instalacao`
copia as cópias verificadas para `<pasta de onde o script roda>/docker/`, a mesma
pasta do `.env`. Isso acontece no primeiro instante em que um arquivo é preciso
(a migração, ou a subida logo depois do `.env`), nunca antes: o caminho sem TTY
continua sem gravar nada. O que já estiver no destino é **substituído, nunca
lido** — numa atualização é o compose da versão anterior —, com `rm` antes de
copiar para que um symlink não leve a escrita a outro lugar. O layout sob a
pasta é o mesmo de antes de propósito: os bind-mounts relativos do compose
continuam resolvendo, o marcador continua registrando o compose e o comando que
o runbook dá ao operador não muda.

**5. O E2E inverte o que cobra.** O passo de contorno sai; no lugar entra a
asserção de que a pasta do job começa **sem** `docker/` (ele não tem checkout),
de que sem TTY o instalador verificou os arquivos e não gravou nenhum, e — num
passo próprio, depois da instalação, para o token não estar no ambiente do
instalador — de que os arquivos gravados são byte a byte os que o manifesto da
Release cobre. `install-e2e.spec.ts` deixa de cobrar "as duas metades" do
contorno e passa a cobrar que ele **não** volte.

## O que este ADR recusa explicitamente

- **Clonar o repositório na tag.** Seria um arquivo só a manter, sempre coerente
  com a tag — e trocaria a cadeia de assinatura por **confiança no transporte do
  `git`**, acrescentando uma dependência que a máquina limpa pode não ter. O que
  sobe a instalação passaria a ser a única coisa, entre o que o instalador usa,
  que não é verificada como o binário é.
- **Um tarball com os quatro.** Um arquivo a mais a extrair na máquina dos
  outros, e uma linha do manifesto que cobre quatro arquivos sem nomeá-los — a
  mesma razão pela qual o ADR 0149 preferiu um manifesto a cinco assinaturas,
  aplicada ao contrário.
- **Embutir os arquivos no `install.sh`** (heredoc). O compose tem centenas de
  linhas e muda com a topologia; o instalador passaria a mudar junto com cada
  serviço, e o `composes-em-conformidade.spec.ts` teria de ler shell.
- **Uma variável ou flag para apontar outra URL de Release**, para teste. É a
  forma mais curta de uma porta de pular verificação (ADR 0150). Os testes do
  shell passam a URL como ARGUMENTO da função, que é o que `main` também faz.
- **Rodar o `install-e2e.yml` em `pull_request`.** Continua fora, pelo motivo do
  ADR 0150.

## Consequences

- **Fechado no código, provado só na próxima tag final.** A esteira só publica
  numa tag e o E2E só roda depois dela; em PR roda a parte estática
  (`assets-do-instalador.spec.ts`, `install-e2e.spec.ts`) e a funcional do shell
  contra uma Release de mentira (`install-arquivos-da-instalacao.spec.ts`). Até a
  primeira tag depois deste merge, nenhuma Release publicada tem os assets.
- **Nenhuma ação do operador, e nenhuma instalação que funcionava deixa de
  funcionar.** O `install.sh` novo só chega a alguém dentro de uma Release, e é o
  MESMO passo do MESMO job que o anexa e anexa os quatro assets — então uma
  Release com o instalador novo e sem os arquivos só existe se esse passo falhar
  no meio, e aí o instalador recusa cedo, com *"a Release não publica …"*, em vez
  de morrer depois do `.env`. Rodar o `install.sh` novo de um checkout contra uma
  Release antiga já era recusado antes, pela verificação de origem
  ([RN-526](../business-rules.md#rn-526)): o hash dele não está no manifesto
  antigo. As Releases já publicadas continuam com o instalador antigo e o
  contorno de rodá-lo de dentro de um checkout na tag.
- **A Release cresce** em quatro assets (~29 KB) e o manifesto em quatro linhas,
  e os quatro arquivos passam a ser **versionados junto** com o instalador: mudar
  um deles muda o que a próxima tag assina. Mudar a TABELA exige mudar os dois
  lados, e o spec reprova se só um mudar.
- **Um checkout cuja pasta é a da instalação tem o `docker/` sobrescrito** pelas
  cópias da Release. Na tag que se instala elas são idênticas; fora dela, o
  `git status` fica sujo, e o script DIZ quais substituiu. É o preço de o layout
  não mudar, e só existe para quem instala de dentro de um checkout.
- **O proxy `GET /runner-releases/binary` não muda**: ele lê o manifesto como um
  mapa nome → hash ([RN-525](../business-rules.md#rn-525)), e linhas a mais não o
  afetam.
- **Adjacência medida e NÃO corrigida.** A prova de restauração da migração
  (`test-restore-compose.sh`) chama `docker compose -f <compose>` sem
  `--env-file`, e o Compose procura o `.env` na pasta do COMPOSE, não na de onde
  se roda (medido: `docker compose -f docker/c.yml config` com `.env` só no
  diretório corrente falha na interpolação). Como o compose mora em `docker/` e
  o `.env` na pasta acima, a variável `BRABO_BACKUP_IMAGE` não chega, e a prova
  tende a reprovar — desfecho SEGURO pela RN-530 (nada é apagado), mas a
  migração por compose não fecha. É defeito pré-existente do caminho de
  migração, que nenhum E2E exercita; fica declarado aqui para a frente que o
  exercitar.
