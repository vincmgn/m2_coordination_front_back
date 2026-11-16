import {describe, expect, it} from 'vitest';
import {calculer} from './calcul';

describe('calculer', () => {
  it('respecte les priorités et les parenthèses', () => {
    expect(calculer('30 * 1.2')).toBeCloseTo(36);
    expect(calculer('2 + 3 * 4')).toBe(14);
    expect(calculer('(2 + 3) * -4')).toBe(-20);
  });

  it("refuse tout ce qui n'est pas de l'arithmétique", () => {
    expect(() => calculer('alert(1)')).toThrow();
    expect(() => calculer('(1 + 2')).toThrow();
    expect(() => calculer('1 2')).toThrow();
  });
});
