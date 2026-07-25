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
  `gitleaks dir <worktree>` — varre a ÁRVORE DE TRABALHO. Escreve o relatório
  num arquivo temporário (o gitleaks não suporta imprimir JSON puro em stdout
  de forma confiável entre versões), lê e apaga em seguida. Exit `1` = achou
  segredos (não é falha); só um exit diferente de 0/1 é erro real.

  ## Por que `dir` e não `detect`

  `gitleaks detect` varre o LOG DE COMMITS, não a árvore. Isso tornava o
  critério de aceite dos gates literalmente inalcançável: o dev commita um
  segredo, o SecOps reprova, o dev remove o segredo num commit NOVO — e o
  segredo continua no commit anterior da branch. O SecOps reprovava de novo a
  cada volta até estourar o teto de correções e a task virar `blocked`.
  Comprovado no container: com o segredo já removido da árvore, `detect`
  reportava 1 achado e `dir`, 0.

  Consequência aceita: varre a árvore inteira do worktree (superset do diff —
  ver `Engine.Gates.Diff`), então um segredo pré-existente na branch base
  reprova toda PR. É o comportamento correto pra um gate, mas é mais amplo do
  que o "sobre o diff" do ADR 0013.

  O subcomando `dir` existe desde o gitleaks 8.19 — daí o pin
  `GITLEAKS_VERSION` no `docker/engine/Dockerfile` ser load-bearing. Binário
  antigo demais devolve exit fora de `[0, 1]` e cai no `{:error,
  :scan_failed}`, que o `SecOpsAgentServer` trata como "pulado".
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
          "dir",
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
        {_output, exit_code} when exit_code in [0, 1] -> parse(report_path, worktree_path)
        {_output, _exit} -> {:error, :scan_failed}
      end

    File.rm(report_path)
    outcome
  end

  defp parse(report_path, worktree_path) do
    case File.read(report_path) do
      {:ok, content} -> parse_content(content, worktree_path)
      {:error, :enoent} -> {:ok, []}
      {:error, reason} -> {:error, reason}
    end
  end

  defp parse_content(content, worktree_path) do
    case Jason.decode(content) do
      {:ok, findings} when is_list(findings) ->
        {:ok, Enum.map(findings, &format(&1, worktree_path))}

      {:ok, _} ->
        {:ok, []}

      _ ->
        {:error, :invalid_output}
    end
  end

  defp format(finding, worktree_path) do
    %{
      tool: "gitleaks",
      path: relative_path(finding["File"], worktree_path),
      line: finding["StartLine"],
      message: finding["Description"] || finding["RuleID"] || "segredo detectado"
    }
  end

  # `gitleaks dir` reporta caminho ABSOLUTO (o `detect` reportava relativo).
  # O parecer vai pro usuário e pro prompt de correção do dev: o caminho
  # precisa ser o do repositório, não o do worktree dentro do container.
  defp relative_path(nil, _worktree_path), do: nil

  defp relative_path(path, worktree_path) do
    case Path.relative_to(path, worktree_path) do
      ^path -> path
      relative -> relative
    end
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
