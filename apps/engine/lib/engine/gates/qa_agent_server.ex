defmodule Engine.Gates.QaAgentServer do
  @moduledoc """
  QAAgent (Fase 4a) — um por projeto (`Engine.Gates.Registry`, chave
  `{project_id, "qa"}`). Ativado quando uma task entra em `awaiting_qa`:
  acha o worktree do dev (`Engine.Dev.DevAgentState.find_by_task_id/2`),
  roda a suite via `terminal` (ToolLoop/LLM — cruzar regra de negócio com
  teste é julgamento semântico, diferente do SecOps determinístico) e
  registra o parecer com `emit_qa_verdict` (`Engine.Gates.Tools.EmitQaVerdict`
  — só aceita aprovar com suite verde). `changes_requested` devolve pro
  `Engine.Dev.DevAgentServer.correct/3` NO MESMO worktree/branch;
  `approved` dispara o `Engine.Gates.SecOpsAgentServer`.
  """

  use GenServer, restart: :temporary

  alias Engine.Dev.{ContextBuilder, DevAgentServer, DevAgentState}
  alias Engine.Gates.{Dispatcher, QaTools}
  alias Engine.Gates.Hooks.Termination
  alias Engine.Harness.{ArtifactEmitter, ToolLoop}
  alias Engine.Harness.Hooks
  alias Engine.Harness.Hooks.{ActionPipeline, EventLog}
  alias Engine.Sessions.EngineApiClient

  def start_link(project_id) do
    GenServer.start_link(__MODULE__, project_id, name: via(project_id))
  end

  def via(project_id), do: {:via, Registry, {Engine.Gates.Registry, {project_id, "qa"}}}

  @doc "Dispara a revisão de QA pra `task_id`."
  def run(project_id, task_id), do: GenServer.cast(via(project_id), {:run, task_id})

  @impl true
  def init(project_id), do: {:ok, %{project_id: project_id}}

  @impl true
  def handle_cast({:run, task_id}, state) do
    case DevAgentState.find_by_task_id(state.project_id, task_id) do
      nil -> :ok
      dev_state -> run_qa(state.project_id, dev_state, task_id)
    end

    {:noreply, state}
  end

  defp run_qa(project_id, dev_state, task_id) do
    session_id = dev_state.session_id

    case ContextBuilder.fetch(project_id, session_id, task_id) do
      {:ok, dev_context} ->
        project_id
        |> build_ctx(session_id, dev_state, dev_context)
        |> ToolLoop.run()
        |> handle_outcome(project_id, dev_state, task_id)

      {:error, _reason} ->
        :ok
    end
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
      agent: "qa",
      workspace_root: dev_state.worktree_path,
      tools: QaTools.registry(),
      hooks: qa_hooks(),
      # Mesmo teto por task do DevAgent: uma revisão de QA é um ciclo de
      # ToolLoop como qualquer outro, e sem teto ela gastaria sem limite — o
      # gate roda de novo a CADA correção, então o custo se multiplica.
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
      Você é o gate de QA da task "#{task["title"]}" (story "#{story["title"]}").
      Você NÃO escreve código: só lê, roda a suite e emite um parecer.

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

  defp handle_outcome(
         {:halted, {"emit_qa_verdict", verdict}, _ctx},
         project_id,
         dev_state,
         task_id
       ) do
    emit_verdict_artifact(project_id, dev_state.session_id, task_id, verdict)
    apply_verdict(project_id, dev_state, task_id, verdict.veredito, verdict.resumo, verdict.itens)
  end

  # O QA não chegou a um parecer (limite de iterações, orçamento estourado, ou
  # o modelo parou sem chamar `emit_qa_verdict`). Isto NÃO é um veredito: não
  # há achado nenhum sobre o código do dev.
  #
  # Antes virava `changes_requested`, o que devolvia pro dev — que não tinha o
  # que corrigir — e ainda QUEIMAVA uma volta do teto de correções. Com azar
  # repetido, um QA quebrado bloqueava uma task perfeita e o parecer registrado
  # culpava o dev. Agora bloqueia a task direto, com o motivo verdadeiro, sem
  # gastar correção: o gate continua em `awaiting_qa`, e o humano decide
  # desbloquear depois de ler o diagnóstico (`UnblockTaskUseCase`).
  defp handle_outcome(outcome, project_id, dev_state, task_id) do
    {reason, diagnosis} = falha_do_qa(outcome)

    emit(project_id, dev_state.session_id, "dev.error", %{agentId: "qa", reason: reason})

    ArtifactEmitter.emit(project_id, dev_state.session_id, "qa", "task_blocked", %{
      taskId: task_id,
      agentId: "qa",
      reason: reason,
      diagnosis: diagnosis
    })

    EngineApiClient.mark_task_blocked(
      project_id,
      dev_state.session_id,
      task_id,
      reason,
      diagnosis,
      "qa"
    )
  end

  defp falha_do_qa({:limit_reached, _ctx}),
    do: {"QA não concluiu o parecer", "limite de iterações atingido sem emit_qa_verdict"}

  defp falha_do_qa({:budget_exceeded, _ctx}),
    do: {"QA não concluiu o parecer", "orçamento de tokens da task esgotado na revisão"}

  defp falha_do_qa({:ok, ctx}),
    do: {"QA não concluiu o parecer", diagnostico_de_parada(ctx)}

  defp falha_do_qa(other),
    do: {"QA não concluiu o parecer", "desfecho inesperado do ToolLoop: #{inspect(other)}"}

  # Mesma distinção que o DevAgentServer faz: "o modelo parou por conta" e "o
  # provider falhou" chegam aqui como o mesmo `{:ok, ctx}`, e sem o
  # `:last_error` o diagnóstico sairia vazio (foi o que escondeu um timeout no
  # primeiro demo do dev — ver ADR 0019).
  defp diagnostico_de_parada(ctx) do
    case Map.get(ctx, :last_error) do
      nil -> "o modelo parou sem chamar emit_qa_verdict"
      error -> "falha no turno de LLM: #{inspect(error)}"
    end
  end

  defp apply_verdict(project_id, dev_state, task_id, veredito, resumo, itens) do
    result =
      EngineApiClient.record_gate_verdict(
        project_id,
        dev_state.session_id,
        task_id,
        "qa",
        veredito,
        resumo,
        itens,
        dev_state.max_gate_corrections
      )

    case result do
      {:ok, %{"nextAction" => "correct"}} ->
        DevAgentServer.correct(project_id, dev_state.agent_id, %{
          gate: "qa",
          reason: resumo,
          diagnosis: Enum.join(itens, "; ")
        })

      {:ok, %{"nextAction" => "run_secops"}} ->
        :ok = Dispatcher.run_secops(project_id, task_id)

      _ ->
        :ok
    end
  end

  # Parecer como ARTEFATO validado (`Engine.Harness.ArtifactSchemas`), não como
  # evento cru: é o registro durável que o usuário lê pra decidir sobre a PR.
  defp emit_verdict_artifact(project_id, session_id, task_id, verdict) do
    ArtifactEmitter.emit(project_id, session_id, "qa", "qa_verdict", %{
      taskId: task_id,
      veredito: verdict.veredito,
      resumo: verdict.resumo,
      itens: verdict.itens,
      coverageMatrix: verdict.coverage_matrix
    })
  end

  defp emit(project_id, session_id, type, payload) do
    ArtifactEmitter.append(project_id, session_id, "qa", type, payload)
  end
end
