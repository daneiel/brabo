# 0214 — Pergunta em aberto vira pendência a resolver

## Status

**Accepted.** 2026-10-11 (AT-521; decisões do dono em 11/10). Estende o
[ADR 0207](0207-ciclo-de-gate-velho-estaciona.md) (estacionamento de ciclo de
gate) e REVISA uma parte do [ADR 0212](0212-historia-arquivada.md) (correção de
história). Regras em RN-858, RN-859, RN-860 e RN-861.

Tema: `gates`. O mecanismo que muda comportamento de verdade é o veredito novo
do QA, que não consome ciclo e estaciona pelo mecanismo do ADR 0207; o registro
e a fila existem para que esse veredito tenha a quem perguntar.

## Context

Medido no TP-01 (14ª rodada):

- O Criativo deixou **quatro perguntas** ao usuário só no TEXTO da resposta.
  Nenhuma virou registro; nada na tela as listava depois que o fio rolou.
- O QA reprovou `GET /:codigo` por "não confirmado pelo usuário" até ESGOTAR o
  ciclo de correção (RN-762) — **duas vezes**. A segunda veio DEPOIS de o dono
  responder no chat: a história já estava `ready`, o ADR 0212 só deixa corrigir
  história `draft`, e o QA lia a DoR da história, que continuava dizendo "não
  confirmado". O dev não tinha o que corrigir: a decisão era do usuário, e
  `changes_requested` gastava um ciclo a cada volta.

Faltavam três coisas: um REGISTRO da pergunta com estado, um VEREDITO que
diga "isto depende do usuário" sem punir o dev, e um caminho para a RESPOSTA
chegar a quem trabalha (contexto do dev, recorte do QA, a própria história).

## Decision

### 1. O registro

- `artifact.open_question` (append-only, no log da sessão onde nasce):
  `{ questionId, pergunta (≤ 500), sugestao (≤ 300, opcional),
  afeta: { regras, historias, tarefas }, autor, sessionId }`.
- Fecha com `open_question.answered`
  `{ questionId, resposta, aceitouSugestao, decisionEventId, respondidaPor }`.
  O STATUS sai do log (aberta = sem `answered`), nunca de tabela.
- A resposta grava um `decision_record` (ator: o usuário) com `context` = a
  pergunta, `choice` = a resposta, `consequences` = o que afeta, e o
  `questionId`. É o mesmo artefato genérico da RN-505.

### 2. A origem é só a ferramenta

`declare_open_question` (Criativo, PO, Arquiteto, Dev Lead), com UMA frase de
instrução CENTRAL, não repetida por servidor: "Toda dúvida que você deixar
para o usuário vira `declare_open_question`, com a sua sugestão e o que ela
afeta; não termine o turno com pergunta só no texto."

### 3. Quem responde

Só o AUTOR da sessão onde a pergunta nasceu. Para a pergunta do QA, o autor da
sessão de execução (quem ativou a execução). Os outros membros veem a pergunta
com o controle inerte e o motivo em texto (ADR 0064).

### 4. As rotas

- `GET /projects/:projectId/open-questions?status=open|answered|all` —
  `viewer`, `limit` 50 com o total (RN-180).
- `POST /projects/:projectId/open-questions/:questionId/answer` — corpo
  `{ resposta }` ou `{ aceitarSugestao: true }`; 403 `so_o_autor_da_sessao`,
  409 `pergunta_ja_respondida`, 404 para pergunta de outro projeto.

### 5. A prontidão avisa e segue

"Estou pronto" (Criativo) e "Confirmar arquitetura pronta" mostram "N
perguntas seguem abertas — responder", com atalho para a fila. Não bloqueiam.

### 6. O veredito `needs_user_decision`

`emit_qa_verdict` ganha `needs_user_decision` com `{ pergunta, sugestao }` (ou
um `openQuestionId` existente). A api NÃO incrementa o contador de correção
(RN-762), grava a `open_question` (autor `qa-agent`, afetando a tarefa) e o
ciclo fica ESTACIONADO pelo mecanismo do ADR 0207 (`gate.rescue_parked`). A
tarefa aparece como "esperando você". Responder a pergunta religa o gate por
`GateRescuer.retomar_estacionado/3` (o caminho da RN-724), e o QA julga com a
decisão no contexto. Na consolidação do QA Lead, `needs_user_decision` de uma
subespecialidade vence `approved`. Régua do recorte do QA: requisito marcado
"não confirmado pelo usuário" (ou contradito por decisão vigente) →
`needs_user_decision`, nunca `changes_requested`.

Isto ESTENDE o ADR 0207: lá o ciclo estacionava por tempo parado; aqui
estaciona também por decisão do usuário pendente. O gesto de retomar é o
mesmo mecanismo, disparado pela resposta.

### 7. A decisão chega a quem trabalha

`GET .../dev-context` devolve `decisoes` — as ligadas à história/tarefa por
`afeta`, teto 10 e 1 500 caracteres. O kickoff do dev e o recorte do QA
mostram "Decisões do usuário — vencem RF/DoR quando conflitam".

### 8. O PO corrige história `ready` por resposta do usuário (revisa o ADR 0212)

O que MUDA no ADR 0212: `recusaDeCorrecaoDeHistoria` passa a aceitar história
`ready` quando o pedido de correção cita um `questionId` RESPONDIDO; o PO
recebe a resposta e corrige RF/DoR. O que NÃO muda: a recusa com tarefa
`in_review` (e `in_progress`) continua; arquivar continua só para `draft`; a
correção de `ready` sem `questionId` respondido continua recusada; a edição
pelo usuário na aba Backlog segue a régua do 0212.

### 9. A tela

Fila "Perguntas em aberto" no bloco de pendências do chat, com título e
contagem próprios (nunca somada às outras filas, RN-467): pergunta, quem
perguntou, o que afeta, a sugestão com "Aceitar sugestão" e um campo curto com
"Responder" — os dois só para o autor da sessão. O aviso "N perguntas em
aberto" fica junto de "Estou pronto" e "Confirmar arquitetura pronta".

## Consequences

- Custo de token: ~60 tokens por turno conversacional (a frase central e a
  descrição da ferramenta) e até ~400 no recorte do QA / kickoff do dev quando
  há decisões ligadas (teto de 10 e 1 500 caracteres).
- O ciclo de correção deixa de ser gasto com o que o dev não pode resolver.
- A pergunta tem dono: o autor da sessão. Membro que não é o autor não
  destrava — preço declarado (ver Alternativas).
- O que NÃO muda: os tetos absolutos (RN-418), o merge manual em branch
  protegida, o teto de ciclo de correção (só deixa de contar este veredito), a
  régua de arquivar do ADR 0212, e o estacionamento por tempo do ADR 0207.

## Alternatives considered

- **Bloquear a prontidão com pergunta aberta.** Recusada: a pergunta pode ser
  de detalhe que não impede o PO de seguir; bloquear trocaria um esquecimento
  por um travamento. Avisar com atalho resolve o esquecimento.
- **Detectar perguntas no texto do agente.** Recusada: heurística sobre prosa
  erra nos dois sentidos e cria pendência que ninguém declarou. A origem é a
  ferramenta, e a instrução central é o que faz o agente usá-la.
- **QA seguir com a sugestão do agente.** Recusada: aprovar sobre um palpite
  esconde a decisão do usuário e é exatamente o requisito "não confirmado" que
  o QA existe para não deixar passar.
- **Qualquer membro `developer` responder.** Recusada por decisão do dono: a
  pergunta é sobre a intenção de quem conduziu a sessão; outro membro
  respondendo trocaria a decisão de dono sem que ele soubesse.
