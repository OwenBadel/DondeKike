export interface InsumoRecipe {
  insumoId: string;
  quantity: number;
}

export interface CatalogItem {
  id: string;
  name: string;
  image: string;
  content: string;
  price: number;
  category: string;
  sortOrder: number;
  insumoRecipe?: InsumoRecipe[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CatalogFormData {
  name: string;
  image: string;
  content: string;
  price: number;
  category: string;
  sortOrder?: number;
  insumoRecipe?: InsumoRecipe[];
}

export const CATALOG_CATEGORIES = [
  'Perros',
  'Hamburguesas',
  'Bebidas',
  'Otro'
];
