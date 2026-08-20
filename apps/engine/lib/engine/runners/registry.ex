defmodule Engine.Runners.Registry do
  @moduledoc """
  Presença do runner conectado por projeto — no máximo UM runner por
  projeto, no cluster inteiro.

  Registro em `:global`, mesmo padrão de `Engine.Sessions.SessionServer.via/1`
  (Fase 5): com HPA/múltiplas réplicas, o runner pode conectar em qualquer
  pod, e `TerminalExecutor` (que decide se roteia um comando pro runner) pode
  rodar em outro. Um `Registry` local só enxergaria o runner quando os dois
  caíssem no mesmo pod.

  A exclusividade ("no máximo um") não é uma checagem em cima do registro —
  é uma PROPRIEDADE do próprio `:global`: `register_name/3` devolve `:no`
  quando o nome já está ocupado, em vez de substituir o dono anterior. E a
  entrada some SOZINHA quando o processo dono morre (crash, disconnect,
  `terminate/2` do canal, o que for) — `:global` monitora o pid registrado,
  então mesmo uma queda sem `terminate/2` limpo (kill duro, partição de
  rede) não deixa presença fantasma.
  """

  @doc """
  Tenta registrar `pid` como o runner de `project_id`. `:ok` quando não
  havia runner nenhum; `{:error, :already_connected}` quando já existe um —
  quem chama (o `join/3` do canal) recusa o segundo `join` com esse erro.
  """
  def register(project_id, pid) do
    case :global.register_name(name(project_id), pid) do
      :yes -> :ok
      :no -> {:error, :already_connected}
    end
  end

  @doc "Desregistra explicitamente — chamado por `terminate/2` do canal (limpeza imediata, sem esperar o monitor do `:global`)."
  def unregister(project_id) do
    :global.unregister_name(name(project_id))
    :ok
  end

  @doc "`true` se há um runner conectado (em QUALQUER nó do cluster) para `project_id`."
  def connected?(project_id) do
    whereis(project_id) != nil
  end

  @doc "pid do runner conectado, ou `nil`."
  def whereis(project_id) do
    case :global.whereis_name(name(project_id)) do
      :undefined -> nil
      pid -> pid
    end
  end

  defp name(project_id), do: {:brabo_runner, project_id}
end
