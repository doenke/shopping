import { KEY_COLOR_HEX } from './image.js';

/** Style sentence from docs/konzept/11-icon-designrichtlinie.md; editable in the settings while finding the style. */
export const DEFAULT_STYLE =
  'Soft flat vector-style illustration, no outlines, 2-4 tonal shades per color, soft light from top-left, ' +
  'small soft highlight, natural slightly desaturated colors, rounded friendly shapes, simple silhouette readable at 32 px.';

export interface PromptInput {
  subject: string;
  style: string;
  background: 'key' | 'transparent';
  withReferences: boolean;
  /** Extra wish from the review, e.g. "only one carrot". */
  hint?: string | null;
}

export function buildPrompt({ subject, style, background, withReferences, hint }: PromptInput): string {
  const bg =
    background === 'key'
      ? `Centered on a solid flat pure magenta (${KEY_COLOR_HEX}) background with generous empty margin, nothing touches the edges.`
      : 'Centered on a fully transparent background with generous empty margin, nothing touches the edges.';
  return [
    `Icon of ${subject.replace(/\.$/, '')}.`,
    hint ? `${hint.replace(/\.$/, '')}.` : null,
    style,
    bg,
    'No text, no letters, no logos, no labels, no shadow on the ground, no frame, no plate, no hands, no background scene.',
    withReferences ? 'Match the exact drawing style, lighting, color treatment and level of detail of the reference images, but draw the new subject.' : null,
  ]
    .filter(Boolean)
    .join(' ');
}
