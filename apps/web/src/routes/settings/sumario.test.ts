import { describe, expect, it } from 'vitest';
import {
  GRUPOS_DO_SUMARIO,
  SECOES_DE_CONFIGURACOES,
  chaveDoId,
  idDaSecao,
  ordemDaSecao,
  resolverChaveDeSecao,
} from './sumario';

/**
 * O registro sozinho — o que ele promete antes de qualquer tela existir.
 *
 * O acordo entre o registro e o JSX do barrel (as 17 seções, montadas, com
 * âncora) é o que `SumarioDeConfiguracoes.test.tsx` verifica; aqui ficam as
 * propriedades que não precisam de DOM.
 */
describe('registro de seções de Configurações', () => {
  it('não tem chave repetida — `id` é espaço global do documento', () => {
    const chaves = SECOES_DE_CONFIGURACOES.map((s) => s.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it('os quatro grupos caem CONTÍGUOS sobre a ordem de render', () => {
    // O agrupamento é uma LEITURA da ordem que o barrel já tinha, não uma
    // reorganização da aba. Se um grupo passasse a aparecer em dois trechos
    // separados, alguém teria reordenado seção — e o sumário passaria a
    // sugerir uma sequência de leitura que a página não tem.
    const grupos = SECOES_DE_CONFIGURACOES.map((s) => s.grupo);
    const trechos = grupos.filter((g, i) => g !== grupos[i - 1]);
    expect(trechos).toEqual([...GRUPOS_DO_SUMARIO]);
  });

  it('`ordemDaSecao` devolve a posição na ordem de render', () => {
    expect(ordemDaSecao('repository')).toBe(0);
    expect(ordemDaSecao('key-spend')).toBe(SECOES_DE_CONFIGURACOES.length - 1);
  });

  it('`chaveDoId` é a volta de `idDaSecao`', () => {
    for (const secao of SECOES_DE_CONFIGURACOES) {
      expect(chaveDoId(idDaSecao(secao.chave))).toBe(secao.chave);
    }
  });

  it('chave desconhecida na URL vira `undefined`, não um alvo que nunca existe', () => {
    expect(resolverChaveDeSecao('budget')).toBe('budget');
    expect(resolverChaveDeSecao('secao-budget')).toBeUndefined();
    expect(resolverChaveDeSecao('inexistente')).toBeUndefined();
    expect(resolverChaveDeSecao(undefined)).toBeUndefined();
    expect(resolverChaveDeSecao(7)).toBeUndefined();
  });

  it('id de seção não colide com id cru de conteúdo', () => {
    // `event-…` (SessionPage) e `secao-…` são os dois prefixos de `id` que o
    // app crava hoje; a colisão que o prefixo evita é com um `id` curto que
    // uma seção venha a usar por dentro (`members`, `budget`).
    for (const secao of SECOES_DE_CONFIGURACOES) {
      expect(idDaSecao(secao.chave).startsWith('secao-')).toBe(true);
    }
  });
});
