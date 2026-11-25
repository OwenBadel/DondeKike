import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Insumo, InsumoFormData } from '../models/product.model';
import { CatalogItem } from '../models/catalog.model';
import { InsumoDeduction } from '../models/order.model';
import { CartItem } from './cart.service';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class InventoryService {

  private sb = inject(SupabaseService);

  private insumos$ = new BehaviorSubject<Insumo[]>([]);
  private realtimeTimer: ReturnType<typeof setTimeout> | null = null;

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
          this.scheduleRefresh();
        })
        .subscribe();
    } catch {
      // Ignorar si Realtime no está habilitado para la tabla
    }
  }

  private scheduleRefresh(): void {
    if (this.realtimeTimer) clearTimeout(this.realtimeTimer);
    this.realtimeTimer = setTimeout(() => this.refresh(), 150);
  }

  async addInsumo(data: InsumoFormData): Promise<Insumo | null> {
    const cleanName = (data.name || '').trim();
    if (cleanName.length < 2) return null;

    const row = {
      id: this.generateId(),
      name: cleanName,
      image: data.image || '',
      stock: Math.max(0, Math.round(Number(data.stock) || 0)),
      low_stock_threshold: Math.max(0, Math.round(Number(data.lowStockThreshold) || 0))
    };

    const { data: inserted, error } = await this.sb.client
      .from('insumos')
      .insert(row)
      .select()
      .single();

    if (error) {
      return null;
    }

    await this.refresh();
    return inserted
      ? this.mapRow(inserted)
      : this.mapRow({ ...row, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  }

  async updateInsumo(id: string, data: Partial<InsumoFormData>): Promise<Insumo | null> {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) {
      const cleanName = data.name.trim();
      if (cleanName.length < 2) return null;
      updates['name'] = cleanName;
    }
    if (data.image !== undefined) updates['image'] = data.image;
    if (data.stock !== undefined) updates['stock'] = Math.max(0, Math.round(Number(data.stock) || 0));
    if (data.lowStockThreshold !== undefined) {
      updates['low_stock_threshold'] = Math.max(0, Math.round(Number(data.lowStockThreshold) || 0));
    }

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

  async adjustStock(insumoId: string, delta: number): Promise<Insumo | null> {
    const safeDelta = Math.round(delta);
    if (safeDelta === 0) return this.getInsumoById(insumoId) || null;

    // 1. Intentar ajuste atómico en servidor (evita lost updates concurrentes)
    const { data: rpcData, error: rpcError } = await this.sb.client.rpc('adjust_insumo_stock_atomic', {
      p_insumo_id: insumoId,
      p_delta: safeDelta
    });

    if (!rpcError && rpcData?.success && rpcData.insumo) {
      await this.refresh();
      return this.mapRow(rpcData.insumo);
    }

    // 2. Fallback leyendo el valor más reciente antes de actualizar
    const { data: fresh } = await this.sb.client
      .from('insumos')
      .select('stock')
      .eq('id', insumoId)
      .maybeSingle();

    const baseStock = fresh ? Number(fresh.stock) || 0 : (this.getInsumoById(insumoId)?.stock ?? 0);
    return this.updateInsumo(insumoId, { stock: Math.max(0, baseStock + safeDelta) });
  }

  async decrementStock(insumoId: string, quantity: number): Promise<boolean> {
    const insumo = this.getInsumoById(insumoId);
    if (!insumo || insumo.stock < quantity) return false;
    const result = await this.adjustStock(insumoId, -Math.abs(quantity));
    return result !== null;
  }

  async incrementStock(insumoId: string, quantity: number): Promise<boolean> {
    const result = await this.adjustStock(insumoId, Math.abs(quantity));
    return result !== null;
  }

  findInsumoByName(name: string): Insumo | undefined {
    const normalized = this.normalizeText(name);
    if (!normalized) return undefined;

    const direct = this.insumos$.value.find(i => this.normalizeText(i.name).includes(normalized));
    if (direct) return direct;

    return this.insumos$.value.find(i => {
      const insBase = this.normalizeText(i.name).replace(/\([^)]*\)/g, '').trim();
      return insBase.length >= 4 && normalized.includes(insBase);
    });
  }

  /**
   * Calcula porciones disponibles según receta e inventario.
   * Si un insumo referenciado en la receta fue eliminado, retorna 0 (coherente con validateCartStock).
   */
  getProductMaxServings(catalogItem: CatalogItem): number | null {
    const recipe = catalogItem.insumoRecipe;
    if (recipe && Array.isArray(recipe) && recipe.length > 0) {
      let minServings = Infinity;
      let checkedAny = false;

      for (const r of recipe) {
        if (!r.insumoId || r.quantity <= 0) continue;
        checkedAny = true;
        const insumo = this.getInsumoById(r.insumoId);
        if (!insumo) {
          return 0;
        }
        minServings = Math.min(minServings, Math.floor(insumo.stock / r.quantity));
      }

      return checkedAny ? Math.max(0, minServings) : null;
    }

    const directInsumo = this.findInsumoByName(catalogItem.name);
    return directInsumo ? Math.max(0, directInsumo.stock) : null;
  }

  validateCartStock(cartItems: CartItem[]): {
    valid: boolean;
    missing: { name: string; available: number; needed: number }[];
    deductions: InsumoDeduction[];
  } {
    const deductionMap = new Map<string, { name: string; needed: number }>();

    for (const item of cartItems) {
      const recipe = item.catalogItem.insumoRecipe;

      if (recipe && Array.isArray(recipe) && recipe.length > 0) {
        for (const r of recipe) {
          if (r.insumoId && r.quantity > 0) {
            const insumo = this.getInsumoById(r.insumoId);
            const insName = insumo ? insumo.name : 'Insumo no encontrado';
            const current = deductionMap.get(r.insumoId) || { name: insName, needed: 0 };
            current.needed += r.quantity * item.quantity;
            deductionMap.set(r.insumoId, current);
          }
        }
      } else {
        const directInsumo = this.findInsumoByName(item.catalogItem.name);
        if (directInsumo) {
          const current = deductionMap.get(directInsumo.id) || { name: directInsumo.name, needed: 0 };
          current.needed += item.quantity;
          deductionMap.set(directInsumo.id, current);
        }
      }

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

  private normalizeText(value: string): string {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  private mapRow(row: any): Insumo {
    return {
      id: row.id,
      name: row.name,
      image: row.image || '',
      stock: Number(row.stock) || 0,
      lowStockThreshold: Number(row.low_stock_threshold) || 0,
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
