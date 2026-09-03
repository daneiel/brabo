# 0136 — Página global de containers: teto por carga no broker, e `container_remove` no teto absoluto

## Context

O ADR 0130 (broker de container) declarou as cinco operações da
`DockerPort` — `start`/`stop`/`remove`/`inspect`/`exec` — e um comentário
explícito em `ContainerBrokerPort`: *"`stop`/`remove` seguem sem chamador:
são EFEITO EXTERNO e não acontecem sem `proposed_action` própria, que ainda
não existe."* O ADR 0133/0134 (PRs 1.5/1.6) ligaram `start`/`exec`; este PR
(1.8, o último da Parte 1 do plano "Execução em container real") fecha a
lacuna que sobrou, e entrega a tela que o comentário do controller
`ContainersController` (rota `lifecycle` por projeto) já apontava: *"a
página global que a consome é outro PR."*

Duas decisões arquiteturais concretas surgiram ao desenhar essa tela, e
nenhuma tinha resposta pronta nos ADRs anteriores:

1. A tela é CROSS-PROJETO — uma linha por projeto do workspace que já tem
   `project_containers`. O REGISTRADO agrega sem custo (é leitura de banco,
   mesmo molde de `ProjectsSummaryRepository`), mas o OBSERVADO — perguntar
   ao broker o estado atual, ADR 0130 — é uma chamada de REDE por projeto.
   Perguntar a TODOS sem teto violaria a regra do CLAUDE.md: *"leitura
   composta que chama o provider N vezes tem orçamento e cache, senão vira
   amplificador de tráfego"* (ADR 0060).
2. `container_remove` é qualitativamente diferente de `container_start`/
   `container_stop`: descarta o container e força reprovisionar do zero. O
   plano original não especificou o calibre exato — só que as três ações
   nascem como `proposed_action`.

## Decision

### O teto de chamadas ao broker é por DUAS réguas, não uma

`ObterVisaoGeralDeContainersUseCase` só pergunta ao broker (via
`ObterEstadoObservadoDoContainerUseCase`, já existente) para linhas cujo
REGISTRADO é `provisioning`/`running` — um container `stopped`/`failed`/
`removed` não precisa de confirmação do daemon para a tela fazer sentido, e
excluí-los da pergunta é grátis (não é o teto que os protege, é a
elegibilidade). Entre as elegíveis, no máximo `TETO_DE_VERIFICACOES_POR_CARGA`
(20, um NÚMERO revisável, não "todos") são perguntadas por carregamento, em
PARALELO (`Promise.all`, nunca em série — encadear multiplicaria a latência
pelo teto à toa).

O que fica de fora de qualquer uma das duas réguas carrega um campo PRÓPRIO,
`naoVerificado` (`fora_do_escopo_da_verificacao` |
`teto_de_verificacoes_atingido`) — nunca confundido com `naoObservado`
(`broker-nao-configurado`/`broker-sem-resposta`/`broker-recusou`, que já
existia e significa "o broker FOI perguntado e recusou/não respondeu"). Uma
linha fora do teto tem os três campos de observação (`observado`/
`naoObservado`/`detalheDaObservacao`) todos `null` — a tela nunca inventa
uma resposta que o broker não deu.

Por que 20: hoje (FASE 25b) nenhum provisionamento automático existe —
container só sobe por `container_start` aprovado manualmente — então o
número de containers `provisioning`/`running` simultâneos tende a ser
pequeno. 20 é folga generosa para o presente, não um corte apertado medido
contra volume real; revisar o número é uma linha, não uma migração.

### O REGISTRADO agrega em TRÊS consultas constantes, nunca uma por projeto

`ContainersOverviewRepository`/`DrizzleContainersOverviewRepository` segue o
MESMO molde de `ProjectsSummaryRepository` (RN-090): a primeira consulta
junta `projects` com `project_containers` (INNER JOIN — só entra quem já
TEM linha, que é a régua da tela), a segunda busca em lote os eventos
`artifact.project_image` dos projetos encontrados (para resolver a
imagem-texto de cada `imageVersion` CONGELADO — não a vigente, que pode ter
sido revisada depois que o container nasceu; `decisaoNaVersao`,
`domain/containers/project-container.ts`, extraída de
`ObterContainerDoProjetoUseCase` para não duplicar a lógica de
validação/degrade), e a terceira busca em lote as `proposed_actions`
pendentes de container dos mesmos projetos — o que permite a tela trocar os
três botões de ação pelo `ApprovalCard` inline sem uma quarta consulta por
projeto. Um teste (`containers-overview.repository.spec.ts`, mesmo desenho
do de `ProjectsSummaryRepository`) prova que o número de consultas é
IGUAL com 2 e com 20 projetos.

### `container_remove` entra no teto absoluto de `decide.ts`; `container_stop` segue o calibre de `container_start`

