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
  """

  @chave {__MODULE__, :contagem}

  # Ordem fixa da linha; a chave é o que se conta.
  @rotulos [
    {:regra, "regra de negócio", "regras de negócio"},
    {:decisao, "decisão", "decisões"},
    {:epico, "épico", "épicos"},
    {:historia, "história", "histórias"},
    {:historia_corrigida, "história corrigida", "histórias corrigidas"},
    {:historia_arquivada, "história arquivada", "histórias arquivadas"},
    {:tarefa, "tarefa", "tarefas"},
    {:nota, "nota", "notas"},
    {:artefato, "outro artefato", "outros artefatos"}
  ]

  @doc "Anota o desfecho de uma ferramenta. Só `{:ok, _}` de escrita conta."
  @spec anotar(String.t() | nil, map() | nil, term()) :: :ok
  def anotar(tool, args, {:ok, _}) do
    case classe(tool, args || %{}) do
      nil ->
        :ok

      c ->
        Process.put(@chave, Map.update(Process.get(@chave, %{}), c, 1, &(&1 + 1)))
        :ok
    end
  end

  def anotar(_tool, _args, _resultado), do: :ok

  @doc "Devolve a linha factual do turno (ou `nil`) e esvazia a contagem."
  @spec descarregar() :: String.t() | nil
  def descarregar do
    contagem = Process.delete(@chave) || %{}

    partes =
      for {c, um, varios} <- @rotulos, n = Map.get(contagem, c), n do
        "#{n} #{if n == 1, do: um, else: varios}"
      end

    if partes == [], do: nil, else: "Gravado neste turno: " <> Enum.join(partes, ", ") <> "."
  end

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
