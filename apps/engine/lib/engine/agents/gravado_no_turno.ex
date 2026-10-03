defmodule Engine.Agents.GravadoNoTurno do
  @moduledoc """
  O que as ferramentas de ESCRITA gravaram de verdade num turno de agente
  conversacional (RN-731, AT-414).

  O modelo fechava o turno com "Registrei as 8 regras de negócio" quando o
  painel tinha 6: o número do fecho era texto livre, nunca fato. Este módulo
  conta só os resultados `{:ok, _}` do PRÓPRIO turno, no dicionário do
  processo do turno (o mesmo de `Engine.Agents.TextoDoTurno`), e
  `TextoDoTurno.payload_do_turno/2` acrescenta ao fecho a linha factual
  "Gravado neste turno: …" — sem reescrever uma palavra do modelo. Turno sem
  escrita não ganha linha nenhuma.

  A linha sai no idioma do turno (RN-622, `IdiomaDaResposta.idioma_do_turno/1`:
  o do autor, senão o do projeto): `pt*` em português, qualquer outro — ou
  nenhum — em inglês.
  """

  alias Engine.Harness.IdiomaDaResposta

  @chave {__MODULE__, :contagem}
  @chave_projeto {__MODULE__, :projeto}

  # Ordem fixa da linha; a chave é o que se conta. {singular, plural} por idioma.
  @rotulos [
    {:regra, {"regra de negócio", "regras de negócio"}, {"business rule", "business rules"}},
    {:decisao, {"decisão", "decisões"}, {"decision", "decisions"}},
    {:epico, {"épico", "épicos"}, {"epic", "epics"}},
    {:historia, {"história", "histórias"}, {"story", "stories"}},
    {:historia_corrigida, {"história corrigida", "histórias corrigidas"},
     {"story corrected", "stories corrected"}},
    {:historia_arquivada, {"história arquivada", "histórias arquivadas"},
     {"story archived", "stories archived"}},
    {:tarefa, {"tarefa", "tarefas"}, {"task", "tasks"}},
    {:nota, {"nota", "notas"}, {"note", "notes"}},
    {:artefato, {"outro artefato", "outros artefatos"}, {"other artifact", "other artifacts"}}
  ]

  @doc "Anota o desfecho de uma ferramenta. Só `{:ok, _}` de escrita conta."
  @spec anotar(String.t() | nil, map() | nil, term(), String.t() | nil) :: :ok
  def anotar(tool, args, resultado, project_id \\ nil)

  def anotar(tool, args, {:ok, _}, project_id) do
    case classe(tool, args || %{}) do
      nil ->
        :ok

      c ->
        if project_id, do: Process.put(@chave_projeto, project_id)
        Process.put(@chave, Map.update(Process.get(@chave, %{}), c, 1, &(&1 + 1)))
        :ok
    end
  end

  def anotar(_tool, _args, _resultado, _project_id), do: :ok

  @doc """
  Devolve a linha factual do turno (ou `nil`) e esvazia a contagem. Sem
  `idioma`, usa o do turno.
  """
  @spec descarregar(String.t() | nil) :: String.t() | nil
  def descarregar(idioma \\ nil) do
    project_id = Process.delete(@chave_projeto)
    contagem = Process.delete(@chave) || %{}

    if contagem == %{} do
      nil
    else
      pt? = portugues?(idioma || IdiomaDaResposta.idioma_do_turno(project_id))

      partes =
        for {c, rot_pt, rot_en} <- @rotulos, n = Map.get(contagem, c), n do
          {um, varios} = if pt?, do: rot_pt, else: rot_en
          "#{n} #{if n == 1, do: um, else: varios}"
        end

      prefixo = if pt?, do: "Gravado neste turno: ", else: "Recorded this turn: "
      prefixo <> Enum.join(partes, ", ") <> "."
    end
  end

  defp portugues?(idioma) when is_binary(idioma),
    do: idioma |> String.downcase() |> String.starts_with?("pt")

  defp portugues?(_), do: false

  defp classe("emit_artifact", %{"type" => "business_rule"}), do: :regra
  defp classe("emit_artifact", %{"type" => "decision_record"}), do: :decisao
  defp classe("emit_artifact", %{"type" => "note"}), do: :nota
  defp classe("emit_artifact", _), do: :artefato
  defp classe("create_epic", _), do: :epico
  defp classe("create_story", _), do: :historia
  defp classe("update_story", _), do: :historia_corrigida
  defp classe("archive_story", _), do: :historia_arquivada
  defp classe("create_task", _), do: :tarefa
  defp classe(_, _), do: nil
end
