import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { UsersRoutingModule } from './users-routing.module';
import { UsersPage } from './users.page';
import { CreateUserModalComponent } from './create-user-modal/create-user-modal.component';

@NgModule({
  imports: [CommonModule, FormsModule, ReactiveFormsModule, IonicModule, UsersRoutingModule],
  declarations: [UsersPage, CreateUserModalComponent]
})
export class UsersModule {}
