import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { CatalogItem, CatalogFormData, InsumoRecipe } from '../models/catalog.model';
import { SupabaseService } from './supabase.service';
import { validateImageFile } from '../utils/form-validators.util';

@Injectable({ providedIn: 'root' })
export class CatalogService {

  private sb = inject(SupabaseService);

  private items$ = new BehaviorSubject<CatalogItem[]>([]);
  private realtimeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.loadItems();
    this.initRealtime();
  }

  get allItems$(): Observable<CatalogItem[]> {
    return this.items$.asObservable();
  }

  get currentItems(): CatalogItem[] {
    return this.items$.value;
  }

  getItemById(id: string): CatalogItem | undefined {
    return this.items$.value.find(i => i.id === id);
  }

  getItemsUsingInsumo(insumoId: string): CatalogItem[] {
    return this.items$.value.filter(item =>
      (item.insumoRecipe || []).some(r => r.insumoId === insumoId)
    );
  }

  private initRealtime(): void {
    try {
      this.sb.client
        .channel('realtime:catalog_items')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'catalog_items' }, () => {
          this.scheduleRefresh();
        })
        .subscribe();
    } catch {
      // Realtime opcional si la publicación no incluye catalog_items
    }
  }

  private scheduleRefresh(): void {
    if (this.realtimeTimer) clearTimeout(this.realtimeTimer);
    this.realtimeTimer = setTimeout(() => this.refresh(), 150);
  }

  async uploadImage(file: File): Promise<string> {
    const check = validateImageFile(file);
    if (!check.valid) {
      throw new Error(check.message || 'Imagen no válida.');
    }

    const mimeExtMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/avif': 'avif'
    };
    const ext = mimeExtMap[file.type] || 'jpg';
    const path = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;

    const { error } = await this.sb.client.storage
      .from('catalog-images')
      .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });

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
    } catch {
      // Ignorar errores de limpieza de imágenes locales o externas
    }
  }

  async addItem(data: CatalogFormData): Promise<CatalogItem | null> {
    const cleanName = (data.name || '').trim();
    const cleanContent = (data.content || '').trim();
    if (cleanName.length < 2 || !cleanContent) {
      return null;
    }

    const currentItems = this.items$.value;
    const maxOrder = currentItems.length > 0
      ? Math.max(...currentItems.map(i => i.sortOrder || 0))
      : 0;

    const row = {
      id: this.generateId(),
      name: cleanName,
      image: data.image || '',
      content: cleanContent,
      price: Math.max(0, Math.round(Number(data.price) || 0)),
      category: data.category,
      sort_order: data.sortOrder ?? (maxOrder + 1),
      insumo_recipe: data.insumoRecipe || []
    };

    const { data: inserted, error } = await this.sb.client
      .from('catalog_items')
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

  async updateItem(id: string, data: Partial<CatalogFormData>): Promise<CatalogItem | null> {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) {
      const cleanName = data.name.trim();
      if (cleanName.length < 2) return null;
      updates['name'] = cleanName;
    }
    if (data.image !== undefined) updates['image'] = data.image;
    if (data.content !== undefined) {
      const cleanContent = data.content.trim();
      if (!cleanContent) return null;
      updates['content'] = cleanContent;
    }
    if (data.price !== undefined) updates['price'] = Math.max(0, Math.round(Number(data.price) || 0));
    if (data.category !== undefined) updates['category'] = data.category;
    if (data.sortOrder !== undefined) updates['sort_order'] = data.sortOrder;
    if (data.insumoRecipe !== undefined) updates['insumo_recipe'] = data.insumoRecipe;

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
    const { error } = await this.sb.client.from('catalog_items').delete().eq('id', id);
    if (error) return false;

    if (item?.image) {
      await this.deleteImage(item.image);
    }

    await this.refresh();
    return true;
  }

  async refresh(): Promise<void> {
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
    } catch {
      recipe = [];
    }

    return {
      id: row.id,
      name: row.name,
      image: row.image || '',
      content: row.content || '',
      price: Math.round(Number(row.price) || 0),
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
