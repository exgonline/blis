import {
  PHASE_DISTRIBUTION_FACTORS,
  getPhaseFactors,
  distributePhaseAmps,
  validatePhaseFactors,
} from '../src/utils/phase';

describe('Phase distribution', () => {
  describe('PHASE_DISTRIBUTION_FACTORS', () => {
    const buildingTypes = [
      'hotel',
      'hotel_budget',
      'housing_association',
      'fleet_depot',
      'warehouse_simple',
      'car_park',
      'car_park_with_facilities',
      'office_general',
      'retail',
      'pub_restaurant',
      'unknown',
    ];

    buildingTypes.forEach((buildingType) => {
      it(`${buildingType} phase factors sum to 1.0`, () => {
        const factors = PHASE_DISTRIBUTION_FACTORS[buildingType];
        expect(factors).toBeDefined();
        const sum = factors!.l1 + factors!.l2 + factors!.l3;
        expect(sum).toBeCloseTo(1.0, 10);
      });
    });

    it('all 11 building types are defined', () => {
      expect(Object.keys(PHASE_DISTRIBUTION_FACTORS)).toHaveLength(11);
    });

    it('all factors are between 0 and 1', () => {
      for (const factors of Object.values(PHASE_DISTRIBUTION_FACTORS)) {
        expect(factors.l1).toBeGreaterThan(0);
        expect(factors.l1).toBeLessThan(1);
        expect(factors.l2).toBeGreaterThan(0);
        expect(factors.l2).toBeLessThan(1);
        expect(factors.l3).toBeGreaterThan(0);
        expect(factors.l3).toBeLessThan(1);
      }
    });
  });

  describe('getPhaseFactors', () => {
    it('returns correct factors for hotel', () => {
      const factors = getPhaseFactors('hotel');
      expect(factors.l1).toBe(0.38);
      expect(factors.l2).toBe(0.31);
      expect(factors.l3).toBe(0.31);
    });

    it('falls back to unknown for unrecognised building type', () => {
      const factors = getPhaseFactors('some_unknown_type_xyz');
      const unknownFactors = PHASE_DISTRIBUTION_FACTORS['unknown']!;
      expect(factors.l1).toBe(unknownFactors.l1);
      expect(factors.l2).toBe(unknownFactors.l2);
      expect(factors.l3).toBe(unknownFactors.l3);
    });
  });

  describe('distributePhaseAmps', () => {
    it('distributes 100A across three phases using hotel factors', () => {
      const factors = PHASE_DISTRIBUTION_FACTORS['hotel']!;
      const distributed = distributePhaseAmps(100, factors);
      expect(distributed.l1).toBeCloseTo(38, 5);
      expect(distributed.l2).toBeCloseTo(31, 5);
      expect(distributed.l3).toBeCloseTo(31, 5);
    });

    it('distributed phases sum back to total amps', () => {
      const factors = getPhaseFactors('office_general');
      const total = 150;
      const distributed = distributePhaseAmps(total, factors);
      const sum = distributed.l1 + distributed.l2 + distributed.l3;
      expect(sum).toBeCloseTo(total, 5);
    });

    it('handles zero amps', () => {
      const factors = getPhaseFactors('retail');
      const distributed = distributePhaseAmps(0, factors);
      expect(distributed.l1).toBe(0);
      expect(distributed.l2).toBe(0);
      expect(distributed.l3).toBe(0);
    });

    it('scales linearly with total amps', () => {
      const factors = getPhaseFactors('warehouse_simple');
      const d50 = distributePhaseAmps(50, factors);
      const d100 = distributePhaseAmps(100, factors);
      expect(d100.l1).toBeCloseTo(d50.l1 * 2, 5);
      expect(d100.l2).toBeCloseTo(d50.l2 * 2, 5);
      expect(d100.l3).toBeCloseTo(d50.l3 * 2, 5);
    });
  });

  describe('validatePhaseFactors', () => {
    it('accepts factors that sum to 1.0', () => {
      expect(validatePhaseFactors({ l1: 0.34, l2: 0.33, l3: 0.33 })).toBe(true);
    });

    it('accepts factors that are close to 1.0 (floating point tolerance)', () => {
      // 0.38 + 0.31 + 0.31 = 1.00 exactly
      expect(validatePhaseFactors({ l1: 0.38, l2: 0.31, l3: 0.31 })).toBe(true);
    });

    it('rejects factors that sum to more than 1.0 + tolerance', () => {
      expect(validatePhaseFactors({ l1: 0.5, l2: 0.4, l3: 0.3 })).toBe(false);
    });

    it('rejects factors that sum to less than 1.0 - tolerance', () => {
      expect(validatePhaseFactors({ l1: 0.2, l2: 0.2, l3: 0.2 })).toBe(false);
    });
  });
});
