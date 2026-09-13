# `@brabo/runner`

CLI que roda **na máquina do próprio usuário**, conectada ao engine por um
canal Phoenix autenticado por ticket de uso único (ADR 0102/0103). Ela
existe para projetos no modo `runner` (ADR 0104): a pasta do código
continua na máquina do usuário, sem bind-mount nenhum. Rodando com os
privilégios de quem a executa, ela:

- executa comandos de agente já **aprovados** pelo pipeline de
  `proposed_action` (`exec`), confirmando o caminho de verdade da pasta;
- oferece um terminal interativo de verdade (PTY) para a aba **Terminal**
  da web;
- faz a navegação de pasta local (`fs_list_dir`/`fs_home_dir`) que alimenta
  o seletor de pasta ("Procurar pasta...") da criação/adoção de projeto.

Não decide política nenhuma: só faz o que o produto já aprovou. Ver os
docblocks de `src/channel.ts`, `src/exec.ts`, `src/pty.ts`, `src/guard.ts` e
`src/fs-browser.ts` para o desenho de cada parte. A porta de Docker — o
alicerce da execução em container (ADR 0128) — mora no pacote
`@brabo/docker-port` desde que ela ganhou um segundo consumidor do lado
servidor (ADR 0130); daqui, **nada a chama ainda**: nenhuma mensagem do canal a
alcança e nenhum container sobe na sua máquina. O docblock dos dois arquivos
daquele pacote explica a porta de cinco operações e a prova de empacotamento
que escolheu a implementação. Ver também a
[ADR 0107](https://github.com/daneiel/brabo/blob/main/docs/adr/0107-navegacao-de-pasta-local-via-o-runner.md)
para o argumento de segurança da navegação de pasta.

## Modo automático (recomendado)

Na tela do projeto (modo `runner`), use o botão **"Configurar pasta
automaticamente"**: o navegador baixa, numa pasta escolhida por você, três
arquivos já configurados — o binário (`brabo-runner`/`brabo-runner.exe`),
`brabo-runner.config.json` (projeto + URL da api) e uma chave de dispositivo
(`brabo-runner-device-key.jwk.json`). Com os três na mesma pasta, basta:

```sh
# Linux/macOS
chmod +x ./brabo-runner && ./brabo-runner
```

```powershell
# Windows
.\brabo-runner.exe
```

Sem digitar id de projeto nem token — o CLI lê o config e a chave de
dispositivo da própria pasta de onde ele é executado (duplo-clique no
Windows Explorer já herda o `cwd` da pasta). `--project`, `--dir` e
`--token` continuam existindo para os fluxos abaixo, e uma flag explícita
sempre vence o arquivo local quando os dois aparecem.

## Instalação

### Via npm (requer Node.js ≥ 22.6)

```sh
npm install -g @brabo/runner
```

### Binário standalone (sem Node/npm)

Baixe o executável da sua plataforma direto de uma
[GitHub Release](https://github.com/daneiel/brabo/releases) — não precisa
de Node, npm nem toolchain de compilação instalados:

| Plataforma | Arquivo |
|---|---|
| Linux x64 | `brabo-runner-linux-x64` |
| Linux ARM64 | `brabo-runner-linux-arm64` |
| macOS Intel | `brabo-runner-darwin-x64` |
| macOS Apple Silicon | `brabo-runner-darwin-arm64` |
| Windows x64 | `brabo-runner-win32-x64.exe` |

```sh
# Linux/macOS
chmod +x ./brabo-runner-<plataforma>
./brabo-runner-<plataforma> --project <projectId> --dir <caminho-absoluto> --token brb_...
```

O binário é um único arquivo — o addon nativo (`node-pty`, usado só pelo
terminal interativo da aba Code) já vem embutido dentro dele (ADR 0112),
extraído para um diretório temporário na primeira execução. Não é
assinado/notarizado ainda (macOS Gatekeeper e o SmartScreen do Windows vão
avisar no primeiro uso) — item de backlog declarado no ADR 0112, exige o
dono do produto obter/custear uma identidade de assinatura de código.

## Uso

```sh
brabo-runner --project <projectId> --dir <caminho-absoluto> --token brb_... [--api-url <url>]
```

Todas as flags abaixo são opcionais quando a pasta atual tem
`brabo-runner.config.json`/`brabo-runner-device-key.jwk.json` (modo
automático, acima) — uma flag informada explicitamente sempre vence o valor
do arquivo local.

- `--project`: o id do projeto no Brabo, com `execution_mode` = `runner`.
  Só **um** runner por projeto no cluster inteiro
  (`Engine.Runners.Registry`) — um segundo `brabo-runner` para o mesmo
  projeto é recusado no join. Omitido, o CLI só continua como **agente de
  máquina** (abaixo), que exige chave de máquina e base consentida — caso
  contrário ele imprime o uso dizendo o que faltou.
- `--dir`: a pasta absoluta onde o código do projeto vive nesta máquina —
  raiz para os comandos (`exec`) e o terminal (PTY). Omitida, a raiz é a
  própria pasta de onde o comando roda (`cwd`). Se a pasta ainda não
  existir, ela é **criada automaticamente** (`mkdir -p`); se `--dir` apontar
  para um arquivo já existente, é erro — este CLI nunca sobrescreve um
  arquivo (RN-435, ADR 0104). A navegação de pasta
  (`fs_list_dir`/`fs_home_dir`) **não** é restrita a esta pasta — ela
  navega livre pela máquina, de propósito (ver `src/fs-browser.ts`). No
  **Linux**, `--dir` só é aceito dentro do `$HOME` do usuário (o próprio
  home ou uma subpasta dele) — fora do Linux essa restrição não vale
  (RN-434, ADR 0104); a checagem do `$HOME` roda ANTES da criação
  automática, então uma pasta fora do home no Linux continua recusada
  mesmo quando ainda não existe.
- `--token`: um Personal Access Token (`brb_…`), gerado em **Configurações do
  projeto → Tokens de acesso**. Também pode vir pela variável de ambiente
  `BRABO_ACCOUNT_TOKEN` — nunca é gravado em disco por este CLI. Sem
  `--token`/`BRABO_ACCOUNT_TOKEN`, a chave de dispositivo local do modo
  automático é usada para autenticar (JWT EdDSA de vida curta, assinado a
  cada tentativa de conexão).
- `--api-url`: ordem de prioridade: flag explícita → `BRABO_API_URL` →
  `apiUrl` do `brabo-runner.config.json` local → `http://localhost:3000`.
- `--base`: a **base de projetos** desta máquina — a pasta sob a qual cada
  projeto é uma **subpasta** (ADR 0151, RN-529). Omitida, é lida de
  `$XDG_CONFIG_HOME/brabo/runner.json` (senão
  `~/.config/brabo/runner.json`), que é onde o instalador a grava; a flag
  explícita vence o arquivo. **Sem flag e sem arquivo o runner roda sem
  base, exatamente como sempre.**

### A base e `--dir` são coisas diferentes, e uma não invalida a outra

`--dir` é a raiz **deste** projeto; a base é onde uma pasta de projeto
**nova** nasce. Um projeto cuja pasta está fora da base continua
perfeitamente válido — a base é regra de **criação**, e a validação de
`--dir` (RN-434/RN-435) não a consulta. É a mesma proibição que a api já
declara por escrito em `project-workspaces-root.ts` para
`BRABO_PROJECTS_BASE` (RN-500/RN-501).

A base é **local** e nunca chega pela rede: quem tem a raiz é quem executa,
e o que o servidor manda é o **segmento relativo** (o invariante do ADR
0130/0144). O que a base recusa, com motivo nomeado: caminho relativo, com
`..`, `/`, um arquivo já existente, fora do `$HOME` no Linux (a mesma regra
de `--dir`), e a base que está **dentro** da pasta deste projeto ou é igual
a ela — nesse caso todo projeto novo nasceria dentro deste. O sentido
contrário (a pasta do projeto dentro da base) é o arranjo normal.

Recusa vinda da **flag** encerra o processo com código 2; recusa vinda do
**arquivo** é dita em `stderr`, nomeia o que se perde, e o runner segue sem
base — derrubar um agente que atende um projeto por causa de uma
configuração que ele ainda não usa seria desproporcional. Um arquivo que
existe e não declara `base` é ausência, não recusa.

Isto é **best-effort**, como `guard.ts` e `espelho-guard.ts`: a fronteira de
segurança continua sendo autenticação + pipeline de aprovação + o
consentimento de quem rodou o CLI.

### O que a base HABILITA: `workspace_create` (RN-532)

Com base consentida, este runner declara no `join` uma quarta capacidade —
`workspace` — e passa a atender a mensagem `workspace_create` (ADR 0151
pontos 3 a 6). O servidor manda o `projectId` e o **segmento relativo** à
base (nunca um caminho absoluto); o runner faz `mkdir -p` e então
`git init` — ou clona, quando o pedido traz uma URL de repositório, caso em
que a credencial viaja em `env` e o clone roda no **HOST**, pelo mesmo
mecanismo do `exec` (ADR 0145).

Tendo dado certo, ele empurra o `workspace_confirm` que já existia — e é
esse, e só esse, que GRAVA. Nenhuma rota nova de gravação nasceu, e o único
caminho que carimba `workspace_verified_at` continua sendo um só. O
`workspace_create_result` só destrava quem pediu: sucesso com o caminho
final, ou erro **nomeado** (`sem-base`, `segmento`, `nao-e-pasta`, `mkdir`,
`git`).

Duas coisas que valem registrar. A capacidade `workspace` é a única cuja
declaração depende do **estado desta execução** e não da versão do binário —
sem base não há onde criar pasta, e declará-la mesmo assim seria o defeito
silencioso que a negociação existe para impedir. E `estado.dir` **não muda**:
a pasta criada é a do projeto do ponto de vista do servidor, mas a raiz que
`guard.ts` usa para conter comando aprovado continua sendo a desta execução —
trocá-la em runtime moveria uma fronteira de contenção por causa de uma
mensagem de rede.

### A credencial de git NÃO entra no container, e a recusa diz isso (RN-558)

Quando este runner subiu o container do projeto (`container_start`, ADR 0137),
ele passa a rotear **todo** comando para dentro dele por `docker exec` — e a
porta de Docker do produto **não tem campo de `env`**, de propósito (ADR 0130:
sem `-e` livre nenhum). A credencial de git (ADR 0056) só existe no ambiente do
processo filho do caminho **HOST**.

Até a RN-558 o comando rodava assim mesmo, com o helper de credencial instalado
e as variáveis **vazias**: o `git fetch` saía com falha de autenticação, e quem
investigava caçava token, permissão ou rede. E esse é o caminho **comum**, não
uma borda — o container `running` que o servidor exige antes de qualquer
operação de git (RN-507) só existe porque **este mesmo runner** o subiu.

Agora o runner **recusa** esse par antes de executar qualquer coisa, com uma
saída que diz o que aconteceu, por quê, e que **nada** foi executado. A recusa
nunca cita nome nem valor das variáveis — só quantas eram.

**O que isso significa na prática:** clonar ou atualizar um repositório
**remoto autenticado** em modo runner só funciona com o container **parado**.
Repositório local (sem credencial) não é afetado, nem `workspace_create`, que
roda no host. Entregar a credencial ao `docker exec` mexeria na porta de
contenção e é decisão à parte — a metade aberta está declarada na RN-558.

### Agente de MÁQUINA: sem `--project`, uma conexão por projeto (RN-544)

Com uma **chave de dispositivo de máquina** (ADR 0154, RN-543) e uma **base
consentida**, o `brabo-runner` roda sem `--project`: ele consulta
`GET /runner/projects` e abre **uma conexão por projeto** que a rota listar,
cada uma na pasta `<base>/<workspaceDirName>`.

```sh
# a base vem do instalador (~/.config/brabo/runner.json) ou de --base
brabo-runner --api-url https://brabo.exemplo
```

O modo com `--project` **não mudou em nada** — ele continua sendo o caminho de
quem usa o fluxo do navegador (ADR 0118) ou flags explícitas, com uma conexão
só. As **duas** condições do modo novo são obrigatórias e por motivos
diferentes: a credencial de máquina é o que a rota aceita, e a base é de onde a
pasta de cada projeto é derivada. Sem base, rodar sem `--project` cai no bloco
de uso dizendo exatamente isso.

Este CLI **não sabe** de que espécie é a própria chave: em disco, a de máquina
e a de projeto são o mesmo arquivo (uma JWK com `kid`). Quem sabe é o servidor,
e uma credencial presa a projeto é recusada com 403 e uma mensagem própria, que
o CLI repassa nomeando o conserto (`--project`).

O que muda no comportamento, e vale saber antes de operar:

- **Com pelo menos uma conexão viva, a lista é consultada só no start.**
  Projeto criado depois disso entra quando o agente reconectar — repesquisar
  periodicamente faria uma lista que volta menor (projeto apagado? convertido?
  500 transitório?) derrubar conexão viva por ambiguidade.
- **Lista vazia é normal, e o agente FICA DE PÉ esperando** (RN-550): é o
  estado de toda instalação nova, e com **zero** conexões não há nada a
  derrubar nem ambiguidade a resolver — qualquer projeto que apareça é ganho
  puro. Ele reconsulta a cada **15s, 30s e depois 60s** (o último se repete
  para sempre) e **para de reconsultar** assim que a primeira lista não-vazia
  chega. Esperar não tem teto; **dez falhas seguidas** da consulta, sim: aí o
  processo sai com 1 nomeando o número. Uma consulta que responde — inclusive
  vazio — zera esse contador. A cada 30 consultas sem projeto ele imprime um
  batimento dizendo quantas foram, para "esperando" não se parecer com
  "travado" no `journalctl`.
- **Lista não-vazia com todos os projetos recusados continua saindo com 1.** É
  a exceção declarada da regra acima: ali cada recusa nomeia um defeito local
  com conserto próprio, e reconsultar repetiria as mesmas linhas para sempre.
- **O teto de tentativas e a recusa de join são POR PROJETO.** Um projeto
  recusado (segundo runner no mesmo projeto, ticket inválido) ou que esgotou as
  tentativas encerra sozinho, **nomeado**, e os demais seguem. Só quando nenhum
  sobra o processo sai com 1, listando o desfecho de cada um.
- **Todo log do laço é prefixado pelo nome do projeto** — com N laços
  intercalados, "falha na conexão" sem dono não diz nada.
- `--api-url` no modo de máquina vem da flag, de `BRABO_API_URL` ou do default:
  o `brabo-runner.config.json` é **por projeto** e não participa.

O espelho (RN-516) e o `workspace_create` (RN-532) continuam idênticos: os dois
são por projeto e viajam na concessão do `join` **daquela** conexão — é isso que
já os torna corretos com N. Desde a RN-545, `service install --machine` põe este
processo de pé como serviço de usuário — ver *Serviço de usuário*, abaixo.

### Rodando direto do checkout do monorepo (sem instalar via npm)

```bash
git clone <o repositório do Brabo>
cd brabo
pnpm install
pnpm --filter runner start -- --project <projectId> --dir <pasta-absoluta> --token brb_...
```

Requer **Node.js 22.6 ou mais recente** (o *type stripping* nativo de `.ts`
que este caminho usa só existe a partir daí).

## Chave de dispositivo pelo terminal (`device-key create | finish`)

O par Ed25519 pode nascer **nesta máquina**, sem passar pelo navegador (ADR
0155 ponto 4, RN-551) — é como o instalador pareia o agente numa instalação
nova. A metade privada **nunca viaja**.

```sh
# 1) gera o par aqui e imprime a JWK PÚBLICA (uma linha, no stdout)
PUB=$(brabo-runner device-key create)

# 2) registre essa pública na api — quem faz isso é quem tem a credencial
#    para registrar (o instalador, com o service token), nunca este CLI
ID=$(… POST {"name": "…", "publicKeyJwk": '"$PUB"'} … | jq -r .id)

# 3) carimba o `kid` (que É o id do registro) e grava a chave de verdade
brabo-runner device-key finish --id "$ID"
```

- **São dois passos por causa do `kid`.** Ele é o id do registro **no
  servidor** (RN-475) — o único vínculo entre o arquivo em disco e a chave
  pública que a api guarda —, e só existe depois do registro. Uma privada
  gravada antes dele nasce inútil, e o CLI a recusa sempre. Por isso o `create`
  grava em `brabo-runner-device-key.jwk.json.parcial`, um nome que o runner
  **não** procura: o arquivo que ele lê ou está completo ou não existe.
- **Onde:** `$XDG_CONFIG_HOME/brabo/` (senão `~/.config/brabo/`), ao lado do
  `runner.json` — é a chave da **máquina**, e ela não tem pasta de projeto onde
  morar. `--dir <pasta>` aponta para outro destino (por exemplo, a pasta de um
  projeto). A privada é gravada em **modo 600**; a pasta, quando é este comando
  que a cria, em 700.
- **stdout é para script, stderr é para gente.** O `create` imprime só a JWK
  pública no stdout; o `finish`, só o caminho do arquivo. Todo o resto —
  inclusive o próximo comando a rodar — sai no stderr.
- **Sobrescrever chave completa é recusado**, e não há `--force`: trocar a
  identidade de uma máquina já pareada em silêncio deixaria um agente
  assinando com uma chave que o servidor não conhece. Revogue a chave atual,
  apague o arquivo e recomece pelo `create`.
- Este CLI **não** afirma de que espécie é a chave que ele cria — em disco, a
  de máquina e a de projeto são o mesmo arquivo. Quem sabe é a rota que
  registrou a pública.

## Serviço de usuário (`service install | uninstall | status`)

Para que o runner suba junto com a sua sessão em vez de viver num terminal
aberto, instale-o como **serviço de usuário** — `systemd --user` no Linux,
`LaunchAgent` no macOS (ADR 0147, RN-518):

```sh
# de dentro da pasta configurada pelo botão "Configurar pasta automaticamente"
brabo-runner service install
brabo-runner service status
brabo-runner service uninstall

# ou, para o agente desta MÁQUINA (atende todos os seus projetos em modo runner)
brabo-runner service install --machine
brabo-runner service status --machine
brabo-runner service uninstall --machine
```

- **Nível de usuário, sempre.** Nunca serviço de sistema, nunca root: rodar
  `service install` como root é **recusado**, sem escrever arquivo nenhum. O
  runner roda com os privilégios de quem o executa **por desenho**, e é essa
  premissa que sustenta as três fronteiras descritas em *Segurança*, abaixo.
- **Windows fica fora de escopo**, por decisão declarada: serviço de usuário
  ali é um terceiro mecanismo, não uma variação dos dois. Os três subcomandos
  recusam nomeando a plataforma; rodar em primeiro plano continua funcionando.
- **DUAS espécies de unit, e elas convivem** (ADR 0154 ponto 4, RN-545). A de
  **projeto** (`brabo-runner-<projectId>.service` /
  `dev.brabo.runner.<projectId>`) é o comportamento de sempre, byte a byte:
  `--project` e `--dir` seguem opcionais, e sem eles valem o
  `brabo-runner.config.json` e a pasta corrente. A de **máquina**
  (`brabo-runner.service` / `dev.brabo.runner`, sem sufixo) roda o agente do
  *Agente de máquina* descrito acima — um processo, uma conexão por projeto.
  Os nomes não colidem: o `projectId` nunca é vazio, então o de projeto sempre
  tem um `-` onde o de máquina tem um `.`.
- **A espécie nova é opt-in explícito (`--machine`)**, e nunca "a ausência de
  `--project`": o caminho normal de hoje é rodar `install` sem flag nenhuma de
  dentro da pasta configurada, com o `brabo-runner.config.json` respondendo
  quem é o projeto — tratar isso como "máquina" converteria em silêncio a
  instalação de quem já usa o produto. `--machine` junto de `--project` é
  recusa nomeada.
- **`install --machine` exige base consentida** (RN-529) e recusa uma pasta que
  tenha `brabo-runner.config.json`: sem base o agente de máquina não sobe, e
  com esse arquivo no `WorkingDirectory` o serviço subiria em modo de
  **projeto**, em silêncio, atendendo um só. A `XDG_CONFIG_HOME` vai
  **congelada** na unit quando está posta (é ela que decide onde o arquivo da
  base mora, e nenhum dos dois gerenciadores repassa o ambiente do shell); o
  **valor** da base não vai — trocá-la é editar o arquivo e reiniciar.
- **`install` recusa quando a OUTRA espécie já está instalada**, nomeando cada
  unit e o `uninstall` de cada uma, sem remover nem gravar nada. As duas juntas
  seriam dois processos disputando o mesmo projeto, e o servidor negaria um
  deles. Não há `--force`.
- **A credencial é a chave de dispositivo da pasta**, e só ela.
  `--token`/`BRABO_ACCOUNT_TOKEN` são ignorados de propósito — gravá-los num
  arquivo de unit os deixaria em disco, e este CLI nunca grava credencial em
  disco.
- **`uninstall` remove três coisas**: o arquivo de unit, o
  `brabo-runner.config.json` e o `brabo-runner-device-key.jwk.json`. A pasta a
  limpar é lida do próprio arquivo de unit (o registro do que foi instalado),
  nunca chutada a partir do diretório corrente; sem unit, passe `--dir`. A
  chave sai **deste disco** — ela **não** é revogada no servidor, o que se faz
  pela tela do projeto.
- **`uninstall` sem espécie nomeada RECUSA** e lista o que existe no disco, com
  o comando exato de cada um. Ele não herda o default de `status` de propósito:
  ler a espécie errada custa uma linha errada, remover a errada custa um
  serviço e uma chave de dispositivo.
- **`status` responde um de quatro estados**, com frase e código de saída
  próprios e sem colapsar nenhum: não instalado (`4`), instalado e rodando
  (`0`), instalado e parado (`3`), e instalado com o gerenciador de serviços
  sem responder (`5`) — este último nunca é apresentado como "parado". Com as
  duas espécies no disco, o **código continua sendo o da unit perguntada** — os
  quatro não viram oito nem se somam —, e a outra aparece em **texto**, como
  presença lida do DISCO, dizendo que o estado dela não foi perguntado ao
  gerenciador. Sem `--machine` e sem projeto resolvível, a resposta é sobre a
  unit de **máquina**, e a saída nomeia `--project` para quem queria a outra.

O `PATH` do momento da instalação vai **congelado** dentro da unit (os dois
gerenciadores dão ao serviço um PATH mínimo, e o runner chama `git` e
`docker`): mudou o seu PATH, rode `service install` de novo.

## Reconexão

Quando a conexão cai, o runner **pede um ticket NOVO** e tenta de novo, com
backoff (`1s, 2s, 5s, 10s, 30s`) e um teto de 10 tentativas seguidas sem
sucesso — passou disso, ele desiste e diz para você rodá-lo de novo. Recusa de
entrada no canal (ticket inválido, outro runner já conectado neste projeto)
**não** é transitória: ele encerra na hora, com a mensagem, sem laço
automático.

O auto-reconnect embutido da biblioteca `phoenix` fica **desligado** de
propósito (`reconnectAfterMs`), e isso não é detalhe: o ticket do socket é de
**uso único** (RN-108), e o reconnect da lib repete os MESMOS parâmetros — ou
seja, o mesmo ticket já consumido, recusado toda vez. Uma versão anterior deste
CLI vinha com ele LIGADO (o comentário do código dizia o contrário) e o efeito
medido foi: recusa a cada ~5,13s indefinidamente, e **429 (limite de
requisições) na tela do navegador do dono da conta** — o limite da api é por
usuário, e quem o estourava era o runner. Se você vir 429 na web sem explicação,
confira se o binário do runner está atualizado.

## Segurança

A fronteira de segurança do runner **não é sandboxing** — é a composição de
três coisas: autenticação (o Personal Access Token da sua conta), o pipeline
de aprovação de sempre (todo comando de agente continua nascendo uma ação
proposta, sujeita à política do projeto) e o seu consentimento em rodar este
binário na própria máquina, com os seus privilégios.

## Testes e typecheck deste workspace

```bash
pnpm --filter runner test
pnpm --filter runner typecheck
```

Construir o binário standalone (exige [Bun](https://bun.sh) instalado —
`curl -fsSL https://bun.sh/install | bash` — só na plataforma ATUAL; nunca
cross-compila um addon nativo):

```bash
pnpm --filter runner build:bin
pnpm --filter runner smoke:bin
```

## Mais

Documentação completa, incluindo a decisão de arquitetura por trás do runner
local, em [ADR 0103](https://github.com/daneiel/brabo/blob/main/docs/adr/0103-runner-local-execucao-na-maquina-do-usuario.md),
[ADR 0104](https://github.com/daneiel/brabo/blob/main/docs/adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md),
[ADR 0105](https://github.com/daneiel/brabo/blob/main/docs/adr/0105-personal-access-token-do-runner-escopado-por-construcao.md),
[ADR 0106](https://github.com/daneiel/brabo/blob/main/docs/adr/0106-distribuicao-do-runner-via-tsup-e-npm-publish.md),
[ADR 0107](https://github.com/daneiel/brabo/blob/main/docs/adr/0107-navegacao-de-pasta-local-via-o-runner.md)
e [ADR 0112](https://github.com/daneiel/brabo/blob/main/docs/adr/0112-binario-standalone-do-runner-via-bun-build-compile.md)
(o binário standalone).

## Licença

MIT
