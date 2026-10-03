# 0209 — O engine sobe para Elixir 1.20.4 / OTP 29.1.1

## Status

**Accepted.** 2026-10-02 (AT-398; decisão do dono em 02/10, "subir o engine
para OTP 29.1.x"). Troca o runtime fixado no
[ADR 0024](0024-fase5-imagens-producao-ci.md) (decisão 10: a mesma versão de
Elixir nos Dockerfiles e no CI), sem editá-lo — a regra de versão ÚNICA segue
valendo, o que muda é a versão.

## Context

Desde a AT-361 o `Dockerfile.prod` do engine roda sobre Alpine 3.24.2 com OTP
27.3.4.18 (o hexpm não publica 27.1.2 sobre 3.24), enquanto dev e CI ficavam em
Elixir 1.17.3 / OTP 27.1.2 / Alpine 3.20.3. O build do engine no CI passou a
abortar em cerca de 10% das rodadas (0/57 antes do #821, 5/49 depois) com:

```
sys_signal_stack.c:101:sys_sigaltstack(): Internal error
```

Causa medida: a musl 1.2.6 do Alpine 3.24 recusa a pilha alternativa de sinais
de tamanho fixo (`SIGSTKSZ` = 8192) que o ERTS 27 pede, em hosts com AMX
(erlang/otp#11349). A correção — dimensionar por `sysconf(_SC_MINSIGSTKSZ)`
(commits `3a94587176`/`fc35c2496c`) — existe SÓ a partir do OTP 29.1. O mesmo
defeito faria o engine de PRODUÇÃO morrer no boot num servidor com AMX: o
intermitente do CI é o sorteio de máquina.

Voltar o Alpine para 3.22 resolveria o sintoma e congelaria a imagem numa
linha que deixa de receber correção de segurança; não foi escolhido.

## Decision

1. O engine roda **Elixir 1.20.4 / OTP 29.1.1** em dev, produção e CI. A
   imagem é `hexpm/elixir:1.20.4-erlang-29.1.1-alpine-3.24.2`, presa pelo
   digest do ÍNDICE (`sha256:ad851f40…`, ADR 0159/0178), a MESMA no builder do
   `Dockerfile.prod` e no `Dockerfile` de dev. O runtime de produção continua
   `alpine:3.24.2` (a musl do builder casa com a do runtime). Elixir 1.20 é a
   única linha com imagem e build do hexpm para OTP 29.1.
2. `ELIXIR_VERSION`/`OTP_VERSION` sobem juntos nos três workflows que os
   declaram (`ci.yml`, `golden-set-rag.yml`, `golden-set-qa.yml`), e o
   `mix.exs` passa a exigir `~> 1.20`.
3. O job "Build, scan e smoke" imprime se o host tem AMX
   (`grep -c amx_tile /proc/cpuinfo`): verde num host com AMX é a prova de que
   o defeito não voltou, e não sorte de sorteio.
4. Nenhuma dependência do `mix.lock` mudou: `mix deps.get` + `mix compile
   --warnings-as-errors` passam na versão nova. O verificador de tipos do
   Elixir 1.20 apontou uma cláusula morta em
   `Engine.Agents.FilaDeMensagens.acordar/3` — a falha de subir o agente
   LANÇA, não volta como valor — e ela foi corrigida contendo o erro por
   agente, não silenciada.

## Consequences

- **Preço de dev:** os volumes de `_build`/`deps` do engine foram compilados
  com OTP 27. O Mix recompila sozinho o que foi construído com outra versão de
  Elixir, então basta `docker compose up -d --build engine`; se o volume
  insistir em artefato velho, `docker volume rm` dos dois volumes do engine. Por
  ser recompilação automática, a mudança NÃO é breaking para quem opera.
- Quem roda o engine fora do Docker precisa de Elixir 1.20.4 / OTP 29.1.1
  (o `mix format --check-formatted` depende da versão, ADR 0024 decisão 10).
- Dependabot `docker`: com OTP 29.1 + Alpine 3.24 não há mais par quebrado, e
  nenhum `ignore` foi acrescentado. Ele pode propor uma tag `hexpm/elixir` de
  OTP 29.1.x mais nova — todas contêm a correção. Uma proposta que DESÇA para
  OTP < 29.1 com Alpine ≥ 3.24 reintroduz o defeito e deve ser recusada na
  revisão.
- Rollout em Kubernetes mistura, por instantes, nós OTP 27 e 29: a distribuição
  Erlang aceita pares com duas versões maiores de diferença.
