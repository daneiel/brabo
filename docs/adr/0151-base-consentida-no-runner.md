# 0151 — A base consentida no runner, e a criação de pasta pelo canal

## Status

**Proposed.** Recorte deliberadamente estreito: o runner **por máquina** ficou
fora da [FASE 29](../explanation/fase-29-instalacao-de-uma-linha.md) e está
declarado como escopo da fase seguinte, com a medição já feita (ver
Consequences).

## Context

A direção de produto é o usuário escolher um projeto na web e **ver a pasta
aparecer** na máquina dele. Hoje isso não acontece, e o motivo não é falta de
agente — o `brabo-runner` já vive lá. É que ele nasce sem noção de onde as
coisas moram.

**O runner não tem base.** A única raiz é `--dir`, resolvida por `resolverDir`
(`apps/runner/src/guard.ts:221-227`) contra `INIT_CWD ?? process.cwd()`; sem
`--dir`, a raiz **é o cwd** (`apps/runner/src/index.ts:242-250`). `estado.dir`
(`index.ts:366-368`) é *um* caminho, singular, e é ele que vai para
`validarCwdDentroDaRaiz`, para o `GerenciadorDePty`, para `cwdParaContainer` e
para o `workspace_confirm` (`index.ts:725`). Não existe constante, variável de
ambiente nem campo de base em `apps/runner/src/` — a palavra só aparece em
comentários.

**A base existe, mas na api, e ela é proibida de descer.**
`apps/api/src/infrastructure/filesystem/project-workspaces-root.ts` tem
`baseDeProjetos()` (`:68`), `dentroDaBaseDeProjetos` (`:93`) e
`segmentoSobABaseDeProjetos` (`:116`) — e o mesmo arquivo **proíbe por escrito**
(`:421-438`) que a regra da base entre em `caminhoDeWorkspaceLocalValido`,
porque esse predicado roda em **toda leitura** e um projeto montado legado fora
da base explodiria ao ser lido. A base é regra de **criação e conversão**.

**Há um precedente exato de guarda irmã.** `apps/runner/src/espelho-guard.ts`
nasceu reusando os três helpers de `guard.ts` (`:51`) e implementa a recusa de
laço por **segmento** — `dentroDoEscopo(destino, workspace)` e
`dentroDoEscopo(workspace, destino)` (`:214`, `:223`) —, nunca `startsWith`
cru, com a razão escrita em `:152-154`: *"`/base-outra` NÃO está dentro de
`/base`"*.

**E há um invariante que este ADR não pode quebrar.** Desde o
[ADR 0130](0130-broker-de-container.md), nenhum caminho absoluto atravessa a
rede: quem tem a raiz é quem executa, e o que viaja é o **segmento relativo**
mais um discriminador de contra qual raiz ele vale
([ADR 0144](0144-a-segunda-raiz-do-broker.md)).

## Decision

### 1. O runner nasce com uma base, consentida no instalador

O `install.sh` ([ADR 0150](0150-instalador-de-uma-linha.md)) consente **uma**
base e a grava na configuração local do runner. Cada projeto é uma **subpasta**
dela. `--dir` continua existindo e continua significando o que sempre
significou — é o binário legado da RN-514, e quebrá-lo seria `breaking/` sem
ganho.

A base é **local**, nunca recebida pela rede. É o mesmo desenho do broker
(ADR 0144): a raiz é de quem executa; o servidor manda o **segmento**.

### 2. A guarda reusa a régua, não a copia

A validação da base e da subpasta reusa `semBarraFinal`, `dentroDoEscopo` e
`realpathMaisProximo` de `guard.ts` — que já são exportados exatamente por
isso (`guard.ts:33-43`, quando `espelho-guard.ts` nasceu) — e a recusa de laço
por segmento de `espelho-guard.ts:208-233`. **Não nasce uma quarta cópia da
régua**: a RN-515 já estabeleceu isso do lado da api, quando
`validarDestinoDeEspelho` reusou `caminhoDeWorkspaceLocalValido`
(`apps/api/src/application/services/workspace-location.ts:132-136`) em vez de
reescrevê-la.

Herda por escrito a mesma ressalva de TOCTOU de `guard.ts:9-31` e
`espelho-guard.ts:30-39`: isto é best-effort e não é a fronteira de segurança,
que continua sendo autenticação mais o pipeline de aprovação.

### 3. A mensagem nova pede a criação, e a confirmação reusa o que já existe

Par novo no canal, no molde de **pedido com resposta** (`exec`/`exec_result`,
`terminal_channel.ex:563-567` e `:737-749`), porque quem pede precisa saber se
deu certo:

- `workspace_create` — engine → runner: `projectId` e o **segmento relativo à
  base**. Nunca um caminho absoluto.
- `workspace_create_result` — runner → engine: sucesso com o caminho final, ou
  erro **nomeado**.

O runner faz `mkdir -p` e então `git init` ou clone. Tendo dado certo, ele
manda o **`workspace_confirm` que já existe** (`channel.ts:577-582`), e é ele
que grava — pelo caminho já construído e testado: canal → engine → HTTP interno
→ `ConfirmProjectWorkspaceUseCase`, que revalida o léxico
(`confirm-project-workspace.use-case.ts:83`), é idempotente (`:93-95`) e grava
`workspaceVerifiedAt`.

