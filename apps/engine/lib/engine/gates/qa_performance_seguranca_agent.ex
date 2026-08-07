defmodule Engine.Gates.QaPerformanceSegurancaAgent do
  @moduledoc """
  QA de Performance e Segurança (Fase 8b) — a segunda subespecialidade da área
  de QA. Revisa os RNFs de performance da story (latência, throughput, uso de
  recurso) e faz um apoio de segurança em nível de CÓDIGO/DESIGN (uso correto
  de parametrização, validação de entrada, o que dá pra ver lendo o diff) —
  só entra em campo quando o `QaLeadServer` decide que a story tem RNF de
  performance pertinente (`Engine.Gates.QaLead.rnf_de_performance?/1`).

  ## A fronteira com o SecOps é estrutural, não só de instrução

  O registro de ferramentas desta subespecialidade NÃO inclui `Terminal`: ela
  não roda scanner de segredo/vulnerabilidade (`Engine.Gates.SecOpsAgentServer`
  faz isso, determinístico, em gate PRÓPRIO, depois) nem a suite de testes
  (`Engine.Gates.QaAutomacaoAgent` faz isso). Sem `terminal`, ela estrutural-
  mente não CONSEGUE fazer o trabalho de nenhum dos dois — a fronteira não
  depende do modelo obedecer o prompt. Só lê (`read_file`/`search_workspace`)
  e emite o parecer.
  """

  alias Engine.Gates.Hooks.Termination
  alias Engine.Gates.Tools.EmitPerfSegurancaVerdict
  alias Engine.Harness.Tools.{ReadFile, SearchWorkspace}
  alias Engine.Harness.{Hooks, ToolLoop}
  alias Engine.Harness.Hooks.{ActionPipeline, EventLog}

  @registry [ReadFile, SearchWorkspace, EmitPerfSegurancaVerdict]

  @doc "Registro de ferramentas — sem `Terminal`, de propósito (ver moduledoc)."
  def tools, do: @registry

  @doc """
  Roda a revisão de Performance/Segurança. `dev_context` é o mesmo mapa que o
  Lead já buscou uma vez com `Engine.Dev.ContextBuilder.fetch/3` — sem
  chamada nova.

  Devolve `{:ok, parecer}` (`veredito`/`resumo`/`itens`, sem
  `coverage_matrix` — não se aplica a esta subespecialidade) ou
  `{:blocked, %{reason:, diagnosis:, origin:}}`.
  """
  def run(project_id, session_id, task_id, dev_state, dev_context) do
    project_id
    |> build_ctx(session_id, dev_state, dev_context)
    |> ToolLoop.run()
    |> handle_outcome(task_id)
  end

  @doc "Retoma o laço parado numa ação pendente. Ver `QaAutomacaoAgent.retomar/3`."
  def retomar(pendente, texto_do_desfecho, task_id) do
    pendente.ctx
    |> Map.update!(:messages, fn messages ->
      messages ++
        [
          %{
            "role" => "tool",
            "content" => texto_do_desfecho,
            "toolCallId" => pendente.tool_call_id,
            "name" => pendente.tool_name,
            :pinned => false
          }
        ]
    end)
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
      agent: "qa-performance-seguranca",
      workspace_root: dev_state.worktree_path,
      tools: @registry,
      hooks: hooks(),
      # Mesmo pool da Automação — as duas subespecialidades compartilham o
      # orçamento da task (ver RN-036: é assim que "o orçamento migra pra
      # área" vale sem coluna nova).
      token_budget_micros: dev_state.task_budget_micros,
      business_rules_units: business_rules_units,
      task_state_units: task_state_units,
      messages: [initial_message(task, story)],
      context_window: 128_000
    }
  end

  defp hooks do
    Hooks.new()
    |> Hooks.register(:pre_tool_use, ActionPipeline)
    |> Hooks.register(:post_tool_use, EventLog)
    |> Hooks.register(:post_tool_use, Termination)
  end

  defp initial_message(task, story) do
    rnfs = story["rnf"] || []

    lista_rnfs =
      rnfs
      |> Enum.with_index(1)
      |> Enum.map_join("\n", fn {rnf, i} -> "#{i}. #{rnf}" end)

    %{
      "role" => "user",
      "content" => """
      Você é a subespecialidade de Performance e Segurança do gate de QA da
      task "#{task["title"]}" (story "#{story["title"]}"). Foi chamada porque
      a story tem requisito não-funcional de performance. Você NÃO escreve
      código: só lê e emite um parecer.

      RNFs da story:
      #{lista_rnfs}

      Duas coisas pra avaliar, nesta ordem:
      1. Performance: o código atende os RNFs acima? Procure por padrões
         óbvios de problema — consulta em loop, ausência de paginação onde a
         story pede, trabalho síncrono que deveria ser assíncrono.
      2. Apoio de segurança EM NÍVEL DE CÓDIGO: parametrização de query,
         validação de entrada, dados sensíveis em log. Você NÃO roda scanner
         de segredo nem de vulnerabilidade — isso é o SecOps, um gate
         determinístico próprio que roda depois de você. Se notar algo que
         parece segredo hardcoded, registre em `itens`, mas o veredito de
         segurança de verdade é do SecOps, não seu.

      Use `read_file`/`search_workspace` pra examinar o que for preciso, e
      então `emit_perf_seguranca_verdict` com `veredito`
      (`approved`/`changes_requested`), `resumo` e `itens` (o que precisa
      mudar, se houver).

      Responda SEMPRE chamando uma das ferramentas acima.
      """,
      :pinned => true
    }
  end

  defp handle_outcome({:halted, {"emit_perf_seguranca_verdict", verdict}, _ctx}, _task_id) do
    {:ok, verdict}
  end

  # Ver `QaAutomacaoAgent`: pendente é laço parado, não falha.
  defp handle_outcome({:halted, {:awaiting_approval, action_id, call_id, tool}, ctx}, _task_id) do
    {:awaiting, %{action_id: action_id, tool_call_id: call_id, tool_name: tool, ctx: ctx}}
  end

  defp handle_outcome(outcome, _task_id) do
    {reason, diagnosis, origin} = falha_da_subespecialidade(outcome)
    {:blocked, %{reason: reason, diagnosis: diagnosis, origin: origin}}
  end

  defp falha_da_subespecialidade({:limit_reached, _ctx}),
    do:
      {"QA de Performance/Segurança não concluiu o parecer",
       "limite de iterações atingido sem emit_perf_seguranca_verdict", "modelo"}

  defp falha_da_subespecialidade({:budget_exceeded, _ctx}),
    do:
      {"QA de Performance/Segurança não concluiu o parecer",
       "orçamento de tokens da task esgotado na revisão", "politica"}

  defp falha_da_subespecialidade({:ok, ctx}) do
    {reason, origin} = diagnostico_de_parada(ctx)
    {"QA de Performance/Segurança não concluiu o parecer", reason, origin}
  end

  defp falha_da_subespecialidade(other),
    do:
      {"QA de Performance/Segurança não concluiu o parecer",
       "desfecho inesperado do ToolLoop: #{inspect(other)}", "infra"}

  defp diagnostico_de_parada(ctx) do
    case Map.get(ctx, :last_error) do
      nil -> {"o modelo parou sem chamar emit_perf_seguranca_verdict", "modelo"}
      error -> {"falha no turno de LLM: #{inspect(error)}", "infra"}
    end
  end
end
