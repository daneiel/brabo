> Parte do `CLAUDE.md` da raiz, importada por ele e lida em toda sessão.
> Edite aqui; o `CLAUDE.md` só guarda o índice das partes.

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
- FASE 25b e o ciclo de vida do container (o broker por padrão só no compose
  de DEV, `container_start`/`_stop`/`_remove`, a ramificação por DESTINO): o
  texto inteiro mora em `.claude/rules/broker-e-containers.md`, carregado quando a
  sessão lê broker, `docker/` ou o código de container da api e do engine.
- Psicólogo PAUSADO desde 2026-08-10 (`PSYCHOLOGIST_ENABLED=false`),
  aguardando spec; Staff dormente para disparo automático (acionável manual —
  nenhum código o dispara, nem a Anamnese)
- A Anamnese foi RELIGADA em 2026-10-01 por decisão do dono (RN-680, ADR
  0196): `ANAMNESE_ENABLED` volta ao default `true` no `runtime.exs` e nos
  três composes (`START_ANAMNESE` não mudou: `false` só no de produção,
  divergência já declarada), com duas correções que são regra. (1) A rodada
  NÃO roda sem SUJEITO elegível — membro EFETIVO do projeto
  (`listEffectiveMembers`, a régua da RN-471; criar projeto não grava
  `project_members`, e era por isso que toda rodada do uso real de 29/09
  terminava paga em "nenhum membro elegível"), fora do opt-out, com
  interação PRÓPRIA na janela (`Engine.Anamnese.Elegibilidade`, antes da
  triagem; desde a RN-756 só conta interação de CONTEÚDO TÉCNICO — mensagem
  escrita, resposta estruturada, recusa com motivo —, nunca aprovação/handoff; nem a fila de hipóteses a atravessa). Sem sujeito: nenhuma
  chamada ao LLM nem ao RAG, motivo nomeado no log e, só na rodada pedida à
  mão, `anamnese.run_skipped`. (2) A hipótese que a PRÓPRIA pessoa aceitou
  (quem aceita é o autor da sessão) vira `FatoDoPerfil` no grafo, traduzido
  de `psychologist.hypothesis_accepted` pelo MESMO `GraphEventTranslator`, e
  entra no turno dos agentes que conversam com ela como mensagem `system`
  EFÊMERA (`Engine.Harness.PerfilDoAutor`, o caminho do idioma da RN-622;
  lida por `QueryUserContextUseCase`, escopada ao projeto, 5 fatos, teto de
  2 000 caracteres). Aceite de terceiro e recusa ficam só registrados.
  Desde a RN-716 (AT-376) a Anamnese não grava nível sobre o que não
  observou: perfil cuja evidência não inclui evento da PRÓPRIA pessoa, ou só
  tem cliques de aprovação (`proposed_action.approved`, `handoff.accepted`,
  `readiness.confirmed`), é recusado pela api como "não observado", sem
  `profile_updated`. A regra é de CÓDIGO (`validateProficiencyBatch`), não só
  de prompt; não a afrouxe para o lote passar. E o que a pessoa faz para
  reparar falha de agente não é traço dela: desde a RN-717 (ADR 0205) vira
  `anamnese.agent_deviation`, sinal do PRODUTO, com payload por lista de
  permitidos (agente, tipo fechado, `eventId`s), sem texto livre nem dado
  pessoal, e FORA do grafo do usuário — não o projete no
  `GraphEventTranslator`.
  Desde a RN-722 (decisões do dono de 02/10) a rodada que avalia a janela e
  encerra sem perfil a FECHA (`anamnese_runs` com zero perfis) — antes ela
  rodava paga a cada 15 min sobre a mesma janela, para sempre (~US$ 8,90/dia
  medidos); os eventos da própria Anamnese e os de sistema ficam fora da
  janela e da contagem; sujeito exige 5+ interações próprias NOVAS e o projeto
  tem no máximo 4 rodadas pagas por dia UTC — abaixo disso, nem LLM nem RAG.
