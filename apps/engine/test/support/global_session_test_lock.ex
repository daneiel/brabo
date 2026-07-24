defmodule Engine.GlobalSessionTestLock do
  @moduledoc """
  `async: false` num módulo de teste só serializa os testes DENTRO desse
  módulo — módulos diferentes ainda rodam concorrentemente entre si.
  Vários arquivos de teste mutam estado global compartilhado
  (Engine.Sessions.Monitor/Registry/SessionSupervisor, e
  Application.put_env(:engine, :test_pid/:engine_api_client, ...)) —
  sem exclusão mútua ENTRE arquivos, dois desses testes rodando ao mesmo
  tempo corrompem um ao outro (mensagem indo pro pid errado, ou o
  Monitor crashando ao usar a conexão sandboxed de um teste que já
  terminou). Usa :global.set_lock/2 (bloqueia até conseguir) pra
  serializar esses arquivos entre si.
  """

  def acquire, do: :global.set_lock({__MODULE__, self()}, [node()])
  def release, do: :global.del_lock({__MODULE__, self()}, [node()])
end
