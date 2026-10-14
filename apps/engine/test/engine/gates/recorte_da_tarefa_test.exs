defmodule Engine.Gates.RecorteDaTarefaTest do
  # AT-448 (RN-765): o QA julga a TAREFA, não a história inteira.
  use ExUnit.Case, async: true

  alias Engine.Gates.RecorteDaTarefa

  test "o recorte traz a tarefa, as irmãs com status e a régua de observação" do
    texto =
      RecorteDaTarefa.texto(%{
        task: %{"title" => "Modelar tabela de usuários", "description" => "hash bcrypt"},
        sibling_tasks: [%{"title" => "Login HTTP com JWT", "status" => "todo"}],
        business_rules_units: [%{id: {:business_rule, 0}, content: "Senha com bcrypt"}]
      })

    assert texto =~ "Tarefa: Modelar tabela de usuários"
    assert texto =~ "hash bcrypt"
    assert texto =~ "- Login HTTP com JWT (todo)"
    assert texto =~ "- Senha com bcrypt"
    assert texto =~ "NÃO reprova esta entrega"
  end

  test "AT-526 (RN-877): manda conferir as decisões antes de needs_user_decision" do
    texto = RecorteDaTarefa.texto(%{task: %{"title" => "Única"}})
    assert texto =~ "ANTES de `needs_user_decision`, confira as"
    assert texto =~ "`openQuestionId` só com o uuid de uma"
  end

  test "sem irmãs nem regras (contexto antigo) diz nenhuma em vez de quebrar" do
    texto = RecorteDaTarefa.texto(%{task: %{"title" => "Única"}})
    assert texto =~ "Tarefa: Única"
    assert texto =~ "(nenhuma)"
  end

  test "RN-785: traz as tarefas abertas de outras histórias do módulo e o corte" do
    texto =
      RecorteDaTarefa.texto(%{
        task: %{"title" => "Middleware JWT"},
        module_open_tasks: [
          %{"title" => "POST /links", "status" => "todo", "storyTitle" => "Criar links"}
        ],
        module_open_tasks_total: 3
      })

    assert texto =~ "- POST /links (todo, história: Criar links)"
    assert texto =~ "(mostrando 1 de 3)"
    assert texto =~ "OUTRA história ainda não feita"
  end

  test "RN-786: o contrato do módulo entra como fonte da interface, com a régua da divergência" do
    texto =
      RecorteDaTarefa.texto(%{
        task: %{"title" => "Painel"},
        module_contract: %{
          "modulo" => "api",
          "expoe" => [%{"tipo" => "rota", "assinatura" => "GET /panel", "descricao" => "painel"}]
        }
      })

    assert texto =~ "Contrato do módulo api"
    assert texto =~ "- rota: GET /panel — painel"
    assert texto =~ "nomeie a DIVERGÊNCIA"
  end

  test "RN-786: sem contrato, nenhuma seção de contrato" do
    refute RecorteDaTarefa.texto(%{task: %{"title" => "X"}, module_contract: nil}) =~
             "Contrato do módulo"
  end

  # AT-479: "a contagem e o histórico de cliques de todos os links" foi
  # aprovado com só `{totalCliques}`.
  test "regra que quantifica por item pede a conferência da forma da resposta" do
    texto =
      RecorteDaTarefa.texto(%{
        task: %{"title" => "Painel de cliques"},
        business_rules_units: [
          %{content: "O painel mostra a contagem e o histórico de cliques de todos os links"}
        ]
      })

    assert texto =~ "Forma da resposta"
    assert texto =~ "não só o total"
    assert texto =~ "o campo recusado"
  end

  test "regra sem quantificador não ganha a seção (e \"por exemplo\" não conta)" do
    texto =
      RecorteDaTarefa.texto(%{
        task: %{"title" => "Login", "description" => "por exemplo, e-mail e senha"},
        business_rules_units: [%{content: "Senha com bcrypt"}]
      })

    refute texto =~ "Forma da resposta"
  end

  # AT-483 (RN-813): o entregável não subia e nenhum gate rodou o entrypoint.
  test "tarefa que toca a fiação exige evidência do ponto de entrada real" do
    texto =
      RecorteDaTarefa.texto(%{
        task: %{
          "title" => "Registrar rotas de links",
          "description" => "server.ts chama a migração"
        }
      })

    assert texto =~ "Ponto de entrada"
    assert texto =~ "importe o entrypoint real"
    assert texto =~ "Sem essa evidência"
  end

  test "tarefa que não toca entrypoint nem fiação não ganha a seção" do
    refute RecorteDaTarefa.texto(%{task: %{"title" => "Hash de senha com bcrypt"}}) =~
             "Ponto de entrada"
  end

  # AT-487 (RN-814): o QA reprovou em duas voltas por lacunas da entrega original.
  test "o recorte pede todas as lacunas numa volta só" do
    assert RecorteDaTarefa.texto(%{task: %{"title" => "X"}}) =~ "TODAS as lacunas"
  end

  describe "Rodada 64 (RN-817/818/819)" do
    test "RN-817: pede ambiente limpo, encerrar o grupo e pulado como observação" do
      texto = RecorteDaTarefa.texto(%{task: %{"title" => "Modelar tabela"}})
      assert texto =~ "Ambiente limpo"
      assert texto =~ "encerrar o GRUPO"
      assert texto =~ "se PULOU por ambiente"
      assert texto =~ "nunca processo de fora dele"
    end

    test "RN-818: com ponto de entrada diz o que conta e o que não cabe" do
      texto = RecorteDaTarefa.texto(%{task: %{"title" => "Fiação do server.ts"}})
      assert texto =~ "O que CONTA como evidência"
      assert texto =~ "construir imagem Docker"
      assert texto =~ "NUNCA vai para `itens`"
    end

    test "RN-818: sem ponto de entrada não traz a régua de evidência" do
      texto = RecorteDaTarefa.texto(%{task: %{"title" => "Modelar tabela"}})
      refute texto =~ "O que CONTA como evidência"
    end

    test "RN-819: pede varredura por regra antes de emitir" do
      texto =
        RecorteDaTarefa.texto(%{
          task: %{"title" => "X"},
          business_rules_units: [%{content: "Regra A"}]
        })

      assert texto =~ "VARREDURA POR REGRA"
      assert texto =~ "Só emita depois de passar por TODAS"
    end

    test "RN-846: confere rota no README e erro de entrada próprio" do
      texto = RecorteDaTarefa.texto(%{task: %{"title" => "X"}})
      assert texto =~ "método, caminho, corpo, respostas e"
      assert texto =~ "a crua da biblioteca"
      refute texto =~ "Expected property name"
    end

    test "RN-850: confere a seção Rotas HTTP e a ausência de nota de processo" do
      texto = RecorteDaTarefa.texto(%{task: %{"title" => "X"}})
      assert texto =~ ~s(dentro da seção "Rotas HTTP")
      assert texto =~ "nunca no fim"
      assert texto =~ "nota de processo"
      refute texto =~ "no fim do README"
    end
  end

  describe "RN-854: OpenAPI e Swagger no container" do
    test "tarefa que toca rotas pede /openapi.json e /docs, compose em resumo" do
      texto = RecorteDaTarefa.texto(%{task: %{"title" => "Expor rotas HTTP"}})
      assert texto =~ "/openapi.json` e `/docs`"
      assert texto =~ "provado só na máquina do"
      assert texto =~ "rota faltando é ITEM, nunca observação"
      assert RecorteDaTarefa.toca_ponto_de_entrada?(%{"title" => "server.ts"})
    end

    test "RN-865: tarefa que diz só endpoint ou verbo com caminho recebe a seção" do
      criar = %{
        "title" => "Implementar criação de link com código aleatório e validação de URL",
        "description" => "Endpoint protegido que gera código de 7 caracteres."
      }

      painel = %{"title" => "Gravar cliques", "description" => "expõe GET /panel com o histórico"}

      for task <- [criar, painel] do
        assert RecorteDaTarefa.toca_ponto_de_entrada?(task)
        texto = RecorteDaTarefa.texto(%{task: task})
        assert texto =~ "rota que o CÓDIGO registra"
        assert texto =~ "rota faltando é ITEM, nunca observação"
      end
    end

    test "falha: tarefa sem rota não recebe a seção" do
      texto = RecorteDaTarefa.texto(%{task: %{"title" => "Modelar tabela"}})
      refute texto =~ "openapi.json"
      refute RecorteDaTarefa.toca_ponto_de_entrada?(nil)
    end
  end
end
