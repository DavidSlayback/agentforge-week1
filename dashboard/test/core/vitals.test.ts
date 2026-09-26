import { describe, expect, it } from 'vitest';
import { isPediatric, latestVitalsSet, phpNumberFormat, vitalsFields, type VitalsSet } from '../../core/rules/vitals.ts';

const US_UNITS = {
  bps_unit: 'mm[Hg]',
  height_unit: 'in',
  weight_unit: 'lb',
  temperature_unit: 'degF',
  pulse_unit: '/min',
  respiration_unit: '/min',
  BMI_unit: 'kg/m2',
  waist_circ_unit: 'in',
  head_circ_unit: 'in',
  oxygen_saturation_unit: '%',
  oxygen_flow_rate_unit: 'L/min',
  inhaled_oxygen_concentration_unit: '%',
} as const;

describe('latestVitalsSet', () => {
  it('picks the latest date, whatever the row order, and breaks a date tie on the higher id', () => {
    const rows: VitalsSet[] = [
      { id: '5', date: '2026-04-05 09:10:00' },
      { id: '7', date: '2026-04-05 09:10:00' },
      { id: '9', date: '2025-01-01 00:00:00' },
    ];
    expect(latestVitalsSet(rows)?.id).toBe('7');
    expect(latestVitalsSet([...rows].reverse())?.id).toBe('7');
    expect(latestVitalsSet([{ id: '10', date: '2026-04-05' }, { id: '2', date: '2026-04-05 00:00:01' }])?.id).toBe('2');
    expect(latestVitalsSet([])).toBeNull();
  });
});

describe('isPediatric: getPatientAge(DOB) <= 20 or an age in months (report.php:39-40)', () => {
  it('is true through age 20 and false from 21, and true for infants (months)', () => {
    expect(isPediatric('2007-02-18', '2026-09-25')).toBe(true); // 19
    expect(isPediatric('2005-09-25', '2026-09-25')).toBe(false); // 21 today
    expect(isPediatric('2005-09-26', '2026-09-25')).toBe(true); // still 20
    expect(isPediatric('2026-01-01', '2026-09-25')).toBe(true); // "8 months"
    expect(isPediatric('1970-04-12', '2026-09-25')).toBe(false);
    expect(isPediatric(null, '2026-09-25')).toBe(false);
  });
});

describe('phpNumberFormat', () => {
  it('rounds half away from zero and groups thousands like PHP number_format', () => {
    expect(phpNumberFormat(31.2, 0)).toBe('31');
    expect(phpNumberFormat(2.5, 0)).toBe('3');
    expect(phpNumberFormat(-2.5, 0)).toBe('-3');
    expect(phpNumberFormat(1234.5, 0)).toBe('1,235');
    expect(phpNumberFormat(2, 2)).toBe('2.00');
    expect(phpNumberFormat(0.125, 2)).toBe('0.13');
  });
});

describe('vitalsFields: the legacy order, labels, skip rule and formats, with the API units', () => {
  it('an adult set (DASH-SYN-01 set 35 values) renders in form_vitals column order', () => {
    const set: VitalsSet = {
      id: '35',
      date: '2026-04-05 09:10:00',
      bps: '128',
      bpd: '82',
      weight: '176.000000',
      height: '65.000000',
      temperature: '98.200000',
      temp_method: 'Oral',
      pulse: '72.000000',
      respiration: '14.000000',
      note: 'synthetic note',
      BMI: '29.300000',
      BMI_status: 'Overweight',
      waist_circ: null,
      head_circ: null,
      oxygen_saturation: '98.00',
      oxygen_flow_rate: null,
      inhaled_oxygen_concentration: null,
      ...US_UNITS,
    };
    expect(vitalsFields(set, false)).toEqual([
      { label: 'Blood Pressure', value: '128/82 mmHg' },
      { label: 'Height', value: '65 in' },
      { label: 'Weight', value: '176 lb' },
      { label: 'Temperature', value: '98.2 F' },
      { label: 'Temp Method', value: 'Oral' },
      { label: 'Pulse', value: '72 per min' },
      { label: 'Respiration', value: '14 per min' },
      { label: 'Note', value: 'synthetic note' },
      { label: 'BMI', value: '29 kg/m^2' },
      { label: 'BMI Status', value: 'Overweight' },
      { label: 'Oxygen Saturation', value: '98 %' },
    ]);
  });

  it('skips null, empty and numeric-zero values ("0.0" rule), and needs both halves of the blood pressure', () => {
    const fields = vitalsFields({ id: '1', bps: '120', bpd: '', pulse: '0.000000', respiration: '0', oxygen_flow_rate: '0.5', temp_method: '', ...US_UNITS }, false);
    expect(fields).toEqual([{ label: 'Oxygen Flow Rate', value: '0.50 l/min' }]);
  });

  it('pediatric: BMI Status reads "See Growth-Chart" and non-zero percentiles show; adults never see percentiles', () => {
    const set: VitalsSet = { id: '1', BMI: '17.6', BMI_status: 'Underweight', ped_bmi: '45.4', ped_weight_height: '0.00', ...US_UNITS };
    expect(vitalsFields(set, true)).toEqual([
      { label: 'BMI', value: '18 kg/m^2' },
      { label: 'BMI Status', value: 'See Growth-Chart' },
      { label: 'Pediatric BMI Percentile', value: '45 %' },
    ]);
    expect(vitalsFields(set, false).map((f) => f.label)).toEqual(['BMI', 'BMI Status']);
  });

  it('shows metric units when the API returns them, and an unknown unit code as returned', () => {
    expect(vitalsFields({ id: '1', weight: 79.83, weight_unit: 'kg', temperature: 36.8, temperature_unit: 'Cel', height: 165.1, height_unit: 'furlong' }, false)).toEqual([
      { label: 'Height', value: '165.1 furlong' },
      { label: 'Weight', value: '79.83 kg' },
      { label: 'Temperature', value: '36.8 C' },
    ]);
  });
});
