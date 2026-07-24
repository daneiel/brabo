defmodule Engine.Actions.TerminalExecutor do
  @moduledoc """
  Executa um comando de terminal já aprovado, isolado no working tree do
  projeto, com timeout e captura de output. A decisão de aprovar já
  aconteceu na api (domain/actions/decide.ts) — este módulo confia no
  comando recebido e o executa via `sh -c` (interpreta &&/;/etc.
  nativamente; nunca reconstrói uma string a partir de tokens parseados).

  Limitação conhecida: ao estourar o timeout, `Task.shutdown` mata o
  processo Elixir que aguarda, mas não necessariamente o processo OS
  filho gerado por `System.cmd` (limitação documentada do Erlang/Elixir —
  matar o lado Erlang de uma porta não manda SIGKILL pro processo OS por
  trás dela). Aceitável pra este incremento (demo-grade); resolver isso
  de verdade pediria uma lib tipo MuonTrap, não justificada ainda.
  """

  alias Engine.Actions.Workspace
  alias Engine.Projects.ProjectRepository

  @bytes_per_token 4

  def run(project_id, command, timeout_ms \\ nil) do
    timeout = timeout_ms || Application.fetch_env!(:engine, :terminal_action_timeout_ms)

    case ProjectRepository.get_local_repo_path(project_id) do
      {:ok, bare_repo_path, default_branch} ->
        dir = Workspace.ensure!(project_id, bare_repo_path, default_branch)
        execute(dir, command, timeout)

      {:error, reason} ->
        failed_result("workspace indisponível: #{inspect(reason)}")
    end
  end

  defp execute(dir, command, timeout_ms) do
    task =
      Task.async(fn -> System.cmd("sh", ["-c", command], cd: dir, stderr_to_stdout: true) end)

    case Task.yield(task, timeout_ms) || Task.shutdown(task, :brutal_kill) do
      {:ok, {output, exit_code}} -> build_result(output, exit_code, false)
      nil -> failed_result("timeout após #{timeout_ms}ms", timed_out: true)
    end
  end

  defp build_result(output, exit_code, timed_out) do
    raw_bytes = byte_size(output)
    {compressed_bytes, estimated_tokens_compressed} = compression_estimate(raw_bytes)

    %{
      stdout: output,
      stderr: "",
      exit_code: exit_code,
      timed_out: timed_out,
      raw_bytes: raw_bytes,
      estimated_tokens_raw: estimate_tokens(raw_bytes),
      compressed_bytes: compressed_bytes,
      estimated_tokens_compressed: estimated_tokens_compressed
    }
  end

  defp failed_result(message, opts \\ []) do
    %{
      stdout: "",
      stderr: message,
      exit_code: nil,
      timed_out: Keyword.get(opts, :timed_out, false),
      raw_bytes: 0,
      estimated_tokens_raw: 0,
      compressed_bytes: nil,
      estimated_tokens_compressed: nil
    }
  end

  # Nunca reexecuta o comando real só pra medir compressão (perigoso pra
  # comandos com efeito colateral) — só consulta o `rtk gain`, read-only,
  # e estima a partir da razão que ele reportar.
  defp compression_estimate(raw_bytes) do
    if rtk_detector().available?() do
      case rtk_detector().gain_ratio() do
        ratio when is_float(ratio) and ratio >= 0.0 and ratio < 1.0 ->
          compressed = round(raw_bytes * (1 - ratio))
          {compressed, estimate_tokens(compressed)}

        _ ->
          {nil, nil}
      end
    else
      {nil, nil}
    end
  end

  # Ceiling division — qualquer output não-vazio conta como pelo menos 1
  # token estimado (div/2 arredondaria "oi\n" pra 0, o que não faz sentido
  # como estimativa de tokens de uma saída real).
  defp estimate_tokens(0), do: 0
  defp estimate_tokens(bytes), do: max(1, div(bytes + @bytes_per_token - 1, @bytes_per_token))

  defp rtk_detector,
    do: Application.get_env(:engine, :rtk_detector, Engine.Actions.RtkDetector.Live)
end
