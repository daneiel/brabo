> Parte do `CLAUDE.md` da raiz que NÃO é importada: é índice, lido sob demanda
> (fora do import para o contexto de sessão caber no teto de 150 mil caracteres).

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
| Trilho vertical de navegação do projeto (removido no ADR 0211) | ADR 0126, ADR 0211, RN-201 |
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
| A rotação da chave mestra, provada e observável (AT-033/AT-034) | ADR 0158, RN-562, RN-563 |
| O Infra Lead recusa `container_start` por modo antes de propor (AT-048) | RN-566 |
| O motivo da política no `proposed_action.created` (AT-066) | RN-567 |
| Imagem de terceiro por digest, e o lint irmão (AT-036, BRB-004) | ADR 0159 |
| O `checksums.txt` deixa de ser refém da matriz (AT-051) | RN-565 |
| A credencial que sumia no `docker exec` do runner (AT-053) | Lacuna que o ADR 0145 declarou POR ESCRITO e mediu: o container `running` que a RN-507 exige antes de qualquer operação de `RunnerGit` só existe porque o MESMO runner o subiu, e é esse mesmo sucesso que o faz rotear todo comando para dentro dele — por um `docker exec` sem campo de `env` (ADR 0130, sem `-e` livre). O `git fetch` autenticado rodava com o helper instalado e as variáveis VAZIAS, e a falha chegava como token inválido ou rede fora: o caminho COMUM, não uma borda. Entregou-se a metade do SILÊNCIO, nunca a do `env`: o par (`env` presente, container ativo) passa a ser RECUSADO antes de executar, com marca de PROTOCOLO partida entre duas linguagens, mensagem que diz o quê e por quê, e origem `politica` — não `codigo`, porque não há cláusula faltando, há decisão de produto pendente. Quem recusa é o RUNNER e só ele pode: `containerAtivo` nasce `null` a cada execução, então container `running` REGISTRADO no banco NÃO implica container ativo NAQUELE processo, e um runner reiniciado com o container de pé roteia pro HOST, onde a credencial chega — subir a checagem recusaria um caminho que funciona, e `RunnerReadiness` fica byte a byte como está. A saída nunca cita nome nem valor de variável, só a CONTAGEM (a invariante da RN-507 sobrevive intacta). Metade aberta declarada; a adjacência (a idempotência de `ensure!` marcava pronto o workspace cujo `fetch` falhou) fechou no AT-112 | RN-558 |
| O teto de auto-rebaixamento chega à REMOÇÃO (BRB-001) | O ADR 0127 pôs os dois tetos só no `add` e declarou esta porta aberta POR ESCRITO, com o custo estimado e um teste cujo nome documentava o buraco. Remover a linha de `project_members` não apaga um papel, TROCA o efetivo — `projectRole ?? workspaceRole` passa a resolver pelo segundo termo —, então `maintainer` pela linha de projeto com `viewer` no workspace se rebaixava sozinho, sem volta pela tela (repor pede o `maintainer` recém-abandonado); sem papel de workspace, a queda é para acesso NENHUM. É o teto 2 REUSADO: `remocaoEhAutoRebaixamento` delega a `ehAutoRebaixamento` com o papel de workspace no lugar do papel pedido, e existe como função própria por UM caso que a outra assinatura não sabe enunciar (papel-depois "nenhum" não é um `Role`). O teto 1 não ganha par, e a ausência é DECISÃO escrita ao lado da função: `owner` é o topo do `ROLE_ORDER`, remover só pode elevar, e é assim que se desfaz a restrição que o teto 1 impede de criar. Sem limiar como o teto 2, então o preço vem junto e é declarado — a auto-remoção de `owner` de projeto para `maintainer` de workspace é reversível e CAI TAMBÉM, único movimento benigno que passava e passa a recusar. Mensagem PRÓPRIA (quem clicou "remover" não pediu mudança de papel), tela intocada (o toast já mostra a frase da api) | RN-556, ADR 0156 |
| O teto de auto-movimento no upsert de WORKSPACE, e a auto-promoção (BRB-002) | Terceiro e último da linha. `AddWorkspaceMemberUseCase` era passa-adiante de doze linhas que NUNCA recebeu o ator, numa rota `@RequireRole('owner')` — a mesma classe de defeito um escopo ACIMA e mais grave, porque aqui não há nível acima para segurar a queda e `WorkspacesController` NÃO tem `@Delete` de membro (medido): um `owner` que se gravasse `viewer` perdia o workspace inteiro, e desfazer é a MESMA rota, que pede o `owner` recém-abandonado. O teto NÃO conta owners — a cláusula do ADR 0127 (*"se enuncia numa cláusula, não tem número para envelhecer"*) JÁ produz o invariante que a contagem existiria para garantir: nunca há zero donos, porque tirar o último exigiria que ele mesmo o fizesse. O teto 1 não tem par aqui, e foi CONSIDERADO e não espelhado: ele é regra sobre INVERSÃO DE HIERARQUIA, e o `@RequireRole('owner')` já a impede — somado à ausência de rota de remoção, pô-lo faria de `owner` um ESTADO ABSORVENTE, do qual ninguém sai por HTTP, que é a classe de estado que o ADR 0127 nasceu para eliminar, com o sinal trocado. Rebaixar OUTRO `owner` fica, reversível pela mesma rota. Junto, a auto-PROMOÇÃO — declarada nas Consequences do 0127 como capacidade que ficava, com teste fixando a permissão — vira BRECHA e fecha nas DUAS rotas de associação: das duas metades do movimento sobre o próprio papel, a de cima é a única que ESCALA privilégio, e o 0127 pôde dizer que os tetos dele não eram sobre escalação. Teste INVERTIDO, nome guardando a origem. A régua não foi copiada: virou UM classificador (`autoMovimentoDoProprioPapel`, devolve o SENTIDO porque a mensagem depende dele), e `ehAutoRebaixamento` sobreviveu como LEITURA dele por motivo de COMPORTAMENTO — alargá-la faria a REMOÇÃO recusar a auto-promoção, o movimento benigno que o ADR 0156 protegeu. Custo declarado: `maintainer` que precise de `owner` no projeto passa a depender de outra pessoa | ADR 0157, RN-557 |
| A chave de dispositivo ganha tela, e a tela diz o alcance de revogar (AT-012) | RN-561 |
| A presença de QA/SecOps no painel pelo agregado da sessão, não pela janela (AT-047) | RN-568 |
| O compose do instalador viaja com ele, assinado (AT-026) | ADR 0160, RN-570 |
| A reprojeção do grafo a partir do event log (AT-032, BRB-018) | RN-569 |
| A pasta `docs/` dos artefatos também se reconstrói do event log (AT-128) | RN-590 |
| As três provas de propriedade agendadas num k3d do Actions (AT-035, BRB-009) | runbook, Scheduled property proofs |
| O instalador acusava adulteração por falta de `sha256sum` no macOS (AT-091) | RN-526, CHANGELOG |
| O Arquiteto e o Infra Lead propunham PR em projeto sem repositório (AT-088) | RN-577 |
| O repositório nasce no aceite ao Arquiteto, e ativar sem ele é 409 (AT-092) | ADR 0165, RN-582 |
| O critério de roteamento do hub no binding de modelo, congelado no metering (AT-090) | ADR 0166, RN-583 |
| O registro de gates respondia 500 na imagem publicada (AT-086) | RN-070 |
| O `Environment=` da unit entregava OUTRO valor ao serviço (AT-095) | RN-518, CHANGELOG |
| A árvore do time dizia "começou a task" sobre dev bloqueado por container (AT-087) | RN-572 |
| A tela só oferece o modo que a instalação executa; o broker do instalador parou na imagem (AT-085) | ADR 0161, RN-573/574 |
| O broker vira a quinta imagem publicada, e o instalador pergunta se o liga (AT-097) | ADR 0162, RN-575 |
| O clique que dispara turno responde ao aceitar, e a recusa deixa de ser calada (AT-089) | ADR 0163, RN-578 |
| A tela de Sessão para de pollar a 3s com o canal vivo, e o corpo vazio ganha ETag (AT-093) | RN-579, CHANGELOG |
| A mensagem ao `infra` era lida pelo Criativo; o chat deixa de ter destinatário padrão (AT-098) | RN-584 |
| A sessão do provisionamento não vira a mais recente, e o 409 da ativação não aponta handoff de sessão encerrada (AT-131) | RN-582 |
| A web reconhece a sessão técnica pelo marcador da api, não pelo nome (AT-183) | RN-592 |
| O Infra Lead recusa a subida por estado, na ordem da `/containers` (AT-142) | RN-610 |
| O Infra Lead conversa pelo composer, e o turno dele passa pelo `TurnoAssincrono` (AT-141) | ADR 0175, RN-617 |
| O pepper do auth deixa de cair no `AUTH_JWT_SECRET`, e quem migra o define com o valor atual (AT-210, BREAKING) | RN-613 |
| O modo automático libera o escopo de caminho, e só ele (AT-226) | ADR 0167, RN-603 |
| O teto da chamada ao broker é por operação, e o do engine passa do da api (AT-233) | RN-604 |
| O pull de imagem vira passo nomeado do `start`, sob o teto de controle (AT-234) | RN-605 |
| O golden-set do QA volta a medir sob a RN-502 e roda agendado, semanal (AT-076/AT-149) | ADR 0168 |
| O compose de dev vira `brabo-dev`, e o dev recusa subir ao lado de uma instalação (AT-173) | ADR 0170 |
| A raiz do escopo no `proposed_action.created`, relativa e nunca absoluta (AT-147) | RN-609 |
| A chave de máquina ganha listagem e revogação por CONTA (AT-118) | RN-611 |
| A remoção de membro de workspace nasce, protegida pela mesma cláusula, e a titularidade se transfere (AT-115) | ADR 0173, RN-615, RN-616 |
| O release escaneia com Trivy o que publica, por digest, antes de assinar (AT-179) | ADR 0172 |
| `SessionPage.tsx` abaixo de 1 000 linhas, em dez PRs mecânicos, e a trava depois (AT-138, BRB-015) | ADR 0176 |
| O idioma das RESPOSTAS vira preferência da conta, com override por sessão, separado do `users.locale` (AT-162) | ADR 0177, RN-618 |
| O projeto ganha idioma, o de artefato compartilhado e turno sem autor (AT-243) | ADR 0177, RN-619 |
| A barra da sessão mostra o idioma das respostas de quem vê, com a origem, e troca só para ele (AT-165) | RN-620 |
| O idioma chega ao modelo por mensagem de sistema efêmera no fim de cada chamada (AT-164) | RN-622 |
| O artefato gravado num turno com autor sai no idioma do projeto (AT-245) | RN-623 |
| A tag da imagem de terceiro entra na referência, antes do digest; o Dependabot de imagem segue desligado (AT-139) | ADR 0178 |
| A api detecta o idioma do autor e pergunta antes de usá-lo (AT-163) | RN-624 |
| O laço roteia a ferramenta pelo Jev (AT-238) | ADR 0179, RN-625 |
| O chat decide o que os agentes propuseram noutra sessão, retoma o turno do log e propõe o merge (AT-256/268/265/266) | RN-626 |
| O container do projeto roda com o dono da pasta, medido pela api e revalidado pelo broker (AT-247) | ADR 0180, RN-627 |
| A Infra sobe o container com o menor recurso elegível, derivado do `module_map` (AT-261) | ADR 0199, RN-683 |
| O contrato entre módulos vira artefato do Arquiteto, e o dev o lê em vez do worktree alheio (AT-276) | ADR 0200, RN-684 |
| A oferta de fonte em todo artefato publicado — as cinco imagens e a Release do runner (AT-120, BRB-017) | runbook, The written offer of source |
| O plano de teste nasce depois da entrega do dev, e o `implementavel` se julga sem ele (AT-269) | ADR 0192, RN-674 |
| O git credenciado roda no host do runner, o código no container (AT-116, prova AT-111) | ADR 0193, RN-676 |
| A mensagem com turno em curso entra numa fila persistida no log e é lida no fim do turno (AT-267) | ADR 0191, RN-673 |
| O piloto automático: "Sempre permitir" não o desliga, e o escopo compara com a pasta real de execução (AT-259/255/258) | ADR 0189, RN-669, RN-670 |
| "Sempre permitir" grava verbo + subcomando, um padrão por segmento (AT-257, fecha a AT-170) | ADR 0189, RN-675 |
| Aprovar o plano do Dev Lead ativa a execução; a tarefa ganha o módulo que ele atribui (AT-263/AT-274) | ADR 0194, RN-677, RN-678 |
| A imagem dos workflows vem do compose, e o Dependabot de imagem é ligado (AT-246) | ADR 0197 |
| A curadoria recusa o alias `~` do OpenRouter, preço de vitrine (AT-271) | RN-679 |
| A Anamnese religada: não roda sem sujeito elegível, e a hipótese aceita vira fato do perfil (AT-277) | ADR 0196, RN-680 |
| O merge recusa PR já mergeada e proposta repetida; gate pendente vira aviso (AT-249) | RN-663 |
| O custo real que o provider devolve vira o número do metering (AT-270) | ADR 0188, RN-665 |
| O metering lê cache e reasoning tokens (AT-272) | ADR 0188, RN-666 |
| A Infra sobe o container sozinha no aceite do handoff (AT-260) | ADR 0190, RN-671 |
| O handoff ao Dev Lead sai da Infra, só com o container `running` (AT-262) | ADR 0190, RN-672 |
| O tema escuro vira preto neutro, e a dívida de contraste acaba (AT-283/AT-284) | ADR 0181, RN-640 |
| "Sempre permitir" aprova e grava o padrão na mesma transação; clique em ação já aprovada vira sucesso nomeado, e os tipos do teto (git tipado) deixam de oferecer o botão (AT-310/AT-320) | RN-642 |
| O chat mostra e deixa escolher o destinatário, e a oferta de handoff é casada pelo `handoffId` (AT-251) | RN-631 |
| O handoff manual ganha botão de aceite, e oferta pendente não esconde as seguintes (AT-253) | RN-631 |
| O handoff manual não declara prontidão, e a oferta a agente ativo noutra sessão não é acionável (AT-293/AT-294) | RN-633 |
| Depois de "Ativar execução", a tela vai à sessão de execução (AT-295) | RN-634 |
| Duas abas não batem no teto: leitura de projeto a 15s, e o canal com janela em toda tela que o ouve (AT-278) | RN-632 |
| O fio corta por mensagem, não parte a troca e recolhe o histórico na ordem (AT-319) | RN-644 |
| A barra da sessão se arruma pela própria largura: modelo e idioma num controle só, sem perder a origem (AT-317) | RN-620 |
| A aprovação chega à janela certa: cauda das ações, fila do projeto, pendências em sessão encerrada e aviso pelo canal (AT-296..299, AT-318) | RN-637, RN-638 |
| A aba PRs fala da lista de PRs, e Parar/Remover sem container dizem por quê (AT-323/AT-324) | RN-646 |
| O handoff deixa de repetir e de ficar obsoleto: uma oferta pendente por destino, `superseded` ao ativar (AT-291/292) | ADR 0182, RN-635/636 |
| A sessão encerrada pode ser reaberta, com o log intacto e o fechamento anterior como evento novo (AT-071) | ADR 0183, RN-649/650 |
| Reabrir sessão é `developer`, e o dono confirma sem prazo e a recusa com execução (AT-337) | ADR 0184, RN-650 |
| Code-splitting por rota, o streaming fora da página e os polls do bootstrap (AT-300/301/302) | RN-639, CHANGELOG |
| Layout móvel pós-login: a sidebar vira gaveta e o trilho do projeto vira barra horizontal (AT-316) | RN-643 |
| Configurações no teto: configuração vale um minuto, não polla, e o sumário deita (AT-321) | RN-645 |
| No telefone a Sessão ganha gaveta de contexto e barra que quebra linha; tabelas viram cartões (AT-328/AT-330) | RN-651 |
| A sidebar, o card do Dashboard e o painel de artefatos não se contradizem (AT-325) | RN-648 |
| Cada mensagem do fio aparece sob o ator do evento, nunca sob quem vê a tela (AT-329) | RN-652 |
| Os últimos textos fixos do web vão para os locales, e a paridade de chaves vira teste (AT-289) | CHANGELOG |
| A interface em pt-BR sem jargão em inglês nem número de RN/ADR, com o nome do agente e plural do i18next (AT-326) | CHANGELOG |
| Plural do i18next em todos os namespaces e `_zero` no pt-BR; o brilho do login vira acento; a lacuna do motivo da política dita uma vez na fila de Aprovações (AT-331/332/333) | CHANGELOG, RN-614 |
| O cartão de aprovação é um só nas quatro superfícies; controle segmentado, estado vazio, CTA e botão desabilitado seguem um padrão (AT-322/AT-327) | CHANGELOG, design/README.md |
| Os modelos vigentes de agentes e áreas numa leitura só: a carga de Configurações cai de 49 para 30 (AT-334) | RN-654 |
| O fio nomeia quem entra pelo papel de workspace, e cada cartão de Aprovações lê o próprio motivo da política (AT-335/AT-336) | RN-655, RN-656 |
| Projeto novo nasce com promoção de histórias automática (AT-313) | RN-659 |
| O handoff do PO ao Arquiteto é aceito pelo sistema com backlog coberto e repositório local (AT-314) | ADR 0186, RN-660 |
| O modo automático oferecido em lote para o time no início da execução (AT-315) | RN-661 |
| Um clique "Estou pronto — a necessidade está validada" fecha a prontidão, o gate `necessidade-validada` e o aceite do PO (AT-311/AT-312) | ADR 0185, RN-657/658 |
| A Visão geral e a aba Executores leem os modelos do time pelo lote, e os cartões das pendências de outras sessões no chat mostram o motivo da política (AT-339/AT-340) | RN-654, RN-656 |
| O formulário estruturado segue o idioma da resposta; a descrição da ferramenta deixa de fixar pt-BR (AT-282) | RN-667 |
| A PR do dev agent mira `dev`, o worktree nasce de `dev` e o gate julga o diff contra `dev`, os três juntos (AT-250) | RN-664 |
| O Infra Lead não anuncia subida de container que não fez: o lote todo roda antes do fim de turno da PR, e o fecho diz quando a subida não foi proposta (AT-264) | RN-668 |
| A duplicata semântica de história e regra vira AVISO por embedding com limiar, e o gasto vira linha do metering (AT-171) | ADR 0198, RN-681 |
| O Workflows não é delegado sem CI que rode, e não pergunta a ninguém (AT-368) | RN-710 |
| A consultiva sem agente pede um agente: o composer não envia sem destinatário e `POST .../chat` recusa com 422 `destinatario_ausente` (AT-254) | RN-682 |
| O fio da sessão legível: faixa sem Markdown cru, formulário respondido uma vez, "Para" que segue o handoff aceito, bloco de código longo recolhido (AT-375) | RN-712 |
| O cartão de PR não diz "abriu" antes de abrir, PR de ADR/infra não oferece "sempre permitir", e o plano diz a estimativa e só sobe agente com tarefa (AT-371/AT-381) | RN-709 |
| O agente de execução sabe onde está: pasta, imagem, rede, git tipado e o próprio módulo (AT-379/AT-378) | RN-706 |
| Os conversacionais dizem o fluxo real, e a restrição técnica do usuário vira decision_record (AT-369/AT-370) | RN-711 |
| O merge do repositório local é merge de verdade, e conflito é recusa nomeada (AT-377) | RN-704 |
| A recusa de merge aparece na aba PRs, a falha grava o tipo da ação e a PR local ganha autor (AT-383/AT-382) | RN-705 |
| A compactação de contexto não troca turnos por um marcador vazio, e a janela padrão vai a 128k (AT-366) | RN-702 |
| O PO não anuncia o handoff sem fazê-lo: o servidor oferece ao Arquiteto com regras cobertas e toda história com tarefa (AT-364) | RN-700 |
| O Dev Lead lê o module_map vigente e relê o backlog quando o plano é recusado (AT-362/AT-363) | RN-699 |
| Subagente sem modelo herda o do lead da área; o `appsec` deixa de falhar depois de "aplicar a todos" (AT-367) | RN-703 |
| O painel de contexto não afirma 0 regras fora da janela de eventos (AT-365) | RN-701 |
| O índice de ADR agrupado por tema, com o tema fora do ADR (AT-137) | ADR 0202 |
| A revogação mira a CHAVE, e não o par `{projeto, usuário}` (AT-013) | ADR 0201, RN-685 |
| O binário do runner lê o PTY sob o Bun, e o Windows sai da matriz de binários (AT-342/AT-343) | ADR 0187, RN-688 |
| O fluxo do runner pelo navegador é aposentado; o painel manda para o instalador (AT-014, BRB-031, BREAKING) | ADR 0203, RN-687 |
| As refs `caminho:N` (`símbolo`) das RNs relidas pelo símbolo, e a aferição promovida a `block` (AT-122) | documentation-workflow.md |
| O teto da RN-418 vale também para `git_push`/`pr_open` TIPADOS, e a ativação deixa de semeá-los (AT-347) | RN-689 |
| A análise da Anamnese sai do fio, e o nível de proficiência chega aos agentes (AT-355/AT-356) | RN-695, RN-696 |
| A dica de abertura fica no fio até a primeira mensagem, e os campos da sessão não convidam o autofill (AT-353) | RN-693 |
| Os conversacionais guardam os `toolCalls` da resposta, e o resultado da ferramenta deixa de chegar órfão ao provider (AT-350) | RN-690 |
| O catálogo de modelos ganha busca, o sync ao lado da credencial e o "ativar e aplicar ao time" (AT-357) | RN-694 |
| A prontidão do Criativo sem ferramentas; o texto do turno numa resposta só, e o teto visível no fio (AT-352/AT-354) | RN-697, RN-698 |
| A Anamnese só roda com interação de conteúdo técnico do sujeito (AT-439) | RN-756 |
| O instalador pergunta pelos modelos locais e mede a porta do Ollama; `brabo-dev` não é instalação, e a migração reinstala do zero (AT-351/AT-358) | RN-691, RN-692 |
| O `npm install` cabe no `terminal`: o engine espera o `propose_action` pelo teto do comando, que vai a 120s (AT-440) | RN-757 |
| O gate parado esperando clique é dito no painel, e a oferta em lote cobre os subagentes de QA (AT-449) | RN-766 |
| O gate de QA julga a tarefa, e RF de tarefa irmã é observação (AT-448) | RN-765 |
| O semgrep do SecOps morria sem `$HOME` gravável na imagem de produção, e o parecer aprovava (AT-380) | RN-707 |
| O projeto novo diz o próximo passo: cartão de primeiros passos na Visão geral, e Configurações abre pela credencial e pelos modelos (AT-372/AT-374) | RN-708 |
| O conflito de merge devolve a tarefa ao dev agent dono, que integra a dev e reenvia; os gates julgam de novo (AT-383) | RN-715 |
| O modo automático libera push e PR de todo agente; merge protegido e sudo seguem manuais (AT-385) | ADR 0204, RN-713 |
| A Infra herda a rede do Arquiteto na subida automática, `egress` incluído (AT-392) | ADR 0208, RN-723 |
| O PO completa a história existente e não oferece o handoff com regra descoberta (AT-388/AT-389) | RN-720 |
| A Anamnese fecha a janela sem perfil e tem teto diário; ciclo de gate parado estaciona (AT-391) | ADR 0207, RN-722 |
| O ciclo de gate estacionado volta por botão no fio (AT-397) | ADR 0207, RN-724 |
| O `docs:generate` reescreve contagens, próximo ADR e refs deslocadas (AT-399) | documentation-workflow.md |
| O engine sobe para OTP 29.1 porque o 27.3 aborta sob musl 1.2.6 em host com AMX (AT-398) | ADR 0209 |
| A bolha do agente mostra só o fecho do turno; as voltas anteriores ficam em "Passos do turno" (AT-395) | RN-698 |
| Node 26 nas imagens e nos workflows, sem o `ignore` do major (AT-360) | CHANGELOG |
| O TanStack AI não é adotado no front; revisitar na 1.0 (AT-400) | tanstack-ai.md |
| O texto do turno do agente em curso ganha o Shimmer, com motion (AT-401) | ADR 0210 |
| Uma navegação só: a sidebar absorve o trilho do projeto (AT-404) | ADR 0211, RN-196, RN-201, RN-643 |
| A mensagem do usuário aparece uma vez no fio, e "Ativar execução" vira secundário no handoff ao Dev Lead (AT-409/AT-410) | RN-728 |
| Escape unicode no texto da ferramenta, duplicata normalizada e recusa que diz o que chegou (AT-405/AT-408) | RN-725 |
| O crédito esgotado no provider pausa o dev com origem infra e diz como retomar (AT-407) | RN-726 |
| A PR de infra mira `dev`, a sidebar abre só o projeto atual, e o assistente não convida o autofill (AT-411/412/413/415) | RN-729 |
| A história draft se corrige e se arquiva, pelo PO e pelo usuário (AT-406) | ADR 0212, RN-727 |
| O fecho do turno ganha o número real do que foi gravado (AT-414) | RN-731 |
| O 402 do provider vira `insufficient_credit` na api, e o engine decide pelo código (AT-416) | RN-730 |
| O texto do turno decodifica escape unicode literal pela régua da RN-725 (AT-417) | RN-732 |
| A escolha de imagem avisa que rede `none` impede instalar dependências (AT-420) | RN-735 |
| O nome do projeto no assistente sem autofoco, para o gerenciador de senhas não cobrir a página (AT-418) | RN-736 |
| A falha do turno grava o texto do provider, e o crédito esgotado vira frase curta no idioma do turno (AT-421) | RN-733 |
| O caminho OpenAI-compatível manda `max_tokens` sempre (padrão 4096) (AT-419) | RN-734 |
| O container sobe com `--init` e para na hora; a `/containers` relê a linha mesmo com a aprovação recusada (AT-422) | RN-738 |
| A resposta cortada pelo limite de tokens é narrada, e o argumento de ferramenta cortado não é executado (AT-423) | RN-737 |
| `SEM_AUTOFILL` ganha `aria-autocomplete` e o ignore do Proton Pass; o rótulo visível fica (AT-425) | RN-740 |
| O diagnóstico da falha guarda o corpo do provider até 4 000 caracteres; a bolha corta em 300 (AT-424) | RN-739 |
| O raciocínio ganha orçamento próprio e não come a saída visível da tool call (AT-427) | RN-741 |
| O dev agent não morre calado: HTTP em processo próprio, crash vira `agent.error` e religamento (AT-428) | RN-742 |
| Bloquear a task preserva o trabalho do worktree em commit, e a próxima parte dele (AT-429) | RN-743 |
| O dev sabe que o shell é `sh` e começa vendo o próprio worktree (AT-444) | RN-744 |
| Na resposta cortada, só a chamada incompleta é recusada (AT-430) | RN-745 |
| O fecho do Arquiteto diz o que gravou, e as escritas recusadas são contadas (AT-431) | RN-746 |
| O plano do Dev Lead diz quantos dev agents sobem, não quantos pede (AT-437) | RN-747 |
| A espera por aprovação fecha a faixa do turno e leva o cartão à vista (AT-432) | RN-748 |
| A resposta cortada pelo teto oferece "Continuar de onde parou" num clique (AT-434) | RN-749 |
| O colapso por agente deixa o fecho de cada agente aberto no handoff (AT-435) | RN-750 |
| Os saltos de layout da Sessão e do catálogo: composer, aba ativa, barra de lote e rolagem do fio (AT-442) | RN-751 |
| A PR de infra mergeada sai de "PRs de infra em revisão" (AT-436) | RN-752 |
| O seletor de modelo mostra `thinking`; ligar o modo automático não aprova o cartão, e ele diz isso (AT-443) | RN-755 |
| A oferta em lote do modo automático espera saber quem já está ligado (AT-477) | RN-803 |
| O cartão do plano do Dev Lead oferece o modo automático em lote antes de aprovar (AT-476) | RN-804 |
| O plano de teste gravado é o que a ferramenta aceitou, e o QA roda um ciclo por tarefa (AT-478) | RN-805, RN-806 |
| O recorte do QA pede a forma da resposta quando a regra fala por item (AT-479) | RN-765 |
| O item do gitleaks diz a regra e o trecho mascarado; segredo de teste nasce em runtime (AT-470) | RN-796 |
| O QA confere os comandos do README tocado contra os scripts do package.json (AT-475) | RN-798 |
| A estimativa do plano do Dev Lead soma o dobro da primeira tarefa de cada módulo (AT-473) | RN-802 |
| A linha do tempo do time na Visão geral filtra por família, não pela roster da sessão mais recente (AT-471) | RN-800 |
| O nome da nova sessão não convida o gerenciador de senhas (AT-472) | RN-801 |
| A task sem diff contra a `dev` fecha como "já na dev", sem PR nem gates (AT-474) | RN-797 |
| O SecOps conta o diff da PR contra a `dev` da origem, e o `qa_verdict` grava lista (AT-464) | RN-787 |
| O dev agent órfão fecha por evento novo no boot, e a sessão deixa de ser reagendada para sempre (AT-465) | RN-778 |
| O Arquiteto recebe, ao declarar o contrato, as rotas das histórias que ele não declara (AT-468) | RN-792 |
| Decisões fora da janela, a linha do tempo pela sessão de execução e a aba da sidebar pelo tipo da sessão (AT-463) | RN-788, RN-789 |
| O raciocínio não é ligado por aceitar o parâmetro, e os dev agents de execução o desligam (AT-467) | RN-782, RN-783 |
| As leituras de estado do Arquiteto entram no piso do Jev (AT-460) | RN-784 |
| O worktree da tarefa (re)pegada parte da `dev` atual do remoto e a integra; conflito é bloqueio nomeado (AT-458) | RN-779 |
| A resposta só de raciocínio cortada pelo teto é retentada uma vez e, repetida, bloqueia nomeada (AT-459) | RN-780 |
| A mensagem de commit do dev não grava a pendência de commit/PR que é do sistema (AT-464) | RN-781 |
| O QA não reprova pelo que outra história do módulo ainda vai entregar (AT-461) | RN-785 |
| O QA lê o contrato do módulo, e divergência com a história é observação (AT-462) | RN-786 |
| A execução não fecha com tarefa bloqueada, PR esperando merge ou conflito; desbloquear acorda o dev do módulo (AT-457) | RN-776, RN-777 |
| A primeira tarefa de cada módulo tem o dobro do teto por tarefa (AT-433) | RN-774 |
| O Arquiteto lê o status atual das ADRs e o backlog com as tarefas antes de afirmar estado (AT-454) | RN-772, RN-773 |
| O recorte do Jev não vira incapacidade: piso de obrigação no menu e aviso efêmero de recorte (AT-445) | RN-758, RN-759 |
| A aba PRs diz a verdade do botão Merge com a tarefa bloqueada (AT-451) | RN-768 |
| Encerrar sessão com execução pergunta antes, e o estado sai traduzido (AT-452) | RN-769 |
| Miudezas de tela do TP-01: autor da PR de ADR, modelo da Infra, título da PR do dev, selo da execução, caminho e tabela (AT-455) | RN-770 |
| A próxima task do dev agent parte da última branch dele não mergeada (AT-447) | RN-760 |
| O repositório nasce com `.gitignore` base, o commit do dev exclui dependência instalada e o SecOps a acusa (AT-446) | RN-761 |
| O bloqueio por ciclo de correção esgotado grava a origem `politica` (AT-450) | RN-762 |
| Encerrar a sessão de execução para os dev agents e os gates; "Parar execução" na aba Executores (AT-456) | RN-763 |
| O recorte do Jev não tira dos agentes de gate a ferramenta de parecer (AT-509) | RN-840 |
| O QA de Automação sem raciocínio, e `report_done`/`report_blocked` no piso do Jev dos dev agents (AT-504/AT-499) | RN-838, RN-839 |
| O README de como subir o entregável vira critério do DoD que o PO escreve (AT-466) | RN-790 |
| Sem execução vigente, Executores e Visão geral dizem as tarefas pendentes e religam pelo mesmo `execution/activate` (AT-469) | RN-794 |
