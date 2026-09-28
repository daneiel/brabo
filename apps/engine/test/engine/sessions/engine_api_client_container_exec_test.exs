defmodule Engine.Sessions.EngineApiClientContainerExecTest do
  @moduledoc """
  AT-233 (RN-604) — o teto da chamada `container-exec` do engine à api.

  O comando de terminal de um projeto `container`/`mounted` com container
  `running` atravessa engine -> api -> broker (ADR 0134, RN-492). O broker
  corta o comando em `timeoutMs`; a api espera mais que isso; o ENGINE tem de
  esperar mais que a api. Até a AT-233 esta chamada não passava
  `receive_timeout` e caía no default do Req (15s) — exatamente o default de
  `TERMINAL_ACTION_TIMEOUT_MS`. Um comando que usasse o teto inteiro voltava
  como `%Req.TransportError{reason: :timeout}` aqui, e com o teto configurado
  acima de 15s NENHUM comando longo chegava ao fim. Subir o teto só na api
  não consertava nada.

  Diferente dos vizinhos (`engine_api_client_timeout_test.exs`), este faz
  HTTP de VERDADE contra uma api falsa (`Bandit` + um plug que demora): o que
  se prova é o teto que o socket respeita, e isso não aparece lendo o fonte.
  Custa ~16s, uma vez.
  """

  use ExUnit.Case, async: false

  alias Engine.Sessions.EngineApiClient.Live

  defmodule ApiQueDemora do
    @moduledoc false
    @behaviour Plug

    @impl true
    def init(opts), do: opts

    @impl true
    def call(conn, opts) do
      Process.sleep(Keyword.fetch!(opts, :demora_ms))

      conn
      |> Plug.Conn.put_resp_content_type("application/json")
      |> Plug.Conn.send_resp(
        200,
        Jason.encode!(%{sucesso: true, exitCode: 0, output: "ok", timedOut: false})
      )
    end
  end

  setup do
    url_anterior = Application.get_env(:engine, :api_url)

    on_exit(fn ->
      if url_anterior,
        do: Application.put_env(:engine, :api_url, url_anterior),
        else: Application.delete_env(:engine, :api_url)
    end)

    :ok
  end

  defp subir_api(demora_ms) do
    {:ok, pid} =
      Bandit.start_link(
        plug: {ApiQueDemora, demora_ms: demora_ms},
        port: 0,
        ip: :loopback,
        startup_log: false
      )

    {:ok, {_ip, porta}} = ThousandIsland.listener_info(pid)
    Application.put_env(:engine, :api_url, "http://127.0.0.1:#{porta}")
    pid
  end

  @tag timeout: 60_000
  test "uma api que responde depois do default de 15s do Req ainda é esperada" do
    # 16s: passa do default do Req (15s) e fica dentro de `timeoutMs` + folga.
    # Na base, isto voltava `{:error, %Req.TransportError{reason: :timeout}}`.
    subir_api(16_000)

    assert {:ok, %{"sucesso" => true, "output" => "ok"}} =
             Live.executar_comando_no_container("proj-1", "npm test", nil, 15_000)
  end

  test "o teto da chamada é o `timeoutMs` do comando mais a folga, e sempre passa dele" do
    for timeout_ms <- [1, 15_000, 120_000] do
      assert Live.teto_do_container_exec_ms(timeout_ms) > timeout_ms
    end

    # Sem `timeoutMs`, o broker usa o default dele (15s) — o teto daqui não
    # pode ser menor que isso mais a folga.
    assert Live.teto_do_container_exec_ms(nil) == Live.teto_do_container_exec_ms(15_000)
  end

  test "a folga daqui é maior que a da api (espelhada lá como FOLGA_DO_EXEC_NO_ENGINE_MS)" do
    # `apps/api/src/infrastructure/http-clients/container-broker.client.ts`
    # afirma, contra este número, que a api desiste ANTES do engine. Se ele
    # mudar aqui sem mudar lá, o teste de lá mente.
    fonte_da_api =
      File.read!(
        Path.join(
          File.cwd!(),
          "../api/src/infrastructure/http-clients/container-broker.client.ts"
        )
      )

    [_, numero] = Regex.run(~r/FOLGA_DO_EXEC_NO_ENGINE_MS = ([\d_]+);/, fonte_da_api)
    espelho = numero |> String.replace("_", "") |> String.to_integer()

    assert Live.teto_do_container_exec_ms(0) == espelho
  end
end
