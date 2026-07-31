defmodule Engine.Infra.InfraLead do
  @moduledoc """
  Lógica pura da área de Infra (Fase 8c, ADR 0038): a consolidação dos dois
  delegados (o próprio Lead — Dockerfiles/compose — e o `WorkflowsAgent` —
  pipeline de CI) numa PR só. Sem IO — o `InfraLeadServer` roda os dois e
  chama a api; este módulo só decide, mesmo espírito de `Engine.Gates.QaLead`.

  Diferente do QA, não há delegação dispensável aqui: as duas SEMPRE rodam
  (CLAUDE.md 8c item 3 — "delega Dockerfiles/compose pra si... e workflows
  pro subagente"), então `consolidar/2` recebe sempre os dois resultados,
  nunca uma lista variável.
  """

  @doc """
  Consolida o resultado do Lead (Dockerfiles/compose) com o do Workflows
  (CI). Cada um é exatamente o que `InfraLeadServer`'s próprio turno e
  `WorkflowsAgent.run/3` devolvem: `{:ok, %{files:, summary:}} |
  {:blocked, %{reason:, diagnosis:, origin:}}`.

  - `{:ok, %{title:, files:}}` — união dos dois conjuntos de arquivo por
    `path` (sem colisão esperada; se houver, o do Workflows vence, por ser
    mais específico), pronta pra UMA chamada a `propose_action(...,
    "open_infra_pr", ...)`.
  - `{:blocked, %{reason:, diagnosis:, origin:}}` — qualquer um dos dois não
    concluiu. NUNCA abre PR parcial — mesma regra do QA: falha de delegado
    nunca vira sucesso silencioso (ADR 0020, um nível acima).
  """
  def consolidar({:ok, lead}, {:ok, workflows}) do
    {:ok,
     %{
       title: titulo(lead.summary, workflows.summary),
       files: mesclar_arquivos(lead.files, workflows.files)
     }}
  end

  def consolidar({:blocked, info_lead}, {:ok, _workflows}),
    do: bloqueio("Infra (Dockerfiles/compose)", info_lead)

  def consolidar({:ok, _lead}, {:blocked, info_workflows}),
    do: bloqueio("Workflows (CI)", info_workflows)

  def consolidar({:blocked, info_lead}, {:blocked, info_workflows}) do
    {:blocked,
     %{
       reason: "Infra (Dockerfiles/compose): #{info_lead.reason}",
       diagnosis: "#{info_lead.diagnosis}; Workflows (CI): #{info_workflows.diagnosis}",
       origin: info_lead.origin
     }}
  end

  defp bloqueio(label, info) do
    {:blocked,
     %{reason: "#{label}: #{info.reason}", diagnosis: info.diagnosis, origin: info.origin}}
  end

  defp titulo(resumo_lead, resumo_workflows),
    do: "infra: #{resumo_lead} + #{resumo_workflows}"

  # União por `path` — o arquivo do Workflows vence em caso de colisão (mais
  # específico: só ele sabe o formato de CI decidido pelo provider).
  defp mesclar_arquivos(arquivos_lead, arquivos_workflows) do
    por_path =
      Enum.reduce(arquivos_lead, %{}, fn f, acc -> Map.put(acc, Map.get(f, "path"), f) end)

    por_path =
      Enum.reduce(arquivos_workflows, por_path, fn f, acc ->
        Map.put(acc, Map.get(f, "path"), f)
      end)

    # Preserva a ordem: arquivos do lead primeiro (na ordem original),
    # depois os do Workflows que não colidiram.
    paths_lead = Enum.map(arquivos_lead, &Map.get(&1, "path"))
    paths_workflows_novos = Enum.map(arquivos_workflows, &Map.get(&1, "path")) -- paths_lead

    (paths_lead ++ paths_workflows_novos)
    |> Enum.uniq()
    |> Enum.map(&Map.fetch!(por_path, &1))
  end
end
