defmodule EngineWeb.Plugs.VerifyServiceTokenTest do
  @moduledoc """
  O plug que autentica o tráfego interno vindo da api (Fase 7a, item 4).

  Até o corte, este caminho não tinha teste dedicado nenhum: a única cobertura
  era indireta, pelo `route_surface_test.exs`, e passava em parte por acidente
  — com o JWKS desligado na suite, o verificador não conseguia buscar signers e
  TUDO falhava fechado em 401. O teste dizia "recusa sem token" sem nunca ter
  exercitado um token válido.

  Com o segredo em config, os dois lados do `if` são alcançáveis, e é isso que
  estes casos cobrem.
  """
  use EngineWeb.ConnCase, async: true

  alias EngineWeb.Plugs.VerifyServiceToken

  @cabecalho "x-brabo-service-token"
  @valido "service-token-de-teste"

  setup do
    Application.put_env(:engine, :service_token, @valido)

    on_exit(fn ->
      Application.put_env(:engine, :service_token, @valido)
      Application.delete_env(:engine, :service_token_previous)
    end)

    :ok
  end

  defp chamar(conn), do: VerifyServiceToken.call(conn, [])

  describe "token ausente" do
    test "recusa com 401 e interrompe o pipeline", %{conn: conn} do
      conn = chamar(conn)

      assert conn.status == 401
      assert conn.halted
    end

    test "o corpo é JSON, não HTML", %{conn: conn} do
      conn = chamar(conn)

      assert %{"error" => mensagem} = Jason.decode!(conn.resp_body)
      assert is_binary(mensagem)
    end
  end

  describe "token inválido" do
    test "recusa token errado", %{conn: conn} do
      conn = conn |> put_req_header(@cabecalho, "token-do-atacante") |> chamar()

      assert conn.status == 401
      assert conn.halted
    end

    test "recusa token vazio", %{conn: conn} do
      conn = conn |> put_req_header(@cabecalho, "") |> chamar()

      assert conn.status == 401
    end

    test "recusa prefixo do token válido", %{conn: conn} do
      # Comprimento diferente sai antes na comparação; o caso existe para
      # garantir que sair antes NÃO significa aceitar.
      prefixo = String.slice(@valido, 0..3)
      conn = conn |> put_req_header(@cabecalho, prefixo) |> chamar()

      assert conn.status == 401
    end

    test "não aceita o token no cabeçalho authorization", %{conn: conn} do
      # O cabeçalho é próprio de propósito: `authorization` significa "JWT de
      # usuário" no resto do sistema, e aceitar os dois criaria ambiguidade
      # sobre qual mecanismo protege a rota.
      conn = conn |> put_req_header("authorization", "Bearer #{@valido}") |> chamar()

      assert conn.status == 401
    end
  end

  describe "token válido" do
    test "deixa passar sem tocar na resposta", %{conn: conn} do
      conn = conn |> put_req_header(@cabecalho, @valido) |> chamar()

      refute conn.halted
      assert conn.status == nil
    end
  end

  describe "rotação" do
    test "aceita o token ANTERIOR enquanto a rotação não termina", %{conn: conn} do
      Application.put_env(:engine, :service_token, "token-novo")
      Application.put_env(:engine, :service_token_previous, @valido)

      conn = conn |> put_req_header(@cabecalho, @valido) |> chamar()

      refute conn.halted
    end

    test "aceita também o token NOVO", %{conn: conn} do
      Application.put_env(:engine, :service_token, "token-novo")
      Application.put_env(:engine, :service_token_previous, @valido)

      conn = conn |> put_req_header(@cabecalho, "token-novo") |> chamar()

      refute conn.halted
    end

    test "terminada a rotação, o anterior deixa de valer", %{conn: conn} do
      Application.put_env(:engine, :service_token, "token-novo")
      Application.delete_env(:engine, :service_token_previous)

      conn = conn |> put_req_header(@cabecalho, @valido) |> chamar()

      assert conn.status == 401
    end

    test "anterior igual ao atual não conta como rotação", %{conn: conn} do
      # Configurar os dois com o mesmo valor não é rotação; tratar como se
      # fosse faria a verificação pagar o dobro do custo sem motivo.
      Application.put_env(:engine, :service_token_previous, @valido)

      conn = conn |> put_req_header(@cabecalho, @valido) |> chamar()

      refute conn.halted
    end
  end
end
