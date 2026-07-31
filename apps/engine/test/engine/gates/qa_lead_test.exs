defmodule Engine.Gates.QaLeadTest do
  # Puro — sem IO, sem Application env. Mesmo espírito de
  # `domain/sessions/agent-activation.ts` do lado api: a decisão isolada da
  # busca de dados e da chamada à api.
  use ExUnit.Case, async: true

  alias Engine.Gates.QaLead

  describe "rnf_de_performance?/1" do
    test "reconhece a palavra-chave, case-insensitive" do
      assert QaLead.rnf_de_performance?(["A resposta deve sair em até 200ms"]) == false
      assert QaLead.rnf_de_performance?(["Tempo de resposta abaixo de 200ms"])
      assert QaLead.rnf_de_performance?(["PERFORMANCE: suportar 500 req/s"])
      assert QaLead.rnf_de_performance?(["Escalabilidade horizontal via HPA"])
      assert QaLead.rnf_de_performance?(["Baixa latência no endpoint de busca"])
    end

    test "story sem RNF nenhum não delega" do
      refute QaLead.rnf_de_performance?([])
    end

    test "RNF presente mas sem relação com performance não delega" do
      refute QaLead.rnf_de_performance?(["Dados sensíveis nunca em log", "Conformidade LGPD"])
    end

    test "nil (story sem o campo) não estoura — trata como ausência" do
      refute QaLead.rnf_de_performance?(nil)
    end
  end

  describe "consolidar/1 — todas as delegações aprovaram" do
    test "um parecer só (Automação, sem Performance/Segurança delegada)" do
      resultados = [
        {"QA de Automação",
         {:ok, %{veredito: "approved", resumo: "cobertura completa", itens: []}}}
      ]

      assert {:ok, %{veredito: "approved", itens: []} = consolidado} =
               QaLead.consolidar(resultados)

      assert consolidado.resumo =~ "QA de Automação"
    end

    test "as duas subespecialidades aprovando -> approved, itens vazio" do
      resultados = [
        {"QA de Automação", {:ok, %{veredito: "approved", resumo: "ok", itens: []}}},
        {"QA de Performance e Segurança", {:ok, %{veredito: "approved", resumo: "ok", itens: []}}}
      ]

      assert {:ok, %{veredito: "approved", itens: []}} = QaLead.consolidar(resultados)
    end

    test "propaga a coverage_matrix da Automação — a UI já sabe renderizar" do
      matrix = [%{rule: "regra X", tests: ["x_test.exs"], covered: true}]

      resultados = [
        {"QA de Automação",
         {:ok, %{veredito: "approved", resumo: "ok", itens: [], coverage_matrix: matrix}}}
      ]

      assert {:ok, %{coverage_matrix: ^matrix}} = QaLead.consolidar(resultados)
    end
  end

  describe "consolidar/1 — changes_requested rastreado por subespecialidade" do
    test "só a Automação pede mudança -> itens prefixados só dela" do
      resultados = [
        {"QA de Automação",
         {:ok,
          %{
            veredito: "changes_requested",
            resumo: "faltam testes",
            itens: ["regra X sem teste"]
          }}}
      ]

      assert {:ok, %{veredito: "changes_requested", itens: itens}} =
               QaLead.consolidar(resultados)

      assert itens == ["[QA de Automação] regra X sem teste"]
    end

    test "as duas pedem mudança -> itens das DUAS, cada um com o próprio prefixo" do
      resultados = [
        {"QA de Automação",
         {:ok, %{veredito: "changes_requested", resumo: "x", itens: ["falta teste de SKU"]}}},
        {"QA de Performance e Segurança",
         {:ok,
          %{
            veredito: "changes_requested",
            resumo: "y",
            itens: ["consulta em loop no handler"]
          }}}
      ]

      assert {:ok, %{veredito: "changes_requested", itens: itens}} =
               QaLead.consolidar(resultados)

      assert "[QA de Automação] falta teste de SKU" in itens
      assert "[QA de Performance e Segurança] consulta em loop no handler" in itens
    end

    test "uma aprova e a outra pede mudança -> changes_requested (não é maioria, é unanimidade)" do
      resultados = [
        {"QA de Automação", {:ok, %{veredito: "approved", resumo: "ok", itens: []}}},
        {"QA de Performance e Segurança",
         {:ok, %{veredito: "changes_requested", resumo: "lento", itens: ["N+1 na listagem"]}}}
      ]

      assert {:ok, %{veredito: "changes_requested", itens: itens}} =
               QaLead.consolidar(resultados)

      assert itens == ["[QA de Performance e Segurança] N+1 na listagem"]
    end
  end

  describe "consolidar/1 — falha de subagente NUNCA vira changes_requested" do
    test "uma delegação bloqueada -> {:blocked, ...} com a origem real, não um veredito" do
      resultados = [
        {"QA de Automação", {:ok, %{veredito: "approved", resumo: "ok", itens: []}}},
        {"QA de Performance e Segurança",
         {:blocked,
          %{
            reason: "QA de Performance/Segurança não concluiu o parecer",
            diagnosis: "limite de iterações atingido",
            origin: "modelo"
          }}}
      ]

      assert {:blocked, %{origin: "modelo", reason: reason, diagnosis: diagnosis}} =
               QaLead.consolidar(resultados)

      assert reason =~ "QA de Performance e Segurança"
      assert diagnosis =~ "limite de iterações"
    end

    test "as duas falham -> bloqueia priorizando a PRIMEIRA da lista, mas cita as duas" do
      resultados = [
        {"QA de Automação",
         {:blocked, %{reason: "falhou", diagnosis: "worktree sumiu", origin: "infra"}}},
        {"QA de Performance e Segurança",
         {:blocked, %{reason: "falhou", diagnosis: "orçamento estourado", origin: "politica"}}}
      ]

      assert {:blocked, %{origin: "infra", diagnosis: diagnosis}} = QaLead.consolidar(resultados)
      assert diagnosis =~ "worktree sumiu"
      assert diagnosis =~ "orçamento estourado"
    end

    test "uma falha e a outra aprova -> ainda bloqueia (aprovação não compensa falha)" do
      resultados = [
        {"QA de Automação",
         {:blocked, %{reason: "falhou", diagnosis: "provider caiu", origin: "infra"}}},
        {"QA de Performance e Segurança", {:ok, %{veredito: "approved", resumo: "ok", itens: []}}}
      ]

      assert {:blocked, %{origin: "infra"}} = QaLead.consolidar(resultados)
    end
  end
end
