import { describe, expect, it } from 'vitest';
import { contentValidationErrors, validateEfficiencyDefinition } from '../../src/content/validation';

describe('content validation', () => {
  it('requires canonical efficiency axes on every non-cosmetic reward definition', () => {
    expect(contentValidationErrors()).toEqual([]);
    expect(validateEfficiencyDefinition('broken', { efficiencyAxes: [] })).toEqual([
      'broken must declare efficiencyAxes',
    ]);
    expect(validateEfficiencyDefinition('broken', { efficiencyAxes: ['speed'] })).toEqual([
      'broken has an invalid efficiency axis',
    ]);
  });
});
