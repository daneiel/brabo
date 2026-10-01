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

  ## Soltar o lock é também esperar o Monitor (AT-189)

  Parar uma sessão NÃO termina o trabalho que ela deixa: o
  `Engine.Sessions.Monitor` recebe o `:DOWN` de forma assíncrona e só ENTÃO
  apaga a linha de `session_states` — pela conexão do sandbox em modo
  compartilhado, que é do TESTE. O `on_exit` que para a sessão e o que solta
  este lock rodam ANTES do `stop_owner` do `Engine.DataCase` (os `on_exit`
  rodam em ordem inversa de registro, e o do sandbox é o primeiro registrado),
  mas nada esperava o Monitor: o DELETE dele corria contra o `stop_owner`, e o
  `mix test` inteiro saía cheio de `owner #PID<…> exited` apontando para
  `Monitor.safe_delete/1`. Pior que o ruído, o lock já tinha sido solto, então
  o arquivo seguinte podia começar com o Monitor ainda trabalhando no dele.

  Por isso `release/0` só solta o lock depois de (1) parar as sessões que o
  teste deixou vivas, com `expect_stop` — parada esperada, sem callback à api —
  e (2) ver o Monitor sem nenhuma sessão observada. A barreira é o ESTADO do
  Monitor, não o tempo: a entrada de uma sessão só sai do `by_pid` no fim do
  `handle_info(:DOWN)`, DEPOIS do DELETE e do relato, então "vazio" quer dizer
  que o trabalho dele acabou.
  """

  alias Engine.Sessions.{Monitor, SessionServer}

  # Teto da espera pelo Monitor. Não é um prazo que o teste disputa: o Monitor
  # processa um `:DOWN` por vez com uma ida ao banco, e passar disto significa
  # que ele travou — o teste falha nomeando isso em vez de seguir sujo.
  @teto_ms 5_000

  def acquire, do: :global.set_lock({__MODULE__, self()}, [node()])

  def release do
    encerrar_sessoes_restantes()
    aguardar_monitor_ocioso(System.monotonic_time(:millisecond) + @teto_ms)
    :global.del_lock({__MODULE__, self()}, [node()])
  end

  defp encerrar_sessoes_restantes do
    for {pid, %{session_id: session_id}} <- observadas(), Process.alive?(pid) do
      :ok = Monitor.expect_stop(session_id)

      try do
        SessionServer.stop(pid)
      catch
        # Morreu entre a leitura e o stop — o `:DOWN` dela já está a caminho.
        :exit, _ -> :ok
      end
    end
  end

  defp aguardar_monitor_ocioso(prazo) do
    cond do
      observadas() == %{} ->
        :ok

      System.monotonic_time(:millisecond) > prazo ->
        raise "Engine.Sessions.Monitor ainda observa #{map_size(observadas())} " <>
                "sessão(ões) #{@teto_ms}ms depois de o teste pará-las"

      true ->
        Process.sleep(5)
        aguardar_monitor_ocioso(prazo)
    end
  end

  defp observadas, do: :sys.get_state(Monitor).by_pid
end
