defmodule Engine.Telemetry.PrettyLogFormatterTest do
  @moduledoc """
  O formatter legível de desenvolvimento (ADR 0035).

  O que se protege NÃO é o layout — layout muda e é questão de gosto. É que
  **este código nunca pode levantar**. Ele roda dentro do logger: uma exceção
  aqui perde a linha e, pior, pode recursar tentando logar a própria falha. Um
  formatter que derruba o log em desenvolvimento transforma qualquer investigação
  em adivinhação.

  Por isso a maioria dos testes alimenta entrada torta e afirma apenas que saiu
  iodata utilizável.
  """

  use ExUnit.Case, async: true

  alias Engine.Telemetry.PrettyLogFormatter

  defp formatar(event), do: event |> PrettyLogFormatter.format(%{}) |> IO.iodata_to_binary()

  defp evento(over \\ %{}) do
    Map.merge(
      %{
        level: :info,
        msg: {:string, "sessão adotada por este nó"},
        meta: %{time: 1_785_374_400_000_000}
      },
      over
    )
  end

  describe "a linha" do
    test "termina em newline" do
      # `:logger` concatena o retorno de vários eventos; sem o \n final as linhas
      # colam umas nas outras.
      assert formatar(evento()) =~ ~r/\n$/
    end

    test "carrega o nível e a mensagem" do
      saida = formatar(evento(%{level: :warning, msg: {:string, "token recusado"}}))
      assert saida =~ "warning"
      assert saida =~ "token recusado"
    end

    test "mostra os ids encurtados, numa segunda linha" do
      saida =
        formatar(
          evento(%{
            meta: %{
              time: 1_785_374_400_000_000,
              otel_trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
              session_id: "01JEVHYP000000000000A1B2C3"
            }
          })
        )

      # 8 primeiros caracteres: o suficiente para reconhecer e para casar com a
      # linha do outro serviço, sem empurrar a mensagem para fora da tela.
      assert saida =~ "trace=4bf92f35"
      assert saida =~ "session=01JEVHYP"
      refute saida =~ "4bf92f3577b34da6a3ce929d0e0e4736"
    end

    test "sem id nenhum, não emite a segunda linha" do
      saida = formatar(evento())
      refute saida =~ "trace="
      # Uma linha só: a de conteúdo.
      assert saida |> String.trim_trailing() |> String.split("\n") |> length() == 1
    end

    test "mostra mfa quando presente" do
      saida =
        formatar(
          evento(%{
            meta: %{time: 1_785_374_400_000_000, mfa: {Engine.Sessions.Adopter, :adotar, 1}}
          })
        )

      assert saida =~ "mfa=Engine.Sessions.Adopter.adotar/1"
    end
  end

  describe "cor" do
    test "não emite escape ANSI quando o terminal não suporta" do
      # `docker compose logs` e redirecionamento para arquivo. Sujar a saída com
      # escapes é o mesmo defeito que fixar `colorize: true` no pino-pretty.
      #
      # `on_exit` e não `after`: o bloco `after` do `test` não compartilha escopo
      # com o corpo, então a variável do valor anterior não existiria lá.
      anterior = Application.get_env(:elixir, :ansi_enabled)
      on_exit(fn -> Application.put_env(:elixir, :ansi_enabled, anterior) end)

      Application.put_env(:elixir, :ansi_enabled, false)
      refute formatar(evento()) =~ "\e["
    end
  end

  describe "nunca levanta" do
    test "com evento vazio" do
      assert is_binary(formatar(%{}))
    end

    test "sem meta" do
      assert is_binary(formatar(%{level: :info, msg: {:string, "x"}}))
    end

    test "com meta nil" do
      assert is_binary(formatar(%{level: :info, msg: {:string, "x"}, meta: nil}))
    end

    test "com msg de forma inesperada" do
      assert is_binary(formatar(evento(%{msg: :atom_solto})))
      assert is_binary(formatar(evento(%{msg: {:report, %{pid: self()}}})))
    end

    test "com time inválido" do
      assert is_binary(formatar(evento(%{meta: %{time: "lixo"}})))
    end

    test "com nível desconhecido" do
      assert is_binary(formatar(evento(%{level: :nivel_que_nao_existe})))
    end
  end
end
