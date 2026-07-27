defmodule Engine.Actions.YamlLintDetector do
  @moduledoc """
  Contrato pra detectar/rodar o `yamllint` (validação sintática de YAML — o
  compose de dev e o esqueleto de CI que o InfraAgent propõe, Fase 4a).

  Espelha `Engine.Actions.HadolintDetector`: recebe CONTEÚDO (não path), roda o
  binário externo, e a ausência dele degrada graciosamente (`:unavailable`) sem
  quebrar o gate. Trocável em teste via
  `Application.get_env(:engine, :yamllint_detector, ...)`.

  Existe porque o gate de QA de infra só olhava Dockerfile: uma PR só com
  `docker-compose.yml` e `.github/workflows/ci.yml` era aprovada sem checagem
  nenhuma, embora o enunciado da Fase 4a peça "validação sintática" das PRs de
  infra (ver ADR 0021). Não há parser de YAML nas deps do Elixir, e o padrão da
  casa pra validação é ferramenta externa com detecção opcional.

  Cada achado carrega `:level` — só `"error"` reprova o gate, pelo mesmo motivo
  documentado no `HadolintDetector`.
  """

  @callback available?() :: boolean()
  @callback lint(content :: String.t()) ::
              {:ok, [map()]} | {:error, term()} | :unavailable
end

defmodule Engine.Actions.YamlLintDetector.Live do
  @moduledoc """
  `yamllint -f parsable -d "{rules: {}}" <path>` sobre um arquivo temporário.

  A config com REGRAS VAZIAS é o ponto todo: o objetivo aqui é validar SINTAXE,
  e o yamllint com qualquer perfil de estilo reprova coisas que não têm nada a
  ver com o YAML ser válido. O perfil `relaxed` chega a classificar
  `new-line-at-end-of-file` como `[error]` — YAML gerado por LLM raramente
  termina com quebra de linha, então isso barraria toda PR de infra e o
  InfraAgent circularia até estourar o teto de correções.

  Sem nenhuma regra ativa, o yamllint só reporta falha de PARSE (que não é
  regra), com `(syntax)` no fim da linha. Verificado no container: YAML válido
  sem newline final sai limpo; `ports: [` sem fechar sai
  `[error] syntax error: ... (syntax)`.

  Exit `0` = limpo, `1` = achados (não é falha do processo) — só um exit fora
  de [0, 1] é erro real. Formato `parsable`: `arquivo:linha:coluna: [nível]
  mensagem (regra)`.
  """

  @behaviour Engine.Actions.YamlLintDetector

  # `file:line:col: [level] message`
  @linha_regex ~r/^[^:]*:(?<line>\d+):\d+:\s*\[(?<level>\w+)\]\s*(?<message>.*)$/

  @impl true
  def available?, do: System.find_executable("yamllint") != nil

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
    path = Path.join(System.tmp_dir!(), "yamllint-#{System.unique_integer([:positive])}.yml")

    File.write!(path, content)

    outcome =
      case System.cmd("yamllint", ["-f", "parsable", "-d", "{rules: {}}", path],
             stderr_to_stdout: true
           ) do
        {output, exit_code} when exit_code in [0, 1] -> {:ok, parse(output)}
        {_output, _exit} -> {:error, :lint_failed}
      end

    File.rm(path)
    outcome
  end

  defp parse(output) do
    output
    |> String.split("\n", trim: true)
    |> Enum.flat_map(&format/1)
  end

  defp format(linha) do
    case Regex.named_captures(@linha_regex, linha) do
      nil ->
        []

      %{"line" => line, "level" => level, "message" => message} ->
        [
          %{
            tool: "yamllint",
            path: "yaml",
            line: String.to_integer(line),
            level: level,
            message: message
          }
        ]
    end
  end
end

defmodule Engine.Actions.YamlLintDetector.Fake do
  @moduledoc "Controlado via Application.env — sem Mox, sem Agent."

  @behaviour Engine.Actions.YamlLintDetector

  @impl true
  def available?, do: Application.get_env(:engine, :yamllint_fake_available, false)

  @impl true
  def lint(_content) do
    Application.get_env(:engine, :yamllint_fake_result, :unavailable)
  end
end
