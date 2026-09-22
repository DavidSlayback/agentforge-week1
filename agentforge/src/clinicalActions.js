import crypto from 'node:crypto';

export const CLINICAL_ACTION_TYPES = new Set(['diagnosis', 'order']);

const requireString = (value, code) => {
  if (typeof value !== 'string' || !value.trim()) throw Object.assign(new Error(code), { code });
  return value.trim();
};

function publicAction(action) {
  return action ? { ...action, resource: { ...action.resource } } : null;
}

function actionId({ patientRef, clinicianRef, actionType, instruction }) {
  return `draft-${crypto.createHash('sha256').update(`${patientRef}|${clinicianRef}|${actionType}|${instruction}`).digest('hex').slice(0, 24)}`;
}

export function buildClinicalActionDraft({ patientRef, clinicianRef, actionType, instruction, instructionSource = 'clinician', now = () => new Date().toISOString() }) {
  patientRef = requireString(patientRef, 'CLINICAL_ACTION_PATIENT_REQUIRED');
  clinicianRef = requireString(clinicianRef, 'CLINICAL_ACTION_CLINICIAN_REQUIRED');
  instruction = requireString(instruction, 'CLINICAL_ACTION_INSTRUCTION_REQUIRED');
  if (instruction.length > 1000) throw Object.assign(new Error('CLINICAL_ACTION_INSTRUCTION_TOO_LONG'), { code: 'CLINICAL_ACTION_INSTRUCTION_TOO_LONG' });
  if (!CLINICAL_ACTION_TYPES.has(actionType)) throw Object.assign(new Error('CLINICAL_ACTION_TYPE_INVALID'), { code: 'CLINICAL_ACTION_TYPE_INVALID' });
  if (instructionSource !== 'clinician') throw Object.assign(new Error('CLINICAL_ACTION_INSTRUCTION_SOURCE_INVALID'), { code: 'CLINICAL_ACTION_INSTRUCTION_SOURCE_INVALID' });
  return {
    id: actionId({ patientRef, clinicianRef, actionType, instruction }),
    status: 'draft',
    synthetic_only: true,
    action_type: actionType,
    patient_ref: patientRef,
    clinician_uuid: clinicianRef,
    resource: actionType === 'diagnosis' ? { resource_type: 'Condition', code_text: instruction } : { resource_type: 'ServiceRequest', order_text: instruction },
    source_instruction: instruction,
    instruction_source: 'clinician',
    created_at: now(),
    provenance: 'clinician-authored-unconfirmed',
  };
}

/** Synthetic-only action ledger. No live OpenEMR write path uses this store. */
export class SyntheticClinicalActionStore {
  constructor({ now = () => new Date().toISOString(), persist = null } = {}) {
    this.now = now;
    this.persist = persist;
    this.drafts = new Map();
    this.actions = new Map();
    this.confirmedByDraft = new Map();
  }

  draft(input) {
    const action = buildClinicalActionDraft({ ...input, now: this.now });
    const existing = this.drafts.get(action.id);
    if (existing) return { duplicate: true, action: publicAction(existing) };
    this.drafts.set(action.id, action);
    return { duplicate: false, action: publicAction(action) };
  }

  confirm(id, { patientRef, clinicianRef, confirmationEvent } = {}) {
    const draft = this.drafts.get(id);
    if (!draft) throw Object.assign(new Error('CLINICAL_ACTION_DRAFT_NOT_FOUND'), { code: 'CLINICAL_ACTION_DRAFT_NOT_FOUND' });
    if (draft.patient_ref !== patientRef || draft.clinician_uuid !== clinicianRef) throw Object.assign(new Error('CLINICAL_ACTION_SCOPE_MISMATCH'), { code: 'CLINICAL_ACTION_SCOPE_MISMATCH' });
    if (!confirmationEvent || typeof confirmationEvent !== 'object') throw Object.assign(new Error('CLINICAL_ACTION_CONFIRMATION_REQUIRED'), { code: 'CLINICAL_ACTION_CONFIRMATION_REQUIRED' });
    const eventId = requireString(confirmationEvent.event_id, 'CLINICAL_ACTION_EVENT_ID_REQUIRED');
    if (confirmationEvent.actor !== 'clinician') throw Object.assign(new Error('CLINICAL_ACTION_ACTOR_INVALID'), { code: 'CLINICAL_ACTION_ACTOR_INVALID' });
    if (confirmationEvent.confirmed !== true) {
      if (confirmationEvent.confirmed !== false) throw Object.assign(new Error('CLINICAL_ACTION_CONFIRMATION_REQUIRED'), { code: 'CLINICAL_ACTION_CONFIRMATION_REQUIRED' });
      return { status: 'cancelled', duplicate: false, action: null, draft: publicAction(draft), cancellation_event_id: eventId };
    }
    const existingId = this.confirmedByDraft.get(id);
    if (existingId) return { status: 'confirmed', duplicate: true, action: publicAction(this.actions.get(existingId)) };
    const action = {
      ...draft,
      id: `action-${draft.id.slice('draft-'.length)}`,
      status: 'confirmed',
      confirmed_at: this.now(),
      confirmation_event_id: eventId,
      authored_by: clinicianRef,
      provenance: 'synthetic-openemr-clinician-confirmed',
    };
    if (this.persist) this.persist(action);
    this.actions.set(action.id, action);
    this.confirmedByDraft.set(id, action.id);
    return { status: 'confirmed', duplicate: false, action: publicAction(action) };
  }

  get(id, { patientRef, clinicianRef } = {}) {
    const action = this.actions.get(id) || this.actions.get(this.confirmedByDraft.get(id));
    if (!action) throw Object.assign(new Error('CLINICAL_ACTION_NOT_FOUND'), { code: 'CLINICAL_ACTION_NOT_FOUND' });
    if (action.patient_ref !== patientRef || action.clinician_uuid !== clinicianRef) throw Object.assign(new Error('CLINICAL_ACTION_SCOPE_MISMATCH'), { code: 'CLINICAL_ACTION_SCOPE_MISMATCH' });
    return { action: publicAction(action) };
  }

  list(patientRef) {
    return [...this.actions.values()].filter((action) => action.patient_ref === patientRef).map(publicAction);
  }
}
