defmodule Engine.Harness.HooksTest do
  use ExUnit.Case, async: true

  alias Engine.Harness.Hooks

  # Handler-módulo que implementa o behaviour (o pipeline vai plugar assim).
  defmodule AppendModule do
    @behaviour Engine.Harness.Hooks
    @impl true
    def call(ctx), do: {:cont, Map.update(ctx, :trace, [:mod], &(&1 ++ [:mod]))}
  end

  test "registro vazio: passthrough, contexto inalterado" do
    assert Hooks.run(Hooks.new(), :pre_tool_use, %{a: 1}) == {:ok, %{a: 1}}
  end

  test "handlers rodam na ordem de registro" do
    hooks =
      Hooks.new()
      |> Hooks.register(:pre_tool_use, fn ctx ->
        {:cont, Map.update(ctx, :trace, [1], &(&1 ++ [1]))}
      end)
      |> Hooks.register(:pre_tool_use, fn ctx ->
        {:cont, Map.update(ctx, :trace, [2], &(&1 ++ [2]))}
      end)
      |> Hooks.register(:pre_tool_use, fn ctx ->
        {:cont, Map.update(ctx, :trace, [3], &(&1 ++ [3]))}
      end)

    assert {:ok, %{trace: [1, 2, 3]}} = Hooks.run(hooks, :pre_tool_use, %{})
  end

  test "handler que retorna {:halt, reason} interrompe a cadeia" do
    parent = self()

    hooks =
      Hooks.new()
      |> Hooks.register(:post_tool_use, fn ctx ->
        send(parent, :primeiro_rodou)
        {:cont, ctx}
      end)
      |> Hooks.register(:post_tool_use, fn _ctx -> {:halt, :bloqueado} end)
      |> Hooks.register(:post_tool_use, fn _ctx ->
        send(parent, :terceiro_rodou)
        {:cont, %{}}
      end)

    assert Hooks.run(hooks, :post_tool_use, %{}) == {:halt, :bloqueado}
    assert_received :primeiro_rodou
    # O terceiro handler (depois do halt) NÃO roda.
    refute_received :terceiro_rodou
  end

  test "handler pode ser um módulo que implementa o behaviour" do
    hooks = Hooks.new() |> Hooks.register(:session_start, AppendModule)
    assert {:ok, %{trace: [:mod]}} = Hooks.run(hooks, :session_start, %{})
  end

  test "register em fase desconhecida levanta ArgumentError" do
    # via apply/3 pra o checker de tipos não estreitar a fase num literal
    # conhecido (o contrato aceita qualquer atom; a validação é em runtime).
    assert_raise ArgumentError, fn ->
      apply(Hooks, :register, [Hooks.new(), :fase_inexistente, fn ctx -> {:cont, ctx} end])
    end
  end
end
