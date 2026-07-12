import { describe, expect, it } from 'vitest';
import { computeLayout } from '../../src/platform/responsiveLayout';

describe('computeLayout', () => {
  it('uses zoom 2 and portrait for a 320×568 phone', () => {
    expect(computeLayout({ width: 320, height: 568 })).toEqual({ zoom: 2, orientation: 'portrait' });
  });

  it('uses zoom 2 and landscape for a 568×320 phone', () => {
    expect(computeLayout({ width: 568, height: 320 })).toEqual({ zoom: 2, orientation: 'landscape' });
  });

  it('uses zoom 3 for a 1366×768 desktop', () => {
    expect(computeLayout({ width: 1366, height: 768 })).toEqual({ zoom: 3, orientation: 'landscape' });
  });

  it('uses zoom 3 at the 1080 tier boundary (1920×1080)', () => {
    expect(computeLayout({ width: 1920, height: 1080 })).toEqual({ zoom: 3, orientation: 'landscape' });
  });

  it('uses the top zoom tier above 1080 on the short axis', () => {
    expect(computeLayout({ width: 2000, height: 1440 }).zoom).toBe(4);
  });
});
