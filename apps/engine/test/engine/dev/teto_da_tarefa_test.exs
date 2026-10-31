defmodule Engine.Dev.TetoDaTarefaTest do
  use ExUnit.Case, async: true

  alias Engine.Dev.TetoDaTarefa

  test "RN-774: a primeira tarefa do módulo ganha 2x; as outras, o teto" do
    assert TetoDaTarefa.efetivo(500_000, %{"primeiraDoModulo" => true}) == 1_000_000
    assert TetoDaTarefa.efetivo(500_000, %{"primeiraDoModulo" => false}) == 500_000
  end

  test "sem a marca (api antiga, contexto sem módulo) vale o teto normal; sem teto segue sem" do
    assert TetoDaTarefa.efetivo(500_000, %{}) == 500_000
    assert TetoDaTarefa.efetivo(500_000, %{"primeiraDoModulo" => "true"}) == 500_000
    assert TetoDaTarefa.efetivo(nil, %{"primeiraDoModulo" => true}) == nil
  end

  test "descreve o teto que valeu" do
    assert TetoDaTarefa.descrever(1_000_000, true) =~
             "teto da primeira tarefa do módulo: 1000000 micro-USD, US$ 1.00"

    assert TetoDaTarefa.descrever(500_000, false) =~ "teto: 500000 micro-USD, US$ 0.50"
  end
end
