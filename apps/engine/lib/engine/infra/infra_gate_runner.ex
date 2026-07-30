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
  `Engine.Infra.InfraLeadServer.correct/2` (mesma branch, sem PR nova — o
  Lead reroda a área inteira, Fase 8c).
  """

  alias Engine.Infra.InfraLeadServer
  alias Engine.Gates.{Dispatcher, Scanner}
  alias Engine.Harness.ArtifactEmitter
  alias Engine.Sessions.EngineApiClient

  defp hadolint,
    do: Application.get_env(:engine, :hadolint_detector, Engine.Actions.HadolintDetector.Live)

  defp semgrep,
    do: Application.get_env(:engine, :semgrep_detector, Engine.Actions.SemgrepDetector.Live)

  defp gitleaks,
    do: Application.get_env(:engine, :gitleaks_detector, Engine.Actions.GitleaksDetector.Live)

  defp yamllint,
    do: Application.get_env(:engine, :yamllint_detector, Engine.Actions.YamlLintDetector.Live)

  @doc """
  Validação SINTÁTICA da PR de infra: hadolint nos Dockerfiles, yamllint no
  compose e no pipeline de CI.

  Só achado de nível `error` reprova. Os demais (`warning`/`info`/`style`) vão
  no parecer como informação — reprovar por nit de estilo faria o gate recusar
  qualquer Dockerfile plausível e o InfraAgent circular até estourar o teto de
  correções (ver ADR 0021).
  """
  def run_qa(project_id, session_id, pr_action_id) do
    with {:ok, %{"files" => files}} <-
           EngineApiClient.get_infra_pr_files(project_id, session_id, pr_action_id) do
      {docker_findings, docker_notes} = lint_dockerfiles(files)
      {yaml_findings, yaml_notes} = lint_yamls(files)

      findings = nada_a_validar(files) ++ docker_findings ++ yaml_findings
      skipped_notes = docker_notes ++ yaml_notes
      {bloqueantes, informativos} = Enum.split_with(findings, &bloqueante?/1)

      veredito = if bloqueantes == [], do: "approved", else: "changes_requested"
      resumo = build_resumo("validação sintática", skipped_notes, bloqueantes, informativos)
      # Os itens carregam TODOS os achados: o que reprova primeiro, o resto
      # como contexto pro InfraAgent melhorar sem ser obrigado a isso.
      itens = Enum.map(bloqueantes ++ informativos, &format_item/1)

      emit(project_id, session_id, "qa_verdict", pr_action_id, veredito, resumo, itens)
      apply_verdict(project_id, session_id, pr_action_id, "qa", veredito, resumo, itens)
    else
      _ -> :ok
    end
  end

  # Achado sem `:level` conhecido conta como bloqueante — um detector que não
  # informa severidade não deve virar aprovação silenciosa.
  defp bloqueante?(finding), do: Map.get(finding, :level, "error") == "error"

  # Uma PR de infra sem NENHUM arquivo reconhecível não passou por validação —
  # ela é invalidável, que não é a mesma coisa que válida. Aprovar isso foi o
  # que aconteceu na execução do critério de aceite: o modelo produziu `files`
  # malformados (paths que eram blobs de JSON), nenhum Dockerfile nem YAML foi
  # reconhecido, e o gate aprovou com "nenhum Dockerfile encontrado na PR"
  # (ADR 0021). O gate existe pra validar artefatos de infra; sem nenhum, o
  # veredito honesto é devolver.
  defp nada_a_validar(files) do
    if Enum.any?(files, &(dockerfile?(&1) or yaml?(&1))) do
      []
    else
      [
        %{
          tool: "gate",
          path: "(PR)",
          line: 0,
          level: "error",
          message:
            "a PR não contém nenhum Dockerfile nem YAML — nada a validar. " <>
              "Verifique se cada arquivo tem `path` (ex.: \"api/Dockerfile\") e " <>
              "`content` com o conteúdo do arquivo."
        }
      ]
    end
  end

  @doc "Roda gitleaks+semgrep contra um diretório temporário com os arquivos da PR de infra."
  def run_secops(project_id, session_id, pr_action_id) do
    with {:ok, %{"files" => files}} <-
           EngineApiClient.get_infra_pr_files(project_id, session_id, pr_action_id) do
      dir = write_temp_dir(files)

      try do
        {semgrep_findings, semgrep_note} = Scanner.run(semgrep(), dir, "semgrep")
        {gitleaks_findings, gitleaks_note} = Scanner.run(gitleaks(), dir, "gitleaks")
        findings = semgrep_findings ++ gitleaks_findings
        skipped_notes = Enum.filter([semgrep_note, gitleaks_note], & &1)

        veredito = if findings == [], do: "approved", else: "changes_requested"
        resumo = build_resumo("scanners", skipped_notes, findings)
        itens = Enum.map(findings, &format_item/1)

        emit(project_id, session_id, "secops_verdict", pr_action_id, veredito, resumo, itens)

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

  # Compose de dev e esqueleto de CI — antes do ADR 0021 nada disso era
  # validado, e uma PR sem Dockerfile era aprovada sem checagem nenhuma.
  defp lint_yamls(files) do
    yamls = Enum.filter(files, &yaml?/1)

    if yamls == [] do
      {[], ["nenhum YAML encontrado na PR"]}
    else
      det = yamllint()

      if det.available?() do
        results = Enum.map(yamls, &lint_one(det, &1))
        findings = results |> Enum.map(&elem(&1, 0)) |> List.flatten()
        notes = results |> Enum.map(&elem(&1, 1)) |> Enum.filter(& &1)
        {findings, notes}
      else
        {[], ["yamllint indisponível, pulado"]}
      end
    end
  end

  defp yaml?(file) do
    file
    |> Map.get("path", "")
    |> Path.extname()
    |> String.downcase()
    |> then(&(&1 in [".yml", ".yaml"]))
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

  # Variante do gate de QA: separa o que REPROVA do que é só informativo, pra
  # o parecer não sugerir que um warning de estilo barrou a PR.
  defp build_resumo(source, skipped_notes, bloqueantes, informativos) do
    base = build_resumo(source, skipped_notes, bloqueantes)

    case informativos do
      [] -> base
      lista -> "#{base} #{length(lista)} aviso(s) não bloqueante(s)."
    end
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
        InfraLeadServer.correct(session_id, %{
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

  # Mesmos tipos de artefato dos gates de dev (`qa_verdict`/`secops_verdict`),
  # com `prActionId` no lugar de `taskId` como sujeito — o schema aceita os
  # dois, um de cada vez (ver `Engine.Harness.ArtifactSchemas`).
  defp emit(project_id, session_id, type, pr_action_id, veredito, resumo, itens) do
    ArtifactEmitter.emit(project_id, session_id, "infra-gate", type, %{
      prActionId: pr_action_id,
      veredito: veredito,
      resumo: resumo,
      itens: itens
    })
  end
end
