import { describe, expect, it } from 'vitest';
import { montarAlarme, tituloDoAlarme } from './alarme-de-tag.ts';

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