- Psicólogo PAUSADO desde 2026-08-10 (`PSYCHOLOGIST_ENABLED=false`),
  aguardando spec — e a Anamnese esteve pausada junto até a RN-680. A pausa do
  Psicólogo segue valendo e a decisão de produto NÃO mudou — o que mudou na
  RN-540 é que ela passou a ser REVERSÍVEL de verdade: as duas flags não estavam mapeadas no `environment:`
  do serviço `engine` de compose NENHUM, o Compose não repassa o ambiente do
  host, e `ANAMNESE_ENABLED=true` no `.env` era inerte — `runtime.exs` caía no
  default `"false"` em silêncio, enquanto TRÊS lugares (os docblocks dos dois
  workers e `docs/reference/configuration.md`) prometiam que "ligar de volta é
  `X=true` e reiniciar". Medido no container: `[true] [] []`. As oito flags
  BOOLEANAS do `runtime.exs` estão nos TRÊS composes agora (o de instalação
  desde a AT-202), cada uma com o MESMO default do código salvo as duas chaves
  de boot que PRODUÇÃO desliga de propósito, DECLARADAS no spec, e
  `scripts/ci/flags-do-engine-no-compose.spec.ts` DERIVA a lista e reprova a
  próxima que faltar. A INSTALAÇÃO tinha a mesma divergência por CÓPIA e deixou
  de ter (AT-219): ali `START_OUTBOX_DRAIN=false` deixava o outbox sem
  consumidor nenhum — sessão encerrada não parava, dev agent esperando
  decisão/gate/container nunca acordava. Não "uniformize" produção e
  instalação em nenhum dos sentidos. As duas chaves de boot ligadas não gastam
  token com as flags de PRODUTO desligadas: o `kickoff/0` da Anamnese não
  agenda job, e o drain não enfileira o Psicólogo. E ligar a Anamnese periódica
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
- **O piloto automático confia na contenção do container, e ela tem bordas
  que a prova NÃO cobre (ADR 0189).** Provado em
  `apps/broker/src/contencao-do-brabo.spec.ts`: uma pasta só, em `/work`,
  estritamente abaixo da raiz do broker, sem socket nem privilégio. Declarado e
  NÃO remendado (a decisão foi descrever): no compose de PRODUÇÃO nada no host
  confere que `BRABO_PROJECTS_BASE` não contém o checkout/a pasta do `.env`
  (o preflight só roda no `pnpm dev`, e a api compara com o próprio `cwd`); o
  `install.sh` confere a base só no consentimento, sem teste; no modo `runner`
  nada compara a pasta com um checkout do Brabo na máquina do usuário;
  `segmentoDeProjetoValidado` aceita `.` (a api nunca o produz); e a rede
  `egress` alcança as portas publicadas da máquina. Fechar qualquer uma é
  decisão do dono, não correção de passagem
