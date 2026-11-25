import { FormControl } from '@angular/forms';
import { trimmedMinLength, trimmedRequired, validateImageFile } from './form-validators.util';

describe('form-validators.util', () => {
  it('rechaza cadenas compuestas únicamente por espacios', () => {
    const ctrl = new FormControl('   ', [trimmedRequired(), trimmedMinLength(2)]);
    expect(ctrl.invalid).toBeTrue();
    expect(ctrl.hasError('required')).toBeTrue();

    ctrl.setValue(' a ');
    expect(ctrl.hasError('minlength')).toBeTrue();

    ctrl.setValue(' Pan ');
    expect(ctrl.valid).toBeTrue();
  });

  it('bloquea SVG y archivos mayores a 5MB en validación de imágenes', () => {
    const svg = new File(['<svg></svg>'], 'xss.svg', { type: 'image/svg+xml' });
    expect(validateImageFile(svg).valid).toBeFalse();

    const validPng = new File([new Uint8Array(1024)], 'burger.png', { type: 'image/png' });
    expect(validateImageFile(validPng).valid).toBeTrue();
  });
});
