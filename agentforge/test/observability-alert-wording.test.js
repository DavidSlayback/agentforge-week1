import test from 'node:test';
import assert from 'node:assert/strict';
import { renderObservabilityPage } from '../src/observabilityPage.js';

// The alert line must not assert "observed > threshold" for an alert that is OK.
test('alert wording flips the comparison when an alert is not firing', () => {
  const page = renderObservabilityPage({});
  assert.match(page, /a\.triggered\?esc\(a\.operator\):\(a\.operator==='>'\?'≤'/);
  assert.doesNotMatch(page, /esc\(a\.operator\)\+' '\+esc\(a\.threshold\?\?'—'\)\+' · threshold/);
});
