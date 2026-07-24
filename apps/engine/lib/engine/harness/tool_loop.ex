defmodule Engine.Harness.ToolLoop do
  @moduledoc """
  Contrato do loop de tool use do harness (Fase 3a/4a). Cada turno: chama o
  endpoint de LLM da api (nunca provider direto), parseia tool calls, despacha
  pras ferramentas registradas, injeta os resultados como mensagens `tool` e
  repete — com limite de iterações, teto de tokens OPCIONAL e término
  GRACIOSO em qualquer um dos dois (`toolloop.limit_reached`/
  `toolloop.budget_exceeded`, nunca loop infinito nem gasto sem teto). Um hook
  `:post_tool_use` pode sinalizar `{:halt, reason}` (ex.: o DevAgent concluindo
  ou se bloqueando) — o loop para ali com `{:halted, reason, ctx}`. Impl de
  referência em `.Default`. Trocável via `Application.get_env(:engine,
  :tool_loop, ...)`.
  """

  @callback run(ctx :: map()) ::
              {:ok, map()}
              | {:limit_reached, map()}
              | {:budget_exceeded, map()}
              | {:halted, term(), map()}

  def run(ctx), do: impl().run(ctx)

  defp impl,
    do: Application.get_env(:engine, :tool_loop, Engine.Harness.ToolLoop.Default)
end

