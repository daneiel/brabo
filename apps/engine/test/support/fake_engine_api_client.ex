defmodule Engine.Sessions.FakeEngineApiClient do
  @moduledoc """
  Fake de teste pra Engine.Sessions.EngineApiClient — sem Mox, sem Agent.
  `report_termination`/`append_event` notificam o `:test_pid` via `send/2`.

  `llm_turn`/`propose_action` são scriptados pelo DICIONÁRIO DE PROCESSO do
  chamador (os testes rodam o ToolLoop/ContextManager de forma SÍNCRONA no
  próprio processo de teste), então:

    * `Process.put(:fake_llm_always, resp)` — toda chamada retorna `resp`
      (usado no teste de limite de iterações, pra sempre pedir tool call);
    * `Process.put(:fake_llm_turns, [resp1, resp2, ...])` — fila consumida em
      ordem; esgotada, retorna uma resposta final "pronto" (encerra o loop);
    * `Process.put(:fake_propose_action, action_map)` — resposta do pipeline.

  Também `send`a `{:llm_turn, ...}` / `{:propose_action, ...}` pro `:test_pid`
  pra os testes asseverarem as chamadas.
  """

  @behaviour Engine.Sessions.EngineApiClient

  @impl true
  def report_termination(project_id, session_id, reason, to) do
    notify({:termination_reported, project_id, session_id, reason, to})
    :ok
  end

  @impl true
  def append_event(project_id, session_id, event) do
    notify({:event_appended, project_id, session_id, event})
    :ok
  end

  @impl true
  def llm_turn(_project_id, _session_id, agent, messages, tools) do
    notify({:llm_turn, agent, messages, tools})

    cond do
      resp = Process.get(:fake_llm_always) ->
        {:ok, resp}

      true ->
        case Process.get(:fake_llm_turns, []) do
          [resp | rest] ->
            Process.put(:fake_llm_turns, rest)
            {:ok, resp}

          [] ->
            {:ok, final_response()}
        end
    end
  end

  @impl true
  def propose_action(_project_id, _session_id, action_type, actor, payload) do
    notify({:propose_action, action_type, actor, payload})
    {:ok, Process.get(:fake_propose_action, %{"id" => "pa-1", "status" => "pending"})}
  end

  @doc "Resposta que só devolve texto final, sem tool calls (encerra o loop)."
  def final_response(content \\ "pronto") do
    %{
      "message" => %{"role" => "assistant", "content" => content, "toolCalls" => []},
      "usage" => %{
        "inputTokens" => 0,
        "outputTokens" => 0,
        "costMicros" => 0,
        "estimated" => true
      },
      "error" => nil
    }
  end

  @doc "Resposta com uma tool call (pede a ferramenta `name` com `args`)."
  def tool_call_response(name, args) do
    %{
      "message" => %{
        "role" => "assistant",
        "content" => "",
        "toolCalls" => [%{"id" => "tc-#{name}", "name" => name, "arguments" => args}]
      },
      "usage" => %{
        "inputTokens" => 0,
        "outputTokens" => 0,
        "costMicros" => 0,
        "estimated" => true
      },
      "error" => nil
    }
  end

  defp notify(msg) do
    if pid = Application.get_env(:engine, :test_pid), do: send(pid, msg)
    :ok
  end
end
