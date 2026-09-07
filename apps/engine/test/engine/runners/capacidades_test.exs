defmodule Engine.Runners.CapacidadesTest do
  @moduledoc """
  O vocabulário e as três perguntas do `join` (ADR 0147 ponto 1, RN-514),
  isoladas do canal: `Engine.Runners.Capacidades` é função pura sobre os
  params do join e o `execution_mode` do projeto — sem socket, sem banco.

  A cobertura ponta a ponta (join de verdade, recusa de verdade, mensagem
  recusada de verdade) vive em `EngineWeb.TerminalChannelTest`.
  """

  use ExUnit.Case, async: true

  alias Engine.Runners.Capacidades

  describe "declaradas/1" do
    test "lista declarada é respeitada" do
      assert Capacidades.declaradas(%{"capacidades" => ["exec", "pty"]}) ==
               MapSet.new(["exec", "pty"])
    end

    test "params SEM `capacidades` é binário LEGADO — concede exec e pty" do
      assert Capacidades.declaradas(%{}) == MapSet.new(["exec", "pty"])
    end

    test "lista VAZIA também é legado — é a forma que params vazios assumem no caminho de rede" do
      assert Capacidades.declaradas(%{"capacidades" => []}) == MapSet.new(["exec", "pty"])
    end

    test "valor que não é lista (nem params que não é mapa) cai no legado" do
      assert Capacidades.declaradas(%{"capacidades" => "exec"}) == MapSet.new(["exec", "pty"])
      assert Capacidades.declaradas(nil) == MapSet.new(["exec", "pty"])
    end

    test "capacidade DESCONHECIDA é ignorada, e o resto passa" do
      assert Capacidades.declaradas(%{"capacidades" => ["exec", "teletransporte"]}) ==
               MapSet.new(["exec"])
    end

    test "declarar SÓ nomes desconhecidos é declaração vazia, nunca legado" do
      assert Capacidades.declaradas(%{"capacidades" => ["teletransporte"]}) == MapSet.new()
    end

    test "`espelho` está no vocabulário e é declarável" do
      assert "espelho" in Capacidades.conhecidas()

      assert Capacidades.declaradas(%{"capacidades" => ["espelho"]}) ==
               MapSet.new(["espelho"])
    end
  end

  describe "exigidas/2" do
    test "`runner` exige exec" do
      assert Capacidades.exigidas("runner") == MapSet.new(["exec"])
    end

    test "`container` e `mounted` não exigem nada — o runner não é o caminho de execução deles" do
      assert Capacidades.exigidas("container") == MapSet.new()
      assert Capacidades.exigidas("mounted") == MapSet.new()
    end

    test "modo desconhecido ou `nil` não exige nada — 'não sei' nunca vira recusa (RN-088)" do
      assert Capacidades.exigidas(nil) == MapSet.new()
      assert Capacidades.exigidas("modo-que-nao-existe") == MapSet.new()
    end

    test "MODO nenhum exige `espelho` — quem exige é o DESTINO (RN-516)" do
      refute Enum.any?(["runner", "container", "mounted", nil], fn modo ->
               MapSet.member?(Capacidades.exigidas(modo), "espelho")
             end)
    end

    test "destino declarado EXIGE `espelho`, em qualquer modo" do
      for modo <- ["runner", "mounted", nil] do
        assert MapSet.member?(
                 Capacidades.exigidas(modo, "/home/voce/espelhos/proj"),
                 "espelho"
               )
      end
    end

    test "`runner` COM destino exige as duas — exec pelo modo, espelho pelo destino" do
      assert Capacidades.exigidas("runner", "/home/voce/espelhos/proj") ==
               MapSet.new(["exec", "espelho"])
    end

    test "destino nulo ou em BRANCO não exige nada — string vazia não é destino" do
      assert Capacidades.exigidas("mounted", nil) == MapSet.new()
      assert Capacidades.exigidas("mounted", "") == MapSet.new()
      assert Capacidades.exigidas("mounted", "   ") == MapSet.new()
    end

    test "destino?/1 é a ÚNICA resposta pra 'isto é um destino?'" do
      assert Capacidades.destino?("/home/voce/espelhos/proj")
      refute Capacidades.destino?(nil)
      refute Capacidades.destino?("")
      refute Capacidades.destino?("  ")
      refute Capacidades.destino?(42)
    end
  end

  describe "conceder/3" do
    test "caminho feliz: declarou o que o modo exige, recebe o que declarou" do
      assert {:ok, concedidas} =
               Capacidades.conceder(%{"capacidades" => ["exec", "pty"]}, "runner")

      assert concedidas == MapSet.new(["exec", "pty"])
    end

    test "binário legado num projeto `runner` entra — exec e pty é o que ele sabe fazer" do
      assert {:ok, concedidas} = Capacidades.conceder(%{}, "runner")
      assert concedidas == MapSet.new(["exec", "pty"])
    end

    test "capacidade EXIGIDA e não declarada devolve a lista do que falta" do
      assert {:error, ["exec"]} = Capacidades.conceder(%{"capacidades" => ["pty"]}, "runner")
    end

    test "declarar menos que o legado num modo que não exige nada é ACEITO" do
      assert {:ok, concedidas} = Capacidades.conceder(%{"capacidades" => ["pty"]}, "container")
      assert concedidas == MapSet.new(["pty"])
    end

    test "projeto COM destino e runner que declara `espelho`: concede, e o espelho entra" do
      assert {:ok, concedidas} =
               Capacidades.conceder(
                 %{"capacidades" => ["exec", "pty", "espelho"]},
                 "runner",
                 "/home/voce/espelhos/proj"
               )

      assert concedidas == MapSet.new(["exec", "pty", "espelho"])
    end

    test "projeto COM destino e runner que NÃO declara `espelho`: recusa NOMEANDO o que falta" do
      # O primeiro caso REAL do mecanismo de recusa que a RN-514 deixou
      # implementado e sem disparo nenhum. Custo declarado no ADR 0147: um
      # binário velho deixa de conectar num projeto que exige `espelho`.
      assert {:error, ["espelho"]} =
               Capacidades.conceder(
                 %{"capacidades" => ["exec", "pty"]},
                 "runner",
                 "/home/voce/espelhos/proj"
               )
    end

    test "binário LEGADO (params vazios) num projeto com destino também é recusado" do
      assert {:error, ["espelho"]} =
               Capacidades.conceder(%{}, "mounted", "/home/voce/espelhos/proj")
    end

    test "sem destino, nada muda para ninguém — o caminho de sempre continua igual" do
      assert {:ok, concedidas} = Capacidades.conceder(%{}, "runner", nil)
      assert concedidas == MapSet.new(["exec", "pty"])
    end

    test "runner mais NOVO que o engine conecta — o desconhecido some, não recusa" do
      assert {:ok, concedidas} =
               Capacidades.conceder(
                 %{"capacidades" => ["exec", "pty", "espelho", "capacidade-do-futuro"]},
                 "runner"
               )

      assert concedidas == MapSet.new(["exec", "pty", "espelho"])
    end
  end

  describe "mensagens" do
    test "a recusa do join NOMEIA a capacidade que falta e diz o que fazer" do
      mensagem = Capacidades.mensagem_de_recusa(["exec"])

      assert mensagem =~ "`exec`"
      assert mensagem =~ "brabo-runner"
      assert mensagem =~ "npm install -g @brabo/runner"
    end

    test "a recusa de uma MENSAGEM nomeia a capacidade E o evento não entregue" do
      mensagem = Capacidades.mensagem_de_capacidade_ausente("pty", "pty_open")

      assert mensagem =~ "`pty`"
      assert mensagem =~ "`pty_open`"
      assert mensagem =~ "NÃO foi entregue"
    end
  end
end
