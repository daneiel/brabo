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
end
