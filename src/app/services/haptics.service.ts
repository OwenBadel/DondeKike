import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

@Injectable({ providedIn: 'root' })
export class HapticsService {

  private get isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  async tap(): Promise<void> {
    if (!this.isNative) return;
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Ignorar si el dispositivo no soporta vibración
    }
  }

  async impact(): Promise<void> {
    if (!this.isNative) return;
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch {
      // Ignorar si el dispositivo no soporta vibración
    }
  }

  async success(): Promise<void> {
    if (!this.isNative) return;
    try {
      await Haptics.notification({ type: NotificationType.Success });
    } catch {
      // Ignorar si el dispositivo no soporta vibración
    }
  }

  async warning(): Promise<void> {
    if (!this.isNative) return;
    try {
      await Haptics.notification({ type: NotificationType.Warning });
    } catch {
      // Ignorar si el dispositivo no soporta vibración
    }
  }
}
