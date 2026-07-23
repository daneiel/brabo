FROM hexpm/elixir:1.17.3-erlang-27.1.2-alpine-3.20.3

RUN apk add --no-cache build-base inotify-tools

WORKDIR /workspace/apps/engine

CMD ["sh", "-c", "mix local.hex --force && mix local.rebar --force && mix deps.get && mix ecto.create && mix ecto.migrate && mix phx.server"]
