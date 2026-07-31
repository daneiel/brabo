defmodule EngineWeb.Plugs.CorsTest do
  @moduledoc """
  O CORS do engine (ADR 0037).

  O defeito que este arquivo impede de voltar: `GET /health` respondia 200 sem
  `access-control-allow-origin`, e o navegador descartava a resposta — a
  `StatusPage` mostrava o engine como `error` com ele saudável. Um teste de
  controller comum não pegava isso, porque do lado do servidor a resposta estava
  perfeita. O que faltava era o cabeçalho, e é ele que se afirma aqui.

  O segundo grupo de testes guarda a FRONTEIRA: `/internal/*` e `/metrics` não
  recebem CORS. Não é detalhe de estilo — anunciar CORS em `/internal` diria a um
  navegador que ele é cliente esperado do canal por onde a api comanda o engine.
  """
  use EngineWeb.ConnCase, async: true

  alias EngineWeb.Plugs.Cors

  @origem "http://localhost:5173"

  setup do
    # A config vem do `runtime.exs`, que em test devolve o default de dev. Fixar
    # aqui deixa o teste independente do ambiente em que roda.
    anterior = Application.get_env(:engine, :web_origins)
    Application.put_env(:engine, :web_origins, [@origem])
    on_exit(fn -> Application.put_env(:engine, :web_origins, anterior) end)
    :ok
  end

  describe "requisição simples de navegador" do
    test "GET /health com Origin conhecida devolve o cabeçalho", %{conn: conn} do
      conn =
        conn
        |> put_req_header("origin", @origem)
        |> get(~p"/health")

      assert conn.status == 200
      assert get_resp_header(conn, "access-control-allow-origin") == [@origem]
    end

    test "e devolve `vary: origin` junto", %{conn: conn} do
      # Sem `vary`, um proxy que guarde a resposta de uma origem pode entregá-la a
      # outra com o cabeçalho errado dentro.
      conn = conn |> put_req_header("origin", @origem) |> get(~p"/health")
      assert "origin" in get_resp_header(conn, "vary")
    end

    test "/live e /ready também, porque são a mesma superfície" do
      for rota <- ["/live", "/ready"] do
        c =
          build_conn()
          |> put_req_header("origin", @origem)
          |> get(rota)

        assert get_resp_header(c, "access-control-allow-origin") == [@origem],
               "#{rota} ficou sem CORS"
      end
    end

    test "origem desconhecida: responde, mas SEM o cabeçalho", %{conn: conn} do
      # Não é 403 de propósito: o servidor atende, e quem barra a leitura é o
      # navegador. Recusar aqui quebraria clientes que não são navegador.
      conn =
        conn
        |> put_req_header("origin", "http://evil.example")
        |> get(~p"/health")

      assert conn.status == 200
      assert get_resp_header(conn, "access-control-allow-origin") == []
    end

    test "sem Origin nenhum: probe e curl seguem intactos", %{conn: conn} do
      conn = get(conn, ~p"/health")

      assert conn.status == 200
      assert get_resp_header(conn, "access-control-allow-origin") == []
      assert get_resp_header(conn, "vary") == []
    end
  end

  describe "preflight" do
    test "OPTIONS /health responde 204 em vez de 404", %{conn: conn} do
      # É o ponto de o plug estar no ENDPOINT e não num pipeline do router: não
      # existe rota OPTIONS, então dentro de um pipeline isto daria 404 — medido
      # antes da correção.
      conn =
        conn
        |> put_req_header("origin", @origem)
        |> put_req_header("access-control-request-method", "GET")
        |> options(~p"/health")

      assert conn.status == 204
      assert get_resp_header(conn, "access-control-allow-origin") == [@origem]
      assert get_resp_header(conn, "access-control-allow-methods") == ["GET, HEAD, OPTIONS"]
    end

    test "anuncia `traceparent`, para a instrumentação não quebrar o preflight", %{conn: conn} do
      # A web instrumenta as chamadas à api com `traceparent` (ADR 0035). Se
      # instrumentar esta também, o preflight não pode passar a falhar por um
      # cabeçalho que a lista esqueceu — foi o modo de falha do lado da api.
      conn =
        conn
        |> put_req_header("origin", @origem)
        |> put_req_header("access-control-request-method", "GET")
        |> options(~p"/health")

      [cabecalhos] = get_resp_header(conn, "access-control-allow-headers")
      assert cabecalhos =~ "traceparent"
      assert cabecalhos =~ "Content-Type"
    end

    test "tem max-age, porque a StatusPage consulta de 5 em 5 segundos", %{conn: conn} do
      conn =
        conn
        |> put_req_header("origin", @origem)
        |> put_req_header("access-control-request-method", "GET")
        |> options(~p"/health")

      assert get_resp_header(conn, "access-control-max-age") == ["600"]
    end

    test "preflight de origem desconhecida termina aqui, e sem allow-origin", %{conn: conn} do
      conn =
        conn
        |> put_req_header("origin", "http://evil.example")
        |> put_req_header("access-control-request-method", "GET")
        |> options(~p"/health")

      assert conn.status == 204
      assert get_resp_header(conn, "access-control-allow-origin") == []
    end
  end

  describe "a fronteira: o que NÃO recebe CORS" do
    test "/internal/* não recebe, mesmo com Origin conhecida", %{conn: conn} do
      # As rotas internas são server-to-server com segredo compartilhado
      # (RN-035). O 401 aqui é o guard de service token fazendo o trabalho dele —
      # o que se afirma é a AUSÊNCIA do cabeçalho de CORS.
      conn =
        conn
        |> put_req_header("origin", @origem)
        |> post("/internal/sessions", %{})

      assert conn.status == 401
      assert get_resp_header(conn, "access-control-allow-origin") == []
    end

    test "preflight em /internal/* NÃO é interceptado pelo plug", %{conn: conn} do
      # Se fosse, o plug responderia 204 e diria a um navegador que aquele caminho
      # aceita requisição de origem cruzada. Como não é, o pedido segue até o
      # router, que não tem rota OPTIONS: 404, sem cabeçalho de CORS nenhum.
      conn =
        conn
        |> put_req_header("origin", @origem)
        |> put_req_header("access-control-request-method", "POST")
        |> options("/internal/sessions")

      assert conn.status == 404
      assert get_resp_header(conn, "access-control-allow-origin") == []
      assert get_resp_header(conn, "access-control-allow-methods") == []
    end

    test "/metrics não recebe: métrica interna não é para JavaScript de página", %{conn: conn} do
      conn =
        conn
        |> put_req_header("origin", @origem)
        |> get(~p"/metrics")

      assert conn.status == 200
      assert get_resp_header(conn, "access-control-allow-origin") == []
    end

    test "a allowlist de caminho é explícita e tem exatamente três entradas" do
      # Asserção sobre a lista, não sobre o comportamento: quem acrescentar um
      # caminho aqui está movendo uma fronteira de segurança, e o teste faz isso
      # aparecer no diff.
      assert Cors.caminhos_de_navegador() == ["/health", "/live", "/ready"]
    end
  end

  describe "a lista de origens vem da config, num lugar só" do
    test "lê `:web_origins`, que o runtime.exs traduz de WEB_ORIGIN" do
      Application.put_env(:engine, :web_origins, ["http://a.example", "http://b.example"])
      assert Cors.origens_permitidas() == ["http://a.example", "http://b.example"]
    end

    test "lista vazia fecha o acesso de navegador, sem derrubar o engine", %{conn: conn} do
      # É o que acontece em produção sem WEB_ORIGIN: a api levanta exceção no boot,
      # o engine fecha o CORS e segue servindo filas e canais.
      Application.put_env(:engine, :web_origins, [])

      conn = conn |> put_req_header("origin", @origem) |> get(~p"/health")

      assert conn.status == 200
      assert get_resp_header(conn, "access-control-allow-origin") == []
    end
  end
end
