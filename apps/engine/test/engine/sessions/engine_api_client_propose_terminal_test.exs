defmodule Engine.Sessions.EngineApiClientProposeTerminalTest do
  @moduledoc """
  AT-440 (RN-757) — o teto da chamada `propose_action` de uma ação
  `terminal`.

  A api executa a ação `terminal` auto-aprovada dentro da mesma requisição
  (chamando `/internal/actions/execute` de volta neste engine). No default de
  15s do Req, um `npm install` que passasse disso voltava ao agente como
  `%Req.TransportError{reason: :timeout}` cru. HTTP de verdade contra uma api
  falsa que demora (~16s, uma vez), no molde de
  `engine_api_client_propose_action_test.exs`.
  """

  use ExUnit.Case, async: false

  alias Engine.Harness.Hooks.ActionPipeline
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
        Jason.encode!(%{
          id: "acao-1",
          status: "executed",
          executionResult: %{exitCode: 0, stdout: "added 120 packages"}
        })
      )
    end
  end

  setup do
    url_anterior = Application.get_env(:engine, :api_url)
    teto_anterior = Application.get_env(:engine, :terminal_action_timeout_ms)

    on_exit(fn ->
      if url_anterior,
        do: Application.put_env(:engine, :api_url, url_anterior),
        else: Application.delete_env(:engine, :api_url)

      Application.put_env(:engine, :terminal_action_timeout_ms, teto_anterior)
    end)

    :ok
  end

  @tag timeout: 60_000
  test "um `terminal` que a api executa por mais de 15s ainda é esperado" do
    {:ok, pid} =
      Bandit.start_link(
        plug: {ApiQueDemora, demora_ms: 16_000},
        port: 0,
        ip: :loopback,
        startup_log: false
      )

    {:ok, {_ip, porta}} = ThousandIsland.listener_info(pid)
    Application.put_env(:engine, :api_url, "http://127.0.0.1:#{porta}")

    assert {:ok, %{"status" => "executed"}} =
             Live.propose_action(
               "proj-1",
               "sessao-1",
               "terminal",
               %{kind: "agent", id: "dev-api"},
               %{command: "npm install"}
             )
  end

  test "a ordem é broker < api < engine `container-exec` < engine `propose_action` < 300s" do
    teto = Application.fetch_env!(:engine, :terminal_action_timeout_ms)

    assert Live.teto_do_propose_action_de_terminal_ms() >
             Live.teto_do_container_exec_ms(teto)

    # O padrão de produção (120s) fica abaixo dos 300s de cabeçalhos do
    # `fetch` do Node que a api usa para chamar `/internal/actions/execute`.
    Application.put_env(:engine, :terminal_action_timeout_ms, 120_000)
    assert Live.teto_do_propose_action_de_terminal_ms() < 300_000
  end

  test "o estouro da espera chega ao modelo nomeando o teto e o que fazer" do
    Application.put_env(:engine, :terminal_action_timeout_ms, 120_000)
    texto = ActionPipeline.resultado_de_teto_do_terminal()

    assert texto =~ "teto de execução de terminal (120s"
    assert texto =~ "nohup"
    refute texto =~ "TransportError"
  end
end
