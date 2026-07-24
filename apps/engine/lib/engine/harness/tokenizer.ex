defmodule Engine.Harness.Tokenizer do
  @moduledoc """
  Contagem APROXIMADA de tokens, local, sem provider de LLM. Trocável em
  teste/produção via `Application.get_env(:engine, :tokenizer, ...Approximate)`
  — mesmo padrão de `Engine.Actions.RtkDetector`. Todo resultado é uma
  ESTIMATIVA (`estimated?/0` = true); quem consome (PromptAssembler) marca as
  camadas como `estimated: true`. Um tokenizer real pode ser plugado depois
  sem tocar no resto do harness.
  """

  @callback estimate(text :: binary()) :: non_neg_integer()
  @callback estimated?() :: boolean()

  @doc "Estimativa de tokens do texto, pelo tokenizer configurado."
  def estimate(text), do: impl().estimate(text)

  @doc "Se o tokenizer configurado é aproximado (sempre true por ora)."
  def estimated?, do: impl().estimated?()

  defp impl do
    Application.get_env(:engine, :tokenizer, Engine.Harness.Tokenizer.Approximate)
  end
end

defmodule Engine.Harness.Tokenizer.Approximate do
  @moduledoc """
  Estimativa por bytes/4 com teto — mesma heurística já usada em
  `Engine.Actions.TerminalExecutor` (`@bytes_per_token 4`). Barata,
  determinística, sem dependência externa. Não pretende ser exata; é o piso
  bom o suficiente pra orçamento de camadas antes de haver LLM.
  """

  @behaviour Engine.Harness.Tokenizer

  @bytes_per_token 4

  @impl true
  def estimate(text) when is_binary(text) do
    case byte_size(text) do
      0 -> 0
      bytes -> div(bytes + @bytes_per_token - 1, @bytes_per_token)
    end
  end

  @impl true
  def estimated?, do: true
end
