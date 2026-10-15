# ADR 0118 — Configuração do runner pelo navegador: uma chave de dispositivo Ed25519 como segunda credencial do `runner-ticket`, um proxy do GitHub Releases para o binário e a File System Access API para uma pasta configurada com um clique

- **Status:** Aceito
- **Data:** 2026-08-27
- **Contexto:** fecha o atrito de configurar o `brabo-runner` na máquina do usuário — até aqui era preciso montar à mão três coisas espalhadas por telas diferentes: o id do projeto, o caminho da pasta e um Personal Access Token emitido numa terceira tela
- **Referências (sem editar):** [ADR 0103](0103-runner-local-execucao-na-maquina-do-usuario.md) (o próprio runner e sua fronteira de segurança), [ADR 0104](0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md) (`execution_mode: runner`, o item de backlog do PAT que a chave de dispositivo deste ADR complementa), [ADR 0105](0105-personal-access-token-do-runner-escopado-por-construcao.md) (o PAT ao qual esta decisão se SOMA, nunca substitui), [ADR 0106](0106-distribuicao-do-runner-via-tsup-e-npm-publish.md) e [ADR 0112](0112-binario-standalone-do-runner-via-bun-build-compile.md) (os binários standalone que o proxy deste ADR serve), [ADR 0107](0107-navegacao-de-pasta-local-via-o-runner.md) (navegação de pasta POR MEIO de um runner já conectado — este ADR trata de conectar o runner em primeiro lugar)

## Contexto

`execution_mode: runner` (ADR 0104) permite que o código de um projeto more
numa pasta da própria máquina do usuário, sem bind-mount e sem container —
mas chegar a esse estado exigia que uma pessoa, à mão: achasse o id do
projeto, gerasse um Personal Access Token em Configurações do Projeto →
Tokens de Acesso (ADR 0105), copiasse um comando
`brabo-runner --project <id> --dir <path> --token <token>` que alguém tivesse
digitado corretamente, baixasse ela mesma o binário certo para o seu
SO/arquitetura e o rodasse da pasta certa. Três informações, três telas, e um
segredo que o usuário tinha de digitar ou colar num terminal.

`NewProjectWizard.tsx` e `RunnerOnboardingPanel.tsx` tinham, cada um,
desenvolvido com o tempo o PRÓPRIO texto de comando para isso, e os dois
divergiram — a cópia do assistente nunca incluiu `--token`, e a do painel
usava a sintaxe `pnpm --filter runner start` em vez do binário. Nenhuma estava
errada quando foi escrita; nada obrigava as duas superfícies a concordar, e
elas deixaram de concordar em silêncio.

O dono do produto também perguntou, explicitamente, se o runner poderia
DESCOBRIR sozinho um container Docker/Kubernetes local e se conectar por SSH,
em vez de exigir que um humano passasse por qualquer configuração. Esse
caminho foi considerado e recusado nesta mesma sessão — ver "Alternativas
consideradas e recusadas" abaixo.

## Decisão

### 1. Uma chave de dispositivo Ed25519, gerada no navegador, é uma segunda credencial do `runner-ticket` — soma-se ao PAT, nunca o substitui

Tabela nova `runner_device_keys` (`apps/api/src/db/schema.ts:2058-2081`,
migration `0054_demonic_shiver_man.sql`): `id`, `userId` (FK `users`,
cascade), `projectId` (FK `projects`, cascade), `name`, `publicKeyJwk`,
`createdAt`, `revokedAt`, `revokedReason`, `lastUsedAt` — a metade PÚBLICA de
um par de chaves Ed25519 que o navegador gera com `crypto.subtle.generateKey`
(`apps/web/src/lib/runner-bootstrap.ts:123-131`). A metade privada nunca sai
do navegador pela rede; só a JWK pública exportada é enviada por POST a
`RegisterRunnerDeviceKeyUseCase`
(`apps/api/src/application/use-cases/auth/register-runner-device-key.use-case.ts`)
via `POST /projects/:projectId/runner-device-keys`
(`apps/api/src/interfaces/http/runner/runner-device-keys.controller.ts`).
Essa rota é autenticada pelo JWT de sessão NORMAL, `@RequireRole('developer')`
— quem chama aqui é de fato o navegador logado registrando o dispositivo que
ele está prestes a configurar, a imagem espelhada de
`PersonalAccessTokensController` emitindo um PAT.
`RevokeRunnerDeviceKeyUseCase` apaga (marca como revogada) do mesmo jeito que
`RevokePersonalAccessTokenUseCase` — idempotente, `null` para "não encontrada
ou não é sua", a mesma disciplina de não revelar da RN-426.

