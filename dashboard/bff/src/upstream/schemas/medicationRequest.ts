import { z } from 'zod';

/**
 * FHIR `MedicationRequest` as serialized by
 * `FhirMedicationRequestService::parseOpenEMRRecord()`
 * (`src/Services/FHIR/FhirMedicationRequestService.php:132-200@legacy-baseline`).
 * Only what the Medications card reads is declared:
 *
 * - `id` is the source row's uuid (`populateId()`); for the lists branch of
 *   `PrescriptionService::getBaseSql()` that is `lists.uuid`, the same uuid the
 *   REST medication list serves, which is the join key;
 * - `intent` is `plan` for lists rows without a `lists_medication.request_intent`
 *   (`PrescriptionService.php:212`) and `order` by default for prescriptions (:156);
 * - `subject.reference` is `Patient/<puuid>` (`populateSubject()`, :420-429);
 * - `dosageInstruction[].text` is `drug_dosage_instructions` (else `dosage`),
 *   set only when non-empty and not numeric (`populateDosageInstruction()`, :253-266).
 */
export const fhirMedicationRequestSchema = z.object({
  resourceType: z.literal('MedicationRequest'),
  id: z.string().min(1),
  intent: z.string().optional(),
  subject: z.object({ reference: z.string().optional() }).optional(),
  dosageInstruction: z.array(z.object({ text: z.string().optional() })).optional(),
});
export type FhirMedicationRequest = z.infer<typeof fhirMedicationRequestSchema>;

/** The search Bundle (`FhirMedicationRequestRestController::getAll()`). Every entry must be a MedicationRequest. */
export const fhirMedicationRequestBundleSchema = z.object({
  resourceType: z.literal('Bundle'),
  total: z.number().int().min(0).optional(),
  entry: z.array(z.object({ resource: fhirMedicationRequestSchema })).optional(),
});
