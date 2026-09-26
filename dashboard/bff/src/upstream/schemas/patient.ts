import { z } from 'zod';

/**
 * FHIR `Patient` as serialized by `FhirPatientService::parseOpenEMRRecord()`
 * (`src/Services/FHIR/FhirPatientService.php:196-257@legacy-baseline`). Only
 * the fields the header reads are declared; others are stripped.
 */
export const fhirPatientSchema = z.object({
  resourceType: z.literal('Patient'),
  id: z.string().min(1),
  active: z.boolean().optional(),
  name: z
    .array(
      z.object({
        use: z.string().optional(),
        family: z.string().optional(),
        given: z.array(z.string()).optional(),
        suffix: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  gender: z.enum(['male', 'female', 'other', 'unknown']).optional(),
  birthDate: z.string().optional(),
  deceasedDateTime: z.string().optional(),
  deceasedBoolean: z.boolean().optional(),
  identifier: z
    .array(
      z.object({
        type: z.object({ coding: z.array(z.object({ code: z.string().optional() })).optional() }).optional(),
        value: z.string().optional(),
      }),
    )
    .optional(),
});
export type FhirPatient = z.infer<typeof fhirPatientSchema>;

/** A FHIR search Bundle of Patients (`GET /fhir/Patient?identifier=`). */
export const fhirPatientBundleSchema = z.object({
  resourceType: z.literal('Bundle'),
  total: z.number().int().min(0).optional(),
  entry: z.array(z.object({ resource: fhirPatientSchema })).optional(),
});
export type FhirPatientBundle = z.infer<typeof fhirPatientBundleSchema>;

/**
 * The `data` object of `GET /api/patient/:puuid` (`patient_data.*`,
 * `PatientService.php:426-427@legacy-baseline`). The BFF reads it only to
 * resolve the integer `pid` once (10.04) and to cross-check the identity.
 */
export const restPatientSchema = z.object({
  uuid: z.string().min(1),
  pid: z.union([z.number(), z.string()]),
  pubpid: z.string().nullable().optional(),
});
export type RestPatient = z.infer<typeof restPatientSchema>;
