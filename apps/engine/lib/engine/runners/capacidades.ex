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

  ## As quatro capacidades

  - `exec` — comando já aprovado, o par `exec`/`exec_result` (ADR 0104);
  - `pty` — terminal interativo, os eventos `pty_*` (ADR 0103);
  - `espelho` — copiar o trabalho para uma pasta fora da base montada
    (`mirror_sync`, ADR 0147 ponto 2, RN-516);
  - `workspace` — criar a pasta de um projeto sob a BASE local do agente
    (`workspace_create`, ADR 0151 ponto 3, RN-532).

  `espelho` nasceu aqui como nome do vocabulário e nada mais (RN-514) — e a
  aposta se pagou: quando a capacidade passou a existir de verdade no binário
  (RN-516), o formato do `join` não mudou uma vírgula. O que mudou foi só
  QUEM a exige.

  `workspace` NÃO repetiu essa aposta, e o ADR 0151 ponto 4 diz por quê: ela
  entra no vocabulário **na sessão em que o código entra**, dos dois lados. A
  lição da RN-514 é que declarar o que não se implementa é exatamente o defeito
  silencioso que a negociação existe para impedir; um nome no servidor sem o
  código do outro lado é a mesma aposta feita de novo, e ela só se pagou uma
  vez porque alguém a cobrou.

  ## `workspace` é o que o servidor SABE sobre a base do agente

  Ela é a única das quatro cuja declaração depende do ESTADO daquela execução,
  e não só da versão do binário: o runner só a declara quando tem uma BASE
  consentida (RN-529, `capacidadesDoRunner` em `channel.ts`). O engine não lê o
  disco do usuário e não tem tabela de bases — então "há base consentida"
  chega por esta linha e por mais nenhuma, e é ela que responde a segunda
  pré-condição de `Engine.Runners.PastaDoProjeto`.

  Ninguém a EXIGE (ela não está em `@exigidas_por_modo` e não vem de dado do
  projeto): um runner sem base continua conectando e atendendo normalmente o
  projeto dele. O que ele não recebe é `workspace_create` — recusado com
  resposta NOMEADA, nunca entregue a um handler que não existe.

  ## Quem exige `espelho`: o DESTINO, não o modo (RN-516)

  As outras duas exigências vêm do `execution_mode`. Esta vem de um DADO do
  projeto — `projects.mirror_path` (RN-515): destino declarado exige a
  capacidade, destino nulo não exige nada. É a diferença entre "este modo
  precisa disto para funcionar" e "o usuário pediu isto neste projeto", e por
  isso ela não cabia no mapa por modo.

  A consequência está declarada no ADR 0147: um runner velho conectado a um
  projeto que exige `espelho` deixa de conectar, com recusa NOMEADA. É
  opt-in — só acontece onde alguém configurou um destino — e é o primeiro
  caso REAL do mecanismo de recusa que a RN-514 deixou implementado e sem
  nenhum disparo.

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
  @conhecidas ~w(espelho exec pty workspace)

  # O que um binário que não declara nada sabe fazer, por construção.
  #
  # `workspace` NUNCA entra aqui, e por um motivo mais forte que a idade do
  # binário: ela depende de haver uma BASE consentida naquela execução, e um
  # binário mudo não tem como ter consentido base nenhuma (o mecanismo nasceu
  # depois dele). Concedê-la por omissão seria o servidor AFIRMANDO uma base
  # que não existe.
  @legado ~w(exec pty)

  # O que cada `execution_mode` EXIGE do runner conectado. `container` e
  # `mounted` não exigem nada: o runner nem é o caminho de execução deles
  # (quem sobe e executa é o broker, ADR 0130/0144). `runner` exige `exec`
  # porque é literalmente o que faz o modo funcionar — sem ele, o
  # `TerminalExecutor` rotearia comando aprovado para um binário que não o
  # executa, e a falha apareceria como timeout, não como recusa.
  #
  # `espelho` NÃO entra neste mapa, em modo nenhum: quem o exige é o DESTINO
  # (`projects.mirror_path`), que é dado do projeto e não do modo — ver
  # `exigidas/2`. `mounted` e `runner` podem ter destino; `container` não pode
  # (a api recusa, RN-515), então o mapa por modo nunca acertaria os dois.
  #
  # `workspace` também não entra, e por outro motivo (ADR 0151 ponto 4): exigi-la
  # em `runner` faria todo runner SEM base consentida deixar de conectar — o que
  # é `breaking/` e MAJOR — para uma função que aquele projeto talvez nunca
  # use. Ela é opt-in pela outra ponta: quem tem base declara, e só quem
  # declarou recebe `workspace_create`.
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
  O que o projeto EXIGE — o `execution_mode` e, desde a RN-516, o DESTINO do
  espelho (`projects.mirror_path`).

  `nil` nos dois argumentos (projeto que não existe, id malformado, consulta
  que falhou, projeto sem espelho) exige NADA — "não sei qual é o modo" nunca
  vira recusa, pela mesma régua da RN-088: o produto não colapsa "não sei"
  com "não tem". Destino em branco é tratado como ausente pelo mesmo motivo:
  uma string vazia no banco não é um destino, é uma linha malformada, e
  recusar o join por causa dela deixaria o projeto inalcançável sem dizer o
  porquê certo.

  `mirror_path` tem default `nil` para o chamador que só sabe do modo (o
  teste do vocabulário, e qualquer código anterior à RN-516) continuar
  perguntando a mesma coisa que sempre perguntou.
  """
  @spec exigidas(String.t() | nil, String.t() | nil) :: MapSet.t(capacidade())
  def exigidas(execution_mode, mirror_path \\ nil) do
    por_modo = Map.get(@exigidas_por_modo, execution_mode, [])
    por_destino = if destino?(mirror_path), do: ["espelho"], else: []

    MapSet.new(por_modo ++ por_destino)
  end

  @doc """
  `true` só para um destino de espelho de VERDADE — string não-vazia depois
  de aparada. Único lugar onde esta pergunta é respondida do lado engine.
  """
  @spec destino?(String.t() | nil | any()) :: boolean()
  def destino?(mirror_path) when is_binary(mirror_path), do: String.trim(mirror_path) != ""
  def destino?(_), do: false

  @doc """
  A decisão do `join`: `{:ok, concedidas}` com o conjunto que vive em
  `socket.assigns`, ou `{:error, faltando}` com a LISTA ordenada das
  capacidades exigidas que o runner não declarou.
  """
  @spec conceder(map() | any(), String.t() | nil, String.t() | nil) ::
          {:ok, MapSet.t(capacidade())} | {:error, [capacidade()]}
  def conceder(params, execution_mode, mirror_path \\ nil) do
    declaradas = declaradas(params)

    faltando =
      execution_mode
      |> exigidas(mirror_path)
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
