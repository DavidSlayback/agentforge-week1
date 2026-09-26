/** Display labels are separate from the wire-schema field identifiers. */
export function clinicalLabel(field) {
  if (field === 'encounter.reason') return 'visit reason';
  if (field === 'note.plan_follow_through') return 'plan follow-through';
  const parts = String(field).split('.');
  const label = parts.length > 2 ? parts.slice(1, -1).join(' ') : parts.slice(1).join(' ') || parts[0];
  // A live OpenEMR medication row's free-text comments (openemrAdapter.js) is labeled as such, not as a dose.
  if (parts[0] === 'medication' && parts.length > 2 && parts.at(-1) === 'comment') return `${label.replaceAll('_', ' ')} instructions/comment`;
  return label.replaceAll('_', ' ');
}

export function clinicalFact(claim) {
  const label = clinicalLabel(claim.field);
  const name = label.charAt(0).toUpperCase() + label.slice(1);
  if (claim.field.startsWith('problem.')) return `${name} is documented as ${claim.value}`;
  // Live OpenEMR medication rows (openemrAdapter.js): a route with no dose says
  // so, and free-text comments are rendered as instructions/comment, not a dose.
  if (claim.field.startsWith('medication.') && claim.field.endsWith('.dose') && claim.value === 'dose not available from this OpenEMR route') return `${name}: ${claim.value}`;
  if (claim.field.startsWith('medication.') && claim.field.endsWith('.comment')) return `${name}: ${claim.value}`;
  if (claim.field.startsWith('medication.')) return `${name} is recorded at ${claim.value}`;
  if (claim.field.startsWith('note.')) return `The note records “${claim.value}”`;
  return `${name}: ${claim.value}`;
}
