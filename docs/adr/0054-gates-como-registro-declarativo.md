# 0054 — Gates como registro declarativo

## Status

Proposto

## Contexto

Os gates do fluxo (QA, SecOps, promoção manual de story, plano de adoção, merge
manual, pipeline de proposed_actions) existem e foram validados por execução
real (ADR 0020, 0044–0046), mas estão **implícitos**: espalhados entre prompts
de agente, código do engine, regras puras da api e convenções do CLAUDE.md.

A lição da Fase 10/13 — métrica extraída por script, nunca anotada — não tem
como ser aplicada a um gate que não é enumerável.

O [ADR 0048](0048-decisao-no-log-e-a-ordem-do-gate.md) resolveu a metade de
baixo desse problema: pôs a decisão de ação no event log, com o ator real, e
fez `proposed_action.created` carregar o `status` — que é o que distingue "o
usuário clicou" de "a política decidiu sozinha". Sem aquilo, medir passagem de
gate seria contar eventos que não existiam. Este ADR é a metade de cima: dizer
QUAIS gates existem, para que o que o 0048 tornou observável fique também
enumerável.

## Decisão

Registro declarativo em `docs/gates.yml`, versionado, com schema: `id`, fluxo,
dono (agente/área/usuário), entradas, entregável, `verificacao` (script |
humana), `severidade` (block | warn), `aprovacao_humana`, `status` (active |
planned).

Regras:

- Gate sem script de verificação nasce `warn`; promoção a `block` exige o
  script existir e ter medido passagens (mesma filosofia do staged rollout da
  documentação).
- `aprovacao_humana: true` é imutável por configuração de produto nos gates que
  a constituição declara manuais (merge em protegida, promoção de story no modo
  manual, plano de adoção, decisão de ação) — garantido por teste, como o merge
  manual já é.
- `status: planned` declara gate de papel futuro sem ativá-lo.

### `evidencia`: onde mora a prova

Campo que a spec original não previa, e que a primeira leitura do código
tornou obrigatório: **nem todo gate pode ter prova no event log**.

- `merge-protegida` não emite evento próprio. É um teto aplicado por último
  sobre o veredito já calculado (`decide.ts`), que rebaixa `auto_approve` para
  `require_approval`; o desfecho aparece como um `proposed_action.created`
  pendente, indistinguível de qualquer outra pendência. O que garante a trava é
  **teste**.
- `backmerge` vive inteiramente fora da aplicação: é check required de PR, com
  estado versionado em `.release/gate.json` na `main`.

Sem esse campo, a regra "gate `active` + `block` sem evidência no log reprova"
tornaria os dois vermelhos para sempre — e eles são as travas mais duras do
produto. Cada gate declara então `evidencia: event_log | teste | ci` com o
localizador junto (tipos de evento e filtro de payload, caminho do spec, ou
workflow). O script só cobra o event log de quem o declara; para `teste` e `ci`
confirma que o alvo existe.

A alternativa — rebaixar os dois a `warn` — foi recusada por mentir sobre a
severidade real, que é justamente o que o registro existe para acabar.

### O filtro importa tanto quanto o tipo

`qa-verificada` e `secops-segura` **não são dois tipos de evento**: os dois
gravam `pr.gate_changed`, discriminados por `payload.gate`. E o mesmo tipo é
gravado na ABERTURA do gate, sem `veredito`. Um registro que guardasse só o
nome do tipo contaria abertura como passagem, e mediria o dobro do que
aconteceu. Por isso `evidencia` carrega o filtro de payload, não só o tipo.

## Alternativas consideradas

- **Manter implícito nos prompts:** rejeitado — não mensurável.
- **Tabela no banco em vez de YAML:** rejeitado por ora — gates mudam por PR
  revisado, não em runtime; segue o precedente do `.docmap.yml` e dos rulesets
  versionados (ADR 0030). Migrar para banco fica trivial com o loader como
  fronteira.

## Consequências

- O modo community do approval-ladder (backlog) vira mudança de valores em
  `aprovacao_humana`, não reescrita de agentes.
- Dev Lead (ADR 0053) e Platform/SRE ganham contrato de entrada: quando forem
  implementados, o gate deles já está especificado como `planned`.
- O registro nasce sabendo de um gate que a spec original esquecera —
  `infra-verificada`, o julgamento de QA/SecOps sobre PR de infra, que tem
  caminho próprio (`infra.gate_changed`) porque não há task de backlog por
  trás. Enumerar encontra o que estava fora da conta: é o primeiro dividendo do
  registro, antes mesmo de ele medir qualquer coisa.

## Referências

- [ADR 0048](0048-decisao-no-log-e-a-ordem-do-gate.md) — a decisão no event
  log, sem a qual não haveria o que medir
- [ADR 0020](0020-destravar-gates-qa-secops.md) — gates validados por
  execução real
- [ADR 0030](0030-politica-de-branches-mecanizada.md) — rulesets versionados,
  o precedente de configuração em arquivo
- `docs/gates.yml` — o registro
