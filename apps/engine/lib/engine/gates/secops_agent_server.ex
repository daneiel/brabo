defmodule Engine.Gates.SecOpsAgentServer do
  @moduledoc """
  SecOpsAgent (Fase 4a) — um por projeto (`Engine.Gates.Registry`, chave
  `{project_id, "secops"}`). Ativado quando QA aprova: acha o worktree do
  dev, roda `gitleaks`+`semgrep` (`Engine.Actions.GitleaksDetector`/
  `SemgrepDetector`, ambos com detecção opcional — scanner ausente é
  PULADO, registrado no resumo, nunca quebra o gate) e lista os ADRs
  `securityRelevant` como checklist informativo.

  DETERMINÍSTICO (sem LLM/ToolLoop), ao contrário do QAAgent: achar um
  segredo/vulnerabilidade é checagem estruturada sobre saída de scanner, não
  julgamento semântico — um SecOps determinístico é mais confiável do que
  um LLM resumindo achado de segurança (decisão documentada no ADR 0013).
  Sem achados → `approved`; qualquer achado → `changes_requested`, devolve
  pro `Engine.Dev.DevAgentServer.correct/3` no MESMO worktree/branch.
  """

  use GenServer, restart: :temporary

  alias Engine.Dev.{ContextBuilder, DevAgentServer, DevAgentState}
  alias Engine.Gates.Diff
  alias Engine.Sessions.EngineApiClient

  defp semgrep,
    do: Application.get_env(:engine, :semgrep_detector, Engine.Actions.SemgrepDetector.Live)

  defp gitleaks,
    do: Application.get_env(:engine, :gitleaks_detector, Engine.Actions.GitleaksDetector.Live)

  def start_link(project_id) do
    GenServer.start_link(__MODULE__, project_id, name: via(project_id))
  end

  def via(project_id), do: {:via, Registry, {Engine.Gates.Registry, {project_id, "secops"}}}

  @doc "Dispara a checagem de SecOps pra `task_id`."
  def run(project_id, task_id), do: GenServer.cast(via(project_id), {:run, task_id})

  @impl true
  def init(project_id), do: {:ok, %{project_id: project_id}}

  @impl true
  def handle_cast({:run, task_id}, state) do
    case DevAgentState.find_by_task_id(state.project_id, task_id) do
      nil -> :ok
      dev_state -> run_secops(state.project_id, dev_state, task_id)
    end

    {:noreply, state}
  end

  defp run_secops(project_id, dev_state, task_id) do
    worktree = dev_state.worktree_path

    diff_note =
      case Diff.compute(project_id, worktree) do
        {:ok, diff_text} ->
          "#{length(Diff.changed_paths(diff_text))} arquivo(s) alterado(s) nesta PR."

        {:error, reason} ->
          "diff indisponível (#{inspect(reason)})."
      end

    {semgrep_findings, semgrep_note} = run_scanner(semgrep(), worktree, "semgrep")
    {gitleaks_findings, gitleaks_note} = run_scanner(gitleaks(), worktree, "gitleaks")
    findings = semgrep_findings ++ gitleaks_findings
    skipped_notes = Enum.filter([semgrep_note, gitleaks_note], & &1)

    security_adrs = security_relevant_adrs(project_id, dev_state.session_id, task_id)

    veredito = if findings == [], do: "approved", else: "changes_requested"
    resumo = build_resumo(diff_note, skipped_notes, security_adrs, findings)
    itens = Enum.map(findings, &format_item/1)

    emit(project_id, dev_state.session_id, "artifact.secops_verdict", %{
      taskId: task_id,
      veredito: veredito,
      resumo: resumo,
      itens: itens
    })

    apply_verdict(project_id, dev_state, task_id, veredito, resumo, itens)
  end

  defp run_scanner(detector, worktree, name) do
    if detector.available?() do
      case detector.scan(worktree) do
        {:ok, findings} -> {findings, nil}
        {:error, reason} -> {[], "#{name} falhou (#{inspect(reason)}), pulado"}
        :unavailable -> {[], "#{name} indisponível, pulado"}
      end
    else
      {[], "#{name} indisponível, pulado"}
    end
  end

  defp security_relevant_adrs(project_id, session_id, task_id) do
    case ContextBuilder.fetch(project_id, session_id, task_id) do
      {:ok, %{adrs: adrs}} -> Enum.filter(adrs, &Map.get(&1, "securityRelevant", false))
      {:error, _reason} -> []
    end
  end

  defp build_resumo(diff_note, skipped_notes, security_adrs, findings) do
    scanner_note =
      case skipped_notes do
        [] -> ""
        notes -> " " <> Enum.join(notes, " ")
      end

    checklist_note =
      case security_adrs do
        [] ->
          "Nenhum ADR de segurança marcado pra este projeto."

        adrs ->
          "#{length(adrs)} ADR(s) de segurança considerados: " <>
            Enum.map_join(adrs, ", ", &Map.get(&1, "title", "(sem título)"))
      end

    findings_note =
      if findings == [], do: "Nenhum achado.", else: "#{length(findings)} achado(s)."

    "#{diff_note}#{scanner_note} #{checklist_note} #{findings_note}"
  end

  defp format_item(finding) do
    "[#{finding.tool}] #{finding.path}:#{finding.line} — #{finding.message}"
  end

  defp apply_verdict(project_id, dev_state, task_id, veredito, resumo, itens) do
    result =
      EngineApiClient.record_gate_verdict(
        project_id,
        dev_state.session_id,
        task_id,
        "secops",
        veredito,
        resumo,
        itens,
        dev_state.max_gate_corrections
      )

    case result do
      {:ok, %{"nextAction" => "correct"}} ->
        DevAgentServer.correct(project_id, dev_state.agent_id, %{
          gate: "secops",
          reason: resumo,
          diagnosis: Enum.join(itens, "; ")
        })

      _ ->
        :ok
    end
  end

  defp emit(project_id, session_id, type, payload) do
    EngineApiClient.append_event(project_id, session_id, %{
      type: type,
      actorKind: "agent",
      actorId: "secops",
      payload: payload
    })
  end
end
