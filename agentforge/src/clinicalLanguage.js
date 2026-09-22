/** Display labels are separate from the wire-schema field identifiers. */
export function clinicalLabel(field) {
  if (field === 'encounter.reason') return 'visit reason';
  if (field === 'note.plan_follow_through') return 'plan follow-through';
  const parts = String(field).split('.');
  const label = parts.length > 2 ? parts.slice(1, -1).join(' ') : parts.slice(1).join(' ') || parts[0];
  return label.replaceAll('_', ' ');
}

export function clinicalFact(claim) {
  const label = clinicalLabel(claim.field);
  const name = label.charAt(0).toUpperCase() + label.slice(1);
  if (claim.field.startsWith('problem.')) return `${name} is documented as ${claim.value}`;
  if (claim.field.startsWith('medication.')) return `${name} is recorded at ${claim.value}`;
  if (claim.field.startsWith('note.')) return `The note records “${claim.value}”`;
  return `${name}: ${claim.value}`;
}
