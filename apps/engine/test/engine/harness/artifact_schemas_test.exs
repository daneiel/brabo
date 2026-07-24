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

  test "known/0 lista só os model-emittable" do
    assert Enum.sort(ArtifactSchemas.known()) == ["business_rule", "note"]
  end

  test "tipo desconhecido" do
    assert {:error, {:unknown_type, "xpto"}} =
             ArtifactSchemas.validate("xpto", %{})
  end
end
