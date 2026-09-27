import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { InventoryRoutingModule } from './inventory-routing.module';
import { InventoryPage } from './inventory.page';
import { ProductModalComponent } from './product-modal/product-modal.component';

@NgModule({
  imports: [CommonModule, ReactiveFormsModule, IonicModule, InventoryRoutingModule],
  declarations: [InventoryPage, ProductModalComponent]
})
export class InventoryModule {}
