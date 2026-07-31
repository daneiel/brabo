defmodule Engine.Actions.ActionlintDetector do
  @moduledoc """
  Contrato pra detectar/rodar o `actionlint` (lint sintático de workflow do
  GitHub Actions, subagente Workflows — Fase 8c). Mesmo padrão de
  `Engine.Actions.HadolintDetector`: feature-detecção via
  `System.find_executable/1`, ausência do binário degrada graciosamente
  (`:unavailable`), nunca quebra o turno. Trocável em teste via
  `Application.get_env(:engine, :actionlint_detector, ...)`.

  Só entende `.github/workflows/*.{yml,yaml}` — `actionlint` NÃO valida
  `.gitlab-ci.yml` (schema diferente, sem equivalente estático offline). O
  `Engine.Infra.Tools.ValidateInfraFile` decide QUANDO chamar este detector
  por extensão de caminho; este módulo só sabe rodar o binário contra
  conteúdo de workflow.
  """

  @callback available?() :: boolean()
  @callback lint(content :: String.t()) ::
              {:ok, [map()]} | {:error, term()} | :unavailable
end

defmodule Engine.Actions.ActionlintDetector.Live do
  @moduledoc """
  Escreve o conteúdo num arquivo temporário sob um diretório
  `.github/workflows/` (actionlint só reconhece workflow pelo PATH) e roda
  `actionlint <path>`. Exit `0` = limpo, `1` = achados (não é falha do
  processo) — só um exit fora de [0, 1] é erro real. Saída no formato
  padrão (`path:line:col: message [rule]`), parseada por linha — sem
  depender de template Go pra JSON.
  """

  @behaviour Engine.Actions.ActionlintDetector

  @impl true
  def available?, do: System.find_executable("actionlint") != nil

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
    root = Path.join(System.tmp_dir!(), "actionlint-#{System.unique_integer([:positive])}")
    dir = Path.join([root, ".github", "workflows"])
    File.mkdir_p!(dir)
    path = Path.join(dir, "ci.yml")
    File.write!(path, content)

    outcome =
      case System.cmd("actionlint", [path], stderr_to_stdout: true) do
        {output, exit_code} when exit_code in [0, 1] -> parse(output)
        {_output, _exit} -> {:error, :lint_failed}
      end

    File.rm_rf(root)
    outcome
  end

  # `path:line:col: message [rule]` — uma linha por achado. `actionlint` não
  # distingue severidade (tudo que reporta é erro sintático/semântico), então
  # todo achado carrega `level: "error"`, igual ao hadolint quando o achado
  # não informa nível.
  defp parse(output) do
    findings =
      output
      |> String.split("\n", trim: true)
      |> Enum.map(&parse_line/1)
      |> Enum.reject(&is_nil/1)

    {:ok, findings}
  end

  @linha ~r/^.+?:(\d+):(\d+):\s*(.+)$/

  defp parse_line(line) do
    case Regex.run(@linha, line) do
      [_, ln, _col, message] ->
        %{
          tool: "actionlint",
          path: ".github/workflows/ci.yml",
          line: String.to_integer(ln),
          level: "error",
          message: message
        }

      _ ->
        nil
    end
  end
end

defmodule Engine.Actions.ActionlintDetector.Fake do
  @moduledoc "Controlado via Application.env — sem Mox, sem Agent."

  @behaviour Engine.Actions.ActionlintDetector

  @impl true
  def available?, do: Application.get_env(:engine, :actionlint_fake_available, false)

  @impl true
  def lint(_content) do
    Application.get_env(:engine, :actionlint_fake_result, :unavailable)
  end
end
