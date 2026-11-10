import { useEffect, useState } from 'react';

export interface HouseholdPerson {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin?: boolean;
}

export interface Household {
  id: string;
  name: string;
  /** The user's own household (comes first). */
  own: boolean;
  /** The owner household (members of the owner group). */
  owner: boolean;
  members: HouseholdPerson[];
}

/** All households with their people (needs a connection; null while loading or offline). */
export function useHouseholds(deps: unknown[] = [], enabled = true): [Household[] | null, () => void] {
  const [data, setData] = useState<Household[] | null>(null);
  const load = () => {
    if (!enabled) return;
    void fetch('/api/v1/households')
      .then((r) => (r.ok ? (r.json() as Promise<Household[]>) : null))
      .then(setData)
      .catch(() => setData(null));
  };
  useEffect(load, [...deps, enabled]);
  return [data, load];
}
