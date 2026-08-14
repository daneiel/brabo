import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';

// A branch que o botão "editar esta página" aponta. PRs de doc miram `dev`;
// o site publicado sai de `main` (ver CLAUDE.md).
const EDIT_BRANCH = 'dev';

// PUBLICAÇÃO POR DEGRAU. Cada permanente publica no seu próprio lugar dentro do
// mesmo GitHub Pages, e desde o ADR 0071 os TRÊS são simétricos:
// `/brabo/main/`, `/brabo/qa/` e `/brabo/dev/`. A raiz virou a página que
// escolhe entre eles. Quem decide é o `docs-deploy.yml`, passando
// `DOCS_BASE_URL` e `DOCS_BRANCH`.
//
// Não é preferência de estilo: o `baseUrl` entra em TODA URL de asset que o
// Docusaurus emite. Um site servido de `/brabo/dev/` com `baseUrl: '/brabo/'`
// carrega HTML e nada mais — CSS, JS e busca dão 404, e a página parece
// "quebrada sem erro".
//
// O default é o de produção, então rodar `pnpm docs:build` sem variável nenhuma
// continua produzindo exatamente o que sempre produziu.
const BASE_URL = process.env.DOCS_BASE_URL ?? '/brabo/main/';

// O degrau é DECLARADO, não deduzido do baseUrl.
//
// Isto já foi `BASE_URL === '/brabo/'`, e funcionava enquanto `main` era o
// único que publicava na raiz. Com os três em subdiretório, aquela comparação
// passaria a ser falsa para `main` também — e o efeito seria `noIndex: true` na
// documentação REAL: ela sairia do Google em silêncio, com o CI verde, porque
// nada no build reprova por indexar de menos.
//
// Deduzir ambiente de uma string de caminho é o tipo de acoplamento que só
// aparece quando o caminho muda. Uma variável própria não tem esse problema.
const DOCS_BRANCH = process.env.DOCS_BRANCH ?? 'main';

// `main` é a documentação real; `dev` e `qa` são pré-visualização do degrau.
const E_PRODUCAO = DOCS_BRANCH === 'main';

// Os três degraus, para o seletor da barra do topo. `href` ABSOLUTO de
// propósito: o link atravessa sites com `baseUrl` diferente, e um link relativo
// resolveria dentro do próprio degrau — `/brabo/dev/main/`, que não existe.
const DEGRAUS = [
  { branch: 'main', rotulo: 'main — estável' },
  { branch: 'qa', rotulo: 'qa — candidata' },
  { branch: 'dev', rotulo: 'dev — em desenvolvimento' },
] as const;

