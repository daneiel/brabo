defmodule EngineWeb.ContainerCommandController do
  @moduledoc """
  A api pedindo ao engine para repassar uma operação de container ao RUNNER
  conectado (`terminal:<projectId>`, papel `:runner`) — ADR 0137. Existe
  porque só o engine enxerga o canal Phoenix onde o runner escuta; a api não
  fala com ele diretamente, do mesmo jeito que ela não fala com o daemon
  Docker do broker diretamente (ADR 0130).

  Chamado só para projeto `mounted`/`runner` — `execution_mode: container`
  continua indo pelo broker (`ContainerBrokerPort`, `apps/broker`), que este
  controller nunca toca. `ExecuteContainerStartUseCase`/`ExecuteContainerStopUseCase`/
  `ExecuteContainerRemoveUseCase`, do lado api, são quem decide qual dos dois
  caminhos usar, pelo `executionMode` do projeto — este controller não sabe
  disso, só repassa.

  ## A resposta é SEMPRE 200

  Mesma disciplina de `ActionCommandController`/`ExecutarComandoNoContainerUseCase`:
  `sucesso: false` no CORPO, nunca um status HTTP de erro, para as causas que
  são falha NORMAL do comando — sem runner conectado, timeout, ou o runner
  tendo tentado e recusado (Docker indisponível na máquina do usuário,
  especificação inválida). `motivoCodigo` só vem preenchido quando o engine
  NEM CHEGOU a perguntar ao runner (`RunnerRouter` devolveu `{:error, _}`) —
  é o sinal que o `HttpApiToEngineClient` usa para lançar
  `RunnerNaoConectadoError` em vez de `RunnerRecusouContainerError` do lado
  api.
  """

  use EngineWeb, :controller

  alias Engine.Runners.RunnerRouter

  def start(conn, %{"projectId" => project_id, "spec" => spec}) do
    responder(conn, RunnerRouter.start_container(project_id, spec), :start)
  end

  def stop(conn, %{"projectId" => project_id, "workspaceDirName" => workspace_dir_name}) do
    responder(conn, RunnerRouter.stop_container(project_id, workspace_dir_name), :stop_ou_remove)
  end

  def remove(conn, %{"projectId" => project_id, "workspaceDirName" => workspace_dir_name}) do
    responder(
      conn,
      RunnerRouter.remove_container(project_id, workspace_dir_name),
      :stop_ou_remove
    )
  end

  defp responder(conn, {:error, :not_connected}, _formato) do
    json(conn, %{
      sucesso: false,
      motivoCodigo: "not_connected",
      motivo: "nenhum runner conectado a este projeto"
    })
  end

  defp responder(conn, {:error, :timeout}, _formato) do
    json(conn, %{
      sucesso: false,
      motivoCodigo: "timeout",
      motivo: "o runner não respondeu a tempo"
    })
  end

  defp responder(conn, {:ok, payload}, :start) do
    case Map.get(payload, "sucesso") do
      true ->
        json(conn, %{
          sucesso: true,
          containerId: Map.get(payload, "containerId"),
          nome: Map.get(payload, "nome"),
          jaEstavaDePe: Map.get(payload, "jaEstavaDePe") || false
        })

      _ ->
        json(conn, %{
          sucesso: false,
          motivo: Map.get(payload, "erro") || "motivo não informado"
        })
    end
  end

  defp responder(conn, {:ok, payload}, :stop_ou_remove) do
    case Map.get(payload, "sucesso") do
      true ->
        json(conn, %{sucesso: true})

      _ ->
        json(conn, %{
          sucesso: false,
          motivo: Map.get(payload, "erro") || "motivo não informado"
        })
    end
  end
end
