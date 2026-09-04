import { describe, expect, it } from 'vitest';
import {
  nomeDoContainer,
  PONTO_DE_MONTAGEM,
  RaizDeProjetoInvalidaError,
  raizDeProjetoValidada,
} from './docker-port.ts';

/**
 * O que se testa aqui é a metade da porta que NÃO é interface: a marca de
 * `RaizDeProjeto`. As outras três contenções da `DockerPort` — sem
 * `privileged`, sem `cap_add`, sem `network: host` — são impossíveis de
 * escrever e por isso impossíveis de testar em runtime: quem as reprova é o
 * `tsc` do CI, não o vitest. Um teste que "provasse" isso teria que forçar um
 * `as any` primeiro, ou seja, provaria o contrário.
 */
describe('raizDeProjetoValidada', () => {
  it('aceita um caminho absoluto de projeto e devolve normalizado', () => {
    expect(raizDeProjetoValidada('/home/alguem/dev/exp002')).toBe('/home/alguem/dev/exp002');
  });

  it('normaliza barras repetidas e a barra final', () => {
    expect(raizDeProjetoValidada('/home/alguem//dev/exp002/')).toBe('/home/alguem/dev/exp002');
  });

  it.each([
    ['relativo', 'dev/exp002', 'não é absoluto'],
    ['vazio', '', 'vazio'],
    ['com travessia', '/home/alguem/../../etc', 'contém `..`'],
    ['com NUL', '/home/alguem\0/dev', 'NUL'],
    ['a raiz do filesystem', '/', 'raiz do filesystem'],
    ['o socket do docker', '/var/run/docker.sock', 'pasta de sistema'],
    ['/etc', '/etc', 'pasta de sistema'],
  ])('recusa %s com motivo nomeado', (_rotulo, caminho, trechoDoMotivo) => {
    expect(() => raizDeProjetoValidada(caminho)).toThrowError(RaizDeProjetoInvalidaError);
    try {
      raizDeProjetoValidada(caminho);
    } catch (erro) {
      const recusa = erro as RaizDeProjetoInvalidaError;
      expect(recusa.motivo).toContain(trechoDoMotivo);
      // A origem entra no vocabulário do produto (infra | modelo | código |
      // política) em vez de ficar implícita na mensagem.
      expect(recusa.origem).toBe('codigo');
    }
  });

  it('recusa a travessia ANTES de normalizar — `resolve` a apagaria em silêncio', () => {
    // `/home/alguem/dev/../dev/exp002` resolve para um caminho perfeitamente
    // válido. Aceitá-lo esconderia que a spec foi COMPOSTA com travessia
    // dentro, que é o sinal que interessa.
    expect(() => raizDeProjetoValidada('/home/alguem/dev/../dev/exp002')).toThrowError(
      RaizDeProjetoInvalidaError,
    );
  });
});

describe('nomeDoContainer', () => {
  it('deriva do workspace_dir_name, e só dele (RN-109)', () => {
    expect(nomeDoContainer('exp002-f52be111')).toBe('brabo-exp002-f52be111');
  });
});

describe('constantes da porta', () => {
  it('o ponto de montagem é constante — não há como escolher o destino', () => {
    expect(PONTO_DE_MONTAGEM).toBe('/work');
  });
});
