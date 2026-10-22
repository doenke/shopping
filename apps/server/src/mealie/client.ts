/** Minimal client for the Mealie v2 API (checked against Mealie's OpenAPI description). */

export interface MealieUnit {
  id: string;
  name: string;
  pluralName?: string | null;
  abbreviation?: string | null;
}

export interface MealieFood {
  id: string;
  name: string;
  pluralName?: string | null;
  aliases?: { name: string }[];
  label?: { id: string; name: string } | null;
}

export interface MealieShoppingItem {
  id: string;
  shoppingListId: string;
  quantity: number;
  unit: MealieUnit | null;
  food: MealieFood | null;
  note: string | null;
  display: string;
  checked: boolean;
  recipeReferences?: { recipeId: string }[];
  [key: string]: unknown;
}

export interface MealieShoppingList {
  id: string;
  name: string | null;
  listItems: MealieShoppingItem[];
  recipeReferences?: { recipeId: string; recipe?: { id?: string | null; name?: string | null } }[];
}

export interface MealieRecipeSummary {
  id: string | null;
  slug: string;
  name: string | null;
  recipeServings: number;
  recipeYieldQuantity?: number;
}

export interface MealieIngredient {
  quantity: number | null;
  unit: MealieUnit | null;
  food: MealieFood | null;
  note: string | null;
  display: string;
  title?: string | null;
  originalText?: string | null;
}

export interface MealieRecipe extends MealieRecipeSummary {
  recipeIngredient: MealieIngredient[];
}

export interface MealiePlanEntry {
  date: string;
  entryType: string;
  title: string;
  recipeId: string | null;
  recipeScale?: number;
  recipe: MealieRecipeSummary | null;
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

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new MealieError(`Mealie nicht erreichbar: ${(err as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) throw new MealieError('Mealie-Token wird nicht akzeptiert', res.status);
    if (res.status === 404) throw new MealieError('In Mealie nicht gefunden', 404);
    if (!res.ok) throw new MealieError(`Mealie antwortet mit HTTP ${res.status}`, res.status);
    return (await res.json()) as T;
  }

  private get<T>(path: string): Promise<T> {
    return this.request('GET', path);
  }

  private async all<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    const sep = path.includes('?') ? '&' : '?';
    for (let page = 1; page < 1000; page++) {
      const res = await this.get<Page<T>>(`${path}${sep}page=${page}&perPage=200`);
      items.push(...res.items);
      const pages = res.total_pages ?? res.totalPages ?? 1;
      if (page >= pages || res.items.length === 0) break;
    }
    return items;
  }

  about(): Promise<{ version: string }> {
    return this.get('/api/app/about');
  }

  self(): Promise<{ username?: string; fullName?: string }> {
    return this.get('/api/users/self');
  }

  foods(): Promise<MealieFood[]> {
    return this.all('/api/foods?orderBy=name&orderDirection=asc');
  }

  shoppingLists(): Promise<{ id: string; name: string | null }[]> {
    return this.all('/api/households/shopping/lists');
  }

  shoppingList(id: string): Promise<MealieShoppingList> {
    return this.get(`/api/households/shopping/lists/${encodeURIComponent(id)}`);
  }

  /** Bulk update (used to tick items off after taking them over). */
  updateShoppingItems(items: MealieShoppingItem[]): Promise<unknown> {
    return this.request('PUT', '/api/households/shopping/items', items);
  }

  async searchRecipes(search: string): Promise<MealieRecipeSummary[]> {
    const q = new URLSearchParams({ search, perPage: '20', page: '1', orderBy: 'name', orderDirection: 'asc' });
    return (await this.get<Page<MealieRecipeSummary>>(`/api/recipes?${q}`)).items;
  }

  recipe(slug: string): Promise<MealieRecipe> {
    return this.get(`/api/recipes/${encodeURIComponent(slug)}`);
  }

  mealplan(from: string, to: string): Promise<MealiePlanEntry[]> {
    return this.all(`/api/households/mealplans?start_date=${from}&end_date=${to}&orderBy=date&orderDirection=asc`);
  }
}
