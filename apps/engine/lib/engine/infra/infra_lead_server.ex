defmodule Engine.Infra.InfraLeadServer do
  @moduledoc """
  Infra Lead (Fase 4a; área — Fase 8c, ADR 0038). Ativado pelo handoff
  aceito do Arquiteto (contato externo INALTERADO — mesma chave de
  registro, mesmo `InfraLeadSupervisor.start_agent/2`), consome module_map +
  ADRs `infraRelevant` e continua gerando Dockerfiles/compose PRA SI (o
  trabalho que o antigo `InfraAgentServer` fazia sozinho), delegando o
  pipeline de CI pro subagente `Engine.Infra.WorkflowsAgent` — os dois se
  consolidam (`Engine.Infra.InfraLead.consolidar/2`) numa PR única via
  `open_infra_pr`, auto-aprovada pela autonomia seedada no accept do
  handoff — NUNCA aplica nada em ambiente, só propõe.

  Espelha o `Engine.Agents.ArquitetoServer`: GenServer por sessão, estado +
  rehydration + streaming + loop bounded de tool use. Kickoff no start
  fresco. Tools NUNCA incluem `Terminal` — restrição estrutural (defesa em
  profundidade: `agent_autonomy (infra, terminal) = deny`, ver ADR 0014).

  ## Por que este continua sendo um GenServer conversacional e o Workflows não

  O QA (Fase 8b) reconstruiu seus subagentes sobre `ToolLoop`
  project/task-scoped porque o `QAAgent` de antes já era assim. Este agente
  não era: é conversacional, session-scoped, espelho do `ArquitetoServer` — e
  o pedido (CLAUDE.md 8c item 1) é "contato externo inalterado", não "vire o
  padrão do QA". Então o Lead continua GenServer conversacional; o
  `WorkflowsAgent`, que não conversa com ninguém (delegado síncrono,
  single-shot), usa `ToolLoop` bounded — mesma família dos subagentes de QA.
  Duas famílias arquiteturais dentro da MESMA área — o ADR 0038 descreve o
  contrato lead↔subagente, não a implementação interna de cada um.

  ## `propose_infra_pr` muda de "propõe agora" pra "sinaliza que terminei"

  Antes, a tool `propose_infra_pr` chamava a api direto (`ProposeInfraPr.
  run/2`). Agora, pra consolidar numa PR SÓ com o que o Workflows gera,
  `dispatch_calls/2` intercepta essa tool ANTES de rodar `run_tool/3` — o
  turno HALTS e devolve `{title, files}` pra `finalize/3`, que roda o
  Workflows, consolida, e só então chama a api (uma vez, com a união dos
  arquivos). O SPEC da tool não muda — o modelo não percebe diferença
  nenhuma.
  """

  use GenServer, restart: :temporary

  alias Engine.Harness.{ContextBuilder, PromptAssembler, ContextManager, ToolCallRecovery}
  alias Engine.Infra.{InfraLead, WorkflowsAgent}
  alias Engine.Infra.Tools.{ValidateInfraFile, ProposeInfraPr}
  alias Engine.Gates.Dispatcher
  alias Engine.Harness.ArtifactEmitter
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
      |> conclude()

    {:noreply, state}
  end

  # Gate (QA/SecOps) reprovou (Fase 4a) — corrige na MESMA branch/PR:
  # instrui o modelo a ajustar os arquivos e chamar `propose_infra_pr` de
  # novo. `:correct` reroda a ÁREA INTEIRA (Lead + Workflows) — mesma
  # filosofia de "ciclo K no nível da área" do 8b: não tenta decidir qual
  # dos dois é "dono" do finding, e `ExecuteInfraPrUseCase` já recommita na
  # mesma PR quando o artefato de sessão já existe (idempotente).
  @impl true
  def handle_cast({:correct, findings}, state) do
    broadcast(state, "agent.status", %{status: "working"})

    instruction =
      user_msg(
        "O gate #{findings.gate} pediu mudanças: #{findings.reason}\n" <>
          "Detalhes: #{findings.diagnosis}\n" <>
          "Corrija os arquivos de infra que forem seus (Dockerfiles/compose) e chame " <>
          "`propose_infra_pr` de novo com os arquivos corrigidos (pode repetir o título). " <>
          "Se o achado for sobre o pipeline de CI, ainda assim chame `propose_infra_pr` com " <>
          "os seus arquivos — o Workflows é rerrodado junto e a correção dele entra na mesma PR."
      )

    state =
      state
      |> append(instruction)
      |> compact()
      |> run_turn(@max_iterations)
      |> conclude()

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
      |> conclude()

    {:reply, :ok, state}
  end

  # --- Turno com loop bounded de tool use ---

  # `{:done, state}` — turno acabou sem propor (sem tool call, ou limite de
  # iterações). `{:proposed, title, files, state}` — o modelo chamou
  # `propose_infra_pr`; o turno HALTS aqui, sem consumir mais iterações.
  defp run_turn(state, remaining) when remaining <= 0, do: {:done, state}

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
          [] -> {:done, state}
          calls -> dispatch_calls(calls, state, remaining)
        end

      {:error, reason} ->
        emit_response(state, "")
        broadcast(state, "agent.error", %{reason: inspect(reason)})
        {:done, state}
    end
  end

  defp dispatch_calls(calls, state, remaining) do
    calls
    |> Enum.reduce_while({:cont, state}, fn call, {:cont, st} ->
      if Map.get(call, "name") == "propose_infra_pr" do
        args = Map.get(call, "arguments", %{})
        title = Map.get(args, "title", "Dockerfiles e compose de dev")
        files = Map.get(args, "files", [])

        st =
          append(st, %{
            "role" => "tool",
            "content" => "arquivos recebidos, consolidando com o Workflows antes de propor.",
            "toolCallId" => Map.get(call, "id"),
            "name" => "propose_infra_pr",
            :pinned => false
          })

        {:halt, {:proposed, title, files, st}}
      else
        {:cont, {:cont, dispatch_tool(call, st)}}
      end
    end)
    |> case do
      {:proposed, _title, _files, _state} = result -> result
      {:cont, state} -> run_turn(state, remaining - 1)
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
  defp run_tool(name, _args, _state), do: {:error, "ferramenta desconhecida: #{name}"}

  # --- Conclusão do turno: consolida com o Workflows e propõe (ou bloqueia) ---

  # `agent.status` só aceita "working"/"idle" (`LiveBroadcast.agent_status/4`
  # — contrato compartilhado com Criativo/PO/Arquiteto, não estendo pra um
  # terceiro valor). "blocked" descreveria o DESFECHO da rodada, não se o
  # agente está disponível — o agente terminou o turno de qualquer jeito, e
  # o desfecho de bloqueio já fica visível pelo evento `dev.error` que
  # `aplicar/2` emite.
  defp conclude({:proposed, title, files, state}) do
    {_status, state} = finalize(state, title, files)
    broadcast(state, "agent.done", %{})
    broadcast(state, "agent.status", %{status: "idle"})
    state
  end

  defp conclude({:done, state}) do
    broadcast(state, "agent.done", %{})
    broadcast(state, "agent.status", %{status: "idle"})
    state
  end

  defp finalize(state, title, files) do
    resultado_lead = {:ok, %{files: files, summary: title}}
    infra_ctx = fetch_infra_ctx(state)
    resultado_workflows = WorkflowsAgent.run(state.project_id, state.session_id, infra_ctx)

    emit_delegation_result(state, "infra-lead", resultado_lead)
    emit_delegation_result(state, "infra-workflows", resultado_workflows)

    InfraLead.consolidar(resultado_lead, resultado_workflows)
    |> aplicar(state)
  end

  defp fetch_infra_ctx(state) do
    case EngineApiClient.get_infra_context(state.project_id, state.session_id) do
      {:ok, ctx} -> ctx
      _ -> %{}
    end
  end

  defp aplicar({:ok, %{title: title, files: files}}, state) do
    {:idle, abrir_pr(state, title, files)}
  end

  defp aplicar({:blocked, %{reason: reason}}, state) do
    emit(state, "dev.error", %{agentId: "infra-lead", reason: reason})
    {:blocked, state}
  end

  # Extraído de `Engine.Infra.Tools.ProposeInfraPr.run/2` (Fase 4a) — a
  # chamada de api que abria a PR direto na tool call agora acontece aqui,
  # depois da consolidação com o Workflows, uma vez só, com a UNIÃO dos
  # arquivos.
  defp abrir_pr(state, title, files) do
    actor = %{kind: "agent", id: @agent}
    payload = %{title: title, files: files}

    case EngineApiClient.propose_action(
           state.project_id,
           state.session_id,
           "open_infra_pr",
           actor,
           payload
         ) do
      {:ok, %{"id" => id, "status" => "executed"}} ->
        Dispatcher.run_infra_qa(state.project_id, state.session_id, id)
        state

      {:ok, %{"id" => _id, "status" => _status}} ->
        state

      {:error, reason} ->
        broadcast(state, "agent.error", %{reason: inspect(reason)})
        state
    end
  end

  # Emite `infra_delegation_files` (server-emitted, dá o `parecer_artifact_id`
  # que `delegations` exige) e registra a delegação — SEMPRE os dois
  # delegados, mesmo o próprio Lead (RN-037: "delega pra si" também é
  # rastreado, não só o Workflows).
  defp emit_delegation_result(state, subagent, {:ok, resultado}) do
    case ArtifactEmitter.emit_returning(
           state.project_id,
           state.session_id,
           subagent,
           "infra_delegation_files",
           %{files: resultado.files, summary: resultado.summary}
         ) do
      {:ok, event} ->
        record_delegation(state, subagent, %{
          status: "completed",
          parecer_artifact_id: Map.get(event, "id")
        })

      {:error, reason} ->
        record_delegation(state, subagent, %{
          status: "failed",
          failure_origin: "codigo",
          failure_reason: "resultado inválido: #{inspect(reason)}"
        })
    end
  end

  defp emit_delegation_result(state, subagent, {:blocked, info}) do
    record_delegation(state, subagent, %{
      status: "failed",
      failure_origin: info.origin,
      failure_reason: "#{info.reason} — #{info.diagnosis}"
    })
  end

  # Sem `task_id`: a área de Infra delega sobre a SESSÃO, sem task de
  # backlog por trás (a rota/coluna são nullable desde a Fase 8c).
  defp record_delegation(state, subagent, campos) do
    EngineApiClient.record_delegation(
      Map.merge(
        %{
          project_id: state.project_id,
          session_id: state.session_id,
          lead_agent: "infra-lead",
          area: "infra",
          subagent: subagent
        },
        campos
      )
    )

    :ok
  end

  # --- Kickoff ---

  defp kickoff_instruction(state) do
    case EngineApiClient.get_infra_context(state.project_id, state.session_id) do
      {:ok, ctx} -> build_kickoff(ctx)
      _ -> "Proponha os artefatos de infra (Dockerfiles, compose de dev)."
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
    Você recebeu o handoff do Arquiteto. Proponha os artefatos de INFRA que são
    SEUS — Dockerfiles e compose de dev. O pipeline de CI é responsabilidade de
    outra subespecialidade (Workflows), que roda depois e junta o resultado à
    mesma PR — você não precisa gerá-lo.

    1. Para cada módulo do module_map abaixo, gere um Dockerfile adequado ao stack.
    2. Gere um compose de desenvolvimento (docker-compose.yml) integrando os módulos.
    3. Valide CADA arquivo com `validate_infra_file` (path + content) antes de propor.
    4. Chame `propose_infra_pr` (title + files) com o que é seu — a consolidação
       com o pipeline de CI acontece depois, automaticamente.

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
