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

    test "ADR 0182: handoff recusado por agente já ativo é política, não código" do
      assert FalhaDeTurno.origem({409, %{"reason" => "agente_ja_ativo"}}) == "politica"
      # Outro 409 continua sendo do chamador.
      assert FalhaDeTurno.origem({409, %{"reason" => "sessao_encerrada"}}) == "codigo"
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

  describe "crédito esgotado (RN-726)" do
    test "402 do provider é infra e é reconhecido" do
      texto = "openrouter respondeu com status 402: add credits"
      assert FalhaDeTurno.credito_esgotado?(texto)
      assert FalhaDeTurno.credito_esgotado?(inspect({:final, texto}))
      assert FalhaDeTurno.origem({:final, texto}) == "infra"
    end

    test "outro erro do provider não é crédito" do
      refute FalhaDeTurno.credito_esgotado?("openrouter respondeu com status 500")
      refute FalhaDeTurno.credito_esgotado?(nil)
    end
  end

  describe "RN-730: o errorCode do provider decide antes do texto" do
    test "insufficient_credit é crédito esgotado e origem infra, sem frase nenhuma" do
      assert FalhaDeTurno.credito_esgotado?(%{
               "errorCode" => "insufficient_credit",
               "error" => "x"
             })

      assert FalhaDeTurno.origem({:final, "x", "insufficient_credit"}) == "infra"
    end

    test "outro code não é crédito, mesmo com a frase; sem code, o texto é a rede" do
      refute FalhaDeTurno.credito_esgotado?(%{"errorCode" => "upstream", "error" => "status 402"})
      assert FalhaDeTurno.credito_esgotado?(%{"errorCode" => nil, "error" => "status 402"})
      assert FalhaDeTurno.origem({:final, "upstream falhou", "upstream"}) == "modelo"
      assert FalhaDeTurno.mensagem({:final, "x", "upstream"}) =~ "x"
    end
  end

  describe "RN-733: diagnóstico sem tupla e frase curta de crédito" do
    test "diagnostico nunca devolve a tupla {:final, ...}" do
      assert FalhaDeTurno.diagnostico({:final, "x", "insufficient_credit"}) == "x"
      assert FalhaDeTurno.diagnostico({:final, "x"}) == "x"
      assert FalhaDeTurno.diagnostico(:aborted) == ":aborted"
    end

    test "crédito por code ou por texto: frase curta, sem o JSON do provider" do
      msg = FalhaDeTurno.mensagem({:final, "(402): {json}", "insufficient_credit"})
      assert msg =~ "Crédito do provedor do modelo esgotado"
      refute msg =~ "json"
      assert FalhaDeTurno.mensagem({:final, "status 402: add credits"}) =~ "esgotado"
    end
  end

  describe "RN-739: o diagnóstico leva o corpo inteiro, a bolha segue curta" do
    @corpo_402 "openrouter sem crédito (402): " <>
                 ~s({"error":{"message":"This request requires more credits. ) <>
                 String.duplicate("x", 400) <>
                 ~s(","code":402,"metadata":{"reason":"insufficient_credits","provider_name":null}}})

    test "o reason gravado contém o metadata inteiro" do
      assert FalhaDeTurno.diagnostico({:final, @corpo_402, "insufficient_credit"}) =~
               ~s("metadata":{"reason":"insufficient_credits","provider_name":null})
    end

    test "erro longo que não é crédito: a bolha corta, o diagnóstico não" do
      corpo = "openrouter respondeu com status 500: " <> String.duplicate("y", 1_000)
      msg = FalhaDeTurno.mensagem({:final, corpo, "upstream"})
      assert String.length(msg) < 450
      assert msg =~ "…"
      assert FalhaDeTurno.diagnostico({:final, corpo, "upstream"}) == corpo
    end
  end

  describe "RN-810: erro de rede do provider é infra" do
    test "code connection/timeout e texto de DNS são rede; o resto não" do
      assert FalhaDeTurno.falha_de_rede?(%{"errorCode" => "connection", "error" => "x"})
      assert FalhaDeTurno.falha_de_rede?(%{"error" => "getaddrinfo EAI_AGAIN openrouter.ai"})
      refute FalhaDeTurno.falha_de_rede?(%{"errorCode" => "auth", "error" => "chave inválida"})
      refute FalhaDeTurno.falha_de_rede?(nil)
      assert FalhaDeTurno.origem("getaddrinfo EAI_AGAIN openrouter.ai") == "infra"
      assert FalhaDeTurno.origem({:final, "read ECONNRESET"}) == "infra"
      assert FalhaDeTurno.origem("algo inesperado") == "codigo"
    end
  end
end
