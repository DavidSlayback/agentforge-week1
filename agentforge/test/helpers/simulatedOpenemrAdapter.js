import { FixtureAdapter } from '../../src/fixtureAdapter.js';
import { authorizeRequest } from '../../src/accessContext.js';
import { SyntheticWriteback } from '../../src/syntheticWriteback.js';

/** Synthetic local fixture implementation of the adapter boundary. Test-only. */
export class SimulatedOpenEMRAdapter {
  constructor({ fixturePath, sourceDocumentStore, observationStore, clinicalActionStore } = {}) {
    this.fixture = new FixtureAdapter(fixturePath);
    this.writeback = new SyntheticWriteback({ sourceDocumentStore, observationStore, clinicalActionStore });
    this.name = 'simulated-openemr';
  }

  authorize(request, verifiedContext = null, options = {}) {
    return authorizeRequest({ request, verifiedContext, ...options });
  }

  // Synthetic local mode preserves the authorization/retrieval seam without
  // contacting OpenEMR.
  getCase(patientRef, caseId) { return this.fixture.getCase(patientRef, caseId); }
  retrieve(item) { return this.fixture.retrieve(item); }
  persistSourceDocument(input) { return this.writeback.persistSourceDocument(input); }
  getSourceDocument(id, options) { return this.writeback.getSourceDocument(id, options); }
  listSourceDocuments(patientRef) { return this.writeback.listSourceDocuments(patientRef); }
  persistObservation(input) { return this.writeback.persistObservation(input); }
  listObservations(patientRef) { return this.writeback.listObservations(patientRef); }
  draftClinicalAction(input) { return this.writeback.draftClinicalAction(input); }
  confirmClinicalAction(id, input) { return this.writeback.confirmClinicalAction(id, input); }
  getClinicalAction(id, options) { return this.writeback.getClinicalAction(id, options); }
  async checkReady() { return this.fixture.checkReady(); }
}
