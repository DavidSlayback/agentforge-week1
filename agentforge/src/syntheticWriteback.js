import { authorizeRequest } from './accessContext.js';
import { SyntheticSourceDocumentStore } from './sourceDocuments.js';
import { SyntheticClinicalActionStore } from './clinicalActions.js';
import { SyntheticLabObservationStore } from './syntheticLabObservations.js';

/**
 * Synthetic-only persistence boundary.
 *
 * This collaborator is intentionally separate from chart retrieval. It owns
 * only local fixture documents and clinician-confirmed action drafts; it
 * must never be used as an OpenEMR chart adapter.
 */
export class SyntheticWriteback {
  constructor({ sourceDocumentStore = new SyntheticSourceDocumentStore(), clinicalActionStore = new SyntheticClinicalActionStore(), labObservationStore = new SyntheticLabObservationStore() } = {}) {
    this.sourceDocumentStore = sourceDocumentStore;
    this.clinicalActionStore = clinicalActionStore;
    // E5: synthetic lab results for the trend chart (not OpenEMR).
    this.labObservationStore = labObservationStore;
    this.name = 'synthetic-writeback';
  }

  authorize(request, verifiedContext = null, options = {}) {
    return authorizeRequest({ request, verifiedContext, ...options });
  }

  persistSourceDocument(input) { return this.sourceDocumentStore.persist(input); }
  getSourceDocument(id, options) { return this.sourceDocumentStore.get(id, options); }
  listSourceDocuments(patientRef) { return this.sourceDocumentStore.list(patientRef); }
  draftClinicalAction(input) { return this.clinicalActionStore.draft(input); }
  confirmClinicalAction(id, input) { return this.clinicalActionStore.confirm(id, input); }
  getClinicalAction(id, options) { return this.clinicalActionStore.get(id, options); }
  persistSyntheticLabObservations({ patientRef, sourceDocument, rows }) { return this.labObservationStore.persist({ patientRef, sourceDocumentId: sourceDocument.id, rows }); }
  readLabObservationHistory({ patientRef }) { return this.labObservationStore.history({ patientRef }); }
}
