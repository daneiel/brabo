defmodule Engine.Sessions.EngineApiClientHeadersTest do
  @moduledoc """
  O funil de headers de toda chamada engine -> api (ADR 0035).

  A regressão que este arquivo existe para pegar: o `traceparent` era injetado
  dentro de `post_returning/3`, que é funil só dos POSTs. Os seis `Req.get` e o
  `llm_turn_stream` mandavam `auth_headers()` puro, sem trace. O efeito era
  silencioso e enganoso — a árvore da sessão existia no Tempo e parecia
  completa, mas toda a metade de LEITURA (o `list_events` da rehidratação, as
  leituras que montam o contexto do agente) e o turno de LLM em streaming
  apareciam como traces órfãs, desconectadas de quem as pediu.

  Nada aqui faz HTTP. O módulo não tem teste de nível HTTP hoje (os testes
  passam por `test/support/fake_engine_api_client.ex`) e montar `Req.Test` só
  para isto seria desproporcional. O que se afirma é mais direto e mais difícil
  de burlar: **existe um funil, e ninguém escapa dele**.
  """

  use ExUnit.Case, async: true

  @caminho "lib/engine/sessions/engine_api_client.ex"

  describe "o funil" do
    setup do
      %{fonte: File.read!(Path.join(File.cwd!(), @caminho))}
    end

    test "nenhum call site usa auth_headers() direto", %{fonte: fonte} do
      # `auth_headers/0` só pode ser composta por `headers/0`. Qualquer
      # `headers: auth_headers()` de volta no arquivo é uma chamada sem trace.
      refute fonte =~ "headers: auth_headers()"
    end

    test "nem monta a composição à mão no lugar de chamar o funil", %{fonte: fonte} do
      # Como era antes dentro de `post_returning/3`: funcionava, e é justamente o
      # padrão que deixou os GETs de fora por não ser o único caminho.
      refute fonte =~ "headers: trace_headers("
      # A composição existe em UM lugar só, o do funil.
      assert fonte =~ "def headers, do: trace_headers(auth_headers())"
    end

    test "todo Req.get e o stream passam por headers()", %{fonte: fonte} do
      # Oito call sites quando isto foi escrito: seis GET, o stream de SSE e o
      # funil de POST. O número não é o contrato — a ausência de escapatória é.
      assert fonte |> String.split("headers: headers()") |> length() |> Kernel.-(1) >= 8

      for linha <- String.split(fonte, "\n"),
          String.contains?(linha, "Req.get(") do
        assert String.contains?(linha, "headers: headers()"),
               "Req.get sem o funil de headers: #{String.trim(linha)}"
      end
    end
  end

  describe "headers/0" do
    test "sempre carrega o token de serviço" do
      # Sem ele todo /internal da api responde 401 — o funil não pode perder o
      # header que já funcionava ao ganhar o que faltava.
      headers = chamar_headers()
      assert Enum.any?(headers, fn {nome, _} -> nome == "x-brabo-service-token" end)
    end

    test "dentro de uma span, acrescenta traceparent W3C" do
      Engine.Telemetry.Span.with_span("teste", %{}, fn ->
        headers = chamar_headers()

        assert {_, traceparent} =
                 Enum.find(headers, fn {nome, _} -> nome == "traceparent" end)

        assert traceparent =~ ~r/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/
      end)
    end

    test "fora de span, só o token — e não levanta" do
      # Job antigo, boot, qualquer caminho sem contexto: a chamada tem que sair
      # de todo jeito. Um funil que exigisse span quebraria a rehidratação.
      headers = chamar_headers()
      refute Enum.any?(headers, fn {nome, _} -> nome == "traceparent" end)
      assert length(headers) == 1
    end
  end

  # `headers/0` é `@doc false` no `.Live` — pública apenas para este teste poder
  # afirmar sobre o valor real em vez de sobre o texto do arquivo.
  defp chamar_headers, do: Engine.Sessions.EngineApiClient.Live.headers()
end
