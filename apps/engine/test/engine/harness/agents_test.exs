defmodule Engine.Harness.AgentsTest do
  use ExUnit.Case, async: true

  alias Engine.Harness.Agents

  @moduledoc """
  A identidade de agente diz o papel — e, no caso do Criativo, também a
  FRONTEIRA.

  Numa execução real ele perguntou ao usuário se a API devia usar `GET` ou
  `POST` e se a resposta devia ser JSON ou texto puro: decisões do Arquiteto.
  A identidade dizia o que ele FAZ e não dizia o que não é dele, e um modelo
  prestativo preenche o vão.
  """

  describe "identity/1 do Criativo" do
    test "declara o papel" do
      assert Agents.identity("criativo") =~ "ideação de produto"
      assert Agents.identity("criativo") =~ "regras de negócio"
    end

    test "declara a FRONTEIRA — o que não é dele e de quem é" do
      identidade = Agents.identity("criativo")

      assert identidade =~ "FRONTEIRA"
      assert identidade =~ "Arquiteto"
      # Os três assuntos que ele invadiu na execução real.
      assert identidade =~ "método"
      assert identidade =~ "formato de resposta"
      assert identidade =~ "não escreve código"
    end
  end

  describe "identity/1 dos demais" do
    test "todo slug conhecido tem identidade" do
      for slug <- Agents.known() do
        assert is_binary(Agents.identity(slug))
        assert Agents.identity(slug) != ""
      end
    end

    @doc """
    Slug desconhecido cai num fallback e NÃO levanta: o harness precisa montar
    prompt para qualquer slug, e um agente novo sem entrada aqui não pode
    derrubar a sessão.
    """
    test "slug desconhecido tem fallback genérico" do
      assert Agents.identity("agente-que-nao-existe") =~ "agente-que-nao-existe"
    end
  end
end
