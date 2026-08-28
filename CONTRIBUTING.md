# Contribuindo com o Brabo

Obrigado pelo interesse. Este documento existe para economizar o tempo dos
dois lados: o que ajuda, o que provavelmente não vai ser aceito, e como o
processo funciona de verdade.

## Antes de escrever código: abra uma issue

**Com todas as letras: PR grande sem issue prévia provavelmente será
recusado.** Não por burocracia — por respeito ao seu tempo. Este projeto tem
decisões arquiteturais registradas em [68 ADRs](docs/adr/index.md), e uma
mudança que contradiz uma delas custa muito trabalho para depois ser
rejeitada.

Abra uma issue, descreva o problema, e espere alinhamento. Para correção
óbvia (typo, link quebrado, mensagem de erro errada), pode mandar o PR direto.

## Setup

```bash
git clone git@github.com:daneiel/brabo.git
cd brabo
cp .env.example .env
pnpm install
pnpm dev
```

Depois: <http://localhost:5173>. `pnpm --filter api seed` cria os usuários de
demonstração — o login é `owner@brabo.dev` / `brabo12345678`.

`pnpm bootstrap` abre um menu de terminal com o que se faz no dia a dia (Docker,
Kubernetes, banco e testes), se você preferir não decorar comando. Ele só chama o
que já existe, e `pnpm bootstrap --print-commands` mostra exatamente o quê.

**Quanto tempo leva de verdade:** os comandos acima somam poucos minutos, mas a
**primeira** subida baixa as imagens (Postgres, Elixir, Node) e o
modelo padrão do Ollama. Numa conexão razoável, conte **10 a 20 minutos** na
primeira vez e menos de um minuto nas seguintes. Precisa de ~6 GiB de RAM
livres.

O passo a passo comentado, com o que conferir quando cada etapa falha, está em
[Primeiros passos](docs/getting-started.md).

## Rodando os testes

```bash
pnpm --filter api test      # vitest
pnpm --filter web test      # vitest
pnpm engine:test            # ExUnit
```

Elixir **não** é obrigatório no host — o engine roda no container. Se for
rodar fora do Docker, use a versão exata do projeto (**1.17.3 / OTP 27.1.2**):
o `mix format` de versões diferentes produz saída diferente e deixa o
`--check-formatted` do CI vermelho. Para formatar sem instalar:

```bash
docker run --rm -v "$PWD/apps/engine:/app" -w /app \
  hexpm/elixir:1.17.3-erlang-27.1.2-alpine-3.20.3 mix format
```

## Documentação faz parte do PR

Não é etapa posterior nem tarefa de outra pessoa.

**PR que muda comportamento observável precisa atualizar a doc
correspondente, no mesmo PR.** O mapa de responsabilidade é o
[`docs/.docmap.yml`](docs/.docmap.yml): ele liga caminhos de código aos
documentos que dependem deles. Consulte antes de abrir o PR e mostre o diff da
doc junto com o do código.

Três regras que caem daí:

- Arquivos marcados `generated: true` são gerados por `pnpm docs:generate` —
  **nunca** edite à mão, o build sobrescreve.
- Mudança estrutural (fronteira de camada, banco, modelo de consistência,
  dependência pesada) pede um [ADR](docs/adr/index.md) novo. Nunca edite um ADR
  aceito: escreva outro dizendo qual substitui.
- Regra de negócio nova vira uma RN em
  [`docs/business-rules.md`](docs/business-rules.md), com `arquivo:linha` e o
  teste que a cobre.

Rodar o site de documentação localmente — `website/` tem lockfile próprio
desde o [ADR 0117](docs/adr/0117-lockfile-proprio-para-o-website.md), então o
`pnpm install` da raiz (Setup, acima) não instala as dependências dele:

```bash
cd website && pnpm install && cd ..  # só na primeira vez, ou quando o lockfile mudar
pnpm docs:start     # servidor de desenvolvimento
pnpm docs:build     # build de produção — link quebrado FALHA o build
```

Sem informação suficiente para escrever algo, use
`> **TODO(humano):** <pergunta específica>`. Documentação inventada é pior que
documentação faltando.

### Versionar a documentação

O site **não** é versionado hoje: existe uma versão só, a `current`, que
reflete a branch. Numa `0.x` com um único release publicado, versionar
adicionaria manutenção sem dar nada em troca — cada versão congelada é uma
cópia inteira de `docs/` que passa a envelhecer sozinha.

Quando fizer sentido, o comando é:

```bash
pnpm --dir website docusaurus docs:version 0.2
```

E a regra de **quando**: só em **major ou minor**, nunca em patch. `0.2`,
`1.0`, `1.1` — sim. `1.0.1` — não. Versionar demais multiplica o custo de
manutenção da documentação por N, e ninguém procura a doc de um patch.

## Fluxo

