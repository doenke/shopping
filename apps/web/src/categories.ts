import type { CategoryRow } from '@shopping/shared';
import { createContext, useContext } from 'react';

/** Own categories of the household (and of lists shared with the user); see docs/konzept/09. */
export const CategoryContext = createContext<CategoryRow[]>([]);

export function useCustomCategories(): CategoryRow[] {
  return useContext(CategoryContext);
}
