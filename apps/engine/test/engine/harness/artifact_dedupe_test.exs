defmodule Engine.Harness.ArtifactDedupeTest do
  # Puro: sem banco, sem env global.
  use ExUnit.Case, async: true

  alias Engine.Harness.ArtifactDedupe

  describe "normalizar/1" do
    test "caixa, acento e espaço em excesso não fazem título novo" do
      canonico = ArtifactDedupe.normalizar("Saudação com nome")

      assert ArtifactDedupe.normalizar("saudação com nome") == canonico
      assert ArtifactDedupe.normalizar("SAUDACAO COM NOME") == canonico
      assert ArtifactDedupe.normalizar("  Saudação   com  nome  ") == canonico
    end

    test "pontuação FICA — colapsá-la juntaria títulos escritos diferentes de propósito" do
      refute ArtifactDedupe.normalizar("Saudação: com nome") ==
               ArtifactDedupe.normalizar("Saudação com nome")
    end

    test "não-binário vira vazio em vez de explodir" do
      assert ArtifactDedupe.normalizar(nil) == ""
      assert ArtifactDedupe.normalizar(42) == ""
    end
  end

  describe "duplicata/2" do
    test "devolve o título ORIGINAL, não a forma canônica" do
      # O modelo precisa ver o texto como foi gravado; devolver "saudacao com
      # nome" o faria tentar consertar um fantasma.
      assert ArtifactDedupe.duplicata("SAUDACAO COM NOME", ["Saudação com nome"]) ==
               "Saudação com nome"
    end

    test "título inédito não é duplicata" do
      assert ArtifactDedupe.duplicata("Outra regra", ["Saudação com nome"]) == nil
    end

    test "lista vazia nunca acusa" do
      assert ArtifactDedupe.duplicata("Saudação com nome", []) == nil
    end

    test "título vazio (ou só espaço) não colide com nada" do
      # Senão dois títulos inválidos colidiriam entre si e o erro reportado
      # seria o de duplicata, escondendo o de schema.
      assert ArtifactDedupe.duplicata("   ", ["", "outra"]) == nil
    end

    test "semanticamente igual, escrito diferente, PASSA — e isso é o limite conhecido" do
      # Exatamente o par do achado K/R que este mecanismo não resolve.
      assert ArtifactDedupe.duplicata(
               "Quem chama pode se identificar e recebe saudação personalizada",
               ["Saudação com nome"]
             ) == nil
    end
  end
end
