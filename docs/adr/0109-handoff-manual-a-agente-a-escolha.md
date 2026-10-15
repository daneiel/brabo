# ADR 0109 — Handoff manual a um agente à escolha reusa oferta+aceite, nunca um terceiro estado de handoff

- **Status:** Aceito
- **Data:** 2026-08-23
- **Contexto:** fecha o item de backlog "Manual handoff to an agent of
  choice" (`docs/explanation/backlog.md`), cujo critério de ativação já estava
  escrito ali: "quando um agente FORA do pipeline fixo de handoff precisar ser
  alcançado por decisão humana — hoje é exatamente o caso do Staff (ADR 0088),
  alcançável só pela rota interna"
- **Precedente direto:** [ADR 0038](0038-hierarquia-de-agentes.md)
  (regra de alvo do handoff — `assertHandoffTargetAllowed`), [ADR 0088](0088-staff-agente-dormente-para-disparo-automatico.md)
  (o Staff, o caso real que motivou este ADR), [ADR 0087](0087-ux-designer-agente.md)
  (UX Designer, achado endereçável pela mesma investigação)

## Contexto {#context}

`CreateHandoffUseCase` é o único lugar do sistema que escreve `toAgent` (ADR
0038) — mas o único chamador dele era `POST internal/sessions/:sessionId/handoffs`,
uma rota só do engine. Todo handoff do produto hoje é criado por um AGENTE
chamando essa rota interna por iniciativa própria (o Criativo oferecendo ao
PO, o Arquiteto oferecendo à Infra/ao Dev Lead etc.). Não havia caminho para
um HUMANO, da tela de sessão, endereçar um handoff a um agente fora dessa
cadeia fixa.

O ADR 0088 nomeou a lacuna com precisão ao construir o Staff: "acionável
MANUALMENTE" queria dizer que a mecânica de domínio (ativação, validação de
alvo) já o permitia, mas "a UI genérica de 'handoff manual a um agente à
escolha' segue no backlog". O encanamento do Staff no engine
(`StaffSupervisor`, `StaffServer`, a cláusula `"staff"` em
`agent_command_controller.ex`) estava pronto e sem teste por nenhum caminho
real de usuário — a única forma de alcançá-lo era uma chamada HTTP crua à rota
interna.

A investigação antes de escrever qualquer código achou um segundo agente na
mesma situação: `ux-designer` (ADR 0087) também tem uma cláusula `message/2`
inteiramente ligada no engine (`agent_command_controller.ex`, confirmado
lendo o arquivo — a cláusula espelha exatamente a do Staff), e é igualmente
inalcançável a partir de `SessionPage.tsx`, que nunca o acrescentou a
`AGENTES_DE_CHAT`. Os dois fecham juntos.

## Decisão {#decision}

**Nenhum terceiro estado de handoff.** Um handoff manual é escrito pelo MESMO
`CreateHandoffUseCase.execute` que o `offer_handoff` do próprio agente já usa
— ele nasce `offered`, exatamente como um automático, e o fluxo de aceite
EXISTENTE (`AcceptHandoffUseCase`, a rota `handoffs/:handoffId/accept`, o
`offeredHandoff`/`handleAcceptHandoff` de `SessionPage.tsx`) o pega sem
mudança nenhuma. A única coisa nova é um segundo caminho de ESCRITA, voltado
ao humano. Dois motivos para isso ter sido escolhido em vez de inventar um
conceito distinto de `manual_handoff`:

1. **O lado da leitura nunca precisou saber quem decidiu.** `handoff.offered`
   já tem `actor` no envelope do evento — um handoff manual só escreve
   `actor: {kind: 'user', id: userId}` em vez do padrão
   `{kind: 'agent', id: fromAgent}` que `CreateHandoffUseCase` fixava no
   código. `CreateHandoffInput` ganhou um campo opcional `actor?: Actor`
   exatamente para isso — compatível com o que existia, o chamador interno não
   o passa e mantém o comportamento antigo.
