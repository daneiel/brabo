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
end
