defmodule Engine.Gates.RecorteDaTarefa do
  @moduledoc """
  O recorte da TAREFA que o gate de QA julga (AT-448, RN-765).

  O QA recebia só a história inteira e reprovava a tarefa por um RF que é de
  uma tarefa IRMÃ ainda pendente ("login HTTP com JWT não existe nesta
  entrega" na tarefa que só modelava a tabela) — e a tarefa bloqueava depois
  de três correções que ela não tinha como fazer. Este módulo monta o texto
  que a QA-estratégia e a QA-automação recebem: título e descrição da tarefa,
  as regras de negócio da história, e as tarefas irmãs com o status (o que
  `GET .../dev-context` devolve em `siblingTasks`) e, desde a AT-461 (RN-785),
  as tarefas não concluídas de OUTRAS histórias do mesmo módulo
  (`moduleOpenTasks`). A régua é dita junto: o
  veredito é sobre o que é DESTA tarefa, e requisito de outra tarefa é
  OBSERVAÇÃO, nunca reprovação. Puro — sem I/O.
  """

  @doc "Texto do recorte, a partir de `dev_context` (`task`, `sibling_tasks`, regras)."
  @spec texto(map()) :: String.t()
  def texto(dev_context) do
    task = Map.get(dev_context, :task, %{})
    irmas = Map.get(dev_context, :sibling_tasks, [])
    regras = Map.get(dev_context, :business_rules_units, [])
    abertas = Map.get(dev_context, :module_open_tasks, [])
    total = Map.get(dev_context, :module_open_tasks_total, length(abertas))

    """

    RECORTE DESTA TAREFA (o veredito é sobre ele):
    Tarefa: #{Map.get(task, "title", "")}
    #{Map.get(task, "description", "")}

    Regras de negócio da história:
    #{lista(Enum.map(regras, &Map.get(&1, :content, "")))}

    Outras tarefas da MESMA história (não são desta entrega):
    #{lista(Enum.map(irmas, &irma/1))}

    Tarefas ainda NÃO concluídas de OUTRAS histórias do mesmo módulo:
    #{lista(Enum.map(abertas, &aberta/1))}#{corte(abertas, total)}

    Julgue SÓ o que é desta tarefa. Requisito da história que pertence a
    outra tarefa (feita ou pendente) NÃO reprova esta entrega: cite-o no
    `resumo` como observação e não o ponha em `itens`. O mesmo vale para o
    que depende de entrega de OUTRA história ainda não feita (uma rota, uma
    tela, um dado que ela cria): é observação, nunca reprovação.
    """
  end

  defp aberta(t),
    do:
      "#{Map.get(t, "title", "")} (#{Map.get(t, "status", "?")}, história: #{Map.get(t, "storyTitle", "?")})"

  defp corte(abertas, total) when total > length(abertas),
    do: "\n(mostrando #{length(abertas)} de #{total})"

  defp corte(_, _), do: ""

  defp irma(t), do: "#{Map.get(t, "title", "")} (#{Map.get(t, "status", "?")})"

  defp lista([]), do: "(nenhuma)"
  defp lista(itens), do: Enum.map_join(itens, "\n", &("- " <> to_string(&1)))
end