2. **Duplicar a lógica de aceite/ativação para um segundo "tipo" de handoff
   seria exatamente o antipadrão que o ADR 0086 já rejeitou uma vez** (um
   segundo mecanismo de suspensão em vez de reusar o existente). O card de
   aceite em `SessionPage.tsx` não se importa com COMO um handoff foi
   oferecido — só que ele exista e mire um agente com quem a tela sabe
   conversar (`AGENTES_DE_CHAT`).

**`addressableAgents()` — um catálogo mais estrito que `assertHandoffTargetAllowed`.**
A regra de alvo existente (ADR 0038) só RECUSA um subagente; ela não tem
opinião sobre se `toAgent` é sequer um agente real e conhecido — um agente
citando "abc" como alvo passaria. Isso está bem para um agente, que só cita
agentes que já conhece pelas próprias instruções. NÃO está bem para um humano
escolhendo num dropdown, onde um cliente desatualizado ou uma requisição
feita à mão poderia mandar qualquer coisa. `addressableAgents()`
(`apps/api/src/domain/agents/agent-areas.ts`) é o conjunto fechado — leads de
área (`AGENT_AREAS.map(a => a.lead)`) ∪ `SOLO_CONVERSATIONAL_AGENTS`
(`criativo`, `po`, `arquiteto`, `ux-designer`, `staff`) — e
`RequestManualHandoffUseCase` confere a pertinência a ele ANTES de chamar
`CreateHandoffUseCase`.

`SOLO_CONVERSATIONAL_AGENTS` é uma lista nova, escrita à mão, no domínio da
api — não derivada de `apps/web/src/lib/agents.ts` (esse roster inclui também
agentes de gate como `qa-automacao`/`secops` e o Psicólogo/Anamnese, nenhum
deles endereçável por handoff) e não gerada por `gerar:areas` (que só cobriu
`AGENT_AREAS`). O lado web ganha a própria cópia espelhada à mão em
`agents.ts`, no mesmo arquivo cujo comentário já diz que ele "sobreviveu para
cor, ícone e a REGRA de endereçamento" — esta é exatamente essa regra. As
duas listas NÃO são conferidas uma contra a outra por teste hoje (isso
exigiria o mesmo mecanismo de gerador que a lista de áreas da Fase 18 tem);
uma deriva ali produz, no pior caso, uma opção velha num `<select>` que o
`RequestManualHandoffUseCase` do backend continua recusando com 400 — nunca um
handoff escrito errado.

**O `fromAgent` de um handoff manual é derivado, não perguntado.** O seletor
só pergunta o `toAgent` — pedir ao usuário que nomeie também um `fromAgent`
seria pedir que ele explicasse a contabilidade interna do engine.
`RequestManualHandoffUseCase` lê os eventos `agent.activated` da sessão
(`SessionEventRepository.listByTypeInSession`) e pega o mais recente, a mesma
regra "o mais recente por `seq` vence" que o `activeAgent` de
`SessionPage.tsx` já usa (achado 9-fix) — não existia antes, do lado do
servidor, consulta nenhuma de "agente corrente" da sessão, então este ADR
introduz a primeira, escopada a este caso de uso. Uma sessão ainda sem agente
ativado cai no sentinela `"usuario"` — nunca um nome de agente adivinhado, a
mesma regra de "nada de diagnóstico por eliminação" que a RN-059 já
estabeleceu para falhas de turno.

**`ux-designer` e `staff` entraram os dois em `AGENTES_DE_CHAT`.** Verificado
lendo `agent_command_controller.ex` antes de escrever qualquer código do web:
os dois têm uma cláusula `message/2` de forma idêntica à de
`po`/`dev-lead`/`arquiteto` — nenhuma mudança de engine foi necessária para
nenhum deles. `infra`/`qa` continuam excluídos, sem mudança: são leads de área
sem `kickoff/1` e sem cláusula `message`, o mesmo motivo documentado que o
comentário de `AGENTES_DE_CHAT` já dava para excluir a Infra.

## Consequências {#consequences}

**A favor**

- O Staff (ADR 0088) e o UX Designer (ADR 0087) passam a ser alcançáveis pela
  tela de Sessão pela primeira vez — os dois tinham encanamento completo no
  engine, parado sem uso atrás de uma rota só interna.
