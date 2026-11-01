defmodule Engine.Dev.TetoDaTarefa do
  @moduledoc """
  O teto EFETIVO de gasto de uma tarefa do dev agent (AT-433, RN-774) — o ponto
  ÚNICO onde ele é resolvido.

  A primeira tarefa de um módulo monta o esqueleto inteiro (manifesto, app,
  banco, testes) e custa mais que as seguintes: no TP-01 de 08/10 ela gastou
  US$ 0,53 contra o teto fixo de US$ 0,50 e foi bloqueada. Decisão do dono
  (09/10): ela ganha `@multiplicador_da_primeira` vezes o teto por tarefa; as
  demais seguem o teto configurado.

  "Primeira" é o que a api diz em `task.primeiraDoModulo` no contexto da tarefa
  (`ehPrimeiraTarefaDoModulo`): o `backlog.task_claimed` mais antigo do projeto
  para aquele módulo é desta tarefa. Ausente (contexto sem módulo, api antiga)
  vale o teto normal.
  """

  # Constante nomeada, não configuração (decisão do dono).
  @multiplicador_da_primeira 2

  @doc "O multiplicador da primeira tarefa do módulo."
  @spec multiplicador_da_primeira() :: pos_integer()
  def multiplicador_da_primeira, do: @multiplicador_da_primeira

  @doc """
  Teto efetivo para `task`, a partir do teto por tarefa `base`. `nil` (sem
  teto) continua `nil`.
  """
  @spec efetivo(integer() | nil, map()) :: integer() | nil
  def efetivo(nil, _task), do: nil

  def efetivo(base, task) when is_integer(base) do
    if primeira?(task), do: base * @multiplicador_da_primeira, else: base
  end

  @doc "A tarefa (mapa da api, ou o booleano já resolvido) é a primeira do módulo?"
  @spec primeira?(term()) :: boolean()
  def primeira?(primeira) when is_boolean(primeira), do: primeira
  def primeira?(task) when is_map(task), do: Map.get(task, "primeiraDoModulo") == true
  def primeira?(_), do: false

  @doc "O texto do teto que valeu, para o diagnóstico do bloqueio por orçamento."
  @spec descrever(integer(), term()) :: String.t()
  def descrever(teto, task) do
    usd = :erlang.float_to_binary(teto / 1_000_000, decimals: 2)

    if primeira?(task),
      do: "teto da primeira tarefa do módulo: #{teto} micro-USD, US$ #{usd}",
      else: "teto: #{teto} micro-USD, US$ #{usd}"
  end
end
