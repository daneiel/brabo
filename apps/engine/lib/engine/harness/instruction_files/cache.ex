defmodule Engine.Harness.InstructionFiles.Cache do
  @moduledoc """
  Dono de uma tabela ETS que cacheia o merge de instruções por
  {project_id, agent}. Processo mínimo (só cria e detém a tabela); o IO de
  fs+banco acontece no processo CHAMADOR de `InstructionFiles.Live.load/2`
  — assim o cache não toca no banco e não colide com o sandbox Ecto nos
  testes.

  Primeiro uso de ETS no engine (ver ADR): é o primitivo padrão de cache do
  Elixir, e evita a dor de um GenServer lendo o banco sob sandbox. A
  invalidação é MANUAL (`InstructionFiles.invalidate/2`) — sem watch de fs
  por ora.
  """

  use GenServer

  @table :harness_instruction_cache

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, :ok, name: __MODULE__)
  end

  @impl true
  def init(:ok) do
    _ =
      :ets.new(@table, [:named_table, :public, :set, read_concurrency: true])

    {:ok, %{}}
  end

  @doc "Valor cacheado pra chave, ou `:miss`."
  def get(key) do
    case :ets.lookup(@table, key) do
      [{^key, value}] -> {:ok, value}
      [] -> :miss
    end
  end

  @doc "Grava o valor pra chave."
  def put(key, value) do
    :ets.insert(@table, {key, value})
    :ok
  end

  @doc "Descarta a chave (invalidação)."
  def delete(key) do
    :ets.delete(@table, key)
    :ok
  end

  @doc """
  Descarta TODAS as entradas de um agente, qualquer que seja a `root`
  (Fase 4b). A chave é `{project_id, agent, root}` e a root varia — nil
  pro workspace compartilhado, o path do worktree pros dev agents — então
  invalidar só uma chave deixaria o dev servindo a instrução velha depois
  de um patch/rollback.
  """
  def delete_agent(project_id, agent) do
    :ets.match_delete(@table, {{project_id, agent, :_}, :_})
    :ok
  end
end
