import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { OrdersRoutingModule } from './orders-routing.module';
import { OrdersPage } from './orders.page';

@NgModule({
  imports: [CommonModule, IonicModule, OrdersRoutingModule],
  declarations: [OrdersPage]
})
export class OrdersModule {}
