INSERT INTO cibse_benchmarks (category, description, good_practice_kwh, typical_kwh, notes)
VALUES
    ('hotel', 'Hotel/motel with restaurant and bar', 150, 220, 'CIBSE TM46 Table 1. Includes HVAC, lighting, catering equipment.'),
    ('hotel_budget', 'Budget hotel, limited facilities', 100, 160, 'CIBSE TM46 Table 1. Limited food service, simpler HVAC.'),
    ('housing_association', 'Residential communal areas and shared building services', 25, 45, 'Communal lighting, lifts, door entry, shared plant rooms only. Excludes individual dwelling consumption.'),
    ('fleet_depot', 'Warehouse/depot with workshop and office areas', 45, 80, 'CIBSE TM46 Table 1. Mix of warehouse, workshop, and office. Excludes EV charging load.'),
    ('warehouse_simple', 'Simple storage warehouse, minimal HVAC', 30, 55, 'CIBSE TM46. Lighting-dominated load, minimal process energy.'),
    ('car_park', 'Car park with lighting and access control only', 8, 15, 'CIBSE TM46. Low load factor. Predominantly lighting. Excludes EV charging load.'),
    ('car_park_with_facilities', 'Car park with kiosk, lifts, or facilities building', 20, 38, 'Higher than basic car park due to lifts and heated kiosk.'),
    ('office_general', 'General open-plan office', 95, 160, 'CIBSE TM46 Table 1. IT and small power significant component.'),
    ('retail', 'Retail store or supermarket', 185, 280, 'CIBSE TM46. Lighting and refrigeration dominant.'),
    ('pub_restaurant', 'Public house or restaurant', 280, 450, 'CIBSE TM46. Catering equipment dominant load. High variance by trading hours.'),
    ('unknown', 'Unknown building type — conservative estimate applied', 60, 110, 'Fallback values used when building type cannot be determined. Deliberately conservative to avoid under-estimating building load.')
ON CONFLICT (category) DO NOTHING;

INSERT INTO age_multipliers (age_band, multiplier, description)
VALUES
    ('pre_1970',  1.65, 'Pre-1970 stock, poor insulation, older plant'),
    ('1970_1990', 1.40, '1970-1990 stock, some upgrades likely'),
    ('1990_2005', 1.20, '1990-2005 stock, Part L improvements'),
    ('post_2005', 1.00, 'Post-2005, modern standards baseline'),
    ('unknown',   1.35, 'Age unknown — conservative default applied')
ON CONFLICT (age_band) DO NOTHING;
