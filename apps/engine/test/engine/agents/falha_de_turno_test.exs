defmodule Engine.Agents.FalhaDeTurnoTest do
  @moduledoc """
  A origem da falha é sempre uma das quatro (achados P, Q e T).

  O modo de falha que estes testes existem para impedir não é classificar
  errado — é classificar com um valor que não aponta ação nenhuma. Foi o que
  aconteceu três vezes: `origin: null`, `"indeterminada"` num `agent.error`, e
  `"indeterminada"` num `dev.blocked` cujo campo `diagnosis` nomeava a causa na
  MESMA linha.
  """

  use ExUnit.Case, async: true

  alias Engine.Agents.FalhaDeTurno

  describe "o vocabulário é fechado" do
    # A afirmação central da Fase G. Se alguém acrescentar uma cláusula que
    # devolva outra coisa — ou trouxer `indeterminada` de volta —, isto falha.
    @entradas [
      :no_final_event,
      :timeout,
      :aborted,
      {500, %{}},
      {413, %{"message" => "request entity too large"}},
      {401, %{}},
      {:final, "orçamento estourado"},
      {:final, "credencial inválida"},
      {:final, "modelo vinculado sumiu"},
      {:final, "o provider respondeu 429"},
      {:final, "uma frase que ninguém previu"},
      %RuntimeError{message: "boom"},
      :algo_totalmente_novo,
      nil,
      "string solta",
      {:tupla, :estranha, 3}
    ]

    for entrada <- @entradas do
      test "#{inspect(entrada)} classifica numa das quatro" do
        origem = FalhaDeTurno.origem(unquote(Macro.escape(entrada)))

        assert origem in FalhaDeTurno.origens(),
               "origem #{inspect(origem)} não é uma das quatro do ADR 0020"
      end
    end

    test "`indeterminada` não é uma origem válida" do
      refute "indeterminada" in FalhaDeTurno.origens()
    end
  end

  describe "as classificações que a execução real ensinou" do
    test "413 do achado T: a origem sai do próprio status" do
      # O caso que encerrou a execução do hello-limpo. O corpo é grande demais
      # porque o ENGINE mandou demais — limite do nosso lado, não do modelo.
      assert FalhaDeTurno.origem({413, %{"message" => "request entity too large"}}) == "codigo"
    end

    test "5xx é da api, 4xx é de quem chamou" do
      assert FalhaDeTurno.origem({503, %{}}) == "infra"
      assert FalhaDeTurno.origem({422, %{}}) == "codigo"
    end

    test "transporte morto é infra, não modelo" do
      assert FalhaDeTurno.origem(:no_final_event) == "infra"
      assert FalhaDeTurno.origem(:aborted) == "infra"
      assert FalhaDeTurno.origem(:timeout) == "infra"
      assert FalhaDeTurno.origem(%RuntimeError{message: "conexão recusada"}) == "infra"
    end

    test "orçamento, credencial e binding são POLÍTICA — nada quebrou" do
      assert FalhaDeTurno.origem({:final, "budget excedido"}) == "politica"
      assert FalhaDeTurno.origem({:final, "credencial ausente"}) == "politica"
      assert FalhaDeTurno.origem({:final, "binding sem modelo"}) == "politica"
    end

    test "rate limit e upstream são do provider" do
      assert FalhaDeTurno.origem({:final, "rate limit do provider"}) == "modelo"
      assert FalhaDeTurno.origem({:final, "upstream 429"}) == "modelo"
    end

    test "texto não reconhecido vira `codigo`, que é onde a cláusula falta" do
      # Não é chute: é nomear a lacuna. `indeterminada` não apontava ação
      # nenhuma, e quem triava a rodada seguinte recomeçava do zero.
      assert FalhaDeTurno.origem({:final, "erro que ninguém previu ainda"}) == "codigo"
    end
  end

  describe "a mensagem que o agente diz" do
    test "nomeia o que falhou e que nada foi gasto" do
      msg = FalhaDeTurno.mensagem(:no_final_event)

      assert msg =~ "interrompida antes do fim"
      assert msg =~ "Nada foi gasto"
    end

    test "repassa verbatim o texto que a api narrou" do
      assert FalhaDeTurno.mensagem({:final, "modelo xyz não existe"}) =~ "modelo xyz não existe"
    end
  end
end
