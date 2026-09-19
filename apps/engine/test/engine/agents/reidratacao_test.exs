defmodule Engine.Agents.ReidratacaoTest do
  @moduledoc """
  RN-580 — o que um agente conversacional recebe quando sobe sobre uma sessão
  que já tem conversa. Cada tipo que entra na reidratação tem um teste que
  reprova se ele sair (é a mutação que a RN pede), e o corte pela cauda tem o
  número escrito conferido.
  """

  use ExUnit.Case, async: false

  alias Engine.Agents.Reidratacao
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    on_exit(fn -> Application.delete_env(:engine, :engine_api_client) end)
    :ok
  end

  defp msg(texto), do: %{"type" => "chat.message", "payload" => %{"text" => texto}}

  defp resp(texto, agente \\ "criativo"),
    do: %{
      "type" => "agent.response",
      "actor" => %{"kind" => "agent", "id" => agente},
      "payload" => %{"content" => texto}
    }

  defp tool_call(agente, tool, args),
    do: %{
      "type" => "tool.call",
      "actor" => %{"kind" => "agent", "id" => agente},
      "payload" => %{"tool" => tool, "args" => args}
    }

  defp tool_result(agente, tool, payload),
    do: %{
      "type" => "tool.result",
      "actor" => %{"kind" => "agent", "id" => agente},
      "payload" => Map.put(payload, "tool", tool)
    }

  defp historico(agente \\ "criativo"), do: Reidratacao.historico("p", "s", agente)

  defp conteudos(mensagens), do: Enum.map(mensagens, & &1["content"])

  describe "o que entra (caminho feliz)" do
    test "mensagens do usuário e respostas continuam entrando, na ordem" do
      Process.put(:fake_events, [msg("minha ideia é X"), resp("legal, me conta mais")])

      assert [
               %{"role" => "user", "content" => "minha ideia é X"},
               %{"role" => "assistant", "content" => "legal, me conta mais"}
             ] = historico()
    end

    test "pergunta estruturada entra como fala do agente, com rótulos e opções" do
      Process.put(:fake_events, [
        msg("quero um app"),
        %{
          "type" => "chat.structured_question",
          "actor" => %{"kind" => "agent", "id" => "criativo"},
          "payload" => %{
            "questions" => [
              %{"id" => "nome", "label" => "Qual o nome?", "type" => "text"},
              %{"id" => "pub", "label" => "Quem usa?", "options" => ["B2B", "B2C"]}
            ]
          }
        }
      ])

      [_usuario, pergunta] = historico()
      assert pergunta["role"] == "assistant"
      assert pergunta["content"] =~ "Enviei ao usuário, por formulário"
      assert pergunta["content"] =~ "1. Qual o nome?"
      assert pergunta["content"] =~ "2. Quem usa? (opções: B2B | B2C)"
    end

    test "pergunta de OUTRO agente entra nomeando quem perguntou" do
      Process.put(:fake_events, [
        %{
          "type" => "chat.structured_question",
          "actor" => %{"kind" => "agent", "id" => "criativo"},
          "payload" => %{"questions" => [%{"id" => "a", "label" => "Prazo?"}]}
        }
      ])

      [pergunta] = historico("po")
      assert pergunta["content"] =~ "O agente criativo enviou ao usuário"
    end

    test "a resposta ao formulário entra UMA vez — pelo chat.message que a api grava junto" do
      # `AnswerStructuredQuestionUseCase` grava o `_answered` E reusa
      # `SendAgentMessageUseCase`, que grava o `chat.message` formatado. O
      # agente leu o segundo ao vivo; reidratar os dois duplicaria a resposta.
      Process.put(:fake_events, [
        %{
          "type" => "chat.structured_question_answered",
          "actor" => %{"kind" => "user", "id" => "u1"},
          "payload" => %{"questionSetId" => "q1", "answers" => %{"nome" => "Brabo"}}
        },
        msg("1. Qual o nome?: Brabo")
      ])

      assert conteudos(historico()) == ["1. Qual o nome?: Brabo"]
    end

    test "ferramenta do PRÓPRIO agente entra com argumentos e desfecho pareados" do
      Process.put(:fake_events, [
        msg("registra a regra"),
        tool_call("criativo", "emit_artifact", %{"type" => "business_rule"}),
        # o artefato que a ferramenta gravou fica ENTRE a chamada e o resultado
        %{"type" => "artifact.business_rule", "id" => "r1", "payload" => %{}},
        tool_result("criativo", "emit_artifact", %{"ok" => true}),
        tool_call("criativo", "emit_artifact", %{"type" => "note"}),
        tool_result("criativo", "emit_artifact", %{"ok" => false, "erro" => "schema"})
      ])

      [_usuario, ok, erro] = historico()
      assert ok["role"] == "assistant"
      assert ok["content"] =~ "Chamei a ferramenta `emit_artifact`"
      assert ok["content"] =~ ~s("type":"business_rule")
      assert ok["content"] =~ "desfecho: ok."
      assert erro["content"] =~ ~s("type":"note")
      assert erro["content"] =~ "desfecho: ERRO: schema."
    end

    test "o texto que a ferramenta devolveu volta na nota, e o corte diz o total real (RN-589)" do
      Process.put(:fake_events, [
        tool_call("po", "create_epic", %{"title" => "Cadastro"}),
        tool_result("po", "create_epic", %{"ok" => true, "resultado" => "épico criado id=ep-42"}),
        tool_call("po", "listar_backlog", %{}),
        tool_result("po", "listar_backlog", %{
          "ok" => true,
          "resultado" => "linhas...",
          "resultadoTotal" => 9000
        })
      ])

      [criado, cortado] = historico("po")
      assert criado["content"] =~ "desfecho: ok, devolveu: épico criado id=ep-42."
      assert cortado["content"] =~ "cortado; o total real tinha 9000 caracteres"
    end

    test "ferramenta sem tool.result (sessão anterior à RN-589) diz que o log não tem o desfecho" do
      Process.put(:fake_events, [tool_call("po", "create_epic", %{"title" => "Cadastro"})])

      [nota] = historico("po")
      assert nota["content"] =~ "Chamei a ferramenta `create_epic`"
      assert nota["content"] =~ "não registra o desfecho"
    end

    test "ferramenta de OUTRO agente fica de fora" do
      Process.put(:fake_events, [
        tool_call("criativo", "emit_artifact", %{}),
        tool_result("criativo", "emit_artifact", %{"ok" => true})
      ])

      assert historico("po") == []
    end

    test "argumento gigante é cortado" do
      Process.put(:fake_events, [
        tool_call("ux-designer", "propose_prototype", %{"telas" => String.duplicate("x", 5_000)})
      ])

      [nota] = historico("ux-designer")
      assert String.length(nota["content"]) < 2_000
      assert nota["content"] =~ "…"
    end
  end

  describe "o fim da conversa, não o começo" do
    test "pede a CAUDA, com o teto de 200" do
      Process.put(:fake_events, [msg("oi")])
      historico()

      assert [primeira | _] = Process.get(:fake_list_events_calls)
      assert primeira[:latest] == true
      assert primeira[:limit] == 200
      assert Reidratacao.teto() == 200
    end

    test "conversa que cabe no teto não ganha resumo nem leitura extra" do
      Process.put(:fake_events, Enum.map(1..200, &msg("m#{&1}")))

      mensagens = historico()
      assert length(mensagens) == 200
      assert List.first(mensagens)["content"] == "m1"
      assert length(Process.get(:fake_list_events_calls)) == 1
    end

    test "conversa maior que o teto: o FIM entra inteiro, o começo vira resumo com o número" do
      Process.put(:fake_events, Enum.map(1..250, &msg("m#{&1}")))

      [resumo | resto] = historico()

      # a última mensagem é a que o agente estava respondendo — era ela que
      # ficava de fora quando a leitura pegava os PRIMEIROS 200
      assert List.last(resto)["content"] == "m250"
      assert List.first(resto)["content"] == "m51"
      assert length(resto) == 200

      assert resumo["role"] == "system"
      assert resumo["content"] =~ "50 evento(s) ANTERIORES aos 200 mais recentes"
      # a abertura: as primeiras mensagens, que não estão na cauda
      assert resumo["content"] =~ "- usuário: m1\n"
      refute resumo["content"] =~ "m51"
    end

    test "o resumo traz o texto gravado na compactação mais recente do agente" do
      compactacoes = [
        %{
          "type" => "context.compacted",
          "payload" => %{
            "tokensBefore" => 10,
            "tokensAfter" => 5,
            "summary" => "resumo velho",
            "agent" => "criativo"
          }
        },
        %{
          "type" => "context.compacted",
          "payload" => %{
            "tokensBefore" => 10,
            "tokensAfter" => 5,
            "summary" => "resumo do PO",
            "agent" => "po"
          }
        },
        %{
          "type" => "context.compacted",
          "payload" => %{
            "tokensBefore" => 10,
            "tokensAfter" => 5,
            "summary" => "o usuário quer X",
            "agent" => "criativo"
          }
        }
      ]

      Process.put(:fake_events, compactacoes ++ Enum.map(1..250, &msg("m#{&1}")))

      [resumo | _] = historico()
      assert resumo["content"] =~ "o usuário quer X"
      refute resumo["content"] =~ "resumo do PO"
      refute resumo["content"] =~ "resumo velho"
    end

    test "conversa compactada ANTES do resumo ser gravado é declarada, não inventada" do
      antiga = %{
        "type" => "context.compacted",
        "payload" => %{"tokensBefore" => 10, "tokensAfter" => 5}
      }

      Process.put(:fake_events, [antiga, antiga] ++ Enum.map(1..250, &msg("m#{&1}")))

      [resumo | _] = historico()
      assert resumo["content"] =~ "compactada 2 vez(es) antes de o resumo"
      assert resumo["content"] =~ "se perdeu"
    end
  end

  describe "falha" do
    test "histórico ilegível vira UMA mensagem de sistema dizendo isso — nunca uma conversa vazia calada" do
      Process.put(:fake_events_error, {500, %{"message" => "fora"}})

      assert [%{"role" => "system", "content" => conteudo}] = historico()
      assert conteudo =~ "Não consegui ler o histórico desta sessão"
    end

    test "a abertura falhando não apaga o número nem a cauda" do
      Process.put(:fake_events, Enum.map(1..230, &msg("m#{&1}")))

      Process.put(:fake_events_error_quando, fn opts ->
        if opts[:after_seq] == 0, do: :timeout
      end)

      [resumo | resto] = historico()
      assert length(resto) == 200
      assert resumo["content"] =~ "30 evento(s) ANTERIORES"
      assert resumo["content"] =~ "Não consegui ler a abertura da conversa (:timeout)"
    end
  end

  describe "leitura por tipo (kickoffs)" do
    test "traz só os tipos pedidos, os mais recentes, e diz quando bate no teto" do
      Process.put(
        :fake_events,
        Enum.map(1..300, &msg("m#{&1}")) ++
          [%{"type" => "artifact.product_brief", "payload" => %{"summary" => "tarde"}}]
      )

      assert {:ok, [brief], false} =
               Reidratacao.eventos_do_tipo("p", "s", ["artifact.product_brief"])

      assert brief["payload"]["summary"] == "tarde"

      Process.put(
        :fake_events,
        Enum.map(1..201, fn i -> %{"type" => "artifact.business_rule", "id" => "r#{i}"} end)
      )

      assert {:ok, regras, true} =
               Reidratacao.eventos_do_tipo("p", "s", ["artifact.business_rule"])

      assert length(regras) == 200
      assert List.last(regras)["id"] == "r201"
      assert Reidratacao.aviso_de_recorte(true) =~ "teto de 200"
      assert Reidratacao.aviso_de_recorte(false) == ""
    end

    test "falha de leitura sobe como erro" do
      Process.put(:fake_events_error, :econnrefused)

      assert {:error, :econnrefused} =
               Reidratacao.eventos_do_tipo("p", "s", ["artifact.product_brief"])
    end
  end
end
