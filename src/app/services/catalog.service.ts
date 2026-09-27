import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CatalogItem, CatalogFormData, InsumoRecipe } from '../models/catalog.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class CatalogService {

  private sb = inject(SupabaseService);

  private items$ = new BehaviorSubject<CatalogItem[]>([]);

  constructor() {
    this.loadItems();
  }

  get allItems$(): Observable<CatalogItem[]> {
    return this.items$.asObservable();
  }

  getItemById(id: string): CatalogItem | undefined {
    return this.items$.value.find(i => i.id === id);
  }

  getItemsByCategory(category: string): Observable<CatalogItem[]> {
    return this.items$.pipe(
      map(items => items.filter(i => i.category === category))
    );
  }

  searchItems(term: string): Observable<CatalogItem[]> {
    const lower = term.toLowerCase().trim();
    return this.items$.pipe(
      map(items => items.filter(i =>
        i.name.toLowerCase().includes(lower) ||
        i.content.toLowerCase().includes(lower) ||
        i.category.toLowerCase().includes(lower)
      ))
    );
  }

  async uploadImage(file: File): Promise<string> {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;

    const { error } = await this.sb.client.storage
      .from('catalog-images')
      .upload(path, file, { cacheControl: '3600', upsert: false });

    if (error) throw error;

    const { data } = this.sb.client.storage
      .from('catalog-images')
      .getPublicUrl(path);

    return data.publicUrl;
  }

  async deleteImage(imageUrl: string): Promise<void> {
    if (!imageUrl) return;
    try {
      const parts = imageUrl.split('/catalog-images/');
      if (parts.length < 2) return;
      const path = decodeURIComponent(parts[1]);
      await this.sb.client.storage.from('catalog-images').remove([path]);
    } catch { /* ignore */ }
  }

  async addItem(data: CatalogFormData): Promise<CatalogItem> {
    const currentItems = this.items$.value;
    const maxOrder = currentItems.length > 0
      ? Math.max(...currentItems.map(i => i.sortOrder || 0))
      : 0;

    const row = {
      id: this.generateId(),
      name: data.name.trim(),
      image: data.image || '',
      content: data.content.trim(),
      price: Math.max(0, data.price),
      category: data.category,
      sort_order: data.sortOrder ?? (maxOrder + 1),
      insumo_recipe: JSON.stringify(data.insumoRecipe || [])
    };

    await this.sb.client.from('catalog_items').insert(row);
    await this.refresh();
    return this.mapRow({ ...row, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  }

  async updateItem(id: string, data: Partial<CatalogFormData>): Promise<CatalogItem | null> {
    const updates: any = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) updates.name = data.name.trim();
    if (data.image !== undefined) updates.image = data.image;
    if (data.content !== undefined) updates.content = data.content.trim();
    if (data.price !== undefined) updates.price = Math.max(0, data.price);
    if (data.category !== undefined) updates.category = data.category;
    if (data.sortOrder !== undefined) updates.sort_order = data.sortOrder;
    if (data.insumoRecipe !== undefined) updates.insumo_recipe = JSON.stringify(data.insumoRecipe);

    const { data: updated, error } = await this.sb.client
      .from('catalog_items')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !updated) return null;
    await this.refresh();
    return this.mapRow(updated);
  }

  async deleteItem(id: string): Promise<boolean> {
    const item = this.getItemById(id);
    if (item?.image) {
      await this.deleteImage(item.image);
    }
    const { error } = await this.sb.client.from('catalog_items').delete().eq('id', id);
    if (error) return false;
    await this.refresh();
    return true;
  }

  async refresh(): Promise<void> {
    // Intentar ordenar por sort_order, con fallback a created_at
    const { data, error } = await this.sb.client
      .from('catalog_items')
      .select('*')
      .order('sort_order', { ascending: true });

    if (!error && data) {
      this.items$.next(data.map((r: any) => this.mapRow(r)));
      return;
    }

    const { data: fallbackData } = await this.sb.client
      .from('catalog_items')
      .select('*')
      .order('created_at', { ascending: true });

    if (fallbackData) {
      this.items$.next(fallbackData.map((r: any) => this.mapRow(r)));
    }
  }

  private async loadItems(): Promise<void> {
    await this.refresh();
  }

  private mapRow(row: any): CatalogItem {
    let recipe: InsumoRecipe[] = [];
    try {
      recipe = typeof row.insumo_recipe === 'string'
        ? JSON.parse(row.insumo_recipe)
        : (row.insumo_recipe || []);
    } catch { recipe = []; }

    return {
      id: row.id,
      name: row.name,
      image: row.image || '',
      content: row.content || '',
      price: row.price,
      category: row.category,
      sortOrder: row.sort_order || 0,
      insumoRecipe: recipe,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  private generateId(): string {
    const rand = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').substring(0, 10)
      : Math.random().toString(36).substring(2, 12);
    return 'cat_' + rand;
  }
}
