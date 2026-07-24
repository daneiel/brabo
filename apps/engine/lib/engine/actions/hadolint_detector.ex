defmodule Engine.Actions.HadolintDetector do
  @moduledoc """
  Contrato pra detectar/rodar o `hadolint` (lint sintático de Dockerfile,
  InfraAgent — Fase 4a). Mesmo padrão de `Engine.Actions.RtkDetector`/
  `GitleaksDetector`/`SemgrepDetector`: feature-detecção via
  `System.find_executable/1`, ausência do binário degrada graciosamente
  (`:unavailable`), nunca quebra o turno/gate. Trocável em teste via
  `Application.get_env(:engine, :hadolint_detector, ...)`.

  Diferente dos outros dois (que rodam contra um WORKTREE de arquivos já no
  disco), o hadolint aqui roda contra CONTEÚDO direto — o InfraAgent gera o
  Dockerfile como texto (igual ADR), nunca toca um worktree.
  """

  @callback available?() :: boolean()
  @callback lint(content :: String.t()) ::
              {:ok, [map()]} | {:error, term()} | :unavailable
end

defmodule Engine.Actions.HadolintDetector.Live do
  @moduledoc """
  Escreve o conteúdo num arquivo temporário (hadolint só lê de um path de
  verdade) e roda `hadolint --format json <path>`. Exit `0` = limpo, `1` =
  achados (não é falha do processo) — só um exit fora de [0, 1] é erro real.
  """

  @behaviour Engine.Actions.HadolintDetector

  @impl true
  def available?, do: System.find_executable("hadolint") != nil

  @impl true
  def lint(content) do
    if available?() do
      run(content)
    else
      :unavailable
    end
  rescue
    _ -> {:error, :lint_failed}
  end

  defp run(content) do
    path =
      Path.join(System.tmp_dir!(), "hadolint-#{System.unique_integer([:positive])}.Dockerfile")

    File.write!(path, content)

    outcome =
      case System.cmd("hadolint", ["--format", "json", path], stderr_to_stdout: true) do
        {output, exit_code} when exit_code in [0, 1] -> parse(output)
        {_output, _exit} -> {:error, :lint_failed}
      end

    File.rm(path)
    outcome
  end

  defp parse(output) do
    case Jason.decode(output) do
      {:ok, findings} when is_list(findings) -> {:ok, Enum.map(findings, &format/1)}
      {:ok, _} -> {:ok, []}
      _ -> {:error, :invalid_output}
    end
  end

  defp format(finding) do
    %{
      tool: "hadolint",
      path: "Dockerfile",
      line: finding["line"],
      message: "[#{finding["code"]}] #{finding["message"]}"
    }
  end
end

defmodule Engine.Actions.HadolintDetector.Fake do
  @moduledoc "Controlado via Application.env — sem Mox, sem Agent."

  @behaviour Engine.Actions.HadolintDetector

  @impl true
  def available?, do: Application.get_env(:engine, :hadolint_fake_available, false)

  @impl true
  def lint(_content) do
    Application.get_env(:engine, :hadolint_fake_result, :unavailable)
  end
end
