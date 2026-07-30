defmodule Engine.Telemetry.PrettyLogFormatter do
  @moduledoc """
  Formatter de log legível para desenvolvimento (ADR 0035).

  Antes, `config/dev.exs` reduzia o formato a `"[$level] $message\\n"`, jogando
  fora timestamp **e** toda a metadata. O efeito era que `trace_id`, `session_id`
  e `mfa` — que o formatter de produção sempre soube emitir — eram invisíveis
  justamente no ambiente onde se lê log com os olhos. Correlacionar api e engine
  em dev era impossível não porque o dado não existia, mas porque ninguém o
  imprimia.

  Lê os mesmos campos do `JsonLogFormatter`, via `Engine.Telemetry.LogFields`, e
  os organiza para leitura humana:

      22:41:03.184 info  sessão adotada por este nó
                         trace=af994cbb session=01JEVHYP mfa=Engine.Sessions.Adopter.adotar/1

  ## Nunca levanta

  Mesma disciplina do formatter de produção: isto roda DENTRO do logger, e uma
  exceção aqui perde a linha e pode recursar tentando logar a própria falha. O
  `rescue` devolve uma linha mínima em vez de deixar propagar.

  ## Cor só quando há terminal

  `IO.ANSI.enabled?/0` é falso quando a saída é redirecionada, então
  `docker compose logs` e arquivo não recebem escape nenhum — mesma escolha do
  `pino-pretty` do lado da api, que deixa o `colorize` no default.
  """

  alias Engine.Telemetry.LogFields

  @largura_nivel 5

  def format(event, _config) do
    campos = LogFields.build(event)

    [
      linha_principal(campos),
      contexto(campos),
      "\n"
    ]
  rescue
    e -> ["[erro] falha ao formatar log: #{inspect(e)}\n"]
  end

  defp linha_principal(campos) do
    hora = hora_curta(campos["time"])
    nivel = campos["level"]

    [
      colorir(hora, :faint),
      " ",
      colorir(String.pad_trailing(nivel, @largura_nivel), cor_do_nivel(nivel)),
      " ",
      campos["message"] || ""
    ]
  end

  # Os identificadores vão numa segunda linha, indentada: eles importam quando se
  # está caçando algo, e atrapalham quando se está só acompanhando o fluxo.
  # Juntá-los à mensagem empurraria o texto para fora da tela.
  defp contexto(campos) do
    partes =
      [
        {"trace", encurtar(campos["trace_id"])},
        {"session", encurtar(campos["session_id"])},
        {"req", encurtar(campos["request_id"])},
        {"layer", campos["layer"]},
        {"mfa", campos["mfa"]},
        {"path", campos["path"]}
      ]
      |> Enum.reject(fn {_rotulo, valor} -> valor in [nil, ""] end)
      |> Enum.map(fn {rotulo, valor} -> "#{rotulo}=#{valor}" end)

    case partes do
      [] -> []
      _ -> ["\n", colorir("      " <> Enum.join(partes, " "), :faint)]
    end
  end

  # `2026-07-30T01:41:03.184Z` -> `22:41:03.184`, em hora local, que é o que se
  # compara com o relógio da parede ao reproduzir um problema.
  defp hora_curta(iso) when is_binary(iso) do
    case DateTime.from_iso8601(iso) do
      {:ok, dt, _} ->
        dt
        |> DateTime.shift_zone!(horario_local())
        |> Calendar.strftime("%H:%M:%S")
        |> Kernel.<>(milissegundos(dt))

      _ ->
        iso
    end
  rescue
    _ -> iso
  end

  defp hora_curta(_), do: ""

  defp milissegundos(%DateTime{microsecond: {micro, _}}) do
    "." <> (micro |> div(1000) |> Integer.to_string() |> String.pad_leading(3, "0"))
  end

  defp milissegundos(_), do: ""

  # `Etc/UTC` sem banco de timezone instalado; com um, respeita o TZ do sistema.
  defp horario_local do
    case Calendar.get_time_zone_database() do
      Calendar.UTCOnlyTimeZoneDatabase -> "Etc/UTC"
      _ -> System.get_env("TZ") || "Etc/UTC"
    end
  end

  # Id de 32 hex inteiro não cabe e não ajuda a ler; os 8 primeiros bastam para
  # reconhecer e para casar com a linha do outro serviço. Quem for colar no
  # Grafana pega o id inteiro do log de produção.
  defp encurtar(valor) when is_binary(valor) and byte_size(valor) > 8,
    do: binary_part(valor, 0, 8)

  defp encurtar(valor), do: valor

  defp cor_do_nivel("error"), do: :red
  defp cor_do_nivel("warning"), do: :yellow
  defp cor_do_nivel("warn"), do: :yellow
  defp cor_do_nivel("info"), do: :green
  defp cor_do_nivel("debug"), do: :cyan
  defp cor_do_nivel(_), do: :normal

  defp colorir(texto, cor) do
    if IO.ANSI.enabled?() do
      [apply(IO.ANSI, cor, []), texto, IO.ANSI.reset()]
    else
      texto
    end
  end
end
