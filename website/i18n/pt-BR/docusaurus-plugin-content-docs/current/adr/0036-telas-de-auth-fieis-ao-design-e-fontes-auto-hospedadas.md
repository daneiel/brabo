# 0036 — Telas de auth fiéis ao design, e as três fontes que não carregavam

## Contexto

As quatro telas de auth — `/login`, `/registrar`, `/esqueci-senha`,
`/definir-senha` — nasceram no [ADR 0032](0032-corte-do-keycloak-e-sessao-em-cookie.md),
junto com o corte do Keycloak. Nasceram **funcionais**: autenticam, tratam erro,
navegam, e as propriedades de anti-enumeração do
[ADR 0031](0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) estão todas
lá. O que nunca existiu foi design.

O motivo está escrito no próprio código que elas substituíram: o Keycloak servia
essa superfície, então ela nunca foi desenhada. `design/SCREENS.md`, a curadoria
de telas do design system, **não tem seção de login** — a lacuna é anterior às
telas. Elas foram compostas a partir dos specs de base do `design/COMPONENTS.md`
e dos tokens semânticos, que é o melhor que se podia fazer sem mock, e o
resultado é um card cinza sem marca, com o aviso de migração como prosa solta no
rodapé e sem rodapé de página.

Duas descobertas mudaram o enquadramento desta sessão.

### 1. O mock existe, mas não no repositório

Um mock de login foi criado no projeto de design externo **depois** da curadoria
de 2026-07-23 que gerou `design/tokens.css` e `design/COMPONENTS.md`:

- projeto `1c960ca8-5e00-4558-8ced-80dfbdf01027`, arquivo `Brabo Login.dc.html`.

É a especificação autoritativa deste trabalho, e ela vive fora do controle de
versão. Quem revisar isto depois não tem como reconferir sem acesso ao projeto de
design — daí a obrigação, registrada na decisão 9, de a tela entrar em
`design/SCREENS.md`.

### 2. As três fontes do design system não carregavam em produção

`apps/web/index.html` puxava Space Grotesk, Archivo e IBM Plex Mono do Google
Fonts por `<link>`. A CSP da imagem de produção, em `docker/web/nginx.conf`, é:

```
style-src 'self' 'unsafe-inline'; font-src 'self' data:
```

Ela **bloqueia a folha de estilo e os arquivos de fonte**. Nenhum `.woff2` estava
versionado. Então, no contêiner nginx, as três famílias caíam em fonte de
sistema — e como `--font-heading` e `--font-body` compartilham o fallback
`sans-serif`, **a distinção tipográfica entre título e corpo simplesmente
desaparecia**. `index.css` tem `font-synthesis: none`, então o navegador não
sintetizava nem o peso 700.

Era invisível em `pnpm dev`, onde não há nginx nem CSP. E o comentário no topo de
`design/tokens.css` afirmava que a carga acontecia "via `<link>` no `<head>` do
HTML que consome este arquivo" — descrevendo com precisão um mecanismo que a
própria imagem de produção proibia.

Isto não é hipótese nem dívida futura: era defeito em produção, na tipografia,
que é a primeira coisa que o design system especifica.

## Decisão

### 1. Auto-hospedar as três famílias

Oito arquivos `.woff2` em `apps/web/public/fonts/`, com `@font-face` em
`apps/web/src/index.css` e `font-display: swap`. O `<link>` do Google sai.
Satisfaz a CSP atual **sem afrouxá-la** — a alternativa era acrescentar
`fonts.googleapis.com` e `fonts.gstatic.com` a `style-src` e `font-src`, o que
troca um defeito por duas dependências de terceiro no caminho crítico de render.

O `@font-face` fica em `index.css` e **não** em `design/tokens.css`: a carga é
responsabilidade de quem consome os tokens, e o comentário daquele arquivo passa a
dizer isso em vez do que dizia.

Space Grotesk e Archivo são fontes **variáveis** e entram com intervalo de peso
(`font-weight: 500 700` e `400 600`); IBM Plex Mono é estática e entra com um
`@font-face` por peso. A distinção foi verificada decodificando o diretório de
tabelas de cada `.woff2` e procurando a tabela `fvar` — declarar intervalo numa
fonte estática faz o navegador sintetizar o peso que falta, que é exatamente o que
`font-synthesis: none` existe para impedir.

