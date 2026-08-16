import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ApprovalCard } from './ApprovalCard';
import type { ActionType, ProposedAction } from '../lib/api-types';

/**
 * Os 15 tipos do backend (`apps/api/src/domain/actions/decide.ts`).
 *
 * A lista era "escrita à mão de propósito", confiando no `Record<ActionType, …>`
 * para cobrar tipo novo na compilação. Não cobrou: `parallelize` e
 * `raise_max_parallel` entraram na FASE 14d e ficaram fora dos dois lados ao
 * mesmo tempo — do backend o compilador do web não sabe nada. Quem cobra a
 * divergência agora é `src/lib/aprovacoes.test.ts`, que LÊ o decide.ts; esta
 * lista continua aqui só como fixture de render.
 */
const TODOS_OS_TIPOS: ActionType[] = [
  'terminal',
  'git_commit',
  'git_push',
  'pr_open',
  'spend',
  'git_repo_create',
  'git_branch_create',
  'git_branch_protect',
  'write_file',
  'open_adr_pr',
  'git_merge',
  'open_infra_pr',
  'instruction_patch',
  'parallelize',
  'raise_max_parallel',
];

function makeAction(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'action-1',
    projectId: 'project-1',
    sessionId: 'session-1',
    seq: 1,
    actionType: 'terminal',
    payload: { command: 'rm -rf /tmp/build' },
    status: 'pending',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'llama3.1:8b' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ApprovalCard', () => {
  it('chama onApprove ao clicar em Aprovar', () => {
    const onApprove = vi.fn();
    render(
      <ApprovalCard action={makeAction()} onApprove={onApprove} onDeny={vi.fn()} onAlwaysAllow={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('chama onDeny ao clicar em Negar', () => {
    const onDeny = vi.fn();
    render(
      <ApprovalCard action={makeAction()} onApprove={vi.fn()} onDeny={onDeny} onAlwaysAllow={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Negar' }));
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it('chama onAlwaysAllow ao clicar em Sempre permitir', () => {
    const onAlwaysAllow = vi.fn();
    render(
      <ApprovalCard action={makeAction()} onApprove={vi.fn()} onDeny={vi.fn()} onAlwaysAllow={onAlwaysAllow} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sempre permitir' }));
    expect(onAlwaysAllow).toHaveBeenCalledTimes(1);
  });

  it('sem onActivateAutoMode, o botão "Modo automático" não aparece (RN-153 — sem papel maintainer)', () => {
    render(
      <ApprovalCard action={makeAction()} onApprove={vi.fn()} onDeny={vi.fn()} onAlwaysAllow={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Modo automático' })).toBeNull();
  });

  it('com onActivateAutoMode, chama ao clicar em "Modo automático"', () => {
    const onActivateAutoMode = vi.fn();
    render(
      <ApprovalCard
        action={makeAction()}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
        onActivateAutoMode={onActivateAutoMode}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Modo automático' }));
    expect(onActivateAutoMode).toHaveBeenCalledTimes(1);
  });

  it('mostra a nota do "Modo automático" na variante chat, citando os tetos que continuam pedindo decisão', () => {
    render(
      <ApprovalCard
        action={makeAction()}
        variant="chat"
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
        onActivateAutoMode={vi.fn()}
      />,
    );
    expect(screen.getByText(/libera TODA ação futura/)).toBeInTheDocument();
    expect(screen.getByText(/paralelismo/)).toBeInTheDocument();
  });

  it('mostra a nota de permissions.json na variante chat', () => {
    render(<ApprovalCard action={makeAction()} variant="chat" onApprove={vi.fn()} onDeny={vi.fn()} onAlwaysAllow={vi.fn()} />);
    expect(screen.getByText(/permissions\.json/)).toBeInTheDocument();
  });

  it('esconde os botões e mostra o estado decidido quando negado', () => {
    render(
      <ApprovalCard
        action={makeAction({ status: 'denied', rejectionReason: 'comando destrutivo' })}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument();
    expect(screen.getByText(/Negado/)).toBeInTheDocument();
    expect(screen.getByText(/comando destrutivo/)).toBeInTheDocument();
  });

  it('mostra "sempre permitido" quando auto_approved com política auto_approve', () => {
    render(
      <ApprovalCard
        action={makeAction({ status: 'auto_approved', resolvedPolicy: 'auto_approve' })}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
      />,
    );

    expect(screen.getByText(/Sempre permitido/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument();
  });

  it('mostra "Aprovado · comando em execução" para ação terminal aprovada', () => {
    render(
      <ApprovalCard action={makeAction({ status: 'approved' })} onApprove={vi.fn()} onDeny={vi.fn()} onAlwaysAllow={vi.fn()} />,
    );
    expect(screen.getByText('Aprovado · comando em execução')).toBeInTheDocument();
  });

  it('renderiza o comando da ação terminal', () => {
    render(<ApprovalCard action={makeAction()} onApprove={vi.fn()} onDeny={vi.fn()} onAlwaysAllow={vi.fn()} />);
    // Duas ocorrências desde a FASE 19, e as duas ganham o lugar delas: a FRASE
    // (resumo, visível sempre — inclusive na fila, onde o detalhe nasce
    // fechado) e a linha `$ comando` do corpo, que é o comando INTEIRO.
    expect(screen.getAllByText(/rm -rf \/tmp\/build/).length).toBeGreaterThan(0);
  });

  it('permite seleção em lote quando selectable', () => {
    const onToggleSelect = vi.fn();
    render(
      <ApprovalCard
        action={makeAction()}
        variant="queue"
        selectable
        selected={false}
        onToggleSelect={onToggleSelect}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
  });

  describe('instruction_patch (Fase 4b)', () => {
    function patchAction(payload: Record<string, unknown> = {}) {
      return makeAction({
        actionType: 'instruction_patch',
        payload: {
          agent: 'dev-api',
          fromVersion: 2,
          rationale: 'usuário é sênior em NestJS',
          hypothesisId: '01JEVHYP000000000000A1B2C3',
          files: [
            {
              path: 'dev-api.md',
              additions: 1,
              deletions: 1,
              lines: [
                { kind: 'del', lineNo: 2, content: 'Explique cada conceito.' },
                { kind: 'add', lineNo: 2, content: 'Assuma familiaridade.' },
              ],
            },
          ],
          ...payload,
        },
      });
    }

    it('não oferece "Sempre permitir" — a permissão seria inerte', () => {
      // O teto do decide.ts força require_approval sempre, então gravar a
      // regra em permissions.json não mudaria nada: o botão prometia efeito.
      render(
        <ApprovalCard
          action={patchAction()}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
          onAlwaysAllow={vi.fn()}
        />,
      );

      expect(screen.getByRole('button', { name: 'Aprovar' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Sempre permitir' })).toBeNull();
    });

    it('mostra o badge da hipótese de origem (rastreabilidade do loop)', () => {
      render(
        <ApprovalCard
          action={patchAction()}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
          onAlwaysAllow={vi.fn()}
        />,
      );

      expect(screen.getByText(/origem: hipótese/)).toBeTruthy();
      expect(screen.getByText(/A1B2C3/)).toBeTruthy();
    });

    it('sem hipótese de origem, o badge não aparece', () => {
      render(
        <ApprovalCard
          action={patchAction({ hypothesisId: null })}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
          onAlwaysAllow={vi.fn()}
        />,
      );

      expect(screen.queryByText(/origem: hipótese/)).toBeNull();
    });

    it('mostra a transição de versão e o diff', () => {
      render(
        <ApprovalCard
          action={patchAction()}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
          onAlwaysAllow={vi.fn()}
        />,
      );

      expect(screen.getByText('v2 → v3')).toBeTruthy();
      expect(screen.getByText('Explique cada conceito.')).toBeTruthy();
      expect(screen.getByText('Assuma familiaridade.')).toBeTruthy();
    });

    it('renderiza TODOS os arquivos do patch, não só o primeiro', () => {
      render(
        <ApprovalCard
          action={patchAction({
            files: [
              {
                path: 'dev-api.md',
                additions: 1,
                deletions: 0,
                lines: [{ kind: 'add', lineNo: 1, content: 'primeiro arquivo' }],
              },
              {
                path: 'po.md',
                additions: 1,
                deletions: 0,
                lines: [{ kind: 'add', lineNo: 1, content: 'segundo arquivo' }],
              },
            ],
          })}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
          onAlwaysAllow={vi.fn()}
        />,
      );

      expect(screen.getByText('primeiro arquivo')).toBeTruthy();
      expect(screen.getByText('segundo arquivo')).toBeTruthy();
      expect(screen.getByText('po.md')).toBeTruthy();
    });
  });

  /**
   * A regressão que isto existe para pegar: a união `ActionType` do web era um
   * subconjunto da do backend, e `ACTION_ICON[actionType]` devolvia `undefined`
   * para o resto — o que o React trata como componente inválido e derruba a
   * árvore inteira, não só o card.
   *
   * Como o bootstrap de Gitflow propõe `git_repo_create`, `git_branch_create` e
   * `git_branch_protect`, a tela da sessão de TODO projeto criado num provider
   * ficava impossível de abrir. Projeto ADOTADO não passa por bootstrap, e era
   * por isso que a execução anterior nunca tinha esbarrado nisso.
   */
  describe('todo tipo de ação do backend', () => {
    it.each(TODOS_OS_TIPOS)('renderiza %s sem derrubar a tela', (actionType) => {
      render(
        <ApprovalCard
          action={makeAction({ actionType })}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
          onAlwaysAllow={vi.fn()}
        />,
      );

      // Um card de verdade, não uma casca: o botão só existe se o corpo
      // inteiro renderizou.
      expect(screen.getByRole('button', { name: 'Aprovar' })).toBeTruthy();
    });
  });

  /**
   * FASE 19 (RN-096) — o card diz o que vai acontecer, e o payload cru não é
   * despejado.
   *
   * O defeito que isto tranca: `Object.entries(payload).map(...)` com
   * `JSON.stringify` no valor, SEMPRE visível, para todo tipo sem corpo visual
   * próprio. Reintroduzir aquele bloco faz os dois primeiros testes daqui
   * morrerem — foi assim que eles foram verificados.
   */
  describe('frase e colapso', () => {
    // Um tipo SEM corpo visual próprio — os que caíam no despejo. `atual` e
    // `proposto` são números: o `String(value)` do bloco antigo os escrevia na
    // tela sem uma palavra dizendo o que eram.
    const acaoDeTeto = () =>
      makeAction({
        actionType: 'raise_max_parallel',
        payload: { area: 'dev', atual: 2, proposto: 4, rationale: 'três autorizações seguidas' },
      });

    it('mostra a FRASE do que vai acontecer, não as chaves do payload', () => {
      render(
        <ApprovalCard action={acaoDeTeto()} variant="queue" onApprove={vi.fn()} onDeny={vi.fn()} onAlwaysAllow={vi.fn()} />,
      );

      expect(screen.getByText(/Sobe o teto de agentes em paralelo da área dev de 2 para 4/)).toBeTruthy();
      // O despejo antigo escrevia isto na tela, sem pedir: chave, dois-pontos e
      // o valor.
      expect(screen.queryByText(/rationale:/)).toBeNull();
      expect(screen.queryByText(/^proposto: 4$/)).toBeNull();
    });

    it('o payload cru nasce COLAPSADO — em qualquer variante', () => {
      for (const variant of ['chat', 'queue'] as const) {
        const { unmount } = render(
          <ApprovalCard action={acaoDeTeto()} variant={variant} onApprove={vi.fn()} onDeny={vi.fn()} onAlwaysAllow={vi.fn()} />,
        );

        const cabecalho = screen.getByRole('button', { name: /Payload cru/ });
        expect(cabecalho.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByText(/três autorizações seguidas/)).toBeNull();
        unmount();
      }
    });

    /*
     * Aberto, o payload é JSON INDENTADO — não `chave: JSON.stringify(valor)`,
     * uma linha por chave, que era o formato do despejo. A diferença importa
     * mesmo dentro do colapso: com valor aninhado, o despejo achatava o objeto
     * inteiro numa linha só (`remote: {"name":"origin","url":"…"}`) e o motivo
     * de abrir o detalhe — LER o payload — não se cumpria.
     *
     * É esta asserção que mata o mutante. Sem ela, reintroduzir o bloco antigo
     * dentro do `Disclosure` passa em tudo: colapsado, o texto some da tela de
     * qualquer jeito.
     */
    it('abrir o colapso revela o payload como JSON legível, não como despejo', () => {
      render(
        <ApprovalCard action={acaoDeTeto()} variant="queue" onApprove={vi.fn()} onDeny={vi.fn()} onAlwaysAllow={vi.fn()} />,
      );

      fireEvent.click(screen.getByRole('button', { name: /Payload cru/ }));

      const bloco = screen.getByText(/três autorizações seguidas/);
      expect(bloco.textContent).toContain('"area": "dev"');
      expect(bloco.textContent).toContain('"proposto": 4');
    });

    /*
     * O default do colapso é DERIVADO de `variant` + `status` (item 14 da
     * fase): nenhuma prop nova, e por isso nenhum call site precisou mudar.
     */
    it('detalhe rico nasce ABERTO no chat enquanto a ação está pendente', () => {
      render(<ApprovalCard action={makeAction()} variant="chat" onApprove={vi.fn()} onDeny={vi.fn()} onAlwaysAllow={vi.fn()} />);
      expect(screen.getByRole('button', { name: /Detalhes/ }).getAttribute('aria-expanded')).toBe('true');
    });

    it('e nasce FECHADO na fila, onde são N cards de uma vez', () => {
      render(<ApprovalCard action={makeAction()} variant="queue" onApprove={vi.fn()} onDeny={vi.fn()} onAlwaysAllow={vi.fn()} />);
      expect(screen.getByRole('button', { name: /Detalhes/ }).getAttribute('aria-expanded')).toBe('false');
    });

    it('no chat, ação já decidida também nasce fechada — não espera mais nada', () => {
      render(
        <ApprovalCard
          action={makeAction({ status: 'executed' })}
          variant="chat"
          onApprove={vi.fn()}
          onDeny={vi.fn()}
          onAlwaysAllow={vi.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: /Detalhes/ }).getAttribute('aria-expanded')).toBe('false');
    });

    /*
     * O caminho do tipo que o web ainda não conhece — real, não teórico: a
     * união do web já ficou defasada duas vezes. Antes o `ACTION_ICON`
     * devolvia `undefined` e o React derrubava a ÁRVORE inteira.
     */
    /*
     * `write_file` ganhou corpo próprio: antes caía no fallback genérico
     * (JSON cru colapsado), então um write que genuinamente pedia aprovação
     * exigia um clique extra para ver o que seria escrito.
     */
    it('write_file pendente no chat mostra path + preview do conteúdo, ABERTO por padrão', () => {
      render(
        <ApprovalCard
          action={makeAction({
            actionType: 'write_file',
            payload: { path: 'apps/api/src/foo.ts', content: 'export const foo = 1;\n' },
          })}
          variant="chat"
          onApprove={vi.fn()}
          onDeny={vi.fn()}
          onAlwaysAllow={vi.fn()}
        />,
      );

      const cabecalho = screen.getByRole('button', { name: /Detalhes/ });
      expect(cabecalho.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByText('apps/api/src/foo.ts')).toBeTruthy();
      expect(screen.getByText(/export const foo = 1;/)).toBeTruthy();
      // Nem o payload cru genérico nem o rótulo dele aparecem — write_file
      // tem corpo próprio agora, não cai mais no fallback.
      expect(screen.queryByRole('button', { name: /Payload cru/ })).toBeNull();
    });

    it('write_file com conteúdo grande trunca o preview e avisa quantas linhas', () => {
      const linhas = Array.from({ length: 40 }, (_, i) => `linha ${i + 1}`);
      render(
        <ApprovalCard
          action={makeAction({
            actionType: 'write_file',
            payload: { path: 'apps/api/src/big.ts', content: linhas.join('\n') },
          })}
          variant="chat"
          onApprove={vi.fn()}
          onDeny={vi.fn()}
          onAlwaysAllow={vi.fn()}
        />,
      );

      // O bloco de preview é um texto só (uma linha por `\n`) — a asserção lê
      // o `textContent` bruto porque o normalizador padrão do RTL colapsaria
      // as quebras de linha e esconderia o corte.
      const preview = screen.getByText(/linha 1 linha 2/);
      expect(preview.textContent).toContain('linha 1');
      expect(preview.textContent).toContain('linha 25');
      expect(preview.textContent).not.toContain('linha 40');
      expect(screen.getByText(/25 de 40 linha\(s\)/)).toBeTruthy();
    });

    it('write_file com content vazio mostra a mensagem de fallback, não um preview em branco', () => {
      render(
        <ApprovalCard
          action={makeAction({
            actionType: 'write_file',
            payload: { path: 'apps/api/src/foo.ts', content: '' },
          })}
          variant="chat"
          onApprove={vi.fn()}
          onDeny={vi.fn()}
          onAlwaysAllow={vi.fn()}
        />,
      );

      expect(screen.getByText(/O modelo não produziu um conteúdo válido para esta ação\./)).toBeTruthy();
    });

    it('write_file sem path e sem content mostra a mensagem combinada', () => {
      render(
        <ApprovalCard
          action={makeAction({ actionType: 'write_file', payload: {} })}
          variant="chat"
          onApprove={vi.fn()}
          onDeny={vi.fn()}
          onAlwaysAllow={vi.fn()}
        />,
      );

      expect(screen.getByText(/O modelo não produziu um caminho e um conteúdo válidos para esta ação\./)).toBeTruthy();
    });

    it('terminal com command vazio mostra a mensagem de fallback, não "$ " em branco', () => {
      render(
        <ApprovalCard
          action={makeAction({ actionType: 'terminal', payload: { command: '' } })}
          variant="chat"
          onApprove={vi.fn()}
          onDeny={vi.fn()}
          onAlwaysAllow={vi.fn()}
        />,
      );

      expect(screen.getByText(/O modelo não produziu um comando válido para esta ação\./)).toBeTruthy();
      expect(screen.queryByText('$')).toBeNull();
    });

    it('tipo desconhecido: verbo neutro + "ver detalhes", sem derrubar a tela', () => {
      render(
        <ApprovalCard
          // O cast é o ponto do teste: representa o tipo que o BACKEND já
          // propõe e a união do web ainda não conhece. Sem ele não dá para
          // exercitar o caminho — o compilador impediria justamente o cenário
          // que aconteceu duas vezes em produção.
          action={makeAction({ actionType: 'deploy_producao' as ActionType, payload: { host: 'prod-1' } })}
          variant="queue"
          onApprove={vi.fn()}
          onDeny={vi.fn()}
          onAlwaysAllow={vi.fn()}
        />,
      );

      expect(screen.getByText(/propõe uma ação — ver detalhes\./)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Aprovar' })).toBeTruthy();
      expect(screen.queryByText(/prod-1/)).toBeNull();
    });
  });

  /**
   * A faixa por arquivo (`git_commit`/`git_push`) NÃO migrou para o
   * `Disclosure` do design system (Onda 4/frente H4) — ela gira o chevron
   * com `transform: rotate(90deg)`, e o `Disclosure` genérico troca de ícone
   * sem animação. O defeito real que valia corrigir era outro: faltava
   * `aria-controls` apontando para uma região que existe mesmo fechada —
   * exatamente o que o `Disclosure` sempre garantiu para os colapsos que já
   * o usam (RN-250).
   */
  describe('faixa de arquivo do diff (git_commit/git_push)', () => {
    function acaoComArquivos() {
      return makeAction({
        actionType: 'git_commit',
        payload: {
          files: [
            { path: 'apps/api/src/a.ts', additions: 2, deletions: 0, lines: [{ kind: 'add', content: 'x', lineNo: 1 }] },
            { path: 'apps/api/src/b.ts', additions: 0, deletions: 1, lines: [{ kind: 'del', content: 'y', lineNo: 3 }] },
          ],
        },
      });
    }

    it('nasce fechada, com aria-controls apontando pra uma região que existe mesmo escondida', () => {
      render(
        <ApprovalCard action={acaoComArquivos()} variant="chat" onApprove={vi.fn()} onDeny={vi.fn()} onAlwaysAllow={vi.fn()} />,
      );

      const faixaA = screen.getByRole('button', { name: /a\.ts/ });
      expect(faixaA.getAttribute('aria-expanded')).toBe('false');
      const idRegiao = faixaA.getAttribute('aria-controls');
      expect(idRegiao).toBeTruthy();
      const regiao = document.getElementById(idRegiao!);
      expect(regiao).not.toBeNull();
      expect(regiao).toHaveAttribute('role', 'region');
      expect(regiao).not.toBeVisible();
    });

    it('clicar abre o diff daquele arquivo, e abrir outro fecha o anterior (exclusivo)', () => {
      render(
        <ApprovalCard action={acaoComArquivos()} variant="chat" onApprove={vi.fn()} onDeny={vi.fn()} onAlwaysAllow={vi.fn()} />,
      );

      const faixaA = screen.getByRole('button', { name: /a\.ts/ });
      const faixaB = screen.getByRole('button', { name: /b\.ts/ });

      fireEvent.click(faixaA);
      expect(faixaA.getAttribute('aria-expanded')).toBe('true');
      expect(faixaB.getAttribute('aria-expanded')).toBe('false');

      fireEvent.click(faixaB);
      expect(faixaA.getAttribute('aria-expanded')).toBe('false');
      expect(faixaB.getAttribute('aria-expanded')).toBe('true');
    });
  });
});
