---
paths:
  - "install.sh"
  - "apps/runner/**"
  - "apps/web/src/**/*chave*"
  - "apps/web/src/**/*Runner*"
  - "apps/api/src/**/runner-device*"
  - "scripts/ci/assets-do-instalador*"
---

## Chaves de dispositivo, instalador e broker da instalação (lacunas movidas de estado-atual.md)

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
