import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Os ADRs agrupados por tema, DERIVADOS de `docs/adr/temas.yml` e dos arquivos
 * em `docs/adr/` a cada build (AT-560): ADR novo cai no grupo do tema dele sem
 * editar este arquivo. O parser lê só as duas formas que o `temas.yml` usa
 * (`- id:`/`titulo:` e `"NNNN": tema`); quem valida o arquivo é o `docs:check`.
 * Parse que se perdeu (zero temas, zero ADRs mapeados, ADR sem tema) LANÇA:
 * o `docs:check` garante que todo ADR tem tema, então isso só acontece se o
 * formato do `temas.yml` mudou e este parser não acompanhou.
 */
function adrsPorTema() {
  const dir = path.resolve(__dirname, '../docs/adr');
  const yml = readFileSync(path.join(dir, 'temas.yml'), 'utf8');
  const temas = [...yml.matchAll(/^\s+- id: (\S+)\n\s+titulo: (.+)$/gm)].map((m) => ({ id: m[1], titulo: m[2].trim() }));
  const temaDe = new Map([...yml.matchAll(/^\s+"(\d{4})": (\S+)\s*$/gm)].map((m) => [m[1], m[2]]));
  const grupos = new Map<string, string[]>([...temas.map((t) => [t.id, []] as [string, string[]]), ['', []]]);
  for (const arq of readdirSync(dir).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort()) {
    const tema = temaDe.get(arq.slice(0, 4)) ?? '';
    (grupos.get(tema) ?? grupos.get('')!).push(`adr/${arq.slice(0, -3)}`);
  }
  const semTema = grupos.get('')!;
  if (!temas.length || !temaDe.size || semTema.length) {
    throw new Error(
      `sidebars.ts: o parse de docs/adr/temas.yml se perdeu (${temas.length} temas, ${temaDe.size} ADRs mapeados, sem tema: ${semTema.join(', ') || 'nenhum'}). Ajuste adrsPorTema() ao formato do arquivo.`,
    );
  }
  return temas
    .map((t) => ({ type: 'category' as const, label: t.titulo, items: grupos.get(t.id)! }))
    .filter((c) => c.items.length);
}

/**
 * Escrito à mão, organizado por Diátaxis — tutorial, how-to, referência e
 * explicação não se misturam.
 *
 * Duas ausências deliberadas em relação ao molde completo do Diátaxis:
 *
 * - **how-to/** — não existe ainda. Um guia por tarefa real vale muito, mas
 *   criar arquivos finos só pra preencher a categoria é pior que não ter: o
 *   runbook já cobre as tarefas operacionais e o getting-started cobre o
 *   caminho de entrada.
 * Quando houver conteúdo genuíno, a categoria entra aqui — foi o que
 * aconteceu com **explanation/**, que nasceu com a página do mecanismo de
 * sincronização. Os 28 ADRs continuam sendo a maior parte da camada de
 * explicação deste projeto; `explanation/` é pra o que não é decisão datada.
 */
const sidebars: SidebarsConfig = {
  docs: [
    {
      type: 'category',
      label: '🚀 Comece aqui',
      collapsed: false,
      items: ['intro', 'getting-started', 'tutorials/from-zero-to-deliverable', 'tutorials/interface-antes-e-depois-shadcn'],
    },
    {
      type: 'category',
      label: '🏗️ Arquitetura',
      collapsed: false,
      items: [
        'architecture',
        {
          type: 'category',
          label: 'Decisões (ADR)',
          link: { type: 'doc', id: 'adr/adr-index' },
          items: adrsPorTema(),
        },
      ],
    },
    {
      type: 'category',
      label: '📐 Regras',
      collapsed: false,
      items: ['business-rules', 'business-rules/custo', 'business-rules/autenticacao'],
    },
    {
      type: 'category',
      label: '📖 Referência',
      collapsed: false,
      items: [
        { type: 'doc', id: 'reference/configuration', label: 'Configuração' },
        { type: 'doc', id: 'reference/events', label: 'Eventos' },
        { type: 'doc', id: 'reference/permissions', label: 'Permissões' },
        { type: 'doc', id: 'reference/artifacts', label: 'Artefatos' },
        { type: 'doc', id: 'reference/git-providers', label: 'Provedores de git' },
        { type: 'doc', id: 'reference/internal-api', label: 'API interna' },
        { type: 'doc', id: 'reference/scripts', label: 'Scripts e comandos' },
        { type: 'doc', id: 'reference/rulesets', label: 'Rulesets do repositório' },
        { type: 'doc', id: 'reference/paridade-de-traducao', label: 'Paridade de tradução' },
        { type: 'doc', id: 'reference/brb', label: 'Registro BRB' },
        'security-surface',
        {
          // Uma página Redoc gerada da spec pelo redocusaurus (ADR 0206).
          type: 'link',
          label: 'Referência da API',
          href: '/reference/api/',
        },
      ],
    },
    {
      type: 'category',
      label: '💡 Explicação',
      collapsed: false,
      items: [
        {
          type: 'category',
          label: 'Processo e esteira',
          collapsed: false,
          items: [
            'explanation/documentation-workflow',
            'explanation/branching-policy',
            'explanation/cadeia-de-suprimentos-do-ci',
            'explanation/gates',
            'explanation/observability',
            'explanation/modelo-de-time',
          ],
        },
        {
          type: 'category',
          label: 'Validações e medições',
          collapsed: true,
          items: [
            'explanation/primeiro-dogfooding',
            'explanation/execucao-real-hello-world',
            'explanation/achados-execucao-real',
            'explanation/validacao-fase-12',
            'explanation/validacao-real',
            'explanation/aceite-providers',
            'explanation/medicao-do-idioma',
            'explanation/medicao-do-jev',
            'explanation/auditoria-fluxo-vs-codigo',
            'explanation/auditoria-visual-rodada-29',
          ],
        },
        {
          type: 'category',
          label: 'História das fases',
          collapsed: true,
          items: [
            'explanation/historico-de-fases',
            'explanation/fase-28-pasta-do-usuario',
            'explanation/fase-29-instalacao-de-uma-linha',
            'explanation/fase-30-runner-por-maquina',
            'explanation/backlog',
          ],
        },
        {
          type: 'category',
          label: 'Localização',
          collapsed: true,
          items: [
            'explanation/localizacao',
            'explanation/localizacao-en',
            'explanation/localizacao-ru',
            'explanation/localizacao-zh-hans',
          ],
        },
        {
          type: 'category',
          label: 'Notas técnicas',
          collapsed: true,
          items: [
            'explanation/tanstack-ai',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: '🛠️ Operação',
      collapsed: false,
      items: ['runbook'],
    },
    {
      type: 'category',
      label: '📚 Vocabulário',
      collapsed: false,
      items: ['glossary'],
    },
    {
      type: 'category',
      label: '🤝 Contribuir',
      collapsed: false,
      items: [
        {
          type: 'link',
          label: 'Como contribuir',
          href: 'https://github.com/daneiel/brabo/blob/dev/CONTRIBUTING.md',
        },
        {
          type: 'link',
          label: 'Onde pedir ajuda',
          href: 'https://github.com/daneiel/brabo/blob/dev/SUPPORT.md',
        },
        {
          type: 'link',
          label: 'Reportar vulnerabilidade',
          href: 'https://github.com/daneiel/brabo/blob/dev/SECURITY.md',
        },
      ],
    },
  ],
};

export default sidebars;
