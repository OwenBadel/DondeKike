import { Injectable } from '@angular/core';
import { Invoice } from '../models/invoice.model';
import { Order } from '../models/order.model';

@Injectable({ providedIn: 'root' })
export class NotificationService {

  /**
   * Simula el envío de comprobante por email.
   * En producción, integrar con SendGrid o EmailJS.
   *
   * Para EmailJS:
   *   1. Instalar: npm install @emailjs/browser
   *   2. Configurar template en emailjs.com
   *   3. Usar emailjs.send(serviceId, templateId, templateParams)
   *
   * Para SendGrid:
   *   1. Requiere backend/API proxy
   *   2. Enviar POST a tu API con los datos
   */

  async sendOrderConfirmation(order: Order, invoice: Invoice): Promise<{ success: boolean; message: string }> {
    try {
      // Simulación de envío de email
      console.log('📧 Enviando comprobante por email...');
      console.log(`   Para: ${order.customerEmail}`);
      console.log(`   Orden #${order.orderNumber}`);
      console.log(`   Factura: ${invoice.invoiceNumber}`);
      console.log(`   Total: $${invoice.total.toFixed(2)}`);

      // Simular delay de red
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Log detallado del email
      console.log('📧 Email enviado exitosamente');
      console.log('------- COMPROBANTE -------');
      console.log(`Negocio: ${invoice.businessName}`);
      console.log(`Dirección: ${invoice.businessAddress}`);
      console.log(`Teléfono: ${invoice.businessPhone}`);
      console.log(`Factura: ${invoice.invoiceNumber}`);
      console.log(`Cliente: ${invoice.customerName}`);
      console.log('Productos:');
      invoice.items.forEach(item => {
        console.log(`  - ${item.productName} x${item.quantity} = $${item.subtotal.toFixed(2)}`);
      });
      console.log(`Subtotal: $${invoice.subtotal.toFixed(2)}`);
      console.log(`IVA (${(invoice.taxRate * 100).toFixed(0)}%): $${invoice.tax.toFixed(2)}`);
      console.log(`Total: $${invoice.total.toFixed(2)}`);
      console.log('---------------------------');

      return {
        success: true,
        message: `Comprobante enviado a ${order.customerEmail}`
      };
    } catch (error) {
      console.error('Error enviando email:', error);
      return {
        success: false,
        message: 'Error al enviar el comprobante. Intente nuevamente.'
      };
    }
  }

  async notifyOwner(order: Order, invoice: Invoice): Promise<void> {
    console.log('📧 Notificando al dueño sobre nueva venta...');
    console.log(`   Orden #${order.orderNumber} - Total: $${order.total.toFixed(2)}`);
    // En producción: enviar email al dueño con resumen de la venta
  }
}
