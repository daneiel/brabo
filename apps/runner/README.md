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
`src/fs-browser.ts` para o desenho de cada parte, e a
[ADR 0107](https://github.com/daneiel/brabo/blob/main/docs/adr/0107-navegacao-de-pasta-local-via-o-runner.md)
para o argumento de segurança da navegação de pasta.

## Instalação

```sh
npm install -g @brabo/runner
```

## Uso

```sh
brabo-runner --project <projectId> --dir <caminho-absoluto> --token brb_... [--api-url <url>]
```

- `--project`: o id do projeto no Brabo, com `execution_mode` = `runner`.
  Só **um** runner por projeto no cluster inteiro
  (`Engine.Runners.Registry`) — um segundo `brabo-runner` para o mesmo
  projeto é recusado no join.
- `--dir`: a pasta absoluta onde o código do projeto vive nesta máquina —
  raiz para os comandos (`exec`) e o terminal (PTY). Se a pasta ainda não
  existir, ela é **criada automaticamente** (`mkdir -p`); se `--dir` apontar
  para um arquivo já existente, é erro — este CLI nunca sobrescreve um
  arquivo (RN-434, ADR 0104). A navegação de pasta
  (`fs_list_dir`/`fs_home_dir`) **não** é restrita a esta pasta — ela
  navega livre pela máquina, de propósito (ver `src/fs-browser.ts`). No
  **Linux**, `--dir` só é aceito dentro do `$HOME` do usuário (o próprio
  home ou uma subpasta dele) — fora do Linux essa restrição não vale
  (RN-433, ADR 0104); a checagem do `$HOME` roda ANTES da criação
  automática, então uma pasta fora do home no Linux continua recusada
  mesmo quando ainda não existe.
- `--token`: um Personal Access Token (`brb_…`), gerado em **Configurações do
  projeto → Tokens de acesso**. Também pode vir pela variável de ambiente
  `BRABO_ACCOUNT_TOKEN` — nunca é gravado em disco por este CLI.
- `--api-url`: default `http://localhost:3000`, ou a variável de ambiente
  `BRABO_API_URL`.

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

## Mais

Documentação completa, incluindo a decisão de arquitetura por trás do runner
local, em [ADR 0103](https://github.com/daneiel/brabo/blob/main/docs/adr/0103-runner-local-execucao-na-maquina-do-usuario.md),
[ADR 0104](https://github.com/daneiel/brabo/blob/main/docs/adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md),
[ADR 0105](https://github.com/daneiel/brabo/blob/main/docs/adr/0105-personal-access-token-do-runner-escopado-por-construcao.md)
e [ADR 0107](https://github.com/daneiel/brabo/blob/main/docs/adr/0107-navegacao-de-pasta-local-via-o-runner.md).

## Licença

MIT
