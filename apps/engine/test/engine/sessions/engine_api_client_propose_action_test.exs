defmodule Engine.Sessions.EngineApiClientProposeActionTest do
  @moduledoc """
  AT-234 (RN-605) — o teto da chamada `propose_action` do engine à api.

  Quando `container_start` (ou `container_start_via_runner`, ou
  `container_stop`) nasce AUTO-APROVADA, a api a EXECUTA dentro da mesma
  requisição (`ProposeActionUseCase`), esperando o broker
  (`TETO_DE_MUTACAO_MS`, 195s) ou o runner (`RunnerRouter`, 185s no `start`).
  Até a AT-234 esta chamada caía no default do Req (15s): um `start` longo,
  mesmo sem pull, voltava como timeout de transporte aqui, e o desfecho
  nomeado da api chegava a ninguém.

  Mesmo desenho de `engine_api_client_container_exec_test.exs`: HTTP de
  VERDADE contra uma api falsa que demora, porque o que se prova é o teto que
  o socket respeita. Custa ~16s, uma vez.
  """

  use ExUnit.Case, async: false

  alias Engine.Runners.RunnerRouter
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
      |> Plug.Conn.send_resp(200, Jason.encode!(%{id: "acao-1", status: "auto_approved"}))
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
  test "um `container_start` que a api executa por mais de 15s ainda é esperado" do
    # 16s: passa do default do Req (15s). Na base, isto voltava
    # `{:error, %Req.TransportError{reason: :timeout}}`.
    subir_api(16_000)

    assert {:ok, %{"id" => "acao-1", "status" => "auto_approved"}} =
             Live.propose_action(
               "proj-1",
               "sessao-1",
               "container_start",
               %{kind: "agent", id: "infra-lead"},
               %{}
             )
  end

  test "só as ações de container que a api executa no propose ganham o teto longo" do
    for tipo <- ~w(container_start container_start_via_runner container_stop) do
      assert Live.opcoes_do_propose_action(tipo) ==
               [receive_timeout: Live.teto_do_propose_action_de_container_ms()]
    end

    # `container_remove` nunca nasce auto-aprovado (teto absoluto de
    # `decide.ts`), e as demais seguem no default do Req.
    for tipo <- ~w(container_remove git_commit open_infra_pr) do
      assert Live.opcoes_do_propose_action(tipo) == []
    end
  end

  test "a ordem é broker < api < engine, e runner < engine, no `container_start`" do
    fonte_da_api =
      File.read!(
        Path.join(
          File.cwd!(),
          "../api/src/infrastructure/http-clients/container-broker.client.ts"
        )
      )

    [_, espelho] =
      Regex.run(
        ~r/TETO_DO_PROPOSE_ACTION_DE_CONTAINER_NO_ENGINE_MS = ([\d_]+);/,
        fonte_da_api
      )

    espelho = espelho |> String.replace("_", "") |> String.to_integer()
    assert Live.teto_do_propose_action_de_container_ms() == espelho

    # `TETO_DE_MUTACAO_MS` da api: contexto (10s) + seis chamadas de controle
    # de 30s + margem (5s). Derivado aqui das mesmas parcelas, para o teste
    # reprovar se o engine descer abaixo dele.
    teto_de_mutacao_da_api = 10_000 + 6 * 30_000 + 5_000
    assert Live.teto_do_propose_action_de_container_ms() > teto_de_mutacao_da_api

    # O caminho do runner: api -> engine -> runner, e o engine do
    # `propose_action` espera mais que o `RunnerRouter` do outro lado.
    assert Live.teto_do_propose_action_de_container_ms() > RunnerRouter.timeout_do_start_ms()
  end
end
