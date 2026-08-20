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

  ## Roteamento pro runner local (projeto `local` + runner conectado)

  O comando que chega aqui JÁ foi aprovado pelo pipeline de sempre
  (`decide()`/`proposed_action` do lado api) — este módulo nunca decide SE
  um comando pode rodar, só ONDE. Quando o projeto está em modo `local`
  (ADR 0072) e há um runner conectado (`Engine.Runners.Registry`), o
  comando é entregue a ele via canal Phoenix (`Engine.Runners.RunnerRouter`)
  em vez de `System.cmd` local. Sem runner conectado — mesmo em modo
  `local` — o caminho de sempre (bind-mount + `System.cmd` no container)
  continua sendo o FALLBACK, nunca removido.
  """

  alias Engine.Actions.Workspace
  alias Engine.Projects.{Project, ProjectRepository}
  alias Engine.Runners.{Registry, RunnerRouter}

  @bytes_per_token 4

  @doc """
  `opts[:cwd]` sobrescreve o diretório de execução (ex.: o worktree de um dev
  agent) — sem ele, roda no workspace compartilhado do projeto (comportamento
  de sempre). `opts[:timeout_ms]` sobrescreve o timeout default.
  """
  def run(project_id, command, opts \\ []) do
    timeout =
      Keyword.get(opts, :timeout_ms) ||
        Application.fetch_env!(:engine, :terminal_action_timeout_ms)

    cwd = Keyword.get(opts, :cwd)

    if roteia_para_runner?(project_id) do
      run_via_runner(project_id, command, cwd, timeout)
    else
      case cwd do
        nil -> run_in_project_workspace(project_id, command, timeout)
        cwd -> execute(cwd, command, timeout)
      end
    end
  end

  # `Project.get/1` (não `ProjectRepository`, que não expõe workspace_mode)
  # devolve `nil` pra projeto inexistente/id malformado — degrada pro
  # caminho de sempre, nunca propaga erro daqui.
  defp roteia_para_runner?(project_id) do
    case Project.get(project_id) do
      %{workspace_mode: "local"} -> Registry.connected?(project_id)
      _ -> false
    end
  rescue
    _ -> false
  end

  defp run_via_runner(project_id, command, cwd, timeout) do
    efetivo_cwd = cwd || workspace_path_local(project_id)

    case RunnerRouter.exec(project_id, command, efetivo_cwd, timeout) do
      {:ok, payload} ->
        build_result(
          Map.get(payload, "output") || "",
          Map.get(payload, "exitCode"),
          Map.get(payload, "timedOut") || false
        )

      # Race: Registry dizia conectado no início de run/3, mas o runner
      # caiu entre a checagem e o dispatch (ou nunca respondeu). Cai pro
      # caminho de sempre em vez de falhar a ação inteira.
      {:error, :not_connected} ->
        case cwd do
          nil -> run_in_project_workspace(project_id, command, timeout)
          cwd -> execute(cwd, command, timeout)
        end

      {:error, :timeout} ->
        failed_result("timeout do runner após #{timeout}ms", timed_out: true)
    end
  end

  defp workspace_path_local(project_id) do
    case Project.get(project_id) do
      %{workspace_path: path} when is_binary(path) -> path
      _ -> nil
    end
  end

  defp run_in_project_workspace(project_id, command, timeout) do
    # `remoto_de_trabalho/1` cobre provider local E remoto (ADR 0056) — antes,
    # todo comando falhava em projeto do GitHub porque o executor só sabia
    # resolver bare repo local.
    case ProjectRepository.remoto_de_trabalho(project_id) do
      {:ok, remoto} ->
        case Workspace.ensure_remoto(project_id, remoto) do
          {:ok, dir} -> execute(dir, command, timeout)
          {:error, reason} -> failed_result("workspace indisponível: #{reason}")
        end

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
      stdout: truncate(output, raw_bytes),
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

  @doc false
  # Teto de bytes da saída (achado S).
  #
  # A saída de CADA comando fica no histórico do laço e viaja em TODO turno
  # seguinte. Sem teto, um `find` numa árvore grande basta: a execução do
  # hello-limpo morreu com `{413, "request entity too large"}` no turno 18,
  # antes de escrever uma linha. O estouro é de BYTES da requisição contra o
  # limite de transporte HTTP da própria api do Brabo — não do provider de
  # LLM, e não de janela de contexto: a maior chamada bem-sucedida tinha só
  # 28.993 tokens de entrada.
  #
  # `raw_bytes` continua sendo o tamanho REAL produzido, não o truncado: é
  # medição, e mentir nela esconderia exatamente o comportamento que motivou
  # o teto. Quem quiser detectar truncagem compara `byte_size(stdout)` com
  # `raw_bytes` — ou lê a marca, que é o que o MODELO faz.
  def truncate(output, raw_bytes) do
    max = max_output_bytes()

    if raw_bytes <= max do
      output
    else
      output
      |> binary_part(0, max)
      |> cortar_utf8_incompleto()
      |> Kernel.<>(marca_de_truncagem(max, raw_bytes))
    end
  end

  # A marca é endereçada ao modelo, não ao humano: diz o que sumiu E o que
  # fazer a respeito. Sem a segunda metade ele tende a repetir o mesmo comando.
  defp marca_de_truncagem(max, raw_bytes) do
    "\n\n[saída truncada: #{max} de #{raw_bytes} bytes. " <>
      "Refine o comando (head, grep, -maxdepth) para ver o que falta.]"
  end

  # `binary_part/3` corta por BYTE e pode partir um caractere multibyte ao
  # meio, produzindo binário inválido que quebra a serialização JSON do
  # resultado. Recua até 3 bytes — o máximo de uma sequência UTF-8 incompleta.
  defp cortar_utf8_incompleto(bin), do: cortar_utf8_incompleto(bin, 3)

  defp cortar_utf8_incompleto(bin, 0), do: bin

  defp cortar_utf8_incompleto(bin, tentativas) do
    if String.valid?(bin) do
      bin
    else
      bin
      |> binary_part(0, byte_size(bin) - 1)
      |> cortar_utf8_incompleto(tentativas - 1)
    end
  end

  defp max_output_bytes,
    do: Application.get_env(:engine, :terminal_output_max_bytes, 32_768)

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
