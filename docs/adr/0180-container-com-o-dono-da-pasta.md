# 0180 — O container do projeto roda com o dono da pasta, medido pela api

## Status

**Accepted.** 2026-09-29 (AT-247, história HS-071, épico EP-030, rodada 27).
Sobre o [ADR 0130](0130-broker-de-container.md) (o broker, a contenção em
cinco camadas e a especificação COMPUTADA) e o
[ADR 0144](0144-a-segunda-raiz-do-broker.md) (o broker serve `mounted`). Não
os edita: **acrescenta um campo à especificação** e diz por que ele não abre
porta nenhuma.

## Context

Medido no uso real de 2026-09-29: `docker inspect` do container de um projeto
mostrava `User=` vazio (root) e `CapDrop=[ALL]`. A pasta do projeto, montada em
`/work`, é `755` do uid do operador (1000). Root **sem** `CAP_DAC_OVERRIDE` não
escreve em pasta de outro uid, e `--cap-drop ALL` é exatamente o que tira essa
capacidade. Resultado: `npm install` dava `EACCES` em todos os dev agents e no
QA-automação; só `write_file` funcionava, porque escreve pelo processo do engine
no HOST, fora do container.

Reproduzido em Docker real (`node:22-bookworm-slim`, `--cap-drop ALL`, pasta
`755` do uid 1000): como root `touch` dá `Permission denied`; com
`--user 1000:1000` escreve. Com um uid sem entrada em `/etc/passwd` o `HOME`
fica `/` e o `npm` morre em `//.npm`.

`DockerPort` tem cinco operações, o bind é UMA pasta de tipo marcado e o tipo
não tem `privileged`/`cap_add`/`-v` livre (ADR 0130). Qualquer conserto tem de
caber nisso.

## Decision

1. `EspecificacaoDeContainer` ganha `usuario?: { uid, gid }`. O adaptador de CLI
   o traduz em `--user <uid>:<gid>` e em `--env HOME=/tmp` (constante: uid sem
   passwd recebe `HOME=/`). Sem `usuario`, o `run` sai byte a byte como antes.
2. **Quem mede é a api**, que alcança a pasta (a base montada por identidade, ou
   a raiz gerenciada): `GET /internal/projects/:id/container-spec` passa a
   devolver `usuarioDaPasta` (`stat` da pasta; `null` se não mede, se o projeto
   é `runner` ou se o dono é root). O broker compõe `usuario` DESSE contexto —
   nunca do corpo de um pedido: `start` não tem corpo e `pedidoDeExecValidado`
   ignora qualquer campo extra.
3. O broker **revalida** (`usuarioValidado`): inteiros em 1..2^31-1, `0`
   recusado nomeando o campo. Root é o AUSENTE; um `--user 0` explícito seria um
   afrouxamento que ninguém decidiu.
4. `exec` **não ganha campo**: `docker exec` herda o usuário do container.
5. Vale para `container` e `mounted` (a api mede a pasta que cada um monta); o
   modo `runner` não passa pelo broker e não muda.

## Consequences

- **Não abre porta de contenção.** O processo passa a ter MENOS poder sobre o
  host do que antes (não-root em vez de root), `--cap-drop ALL` continua, e não
  há campo em que um chamador escreva usuário, capacidade, mount ou rede.
- A segunda opção considerada, devolver `DAC_OVERRIDE`/`CHOWN`/`FOWNER`, foi
  **recusada**: afrouxa a contenção que o ADR 0130 fixou e mantém root.
- Uma terceira, o broker fazer `stat` ele mesmo, exigiria montar as pastas dos
  projetos no broker (hoje ele só tem o socket) — mais superfície num processo
  root-equivalente. A api já as alcança.
- Não é BREAKING para o operador: pasta ilegível ou de root cai em "como
  sempre". Container JÁ criado não muda até ser recriado (o `--user` é do
  `run`); o próximo `container_start` já sobe certo.
- Dono da pasta ≠ quem o dev agent deveria ser não é distinção que o produto
  faça: o alvo é escrever onde o operador já escreve.
- **Não medido:** Docker Desktop (macOS/Windows), onde o mapeamento de uid do
  bind-mount é outro; Docker rootless; pasta sob NFS com `root_squash`.
