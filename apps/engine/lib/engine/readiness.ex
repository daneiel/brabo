defmodule Engine.Readiness do
  @moduledoc """
  Sinal explícito de "o boot terminou de reidratar" (Fase 5).

  Antes disto a garantia existia, mas só implicitamente: os dois reidratadores
  ficam ANTES do `EngineWeb.Endpoint` na árvore de supervisão
  (`Engine.Application`), e `Supervisor.start_link/2` é sequencial — quando o
  Endpoint aceita a primeira conexão, a reidratação já acabou por construção.

  Isso basta para o Docker, onde o container só existe depois do boot inteiro.
  Não basta para Kubernetes: o readiness probe precisa DISTINGUIR "ainda
  reidratando" de "pronto", e o único jeito de distinguir sem um sinal
  observável seria a porta não estar aberta — o que o kubelet lê como
  `Connection refused`, indistinguível de pod morto. Além disso, "readiness só
  depois da reidratação" vira afirmação testável em vez de propriedade
  emergente da ordem da árvore, que qualquer reordenação futura quebraria em
  silêncio.

  `:persistent_term` e não ETS porque a leitura acontece em toda probe (a cada
  poucos segundos, para sempre) e nunca há escrita depois do boot: são
  exatamente duas escritas por nó, no boot. É o caso de uso canônico.
  """

  @stages [:sessions, :dev_agents]

  @doc "Marca um estágio de reidratação como concluído."
  def mark(stage) when stage in @stages do
    :persistent_term.put(key(stage), true)
    :ok
  end

  @doc """
  Marca o nó como em desligamento (Fase 5, item 4).

  A partir daqui `/ready` responde 503 e o kubelet tira o pod dos Endpoints do
  Service — é assim que se para de receber tráfego NOVO sem derrubar o que já
  está em andamento. É o primeiro passo do `Engine.Shutdown.drain/0`, e vem
  antes de tudo de propósito: drenar sessões enquanto o Service ainda manda
  sessão nova para cá seria enxugar gelo.
  """
  def begin_shutdown do
    :persistent_term.put(key(:shutting_down), true)
    :ok
  end

  @doc "Verdadeiro depois de `begin_shutdown/0`."
  def shutting_down?, do: :persistent_term.get(key(:shutting_down), false)

  @doc """
  Verdadeiro só quando TODOS os estágios de reidratação terminaram E o nó não
  está desligando.

  Um estágio que nunca rodou é indistinguível de um que ainda está rodando, e
  ambos significam a mesma coisa para o probe: não pronto.
  """
  def ready? do
    not shutting_down?() and Enum.all?(@stages, &:persistent_term.get(key(&1), false))
  end

  @doc "O que falta para ficar pronto — é o que o /ready reporta quando nega."
  def pending do
    if shutting_down?() do
      [:shutting_down]
    else
      Enum.reject(@stages, &:persistent_term.get(key(&1), false))
    end
  end

  @doc "Só para teste: devolve o nó ao estado pré-reidratação."
  def reset do
    Enum.each([:shutting_down | @stages], &:persistent_term.erase(key(&1)))
    :ok
  end

  defp key(stage), do: {__MODULE__, stage}
end
