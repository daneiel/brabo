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
end
