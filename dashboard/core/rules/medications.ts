/**
 * Medications dosage instructions (slice 01-06-04, catalog 4.05).
 *
 * The legacy card prints `lists_medication.drug_dosage_instructions` after each
 * title (`templates/patient/card/medication.html.twig`). The REST medication
 * list the card is built from has no such column, so the BFF reads FHIR
 * `MedicationRequest?intent=plan` and joins it to the REST rows **by uuid**:
 * a lists-medication row and its MedicationRequest share `lists.uuid`.
 *
 * `intent` is filtered again here, so a server that ignored the search
 * parameter could not attach a prescription's instructions to a medication
 * (uuids differ across tables anyway; this is belt and braces).
 */

export interface MedicationForJoin {
  readonly uuid: string;
  readonly title: string;
}

export interface MedicationRequestForJoin {
  readonly id: string;
  readonly intent: string | undefined;
  /** Every `dosageInstruction[].text`, in order, as served. */
  readonly dosageTexts: readonly string[];
}

export interface JoinedMedication {
  readonly title: string;
  /** The instructions to show after the title, or null when none are recorded. */
  readonly dosage: string | null;
}

export interface DosageJoin {
  readonly rows: readonly JoinedMedication[];
  /** Medications with no `intent=plan` MedicationRequest of the same uuid. */
  readonly unmatched: number;
}

export function joinDosageInstructions(medications: readonly MedicationForJoin[], requests: readonly MedicationRequestForJoin[]): DosageJoin {
  const byId = new Map<string, string | null>();
  for (const r of requests) {
    if (r.intent !== 'plan') continue;
    const texts = r.dosageTexts.map((t) => t.trim()).filter((t) => t !== '');
    byId.set(r.id.toLowerCase(), texts.length > 0 ? texts.join('; ') : null);
  }
  let unmatched = 0;
  const rows = medications.map((m): JoinedMedication => {
    const key = m.uuid.toLowerCase();
    if (!byId.has(key)) {
      unmatched += 1;
      return { title: m.title, dosage: null };
    }
    return { title: m.title, dosage: byId.get(key) ?? null };
  });
  return { rows, unmatched };
}
