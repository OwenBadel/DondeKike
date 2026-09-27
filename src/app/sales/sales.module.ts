import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { SalesRoutingModule } from './sales-routing.module';
import { SalesPage } from './sales.page';

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    SalesRoutingModule
  ],
  declarations: [SalesPage]
})
export class SalesModule {}