`PatAuthGuard` — o mesmo guard que `POST .../runner-ticket` já usava para o
PAT (ADR 0105, RN-439) — ganhou um segundo ramo
(`apps/api/src/interfaces/http/auth/pat-auth.guard.ts:104-116`): um bearer
token que começa com `brb_` segue o caminho do PAT, inalterado; um bearer
token com forma de JWT compacto (três segmentos separados por ponto) segue um
caminho novo, `autenticarChaveDeDispositivo` (linhas 144-216). Ele lê o `kid`
não verificado do cabeçalho do JWT (`decodeProtectedHeader` — sem checar
assinatura ainda), procura uma linha ATIVA de `runner_device_keys` por esse
`kid`, verifica a assinatura com `importJWK`/`jwtVerify` do `jose` contra a
chave pública ARMAZENADA e impõe um TTL curto e obrigatório: `exp - iat` deve
ser no máximo 60 segundos (`TTL_MAXIMO_DEVICE_KEY_SEGUNDOS`, linha 23) —
conferido contra a vida que o PRÓPRIO token declara, não contra "agora", de
modo que um token capturado não possa ser reapresentado com proveito, seja
quando for. O `userId` usado na autorização vem do registro ARMAZENADO, nunca
de uma claim do JWT — o token só precisa provar a posse da chave privada, não
afirmar de quem ela é. O `projectId` é conferido duas vezes: a claim do
próprio JWT contra o parâmetro da rota e, separadamente, o `projectId` da
chave registrada contra a rota (espelhando as duas checagens idênticas do
caminho do PAT) — uma claim forjada numa chave registrada para outro projeto
é recusada com 403, seguindo a distinção de categoria do caminho do PAT entre
"não autenticado" e "autenticado para o projeto errado".

O próprio runner assina esse JWT, em `apps/runner/src/auth.ts`
(`assinarTicketComChaveDeDispositivo`, linhas 143-154): EdDSA, expiração de
30 segundos, `kid` igual ao id de registro da chave de dispositivo, usando uma
JWK privada que já está EM MEMÓRIA quando a função roda — ela nunca toca
`node:fs`, preservando a garantia existente de "nenhum I/O de arquivo em
`auth.ts`" (a suíte "nenhum I/O de arquivo" de `auth.spec.ts`). Ler a chave
do disco é um módulo NOVO e SEPARADO, `apps/runner/src/device-key.ts`, de
propósito (ver Decisão 4).

**Isto explicitamente NÃO é a "autenticação dupla com JWT de sessão" que a
RN-439 já proíbe nesta rota.** O docblock do próprio guard
(`pat-auth.guard.ts:41-53`) afirma a distinção: o JWT de sessão do login
continua nunca sendo aceito aqui — aceitá-lo deixaria o `RolesGuard`
autorizar um navegador logado para tudo o que o papel dele permite em todo o
resto da api, que é exatamente a fuga de escopo que a RN-439/ADR 0105
construiu `@RequirePatAuth()` para impedir. O JWT da chave de dispositivo é
outro bicho: um token que o runner assina SOZINHO, com uma chave cuja metade
privada a api nunca viu, afirmando só "sou um dispositivo registrado para
este usuário, neste projeto" — tão escopado quanto o PAT ao lado do qual ele
está, nunca uma credencial de sessão disfarçada.

### 2. A api faz proxy do binário já publicado no GitHub Releases — ela não constrói nem guarda uma segunda cópia de nada

`RunnerReleasesController`
(`apps/api/src/interfaces/http/runner/runner-releases.controller.ts`)
acrescenta `GET /runner-releases/binary?platform=<target>`, `@Public()` — sem
autenticação, por desenho: o binário em si não carrega segredo, e exigir
login para baixar a coisa que você usaria para configurar a sua PRIMEIRA
credencial seria andar ao contrário. `platform` é conferido contra uma lista
fechada de permitidos (`linux-x64`, `linux-arm64`, `darwin-x64`,
`darwin-arm64`, `win32-x64` — os mesmos cinco alvos que o ADR 0112 já
constrói) antes de tocar qualquer coisa — nunca interpolado cru na URL do
GitHub nem no nome do asset, fechando o vetor de SSRF/injeção que um
parâmetro livre abriria. O controller resolve a lista de assets da release
`latest` pela API REST do GitHub, guarda essa resolução em cache (só URLs,
nunca bytes) num `Map` em memória por cinco minutos (`CACHE_TTL_MS`) para
ficar bem abaixo do limite de 60 requisições/hora sem autenticação do GitHub
mesmo sob uma rajada de downloads simultâneos, e então repassa os bytes do
asset direto (`Readable.fromWeb(...).pipe(res)`). Nenhuma dependência nova —
o `fetch` é do próprio Node. A alternativa de o navegador falar direto com o
GitHub foi recusada: o nome exato do asset é detalhe de implementação que a
api já calcula (`nomeDoAsset`), e uma chamada direta navegador→GitHub
abriria mão do cache que este proxy ganha de graça.

