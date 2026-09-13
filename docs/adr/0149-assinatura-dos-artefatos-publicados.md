# 0149 — Assinatura dos artefatos publicados

## Status

**Proposed.** Primeiro ADR da [FASE 29](../explanation/fase-29-instalacao-de-uma-linha.md).
Nada aqui muda o que as imagens contêm nem o que o runner faz — muda o que se
publica **ao lado** delas e o que passa a ser verificável.

## Context

O produto **não assina nada do que publica**. A busca por `cosign`, `sigstore`,
`slsa` e `attestation` em `.github/`, `scripts/`, `docker/` e `Makefile`
devolve uma única ocorrência real, e ela não cobre nem imagem nem binário:
`npm publish --provenance` do pacote npm do runner
(`.github/workflows/publish-runner.yml:188`, com o `id-token: write` que ele
exige em `:27`).

O que fica sem procedência:

- **As quatro imagens do GHCR.** `release.yml` constrói e publica com
  `docker/bake-action` (`.github/workflows/release.yml:286-303`), registra os
  digests em `.release/images.json` (`:308-319`, via
  `scripts/ci/images-manifest.ts`) e anexa esse manifesto à Release
  (`:321-332`). O workflow declara três permissões — `contents: write`,
  `pull-requests: write`, `packages: write` (`:40-43`) — e **não tem
  `id-token: write`**, que é o que uma assinatura keyless exige.
- **Os cinco binários do runner.** `build-runner-binaries.yml` monta a matriz
  (`:58-74`), constrói e sobe cada arquivo com `gh release upload`
  (`:227`) — **e nada mais**. Não há `checksums.txt`, `.sig`, `.asc` nem
  `sha256` de artefato nosso em workflow nenhum. Os `sha256sum -c` que existem
  (`ci.yml:201,453,458,462`, `docker/engine/Dockerfile.prod:95,100,104`)
  verificam binário **de terceiro**, e são justamente o padrão que o repositório
  já sabe aplicar e nunca aplicou a si mesmo.
- **O caminho de download que o produto oferece.**
  `GET /runner-releases/binary` é `@Public()`
  (`apps/api/src/interfaces/http/runner/runner-releases.controller.ts:73-74`),
  valida a **entrada** (`platform` contra uma allowlist fechada, `:97`) e
  transmite os bytes do GitHub direto para o cliente (`:111-133`). Não há
  checksum, assinatura ou qualquer verificação de integridade. O
  [ADR 0146](0146-base-consentida-no-bootstrap.md):208-212 já nomeia isso como
  BRB-005 — *"não um padrão a imitar"*.

Isso é o **BRB-005**, e é o que barrou o instalador de uma linha na FASE 28:
*"um instalador de uma linha sem assinatura é pior que o download atual"*
(`../explanation/fase-28-pasta-do-usuario.md:171-173`). A ordem da FASE 29 sai
daí — sem este ADR, o [ADR 0150](0150-instalador-de-uma-linha.md) seria
exatamente a coisa que a fase anterior recusou.

## Decision

### 1. `cosign` keyless, com a identidade do workflow

`release.yml` ganha `id-token: write` e assina as **quatro imagens por
digest** — o digest que ele já calculou e já gravou em `.release/images.json`,
nunca por tag, que é ponteiro móvel. A identidade que assina é o próprio
workflow (OIDC do GitHub Actions), e é ela que a verificação cobra:
`--certificate-identity` do workflow e `--certificate-oidc-issuer` do GitHub.

Keyless e não par de chaves gerido à mão pelo motivo que o repositório já
aplica à cadeia de suprimentos: uma chave privada exigiria custódia, rotação e
**mais um segredo de CI** — e o histórico recente do repositório inclui um PAT
que expirou e reprovou duas runs do `tag-release` sem ninguém perceber até a
issue automática existir ([ADR 0139](0139-o-alarme-de-esteira-ganha-destinatario.md)).
Uma credencial efêmera derivada da execução não expira no armário.

### 2. Um `checksums.txt` assinado, não cinco assinaturas

`build-runner-binaries.yml` passa a publicar um `checksums.txt` com o SHA-256
dos cinco binários, e **assina esse arquivo**. Assinar cada binário produziria
cinco artefatos de assinatura para verificar e cinco jeitos de a verificação
ficar pela metade; um manifesto assinado cobre o conjunto com uma verificação
só, e é o formato que qualquer consumidor sabe ler.

O `checksums.txt` nasce no mesmo job que já espera a Release existir
(`build-runner-binaries.yml:213-221`, o laço com teto de 600s), e a matriz
continua `fail-fast: false`: um alvo que não construiu **não** impede os outros
de publicar, mas o manifesto declara quais alvos ele cobre — um checksums que
lista quatro binários e cala sobre o quinto seria pior que nenhum.

### 3. Quem verifica, e o que acontece quando falha

| consumidor | verifica | quando falha |
|---|---|---|
| `install.sh` (ADR 0150) | assinatura da imagem por digest; `checksums.txt` assinado antes de usar o binário | **recusa nomeada** — diz qual artefato, qual verificação e para |
| `GET /runner-releases/binary` | **só** o SHA-256 do binário contra o `checksums.txt` da mesma Release — **não** a assinatura dele (ver abaixo) | 502 com `motivo`; nunca serve bytes não verificados |
| build local (ADR 0150) | a tag do git e a árvore limpa | recusa antes de construir |

