# 0150 — O instalador de uma linha, com fonte escolhida e marcador

## Status

**Proposed.** Depende do [ADR 0149](0149-assinatura-dos-artefatos-publicados.md):
sem assinatura, este documento propõe exatamente o que a FASE 28 recusou.

## Context

Instalar o Brabo hoje exige um checkout, cinco segredos exportados à mão e
conhecimento que não está em lugar nenhum — os três gestos que
[o documento da fase](../explanation/fase-29-instalacao-de-uma-linha.md)
descreve. Três fatos do disco restringem qualquer desenho de instalador:

**O compose de produção não é um manifesto de instalação.** Todos os serviços
de `docker/docker-compose.prod.yml` apontam para `brabo-*:prod` **com bloco
`build:` local** (`:102-105`, `:144-147`, `:253-256`, `:381-384`); não há uma
única referência a `ghcr.io` em `docker/`. O cabeçalho do arquivo diz de si
mesmo, em `:1` e `:8`, que é o *"compose de VALIDAÇÃO das imagens de
produção"* e que *"o que este arquivo NÃO é: um manifesto de produção
endurecido"*. O único consumidor de `.release/images.json` no repositório é
`scripts/ci/aplicar-imagens.ts`, que escreve em **overlay do kustomize**
(`Makefile:35-36`).

**Já existe um molde de consentimento, e ele é rígido no ponto certo.**
`scripts/dev/consentir-base.mjs:195-208`: sem TTY, o script **relata e retorna
0** — não consente, não grava, não cria pasta. E a ordem dele é lei:
`validarBase` roda **antes** de qualquer `mkdir` (`:228-242`), a gravação no
`.env` é o **último** passo (`:272`), e uma prova que falha recusa sem gravar
(`:246-258`).

**Os cinco segredos já são gerados em algum lugar.** `docker/smoke.sh:31-57`
gera os cinco com `openssl rand`, respeitando valor já exportado
(`${VAR:-$(gerar)}`), inclusive o detalhe de `NEO4J_PASSWORD` precisar ser
`-hex` porque `/` quebra o parse de `NEO4J_AUTH` (`:53-56`). Não é preciso
inventar essa parte, só torná-la persistente.

## Decision

### 1. A invocação preserva o stdin

```sh
sh -c "$(curl -fsSL https://github.com/daneiel/brabo/releases/latest/download/install.sh)"
```

E **não** `curl … | sh`. O motivo é mecânico, não estético: com o script
chegando pelo pipe, o `stdin` do processo **é o download**, e um `read` para
perguntar qualquer coisa lê bytes do próprio script ou encontra EOF. Um
instalador que não pode perguntar teria de escolher sozinho onde criar pastas
no computador de alguém — e a régua do repositório é a oposta
(`consentir-base.mjs:195-208`).

Sem TTY o instalador **relata e sai**, no mesmo formato do molde: imprime o que
faria, o que encontrou, e o comando para rodar num terminal.

### 2. O script verifica a própria origem antes de agir

O `install.sh` é **versionado no repositório** e publicado como asset da
Release. Ele carrega a própria versão e, como primeiro ato, baixa o
`checksums.txt` assinado daquela Release, verifica a assinatura (ADR 0149) e
confere **o próprio hash** contra ela. Divergiu, para.

Isso estende — não cita como já dito — o ponto 5 do
[ADR 0146](0146-base-consentida-no-bootstrap.md):195-212, que versiona
`consentir-base.mjs` com o argumento de que *"um script que configura o host do
usuário, cria pasta e escreve no `.env` é precisamente o artefato cuja
procedência precisa ser auditável"*, e cujo corolário é que **a api não ganha
rota que emita script de host**. O `install.sh` é o mesmo tipo de artefato, com
mais alcance; o corolário vale igual.

### 3. Detecção nomeia o que encontrou, e só então pergunta

O **marcador** mora em `$XDG_STATE_HOME/brabo/install-state.json`, com fallback
`~/.local/state/brabo/` — o mesmo idioma que `servico.ts:250-261` já usa para
`XDG_CONFIG_HOME`. Não em `~/.brabo/`, que é onde o runner guarda coisa **por
projeto**: estado de instalação e configuração de projeto são vidas diferentes,
e juntá-las faria a deleção de um apagar o outro.

O marcador é **versionado** (`schemaVersion`) e guarda: versão instalada, fonte
(`ghcr` ou `local`), digests aplicados, caminhos (`.env`, base de projetos,
diretório do compose) e a data. É ele que torna a segunda execução um **diff** e
não uma adivinhação.

Sem marcador — toda instalação anterior a esta versão — o script procura
**sinais**: projeto de compose com serviços `brabo-*`, units
`brabo-runner-*.service`, um `.env` com as cinco chaves. E **nomeia o que
achou** antes de qualquer pergunta. Não existe o caminho "achei algo, decido
sozinho".

### 4. Deleção diz o que apaga, e o que nunca apaga

| apaga (com confirmação, listado antes) | **nunca** apaga |
|---|---|
| volumes nomeados do compose, `pgdata` inclusive | a **base de projetos** do usuário |
| o `.env` gerado | a **pasta de espelho** (RN-516: o espelho nunca apaga, e o instalador tampouco) |
| units de serviço do runner | qualquer pasta fora dos caminhos do marcador |
| a chave de dispositivo em disco | o que a chave protege no servidor — revogar é outra ação |

A segunda coluna é o ponto. Pasta de usuário é acúmulo, não estado do produto;
apagá-la seria o instalador tomando uma decisão que ninguém lhe delegou.

### 5. Duas fontes de imagem, e "oficial" é resultado de verificação

