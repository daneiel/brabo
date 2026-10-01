# 0191 — A mensagem que chega com turno em curso entra numa fila persistida e é lida no fim do turno

## Status

**Accepted.** 2026-10-01 (AT-267, decisão do dono de 01/10). Revisa, só para a
MENSAGEM do usuário, a recusa síncrona `turno_em_andamento` do
[ADR 0163](0163-o-clique-responde-ao-aceitar.md). O ADR 0163 não é editado: o
aceite imediato que ele decidiu continua valendo, e a recusa nomeada continua
valendo para os comandos que não são fala (revisão de história do PO,
prontidão do Criativo, oferta de handoff do Arquiteto). Regra:
[RN-673](../business-rules.md#rn-673).

## Context

Desde o ADR 0163 uma mensagem que chegava a um agente conversacional no meio
de um turno era recusada com 409 `turno_em_andamento` e um `agent.error`
durável. Isso fechou o silêncio — antes o 409 era um 202 calado —, mas não o
defeito: a api grava o `chat.message` ANTES de falar com o engine
(`SendAgentMessageUseCase`), então a mensagem ficava no fio com cara de dita e
nunca chegava ao modelo. A tela pedia "mande de novo quando ele terminar".

O uso real de 2026-09-29 (sessão `be70`) mediu três desses no mesmo dia, um em
cada agente: seq 100 (PO, 06:28), seq 268 (Infra Lead, 06:39 — "infra ainda
está executando") e seq 312 (Dev Lead, 06:46 — "ok"). As três estão gravadas
como `chat.message` e nenhuma foi lida. Reproduzido no código desta árvore:
`TurnoAssincrono.iniciar/3` respondia `{:error, :turno_em_andamento}` com
`from` e turno em curso, e `AgentCommandController.responder_ao_aceite/2` o
convertia em 409 — o teste `agent_command_controller_test.exs` ("turno já em
curso: 409 nomeado") fixava exatamente esse desfecho.

O único precedente de fila era o do Infra Lead (`correcoes_pendentes`, RN-617):
EM MEMÓRIA, para correção de gate, nunca para fala do usuário — e perdida num
restart do engine.

A decisão do dono (01/10), que é o requisito:

1. a mensagem que chega com turno em curso entra numa fila **persistida**, que
   sobrevive a restart;
2. **N mensagens = 1 turno**: no fim do turno em curso, as pendentes são lidas
   juntas, na ordem, num turno só;
3. **cada uma pode ser cancelada** enquanto pendente, por quem a enviou, com o
   mínimo de papel que a rota de mensagem já exige;
4. **teto de 10** pendentes por agente e sessão, e acima disso recusa nomeada;
5. vale para os SETE conversacionais pelo mesmo caminho (`TurnoAssincrono`),
   nunca por servidor.

## Decision

**A fila mora em `TurnoAssincrono`, e o estado dela mora no event log.**

- `TurnoAssincrono.receber_mensagem/4` substitui o `iniciar/3` direto nos sete
  `handle_call({:user_message, …})`. Sem turno e sem fila, sobe o turno como
  sempre (`:ok`, 202). Com turno em curso e fila abaixo de 10, enfileira,
  grava `chat.message_queued` e responde `{:ok, :enfileirada, posicao}` —
  202 também, com o corpo `{entrega: "enfileirada", posicao}`. Com a fila no
  teto, `{:error, :fila_de_mensagens_cheia}`: 409 nomeado e `agent.error`
  durável (a mensagem está gravada e NÃO será lida — a mesma honestidade que o
  ADR 0163 exigiu da recusa antiga).
- **O servidor só diz como uma fala vira turno.** Cada um dos sete passou a ter
  `turno_de_mensagem/2` (a mesma montagem que o `handle_call` fazia inline) e a
  guarda no state (`:montar_turno_de_mensagem`). `TurnoAssincrono` decide
  QUANDO; o servidor, COMO. Nenhum servidor ganhou fila própria.
- **No fim do turno — `finalizar/1`, nunca `suspender/1` — a fila vira UM
  turno.** A entrega é uma mensagem a si mesmo
  (`:entregar_fila_de_mensagens`), não uma chamada dentro do fecho, porque o
  servidor ainda tem o próprio fecho no mesmo `handle_info` (o Infra Lead
  drena a correção de gate, o Arquiteto o handoff ao Dev Lead) e não pode
  encontrar um turno da fila já de pé. As pendentes viram um texto só
  (`FilaDeMensagens.texto_do_turno/1`: uma é ela mesma; várias, numeradas na
  ordem, com uma linha dizendo que são várias), e `chat.message_delivered`
  lista os ids. O idioma do turno é o do autor da mensagem MAIS RECENTE
  (RN-622). A fila que importa é a do state ATUAL, nunca a do resultado da
  Task, que capturou o state do início do turno.
- **A mensagem que chega entre o fim do turno e a entrega entra no FIM da
  fila**, e a fila inteira é entregue na hora — a mais nova nunca passa na
  frente das que esperavam.
- **Três eventos imutáveis, todos com o id do `chat.message`.**
  `chat.message_queued` (agente; `mensagemId`, `texto`, `idioma`, `posicao` —
  o texto vai junto porque é o que a fila precisa reler depois de um restart),
  `chat.message_delivered` (agente; `mensagemIds`) e `chat.message_cancelled`
  (ator `user`, quem cancelou; `mensagemId`, `agente`). Pendente é enfileirada
  e nem entregue nem cancelada — a mesma derivação no engine
  (`FilaDeMensagens.pendentes/2`) e na tela (`estadosNaFila`). Nenhuma tabela.
- **Restart.** O `init/1` dos sete reconstrói a fila do log
  (`TurnoAssincrono.fila_ao_subir/3`) e agenda a entrega; a
  `Reidratacao` tira do histórico a cancelada (nunca foi dita) e a pendente
  deste agente (chegará pelo turno da fila — sem isso entraria duas vezes). No
  boot, depois de fechar o turno órfão (RN-586), o `Rehydrator` acorda o agente
  que tem fila pendente (`FilaDeMensagens.acordar_pendentes/2`): sem isso a
  fila de quem estava no meio de um turno quando o engine caiu esperaria alguém
  escrever de novo. O turno interrompido continua NUNCA refeito — o que se lê é
  a mensagem que nenhum turno leu.
- **Cancelar.** `POST …/agents/:agent/messages/:messageId/cancel`
  (`developer`, o mesmo da rota de mensagem). A api confere que a mensagem é um
  `chat.message` desta sessão, que o ator dela é o chamador (403
  `mensagem_de_outra_pessoa` senão) e que a sessão aceita conversa (RN-581).
  Quem decide se ela ainda está na fila é o processo do agente, que serializa a
  corrida com a entrega: 409 `mensagem_fora_da_fila` quando já foi lida ou
  cancelada. Com o agente fora do ar não há fila em memória — a fila é o log —
  e o engine grava o cancelamento direto.
- **Turno suspenso em aprovação (Dev Lead, RN-284) segue recusando**, com
  `aguardando_aprovacao`. Foi considerado usar a mesma fila e recusado: o
  turno suspenso não tem fim previsto (depende de um humano decidir em
  Aprovações), e enfileirar seria prometer leitura "no fim do turno" sem fim à
  vista. A mensagem que já estava na fila quando o turno suspendeu espera a
  RETOMADA terminar — a entrega pula estado suspenso.
- **A tela.** O composer deixa de travar durante o turno quando a mensagem vai
  a um agente: o botão vira "Pôr na fila", a mensagem não arma turno novo (o em
  curso segue sendo o acompanhado) e aparece no fio com o selo "na fila de
  <agente>" e, para quem a enviou, o botão de cancelar. Cancelada fica riscada.
  O chat sem agente (SSE) continua travando: lá não há fila.

## Consequences

- **A recusa `turno_em_andamento` não sumiu.** Ela continua para revisão de
  história, prontidão e oferta de handoff, que chamam `iniciar/3` com `from`.
  Quem ler o ADR 0163 sozinho vai achar que a mensagem ainda é recusada; a
  RN-578 aponta para cá.
- **O texto da mensagem fica duas vezes no log** quando ela entra na fila (no
  `chat.message` e no `chat.message_queued`). Custo aceito: sem ele, uma fila
  cujo `chat.message` saiu da janela de 200 eventos não se reconstruiria.
- **A leitura da fila no `init/1` é uma consulta a mais por subida de agente**
  (por tipo, com o teto de 200 do ADR 0060). Mais de 200 eventos de fila numa
  sessão faria a reconstrução ver só os mais recentes — declarado, não
  medido; o teto de 10 pendentes torna isso improvável, não impossível.
- **Acordar no boot gasta token sem ninguém clicar** — em nome de mensagens que
  o usuário mandou e que nenhum turno leu. É a diferença deliberada para a
  RN-586, que não refaz o turno: o turno interrompido pode ter tido efeito; a
  mensagem pendente, nenhum.
- **O cancelamento com o agente fora do ar tem uma janela:** o agente pode
  estar subindo (lendo a fila do log) no mesmo instante em que o cancelamento é
  gravado. Não há trava; a mensagem pode ser lida. Declarado.
- **Mensagens para outro agente com turno em curso na tela.** A tela acompanha
  um turno por vez; mandar a um agente OCIOSO enquanto outro trabalha sobe o
  turno dele (`entrega: lida`) e a tela passa a acompanhá-lo pelo log. O
  seletor de destinatário continua travado durante o turno, como antes.
- **Sessão encerrada.** Os agentes param (RN-581) e a fila morre com eles; a
  mensagem que estava pendente fica "na fila" no log para sempre, e a tela não
  oferece cancelar numa sessão inativa. Se a sessão for reaberta (ADR 0183) e
  o agente subir de novo, o `init/1` dele entrega a fila — consequência
  aceita, não desenhada à parte.
- **Só o CI prova o engine.** Nesta árvore o `repo.hex.pm` responde 403 e a
  suíte ExUnit não roda localmente; os testes novos
  (`fila_de_mensagens_test.exs`) e os ajustados foram escritos contra os fakes
  existentes e verificados só por parser e formatador.
