defmodule Engine.Harness.IteracoesTest do
  # async: false — os tetos por tipo vêm do Application env, que é global.
  use ExUnit.Case, async: false

  alias Engine.Harness.Iteracoes

  describe "tipo/1" do
    test "dev agent de módulo é execução" do
      assert Iteracoes.tipo("dev-api") == :execucao
      assert Iteracoes.tipo("dev-web") == :execucao
    end

    test "o segundo dev do mesmo módulo continua sendo execução" do
      # O paralelismo cria `dev-<modulo>-2`; ele faz o mesmo trabalho do
      # primeiro e não pode nascer com outro teto.
      assert Iteracoes.tipo("dev-api-2") == :execucao
    end

    test "os subagentes de QA são gate" do
      assert Iteracoes.tipo("qa-automacao") == :gate
      assert Iteracoes.tipo("qa-performance-seguranca") == :gate
    end

    test "o DEV LEAD é conversacional, apesar do prefixo `dev-`" do
      # O ponto da cláusula que vem ANTES do prefixo. O lead decide e delega,
      # não escreve código — e sem esta regra ele herdaria o teto do trabalho
      # pesado por acidente de nomenclatura.
      assert Iteracoes.tipo("dev-lead") == :conversacional
    end

    test "infra-workflows é conversacional DE PROPÓSITO" do
      # Ele usa ferramenta, mas roda sem `token_budget_micros`: para ele o
      # teto de iterações é a única trava de custo que existe.
      assert Iteracoes.tipo("infra-workflows") == :conversacional
    end

    test "agente desconhecido cai no teto mais BAIXO" do
      # Errar para o lado barato: quem precisa de mais voltas aparece como
      # `limite de iterações atingido` e é corrigido; quem ganha 60 por engano
      # gasta calado.
      assert Iteracoes.tipo("agente-que-ainda-nao-existe") == :conversacional
      assert Iteracoes.tipo(nil) == :conversacional
    end

    test "aceita átomo além de string" do
      assert Iteracoes.tipo(:"dev-api") == :execucao
    end
  end

  describe "teto/1" do
    test "quem trabalha ganha mais volta que quem conversa" do
      conversacional = Iteracoes.teto("criativo")

      assert Iteracoes.teto("dev-api") > conversacional
      assert Iteracoes.teto("qa-automacao") > conversacional
    end

    test "o conversacional segue no 8 que o produto sempre teve" do
      # Subir o default global seria a correção ERRADA: o Criativo não precisa
      # de 60 iterações para conversar.
      assert Iteracoes.teto("criativo") == 8
    end

    test "o dev agent tem folga para explorar, escrever e testar" do
      # Com 8 ele não escrevia um arquivo; com 25 escreveu três e rodou os
      # testes (validação real da 13b).
      assert Iteracoes.teto("dev-api") >= 25
    end
  end

  describe "sobrescrita por ambiente" do
    test "a chave ANTIGA continua sendo a do conversacional" do
      # Quem já ajustava TOOL_LOOP_MAX_ITERATIONS não pode ter o ajuste
      # ignorado em silêncio pela mudança.
      anterior = Application.get_env(:engine, :tool_loop_max_iterations)
      Application.put_env(:engine, :tool_loop_max_iterations, 3)

      # `put_env(..., nil)` NÃO restaura: a chave passa a existir valendo `nil`,
      # e `get_env/3` devolve `nil` em vez do default. Isso vazava para os
      # outros testes conforme a ordem do seed.
      on_exit(fn -> restaurar(:tool_loop_max_iterations, anterior) end)

      assert Iteracoes.teto("criativo") == 3
    end

    test "o teto de execução é sobrescrevível sem afetar o conversacional" do
      anterior = Application.get_env(:engine, :tool_loop_max_iterations_execucao)
      Application.put_env(:engine, :tool_loop_max_iterations_execucao, 99)

      on_exit(fn -> restaurar(:tool_loop_max_iterations_execucao, anterior) end)

      assert Iteracoes.teto("dev-api") == 99
      assert Iteracoes.teto("criativo") == 8
    end
  end

  # Sem valor anterior, a chave tem de SUMIR — não voltar existindo como `nil`.
  defp restaurar(chave, nil), do: Application.delete_env(:engine, chave)
  defp restaurar(chave, valor), do: Application.put_env(:engine, chave, valor)
end
