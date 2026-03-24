import {
  annualKwhToHalfHourKw,
  kwToAmpsThreePhase,
  POWER_FACTOR,
  VOLTAGE_LINE,
  SQRT3,
  P75_MULTIPLIER,
} from '../src/services/building-load.service';
import { PHASE_DISTRIBUTION_FACTORS, validatePhaseFactors } from '../src/utils/phase';

describe('BuildingLoadService — core calculations', () => {
  describe('annualKwhToHalfHourKw', () => {
    it('converts annual kWh and coefficient to kW correctly', () => {
      // 100,000 kWh/year, coefficient = 0.00274 (average)
      const kw = annualKwhToHalfHourKw(100_000, 0.00274);
      // kWh_in_period = 100000 * 0.00274 = 274
      // kW = 274 / 0.5 = 548
      expect(kw).toBeCloseTo(548, 0);
    });

    it('returns 0 for zero annual kWh', () => {
      expect(annualKwhToHalfHourKw(0, 0.00274)).toBe(0);
    });

    it('returns 0 for zero coefficient', () => {
      expect(annualKwhToHalfHourKw(100_000, 0)).toBe(0);
    });

    it('scales linearly with annual kWh', () => {
      const kw1 = annualKwhToHalfHourKw(50_000, 0.001);
      const kw2 = annualKwhToHalfHourKw(100_000, 0.001);
      expect(kw2).toBeCloseTo(kw1 * 2, 5);
    });
  });

  describe('kwToAmpsThreePhase', () => {
    it('converts kW to amps for 400V three-phase at PF 0.95', () => {
      // I = (kW * 1000) / (√3 × 400 × 0.95)
      const expectedAmps = (100 * 1000) / (SQRT3 * VOLTAGE_LINE * POWER_FACTOR);
      expect(kwToAmpsThreePhase(100)).toBeCloseTo(expectedAmps, 4);
    });

    it('returns 0 for 0 kW', () => {
      expect(kwToAmpsThreePhase(0)).toBe(0);
    });

    it('scales linearly with kW', () => {
      const a1 = kwToAmpsThreePhase(50);
      const a2 = kwToAmpsThreePhase(100);
      expect(a2).toBeCloseTo(a1 * 2, 5);
    });

    it('uses correct formula constants', () => {
      // At 100 kW, three-phase 400V, PF 0.95
      // Expected: (100000) / (1.7320508 * 400 * 0.95) ≈ 151.97 A
      expect(kwToAmpsThreePhase(100)).toBeCloseTo(151.97, 1);
    });
  });

  describe('Phase factor validation', () => {
    it('phase factors sum to 1.0 for all building types', () => {
      for (const [buildingType, factors] of Object.entries(PHASE_DISTRIBUTION_FACTORS)) {
        const sum = factors.l1 + factors.l2 + factors.l3;
        expect(sum).toBeCloseTo(1.0, 2);
      }
    });

    it('validatePhaseFactors returns true for valid factors', () => {
      expect(validatePhaseFactors({ l1: 0.34, l2: 0.33, l3: 0.33 })).toBe(true);
    });

    it('validatePhaseFactors returns false for invalid factors', () => {
      expect(validatePhaseFactors({ l1: 0.5, l2: 0.5, l3: 0.5 })).toBe(false);
    });

    it('all defined building types have positive phase factors', () => {
      for (const factors of Object.values(PHASE_DISTRIBUTION_FACTORS)) {
        expect(factors.l1).toBeGreaterThan(0);
        expect(factors.l2).toBeGreaterThan(0);
        expect(factors.l3).toBeGreaterThan(0);
      }
    });
  });

  describe('P75 calculation', () => {
    it('P75 is always >= central estimate', () => {
      const centralKwh = 50_000;
      const coefficient = 0.002;
      const centralKw = annualKwhToHalfHourKw(centralKwh, coefficient);
      const p75Kw = annualKwhToHalfHourKw(centralKwh * P75_MULTIPLIER, coefficient);
      expect(p75Kw).toBeGreaterThanOrEqual(centralKw);
    });

    it('P75 multiplier is 1.15', () => {
      expect(P75_MULTIPLIER).toBe(1.15);
    });

    it('P75 is exactly 15% above central', () => {
      const central = annualKwhToHalfHourKw(100_000, 0.002);
      const p75 = annualKwhToHalfHourKw(100_000 * P75_MULTIPLIER, 0.002);
      expect(p75).toBeCloseTo(central * 1.15, 5);
    });
  });

  describe('Unknown building type fallback', () => {
    it('unknown building type has defined phase factors', () => {
      const factors = PHASE_DISTRIBUTION_FACTORS['unknown'];
      expect(factors).toBeDefined();
      expect(factors!.l1 + factors!.l2 + factors!.l3).toBeCloseTo(1.0, 2);
    });
  });
});