**Obrigação de licença.** As três são OFL 1.1, que exige distribuir o aviso de
copyright junto do binário. `apps/web/public/fonts/LICENSE.txt` traz a licença e
os três avisos, e `THIRD_PARTY_NOTICES.md` deixou de dizer "carregadas por CDN,
não embutidas" — porque agora são embutidas, e a obrigação passou a existir.

### 2. Verificação em duas camadas, porque uma não alcança

- **Teste** (`apps/web/test/fontes.test.ts`): todo `url()` de `@font-face` no
  `index.css` resolve para arquivo existente, com assinatura `wOF2`; todo bloco
  tem `font-display: swap` e `unicode-range`; o intervalo de peso corresponde a
  variável-ou-estática; e `index.html` **não** menciona `fonts.googleapis.com`.
- **Gate no `docker/web/Dockerfile.prod`**: o diretório existe, tem os oito
  arquivos, e o `index.html` publicado não referencia o CDN.

Nenhum dos dois prova fonte **renderizada**. jsdom não aplica CSS Module nem
resolve `var()` de `@import`, e `getComputedStyle` devolve o que foi escrito, não
o que foi resolvido. A prova de renderização é conferência manual no contêiner, e
está registrada como tal.

### 3. `AuthLayout` passa a ser a moldura inteira

Era o card e mais nada. O mock acrescenta duas peças que valem para as quatro
telas igualmente — cabeçalho de marca acima do card e rodapé de página abaixo — e
elas moram na moldura, não na tela. Cada tela preenche quatro pontos: `titulo`,
`subtitulo`, `rodapeDoCartao` e `abaixoDoCartao`.

O título do card é o único `<h1>`; "Brabo" é um `<span>`. Promover a marca a
cabeçalho daria dois `<h1>` e faria a lista de cabeçalhos do leitor de tela
começar pela marca em toda tela, em vez de dizer o que se faz ali.

### 4. Quatro componentes do design system, e o critério de onde cada coisa mora

| peça | onde ficou | por quê |
|---|---|---|
| `Alert` | componente novo em `components/ui/` | precisa em quatro tons e nas quatro telas; antes cada tela tinha a própria classe `.aviso`/`.banner`, copiada com espaçamento ligeiramente diferente |
| `loading` no `Button` | prop no DS | cada tela trocava o label à mão; para quem usa leitor de tela o botão só ficava desabilitado, sem dizer que havia trabalho em curso |
| campo preenchido | prop `preenchido` no `Input`, opt-in | o `Input` é usado por cinco telas fora de auth; trocar o default restilizaria as cinco em silêncio |
| revelar senha | prop `revelavel` no `Input` | é anatomia de campo, não de tela: o botão se posiciona dentro da caixa e alterna o `type`. As duas telas com senha herdam |
| cabeçalho de marca | local, no `AuthLayout` | é moldura de tela, não componente de biblioteca |
| `LogoMark` | ícone novo | o `BrandIcon` existente é outro desenho (cubo isométrico); o do mock é barra + dois chevrons |

**`role` do `Alert` é prop, e não é derivado do tom.** `role="alert"` é live region
assertiva: o leitor de tela interrompe o que estiver falando. Isso é certo para o
resultado de uma ação que o usuário acabou de disparar e errado para texto que já
estava na tela quando ela abriu. Se o tom decidisse o papel, o aviso de migração
(tom `warning`) entraria na mesma live region do erro de credencial — e o anúncio
de "e-mail ou senha incorretos" passaria a incluir "a senha antiga não foi
migrada", que é precisamente a insinuação sobre a conta que o 401 uniforme do ADR
0031 existe para evitar.

**`fullWidth` do `Button` era quebrado.** A regra era `flex: 1`, que só faz efeito
se o pai for flex ou grid — e nenhum dos containers que usam a prop é. Ela era
passada em sete lugares, todos nas telas de auth, e não esticava nada: "botão
full-width" aparecia como requisito de design enquanto o botão tinha a largura do
texto. Virou `width: 100%`.