- **O Infra Lead propunha `container_start` às cegas; desde a RN-566 ele
  recusa por MODO, desde a RN-610 por ESTADO, e o que sobra da lacuna é a
  IMAGEM em `container`/`mounted`, de propósito.** A metade fechada:
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
  Desde a RN-610 (AT-142) o agente recusa também por ESTADO, na ordem da
  `/containers` e com as mesmas leituras locais (Postgres direto e o registro
  de runners, nunca HTTP): as DUAS tools recusam container já REGISTRADO
  `running`/`provisioning`, e `container_start_via_runner` recusa sem imagem
  decidida (ela não elege, sobe a decidida) e com pasta nunca confirmada
  (`workspace_verified_at` nulo), antes da checagem de runner conectado que já
  fazia. `GetInfraContextUseCase` NÃO mudou — a decisão foi recusa no
  despacho, não contexto. **O que SEGUE ABERTO, de propósito:** propor
  `container_start` SEM imagem decidida continua possível em
  `container`/`mounted`, porque ali a recusa por imagem inverteria a ordem —
  eleger a imagem é o que essa proposta FAZ (RN-491); não "complete" a régua
  da tela ali. Broker ausente na instalação e papel/sessão também não são
  checados pelo agente (o primeiro a api recusa ao propor, RN-591). O ADR 0137 (RN-497) segue valendo: aprovar `container_start` em
  `mounted` pode dar certo de verdade, pelo broker. Desde a RN-591 a instalação SEM
  broker também é dita: a api recusa a proposta com 409
  `sem_broker_na_instalacao` (a fonte é `ContainerBrokerPort.configurado()`; o
  engine NÃO lê `BROKER_URL`, e o texto da recusa chega ao modelo), a conversão
  de modo e "Parar"/"Remover" ficam inertes com o motivo em texto — só a
  ausência CONFIRMADA bloqueia a conversão, "não sei" não Desde a RN-577 o mesmo
  molde vale para a PR: `propose_infra_pr` (e o `propose_adr` do Arquiteto)
  recusam LOCALMENTE, antes de propor, projeto SEM repositório — o predicado é
  o MESMO de `ExecuteAdrPrUseCase`/`ExecuteInfraPrUseCase` (linha em
  `project_repositories`, lida direto do Postgres por
  `ProjectRepository.recusa_de_pr_sem_repositorio/2`), e no Infra Lead a
  pergunta vem ANTES do HALT, para não gastar o laço do Workflows numa PR
  impossível. A recusa deixa `tool.call` e `tool.result` (`ok: false`, com o
  motivo) no event log. ONDE o repositório nasce NÃO foi decidido ali (é a
  AT-092): o texto da recusa descreve o gatilho de hoje, o aceite do handoff
  ao Dev Lead (RN-522)
- **O `rollout-test` acusou sessão órfã de forma intermitente — TRÊS em treze
  rodadas** do `propriedades.yml` (BRB-009, AT-078). A causa provável foi
  CORRIGIDA na RN-588: o `Monitor` do pod antigo apagava a linha de
  `session_states` que o par acabara de regravar; o drain agora marca o repasse
  (`Monitor.expect_handoff/1`) e o Monitor não a apaga. Provado em ExUnit
  (entrelaçamento determinístico), NÃO no k3d — a confirmação é a próxima
  sequência de rodadas verdes, e uma nova órfã traria a linha de log do
  Monitor ("mantido"/"apagado"). Restam inferência: o instante do apagamento
  nunca foi medido, e a leitura vem do artefato da rodada `35452845830`.
  Histórico, até a correção: a rodada `35448353884`
  com as cinco sessões no MESMO pod antigo: quatro adotadas, uma sem dono e sem
  drenagem por 120s. Nas rodadas verdes a convergência leva 2–3s, então a
  leitura provável é corrida na adoção/drenagem, não atraso. Declarado e NÃO
  corrigido, e a regra do AT-078 é NENHUMA correção antes de reproduzir: o log
  que diria o que houve morria com o pod antigo, e desde o AT-078 a prova o
  guarda (`deploy/k8s/rollout-evidencia.sh`, artefato `rollout-evidencia`),
  junto com o instante do scale-down do HPA — o confundidor conhecido, que
  derruba réplicas NOVAS ~75s depois do rollout — e o veredito de a órfã ter
  ficado sem dono ANTES ou DEPOIS dele. A correção é do engine, não da prova —
  não afrouxe o teto, não ponha `sleep`, não mude o que conta como adotada ou
  drenada para o verde voltar
- Restart do engine com Dev Lead suspenso perde a inscrição no Wake (decisão
  segue visível em Aprovações) — ADR 0086
