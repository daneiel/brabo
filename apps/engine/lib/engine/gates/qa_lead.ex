defmodule Engine.Gates.QaLead do
  @moduledoc """
  Lógica pura da área de QA (Fase 8b, ADR 0038): a decisão de delegar e a
  consolidação dos pareceres num veredito só. Sem IO — o `QaLeadServer` busca
  contexto, roda os subagentes e chama a api; este módulo só decide, no mesmo
  espírito de `domain/sessions/agent-activation.ts` do lado api.

  ## Por que o veredito final não é um artefato genérico

  O ADR 0038 desenha um `consolidated_verdict` genérico pra qualquer área. A
  área de QA não usa: ela tem um contrato PRÓPRIO e anterior — `qa_verdict`
  (`veredito`/`resumo`/`itens`) —, e mudar esse contrato quebraria
  `RecordGateVerdictUseCase` e o `demo:pr-gates`. `consolidar/1` produz
  exatamente a forma de `qa_verdict`; quem consome nunca sabe que existiu mais
  de um subagente.
  """

  # Heurística por palavra-chave, não NLP: `stories.rnf` é texto livre
  # (`jsonb string[]`, ver schema.ts), e não há campo estruturado de
  # "categoria do RNF" pra consultar. Case-insensitive, substring simples.
  @palavras_chave_performance [
    "performance",
    "desempenho",
    "latência",
    "latencia",
    "throughput",
    "vazão",
    "vazao",
    "tempo de resposta",
    "escalabilidade"
  ]

  @doc """
  A story tem RNF de performance pertinente? Decide se a subespecialidade de
  Performance/Segurança é delegada ou dispensada.
  """
  def rnf_de_performance?(rnf) when is_list(rnf) do
    Enum.any?(rnf, fn item ->
      texto = String.downcase(to_string(item))
      Enum.any?(@palavras_chave_performance, &String.contains?(texto, &1))
    end)
  end

  def rnf_de_performance?(_), do: false

  @doc """
  Consolida os resultados das delegações que RODARAM (a dispensada nunca
  entra aqui — ela nem chega a ser executada). `resultados` é uma lista de
  `{label, resultado}`, `label` o rótulo pt-BR da subespecialidade (usado pra
  prefixar `itens`) e `resultado` exatamente o que
  `QaAutomacaoAgent.run/5`/`QaPerformanceSegurancaAgent.run/5` devolvem.

  Duas saídas:

  - `{:ok, %{veredito:, resumo:, itens:}}` — pronto pra
    `EngineApiClient.record_gate_verdict/8`, sem mudar o contrato: `approved`
    só se TODAS as delegações completadas tiverem aprovado; qualquer
    `changes_requested` consolida `itens` das duas, cada item prefixado com o
    `label` de quem o levantou — é assim que se rastreia a origem sem mudar
    `itens` de `string[]` pra outra forma (ADR 0038, decisão 1).
  - `{:blocked, %{reason:, diagnosis:, origin:}}` — pelo menos uma delegação
    não concluiu. NUNCA vira `changes_requested`: não há achado nenhum sobre o
    código do dev, e registrar um teria devolvido pro dev sem nada corrigível
    e ainda queimado uma correção (a mesma lição do ADR 0020, um nível acima —
    agora é falha de SUBAGENTE, não do agente único de antes).
  """
  def consolidar(resultados) when is_list(resultados) do
    case Enum.filter(resultados, fn {_label, r} -> match?({:blocked, _}, r) end) do
      [] -> consolidar_aprovados(resultados)
      bloqueados -> consolidar_bloqueio(bloqueados)
    end
  end

  defp consolidar_aprovados(resultados) do
    pareceres = Enum.map(resultados, fn {label, {:ok, verdict}} -> {label, verdict} end)

    todos_aprovados? =
      Enum.all?(pareceres, fn {_label, verdict} -> verdict.veredito == "approved" end)

    if todos_aprovados? do
      {:ok,
       %{
         veredito: "approved",
         resumo: resumo_aprovado(pareceres),
         itens: [],
         coverage_matrix: coverage_matrix_de(pareceres)
       }}
    else
      {:ok,
       %{
         veredito: "changes_requested",
         resumo: resumo_pendencias(pareceres),
         itens: itens_prefixados(pareceres),
         coverage_matrix: coverage_matrix_de(pareceres)
       }}
    end
  end

  # Só a Automação produz `coverageMatrix` (é o que roda a suite e cruza
  # regra→teste); Performance/Segurança nunca tem. Propagar em vez de
  # descartar preserva o que a UI já exibe (`VerdictCard` em
  # `PrGateTimeline.tsx` já renderiza a matriz quando presente).
  defp coverage_matrix_de(pareceres) do
    Enum.find_value(pareceres, [], fn {_label, verdict} ->
      case Map.get(verdict, :coverage_matrix, []) do
        [] -> nil
        matrix -> matrix
      end
    end)
  end

  defp resumo_aprovado(pareceres) do
    labels = pareceres |> Enum.map(fn {label, _} -> label end) |> Enum.join(" e ")
    "#{labels} aprovaram."
  end

  defp resumo_pendencias(pareceres) do
    pendentes =
      pareceres
      |> Enum.filter(fn {_label, v} -> v.veredito == "changes_requested" end)
      |> Enum.map(fn {label, _} -> label end)
      |> Enum.join(", ")

    "Mudanças solicitadas por: #{pendentes}."
  end

  defp itens_prefixados(pareceres) do
    Enum.flat_map(pareceres, fn {label, verdict} ->
      Enum.map(verdict.itens, &"[#{label}] #{&1}")
    end)
  end

  # Prioriza a PRIMEIRA falha na ordem em que as delegações foram passadas
  # (Automação antes de Performance/Segurança) — determinístico, e é raro
  # haver mais de uma; quando houver, as duas aparecem no diagnóstico mesmo
  # a origem sendo a da primeira.
  defp consolidar_bloqueio(bloqueados) do
    [{label_principal, {:blocked, principal}} | resto] = bloqueados

    diagnostico =
      if resto == [] do
        principal.diagnosis
      else
        outros =
          Enum.map_join(resto, "; ", fn {label, {:blocked, info}} ->
            "#{label}: #{info.diagnosis}"
          end)

        "#{principal.diagnosis}; #{outros}"
      end

    {:blocked,
     %{
       reason: "#{label_principal}: #{principal.reason}",
       diagnosis: diagnostico,
       origin: principal.origin
     }}
  end
end
