import { FixtureAdapter } from './fixtureAdapter.js';
import { authorizeRequest } from './accessContext.js';

/**
 * A production-shaped OpenEMR seam backed by synthetic fixtures. It makes the
 * server-verified identity/patient/scope boundary explicit without claiming
 * that this deployment reads a live OpenEMR instance.
 */
export class SimulatedOpenEMRAdapter {
  constructor({ fixturePath, requireSignedContext = false }) {
    this.fixture = new FixtureAdapter(fixturePath);
    this.requireSignedContext = requireSignedContext;
    this.name = 'simulated-openemr';
  }

  authorize(request, verifiedContext = null) {
    return authorizeRequest({ request, verifiedContext, requireSignedContext: this.requireSignedContext });
  }

  getCase(patientRef, caseId) { return this.fixture.getCase(patientRef, caseId); }
  retrieve(item) { return this.fixture.retrieve(item); }
  async checkReady() { return this.fixture.checkReady(); }
}
