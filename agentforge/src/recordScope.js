/** Allow fixture records without a patient reference but reject explicit mismatches. */
export function recordBelongsToPatient(record, patientRef) {
  return !record?.patient_ref || String(record.patient_ref) === String(patientRef);
}
