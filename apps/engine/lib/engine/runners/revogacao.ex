defmodule Engine.Runners.Revogacao do
  @moduledoc """
  Revogar uma credencial de dispositivo alcança a CONEXÃO VIVA (ADR 0147
  ponto 6, RN-520) — e, desde o ADR 0201 (RN-685), alcança SÓ as conexões
  daquela credencial.

  ## Os dois alvos, e quem usa cada um

  - `derrubar_credencial/4` — o alvo é a CREDENCIAL (a chave de dispositivo
    pelo `kid`, ou o PAT). É o que a revogação de chave e de PAT usa
    (`POST /internal/runner/disconnect-credential`). Outro runner do mesmo
    usuário, conectado com outra chave ou com PAT, fica de pé.
  - `derrubar/3` — o alvo é `{projeto, usuário}`, o desenho original da
    RN-520. Continua existindo porque tem um chamador cuja pergunta É essa: a
    remoção de membro de workspace (RN-615), que tira a PESSOA do projeto e
    precisa derrubar qualquer conexão dela ali, com a credencial que for.

  ## Como a credencial chega aqui

  A api diz, ao pedir o ticket, qual credencial o pediu
  (`Engine.Runners.SocketTicket`, colunas `credential_kind`/`credential_id`),
  o `connect/3` a põe em `socket.assigns.credencial`, e é o CANAL quem a
  compara — o mesmo molde de antes, só com outro termo de comparação. Até o
  ADR 0201 a identidade da credencial morria no `PatAuthGuard`, e o alvo por
  `{projeto, usuário}` era a precisão que existia, não uma escolha.

  ## Por que perguntar a TODOS os runners, e não aos projetos que a api lista

  A chave de MÁQUINA atende N projetos. A api sabe listar os candidatos, mas
  a lista pode não ter um projeto em que a conexão ainda vive (o papel do dono
  caiu, o modo foi convertido com o runner de pé). A pergunta certa é "quem
  nasceu desta credencial?", e só cada canal sabe a resposta — então a
  pergunta vai a todo runner registrado no cluster (`Registry.todos/0`). O
  custo é linear em runners conectados e só existe quando alguém revoga.

  ## Antes de derrubar, anular o que ainda não entrou

  `SocketTicket.anular_pendentes_da_credencial/1` roda PRIMEIRO: um ticket
  emitido segundos antes da revogação passaria no `connect/3` e no `join/3`
  depois dela, e a conexão nasceria de uma credencial morta. Era uma janela
  aberta também no alvo antigo; fechá-la só ficou possível com a coluna.

  ## O ticket LEGADO (sem credencial) durante o rollout

  Uma conexão aberta com ticket emitido por uma api anterior ao ADR 0201 não
  tem credencial em `assigns`. Para ela não deixar de cair — o que reabriria a
  RN-519 —, a api manda o dono e os projetos que a credencial alcança, e o
  canal SEM credencial daquele dono num desses projetos cai pelo par, como
  antes. É o único resto do alvo antigo, e some sozinho: a próxima reconexão
  já pede ticket novo, com credencial.

  ## Por que o canal decide, e não este módulo

  `Engine.Runners.Registry` entrega o pid, mas a credencial e o `user_id`
  daquela conexão vivem em `socket.assigns` — dentro do processo do canal,
  que é o único que pode lê-los. Daí a mensagem correlacionada por `ref` e a
  espera com teto, o MESMO molde de `Engine.Runners.RunnerRouter`.
  """

  alias Engine.Runners.{Registry, SocketTicket}

  # Teto curto de propósito: o canal só compara dois binários e responde. Um
  # `receive` sem `after` deixaria a revogação (que é 204 do outro lado)
  # pendurada num pid que travou.
  @timeout_ms 5_000

  @type desfecho :: :derrubado | :sem_runner | :de_outro_dono

  @type balanco :: %{
          derrubados: non_neg_integer(),
          legados: non_neg_integer(),
          intocados: non_neg_integer(),
          sem_resposta: non_neg_integer(),
          tickets_anulados: non_neg_integer()
        }

  @doc """
  Derruba a conexão do runner de `user_id` no projeto `project_id`, se houver
  — com a credencial que for. É o alvo da REMOÇÃO DE MEMBRO (RN-615), não o
  da revogação de credencial (ver `derrubar_credencial/4`).

  - `{:ok, :derrubado}` — havia runner DESSE usuário e ele caiu.
  - `{:ok, :sem_runner}` — não há runner conectado ao projeto. **Não é erro**.
  - `{:ok, :de_outro_dono}` — há runner, mas de outro usuário. Fica de pé.
  - `{:error, :timeout}` — o canal não respondeu a tempo.

  Nunca levanta. Quem chama é a api, num `DELETE` que é 204 e idempotente:
  telemetria e efeito colateral jamais derrubam o efeito principal (a MESMA
  régua de `rag_searches`/RN-479 e do `mirror_sync_result`/RN-517).
  """
  @spec derrubar(term(), term(), pos_integer()) :: {:ok, desfecho()} | {:error, :timeout}
  def derrubar(project_id, user_id, timeout_ms \\ @timeout_ms)

  def derrubar(project_id, user_id, timeout_ms)
      when is_binary(project_id) and is_binary(user_id) do
    case Registry.whereis(project_id) do
      nil ->
        {:ok, :sem_runner}

      pid ->
        ref = Ecto.UUID.generate()
        send(pid, {:derrubar_por_revogacao, ref, user_id, self()})

        receive do
          {:runner_derrubado, ^ref, desfecho} -> {:ok, desfecho}
        after
          timeout_ms -> {:error, :timeout}
        end
    end
  end

  def derrubar(_project_id, _user_id, _timeout_ms), do: {:ok, :sem_runner}

  @doc """
  Derruba TODA conexão de runner aberta com `credencial`
  (`%{kind: "device_key" | "pat", id: binary}`), em qualquer projeto, e anula
  os tickets dela que ainda não entraram (ADR 0201, RN-685).

  `user_id` e `projetos_legados` servem SÓ à conexão legada (ver moduledoc):
  um canal sem credencial em `assigns`, daquele dono, num daqueles projetos.

  Devolve `{:ok, balanco}` com as contagens — nunca erro: credencial fora de
  forma não mira nada (`tickets_anulados: 0`, nenhum runner perguntado), e
  canal que não respondeu no teto entra em `sem_resposta`. O teto é do
  CONJUNTO, não por canal, para a resposta da api não crescer com o número de
  runners.
  """
  @spec derrubar_credencial(term(), term(), term(), pos_integer()) :: {:ok, balanco()}
  def derrubar_credencial(credencial, user_id, projetos_legados, timeout_ms \\ @timeout_ms)

  def derrubar_credencial(%{kind: kind, id: id}, user_id, projetos_legados, timeout_ms) do
    case SocketTicket.credencial(kind, id) do
      nil ->
        {:ok, balanco_vazio()}

      credencial ->
        anulados = SocketTicket.anular_pendentes_da_credencial(credencial)

        legado = %{
          user_id: if(is_binary(user_id), do: user_id),
          projetos: projetos_legados |> List.wrap() |> Enum.filter(&is_binary/1) |> MapSet.new()
        }

        pids = Registry.todos()
        ref = Ecto.UUID.generate()

        Enum.each(pids, fn pid ->
          send(pid, {:derrubar_por_credencial, ref, credencial, legado, self()})
        end)

        prazo = System.monotonic_time(:millisecond) + timeout_ms

        balanco =
          Enum.reduce(pids, %{balanco_vazio() | tickets_anulados: anulados}, fn _pid, acc ->
            restante = max(prazo - System.monotonic_time(:millisecond), 0)

            receive do
              {:runner_derrubado, ^ref, :derrubado} ->
                Map.update!(acc, :derrubados, &(&1 + 1))

              {:runner_derrubado, ^ref, :derrubado_legado} ->
                Map.update!(acc, :legados, &(&1 + 1))

              {:runner_derrubado, ^ref, _intocado} ->
                Map.update!(acc, :intocados, &(&1 + 1))
            after
              restante -> Map.update!(acc, :sem_resposta, &(&1 + 1))
            end
          end)

        {:ok, balanco}
    end
  end

  def derrubar_credencial(_credencial, _user_id, _projetos_legados, _timeout_ms),
    do: {:ok, balanco_vazio()}

  defp balanco_vazio,
    do: %{derrubados: 0, legados: 0, intocados: 0, sem_resposta: 0, tickets_anulados: 0}
end
