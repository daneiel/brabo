defmodule Engine.Harness.IdDoBacklog do
  @moduledoc """
  Resolve o id de história/tarefa que um agente passa a uma ferramenta (RN-721).

  O modelo copia o id das listagens e às vezes o ENCURTA (os 8 primeiros
  caracteres), e a api recusa com 400 "must be a UUID" — o Arquiteto desistia
  de ligar módulos às histórias. Aqui um PREFIXO de no mínimo 8 hex é
  resolvido para o UUID dentro do backlog do PROJETO; prefixo ambíguo ou
  inexistente vira recusa NOMEADA, que volta ao modelo como entrada do laço.
  UUID completo passa sem consulta.
  """

  alias Engine.Sessions.EngineApiClient

  @uuid ~r/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/i
  @prefixo ~r/\A[0-9a-f]{8}[0-9a-f-]*\z/i

  @type tipo :: :historia | :tarefa

  @spec resolver(String.t(), tipo(), term()) :: {:ok, String.t()} | {:error, String.t()}
  def resolver(project_id, tipo, id) when is_binary(id) do
    cond do
      Regex.match?(@uuid, id) ->
        {:ok, id}

      Regex.match?(@prefixo, id) ->
        case EngineApiClient.list_backlog(project_id) do
          {:ok, epicos} when is_list(epicos) -> resolver_em(ids(epicos, tipo), tipo, id)
          outro -> {:error, "não consegui ler o backlog para resolver #{id}: #{inspect(outro)}"}
        end

      # Nem UUID nem prefixo de 8+ hex: segue como veio, e quem recusa é a
      # api, com a frase dela — esta peça só resolve, nunca inventa régua.
      true ->
        {:ok, id}
    end
  end

  def resolver(_project_id, _tipo, id), do: {:ok, id}

  @doc "Resolução pura de um prefixo contra a lista de ids conhecidos."
  @spec resolver_em([String.t()], tipo(), String.t()) :: {:ok, String.t()} | {:error, String.t()}
  def resolver_em(ids, tipo, prefixo) do
    p = String.downcase(prefixo)

    case Enum.filter(ids, &(is_binary(&1) and String.starts_with?(String.downcase(&1), p))) do
      [unico] ->
        {:ok, unico}

      [] ->
        {:error,
         "nenhuma #{nome(tipo)} do projeto tem id começando com #{prefixo}. " <>
           "Releia o backlog e use o id completo."}

      varios ->
        {:error,
         "o prefixo #{prefixo} é ambíguo: #{length(varios)} #{nome(tipo)}s " <>
           "do projeto começam com ele. Use o id completo."}
    end
  end

  defp ids(epicos, :historia), do: Enum.map(historias(epicos), &Map.get(&1, "id"))

  defp ids(epicos, :tarefa),
    do:
      historias(epicos)
      |> Enum.flat_map(&Map.get(&1, "tasks", []))
      |> Enum.map(&Map.get(&1, "id"))

  defp historias(epicos), do: Enum.flat_map(epicos, &Map.get(&1, "stories", []))

  defp nome(:historia), do: "história"
  defp nome(:tarefa), do: "tarefa"
end
