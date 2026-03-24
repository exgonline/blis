import { getSeason, getDayType, getHalfHourPeriod } from '../src/utils/season';
import { ElexonSeason, DayType } from '../src/types/index';

describe('getSeason', () => {
  describe('winter', () => {
    it('mid-November is winter', () => {
      expect(getSeason(new Date('2024-11-15T12:00:00Z'))).toBe(ElexonSeason.Winter);
    });

    it('mid-December is winter', () => {
      expect(getSeason(new Date('2024-12-20T12:00:00Z'))).toBe(ElexonSeason.Winter);
    });

    it('January is winter', () => {
      expect(getSeason(new Date('2024-01-10T12:00:00Z'))).toBe(ElexonSeason.Winter);
    });

    it('February is winter', () => {
      expect(getSeason(new Date('2024-02-29T12:00:00Z'))).toBe(ElexonSeason.Winter); // 2024 is leap year
    });
  });

  describe('spring', () => {
    it('1 March is spring', () => {
      expect(getSeason(new Date('2024-03-01T12:00:00Z'))).toBe(ElexonSeason.Spring);
    });

    it('30 April is spring', () => {
      expect(getSeason(new Date('2024-04-30T12:00:00Z'))).toBe(ElexonSeason.Spring);
    });

    it('mid-March is spring', () => {
      expect(getSeason(new Date('2024-03-20T12:00:00Z'))).toBe(ElexonSeason.Spring);
    });
  });

  describe('summer', () => {
    it('May is summer', () => {
      expect(getSeason(new Date('2024-05-20T12:00:00Z'))).toBe(ElexonSeason.Summer);
    });

    it('June is summer', () => {
      expect(getSeason(new Date('2024-06-15T12:00:00Z'))).toBe(ElexonSeason.Summer);
    });

    it('September is summer', () => {
      expect(getSeason(new Date('2024-09-25T12:00:00Z'))).toBe(ElexonSeason.Summer);
    });
  });

  describe('high_summer', () => {
    it('August 1 is high_summer', () => {
      expect(getSeason(new Date('2024-08-01T12:00:00Z'))).toBe(ElexonSeason.HighSummer);
    });

    it('August 15 is high_summer', () => {
      expect(getSeason(new Date('2024-08-15T12:00:00Z'))).toBe(ElexonSeason.HighSummer);
    });
  });

  describe('autumn', () => {
    it('October is autumn', () => {
      expect(getSeason(new Date('2024-10-10T12:00:00Z'))).toBe(ElexonSeason.Autumn);
    });

    it('31 October is autumn', () => {
      expect(getSeason(new Date('2024-10-31T12:00:00Z'))).toBe(ElexonSeason.Autumn);
    });
  });

  describe('clock change boundary handling', () => {
    it('handles UTC time on BST clock change day (last Sunday March)', () => {
      // 31 March 2024 — clocks go forward (BST starts)
      // Should still be spring regardless of local time zone
      const season = getSeason(new Date('2024-03-31T01:30:00Z'));
      expect(season).toBe(ElexonSeason.Spring);
    });

    it('handles UTC time on GMT clock change day (last Sunday October)', () => {
      // 27 October 2024 — clocks go back (GMT resumes)
      const season = getSeason(new Date('2024-10-27T01:30:00Z'));
      expect(season).toBe(ElexonSeason.Autumn);
    });
  });
});

describe('getDayType', () => {
  it('Monday is weekday', () => {
    expect(getDayType(new Date('2024-01-08T12:00:00Z'))).toBe(DayType.Weekday);
  });

  it('Wednesday is weekday', () => {
    expect(getDayType(new Date('2024-01-10T12:00:00Z'))).toBe(DayType.Weekday);
  });

  it('Friday is weekday', () => {
    expect(getDayType(new Date('2024-01-12T12:00:00Z'))).toBe(DayType.Weekday);
  });

  it('Saturday is saturday', () => {
    expect(getDayType(new Date('2024-01-13T12:00:00Z'))).toBe(DayType.Saturday);
  });

  it('Sunday is sunday', () => {
    expect(getDayType(new Date('2024-01-14T12:00:00Z'))).toBe(DayType.Sunday);
  });

  it('Bank holiday treated as sunday', () => {
    // 25 December 2024 (Wednesday, but bank holiday)
    expect(getDayType(new Date('2024-12-25T12:00:00Z'))).toBe(DayType.Sunday);
  });

  it('Good Friday 2024 treated as sunday', () => {
    expect(getDayType(new Date('2024-03-29T12:00:00Z'))).toBe(DayType.Sunday);
  });

  it('Easter Monday 2024 treated as sunday', () => {
    expect(getDayType(new Date('2024-04-01T12:00:00Z'))).toBe(DayType.Sunday);
  });
});

describe('getHalfHourPeriod', () => {
  it('00:00 UTC is period 0', () => {
    expect(getHalfHourPeriod(new Date('2024-01-01T00:00:00Z'))).toBe(0);
  });

  it('00:29 UTC is period 0', () => {
    expect(getHalfHourPeriod(new Date('2024-01-01T00:29:00Z'))).toBe(0);
  });

  it('00:30 UTC is period 1', () => {
    expect(getHalfHourPeriod(new Date('2024-01-01T00:30:00Z'))).toBe(1);
  });

  it('12:00 UTC is period 24', () => {
    expect(getHalfHourPeriod(new Date('2024-01-01T12:00:00Z'))).toBe(24);
  });

  it('23:30 UTC is period 47', () => {
    expect(getHalfHourPeriod(new Date('2024-01-01T23:30:00Z'))).toBe(47);
  });

  it('23:59 UTC is period 47', () => {
    expect(getHalfHourPeriod(new Date('2024-01-01T23:59:00Z'))).toBe(47);
  });
});
