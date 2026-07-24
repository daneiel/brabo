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
  def append_event_returning(project_id, session_id, event) do
    notify({:event_appended, project_id, session_id, event})
    id = "evt-#{System.unique_integer([:positive])}"
    {:ok, %{"id" => id, "seq" => 0, "type" => Map.get(event, :type)}}
  end

  @impl true
  def list_events(_project_id, _session_id) do
    {:ok, Process.get(:fake_events, [])}
  end

  @impl true
  def create_handoff(project_id, session_id, from_agent, to_agent, artifact_id) do
    notify({:handoff_created, project_id, session_id, from_agent, to_agent, artifact_id})

    {:ok,
     Process.get(:fake_handoff, %{
       "id" => "ho-1",
       "fromAgent" => from_agent,
       "toAgent" => to_agent,
       "artifactId" => artifact_id,
       "status" => "offered"
     })}
  end

  @impl true
  def create_epic(_project_id, _session_id, fields) do
    notify({:epic_created, fields})
    reply(:fake_epic, %{"id" => "ep-#{unique()}", "title" => Map.get(fields, :title)})
  end

  @impl true
  def create_story(_project_id, _session_id, fields) do
    notify({:story_created, fields})
    # Erro scriptável (ex.: business_rule_id inválido) via :fake_story_error.
    case Process.get(:fake_story_error) do
      nil ->
        reply(:fake_story, %{"id" => "st-#{unique()}", "status" => "ready"})

      reason ->
        {:error, reason}
    end
  end

  @impl true
  def create_task(_project_id, _session_id, fields) do
    notify({:task_created, fields})
    reply(:fake_task, %{"id" => "tk-#{unique()}"})
  end

  @impl true
  def create_module_map(_project_id, _session_id, modules) do
    notify({:module_map_created, modules})

    case Process.get(:fake_module_map_error) do
      nil -> reply(:fake_module_map, %{"id" => "mm-#{unique()}", "version" => 1})
      reason -> {:error, reason}
    end
  end

  @impl true
  def assign_story_modules(_project_id, _session_id, fields) do
    notify({:story_modules_assigned, fields})

    case Process.get(:fake_assign_error) do
      nil -> reply(:fake_story, %{"id" => Map.get(fields, :storyId)})
      reason -> {:error, reason}
    end
  end

  @impl true
  def claim_task(_project_id, _session_id, module, agent_id) do
    notify({:task_claimed, module, agent_id})
    # Fila de tasks scriptada por :fake_tasks (pop); esgotada → nil.
    case Process.get(:fake_tasks, []) do
      [task | rest] ->
        Process.put(:fake_tasks, rest)
        {:ok, task}

      [] ->
        {:ok, nil}
    end
  end

  @impl true
  def mark_task(_project_id, _session_id, task_id, status, agent_id) do
    notify({:task_marked, task_id, status, agent_id})
    {:ok, %{"id" => task_id, "status" => status}}
  end

  defp reply(key, default), do: {:ok, Process.get(key, default)}
  defp unique, do: System.unique_integer([:positive])

  @impl true
  def llm_turn_stream(_project_id, _session_id, agent, messages, tools, on_delta) do
    notify({:llm_turn_stream, agent, messages, tools})

    # Deltas scriptados (opcional) — rebroadcastados pelo on_delta.
    for delta <- Process.get(:fake_deltas, []), do: on_delta.(delta)

    resp =
      cond do
        r = Process.get(:fake_llm_always) ->
          r

        true ->
          case Process.get(:fake_llm_turns, []) do
            [r | rest] ->
              Process.put(:fake_llm_turns, rest)
              r

            [] ->
              final_response()
          end
      end

    {:ok, resp}
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