### 5. Onde cada erro aparece

O erro de credencial sai do campo Senha e vira alerta no topo do card. Erro de
formulário e erro de campo passam a ser coisas distintas nas quatro telas:

- **do campo** (senha curta, confirmação diferente): sob o campo, com
  `aria-invalid`, porque é ali que se conserta;
- **do formulário** (credencial recusada, link inválido, falha de rede): no
  alerta do topo, porque não aponta para campo nenhum.

Credencial recusada não recebe `aria-invalid` em campo nenhum: nem o e-mail nem a
senha estão individualmente malformados, e a api não diz qual dos dois errou.
Marcar os dois afirmaria mais do que se sabe.

A cópia muda de `E-mail ou senha inválidos.` para `E-mail ou senha incorretos.`.
O caso 403 (`Confirme seu e-mail…`) segue distinto, como o ADR 0032 e a
[RN-032](../business-rules/autenticacao.md#rn-032) exigem: a uniformidade é entre "não existe",
"senha errada" e "conta bloqueada" — não com "e-mail não verificado", que só é
alcançável **depois** de a senha ser provada.

### 6. A versão real no rodapé, e a cadeia que não existia

O rodapé mostra a versão do artefato. Descobriu-se, ao ligá-la, que
`BRABO_VERSION` **nunca era definida em lugar nenhum do repositório**: a api a
lia para o `service.version` do recurso OpenTelemetry e sempre recebia o fallback
`dev`, então todo span de todo ambiente dizia `dev` e o atributo era inútil
justamente para o que ele serve. E `docs/reference/configuration.md` afirmava que
"a imagem de release injeta a tag" e que ela "aparece no `/health`" — as duas
falsas.

A cadeia agora existe, e é uma só para os dois serviços: `release.yml` calcula
`versao=${TAG#v}` → passa `VERSION` ao `docker buildx bake` → o bakefile a
converte em `BRABO_VERSION` (alvo `api`) e `VITE_BRABO_VERSION` (alvo `web`) →
cada `Dockerfile.prod` a declara como `ARG` com default `dev` → o Vite inlina →
`runtime-config.ts` lê → `AuthLayout` mostra.

**Build-time, apesar de o [ADR 0024](0024-fase5-imagens-producao-ci.md) ter
escolhido runtime para as URLs.** A razão lá era promover a MESMA imagem entre
ambientes, e URL é propriedade do ambiente. Versão é propriedade do **artefato**:
`brabo-web:1.1.2` não deve poder reportar outra coisa, ou o rodapé passa a ser um
campo editável em vez de uma identidade.

`VERSION` é separada de `TAG` no bakefile porque o `ci.yml` usa `TAG=prod`, e
"prod" não é versão de nada.

### 7. `/status` deixa de exigir sessão

O rodapé aponta para `/status`, e ela estava atrás do guard de sessão: clicar em
"Status" na tela de login redirecionava de volta para a tela de login — o único
destino que ela não pode ter. Passou para um `publicLayout` novo, irmão do de
auth. É seguro: a página só consulta os `/health` da api e do engine, que já eram
públicos porque é o kubelet que os chama, antes de qualquer token existir.

### 8. Contraste calculado dos tokens, não medido pelo axe

O axe roda nas quatro telas, nos estados vazio, de erro e de sucesso — mas com a
regra `color-contrast` **explicitamente desligada**. Ela precisa de layout e de
cor resolvida, e jsdom não tem nem um nem outro: rodá-la ali produziria "passou"
sem ter olhado nada, que é pior que teste ausente porque parece cobertura.

O contraste é verificado por cálculo direto sobre `design/tokens.css`, com a
fórmula de luminância do WCAG 2.1, para os pares que as telas realmente usam.
Quatro reprovavam o 4.5:1. Três foram corrigidos com tokens que já existiam:

| par | era | virou | razão |
|---|---|---|---|
| `.hint` do `Input` | `--text-muted` (3.89) | `--text-secondary` (8.00) | valia para as cinco telas fora de auth também |
| `.link` de auth | `--accent` (3.88) | `--accent-hover` (4.90) | mesmo matiz, um degrau mais claro |
| placeholder do campo preenchido | `--text-muted` (3.10) | `--text-secondary` (6.37) | placeholder é texto |

O quarto **não** foi corrigido, e é o mais visível: `--on-accent` sobre `--accent`
dá **3.20:1** no botão primário, que exige 4.5 (texto de 14px/600). É o par
terracota do design system, usado em todo botão primário da aplicação; consertar
exige escurecer `--accent` até `--terracota-500` (5.27:1), o que muda a cor da
marca em toda a UI. Isso é decisão de design, não de implementação, e fica
registrado como pendência com o número travado em teste, para não poder piorar
sem ninguém ver.

### 9. A tela entra no `design/`

`design/` é a fonte de verdade da UI e não tinha spec de alerta, de loading de
botão nem de campo preenchido — as três coisas que este trabalho cria. As três
anatomias entram em `design/COMPONENTS.md`, e `design/SCREENS.md` ganha a seção de
login que nunca existiu. É o que fecha a lacuna que originou o problema, e é a
única forma de a fidelidade ser reconferível por quem não tem o mock.

## Consequências

### As divergências deliberadas em relação ao mock

| # | divergência | razão |
|---|---|---|
| 1 | sem "Continuar com GitHub" | login social é backlog consciente da Fase 7, já registrado no ADR 0031 e reafirmado no 0032. Nada de novo aqui — só a constatação de que o mock desenhou algo que a fase decidiu não ter |
| 2 | sem "N agentes online" | dado dinâmico pré-autenticação amplia a superfície sem necessidade: exigiria uma rota pública contando agentes. É candidato a painel interno, não a tela de login |
| 3 | campo em `--surface-2`, não `--code-bg` | escolha explícita: campo elevado em vez de afundado. Sobre um card `--surface-1`, o fundo default do campo é o MESMO do card |
| 4 | `.link` em `--accent-hover` | contraste — ver decisão 8 |
| 5 | `--shadow` dos tokens, não a redefinição do mock | o mock é um arquivo solto e sobrescreveu o token no próprio `:root`. A fonte de verdade do token é o design system |
| 6 | "Esqueci minha senha" é irmão do `<label>`, não filho | clique em qualquer lugar de um `<label>` ativa o campo associado; dentro do rótulo, o clique no link também focaria o campo de senha |

**Consequência derivada da nº 1**: o divisor "ou" do mock existe **só** para
separar os dois botões. Sem o segundo, ele sai também — manter um "ou" apontando
para nada seria pior que a assimetria.

**Consequência da nº 2**: o rodapé do card fica com um item, então o
`justify-content: space-between` do mock vira alinhamento à esquerda, explícito.

### O que fica pendente, e por quê

- **O contraste do botão primário** (3.20:1). Precisa de decisão sobre a cor da
  marca. É a única reprovação de AA que sobra nas telas.
- **O mesmo problema de campo nas outras cinco telas**: `Input` default é
  `--surface-1` sobre card `--surface-1`, separados por 1px de borda. A variante é
  opt-in, então nada mudou lá — e nada foi consertado.
- **`data-theme="light"` continua não exercitado.** Existe nos tokens e nada o
  define. As telas usam só token semântico, então herdam o tema claro se alguém o
  ligar, mas três pares dele reprovam o AA — afirmado como registro no teste de
  contraste, não como garantia.
- **A fidelidade é contra um arquivo não versionado.** Mitigado pela decisão 9,
  não eliminado.
- **Nenhum teste prova fonte renderizada.** Ver decisão 2.

### Duas dependências novas, as duas de desenvolvimento

`@testing-library/user-event` (ordem de foco) e `axe-core` (a11y estrutural).
Nenhuma de runtime — o bundle não muda.

`axe-core` direto, e não o wrapper `vitest-axe` que seria o caminho óbvio: o
wrapper acrescenta um matcher e uma dependência para economizar seis linhas, e com
a chamada direta a lista de regras desligadas fica visível no arquivo de teste,
onde quem desligar a próxima terá que escrever por quê.

O harness foi conferido contra violação real — input sem `<label>` e botão sem
nome acessível — antes de se confiar no verde. Teste de a11y que passa por não
estar olhando é o modo de falha padrão dessa ferramenta em jsdom.
