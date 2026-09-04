defmodule Engine.Runners.RunnerRouter do
  @moduledoc """
  Ponte SÍNCRONA entre `Engine.Actions.TerminalExecutor` (chamado pelo
  controller HTTP `/internal/actions/execute`, que a api espera responder de
  forma síncrona) e o runner conectado no canal `terminal:<projectId>`
  (`EngineWeb.TerminalChannel`).

  O comando já passou pelo pipeline de aprovação (`decide()`/
  `proposed_action`) do lado api ANTES de `TerminalExecutor.run/3` ser
  chamado — este módulo só entrega o comando já aprovado ao processo certo
  e espera a resposta, exatamente como `TerminalExecutor.execute/3` já fazia
  via `System.cmd` no caminho de container.

  ## Como a correlação atravessa o cluster

  `Engine.Runners.Registry.whereis/1` devolve o pid do canal em QUALQUER nó
  (registro `:global`). `send/2` para um pid remoto funciona nativamente na
  distribuição do Erlang/OTP — não precisa de nenhuma ponte adicional. O
  canal empurra o evento `"exec"` pro cliente runner (`push/3`) e guarda
  `{ref, from}` em `socket.assigns.pending_execs`; quando o push
  `"exec_result"` do runner chega com o mesmo `ref`, o canal manda
  `{:runner_exec_result, ref, payload}` de volta pro `from` — que é este
  processo, bloqueado em `receive`.
  """

  alias Engine.Runners.Registry

  # Teto default das TRÊS operações de container abaixo — não reusa
  # `terminal_action_timeout_ms` de propósito: aquela config é do terminal, e
  # um `docker start`/`pull` implícito de imagem pode legitimamente levar
  # mais tempo que um comando de terminal comum.
  @timeout_padrao_ms 60_000

  @doc """
  Executa `command` no runner conectado a `project_id`, com `cwd` (pode ser
  `nil`) e `timeout_ms`. Devolve `{:ok, payload}` (o mapa cru do
  `"exec_result"`, chaves string) | `{:error, :not_connected}` |
  `{:error, :timeout}`.
  """
  def exec(project_id, command, cwd, timeout_ms) do
    case Registry.whereis(project_id) do
      nil ->
        {:error, :not_connected}

      pid ->
        ref = Ecto.UUID.generate()
        send(pid, {:dispatch_exec, ref, command, cwd, self(), timeout_ms})

        receive do
          {:runner_exec_result, ^ref, payload} -> {:ok, payload}
        after
          timeout_ms -> {:error, :timeout}
        end
    end
  end

  @doc """
  Pede ao runner conectado a `project_id` para SUBIR o container do projeto
  (`spec`, o mapa que `EngineWeb.ContainerCommandController` recebeu da api —
  os mesmos campos de `EntradaDeEspecificacao` de `packages/docker-port`,
  menos `raizDoProjeto`, que o runner enche sozinho com a raiz confirmada no
  startup). Mesmo par exec/exec_result, evento `container_start`/
  `container_start_result`. Devolve `{:ok, payload}` (o mapa cru de
  `"container_start_result"`) | `{:error, :not_connected}` |
  `{:error, :timeout}` — mesmo contrato de `exec/4`.
  """
  def start_container(project_id, spec, timeout_ms \\ @timeout_padrao_ms) do
    dispatch(
      project_id,
      :dispatch_container_start,
      spec,
      timeout_ms,
      :runner_container_start_result
    )
  end

  @doc "Espelho de `start_container/3` para `container_stop` — `workspace_dir_name` é o payload."
  def stop_container(project_id, workspace_dir_name, timeout_ms \\ @timeout_padrao_ms) do
    dispatch(
      project_id,
      :dispatch_container_stop,
      workspace_dir_name,
      timeout_ms,
      :runner_container_stop_result
    )
  end

  @doc "Espelho de `start_container/3` para `container_remove`."
  def remove_container(project_id, workspace_dir_name, timeout_ms \\ @timeout_padrao_ms) do
    dispatch(
      project_id,
      :dispatch_container_remove,
      workspace_dir_name,
      timeout_ms,
      :runner_container_remove_result
    )
  end

  # O molde comum das TRÊS operações de container acima — mesmo desenho de
  # `exec/4` (`Registry.whereis` -> `send` correlacionado por `ref` -> espera
  # bloqueada por `receive ... after`), fatorado porque três cópias quase
  # idênticas divergiam só no átomo de evento e no de resultado.
  defp dispatch(project_id, evento_tag, payload, timeout_ms, resultado_tag) do
    case Registry.whereis(project_id) do
      nil ->
        {:error, :not_connected}

      pid ->
        ref = Ecto.UUID.generate()
        send(pid, {evento_tag, ref, payload, self(), timeout_ms})

        receive do
          {^resultado_tag, ^ref, resultado} -> {:ok, resultado}
        after
          timeout_ms -> {:error, :timeout}
        end
    end
  end
end
