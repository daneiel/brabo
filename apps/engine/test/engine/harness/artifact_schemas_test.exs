defmodule Engine.Harness.ArtifactSchemasTest do
  use ExUnit.Case, async: true

  alias Engine.Harness.ArtifactSchemas

  describe "note" do
    test "válido com title + body" do
      assert :ok = ArtifactSchemas.validate("note", %{"title" => "t", "body" => "b"})
    end

    test "faltando chave" do
      assert {:error, {:missing_keys, ["body"]}} =
               ArtifactSchemas.validate("note", %{"title" => "t"})
    end
  end

  describe "business_rule (origem obrigatória e não-vazia)" do
    test "válido com origin não-vazia" do
      assert :ok =
               ArtifactSchemas.validate("business_rule", %{
                 "title" => "Só maiores de 18",
                 "description" => "Cadastro exige idade >= 18",
                 "origin" => [3, 5]
               })
    end

    test "origin vazia é rejeitada" do
      assert {:error, :origem_invalida} =
               ArtifactSchemas.validate("business_rule", %{
                 "title" => "t",
                 "description" => "d",
                 "origin" => []
               })
    end

    test "origin ausente é rejeitada (chave obrigatória)" do
      assert {:error, {:missing_keys, ["origin"]}} =
               ArtifactSchemas.validate("business_rule", %{
                 "title" => "t",
                 "description" => "d"
               })
    end

    test "origin de tipo errado é rejeitada" do
      assert {:error, :origem_invalida} =
               ArtifactSchemas.validate("business_rule", %{
                 "title" => "t",
                 "description" => "d",
                 "origin" => "conversa"
               })
    end
  end

  describe "product_brief" do
    test "valida chaves, mas NÃO é tool-emittable" do
      assert :ok =
               ArtifactSchemas.validate("product_brief", %{
                 "title" => "t",
                 "summary" => "s",
                 "rules" => [1, 2]
               })

      refute "product_brief" in ArtifactSchemas.known()
    end
  end

  describe "pareceres de gate (qa_verdict/secops_verdict)" do
    test "válido sobre uma task de dev, e NÃO é tool-emittable" do
      for tipo <- ["qa_verdict", "secops_verdict"] do
        assert :ok =
                 ArtifactSchemas.validate(tipo, %{
                   "taskId" => "t-1",
                   "veredito" => "changes_requested",
                   "resumo" => "1 regra sem teste",
                   "itens" => ["RF2 não tem teste"]
                 })

        refute tipo in ArtifactSchemas.known()
      end
    end

    test "válido sobre uma PR de infra (prActionId no lugar de taskId)" do
      assert :ok =
               ArtifactSchemas.validate("secops_verdict", %{
                 "prActionId" => "a-1",
                 "veredito" => "approved",
                 "resumo" => "Nenhum achado.",
                 "itens" => []
               })
    end

    test "coverageMatrix é opcional" do
      assert :ok =
               ArtifactSchemas.validate("qa_verdict", %{
                 "taskId" => "t-1",
                 "veredito" => "approved",
                 "resumo" => "suite verde",
                 "itens" => [],
                 "coverageMatrix" => [%{"rule" => "RF1", "tests" => ["a.test.js"], "covered" => true}]
               })
    end

    test "sem sujeito, ou com os dois, é rejeitado" do
      base = %{"veredito" => "approved", "resumo" => "r", "itens" => []}

      assert {:error, {:sujeito_invalido, []}} = ArtifactSchemas.validate("qa_verdict", base)

      assert {:error, {:sujeito_invalido, _}} =
               ArtifactSchemas.validate(
                 "qa_verdict",
                 Map.merge(base, %{"taskId" => "t-1", "prActionId" => "a-1"})
               )
    end

    test "veredito fora da máquina de estados da api é rejeitado" do
      assert {:error, {:veredito_invalido, "talvez"}} =
               ArtifactSchemas.validate("qa_verdict", %{
                 "taskId" => "t-1",
                 "veredito" => "talvez",
                 "resumo" => "r",
                 "itens" => []
               })
    end

    test "faltando chave obrigatória" do
      assert {:error, {:missing_keys, ["resumo"]}} =
               ArtifactSchemas.validate("secops_verdict", %{
                 "taskId" => "t-1",
                 "veredito" => "approved",
                 "itens" => []
               })
    end
  end

  test "known/0 lista só os model-emittable" do
    assert Enum.sort(ArtifactSchemas.known()) == ["business_rule", "note"]
  end

  test "tipo desconhecido" do
    assert {:error, {:unknown_type, "xpto"}} =
             ArtifactSchemas.validate("xpto", %{})
  end
end
