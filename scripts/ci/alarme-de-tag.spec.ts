import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { montarAlarme, textoDeFechamento, tituloDoAlarme } from './alarme-de-tag.ts';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const falha = {
  branch: 'qa',
  sha: 'fdcc6093fb46700198ed00ee64bcd830b5399905',
  urlDoRun: 'https://github.com/daneiel/brabo/actions/runs/32798660541',
};

describe('tituloDoAlarme', () => {
  // O título é a CHAVE de deduplicação do workflow: é por ele que a segunda
  // falha na mesma branch vira comentário em vez de issue nova. Se este
  // formato mudar sem a busca do workflow mudar junto, cada falha abre uma
  // issue — e issue repetida é a forma mais rápida de ensinar a ignorar.
  it('é estável e nomeia a branch', () => {
    expect(tituloDoAlarme('qa')).toBe('[tag-release] o carimbo falhou em `qa`');
    expect(tituloDoAlarme('dev')).toBe('[tag-release] o carimbo falhou em `dev`');
  });

  it('separa por branch — uma issue por permanente, não uma global', () => {
    expect(tituloDoAlarme('qa')).not.toBe(tituloDoAlarme('main'));
  });
});

describe('montarAlarme', () => {
  it('usa o mesmo título da chave de deduplicação', () => {
    expect(montarAlarme(falha).titulo).toBe(tituloDoAlarme('qa'));
  });

  it('leva o run, o commit e o sha curto — sem eles não há por onde começar', () => {
    const { corpo } = montarAlarme(falha);
    expect(corpo).toContain(falha.urlDoRun);
    expect(corpo).toContain(falha.sha);
    expect(corpo).toContain('fdcc6093');
  });

  it('diz o conserto, não só o diagnóstico', () => {
    const { corpo } = montarAlarme(falha);
    expect(corpo).toContain('Create a merge commit');
    expect(corpo).toContain('git merge -s ours');
  });

  it('avisa que o PR do conserto também não pode ser squash', () => {
    // Este é o erro que já aconteceu: a #464 consertava a ancestralidade e foi
    // squashada, o que apagou exatamente a correção que ela carregava.
    expect(montarAlarme(falha).corpo).toContain('a correção *é* o segundo parent');
  });

  it('nomeia o token expirado como causa alternativa', () => {
    // Sem isto, quem abrisse a issue com o checkout quebrado procuraria squash
    // por horas — o sintoma é o mesmo (nada carimbado), a causa é outra.
    expect(montarAlarme(falha).corpo).toContain('BRABO_BOT_TOKEN');
  });
});

// AT-664: o desfecho do `carimbar` decide o que acontece com a issue, num bash
// de verdade com um `gh` de mentira que registra as chamadas.
describe('alarmar_tag', () => {
  let area: string;
  const GH_FALSO = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$GH_LOG"
case "$1 $2" in
  "issue list") [ -n "\${ISSUE_ABERTA:-}" ] && printf '%s\\n' "$ISSUE_ABERTA" ;;
  "issue create") echo "https://github.com/x/y/issues/99" ;;
esac
exit 0
`;
  beforeEach(() => {
    area = mkdtempSync(path.join(tmpdir(), 'brabo-alarme-tag-'));
    writeFileSync(path.join(area, 'gh'), GH_FALSO);
    chmodSync(path.join(area, 'gh'), 0o755);
    writeFileSync(path.join(area, 'corpo.md'), 'corpo');
    writeFileSync(path.join(area, 'fechamento.md'), textoDeFechamento(falha));
  });
  afterEach(() => rmSync(area, { recursive: true, force: true }));

  function rodar(desfecho: string, aberta = ''): string[] {
    execFileSync(
      'bash',
      ['--norc', '--noprofile', '-euo', 'pipefail', '-c', 'source "$ALVO"\nalarmar_tag "$DESFECHO"'],
      {
        encoding: 'utf8',
        env: {
          PATH: `${area}:${process.env.PATH}`,
          ALVO: path.join(RAIZ, 'scripts/ci/alarmar-tag.sh'),
          DESFECHO: desfecho,
          GH_LOG: path.join(area, 'gh.log'),
          ISSUE_ABERTA: aberta,
          TITULO: tituloDoAlarme('qa'),
          CORPO: path.join(area, 'corpo.md'),
          FECHAMENTO: path.join(area, 'fechamento.md'),
        },
      },
    );
    const log = path.join(area, 'gh.log');
    return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  }

  it('falha sem issue aberta abre uma', () => {
    expect(rodar('failure').some((l) => l.startsWith('issue create'))).toBe(true);
  });

  it('falha com issue aberta comenta, nunca abre outra', () => {
    const c = rodar('failure', '7');
    expect(c.some((l) => l.startsWith('issue comment 7'))).toBe(true);
    expect(c.some((l) => l.startsWith('issue create'))).toBe(false);
  });

  it('verde fecha a aberta citando run e SHA', () => {
    const fecha = rodar('success', '7').find((l) => l.startsWith('issue close 7'));
    expect(fecha).toContain(falha.urlDoRun);
    expect(fecha).toContain(falha.sha);
  });

  it('verde sem issue aberta não faz nada; cancelado também não', () => {
    expect(rodar('success').some((l) => /issue (close|create|comment)/.test(l))).toBe(false);
    expect(rodar('cancelled', '7').some((l) => /issue (close|create|comment)/.test(l))).toBe(false);
  });
});
