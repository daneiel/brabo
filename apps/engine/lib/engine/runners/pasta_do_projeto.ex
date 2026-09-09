defmodule Engine.Runners.PastaDoProjeto do
  @moduledoc """
  A criação da pasta de um projeto na máquina do usuário (ADR 0151 pontos 3, 5
  e 6; RN-532): o PREDICADO próprio e o pedido `workspace_create` ao agente
  local conectado.

  ## Predicado PRÓPRIO, e por que não `RunnerReadiness` com uma flag

  `Engine.Runners.RunnerReadiness` fica **byte a byte como está** — este módulo
  não o chama, não o estende e não recebe nada dele. As TRÊS pré-condições dele
  (workspace confirmado, runner conectado, container REGISTRADO `running`)
  continuam sendo as do `exec` e do `RunnerGit`.

  Criar pasta tem DUAS: runner conectado, e base consentida.

  A tentação e a recusa são as mesmas de `Engine.Runners.Espelho`, e o ADR 0151
  ponto 5 adota a citação dele literalmente (`espelho.ex:19-24`):

  > A tentação óbvia seria `RunnerReadiness.verificar(project_id,
  > pular_container: true)`. O ADR 0147 recusa isso por escrito, e a razão é
  > mecânica: uma função compartilhada com flag "pula container" é precisamente
  > o caminho pelo qual a terceira pré-condição cai POR ACIDENTE para o `exec`
  > numa refatoração futura — e o ADR 0145 existe para ela não cair.

  E aqui a terceira seria pior que desnecessária: ela é **circular**. Um
  projeto `runner` só chega a ter container `running` REGISTRADO depois de o
  próprio runner o subir, e o container sobe sobre a pasta — que é justamente o
  que esta mensagem existe para criar. Exigir container antes de criar a pasta
  é exigir que a pasta já exista.

  ## O que ele NÃO pergunta

  - **`workspace_verified_at`** — ao contrário do espelho. Aqui ele é o
    RESULTADO, não a pré-condição: o `workspace_confirm` que o runner manda
    depois de criar é quem o carimba (ver "A confirmação", abaixo). Exigi-lo
    antes tornaria a mensagem inalcançável exatamente no caso para o qual ela
    foi feita — o projeto cuja pasta ainda não existe.
  - **o `execution_mode`** — pela mesma razão do espelho: a segunda fonte da
    mesma regra. Quem tem base consentida é o agente local, e só existe agente
    local nos modos em que ele existe.
  - **onde a base fica** — ela é LOCAL (RN-529) e nunca atravessa a rede. O que
    viaja é o SEGMENTO relativo, o invariante do ADR 0130/0144: quem tem a raiz
    é quem executa.

  ## As duas pré-condições, e ONDE cada uma é respondida

  A primeira (`runner conectado`) é respondida aqui, pelo `Registry` — é a
  única que este processo consegue responder sozinho.

  A segunda (`base consentida`) é respondida pela CONEXÃO, e chega como a
  capacidade `workspace` declarada no `join` (ADR 0151 ponto 4): o runner só a
  declara quando tem base. Ela vive em `socket.assigns` daquele canal e **nunca
  em tabela** — é a mesma razão do ADR 0147: capacidade é propriedade DAQUELA
  conexão, e uma tabela poderia afirmar que um runner sabe algo que o processo
  conectado agora não sabe.

  Por isso ela não é uma consulta e sim o próprio despacho: o canal recusa
  ANTES de empurrar e responde `motivo: :sem_base` pelo MESMO `ref`, no formato
  que este módulo já espera — nunca um timeout, que é como o defeito do
  Context do ADR 0147 apareceria. O módulo é o dono das DUAS: os dois motivos,
  as duas mensagens e a ordem em que se aplicam moram aqui, e em nenhum outro
  lugar.

  ## A confirmação REUSA `workspace_confirm` — nenhuma rota nova de gravação

  Tendo criado a pasta, o runner manda o `workspace_confirm` que existe desde a
  RN-423, e é ELE que grava: canal → engine → HTTP interno →
  `ConfirmProjectWorkspaceUseCase`, que revalida o léxico, é idempotente e
  carimba `workspace_verified_at`.

  Isto é deliberado (ADR 0151 ponto 3): o engine continua **não escrevendo a
  tabela**, e o único caminho que carimba `workspace_verified_at` continua
  sendo um só. `workspace_create_result` não grava nada — ele só destrava quem
  pediu.

  Registro de precisão, porque o nome circulou: **`workspace.verified` não
  existe** neste repositório. O que existe é o evento
  `project.workspace_verified` (emitido pela api) e a coluna
  `workspace_verified_at`.

  ## Não é `proposed_action`, e nenhum teto ganha exceção

  Criar a pasta do projeto que o usuário acabou de pedir é configuração
  CONSENTIDA, não um agente pedindo para agir — a mesma linha que o espelho já
  estabeleceu (RN-516). Fazê-la por comando de terminal cairia no escopo do ADR
  0055 e viraria fila de aprovações rotineiras, corroendo o teto que dá sentido
  ao clique. Nenhum teto de `decide.ts` é tocado, nem ganha chave de
  configuração.
  """

  require Logger

  alias Engine.Runners.{Registry, RunnerRouter}

  @type motivo :: :desconectado | :sem_base | :timeout | :recusado

  @doc """
  As DUAS pré-condições, na ordem: `:pronto` quando há um runner CONECTADO
  agora — e a segunda (base consentida) é respondida pela conexão, no despacho
  (ver o moduledoc).

  Separado de `criar/3` de propósito, pelo mesmo motivo de
  `Engine.Runners.Espelho.verificar/1`: quem quiser saber se vale a pena
  oferecer a operação pergunta sem disparar nada.
  """
  @spec verificar(String.t() | nil) :: :pronto | {:erro, motivo()}
  def verificar(project_id) when is_binary(project_id) do
    if Registry.connected?(project_id), do: :pronto, else: {:erro, :desconectado}
  end

  def verificar(_project_id_invalido), do: {:erro, :desconectado}

  @doc """
  Pede ao agente local a criação da pasta do projeto sob a BASE dele, a partir
  do `segmento` RELATIVO — nunca um caminho absoluto (ADR 0130/0144).

  `opts`:
  - `:repo_url` — sem ela o runner faz `git init`; com ela, `git clone`.
  - `:env` — credencial de git (ADR 0056), no mesmo mecanismo do `exec`
    (RN-507/ADR 0145). O clone roda no HOST, então este é o caminho que
    CARREGA credencial — a lacuna do `docker exec` (ADR 0130/0145) não o
    alcança.
  - `:timeout_ms` — o clone pode ser grande; o default é o do `RunnerRouter`.

  `{:ok, caminho}` com o caminho ABSOLUTO final (o mesmo que o
  `workspace_confirm` gravou logo antes), ou `{:erro, motivo, mensagem}`.
  NUNCA levanta: quem chama está atendendo um pedido do usuário, e uma falha
  aqui não pode virar 500 lá.
  """
  @spec criar(String.t() | nil, String.t(), keyword()) ::
          {:ok, String.t()} | {:erro, motivo(), String.t()}
  def criar(project_id, segmento, opts \\ [])

  def criar(project_id, segmento, opts) when is_binary(project_id) and is_binary(segmento) do
    case verificar(project_id) do
      :pronto -> despachar(project_id, segmento, opts)
      {:erro, motivo} -> recusar(project_id, motivo)
    end
  end

  def criar(project_id, _segmento_invalido, _opts) do
    recusar(project_id, :recusado)
  end

  defp despachar(project_id, segmento, opts) do
    payload = %{
      # `projectId` viaja no payload mesmo o canal já o conhecendo: é o que o
      # log do outro lado usa para dizer de QUAL projeto é a pasta que apareceu
      # no disco do usuário, e o ADR 0151 ponto 3 o nomeia no contrato.
      projectId: project_id,
      segmento: segmento
    }

    payload = por_opcao(payload, :repoUrl, Keyword.get(opts, :repo_url))
    payload = por_opcao(payload, :env, Keyword.get(opts, :env))

    resposta =
      case Keyword.get(opts, :timeout_ms) do
        nil -> RunnerRouter.create_workspace(project_id, payload)
        timeout_ms -> RunnerRouter.create_workspace(project_id, payload, timeout_ms)
      end

    case resposta do
      {:ok, %{"sucesso" => true, "caminho" => caminho}} when is_binary(caminho) ->
        {:ok, caminho}

      {:ok, %{"sucesso" => true}} ->
        # Sucesso SEM caminho é resposta que este servidor não entende, e ela
        # não vira sucesso por omissão (RN-088): sem o caminho não há o que
        # dizer a quem pediu, e o `workspace_confirm` — que é quem grava — pode
        # nem ter acontecido.
        {:erro, :recusado,
         "o brabo-runner respondeu sucesso sem informar o caminho criado — " <>
           "resposta fora do contrato de `workspace_create_result`."}

      {:ok, payload_de_falha} when is_map(payload_de_falha) ->
        {:erro, motivo_da_resposta(payload_de_falha), erro_da_resposta(payload_de_falha)}

      {:error, :not_connected} ->
        recusar(project_id, :desconectado)

      {:error, :timeout} ->
        recusar(project_id, :timeout)
    end
  end

  # `sem-base` é o ÚNICO motivo do runner que este servidor traduz para um
  # átomo próprio, e é porque ele tem conserto próprio (rodar o instalador,
  # ou passar `--base`). Os outros quatro (`segmento`, `nao-e-pasta`, `mkdir`,
  # `git`) são `:recusado` com a mensagem do runner: colapsá-los num átomo
  # cada só multiplicaria vocabulário sem mudar o que se pode fazer a
  # respeito, e a mensagem já os nomeia.
  defp motivo_da_resposta(%{"motivo" => "sem-base"}), do: :sem_base
  defp motivo_da_resposta(_), do: :recusado

  defp erro_da_resposta(%{"erro" => erro}) when is_binary(erro) and erro != "", do: erro
  defp erro_da_resposta(_), do: mensagem(:recusado)

  defp recusar(project_id, motivo) do
    Logger.debug(
      "workspace_create: o projeto #{inspect(project_id)} não criou pasta — #{mensagem(motivo)}"
    )

    {:erro, motivo, mensagem(motivo)}
  end

  # Campo opcional some do payload em vez de viajar como `null` — o mesmo
  # cuidado que `RunnerRouter.exec/5` já tem com `env`: um runner mais antigo
  # nunca recebe chave que não sabe interpretar.
  defp por_opcao(payload, _chave, nil), do: payload
  defp por_opcao(payload, chave, valor), do: Map.put(payload, chave, valor)

  @doc "Mensagem nomeada por motivo — nenhuma se disfarça de outra."
  @spec mensagem(motivo()) :: String.t()
  def mensagem(:desconectado),
    do: "nenhum brabo-runner está conectado a este projeto agora"

  def mensagem(:sem_base),
    do:
      "o brabo-runner conectado não declarou a capacidade `workspace` no join — " <>
        "ou o binário é anterior a esta versão, ou ele está rodando SEM base de " <>
        "projetos consentida (RN-529). Rode o instalador para consentir uma base, " <>
        "ou inicie o runner com --base <caminho>."

  def mensagem(:timeout),
    do:
      "o brabo-runner não respondeu ao pedido de criação da pasta a tempo — " <>
        "um clone grande pode levar mais que o teto; confira a máquina dele"

  def mensagem(:recusado),
    do: "o brabo-runner recusou criar a pasta do projeto"
end
