import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  PUBLIC_URL: z.string().url().transform((u) => u.replace(/\/$/, '')),
  /** Used to encrypt stored secrets (Mealie token) and sign the login cookie. */
  SECRET_KEY: z.string().min(16),
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_ADMIN_GROUP: z.string().default('admins'),
  /** Claim with the household tag (Pocket ID: custom claim on the user or a group). */
  OIDC_HOUSEHOLD_CLAIM: z.string().default('household'),
  /** Name of the household for users without a tag. */
  DEFAULT_HOUSEHOLD_NAME: z.string().trim().min(1).default('Haushalt'),
  /** Text of the login button, e.g. "Mit Firmenkonto anmelden". */
  OIDC_LOGIN_LABEL: z.string().trim().min(1).max(60).default('Mit Pocket ID anmelden'),
  /** Local development only: allows logging in with just a name, without OIDC. */
  DEV_LOGIN: bool,
  WEB_DIST: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Ungültige Konfiguration:\n${issues}`);
  }
  const config = parsed.data;
  if (!config.DEV_LOGIN && !(config.OIDC_ISSUER && config.OIDC_CLIENT_ID)) {
    throw new Error('OIDC_ISSUER und OIDC_CLIENT_ID müssen gesetzt sein (oder DEV_LOGIN=true für die lokale Entwicklung).');
  }
  return config;
}
