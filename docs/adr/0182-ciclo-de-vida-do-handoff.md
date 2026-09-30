# 0182 — A oferta de handoff ganha ciclo de vida: uma pendente por destino, e `superseded`

## Status

**Accepted.** 2026-09-30 (AT-291 e AT-292, história HS-075, rodada 29; a AT-273
do vault se funde na AT-292 por decisão do dono). Sobre o
[ADR 0038](0038-hierarquia-de-agentes.md) (handoff externo endereça só lead de área
ou agente sem área, validado em `CreateHandoffUseCase`) e o
[ADR 0090](0090-qa-estrategia-e-appsec-segundo-momento.md) (o AppSec entrega o
threat model a três destinos). Não os edita: **acrescenta um estado e uma
invariante** à tabela `handoffs`.

## Context

Medido no código de `dev` em 2026-09-30:

- `HandoffStatus` declarava `offered | accepted | completed | rejected`, mas só
  `offered` e `accepted` eram gravados. Não havia expiração, supersessão nem
  dedupe.
- `CreateHandoffUseCase` inseria uma linha nova a cada chamada. Qualquer
  repetição virava oferta nova: o agente repetindo `offer_handoff`, o Criativo
  reconfirmando a prontidão, o Staff devolvendo outro RFC.
- `OfferInfraHandoffUseCase` não era idempotente. Duplo clique em "arquitetura
  pronta", ou duas abas, gravava o marco duas vezes e pedia ao engine dois
  turnos de fechamento do Arquiteto e duas ofertas ao Dev Lead — 2× Infra e 2×
  Dev Lead na tela.
- O AppSec (`criar_handoffs_appsec/3`) cria três ofertas por história com
  `run_design`, aos mesmos três destinos (`arquiteto`, `dev-lead`, `infra`). Com
  N histórias, 3N ofertas pendentes empilhadas.
- Uma oferta a um agente que já estava ativo ficava `offered` para sempre, e a
  tela a mostrava acionável: aceitar ativaria de novo quem já estava de pé.

## Decision

1. **Status novo `superseded`** (migration `0064`, só `ALTER TYPE … ADD VALUE`).
   A oferta que deixou de ser a vigente muda de status na LINHA, como o aceite já
   fazia, e ganha um evento `handoff.superseded` com `handoffId`, `toAgent`,
   `motivo` (`agente_ativado` | `nova_oferta`) e `substitutaId`. Nunca UPDATE
   em evento: o `handoff.offered` que anunciou a oferta fica como estava. O
   evento cai na sessão da oferta VELHA, com o ator `system`
   `handoff-lifecycle`, e entra mesmo em sessão encerrada (não é conversa,
   RN-581).

2. **No máximo UMA oferta `offered` por (projeto, destino).** A decisão é pura
   (`decidirOferta`, `domain/sessions/ciclo-de-vida-do-handoff.ts`):
   - sem pendente, cria;
   - pendente na MESMA sessão e a oferta nova não traz artefato novo (`null` ou
     igual) → devolve a existente (`desfecho: ja_oferecido`), sem linha nem
     evento. É o duplo clique, as duas abas, o agente repetindo a ferramenta;
   - qualquer outro caso (artefato NOVO, ou pendente noutra sessão) → cria a
     nova e SUBSTITUI a pendente (`desfecho: substituiu_oferta`).

   **Por que substituir, e não sempre devolver a existente.** O card pedia as
   duas opções e preferia não perder o artefato novo. Devolver a antiga quando
   o artefato mudou deixaria o brief reescrito (ou o RFC novo do Staff) sem
   oferta que o carregue. Devolver uma pendente de OUTRA sessão deixaria quem
   pediu sem nada para aceitar na conversa em que está — e, se a outra sessão já
   fechou, sem nada aceitável em lugar nenhum (RN-581 recusa aceite em sessão
   encerrada). Devolver só vale onde nada se perde: mesma sessão, mesmo
   artefato.

