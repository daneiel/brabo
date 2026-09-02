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
`src/fs-browser.ts` para o desenho de cada parte. `src/docker-port.ts` e
`src/docker-cli.ts` são o alicerce da execução em container (ADR 0128) e
**ainda não são chamados por nada** — nenhuma mensagem do canal os alcança, e
nenhum container sobe; o docblock dos dois explica a porta de cinco operações e
a prova de empacotamento que escolheu a implementação. Ver também a
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
  projeto é recusado no join.
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

### Rodando direto do checkout do monorepo (sem instalar via npm)

```bash
git clone <o repositório do Brabo>
cd brabo
pnpm install
pnpm --filter runner start -- --project <projectId> --dir <pasta-absoluta> --token brb_...
```

Requer **Node.js 22.6 ou mais recente** (o *type stripping* nativo de `.ts`
que este caminho usa só existe a partir daí).

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
