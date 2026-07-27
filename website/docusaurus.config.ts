import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';

// A branch que o botão "editar esta página" aponta. PRs de doc miram `dev`;
// o site publicado sai de `main` (ver CLAUDE.md).
const EDIT_BRANCH = 'dev';

const config: Config = {
  title: 'Brabo',
  tagline:
    'Um time de agentes de IA conduz sua aplicação — você mantém a autoridade final',
  favicon: 'img/favicon.ico',

  url: 'https://daneiel.github.io',
  baseUrl: '/brabo/',
  organizationName: 'daneiel',
  projectName: 'brabo',
  trailingSlash: false,

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
