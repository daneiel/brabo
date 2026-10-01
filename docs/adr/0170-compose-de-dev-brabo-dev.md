# 0170 — O compose de dev vira `brabo-dev`, e o dev recusa subir ao lado de uma instalação

## Status

**Accepted.** Decisão do mantenedor em 2026-09-27 (AT-173): "os dois" — nome
próprio para o dev E guarda. Referencia o [ADR 0150](0150-instalador-de-uma-linha.md)
(o compose de instalação, que nasceu dizendo ter `name` diferente do de dev) e o
[ADR 0152](0152-backup-de-volumes-contra-compose.md) (os volumes que importam).
Não edita nenhum dos dois.

## Context

Medido em 2026-09-19: `docker/docker-compose.yml` (dev) e
`docker/docker-compose.install.yml` declaravam os dois `name: brabo`. O
comentário do compose de instalação afirmava o contrário — *"`name` diferente
do compose de dev de propósito: os dois podem coexistir na mesma máquina"* — e
não era verdade. Para o Docker, uma máquina com instalação E checkout tinha UM
projeto: os containers (`brabo-api-1`, `brabo-postgres-1`…), a rede
(`brabo_default`) e os volumes de mesmo nome (`brabo_pgdata`,
`brabo_neo4j_data`, `brabo_git_local_repos`, `brabo_project_workspaces`…) eram
os mesmos.

Três consequências, a primeira medida:

- subir um compose sobre o outro RECRIA os containers do outro e os liga ao
  banco dele — o banco de uma instalação recebeu uma migration do dev;
- `scripts/dev/reset-total.sh` faz `DROP SCHEMA … CASCADE` no Postgres do
  projeto `brabo` — ou seja, apagaria o banco da instalação;
- `docker compose down` de um derruba o outro.

O compose de PRODUÇÃO (`docker-compose.prod.yml`) já era `brabo-prod`, e não
entra aqui.

## Decision

**1. O compose de dev passa a se chamar `brabo-dev`.** Containers
`brabo-dev-<serviço>-1`, rede `brabo-dev_default`, volumes `brabo-dev_<chave>`.
O overlay de observabilidade (`docker-compose.observability.yml`) repete o
nome, porque o `name:` do ÚLTIMO `-f` vence e um valor diferente ali moveria o
stack inteiro para outro projeto; o Alloy dele filtra por
`com.docker.compose.project=brabo-dev`.

**O de instalação FICA `brabo`.** É o nome que as instalações já feitas têm, e
trocá-lo desligaria cada uma dos próprios volumes na próxima atualização — o
custo cairia em quem nunca leu este repositório. Quem troca é o lado de quem
desenvolve, que lê o CHANGELOG e tem o runbook.

**2. Guarda, no `preflight.mjs` e no `reset-total.sh`.** Os dois RECUSAM,
nomeando os containers achados e o `down` (sem `-v`) de cada arquivo, quando
existe na máquina container — em qualquer estado, `docker ps -a` — cujo rótulo
`com.docker.compose.project.config_files` aponta para o compose de INSTALAÇÃO
(`docker-compose.install.yml`, ou o nome do asset `brabo-install-compose.yml`).
E recusam quando o compose de dev, como o script o chama, resolveria o projeto
`brabo` (um `COMPOSE_PROJECT_NAME=brabo` no `.env` ou no ambiente). No reset, a
guarda é o PRIMEIRO passo, antes até do preflight, e a recusa sai como
`RESET NÃO COMEÇOU`.

O critério é o ARQUIVO do rótulo, não o nome do projeto: uma instalação é
reconhecida em qualquer `-p`, e é isso que torna a guarda útil contra o que o
nome não resolve — o compose de dev subido com `-p brabo` à mão, o
`COMPOSE_PROJECT_NAME`, e um checkout antigo com `name: brabo` (que não tem
esta guarda, mas cujo acidente o checkout NOVO recusa continuar).

A régua existe em DOIS lugares, JS (`scripts/dev/instalacao-na-maquina.mjs`) e
bash (`recusar_se_ha_instalacao` em `scripts/dev/reset-total-lib.sh`), porque o
spec do reset roda com um `node` de mentira no PATH e precisa provar que o
próprio script recusa. As duas são exercitadas pelos specs ao lado.

Docker que não responde NÃO recusa: o preflight diz que a guarda não rodou e
segue (o `up` não sobe nada sem Docker), e no reset o `build`, ainda antes do
primeiro efeito, falharia igual.

**3. Migração de quem já desenvolve: aviso, nunca recusa, nunca apagar.** O
próximo `pnpm dev` cria volumes `brabo-dev_*` VAZIOS; os dados seguem nos
`brabo_*`. O preflight AVISA quando acha volume `brabo_*` com chave que SÓ o
compose de dev declara (`*_node_modules`, `engine_build`/`deps`/`mix`/`hex`) —
a lista é DERIVADA dos dois arquivos de compose, nunca copiada — e separa, sem
afirmar de quem são, os de chave comum aos dois (`pgdata`, `neo4j_data`,
`git_local_repos`, `project_workspaces`…), que podem ser de uma instalação. O
procedimento para copiar (volume a volume, `cp -a`, com o Postgres parado) ou
recomeçar está no runbook, "Moving a dev environment to brabo-dev". Nenhum
script remove volume.

## Consequences

- **Quem desenvolve age uma vez** (por isso a branch é `breaking/`): derruba o
  stack antigo SEM `-v` (`docker compose -p brabo -f docker/docker-compose.yml
  down`) e escolhe copiar os dados ou recomeçar. Enquanto não o fizer, o
  compose antigo segura as portas, e o preflight diz exatamente isso em vez do
  `port is already allocated`.
- **Desenvolver numa máquina que tem instalação passa a exigir derrubar a
  instalação antes** (`down` sem `-v`: volumes e dados ficam, `up -d` a traz de
  volta). É o preço declarado da guarda por PRESENÇA, e foi escolhido pelo
  mantenedor: os nomes separados já tornam a convivência segura no caso comum,
  mas a guarda existe justamente para o caso incomum — e uma guarda que só
  olhasse colisão de nome deixaria passar o checkout antigo e o `-p` à mão com
  a instalação parada. Rodar os dois AO MESMO TEMPO continua impossível de
  qualquer forma: eles publicam as mesmas portas.
- Volume órfão `brabo_*` com chave comum não é distinguível, sozinho, entre dev
  antigo e instalação — o aviso diz isso em vez de afirmar. O runbook ensina a
  perguntar (`config_files` dos containers, chaves exclusivas, se houve
  instalação na máquina).
- Documentação e comandos que citavam `brabo-api-1`, `brabo-postgres-1`,
  `brabo-ollama-1`, `brabo_pgdata`… no contexto de DEV passaram a citar
  `brabo-dev-*`. Os que falam da INSTALAÇÃO (o volume
  `brabo_project_workspaces` que o `install.sh` mede, a raiz do broker na
  instalação) ficam como estão, porque continuam verdade. Narrativa histórica
  (CHANGELOG antigo, RNs e ADRs aceitos) não é reescrita.
- Os rótulos `pod` do Prometheus local passam a `brabo-dev-api-1`/
  `brabo-dev-engine-1`, o nome real do container; nenhum dashboard filtra por
  valor de `pod`, só agrupa.
