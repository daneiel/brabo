defmodule Engine.Infra.InfraAgentServer do
  @moduledoc """
  InfraAgent conversacional no harness (Fase 4a — fechamento). Ativado pelo
  handoff aceito do Arquiteto, consome module_map + ADRs `infraRelevant` e
  produz Dockerfiles/compose/CI via `propose_infra_pr` (proposed_action
  `open_infra_pr`, auto-aprovada pela autonomia seedada no accept do
  handoff — NUNCA aplica nada em ambiente, só propõe). Valida cada
  Dockerfile com `validate_infra_file` (hadolint) antes de propor.

  Espelha o `Engine.Agents.ArquitetoServer`: GenServer por sessão, estado +
  rehydration + streaming + loop bounded de tool use. Kickoff no start
  fresco. Tools NUNCA incluem `Terminal` — restrição estrutural (defesa em
  profundidade: `agent_autonomy (infra, terminal) = deny`, ver ADR 0014).
  """

  use GenServer, restart: :temporary

  alias Engine.Harness.{ContextBuilder, PromptAssembler, ContextManager, ToolCallRecovery}
  alias Engine.Infra.Tools.{ValidateInfraFile, ProposeInfraPr}
  alias Engine.Sessions.{EngineApiClient, LiveBroadcast}

  @agent "infra"
  @max_iterations 14

  # --- API pública ---

  def start_link({session_id, project_id}) do
    GenServer.start_link(__MODULE__, {session_id, project_id}, name: via(session_id))
  end

  def via(session_id),
    do: {:via, Registry, {Engine.Sessions.Registry, "infra:" <> session_id}}

  def kickoff(session_id), do: GenServer.cast(via(session_id), :kickoff)

  def user_message(session_id, text),
    do: GenServer.call(via(session_id), {:user_message, text}, 180_000)

  @doc "Gate (QA/SecOps) pediu mudanças — mesma branch/PR, sem PR nova."
  def correct(session_id, findings), do: GenServer.cast(via(session_id), {:correct, findings})

  # --- Callbacks ---

  @impl true
  def init({session_id, project_id}) do
    system_msg = %{
      "role" => "system",
      "content" => system_prompt(project_id),
      :pinned => true
    }

    history = rehydrate(project_id, session_id)

    {:ok,
     %{
       session_id: session_id,
       project_id: project_id,
       agent: @agent,
       messages: [system_msg | history],
       tool_specs: [ValidateInfraFile.spec(), ProposeInfraPr.spec()]
     }}
  end

  @impl true
  def handle_cast(:kickoff, state) do
    broadcast(state, "agent.status", %{status: "working"})

    state =
      state
      |> append(user_msg(kickoff_instruction(state)))
      |> compact()
      |> run_turn(@max_iterations)

    broadcast(state, "agent.done", %{})
    broadcast(state, "agent.status", %{status: "idle"})
    {:noreply, state}
  end

  # Gate (QA/SecOps) reprovou (Fase 4a) — corrige na MESMA branch/PR:
  # instrui o modelo a ajustar os arquivos e chamar `propose_infra_pr` de
  # novo (ExecuteInfraPrUseCase detecta que já existe um artefato pra esta
  # sessão e só commita, sem abrir PR nova).
  @impl true
  def handle_cast({:correct, findings}, state) do
    broadcast(state, "agent.status", %{status: "working"})

    instruction =
      user_msg(
        "O gate #{findings.gate} pediu mudanças: #{findings.reason}\n" <>
          "Detalhes: #{findings.diagnosis}\n" <>
          "Corrija os arquivos de infra e chame `propose_infra_pr` de novo com os arquivos " <>
          "corrigidos (pode repetir o título)."
      )

    state =
      state
      |> append(instruction)
      |> compact()
      |> run_turn(@max_iterations)

    broadcast(state, "agent.done", %{})
    broadcast(state, "agent.status", %{status: "idle"})
    {:noreply, state}
  end

  @impl true
  def handle_call({:user_message, text}, _from, state) do
    broadcast(state, "agent.status", %{status: "working"})

    state =
      state
      |> append(user_msg(text))
      |> compact()
      |> run_turn(@max_iterations)

    broadcast(state, "agent.done", %{})
    broadcast(state, "agent.status", %{status: "idle"})
    {:reply, :ok, state}
  end

  # --- Turno com loop bounded de tool use ---

  defp run_turn(state, remaining) when remaining <= 0, do: state

  defp run_turn(state, remaining) do
    on_delta = fn text -> broadcast(state, "agent.delta", %{text: text}) end
    wire = Enum.map(state.messages, &to_wire/1)

    case EngineApiClient.llm_turn_stream(
           state.project_id,
           state.session_id,
           @agent,
           wire,
           state.tool_specs,
           on_delta
         ) do
      {:ok, %{"message" => message}} ->
        content = Map.get(message, "content", "")
        state = append(state, assistant_msg(content))
        if content != "", do: emit_response(state, content)

        case tool_calls(message, state.tool_specs) do
          [] ->
            state

          calls ->
            state = Enum.reduce(calls, state, &dispatch_tool/2)
            run_turn(state, remaining - 1)
        end

      {:error, reason} ->
        emit_response(state, "")
        broadcast(state, "agent.error", %{reason: inspect(reason)})
        state
    end
  end

  defp dispatch_tool(call, state) do
    name = Map.get(call, "name")
    args = Map.get(call, "arguments", %{})
    id = Map.get(call, "id")

    emit(state, "tool.call", %{tool: name, args: args})

    text =
      case run_tool(name, args, state) do
        {:ok, s} -> s
        {:error, s} -> s
      end

    append(state, %{
      "role" => "tool",
      "content" => text,
      "toolCallId" => id,
      "name" => name,
      :pinned => false
    })
  end

  defp run_tool("validate_infra_file", args, state), do: ValidateInfraFile.run(args, state)
  defp run_tool("propose_infra_pr", args, state), do: ProposeInfraPr.run(args, state)
  defp run_tool(name, _args, _state), do: {:error, "ferramenta desconhecida: #{name}"}

  # --- Kickoff ---

  defp kickoff_instruction(state) do
    case EngineApiClient.get_infra_context(state.project_id, state.session_id) do
      {:ok, ctx} -> build_kickoff(ctx)
      _ -> "Proponha os artefatos de infra (Dockerfiles, compose de dev, esqueleto de CI)."
    end
  end

  defp build_kickoff(ctx) do
    module_map = Map.get(ctx, "moduleMap")
    adrs = Map.get(ctx, "adrs", [])

    modules_text =
      case module_map do
        %{"modules" => modules} when is_list(modules) and modules != [] ->
          Enum.map_join(modules, "\n", fn m ->
            "- #{Map.get(m, "name")} (#{Map.get(m, "stack")}): #{Map.get(m, "responsibility")}"
          end)

        _ ->
          "(sem module_map vigente)"
      end

    adrs_text =
      case adrs do
        [] ->
          "(nenhum ADR marcado infraRelevant)"

        adrs ->
          Enum.map_join(adrs, "\n\n", fn a ->
            "#{Map.get(a, "title")}\n#{Map.get(a, "content")}"
          end)
      end

    """
    Você recebeu o handoff do Arquiteto. Proponha os artefatos de INFRA do projeto:
    1. Para cada módulo do module_map abaixo, gere um Dockerfile adequado ao stack.
    2. Gere um compose de desenvolvimento (docker-compose.yml) integrando os módulos.
    3. Gere um esqueleto de pipeline de CI (ex.: .github/workflows/ci.yml).
    4. Valide CADA Dockerfile com `validate_infra_file` antes de propor a PR.
    5. Proponha tudo numa única PR via `propose_infra_pr` (title + files).

    Você NUNCA aplica nada em ambiente — só propõe a PR. Sem acesso a terminal.

    MÓDULOS:
    #{modules_text}

    ADRs DE INFRA:
    #{adrs_text}
    """
  end

  # --- Rehydration ---

  defp rehydrate(project_id, session_id) do
    case EngineApiClient.list_events(project_id, session_id) do
      {:ok, events} -> events |> Enum.map(&to_message/1) |> Enum.reject(&is_nil/1)
      _ -> []
    end
  end

  defp to_message(%{"type" => "chat.message", "payload" => payload}),
    do: user_msg(Map.get(payload, "text", ""))

  defp to_message(%{"type" => "agent.response", "payload" => payload}),
    do: assistant_msg(Map.get(payload, "content") || Map.get(payload, "text") || "")

  defp to_message(_event), do: nil

  # --- Helpers ---

  defp compact(state) do
    {:ok, state} = ContextManager.maybe_compact(state)
    state
  end

  defp system_prompt(project_id) do
    project_id
    |> ContextBuilder.build_layers(@agent)
    |> PromptAssembler.assemble()
    |> PromptAssembler.Default.render()
  end

  defp user_msg(text), do: %{"role" => "user", "content" => text, :pinned => false}

  defp assistant_msg(content),
    do: %{"role" => "assistant", "content" => content, :pinned => false}

  defp append(state, message), do: %{state | messages: state.messages ++ [message]}

  defp to_wire(message), do: Map.delete(message, :pinned)

  # Modelo local costuma descrever a chamada em TEXTO em vez de usar o
  # protocolo nativo. O ToolLoop já recuperava isso (ADR 0020), mas os agentes
  # conversacionais têm loop PRÓPRIO e ficaram de fora — o InfraAgent morria
  # com resposta vazia tendo escrito o `propose_infra_pr` certo em texto.
  defp tool_calls(message, tool_specs) do
    case Map.get(message, "toolCalls") || [] do
      [] ->
        ToolCallRecovery.from_content(
          Map.get(message, "content", ""),
          Enum.map(tool_specs, & &1.name)
        )

      nativas ->
        nativas
    end
  end

  defp emit_response(state, content),
    do: emit(state, "agent.response", %{content: content})

  defp emit(state, type, payload) do
    EngineApiClient.append_event(state.project_id, state.session_id, %{
      type: type,
      actorKind: "agent",
      actorId: @agent,
      payload: payload
    })

    Engine.Sessions.LiveBroadcast.event_appended(state.session_id, type, @agent, payload)
  end

  # `agent.status` PRECISA ser persistido, não só broadcastado: o painel do
  # time deriva o roster do event log buscado por HTTP (ver
  # Engine.Sessions.LiveBroadcast.agent_status/4 e o ADR 0021).
  defp broadcast(state, "agent.status", %{status: status}) do
    LiveBroadcast.agent_status(state.project_id, state.session_id, @agent, status)
  end

  defp broadcast(state, event, payload) do
    EngineWeb.Endpoint.broadcast("session:" <> state.session_id, event, payload)
  end
end
