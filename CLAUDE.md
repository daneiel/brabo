# Brabo — Plataforma de engenharia orquestrada por agentes

## O que é
Sistema que gerencia o ciclo completo de uma aplicação: provisionamento de
repositório, Gitflow, agentes de IA especializados (Criativo, PO, Arquiteto,
Devs, Infra, QA, SecOps, Psicólogo, Anamnese), controle de custos de token
e pipeline de aprovação de ações com autoridade final do usuário.

## Histórico

A narrativa completa de cada fase — o que entregou, o que cortou, os achados
e por quê — mora em `docs/explanation/historico-de-fases.md`. Este índice
existe só para LOCALIZAR: a coluna diz onde procurar, nunca o que a fase fez.
A regra que sobreviveu de cada fase está em Convenções, nas RNs e nos ADRs.
**Nada aqui é lacuna aberta** — o que segue aberto está na seção "Estado atual
e aberto", logo abaixo.

Em 2026-09-11 a coluna de narrativa saiu daqui, e o motivo importa: 53 destas
entradas tinham a narrativa num lugar só — esta tabela —, apesar de o texto
acima afirmar desde sempre que ela morava no histórico. As 53 foram movidas
para `docs/explanation/historico-de-fases.md` sem reescrita antes de a coluna
ser removida. Fase que fechar daqui em diante escreve a narrativa LÁ e uma
linha aqui; não faça o caminho inverso, que foi o que produziu a deriva.

O que está EM EXECUÇÃO não mora nesta tabela: mora no kanban do vault
(`projetos/brabo/07-backlog/Kanban (Brabo).md`), um card por sessão, com o
estado lido do repositório e não da conversa.

| Fase / Programa | Onde está a narrativa |
|---|---|
| FASE 1 (MVP) | — |
| FASE 2 | — |
| FASE 3 | — |
| FASE 4 | ADR 0020 |
| FASE 5 | ADR 0024 |
| FASE DOC | documentation-workflow.md |
| FASE 6 | ADR 0030 |
| FASE 7 | ADR 0031 |
| FASE 8 | ADR 0038 |
| FASE 9 | ADR 0041 |
| FASE 10 | primeiro-dogfooding.md |
| FASE 11 | ADR 0043 |
| FASE 12 | ADR 0044 |
| FASE 13 | validacao-real.md |
| FASE 14 | ADR 0052 |
| FASE 15 | ADR 0054 |
| PÓS-15 | ADR 0058 |
| PROGRAMA 16–26 | ADR 0060 |
| PÓS-PROGRAMA 16–26 | ADR 0068, RN-148 |
| RODADAS exp001/exp003 | ADR 0069, RN-150 |
| PROGRAMA 28 (Ondas 1–5) | ADR 0074 |
| Modelo de time / auditoria fluxo.yml | ADR 0085 |
| Agentes antecipados | ADR 0087 |
| Correções pós-uso (ago/2026) | ADR 0096, RN-408 |
| Neo4j | ADR 0099 |
| Runner local | ADR 0102 |
| Abas agrupadas / PRs project-wide / carrossel do PO | RN-421 |
| Handoff manual / budget por área / pasta local no RAG | ADR 0109 |
| pnpm bootstrap | — |
| Faixa de atividade do turno | RN-459 |
| Ollama nativo / pull de Hugging Face | ADR 0114, RN-461 |
| Lockfile próprio do website | ADR 0117 |
| Configuração automática do runner pelo navegador | ADR 0118, RN-464 |
| Imagens publicadas no GHCR | ADR 0119 |
| Schema por agregado | ADR 0121 |
| `SessionPage.tsx` em 5 PRs mecânicos | ADR 0122 |
| Hook do canal de turno do `SessionPage.tsx` | ADR 0124 |
| `ProjectSettingsTab.tsx` por seção | ADR 0125 |
| Trilho vertical de navegação do projeto | ADR 0126, RN-201 |
| Sumário ancorado de Configurações | CHANGELOG |
| Padrão único de valor herdado | CHANGELOG |
| Salvar por seção em Configurações | RN-469 |
| Painel "precisa de você" | RN-467 |
| Cascata de modelo como cadeia visível | RN-470 |
| Pasta antes do runner | RN-473 |
| O `kid` na chave de dispositivo | RN-475 |
| Provisionamento que não fica calado | RN-477 |
| O arquivo de política e o escopo do terminal | RN-478 |
| Aviso do passo humano antes do clique | RN-473 |
| Um modelo para todos os agentes | RN-476 |
| Tetos de rebaixamento em `project_members` | ADR 0127, RN-472 |
| Telemetria de busca do RAG | RN-479 |
| Broker de container | ADR 0130, RN-485 |
| Roteamento de módulos para infra (PR 1.4) | ADR 0131, RN-487 |
| Golden-set de acerto do RAG | ADR 0132, RN-490 |
| A Infra elege, e a eleição sobe o container de verdade (PR 1.5) | ADR 0130, RN-491 |
| Dev agents executam DENTRO do container real (PR 1.6) | ADR 0134, RN-492 |
| O portão da imagem nos três modos (PR 1.7, BREAKING) | ADR 0135, RN-494 |
| Página global de containers (PR 1.8, fecha a Parte 1) | ADR 0136, RN-495 |
| O runner sobe o container do projeto (PR 1.3, Parte 1 fora de ordem — fecha a metade que a RN-494/PR 1.7 tinha deixado declarada) | ADR 0137, RN-497 |
| Golden-set do RAG em CI, agendado (Parte 2/Etapa 3) | ADR 0138, RN-498 |
| O handoff da Infra podia ser aceito por tela nenhuma (D0) | RN-499 |
| A base única dos projetos montados (PR 1, BREAKING) | ADR 0141, RN-500 |
| A pasta montada nasce quando o container sobe (PR 2) | ADR 0142, RN-501 |
| Container de projeto montado (PR 3) | ADR 0144, RN-503 |
| O navegador de pastas passa a ser servido pela api (PR 4) | RN-504 |
| Agentes de dev só depois do container (PR 7) | ADR 0143, RN-502 |
| Alarme de merge de esteira com destinatário | ADR 0139 |
| O artefato de decisão dos conversacionais (Frente 3, fatia genérica) | RN-505 |
| "Sempre permitir" separado por Dev Agent de módulo | RN-509 |
| Docker vira pré-requisito real do modo Runner | ADR 0145, RN-507 |
| RN-505 duplicada em dev, corrigida | ADR 0145, RN-505/509/507 |
| O gatilho do appsec | ADR 0090, RN-539 |
| FASE 28 (sessão 1) — a pasta do usuário, só decisão | ADR 0146 |
| FASE 28 (sessão 2) — a base deixa de depender de alguém adivinhar que ela existe | ADR 0146, RN-511 |
| FASE 28 (sessão 3) — o assistente oferece a Pasta montada | ADR 0146, RN-513 |
| FASE 28 (sessão 5) — o `join` do agente local deixa de ser mudo | ADR 0147, RN-514 |
| FASE 28 (sessão 6, metade A) — onde o destino do espelho mora | ADR 0147, RN-515 |
| FASE 28 (sessão 6, metade B) — o espelho passa a existir | ADR 0147, RN-516 |
| FASE 28 (sessão 8) — o estado do espelho fica visível | ADR 0147, RN-517 |
| O broker que nunca subiu (correção da RN-512) | ADR 0130, RN-512 |
| FASE 28 (sessão 7) — o agente local vira serviço de usuário | ADR 0147, RN-518 |
| FASE 28 (sessão 7) — a revogação deixa de ser cega, e alcança a conexão viva | ADR 0147, RN-519 |
| A spec do runner ia sem `projectId`, e o caminho NUNCA subiu container | ADR 0145, RN-508 |
| A sessão morria com dev agent bloqueado por container | RN-411/502 |
| O painel dizia "trabalhando" sobre quem estava parado | RN-411/470/502 |
| Subir container pela tela, nos três modos | ADR 0136, RN-521 |
| A pausa que não podia ser desfeita | RN-540 |
| O quarto template ganha consumidor | ADR 0101, RN-413/417 |
| FASE 29 (sessão 1) — instalação de uma linha, só planejamento | ADR 0149 |
| FASE 29 (sessão 2) — a esteira assina o que publica | ADR 0149, RN-524 |
| FASE 29 (sessão 3) — o instalador que ainda não instala | ADR 0150, RN-526 |
| FASE 29 (sessão 4) — a instalação sobe de um compose próprio | ADR 0150, RN-527 |
| FASE 29 (sessão 6) — migrar exige backup PROVADO | ADR 0150, RN-530 |
| FASE 29 (sessão 7) — uma base para os dois lados, e o BRB-031 fecha | ADR 0150, RN-531 |
| FASE 29 (sessões 8-10) — o protocolo, o picker e o E2E | ADR 0149, RN-532 |
| FASE 29 (sessão 3) — o proxy de download passa a verificar, e diz o que NÃO verifica | ADR 0149, RN-525 |
| FASE 29 (sessão 8) — a base do agente local ganha um consumidor | ADR 0151, RN-532 |
| FASE 29 (sessão 5) — o backup passa a cobrir o que perder dói | ADR 0152, RN-528 |
| FASE 29 (sessão 9) — o picker do modo Runner volta a ler o disco de quem escolhe | ADR 0151, RN-533 |
| FASE 30 (sessão 2) — a chave de dispositivo passa a poder ser da MÁQUINA | ADR 0154, RN-543 |
| FASE 30 (sessão 3) — o agente local abre N conexões, uma por projeto | ADR 0154, RN-544 |
| FASE 30 (sessão 4) — a unit de MÁQUINA, convivendo com as por projeto | ADR 0154, RN-545 |
| FASE 30 — o agente espera o primeiro projeto, e a chave nasce no terminal | ADR 0155, RN-550/551 |
| FASE 30 — a chave de MÁQUINA ganha quem a registra | ADR 0155, RN-552 |
| FASE 30 (sessão 6) — o `install.sh` fecha a instalação | ADR 0155, RN-547 |
| FASE 30 (sessão 7) — a tela reconhece agente de máquina já pareado | ADR 0154, RN-548 |
| FASE 30 — CONCLUÍDA (sessão 8: o E2E em máquina limpa) | historico-de-fases.md |
| O runner reconectava sozinho com um ticket morto | RN-108 |
| A conversão de modo deixa de ser um salto no escuro (AT-049/AT-050) | RN-559, RN-560 |
| O Infra Lead recusa `container_start` por modo antes de propor (AT-048) | RN-566 |
| A credencial que sumia no `docker exec` do runner (AT-053) | Lacuna que o ADR 0145 declarou POR ESCRITO e mediu: o container `running` que a RN-507 exige antes de qualquer operação de `RunnerGit` só existe porque o MESMO runner o subiu, e é esse mesmo sucesso que o faz rotear todo comando para dentro dele — por um `docker exec` sem campo de `env` (ADR 0130, sem `-e` livre). O `git fetch` autenticado rodava com o helper instalado e as variáveis VAZIAS, e a falha chegava como token inválido ou rede fora: o caminho COMUM, não uma borda. Entregou-se a metade do SILÊNCIO, nunca a do `env`: o par (`env` presente, container ativo) passa a ser RECUSADO antes de executar, com marca de PROTOCOLO partida entre duas linguagens, mensagem que diz o quê e por quê, e origem `politica` — não `codigo`, porque não há cláusula faltando, há decisão de produto pendente. Quem recusa é o RUNNER e só ele pode: `containerAtivo` nasce `null` a cada execução, então container `running` REGISTRADO no banco NÃO implica container ativo NAQUELE processo, e um runner reiniciado com o container de pé roteia pro HOST, onde a credencial chega — subir a checagem recusaria um caminho que funciona, e `RunnerReadiness` fica byte a byte como está. A saída nunca cita nome nem valor de variável, só a CONTAGEM (a invariante da RN-507 sobrevive intacta). Metade aberta declarada, e a adjacência também: a idempotência de `ensure!` marca o workspace pronto na segunda tentativa por achar o `.git`, e ela falha adiante em vez de repetir a recusa | RN-558 |
| O teto de auto-rebaixamento chega à REMOÇÃO (BRB-001) | O ADR 0127 pôs os dois tetos só no `add` e declarou esta porta aberta POR ESCRITO, com o custo estimado e um teste cujo nome documentava o buraco. Remover a linha de `project_members` não apaga um papel, TROCA o efetivo — `projectRole ?? workspaceRole` passa a resolver pelo segundo termo —, então `maintainer` pela linha de projeto com `viewer` no workspace se rebaixava sozinho, sem volta pela tela (repor pede o `maintainer` recém-abandonado); sem papel de workspace, a queda é para acesso NENHUM. É o teto 2 REUSADO: `remocaoEhAutoRebaixamento` delega a `ehAutoRebaixamento` com o papel de workspace no lugar do papel pedido, e existe como função própria por UM caso que a outra assinatura não sabe enunciar (papel-depois "nenhum" não é um `Role`). O teto 1 não ganha par, e a ausência é DECISÃO escrita ao lado da função: `owner` é o topo do `ROLE_ORDER`, remover só pode elevar, e é assim que se desfaz a restrição que o teto 1 impede de criar. Sem limiar como o teto 2, então o preço vem junto e é declarado — a auto-remoção de `owner` de projeto para `maintainer` de workspace é reversível e CAI TAMBÉM, único movimento benigno que passava e passa a recusar. Mensagem PRÓPRIA (quem clicou "remover" não pediu mudança de papel), tela intocada (o toast já mostra a frase da api) | RN-556, ADR 0156 |
| O teto de auto-movimento no upsert de WORKSPACE, e a auto-promoção (BRB-002) | Terceiro e último da linha. `AddWorkspaceMemberUseCase` era passa-adiante de doze linhas que NUNCA recebeu o ator, numa rota `@RequireRole('owner')` — a mesma classe de defeito um escopo ACIMA e mais grave, porque aqui não há nível acima para segurar a queda e `WorkspacesController` NÃO tem `@Delete` de membro (medido): um `owner` que se gravasse `viewer` perdia o workspace inteiro, e desfazer é a MESMA rota, que pede o `owner` recém-abandonado. O teto NÃO conta owners — a cláusula do ADR 0127 (*"se enuncia numa cláusula, não tem número para envelhecer"*) JÁ produz o invariante que a contagem existiria para garantir: nunca há zero donos, porque tirar o último exigiria que ele mesmo o fizesse. O teto 1 não tem par aqui, e foi CONSIDERADO e não espelhado: ele é regra sobre INVERSÃO DE HIERARQUIA, e o `@RequireRole('owner')` já a impede — somado à ausência de rota de remoção, pô-lo faria de `owner` um ESTADO ABSORVENTE, do qual ninguém sai por HTTP, que é a classe de estado que o ADR 0127 nasceu para eliminar, com o sinal trocado. Rebaixar OUTRO `owner` fica, reversível pela mesma rota. Junto, a auto-PROMOÇÃO — declarada nas Consequences do 0127 como capacidade que ficava, com teste fixando a permissão — vira BRECHA e fecha nas DUAS rotas de associação: das duas metades do movimento sobre o próprio papel, a de cima é a única que ESCALA privilégio, e o 0127 pôde dizer que os tetos dele não eram sobre escalação. Teste INVERTIDO, nome guardando a origem. A régua não foi copiada: virou UM classificador (`autoMovimentoDoProprioPapel`, devolve o SENTIDO porque a mensagem depende dele), e `ehAutoRebaixamento` sobreviveu como LEITURA dele por motivo de COMPORTAMENTO — alargá-la faria a REMOÇÃO recusar a auto-promoção, o movimento benigno que o ADR 0156 protegeu. Custo declarado: `maintainer` que precise de `owner` no projeto passa a depender de outra pessoa | ADR 0157, RN-557 |
| A chave de dispositivo ganha tela, e a tela diz o alcance de revogar (AT-012) | RN-561 |

## Estado atual e aberto

O que segue é OPERATIVO — decide comportamento de sessão hoje. Fechou? Sai
daqui e o fechamento vai para o histórico.

**Nenhuma fase EM EXECUÇÃO.** A FASE 30 fechou na sessão 8 (RN-549) — a
narrativa inteira está em `docs/explanation/historico-de-fases.md`, o recorte em
`docs/explanation/fase-30-runner-por-maquina.md`, e o que sobreviveu dela como
regra está em Stack (a chave de MÁQUINA, as duas espécies de unit, a espera com
zero projetos) e nas lacunas abaixo. Trabalho novo nasce do kanban do vault.

**Decisões de produto abertas (não são bugs; não corrigir de passagem):**
- Z/AD: allowlist de verbos não converge (verbo/forma/invocação são espaços
  distintos) — `docs/explanation/achados-execucao-real.md`
- AE: agente de QA tenta consertar o código que julga; contido por duas
  barreiras independentes
- Botão "Ativar execução" mudar de dono continua fora de escopo, por decisão
  declarada (ADR 0053 item 5) — só a metade da delegação Dev Lead →
  `dev-<modulo>` fechou (ADR 0094); a execução segue no caminho atual

