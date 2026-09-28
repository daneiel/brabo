defmodule Engine.RegistryDePar do
  @moduledoc """
  Roda DENTRO de um nó `:peer` de teste: sobe o `Engine.Sessions.Registry` dele
  e registra uma chave, como o conversacional que ainda roda um turno no pod
  antigo (RN-586). Precisa ser um módulo compilado em disco — função anônima do
  teste não existe no outro nó.
  """

  def subir(chave) do
    spawn(fn ->
      {:ok, _} = Registry.start_link(keys: :unique, name: Engine.Sessions.Registry)
      {:ok, _} = Registry.register(Engine.Sessions.Registry, chave, nil)
      Process.sleep(:infinity)
    end)

    :ok
  end
end
