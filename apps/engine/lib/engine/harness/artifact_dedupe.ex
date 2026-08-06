defmodule Engine.Harness.ArtifactDedupe do
  @moduledoc """
  Comparação de títulos de artefato para detectar duplicata EXATA.

  O escopo é deliberadamente estreito, e vale dizer o que ele NÃO é: isto
  não sabe se duas regras significam a mesma coisa. "Saudação com nome" e
  "Quem chama pode se identificar" continuam passando como distintas — e
  passariam, porque decidir isso é julgamento, não `if`.

  O que ele pega é o caso mecânico, que é o que o achado K registrou:
  rodar o Criativo de novo no mesmo projeto e ele reemitir as MESMAS
  regras, palavra por palavra. Duplicata assim não precisa de modelo para
  ser vista, e deixá-la passar polui a rastreabilidade regra→história.

  Normalizar é o mínimo para "palavra por palavra" não virar
  "byte por byte": caixa, acento e espaço em excesso variam entre turnos
  do modelo sem que o texto mude de sentido.
  """

  @doc """
  Forma canônica de um título: minúsculas, sem acento, sem espaço
  redundante.

  Acento sai porque o modelo alterna "Saudação"/"Saudacao" entre turnos;
  pontuação FICA, porque removê-la começaria a colapsar títulos que a
  pessoa escreveu diferentes de propósito.
  """
  @spec normalizar(String.t()) :: String.t()
  def normalizar(titulo) when is_binary(titulo) do
    titulo
    |> String.downcase()
    |> :unicode.characters_to_nfd_binary()
    # \p{Mn} = marca combinante (o acento já separado pelo NFD).
    |> String.replace(~r/\p{Mn}/u, "")
    |> String.replace(~r/\s+/u, " ")
    |> String.trim()
  end

  def normalizar(_), do: ""

  @doc """
  O título já existe na lista? Devolve o título ORIGINAL do que já
  existia — a mensagem de erro precisa mostrar ao modelo o texto como ele
  foi gravado, não a forma canônica, senão ele tenta "corrigir" um
  fantasma.
  """
  @spec duplicata(String.t(), [String.t()]) :: String.t() | nil
  def duplicata(titulo, existentes) when is_binary(titulo) and is_list(existentes) do
    alvo = normalizar(titulo)

    if alvo == "" do
      nil
    else
      Enum.find(existentes, fn existente -> normalizar(existente) == alvo end)
    end
  end
end
