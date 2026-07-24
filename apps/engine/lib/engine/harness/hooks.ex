defmodule Engine.Harness.Hooks do
  @moduledoc """
  Registro funcional de hooks do harness — um VALOR (map de fases → lista de
  handlers em ordem de registro), não um processo. Determinístico e testável
  sem estado global mutável; o pipeline de ações e o executor de terminal
  plugam como handlers numa sessão futura.

  Fases: `:pre_tool_use`, `:post_tool_use`, `:session_start`, `:session_end`.

  Um handler é um módulo que implementa o callback `call/1` OU uma função
  aridade-1. Cada handler recebe o contexto (um map) e retorna:

    * `{:cont, context}` — segue a cadeia (contexto possivelmente atualizado);
    * `{:halt, reason}` — interrompe a cadeia imediatamente.

  `run/3` executa os handlers da fase NA ORDEM DE REGISTRO e devolve
  `{:ok, contexto_final}` ou `{:halt, reason}`.
  """

  @callback call(context :: map()) :: {:cont, map()} | {:halt, term()}

  @phases [:pre_tool_use, :post_tool_use, :session_start, :session_end]

  @doc "Registro vazio — todas as fases sem handlers."
  def new, do: Map.new(@phases, &{&1, []})

  @doc "Fases suportadas, em ordem canônica."
  def phases, do: @phases

  @doc """
  Registra um handler (módulo ou função aridade-1) ao FIM da lista da fase,
  preservando a ordem de registro. Fase desconhecida levanta `ArgumentError`.
  """
  def register(hooks, phase, handler) do
    ensure_phase!(phase)
    Map.update!(hooks, phase, &(&1 ++ [handler]))
  end

  @doc """
  Roda os handlers da fase na ordem de registro. Para na primeira resposta
  `{:halt, reason}` (os handlers seguintes não rodam). Registro vazio =
  passthrough (`{:ok, context}` inalterado). Fase desconhecida levanta.
  """
  def run(hooks, phase, context) do
    ensure_phase!(phase)
    handlers = Map.fetch!(hooks, phase)

    Enum.reduce_while(handlers, {:ok, context}, fn handler, {:ok, ctx} ->
      case invoke(handler, ctx) do
        {:cont, next_ctx} -> {:cont, {:ok, next_ctx}}
        {:halt, reason} -> {:halt, {:halt, reason}}
      end
    end)
  end

  defp ensure_phase!(phase) when is_atom(phase) do
    unless phase in @phases do
      raise ArgumentError, "fase de hook desconhecida: #{inspect(phase)}"
    end
  end

  defp invoke(handler, ctx) when is_function(handler, 1), do: handler.(ctx)
  defp invoke(handler, ctx) when is_atom(handler), do: handler.call(ctx)
end
