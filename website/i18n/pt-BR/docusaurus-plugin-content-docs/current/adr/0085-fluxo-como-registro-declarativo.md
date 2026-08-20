# ADR 0085 — Fluxo de papéis como registro declarativo (fluxo.yml)

## Status
Proposto

## Contexto
O produto tem três verdades sobre o time de agentes em três lugares:
o catálogo (`agent-areas.ts`, uma fonte, FASE 18), o controle
(`docs/gates.yml`, ADR 0054) e as RELAÇÕES — quem entrega o quê a
quem — que só existem implícitas em prompts, casos de uso e no
histórico de ADRs. Relação implícita não é auditável nem medível. O
modelo de time desenhado em ago/2026 (mapa de profissões de mercado →
agentes) produziu essa terceira peça sem lugar para morar, e a
auditoria contra o produto divergiu em quatro pontos justamente por
falta dela.

## Decisão
`docs/fluxo.yml` versionado, segregado por camada, com contratos por
papel: missão, entradas/saídas tipadas (artefato + origem/destino +
via), gate de saída referenciando gates.yml, status
(`active|planned|proposto|em-refinamento`) e absorções declaradas.
Regras:
- Papel `proposto` DECLARA quem o absorve hoje e o critério objetivo
  de separação — o organograma-alvo vira sequência de ativação, nunca
  aspiração.
- Papel que referencia gate inexistente no gates.yml reprova em teste;
  gate ativo sem papel dono reprova.
- Papel `em-refinamento` mantém código intocado e sai do fluxo formal;
  as pendências que a suspensão cria são declaradas no próprio arquivo.
- Relação com status `lacuna` é backlog rastreável, nunca promessa.

## Alternativas consideradas
- Manter implícito: rejeitado — foi a ausência desta peça que fez a
  auditoria divergir do produto.
- Fundir com gates.yml: rejeitado — controle e relação mudam por
  motivos diferentes (ADR 0054 declara travas; este declara contratos).
- Registrar só os papéis ativos: rejeitado — sem os `proposto` com
  critério, cada nova capacidade redescobriria o modelo do zero.

## Consequências
- A ativação de Staff/Platform e dos gates propostos
  (necessidade-validada, adr-aprovado, implementavel,
  prototipo-validado) vira mudança de dado + ADR próprio.
- Psicólogo/Anamnese em refinamento ficam com pendências visíveis
  (autor da proposta de teto RN-086; gatilho do Staff).
- A tabela de gatilhos do modelo-de-time.md é o roteiro de ondas
  futuras: cada gatilho dispara a separação de papel correspondente.

## Referências
ADR 0038, 0053, 0054; RN-083/086/087; FASE 15/18.
