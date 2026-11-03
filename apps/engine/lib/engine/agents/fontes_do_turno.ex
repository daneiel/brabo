defmodule Engine.Agents.FontesDoTurno do
  @moduledoc """
  As FONTES de uma resposta (AT-716, RN-982): as leituras `ok` do PRÓPRIO
  turno, registradas pelo servidor, nunca pelo texto do modelo. Irmão de
  `Engine.Agents.GravadoNoTurno` (RN-731): `anotar/4` é chamado nos mesmos
  pontos, acumula no dicionário do processo do turno, e `descarregar/0` entrega
  a lista ao fecho (`TextoDoTurno.payload_do_turno/2` e o `ToolLoop`), FORA do
  `content`. É o que foi CONSULTADO, não o que foi USADO.

  Cada fonte: `%{tipo, rotulo, ref?, searchId?, chunkId?}`. Teto de 10; ao
  cortar, `fontesTotal` diz o total real (ADR 0060). Falha não é fonte.
  """

  @chave {__MODULE__, :fontes}
  @chave_hits {__MODULE__, :hits_rag}
  @teto 10

  @tipos %{
    "listar_regras_de_negocio" => "regra",
    "listar_backlog" => "backlog",
    "read_backlog" => "backlog",
    "listar_metricas_de_produto" => "metricas",
    "listar_adrs_propostas" => "adr",
    "listar_contratos_de_modulos" => "contratos",
    "read_file" => "arquivo"
  }

  @doc "Chamado por `rag_search` com os hits estruturados da busca."
  @spec guardar_hits_rag(String.t() | nil, [map()]) :: :ok
  def guardar_hits_rag(search_id, hits) do
    Process.put(@chave_hits, {search_id, hits})
    :ok
  end

  @doc "Anota o desfecho de uma ferramenta. Só `{:ok, _}` de leitura conta."
  @spec anotar(String.t() | nil, map() | nil, term(), String.t() | nil) :: :ok
  def anotar(tool, args, resultado, project_id \\ nil)

  def anotar("rag_search", _args, {:ok, _}, _project_id) do
    case Process.delete(@chave_hits) do
      {search_id, hits} -> Enum.each(hits, &somar(fonte_rag(&1, search_id)))
      _ -> :ok
    end

    :ok
  end

  def anotar("rag_search", _args, _resultado, _project_id) do
    Process.delete(@chave_hits)
    :ok
  end

  def anotar(tool, args, {:ok, _}, _project_id) when is_map_key(@tipos, tool) do
    tipo = Map.fetch!(@tipos, tool)
    ref = if tipo == "arquivo", do: Map.get(args || %{}, "path")
    somar(compacto(%{tipo: tipo, rotulo: ref || tool, ref: ref}))
  end

  def anotar(_tool, _args, _resultado, _project_id), do: :ok

  @doc "Lê as fontes acumuladas (até o teto) SEM esvaziar; é o que a citação numera."
  @spec ver() :: [map()]
  def ver, do: @chave |> Process.get([]) |> Enum.reverse() |> Enum.take(@teto)

  @doc "Devolve `%{fontes: [...], fontesTotal?: n}` (ou `%{}`) e esvazia."
  @spec descarregar() :: map()
  def descarregar do
    Process.delete(@chave_hits)

    case Enum.reverse(Process.delete(@chave) || []) do
      [] ->
        %{}

      todas ->
        base = %{fontes: Enum.take(todas, @teto)}
        if length(todas) > @teto, do: Map.put(base, :fontesTotal, length(todas)), else: base
    end
  end

  defp fonte_rag(hit, search_id) do
    path = Map.get(hit, "path") || "?"

    compacto(%{
      tipo: "rag",
      rotulo: path,
      ref: path,
      searchId: search_id,
      chunkId: Map.get(hit, "chunkId")
    })
  end

  defp compacto(mapa), do: :maps.filter(fn _, v -> v != nil end, mapa)

  defp somar(fonte) do
    atual = Process.get(@chave, [])
    unless fonte in atual, do: Process.put(@chave, [fonte | atual])
    :ok
  end
end
