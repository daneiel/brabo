defmodule Engine.Runners.Capacidades do
  @moduledoc """
  O vocabulário de CAPACIDADES do agente local (ADR 0147, ponto 1) e as três
  perguntas que o `join` do canal `terminal:<projectId>` passa a fazer:
  o que o runner DECLARA saber fazer, o que o `execution_mode` do projeto
  EXIGE, e o que o servidor CONCEDE àquela conexão.

  ## Por que existe

  Até aqui o `join` era mudo dos dois lados — o runner mandava params vazios
  (`socket.channel("terminal:" <> id, {})`) e o servidor os ignorava
  (`def join("terminal:" <> project_id, _params, socket)`). Um agente local
  que ganha função nova sem negociá-la degrada da PIOR forma possível: a
  mensagem chega, o handler não existe do outro lado, e nada acontece — sem
  erro, sem log, sem ninguém saber que a função nunca rodou.

  ## As três capacidades

  - `exec` — comando já aprovado, o par `exec`/`exec_result` (ADR 0104);
  - `pty` — terminal interativo, os eventos `pty_*` (ADR 0103);
  - `espelho` — copiar o trabalho para uma pasta fora da base montada.

  `espelho` está aqui como **nome do vocabulário e nada mais**: nenhum runner
  o declara, nenhum modo o exige, e não há mensagem de espelho no protocolo.
  Quem o implementa é a sessão 6 da FASE 28. Ele nasce nomeado porque o
  vocabulário é do SERVIDOR: um nome que o servidor conhece hoje é um nome
  que ele pode exigir amanhã sem quebrar o formato do `join`.

  ## Ausência de params é o LEGADO, e isso é fato — não benevolência

  Todo binário anterior a esta mudança manda params vazios, e todo binário
  anterior a esta mudança sabe fazer `exec` (ADR 0104) e `pty` (ADR 0103) —
  são as duas funções com que o runner nasceu. Conceder `{exec, pty}` a quem
  não declara nada não é presumir o melhor sobre um desconhecido: é ler
  corretamente a única coisa que aquele binário poderia ter dito.

  O contrário — recusar quem não declara — faria todo runner instalado parar
  de conectar, que é mudança exigindo ação do operador ANTES do deploy (a
  convenção do repositório manda isso nascer em `breaking/` e subir MAJOR).

  ## Desconhecido é IGNORADO, nunca motivo de recusa

  Um runner mais NOVO que o engine tem que conseguir conectar. Por isso o
  conjunto concedido é a interseção do que ele declarou com o que ESTE
  servidor conhece: nome que não está em `conhecidas/0` some do conjunto e
  não vira erro. Só a falta de uma capacidade EXIGIDA recusa o join.

  ## Isto não é fronteira de segurança

  Capacidade é negociação de PROTOCOLO — quem autoriza continua sendo o
  ticket de uso único (RN-108) e o pipeline de `proposed_action`. Um runner
  pode declarar o que quiser; o que ele ganha declarando é que mensagens
  daquele tipo lhe sejam ENTREGUES, nunca permissão para nada.
  """

  # O vocabulário que ESTE servidor conhece. Ordem alfabética: ela é a ordem
  # em que a mensagem de recusa nomeia o que falta.
  @conhecidas ~w(espelho exec pty)

  # O que um binário que não declara nada sabe fazer, por construção.
  @legado ~w(exec pty)

  # O que cada `execution_mode` EXIGE do runner conectado. `container` e
  # `mounted` não exigem nada: o runner nem é o caminho de execução deles
  # (quem sobe e executa é o broker, ADR 0130/0144). `runner` exige `exec`
  # porque é literalmente o que faz o modo funcionar — sem ele, o
  # `TerminalExecutor` rotearia comando aprovado para um binário que não o
  # executa, e a falha apareceria como timeout, não como recusa.
  #
  # NADA exige `espelho` ainda. O mecanismo de recusa nasce implementado e
  # testado aqui; quem passa a exigir é a sessão 6 da FASE 28.
  @exigidas_por_modo %{"runner" => ["exec"]}

  @type capacidade :: String.t()

  @doc "As capacidades que ESTE servidor conhece (ordem alfabética)."
  @spec conhecidas() :: [capacidade()]
  def conhecidas, do: @conhecidas

  @doc "O conjunto que um binário sem declaração sabe fazer — `exec` e `pty`."
  @spec legado() :: [capacidade()]
  def legado, do: @legado

  @doc """
  O que o runner declarou nos params do `join`, já filtrado pelo vocabulário
  conhecido.

  Params ausentes, `capacidades` ausente, lista VAZIA ou valor que não é
  lista caem todos no LEGADO — são todas as formas que "este binário não sabe
  declarar nada" assume no caminho de rede.

  Lista NÃO-vazia é declaração de verdade e é respeitada como está: um runner
  que declara só `["pty"]` fica sem `exec`, mesmo que o resultado seja um
  conjunto vazio depois do filtro (declarar só nomes que este servidor não
  conhece é dizer "não faço nada que você conheça", não "não declarei").
  """
  @spec declaradas(map() | any()) :: MapSet.t(capacidade())
  def declaradas(params) when is_map(params) do
    case Map.get(params, "capacidades") do
      [_ | _] = lista ->
        lista
        |> Enum.filter(&(is_binary(&1) and &1 in @conhecidas))
        |> MapSet.new()

      _ ->
        MapSet.new(@legado)
    end
  end

  def declaradas(_params_nao_mapa), do: MapSet.new(@legado)

  @doc """
  O que o `execution_mode` do projeto EXIGE. `nil` (projeto que não existe,
  id malformado, consulta que falhou) exige NADA — "não sei qual é o modo"
  nunca vira recusa, pela mesma régua da RN-088: o produto não colapsa "não
  sei" com "não tem".
  """
  @spec exigidas(String.t() | nil) :: MapSet.t(capacidade())
  def exigidas(execution_mode) do
    @exigidas_por_modo
    |> Map.get(execution_mode, [])
    |> MapSet.new()
  end

  @doc """
  A decisão do `join`: `{:ok, concedidas}` com o conjunto que vive em
  `socket.assigns`, ou `{:error, faltando}` com a LISTA ordenada das
  capacidades exigidas que o runner não declarou.
  """
  @spec conceder(map() | any(), String.t() | nil) ::
          {:ok, MapSet.t(capacidade())} | {:error, [capacidade()]}
  def conceder(params, execution_mode) do
    declaradas = declaradas(params)

    faltando =
      execution_mode
      |> exigidas()
      |> MapSet.difference(declaradas)
      |> Enum.sort()

    if faltando == [] do
      {:ok, declaradas}
    else
      {:error, faltando}
    end
  end

  @doc """
  A mensagem da recusa — NOMEIA a capacidade que falta e diz o que fazer.
  "Recusado" sem o nome do que falta obrigaria o usuário a adivinhar qual das
  três, e a recusa é fatal do lado do runner (sem retry): ela é a única
  chance de explicar.
  """
  @spec mensagem_de_recusa([capacidade()]) :: String.t()
  def mensagem_de_recusa(faltando) do
    nomes = faltando |> Enum.map(&"`#{&1}`") |> Enum.join(", ")

    "este projeto exige a(s) capacidade(s) #{nomes}, que o brabo-runner " <>
      "conectado não declarou no join — o binário está desatualizado. " <>
      "Atualize-o (`npm install -g @brabo/runner`) e rode de novo."
  end

  @doc """
  A mensagem de uma MENSAGEM recusada por falta de capacidade concedida —
  distinta de `mensagem_de_recusa/1`, que fala do `join`.

  Ela existe porque o defeito que o ADR 0147 nomeia no Context é justamente
  este: a mensagem chega, o handler não existe do outro lado, e nada
  acontece. Com a capacidade negociada, o servidor SABE de antemão que a
  entrega não faria efeito — e dizer isso a quem pediu é o valor que a
  negociação entrega hoje, antes de qualquer capacidade nova existir.
  """
  @spec mensagem_de_capacidade_ausente(capacidade(), String.t()) :: String.t()
  def mensagem_de_capacidade_ausente(capacidade, evento) do
    "o brabo-runner conectado não declarou a capacidade `#{capacidade}` " <>
      "quando entrou no canal, então `#{evento}` NÃO foi entregue a ele — " <>
      "atualize o binário (`npm install -g @brabo/runner`) e conecte de novo."
  end
end
