defmodule Engine.Harness.Tools.ListarContratosDeModulos do
  @moduledoc """
  Ferramenta de LEITURA do dev agent (RN-164/165, ADR 0200, RN-684): o
  contrato entre módulos que o Arquiteto declarou — o que cada módulo expõe e
  de quem o SEU depende.

  Por que ela existe: o dev agent de um módulo que consome outro descobria a
  interface do vizinho abrindo o WORKTREE do dev daquele módulo (no uso real
  de 2026-09-29, 5 dos 24 passos com ferramenta de `dev-board-engine`). O que
  ele lia era código em andamento numa branch que ainda não tinha chegado à
  `dev` — e que podia mudar depois da leitura. O contrato é a versão que o
  Arquiteto fixou, e mudá-lo é versão nova DELE.

  `:direct` — LER não é efeito externo. CONTIDA (ADR 0060): escopo fechado no
  projeto pelo caminho da rota, NENHUM parâmetro (o módulo do dev vem do
  contexto do laço, `ctx.module`, nunca do modelo), e teto de itens com o
  total real dito quando corta. Com o módulo conhecido, ela mostra por inteiro
  só o que é dele, o que ele consome e quem o consome; os demais aparecem só
  pelo nome.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  # Teto de itens renderizados no texto. Cada módulo já tem teto de 40 na api;
  # este é o do conjunto, para um mapa grande não encher o contexto do dev.
  @max_itens 120

  @impl true
  def spec do
    %{
      name: "listar_contratos_de_modulos",
      description: descricao(),
      parameters: %{"type" => "object", "properties" => %{}, "required" => []}
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(_args, ctx) do
    case EngineApiClient.list_module_contracts(ctx.project_id) do
      {:ok, %{"modulos" => modulos} = corpo} when is_list(modulos) ->
        {:ok, renderizar(corpo, modulos, Map.get(ctx, :module))}

      {:ok, outro} ->
        {:error, "resposta inesperada ao listar contratos de módulos: #{inspect(outro)}"}

      {:error, reason} ->
        {:error, "falha ao listar contratos de módulos: #{inspect(reason)}"}
    end
  end

  # --- Renderização ---

  @sem_contrato """
  Sem contrato, a interface desse módulo NÃO está fixada. Não a deduza do
  worktree de outro dev agent: aquilo é código em andamento, que pode mudar
  antes de chegar à `dev`. Implemente pelo que a story e a task dizem; se a
  task depende de uma interface que não existe, use `report_blocked` nomeando
  o módulo e o que falta, para o Arquiteto declarar o contrato.
  """

  defp renderizar(corpo, modulos, meu) do
    versao = Map.get(corpo, "version", 0)
    declarados? = Map.get(corpo, "status") == "declarados"

    cabecalho =
      if declarados?,
        do: "Contrato entre módulos — versão #{versao}, declarada pelo Arquiteto.",
        else: "Nenhum contrato entre módulos foi declarado pelo Arquiteto neste projeto."

    {corpo_texto, mostrados} =
      case Enum.find(modulos, &(Map.get(&1, "modulo") == meu)) do
        nil ->
          {todos(modulos), modulos}

        meu_modulo ->
          {relevantes(meu_modulo, modulos), [meu_modulo | consumidos(meu_modulo, modulos)]}
      end

    fora =
      case Map.get(corpo, "contratosForaDoMapa", []) do
        [] ->
          ""

        nomes ->
          "\n\n(Há contrato de módulo(s) que o module_map vigente não tem mais: #{Enum.join(nomes, ", ")}.)"
      end

    # O aviso vale para o projeto sem contrato nenhum E para o módulo mostrado
    # por inteiro que ficou sem contrato numa versão que declarou outros.
    sem_contrato? = not declarados? or Enum.any?(mostrados, &is_nil(Map.get(&1, "expoe")))
    rodape = if sem_contrato? and modulos != [], do: "\n\n" <> @sem_contrato, else: ""

    "#{cabecalho}\n\n#{corpo_texto}#{fora}#{rodape}" |> String.trim_trailing()
  end

  # Módulo do dev conhecido: o dele e o que ele consome, por inteiro; quem o
  # consome e os demais, só pelo nome.
  defp relevantes(meu, modulos) do
    nome = Map.get(meu, "modulo")
    deps = Map.get(meu, "dependeDe", [])
    consumidos = consumidos(meu, modulos)

    consumidores = modulos |> Enum.filter(&(nome in Map.get(&1, "dependeDe", []))) |> nomes()

    outros =
      modulos
      |> Enum.reject(&(Map.get(&1, "modulo") in [nome | deps]))
      |> Enum.reject(&(nome in Map.get(&1, "dependeDe", [])))
      |> nomes()

    {blocos, restante} = blocos([meu | consumidos], @max_itens)

    [
      "O SEU módulo é \"#{nome}\". Ele consome: #{lista_ou_nenhum(deps)}.",
      blocos,
      corte(restante),
      if(consumidores != [],
        do:
          "Consomem o SEU módulo (não quebre o que você expõe a eles): #{Enum.join(consumidores, ", ")}."
      ),
      if(outros != [],
        do:
          "Outros módulos, que você não consome (contrato não mostrado): #{Enum.join(outros, ", ")}."
      )
    ]
    |> Enum.reject(&(&1 in [nil, ""]))
    |> Enum.join("\n\n")
  end

  defp consumidos(meu, modulos) do
    por_nome = Map.new(modulos, &{Map.get(&1, "modulo"), &1})

    meu
    |> Map.get("dependeDe", [])
    |> Enum.map(&Map.get(por_nome, &1, %{"modulo" => &1, "expoe" => nil}))
  end

  defp todos([]), do: "O projeto não tem module_map vigente."

  defp todos(modulos) do
    {blocos, restante} = blocos(modulos, @max_itens)
    "#{length(modulos)} módulo(s) no module_map vigente.\n\n#{blocos}#{prefixo(corte(restante))}"
  end

  # Renderiza módulo a módulo até o teto de itens; devolve o que sobrou.
  defp blocos(modulos, teto) do
    {textos, restante, _} =
      Enum.reduce(modulos, {[], 0, teto}, fn m, {acc, sobra, livre} ->
        itens = Map.get(m, "expoe") || []
        mostrados = Enum.take(itens, max(livre, 0))
        cortados = length(itens) - length(mostrados)
        {[bloco(m, mostrados) | acc], sobra + cortados, livre - length(mostrados)}
      end)

    {textos |> Enum.reverse() |> Enum.join("\n\n"), restante}
  end

  defp bloco(m, mostrados) do
    nome = Map.get(m, "modulo")
    deps = Map.get(m, "dependeDe", [])
    consome = if deps == [], do: "", else: " (consome: #{Enum.join(deps, ", ")})"

    case Map.get(m, "expoe") do
      nil ->
        "## #{nome}#{consome}\n(sem contrato declarado — veja o aviso abaixo)"

      _ ->
        linhas = Enum.map_join(mostrados, "\n", &item/1)
        "## #{nome}#{consome} expõe:\n#{linhas}"
    end
  end

  defp item(i) do
    descricao =
      case Map.get(i, "descricao") do
        d when is_binary(d) and d != "" -> " — #{d}"
        _ -> ""
      end

    "- [#{Map.get(i, "tipo")}] #{Map.get(i, "assinatura")}#{descricao}"
  end

  defp corte(0), do: ""

  defp corte(n),
    do:
      "(+ #{n} item(ns) de contrato não mostrado(s) pelo teto de #{@max_itens} — o contrato real tem mais)"

  defp prefixo(""), do: ""
  defp prefixo(t), do: "\n\n" <> t

  defp nomes(modulos), do: Enum.map(modulos, &Map.get(&1, "modulo"))

  defp lista_ou_nenhum([]), do: "nenhum outro módulo"
  defp lista_ou_nenhum(deps), do: Enum.join(deps, ", ")

  defp descricao do
    """
    Lista o CONTRATO entre módulos que o Arquiteto declarou: o que cada módulo
    expõe (função, rota, evento, forma de dado, com a assinatura) e de quais
    módulos o SEU depende. Não recebe parâmetro nenhum.

    Use SEMPRE que precisar chamar, importar ou integrar com outro módulo, em
    vez de abrir o worktree ou o código de outro dev agent — aquilo é trabalho
    em andamento, o contrato é o que vale.
    """
  end
end
