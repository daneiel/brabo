defmodule Engine.Runners.Revogacao do
  @moduledoc """
  Revogar uma credencial de dispositivo passa a alcançar a CONEXÃO VIVA
  (ADR 0147 ponto 6, RN-520).

  Até aqui, `DELETE /projects/:projectId/runner-device-keys/:deviceKeyId`
  só impedia ticket NOVO: um `brabo-runner` já conectado seguia com o canal
  `terminal:<projectId>` de pé, executando comando aprovado, até cair
  sozinho. Este módulo é a outra metade — a api manda o comando
  (`POST /internal/projects/:projectId/runner/disconnect`), e é o ENGINE
  quem alcança o pid, porque só ele enxerga o canal.

  ## A precisão possível, e a que NÃO existe

  O alvo é `{projeto, usuário}`, nunca `{chave}`. E isso é uma propriedade do
  caminho do ticket, não uma escolha de gosto: `Engine.Runners.SocketTicket`
  guarda `project_id`, `user_id` e `kind` — e só. A api pede o ticket com
  `{userId, kind}` (`ApiToEngineClient.requestRunnerTicket/3`), então a
  identidade da CREDENCIAL que originou o ticket (o PAT ou o `kid` da chave
  de dispositivo) morre no `PatAuthGuard` e nunca chega ao socket. Levá-la
  até aqui exigiria coluna nova em `runner_socket_tickets`, campo novo no
  pedido interno e um assign novo no `connect/3` — mudança de contrato de
  auth, não desta entrega.

  O custo fica DECLARADO em vez de disfarçado: um runner conectado com PAT,
  ou com OUTRA chave do mesmo usuário no mesmo projeto, também cai. Ele
  reconecta sozinho — a rodada seguinte pede um ticket novo, e a credencial
  que ainda vale ganha um. Quem foi revogado não ganha, e é aí que a
  revogação morde.

  Runner de OUTRO usuário no mesmo projeto NÃO cai: `derrubar/2` compara
  `socket.assigns.user_id` antes de derrubar, e responde `:de_outro_dono`.

  ## Por que o canal decide, e não este módulo

  `Engine.Runners.Registry.whereis/1` entrega o pid, mas o `user_id` daquela
  conexão vive em `socket.assigns` — dentro do processo do canal, que é o
  único que pode lê-lo. Daí a mensagem correlacionada por `ref` e a espera
  bloqueada, o MESMO molde de `Engine.Runners.RunnerRouter`: quem sabe
  responde, quem perguntou espera com teto.
  """

  alias Engine.Runners.Registry

  # Teto curto de propósito: o canal só compara dois binários e responde. Um
  # `receive` sem `after` deixaria a revogação (que é 204 do outro lado)
  # pendurada num pid que travou.
  @timeout_ms 5_000

  @type desfecho :: :derrubado | :sem_runner | :de_outro_dono

  @doc """
  Derruba a conexão do runner de `user_id` no projeto `project_id`, se houver.

  - `{:ok, :derrubado}` — havia runner DESSE usuário e ele caiu.
  - `{:ok, :sem_runner}` — não há runner conectado ao projeto. **Não é erro**:
    é o caso normal de quem revoga uma chave órfã (RN-519).
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
end
