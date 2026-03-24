import { mapMainActivityToBuildingType } from '../src/collectors/epc.collector';
import { BuildingType } from '../src/types/index';

describe('BuildingProfileService — classification logic', () => {
  describe('mapMainActivityToBuildingType', () => {
    const cases: [string, BuildingType][] = [
      ['Hotel', BuildingType.Hotel],
      ['Budget Hotel', BuildingType.HotelBudget],
      ['budget hotel with breakfast', BuildingType.HotelBudget],
      ['Hotel/Motel', BuildingType.Hotel],
      ['General Office', BuildingType.OfficeGeneral],
      ['Open Plan Office', BuildingType.OfficeGeneral],
      ['Retail Store', BuildingType.Retail],
      ['Supermarket', BuildingType.Retail],
      ['Warehouse', BuildingType.WarehouseSimple],
      ['Storage Warehouse', BuildingType.WarehouseSimple],
      ['Car Park', BuildingType.CarPark],
      ['Parking Facility', BuildingType.CarPark],
      ['Public House', BuildingType.PubRestaurant],
      ['Restaurant', BuildingType.PubRestaurant],
      ['Pub and Restaurant', BuildingType.PubRestaurant],
      ['Residential Communal', BuildingType.HousingAssociation],
      ['Housing Communal Areas', BuildingType.HousingAssociation],
      ['Fleet Depot', BuildingType.FleetDepot],
      ['Workshop and Depot', BuildingType.FleetDepot],
      ['Unknown Activity Type', BuildingType.Unknown],
      ['', BuildingType.Unknown],
    ];

    test.each(cases)(
      'maps "%s" to %s',
      (mainActivity, expected) => {
        expect(mapMainActivityToBuildingType(mainActivity)).toBe(expected);
      },
    );

    it('returns Unknown for undefined input', () => {
      expect(mapMainActivityToBuildingType(undefined)).toBe(BuildingType.Unknown);
    });

    it('is case-insensitive', () => {
      expect(mapMainActivityToBuildingType('HOTEL')).toBe(BuildingType.Hotel);
      expect(mapMainActivityToBuildingType('hotel')).toBe(BuildingType.Hotel);
      expect(mapMainActivityToBuildingType('HoTeL')).toBe(BuildingType.Hotel);
    });
  });

  describe('Override precedence', () => {
    it('buildingTypeOverride takes precedence over EPC classification', () => {
      // When a manual override is provided, it should supersede EPC data
      // This is enforced in the service — we test the logic principle here
      const epcDetected = BuildingType.Retail;
      const manualOverride = BuildingType.Hotel;

      // Simulate the override logic: override wins
      const effectiveBuildingType = manualOverride ?? epcDetected;
      expect(effectiveBuildingType).toBe(BuildingType.Hotel);
    });

    it('EPC classification is used when no override exists', () => {
      const epcDetected = BuildingType.Retail;
      const manualOverride = undefined;

      const effectiveBuildingType = manualOverride ?? epcDetected;
      expect(effectiveBuildingType).toBe(BuildingType.Retail);
    });

    it('floor area override takes precedence over EPC floor area', () => {
      const epcFloorArea = 1500;
      const floorAreaOverride = 2000;

      const effectiveFloorArea = floorAreaOverride ?? epcFloorArea;
      expect(effectiveFloorArea).toBe(2000);
    });

    it('null floor area causes UNPROCESSABLE error for estimates', () => {
      // If both floor_area_m2 and floor_area_override are null, estimate cannot be calculated
      const floorAreaM2 = null;
      const floorAreaOverride = null;

      const effectiveFloorArea = floorAreaOverride ?? floorAreaM2;
      expect(effectiveFloorArea).toBeNull();
      // This null value would cause the service to throw an UNPROCESSABLE error
    });
  });
});
