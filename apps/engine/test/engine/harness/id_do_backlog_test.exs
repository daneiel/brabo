defmodule Engine.Harness.IdDoBacklogTest do
  use ExUnit.Case, async: true

  alias Engine.Harness.IdDoBacklog

  @a "91011f7e-1111-4111-8111-111111111111"
  @b "91011f7e-2222-4222-8222-222222222222"
  @c "abcdef01-3333-4333-8333-333333333333"

  test "prefixo único resolve para o UUID" do
    assert {:ok, @c} = IdDoBacklog.resolver_em([@a, @c], :historia, "ABCDEF01")
  end

  test "prefixo ambíguo recusa nomeado" do
    assert {:error, msg} = IdDoBacklog.resolver_em([@a, @b, @c], :historia, "91011f7e")
    assert msg =~ "ambíguo"
  end

  test "prefixo inexistente recusa nomeado" do
    assert {:error, msg} = IdDoBacklog.resolver_em([@a], :tarefa, "deadbeef")
    assert msg =~ "nenhuma tarefa"
  end

  test "UUID completo e id que não é prefixo passam sem consultar a api" do
    assert {:ok, @a} = IdDoBacklog.resolver("p", :historia, @a)
    assert {:ok, "9101"} = IdDoBacklog.resolver("p", :historia, "9101")
  end
end
