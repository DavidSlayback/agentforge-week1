import { z } from 'zod';

/**
 * FHIR `CareTeam` as serialized by `FhirCareTeamService::parseOpenEMRRecord()`
 * (`src/Services/FHIR/FhirCareTeamService.php:103-157`) and its
 * `populate*TeamMembers()` helpers (:336-443). Only the fields the card reads
 * are declared; others are stripped. A participant has no status, no end date
 * and no note (M-6).
 */
const referenceSchema = z.object({ reference: z.string().optional(), type: z.string().optional(), display: z.string().optional() });

const codeableConceptSchema = z.object({
  coding: z.array(z.object({ system: z.string().optional(), code: z.string().optional(), display: z.string().optional() })).optional(),
  text: z.string().optional(),
});

export const fhirCareTeamParticipantSchema = z.object({
  role: z.array(codeableConceptSchema).optional(),
  member: referenceSchema.optional(),
  onBehalfOf: referenceSchema.optional(),
  period: z.object({ start: z.string().optional(), end: z.string().optional() }).optional(),
});
export type FhirCareTeamParticipant = z.infer<typeof fhirCareTeamParticipantSchema>;

export const fhirCareTeamSchema = z.object({
  resourceType: z.literal('CareTeam'),
  id: z.string().min(1),
  status: z.string().optional(),
  name: z.string().optional(),
  subject: referenceSchema.optional(),
  participant: z.array(fhirCareTeamParticipantSchema).optional(),
});
export type FhirCareTeam = z.infer<typeof fhirCareTeamSchema>;

/** The search Bundle (`FhirCareTeamRestController::getAll()`, no paging). Every entry must be a CareTeam. */
export const fhirCareTeamBundleSchema = z.object({
  resourceType: z.literal('Bundle'),
  total: z.number().int().min(0).optional(),
  entry: z.array(z.object({ resource: fhirCareTeamSchema })).optional(),
});

/** `GET /fhir/Practitioner/:id` (`FhirPractitionerService`): the name is all the card reads. */
export const fhirPractitionerSchema = z.object({
  resourceType: z.literal('Practitioner'),
  id: z.string().min(1),
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
});

/** `GET /fhir/Organization/:id` (`FhirOrganizationService`, a facility): the name is all the card reads. */
export const fhirOrganizationSchema = z.object({
  resourceType: z.literal('Organization'),
  id: z.string().min(1),
  name: z.string().optional(),
});
