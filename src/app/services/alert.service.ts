import { Injectable } from '@angular/core';
import Swal, { SweetAlertIcon } from 'sweetalert2';
import { escapeHtml } from '../utils/order-format.util';

@Injectable({
  providedIn: 'root'
})
export class AlertService {

  private Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 2600,
    timerProgressBar: true,
    didOpen: (toast) => {
      toast.onmouseenter = Swal.stopTimer;
      toast.onmouseleave = Swal.resumeTimer;
    }
  });

  toast(title: string, icon: SweetAlertIcon = 'success'): void {
    this.Toast.fire({
      icon,
      titleText: title
    });
  }

  modal(
    title: string,
    message: string,
    icon: SweetAlertIcon = 'info',
    confirmText: string = 'Aceptar'
  ): Promise<any> {
    return Swal.fire({
      titleText: title,
      text: message,
      icon,
      confirmButtonText: confirmText,
      confirmButtonColor: '#D9480F',
      background: '#FFFFFF',
      heightAuto: false
    });
  }

  stockWarning(missingItems: { name: string; available: number; needed: number }[]): Promise<any> {
    const itemsList = missingItems.map(item => `
      <li style="margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #FECACA; padding-bottom: 6px; gap: 12px;">
        <span style="color: #1C1917; font-weight: 600; font-size: 13px;">${escapeHtml(item.name)}</span>
        <span style="font-size: 12.5px; white-space: nowrap; font-family: 'JetBrains Mono', monospace;">
          <span style="color: #DC2626; font-weight: 700;">Disp: ${Number(item.available) || 0}</span>
          <span style="color: #A8A29E; margin: 0 4px;">/</span>
          <span style="color: #57534E;">Req: ${Number(item.needed) || 0}</span>
        </span>
      </li>
    `).join('');

    const htmlContent = `
      <div style="margin: 12px 0; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 12px; padding: 12px 14px; text-align: left;">
        <ul style="margin: 0; padding: 0; list-style: none; font-size: 13px; line-height: 1.5;">
          ${itemsList}
        </ul>
      </div>
      <p style="font-size: 12.5px; color: #57534E; margin: 6px 0 0 0; text-align: center;">
        Ajusta la cantidad del pedido o reabastece los insumos en inventario.
      </p>
    `;

    return Swal.fire({
      icon: 'error',
      titleText: 'Stock Insuficiente',
      html: htmlContent,
      confirmButtonText: 'Ajustar Pedido',
      confirmButtonColor: '#DC2626',
      background: '#FFFFFF',
      heightAuto: false
    });
  }

  async confirm(
    title: string,
    text: string,
    confirmText: string = 'Sí, continuar',
    cancelText: string = 'Cancelar',
    icon: SweetAlertIcon = 'warning'
  ): Promise<boolean> {
    const confirmColor = icon === 'warning' || icon === 'error' ? '#D9480F' : '#15803D';
    const result = await Swal.fire({
      titleText: title,
      text,
      icon,
      showCancelButton: true,
      confirmButtonColor: confirmColor,
      cancelButtonColor: '#78716C',
      confirmButtonText: confirmText,
      cancelButtonText: cancelText,
      background: '#FFFFFF',
      heightAuto: false
    });
    return result.isConfirmed;
  }

  async select(
    title: string,
    inputOptions: Record<string, string>,
    currentValue: string,
    confirmText: string = 'Guardar'
  ): Promise<string | null> {
    const result = await Swal.fire({
      titleText: title,
      input: 'select',
      inputOptions,
      inputValue: currentValue,
      showCancelButton: true,
      confirmButtonColor: '#D9480F',
      cancelButtonColor: '#78716C',
      confirmButtonText: confirmText,
      cancelButtonText: 'Cancelar',
      background: '#FFFFFF',
      heightAuto: false
    });
    return result.isConfirmed ? (result.value as string) : null;
  }
}