- Ciclo de gate parado há mais de 2 h ESTACIONA (`gate.rescue_parked`, ADR
  0207, RN-722, decisão do dono) em vez de ser retomado sozinho no boot ou no
  tick, e o resgate não reinicia ciclo cuja sessão tem ação pendente de ator do
  gate. Retomar o estacionado é o botão "Retomar gate" no aviso do fio
  (`POST /projects/:projectId/tasks/:taskId/gates/:gate/resume`, `developer`,
  409 `gate_nao_estacionado` — RN-724), que chama
  `GateRescuer.retomar_estacionado/3` pelo engine. O ciclo RECENTE que o
  próprio reinício matou não espera os 15 min: o boot o retoma quando nenhum
  nó do cluster o tem em voo (`:erpc`, nó mudo = vivo) e grava
  `gate.interrupted`, que o fio mostra (RN-823); o tick segue com o limiar
- Desde o ADR 0211 a aba de Código abre com 312px de moldura (sidebar 264
  + trilho do `CodeShell` 48), ou 110px com a sidebar recolhida (62 + 48) —
  soma das larguras, não medida no navegador. O trilho do projeto (ADR 0126)
  saiu e a sidebar (`AbasDoProjeto`) é a ÚNICA navegação do projeto, com os
  grupos, a aba ativa, o teclado e os cinco contadores (nunca somados); com
  a sidebar recolhida, as abas do projeto aberto ficam num flyout do quadrado
  do projeto. Os cinco números só aparecem com a moldura do projeto montada:
  na tela de Sessão fica só o de Aprovações do resumo, porque ligar o hook ali
  estoura o orçamento de duas abas (RN-632) — não "complete" isso com query
  nova
- A presença de QA/SecOps, dos membros de área e dos dev agents
  (`gatesEverOpened`, `delegatedSubagents`, `executionActivated`) deixou de
  sofrer da janela de 200 eventos (RN-568): as duas telas passam o agregado do
  resumo como `agregado`, que SOMA à janela e só vale com o resumo da MESMA
  sessão. Desde o AT-130 o `executionActivated` da aba Executores passa pela
  mesma guarda (antes um resumo de sessão mais nova apagava os dev agents), e
  `deriveAgentRoster` também o lê da janela — a lacuna fechou
- Conversão de `execution_mode` nunca migra diff NÃO commitado — órfão no
  disco antigo (RN-447..450, ADR 0111). O órfão CONTINUA; o que mudou na
  RN-560 é que a tela parou de dizer o contrário: o aviso afirmava *"isto
  migra a pasta de trabalho do agente"* nos dois idiomas, e agora diz os três
  fatos separados (o que a conversão RECUSA, o que ela LEVA — a política do
  `permissions.json` —, e o que ela NÃO leva), NOMEANDO o caminho antigo, que
  some da tela assim que a conversão salva. Ele não promete detecção de diff
  (I/O por modo, impossível para `runner` do lado da api). Desde a AT-144 ele
  diz também as consequências CONDICIONAIS, e só quando valem para ESTE
  projeto: o espelho zerado (`mirrorPath` preenchido), o container removido (o
  projeto é `container` HOJE e o ciclo de vida existe fora de `removed` — a
  MESMA condição de `removerContainerSeExistir`, que só roda ao SAIR de
  `container`; em `mounted`/`runner` o caso de uso não toca o container e o
  aviso não diz o contrário) e a pasta confirmada que deixa de valer
  (`workspaceVerifiedAt` preenchido). Nada de listar o que não se aplica, e a
  leitura do ciclo de vida que falha vira texto próprio, nunca "não há
  container". Migrar conteúdo entre modos continua fora, sem dono
