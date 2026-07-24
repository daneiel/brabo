defmodule Engine.Actions.GitleaksDetector do
  @moduledoc """
  Contrato pra detectar/rodar o `gitleaks` (segredos hardcoded, SecOpsAgent —
  Fase 4a). Mesmo padrão do `Engine.Actions.RtkDetector`/`SemgrepDetector`:
  feature-detecção via `System.find_executable/1`, ausência do binário
  degrada graciosamente (`:unavailable`), nunca quebra o gate. Trocável em
  teste via `Application.get_env(:engine, :gitleaks_detector, ...)`.
  """

  @callback available?() :: boolean()
  @callback scan(worktree_path :: String.t()) ::
              {:ok, [map()]} | {:error, term()} | :unavailable
end

defmodule Engine.Actions.GitleaksDetector.Live do
  @moduledoc """
  `gitleaks detect --source <worktree>` — escreve o relatório num arquivo
  temporário (o gitleaks não suporta imprimir JSON puro em stdout de forma
  confiável entre versões), lê e apaga em seguida. Exit `1` = achou
  segredos (não é falha); só um exit diferente de 0/1 é erro real.
  """

  @behaviour Engine.Actions.GitleaksDetector

  @impl true
  def available?, do: System.find_executable("gitleaks") != nil

  @impl true
  def scan(worktree_path) do
    if available?() do
      run(worktree_path)
    else
      :unavailable
    end
  rescue
    _ -> {:error, :scan_failed}
  end

  defp run(worktree_path) do
    report_path =
      Path.join(System.tmp_dir!(), "gitleaks-#{System.unique_integer([:positive])}.json")

    result =
      System.cmd(
        "gitleaks",
        [
          "detect",
          "--source",
          worktree_path,
          "--report-format",
          "json",
          "--report-path",
          report_path,
          "--no-banner"
        ],
        stderr_to_stdout: true
      )

    outcome =
      case result do
        {_output, exit_code} when exit_code in [0, 1] -> parse(report_path)
        {_output, _exit} -> {:error, :scan_failed}
      end

    File.rm(report_path)
    outcome
  end

  defp parse(report_path) do
    case File.read(report_path) do
      {:ok, content} -> parse_content(content)
      {:error, :enoent} -> {:ok, []}
      {:error, reason} -> {:error, reason}
    end
  end

  defp parse_content(content) do
    case Jason.decode(content) do
      {:ok, findings} when is_list(findings) -> {:ok, Enum.map(findings, &format/1)}
      {:ok, _} -> {:ok, []}
      _ -> {:error, :invalid_output}
    end
  end

  defp format(finding) do
    %{
      tool: "gitleaks",
      path: finding["File"],
      line: finding["StartLine"],
      message: finding["Description"] || finding["RuleID"] || "segredo detectado"
    }
  end
end

defmodule Engine.Actions.GitleaksDetector.Fake do
  @moduledoc "Controlado via Application.env — sem Mox, sem Agent."

  @behaviour Engine.Actions.GitleaksDetector

  @impl true
  def available?, do: Application.get_env(:engine, :gitleaks_fake_available, false)

  @impl true
  def scan(_worktree_path) do
    Application.get_env(:engine, :gitleaks_fake_result, :unavailable)
  end
end