`container_start` (RN-491) e `container_stop` (RN-495) são `maintainer`,
`require_approval` por padrão, e PODEM ser configurados `auto_approve` —
nenhuma decisão é irreversível sem reprovisionar: parar um container
registrado `running` é um estado do qual se volta (`stopped -> running`).
`container_remove` é diferente: descarta o container, e a máquina de
estados (`container-lifecycle.ts`) só sai de `removed` PROVISIONANDO DE
NOVO — nunca "voltando à vida". Por isso `container_remove` entra no MESMO
teto absoluto de `decide.ts` que já cobre git push/comando privilegiado
(RN-418/ADR 0102): `require_approval` incondicional, mesmo com "modo
automático" ligado, mesmo com `permissions.json` configurado —
`ApproveAlwaysActionUseCase` recusa (400) gravar o padrão de "sempre
permitir" para ele, fechando a fresta na FONTE, mesmo mecanismo de RN-418.

`ContainerBrokerPort.remove` já era (desde o ADR 0128/0130, implementado em
`packages/docker-port`) `docker rm --force` — remove mesmo um container
`running`, numa chamada só. A máquina de estados NÃO ganhou um atalho
`running -> removed`: `ExecuteContainerRemoveUseCase` registra os DOIS hops
(`stopped`, depois `removed`) quando o registrado ainda dizia `running`,
refletindo o que aconteceu de verdade do lado do Docker sem alargar a
máquina de estados por uma via que só existiria para este caso de uso.

### "Subir de novo" REUSA `container_start` — não é um quarto tipo

Investigado e confirmado: `ExecuteContainerStartUseCase` já lida com a
dança completa a partir de QUALQUER estado — `provisioning`/`running`
(idempotente), `stopped` (pula direto para `running`, sem reprovisionar) e
`failed`/`removed`/sem linha (reprovisiona do zero) — porque ele já existe
para servir a eleição da Infra (RN-491), que também pode acontecer depois
de o container ter caído. A tela (`ContainersPage.tsx`) monta o payload de
`container_start` a partir da DECISÃO VIGENTE do projeto
(`GET .../container`, a mesma rota que a aba Code lê) — imagem, rede,
recursos — em vez de inventar um formulário novo; se o Arquiteto/Infra
ainda não decidiu (não deveria acontecer para uma linha que já existe, mas
a leitura degrada em vez de assumir), o clique falha com uma mensagem
nomeada, nunca propõe um payload vazio. Nenhuma mudança de backend foi
necessária para este terceiro botão.

## Consequences

**A página `/containers` é a primeira leitura cross-projeto que combina
banco (sem N+1) com um provider externo sob orçamento (com teto
explícito).** O padrão — elegibilidade primeiro, teto depois, motivo de
ausência PRÓPRIO nunca confundido com o motivo do provider — fica
disponível para a próxima leitura composta que precisar da mesma disciplina.

**`stop`/`remove` das cinco operações do ADR 0128/0130 têm chamador real
agora.** Das cinco, só `inspect` (leitura, sem `proposed_action`) segue como
estava; `start`/`stop`/`exec` já tinham chamador antes deste PR.
`container-lifecycle.ts` tinha um docblock afirmando "nenhum serviço do
produto monta `/var/run/docker.sock`" — falso desde o ADR 0130 e mais falso
ainda agora; corrigido neste PR, mesmo arquivo que ele já estava editando
por outro motivo.

**O teto de 20 é um NÚMERO, não uma medição.** Não há dado de produção
sobre quantos containers ficam `provisioning`/`running` simultaneamente —
FASE 25b nunca teve provisionamento automático. Se o volume crescer, o
número se revisa; ele não precisa de outra decisão arquitetural para mudar,
só de medição que hoje não existe (mesma régua declarada para os pesos da
busca híbrida do RAG, ADR 0080).

**`container_remove` nunca é auto-aprovável, em lugar nenhum, para sempre —
enquanto esta decisão valer.** Isso é deliberado: a única forma de reverter
seria outra decisão arquitetural explícita, não uma configuração.

**Alternativa considerada e descartada: alargar `container-lifecycle.ts`
com uma transição direta `running -> removed`.** Modelaria o que o broker
FAZ (remove força), mas confundiria o que a máquina de estados MODELA
(estado observável do produto) com o que o Docker permite como atalho
mecânico — a máquina continuaria certa sobre "o que a api sabe que
aconteceu", e o `ExecuteContainerRemoveUseCase` já resolve isso registrando
os dois hops sem tocar no domínio compartilhado por todo o resto do
sistema (inclusive `container_start`, que depende da mesma máquina).

**Alternativa considerada e descartada: teto de chamadas ao broker baseado
em cache/TTL em vez de contagem por carregamento.** Um cache reduziria
chamadas em carregamentos sucessivos rápidos, mas introduziria uma janela em
que o observado pode estar desatualizado SEM a tela saber — o que RN-468
proíbe (sinal de ambiente diz o que SABE, nunca finge frescor que não tem).
O teto por carregamento é mais simples e mais honesto: cada carregamento diz
exatamente o que perguntou.
