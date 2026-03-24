import { PhaseFactors } from '../types/index';

export const PHASE_DISTRIBUTION_FACTORS: Record<string, PhaseFactors> = {
  hotel:                    { l1: 0.38, l2: 0.31, l3: 0.31 },
  hotel_budget:             { l1: 0.37, l2: 0.32, l3: 0.31 },
  housing_association:      { l1: 0.40, l2: 0.30, l3: 0.30 },
  fleet_depot:              { l1: 0.34, l2: 0.33, l3: 0.33 },
  warehouse_simple:         { l1: 0.34, l2: 0.33, l3: 0.33 },
  car_park:                 { l1: 0.35, l2: 0.33, l3: 0.32 },
  car_park_with_facilities: { l1: 0.36, l2: 0.32, l3: 0.32 },
  office_general:           { l1: 0.36, l2: 0.32, l3: 0.32 },
  retail:                   { l1: 0.37, l2: 0.32, l3: 0.31 },
  pub_restaurant:           { l1: 0.38, l2: 0.31, l3: 0.31 },
  unknown:                  { l1: 0.34, l2: 0.33, l3: 0.33 },
};

/**
 * Get the phase distribution factors for a building type.
 * Falls back to 'unknown' if the building type is not found.
 */
export function getPhaseFactors(buildingType: string): PhaseFactors {
  return PHASE_DISTRIBUTION_FACTORS[buildingType] ?? PHASE_DISTRIBUTION_FACTORS['unknown']!;
}

/**
 * Distribute total amps across three phases using the given factors.
 */
export function distributePhaseAmps(
  totalAmps: number,
  factors: PhaseFactors,
): { l1: number; l2: number; l3: number } {
  return {
    l1: totalAmps * factors.l1,
    l2: totalAmps * factors.l2,
    l3: totalAmps * factors.l3,
  };
}

/**
 * Validate that phase factors sum to approximately 1.0 (within floating point tolerance).
 */
export function validatePhaseFactors(factors: PhaseFactors): boolean {
  const sum = factors.l1 + factors.l2 + factors.l3;
  return Math.abs(sum - 1.0) < 0.001;
}