**Cortes e pausas vigentes:**
- FASE 25b DEIXOU de ser corte no compose LOCAL (RN-512, ADR 0146 ponto 3): o
  broker sai do `profiles` ali e sobe com `pnpm dev`, e permanece sob
  `profiles: ["container-broker"]` só em PRODUÇÃO — os dois composes divergem
  de propósito, não uniformize. A justificativa original ("nada o chama... em
  troca de nada", ADR 0130) morreu: são quatro chamadores reais desde os ADRs
  0133/0136, e o ADR 0144 fez `mounted` subir PELO broker, então com o profile
  desligado o modo padrão terminava em `BrokerIndisponivelError`. A assimetria
  é o que o socket significa de cada lado: quem roda `pnpm dev` já o tem (está
  rodando `docker compose`), em produção ele é fronteira de privilégio e o
  operador não é o desenvolvedor. Isso muda QUANDO o broker roda, nunca O QUE
  ele aceita — as cinco camadas de contenção seguem intactas. Consequência:
  `DOCKER_GID` passa a importar para toda máquina de desenvolvimento, e
  `preflight.mjs` RELATA o estado dele a cada subida (errar não quebra o boot,
  quebra o uso, e o sintoma aparece só no `container_start`). Em PRODUÇÃO, sem
  o profile ligado, `container_start` continua terminando `failed` com
  `BrokerIndisponivelError`. O
  que mudou (ADR 0133, RN-491) é que o MECANISMO deixou de ser corte:
  `container_start` é `proposed_action` de verdade, decidida caso a caso pelo
  `ApprovalCard` (`maintainer`, nunca seedada em auto-aprovação), e
  `ExecuteContainerStartUseCase` chama `ContainerBrokerPort.start` de
  verdade quando aprovada — o Infra Lead elege uma das candidatas do
  roteamento do Arquiteto (`artifact.module_routing`, ADR 0131) e a eleição
  emite nova versão de `artifact.project_image` (reusando
  `DecidirImagemDoProjetoUseCase`, `decidedBy: 'infra-lead'`), porque o
  broker compõe a partir DESSE artefato, nunca do roteamento. Das cinco
  operações do ADR 0128/0130, agora as CINCO têm chamador — `inspect` (a
  rota de ciclo de vida, observado ao lado do registrado), `start` e, desde
  o ADR 0134 (RN-492), `exec`: quando há um container `running` REGISTRADO,
  o comando de terminal do dev agent atravessa engine → api → broker e roda
  DENTRO dele, via `docker exec`, em vez de `System.cmd` local — a lacuna
  que a RN-491 tinha deixado declarada ("dev agents NÃO passam a trabalhar
  dentro do container") fechou. Desde o ADR 0136 (RN-495, PR 1.8), `stop` e
  `remove` também têm chamador: a página global de containers
  (`/containers`) propõe `container_stop`/`container_remove` — dois tipos
  novos, sempre um HUMANO clicando "Parar"/"Remover" numa linha da tela,
  nunca um agente. `container_stop` segue o MESMO calibre de
  `container_start` (`maintainer`, pode ser configurado auto-aprovável,
  nunca seedado); `container_remove` — o mais destrutivo dos três, descarta
  o container e exige reprovisionar do zero — entra no MESMO teto absoluto
  de git push/comando privilegiado (RN-418): nunca auto-aprovável, "sempre
  permitir" recusado na fonte. A tela em si tem seu próprio teto: perguntar
  o OBSERVADO ao broker é uma chamada de rede por projeto, então só linhas
  `provisioning`/`running` são elegíveis, com um teto explícito de 20
  chamadas por carregamento (`TETO_DE_VERIFICACOES_POR_CARGA`) — o que fica
  de fora diz por quê (`naoVerificado`), nunca confundido com o broker ter
  sido perguntado e recusado (`naoObservado`).
  `RegistrarTransicaoDeContainerUseCase` ganhou o primeiro chamador fora de
  teste, transicionando `provisioning → running` (ou direto para `running`
  a partir de `stopped`, que a máquina de estados do ADR 0081 não deixa
  reprovisionar) — `container_remove` acrescenta o segundo hop real,
  `running → stopped → removed`, refletindo que `ContainerBrokerPort.remove`
  já era `docker rm --force` (remove mesmo `running`, numa chamada só) sem
  alargar a máquina de estados com um atalho `running → removed` que só
  existiria para este caso. O que seguia cortado até o ADR 0137 (RN-497,
  PR 1.3): `mounted`/`runner` continuavam sem container nenhum subindo NO
  SERVIDOR — o portão dos três modos fechou (RN-494/ADR 0135, PR 1.7: os
  três modos agora exigem imagem decidida para a aba Code, e
  `RegistrarTransicaoDeContainerUseCase` não recusa mais por modo), mas quem
  impedia `mounted`/`runner` de chegar em `running` era só o broker
  (`ModoDeExecucaoNaoSuportadoError`). O ADR 0137 fechou essa metade DO OUTRO
  LADO: `mounted`/`runner` sobem container de verdade NA MÁQUINA DO USUÁRIO,
  pelo `brabo-runner`. E o ADR 0144 (RN-503) fechou a metade que faltava para
  `mounted`, do lado do SERVIDOR: a base única do ADR 0141 tornou aquela pasta
  alcançável pelo daemon do host, então `mounted` passa a subir pelo BROKER
  como `container` — a ramificação vira por DESTINO (`container` e `mounted` →
  broker, `runner` → runner), e as três ações de ciclo de vida mudam juntas. O
  broker ganhou uma SEGUNDA raiz (`BRABO_PROJECTS_HOST_BASE`) e a api passou a
  mandar um localizador DISCRIMINADO em vez de um nome solto, sem que nenhum
  caminho absoluto atravesse a rede. `runner` é o único modo que segue sem
  container NO SERVIDOR — a pasta dele mora numa máquina que o broker não
  enxerga. A pergunta "quantos módulos, um container só" segue como está,
  `project_id UNIQUE` em `project_containers`, sem mudança aqui. O que
  faltava fechar era o OUTRO fallback: até a RN-507 (ADR 0145), um projeto
  `runner` verificado e conectado tinha comando roteado ao CLI mesmo SEM
  container `running` de pé — o runner caía sozinho no host puro,
  silenciosamente. `Engine.Runners.RunnerReadiness` unifica os TRÊS modos sob
  o MESMO predicado, e `container_start` deixa de atender `runner` (o
  payload dela, com eleição de imagem, nunca fazia sentido pra um caminho
  sem roteamento contra o qual eleger) — `container_start_via_runner` é o
  tipo novo, exclusivo desse modo
- Anamnese e Psicólogo PAUSADOS desde 2026-08-10 (`ANAMNESE_ENABLED=false`),
  aguardando spec; Staff dormente para disparo automático (acionável manual)

- Anamnese e Psicólogo PAUSADOS desde 2026-08-10 (`ANAMNESE_ENABLED=false`,
  `PSYCHOLOGIST_ENABLED=false`), aguardando spec. A pausa segue valendo e a
  decisão de produto NÃO mudou — o que mudou na RN-540 é que ela passou a ser
  REVERSÍVEL de verdade: as duas flags não estavam mapeadas no `environment:`
  do serviço `engine` de compose NENHUM, o Compose não repassa o ambiente do
  host, e `ANAMNESE_ENABLED=true` no `.env` era inerte — `runtime.exs` caía no
  default `"false"` em silêncio, enquanto TRÊS lugares (os docblocks dos dois
  workers e `docs/reference/configuration.md`) prometiam que "ligar de volta é
  `X=true` e reiniciar". Medido no container: `[true] [] []`. As oito flags
  BOOLEANAS do `runtime.exs` estão nos dois composes agora, cada uma com o
  MESMO default do código, e `scripts/ci/flags-do-engine-no-compose.spec.ts`
  DERIVA a lista e reprova a próxima que faltar. E ligar a Anamnese periódica
  são DUAS variáveis: `START_ANAMNESE` é a chave de BOOT (decide se o tick é
  agendado) e `ANAMNESE_ENABLED` é a flag de PRODUTO (decide se uma rodada nova
  pode acontecer) — o Psicólogo tem só a segunda, porque o gatilho automático
  dele é o fechamento de sessão, não um tick. `deploy/k8s/` fica de fora por
  COERÊNCIA e não omissão: um Deployment/ConfigMap não intercepta nada, e o
  `brabo-config` nunca carregou nenhuma destas variáveis; Staff dormente para
  disparo automático (acionável manual)
- `DEPLOY_ENABLED` não existe: trava `platform` em `planned` e mantém
  `secops-runtime` sem detecção/resposta/postmortem de incidente (mesmo
  gatilho ausente para os dois — ADR 0091/0092)
- `DEPLOY_ENABLED` não existe **e não nasce por decisão** (ADR 0153): dez
  documentos o citam como gatilho e as duas únicas ocorrências no código são
  comentários. Ele trava `platform` em `planned` e mantém `secops-runtime` sem
  resposta/postmortem de incidente (a DETECÇÃO já é `active`, por script — ADR
  0091/0092). O que o ADR 0153 fez foi separar as duas metades: o gate
  `deployavel` entrou no registro `gates.yml` (estava só no `fluxo.yml` — buraco
  do registro, não do deploy), e o resto é **ambiente**, não flag — a
  infraestrutura já está pronta (overlays, imagens no GHCR por digest, smoke/
  rollout/restore), falta alguém rodar e manter. A variável nasce no PR que
  tiver o primeiro consumidor real, nunca antes
- UX Designer: `teste-de-usabilidade` (exige usuário humano real) e
  `métricas-de-uso` (o funil mede sessão→commit→PR→merge, não adoção de
  feature pelos usuários finais do produto construído) ficam fora de
  alcance, declarado (ADR 0087/0089)

**Lacunas aceitas e declaradas:**
- **O Infra Lead propunha `container_start` às cegas; desde a RN-566 ele
  recusa por MODO, e o que sobra da lacuna é a IMAGEM.** A metade fechada:
  `dispatch_container_start/2` consulta LOCALMENTE o `execution_mode`
  (`Project.get/1`, mesmo processo BEAM, sem HTTP — rede no laço do agente
  era o que a correção não podia custar) antes de chamar `propose_action`, e
  projeto `runner` é recusado NOMEANDO `container_start_via_runner`. Não
  nasceu régua nova: a tool irmã já recusava (RN-508) e a `/containers` já
  ramificava por DESTINO (RN-521, `acaoDeSubidaDoModo`) — as duas tools
  passam pela MESMA `recusa_local_de_subida/2`, com uma CLÁUSULA cada, e a de
  `container_start` é lista de PERMITIDOS como a do broker (modo novo no enum
  nasce recusado). O custo que ESTE arquivo declarava — *"corrigir exigiria
  tocar o prompt/instrução do Infra Lead"* — foi MEDIDO e não se confirmou:
  nenhuma linha de prompt mudou, e o texto da recusa é o que o modelo lê como
  resultado de ferramenta (entrada do laço, RN-163, nunca `agent.error`).
  **A metade que SEGUE ABERTA:** nem as duas tools nem
  `GetInfraContextUseCase` sabem de IMAGEM DECIDIDA, então propor sem imagem
  continua possível em `container`/`mounted` — e ali a recusa por imagem
  inverteria a ordem, porque eleger a imagem é o que essa proposta FAZ
  (RN-491). A `/containers` checa as TRÊS coisas (imagem, modo, pasta
  confirmada) porque tem um humano clicando; o agente checa UMA. Enriquecer o
  contexto do Infra Lead com modo e presença de runner é frente à parte, mais
  cara. O ADR 0137 (RN-497) segue valendo: aprovar `container_start` em
  `mounted` pode dar certo de verdade, pelo broker
- Restart do engine com Dev Lead suspenso perde a inscrição no Wake (decisão
  segue visível em Aprovações) — ADR 0086
- A aba de Código abre com 492px de moldura à esquerda (sidebar 264 + trilho
  do projeto 180 + trilho do `CodeShell` 48), contra ~110px antes do ADR
  0126 — preço MEDIDO e aceito por remover o auto-colapso da RN-201.
  Recolher manualmente continua funcionando e ainda produz trilho do Shell
  ao lado do trilho do projeto: essa é uma escolha do USUÁRIO, não do
  sistema, e é a diferença que o ADR compra
- A navegação por abas do projeto existe em DOIS lugares — o trilho e a
  lista por projeto da sidebar (`LinhaDeAba`, RN-196). Pré-existente (a
  régua horizontal duplicava a mesma lista), só ficou visualmente paralela;
  reconciliar é decisão de produto à parte, não tomada no ADR 0126
- `gatesEverOpened` sofre da classe de defeito da janela de 200 eventos —
  declarado, não corrigido (exigiria mudar assinatura de `deriveAgentRoster`)
- Conversão de `execution_mode` nunca migra diff NÃO commitado — órfão no
  disco antigo (RN-447..450, ADR 0111). O órfão CONTINUA; o que mudou na
  RN-560 é que a tela parou de dizer o contrário: o aviso afirmava *"isto
  migra a pasta de trabalho do agente"* nos dois idiomas, e agora diz os três
  fatos separados (o que a conversão RECUSA, o que ela LEVA — a política do
  `permissions.json` —, e o que ela NÃO leva), NOMEANDO o caminho antigo, que
  some da tela assim que a conversão salva. Ele não promete detecção de diff
  (I/O por modo, impossível para `runner` do lado da api) e não lista TODAS as
  consequências — `mirrorPath` zerado, `workspaceVerifiedAt` nulo e container
  removido seguem ditos só no caso de uso e nas RNs. Migrar conteúdo entre
  modos continua fora, sem dono
- Mirror web de `SOLO_CONVERSATIONAL_AGENTS` sem teste cruzado com a api
  (pior caso: opção velha que o backend recusa com 400)
- `ExecutionModeSection` ENCOLHEU para o ramo `runner` (RN-559): converter para
  `mounted` abre o MESMO `FolderBrowserModal` da criação, com
  `origem: { tipo: 'api', workspaceId }` — mesmo componente, mesmo endpoint,
  nenhuma régua nova (quem valida o caminho continua sendo a api). O que segue
  aberto é converter para `runner`, que continua sem `RunnerOnboardingPanel` e
  sem navegador, digitado no escuro. Ficou fora da RN-473 de propósito, e a
  RN-559 NÃO reabriu: onboardar ANTES de a conversão salvar registra chave num
  projeto que ainda não é `runner`, e `ConfirmProjectWorkspaceUseCase` recusa a
  confirmação com 400; o transporte de navegador daquele ramo
  (`{ tipo: 'runner', projectId }`) exige um runner conectado a ESSE projeto,
  que só passa a existir depois da conversão, e a espera terminaria num erro
  com cara de bug. A ordem "converte, depois onboarda" é decisão de produto à
  parte, sem dono. O que a RN-559 acrescentou ali é a tela DIZER isso em texto,
  em vez de só não oferecer botão nenhum (ADR 0064)
- **A chave de dispositivo TEM tela desde a RN-561, e o que sobra da lacuna
  mudou de assunto.** A metade de api existe desde a RN-519
  (`RunnerDeviceKeysController` com `GET`, a revogada NA lista e `lastUsedAt`
  nulo como sinal da órfã da RN-473), e a de TELA — *"`apps/web` não tem onde
  listar nem revogar"* — FECHOU: a aba Configurações ganhou a 18ª seção
  (`device-keys`, grupo `pessoas`), que lista e revoga sem abrir rota nenhuma.
  A chave ÓRFÃ deixou de ser inalcançável: ela aparece com texto próprio
  ("nunca usada") e tem botão. NÃO "unifique" a régua de papel dela com a do
  `RunnerOnboardingPanel`: as duas usam a MESMA função
  (`podeLerChavesDeDispositivo`, mínimo `developer`, o do ENDPOINT), mas o
  INSUMO difere de propósito — o painel lê o papel de WORKSPACE e DECLARA a
  lacuna (ele monta onde não há `project_members`), a seção compõe o EFETIVO do
  projeto (`projectRole ?? workspaceRole`, RN-471) porque mora na mesma aba que
  `MembersSection` e o dado está à mão. As duas compartilham a `queryKey`
  `['runner-device-keys', projectId]`, e é por isso que revogar pela seção
  invalida o reconhecimento do painel — mexer numa das duas sem a outra faz o
  painel anunciar máquina pareada com a chave recém-revogada.
  Desde a
  RN-543 essa lista devolve DUAS espécies e DIZ qual é qual (`especie`) — uma
  de máquina serve todo projeto do dono e aparece na listagem de todos, porque
  não aparecer em nenhuma a tornaria invisível e permanente, que é o defeito
  que a RN-519 fechou renascido. A marca é o que a tela USA: a confirmação de
  revogar muda com a espécie (máquina derruba o agente local em TODOS os
  projetos do dono em modo runner; projeto derruba no projeto dela), e sem ela
  a tela mentiria sobre o alcance da única ação irreversível que oferece.
  As DUAS metades de criar uma chave de máquina já
  existem: o MATERIAL nasce no terminal (RN-551, `brabo-runner device-key
  create`, par gerado na máquina) e quem REGISTRA a pública é a RN-552
  (`POST /internal/machine-device-keys`, pelo service token).
  **O que segue aberto, e agora é só isto:** (1) numa instalação que ainda não
  tem PROJETO, a listagem e a revogação — as duas por
  `/projects/:projectId/runner-device-keys` — não têm projeto contra o que
  responder, então nem a seção nova alcança uma chave de máquina recém-criada;
  fazer a tela ser de CONTA exigiria rota nova, e não é o que a RN-561 fez. É por
  isso que registrar SUBSTITUI a anterior em vez de deixar órfãs: uma órfã ali
  seria viva e inalcançável. E a rota só serve instalação de UMA pessoa (409 com
  duas ou mais), então instalação com time não tem por onde criar chave de
  máquina — declarado, não acaso. (2) O ALVO da revogação continua sendo
  `{projeto, usuário}` e NUNCA `{chave}` (RN-520): a tela DIZ isso na
  confirmação e não muda: outro runner seu no mesmo projeto cai junto, mesmo
  com PAT ou outra chave, e reconecta se a credencial ainda valer. Mudar o
  alvo exige coluna nova em `runner_socket_tickets` e contrato novo de auth —
  frente própria, com ADR. (3) A visão de `maintainer` (listar/revogar de
  qualquer usuário) segue FORA por DECISÃO da RN-519, não por omissão.
  Desde a RN-548 o web também CONSOME essa
  listagem para outra pergunta — `RunnerOnboardingPanel` reconhece máquina já
  pareada e para de mandar parear —, e ler para RECONHECER continua sendo outra
  coisa que listar para REVOGAR: o painel de propósito não lista chave nem
  oferece revogação, e não passa a listar agora que a seção existe.
  O que ele diz é o CUSTO da espécie (revogar derruba o agente em
  todos os projetos do dono), e o que ele NUNCA diz é que o agente está de pé:
  chave registrada prova pareamento e não processo vivo — a régua do
  `workspaceVerifiedAt` (RN-468) um passo antes —, e a lista é da CONTA e não
  do navegador, então nem "esta máquina está pareada" cabe. A seção nova herda
  esse vocabulário INTEIRO em vez de inventar um segundo: `lastUsedAt` é uso
  registrado, "ativa"/"revogada" fala da LINHA e nunca de conexão, e a espécie
  de máquina nunca ganha verde. É por essas duas
  ressalvas que o fluxo do ADR 0118 NÃO foi removido: ele muda de LUGAR (um
  `<details>` com o rótulo do caso que resolve), e aposentá-lo segue sendo o
  BRB-031
- **A credencial de git NÃO atravessa o container do runner, e o caminho
  COMUM é justamente esse — mas desde a RN-558 ele FALHA DIZENDO ISSO.** A
  geometria não mudou e não muda de passagem: `RunnerReadiness` (RN-507)
  exige container `running` REGISTRADO antes de QUALQUER operação de
  `RunnerGit` — inclusive o `git fetch` autenticado inicial —, a ÚNICA
  forma de esse registro existir num projeto `runner` é o MESMO runner ter
  subido o próprio container, e é esse mesmo sucesso que marca
  `estado.containerAtivo` nele; `tratarExec` roteia pra dentro do container
  (sem campo de `env`, ADR 0130: sem `-e` livre) sempre que `containerAtivo`
  está setado, e só usa o caminho HOST (que carrega a credencial) quando
  está `null`. O que a RN-558 fechou foi a METADE do SILÊNCIO: esse par
  (`env` presente + container ativo) deixou de EXECUTAR — rodava com o
  helper instalado e as variáveis vazias, e a falha chegava como token
  inválido ou rede fora — e passou a ser RECUSADO com desfecho nomeado
  (`MARCA_DE_CREDENCIAL_NAO_ENTREGUE` em `index.ts`, reconhecida por
  `Engine.Runners.CredencialDeGit` no engine), origem `politica` e não
  `codigo`, e evento durável. Quem recusa é o RUNNER, e SÓ ele pode:
  `containerAtivo` nasce `null` a cada execução e um container `running`
  REGISTRADO no banco NÃO implica container ativo naquele processo (runner
  reiniciado com o container de pé roteia pro HOST, e ali a credencial
  chega) — não suba essa checagem para `RunnerReadiness`, que fica byte a
  byte como está. A marca é constante de PROTOCOLO partida entre duas
  linguagens, com guarda em
  `scripts/ci/marca-de-credencial-do-runner.spec.ts`. **A METADE que segue
  ABERTA:** a credencial continua sem atravessar o `docker exec`, então
  clone/fetch de repositório REMOTO AUTENTICADO em modo `runner` só funciona
  com o container parado. Fechar exige decidir COMO uma operação credenciada
  fala com um `docker exec` sem campo de `env`, e toda opção conhecida mexe
  na porta de contenção do ADR 0130 — é ADR, nunca correção de passagem.
  Adjacência medida e NÃO corrigida: a recusa acontece depois de
  `init_from_bare!` já ter feito `git init`, e o `git_dir?` de `ensure!`
  marca o workspace pronto numa tentativa seguinte — a segunda tentativa
  falha adiante, no `worktree add`, em vez de repetir a recusa (defeito
  PRÉ-EXISTENTE da idempotência, vale para qualquer `fetch` que falhe).
  Repositório `local` (sem credencial), os modos `container`/`mounted` e o
  `workspace_create` (roda no HOST) não são afetados
- **O `install.sh` publicado NÃO sobe nada sozinho numa máquina limpa** — medido
  na RN-549. Ele usa `docker compose -f docker/docker-compose.install.yml`, um
  caminho RELATIVO ao diretório de onde roda, e esse arquivo NÃO é asset da
  Release, NÃO entra no `checksums.txt` assinado e **ele não o baixa em lugar
  nenhum** (as únicas descargas são o `cosign`, o manifesto, o próprio hash e o
  binário do runner). Com o `./postgres/init.sql` que o compose bind-monta, são
  TRÊS arquivos. Quem segue o `sh -c "$(curl … install.sh)"` do runbook morre em
  "no such file or directory" DEPOIS de já ter verificado assinatura, escolhido a
  base e gravado o `.env` — a saída de hoje é rodar o instalador de dentro de um
  checkout na tag. Corrigir é decidir entre publicar o compose como asset
  ASSINADO (RN-524) e fazer o instalador clonar: entrega própria, com ADR, nunca
  de passagem. O `install-e2e.yml` traz os três à mão num passo que DIZ que é
  achado, e `scripts/dev/install-e2e.spec.ts` cobra as duas metades
- `install --machine` não sabe se a chave daquela pasta é mesmo de MÁQUINA — em
  disco as duas espécies são o mesmo arquivo (uma JWK com `kid`), e quem sabe é o
  SERVIDOR. Uma pasta com chave de projeto instala a unit sem erro, e a recusa só
  chega no primeiro boot. Declarado desde a RN-545; o que mudou com a RN-547 é
  que passou a existir um caminho que CRIA uma de máquina ali, então a recusa
  deixou de ser o desfecho provável
- `guard.ts` do runner é best-effort por invariante, não lacuna
- Exclusividade por `{project_id, machine_id}` adiada até segundo dev
  simultâneo real
- dbre: `plano-de-capacidade` e `tuning` sem prazo (exigem volume real)
- Métricas permanentemente "não medido": funil ideação→commit, adoção por
  feature, MTTR/change failure rate (ADR 0089/0091/0092)
- Dívida de contraste do tema ESCURO travada por número (ADR 0074)
- Gasto de embedding fora do metering (corte declarado do ADR 0075)
- Painel de Problemas/lint/testes na aba Código segue pendência declarada da
  FASE 26 — nunca entrou (terminal, blame, lista de PRs e virtualização já
  fecharam depois)
- Chunking do RAG (1200 caracteres/150 de sobreposição) e pesos da busca
  híbrida (0.6/0.4, limiar 0.2) seguem sendo PONTO DE PARTIDA — ainda NÃO
  calibrados (ADR 0080). O que mudou desde a Etapa 1 é que agora dá para
  calibrar: a busca deixa rastro (`rag_searches`/`rag_feedback`, RN-479/480) e
  `pnpm --filter api medir:rag` lê esse rastro. O que mudou desde a Etapa 2
  (ADR 0132) é que existe um corpo de 17 perguntas medindo ACERTO de
  retrieval — mas é um corpus CURADO (22 arquivos, não os 130+ ADRs reais) e
  mede se o arquivo certo aparece, não se os PESOS estão certos; mexer nos
  quatro números antes de acumular medição de verdade continuaria destruindo
  a linha de base que os dois instrumentos juntos existem para criar (Etapa 5
  é a única que calibra, e só se a medição comprovar que ajuda). O que mudou
  desde a Etapa 3 (ADR 0138, RN-498) é só ONDE o golden-set roda — em CI
  agora, agendado, além de manual — nunca O QUE ele mede nem o corpus que
  usa; corpus curado e calibração continuam exatamente como estavam
- `rc/rcfix` (ADR 0030) e preferência de moeda com taxa manual seguem no
  backlog original da FASE 13c, sem revisão desde então
- Pull de modelo Hugging Face roda o download inteiro de forma SÍNCRONA
  dentro do request HTTP — a api não tem fila própria; corte declarado,
  candidato a ADR quando o volume de pulls justificar (ADR 0115)

**Pendências com dono humano (TODO(humano) vivos):**
- Smokes de LLM: 5 de 6 providers sem credencial no ambiente (só OpenRouter
  rodou real); `GITHUB_TEST_TOKEN`/`GITLAB_TEST_TOKEN` idem para git
- `NPM_TOKEN` não configurado — `publish-runner.yml` avisa e pula
- Binário standalone: DOIS dos cinco alvos chegam à Release. `v4.0.1` e
  `v5.0.0` anexam `brabo-runner-linux-x64` e `-linux-arm64` (medido com
  `gh release view`) — a corrida com o `release.yml` que derrubava o anexo na
  `v4.0.0` FOI corrigida, com espera de teto 600s em
  `build-runner-binaries.yml`. O que falta são os outros três, e são TRÊS
  causas distintas, não uma: `win32-x64` e `darwin-arm64` reprovam no BUILD
  por motivo próprio de plataforma (o `.node` do `node-pty` fora de
  `build/Release`; `--self-test-pty` com `posix_spawnp failed`), e as duas
  correções JÁ ESTÃO na `dev` (`apps/runner/scripts/build-bin.mjs`), nunca
  exercitadas — o que falta aí é uma TAG, não uma sessão. `darwin-x64`
  (`macos-13`) é o único que nunca chegou a construir: ele fica **24h00m01s**
  na fila e é cancelado, o MESMO número nas três tags, que é o teto do
  Actions batendo — ou seja, o job NUNCA FOI AGENDADO. A hipótese "fila
  congestionada" está descartada pela ordem de grandeza; a que sobra é label
  sem runner, e decidir entre trocar o label, tirar a plataforma (a promessa
  vira quatro alvos, em ADR novo) ou pagar runner é decisão de dono
- i18n Onda 6b NÃO fechou: corpo de `docs/business-rules.md` 100% pt-BR +
  fatia residual de `.tsx`; ao fechar, revisar Stack/Documentação deste
  arquivo para inglês como idioma primário
- Golden-set de regressão do julgamento semântico do QA de Automação (ADR
  0123) existe e roda manualmente (`mix golden_set.qa`, dentro de
  `apps/engine`) contra Ollama local — nunca em CI. Ligar em CI exige
  segredo de LLM de API OU infra nova (runner com GPU, passo de pull do
  Ollama): decisão de um humano, não algo que se constrói escolhendo
- Golden-set de acerto do RAG (ADR 0132, RN-490) — a metade "nunca em CI"
  FECHOU na Etapa 3 (ADR 0138, RN-498): `.github/workflows/golden-set-rag.yml`
  roda `mix golden_set.rag` de verdade, agendado (o gate `rag-acertivo`
  continua `warn`, agora por cadência, não por falta de CI). O que segue
  pendência de dono humano é só a outra metade: medido de verdade (17/17,
  duas rodadas manuais antes disso, determinístico), piso gravado em
  `floor.json` — mas contra um corpus CURADO (22 arquivos), não os 130+
  ADRs reais do produto; ampliar o corpus é decisão de custo de embedding
  numa rodada manual, não escolhida aqui

**Backlog:** `docs/explanation/backlog.md` é a triagem da FASE 13c e é
HISTÓRICA — não a leia como fila viva. Medição de 2026-09-12: pelo menos DOZE
itens que ela ainda apresenta como abertos já não reproduzem (o isolamento do
executor, o schema por agregado, o golden-set do gate semântico, o backup de
`git_local_repos`, o compose de instalação, "FASE 29 é planning-only", o
Dependabot, duas lacunas do runbook, a severidade dos alertas, e mais). O
defeito é de CADÊNCIA e não de conteúdo: fases foram fechadas sem ninguém
voltar ali marcar. A fila viva é o backlog do mantenedor; este arquivo guarda
o RACIOCÍNIO da triagem, que continua valendo.

## Stack (decidida — não proponha alternativas)
- `apps/api`: NestJS 11 + Drizzle ORM + PostgreSQL 16 + pgvector;
  `nodemailer` para SMTP real do `MailSender` (ADR 0096), atrás de
  `MAIL_TRANSPORT` — `log` continua o default, inclusive em produção;
  `neo4j-driver` para o grafo de conhecimento (ADR 0099) — memória
  DERIVADA do event log, nunca fonte de verdade; pgvector CONTINUA sendo
  o índice vetorial dos chunks, o grafo não guarda embedding
- `apps/engine`: Elixir/OTP + Phoenix (canais) + Oban (filas no Postgres)
- `apps/web`: React 19 + Vite + TanStack Query/Router; `react-i18next`+
  `i18next` (fundação de i18n, RN-425) atrás de `lib/i18n.ts`/`lib/idioma.ts`
  — `en` é o idioma default, `pt-BR` mantido, servidor é a fonte de verdade
  (`localStorage` só evita flash no primeiro paint); `mermaid` (runtime,
  ADR 0068) para o diagrama C4 do Arquiteto, isolado atrás de
  `lib/mermaid-render.ts` com `import()` dinâmico; `@xterm/xterm` +
  `@xterm/addon-fit` (ADR 0103) para o terminal interativo do runner
  local, isolado atrás de `lib/xterm-runtime.ts` com `import()` dinâmico
- `apps/runner`: workspace novo, Node/TS — CLI (`brabo-runner`) que roda
  na máquina do usuário, conectando ao engine via canal Phoenix (`phoenix`,
  embutido no bundle) para executar comandos aprovados e terminal
  interativo (`node-pty`, único `external` do build `tsup` — binding
  nativo, resolvido via `node_modules` de quem instalou o pacote) — ver
  "Runner local" (ADR 0103). Desde a RN-514 (ADR 0147 ponto 1) o `join`
  desse canal NÃO é mais mudo: o runner DECLARA nos params o que sabe
  fazer (`CAPACIDADES_DO_RUNNER` em `channel.ts` — desde a RN-516 as TRÊS,
  `exec`, `pty` e `espelho`, e só o que ele implementa de verdade) e o
  servidor CONCEDE a interseção com o vocabulário que conhece
  (`Engine.Runners.Capacidades`), guardando o conjunto em `socket.assigns`
  e NUNCA em tabela. Params ausentes/vazios são o binário LEGADO e valem
  `{exec, pty}` — fato, não suposição —, nome desconhecido é IGNORADO, e
  capacidade EXIGIDA e não declarada recusa o join NOMEANDO a que falta.
  Quem exige: o `execution_mode` (`runner` exige `exec`;
  `container`/`mounted` não exigem nada) e, desde a RN-516, o DADO
  `projects.mirror_path` — destino de espelho declarado EXIGE `espelho`,
  em qualquer modo. Essa é a primeira exigência que DISPARA de verdade, e
  o custo está declarado no ADR: binário velho num projeto com destino
  deixa de conectar (recusa nomeada, fatal, sem retry), e é opt-in.
  Mensagem cuja capacidade não foi concedida é RECUSADA com resposta
  nomeada — nunca entregue a um handler que não existe do outro lado, que
  era o defeito silencioso que o ADR 0147 nomeia. A resposta do `join`
  também deixou de ser vazia para o `:runner`: é por ela, e SÓ por ela,
  que o DESTINO do espelho chega (`%{espelho: %{destino: ...}}`, ADR 0147
  ponto 4) — nunca configuração local nem variável de ambiente, e o runner
  recusa `mirror_sync` para destino que não lhe foi concedido NAQUELA
  conexão; trocar o destino com o runner de pé exige reconectá-lo. O
  espelho em si (`espelho.ts`/`espelho-guard.ts`) copia a LISTA DO GIT
  numa direção só e NUNCA apaga — arquivo apagado na origem permanece no
  destino —, com guarda IRMÃ de `guard.ts` (mesma dupla passada, mesma
  ressalva de TOCTOU), e é disparado por MOMENTO NOMEADO do engine
  (`mirror_sync`, hoje o commit), nunca por watcher. TRÊS caminhos de
  distribuição: clonar o
  monorepo (dev), `npm install -g @brabo/runner` via `tsup` + `npm publish`
  (ADR 0106), e binário standalone via `bun` (`bun build --compile`, ADR
  0112) — o `.node` nativo do `node-pty` embutido por `with { type: 'file'
  }` e extraído para um diretório real em runtime, já que `node-pty`
  resolve seu próprio addon por um `require()` de caminho COMPUTADO que o
  Bun não consegue embutir sozinho. Desde a RN-518 (ADR 0147 ponto 5) ele
  também se INSTALA — `brabo-runner service install|uninstall|status`, nível
  de USUÁRIO sempre (`systemd --user`/`LaunchAgent`), com root RECUSADO e
  Windows recusado por NOME; `Restart=on-abnormal` e
  nunca `on-failure` (exit 1 é recusa fatal de join ou teto esgotado, e
  reiniciar seria o laço que o CLI recusa fazer), autenticação por CHAVE DE
  DISPOSITIVO e nunca por token (uma unit com token o deixaria em disco), e
  `status` com QUATRO estados e quatro códigos de saída — a primeira resposta
  vem do DISCO, então ela continua certa numa máquina sem gerenciador. Desde a
  RN-545 (ADR 0154 ponto 4) são DUAS ESPÉCIES de unit e elas CONVIVEM: a de
  PROJETO (`brabo-runner-<projectId>.service`/`dev.brabo.runner.<projectId>`,
  byte a byte como sempre) e a de MÁQUINA (`brabo-runner.service`/
  `dev.brabo.runner`, sem sufixo), que roda o modo de N conexões da RN-544. Os
  nomes não colidem por CONSTRUÇÃO (`projectId` nunca é vazio, então o de
  projeto sempre tem um `-` onde o de máquina termina), e isso é travado por
  teste. O discriminador é a flag `--machine` e NUNCA a ausência de
  `--project` — o ADR dizia o contrário e foi MEDIDO: `resolverProjeto` tem
  DUAS fontes, e o caminho normal é rodar `install` sem flag de dentro da pasta
  que o navegador configurou, então a letra do ADR converteria em silêncio a
  instalação de quem já usa o produto. `install --machine` RECUSA sem base
  consentida, sem chave, e quando a pasta tem `brabo-runner.config.json` (o
  serviço subiria em modo de PROJETO, em silêncio, atendendo um só), e a unit
  congela `XDG_CONFIG_HOME` mas NUNCA o valor da base — trocar a base é editar
  o arquivo e reiniciar, nunca reinstalar. `install` também RECUSA quando a
  OUTRA espécie já está instalada, nomeando o `uninstall` de cada unit, sem
  remover nem gravar nada e sem `--force`: as duas juntas seriam dois processos
  disputando o mesmo projeto. `status` responde sobre a espécie PERGUNTADA (os
  quatro códigos NÃO viram oito nem se somam) e diz em TEXTO que a outra
  existe, como presença lida do DISCO; sem `--machine` e sem projeto resolvível
  ele cai na MÁQUINA. `uninstall` NÃO herda esse default e recusa listando o
  que existe — ler a espécie errada custa uma linha, remover a errada custa um
  serviço e uma chave.
  Desde a RN-529 (ADR 0151 pontos 1 e 2) ele também pode nascer com uma
  BASE — a pasta da máquina do usuário sob a qual cada projeto é uma
  SUBPASTA. Ela é LOCAL e NUNCA chega pela rede (o desenho do broker, ADR
  0144: quem tem a raiz é quem executa, e o que viaja é o SEGMENTO
  relativo), vem de `--base` ou de `$XDG_CONFIG_HOME/brabo/runner.json`
  (senão `~/.config/brabo/runner.json`, a precedência que `servico.ts` já
  usa) — nunca do `brabo-runner.config.json`, que é POR PROJETO e escrito
  pelo navegador, e nunca de variável de ambiente, que colidiria com
  `BRABO_PROJECTS_BASE` (a base do lado SERVIDOR, ADR 0141) e não
  sobreviveria a uma unit de serviço. `--dir` NÃO muda de significado e a
  base NÃO entra na validação dele: é a proibição de
  `project-workspaces-root.ts` transposta — projeto legado fora da base
  segue válido, e a base é regra de CRIAÇÃO. `base-guard.ts` é o TERCEIRO
  irmão de `guard.ts`, reusando os três helpers, a dupla passada e
  `validarDirDentroDoHomeNoLinux` inteira, e o laço dele é ASSIMÉTRICO (a
  pasta do projeto dentro da base é o arranjo normal; a base dentro da
  pasta do projeto é o defeito). Recusa vinda da FLAG sai com código 2;
  vinda do ARQUIVO é dita e o runner segue SEM base. Ausente é o estado
  normal. Desde a RN-532 (ADR 0151 pontos 3–6) a base tem CONSUMIDOR: o par
  `workspace_create`/`workspace_create_result`, no molde de PEDIDO COM
  RESPOSTA de `exec`/`exec_result` — e nunca no de `workspace_confirm`, que
  é UNIDIRECIONAL. O engine manda `projectId` e o SEGMENTO relativo (nunca
  caminho absoluto); o runner faz `mkdir -p` e `git init`/clone, e a
  confirmação REUSA o `workspace_confirm` que já existia — **nenhuma rota
  nova de gravação nasce**, o engine continua não escrevendo a tabela, e o
  único caminho que carimba `workspace_verified_at` continua sendo um só.
  A ORDEM é o mecanismo (confirm ANTES do resultado: os dois chegam ao mesmo
  processo de canal em ordem, e o handler do confirm é síncrono). A QUARTA
  capacidade, `workspace`, é a única cuja declaração depende do ESTADO da
  execução e não da versão do binário — só é declarada com base consentida,
  e é por ela, e por mais nada, que o servidor sabe que existe base; ninguém
  a EXIGE no join (runner sem base conecta normalmente e só perde essa
  mensagem, recusada com resposta NOMEADA). `estado.dir` NÃO muda com isso:
  trocar em runtime a raiz que `guard.ts` usa moveria uma fronteira de
  contenção por causa de uma mensagem de rede. Criar a pasta NÃO é
  `proposed_action` — é configuração consentida (a linha da RN-516).
  `--project`/`--dir`/`--token` são
  OPCIONAIS quando a pasta tem `brabo-runner.config.json` e a chave de
  dispositivo gravados pelo fluxo do navegador (RN-464..466, ADR 0118):
  o navegador gera um par Ed25519 (Web Crypto), registra a chave pública
  como `runner_device_keys` e grava os três arquivos numa pasta via File
  System Access API (fallback de dois downloads fora do Chromium) —
  `POST .../runner-ticket` aceita essa chave como segunda credencial de
  dispositivo, ADITIVA ao PAT (ADR 0105), nunca um substituto. Desde a RN-551
  (ADR 0155 ponto 4) o navegador NÃO é mais o único gerador: `brabo-runner
  device-key create` gera o par NA MÁQUINA e `device-key finish --id <id>`
  carimba o `kid`. São DOIS comandos porque o `kid` É o id do registro no
  SERVIDOR (RN-475) e só existe depois dele — o `create` grava um `.parcial`
  que `lerChaveDeDispositivo` NÃO procura, então o arquivo que o runner lê
  nunca existe sem `kid`. O CLI NÃO fala com a api, e a razão é de SEGREDO:
  quem registra é o instalador, com o `BRABO_SERVICE_TOKEN` — cada lado guarda
  UM segredo e nenhum vê o do outro; o que atravessa é a JWK PÚBLICA e o id.
  Destino padrão `$XDG_CONFIG_HOME/brabo/` (senão `~/.config/brabo/`), modo
  600, REUSANDO a precedência de `base.ts` (`pastaDeConfiguracaoDoBrabo`,
  extraída e nunca copiada) — e isso não reabre a porta do ADR 0104 Onda 2:
  `device-key.ts` continua lendo só do `cwd` que o chamador passar, e quem
  aponta para lá é o `--dir` da unit de máquina. `stdout` carrega UM valor numa
  linha (a pública no `create`, o caminho no `finish`) e todo o resto é
  `stderr` — é o contrato do `$(...)` do instalador. Sobrescrever chave
  COMPLETA é recusado, sem `--force`. Desde a
  RN-544 (ADR 0154) `--project` é opcional por um SEGUNDO caminho, e só por
  ele: o agente de MÁQUINA roda SEM `--project`, consulta
  `GET /runner/projects` e abre **UMA conexão por projeto** listado, cada uma
  em `<base>/<workspaceDirName>` pelas guardas de sempre
  (`resolverPastaDoProjetoNaBase` + RN-434/435 — nenhuma régua nova). Ele exige
  as DUAS coisas, credencial de MÁQUINA e BASE consentida, e sem base rodar sem
  `--project` continua caindo em `uso()`; o modo com `--project` fica BYTE A
  BYTE. Nada no engine muda (tópico, socket id e ticket descrevem uma CONEXÃO),
  e o espelho/`workspace_create` também não — os dois já viajavam na concessão
  do `join` DAQUELA conexão, que é o que os torna corretos com N. O que MUDA de
  comportamento é o laço: o teto de tentativas e a recusa de join deixam de ser
  do PROCESSO e passam a ser do PROJETO — um projeto que recusa ou esgota
  encerra sozinho e NOMEADO, os demais seguem, e só quando NENHUM sobra o
  processo sai com 1, listando o desfecho de cada um. A lista é consultada UMA
  vez, no start — MAS só COM conexão viva (RN-550, ADR 0155 ponto 5): a regra é
  ASSIMÉTRICA de propósito. Com conexão de pé, repesquisar faria uma lista que
  volta MENOR (apagado? convertido? 500 transitório?) derrubar conexão VIVA por
  ambiguidade; com ZERO conexões não há nada a derrubar nem ambiguidade
  nenhuma, então lista VAZIA deixou de SAIR com 0 e passou a ESPERAR —
  reconsulta a 15s/30s/60s (o último se repete), PARA na primeira lista
  não-vazia, sem teto de espera e com teto de DEZ falhas seguidas (saída 1
  nomeando o número; qualquer resposta, vazia inclusive, zera o contador). É o
  caso da instalação nova, e o argumento do `exit 0` caiu junto com a premissa
  dele ("um serviço ativo que não faz nada"): ele reconsulta e DIZ isso, com
  batimento a cada 30 consultas. `Restart=on-abnormal` NÃO muda em unit nenhuma
  (ele nunca olhou código de saída) — o efeito é a unit de MÁQUINA ficar
  `active (running)` de verdade. Exceção declarada: lista NÃO-vazia com TODOS
  os projetos recusados continua saindo com 1, porque ali cada recusa nomeia um
  defeito local com conserto próprio. N conexões exigem N
  `EstadoDoRunner`, e o motivo é medido: quatro campos dele são POR PROJETO
  (`dir`, `canalAtual`, `containerAtivo`, `destinoDoEspelho`) mais o
  `gerenciadorPty`, que nasce de `dir` — um estado compartilhado faria o
  `docker exec` de um projeto rodar no container de OUTRO; `docker` e `base`
  são da MÁQUINA e entram como o MESMO valor em todos, nunca cópias. E o runner
  NÃO adivinha a espécie da própria chave (em disco as duas são o mesmo
  arquivo, uma JWK com `kid`): quem sabe é o SERVIDOR, e o 403 dele é repassado
  NOMEADO, com o conserto. Desde a
  RN-543 (ADR 0154) essa chave tem DUAS espécies, numa tabela só:
  `runner_device_keys.project_id` preenchido é a chave de PROJETO do fluxo
  acima, e NULO é a chave de MÁQUINA, que vale para qualquer projeto em que
  o DONO dela alcance o papel que a rota já exige. A comparação que impede
  a chave do projeto A servir o projeto B NÃO foi apagada — ela some SÓ
  para `null`, onde não há o que comparar, e aí o papel se resolve contra
  o projeto PEDIDO. Nenhum teto novo, nenhum afrouxado: a chave de máquina
  não dá ao runner nada que o dono dela já não tivesse. `user_id` continua
  `NOT NULL` (o ADR recusa chave que atravesse usuários), e `GET
  runner/projects` — a PRIMEIRA rota de credencial de dispositivo SEM
  `:projectId` no caminho, e por isso exclusiva da espécie de máquina — é
  como o agente DESCOBRE os projetos que atende, em vez de adivinhar por
  nome de pasta. Nada no engine mudou: o tópico, o socket id e o ticket
  descrevem uma CONEXÃO, e N conexões os satisfazem byte a byte. O `id` do
  registro vai gravado DENTRO da JWK privada, no `kid` (RN-475): é o único
  vínculo entre o arquivo em disco e a pública do servidor, e a cadeia
  inteira só o REPASSA — o runner lê `jwk.kid`, o JWT de ticket o leva no
  header, o `PatAuthGuard` acha a pública por ele. Ninguém deriva esse id
  de outra coisa. E o CLI distingue chave AUSENTE (caminho normal de quem
  usa flags, cai no bloco de uso) de chave PRESENTE e recusada (mensagem
  própria, nomeando arquivo e motivo) — colapsar os dois é o que fez um
  bug de uma linha custar uma caçada. Docker mora atrás de uma PORTA de
  CINCO operações (`packages/docker-port`, ADR 0130 — ela NASCEU em
  `apps/runner/src/` e MOVEU quando o broker virou o segundo consumidor:
  `start`/`stop`/`remove`/`inspect`/`exec`), implementada sobre
  `execFile('docker', …)` do `node:child_process`
  — ZERO dependência nova, e por decisão medida, não por gosto (ADR 0128):
  `dockerode` foi instalado e provado contra os artefatos, e o
  `bun build --compile` reprovou resolvendo o `.node` de `cpu-features`, que
  a árvore SSH de `docker-modem` arrasta mesmo quando só se fala com o
  socket unix. O broker NÃO herdou a escolha por herança técnica (ele nunca
  vira binário) e sim por decisão: um mecanismo, não dois. A contenção é o
  TIPO: sem campo para `privileged`/`cap_add`, rede é a união
  `'none' | 'egress'`, e o bind é UMA pasta de tipo MARCADO com destino
  constante — não há lista de mounts. `pidsLimit` entrou na spec no ADR 0130,
  porque o artefato do Arquiteto sempre teve três números e descartar um faria
  ele prometer um teto que o container não recebe. Do lado do RUNNER, essa
  porta deixou de ser só provada por `--self-test-docker` (ADR 0112/0128) e
  ganhou uso real:
  `container_start`/`container_stop`/`container_remove` (ADR 0137,
  RN-497), três pares novos no canal Phoenix (mesmo molde de
  `exec`/`exec_result`), fazem `DockerViaCli.start/stop/exec` de
  verdade, com o Docker do PRÓPRIO usuário — para projeto
  `mounted`/`runner`, que o broker nunca alcança (a pasta mora numa
  máquina que o servidor não enxerga). Desde a RN-507 (ADR 0145), Docker é
  PRÉ-REQUISITO real do modo `runner` — sem container `running`
  REGISTRADO, `TerminalExecutor` recusa e nem chega a mandar comando pro
  canal — e o par `exec`/`exec_result` ganha um campo `env` opcional
  (`Record<string,string>`) para a credencial de git (ADR 0056) viajar
  no ambiente do processo filho que `apps/runner/src/exec.ts` spawna no
  HOST do usuário: mesclado sobre `process.env` (nunca substitui —
  perderia PATH), nunca repassado ao `docker exec` (a porta de Docker não
  ganhou campo de `env`, de propósito) e nunca logado. Desde a RN-558,
  "nunca repassado ao `docker exec`" deixou de significar "roda sem a
  credencial": com container ativo, um `exec` que carrega `env` é RECUSADO
  com desfecho nomeado — ver a lacuna em "Estado atual e aberto", cuja
  metade do `env` segue aberta
- `apps/broker`: workspace novo, Node/TS — o ÚNICO processo do produto que
  fala com um daemon Docker no SERVIDOR (ADR 0130), e o único serviço com
  `/var/run/docker.sock` montado. Não monte esse socket em mais nenhum. Sem
  framework web (são seis rotas, `node:http` puro), imagem própria em
  `docker/broker/`, e o binário `docker` DENTRO da imagem (`docker-cli`, só o
  cliente) — preço declarado da decisão de usar um mecanismo só dos dois lados.
  **Ele não aceita especificação de container**: recebe um `projectId` e uma
  das cinco operações da `DockerPort`, vai à api LER a decisão do Arquiteto
  (`GET /internal/projects/:projectId/container-spec`) e COMPÕE imagem, rede,
  recursos e o único mount. Não existe campo em que se escreva `privileged`,
  `cap_add`, `network: host` ou um `-v` livre — se a spec viajasse no corpo, a
  contenção de um processo root-equivalente no host dependeria de o CHAMADOR
  estar correto. A api NÃO manda caminho nenhum (o `-v` é resolvido pelo daemon
  contra o filesystem do HOST; um caminho de dentro do container da api montaria
  uma pasta VAZIA). Desde o ADR 0144 (RN-503) ele tem DUAS raízes —
  `PROJECT_WORKSPACES_HOST_ROOT` (a pasta GERENCIADA, modo `container`) e
  `BRABO_PROJECTS_HOST_BASE` (a base dos projetos MONTADOS, derivada de
  `BRABO_PROJECTS_BASE` no compose, ADR 0141) — e ele NÃO adivinha qual usar: a
  api manda um localizador DISCRIMINADO (`localizacao`: `gerenciada` |
  `montada` | `indisponivel`) dizendo contra qual raiz o SEGMENTO relativo
  vale. O invariante é o mesmo de sempre — o que atravessa a rede continua
  sendo só a metade que a raiz do broker não cobre. `start` recusa NOMEANDO a
  raiz que falta, e NUNCA cai na outra: a gerenciada é nomeada por
  `workspace_dir_name` e a base é nomeada pelo usuário, então o mesmo nome
  aponta para pastas diferentes e o container subiria com o código de outro
  projeto. Ele atende `container` E `mounted`, e recusa `runner` (a pasta mora
  numa máquina que este host não enxerga); a lista é de PERMITIDOS, então modo
  novo no enum nasce recusado com mensagem. Contenção em cinco camadas
  independentes — sem porta publicada, rede `internal: true` que só a api
  alcança, `BRABO_SERVICE_TOKEN` em tempo constante, cinco operações, spec
  computada. Desde a RN-512 (ADR 0146) sobe POR PADRÃO no compose local e
  permanece sob `profiles: ["container-broker"]` no de produção — a divergência
  entre os dois arquivos é a decisão, não descuido; a imagem dele NÃO é
  publicada no GHCR (as quatro do ADR 0119 seguem sendo quatro). A imagem de
  DEV instala as dependências no BUILD e NUNCA em runtime, e isso é
  consequência direta da rede: sem egress não há registry alcançável, e a
  resposta a "o corepack/pnpm não baixa" é SEMPRE tirar o registry do caminho
  quente (`COREPACK_HOME` preparado no build, com o dono do uid de runtime;
  `pnpm install` como passo de build), NUNCA dar rede ao serviço. Os TRÊS
  volumes nomeados de `node_modules` são montados por cima do que a imagem
  instalou, e o Docker só semeia volume VAZIO — então
  `docker/broker/entrypoint.sh` reconcilia os três contra uma cópia guardada
  FORA de `/workspace`, carimbada com o sha256 do `pnpm-lock.yaml` do build:
  mexer numa dependência do broker exige `up -d --build broker`, e o
  entrypoint AVISA quando a imagem ficou para trás em vez de recusar subir. O
  serviço tem healthcheck (`wget` contra `127.0.0.1:8090/health`, de DENTRO —
  ele não publica porta): sem ele, `up --wait` dava `Healthy` a um container
  que morria cinco segundos depois, e foi assim que a queda chegou a ser
  anunciada como "reset completo"
- `packages/docker-port`: a porta de Docker e o adaptador de CLI, consumidos
  por `apps/runner` e `apps/broker`. Runtime, e por isso NÃO cabe em
  `packages/shared` (100% tipo, invariante travado por teste). Sem passo de
  build: os dois consumidores o EMPACOTAM (`tsup`, `bun build --compile`), e é
  por isso que a api não pode consumi-lo — `pnpm deploy` copia o pacote de
  verdade e o Node recusa type stripping dentro de `node_modules`
- `e2e/`: E2E de NAVEGADOR (Playwright, só chromium — ADR 0120), a quarta
  camada da pirâmide. Roda contra o compose de PRODUÇÃO (`docker/smoke.sh`
  com `SMOKE_KEEP_UP=1`), nunca contra o `vite dev`: o que ele prova —
  refresh em cookie `httpOnly`, CSRF em origem cruzada `:8088`→`:3000`,
  ticket de uso único do socket (RN-108) contra o engine numa TERCEIRA
  origem — só existe quando as três origens são distintas, e jsdom não
  alcança nenhuma delas. NÃO é membro do workspace (mesmo desenho do
  `website/`, ADR 0117): lockfile próprio, `pnpm --dir e2e`, nunca
  `pnpm --filter`. Seletor é ESTRUTURAL, nunca texto (o idioma é decisão do
  servidor), e a asserção é sobre MECANISMO, nunca sobre tela
- Monorepo pnpm (TS) com apps/engine Elixir ao lado; Docker Compose para dev.
  `website/` NÃO é membro do workspace (ADR 0117) — lockfile próprio em
  `website/pnpm-workspace.yaml`/`website/pnpm-lock.yaml`, instalado com
  `pnpm install` de DENTRO de `website/`, nunca `pnpm --filter website` (usa
  `pnpm --dir website` nos scripts `docs:*`). Isola o `pnpm audit` do
  produto da árvore do Docusaurus, que nunca chega a imagem nenhuma.
  Dependência vulnerável TRANSITIVA se fecha por `overrides` — e eles moram em
  `pnpm-workspace.yaml` (raiz) e `website/pnpm-workspace.yaml`, NUNCA em
  `package.json`: já são catorze na raiz e treze no website, cada um com o
  advisory e o caminho do `pnpm why` no comentário ao lado. Duas disciplinas,
  escritas no topo do arquivo: a chave é a FAIXA VULNERÁVEL do aviso (nunca a
  versão instalada hoje) e a faixa é presa à LINHA MAIOR afetada. Faixa que já
  existe e ganha advisory nova sobe de TETO — não nasce entrada nova —, e sobe
  nos DOIS arquivos junto quando é MISTA, senão o lado esquecido volta a
  resolver a faixa vulnerável em silêncio. O painel do Dependabot mede a
  branch DEFAULT (`main`); quem mede a `dev` é o `pnpm audit` local, e ele já
  achou advisory que o painel ainda não tinha aberto — leia os dois, nessa
  ordem. Override que QUEBRA o consumidor não entra: mede-se e declara-se
  (`@faker-js/faker` tem correção e não sobe, porque `postman-collection@5.3.1`
  o pina EXATO e usa a API da v5 — com o override, `pnpm docs:build` reprova)
- Auth: first-party no domínio da api (argon2id + access JWT curto +
  refresh opaco com rotação); autorização RBAC no domínio da api
  (inalterada desde a Fase 1)
- LLM: roteador na api com suite de contrato; base OpenAI-compatível
  sobre node:http (timeout de inatividade, erro por `code`,
  capabilities em duas camadas — ADR 0041); catálogo com curadoria e
  preço congelado no metering (ADR 0042); 9 providers (ADR 0043)
- Deploy: Kubernetes (k3d/kind em validação local). As quatro imagens de
  produção são PUBLICADAS no GHCR a cada tag final, públicas e por digest
  (ADR 0119) — `.release/images.json` registra o que cada tag publicou, e
  `make imagens-do-release` aplica no overlay. O overlay do repositório
  guarda o MARCADOR, nunca uma release congelada; nada disso faz deploy
  sozinho (ver `DEPLOY_ENABLED` acima, que continua não existindo)
- Docs: Docusaurus 3.x em website/ lendo de docs/; Mermaid; busca local
- CI/CD de release: GitHub Actions com lógica em scripts testáveis
  (scripts/ci/, vitest). Todo `uses:` de terceiro é preso a COMMIT SHA, com
  a versão num comentário ao lado (`@<sha>  # v4`) — tag é ponteiro que o
  dono da action move sem aviso, e quem move executa código no runner que
  tem o checkout e os segredos daquele workflow. O comentário é obrigatório:
  é o que diz a um humano, e ao Dependabot, que versão é aquele hash.
  `scripts/ci/actions-pinadas.ts` reprova no job `lint` quem esquecer, e
  todo `curl` de binário passa por `sha256sum -c`. E desde a RN-524 (ADR
  0149) a esteira também ASSINA o que publica: `cosign` keyless (OIDC do
  Actions) nas quatro imagens por DIGEST — nunca por tag, que é ponteiro
  móvel — e UM `checksums.txt` assinado cobrindo os cinco binários do
  runner, não cinco assinaturas. Os dois workflows VERIFICAM o que
  assinaram no mesmo run, porque assinatura que ninguém tenta verificar é
  arquivo a mais e a falha apareceria só na máquina de quem instala. Desde a
  RN-525 o proxy `GET /runner-releases/binary` VERIFICA — mas só o sha256
  contra o `checksums.txt` da mesma release, nunca a ASSINATURA dele: é
  INTEGRIDADE e não procedência, e está escrito assim no docblock, na
  OpenAPI, na mensagem de recusa e na RN. As duas formas de a api verificar
  assinatura foram MEDIDAS e recusadas — `cosign` na imagem custa 155 MB
  contra um runtime Alpine+Node, e `@sigstore/verify` (2,5 MB, barato) faria
  uma rota `@Public()` depender de um SEGUNDO host de terceiro
  (`tuf-repo-cdn.sigstore.dev`) para verificar algo que nenhuma Release
  carrega ainda, o que a régua dos ADRs 0041/0042 proíbe declarar sem prova.
  Quem verifica assinatura é o `install.sh`, com `cosign` pinado. Fica FORA,
  declarado: code-signing de SO dos binários (notarização, Authenticode) e a
  metade de PROCEDÊNCIA do proxy — BRB-005 segue aberto só nela. Ver
  docs/explanation/cadeia-de-suprimentos-do-ci.md, que também DECLARA o que
  segue confiado na fé (sem Dependabot, sem proveniência de dependência npm,
  sem assinatura dos artefatos, imagem de terceiro por tag e não por digest).
  E há UM workflow que NÃO roda em `pull_request` e não pode passar a rodar:
  `install-e2e.yml` (RN-534/RN-549). O instalador verifica a própria origem
  contra o `checksums.txt` ASSINADO de uma Release, que só existe depois de uma
  tag final — fazê-lo rodar em PR exigiria dar-lhe uma porta para PULAR a
  verificação, que é a porta que o ADR 0150 recusa e que, aberta, vale para
  qualquer um. A consequência é DECLARADA e não escondida: **PR que mexe nesse
  workflow não o executa**, e verde ali não significa provado. O que roda em PR
  é `scripts/dev/install-e2e.spec.ts`, e ele guarda as duas formas de o E2E
  apodrecer calado — o gatilho afrouxado, e uma frase do `install.sh` reescrita
  (que não faz as asserções falharem: faz elas SUMIREM). Mesma decisão, mesmo
  motivo, do golden-set do RAG (ADR 0138)

## Convenções
- Branches permanentes: dev, qa, main — um branch, um ambiente. `rc` saiu
  da política (ADR 0030) e o bootstrap parou de criá-la, mas continua em
  `PROTECTED_BRANCHES` DE PROPÓSITO: a lista decide o que a trava de merge
  RECUSA, e repositórios bootstrapados por versões anteriores ainda têm a
  branch. Proteger uma branch que não existe não custa nada; desproteger
  uma que existe custa caro. Não "limpe" essa lista.
  Trabalho nasce de dev com a taxonomia da política (breaking/,
  feature/, bugfix/, perf/, refactor/, chore/, docs/, test/);
  hotfix/ nasce de main. Formato funcao/descritivo,
  regex ^.{0,30}/\S{0,32}$. Commits em conventional commits, pt-BR.
  A FUNÇÃO da branch decide a VERSÃO (scripts/ci/version.ts): breaking/
  sobe MAJOR, feature/ sobe MINOR, todo o resto é PATCH. Mudança que
  exige ação do operador antes do deploy nasce em breaking/ mesmo quando
  o conteúdo é correção — o v2.5.1 saiu patch porque a chave obrigatória
  do OAuth nasceu em bugfix/, e um patch diz "atualize sem pensar".
  Versão não se corrige à mão depois: o valor de ela ser calculada vem de
  não ser negociada caso a caso.
- Volume nomeado do Docker nasce com o dono do caminho que existir NA IMAGEM;
  quando o caminho NÃO existe, ele nasce `root` e o processo non-root fica de
  fora. Por isso `/data/git-repos` e `/data/project-workspaces` são criados e
  `chown`-ados ANTES do `USER` nos QUATRO Dockerfiles — os dois de produção e
  os dois de dev (`docker/api/Dockerfile`, `docker/engine/Dockerfile`). Só a
  produção fazia isso, e o preço foi medido: em dev, `git init --bare` do
  `LocalGitProvider` morria com `permissão negada: /data/git-repos/<slug>.git`
  e o `permissions.json` de cada projeto não tinha onde ser escrito — ou seja,
  provisionar repositório era impossível na máquina de quem desenvolve o
  produto. Ao acrescentar volume nomeado novo, crie o diretório na imagem;
  esquecer não dá erro de build, dá 403 em runtime. Volume JÁ criado continua
  com o dono antigo: a correção vale para volume novo, e destravar um ambiente
  existente exige `docker volume rm` (ou um `chown` pontual como root).
- `docker compose up --wait` só prova o que tem `healthcheck` — para serviço
  sem um, ele espera "running" e segue em frente. Isso já custou duas vezes: o
  broker morrendo em silêncio (corrigido com o healthcheck dele) e o
  `scripts/dev/reset-total.sh` anunciando "reset completo" com a api em
  `Exited (1)`. Os SEIS serviços do compose de DEV têm healthcheck agora, com
  o MESMO teste que as imagens de produção já faziam por `HEALTHCHECK` no
  Dockerfile (`/health` na api e no engine — toca o banco, que é a pergunta
  certa para readiness; `/` no Vite do web). Serviço novo nasce com o dele, e
  `start_period` de DEV é generoso de propósito: o CMD roda
  `pnpm install`/`mix deps.get` antes de o processo escutar.
- Script que apaga o banco PARA antes quem está conectado nele, e a lista é
  `api` e `engine` — nenhum a mais. Os dois mantêm conexão viva com o Postgres
  do compose (pool do Drizzle sobre `public`/`drizzle`; Ecto/Oban sobre
  `engine`), e `DROP SCHEMA` embaixo deles MATA os processos — o engine morre
  dentro do próprio drop, porque o `Rehydrator` consulta `engine.session_states`
  — sem que nada os reerga depois. `web` não fala com banco, `neo4j` é outro
  banco, o `broker` só fala HTTP com a api: parar de mais transforma um reset de
  banco numa derrubada do ambiente. E script que AFIRMA um estado pergunta antes
  de afirmar: `scripts/dev/reset-total.sh` bate em `/health` dos três e imprime
  `ps` antes da frase final, que nomeia o que ficou de pé — e qualquer falha no
  meio sai com o passo nomeado, nunca com a frase de sucesso.
- `apps/api/src/db/seed.ts` é IDEMPOTENTE, e rodá-lo de novo é o caso normal
  (o `bootstrap.sh` do k8s o chama com `BRABO_FORCE_SEED=1` contra um cluster
  que pode já estar semeado, e quem vê o reset falhar tenta rodar só o seed).
  Registro de demonstração novo entra REAPROVEITANDO o que já existe, nunca
  com `create` puro — antes, workspace, projeto e sessão eram os três que não
  reaproveitavam, e a segunda rodada escrevia metade e morria em
  `duplicate key ... "workspaces_slug_unique"`. Sessão reencontrada NÃO é
  reativada nem ganha os 5 eventos de novo: eles são append-only, e uma
  timeline que existe para demonstrar cinco não pode crescer a cada reseed.
- Criar usuário tem UM núcleo (`ProvisionarUsuarioUseCase`) e DUAS portas com
  regras diferentes, e a diferença é o que cada uma protege (RN-546, ADR 0155).
  `provisionarUsuario` (seed/smoke) MANTÉM a recusa de `NODE_ENV=production` e
  ela fica no SCRIPT, não no núcleo: o que ela protege é senha CONHECIDA criada
  SEM interação humana, e não o trio de escritas — **não use `BRABO_FORCE_SEED`
  para atravessá-la**. `POST /internal/first-account` roda em produção de
  propósito (é onde o instalador roda), e é outra categoria: senha DIGITADA no
  TTY por quem está na máquina. E a régua de senha é UMA só, a
  `exigirSenhaValida` do domínio — por isso o DTO dessa rota NÃO repete um
  `@MinLength`, que cobriria só uma das cinco recusas e divergiria da do
  registro no primeiro dia em que uma das duas mudasse.
- Toda mudança entra por PR — push direto em permanente é bloqueado;
  únicas exceções de push: tags (bot de release) e .release/gate.json
  (bot do gate).
- Toda branch cujo PR é mergeado é ARQUIVADA automaticamente
  (`.github/workflows/archive-merged-branch.yml`) — move de
  `refs/heads/<nome>` para `refs/archive/<nome>`, nunca apaga: histórico
  intacto, recuperável com um `git push` de volta. Exceções: dev/qa/main
  (aparecem como `head` de todo PR de promoção), `gh-pages` (deploy do
  site, não é branch de feature) e branch de fork. A política mora em
  `scripts/ci/archive-branch.ts` (testado), ver
  docs/explanation/branching-policy.md, seção "Merged branches get
  archived".
- Comunicação api ↔ engine: eventos via Postgres (transactional outbox
  na api, Oban no engine) + HTTP interno com service token para
  comandos síncronos.
- O schema do Postgres mora em `apps/api/src/db/schema/`, UM arquivo por
  AGREGADO de domínio, espelhando `apps/api/src/domain/*` (ADR 0121);
  `db/schema.ts` é só o BARREL de `export *` que todo mundo importa, e é para
  onde `drizzle.config.ts` aponta. Tabela nova entra no arquivo do agregado
  dela — arquivo novo só quando o agregado é novo, e aí entra também no
  barrel, na posição do ASSUNTO e não no fim. Enum mora com a tabela que o
  CHAMA, não com o assunto: FK entre arquivos é segura num ciclo
  (`.references()` é callback preguiçoso), enum entre arquivos NÃO é (roda na
  avaliação do módulo) — o grafo de imports é um DAG e continuar assim é
  invariante que ninguém testa, só quebra no boot.
- Todo evento de domínio é imutável: nunca UPDATE em tabelas de eventos.
- Estados de sessão são máquina de estados explícita:
  created → active → closing → closed | closed_abnormally
- A sessão tem DUAS classificações, e elas não se sobrescrevem: `kind`
  (`consultiva|criativa`) é a INTENÇÃO de criação, gravada e imutável; o
  evento `execution.activated` é o ESTADO de execução, e continua sendo
  ele que `findActiveExecutionSession` procura. `execution.activated` em
  sessão consultiva é 409, nunca conversão silenciosa (ADR 0061, RN-097).
  Não faça a derivação por evento olhar `kind`
- O `permissions.json` mora onde a API ALCANÇA, e o ESCOPO do terminal aponta
  para o HOST — são DUAS derivações desde a RN-478, não uma. Elas nasceram
  como uma só (`projectScopeRoot`), e isso estava certo enquanto os dois modos
  com pasta de usuário eram bind-mount; deixou de estar quando o `runner`
  nasceu, deliberadamente SEM bind-mount. O escopo do ADR 0055 quer o caminho
  do HOST (é lá que o comando roda, pelo runner); o arquivo de política quer um
  caminho que a api ALCANCE, porque ela o lê e o ESCREVE de dentro do container
  dela — daí o 500 da ativação (`mkdir '/home/<usuario>'`) e, pior, o arquivo
  que NUNCA existiu em projeto `runner`, com `decide()` caindo sempre em
  `require_approval`. `permissionsFilePath` mora ao lado de `projectScopeRoot`,
  no MESMO arquivo, porque a fonte continua única: o que se separou foi a
  pergunta, não a autoridade. No modo `runner` o arquivo vai para a raiz
  GERENCIADA, chaveado pelo `workspace_dir_name` da RN-109 — política é da api,
  não do disco do usuário: guardá-la lá a tornaria editável por quem ela
  restringe e ilegível com o runner desconectado. `container` e `mounted` não
  mudam (em `mounted` a pasta É bind-mount). NÃO "unifique" as duas de volta:
  há teste de não-regressão, e escopo apontando para a raiz gerenciada
  autorizaria comando numa pasta que não é a do projeto. O ENGINE não lê nem
  escreve esse arquivo em ponto nenhum — todas as menções nele são comentário
- Toda ação com efeito externo (git, terminal, gasto) nasce como
  proposed_action e respeita permissions.json; deny sempre vence allow.
  LER não é efeito externo e NÃO vira proposed_action — encheria a fila de
  ruído até ninguém mais ler as de verdade. O que a leitura deve é ser
  CONTIDA e ter TETO: caminho vindo do cliente passa pela checagem central
  (RN-092/RN-095), e leitura composta que chama o provider N vezes tem
  orçamento e cache, senão vira amplificador de tráfego (ADR 0060).
- `agent_autonomy` aceita `actionType: "*"` — "auto mode" (RN-153):
  autonomia pra QUALQUER tipo de ação do agente, ligada pelo `ApprovalCard`
  ("Modo automático") e desligada pelo mesmo toggle manual/auto do card do
  agente na Visão Geral/Executores. Regra específica sempre vence a
  curinga; a resolução mora no repositório (`findMode`), nunca em
  `decide()`. Tetos continuam absolutos MESMO com auto mode ligado, e não
  têm exceção configurável em lugar nenhum — merge em branch protegida,
  `instruction_patch`, `parallelize`/`raise_max_parallel` (RN-154), e o
  teto de efeito externo/comando privilegiado — git push/PR/deploy e
  sudo/doas — que revisou a RN-106 (RN-418, ADR 0102): antes era `deny`
  incondicional, agora é `require_approval` incondicional, com a mesma
  garantia de nunca ser auto-aprovável; "sempre permitir" foi fechado na
  fonte pra esse teto não virar decorativo (`ApproveAlwaysActionUseCase`
  recusa gravar padrão pra esses comandos).
- O papel de PROJETO sobrepõe o de workspace nos DOIS sentidos —
  `ResolveEffectiveRoleUseCase.forProject` é `projectRole ?? workspaceRole`, e
  NÃO é "o maior dos dois" (RN-471). Restringir alguém num projeto sensível é
  capacidade deliberada; não "corrija" isso. O que a sobreposição não pode
  fazer são DOIS movimentos, e eles são teto (ADR 0127, RN-472): ninguém
  rebaixa quem é `owner` do WORKSPACE, e ninguém rebaixa a SI MESMO — 403 nos
  dois, sem chave de configuração. `owner` aqui é `workspace_members.role`,
  NUNCA `workspaces.created_by`: criador não é dono corrente, e o papel é o que
  a autorização usa em todo o resto do sistema. Os tetos moram no CASO DE USO
  com a regra pura em `domain/iam/tetos-de-rebaixamento.ts`, não no
  `RolesGuard` — o guard autoriza o CHAMADOR contra o `@RequireRole` da rota e
  não vê corpo nem alvo, e estes tetos são sobre o ALVO e sobre a relação
  ator↔alvo. O teto 2 vale por DUAS portas desde o ADR 0156 (RN-556): a
  REMOÇÃO da própria linha também é 403 quando o efeito líquido é rebaixamento
  — remover não apaga um papel, TROCA o efetivo pelo do workspace, que pode ser
  menor (ou não existir). `remocaoEhAutoRebaixamento` DELEGA a
  `ehAutoRebaixamento` passando o papel de workspace como o papel pedido — não
  escreva uma segunda régua. O teto 1 NÃO tem par na remoção, de propósito:
  `owner` é o topo do `ROLE_ORDER`, então tirar a linha de um `owner` de
  workspace só pode ELEVAR o efetivo dele, e é a única forma de desfazer a
  restrição que o teto 1 impede de criar. Desde o ADR 0157 (RN-557) o teto 2
  vale por QUATRO portas e nos DOIS SENTIDOS: `POST workspaces/:id/members`
  deixou de ser upsert sem teto (era passa-adiante sem ator, num escopo onde
  não há nível acima para segurar a queda nem rota que remova membro), e a
  auto-PROMOÇÃO — que o ADR 0127 declarou como capacidade que ficava — é
  BRECHA e fecha, nas duas rotas de associação: é a única metade do movimento
  que ESCALA privilégio. A comparação virou UM classificador
  (`autoMovimentoDoProprioPapel`, devolve o SENTIDO porque a mensagem depende
  dele); `ehAutoRebaixamento` sobreviveu como LEITURA dele, de propósito — é
  por ela que `remocaoEhAutoRebaixamento` segue vendo só a metade de baixo, e
  alargá-la faria a REMOÇÃO recusar o movimento benigno que o ADR 0156
  protegeu. O teto 1 também NÃO tem par no workspace, e foi considerado, não
  espelhado: ele é regra sobre INVERSÃO DE HIERARQUIA, e o
  `@RequireRole('owner')` da rota já a impede — pô-lo faria de `owner` um
  estado absorvente, do qual ninguém sai por HTTP. E o teto NÃO conta owners:
  a cláusula já garante que um workspace nunca chega a zero, porque tirar o
  último exigiria que ele mesmo o fizesse. Segue possível e declarado:
  rebaixar outro `maintainer`; um `owner` rebaixando OUTRO `owner` no
  workspace (única forma de revogar propriedade, reversível pela mesma rota);
  reescrever o próprio papel com o MESMO valor (upsert idempotente não é
  movimento); a auto-promoção pela REMOÇÃO da linha de projeto; e a
  auto-remoção quando o workspace segura o MESMO papel — essa é benigna e
  continua passando.
- O projeto escolhe ONDE o código mora, na criação (RN-169/RN-421/RN-422,
  ADR 0072/0104) — e pode CONVERTER depois, sem recriar o projeto, por
  `PUT projects/:projectId/execution-mode` (`maintainer`, RN-447..450, ADR
  0111): `container` (DEFAULT — a pasta gerenciada em
  `PROJECT_WORKSPACES_ROOT`, o comportamento de sempre), `mounted` (o antigo
  `local`, renomeado — uma pasta do USUÁRIO montada por bind-mount, caminho
  absoluto livre em `projects.workspace_path`) ou `runner` (uma pasta do
  USUÁRIO SEM bind-mount, confirmada por um CLI — `brabo-runner` — rodando na
  máquina dela, RN-423). Desde o ADR 0141 (RN-500), o bind-mount de `mounted`
  deixa de ser uma linha de compose POR PROJETO e passa a ser UMA base da
  INSTALAÇÃO — `BRABO_PROJECTS_BASE`, montada por IDENTIDADE (`$X:$X`) em `api`
  e `engine`, com todos os projetos montados morando dentro dela. Identidade e
  não mountpoint fixo porque `workspace_path` é digitado pelo usuário e mostrado
  de volta a ele, e é isso que faz `projectScopeRoot` e
  `Engine.Actions.Workspace.workspace_dir/2` continuarem certos sem código novo.
  Variável PRÓPRIA, NUNCA `PROJECT_WORKSPACES_HOST_DIR`: a raiz gerenciada é
  nomeada por `workspace_dir_name` (UNIQUE) e a base é nomeada pelo usuário, e
  apontar as duas para o mesmo lugar faria `init_from_bare!` dar `git init` na
  pasta de outro projeto. `baseDeProjetos()` NUNCA lança e AUSENTE é estado
  normal — `GET workspaces/:workspaceId/projects-base` (`maintainer`) devolve
  `projectsBase: null`, e é assim que a criação aprende a NÃO oferecer o modo —
  o que desde a RN-513 (ADR 0146 ponto 4) é VERDADE no cliente, e não mais
  intenção sem chamador: o assistente consulta a rota ao MONTAR (não no quinto
  passo), só oferece `mounted` com a base CONHECIDA e presente — carregando ou
  consulta FALHADA não viram oferta, "não sei" nunca vira "tem" —, e com base
  ele PRÉ-SELECIONA o modo sugerindo `<base>/<slug>`, sem jamais sobrescrever
  escolha humana nem caminho digitado.
  A base NÃO entra em `caminhoDeWorkspaceLocalValido` (que roda em toda LEITURA
  e faria projeto montado legado explodir ao ser lido): é regra de criação e
  conversão. E `pnpm dev` RECUSA subir com a base sobreposta ao checkout do
  Brabo, nos dois sentidos — checagem que só o preflight pode fazer, porque a
  api compara contra `process.cwd()` (`/workspace` dentro do container dela) e
  nunca enxerga o checkout real. O par (modo, caminho) é amarrado por CHECK no banco
  (`execution_mode <> 'container'`), e `projectScopeRoot` continua sendo a
  derivação ÚNICA da raiz — não duplique validação nos chamadores. Desde a
  RN-501 (ADR 0142), `mounted` e `runner` validam na criação a MESMA coisa: só
  o LÉXICO, sem I/O (absoluto, sem `..`, nunca raiz/pasta de sistema nem
  sobreposto ao checkout do Brabo — RN-422/RN-423/histórico RN-170), com
  `mounted` acrescentando estar dentro de `BRABO_PROJECTS_BASE`. Os DOIS
  nascem `workspaceVerifiedAt: null`, e a diferença entre eles é QUANDO/QUEM
  confirma o disco: no `runner` é o CLI conectando (sobrescrevendo o que foi
  digitado); no `mounted` é `materializarWorkspaceMontado` — `mkdir -p` mais
  as três perguntas de disco —, chamada por `ExecuteContainerStartUseCase`
  quando a Infra sobe o container (o requisito "após a decisão do Arquiteto"
  cumprido literalmente; falha vira `failed` NOMEADO e o ciclo de vida NÃO
  chega a `provisioning`) e, como EXCEÇÃO declarada, pela conversão de modo,
  que não tem passo de container onde pendurar o trabalho e move o
  `permissions.json` para dentro da pasta. Adiar a VERIFICAÇÃO não toca o
  invariante de PAREAMENTO: `mounted` segue gravando `workspace_path`
  não-nulo e o CHECK fica intacto, sem migration. O portão da imagem
  (RN-105) VALE para os TRÊS modos desde a RN-494/ADR 0135 — projeto
  `mounted`/`runner` sem `artifact.project_image` decidido também responde
  409 na aba Code; a dispensa antiga foi REVOGADA, não é mais o
  comportamento. Desde o ADR 0144 (RN-503), `mounted` SOBE container no
  SERVIDOR, pelo BROKER — a base única do ADR 0141 tornou a pasta alcançável
  pelo daemon, e a recusa antiga era sobre GEOMETRIA, não sobre o nome do
  modo. A ramificação de `container_start`/`_stop`/`_remove` passa a ser por
  DESTINO: `container` e `mounted` → broker, `runner` → runner (as três mudam
  JUNTAS; subir no servidor e parar na máquina do usuário deixaria de pé, sem
  forma de parar, o que está de pé). `runner` continua sem container PRÓPRIO
  no SERVIDOR — quem sobe container pra ele é o `brabo-runner`, na máquina do
  USUÁRIO, com o Docker dela (ADR 0137, RN-497). Consequência declarada no
  ADR: a contenção estrutural do `join` some para esses projetos, e o vetor
  de symlink do ADR 0055 continua aberto. No LINUX, o próprio CLI
  `brabo-runner` recusa `--dir` fora do
  `$HOME` do usuário (RN-434, ADR 0104) — checagem de startup do processo
  local, não a fronteira de segurança (essa continua sendo autenticação +
  pipeline de aprovação, ver `apps/runner/src/guard.ts`); fora do Linux a
  restrição não se aplica.
  Desde a RN-515 (ADR 0147 ponto 4), `mounted` e `runner` podem ainda declarar
  um DESTINO DE ESPELHO — `projects.mirror_path`/`mirrorPath`, por
  `PUT projects/:projectId/mirror-path` (`maintainer`) —, a pasta da máquina do
  usuário FORA da base para onde o agente local copia o trabalho. É por
  PROJETO e nunca global (destino global aterrissaria o artefato do projeto B
  na pasta do A, descoberto pelo conteúdo e não por um erro), `null` é o estado
  NORMAL, e limpar é `null` EXPLÍCITO — a chave é obrigatória, senão omitir o
  campo limparia em silêncio. `container` é RECUSADO com motivo (a origem é um
  volume do SERVIDOR e quem copiaria está na máquina do usuário), e converter o
  modo ZERA o destino. A api valida SÓ o LÉXICO e DIZ isso, reusando
  `caminhoDeWorkspaceLocalValido` — NÃO escreva uma quarta cópia da régua —
  mais os DOIS sentidos do laço origem↔destino, por SEGMENTO e nunca
  `startsWith`. A metade `realpath` da guarda é do RUNNER
  (`apps/runner/src/espelho-guard.ts`, RN-516): a api impediu o laço ESCRITO,
  nunca o construído por symlink, e o comentário no código diz isso.
  A escrita do espelho NÃO é `proposed_action` — é configuração declarada pelo
  usuário, não agente pedindo para agir.
  Desde a RN-516 (ADR 0147 pontos 2/3/4/8) o espelho EXISTE, e três coisas
  dele são regra: o destino viaja SÓ na concessão do `join` e o runner recusa
  `mirror_sync` para destino não concedido NAQUELA conexão (trocar o destino
  com runner de pé exige reconectá-lo, e destino declarado passa a EXIGIR a
  capacidade `espelho`, recusando binário velho no join); a cópia é numa
  direção e NUNCA apaga — arquivo apagado na origem PERMANECE no destino, que
  é acúmulo e não réplica —, e o que se copia é a LISTA DO GIT (rastreados +
  não-rastreados-não-ignorados), com git que falha virando erro NOMEADO e
  nunca um `cp -r` de plano B; e o gatilho é MOMENTO NOMEADO do engine (hoje
  o commit), NUNCA um watcher, que seria trabalho ilimitado disparado até
  pelas escritas do próprio espelho. O predicado do espelho é PRÓPRIO
  (`Engine.Runners.Espelho`, DUAS pré-condições) — `RunnerReadiness` fica
  byte a byte como está e NUNCA ganha flag "pula container": é por essa flag
  que a terceira pré-condição do ADR 0145 cairia por acidente para o `exec`.
- A imagem de container de um projeto é ARTEFATO — `artifact.project_image`,
  versionado, sem tabela, nunca configuração escondida —, e desde o ADR 0133
  (RN-491) tem DOIS emissores possíveis, distinguidos por `decidedBy`: o
  ARQUITETO decidindo do zero (`choose_project_image`, `'arquiteto'`) e a
  INFRA elegendo entre as candidatas do próprio roteamento do Arquiteto
  (`container_start`, `'infra-lead'`) — nunca um caminho paralelo, os dois
  passam por `DecidirImagemDoProjetoUseCase`/`validarDecisaoDeImagem`.
  Enquanto NENHUM dos dois decide, a aba Code responde 409 (RN-105) — nos
  TRÊS modos de execução desde a RN-494/ADR 0135, que revogou a dispensa
  que `mounted`/`runner` tinham (RN-169/RN-421). `mounted`/`runner`
  continuam sem subir container PRÓPRIO no SERVIDOR — quem sobe pra eles é
  o `brabo-runner`, na máquina do usuário (ADR 0137, RN-497). O que mudou
  aqui foi só a exigência de alguém ter decidido a imagem antes de abrir a
  leitura.
  `git push`, abertura de PR e deploy NÃO saem pelo terminal — a regra é
  `require_approval` INCONDICIONAL (teto absoluto, revisado de `deny` pela
  RN-418/ADR 0102 — decisão GLOBAL do dono do produto: nunca auto-aprovável,
  mesmo dentro do escopo do projeto, mesmo com auto mode ligado, mesmo com
  "sempre permitir", que foi fechado na fonte pra não reabrir a porta).
  `sudo`/`doas` entram na MESMA régua. O ciclo de vida do container tem
  TABELA de estado desde a Onda 4/frente F1 do PROGRAMA 28
  (`project_containers`, ADR 0081, RN-243..248) — e quem ESCREVE nela, desde o
  ADR 0130/0133, PODE chamar Docker de verdade: `container_start`
  (`proposed_action`, `maintainer`, RN-491) é o primeiro chamador real de
  `ContainerBrokerPort.start`, e transiciona `provisioning → running` pela
  máquina de estados. Desde o ADR 0136 (RN-495), `container_stop`
  (mesmo calibre de `container_start`) e `container_remove` (o mais
  destrutivo — no MESMO teto absoluto de git push/comando privilegiado,
  nunca auto-aprovável) também são `proposed_action`, propostas pela
  página global de containers (`/containers`) — sempre um humano, nunca um
  agente. Desde a RN-521 essa página também SOBE container, e é o único
  caminho humano para isso: ela lista TODO projeto do workspace (`registrado:
  null` é o TERCEIRO estado, "nunca provisionado", e nunca gasta verificação
  do broker) e ramifica por `execution_mode` — `container`/`mounted` propõem
  `container_start`, `runner` propõe `container_start_via_runner`, cada um com
  o payload que o schema dele aceita. Ela RECUSA localmente (botão inerte, com
  o motivo em TEXTO) sem imagem decidida, em `runner` sem pasta jamais
  confirmada, e para papel abaixo de `maintainer` — o mínimo do ENDPOINT, por
  `roleAtLeast`. Desde a RN-566 o AGENTE também ramifica por modo antes de
  propor: as duas tools do Infra Lead passam por `recusa_local_de_subida/2`
  (`infra_lead_server.ex`), que lê o projeto UMA vez e recusa com motivo
  NOMEADO — a MESMA ramificação por DESTINO, nunca uma segunda régua. O que
  ele NÃO checa, e a tela checa, é imagem decidida e pasta confirmada.
  A política de terminal do ADR 0055 (escopo de caminho, allowlist
  estreito) segue valendo como está — mas ela não decide mais ONDE o comando
  roda quando NÃO há container: desde o ADR 0143 (RN-502), `container` e
  `mounted` SEM um `running` registrado RECUSAM (`:recusar_container_ausente`,
  `failed_result` nomeado), em vez de cair no `System.cmd` dentro do processo
  do engine. Desde a RN-507 (ADR 0145), `runner` entrou na MESMA régua —
  workspace verificado e runner conectado deixaram de bastar; sem container
  `running` REGISTRADO (a mesma leitura de `ProjectContainerLifecycle`,
  centralizada em `Engine.Runners.RunnerReadiness`), o comando recusa em vez
  de atravessar pro canal e arriscar cair no HOST puro do usuário — o
  fallback silencioso que essa RN fecha. O catch-all `:caminho_de_sempre` do
  `TerminalExecutor` encolheu para projeto inexistente/id malformado —
  nenhum modo de execução cai nele. Com um `running` registrado, o comando
  de terminal
  passa a rodar DENTRO do container de verdade (`ContainerBrokerPort.exec`,
  ADR 0134, RN-492) e ganha um PISO de auto-aprovação por cima do escopo
  léxico — não no lugar dele (RN-493). Esse PISO é ESPECÍFICO de
  `execution_mode: container` (`ProposeActionUseCase` só o calcula quando
  `project.executionMode === 'container'`): projeto `mounted`/`runner` com
  um container REAL de pé pelo `brabo-runner` (ADR 0137, RN-497) continua
  sob a política de terminal de sempre, sem piso — a decisão host-vs-container
  ali é INTERNA ao runner, o engine não sabe dela, e `decide()` nunca viu
  motivo pra tratar os dois casos como o mesmo. O que a
  leitura ganhou primeiro (ADR 0130) foi o estado OBSERVADO ao lado do
  registrado, perguntado ao broker — os dois nunca se fundem, e "não
  consegui olhar" tem motivo próprio em vez de herdar o registrado (RN-486).
- O diagrama C4 (Context + Container) também é ARTEFATO do ARQUITETO
  (`artifact.c4_diagram`, versionado, sem tabela — RN-149, ADR 0068),
  mesmo desenho do `artifact.project_image`. O Container level é DERIVADO
  do `module_map` vigente pelo caso de uso, nunca redigitado pelo modelo
  na ferramenta `create_c4_diagram` — só o Context (nome do sistema e
  atores externos) vem do tool call.
- `decision_record` é o outro polo do mesmo espectro: reusa o padrão
  GENÉRICO de `emit_artifact`/`ArtifactSchemas` (o de `note`/
  `business_rule`) em vez do dedicado de `project_image`/`c4_diagram` —
  uma decisão é log append-only, nunca um "vigente" que se substitui
  (RN-505). Os SEIS conversacionais (Criativo, PO, Arquiteto, Dev Lead,
  UX Designer, Staff) podem emitir; distinto de `open_adr_pr` (só o
  Arquiteto, commit real em `docs/adr/*.md` + PR + aprovação humana) —
  os dois COEXISTEM, para escalas diferentes de decisão, nunca um
  substituindo o outro.
- Agentes rodam SEMPRE dentro de um Harness; nenhuma chamada de LLM ou
  ferramenta fora dele.
- Agente que ESCREVE tem de poder LER o que já existe, e tem de poder
  PERGUNTAR quando falta informação. As duas são a mesma lição (RN-164/165):
  um agente só com ferramenta de escrita age sobre um retrato tirado uma vez,
  no kickoff, e diante de uma lacuna escolhe entre inventar e parar. Leitura
  de agente é escopada ao PROJETO quando o recurso é do projeto, e CONTIDA
  (ADR 0060): sem parâmetro onde o modelo escreva o que quiser, custo constante
  por chamada, teto de linhas declarando o total real quando trunca.
- Laço de agente NÃO termina calado. O teto de iterações emite
  `toolloop.limit_reached` — o mesmo tipo para o `ToolLoop` e para os agentes
  conversacionais, que têm laço próprio (RN-166) — e obrigação não cumprida
  vira desfecho explícito no padrão da RN-059, durável e com origem.
- Handoff externo endereça só LEAD de área ou agente sem área;
  delegação interna é privada da área; falha de subagente NUNCA é
  silenciosa — reporta origem ao lead, que decide e registra evento.
- O contrato externo dos gates é estável: quem consome vê um veredito
  por gate, independente da estrutura interna da área.
- A lista de áreas tem UMA fonte —
  `apps/api/src/domain/agents/agent-areas.ts`. As cópias do web e do
  engine são GERADAS por `pnpm --filter api gerar:areas` e reprovam em
  teste se estiverem velhas; nunca as edite à mão (FASE 18). Área nova
  continua sendo decisão de produto, com ADR. A lista é o CATÁLOGO; a
  tabela `agent_areas` é o ESTADO por projeto, e nasce com ele (RN-094).
- `docs/fluxo.yml` é a terceira peça do modelo de time, ao lado do
  CATÁLOGO (`agent-areas.ts`) e do CONTROLE (`docs/gates.yml`, ADR
  0054): declara as RELAÇÕES entre papéis — quem entrega o quê a quem
  (ADR 0085). Papel `proposto` diz quem o absorve hoje e o critério
  objetivo de separação; o docmap cobre mudança em `agent-areas.ts`/
  `gates.yml` só em `warn`, até existir o teste de cruzamento entre os
  três (backlog).
- Merge em branch protegida (dev/qa/main) é SEMPRE manual do
  usuário — sem opção de automatizar, garantido por teste.
- Socket Phoenix da sessão (`session:<id>`) exige ticket opaco de uso
  único (TTL de 30s, `POST .../sessions/:sessionId/socket-ticket`) em
  `connect/3` — NÃO o JWT reaproveitado. O engine consome o ticket lendo
  `session_socket_tickets` direto (mesmo padrão de `outbox_events`);
  reconexão, inclusive automática, sempre busca ticket novo (RN-108).
  A consequência prática vale para TODO construtor de `Socket` do
  repositório, o do `/runner` inclusive: o auto-reconnect embutido do
  `phoenix.js` repete os MESMOS `params`, então ele é NEUTRALIZADO na
  construção (`reconnectAfterMs: () => NUNCA_RECONECTAR_SOZINHO_MS`, 24h) e a
  reconexão é sempre a política PRÓPRIA do módulo, com ticket fresco. Isso já
  falhou em DOIS dos quatro (`apps/runner/src/channel.ts` e
  `apps/web/src/lib/fs-browser-channel.ts`), e no runner o docblock AFIRMAVA a
  neutralização que o código não fazia — 530 req/min contra o teto de 300 do
  `RATE_LIMIT_USER`, com o 429 aparecendo no navegador do usuário dono da
  conta. Por isso a opção é OBRIGATÓRIA no tipo (`OpcoesDoSocket` do runner) e
  é asserida por teste sobre a OPÇÃO passada ao construtor: teste que só
  verifica "conecta" passa com o defeito de pé, e passou. Comentário não é
  mecanismo.
- O produto NUNCA sobrescreve configuração de repositório do usuário
  (proteções, branches) sem plano aprovado explicitamente (regra da
  FASE 12, origem no ADR 0028).
- Commits de agentes usam identidade "<agente>[bot]" com o usuário
  como co-author.
- Todo desfecho de falha de agente registra a ORIGEM da falha
  (infra | modelo | código | política) — nunca diagnóstico por
  eliminação (lição do ADR 0020). Falha NUNCA vira resposta vazia no
  event log, e o motivo NUNCA fica só em broadcast: `agent.error` é
  durável e o agente diz o que houve no fio (RN-059). Falha de UMA
  ferramenta no meio do laço segue a mesma régua (RN-163).
- Os seis agentes conversacionais rodam laço bounded de tool use, com
  teto PRÓPRIO no servidor de cada um (Criativo e PO 12, Arquiteto, Dev
  Lead, UX Designer e Staff 14 — raciocínio, não conversa leve) — não o
  teto do `ToolLoop` (`Engine.Harness.Iteracoes`), que é dos agentes de
  execução e de gate. Erro de ferramenta é ENTRADA do laço, não fim de
  linha; teto esgotado é narrado, nunca silêncio, nos SEIS (RN-163;
  RN-459 fechou os quatro que ainda terminavam calados — só PO e
  Criativo tinham corrigido antes); e o agente não anuncia ação que o
  código não vá executar — o que se promete é decidido pelo teto, nunca
  por texto fixo (RN-163). O Staff é o único SEM `kickoff/1` — sobe e
  fica ocioso até a primeira `user_message`, porque não há artefato de
  sessão para sintetizar uma abertura (ADR 0088). Durante o turno, a
  tela de Sessão narra em tempo real o que o agente está fazendo numa
  faixa acima do composer — o fio só recebe a bolha de resposta depois
  que o turno termina (RN-460).
- O turno de um agente conversacional pode SUSPENDER esperando aprovação
  humana (ADR 0086, RN-284) — hoje só o Dev Lead, no `propose_execution_plan`.
  `Engine.Agents.TurnoAssincrono` responde ao `from` síncrono na hora
  (rompendo o bloqueio do `GenServer.call` de até 180s), mas emite
  `agent.status: awaiting_approval` em vez de `agent.done` quando o `state`
  devolvido carrega `:aguardando_aprovacao` com valor não-nulo. Enquanto
  suspenso, `user_message` não inicia turno novo — vira `agent.error`
  explicando a pendência. Sem tabela de estado própria: restart do engine
  durante a espera perde a inscrição no `Engine.Dev.Wake`, lacuna aceita e
  declarada (a decisão continua registrada em Aprovações).
- A chave de LLM que um agente gasta é a do OWNER do workspace
  (RN-058); o relatório desse gasto é do owner e só dele (RN-060). O
  membro vê o PRÓPRIO consumo por ATOR, em tokens e custo estimado, e
  NUNCA quebrado por provider ou credencial — as duas leituras respondem
  perguntas diferentes e nenhuma é recorte da outra (RN-101/ADR 0063).
- Métrica de execução de agentes é extraída do event log/token_usage
  por script, nunca anotada manualmente (lição da Fase 10/13). A busca do RAG
  segue a mesma régua e acrescenta uma (RN-479..481): quando o instrumento de
  medição não cabe no event log, ele vira TABELA, e a tabela — nunca o evento —
  é a fonte. `session_events.session_id` é `NOT NULL`, e a busca vinda da aba é
  de PROJETO: medir pelo evento perderia justamente as buscas com julgamento
  humano. O evento (`rag.search`/`rag.feedback`, só quando há sessão) é
  NARRAÇÃO da timeline. E o que o instrumento mede vai CONGELADO na linha — os
  pesos da busca, como o preço no metering (ADR 0042) e a `image_version` em
  `project_containers` —, senão a primeira calibração reescreve calada o
  significado de toda medição anterior. Gravar medição NUNCA derruba o que ela
  mede, e também não falha calada: origem `infra` no log e um `null` explícito
  na resposta, que a tela distingue de "não achei nada".
- As CINCO filas de decisão do projeto (aprovações, merges de PR, promoções
  de história, pendências de arquitetura, hipóteses do Psicólogo) nunca são
  SOMADAS — nem nos contadores do trilho (ADR 0126) nem no painel "precisa de
  você" que as reúne (RN-467), cujo chip anuncia PRESENÇA e não quantidade.
  Somar apaga qual fila está pedindo atenção. E o painel é ATALHO para a
  decisão, nunca substituto: ele renderiza o mesmo `ApprovalCard` e chama os
  mesmos endpoints, sem tocar em teto nenhum — em especial o de merge em
  branch protegida (`decide.ts`, `require_approval` incondicional). Tela que
  não tem a data de um registro DIZ de onde tirou a que mostra, ou não mostra
  data: a pendência de arquitetura não tem instante gravado e a linha declara
  que a data é da história relacionada.
- Tela que mostra um RECORTE diz que é recorte (RN-180). Toda leitura tem
  teto — `limit: 200` nos eventos e nas ações —, e teto silencioso faz a
  tela afirmar sobre o que não leu. O número que falta sai de SUBTRAÇÃO
  sobre o `seq` (gapless, por sessão), nunca de uma requisição a mais:
  é o mesmo mecanismo do sino (RN-100). Quando houver como carregar o
  resto, o controle mora onde o corte aparece.
- Ação de UI que vira N chamadas não é transação, e a tela DIZ isso (RN-469).
  Salvar uma seção de Configurações é um PUT por linha suja — em série, na
  ordem da tela, sem abortar na primeira recusa. O desfecho é POR LINHA: só o
  rascunho que a api confirmou some, o que falhou fica no campo e a seção
  continua marcada por ele, e os três desfechos não se disfarçam um do outro —
  todas passaram, NENHUMA passou (a mensagem da API, nunca uma contagem),
  ALGUMAS passaram (quantas de quantas, nomeando as que ficaram). Botão de
  seção deve a contagem do que está pendente, senão "Salvar" diz o mesmo com
  uma linha suja e com cinco. E a régua de quando o botão existe é o CONTROLE,
  não a seção: campo DIGITADO precisa de confirmação, escolha de valor NOMEADO
  salva no `onChange` — não converta as seções de autosave. O que essa régua
  mede é de QUEM é o valor, e há UMA exceção, declarada (RN-476): o seletor que
  aplica um modelo a TODOS os agentes tem botão, porque o valor dele não é
  configuração de nada — é o ARGUMENTO de uma ação sobre 17 linhas que a pessoa
  não estava editando, e no `onChange` um clique exploratório num dropdown as
  reescreveria. Ela grava no nível do AGENTE de propósito: pelo projeto os 17
  herdariam, mas o endpoint de projeto pede `maintainer` onde o de agente pede
  `developer`, e o binding de projeto é também o default de SESSÃO, que a RN-040
  deixa livre. O preço — as 17 linhas divergem, com origem `agent` — é
  declarado, não escondido.
- Tela NUNCA repete o enum do banco como se fosse resposta, e não colapsa
  dois estados por eles compartilharem um valor (RN-470). `origin: 'agent'`
  da cascata de modelo quer dizer DUAS coisas — o agente tem binding próprio,
  ou a cascata pousou em `workspace` e `herdarModeloDeStart` trocou o valor
  pelo do Criativo. A api está certa em devolver `agent` nos dois (o valor
  veio mesmo de um agente): quem separa é a TELA, e ela separa mostrando a
  cascata inteira como cadeia — `workspace › projeto › área › agente`, com
  `vigente`/`definido`/`vazio`/`pulado` por nó, o nível que a cascata alcançou
  marcado como definido-e-não-vigente quando o Criativo entrou, e um nó extra
  nomeando o Criativo. A derivação é do CLIENTE, sem endpoint novo; o que ela
  NÃO consegue provar (agente com linha própria igual à do Criativo) fica
  declarado, e a ação que só importa nesse caso continua acionável. Vazio tem
  texto próprio e vazios diferentes têm textos diferentes — um traço que serve
  a três significados não é neutro, é a tela recusando nomear o que sabe.
- Controle que oferece escolha abre oferecendo o que a api ACEITA naquele
  escopo, e quem decide isso é o ESCOPO, nunca a tela (RN-040). O filtro
  "aptos para agentes" do `ModelPicker` vem MARCADO nas duas telas que gravam
  onde `assertModelFitsBindingScope` exige tool calling — `agent` e `area` — e
  DESMARCADO no seletor de sessão, que grava num escopo livre de propósito:
  marcar ali esconderia o que o domínio permite, que é o defeito inverso. É
  estado INICIAL de um checkbox, nunca trava — desmarcar volta a listar tudo —,
  e não elimina o 422: cobre UMA das três causas, e a tela continua devendo o
  desfecho de recusa. Filtro ligado por padrão cria uma dívida própria: o
  vigente que ele esconde da LISTA (herdado de `project`/`workspace`, níveis que
  nunca exigiram tool calling) precisa ser DITO, com o nome do modelo e a causa
  — o gatilho mostrando um nome que a lista não contém é a tela se contradizendo.
- E o controle só é oferecido a QUEM a api deixa usar — a régua acima decide o
  QUE se oferece, esta decide a QUEM. O mínimo é do ENDPOINT, nunca da seção
  (RN-102): modelo por AGENTE pede `developer`, modelo por ÁREA pede
  `maintainer`, e as duas seções são vizinhas na mesma tela. Copiar o gate da
  vizinha por parecerem iguais produz o defeito INVERSO do que corrige, e o
  inverso é PIOR — oferecer o que será recusado ao menos termina num toast,
  enquanto trancar quem podia é invisível para quem perdeu a capacidade. A
  comparação sai de `roleAtLeast` (`apps/web/src/lib/roles.ts`, sobre
  `ROLE_ORDER`; mesmo nome da função do backend porque é a mesma regra dos dois
  lados), nunca de `role === 'x' || role === 'y'` à mão: a lista à mão acerta por
  acidente enquanto o mínimo é alto e erra calada quando é baixo. Papel AUSENTE
  não alcança nada. O que se tira é o CONTROLE, nunca a INFORMAÇÃO (ADR 0064):
  quem não pode editar continua vendo o valor vigente e a cadeia inteira, o
  controle fica inerte no lugar, e o motivo é dito UMA vez em TEXTO na seção —
  `title` em elemento `disabled` não abre no Chromium, então explicar por tooltip
  é não explicar. Nada disso é fronteira de segurança (quem recusa é o
  `RolesGuard`). O papel a LER é o EFETIVO do projeto — `projectRole ??
  workspaceRole`, uma SOBREPOSIÇÃO nos dois sentidos, e nunca "o maior dos dois"
  que três descrições de OpenAPI ainda prometem (RN-471). Onde a tela já busca
  `project_members` ele é DERIVÁVEL e a lacuna se FECHA (a seção de Membros, que
  compõe da lista que já carrega); onde não busca, lê-se o do WORKSPACE e a
  lacuna se DECLARA (as duas seções de modelo). É UMA lacuna vista de dois
  lados, não uma por seção — não a declare de novo onde os dados estão à mão,
  nem invente uma segunda fonte de papel onde não estão.
- Sinal de ambiente diz o que SABE, e proxy nunca vira garantia (RN-468).
  A tela de login é PRÉ-identidade: só cabem ali os dois `/health`, que já
  são públicos nos dois serviços — presença de runner
  (`{user_id, project_id}`) e modelos locais (`projects/:projectId/models`)
  não têm sujeito antes do login, e a tela DECLARA essa ausência em vez de
  omiti-la. Sonda tem TETO, e os três estados (`verificando`/`respondendo`/
  `sem resposta`) nunca colapsam — RN-088 vale aqui também. O formulário
  NUNCA espera pela sonda. Pós-login, `workspaceVerifiedAt` é registro de
  uma confirmação, não batimento: reconectar com o mesmo caminho nem
  regrava o carimbo, então a tela diz "pasta confirmada em <data>" com a
  ressalva, e nunca "de pé" nem bolinha verde. Quem sabe do AGORA é o
  socket do terminal, na aba Código.
- Evento tem DUAS classificações no cliente, e elas não se substituem:
  `ActivityKind` (assunto — decide ícone e cor) e `OrigemDeEvento`
  (camada — `eventos|sistema|llm|harness|agente|usuario`, RN-177). A
  origem tem UMA fonte, `apps/web/src/lib/activity.ts`, consumida pelo
  painel de log E pelo fio; a precedência dos `if` é a regra (mecanismo
  vence ator, ator vence prefixo de agente) e tipo desconhecido cai em
  `eventos` — nunca some nem abre categoria nova.
- Testes: vitest (api/web/scripts de CI), ExUnit (engine). Nenhuma
  feature sem teste do caminho feliz + 1 caso de falha. Providers de
  git e de LLM validados por suas suites de contrato únicas. A quarta
  camada é o E2E de navegador em `e2e/` (ADR 0120) e ela responde uma
  pergunta que as outras três NÃO respondem — "um navegador de verdade,
  em outra origem, entra e fica dentro?". Ela não substitui nenhuma:
  comportamento continua sendo coberto embaixo, e teste que caberia na
  suite do web não sobe para cá.
- Capability só é declarada quando provada pela suite; sem prova,
  declara-se false e degrada (regra dos ADRs 0041/0042, vale para git
  e LLM).
- O contrato de LLMProvider tem DUAS operações opcionais, e as duas seguem a
  mesma regra de dois lados: `listModels` (Fase 9c) e `embed` (ADR 0075,
  RN-189..191). Embedding é LOTE e devolve **um vetor por entrada ou erro** —
  nunca lista mais curta, porque a ordem é o único vínculo entre entrada e
  vetor e uma resposta parcial é indetectável depois. O erro LANÇA normalizado
  por `code` em vez de virar chunk: não há turno em andamento cujo gasto
  precise sobreviver. A capability tem duas camadas como as outras, com uma
  diferença que precisou ser nomeada: tool calling é GRADIENTE (modelo sem
  ferramenta ainda conversa) e embedding é EXCLUSÃO — modelo de chat não
  vetoriza e modelo de embedding não conversa (RN-190), conjuntos disjuntos.
  Só o `ollama` declara `embeddings: true`, provado contra o daemon real; os
  outros oito degradam com `false` (RN-191), e virar essa flag exige smoke com
  credencial, nunca leitura de doc. O gasto de embedding NÃO passa pelo
  metering ainda — corte declarado do ADR 0075, porque `token_usage.session_id`
  é `NOT NULL` e indexar repositório não acontece dentro de sessão.
- UI: fidelidade estrita ao design system em design/ (tokens, tipografia
  Space Grotesk/Archivo/IBM Plex Mono, dark mode primário). Contraste é
  medido por teste sobre os tokens e layout é verificado no navegador
  por scripts/dev/validacao-visual.js — as duas validações estão
  explicadas em design/README.md.
- Os DOIS temas são alcançáveis e os DOIS são medidos (ADR 0074,
  RN-182/184). `data-theme` é escrito por `apps/web/public/theme-boot.js`,
  ARQUIVO e não script inline — a imagem serve sob `script-src 'self'`, e
  inline passa em dev e é bloqueado em produção. A preferência mora em
  `localStorage['brabo.theme']` e a API é `apps/web/src/lib/tema.ts`;
  nenhum componente escreve o atributo por conta própria. Dívida de
  contraste é do tema ESCURO e está travada por número — não afrouxe um
  piso para passar, e não deixe o claro nascer pior que o primário.
- O handoff estabelece a INTENÇÃO; a medição estabelece o NÚMERO, e o
  produto estabelece o MECANISMO. Já valeu três vezes: as fontes (ADR
  0036), o boot de tema inline e cinco dos oito `--syn-*` que reprovam
  4,5:1 contra o próprio `--code-bg` do handoff (ADR 0074). Nome do
  handoff que já existe com outro nome entra como ALIAS, nunca
  renomeação — `--font-display`, `--shadow-modal` e `--r-md`/`--r-lg`/
  `--r-pill`; e `--r-sm` (7px) NÃO é sinônimo de `--radius-sm` (4px).
- Tipo novo de `proposed_action` nasce com FRASE em pt-BR em
  `apps/web/src/lib/aprovacoes.ts` — verbo e frase têm UMA fonte, e as
  três telas de decisão (Aprovações, chat da sessão, Insights) a
  consomem. `apps/web/src/lib/aprovacoes.test.ts` lê `ACTION_TYPES` do
  `decide.ts` e reprova tipo sem frase; payload cru nunca é despejado,
  nasce colapsado (RN-096).
- Segredos de usuário (API keys de LLM e tokens de git) criptografados
  com envelope encryption; nunca em plaintext no banco ou em logs.
- Decisões arquiteturais relevantes registradas em docs/adr/.

## Documentação é parte da definição de pronto (permanente)
- Ao alterar código, consulte docs/.docmap.yml e atualize os docs
  mapeados NA MESMA mudança, mostrando o diff da doc junto com o do
  código. Não pergunte se deve fazer — faça.
- Fonte de verdade do Markdown: docs/ na raiz. NUNCA crie website/docs/
  — o site lê de docs/ via path.
- Arquivos generated: true no docmap são gerados por pnpm docs:generate
  — nunca editados à mão (o próximo build sobrescreve). Se o gerador
  marcar algo como "sem descrição acima", é lacuna real: escreva a
  descrição na prosa.
- Mudança de comportamento observável → entrada em CHANGELOG.md
  (Unreleased).
- Mudança estrutural (fronteira de camada, banco, modelo de
  consistência, dependência pesada) → ADR novo com o próximo número.
  ADR aceito NUNCA é editado: o novo referencia o antigo.
- Regra de negócio nova → RN-XXX com arquivo:linha e o teste que a cobre,
  em docs/business-rules.md — EXCETO as duas famílias que saíram dele por
  TAMANHO (não por assunto): custo/orçamento/metering vai em
  docs/business-rules/custo.md e auth first-party em
  docs/business-rules/autenticacao.md. As três contam para a mesma numeração
  (nunca reinicie por arquivo) e para a mesma contagem, que o docs:check afere
  somando os três por glob. Âncora `{#rn-NNN}` é o contrato: ela não muda
  quando uma RN muda de arquivo, e link de fora aponta para o arquivo que a
  hospeda hoje.
- TODA mudança verifica se ESTE arquivo precisa mudar — Stack, Convenções,
  "O que NÃO fazer" e o estado das fases. Não pergunte se deve: verifique.
  O gatilho é o mesmo do docmap, e o motivo é que este arquivo é o único
  documento lido em TODA sessão: desatualizado, ele não é neutro, ele
  ensina errado. Ele tem regra `warn` no docmap (não `block`, porque não
  mora sob docs/ e o checker valida glob e link dentro de docs/ — promover
  sem estender o checker criaria regra que se burla com `docs-not-needed`).
- A documentação publica um site por branch permanente, e o CAMINHO nomeia o
  AMBIENTE, não a branch (ADR 0073): `main` → `/brabo/prd/`, `qa` → `/brabo/qa/`,
  `dev` → `/brabo/dev/`, com a raiz sendo o índice gerado por
  `scripts/docs/landing.mjs`. O mapa branch→caminho existe num ponto por
  processo (o passo do `docs-deploy.yml`, `DEGRAUS` no `docusaurus.config.ts` e
  no `landing.mjs`) — nunca interpole `$GITHUB_REF_NAME` num caminho.
- A versão anunciada em PROSA é verificada por `pnpm docs:check` em DOIS
  arquivos, contra o primeiro `## vX.Y.Z` do CHANGELOG: `README.md` e
  `docs/intro.md` (a primeira página do site). Quem escreve os dois é
  `scripts/ci/readme-version.ts`, no mesmo commit do corte do CHANGELOG —
  cobrar o que o gerador não escreve faria todo release nascer vermelho numa
  PR do bot. Frase alterada sem ajustar o padrão reprova como `CEGO`, de
  propósito.
- Frase ancorada num lugar do CÓDIGO entra em
  `verificarFrasesAncoradasNoCodigo` (`scripts/docs/generate.mjs`) — mesma
  tabela-por-frase das contagens, só que o esperado é DERIVADO do artefato e
  não é um número. Hoje são três: a escada da esteira no `description` do
  `branching-policy.md`, derivada de `ESCADA` em `scripts/ci/pr-police.ts`
  (NUNCA de `PROTECTED_BRANCHES`, que tem `rc` de propósito), e as duas frases
  de `db:generate` (`README.md` e `docs/getting-started.md`), derivadas de
  `apps/api/src/db/schema.ts` ser ou não barrel. Consequência prática: mudar a
  escada ou desfazer o barrel reprova o `docs:check` até a prosa acompanhar.
  Padrão que para de casar reprova como `CEGO`, e a FONTE sumir também.
- Variável de ambiente tem ESCOPO no inventário gerado — `produto` (o que o
  operador põe no `.env`) ou `ferramenta` (só CI e quem desenvolve) —, e a
  fonte nova nasce com o dele. Fonte que mora direto numa pasta precisa de
  DOIS globs: `**/` no pathspec do git exige pelo menos um nível de diretório,
  e um inventário que nasce vazio não avisa, passa verde.
- Antes de finalizar: pnpm docs:check e pnpm docs:build verdes (glob
  morto, gerado fora de dia e link quebrado reprovam).
- Nunca inventar conteúdo de doc: sem informação suficiente, use
  > **TODO(humano):** <pergunta específica>.
- Diagramas em Mermaid no próprio Markdown. Nunca imagem de diagrama.
- O mecanismo inteiro está explicado em
  docs/explanation/documentation-workflow.md — leia antes de desligar
  qualquer peça dele.

## O que NÃO fazer
- Não usar Redis (filas ficam no Postgres via Oban)
- Login social (GitHub/GitLab) deixou de ser proibido e está
  IMPLEMENTADO (ADR 0084, PROGRAMA 28/Onda 5, frente I) — a proibição
  foi revogada só para essa capacidade, por decisão explícita do dono
  do produto. O que continua valendo do backlog do ADR 0031: não
  implementar MFA, OIDC provider (a api virar provedor) nem federação
  genérica
- Dev Lead, áreas dinâmicas via module_map e o aparato genérico de
  áreas (agent_areas) deixaram de ser proibidos e estão IMPLEMENTADOS
  (ADR 0053 aceito, FASE 14d). O que continua valendo é o resto da
  regra: não abra área nova de passagem — área nova é decisão de
  produto, com ADR
- Não versionar à mão: toda tag nasce de workflow
- Não instalar libs sem justificar no plano
- Não refatorar código de fase concluída sem pedido explícito
- Não ativar modelo descoberto automaticamente: curadoria manual
  sempre (ADR 0042)
- Não corrigir de passagem os achados que seguem ABERTOS em
  docs/explanation/achados-execucao-real.md — corrigir fora da fase que os
  endereça apaga a evidência de por que existiam. Os 19 achados do
  dogfooding fecharam (19 de 19, ver a FASE 13c); o que resta aberto é da
  execução real e NÃO é bug a corrigir, é decisão de produto: Z/AD (o
  allowlist de verbos não converge — verbo, forma e invocação são espaços
  distintos) e AE (o agente de QA tenta consertar o código que julga,
  contra o próprio prompt, contido por duas barreiras independentes)
- (FASE 15 — CONCLUÍDA) O congelamento de gates valeu enquanto a fase
  corria — nenhum gate NOVO, nenhuma mudança de comportamento de gate
  existente — e terminou sem exceção nenhuma: a fase só DECLAROU e MEDIU
  o que já existia. Segue valendo a regra permanente de que gate novo é
  decisão de produto, com ADR
- (FASE 13 — CONCLUÍDA) O congelamento valeu enquanto a fase corria, e
  vale registrar como terminou, porque a regra funcionou: quatro exceções,
  todas pelo MESMO critério — só o que impedia a própria medição de
  acontecer. Fase F (achados S e U), achado W, achado Y e achado AB. As
  correções de INSTRUMENTO (o script da validação, o Noop, o medidor) não
  precisaram de exceção, e a distinção entre instrumento e produto se
  provou útil o tempo todo. O que a disciplina evitou está registrado: a
  nona execução podia ter passado liberando `bash` no allowlist, e isso
  teria destruído a garantia para fazer o teste passar