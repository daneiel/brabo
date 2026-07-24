defmodule Engine.Actions.SemgrepDetector do
  @moduledoc """
  Contrato pra detectar/rodar o `semgrep` (scanner estático, SecOpsAgent —
  Fase 4a). Mesmo padrão do `Engine.Actions.RtkDetector`: feature-detecção
  via `System.find_executable/1`, nunca assume instalado — instalação em
  Alpine (container do engine) tem risco real de instabilidade, então
  ausência do binário degrada graciosamente (`:unavailable`), nunca quebra o
  gate. Trocável em teste via `Application.get_env(:engine,
  :semgrep_detector, ...)`.
  """

  @callback available?() :: boolean()
  @callback scan(worktree_path :: String.t()) ::
              {:ok, [map()]} | {:error, term()} | :unavailable
end

defmodule Engine.Actions.SemgrepDetector.Live do
  @moduledoc """
  `semgrep --config auto --json` sobre o worktree. Exit code `1` do semgrep
  significa "achou findings" (não é falha de execução) — só um exit
  diferente de 0/1 é erro real. Parsing best-effort: saída inesperada vira
  `{:error, :invalid_output}`, nunca derruba o SecOpsAgent.
  """

  @behaviour Engine.Actions.SemgrepDetector

  @impl true
  def available?, do: System.find_executable("semgrep") != nil

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
    case System.cmd("semgrep", ["--config", "auto", "--json", "--quiet", worktree_path],
           stderr_to_stdout: false
         ) do
      {output, exit_code} when exit_code in [0, 1] -> parse(output)
      {_output, _exit} -> {:error, :scan_failed}
    end
  end

  defp parse(output) do
    case Jason.decode(output) do
      {:ok, %{"results" => results}} -> {:ok, Enum.map(results, &format/1)}
      _ -> {:error, :invalid_output}
    end
  end

  defp format(result) do
    %{
      tool: "semgrep",
      path: result["path"],
      line: get_in(result, ["start", "line"]),
      message: get_in(result, ["extra", "message"]) || result["check_id"] || "achado do semgrep"
    }
  end
end

defmodule Engine.Actions.SemgrepDetector.Fake do
  @moduledoc "Controlado via Application.env — sem Mox, sem Agent."

  @behaviour Engine.Actions.SemgrepDetector

  @impl true
  def available?, do: Application.get_env(:engine, :semgrep_fake_available, false)

  @impl true
  def scan(_worktree_path) do
    Application.get_env(:engine, :semgrep_fake_result, :unavailable)
  end
end
