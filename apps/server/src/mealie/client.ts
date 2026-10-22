/** Minimal client for the Mealie v2 API. */

export interface MealieFood {
  id: string;
  name: string;
  pluralName?: string | null;
  aliases?: { name: string }[];
  label?: { id: string; name: string } | null;
}

interface Page<T> {
  items: T[];
  total_pages?: number;
  totalPages?: number;
}

export class MealieError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export class MealieClient {
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = baseUrl.replace(/\/$/, '');
  }

  private async get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new MealieError(`Mealie nicht erreichbar: ${(err as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) throw new MealieError('Mealie-Token wird nicht akzeptiert', res.status);
    if (!res.ok) throw new MealieError(`Mealie antwortet mit HTTP ${res.status}`, res.status);
    return (await res.json()) as T;
  }

  async about(): Promise<{ version: string }> {
    return this.get('/api/app/about');
  }

  async self(): Promise<{ username?: string; fullName?: string }> {
    return this.get('/api/users/self');
  }

  async foods(): Promise<MealieFood[]> {
    const all: MealieFood[] = [];
    for (let page = 1; page < 1000; page++) {
      const res = await this.get<Page<MealieFood>>(`/api/foods?page=${page}&perPage=200&orderBy=name&orderDirection=asc`);
      all.push(...res.items);
      const pages = res.total_pages ?? res.totalPages ?? 1;
      if (page >= pages || res.items.length === 0) break;
    }
    return all;
  }
}
