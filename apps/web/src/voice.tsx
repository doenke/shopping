import { useEffect, useRef, useState } from 'react';

/** The bits of the Web Speech API used here (not in TypeScript's DOM types everywhere). */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function speechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface Voice {
  supported: boolean;
  listening: boolean;
  toggle: () => void;
}

/**
 * Voice input (Chrome/Android, Safari; not Firefox): what is said goes to onText while speaking (the field
 * shows it), Enter or a tap adds it. onStart clears the field.
 */
export function useVoice(onText: (said: string) => void, onStart?: () => void): Voice {
  const [listening, setListening] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const Recognition = speechRecognition();
  useEffect(() => () => recognition.current?.abort(), []);
  const toggle = () => {
    if (listening) return recognition.current?.stop();
    if (!Recognition) return;
    const r = new Recognition();
    r.lang = 'de-DE';
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => onText(Array.from({ length: e.results.length }, (_, i) => e.results[i]![0]!.transcript).join(' '));
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recognition.current = r;
    onStart?.();
    setListening(true);
    r.start();
  };
  return { supported: !!Recognition, listening, toggle };
}

/** 🎤 – nothing where the browser cannot listen. */
export function MicButton({ voice, className }: { voice: Voice; className: string }) {
  if (!voice.supported) return null;
  return (
    <button
      type="button"
      className={`${className}${voice.listening ? ` ${className}--on` : ''}`}
      aria-label={voice.listening ? 'Zuhören beenden' : 'Sprechen'}
      aria-pressed={voice.listening}
      onClick={voice.toggle}
    >
      🎤
    </button>
  );
}
