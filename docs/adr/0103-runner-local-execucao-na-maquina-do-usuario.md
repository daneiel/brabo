# ADR 0103 — Runner local: execução na máquina do usuário por canal Phoenix com ticket de uso único

- **Status:** Aceito
- **Data:** 2026-08-20
- **Contexto:** pedido do dono do produto, RN-419/420 — companheiro do
  [ADR 0102](0102-revisao-do-adr-0065-teto-absoluto-substitui-deny.md)
- **Revisa (sem atenuar) o terreno de:** [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md),
  [ADR 0072](0072-projeto-local-ou-container.md)

## Contexto

Até esta entrega, NADA no produto executava fora do container: todo
comando de terminal é `System.cmd("sh", ["-c", cmd])` dentro do processo
do engine (`terminal_executor.ex`), e o modo `local` (ADR 0072) só muda a
PASTA via bind-mount — o comando continua rodando no MESMO container do
engine. O pedido do dono do produto foi cruzar essa fronteira de verdade:
agente executando na MÁQUINA do usuário, na pasta local, pelo terminal
padrão dele — mais um terminal interativo de verdade na aba Code, que até
aqui só mostrava texto explicativo + estado do `project_containers`
(nunca um terminal real).

## Decisão

**Componente novo, `apps/runner`** (Node/TS): um CLI (`brabo-runner`) que
o usuário roda na PRÓPRIA máquina. Ele NÃO é orquestrado pelo produto —
sobe por escolha e consentimento explícito do usuário, com os
PRIVILÉGIOS dele.

**Canal**: socket Phoenix NOVO em `/runner` (ao lado do `/socket` de
sessão que já existe), tópico `terminal:<projectId>`, autenticado por
ticket de USO ÚNICO — mesmo padrão de segurança da RN-108 (ticket de
socket de sessão), mas com um detalhe de propriedade INVERTIDO: o ticket
é emitido pelo próprio ENGINE (tabela `runner_socket_tickets`, schema
`"engine"`, migration Ecto própria), e a API o PEDE ao engine via rota
HTTP interna — o inverso do fluxo do ticket de sessão, onde a api grava
o ticket na própria tabela. A troca é justificada: o ticket de runner não
tem uma sessão de chat associada (é por PROJETO), e o estado que precisa
validar exclusividade (só um runner por projeto) já vive no engine
(`Engine.Runners.Registry`, `:global`).

**Dois papéis no mesmo tópico**: `:runner` (o CLI, exclusividade garantida
por `:global.register_name/3` — só UM por projeto, um segundo `join`
recusado) e `:web` (a aba Terminal, múltiplos simultâneos). O engine faz
RELAY puro dos bytes do PTY entre os dois — nunca interpreta o conteúdo.

**Roteamento SEMPRE depois da aprovação.** `TerminalExecutor` só decide
rotear pro runner (em vez do `System.cmd` de sempre) DEPOIS que o
pipeline normal (`decide()`/`proposed_action`) já aprovou o comando — o
runner nunca é um segundo caminho de execução que escapa da política, é
só um DESTINO diferente pro mesmo comando já autorizado. Sem runner
conectado, mesmo em modo `local`, o comportamento de sempre continua
(`System.cmd` no container via bind-mount) — o runner é aditivo, nunca
uma dependência obrigatória.

**A fronteira de segurança do runner NÃO é sandboxing.** É a composição
de três coisas: autenticação (o CLI se identifica com o token da CONTA do
usuário), o pipeline de aprovação de sempre (todo comando de agente
continua nascendo `proposed_action`, com os tetos absolutos do ADR 0102
valendo igual), e o CONSENTIMENTO do usuário em rodar o binário na própria
máquina. `apps/runner/src/guard.ts` valida que o `cwd` recebido fica
dentro da raiz do projeto por resolução léxica — mas está DECLARADO no
código como best-effort, não a garantia real; a garantia real é a
composição acima. Isto revisa, sem atenuar, o terreno dos ADRs 0055/0072:
para execução via runner, a contenção estrutural do `join(raiz, coluna)`
que protege o modo container não existe — o comando roda com os
privilégios do PRÓPRIO usuário, na própria máquina dele.

**PTY interativo é ação do usuário, com rastro.** `pty_open`/`pty_close`
vindos da web emitem `terminal.session.started`/`ended` no event log
(auditoria) — inclusive quando a aba cai sem fechar explicitamente
(`terminate/2` do canal fecha o rastro). Não passa por `proposed_action`
porque não é o agente agindo — é o usuário autenticado digitando no
terminal da própria máquina.

## Achado real durante a implementação

O produto NÃO tem, hoje, um mecanismo de token de conta de LONGA DURAÇÃO
pra automação — `account_tokens` existe só pra links de e-mail de uso
único (verificação, reset de senha, senha inicial pós-migração). O runner
precisava de algo que sobrevivesse entre execuções do CLI. Solução
adotada até um mecanismo de automação de verdade existir: o runner
replica o fluxo de LOGIN do browser (usuário/senha na primeira execução,
cookie httpOnly + CSRF extraídos e persistidos em
`~/.brabo/runner-credentials.json` com permissão `0600`, rotacionados via
`/auth/refresh`). Isso está sinalizado no código como o módulo a trocar
quando um token de automação real (personal access token, ou equivalente)
entrar no produto — não é a forma final, é a forma possível com o que
existe hoje.

## Consequências

- Quatro dependências novas, todas isoladas: `@xterm/xterm` +
  `@xterm/addon-fit` na web (mesma régua do `mermaid`/ADR 0068 —
  `import()` dinâmico; ausência de `eval`/`new Function` confirmada por
  grep no pacote instalado, declarada como evidência forte, NÃO garantia
  formal contra ofuscação); `phoenix` + `node-pty` no runner.
- O terminal interativo do CONTAINER continua não existindo — a FASE 25b
  segue cortada. O runner NÃO é essa peça: é um caminho paralelo,
  na máquina do usuário, não dentro do container do projeto.
- `TERMINAL_ACTION_TIMEOUT_MS`/`TERMINAL_OUTPUT_MAX_BYTES` (tetos que já
  existiam pro executor do container) são replicados como default no
  runner — mesmos valores, para não haver dois comportamentos de teto
  diferentes dependendo de onde o comando roda.
- Guarda de escopo (`guard.ts`) é best-effort, declarado — não fortalece
  o argumento em torno dele além do que está escrito: ele ajuda a pegar
  erro grosseiro, não é uma parede.
