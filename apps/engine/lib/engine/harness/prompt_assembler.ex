defmodule Engine.Harness.PromptAssembler do
  @moduledoc """
  Contrato do montador de prompt em camadas ordenadas com orçamento de tokens
  por camada e corte DETERMINÍSTICO. A implementação de referência é
  `Engine.Harness.PromptAssembler.Default` (pura, agnóstica à fonte de dados —
  quem coleta o conteúdo é o `Engine.Harness.ContextBuilder`).

  Uma CAMADA é um map:

    * blob:  `%{id: atom, kind: :blob, content: binary, cut: :truncate_tail |
      :keep_or_drop, budget: pos_integer (opcional)}`
    * units: `%{id: atom, kind: :units, units: [%{id: term, content: binary}],
      cut: :drop_whole_units, budget: pos_integer (opcional)}` — as unidades
      vêm em ORDEM DE DESCARTE (a cabeça é descartada primeiro).

  O `budget` de cada camada, se ausente, é resolvido dos defaults do módulo
  (sobrescrevíveis via `opts[:budgets]`). Contagem de tokens sempre pelo
  `Engine.Harness.Tokenizer` configurado (estimativa; camadas saem marcadas
  `estimated: true`).
  """

  @callback assemble(layers :: [map()], opts :: keyword()) :: map()

  @doc "Monta as camadas pelo assembler configurado (default: `.Default`)."
  def assemble(layers, opts \\ []), do: impl().assemble(layers, opts)

  defp impl do
    Application.get_env(
      :engine,
      :prompt_assembler,
      Engine.Harness.PromptAssembler.Default
    )
  end
end

defmodule Engine.Harness.PromptAssembler.Default do
  @moduledoc """
  Montagem determinística. Cada camada é medida contra seu orçamento; se
  estourar, corta pela estratégia declarada — sempre por UNIDADE INTEIRA
  quando a camada é `:units` (nunca trunca no meio de uma regra de negócio;
  descarta as mais antigas, que vêm na cabeça da lista). Estratégias:

    * `:drop_whole_units` (camadas `:units`) — descarta unidades inteiras da
      cabeça até caber; uma unidade sozinha maior que o orçamento é descartada
      inteira (camada pode ficar vazia), nunca partida.
    * `:truncate_tail` (blob) — mantém um prefixo dimensionado ao orçamento
      (respeitando UTF-8) + marcador `\\n[… truncado …]`.
    * `:keep_or_drop` (blob) — tudo-ou-nada: cabe mantém, não cabe descarta a
      camada inteira.

  Retorno: `%{layers: [relatorio_por_camada], total_tokens, estimated: true}`,
  onde cada relatório tem `%{id, kind, budget, tokens, estimated, cut_applied,
  dropped, rendered}`. `render/1` concatena os `rendered` não-vazios em branco
  duplo — a string de prompt final.
  """

  @behaviour Engine.Harness.PromptAssembler

  alias Engine.Harness.Tokenizer

  # Orçamentos padrão por camada (sobrescrevíveis via opts[:budgets]).
  # Números iniciais razoáveis; sem LLM ainda, servem só pra exercitar o
  # corte determinístico e dar visibilidade no debug.
  @default_budgets %{
    identidade: 500,
    instruction_files: 4000,
    contexto_projeto: 1500,
    regras_negocio: 6000,
    estado_tarefa: 2000
  }

  @fallback_budget 2000
  @truncation_marker "\n[… truncado …]"
  @unit_separator "\n\n"

  @impl true
  def assemble(layers, opts \\ []) do
    budget_overrides = Keyword.get(opts, :budgets, %{})
    reports = Enum.map(layers, &process_layer(&1, budget_overrides))

    %{
      layers: reports,
      total_tokens: Enum.sum(Enum.map(reports, & &1.tokens)),
      estimated: true
    }
  end

  @doc "Concatena os conteúdos renderizados não-vazios — o prompt final."
  def render(%{layers: reports}) do
    reports
    |> Enum.map(& &1.rendered)
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n\n")
  end

  @doc "Orçamento default de uma camada conhecida (ou o fallback)."
  def default_budget(id), do: Map.get(@default_budgets, id, @fallback_budget)

  defp process_layer(layer, budget_overrides) do
    id = Map.fetch!(layer, :id)
    kind = Map.fetch!(layer, :kind)
    budget = resolve_budget(id, layer, budget_overrides)

    {rendered, cut_applied, dropped} = cut(kind, layer, budget)

    %{
      id: id,
      kind: kind,
      budget: budget,
      tokens: Tokenizer.estimate(rendered),
      estimated: Tokenizer.estimated?(),
      cut_applied: cut_applied,
      dropped: dropped,
      rendered: rendered
    }
  end

  defp resolve_budget(id, layer, overrides) do
    Map.get(overrides, id) || Map.get(layer, :budget) || default_budget(id)
  end

  # --- units: descarte por unidade inteira, da cabeça (mais antigas) ---
  defp cut(:units, layer, budget) do
    units = Map.get(layer, :units, [])
    fit_units(units, budget, [])
  end

  # --- blob ---
  defp cut(:blob, layer, budget) do
    content = Map.get(layer, :content, "")
    strategy = Map.get(layer, :cut, :truncate_tail)

    cond do
      content == "" ->
        {"", :none, []}

      Tokenizer.estimate(content) <= budget ->
        {content, :none, []}

      strategy == :keep_or_drop ->
        {"", :dropped_layer, []}

      true ->
        {truncate_tail(content, budget), :truncated, []}
    end
  end

  # Tenta o conjunto inteiro; se não couber, descarta a unidade da cabeça
  # (mais antiga) e tenta de novo. Registra os ids descartados.
  defp fit_units(units, budget, dropped) do
    rendered = render_units(units)

    cond do
      units == [] ->
        {"", cut_flag(dropped), Enum.reverse(dropped)}

      Tokenizer.estimate(rendered) <= budget ->
        {rendered, cut_flag(dropped), Enum.reverse(dropped)}

      true ->
        [oldest | rest] = units
        fit_units(rest, budget, [oldest.id | dropped])
    end
  end

  defp cut_flag([]), do: :none
  defp cut_flag(_dropped), do: :dropped_units

  defp render_units(units) do
    units |> Enum.map(& &1.content) |> Enum.join(@unit_separator)
  end

  defp truncate_tail(content, budget) do
    marker_tokens = Tokenizer.estimate(@truncation_marker)
    body_budget = budget - marker_tokens

    if body_budget <= 0 do
      # Orçamento não cabe nem o marcador — corta pro marcador só.
      @truncation_marker
    else
      # estimate = ceil(bytes/4); body_budget*4 bytes garante estimate <=
      # body_budget, então o prefixo + marcador fica <= budget.
      prefix = safe_prefix(content, body_budget * 4)
      prefix <> @truncation_marker
    end
  end

  # Prefixo de até `max_bytes` bytes sem partir um codepoint UTF-8.
  defp safe_prefix(content, max_bytes) do
    n = min(max_bytes, byte_size(content))
    trim_to_valid(binary_part(content, 0, n))
  end

  defp trim_to_valid(bin) do
    if String.valid?(bin) do
      bin
    else
      # Remove o último byte (continuação UTF-8 incompleta) e tenta de novo.
      trim_to_valid(binary_part(bin, 0, byte_size(bin) - 1))
    end
  end
end
