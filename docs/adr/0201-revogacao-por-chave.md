# 0201 — A revogação mira a CHAVE, e não o par `{projeto, usuário}`

## Status

**Accepted.** 2026-10-01 (AT-013, história HS-008, épico EP-003, rodada 36;
decisão do dono em 01/10: *"sim, revogação por CHAVE, com ADR — coluna da chave
no ticket do socket e contrato novo de auth; revogar derruba só as conexões
abertas com aquela chave. Mexe no engine, de propósito."*). Revisa a
[RN-520](../business-rules.md#rn-520) — que nasceu no
[ADR 0147](0147-agente-local-com-capacidades.md) ponto 6 — e referencia, sem
editá-los, o [ADR 0154](0154-chave-de-dispositivo-de-maquina.md) (a chave de
MÁQUINA, que pôs *"Revogação por chave"* entre o que NÃO fazia) e o
[ADR 0155](0155-a-primeira-conta-nasce-no-terminal.md) (a chave de máquina que
nasce no terminal e que a instalação registra). Regra nova:
[RN-685](../business-rules.md#rn-685).

## Context

Desde a RN-520, revogar uma chave de dispositivo derruba a conexão VIVA do
runner, e não só o ticket seguinte. O alvo dessa queda era `{projeto,
usuário}`, e a RN-520 dizia por quê: a identidade da credencial que pediu o
ticket — o `kid` da chave (que é o id do registro, RN-475) ou o PAT — morria no
`PatAuthGuard`. `runner_socket_tickets` guardava `project_id`, `user_id` e
`kind`, e mais nada; o canal só sabia comparar o usuário.

Medido no código antes de mudar (`origin/dev`, `ec0fbea52d`):

- **Como o ticket nasce.** `POST /projects/:projectId/runner-ticket` passa pelo
  `PatAuthGuard`, que autentica por PAT (`validarEUsar` devolve `{id, userId,
  projectId}`) ou por chave de dispositivo (o `kid` do header do JWT acha a
  pública em `runner_device_keys`; `chave.id` é esse `kid`). O guard punha só
  `request.user`. `RequestRunnerTicketUseCase` pedia ao engine
  `POST /internal/projects/:projectId/runner-tickets` com `{userId, kind}`, e
  `Engine.Runners.SocketTicket.emitir/3` gravava a linha.
- **Como o engine consome.** `EngineWeb.RunnerSocket.connect/3` valida o ticket
  e põe `project_id`/`user_id`/`kind` em `assigns`; o `id/1` do socket era
  `runner_socket:<kind>:<projectId>:<userId>`; o `join/3` do canal consome e
  registra a presença em `Engine.Runners.Registry` (`:global`, no máximo UM
  runner por projeto no cluster).
- **Onde a revogação derrubava.** `RevokeRunnerDeviceKeyUseCase` grava a
  revogação e chama `disconnectRunnerOfUser(projectId, userId)` —
  `POST /internal/projects/:projectId/runner/disconnect` —, o engine acha o pid
  pelo `Registry`, o canal compara `user_id` e difunde `disconnect` para o
  PRÓPRIO id. Para a chave de MÁQUINA (projeto nulo) o PR #534 fez o alvo
  PLURAL: o mesmo par, uma vez por projeto em modo `runner` que o dono alcança
  (`listRunnerModeReachableBy`).
- **O que cai hoje que não devia.** O runner do mesmo usuário conectado com PAT,
  ou com outra chave, naquele projeto. Com a chave de máquina, o custo
  multiplica: revogar a chave do laptop derruba o agente do desktop em todo
  projeto em que os dois se cruzem.
- **O que NÃO cai hoje e devia.** (1) A conexão da chave de máquina num projeto
  que a lista da api não tem — papel do dono que caiu, projeto convertido de
  modo com o runner de pé. (2) O ticket pedido segundos ANTES da revogação e
  usado DEPOIS: o `connect/3` e o `join/3` não perguntam pela credencial. (3)
  Revogar um PAT não derrubava nada — só impedia ticket novo.

A AT-013 ficou bloqueada por duas razões empilhadas: estava fora do recorte da
FASE 30, e mudar o alvo é mudar o que "revogar" significa. O dono decidiu.

## Decision

1. **O ticket registra QUAL credencial o pediu.** Duas colunas NULÁVEIS em
   `engine.runner_socket_tickets` — `credential_kind` (`"device_key"` |
   `"pat"`) e `credential_id` (o `kid`, ou o id do PAT) —, migration Ecto
   `20261001120000_add_credential_to_runner_socket_tickets.exs`, aditiva, sem
   backfill (os tickets vivem 30 s). A tabela é do ENGINE (schema `engine`),
   então a migration é dele; o diário do Drizzle não muda (segue em `0068`).
   Nulo é estado legítimo: o ticket de `terminal` é da aba da web, autenticada
   por sessão, e o de `runner` emitido por uma api anterior a este ADR chega
   sem ela durante o rollout.

2. **O contrato de auth passa a carregar a credencial até o engine.** O
   `PatAuthGuard` preenche `request.credencialDeDispositivo` (`{tipo: 'pat', id}`
   ou `{tipo: 'device_key', id: chave.id}`) depois de autorizar; o controller
   repassa; `RequestRunnerTicketUseCase` a manda só no `kind: "runner"` (o de
   `terminal` nunca leva, mesmo se alguém passar uma); o pedido interno ganha
   `credentialKind`/`credentialId`, que só viajam juntos. O engine normaliza o
   par (`SocketTicket.credencial/2`): espécie desconhecida ou id vazio viram
   `nil`, nunca uma credencial inventada — e o ticket continua servindo.

3. **O engine guarda a credencial no socket.** `connect/3` põe
   `assigns.credencial`, e o `id/1` ganha dois segmentos quando ela existe —
   `runner_socket:<kind>:<projectId>:<userId>:<espécie>:<id>` —, de modo que o
   `disconnect` que o canal difunde para o PRÓPRIO id alcança só as conexões
   daquela credencial. Sem credencial, o id é o de antes.

4. **A revogação de UMA credencial tem rota própria e alvo próprio.**
   `POST /internal/runner/disconnect-credential` (sem `:projectId`: a chave de
   máquina não tem um), `Engine.Runners.Revogacao.derrubar_credencial/4`:
   1. **anula os tickets PENDENTES da credencial** (`consumed_at` preenchido —
      o mesmo estado de "já usado" que `validar/1` e `consumir/2` recusam,
      nenhum estado novo), fechando a janela entre emitir e usar;
   2. **pergunta a TODO runner registrado no cluster** (`Registry.todos/0`) se
      ele nasceu desta credencial — só o canal sabe, porque a credencial mora
      em `assigns`. Quem nasceu dela cai (transporte + `{:stop, …}` que libera
      a presença); quem não nasceu responde `:intocado` e fica de pé;
   3. responde 200 com um BALANÇO (`derrubados`, `legados`, `intocados`,
      `semResposta`, `ticketsAnulados`), com teto de 5 s para o CONJUNTO. 400
      só para credencial fora de forma — para "não mirei nada" nunca passar por
      "não havia nada".

   A chave de MÁQUINA deixa de ser o par aplicado N vezes: é UM pedido, e ela
   cai em todo projeto em que abriu conexão, inclusive num que a api não
   listaria.

5. **A revogação de chave e a de PAT usam esse alvo.**
   `RevokeRunnerDeviceKeyUseCase` (e, por delegação, a porta da Conta, RN-611)
   pede a queda por `{tipo: 'device_key', id}`; as duas revogações de PAT (a do
   dono, RN-426, e a do `maintainer`, RN-427) passam a derrubar por
   `{tipo: 'pat', id}` — antes não derrubavam nada. A ordem não muda: revoga
   PRIMEIRO, derruba depois, e derrubar é efeito colateral que só LOGA.

6. **Não deixar de derrubar o que já caía (a proibição da AT-013).** Duas peças
   de TRANSIÇÃO, e nenhuma delas é o alvo:
   - **A conexão LEGADA** (ticket sem credencial) do mesmo dono, num dos
     projetos que a api manda como alcance (o da linha, ou os candidatos da
     máquina), cai pelo par como antes (`:derrubado_legado`). Só para chave de
     dispositivo: o PAT não derrubava nada antes, então não ganha alcance
     legado — ganharia uma queda que nunca teve, sobre quem não tem nada com
     ele.
   - **O PLANO B**: se o engine não atende o pedido por chave (um engine
     anterior a esta rota responde 404), a revogação de chave volta ao alvo
     antigo, `disconnectRunnerOfUser` por projeto. Derrubar a mais é
     reversível; deixar de derrubar reabriria a RN-519.

7. **`{projeto, usuário}` continua existindo, com OUTRO dono.**
   `POST /internal/projects/:projectId/runner/disconnect` e
   `Revogacao.derrubar/3` ficam byte a byte (com o id do socket mais fino): é o
   alvo da REMOÇÃO DE MEMBRO (RN-615), que tira a PESSOA do projeto e precisa
   derrubar qualquer conexão dela, com a credencial que for — além do plano B
   acima.

8. **A tela muda o texto, não o comportamento.** A confirmação de revogar —
   na seção de chaves de dispositivo das Configurações e na de chaves de
   máquina da Conta — troca o "colateral" (*"outro runner seu no mesmo projeto
   também cai"*) pela PRECISÃO (*"só cai o que se conectou com ESTA chave"*),
   porque a RN-561 exige que a tela diga o alcance certo e a frase antiga
   passaria a afirmar uma queda que não acontece. É a resposta ao
   `TODO(humano)` da AT-013 (*"a tela muda de comportamento ou só de
   rótulo?"*): só de rótulo — o clique, a rota e a invalidação são os mesmos.

9. **O runner não muda.** Ele já mandava o `kid` no header do JWT, e é tudo que
   o caminho precisa. Nenhuma linha de `apps/runner/`.

## O que este ADR NÃO faz

- **Não muda o que AUTORIZA.** Nenhum teto novo, nenhum afrouxado: o
  `PatAuthGuard` decide como sempre, e a credencial só é ANOTADA depois de
  autorizar. Este ADR move o alvo da queda, nunca a autoridade.
- **Não derruba a aba Terminal da web.** O socket `kind: "terminal"` não tem
  credencial de dispositivo, não ocupa o `Registry` e nunca é perguntado — como
  antes.
- **Não fecha o ticket emitido e ainda não CONECTADO com credencial de api
  antiga.** Um ticket sem credencial (emitido por uma api anterior) não é
  anulado na revogação: não há o que comparar. A janela é de 30 s e só existe
  durante o rollout.
- **Não dá à visão de `maintainer` a revogação de chave de outro usuário.**
  Segue fora por decisão da RN-519.

## Consequences

- **Outro runner do mesmo usuário fica de pé.** O custo que a RN-520 declarava
  some: revogar a chave do laptop não derruba o desktop conectado com outra
  chave, nem o runner conectado com PAT.
- **Revogar a chave de máquina é UM pedido, e mais completo que o plural.**
  Ele alcança projetos que a lista da api não tem. O preço é perguntar a TODO
  runner do cluster — linear em runners conectados, só quando alguém revoga, e
  com teto de 5 s para o conjunto.
- **Revogar PAT passa a derrubar.** É mudança de comportamento observável: o
  runner conectado com um token revogado cai na hora, em vez de seguir até
  reconectar. Para a revogação do `maintainer` (resposta a incidente, RN-427)
  é o que faltava para ela conter alguma coisa.
- **O balanço substitui o desfecho único** no log da revogação de chave. Os
  quatro desfechos de `derrubar/3` seguem existindo para a remoção de membro.
- **Rollout sem ação do operador.** A migration é aditiva e roda no job de
  migração de sempre (`Engine.Release.migrate/0`). Api nova com engine velho:
  os campos novos do pedido de ticket são ignorados e a revogação cai no plano
  B. Api velha com engine novo: tickets sem credencial, que caem pelo par
  (legado), e a revogação velha continua chamando a rota do par, que não
  mudou. Por isso a branch é `feature/` e não `breaking/`.
- **O id do socket do runner muda de forma.** Nada de fora o lê — é o tópico
  interno do `disconnect` do Phoenix —, e o socket aberto antes do deploy
  morre com o pod antigo.
- **Prova do engine só no CI.** O ExUnit (canal real com credencial, PAT que
  fica de pé, máquina em dois projetos sem lista, legado pelo par, ticket
  pendente anulado, controller 200/400) foi escrito sem rodar localmente
  (`repo.hex.pm` dá 403 neste ambiente); sintaxe e formatação conferidas.
