import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { CatalogRoutingModule } from './catalog-routing.module';
import { CatalogPage } from './catalog.page';
import { CatalogItemModalComponent } from './catalog-item-modal/catalog-item-modal.component';

@NgModule({
  imports: [CommonModule, ReactiveFormsModule, FormsModule, IonicModule, CatalogRoutingModule],
  declarations: [CatalogPage, CatalogItemModalComponent]
})
export class CatalogModule {}
