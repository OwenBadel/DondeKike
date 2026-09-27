import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { DashboardRoutingModule } from './dashboard-routing.module';
import { DashboardPage } from './dashboard.page';

@NgModule({
  imports: [CommonModule, IonicModule, DashboardRoutingModule],
  declarations: [DashboardPage]
})
export class DashboardModule {}
