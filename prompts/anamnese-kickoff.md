---
name: anamnese-kickoff
version: "1"
pinned: true
---

Analise a janela do log abaixo e mantenha o perfil de proficiência dos
membros deste projeto. Observe as INTERAÇÕES DO USUÁRIO: a linguagem que
usa, as correções que faz nos agentes, o que aprova ou nega, e o nível das
perguntas que faz.

REGRAS INEGOCIÁVEIS:
- Só competências do catálogo abaixo. NUNCA infira saúde, traços de
  personalidade, idade, gênero ou qualquer característica pessoal — perfis
  com competência fora do catálogo são rejeitados.
- Toda entrada precisa de evidência apontando para ids de eventos REAIS
  da janela, e de um `rationale` explicando o porquê do nível.
- Feche a rodada com UMA chamada de `emit_proficiency`.
{{queued_instruction}}

CATÁLOGO DE COMPETÊNCIAS PERMITIDAS:
{{competency_catalog}}

MEMBROS ELEGÍVEIS:
{{members}}

PERFIS ATUAIS (revise, não duplique):
{{current_profiles}}

{{instructions}}
{{decisions}}
{{relevant_snippets}}
JANELA DO LOG ({{window_from}} → {{window_to}}){{omission_note}}:
{{events}}

## Variáveis

Extraído de `apps/engine/lib/engine/workers/anamnese_worker.ex`,
`initial_message/1` (a mensagem inicial da janela de análise da
Anamnese). Assim como o kickoff do Psicólogo, esta mensagem nasce com
`"pinned" => true` no `.ex` original — nunca compactada pelo
`ContextManager`.

- `{{queued_instruction}}` — bloco condicional. Vazio quando não há
  hipóteses aceitas pelo usuário na fila (`context.queued_hypotheses ==
  []`). Quando há, expande para o texto fixo abaixo, seguido de uma linha
  por hipótese no formato
  `- [{{agenteAlvo}}] ({{hypothesisId}}) {{hipotese}} — sugestão: {{sugestao}} (confiança {{confiancaPercent}}%)`:

  ```

  HIPÓTESES ACEITAS PELO USUÁRIO (input PRIORIZADO — trate como sinal forte):
  <uma linha por hipótese, formato acima>

  Se alguma delas sugerir um ajuste com valor real no arquivo de instrução do
  agente alvo, chame `propose_instruction_patch` ANTES de fechar a rodada,
  passando o `hypothesisId` correspondente.
  ```

- `{{competency_catalog}}` — catálogo de competências permitidas,
  formatado como lista.
- `{{members}}` — membros elegíveis do projeto, formatados.
- `{{current_profiles}}` — perfis de proficiência já existentes
  (revisados, não duplicados pelo modelo).
- `{{instructions}}` / `{{decisions}}` — blocos de instruções e decisões
  formatados (funções `format_instructions`/`format_decisions` no `.ex`
  original); cada um pode ser vazio dependendo do estado do projeto.
- `{{relevant_snippets}}` — trechos do projeto (docs/ADRs/sessões
  indexados) trazidos por `rag_search` (ADR 0099/0100, RN-414), EM
  COMPOSIÇÃO com a janela temporal — nunca em substituição. A query é
  montada só com nomes de competência do catálogo ainda sem perfil
  registrado, nunca com texto livre de hipótese (que poderia falar da
  PESSOA). Vazio (`""`) quando a consulta não roda (catálogo sem
  competência descoberta) ou falha (api do RAG fora do ar) — a Anamnese
  degrada pra só a janela temporal, comportamento anterior a esta leva.
  Quando roda e vem `degraded: true` (léxico-only, sem embedding), isso
  aparece como aviso explícito dentro do bloco.
- `{{window_from}}` / `{{window_to}}` — limites ISO-8601 da janela do log
  analisada nesta rodada.
- `{{omission_note}}` — mesma lógica do kickoff do Psicólogo: nota visível
  quando o log da janela foi truncado, string vazia quando não foi.
- `{{events}}` — o log de eventos dentro da janela.