Isso é deliberado e economiza uma frente inteira: **não nasce rota nova de
gravação**, o engine continua **não escrevendo a tabela**, e o único caminho
que carimba `workspace_verified_at` continua sendo um só.

Registro de precisão, porque o nome circulou: **`workspace.verified` não
existe** no repositório — nem evento, nem mensagem, nem rota. O que existe é o
evento `project.workspace_verified` (`confirm-project-workspace.use-case.ts:107`)
e a coluna `workspace_verified_at`. E `workspace_confirm` é **unidirecional**:
`terminal_channel.ex:356-373` responde `{:noreply, socket}` e não empurra nada
de volta — por isso o par novo não pode ser modelado nele.

### 4. Capacidade declarada só quando implementada

`workspace` entra no vocabulário de `Engine.Runners.Capacidades`
(`capacidades.ex:72`) **na sessão em que o código entra**, nunca antes — a
lição da RN-514, onde declarar `espelho` sem implementá-lo seria exatamente o
defeito silencioso que a negociação existe para impedir. Nome desconhecido
continua sendo ignorado; capacidade exigida e não declarada continua recusando
o join com o nome do que falta.

### 5. Predicado próprio, e `RunnerReadiness` fica byte a byte

Duas pré-condições — runner conectado, base consentida — num módulo **próprio**,
no molde de `Engine.Runners.Espelho` (`espelho.ex:82-99`). **Não** exige
container: criar pasta é operação de sistema de arquivos na máquina do usuário,
sem container de onde cair.

A tentação e a recusa estão escritas, e este ADR as adota literalmente
(`espelho.ex:19-24`):

> A tentação óbvia seria `RunnerReadiness.verificar(project_id, pular_container:
> true)`. O ADR 0147 recusa isso por escrito, e a razão é mecânica: uma função
> compartilhada com flag "pula container" é precisamente o caminho pelo qual a
> terceira pré-condição cai POR ACIDENTE para o `exec` numa refatoração futura
> — e o ADR 0145 existe para ela não cair.

### 6. Não é `proposed_action`

Criar a pasta do projeto que o usuário acabou de pedir é **configuração
consentida**, não um agente pedindo para agir. Vira `proposed_action` nada
disso, e nenhum teto da política ganha exceção — a mesma linha que o espelho já
estabeleceu (RN-516).

### 7. A web lê a base pelo runner

O picker de criação em modo `runner` usa `fs_list_dir`, que existe dos dois
lados (`apps/runner/src/fs-browser.ts:53`,
`terminal_channel.ex:489`) e cujo transporte no web
(`apps/web/src/lib/fs-browser-channel.ts:66`) ficou **sem chamador efetivo**
desde a RN-504 — mantido por decisão declarada em
`apps/web/src/routes/NewProjectWizard.tsx:880-882`. Ele ganha o chamador de
volta. O caminho do modo `mounted`, que passa pela api
(`GET /workspaces/:workspaceId/project-folders`), fica **intacto**.

## O que este ADR recusa explicitamente

- **Runner por máquina nesta fase.** Ver Consequences: são cinco acoplamentos
  independentes, e atacá-los junto com o instalador concentraria dois riscos
  grandes na mesma fase.
- **`RunnerReadiness` com flag.** Pela citação da decisão 5.
- **Uma quarta cópia da régua de caminho.**
- **Caminho absoluto atravessando a rede.** Invariante do ADR 0130.
- **Fundir isto com o espelho.** São mensagens diferentes, com direções e
  gatilhos diferentes; o espelho copia para fora da base, isto cria dentro dela.

## Consequences

- O usuário escolhe o projeto na web e a pasta aparece — sem terminal, sem
  `git init` manual.
- **O runner continua pareado por projeto.** Os cinco acoplamentos medidos, que
  a FASE 30 terá de atravessar: o tópico `terminal:<projectId>`
  (`channel.ts:422`, `terminal_channel.ex:172`), o socket id
  `runner_socket:<kind>:<project_id>:<user_id>` (`runner_socket.ex:71-73`), o
  ticket escopado por projeto (`socket_ticket.ex:10-13`), a coluna
  `runner_device_keys.project_id NOT NULL`
  (`apps/api/src/db/schema/auth.ts:325`) e o nome da unit
  (`servico.ts:263-265`, `:392-394`). Um deles é migration; outro é
  `breaking/`.
- **A revogação continua alcançando `{projeto, usuário}`** (RN-520), o que
  nesta fase mantém o custo atual. Quando a FASE 30 unificar o runner por
  máquina, revogar passará a derrubar **todos** os projetos daquela máquina —
  declarado aqui para não ser descoberto lá.
- A credencial de git descartada no `docker exec` em modo `runner`
  (ADR 0130/0145) **não é afetada**: o clone inicial desta mensagem roda no
  **HOST**, pelo caminho que carrega credencial. A lacuna continua onde estava.