1. **Fork** e clone.
2. **Branch** a partir de `dev`, nunca de `main`:
   `feature/<assunto>`, `bugfix/<assunto>` ou `docs/<assunto>`.

   A lista de funções é **fechada**: `breaking`, `feature`, `bugfix`, `perf`,
   `refactor`, `chore`, `docs`, `test`, `hotfix`. O `pr-police` reprova o que
   estiver fora — `fix/` inclusive, que é o engano mais comum.
3. **Commits** em [conventional commits](https://www.conventionalcommits.org/),
   **em pt-BR** — é o padrão que o histórico inteiro usa:
   ```
   feat(api): rate limit por usuário e por IP
   fix(engine): drain não deixava sessão órfã com uma réplica
   docs(runbook): funde os seis runbooks num só
   ```

   **Quebra de compatibilidade se marca no commit**, com `!` antes dos
   dois-pontos ou `BREAKING CHANGE:` no corpo — e a branch tem que ser
   `breaking/`:
   ```
   feat(auth)!: o refresh sai do corpo e vai para cookie httpOnly
   ```
   É o marcador que faz a quebra aparecer no CHANGELOG; a função da branch é
   que faz a versão subir MAJOR. O `pr-police` exige os dois juntos, porque
   ter só um deles produz uma release que mente — em algum dos dois sentidos.
4. **PR contra `dev`** (não `main`).
5. **Review** meu.
6. **Squash merge.**

Branches permanentes são `dev`, `qa`, `rc` e `main`. Merge nelas é sempre
manual — inclusive para mim, e há teste garantindo isso.

## Definition of Done

Antes de marcar o PR como pronto:

- [ ] Testes passando — caminho feliz **e** ao menos um caso de falha
- [ ] Lint limpo (`pnpm build` e o format do Elixir)
- [ ] Documentação afetada atualizada (ver `docs/.docmap.yml`)
- [ ] `CHANGELOG.md` tocado, se o comportamento observável mudou
- [ ] `pnpm docs:build` sem link quebrado
- [ ] Nenhum segredo no diff — o gitleaks roda no CI, mas ele é a última linha

## O que eu aceito com prazer

- Correção de bug com teste que reproduz
- Documentação: erro, lacuna, exemplo que não funciona
- Melhoria de mensagem de erro — especialmente as que hoje não dizem o que fazer
- Cobertura de teste em caminho de falha
- Acessibilidade e correção de contraste na UI
- Provider de git novo, **se** implementar as doze operações, declarar as
  capabilities honestamente e passar na suite de contrato

## O que provavelmente não aceito

Não é fechamento a ideias — é que estas custam caro e as decisões já foram
tomadas com motivo registrado:

- **Troca de stack.** NestJS, Elixir/OTP, React, Postgres e pnpm estão
  decididos. Não proponha alternativas.
- **Redis.** As filas ficam no Postgres via Oban, e o rate limit é uma janela
  deslizante em SQL. É decisão, não omissão.
- **Refactor amplo sem discussão prévia.** "Limpei o código" num PR de 40
  arquivos é irreviewável.
- **Dependência nova pesada** sem justificativa do que ela resolve e por que
  não dá sem ela.
- **Enfraquecer o pipeline de aprovação.** Qualquer coisa que permita ação com
  efeito externo escapar do `proposed_action`, ou que torne merge em branch
  protegida automatizável, é rejeitada por princípio — há teste garantindo os
  dois.
- **Bitbucket ou um `GenericGitProvider`** — fora de escopo por decisão.
- Mudança de escopo do produto sem issue e alinhamento.

## Prazo de resposta

Projeto mantido em tempo livre. O compromisso honesto: **reviso em geral em até
uma semana**. Se eu sumir por mais que isso, dá um ping educado no PR — não é
falta de interesse, é vida.

Nada de prometer 24 horas.

## Reconhecimento

Seu commit fica no histórico com sua autoria — é o registro que importa. PRs
relevantes são creditados na entrada do `CHANGELOG.md` da versão em que saírem.

Commits feitos por agentes do próprio sistema usam a identidade
`<agente>[bot]` com o humano como co-author, para que dê para distinguir.

## Licenciamento

Ao enviar um PR, você concorda em licenciar sua contribuição sob a mesma
**[MIT](LICENSE)** do projeto. Inbound = outbound.

**Não há CLA.** Você não assina nada nem cede direitos além do que a MIT já
prevê.

O [DCO](https://developercertificate.org/) (`git commit -s`) é **opcional**.
Se você já usa, ótimo. Se não usa, não vou exigir: para contribuidor casual,
descobrir o que é DCO e refazer commits por causa de um trailer é atrito real
que espanta mais gente do que protege.

## Segurança

**Nunca abra issue pública para falha de segurança.** O canal está em
[SECURITY.md](SECURITY.md).

## Código de conduta

Participar deste projeto — issue, PR, review — implica concordar com o
[Código de Conduta](CODE_OF_CONDUCT.md) (Contributor Covenant 2.1). O contato
para reportar comportamento inaceitável está lá.
