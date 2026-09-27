export interface Insumo {
  id: string;
  name: string;
  image: string; // Base64 o URL
  stock: number;
  lowStockThreshold: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface InsumoFormData {
  name: string;
  image: string;
  stock: number;
  lowStockThreshold: number;
}
