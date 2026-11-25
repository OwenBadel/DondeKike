import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export const ALLOWED_IMAGE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif'
] as const;

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Valida que el campo contenga texto no vacío después de eliminar espacios.
 */
export function trimmedRequired(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = typeof control.value === 'string' ? control.value.trim() : '';
    return value.length > 0 ? null : { required: true };
  };
}

/**
 * Valida longitud mínima del texto después de aplicar trim().
 */
export function trimmedMinLength(min: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = typeof control.value === 'string' ? control.value.trim() : '';
    if (value.length === 0) return null; // Dejar que required reporte vacío
    return value.length >= min
      ? null
      : { minlength: { requiredLength: min, actualLength: value.length } };
  };
}

/**
 * Valida formato y peso de imágenes antes de subirlas a Storage (bloquea SVG/scripts).
 */
export function validateImageFile(file: File): { valid: boolean; message?: string } {
  if (!ALLOWED_IMAGE_MIMES.includes(file.type as any)) {
    return {
      valid: false,
      message: 'Formato no permitido. Usa JPG, PNG, WebP o AVIF.'
    };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return {
      valid: false,
      message: 'La imagen supera el máximo permitido de 5 MB.'
    };
  }
  return { valid: true };
}