### 3. A File System Access API escreve a pasta configurada diretamente; um download de dois arquivos é o plano B em todo o resto

`apps/web/src/lib/runner-bootstrap.ts` é o módulo novo que os dois pontos de
entrada abaixo chamam. `detectarPlataforma` escolhe o binário certo para o
SO/arquitetura do usuário — no Chromium, via
`navigator.userAgentData.getHighEntropyValues` (a string clássica
`userAgent` é deliberadamente "reduzida" e não é confiável para arquitetura
no Chrome moderno); fora do Chromium, uma regex de melhor esforço sobre
`userAgent`/`platform`, com `null` (nunca um palpite apresentado como fato)
quando a confiança é baixa demais, e aí a interface deixa o usuário escolher
à mão.

`configurarPastaAutomaticamente` (linhas 199-229) é o caminho de um clique,
disponível só onde `showDirectoryPicker` existe (Chrome/Edge/Opera): ele gera
o par Ed25519, registra a chave pública (`registerRunnerDeviceKey`), baixa o
binário pela rota da Decisão 2, abre o seletor de pasta nativo do navegador e
escreve TRÊS arquivos direto na pasta escolhida — o executável,
`brabo-runner.config.json` (`{ projectId, apiUrl }`) e
`brabo-runner-device-key.jwk.json` (a JWK PRIVADA, escrita em disco só aqui,
nunca enviada pela rede). `baixarKitManual` (linhas 250-268) é o plano B
usado em todo lugar onde a File System Access API não existe (Firefox,
Safari) ou o usuário prefere não deixar um site tocar o seu sistema de
arquivos: os mesmos três artefatos, mas como dois downloads comuns do
navegador (o binário e um `brabo-runner-kit.json` reunindo a configuração e a
chave privada) que o usuário move para uma pasta à mão — sem biblioteca de
zip, só dois arquivos.

`RunnerOnboardingPanel.tsx` passa a ser o ÚNICO componente que desenha esse
fluxo, consumido pelas três superfícies que antes divergiam: o passo
`workspace` do `NewProjectWizard` (modo `runner`), o estado "nenhum runner
conectado" do `FolderBrowserModal` e o estado equivalente do
`TerminalPanel`. A correção da divergência real achada nesta investigação — a
cópia própria e não rastreada do comando manual no assistente, sem
`--token`, e a do painel usando `pnpm --filter runner start` em vez do
binário — entrou nesta mesma mudança: agora há uma única string de comando
manual, sempre com `--token`, recolhida por padrão atrás de um `<details>`
"prefere rodar à mão".

**Limitação aceita, não defeito:** a File System Access API não preserva o
bit de execução do Unix. Depois da escrita automática, um usuário de
Linux/macOS ainda tem de rodar `chmod +x ./brabo-runner` ele mesmo — mostrado
já preenchido, pronto para copiar, no estado de sucesso (`instrucaoFinal`,
`runner-bootstrap.ts:224-226`). É uma limitação da plataforma do navegador,
sem contorno disponível a uma página web; não é algo que uma versão futura
desta funcionalidade deva remover.

### 4. `--project`/`--dir`/`--token` ficam opcionais no CLI quando há uma configuração local

`apps/runner/src/device-key.ts` é um módulo novo, deliberadamente separado
de `auth.ts` (o próprio docblock explica por quê: `auth.ts` tem um teste
dedicado, "nenhum I/O de arquivo", que impede reintroduzir o cache global de
credencial `~/.brabo/...` que a Onda 2 do ADR 0104 removeu de propósito —
este módulo novo lê um arquivo LOCAL e EXPLÍCITO que o usuário acabou de pôr
ali usando o fluxo do navegador, nunca um caminho global).
`lerConfigLocal`/`lerChaveDeDispositivo` leem `brabo-runner.config.json` e
`brabo-runner-device-key.jwk.json` do diretório de trabalho ATUAL, devolvendo
`null` — nunca lançando — para arquivo ausente, JSON inválido ou campo
obrigatório faltando, porque a ausência desses arquivos é o caso NORMAL para
quem ainda usa flags explícitas.

`lerArgumentos` em `apps/runner/src/index.ts` (linhas 95-206) agora resolve
cada uma das três entradas com "flag explícita vence arquivo local" como a
única regra, repetida três vezes: `--project` vence `configLocal.projectId`;
`--dir` vence `.` (que resolve para o diretório de trabalho atual, o mesmo
default forçado de hoje) quando a configuração local existe;
`--token`/`BRABO_ACCOUNT_TOKEN` vence a chave de dispositivo local. Sem
token NEM chave de dispositivo local, o CLI continua saindo com as instruções
de uso (`uso()`) exatamente como antes — nada aqui torna a autenticação
opcional, só qual das duas formas é usada. O efeito líquido: `./brabo-runner`
sem flag nenhuma funciona quando a pasta atual é uma que o navegador
configurou pela Decisão 3, e toda invocação existente com flags explícitas
fica completamente inalterada.