- `ExecutionModeSection` fechou os DOIS ramos: `mounted` abre o MESMO
  `FolderBrowserModal` da criação (RN-559, `origem: { tipo: 'api', workspaceId
  }`), e `runner` é converte, DEPOIS onboarda (RN-612, AT-143): salvar a
  conversão monta, na mesma seção, o `RunnerOnboardingPanel` do projeto agora
  `runner`. A ordem inversa segue impossível (onboardar antes registra chave
  num projeto que ainda não é `runner`, e `ConfirmProjectWorkspaceUseCase`
  recusa com 400) — não a reabra mexendo nessa recusa. A medição que decidiu
  foi de CÓDIGO: o agente de máquina que ESPERA (zero projetos, RN-550) pega o
  projeto sozinho em até 60 s; o que já atende OUTRO projeto só depois de
  reiniciar o serviço, porque a lista é lida uma vez com conexão viva — a tela
  DIZ os dois casos, com o comando, sem afirmar qual é o da pessoa. O caminho
  digitado é PROVISÓRIO (a confirmação do runner o sobrescreve, RN-423, e o
  agente de máquina usa `<base>/<workspaceDirName>`), e o navegador de pastas
  segue FORA do ramo `runner` por construção, não por ordem: o transporte
  `{ tipo: 'runner', projectId }` exige runner conectado, e um runner conectado
  já confirmou a própria pasta — escolher outra seria uma conversão que a
  próxima reconexão desfaz
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
  **O que segue aberto, e agora é só isto:** (1) a instalação SEM PROJETO
  deixou de ser lacuna na RN-611 (AT-118): a chave de MÁQUINA tem listagem e
  revogação por CONTA — `GET`/`DELETE /users/me/machine-device-keys`, sem
  `@RequireRole` (escopo é a própria pessoa, como `users/me/*`), SÓ a espécie de
  máquina (chave de projeto é 404, a mesma resposta de alheia ou inexistente) e
  SÓ as do chamador — e a seção "Chaves de máquina" na Conta (`/account`). A
  revogação por conta DELEGA a `RevokeRunnerDeviceKeyUseCase` e o alvo NÃO muda.
  Registrar SUBSTITUI a anterior CONTINUA, pela razão que não dependia de tela
  (o token de serviço não fabrica credencial em série; a máquina reinstalada não
  deixa chave viva esquecida) — a Conta passa a MOSTRAR a substituída, revogada,
  e diz por quê. As listas de chave têm DUAS `queryKey`s
  (`['runner-device-keys', projectId]` e `['machine-device-keys']`), e toda
  revogação passa por `invalidarChavesDeDispositivo`
  (`apps/web/src/lib/chaves-de-dispositivo-queries.ts`), que invalida a de
  projeto por PREFIXO e a da Conta sempre: a de máquina aparece nas duas, e
  invalidar só a própria deixa o painel anunciando a revogada. Segue aberto: a
  rota que CRIA chave de máquina só serve instalação de UMA pessoa (409 com
  duas ou mais), então instalação com time não tem por onde criar chave de
  máquina — declarado, não acaso. (2) O ALVO da revogação deixou de ser
  `{projeto, usuário}` e passou a ser a CHAVE (RN-685, ADR 0201, revisando a
  RN-520): `runner_socket_tickets` guarda QUAL credencial pediu o ticket
  (`credential_kind`/`credential_id`, nuláveis — `terminal` e ticket de api
  anterior não têm), o socket a guarda em `assigns` e no `id`, e a revogação
  de chave ou de PAT pede `POST /internal/runner/disconnect-credential`, que
  anula os tickets pendentes dela e pergunta a TODO runner do cluster se nasceu
  dela — outro runner seu, com PAT ou outra chave, fica de pé, e a confirmação
  da tela diz isso. NÃO apague as duas peças de transição: a conexão LEGADA
  (ticket sem credencial) cai pelo par nos projetos que a api manda, e engine
  sem a rota faz a revogação de chave voltar ao par — sem elas a revogação
  deixaria de derrubar o que derrubava (RN-519). O par
  `runner/disconnect` continua, como alvo da remoção de membro (RN-615). (3) A visão de `maintainer` (listar/revogar de
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
  de máquina nunca ganha verde. O fluxo do ADR 0118 (o navegador gerando a
  chave, baixando o binário e gravando a pasta) foi APOSENTADO no ADR 0203
  (RN-687, BRB-031 fechado): o painel manda para o `install.sh`, com o
  comando, e o instalador SAI do painel quando há chave reconhecida; o comando
  manual com PAT fica no `<details>`, como o caminho de OUTRA máquina. A rota
  `POST .../runner-device-keys` saiu junto (sem chamador); `GET`/`DELETE`
  ficam, e chave de PROJETO já registrada continua valendo e revogável — não
  "limpe" a espécie `projeto` do banco nem do guard: é ela que mantém de pé o
  runner configurado pelo navegador antes do ADR 0203. Preço declarado:
  instalação com TIME não tem mais caminho sem PAT para parear uma segunda
  máquina, e `GET /runner-releases/binary` ficou sem consumidor de produção,
  mantido por decisão à parte
- **O instalador sobe de uma pasta vazia desde a RN-570 (ADR 0160), mas só a
  partir da PRÓXIMA tag final.** O compose de instalação e os três arquivos que
  a instalação usa por caminho relativo viajam como assets `brabo-install-*` no
  MESMO `checksums.txt` assinado, e o `install.sh` os confere antes de perguntar
  ou gravar. Releases já publicadas NÃO ganham os assets (seguem exigindo
  checkout na tag), e a prova ponta a ponta só roda depois de uma tag (o
  `install-e2e.yml` não roda em PR). A tabela tem DOIS lados —
  `scripts/ci/assets-do-instalador.ts` e o `case` do `install.sh` (bash 3.2, sem
  Node) — e o spec reprova a divergência e todo bind-mount relativo do compose
  fora dela: bind-mount novo no compose de instalação ENTRA NA TABELA, senão não
  viaja. A prova de restauração da MIGRAÇÃO fechou (AT-102): o `install.sh` passa
  `BRABO_ENV_FILE="$PWD/.env"` a `test-restore-compose.sh`, que o entrega ao
  Compose por `--env-file` (e recusa arquivo inexistente, sem cair noutro), e o
  compose de instalação passou a DECLARAR o volume `backup_local` — a ausência
  dele invalidava o arquivo inteiro assim que o profile `backup` ligava, por um
  motivo que nem o `.env` corrigia
- O broker da instalação (ADR 0162, RN-575) só existe a partir da PRÓXIMA tag
  final: o `install.sh` exige `broker` no `images.json`, que Releases
  anteriores não têm, e a prova ponta a ponta (o E2E responde SIM à pergunta e
  confere o broker healthy, a api o alcançando e a raiz conferida) só roda em
  tag. Não medidos: o `DOCKER_GID` e a raiz da pasta gerenciada no Docker
  Desktop do macOS (a metade interativa do E2E é só Linux); Docker rootless ou
  remoto cai na recusa da medição, porque o compose monta
  `/var/run/docker.sock` fixo. Desligar depois exige `rm -sf broker` com o
  profile — `up --remove-orphans` NÃO o remove (medido: serviço sob profile
  desligado continua DEFINIDO, não é órfão)
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
- Gasto de embedding fora do metering (corte declarado do ADR 0075), salvo a
  checagem de duplicata semântica (ADR 0198, RN-681), que é linha própria
- O limiar da duplicata semântica (0,80, RN-681) é PONTO DE PARTIDA NÃO
  calibrado: os vetores reais dos pares de calibração não puderam ser gravados
  (registry do Ollama e Hugging Face bloqueados no ambiente). Gravar é
  `apps/api/scripts/gravar-vetores-de-duplicata.ts` com o Ollama de pé; a prova
  (`limiar-de-duplicata.calibracao.spec.ts`) PULA até lá. Não mexa no número
  sem gravar, e se a gravação não separar os pares, reveja os pares ou o texto
  comparado — nunca afrouxe o teste
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
- A chamada ao broker tem teto POR OPERAÇÃO desde a RN-604 (`tetoDaOperacao`,
  `container-broker.client.ts`), e a cadeia do `exec` é broker < api <
  engine — mexer no teto de um salto sem o de cima reabre o defeito, e os
  testes dos dois lados conferem a ordem. Desde a RN-757 (AT-440) a cadeia
  tem um QUARTO salto, o de fora: a ação `terminal` auto-aprovada é executada
  dentro do `propose_action`, e o engine a espera por
  `TERMINAL_ACTION_TIMEOUT_MS` (agora 120s, era 15s) + 120s — broker (T) <
  api (T + 45s) < `container-exec` (T + 90s) < `propose_action` (T + 120s),
  abaixo dos 300s do `fetch`; o estouro chega ao modelo nomeando o teto, e
  esse teto passar de ~180s reabre o corte. O estouro do `exec` é decidido pelo RELÓGIO, não
  pelo `killed` — o cliente `docker exec` sai 0 ao receber o SIGTERM —, e o
  grupo do comando é morto DENTRO do container pelo PID que o embrulho grava
  (RN-807); não volte a confiar só em `killed`. Segue aberto, por DECISÃO do
  mantenedor (AT-234, opção D, RN-605): imagem grande não sobe na primeira
  tentativa. O pull é passo explícito do `start` (`image inspect` → `pull`)
  sob o MESMO `TIMEOUT_DE_CONTROLE_MS` de 30s, e o estouro é
  `PullExcedeuTetoError` (504, origem `infra`) — antes saía "código -1" com
  `origem: null`. Matar o CLI CANCELA o pull (medido): a imagem NÃO segue
  baixando por trás. Não suba o teto de passagem: as outras três saídas
  (teto próprio, `start` assíncrono, pull antecipado) foram medidas e
  recusadas. Os tetos de quem espera o `start` contam as SEIS chamadas de
  controle (`CHAMADAS_DE_CONTROLE_NO_START`): 195s na api, 185s no
  `RunnerRouter`, 225s no `propose_action` do engine para as ações de
  container que a api executa auto-aprovadas. E `timeoutMs` acima de ~255s
  esbarra nos 300s de cabeçalhos do `fetch` do Node

**Pendências com dono humano (TODO(humano) vivos):**
- Smokes de LLM: 5 de 6 providers sem credencial no ambiente (só OpenRouter
  rodou real); `GITHUB_TEST_TOKEN`/`GITLAB_TEST_TOKEN` idem para git
- A capability `routingPreference` (ADR 0166, RN-583) é `true` SÓ no
  OpenRouter desde 2026-09-29 (AT-158), PROVADA:
  `openrouter-provider.roteamento.smoke.spec.ts` rodou com credencial real e o
  critério mudou o upstream que serviu (`meta-llama/llama-3.3-70b-instruct`:
  `price` → DeepInfra, `throughput` → Groq). A prova é a DIFERENÇA entre
  critérios, não o aceite do campo — o modelo antigo do smoke devolvia o mesmo
  upstream para todos e não provava nada. Os outros oito seguem `false` e,
  para eles, a feature segue DORMENTE (422 na rota). Ligar outro provider exige
  o smoke equivalente com credencial e a saída citada no PR — doc do hub não é
  prova. Não "ligue de passagem"
- `NPM_TOKEN` não configurado — `publish-runner.yml` avisa e pula
- Binário standalone: TRÊS alvos na matriz desde o ADR 0187, os três PROVADOS
  em ensaio, e DOIS chegando à Release. `v4.0.1` e `v5.0.0` anexam
  `brabo-runner-linux-x64` e `-linux-arm64` (medido com `gh release view`) — a
  corrida com o `release.yml` que derrubava o anexo na `v4.0.0` FOI corrigida,
  com espera de teto 600s em `build-runner-binaries.yml`. O `darwin-arm64`
  CONSTRÓI e passa o smoke em ensaio (`workflow_dispatch` com tag vazia, runs
  36779817686 e 36805241339): o que o derrubava era o oven-sh/bun#25822, MEDIDO —
  sob o Bun o `tty.ReadStream` com que o `node-pty` lê o PTY morre no primeiro
  `EAGAIN` do fd não-bloqueante, e o terminal do binário parava depois do
  primeiro pedaço nas três plataformas Unix (o Linux passava na prova por sorte
  de tempo). Sob o Bun o runner lê o PTY com leitor próprio
  (`apps/runner/src/leitor-de-pty.ts`, RN-688), e o `--self-test-pty` faz uma
  segunda volta depois de uma pausa, que reprova o leitor antigo também no
  Linux — falta só uma TAG para ele chegar à Release. O `win32-x64` SAIU por
  decisão do mantenedor (ADR 0187, AT-343), no molde do Mac Intel: quatro
  ensaios (36775746724, 36779817686, 36780804339, 36781729045) o levaram até
  carregar o `node-pty` (o caminho virtual `B:/~BUN/root/`, também sem os
  dois-pontos, reconhecido em `apps/runner/src/binario-compilado.ts` — fica,
  é o ponto de partida da volta), e a SONDA do auto-teste mediu que sob o Bun
  o pipe de saída do ConPTY termina depois do primeiro pedaço: até
  `cmd.exe /c echo` morre com 0xC000013A. O `darwin-x64` (Mac Intel) saiu antes
  (ADR 0174, AT-065): `macos-13` não tem runner e no `macos-15-intel` é esse
  bug do Bun que reprova, com a MESMA prova passando sob Node — e ali só com
  `chmod +x` no `spawn-helper`, que o `node-pty@1.1.0` traz em `0644`; desde a
  AT-114 o runner acrescenta esse bit sozinho ao carregar o `node-pty` sob Node
  (`apps/runner/src/spawn-helper.ts`, só darwin, erro nomeado se falta ou o
  `chmod` é recusado), provado por teste e NUNCA num macOS real. Mac Intel e
  Windows usam `npm install -g @brabo/runner`: o proxy recusa os dois com 400
  próprio (`SEM_BINARIO_POR_DECISAO`, nome e ADR por plataforma), o `install.sh`
  diz isso sem baixar no Mac Intel e, no Windows, na recusa que ele já fazia da
  instalação inteira (ADR 0150). Os TRÊS lugares que enumeram alvos (matriz,
  `PLATAFORMAS` da api, o `case` do `install.sh` — a lista do web saiu com o
  fluxo do navegador, ADR 0203) são amarrados por
  `scripts/ci/alvos-do-runner.spec.ts` — religar o Mac Intel ou o Windows é ADR
  novo, depois de o Bun corrigir, nunca só devolver as linhas da matriz
- i18n Onda 6b NÃO fechou: corpo de `docs/business-rules.md` 100% pt-BR; ao
  fechar, revisar Stack/Documentação deste arquivo para inglês como idioma
  primário. A fatia residual de `.tsx` fechou na AT-289 (varredura por AST de
  texto JSX e literais de prosa: o que sobra é marca, comando, caminho e nome
  de papel/enum, de propósito), e `apps/web/src/lib/i18n-paridade.test.ts`
  reprova chave que exista num idioma e falte no outro. Fora do `.tsx` ainda há
  texto só em pt-BR em `.ts` de `lib/` (o `classifyEvent` de `activity.ts`,
  por exemplo). Desde a AT-326, `i18n-vocabulario.test.ts` reprova número de
  RN/ADR em frase de tela, jargão em inglês no pt-BR ("handoff", "gate",
  "binding", "LLM", "dev agent", "lead" e "runner" ficam: são do glossário) e
  plural por "(s)" — em TODOS os namespaces e nos dois idiomas desde a
  AT-331, que acrescentou `_zero` obrigatório ao lado de todo `_one` no pt-BR
  (o CLDR do `pt` põe o 0 em `one`) e frase com `{{count}}` sem plural,
  salvo invariante declarada no próprio teste
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