- Zero semântica nova de handoff: a tabela `handoffs`, a forma do evento
  `handoff.offered` e o caminho de aceite/ativação ficam todos intocados. Um
  handoff manual e um automático são indistinguíveis para todo leitor
  existente, salvo pelo `actor.kind`.
- O catálogo endereçável é fechado e tipado, não um campo de texto livre —
  `RequestManualHandoffUseCase` recusa um slug desconhecido do mesmo jeito que
  recusa um subagente, os dois com 400 antes de qualquer escrita.

**Contra, declarado**

- **Nenhum teste confere `SOLO_CONVERSATIONAL_AGENTS` entre api e web.** Um
  novo agente conversacional solo acrescentado à lista da api sem atualizar o
  espelho manual do web não reprova o CI — ele só não aparece como opção no
  seletor até alguém notar. Estender `gerar:areas` (Fase 18) para cobrir
  também esta lista é a correção, deixada para quando uma segunda deriva
  acontecer de fato (a mesma disciplina de "não refatorar o que está pronto"
  que o CLAUDE.md pede).
- **O seletor não oferece confirmação/prévia do que o agente-alvo fará com o
  handoff.** É um `<select>` simples + botão, estilizado de propósito menor
  que o composer (`.manualHandoffRow`, intenção do ADR: "isto é
  redirecionamento, não conversa").
- **`infra`/`qa`/`dev-<modulo>` continuam inalcançáveis por este seletor.**
  `addressableAgents()` inclui os leads deles (`infra`, `qa`, `dev-lead`) —
  eles SÃO endereçáveis pelo backend —, mas `AGENTES_DE_CHAT` (a lista
  separada do web de "com quem esta tela consegue de fato conversar") não
  inclui `infra`/`qa`, então um handoff a eles por este seletor criaria um
  handoff `offered` que o card de aceite não consegue desenhar. Este ADR não
  corrige isso — é a mesma limitação que o ADR 0088 já declarava para o Staff
  antes desta funcionalidade, agora estreitada aos dois leads sem cláusula
  `message`.

## Alternativas consideradas {#alternatives-considered}

**Uma rota dedicada `POST .../handoffs/manual`, separada de um
`POST .../handoffs` genérico.** Rejeitada: `GET .../handoffs` já é dono do
caminho `handoffs` puro, sem sufixo de verbo, e o Nest roteia por método HTTP,
não só por caminho — `POST .../handoffs` se lê como "criar um handoff" sem
precisar de qualificador, e o caminho de aceite
(`.../handoffs/:handoffId/accept`) já estabelece o padrão de sufixo de verbo
só onde acontece uma transição de estado.

**Estender `CreateHandoffInternalDto`/a rota interna para aceitar um `userId`
e chamá-la direto do web.** Rejeitada: a rota interna é classificada como
`engine-service` em `docs/security-surface.md`, autenticada pelo token de
serviço compartilhado, não pelo JWT de um usuário — rotear por ela uma
requisição iniciada por humano borraria a classificação que o
`route-surface.spec.ts` impõe, e pularia `RequireRole('developer')` inteiro.

## Referências {#references}

- `apps/api/src/domain/agents/agent-areas.ts` — `addressableAgents`,
  `SOLO_CONVERSATIONAL_AGENTS`
- `apps/api/src/application/use-cases/agents/request-manual-handoff.use-case.ts`
- `apps/api/src/application/use-cases/agents/create-handoff.use-case.ts` —
  acréscimo de `actor?: Actor`
- `apps/api/src/interfaces/http/agents/agents.controller.ts` — `POST
  .../handoffs`
- `apps/web/src/lib/agents.ts` — `addressableAgents`,
  `SOLO_CONVERSATIONAL_AGENTS`
- `apps/web/src/routes/SessionPage.tsx` — `AGENTES_DE_CHAT`,
  `.manualHandoffRow`
- `docs/business-rules.md` — RN-440
- `docs/explanation/backlog.md` — a linha fechada "Manual handoff to an agent
  of choice"