## Consequências

**Chaves de dispositivo AINDA NÃO têm a visão de `maintainer` sobre outros
usuários que os PATs têm.** O próprio docblock de
`RunnerDeviceKeysController` declara isso: ao contrário de
`PersonalAccessTokensController` (RN-427 — um `maintainer` pode listar/revogar
o PAT de QUALQUER usuário no projeto, para resposta a incidente), uma chave
de dispositivo hoje só pode ser listada/revogada pelo usuário que a
registrou. É um corte declarado desta rodada, não um esquecimento — estender
a mesma capacidade de resposta a incidente às chaves de dispositivo é
trabalho futuro direto, se for pedido, seguindo exatamente o padrão que a
RN-427 já estabeleceu para os PATs.

**Um JWT de chave de dispositivo nunca carrega a identidade do usuário — só o
registro armazenado na api carrega.** Isto é intencional (Decisão 1), mas
significa que uma chave de dispositivo nunca pode ser usada para se passar
por um usuário declarado; ela só age como o usuário a quem o registro
ORIGINAL pertence. Revogar o registro é a única forma de invalidá-la — não
existe lista negra separada de "este JWT específico é ruim", nem precisa
existir, dado o TTL de assinatura de 30 segundos mais o máximo de 60
segundos de `exp - iat` imposto de forma independente pelo guard.

**O proxy do binário confia no GitHub Releases como único canal de
distribuição.** Se a release "latest" não tiver asset para a plataforma
pedida (uma release parcial, no meio da publicação), a rota devolve 502 em
vez de chutar uma tag mais antiga — coerente com a lacuna declarada pelo
próprio ADR 0112 de que só `linux-x64` foi validado por execução real até
aqui.

**O cache de resolução de assets do GitHub é por instância, em memória, sem
gancho de invalidação.** Uma release nova publicada no meio da janela fica
invisível para uma instância da api em execução por até cinco minutos. Dada
a pouca frequência com que o runner publica binários novos (preso à mesma
cadência de release de todo o resto), isso foi julgado uma troca aceitável
para ficar com folga abaixo do limite sem autenticação do GitHub — uma
invalidação de verdade por webhook não é construída aqui.

## Alternativas consideradas e recusadas

- **O runner descobre sozinho um container Docker/Kubernetes local e se
  conecta a ele por SSH, sem passo nenhum de escolha de pasta.**
  Considerada e explicitamente RECUSADA pelo dono do produto nesta mesma
  sessão — não um beco técnico, um corte de escopo deliberado. `execution_mode:
  runner` existe justamente porque a Fase 25b (nenhum serviço do produto
  chama o Docker — ver "Cortes e pausas vigentes" no CLAUDE.md) continua
  cortada: ensinar o runner a sondar e se conectar a containers locais
  reabriria exatamente essa fronteira por uma porta lateral, e um caminho de
  conexão por SSH é um modelo de segurança materialmente diferente da
  fronteira autenticação-mais-pipeline-de-aprovação que o ADR 0103 já
  estabeleceu. Fica como candidata a ADR próprio, se e quando a própria Fase
  25b for revista — não algo em que esta funcionalidade entre de ré, calada.
- **Reusar o JWT de sessão como segunda credencial do `runner-ticket` em vez
  de criar um mecanismo novo de chave de dispositivo.** Recusada nos termos da
  própria RN-439: o guard dessa rota existe especificamente para que o JWT de
  uma sessão de navegador NUNCA baste ali, porque o
  `RolesGuard`/`@RequireRole` autorizaria então essa sessão para toda a
  amplitude do papel do usuário em todo o resto da api — o oposto da
  credencial estreita, revogável e escopada ao dispositivo de que esta
  funcionalidade precisa.
- **Compactar o plano B de download manual num único arquivo zip.**
  Recusada: nenhuma dependência nova justificava a comodidade — dois arquivos
  simples (o binário e um pequeno kit JSON) não custam nada a mais para
  produzir nem para o usuário desempacotar.
- **A api construir e hospedar a própria cópia do binário do runner** em vez
  de fazer proxy do GitHub Releases. Recusada: os ADRs 0106/0112 já publicam
  exatamente esses cinco binários pela esteira de release; manter um segundo
  caminho de construir-e-guardar o mesmo artefato seria pura duplicação sem
  benefício — um proxy fino com cache curto basta.
