# ADR 0104 — Navegação de pasta local via o Runner

- **Status:** Aceito
- **Data:** 2026-08-20
- **Contexto:** Onda 4 de um programa maior (pasta local, gestão de PRs,
  i18n) — pedido do dono do produto
- **Revisa (sem editar) o terreno de:** [ADR 0072](0072-projeto-local-ou-container.md),
  companheiro de [ADR 0103](0103-runner-local-execucao-na-maquina-do-usuario.md)

## Contexto

O ADR 0072 (projeto Local, RN-169/170) recusou EXPLICITAMENTE um seletor de
pasta na criação/adoção de projeto: "um seletor exigiria a api enumerar o
filesystem do CONTAINER para o navegador, superfície nova para resolver
ergonomia". A decisão de então era correta — a api roda dentro de um
container, e o filesystem que ela enxerga não é o filesystem do usuário. O
único caminho era digitar o caminho absoluto de cabeça, sabendo de antemão
como ele aparece DENTRO do container (RN-170).

Desde então, o ADR 0103 introduziu `apps/runner`: um CLI que roda NA
MÁQUINA do usuário, com os privilégios dele, autenticado por ticket de uso
único e já usado para dois propósitos (comando de agente aprovado, PTY
interativo). Ele muda a pergunta: a superfície que enumeraria o filesystem
não precisa mais ser a api enumerando o CONTAINER — pode ser o RUNNER
enumerando a máquina real do usuário, o mesmo componente que já teria essa
visão para rodar o terminal.

## Decisão

**A navegação de pasta passa a existir, mas só pelo Runner.** Dois eventos
novos no MESMO canal Phoenix `terminal:<projectId>` que o PTY já usa
(`apps/runner/src/channel.ts`, `EngineWeb.TerminalChannel`):
`fs_list_dir`/`fs_list_dir_reply` e `fs_home_dir`/`fs_home_dir_reply`. Mesmo
desenho do PTY — `:web` pede, relay puro do engine pro pid do runner
registrado (`Engine.Runners.Registry`), `:runner` responde, broadcast
filtrado só pra sockets `:web`. Correlacionado por `ref` gerado pelo
cliente, exatamente como o PTY correlaciona por `sessionRef` — o engine
NUNCA interpreta caminho nenhum, só repassa.

**A api CONTINUA sem enumerar filesystem nenhum.** Isso não muda: nenhuma
rota HTTP nova entra na api para listar diretório. A leitura é sempre
runner → engine (relay) → web, pelo canal que já existe. O argumento do ADR
0072 contra a api enumerar o CONTAINER continua de pé, intocado — esta
decisão não o contradiz, ela desvia o problema para um componente que já
tem a visão certa.

**A fronteira de segurança CONTINUA sendo a do ADR 0103, não uma
allowlist de caminho.** `apps/runner/src/guard.ts` restringe o `cwd` de um
comando de agente JÁ APROVADO à raiz do projeto (`--dir`) — mas essa
restrição NÃO se aplica à navegação de pasta, de propósito: o objetivo
aqui é justamente deixar o usuário navegar LIVRE pela própria máquina,
para escolher QUALQUER pasta como raiz de um futuro projeto Local. Recusar
isso com uma allowlist de caminho contradiria o próprio propósito da
funcionalidade. A fronteira real continua sendo a composição de três
coisas, a mesma do ADR 0103: autenticação (só quem tem o ticket do canal
chega a pedir), leitura pura sem efeito nenhum (listar diretório não é
comando, não passa por `proposed_action`, não escreve nada), e
CONSENTIMENTO — é o usuário quem decide rodar o Runner na própria máquina,
sabendo que ele lista o que for pedido.

**Erro por ENTRADA, não por listagem inteira.** Uma entrada sem permissão
de leitura (ACL restritiva, symlink quebrado, montagem estranha) é pulada
— `apps/runner/src/fs-browser.ts` nunca aborta a listagem inteira por causa
de um item problemático.

## Consequências

- **Gap arquitetural aceito, declarado (não fechado nesta entrega):** o
  ticket do canal (`getTerminalTicket`/`getRunnerTicket`) é emitido POR
  PROJETO — o Runner é `--project <id> --dir <pasta>`, ancorado a um
  projeto que já existe. Na tela de CRIAÇÃO de projeto
  (`NewProjectWizard.tsx`), o projeto só nasce no passo de confirmação,
  então o botão "Procurar pasta..." no passo de workspace NÃO consegue
  conectar a runner nenhum — não há projeto para ancorar o ticket. O
  `FolderBrowserModal` recebe `projectId: string | null` e, quando nulo,
  mostra o estado declarado ("disponível depois que o projeto existir") em
  vez de tentar uma conexão que a arquitetura de hoje não permite. O campo
  de texto livre continua sendo o único caminho nesse fluxo específico —
  exatamente como era antes desta entrega. Fechar isto de verdade exigiria
  ou (a) um modo de ticket/canal desancorado de projeto para o Runner, ou
  (b) o projeto nascer mais cedo no fluxo da wizard (antes da confirmação)
  — as duas são mudanças de escopo maior que esta Onda, e ficam para uma
  entrega futura que o dono do produto priorizar.
- Onde um projeto JÁ EXISTE (aba Code de um projeto Local, por exemplo — a
  navegação também está disponível ali via o mesmo `FolderBrowserModal`,
  independente da criação), a navegação funciona de ponta a ponta,
  incluindo o "sem runner conectado ainda" com onboarding de instalação —
  ver `RunnerOnboardingPanel`.
- `apps/runner` ganha uma terceira responsabilidade sobre o MESMO canal
  (exec, PTY, e agora navegação de pasta) — nenhum canal novo, nenhum
  ticket novo, dois eventos a mais no protocolo já existente.
- Sem evento de auditoria (`terminal.session.*`) para a navegação de
  pasta — diferente do PTY, que é uma SESSÃO com duração. Listar diretório
  é leitura pontual, sem estado, sem efeito: a mesma régua que já isenta
  leitura de `proposed_action` no resto do produto.
