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

  # Ruleset NOMEADO, não `--config auto`: o `auto` exige telemetria ligada
  # ("Cannot create auto config when metrics are off") e mandar o perfil do
  # código do usuário pro semgrep.dev não é aceitável num gate de segurança.
  # Com um pacote nomeado o scan roda com `--metrics=off`.
  #
  # As regras ainda vêm do registry pela REDE na primeira execução (ficam em
  # cache depois): sem rede o semgrep sai com erro, o que aqui vira
  # `{:error, :scan_failed}` e o gate registra "pulado" no resumo do parecer,
  # nunca trava. O teto de tempo fica no `Engine.Gates.Scanner`, que chama isto.
  @args [
    "--config",
    "p/security-audit",
    "--json",
    "--quiet",
    "--metrics=off",
    # Dependências e histórico não são código desta PR, e são o grosso do
    # tempo de varredura numa árvore de projeto real.
    "--exclude=node_modules",
    "--exclude=.git"
  ]

  defp run(worktree_path) do
    {output, exit_code} = System.cmd("semgrep", @args ++ [worktree_path], stderr_to_stdout: false)
    interpretar(output, exit_code)
  end

  @doc false
  # Exit `1` é AMBÍGUO no semgrep: "achou findings" (com JSON no stdout) ou
  # exceção do Python (traceback no stderr, stdout VAZIO). Medido na AT-380
  # (RN-707): com `$HOME` não gravável o semgrep morre criando `~/.semgrep`,
  # sai 1 sem saída, e isso chegava ao parecer como `:invalid_output`, que
  # sugere um JSON mal formado. Stdout vazio é falha de EXECUÇÃO, nomeada.
  def interpretar(output, exit_code) when exit_code in [0, 1] do
    if String.trim(output) == "" do
      {:error, {:sem_saida, exit_code}}
    else
      parse(output)
    end
  end

  def interpretar(_output, _exit_code), do: {:error, :scan_failed}

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
