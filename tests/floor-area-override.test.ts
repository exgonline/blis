import { z } from 'zod';
import { BuildingType } from '../src/types/index';

// ─── Schema validation tests (pure, no DB) ───────────────────────────────────

const floorAreaOverrideSchema = z.object({
  floorAreaM2: z.number().positive().max(500000),
  buildingType: z.nativeEnum(BuildingType).optional(),
  overrideSource: z.string().min(1).max(200),
  notes: z.string().max(500).optional(),
});

describe('floorAreaOverrideSchema validation', () => {
  it('accepts a minimal valid payload', () => {
    const result = floorAreaOverrideSchema.safeParse({
      floorAreaM2: 3420,
      overrideSource: 'manual measurement',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a full valid payload', () => {
    const result = floorAreaOverrideSchema.safeParse({
      floorAreaM2: 3420,
      buildingType: BuildingType.Hotel,
      overrideSource: 'facilities team survey',
      notes: 'Measured by FM team 2026-03-01',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-positive floorAreaM2', () => {
    const result = floorAreaOverrideSchema.safeParse({
      floorAreaM2: 0,
      overrideSource: 'survey',
    });
    expect(result.success).toBe(false);
  });

  it('rejects floorAreaM2 above maximum', () => {
    const result = floorAreaOverrideSchema.safeParse({
      floorAreaM2: 500001,
      overrideSource: 'survey',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing overrideSource', () => {
    const result = floorAreaOverrideSchema.safeParse({ floorAreaM2: 1000 });
    expect(result.success).toBe(false);
  });

  it('rejects empty overrideSource', () => {
    const result = floorAreaOverrideSchema.safeParse({
      floorAreaM2: 1000,
      overrideSource: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects overrideSource longer than 200 characters', () => {
    const result = floorAreaOverrideSchema.safeParse({
      floorAreaM2: 1000,
      overrideSource: 'x'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid buildingType enum value', () => {
    const result = floorAreaOverrideSchema.safeParse({
      floorAreaM2: 1000,
      overrideSource: 'survey',
      buildingType: 'not_a_real_type',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid BuildingType enum values', () => {
    for (const bt of Object.values(BuildingType)) {
      const result = floorAreaOverrideSchema.safeParse({
        floorAreaM2: 1000,
        overrideSource: 'survey',
        buildingType: bt,
      });
      expect(result.success).toBe(true);
    }
  });
});