3. **Concorrência por lock consultivo de TRANSAÇÃO**
   (`pg_advisory_xact_lock(hashtextextended('handoff:<projeto>:<destino>'))`),
   não por índice único parcial. O índice exigiria limpar as duplicatas que já
   existem ANTES de criá-lo, na mesma migration — e o valor novo do enum não
   pode ser usado na transação que o cria. Limpar marcando `rejected` mentiria;
   limpar sem evento violaria a própria régua. Com o lock, as duplicatas de
   antes convergem na próxima oferta ou ativação daquele destino, COM evento. O
   lock é por destino, não por projeto: ofertas a destinos diferentes não se
   esperam.

4. **Oferta a agente já ATIVO no projeto é recusada**, 409 `agente_ja_ativo`,
   sem linha nem evento. Ativo = `agent.activated` para ele numa sessão do
   projeto que NÃO é terminal — a leitura da tela (`session-handoffs.ts`)
   estendida da sessão ao projeto; sessão encerrada para os conversacionais
   dela. A `message` é o texto que o modelo lê (RN-163): a ferramenta
   `offer_handoff` a repassa literal, e `FalhaDeTurno.origem/1` a classifica
   como `politica`, não `codigo`.

5. **Ativar agente substitui as ofertas pendentes a ele**, em QUALQUER sessão do
   projeto, pelos três caminhos que ativam: o aceite (que passa por
   `ActivateAgentUseCase`; a aceita já é `accepted` e não é tocada), a ativação
   direta e a ativação da execução (por `dev-<modulo>`).

6. **`OfferInfraHandoffUseCase` idempotente.** Cada destino (`infra`,
   `dev-lead`) com oferta pendente ou já ativo não é acionado de novo; com os
   dois assim, nada é gravado nem pedido ao engine (`desfecho: ja_oferecido`,
   `jaAtendidos` dizendo por quê). Só o que falta é acionado: Infra ativo e Dev
   Lead sem oferta pede só a do Dev Lead, sem turno do Arquiteto.

7. **AppSec só oferece a quem ainda não recebeu nem está ativo (RN-636).** O
   engine pergunta à api no modo `seAusente` (`create_handoff_if_absent/5`),
   em vez de consultar antes: a pergunta feita daqui seria corrida com outra
   oferta, e a api responde sob o lock do destino. "Já oferecido" e "já ativo"
   não viram `agent.error`; falha de verdade continua narrada por alvo
   (RN-116).

## Consequences

- **A tela ganha um status a mais.** `GET .../handoffs` devolve `superseded`, e
  as rotas de criação devolvem `desfecho`. Os tipos do web são regenerados aqui;
  o que a tela FAZ com o status novo (não oferecer como acionável, ler "ativo"
  do projeto) é da lane `handoff-web` (AT-293..295).
- **A corrida de dois cliques no MESMO instante em "arquitetura pronta" ainda
  grava o marco `architecture.readiness_confirmed` duas vezes.** Nenhuma oferta
  duplica (o lock), e o segundo turno do Arquiteto é recusado pelo engine com
  409 `turno_em_andamento` ([ADR 0163](0163-o-clique-responde-ao-aceitar.md)). Fechar também o evento exigiria segurar o
  lock durante a chamada ao engine, que é rede dentro de transação — recusado.
- **Oferta nova a agente ativo deixa de existir, e com ela o "reativar pela
  oferta".** Quem reescreve o brief com o PO já ativo recebe a recusa nomeada;
  o artefato fica no log e a conversa segue com o agente ativo. Quem precisa
  de uma nova rodada fecha a sessão em que ele está ativo.
- **A oferta do threat model de uma segunda história não nasce enquanto a da
  primeira estiver pendente** (RN-636). O artefato fica no log; o destino, ao
  ser ativado, lê os threat models do projeto. A oferta pendente não aponta
  para o mais recente — é o preço de não substituir a oferta que ainda espera
  aceite.
- **Ativação da execução substitui ofertas a `dev-<modulo>`, que hoje não
  nascem** (subagente não recebe handoff externo, ADR 0038). A chamada existe
  para a regra valer no dia em que a hierarquia mudar, e custa uma leitura por
  módulo.
- **As duplicatas de antes não são limpas pela migration.** Convergem na
  próxima oferta ou ativação ao mesmo destino. Um destino que nunca mais
  receber nem oferta nem ativação mantém as suas `offered`, como hoje.