const config: Config = {
  title: 'Brabo',
  tagline:
    'Um time de agentes de IA conduz sua aplicação — você mantém a autoridade final',
  favicon: 'img/favicon.ico',

  url: 'https://daneiel.github.io',
  baseUrl: BASE_URL,
  organizationName: 'daneiel',
  projectName: 'brabo',
  trailingSlash: false,

  // `dev` e `qa` saem do índice de busca. São o MESMO conteúdo da produção em
  // outro estágio de maturidade: indexados, competiriam com a documentação real
  // nos resultados, e quem chegasse pelo Google leria a versão não validada sem
  // perceber. A raiz continua indexável.
  noIndex: !E_PRODUCAO,

  // Link quebrado é FALHA, não aviso. É o mecanismo mais barato que existe
  // contra documentação apodrecendo: mover um arquivo sem corrigir quem
  // aponta pra ele derruba o CI em vez de virar 404 em produção.
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  onBrokenMarkdownLinks: 'throw',

  future: {
    v4: true,
    // Rspack + SWC. Build 3–4× mais rápido, já estável no 3.x.
    // No 3.10 a flag chama `faster`; `experimental_faster` foi renomeada.
    faster: true,
  },

  i18n: {
    defaultLocale: 'pt-BR',
    locales: ['pt-BR'],
  },

  markdown: {
    mermaid: true,
    // `.md` é CommonMark, `.mdx` é MDX. Sem isto o Docusaurus 3 processa TODO
    // `.md` como MDX, e a sintaxe estrita do MDX quebra em `{` literal e HTML
    // solto — o `{#ancora}` de um título vira "expressão JS inválida". Como
    // nenhuma página aqui usa componente React, CommonMark é o formato certo;
    // o dia que uma precisar, ela vira `.mdx`.
    format: 'detect',
  },

  plugins: [
    [
      // Referência da API gerada do OpenAPI (Fase 7b, itens 7 e 8).
      //
      // `outputDir` aponta para `../docs`, e não para `website/docs`: a fonte
      // única de verdade do Markdown é `docs/` na raiz, e `website/docs/`
      // NUNCA existe.
      //
      // A spec fica um nível ACIMA do `outputDir`: o `clean-api-docs` apaga o
      // diretório inteiro antes de regerar, e deixar a entrada lá dentro faria
      // a segunda execução falhar com ENOENT.
      //
      // Quem escreve os `.mdx` é `pnpm docs:generate`, nunca a mão. O
      // `docs:check` compara o hash de cada arquivo com o manifesto.
      'docusaurus-plugin-openapi-docs',
      {
        id: 'api',
        docsPluginId: 'default',
        config: {
          brabo: {
            specPath: '../docs/reference/openapi.json',
            outputDir: '../docs/reference/api',
            // Uma página por rota, agrupadas por tag — é o que dá a "seção por
            // domínio" que o escopo pede.
            sidebarOptions: {
              groupPathsBy: 'tag',
              categoryLinkSource: 'tag',
            },
            downloadUrl:
              'https://github.com/daneiel/brabo/blob/main/docs/reference/openapi.json',
          },
        },
      },
    ],
  ],

  themes: [
    '@docusaurus/theme-mermaid',
    // O tema é o que renderiza os `.mdx` gerados: sem ele os componentes
    // `<ApiTabs>`/`<SchemaTabs>` que o plugin emite não existem e o build
    // quebra.
    'docusaurus-theme-openapi-docs',
    [
      // Busca local: sem Algolia, sem chamada externa, sem conta em serviço de
      // terceiro. `hashed` põe o hash do índice no nome do arquivo pra não
      // servir índice velho de cache.
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        hashed: true,
        language: ['pt', 'en'],
        indexBlog: false,
        docsRouteBasePath: '/',
        highlightSearchTermsOnTargetPage: true,
        // OBRIGATÓRIO junto do `noIndex` acima, e a interação não é óbvia: o
        // plugin descarta toda página que tenha
        // `<meta name="robots" content="noindex">` (`parse.js`, "Unlisted
        // content"), que é exatamente o que o `noIndex` emite. Sem esta linha, os
        // degraus `dev` e `qa` publicariam com a busca MORTA — índice de 666
        // bytes, `documents: []`, e a caixa de busca respondendo "No results"
        // para qualquer termo.
        //
        // Medido, não suposto: com `noIndex` e sem esta opção, 0 documentos
        // indexados; a produção, que não tem `noIndex`, indexa 2318.
        //
        // As duas coisas não se contradizem: `noIndex` fala com buscador
        // EXTERNO, esta opção fala com o índice LOCAL. Querer os degraus fora do
        // Google não é querer os degraus sem busca.
        forceIgnoreNoIndex: true,
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          // FONTE ÚNICA DE VERDADE: o site LÊ de docs/ na raiz do
          // repositório. Nunca existe website/docs/ — conteúdo duplicado é
          // conteúdo que diverge.
          path: '../docs',
          routeBasePath: '/',
          // O QUE LIGA O TEMA OPENAPI ÀS PÁGINAS GERADAS. Sem esta linha o
          // Docusaurus aplica o default `@theme/DocItem`, e o `@theme/ApiItem`
          // — o único lugar do tema que monta o `<Provider>` do redux
          // (`createStoreWithState`) — nunca é montado. Os `.api.mdx` importam
          // `@theme/ApiExplorer/MethodEndpoint`, que lê esse store com
          // `useSelector`, então cada página de operação achava contexto nulo e
          // morria na HIDRATAÇÃO com "Cannot destructure property 'store'".
          //
          // O modo de falha é traiçoeiro e é o motivo de isto ter passado por
          // duas releases (v1.0.0 e v1.0.1) sem ninguém ver: o SSR renderiza
          // certo, o HTML servido tem o conteúdo da rota, `docs:build` fica
          // VERDE — e o error boundary só apaga a página no navegador. Build
          // verde nunca provou que a página renderiza; quem prova agora é o
          // `scripts/docs/api-render-check.mjs`.
          //
          // Vale para TODA página de doc, não só as de API: o `ApiItem` delega
          // ao `DocItem` quando o front-matter não tem `api:`. É por isso que a
          // verificação desta mudança inclui páginas não-API.
          docItemComponent: '@theme/ApiItem',
          sidebarPath: './sidebars.ts',
          // Função, não string: com `path: '../docs'` o Docusaurus concatena
          // o caminho relativo ao siteDir e produziria `.../docs/../docs/x.md`,
          // que o GitHub não resolve. `docPath` já vem relativo a docs/.
          editUrl: ({ docPath }) =>
            `https://github.com/daneiel/brabo/blob/${EDIT_BRANCH}/docs/${docPath}`,
          showLastUpdateTime: true,
          showLastUpdateAuthor: true,
          // O NÚMERO DO ADR É A IDENTIDADE DELE. Por padrão o Docusaurus
          // trata "0004-" como prefixo de ordenação e o remove da URL, o que
          // transformaria o ADR 0004 em `/adr/git-credential-registration` —
          // e quebraria toda citação por número, dentro e fora do repo.
          numberPrefixParser: false,
          // A missão de documentação não é página do site.
          exclude: ['missions/**', '**/_*.md'],
        },
        // O canal de release notes é o CHANGELOG.md, em Keep a Changelog. Um
        // blog vazio ao lado dele seria só mais um lugar pra procurar.
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Brabo',
      logo: {
        alt: 'Brabo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Documentação',
        },
        { to: '/runbook', label: 'Runbook', position: 'left' },
        { to: '/adr/', label: 'ADRs', position: 'left' },
        // O degrau que você está lendo, e como trocar. Fica à esquerda do
        // GitHub porque é navegação do próprio site, não link externo.
        {
          type: 'dropdown',
          label: DOCS_BRANCH,
          position: 'right',
          items: DEGRAUS.map((d) => ({
            href: `https://daneiel.github.io/brabo/${d.branch}/`,
            label: d.branch === DOCS_BRANCH ? `${d.rotulo} ✓` : d.rotulo,
          })),
        },
        {
          href: 'https://github.com/daneiel/brabo',
          label: 'GitHub',
          position: 'right',
        },
        // TODO(humano): com o handle do Buy Me a Coffee definido (ver
        // .github/FUNDING.yml), descomente:
        // {
        //   href: 'https://buymeacoffee.com/<handle>',
        //   label: '☕ Apoie',
        //   position: 'right',
        // },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentação',
          items: [
            { label: 'Primeiros passos', to: '/getting-started' },
            { label: 'Arquitetura', to: '/architecture' },
            { label: 'Regras de negócio', to: '/business-rules' },
            { label: 'Runbook', to: '/runbook' },
          ],
        },
        {
          title: 'Comunidade',
          items: [
            {
              label: 'Como contribuir',
              href: `https://github.com/daneiel/brabo/blob/${EDIT_BRANCH}/CONTRIBUTING.md`,
            },
            {
              label: 'Onde pedir ajuda',
              href: `https://github.com/daneiel/brabo/blob/${EDIT_BRANCH}/SUPPORT.md`,
            },
            {
              label: 'Segurança',
              href: `https://github.com/daneiel/brabo/blob/${EDIT_BRANCH}/SECURITY.md`,
            },
          ],
        },
        {
          title: 'Mais',
          items: [
            { label: 'GitHub', href: 'https://github.com/daneiel/brabo' },
            {
              label: 'CHANGELOG',
              href: `https://github.com/daneiel/brabo/blob/${EDIT_BRANCH}/CHANGELOG.md`,
            },
            {
              label: 'Licença MIT',
              href: `https://github.com/daneiel/brabo/blob/${EDIT_BRANCH}/LICENSE`,
            },
            {
              label: 'Avisos de terceiros',
              href: `https://github.com/daneiel/brabo/blob/${EDIT_BRANCH}/THIRD_PARTY_NOTICES.md`,
            },
          ],
        },
      ],
      copyright:
        `Copyright © ${new Date().getFullYear()} Daniel Souza. Licenciado sob a MIT. ` +
        'Ferramentas de terceiros mantêm as próprias licenças — ver Avisos de terceiros.',
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'sql', 'elixir', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
