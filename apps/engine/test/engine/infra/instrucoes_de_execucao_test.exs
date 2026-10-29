defmodule Engine.Infra.InstrucoesDeExecucaoTest do
  use ExUnit.Case, async: true

  alias Engine.Infra.InstrucoesDeExecucao

  @base %{
    "command" => "docker compose up --build",
    "urls" => [
      %{"label" => "Swagger", "url" => "http://localhost:8080/docs", "kind" => "api_docs"}
    ],
    "envExample" => true
  }

  defp com_app(app), do: Map.put(@base, "app", app)
  defp app_valido, do: %{"command" => "node server.js", "port" => 3000}

  describe "run sem app (não-regressão)" do
    test "run sem app é válido e não ganha a chave" do
      assert {:ok, run} = InstrucoesDeExecucao.validar(@base)
      refute Map.has_key?(run, "app")
    end
  end

  describe "run.app (AT-610)" do
    test "app válido passa e é preservado" do
      assert {:ok, %{"app" => %{"command" => "node server.js", "port" => 3000}}} =
               InstrucoesDeExecucao.validar(com_app(app_valido()))
    end

    test "command com quebra de linha é recusado nomeando o campo" do
      app = %{"command" => "node a.js\nrm -rf /", "port" => 3000}
      assert {:error, motivo} = InstrucoesDeExecucao.validar(com_app(app))
      assert motivo =~ "`run.app.command`"
    end

    test "command com byte nulo é recusado" do
      assert {:error, motivo} =
               InstrucoesDeExecucao.validar(com_app(%{"command" => "a\0b", "port" => 3000}))

      assert motivo =~ "`run.app.command`"
    end

    test "command vazio é recusado" do
      assert {:error, motivo} =
               InstrucoesDeExecucao.validar(com_app(%{"command" => "  ", "port" => 3000}))

      assert motivo =~ "`run.app.command` está vazio"
    end

    test "command acima de 300 caracteres é recusado" do
      cmd = String.duplicate("a", 301)

      assert {:error, motivo} =
               InstrucoesDeExecucao.validar(com_app(%{"command" => cmd, "port" => 3000}))

      assert motivo =~ "passa de 300"
    end

    test "porta 80 (privilegiada) é recusada nomeando o campo" do
      assert {:error, motivo} =
               InstrucoesDeExecucao.validar(com_app(%{app_valido() | "port" => 80}))

      assert motivo =~ "`run.app.port`"
    end

    test "porta fora de faixa e não inteira são recusadas" do
      for porta <- [65_536, "3000", 3000.0] do
        assert {:error, motivo} =
                 InstrucoesDeExecucao.validar(com_app(%{app_valido() | "port" => porta}))

        assert motivo =~ "`run.app.port`"
      end
    end

    test "app que não é objeto é recusado" do
      assert {:error, motivo} = InstrucoesDeExecucao.validar(com_app("node"))
      assert motivo =~ "`run.app`"
    end
  end

  describe "run.qa (AT-612, RN-941)" do
    @dig "postgres@sha256:" <> String.duplicate("a", 64)

    defp com_qa(extra),
      do:
        Map.put(@base, "qa", %{
          "services" => [Map.merge(%{"name" => "db", "image" => @dig}, extra)]
        })

    test "user e command válidos passam e são preservados; nil vale como ausente" do
      s = %{"user" => "70:70", "command" => ["httpd", "-f"]}
      assert {:ok, %{"qa" => %{"services" => [serv]}}} = InstrucoesDeExecucao.validar(com_qa(s))
      assert serv["user"] == "70:70"
      assert {:ok, _} = InstrucoesDeExecucao.validar(com_qa(%{"user" => nil, "command" => nil}))
    end

    test "recusa root, uid sem gid, comando vazio, grande, com quebra ou longo" do
      for extra <- [
            %{"user" => "0:0"},
            %{"user" => "70:0"},
            %{"user" => "70"},
            %{"command" => []},
            %{"command" => List.duplicate("a", 17)},
            %{"command" => ["a\nb"]},
            %{"command" => [String.duplicate("a", 201)]}
          ] do
        assert {:error, motivo} = InstrucoesDeExecucao.validar(com_qa(extra))
        assert motivo =~ "run.qa.services[0]"
      end
    end
  end
end
