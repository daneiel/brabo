# ADR 0228 — O container do projeto sobe o app pelo comando declarado e publica porta só no loopback

## Status

**Accepted.** 2026-10-29 (AT-610 e AT-608, EP-030; decisões do dono de 29/10).
Tema: `container`. Revisa, sem editá-los, o
[0130](0130-broker-de-container.md) (a spec FECHADA sem
campo de rede) e o
[0213](0213-o-entregavel-roda-na-maquina-pelo-compose-da-infra.md) (Decision 1:
"o broker NÃO publica porta"). Convive com o
[0189](0189-o-piloto-automatico.md) e o
[0229](0229-instancia-de-qa-efemera-com-servicos-declarados-pela-infra.md).
Esta lane fixa o CONTRATO de `packages/docker-port` e do broker; a api, o
engine, o runner e a web vêm depois e implementam o lado deles.

## Contexto

O container do projeto sobe com `sleep infinity` e o app só roda durante o teste
do QA. Porta publicada sem processo escutando não mostra página nenhuma, e o
dono pediu para configurar portas, DNS e `extra_hosts` por container
(AT-608), com o app declarado pela Infra (AT-610).

## Decisão

1. **Comando do app (`comandoDoApp`, opcional).** A Infra o declara
   (`run.app` em `artifact.run_instructions`); a api o entrega na
   `container-spec` e o broker NUNCA o lê do corpo do pedido. Até 300
   caracteres, sem `\n`, `\r` nem NUL. Com ele, `argsDeCriacao` troca o
   `sleep infinity` por um supervisor CONSTANTE (`SUPERVISOR_DO_APP`), com o
   comando como ARGUMENTO posicional (`$1`, molde da RN-807), nunca
   concatenado: o app sobe em background, com log em `/tmp/brabo-app.log` e
   código de saída em `/tmp/brabo-app.exit`, e o PID 1 segue sendo o
   `sleep infinity`. App que morre fica morto. Sem o campo, o `docker run` é
   byte a byte o de hoje (provado por teste).
2. **Portas.** `portas: [{ host, container, protocolo: 'tcp' }]`, sempre
   `-p 127.0.0.1:H:C` (a interface é constante do adaptador, sem opção).
   Host de 1024 a 65535, fora das portas da instalação (3000, 4000, 5173, 5432,
   7474, 7687, 8088, 8090, 11434), no máximo 10, sem duplicata, e recusado com
   rede `none`. Só a CONTENÇÃO muda de forma: a rede `egress` já alcançava as
   portas publicadas da máquina (ADR 0189) e a publicação é só no loopback.
3. **DNS e `extra_hosts`.** `dns` é lista de IP literal v4/v6 (até 3);
   `hostsExtras` é `{ nome, ip }` (até 10), com nome em `[a-z0-9.-]` (até 253,
   sem ponto/hífen nas pontas), nunca `localhost` nem nome de serviço da
   instalação, e IPv4 literal (o `:` do IPv6 é ambíguo em `--add-host`).
   Também recusados com rede `none`.
4. **`inspect`** passa a ler `NetworkSettings.Ports` e devolve
   `portasPublicadas` no estado OBSERVADO; o que a Infra declarou segue sendo
   outra coluna (RN-468).
5. **A `DockerPort` continua com cinco operações.** Os campos novos são da
   SPEC; nenhuma operação nova nasce. Mudar o comando, as portas, o DNS ou os
   hosts só vale em container RECRIADO (o `start` é idempotente); a ação de
   recriar e a aprovação são da lane de api.
6. **Fora desta lane:** `runner` (capacidade no `join`, depois), a página, a
   ação `container_recreate` e a aprovação do comando — o dono decidiu que o
   piloto automático ligado dispensa o clique e, sem ele, a PR de Infra com
   `run.app` pede aprovação humana.

## Consequências

- O 0213 deixa de valer na frase "o broker NÃO publica porta"; vale o resto.
- O container passa a ter processo de longa duração disparado pelo produto, com
  a contenção de qualquer `exec` (`--cap-drop ALL`, `--user`, pids/memória).
- `setsid` ausente na imagem não impede o app: o supervisor cai no `sh` direto.

## Referências

- [0130](0130-broker-de-container.md), [0213](0213-o-entregavel-roda-na-maquina-pelo-compose-da-infra.md),
  [0189](0189-o-piloto-automatico.md).
- [RN-928](../business-rules.md#rn-928), [RN-929](../business-rules.md#rn-929).
