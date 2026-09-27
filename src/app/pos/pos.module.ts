import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { PosRoutingModule } from './pos-routing.module';
import { PosPage } from './pos.page';
import { CheckoutModalComponent } from './checkout-modal/checkout-modal.component';

@NgModule({
  imports: [CommonModule, ReactiveFormsModule, FormsModule, IonicModule, PosRoutingModule],
  declarations: [PosPage, CheckoutModalComponent]
})
export class PosModule {}