defmodule Engine.Harness.ToolLoop.Default do
  @moduledoc """
  Loop determinístico turno-a-turno. Monta o system prompt via o harness
  (ContextBuilder + PromptAssembler), compacta o contexto quando necessário
  (ContextManager), chama `EngineApiClient.llm_turn/5`, e despacha as tool
  calls: ferramentas de pipeline (terminal, write_file fora da whitelist) têm
  o resultado produzido pelo hook `:pre_tool_use`; as diretas rodam sua
  `run/2`. `:post_tool_use` grava o resultado no event log e pode `{:halt,
  reason}` pra terminar o loop AGORA (ex.: DevAgent sinalizando conclusão).

  Mensagens internas são maps com chaves string (formato de fio) + a chave
  atom `:pinned` (removida antes de enviar). O ToolLoop narra o event log
  (`agent.response` — com `iteration`/`tokensSpentMicros` acumulados —,
  `tool.call`, e via hooks `tool.result`).

  `ctx` aceita, opcionalmente: `:tools` (registry de ferramentas — default
  `Engine.Harness.Tools.registry/0`), `:hooks` (default `default_hooks/0`),
  `:workspace_root` (raiz de arquivos/AGENTS.md — default o workspace
  compartilhado do projeto), `:token_budget_micros` (teto de custo por
  execução — default `nil`, sem teto), `:business_rules_units`/
  `:task_state_units` (unidades pras camadas de mesmo nome do
  `ContextBuilder` — default `[]`, usado pelo DevAgent).
  """

  @behaviour Engine.Harness.ToolLoop

  alias Engine.Harness.{ContextBuilder, PromptAssembler, ContextManager, Tools, Hooks}
  alias Engine.Harness.Hooks.{ActionPipeline, EventLog}
  alias Engine.Sessions.EngineApiClient

  @impl true
  def run(ctx) do
    ctx |> init() |> loop()
  end

  defp init(ctx) do
    ctx =
      ctx
      |> Map.put_new(:iteration, 0)
      |> Map.put_new(:max_iterations, default_max_iterations())
      |> Map.put_new(:tokens_spent_micros, 0)
      |> Map.put_new(:token_budget_micros, nil)
      |> Map.put_new(:hooks, default_hooks())
      |> Map.put_new(:tools, Tools.registry())

    system_msg = %{
      "role" => "system",
      "content" => system_prompt(ctx),
      :pinned => true
    }

    ctx
    |> Map.put(:messages, [system_msg | Map.get(ctx, :messages, [])])
    |> Map.put(:tool_specs, Tools.specs(ctx.tools))
  end

  defp loop(%{iteration: iteration, max_iterations: max} = ctx) when iteration >= max do
    emit(ctx, "toolloop.limit_reached", %{iteration: iteration, max_iterations: max})
    {:limit_reached, ctx}
  end

  defp loop(%{token_budget_micros: budget, tokens_spent_micros: spent} = ctx)
       when is_integer(budget) and spent >= budget do
    emit(ctx, "toolloop.budget_exceeded", %{
      tokens_spent_micros: spent,
      token_budget_micros: budget
    })

    {:budget_exceeded, ctx}
  end

  defp loop(ctx) do
    {:ok, ctx} = ContextManager.maybe_compact(ctx)
    wire = Enum.map(ctx.messages, &to_wire/1)

    case EngineApiClient.llm_turn(ctx.project_id, ctx.session_id, ctx.agent, wire, ctx.tool_specs) do
      {:ok, %{"message" => message} = resp} ->
        cost = get_in(resp, ["usage", "costMicros"]) || 0
        ctx = append(ctx, Map.put(message, :pinned, false))
        ctx = Map.update!(ctx, :tokens_spent_micros, &(&1 + cost))

        emit(ctx, "agent.response", %{
          content: Map.get(message, "content", ""),
          error: Map.get(resp, "error"),
          iteration: ctx.iteration,
          tokensSpentMicros: ctx.tokens_spent_micros
        })

        case Map.get(message, "toolCalls") || [] do
          [] ->
            {:ok, ctx}

          tool_calls ->
            case Enum.reduce_while(tool_calls, {:cont, ctx}, &dispatch_or_halt/2) do
              {:halted, reason, ctx} -> {:halted, reason, ctx}
              {:cont, ctx} -> loop(%{ctx | iteration: ctx.iteration + 1})
            end
        end

      {:error, reason} ->
        emit(ctx, "agent.response", %{error: inspect(reason)})
        {:ok, ctx}
    end
  end

  defp dispatch_or_halt(tool_call, {:cont, ctx}) do
    {ctx, halt} = dispatch(tool_call, ctx)

    case halt do
      {:halt, reason} -> {:halt, {:halted, reason, ctx}}
      :cont -> {:cont, {:cont, ctx}}
    end
  end

  defp dispatch(tool_call, ctx) do
    name = Map.get(tool_call, "name")
    args = Map.get(tool_call, "arguments", %{})
    id = Map.get(tool_call, "id")

    emit(ctx, "tool.call", %{tool: name, args: args})

    hook_ctx = ctx |> Map.put(:tool, name) |> Map.put(:args, args)

    {result, ok?} =
      case Hooks.run(ctx.hooks, :pre_tool_use, hook_ctx) do
        {:halt, reason} -> {"bloqueado: #{inspect(reason)}", false}
        {:ok, %{result: precomputed}} -> {precomputed, true}
        {:ok, _cont} -> run_direct(name, args, ctx)
      end

    post_ctx =
      ctx
      |> Map.put(:tool, name)
      |> Map.put(:args, args)
      |> Map.put(:result, result)
      |> Map.put(:result_ok?, ok?)

    halt =
      case Hooks.run(ctx.hooks, :post_tool_use, post_ctx) do
        {:halt, reason} -> {:halt, reason}
        {:ok, _cont} -> :cont
      end

    tool_msg = %{
      "role" => "tool",
      "content" => result,
      "toolCallId" => id,
      "name" => name,
      :pinned => false
    }

    {append(ctx, tool_msg), halt}
  end

  defp run_direct(name, args, ctx) do
    case Tools.find(name, ctx.tools) do
      nil ->
        {"ferramenta desconhecida: #{name}", false}

      mod ->
        case mod.run(args, ctx) do
          {:ok, result} -> {result, true}
          {:error, reason} -> {stringify(reason), false}
        end
    end
  end

  defp system_prompt(ctx) do
    ctx.project_id
    |> ContextBuilder.build_layers(ctx.agent,
      workspace_root: ctx[:workspace_root],
      business_rules_units: Map.get(ctx, :business_rules_units, []),
      task_state_units: Map.get(ctx, :task_state_units, [])
    )
    |> PromptAssembler.assemble()
    |> PromptAssembler.Default.render()
  end

  defp default_hooks do
    Hooks.new()
    |> Hooks.register(:pre_tool_use, ActionPipeline)
    |> Hooks.register(:post_tool_use, EventLog)
  end

  defp emit(ctx, type, payload) do
    EngineApiClient.append_event(ctx.project_id, ctx.session_id, %{
      type: type,
      actorKind: "agent",
      actorId: ctx.agent,
      payload: payload
    })
  end

  defp append(ctx, message), do: %{ctx | messages: ctx.messages ++ [message]}

  defp to_wire(message), do: Map.delete(message, :pinned)

  defp stringify(reason) when is_binary(reason), do: reason
  defp stringify(reason), do: inspect(reason)

  defp default_max_iterations,
    do: Application.get_env(:engine, :tool_loop_max_iterations, 8)
end
