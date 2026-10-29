# ADR 0229 — O QA testa numa instância efêmera, com os serviços que a Infra declarou

## Status

**Accepted.** 2026-10-29 (AT-612, EP-030; decisões do dono de 29/10). Tema:
`container`. Estende o
[0130](0130-broker-de-container.md) e o
[0228](0228-comando-do-app-e-rede-do-container.md) sem editá-los. Esta lane fixa
o contrato de `packages/docker-port` e do broker; o ciclo de vida (api, engine,
tabela de ambientes) vem depois.

## Contexto

O QA roda no container de TRABALHO e a RN-817 mata o que o projeto deixou de
pé, o que mataria o app declarado do ADR 0228. O dono decidiu: o e2e roda num
container de QA à parte, ligado só quando o gate precisa, com a infra do app
(banco, S3...) dentro da mesma instância, e quem decide os serviços é a Infra,
não um catálogo nosso.

## Decisão

1. **Papel `qa`.** Uma spec com `qa: { chave, servicos }` é uma instância
   efêmera por tarefa: nome `brabo-qa-<workspace_dir_name>-<chave>` (`chave` =
   8 caracteres `[a-z0-9]`, os primeiros do `taskId`; fonte única em
   `nomeDoContainerDeQa`), mesma imagem, rede, recursos, usuário e bind `/work`
   do trabalho, SEM `--restart`, com `brabo.papel=qa` e
   `brabo.qa.instancia=<chave>`. Não aceita `comandoDoApp` nem `portas`. A
   `DockerPort` segue com cinco operações: `stop`, `remove`, `inspect` e `exec`
   ganham o parâmetro opcional `alvo: { papel: 'qa', chave }`.
2. **Só o rotulado.** Com `alvo` de QA, o adaptador filtra `brabo.papel=qa`;
   container homônimo sem o papel é "não gerenciado" e nunca é tocado. A
   remoção de QA apaga primeiro os serviços PRÓPRIOS da instância
   (`brabo.qa.dono=<nome do QA>`) e depois a instância; ela fica fora do teto
   absoluto do `container_remove` (decisão do dono), porque só alcança o que
   tem rótulo de QA.
3. **Serviços declarados pela Infra.** `{ nome, imagem, env?, dados?,
   compartilhado? }`, até 6. Imagem por DIGEST (`@sha256:` + 64 hex)
   OBRIGATÓRIO; `env` com chaves `[A-Z_][A-Z0-9_]*` (até 20, valor sem quebra
   de linha); `dados` são caminhos em `--tmpfs` (até 3). Cada serviço sobe com
   `--network container:<qa>` (um `localhost` só), `--cap-drop ALL`, sem
   privilégio nem `--cap-add`, sem porta publicada, teto CONSTANTE de 1 cpu,
   512 MB e 256 pids, `--tmpfs /tmp`, rótulo `brabo.papel=qa`. Falha no meio
   desfaz o que subiu.
4. **Serviço compartilhado.** `--network container:` só liga contêineres a UM
   namespace, então um serviço compartilhado entre instâncias não cabe nele. O
   desenho mínimo: ele vive numa rede privada `--internal` do projeto
   (`brabo-qa-<workspace_dir_name>`), nome do serviço como alias de rede,
   container `brabo-qa-<workspace_dir_name>-svc-<nome>` com rótulo
   `brabo.qa.compartilhado=1`, reaproveitado se já de pé; cada instância se liga
   a essa rede por `docker network connect`. Exige rede `egress` (container em
   `none` não se conecta). Quem remove o compartilhado e quando é pergunta
   aberta para a lane de api.
5. **Broker.** Rotas novas no roteador fechado:
   `/containers/:projectId/qa/:chave/{start,remove,exec}`. A lista de serviços
   vem da `container-spec` da api (`?papel=qa&task=<chave>`), nunca do corpo; a
   chave da rota tem de ser a que a api devolveu.

## Consequências

- Dois processos de teste podem rodar por projeto sem tocar o app de trabalho.
- Postgres/MinIO oficiais com `--cap-drop ALL` e tmpfs NÃO foram medidos com
  Docker real nesta lane; a imagem que exigir capability falha na subida, com
  `failed` nomeado.
- O pull dos serviços cabe no teto de controle de 30 s (RN-604) ou falha
  nomeado: imagem grande não sobe na primeira tentativa.

## Referências

- [0130](0130-broker-de-container.md), [0189](0189-o-piloto-automatico.md),
  [0228](0228-comando-do-app-e-rede-do-container.md).
- [RN-930](../business-rules.md#rn-930).
