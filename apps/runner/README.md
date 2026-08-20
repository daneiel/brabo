# `@brabo/runner`

CLI que roda **na máquina do próprio usuário**, conectada ao engine por um
canal Phoenix autenticado por ticket de uso único (ADR 0102/0103). Ela
executa, com os privilégios do usuário que a roda:

- comandos de agente já **aprovados** pelo pipeline de `proposed_action`
  (`exec`);
- um terminal interativo de verdade (PTY) para a aba **Terminal** da web;
- a navegação de pasta local (`fs_list_dir`/`fs_home_dir`) que alimenta o
  seletor de pasta ("Procurar pasta...") da criação/adoção de projeto.

Não decide política nenhuma: só faz o que o produto já aprovou. Ver os
docblocks de `src/channel.ts`, `src/exec.ts`, `src/pty.ts`, `src/guard.ts` e
`src/fs-browser.ts` para o desenho de cada parte, e a ADR "Navegação de
pasta local via o Runner" para o argumento de segurança da navegação de
pasta.

## Instalação — hoje, só a partir do checkout do monorepo

**Gap declarado**: este pacote **não está publicado no npm**
(`"private": true`) e o `bin` aponta para um `.ts` cru, executado pelo Node
via *type stripping* nativo (sem passo de build) — não pelo empacotamento
tradicional de um binário instalável fora do monorepo. Um instalador nativo
por sistema operacional, com binário assinado, é um gap maior e **fica de
fora** desta entrega. O caminho de instalação disponível hoje é rodar
direto do checkout:

```bash
git clone <o repositório do Brabo>
cd brabo
pnpm install
```

Requer **Node.js 22.6 ou mais recente** (o *type stripping* nativo de `.ts`
que este pacote usa só existe a partir daí; o resto do monorepo já pede
Node recente para outras partes, então instalar uma vez cobre tudo).

## Uso

```bash
# de dentro do checkout do Brabo
pnpm --filter runner start -- --project <projectId> --dir <pasta-absoluta>

# equivalente, sem passar pelo pnpm
node apps/runner/src/index.ts --project <projectId> --dir <pasta-absoluta>
```

Flags:

- `--project <projectId>` — obrigatório. O projeto (modo `local`, ADR 0072)
  ao qual este runner se conecta. Só **um** runner por projeto no cluster
  inteiro (`Engine.Runners.Registry`) — um segundo `brabo-runner` para o
  mesmo projeto é recusado no join.
- `--dir <caminho-absoluto>` — obrigatório. A pasta que serve de raiz para
  os comandos (`exec`) e o terminal (PTY) deste runner. A navegação de pasta
  (`fs_list_dir`/`fs_home_dir`) **não** é restrita a esta pasta — ela
  navega livre pela máquina, de propósito (ver `src/fs-browser.ts`).
- `--api-url <url>` — opcional, default `http://localhost:3000` (ou
  `BRABO_API_URL`).

## Autenticação

Sem um "token de conta" de automação no produto ainda (ver o docblock de
`src/auth.ts` para o porquê), o runner replica o fluxo de login do browser:

- **Primeira execução**: pede e-mail/senha no terminal.
- **Execuções seguintes**: renova sozinho a partir de
  `~/.brabo/runner-credentials.json` (modo `0600`, só o dono lê/escreve).
- **Atalho**: `BRABO_ACCOUNT_TOKEN` no ambiente — um access token JÁ
  emitido (`POST /auth/login` manual, por exemplo), sem renovação
  automática enquanto ele valer (15 minutos por padrão). Útil para testar,
  ruim para um runner de vida longa.

## Testes e typecheck deste workspace

```bash
pnpm --filter runner test
pnpm --filter runner typecheck
```
