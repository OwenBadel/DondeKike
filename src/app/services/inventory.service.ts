import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Insumo, InsumoFormData } from '../models/product.model';
import { InsumoDeduction } from '../models/order.model';
import { CartItem } from './cart.service';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class InventoryService {

  private sb = inject(SupabaseService);

  private insumos$ = new BehaviorSubject<Insumo[]>([]);

  constructor() {
    this.loadInsumos();
    this.initRealtime();
  }

  get allInsumos$(): Observable<Insumo[]> {
    return this.insumos$.asObservable();
  }

  get lowStockInsumos$(): Observable<Insumo[]> {
    return this.insumos$.pipe(
      map(insumos => insumos.filter(i => i.stock <= i.lowStockThreshold))
    );
  }

  getInsumoById(id: string): Insumo | undefined {
    return this.insumos$.value.find(i => i.id === id);
  }

  private initRealtime(): void {
    try {
      this.sb.client
        .channel('realtime:insumos')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'insumos' }, () => {
          this.refresh();
        })
        .subscribe();
    } catch {
      // Ignore if realtime publication is not configured
    }
  }

  async addInsumo(data: InsumoFormData): Promise<Insumo> {
    const row = {
      id: this.generateId(),
      name: data.name.trim(),
      image: data.image || '',
      stock: Math.max(0, data.stock),
      low_stock_threshold: Math.max(0, data.lowStockThreshold)
    };

    await this.sb.client.from('insumos').insert(row);
    await this.refresh();
    return this.mapRow({ ...row, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  }

  async updateInsumo(id: string, data: Partial<InsumoFormData>): Promise<Insumo | null> {
    const updates: any = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) updates.name = data.name.trim();
    if (data.image !== undefined) updates.image = data.image;
    if (data.stock !== undefined) updates.stock = Math.max(0, data.stock);
    if (data.lowStockThreshold !== undefined) updates.low_stock_threshold = Math.max(0, data.lowStockThreshold);

    const { data: updated, error } = await this.sb.client
      .from('insumos')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !updated) return null;
    await this.refresh();
    return this.mapRow(updated);
  }

  async deleteInsumo(id: string): Promise<boolean> {
    const { error } = await this.sb.client.from('insumos').delete().eq('id', id);
    if (error) return false;
    await this.refresh();
    return true;
  }

  async decrementStock(insumoId: string, quantity: number): Promise<boolean> {
    const insumo = this.getInsumoById(insumoId);
    if (!insumo || insumo.stock < quantity) return false;
    const result = await this.updateInsumo(insumoId, { stock: insumo.stock - quantity });
    return result !== null;
  }

  async incrementStock(insumoId: string, quantity: number): Promise<boolean> {
    const insumo = this.getInsumoById(insumoId);
    if (!insumo) return false;
    const result = await this.updateInsumo(insumoId, { stock: insumo.stock + quantity });
    return result !== null;
  }

  findInsumoByName(name: string): Insumo | undefined {
    const lower = name.toLowerCase().trim();
    return this.insumos$.value.find(i => i.name.toLowerCase().includes(lower));
  }

  searchInsumos(term: string): Observable<Insumo[]> {
    const lower = term.toLowerCase().trim();
    return this.insumos$.pipe(
      map(insumos => insumos.filter(i => i.name.toLowerCase().includes(lower)))
    );
  }

  /**
   * Valida si hay stock suficiente en inventario para todos los productos y adiciones del carrito
   */
  validateCartStock(cartItems: CartItem[]): {
    valid: boolean;
    missing: { name: string; available: number; needed: number }[];
    deductions: InsumoDeduction[];
  } {
    const deductionMap = new Map<string, { name: string; needed: number }>();

    for (const item of cartItems) {
      const recipe = item.catalogItem.insumoRecipe;

      // 1. Si el producto tiene receta explícita de insumos
      if (recipe && Array.isArray(recipe) && recipe.length > 0) {
        for (const r of recipe) {
          if (r.insumoId) {
            const insumo = this.getInsumoById(r.insumoId);
            const insName = insumo ? insumo.name : 'Insumo';
            const current = deductionMap.get(r.insumoId) || { name: insName, needed: 0 };
            current.needed += (r.quantity * item.quantity);
            deductionMap.set(r.insumoId, current);
          }
        }
      } else {
        // 2. Si no tiene receta (bebidas como Coca-Cola, etc.), buscar si existe un insumo con nombre coincidente
        const directInsumo = this.findInsumoByName(item.catalogItem.name);
        if (directInsumo) {
          const current = deductionMap.get(directInsumo.id) || { name: directInsumo.name, needed: 0 };
          current.needed += item.quantity;
          deductionMap.set(directInsumo.id, current);
        }
      }

      // 3. Adición de Queso extra
      if (item.cheeseExtra) {
        const queso = this.findInsumoByName('Queso');
        if (queso) {
          const current = deductionMap.get(queso.id) || { name: queso.name, needed: 0 };
          current.needed += item.quantity;
          deductionMap.set(queso.id, current);
        }
      }
    }

    const missing: { name: string; available: number; needed: number }[] = [];
    const deductions: InsumoDeduction[] = [];

    for (const [insumoId, info] of deductionMap.entries()) {
      const insumo = this.getInsumoById(insumoId);
      const stock = insumo ? insumo.stock : 0;
      if (stock < info.needed) {
        missing.push({
          name: info.name,
          available: stock,
          needed: info.needed
        });
      }
      deductions.push({ insumoId, quantity: info.needed });
    }

    return {
      valid: missing.length === 0,
      missing,
      deductions
    };
  }

  async refresh(): Promise<void> {
    const { data } = await this.sb.client
      .from('insumos')
      .select('*')
      .order('created_at', { ascending: true });

    if (data) {
      this.insumos$.next(data.map((r: any) => this.mapRow(r)));
    }
  }

  private async loadInsumos(): Promise<void> {
    await this.refresh();
  }

  private mapRow(row: any): Insumo {
    return {
      id: row.id,
      name: row.name,
      image: row.image || '',
      stock: row.stock,
      lowStockThreshold: row.low_stock_threshold,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  private generateId(): string {
    const rand = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').substring(0, 10)
      : Math.random().toString(36).substring(2, 12);
    return 'ins_' + rand;
  }
}