- **`--source=ghcr`** (padrão): lê `.release/images.json` da Release, resolve
  cada imagem **por digest** e verifica a assinatura (ADR 0149).
- **`--source=local`**: `docker buildx bake` com `docker-bake.hcl:81-83`, que
  produz exatamente os quatro nomes que o compose espera. Exige **working tree
  limpa e em tag**; senão **recusa**, porque uma imagem construída de uma
  árvore suja não é a versão que ela diz ser.

A palavra "oficial" só aparece na saída quando a verificação **passou**. Trocar
de fonte depois é troca de imagem sobre os mesmos volumes — o dado não se move.

### 6. Um compose próprio da instalação

Nasce `docker/docker-compose.install.yml`, que consome os **digests** de
`.release/images.json` e não tem bloco `build:`. O
`docker-compose.prod.yml` fica **intacto**: ele é o compose de validação, é o
que `docker/smoke.sh` usa (`:19-20`, construindo local de propósito), e
promovê-lo a manifesto de instalação quebraria o uso que ele já tem e
contrariaria o próprio cabeçalho.

O custo é declarado: dois arquivos com a mesma topologia de serviços. O que os
separa é o que cada um responde — *"esta tag constrói?"* contra *"esta máquina
roda o que foi publicado?"*.

### 7. O broker não sobe nesta fase, e a consequência é dita

`docker-bake.hcl:81-83` tem **quatro** alvos e `scripts/ci/images-manifest.ts:54`
aceita quatro; `brabo-broker:prod` (`docker-compose.prod.yml:333`) só existe
construído localmente, e por isso o profile `container-broker` é **inalcançável
a partir de artefatos de Release**.

O instalador **não** oferece o profile, e **diz** o que isso significa: com
`--source=ghcr`, projeto em modo `mounted` — que o
[ADR 0146](0146-base-consentida-no-bootstrap.md) tornou o padrão local — não
sobe container, porque quem o sobe é o broker
([ADR 0144](0144-a-segunda-raiz-do-broker.md)). A conversa e o backlog
funcionam; a execução de dev agent naquele modo, não.

Publicar o broker como quinta imagem é a correção, e ela é **pequena** (um alvo
no bake, um id em `images-manifest.ts`, uma assinatura a mais). Fica fora deste
ADR por escopo, não por dúvida: entra como item próprio, e enquanto não entrar,
`--source=local` é o caminho que dá `mounted` completo.

### 8. Windows é recusa nomeada

Como já é na RN-518 (`servico.ts:517-532`): o instalador nomeia a plataforma,
diz que está fora de escopo por decisão declarada e aponta o caminho de
primeiro plano. Não é uma falha genérica nem um silêncio.

### 9. Bash puro, com a decisão testável

O `install.sh` é **bash**, porque precisa rodar antes de qualquer dependência
existir na máquina. A lógica de decisão (detectar, comparar marcador, escolher
fonte, montar o plano de deleção) fica em funções puras, e o script expõe
`--print-plan` / `--print-state` para que um spec em vitest as exercite sem
executar nada — o precedente é real e do mesmo repositório:
`scripts/dev/bootstrap.sh` tem `--print-commands` e é testado por
`scripts/dev/bootstrap.spec.ts`.

### 10. A verificação pós-subida é própria, e o `smoke.sh` não é reusado

`docker/smoke.sh` gera os cinco segredos (`:31-57`) e é o precedente da
decisão 5 — mas **chamá-lo não serve**: ele sobe com `--build` (constrói o que
esta instalação acabou de baixar por digest) e derruba a stack no fim, a menos
que `SMOKE_KEEP_UP=1`. É um teste de CI, e uma instalação não é um teste.

O instalador faz o mínimo honesto no lugar: depois do `up --wait`, bate no
`/health` da api e do engine, e **só então** diz que instalou. `--wait` já
espera o healthcheck — mas quem anuncia um estado tem de tê-lo perguntado, que
é exatamente a lição que o `reset-total.sh` custou (ele anunciava "reset
completo" com a api em `Exited (1)`).

Pelo mesmo raciocínio **não existe passo de migrate**: o compose encadeia
`api` → `migrate-api` com `service_completed_successfully`, e um segundo lugar
mandando migrar seria a segunda fonte da mesma verdade.

## O que este ADR recusa explicitamente

- **`curl | sh`.** Pela decisão 1: fecha o stdin e com ele o consentimento.
- **Promover o `docker-compose.prod.yml` a manifesto de instalação.** Quebra o
  `smoke.sh`, que constrói local de propósito, e contradiz o cabeçalho do
  arquivo.
- **Uma rota da api que gere o script.** Corolário explícito do ADR 0146 ponto
  5, e continua valendo com mais força aqui.
- **Migração adivinhada.** Instalação anterior sem marcador não é
  "provavelmente igual": ela é nomeada, e o caminho é o do
  [ADR 0152](0152-backup-de-volumes-contra-compose.md).
- **Apagar qualquer coisa fora dos caminhos do marcador.**

## Consequences

- Instalar deixa de exigir checkout, e os cinco segredos passam a ser gerados
  uma vez e persistidos com modo `600` — hoje o `smoke.sh` os gera e descarta
  com o stack.
- **Dois composes** com a mesma topologia, e a divergência entre eles vira algo
  a vigiar. O teto: o de instalação não ganha serviço que o de validação não
  tenha.
- Com `--source=ghcr`, `mounted` fica sem container até o broker ser publicado
  (decisão 7). Declarado na saída do instalador, não descoberto depois.
- A segunda execução do instalador passa a ser um diff legível. A primeira
  execução **em uma máquina que já tinha Brabo** continua sendo o caso difícil,
  e é o único que depende de outro ADR.
