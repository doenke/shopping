import { useState } from 'react';
import { type ProviderId, type Status, api } from './common';

export function SettingsForm({ status, open, onSaved }: { status: Status; open: boolean; onSaved: () => void }) {
  const s = status.settings;
  const [provider, setProvider] = useState(s.provider);
  const [accountId, setAccountId] = useState(s.cloudflare.accountId ?? '');
  const [cfToken, setCfToken] = useState('');
  const [cfModel, setCfModel] = useState(s.cloudflare.model);
  const [dailyLimit, setDailyLimit] = useState(String(s.cloudflare.dailyLimit));
  const [size, setSize] = useState(String(s.cloudflare.size));
  const [oaKey, setOaKey] = useState('');
  const [oaModel, setOaModel] = useState(s.openai.model);
  const [quality, setQuality] = useState(s.openai.quality);
  const [cap, setCap] = useState(String(s.openai.monthlyCap).replace('.', ','));
  const [anKey, setAnKey] = useState('');
  const [svgModel, setSvgModel] = useState(s.anthropic.svgModel);
  const [review, setReview] = useState(s.anthropic.review);
  const [categorize, setCategorize] = useState(s.anthropic.categorize ?? true);
  const [fallback, setFallback] = useState(s.anthropic.fallback ?? true);
  const [reviewModel, setReviewModel] = useState(s.anthropic.reviewModel);
  const [anCap, setAnCap] = useState(String(s.anthropic.monthlyCap).replace('.', ','));
  const [candidates, setCandidates] = useState(String(s.candidates));
  const [style, setStyle] = useState(s.style);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const save = async () => {
    setMessage(null);
    try {
      await api('/api/v1/icons/settings', {
        method: 'PUT',
        body: JSON.stringify({
          provider,
          candidates: Number(candidates),
          style,
          cloudflare: {
            accountId: accountId.trim() || null,
            ...(cfToken ? { token: cfToken } : {}),
            model: cfModel,
            dailyLimit: Number(dailyLimit) || 0,
            size: Number(size),
          },
          openai: {
            ...(oaKey ? { apiKey: oaKey } : {}),
            model: oaModel,
            quality,
            monthlyCap: Number(cap.replace(',', '.')) || 0,
          },
          anthropic: {
            ...(anKey ? { apiKey: anKey } : {}),
            svgModel,
            review,
            categorize,
            fallback,
            reviewModel,
            monthlyCap: Number(anCap.replace(',', '.')) || 0,
          },
        }),
      });
      setCfToken('');
      setOaKey('');
      setAnKey('');
      setMessage({ kind: 'ok', text: 'Gespeichert.' });
      onSaved();
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    }
  };

  return (
    <details className="card" open={open}>
      <summary>
        <h2>Bild-KI einrichten</h2>
      </summary>
      <label className="field">
        <span>Anbieter</span>
        <select value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>
          <option value="cloudflare">Cloudflare Workers AI – FLUX.2 (Gratis-Kontingent)</option>
          <option value="openai">OpenAI gpt-image (bezahlt)</option>
          <option value="claude">Claude – zeichnet SVG (bezahlt)</option>
        </select>
      </label>

      <h3>Cloudflare</h3>
      <p className="muted">
        Kostenloses Konto bei Cloudflare, dann <em>AI → Workers AI → REST API</em>: dort stehen die Account-ID und „API-Token erstellen“ (Vorlage „Workers AI“).
        Das Gratis-Kontingent reicht für rund 150 Icons am Tag.
      </p>
      <label className="field">
        <span>Account-ID</span>
        <input value={accountId} onChange={(e) => setAccountId(e.target.value)} autoComplete="off" />
      </label>
      <label className="field">
        <span>API-Token</span>
        <input
          type="password"
          value={cfToken}
          onChange={(e) => setCfToken(e.target.value)}
          placeholder={s.cloudflare.hasToken ? 'gespeichert – leer lassen zum Behalten' : ''}
          autoComplete="off"
        />
      </label>
      <div className="field__row">
        <label className="field">
          <span>Modell</span>
          <select value={cfModel} onChange={(e) => setCfModel(e.target.value)}>
            <option value="flux-2-klein-4b">FLUX.2 klein 4B (sparsam)</option>
            <option value="flux-2-klein-9b">FLUX.2 klein 9B</option>
            <option value="flux-2-dev">FLUX.2 dev (teuer)</option>
          </select>
        </label>
        <label className="field">
          <span>Bilder pro Tag</span>
          <input inputMode="numeric" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} />
        </label>
        <label className="field">
          <span>Größe</span>
          <select value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="512">512 px</option>
            <option value="768">768 px</option>
            <option value="1024">1024 px</option>
          </select>
        </label>
      </div>

      <h3>OpenAI (optional, bezahlt)</h3>
      <p className="muted">Für einzelne Artikel, die mit FLUX nicht gelingen („Mit Bezahl-Modell neu“), oder als Hauptanbieter.</p>
      <label className="field">
        <span>API-Key</span>
        <input
          type="password"
          value={oaKey}
          onChange={(e) => setOaKey(e.target.value)}
          placeholder={s.openai.hasKey ? 'gespeichert – leer lassen zum Behalten' : ''}
          autoComplete="off"
        />
      </label>
      <div className="field__row">
        <label className="field">
          <span>Modell</span>
          <select value={oaModel} onChange={(e) => setOaModel(e.target.value)}>
            <option value="gpt-image-1-mini">gpt-image-1-mini</option>
            <option value="gpt-image-1">gpt-image-1</option>
            <option value="gpt-image-1.5">gpt-image-1.5</option>
          </select>
        </label>
        <label className="field">
          <span>Qualität</span>
          <select value={quality} onChange={(e) => setQuality(e.target.value)}>
            <option value="low">niedrig</option>
            <option value="medium">mittel</option>
            <option value="high">hoch</option>
          </select>
        </label>
        <label className="field">
          <span>Höchstens € pro Monat</span>
          <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />
        </label>
      </div>

      <h3>Claude (optional, bezahlt)</h3>
      <p className="muted">
        Claude malt keine Bilder, zeichnet aber Icons als SVG (sehr einheitlicher Stil, mit Sonnet etwa 3–4 Cent pro Entwurf). Außerdem prüft Claude jeden
        Entwurf vor („erkennbar? Schrift? passt zum Stil?“, mit Haiku unter 0,1 Cent) und beschreibt Artikel aus Mealie. Key aus der Anthropic Console; Preise
        in Dollar, hier als Euro gerechnet.
      </p>
      <label className="field">
        <span>API-Key</span>
        <input
          type="password"
          value={anKey}
          onChange={(e) => setAnKey(e.target.value)}
          placeholder={s.anthropic.hasKey ? 'gespeichert – leer lassen zum Behalten' : 'sk-ant-…'}
          autoComplete="off"
        />
      </label>
      <div className="field__row field__row--wrap">
        <label className="field">
          <span>Modell für SVG-Icons</span>
          <select value={svgModel} onChange={(e) => setSvgModel(e.target.value)}>
            <option value="claude-sonnet-5-5">Sonnet 5.5 (empfohlen)</option>
            <option value="claude-opus-5-5">Opus 5.5 (beste, doppelter Preis)</option>
            <option value="claude-haiku-5-5">Haiku 5.5 (sehr günstig, einfacher)</option>
          </select>
        </label>
        <label className="field">
          <span>Modell für die Vorprüfung</span>
          <select value={reviewModel} onChange={(e) => setReviewModel(e.target.value)}>
            <option value="claude-haiku-5-5">Haiku 5.5 (empfohlen)</option>
            <option value="claude-sonnet-5-5">Sonnet 5.5 (genauer)</option>
          </select>
        </label>
        <label className="field">
          <span>Höchstens € pro Monat</span>
          <input inputMode="decimal" value={anCap} onChange={(e) => setAnCap(e.target.value)} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} />
        KI-Vorprüfung: jeden Entwurf vorab ansehen, Unbrauchbares nach hinten sortieren und einmal neu versuchen
      </label>
      <label className="check">
        <input type="checkbox" checked={categorize} onChange={(e) => setCategorize(e.target.checked)} />
        Kategorien: neue freie Einträge auf Einkaufs- und Packlisten gleich in die passende Kategorie einsortieren (Haiku, auch eigene Kategorien)
      </label>
      <label className="check">
        <input type="checkbox" checked={fallback} onChange={(e) => setFallback(e.target.checked)} />
        Claude als Ersatz: wenn FLUX (oder OpenAI) auch im zweiten Anlauf nichts Brauchbares liefert, zeichnet Claude einen Entwurf
      </label>

      <h3>Erzeugung</h3>
      <label className="field">
        <span>Entwürfe pro Artikel</span>
        <select value={candidates} onChange={(e) => setCandidates(e.target.value)}>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Stil (englisch, gilt für alle Icons – leer = Standard aus der Designrichtlinie)</span>
        <textarea rows={4} value={style} onChange={(e) => setStyle(e.target.value)} />
      </label>
      <button type="button" className="btn btn--primary" onClick={() => void save()}>
        Speichern
      </button>
      {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}
    </details>
  );
}
