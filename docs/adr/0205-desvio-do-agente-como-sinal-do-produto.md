# 0205 — O desvio do agente que a Anamnese observa vira sinal do produto, sem dado pessoal

## Status

**Accepted.** 2026-10-02 (AT-356 parte 2, decisão do dono em 02/10: *"Sim,
sinal do produto"*). Complementa o
[ADR 0196](0196-anamnese-religada-com-sujeito-e-fato-do-perfil.md) sem editá-lo:
a Anamnese continua mantendo o perfil da PESSOA; o que este ADR acrescenta é um
segundo registro, sobre os AGENTES.

## Context

Na loja-teste de 02/10 (AT-376) a Anamnese leu como traço do usuário o que era
falha de agente: *"Não vi o handoff aparecer. Pode passar ao Arquiteto?"* virou
"driver de continuidade" — era a pessoa cobrindo a falha do PO. O mesmo vale
para agente em laço e para turno cancelado pelo usuário. Esse sinal tem valor,
mas para quem melhora o PRODUTO, e não para o perfil de quem o produziu.

Medido em `dev` antes de mudar: a Anamnese só tinha verbos sobre a pessoa
(`emit_proficiency`, `skip_proficiency`) e sobre instruções/teto
(`propose_instruction_patch`, `propose_max_parallel`, que viram
`proposed_action`). Não havia onde dizer "o agente X desviou" sem atribuir isso
a alguém.

## Decision

1. **Evento durável próprio, `anamnese.agent_deviation`**, gravado no event log
   da sessão da rodada pela ferramenta nova `report_agent_deviation`
   (`:direct`, não termina a rodada, ator `agent`/`anamnese`).
2. **Sem dado pessoal, por construção.** O payload é montado no engine por
   lista de PERMITIDOS: `agente`, `tipo` (vocabulário fechado: `laco`,
   `cancelamento_pelo_usuario`, `reparo_pelo_usuario`) e `evidenceEventIds`
   (deduplicados, teto de 20). Não há campo de texto livre — é nele que o modelo
   escreveria nome ou traço. Sessão e projeto vêm do envelope do evento. Campo
   extra que o modelo invente é descartado.
3. **Fora do grafo do usuário.** `GraphEventTranslator` NÃO traduz o tipo: o
   grafo é memória da PESSOA (perfil, fatos aceitos), e o sinal não é dela. Um
   teste fixa a ausência em `EVENTOS_DO_LOG_PROJETAVEIS`.
4. **Leitura por evento, sem tela nova.** Quem melhora o produto lê por
   consulta ao event log (`session_events` com `type =
   'anamnese.agent_deviation'`). A aba Insights não ganha leitura agora: ela é
   por projeto e para quem decide, e o leitor deste sinal é o mantenedor do
   produto.

## Consequences

- O perfil do usuário deixa de absorver falha de agente: o kickoff manda
  registrar o reparo como desvio (RN-716/RN-717).
- **Lacunas declaradas:** a api não confere que os `evidenceEventIds` existem
  (o append interno não valida payload deste tipo); não há agregação nem tela;
  e o reconhecimento do desvio é do modelo — o código só garante a forma e a
  ausência de dado pessoal.
- Mudar o vocabulário de `tipo` é mudança deste contrato, com RN.
