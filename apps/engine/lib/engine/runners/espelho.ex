defmodule Engine.Runners.Espelho do
  @moduledoc """
  O espelho do lado engine (ADR 0147 pontos 3, 4 e 8; RN-516): o PREDICADO
  próprio do espelho e o empurrão de `mirror_sync` para o runner conectado,
  em momentos NOMEADOS.

  ## Predicado PRÓPRIO, e por que não `RunnerReadiness` com uma flag

  `Engine.Runners.RunnerReadiness` fica **byte a byte como está** — este
  módulo não o chama, não o estende e não recebe nada dele. As TRÊS
  pré-condições dele (workspace confirmado, runner conectado, container
  REGISTRADO `running`) continuam sendo as do `exec` e do `RunnerGit`, e a
  terceira continua sendo a que a RN-507 acrescentou.

  O espelho tem DUAS: workspace confirmado e runner conectado. Mais um dado,
  que não é pré-condição de máquina nenhuma e sim de configuração — o DESTINO
  (`projects.mirror_path`, RN-515) —, e sem ele não há nada a fazer.

  A tentação óbvia seria `RunnerReadiness.verificar(project_id, pular_container:
  true)`. O ADR 0147 recusa isso por escrito, e a razão é mecânica: uma função
  compartilhada com flag "pula container" é precisamente o caminho pelo qual a
  terceira pré-condição cai POR ACIDENTE para o `exec` numa refatoração
  futura — e o ADR 0145 existe para ela não cair (sem container `running`, o
  comando caía no HOST puro do usuário, em silêncio).

  E o espelho legitimamente não precisa dela. A terceira existe porque havia
  DUAS execuções possíveis e a errada era invisível; aqui não há ambiguidade
  nenhuma: é cópia de arquivo na máquina do usuário, por definição, sem
  container de onde cair. Exigir Docker seria importar uma pré-condição sem o
  defeito que a justifica — e o custo seria real, porque o espelho é
  justamente a capacidade que deve funcionar para quem não quer Docker.

  Note também o que ele NÃO pergunta: o `execution_mode`. Quem já decidiu
  isso foi a api ao gravar o destino (RN-515 recusa `container`), e repetir a
  decisão aqui seria a segunda fonte da mesma regra.

  ## Momento NOMEADO, nunca watcher

  `sincronizar/2` é chamada de um ponto do código que tem um NOME — hoje o
  commit (`EngineWeb.ActionCommandController`). Nunca `fs.watch` do outro
  lado: watcher é trabalho ilimitado disparado por qualquer coisa, inclusive
  pelas escritas do próprio espelho, que é laço; e rodaria continuamente na
  máquina do usuário sem ninguém ter pedido, que é o oposto do que "agente
  local" deve significar.

  ## Fire-and-forget, de propósito

  O `send/2` não espera resposta, ao contrário de `Engine.Runners.RunnerRouter`
  (que bloqueia em `receive` porque a api espera o resultado do comando de
  forma síncrona). Duas razões: quem dispara o espelho está no meio de OUTRA
  coisa — um commit que já terminou —, e o resultado da sincronização é
  telemetria de conexão (última sync, contagem, último erro), que é o ponto 7
  do ADR e é entrega de outra sessão. Inventar aqui um `mirror_sync_result`
  seria escolher o formato dela sem a decisão que ela precisa.

  Isto NÃO é `proposed_action` e não deve virar uma. A escrita do espelho é
  configuração que o usuário declarou, não um agente pedindo para agir — e
  sincronizar por comando de terminal cairia no escopo do ADR 0055 e viraria
  fila de aprovações rotineiras, corroendo o teto que dá sentido ao clique.
  """

  require Logger

  alias Engine.Projects.Project
  alias Engine.Runners.{Capacidades, Registry}

  @type motivo :: :sem_destino | :nao_verificado | :desconectado

  @doc """
  `{:pronto, destino}` só quando o projeto tem destino de espelho declarado,
  o workspace foi CONFIRMADO (`workspace_verified_at` não-nulo) e há um runner
  CONECTADO agora. `{:erro, motivo}` para a PRIMEIRA pré-condição que faltar,
  sempre na mesma ordem.

  Projeto que não existe, id malformado ou consulta que falhou caem em
  `{:erro, :sem_destino}` — nunca `:pronto` por omissão. `rescue`/`catch` pelo
  MESMO motivo de `Engine.Projects.Project.workspace_dir_name/1`: id fora de
  forma de UUID levanta `Ecto.Query.CastError`, e chamar isto de um processo
  sem conexão do Sandbox levanta `DBConnection.OwnershipError`.
  """
  @spec verificar(String.t()) :: {:pronto, String.t()} | {:erro, motivo()}
  def verificar(project_id) do
    case Project.get(project_id) do
      %{mirror_path: destino, workspace_verified_at: verificado} ->
        cond do
          not Capacidades.destino?(destino) -> {:erro, :sem_destino}
          is_nil(verificado) -> {:erro, :nao_verificado}
          not Registry.connected?(project_id) -> {:erro, :desconectado}
          true -> {:pronto, String.trim(destino)}
        end

      _ ->
        {:erro, :sem_destino}
    end
  rescue
    _ -> {:erro, :sem_destino}
  catch
    _, _ -> {:erro, :sem_destino}
  end

  @doc """
  O destino declarado do projeto, ou `nil`. Lido pelo `join` do canal para
  compor a concessão — separado de `verificar/1` de propósito: no `join` as
  outras duas pré-condições ainda não fazem sentido (é a própria conexão que
  está nascendo, e `workspace_confirm` só chega DEPOIS dela).
  """
  @spec destino(String.t()) :: String.t() | nil
  def destino(project_id) do
    case Project.get(project_id) do
      %{mirror_path: caminho} ->
        if Capacidades.destino?(caminho), do: String.trim(caminho), else: nil

      _ ->
        nil
    end
  rescue
    _ -> nil
  catch
    _, _ -> nil
  end

  @doc """
  Empurra UMA rodada de espelho ao runner conectado, no `momento` nomeado
  (uma string curta, só rastro para o log do outro lado — `"commit"` hoje).

  `:ok` quando a mensagem foi entregue ao canal; `{:erro, motivo}` quando uma
  pré-condição faltou. Nunca levanta: quem chama está no meio de outra coisa
  (o desfecho de um commit), e uma falha aqui não pode virar 500 lá.

  O `destino` viaja na mensagem para o runner CONFERIR contra o que foi
  concedido no join daquela conexão (ADR 0147 ponto 4) — nunca para ser
  obedecido às cegas. Destino trocado entre o join e agora é recusado do outro
  lado, e a correção é reconectar o runner: a concessão é do join.
  """
  @spec sincronizar(String.t() | nil, String.t()) :: :ok | {:erro, motivo()}
  def sincronizar(project_id, momento) when is_binary(project_id) do
    case verificar(project_id) do
      {:pronto, destino} ->
        case Registry.whereis(project_id) do
          nil ->
            {:erro, :desconectado}

          pid ->
            send(pid, {:dispatch_mirror_sync, Ecto.UUID.generate(), destino, momento})
            :ok
        end

      {:erro, motivo} ->
        # `debug` e não `warning`: "este projeto não tem espelho" é o caso
        # NORMAL e majoritário, e ele passa por aqui em todo commit do
        # produto. Um `warning` por commit ensinaria a ignorar o log.
        Logger.debug(
          "espelho: #{momento} não sincronizou o projeto #{project_id} — #{mensagem(motivo)}"
        )

        {:erro, motivo}
    end
  end

  def sincronizar(_project_id_invalido, _momento), do: {:erro, :sem_destino}

  @doc "Mensagem nomeada por motivo — nenhuma delas vira erro para o usuário hoje, só log."
  @spec mensagem(motivo()) :: String.t()
  def mensagem(:sem_destino),
    do: "o projeto não tem destino de espelho declarado (o normal, RN-515)"

  def mensagem(:nao_verificado),
    do: "o workspace do projeto ainda não foi confirmado por nenhum runner (RN-423)"

  def mensagem(:desconectado),
    do: "nenhum brabo-runner está conectado a este projeto agora"
end
