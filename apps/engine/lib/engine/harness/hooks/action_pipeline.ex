defmodule Engine.Harness.Hooks.ActionPipeline do
  @moduledoc """
  Hook `:pre_tool_use` que liga o ToolLoop ao PIPELINE DE AÇÕES (item 4). Pras
  ferramentas que precisam de aprovação, cria um `proposed_action` na api
  (decide/permissions) ANTES do despacho e produz o resultado:

    * `terminal` — cria ação `terminal`; a api auto-executa quando
      `auto_approved` → o resultado (stdout/exit) vira o resultado da tool.
    * `write_file` fora da whitelist do agente — cria ação `write_file`
      (fica `pending`) → resultado "aguardando aprovação".

  Demais ferramentas passam sem gate (`{:cont, ctx}`) e rodam sua `run/2`.
  Quando produz resultado, põe `:result` no ctx (o ToolLoop usa em vez de
  chamar a tool). Nunca causa loop infinito.
  """

  @behaviour Engine.Harness.Hooks

  alias Engine.Sessions.EngineApiClient
  alias Engine.Harness.WriteFilePolicy

  @impl true
  def call(%{tool: "terminal", args: args} = ctx) do
    payload = %{command: Map.get(args, "command", "")}
    propose(ctx, "terminal", payload, &terminal_result/1)
  end

  def call(%{tool: "write_file", args: args, agent: agent} = ctx) do
    path = Map.get(args, "path", "")

    if WriteFilePolicy.allowed?(agent, path) do
      {:cont, ctx}
    else
      payload = %{path: path, content: Map.get(args, "content", "")}
      propose(ctx, "write_file", payload, &pending_result/1)
    end
  end

  def call(ctx), do: {:cont, ctx}

  defp propose(ctx, action_type, payload, result_fun) do
    actor = %{kind: "agent", id: ctx.agent}

    case EngineApiClient.propose_action(
           ctx.project_id,
           ctx.session_id,
           action_type,
           actor,
           payload
         ) do
      {:ok, action} -> {:cont, Map.put(ctx, :result, result_fun.(action))}
      {:error, reason} -> {:cont, Map.put(ctx, :result, "falha no pipeline: #{inspect(reason)}")}
    end
  end

  defp terminal_result(%{"status" => "executed"} = action) do
    exec = Map.get(action, "executionResult", %{})
    "exit #{Map.get(exec, "exitCode", "?")}\n#{Map.get(exec, "stdout", "")}"
  end

  defp terminal_result(%{"status" => "failed"} = action) do
    exec = Map.get(action, "executionResult", %{})
    "falhou: #{Map.get(exec, "stderr", "")}#{Map.get(exec, "stdout", "")}"
  end

  defp terminal_result(action), do: pending_result(action)

  defp pending_result(action) do
    "proposed_action #{Map.get(action, "id", "?")} status #{Map.get(action, "status", "?")}"
  end
end
