import { Injectable } from '@angular/core';
import Swal, { SweetAlertIcon } from 'sweetalert2';

@Injectable({
  providedIn: 'root'
})
export class AlertService {

  private Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 2800,
    timerProgressBar: true,
    didOpen: (toast) => {
      toast.onmouseenter = Swal.stopTimer;
      toast.onmouseleave = Swal.resumeTimer;
    }
  });

  /**
   * Notificación flotante superior moderna (Toast profesional)
   */
  toast(title: string, icon: SweetAlertIcon = 'success'): void {
    this.Toast.fire({
      icon,
      title
    });
  }

  /**
   * Modal informativo o de error profesional
   */
  modal(title: string, html: string, icon: SweetAlertIcon = 'info', confirmText: string = 'Aceptar'): Promise<any> {
    return Swal.fire({
      title,
      html,
      icon,
      confirmButtonText: confirmText,
      confirmButtonColor: '#2dd36f',
      background: '#ffffff',
      heightAuto: false
    });
  }

  /**
   * Alerta visual de stock insuficiente detallando cada producto/insumo
   */
  stockWarning(missingItems: { name: string; available: number; needed: number }[]): Promise<any> {
    const itemsList = missingItems.map(item => `
      <li style="margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #fecaca; padding-bottom: 4px;">
        <span style="color: #0f172a; font-weight: 600; font-size: 13px;">${item.name}</span>
        <span style="font-size: 12.5px;">
          <span style="color: #dc2626; font-weight: 700;">Stock: ${item.available}</span>
          <span style="color: #94a3b8; margin: 0 4px;">•</span>
          <span style="color: #475569;">Req: ${item.needed}</span>
        </span>
      </li>
    `).join('');

    const htmlContent = `
      <div style="margin: 12px 0; background: #fff5f5; border: 1px solid #fecaca; border-radius: 12px; padding: 12px 14px; text-align: left;">
        <ul style="margin: 0; padding: 0; list-style: none; font-size: 13px; line-height: 1.5;">
          ${itemsList}
        </ul>
      </div>
      <p style="font-size: 12.5px; color: #64748b; margin: 6px 0 0 0; text-align: center;">
        Ajusta la cantidad en el pedido o abastece insumos.
      </p>
    `;

    return Swal.fire({
      icon: 'error',
      title: 'Stock Insuficiente',
      html: htmlContent,
      confirmButtonText: 'Ajustar Carrito',
      confirmButtonColor: '#ef4444',
      background: '#ffffff',
      heightAuto: false
    });
  }

  /**
   * Diálogo de confirmación interactivo
   */
  async confirm(title: string, text: string, confirmText: string = 'Sí, continuar', cancelText: string = 'Cancelar', icon: SweetAlertIcon = 'warning'): Promise<boolean> {
    const result = await Swal.fire({
      title,
      text,
      icon,
      showCancelButton: true,
      confirmButtonColor: '#2dd36f',
      cancelButtonColor: '#94a3b8',
      confirmButtonText: confirmText,
      cancelButtonText: cancelText,
      background: '#ffffff',
      heightAuto: false
    });
    return result.isConfirmed;
  }

  /**
   * Diálogo de selección única
   */
  async select(title: string, inputOptions: Record<string, string>, currentValue: string, confirmText: string = 'Guardar'): Promise<string | null> {
    const result = await Swal.fire({
      title,
      input: 'select',
      inputOptions,
      inputValue: currentValue,
      showCancelButton: true,
      confirmButtonColor: '#2dd36f',
      cancelButtonColor: '#94a3b8',
      confirmButtonText: confirmText,
      cancelButtonText: 'Cancelar',
      background: '#ffffff',
      heightAuto: false
    });
    return result.isConfirmed ? (result.value as string) : null;
  }
}
