# 0162 — O broker vira a quinta imagem publicada, e o instalador PERGUNTA se o liga

## Status

**Accepted.** Decidido pelo mantenedor em 2026-09-18 (AT-097). Fecha a
decisão 7 do [ADR 0150](0150-instalador-de-uma-linha.md) (*"o broker não sobe
nesta fase, e a consequência é dita"*), estende o
[ADR 0119](0119-imagens-publicadas-no-ghcr-por-digest.md) de quatro para cinco
imagens e aplica à instalação o argumento que o
[ADR 0146](0146-base-consentida-no-bootstrap.md) (RN-512) aplicou ao compose de
desenvolvimento. O broker em si — as cinco camadas, as cinco operações, a spec
computada — é o do [ADR 0130](0130-broker-de-container.md), e nada nele muda.
Nenhum desses é editado; este documento os referencia.

**Irmão:** o [ADR 0161](0161-a-tela-so-oferece-o-modo-que-a-instalacao-executa.md)
entregou a metade da WEB da mesma decisão do mantenedor ("os dois") — a
criação de projeto só oferece o modo que a instalação executa — e declarou por
escrito que a metade do INSTALADOR parava porque a imagem não era publicada.
Este ADR é essa metade. Os dois se completam sem depender um do outro: aquele
impede a tela de oferecer o que a instalação não executa; este dá à instalação
um jeito de executar, com consentimento. Com o broker ligado, a instalação passa
a ter `BROKER_URL`, e é por ela que a tela do 0161 volta a oferecer os dois
modos.

## Context

Numa instalação real, projeto `container` ou `mounted` **nunca executa**. Quem
sobe o container desses dois modos é o broker
([ADR 0144](0144-a-segunda-raiz-do-broker.md) ramifica por DESTINO:
`container` e `mounted` → broker), e o compose de instalação não tem o serviço.
`BROKER_URL` fica indefinida, `container_start` termina em
`container.start_failed` com `BrokerIndisponivelError`, e os dev agents ficam em
`dev.blocked_by_container` para sempre — a RN-502 recusa, com razão, executar
fora de um container `running`.

A decisão 7 do ADR 0150 declarou isso e chamou a correção de **pequena**. Medido
em 2026-09-18, ao abrir esta frente:

- `docker manifest inspect ghcr.io/daneiel/brabo-broker:6.1.0` → `denied`; a
  mesma pergunta para `brabo-api:6.1.0` resolve. A imagem não existe no registry.
- `docker-bake.hcl` tinha quatro alvos (`api`, `engine`, `web`, `backup`), e
  `scripts/ci/images-manifest.ts` aceitava exatamente os quatro.
- `docker/broker/Dockerfile.prod` **já existia**, e já passava pelo `hadolint`
  do `ci.yml` junto com os outros quatro — `FROM` por digest com a tag na linha
  de cima, `USER node`, `HEALTHCHECK` contra `/health`, npm/corepack removidos.
  O que faltava não era a imagem: era alguém construí-la, escaneá-la e
  publicá-la. O `ci.yml` nunca a construía; o `docker-compose.prod.yml` a
  referenciava como `brabo-broker:prod`, que só existia na máquina de quem
  rodasse `docker compose build` com o profile.
- A Release não traz o código, então `--source=local` — o caminho que o ADR 0150
  apontava como saída — exige um checkout em tag, que não é a instalação de uma
  linha.

## Decision

### 1. O broker é a QUINTA imagem publicada, com os mesmos gates das outras

Alvo `broker` no `docker-bake.hcl`, dentro do grupo `default`: o `ci.yml` passa
a construí-lo a cada PR, a conferir que ele não roda como root, a escaneá-lo no
Trivy com as mesmas regras (`HIGH,CRITICAL`, `--ignore-unfixed`) e a provar que
ele SOBE healthy com rootfs read-only. O `release.yml` o publica por DIGEST, o
`images-manifest.ts` o exige (alvo faltando continua reprovando — cinco de cinco
ou nenhum), e a assinatura `cosign` keyless e a verificação no mesmo run
([RN-524](../business-rules.md#rn-524)) o cobrem sem linha nova, porque os dois
laços leem o manifesto.

O **Kubernetes não o conhece**, e isto é decisão, não esquecimento: não há
Deployment de broker em `deploy/k8s/`, e montar o socket de um nó num pod é
outra conversa de privilégio. `argumentosDeSetImage` passa a emitir só as
imagens que a base do kustomize declara — `make imagens-do-release` segue
escrevendo quatro linhas no overlay.

### 2. O compose de instalação ganha o serviço, DESLIGADO por padrão

O serviço entra sob `profiles: ["container-broker"]`, o MESMO profile do
compose de validação, e com as cinco camadas do ADR 0130 intactas: sem
`ports:`, só na rede `broker` (`internal: true`, que só a api alcança e que não
tem egress), `BRABO_SERVICE_TOKEN` obrigatório em produção, cinco operações,
spec computada a partir do que a api diz. O socket é montado nele e em nenhum
outro. `api` passa a participar da rede `broker` sempre — como já faz no compose
de validação —, e `BROKER_URL` na api continua vazia a menos que o `.env` diga
outra coisa.

A imagem vem de `BRABO_BROKER_IMAGE`, **obrigatória** como as outras quatro, e
isto foi medido e não escolhido: o Compose interpola o arquivo INTEIRO antes de
filtrar por profile, então um `${VAR:?…}` num serviço desligado recusa o arquivo
do mesmo jeito. O instalador sempre a grava (ela vem do mesmo manifesto), ligue
o broker ou não.

As duas raízes vão como no compose de validação: `BRABO_PROJECTS_HOST_BASE`
deriva de `BRABO_PROJECTS_BASE`, que já é caminho de host. A outra,
`PROJECT_WORKSPACES_HOST_ROOT`, não tem como derivar no compose — a pasta
gerenciada da instalação é o volume NOMEADO `project_workspaces`, e o caminho
que o daemon resolve é o do HOST. O instalador a CALCULA
(`<DockerRootDir>/volumes/brabo_project_workspaces/_data`, o layout do driver
`local`) e, depois da subida, a CONFERE contra o `Mountpoint` que o daemon
devolve para o volume; divergir vira pendência nomeada com o valor certo, nunca
um valor adivinhado em silêncio.

### 3. O instalador PERGUNTA, com o risco dito em texto, e o default é NÃO

Uma pergunta nova, depois da base e antes do `.env`. Ela diz o que ligar
concede — um serviço desta instalação passa a falar com o Docker desta máquina,
e quem comanda aquele serviço comanda o Docker —, o que as camadas contêm, e o
que muda sem ele (projeto `container` e `mounted` não executam; o modo Runner
não depende dele). Só `s`/`sim` liga. Enter, qualquer outra coisa ou a falta de
terminal deixam desligado, e o script DIZ que ficou desligado.

Sim grava no `.env` `COMPOSE_PROFILES=container-broker`,
`BROKER_URL=http://broker:8090`, o `DOCKER_GID` e a raiz calculada. O
`DOCKER_GID` é medido **de dentro de um container**, com a própria imagem do
broker e o socket montado por `--mount type=bind` (que recusa em vez de criar a
pasta quando a origem não existe), porque é o gid que o processo vê ali que o
`group_add` precisa — e no Docker Desktop o gid do socket no host não diz nada
sobre o de dentro da VM. Não conseguir medir, ou o caminho não ser um socket, é
recusa NOMEADA que ensina a rodar de novo e responder não; nunca um 999
adivinhado.

A decisão aparece no resumo final, e a frase de *"o que este instalador NÃO
faz"* deixa de dizer que só "Pasta montada" fica sem container: `container`
também fica.

### 4. Por que o argumento da RN-512 vale aqui

O ADR 0146 separou os dois composes pelo que o socket SIGNIFICA: em
desenvolvimento quem sobe a stack já tem o socket, então o broker recebê-lo não
concede nada que o operador não possua; em produção o socket é fronteira de
privilégio e o operador não é o desenvolvedor.

A instalação de uma linha é o primeiro caso, não o segundo. Ela roda **na
máquina da própria pessoa**, que acabou de rodar `docker compose up` — o
instalador não funciona sem que ela tenha o socket. Operador e usuário são a
mesma pessoa. O que a instalação NÃO pode assumir, e é por isso que ela
pergunta em vez de ligar como o compose de desenvolvimento, é que quem instala
sabe o que o socket é: o compose de dev é lido por quem desenvolve o produto; o
instalador é rodado por quem nunca abriu este repositório. Consentimento
explícito é a diferença que resta, e é a que este ADR compra.

O `docker-compose.prod.yml` não muda: segue sob profile, e para ele a leitura
do ADR 0146 continua valendo sem ressalva.

## Consequences

**O preço, declarado.**

- **Uma imagem root-equivalente passa a ser pública.** Qualquer um pode puxar
  `ghcr.io/daneiel/brabo-broker`. A imagem em si não concede nada — é o socket
  montado que concede —, mas ela passa a ser um alvo estudável, e uma
  vulnerabilidade nela vira, em toda instalação que o ligou, um caminho até o
  Docker do host. É por isso que ela entra no Trivy de cada PR e na assinatura
  de cada tag, e não numa lista à parte.
- **O socket do Docker passa a ser montado num serviço de uma instalação de
  usuário**, quando ela consente. Quem comanda o broker comanda o Docker da
  máquina. O que o separa do resto: não publica porta, só a api o alcança, o
  token é comparado em tempo constante, e não existe campo onde se escreva
  `privileged`, `cap_add`, `network: host` ou um `-v` livre. Isso contém o
  chamador; não contém um bug no próprio broker.
- **`BRABO_BROKER_IMAGE` vira obrigatória** no `.env` da instalação, ligado ou
  não. Um `.env` gravado por um instalador anterior não a tem — mas o instalador
  regrava o `.env` a cada execução, e a atualização passa por ele.
- **O instalador exige `broker` no `images.json`.** Uma Release anterior a esta
  não o tem, e o instalador desta versão recusa nomeando o alvo. É a mesma
  regra do ADR 0160: o instalador de uma tag instala aquela tag.
- **A raiz gerenciada depende do layout do driver `local`.** Calculada antes da
  subida, conferida depois; o que não confere vira pendência com o valor lido
  do daemon.
- **Não medido:** o `DOCKER_GID` e a raiz calculada no Docker Desktop do macOS.
  O E2E da tag roda a metade interativa só no Linux.

**O que NÃO muda.** O compose de validação, o `smoke.sh` (que sobe sem profile
e continua provando as mesmas três imagens de app), o compose de
desenvolvimento, o Kubernetes, e o broker em si.
