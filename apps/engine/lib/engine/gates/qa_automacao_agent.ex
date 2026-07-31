defmodule Engine.Gates.QaAutomacaoAgent do
  @moduledoc """
  QA de Automação (Fase 8b) — a subespecialidade em que o `QAAgent` da Fase 4a
  virou. Acha o worktree do dev (`Engine.Dev.DevAgentState`), roda a suite via
  `terminal` (ToolLoop/LLM — cruzar regra de negócio com teste é julgamento
  semântico, diferente do SecOps determinístico) e registra o parecer com
  `emit_qa_verdict` (`Engine.Gates.Tools.EmitQaVerdict` — só aceita aprovar com
  suite verde). Instruções e `coverageMatrix` preservadas byte a byte da Fase
  4a — só a casca mudou.

  ## O que saiu daqui

  Até a Fase 4a este módulo era um `GenServer` — um processo por projeto,
  registrado em `Engine.Gates.Registry`, que também DECIDIA o desfecho: emitia
  o `qa_verdict` pra api (`record_gate_verdict`) e, na falha, bloqueava a task
  (`mark_task_blocked`) diretamente. Essas duas responsabilidades agora são do
  `Engine.Gates.QaLeadServer`, que é quem fala com a api — a Automação vira uma
  ferramenta que ele usa, não mais um agente com voz própria sobre o gate. Ela
  só roda o `ToolLoop` e DEVOLVE o resultado; nunca chama `EngineApiClient`.
  """

  alias Engine.Gates.{Hooks.Termination, QaTools}
  alias Engine.Harness.{Hooks, ToolLoop}
  alias Engine.Harness.Hooks.{ActionPipeline, EventLog}

  @doc """
  Roda a revisão de Automação. `dev_context` é o mesmo mapa que
  `Engine.Dev.ContextBuilder.fetch/3` devolve — buscado UMA vez pelo
  `QaLeadServer` e compartilhado com as duas subespecialidades, não uma
  chamada por subagente.

  Devolve `{:ok, parecer}` (com `veredito`/`resumo`/`itens`/`coverage_matrix`,
  chaves atom — a mesma forma que `Termination` já produzia) ou
  `{:blocked, %{reason:, diagnosis:, origin:}}` quando o loop termina sem
  parecer — o Lead decide o que fazer com o bloqueio, este módulo só relata a
  falha e a ORIGEM (ADR 0020).
  """
  def run(project_id, session_id, task_id, dev_state, dev_context) do
    project_id
    |> build_ctx(session_id, dev_state, dev_context)
    |> ToolLoop.run()
    |> handle_outcome(task_id)
  end

  defp build_ctx(project_id, session_id, dev_state, %{
         task: task,
         story: story,
         business_rules_units: business_rules_units,
         task_state_units: task_state_units
       }) do
    %{
      project_id: project_id,
      session_id: session_id,
      agent: "qa-automacao",
      workspace_root: dev_state.worktree_path,
      tools: QaTools.registry(),
      hooks: qa_hooks(),
      # Mesmo teto por task do DevAgent: uma revisão de QA é um ciclo de
      # ToolLoop como qualquer outro, e sem teto ela gastaria sem limite — o
      # gate roda de novo a CADA correção, então o custo se multiplica. As
      # duas subespecialidades COMPARTILHAM este pool — é o que faz "o
      # orçamento migra pra área" valer sem coluna nova (ver RN-036).
      token_budget_micros: dev_state.task_budget_micros,
      business_rules_units: business_rules_units,
      task_state_units: task_state_units,
      messages: [initial_message(task, story)],
      context_window: 128_000
    }
  end

  defp qa_hooks do
    Hooks.new()
    |> Hooks.register(:pre_tool_use, ActionPipeline)
    |> Hooks.register(:post_tool_use, EventLog)
    |> Hooks.register(:post_tool_use, Termination)
  end

  # Protocolo explícito, passo a passo. A versão anterior era um parágrafo
  # solto e um modelo local respondeu alucinando uma chamada à função de
  # NEGÓCIO sob revisão (`enviar(payload)`) em vez de usar uma ferramenta — o
  # loop encerrava sem parecer. O DevAgent tem o AGENTS.md do repositório
  # guiando cada passo; o QA não tinha nada equivalente.
  defp initial_message(task, story) do
    regras = Enum.concat(story["rf"] || [], story["rnf"] || [])

    lista_regras =
      regras
      |> Enum.with_index(1)
      |> Enum.map_join("\n", fn {regra, i} -> "#{i}. #{regra}" end)

    %{
      "role" => "user",
      "content" => """
      Você é a subespecialidade de Automação do gate de QA da task
      "#{task["title"]}" (story "#{story["title"]}"). Você NÃO escreve código:
      só lê, roda a suite e emite um parecer.

      Regras da story que precisam de cobertura:
      #{lista_regras}

      Siga exatamente estes passos, um por vez, cada um com uma ferramenta:
      1. `terminal` com o comando de teste do projeto (veja o AGENTS.md do
         repositório) e observe o código de saída.
      2. `search_workspace` / `read_file` nos arquivos de teste, pra descobrir
         QUAL teste cobre CADA regra acima.
      3. `emit_qa_verdict` com uma linha de `coverageMatrix` por regra —
         `rule` (o texto da regra), `tests` (os arquivos que a cobrem, lista
         vazia se nenhum) e `covered` (true/false).

      Veredito: `approved` só se a suite saiu com exit 0 E toda regra tem pelo
      menos um teste. Se alguma regra ficou sem teste, use
      `changes_requested` e liste em `itens` exatamente quais regras faltam.

      Responda SEMPRE chamando uma das ferramentas acima. Nunca chame as
      funções do código que está revisando — elas não são ferramentas.
      """,
      :pinned => true
    }
  end

  defp handle_outcome({:halted, {"emit_qa_verdict", verdict}, _ctx}, _task_id) do
    {:ok, verdict}
  end

  # A Automação não chegou a um parecer (limite de iterações, orçamento
  # estourado, ou o modelo parou sem chamar `emit_qa_verdict`). Quem decide o
  # que fazer com isso é o Lead — este módulo só classifica a origem (ADR
  # 0020: nunca por eliminação, sempre nomeada).
  defp handle_outcome(outcome, _task_id) do
    {reason, diagnosis, origin} = falha_da_automacao(outcome)
    {:blocked, %{reason: reason, diagnosis: diagnosis, origin: origin}}
  end

  defp falha_da_automacao({:limit_reached, _ctx}),
    do:
      {"QA de Automação não concluiu o parecer",
       "limite de iterações atingido sem emit_qa_verdict", "modelo"}

  defp falha_da_automacao({:budget_exceeded, _ctx}),
    do:
      {"QA de Automação não concluiu o parecer",
       "orçamento de tokens da task esgotado na revisão", "politica"}

  defp falha_da_automacao({:ok, ctx}) do
    {reason, origin} = diagnostico_de_parada(ctx)
    {"QA de Automação não concluiu o parecer", reason, origin}
  end

  defp falha_da_automacao(other),
    do:
      {"QA de Automação não concluiu o parecer",
       "desfecho inesperado do ToolLoop: #{inspect(other)}", "infra"}

  # Mesma distinção que o DevAgentServer faz: "o modelo parou por conta" e "o
  # provider falhou" chegam aqui como o mesmo `{:ok, ctx}`, e sem o
  # `:last_error` o diagnóstico sairia vazio (foi o que escondeu um timeout no
  # primeiro demo do dev — ver ADR 0019). Provider falhando é `infra`; modelo
  # que só parou de chamar ferramenta é `modelo`.
  defp diagnostico_de_parada(ctx) do
    case Map.get(ctx, :last_error) do
      nil -> {"o modelo parou sem chamar emit_qa_verdict", "modelo"}
      error -> {"falha no turno de LLM: #{inspect(error)}", "infra"}
    end
  end
end
