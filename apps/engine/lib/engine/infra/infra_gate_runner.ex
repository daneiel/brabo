defmodule Engine.Infra.InfraGateRunner do
  @moduledoc """
  Gates de PR de infra (Fase 4a — InfraAgent): DETERMINÍSTICO de ponta a
  ponta (sem GenServer próprio, sem LLM) — `run_qa/3` roda `hadolint` sobre
  cada Dockerfile do payload da PR; `run_secops/3` roda `gitleaks`+`semgrep`
  (mesmos detectors do SecOps de dev) contra um diretório temporário com os
  arquivos (a PR de infra não tem worktree — os arquivos vivem só no
  payload da proposed_action `open_infra_pr`, buscados via
  `EngineApiClient.get_infra_pr_files/3`).

  Disparado via `Engine.Gates.Dispatcher.run_infra_qa/3`/`run_infra_secops/3`
  (fire-and-forget, `Task.start`). `changes_requested` devolve pro
  `Engine.Infra.InfraAgentServer.correct/2` (mesma branch, sem PR nova).
  """

  alias Engine.Infra.InfraAgentServer
  alias Engine.Gates.Dispatcher
  alias Engine.Sessions.EngineApiClient

  defp hadolint,
    do: Application.get_env(:engine, :hadolint_detector, Engine.Actions.HadolintDetector.Live)

  defp semgrep,
    do: Application.get_env(:engine, :semgrep_detector, Engine.Actions.SemgrepDetector.Live)

  defp gitleaks,
    do: Application.get_env(:engine, :gitleaks_detector, Engine.Actions.GitleaksDetector.Live)

  @doc "Roda hadolint sobre cada Dockerfile da PR de infra."
  def run_qa(project_id, session_id, pr_action_id) do
    with {:ok, %{"files" => files}} <-
           EngineApiClient.get_infra_pr_files(project_id, session_id, pr_action_id) do
      {findings, skipped_notes} = lint_dockerfiles(files)

      veredito = if findings == [], do: "approved", else: "changes_requested"
      resumo = build_resumo("hadolint", skipped_notes, findings)
      itens = Enum.map(findings, &format_item/1)

      emit(project_id, session_id, "artifact.qa_verdict", pr_action_id, veredito, resumo, itens)
      apply_verdict(project_id, session_id, pr_action_id, "qa", veredito, resumo, itens)
    else
      _ -> :ok
    end
  end

  @doc "Roda gitleaks+semgrep contra um diretório temporário com os arquivos da PR de infra."
  def run_secops(project_id, session_id, pr_action_id) do
    with {:ok, %{"files" => files}} <-
           EngineApiClient.get_infra_pr_files(project_id, session_id, pr_action_id) do
      dir = write_temp_dir(files)

      try do
        {semgrep_findings, semgrep_note} = run_scanner(semgrep(), dir, "semgrep")
        {gitleaks_findings, gitleaks_note} = run_scanner(gitleaks(), dir, "gitleaks")
        findings = semgrep_findings ++ gitleaks_findings
        skipped_notes = Enum.filter([semgrep_note, gitleaks_note], & &1)

        veredito = if findings == [], do: "approved", else: "changes_requested"
        resumo = build_resumo("scanners", skipped_notes, findings)
        itens = Enum.map(findings, &format_item/1)

        emit(
          project_id,
          session_id,
          "artifact.secops_verdict",
          pr_action_id,
          veredito,
          resumo,
          itens
        )

        apply_verdict(project_id, session_id, pr_action_id, "secops", veredito, resumo, itens)
      after
        File.rm_rf(dir)
      end
    else
      _ -> :ok
    end
  end

  defp lint_dockerfiles(files) do
    dockerfiles = Enum.filter(files, &dockerfile?/1)

    if dockerfiles == [] do
      {[], ["nenhum Dockerfile encontrado na PR"]}
    else
      det = hadolint()

      if det.available?() do
        results = Enum.map(dockerfiles, &lint_one(det, &1))
        findings = results |> Enum.map(&elem(&1, 0)) |> List.flatten()
        notes = results |> Enum.map(&elem(&1, 1)) |> Enum.filter(& &1)
        {findings, notes}
      else
        {[], ["hadolint indisponível, pulado"]}
      end
    end
  end

  defp lint_one(det, file) do
    path = Map.get(file, "path")
    content = Map.get(file, "content", "")

    case det.lint(content) do
      {:ok, findings} -> {Enum.map(findings, &Map.put(&1, :path, path)), nil}
      {:error, reason} -> {[], "hadolint falhou em #{path} (#{inspect(reason)}), pulado"}
      :unavailable -> {[], "hadolint indisponível, pulado"}
    end
  end

  defp dockerfile?(file) do
    file
    |> Map.get("path", "")
    |> Path.basename()
    |> String.downcase()
    |> String.contains?("dockerfile")
  end

  defp run_scanner(detector, dir, name) do
    if detector.available?() do
      case detector.scan(dir) do
        {:ok, findings} -> {findings, nil}
        {:error, reason} -> {[], "#{name} falhou (#{inspect(reason)}), pulado"}
        :unavailable -> {[], "#{name} indisponível, pulado"}
      end
    else
      {[], "#{name} indisponível, pulado"}
    end
  end

  defp write_temp_dir(files) do
    dir = Path.join(System.tmp_dir!(), "infra-pr-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)

    Enum.each(files, fn file ->
      path = Path.join(dir, Map.get(file, "path", "file"))
      File.mkdir_p!(Path.dirname(path))
      File.write!(path, Map.get(file, "content", ""))
    end)

    dir
  end

  defp build_resumo(source, skipped_notes, findings) do
    scanner_note =
      case skipped_notes do
        [] -> ""
        notes -> " " <> Enum.join(notes, " ")
      end

    findings_note =
      if findings == [], do: "Nenhum achado.", else: "#{length(findings)} achado(s) (#{source})."

    String.trim("#{findings_note}#{scanner_note}")
  end

  defp format_item(finding),
    do: "[#{finding.tool}] #{finding.path}:#{finding.line} — #{finding.message}"

  defp apply_verdict(project_id, session_id, pr_action_id, gate, veredito, resumo, itens) do
    result =
      EngineApiClient.record_infra_gate_verdict(
        project_id,
        session_id,
        pr_action_id,
        gate,
        veredito,
        resumo,
        itens
      )

    case result do
      {:ok, %{"nextAction" => "correct"}} ->
        InfraAgentServer.correct(session_id, %{
          gate: gate,
          reason: resumo,
          diagnosis: Enum.join(itens, "; ")
        })

      {:ok, %{"nextAction" => "run_secops"}} ->
        Dispatcher.run_infra_secops(project_id, session_id, pr_action_id)

      _ ->
        :ok
    end
  end

  defp emit(project_id, session_id, type, pr_action_id, veredito, resumo, itens) do
    payload = %{prActionId: pr_action_id, veredito: veredito, resumo: resumo, itens: itens}

    EngineApiClient.append_event(project_id, session_id, %{
      type: type,
      actorKind: "agent",
      actorId: "infra-gate",
      payload: payload
    })

    Engine.Sessions.LiveBroadcast.event_appended(session_id, type, "infra-gate", payload)
  end
end
