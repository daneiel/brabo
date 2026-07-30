import { describe, it, expect, vi, afterEach } from 'vitest';
import { childSpan, logger, newTraceContext } from './logger';

/**
 * O contrato de nomes do log da web (ADR 0035).
 *
 * `trace_id` com underscore é o mesmo campo da api e do engine, e o que o
 * `derivedFields` do Loki procura. Divergir AQUI é o pior dos três lugares para
 * divergir: quebraria só a correlação da web, que é justamente onde ninguém
 * olharia — a web não manda log para o Loki, o `trace_id` do browser serve para
 * um humano casar a linha do console com o span de servidor.
 *
 * O formato do `traceparent` também é contrato, e com a api do outro lado: um id
 * de 31 caracteres, ou a flag de amostragem errada, e o header é silenciosamente
 * descartado pelo propagador W3C — sem erro, sem trace.
 */
describe('logger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('newTraceContext', () => {
    it('gera traceId de 32 hex e spanId de 16 hex', () => {
      const ctx = newTraceContext();
      expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
    });

    it('monta o traceparent W3C com a flag de amostrado', () => {
      const ctx = newTraceContext();
      expect(ctx.traceparent).toBe(`00-${ctx.traceId}-${ctx.spanId}-01`);
      expect(ctx.traceparent).toMatch(
        /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/,
      );
    });

    it('gera ids diferentes a cada chamada', () => {
      expect(newTraceContext().traceId).not.toBe(newTraceContext().traceId);
    });
  });

  describe('childSpan', () => {
    it('mantém a trace e troca a span', () => {
      // É o que faz a retentativa depois do 401 aparecer como um segundo nó no
      // Tempo, em vez de colidir com a primeira tentativa.
      const pai = newTraceContext();
      const filha = childSpan(pai);

      expect(filha.traceId).toBe(pai.traceId);
      expect(filha.spanId).not.toBe(pai.spanId);
      expect(filha.traceparent).toBe(
        `00-${pai.traceId}-${filha.spanId}-01`,
      );
    });
  });

  describe('a linha emitida', () => {
    it('é JSON com trace_id (underscore) e o serviço', () => {
      const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      logger.errorWithTrace('falhou', 'abc123', { status: 500 });

      const linha = JSON.parse(erro.mock.calls[0][0] as string) as Record<
        string,
        unknown
      >;
      expect(linha.trace_id).toBe('abc123');
      expect('traceId' in linha).toBe(false);
      expect(linha.service).toBe('brabo-web');
      expect(linha.level).toBe('error');
      expect(linha.message).toBe('falhou');
      expect(linha.status).toBe(500);
      expect(typeof linha.time).toBe('string');
    });

    it('vai para o console certo por nível', () => {
      const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const info = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      logger.warn('atenção');
      logger.info('nota');

      expect(aviso).toHaveBeenCalledTimes(1);
      expect(info).toHaveBeenCalledTimes(1);
    });

    it('respeita o nível mínimo — debug não sai com logLevel info', () => {
      // `runtimeConfig.logLevel` é `info` por default (e no k8s ficava preso
      // nisso até o ADR 0035 ligar WEB_LOG_LEVEL).
      const info = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      logger.debug('detalhe');
      expect(info).not.toHaveBeenCalled();
    });
  });
});
