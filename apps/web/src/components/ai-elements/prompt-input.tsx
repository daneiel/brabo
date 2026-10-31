import { useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/shadcn/input-group';

type Props = {
  onEnviar: (texto: string) => void;
  placeholder?: string;
  /** Rótulo acessível e texto do botão de envio. */
  rotuloEnviar: string;
  desabilitado?: boolean;
};

/** Padrão Prompt Input sem anexos: Enter envia, Shift+Enter quebra linha; vazio não envia. */
export function CampoDePrompt({ onEnviar, placeholder, rotuloEnviar, desabilitado }: Props) {
  const [texto, setTexto] = useState('');
  const enviar = () => {
    const t = texto.trim();
    if (!t || desabilitado) return;
    onEnviar(t);
    setTexto('');
  };
  const aoSubmeter = (e: FormEvent) => {
    e.preventDefault();
    enviar();
  };
  const aoTeclar = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      enviar();
    }
  };
  return (
    <form onSubmit={aoSubmeter}>
      <InputGroup>
        <InputGroupTextarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={aoTeclar}
          placeholder={placeholder}
          disabled={desabilitado}
          aria-label={placeholder ?? rotuloEnviar}
        />
        <InputGroupAddon align="block-end">
          <InputGroupButton
            type="submit"
            variant="default"
            className="ml-auto"
            disabled={desabilitado || texto.trim() === ''}
          >
            {rotuloEnviar}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
