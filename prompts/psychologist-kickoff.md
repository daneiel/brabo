---
name: psychologist-kickoff
version: "1"
pinned: true
---

A sessão abaixo foi encerrada ({{cause_label}}).
Analise o comportamento dos agentes e produza hipóteses estruturadas.

Cada hipótese PRECISA de evidência apontando para ids de eventos REAIS
do log abaixo — hipótese sem evidência válida é rejeitada e você terá
que corrigi-la. Registre tudo numa única chamada de `emit_hypotheses`.
{{termination_instruction}}

REGRAS DE NEGÓCIO DO PROJETO:
{{business_rules}}

HIPÓTESES ANTERIORES (não descartadas):
{{prior_hypotheses}}

LOG DE EVENTOS DA SESSÃO:{{omission_note}}
{{events}}

## Variáveis

Extraído de `apps/engine/lib/engine/workers/psychologist_worker.ex`,
`initial_message/4` (a mensagem inicial da sessão de análise do
Psicólogo). No `.ex` original esta mensagem nasce com `"pinned" => true`
no mapa da mensagem — o `ContextManager` (ver
`context-manager-summarize.md`) NUNCA compacta itens pinned, então este
kickoff sobrevive inteiro até o fim da análise por mais longa que ela
fique. O campo `pinned: true` no front-matter acima documenta essa
propriedade; não é um placeholder de conteúdo.

- `{{cause_label}}` — rótulo textual da causa de término da sessão
  (`TerminationClassifier.label(cause)`), ex.: "encerramento normal",
  "erro de agente". Aparece duas vezes no `.ex` original quando a causa é
  anormal (uma no corpo principal, outra dentro de
  `{{termination_instruction}}`).
- `{{termination_instruction}}` — bloco condicional. Vazio quando a causa
  é `:normal`; quando é anormal, expande para o texto fixo abaixo (com
  `{{cause_label}}` interpolado de novo):

  ```
  A sessão terminou ANORMALMENTE ({{cause_label}}) — ao menos
  uma hipótese precisa trazer `terminationAnalysis` com {causa, estadoDaSessao,
  analise}, analisando a causa e o estado da sessão no momento do término.
  ```

- `{{business_rules}}` — lista formatada das regras de negócio do
  projeto (`- <título>` por linha), ou `(nenhuma)` se a lista vier vazia.
- `{{prior_hypotheses}}` — hipóteses anteriores não descartadas,
  formatadas, ou `(nenhuma)`.
- `{{omission_note}}` — nota visível ao modelo quando o log foi truncado:
  " (só os N mais recentes de M; K evento(s) mais antigo(s) omitido(s) —
  cite apenas ids presentes abaixo)", ou string vazia quando nada foi
  omitido. Existe para o modelo nunca citar um id de evento que ele não
  viu.
- `{{events}}` — o log de eventos da sessão, formatado, na janela que
  coube no corte.
