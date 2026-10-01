# 0203 — O fluxo do runner pelo navegador é aposentado, e o caminho é o instalador

## Status

**Accepted.** 2026-10-01 (AT-014, `BRB-031`, rodada 36; decisão do dono em
01/10: *"aposentar o fluxo do navegador do ADR 0118 — gerar chave, baixar
binário e gravar config pelo navegador; o caminho é o `install.sh`"*).
Revisa, sem editá-lo, o
[ADR 0118](0118-configuracao-automatica-do-runner-pelo-navegador.md) (a
configuração automática do runner pelo navegador, RN-464..466) e fecha o
`BRB-031`. Preserva o [ADR 0154](0154-chave-de-dispositivo-de-maquina.md) (as
duas espécies de chave), o [ADR 0155](0155-a-primeira-conta-nasce-no-terminal.md)
(a chave de máquina nasce no terminal e o instalador a registra, RN-547/551/552)
e o [ADR 0150](0150-instalador-de-uma-linha.md) (o instalador de uma linha e a
verificação da própria origem).

## Context

O ADR 0118 fez o navegador **gerar o par Ed25519** (Web Crypto), **registrar a
pública** (`POST /projects/:projectId/runner-device-keys`), **baixar o binário**
(`GET /runner-releases/binary`) e **gravar três arquivos** numa pasta pela File
System Access API — ou, fora do Chromium, disparar dois downloads. Ele aceitou
uma limitação por escrito: *"o navegador não preserva o bit de execução;
`chmod +x` em Linux/macOS continua manual"*. Era o último passo manual de
qualquer caminho de instalação, e é o `BRB-031`.

A FASE 29 criou um segundo caminho sem esse passo: o `install.sh` baixa o
binário, o confere contra o `checksums.txt` **assinado** e o instala com
`install -m 0755` (RN-531). A FASE 30 completou o pareamento do lado da
máquina: `brabo-runner device-key create` gera o par NA MÁQUINA (RN-551), o
instalador registra a pública pela rota interna de MÁQUINA com o service token
(RN-552) e encadeia as duas coisas no fim da instalação (RN-547). Desde então o
fluxo do navegador era o **segundo** caminho, recolhido num `<details>` do
`RunnerOnboardingPanel` (RN-548), e aposentá-lo ficou declarado como decisão do
mantenedor, não consequência daquela entrega.

Medido em `dev` (`ec0fbea52d`) antes de mudar — quem usa o que o fluxo usa:

- `apps/web/src/lib/runner-bootstrap.ts` (gerar par, exportar JWK, baixar
  binário, gravar pasta, kit manual) tinha **um** consumidor de produção, o
  `RunnerOnboardingPanel`. Fora dele, só o próprio teste e
  `scripts/ci/alvos-do-runner.spec.ts`, que lia a lista de plataformas do
  navegador como o quarto lugar que enumera alvos.
- `registerRunnerDeviceKey` (`apps/web/src/lib/api-client.ts`) só era chamado
  por `runner-bootstrap.ts`.
- `POST /projects/:projectId/runner-device-keys` só era chamado por
  `runner-bootstrap.ts` e por `e2e/testes/chave-de-dispositivo.spec.ts`, que
  existia para provar EXATAMENTE a chave gerada num Chromium. Nenhum script,
  nenhum runner, nenhum workflow, nenhum `install.sh` a chama — o instalador
  usa `POST /internal/machine-device-keys`.
- `GET` e `DELETE` da mesma rota têm OUTROS consumidores: a seção de chaves das
  Configurações (RN-561), o reconhecimento do painel (RN-548) e a revogação.
- `PatAuthGuard` aceita chave de PROJETO por `kid`, e há chaves de projeto
  registradas em instalações reais pelo fluxo do navegador.
- `GET /runner-releases/binary` (o proxy do download) só tinha o navegador como
  consumidor de produção.

## Decision

1. **O `RunnerOnboardingPanel` manda para o `install.sh`.** O primeiro plano
   do painel passa a ser o comando do instalador
   (`curl -fsSLO …/install.sh && bash install.sh`, a MESMA frase do runbook e
   do próprio `install.sh`, RN-526), copiável, com o que ele faz dito em texto
   — baixa o binário, confere contra o manifesto assinado, instala já
   executável e pareia a máquina — e a `EsperaDoRunner` (RN-474) embaixo. O
   comando é uma cópia em TS da frase do instalador, e
   `scripts/dev/install-invocacao.spec.ts` reprova a cópia que divergir.
2. **O que FICA no painel:** o reconhecimento de chave já pareada (RN-548 e o
   da chave de PROJETO, AT-107), com as mesmas ressalvas — e, reconhecida uma
   chave que serve o projeto, o bloco do instalador SAI. O comando manual com
   PAT (`--token`) fica no `<details>`, renomeado para o caso que ele resolve:
   *"Outra máquina, ou rodar manualmente"*.
3. **O que SOME do web:** `runner-bootstrap.ts` inteiro e o teste dele
   (geração de chave pelo Web Crypto, download do binário pelo navegador,
   gravação via File System Access e o kit de dois downloads),
   `registerRunnerDeviceKey` e o tipo `RunnerDeviceKeySummary`, as chaves de
   i18n dos botões e estados do fluxo, e o seletor de plataforma.
4. **O que SOME da api:** o `POST /projects/:projectId/runner-device-keys`,
   com `RegisterRunnerDeviceKeyUseCase` e os dois DTOs só dele. Ele ficou sem
   chamador. A rota interna de MÁQUINA (`POST /internal/machine-device-keys`)
   FICA, e a régua de forma da JWK (`exigirJwkPublicaEd25519`, no domínio)
   fica com ela.
5. **Chave de projeto JÁ registrada continua valendo, e é revogável.** Nada no
   banco muda: `runner_device_keys.project_id` preenchido continua sendo uma
   espécie válida, `PatAuthGuard` continua aceitando o JWT assinado por ela, o
   `GET` continua listando e o `DELETE` continua revogando. **Um runner
   configurado pelo navegador antes deste ADR não quebra**: a pasta com
   `brabo-runner.config.json` e `brabo-runner-device-key.jwk.json` continua
   sendo lida pelo CLI (RN-466 inteira), e a unit de PROJETO que ele tenha
   instalado continua de pé. O que deixa de existir é criar uma chave de
   projeto NOVA.
6. **O e2e da chave gerada no navegador sai junto.** O que ele provava — que o
   `kid` gravado pelo NAVEGADOR é aceito pelo servidor — não tem mais produtor.
   A cadeia `kid` → JWT → `PatAuthGuard` com chave real segue coberta em
   `apps/api/test/interfaces/pat-auth.guard.spec.ts` e o par gerado na máquina
   em `apps/runner/src/criar-chave-de-dispositivo.spec.ts`.
7. **A lista de alvos do runner passa a morar em TRÊS lugares**, não quatro: a
   do navegador saiu com o módulo, e `scripts/ci/alvos-do-runner.spec.ts`
   trava que ela não volte calada.

A branch é `breaking/`: remover uma rota pública documentada na OpenAPI é
mudança de contrato para quem a chama, e a política de versão
(`scripts/ci/version.ts`) diz que a FUNÇÃO decide — um patch diria "atualize
sem pensar".

## Consequences

**Boas.**

- O caminho de instalação não tem mais passo manual de `chmod` em lugar
  nenhum do produto: o único que tinha saiu. `BRB-031` fecha.
- A chave de dispositivo NOVA nasce num lugar só — o terminal da máquina — e é
  registrada por um registrador só — o instalador. A api perde uma rota de
  escrita autenticada por JWT de sessão.
- O web perde ~530 linhas de código de cripto, download e escrita em disco que
  jsdom não conseguia exercitar sem dublê.

**Ruins, declaradas.**

- **Instalação com time perde o caminho sem PAT.** A rota que cria chave de
  MÁQUINA só serve instalação de UMA pessoa (409 com duas ou mais, RN-552), e
  o `install.sh` instala o Brabo inteiro numa máquina — não serve para parear
  uma SEGUNDA máquina com uma instalação que já existe. Para essas pessoas o
  caminho passa a ser o comando manual com PAT (`--token`), que o painel
  continua oferecendo e nomeia como o da outra máquina. O fluxo do navegador
  era a única forma de parear sem PAT nesse caso, e a decisão do dono o
  aposenta mesmo assim.
- **`GET /runner-releases/binary` fica sem consumidor de produção.** O proxy
  NÃO foi removido aqui: a decisão nomeou a rota de registro de chave, e o
  proxy carrega a verificação de integridade da RN-525 e a metade de
  procedência aberta do `BRB-005`. Remover ou manter é decisão do dono, à
  parte.
- **Quem tinha a aba do fluxo aberta** no momento do deploy recebe 404 no
  `POST` ao clicar — o bundle velho ainda chama a rota. Recarregar a página
  resolve.
- As RNs 464..466 e 473/475 descrevem o fluxo como era; ganham nota de revisão,
  nunca apagamento.
