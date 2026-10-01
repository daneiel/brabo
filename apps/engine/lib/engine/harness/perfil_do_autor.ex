defmodule Engine.Harness.PerfilDoAutor do
  @moduledoc """
  Os FATOS do perfil de quem escreveu a mensagem, no turno que ela sobe
  (RN-680, ADR 0196) — hipóteses do Psicólogo que a PRÓPRIA pessoa aceitou
  neste projeto, lidas pela api no grafo (`QueryUserContextUseCase`, escopado
  ao projeto e com teto) e mandadas no comando `agent/message` como
  `perfilDoAutor`, já em texto.

  Segue o MESMO caminho do idioma da resposta (`Engine.Harness.IdiomaDaResposta`,
  RN-622), e por isso não toca servidor de agente nenhum:

  - o controller junta `idiomaDaResposta` e `perfilDoAutor` num mapa
    `%{idioma: _, perfil: _}` quando há perfil; sem perfil, manda só o idioma,
    como sempre;
  - o servidor repassa o valor a `IdiomaDaResposta.com_idioma_do_autor/2`, que
    reconhece o mapa e chama `com_perfil/2` — o texto entra no dicionário do
    processo durante o `handle_call` e chega à Task do turno pela herança de
    `Engine.Agents.TurnoAssincrono`;
  - a fachada `Engine.Sessions.EngineApiClient` (`llm_turn/5`,
    `llm_turn_stream/6`) acrescenta o texto como mensagem `system` EFÊMERA,
    ANTES da orientação de idioma (que é sempre a última) — nunca em
    `state.messages`, então não vai para o histórico nem se acumula.

  Turno SEM autor (kickoff, dev agents, gates) não tem perfil: não há pessoa
  com quem o agente está conversando. O sumarizador da compactação
  (`context-manager`) fica fora, como no idioma.

  Teto: `teto_de_caracteres/0`, o mesmo `TETO_DO_TEXTO` da api
  (`apps/api/src/domain/graph/perfil-do-autor.ts`). A api já corta ali; o
  corte daqui é a segunda barreira. Valor que não é texto vira ausência —
  nunca derruba o turno.
  """

  @chave :brabo_perfil_do_autor
  @teto 2000
  @sem_perfil ["context-manager"]

  @doc "O teto em caracteres do texto acrescentado (o mesmo da api)."
  def teto_de_caracteres, do: @teto

  @doc """
  Roda `fun` com o perfil do autor no dicionário do processo, e o RESTAURA ao
  sair — o GenServer do agente sobrevive ao turno, e o próximo turno não pode
  herdar o perfil de quem falou antes.
  """
  def com_perfil(perfil, fun) when is_function(fun, 0) do
    anterior = Process.get(@chave)

    case normalizar(perfil) do
      nil -> Process.delete(@chave)
      texto -> Process.put(@chave, texto)
    end

    try do
      fun.()
    after
      if anterior, do: Process.put(@chave, anterior), else: Process.delete(@chave)
    end
  end

  @doc """
  A lista de mensagens com o perfil acrescentado no FIM, ou intacta quando o
  turno não tem perfil (ou o agente é o `context-manager`).
  """
  @spec anexar([map()], String.t()) :: [map()]
  def anexar(messages, agent) when is_list(messages) and agent in @sem_perfil, do: messages

  def anexar(messages, _agent) when is_list(messages) do
    case Process.get(@chave) do
      texto when is_binary(texto) and texto != "" ->
        messages ++ [%{"role" => "system", "content" => texto}]

      _ ->
        messages
    end
  end

  def anexar(messages, _agent), do: messages

  defp normalizar(texto) when is_binary(texto) and texto != "" do
    if String.length(texto) > @teto, do: String.slice(texto, 0, @teto - 1) <> "…", else: texto
  end

  defp normalizar(_), do: nil
end
