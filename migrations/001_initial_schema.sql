-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE api_keys (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key_hash        VARCHAR(64) NOT NULL UNIQUE,
    app_name        VARCHAR(100) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    notes           TEXT
);

CREATE TABLE building_profiles (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id                 VARCHAR(100) NOT NULL UNIQUE,
    site_name               VARCHAR(255),
    address                 VARCHAR(500),
    postcode                VARCHAR(10),
    uprn                    VARCHAR(20),
    building_type           VARCHAR(50) NOT NULL DEFAULT 'unknown',
    building_age            VARCHAR(20) NOT NULL DEFAULT 'unknown',
    floor_area_m2           DECIMAL(10,2),
    elexon_profile_class    INTEGER NOT NULL DEFAULT 3,
    cibse_category          VARCHAR(50) NOT NULL DEFAULT 'unknown',
    classified_by           VARCHAR(20) NOT NULL DEFAULT 'pending',
    classified_at           TIMESTAMPTZ,
    building_type_override  VARCHAR(50),
    floor_area_override     DECIMAL(10,2),
    building_age_override   VARCHAR(20),
    phase_l1_factor         DECIMAL(5,4) NOT NULL DEFAULT 0.3400,
    phase_l2_factor         DECIMAL(5,4) NOT NULL DEFAULT 0.3300,
    phase_l3_factor         DECIMAL(5,4) NOT NULL DEFAULT 0.3300,
    phase_factor_source     VARCHAR(30) NOT NULL DEFAULT 'building_type_default',
    confidence_level        VARCHAR(20) NOT NULL DEFAULT 'STATISTICAL',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_building_profiles_site_id ON building_profiles(site_id);
CREATE INDEX idx_building_profiles_postcode ON building_profiles(postcode);
CREATE INDEX idx_building_profiles_building_type ON building_profiles(building_type);

CREATE TABLE epc_records (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id                 VARCHAR(100) NOT NULL,
    building_reference      VARCHAR(50),
    uprn                    VARCHAR(20),
    floor_area_m2           DECIMAL(10,2),
    property_type           VARCHAR(100),
    main_activity           VARCHAR(200),
    energy_rating           VARCHAR(5),
    asset_rating            INTEGER,
    lodgement_date          DATE,
    fetched_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    api_response_raw        JSONB,
    is_current              BOOLEAN NOT NULL DEFAULT TRUE,
    fetch_status            VARCHAR(20) NOT NULL DEFAULT 'success',
    error_message           TEXT,
    FOREIGN KEY (site_id) REFERENCES building_profiles(site_id) ON DELETE CASCADE
);

CREATE INDEX idx_epc_records_site_id ON epc_records(site_id);
CREATE INDEX idx_epc_records_is_current ON epc_records(site_id, is_current) WHERE is_current = TRUE;
CREATE INDEX idx_epc_records_fetched_at ON epc_records(fetched_at DESC);

CREATE TABLE elexon_profiles (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_class       INTEGER NOT NULL,
    season              VARCHAR(20) NOT NULL,
    day_type            VARCHAR(10) NOT NULL,
    period_index        INTEGER NOT NULL,
    period_start_hhmm   VARCHAR(5) NOT NULL,
    coefficient         DECIMAL(12,8) NOT NULL,
    data_version        VARCHAR(20) NOT NULL DEFAULT '1.0',
    seeded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(profile_class, season, day_type, period_index)
);

CREATE INDEX idx_elexon_profiles_lookup ON elexon_profiles(profile_class, season, day_type, period_index);

CREATE TABLE cibse_benchmarks (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category            VARCHAR(50) NOT NULL UNIQUE,
    description         VARCHAR(255) NOT NULL,
    good_practice_kwh   DECIMAL(8,2) NOT NULL,
    typical_kwh         DECIMAL(8,2) NOT NULL,
    source              VARCHAR(50) NOT NULL DEFAULT 'CIBSE_TM46',
    notes               TEXT,
    seeded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE age_multipliers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    age_band        VARCHAR(20) NOT NULL UNIQUE,
    multiplier      DECIMAL(5,3) NOT NULL,
    description     VARCHAR(100),
    seeded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE building_load_estimates (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id                 VARCHAR(100) NOT NULL,
    calculated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_from              TIMESTAMPTZ NOT NULL,
    valid_until             TIMESTAMPTZ NOT NULL,
    half_hour_period        INTEGER NOT NULL,
    season                  VARCHAR(20) NOT NULL,
    day_type                VARCHAR(10) NOT NULL,
    central_kw              DECIMAL(10,3) NOT NULL,
    p75_kw                  DECIMAL(10,3) NOT NULL,
    central_amps            DECIMAL(10,3) NOT NULL,
    p75_amps                DECIMAL(10,3) NOT NULL,
    l1_amps                 DECIMAL(10,3) NOT NULL,
    l2_amps                 DECIMAL(10,3) NOT NULL,
    l3_amps                 DECIMAL(10,3) NOT NULL,
    floor_area_m2           DECIMAL(10,2) NOT NULL,
    profile_class           INTEGER NOT NULL,
    confidence_level        VARCHAR(20) NOT NULL,
    annual_kwh_p75          DECIMAL(12,2) NOT NULL,
    FOREIGN KEY (site_id) REFERENCES building_profiles(site_id) ON DELETE CASCADE
);

CREATE INDEX idx_estimates_site_valid ON building_load_estimates(site_id, valid_until DESC);
CREATE INDEX idx_estimates_calculated ON building_load_estimates(calculated_at DESC);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER building_profiles_updated_at
    BEFORE UPDATE ON building_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
