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

  ## Roteamento pro runner local (projeto `runner`, verificado, conectado —
  ## RN-423, ADR 0104)

  O comando que chega aqui JÁ foi aprovado pelo pipeline de sempre
  (`decide()`/`proposed_action` do lado api) — este módulo nunca decide SE
  um comando pode rodar, só ONDE. Quando o projeto está em modo `runner`
  (ADR 0072/0104), há TRÊS pré-condições, não uma: workspace VERIFICADO
  (`workspace_verified_at` não-nulo — o runner confirmou o caminho no host
  pelo menos uma vez) e runner CONECTADO agora (`Engine.Runners.Registry`).
  Só com as duas o comando é entregue via canal Phoenix
  (`Engine.Runners.RunnerRouter`) em vez de `System.cmd` local.

  Faltando qualquer uma das duas, o comando é RECUSADO explicitamente — NUNCA
  cai no `System.cmd`/bind-mount de `mounted`, que não existe pra um projeto
  `runner`. Desde a RN-501 (ADR 0142), o caminho de sempre (`System.cmd`
  local) não vale mais para modo de execução NENHUM: ele sobrou só para
  projeto inexistente ou `project_id` malformado (ver a seção abaixo).

  ## Execução DENTRO do container real do projeto (`container`/`mounted`, com
  ## um container REGISTRADO `running` — RN-492/RN-501, ADR 0134/0142)

  Quando o projeto está em `execution_mode: container`/`mounted` (ADR 0072) e
  há uma linha `running` em `project_containers` (ADR 0081/0130/0133 —
  `Engine.Containers.ProjectContainerLifecycle.running?/1`), o comando NÃO
  roda mais via `System.cmd` no processo do engine: ele atravessa
  engine -> api -> broker (`ContainerBrokerPort.exec`) e roda DENTRO do
  container, via `docker exec`. `cwd`, quando presente, é traduzido do
  caminho de HOST (dentro de `project_workspaces_root`) para dentro de
  `/work` — o único diretório que o container enxerga.

  `running` REGISTRADO nunca confirma que o container está de pé DE VERDADE
  agora (RN-486: registrado e observado nunca se fundem). Se ele morreu ou
  foi removido por fora, a chamada ao broker falha e vira `failed_result`
  normal — nunca crash, nunca fallback silencioso de volta pro `System.cmd`
  fora do container, que reabriria o vetor de isolamento que este PR existe
  para fechar.

  E SEM container `running` a recusa é a mesma coisa vista do outro lado
  (RN-501, ADR 0142): `:recusar_container_ausente`, `failed_result` com o
  motivo nomeado. Era exatamente aqui que o ADR 0134 pousava só pela metade
  — a ausência de container não recusava, caía no `System.cmd` do processo
  do engine, e o isolamento que o ADR existe para criar valia só no caminho
  feliz.
  """

  alias Engine.Actions.Workspace
  alias Engine.Containers.ProjectContainerLifecycle
  alias Engine.Projects.{Project, ProjectRepository}
  alias Engine.Runners.{Registry, RunnerRouter}
  alias Engine.Sessions.EngineApiClient

  @bytes_per_token 4

  # Mesmo valor de `PONTO_DE_MONTAGEM` em
  # `packages/docker-port/src/docker-port.ts` (travado por teste lá — o
  # engine não importa pacote TS, então o literal aqui é a cópia, não a
  # fonte). ADR 0134/RN-492.
  @ponto_de_montagem "/work"

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

    case decisao_de_execucao(project_id) do
      :rotear_runner ->
        run_via_runner(project_id, command, cwd, timeout)

      :recusar_nao_verificado ->
        failed_result(
          "projeto no modo \"runner\" ainda não teve o workspace confirmado " <>
            "— rode `brabo-runner --project #{project_id} --dir <pasta>` na " <>
            "sua máquina antes de tentar de novo (RN-423)."
        )

      :recusar_runner_desconectado ->
        failed_result(
          "workspace já confirmado, mas nenhum runner está conectado a " <>
            "este projeto agora — rode `brabo-runner --project #{project_id} " <>
            "--dir <pasta>` na sua máquina e tente de novo."
        )

      :recusar_container_ausente ->
        failed_result(
          "o projeto não tem container REGISTRADO como `running` — o comando " <>
            "NÃO roda fora do container (RN-501). Suba o container do projeto " <>
            "(a Infra propõe `container_start`) e tente de novo."
        )

      :executar_no_container ->
        run_no_container(project_id, command, cwd, timeout)

      :caminho_de_sempre ->
        case cwd do
          nil -> run_in_project_workspace(project_id, command, timeout)
          cwd -> execute(cwd, command, timeout)
        end
    end
  end

  # `Project.get/1` (não `ProjectRepository`, que não expõe execution_mode)
  # devolve `nil` pra projeto inexistente/id malformado — degrada pro
  # caminho de sempre, nunca propaga erro daqui.
  #
  # SEIS saídas (RN-423/ADR 0104 + RN-492/ADR 0134 + RN-501/ADR 0142):
  #
  #   - `runner` sem workspace verificado: recusa (nunca roteia às cegas);
  #   - `runner` verificado, sem runner conectado: recusa (idem);
  #   - `runner` verificado e conectado: roteia pro canal Phoenix — e a
  #     escolha host-vs-container ali é INTERNA ao runner (ADR 0137);
  #   - `container`/`mounted` com um container REGISTRADO `running` (ADR
  #     0130/0133): executa DENTRO dele, via broker. `true` aqui é só o
  #     REGISTRADO (RN-486: registrado e observado nunca se fundem); se o
  #     container morreu por fora, a falha aparece em `run_no_container/4`,
  #     como falha normal de comando;
  #   - `container`/`mounted` SEM container `running`: RECUSA
  #     (`:recusar_container_ausente`) — ver abaixo;
  #   - projeto inexistente ou id malformado: caminho de sempre.
  #
  # ## O fallback silencioso que sumiu (RN-501, ADR 0142)
  #
  # Até aqui, `container` sem container `running` caía em
  # `:caminho_de_sempre`, isto é, `System.cmd` DENTRO do processo do engine —
  # o mesmo processo que fala com o banco, com a api e com todos os outros
  # projetos. O ADR 0134 tinha fechado o isolamento só pro caminho feliz: a
  # ausência de container não recusava, degradava, e degradava calada. Um
  # projeto que nunca subiu container executava comando de dev agent
  # exatamente como antes do broker existir, e nada na saída dizia isso.
  #
  # Agora recusa, espelhando `:recusar_nao_verificado`/
  # `:recusar_runner_desconectado`: a mesma disciplina que o modo `runner`
  # já tinha ("faltou a pré-condição, então não executa em lugar nenhum"),
  # aplicada ao modo `container`. `mounted` entra no MESMO ramo — ele
  # também tem container próprio desde que o `mounted` passou a subir pelo
  # broker; sem ele, `System.cmd` no engine seria a mesma degradação calada.
  # A recusa é `failed_result` normal no chamador, nunca crash: é o mesmo
  # contrato de falha das outras duas recusas deste módulo.
  #
  # O catch-all sobrou pro que ele sempre deveria ter coberto sozinho:
  # projeto inexistente / `project_id` malformado. Nenhum modo de execução
  # cai nele mais.
  defp decisao_de_execucao(project_id) do
    case Project.get(project_id) do
      %{execution_mode: "runner", workspace_verified_at: nil} ->
        :recusar_nao_verificado

      %{execution_mode: "runner"} ->
        if Registry.connected?(project_id),
          do: :rotear_runner,
          else: :recusar_runner_desconectado

      %{execution_mode: modo} when modo in ["container", "mounted"] ->
        if ProjectContainerLifecycle.running?(project_id),
          do: :executar_no_container,
          else: :recusar_container_ausente

      _ ->
        :caminho_de_sempre
    end
  rescue
    _ -> :caminho_de_sempre
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
      # caiu entre a checagem e o dispatch (ou nunca respondeu). NÃO cai
      # pro container (RN-423): um projeto `runner` não tem bind-mount, e
      # "cair pro caminho de sempre" seria a mesma execução às cegas que
      # `:recusar_runner_desconectado` já recusa — a mesma recusa aqui.
      {:error, :not_connected} ->
        failed_result(
          "o runner caiu durante a execução — rode `brabo-runner --project " <>
            "#{project_id} --dir <pasta>` na sua máquina e tente de novo."
        )

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

  # ADR 0134/RN-492 — a nova perna: engine -> api -> broker.exec.
  #
  # `cwd` chega aqui como caminho ABSOLUTO DO HOST (dentro de
  # `project_workspaces_root`, o mesmo que `run_in_project_workspace/3` usa
  # pro caminho de sempre) ou `nil` (roda na raiz do workspace). É traduzido
  # pra dentro de `/work` ANTES de sair pro `EngineApiClient` — o broker
  # nunca vê um caminho de host.
  #
  # Falha do broker (recusou, não respondeu, ou o container morreu/foi
  # removido por fora entre o `running` registrado e agora — RN-486) é
  # FALHA NORMAL do comando: `failed_result`, nunca crash, nunca fallback
  # silencioso pro `System.cmd` fora do container — isso reabriria o vetor
  # de isolamento que este PR existe para fechar.
  defp run_no_container(project_id, command, cwd, timeout) do
    container_cwd = cwd_para_container(project_id, cwd)

    case EngineApiClient.executar_comando_no_container(
           project_id,
           command,
           container_cwd,
           timeout
         ) do
      {:ok, %{"sucesso" => false} = payload} ->
        motivo = Map.get(payload, "motivo") || "motivo não informado"
        failed_result("execução no container do projeto recusada: #{motivo}")

      {:ok, payload} ->
        build_result(
          Map.get(payload, "output") || "",
          Map.get(payload, "exitCode"),
          Map.get(payload, "timedOut") || false
        )

      {:error, reason} ->
        failed_result(
          "não foi possível executar no container do projeto (comunicação " <>
            "engine -> api -> broker): #{inspect(reason)}"
        )
    end
  end

  defp cwd_para_container(_project_id, nil), do: nil

  defp cwd_para_container(project_id, cwd) do
    raiz = Workspace.workspace_dir(project_id)

    cond do
      cwd == raiz ->
        @ponto_de_montagem

      String.starts_with?(cwd, raiz <> "/") ->
        @ponto_de_montagem <> String.trim_leading(cwd, raiz)

      true ->
        # `cwd` fora da raiz do workspace deste projeto — não deveria
        # acontecer pra `execution_mode: container` (todo cwd nasce dentro
        # dela, worktree de dev agent incluso), mas não adivinha: manda como
        # veio, e o broker recusa com `DiretorioForaDoEscopoError` se não
        # estiver dentro de `/work` — defesa em profundidade, nunca um
        # caminho fabricado silenciosamente.
        cwd
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
