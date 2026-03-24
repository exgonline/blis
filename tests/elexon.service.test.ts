import { getSeason, getDayType } from '../src/utils/season';
import { ElexonSeason, DayType } from '../src/types/index';
import profileData from '../src/data/elexon-profiles.json';
import type { ElexonProfileData } from '../src/types/index';

const data = profileData as ElexonProfileData;

describe('Elexon profile data', () => {
  const profileClasses = ['1', '2', '3', '5', '6', '7'];
  const seasons = ['winter', 'spring', 'summer', 'high_summer', 'autumn'];
  const dayTypes = ['weekday', 'saturday', 'sunday'];

  describe('coefficient count', () => {
    profileClasses.forEach((pc) => {
      seasons.forEach((season) => {
        dayTypes.forEach((dayType) => {
          it(`PC${pc} ${season} ${dayType} has exactly 48 coefficients`, () => {
            const seasonData = data.profiles[pc];
            expect(seasonData).toBeDefined();
            const dayData = (seasonData as Record<string, Record<string, number[]>>)[season];
            expect(dayData).toBeDefined();
            const coefficients = dayData![dayType];
            expect(coefficients).toBeDefined();
            expect(coefficients!.length).toBe(48);
          });
        });
      });
    });
  });

  describe('coefficient positivity', () => {
    profileClasses.forEach((pc) => {
      seasons.forEach((season) => {
        dayTypes.forEach((dayType) => {
          it(`PC${pc} ${season} ${dayType} has all positive coefficients`, () => {
            const coefficients = (
              (data.profiles[pc] as Record<string, Record<string, number[]>>)[season]
            )![dayType]!;

            for (const coeff of coefficients) {
              expect(coeff).toBeGreaterThan(0);
            }
          });
        });
      });
    });
  });

  describe('getSeason — boundary dates', () => {
    it('returns winter for December', () => {
      expect(getSeason(new Date('2024-12-15T12:00:00Z'))).toBe(ElexonSeason.Winter);
    });

    it('returns winter for January', () => {
      expect(getSeason(new Date('2024-01-20T12:00:00Z'))).toBe(ElexonSeason.Winter);
    });

    it('returns winter for February', () => {
      expect(getSeason(new Date('2024-02-14T12:00:00Z'))).toBe(ElexonSeason.Winter);
    });

    it('returns spring for March', () => {
      expect(getSeason(new Date('2024-03-15T12:00:00Z'))).toBe(ElexonSeason.Spring);
    });

    it('returns spring for April', () => {
      expect(getSeason(new Date('2024-04-20T12:00:00Z'))).toBe(ElexonSeason.Spring);
    });

    it('returns summer for May', () => {
      expect(getSeason(new Date('2024-05-15T12:00:00Z'))).toBe(ElexonSeason.Summer);
    });

    it('returns summer for early July (before high_summer)', () => {
      expect(getSeason(new Date('2024-07-01T12:00:00Z'))).toBe(ElexonSeason.Summer);
    });

    it('returns summer for September', () => {
      expect(getSeason(new Date('2024-09-15T12:00:00Z'))).toBe(ElexonSeason.Summer);
    });

    it('returns autumn for October', () => {
      expect(getSeason(new Date('2024-10-15T12:00:00Z'))).toBe(ElexonSeason.Autumn);
    });

    it('returns winter for November', () => {
      expect(getSeason(new Date('2024-11-15T12:00:00Z'))).toBe(ElexonSeason.Winter);
    });

    it('returns high_summer for August (before last Monday)', () => {
      expect(getSeason(new Date('2024-08-01T12:00:00Z'))).toBe(ElexonSeason.HighSummer);
    });
  });

  describe('getDayType — known dates', () => {
    it('returns weekday for a Monday', () => {
      expect(getDayType(new Date('2024-01-08T12:00:00Z'))).toBe(DayType.Weekday); // Monday
    });

    it('returns weekday for a Friday', () => {
      expect(getDayType(new Date('2024-01-12T12:00:00Z'))).toBe(DayType.Weekday); // Friday
    });

    it('returns saturday for a Saturday', () => {
      expect(getDayType(new Date('2024-01-13T12:00:00Z'))).toBe(DayType.Saturday); // Saturday
    });

    it('returns sunday for a Sunday', () => {
      expect(getDayType(new Date('2024-01-14T12:00:00Z'))).toBe(DayType.Sunday); // Sunday
    });

    it('returns sunday for Christmas Day 2024 (bank holiday)', () => {
      expect(getDayType(new Date('2024-12-25T12:00:00Z'))).toBe(DayType.Sunday);
    });

    it('returns sunday for New Year Day 2025 (bank holiday)', () => {
      expect(getDayType(new Date('2025-01-01T12:00:00Z'))).toBe(DayType.Sunday);
    });
  });
});
