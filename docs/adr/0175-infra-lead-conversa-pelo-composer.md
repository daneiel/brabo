# 0175 — O Infra Lead conversa pelo composer, e antes o turno dele passa pelo `TurnoAssincrono`

## Status

**Accepted.** 2026-09-27 (AT-141). Decisão do mantenedor: **sim** — o Infra
Lead passa a conversar pelo composer e vira o SÉTIMO agente conversacional.
Referencia o [ADR 0163](0163-o-clique-responde-ao-aceitar.md) (o clique
responde ao aceitar), que este documento NÃO edita: o que ele decidiu para os
seis conversacionais passa a valer para o sétimo, pelo MESMO mecanismo.
Referencia também o [ADR 0038](0038-hierarquia-de-agentes.md) (a hierarquia de agentes, lead e
subagente) e o [ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md) (a
suspensão do Dev Lead, que o Infra Lead não tem). Regra:
[RN-617](../business-rules.md#rn-617). Fecha a decisão aberta que a
[RN-584](../business-rules.md#rn-584) deixou por escrito.

## Context

A [RN-584](../business-rules.md#rn-584) (AT-098) tirou o destinatário padrão da
mensagem de chat e deu ao `infra` uma recusa NOMEADA (`422
agente_sem_conversa`), deixando declarada a pergunta de produto: o Infra Lead
conversa pelo composer? E declarou o preço de responder "sim" sem preparo: o
`user_message/2` que o `InfraLeadServer` exportava rodava o turno INTEIRO
dentro do `handle_call`, com teto de 180 s no `GenServer.call`.

Medido no código antes da mudança, o Infra Lead estava fora de TODAS as peças
que o [ADR 0163](0163-o-clique-responde-ao-aceitar.md) e as RNs seguintes
deram aos outros seis:

| Peça | Os seis | O Infra Lead |
|---|---|---|
| Aceite imediato, `working` gravado antes ([RN-578](../business-rules.md#rn-578)) | `TurnoAssincrono.iniciar/3` | o turno inteiro no `handle_call`/`handle_cast` |
| Recusa nomeada `409 turno_em_andamento` | sim | a segunda mensagem esperava na fila do processo |
| "Parar" ([RN-122](../business-rules.md#rn-122)) | `via_for/2` do `cancel/2` | nem `via_for/2` o conhecia, nem havia Task para matar |
| Turno órfão no reinício ([RN-586](../business-rules.md#rn-586)) | `TurnoOrfao` | "fica de fora — declarado na RN-586" |
| Parar ao fechar a sessão ([RN-581](../business-rules.md#rn-581)) | `terminate/2` abandona a Task | morto depois de 5 s de espera |
| Teto de iterações narrado ([RN-166](../business-rules/autenticacao.md#rn-166)) | `toolloop.limit_reached` | o laço terminava calado no 14º passo |

Também o kickoff: sendo `cast`, ele não segurava clique nenhum, mas ocupava o
processo pelo turno inteiro — medido na instalação da AT-089, 8,4 min. Uma
mensagem que chegasse nesse meio tempo esperaria os 8,4 min na fila e sairia
por `:timeout` no controller (500), e "Parar" só seria atendido depois.

E o teto: o `propose_action` das ações de container que a api executa
auto-aprovadas espera até 225 s ([RN-605](../business-rules.md#rn-605)), mais
que os 180 s do `user_message/2`. Uma mensagem que levasse o modelo a propor
`container_start` podia estourar o `GenServer.call` com a proposta ainda de pé.

## Decision

1. **Primeiro o turno, depois a cláusula.** Os TRÊS turnos do Infra Lead —
   kickoff, correção de gate (`{:correct, _}`) e mensagem — sobem por
   `Engine.Agents.TurnoAssincrono`, o MESMO módulo dos seis. O kickoff continua
   `cast`, disparado só no start FRESCO do handoff aceito; o que muda é onde
   ele roda (numa Task). O `user_message/2` antigo, que rodava inline, deixou
   de existir: o nome ficou, e agora é o aceite — não há dois caminhos.
2. **A consolidação com o Workflows roda DENTRO da Task.** O fim do turno
   (`concluir/1`: HALT de `propose_infra_pr` → `WorkflowsAgent` → PR única)
   é parte da função de turno e devolve o `state`; os sinais de fim
   (`agent.done`, `agent.status: idle`) saem só de `TurnoAssincrono`, no
   processo do servidor ([RN-585](../business-rules.md#rn-585)). "Parar" mata
   também o Workflows em curso.
3. **A correção de gate não é descartada.** `TurnoAssincrono.iniciar/3` sem
   `from` ignora o pedido quando há turno em curso (o caso defensivo do
   kickoff). Para a correção isso perderia o pedido do gate, então ela entra
   numa FILA (`correcoes_pendentes`) e sobe no fecho do turno — sucesso,
   falha, crash ou "Parar" —, na ordem de chegada. É o molde do
   `handoff_dev_pendente` do Arquiteto.
4. **O Infra Lead entra nas listas do engine**: `@agentes_de_conversa` e a
   cláusula própria de `message/2` (a recusa da RN-584 sai), `via_for("infra")`
   no "Parar", e `TurnoOrfao` (`@agentes`). `Engine.Agents.Conversacionais` já o
   listava.
5. **O teto de iterações é o dele, 14**, o mesmo de Arquiteto, Dev Lead, UX
   Designer e Staff — e o 14º passo passa a emitir `toolloop.limit_reached`.
6. **A tela o oferece pela regra de sempre.** `infra` entra em
   `AGENTES_DE_CHAT` (`apps/web/src/lib/session-readiness.ts`): ele é o
   destinatário quando é o `agent.activated` mais recente, sem destinatário
   padrão ([RN-584](../business-rules.md#rn-584)). O aceite do handoff DELE
   continua no card próprio da [RN-499](../business-rules.md#rn-499), e o card
   do fio o exclui por NOME — senão o convite aparecia duas vezes e, por ser o
   mais antigo, voltaria a esconder o do Dev Lead (RN-136).
7. **Conversar não abre efeito externo.** As ferramentas são as mesmas quatro;
   a PR de infra e as duas subidas de container continuam nascendo
   `proposed_action`, com as recusas locais das RN-566/RN-577/RN-610 intactas.

## Consequences

- **O teto de 180 s deixa de importar para o turno.** O `GenServer.call` do
  `user_message/2` só espera o aceite (milissegundos); os 225 s do
  `propose_action` de container correm dentro da Task, sem ninguém esperando
  síncrono. O número 180 000 ficou, igual ao dos outros seis, como teto do
  ACEITE.
- **A mensagem durante o kickoff é recusada com nome.** Antes esperava; agora
  é 409 `turno_em_andamento`, com o `agent.error` durável — a mesma regra dos
  outros seis.
- **A lista gerada não muda.** `SOLO_CONVERSATIONAL_AGENTS` (gerada por
  `pnpm --filter api gerar:areas`) é a dos agentes SEM área que um handoff
  manual endereça; o Infra Lead é lead de área e continua fora dela.
  `AGENTES_DE_CHAT` não é gerada: é a lista que a guarda
  `scripts/ci/destinos-do-composer.spec.ts` confronta com as cláusulas.
- **A tela narra as ferramentas dele.** As quatro ganharam frase na faixa de
  atividade (`toolNarration.json`), em vez do fallback.
- **Declarado e não fechado:** o Infra Lead não tem `ask_structured_questions`
  nem leitura de backlog — conversar com ele é conversar com o que o kickoff
  lhe deu e com as ferramentas de sempre, e ampliar isso é frente própria. A
  mensagem não reexecuta o kickoff: um Infra Lead reerguido por uma mensagem
  (engine reiniciado) reidrata o histórico e responde, sem regerar artefatos.