**Falha de verificação é recusa, nunca aviso.** Um aviso que se pode aceitar
clicando é uma verificação que não existe — e o produto já aplica essa régua em
outro lugar, quando `consentir-base.mjs:246-258` recusa gravar e sai com 1 se o
compartilhamento não foi provado. Ausência do que se verificaria também é
recusa: uma Release sem `checksums.txt` faz o proxy **recusar**, e não servir
declarando que não pôde conferir — senão apagar 400 bytes da Release desligaria
a verificação de todo mundo.

#### O proxy da api verifica INTEGRIDADE, não procedência — e isso é decisão, não omissão

A segunda linha da tabela nasceu escrita como se as duas metades fossem uma. Na
sessão 3 elas foram separadas, depois de medir os dois jeitos de a api verificar
assinatura:

| caminho | medido | por que não |
|---|---|---|
| `cosign` dentro da imagem da api | **155 MB** (`cosign-linux-amd64` v2.6.1) | quase dobra uma imagem de runtime que é Alpine + Node, publicada por digest no GHCR ([ADR 0119](0119-imagens-publicadas-no-ghcr-por-digest.md)), para verificar um download opcional |
| `@sigstore/verify` + `@sigstore/tuf` | **2,5 MB, 12 pacotes**, sem advisory | o tamanho não é o custo. `getTrustedRoot()` refresca metadados TUF contra `tuf-repo-cdn.sigstore.dev` (o `seeds.json` do pacote só semeia o `root.json`), então uma rota `@Public()` que hoje depende de UM host de terceiro passaria a depender de dois — e ela é o ponto de entrada do onboarding do [ADR 0118](0118-configuracao-automatica-do-runner-pelo-navegador.md). Pior: pela régua dos ADRs [0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)/[0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md) — capability só é declarada quando **provada** — não há como provar o caminho hoje, porque **nenhuma Release tem `checksums.txt.bundle`**: o job `checksums` só roda numa tag final, e a lacuna já está declarada na RN-524 do lado de quem assina. Embarcar uma verificação não provável na frente do onboarding trocaria uma fraqueza conhecida por um 502 em toda plataforma, em toda instalação, descoberto só em produção |

Então o proxy confere o hash e **diz que é só o hash** — no docblock, na
descrição de OpenAPI, na mensagem de recusa e na
[RN-525](../business-rules.md#rn-525). Quem verifica a assinatura é o
`install.sh`, que tem `cosign` de verdade pelo caminho da decisão 4. A
consequência é registrada e não escondida: **BRB-005 fecha para a produção da
assinatura e segue aberto para a metade de procedência desta rota** — reabri-la
é decisão de uma sessão posterior, com uma Release assinada real contra a qual
provar.

### 4. O `cosign` que verifica também precisa de procedência

Verificar exige o binário do `cosign` na máquina de quem instala, e baixá-lo
sem verificação recriaria o problema um nível acima. O `install.sh` resolve
isso pelo caminho que o CI já usa para todo binário de terceiro: baixa a versão
**pinada** e confere com `sha256sum -c` contra um hash **escrito no próprio
script versionado** (`ci.yml:201` é o precedente). Quem confia no `install.sh`
o bastante para executá-lo confia no hash que ele carrega; a cadeia não fica
mais frágil do que o elo que a inicia.

## O que este ADR recusa explicitamente

- **Chave gerida à mão** (par próprio, KMS, GPG): custódia e rotação de um
  segredo de CI, pelo ganho de nada que o keyless não dê aqui.
- **"Assina agora, verifica depois."** Assinatura sem consumidor é um arquivo a
  mais na Release. Os três consumidores da tabela acima entram nesta fase, e o
  do `install.sh` é o que dá sentido a ela.
- **Assinar a imagem por tag.** Tag é ponteiro móvel; o digest é o que
  `.release/images.json` já registra e o que o overlay já aplica.
- **Atestação de SBOM e proveniência SLSA completa.** Fora de escopo declarado:
  são outro eixo, com outro consumidor, e nenhum deles remove o BRB-005.

## Consequences

- **BRB-005 fecha** para imagens e binários — e só para eles. O registro
  ([BRB register](../reference/brb.md)) recebe a evidência quando a sessão 2
  mergear.
- **E não fecha para a metade de procedência do proxy da api.** Pela decisão 3,
  `GET /runner-releases/binary` confere integridade contra o manifesto e recusa
  o que não pode conferir, mas não verifica a assinatura do manifesto — as duas
  formas de fazê-lo foram medidas e recusadas (155 MB de `cosign` na imagem; um
  segundo host de terceiro numa rota pública, verificando o que ainda não existe
  para ser provado). O registro de BRB diz isso em vez de anunciar o item
  fechado.
- **O broker continua sem assinatura porque continua sem publicação.**
  `docker-bake.hcl:81-83` tem quatro alvos e `scripts/ci/images-manifest.ts:54`
  aceita quatro; `brabo-broker:prod` só existe construído localmente. A
  consequência é do ADR 0150 e está declarada lá: numa instalação por GHCR, o
  profile `container-broker` é inalcançável — e o modo `mounted` sobe container
  **pelo broker** ([ADR 0144](0144-a-segunda-raiz-do-broker.md)).
- **`release.yml` ganha uma permissão a mais.** `id-token: write` é escopado ao
  workflow e não amplia o que ele já podia fazer com `packages: write`.
- Quem instalar sem rede para o Sigstore não consegue verificar — e, pela
  decisão 3, não instala. É o custo aceito de a verificação não ser opcional.
