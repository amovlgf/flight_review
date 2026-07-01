const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const manifestPath = path.join(repoRoot, 'docs', 'incident-sample-manifest.json');

const VALID_SAMPLE_TYPES = new Set([
  'normal_flight',
  'ground_test',
  'ordinary_armed_flight',
  'abnormal_flight',
]);
const VALID_STATUSES = new Set(['placeholder', 'annotated', 'archived']);
const VALID_REGRESSION_USES = new Set([
  'false_positive_baseline',
  'phase_and_event_baseline',
  'timeline_evidence_navigation',
  'phenomenon_detection',
  'manual_reference',
]);
const VALID_ANOMALY_STATUSES = new Set([
  'not_available',
  'no_critical_detected',
  'needs_review',
]);

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function assertRelativePathInsideDocs(filePath) {
  assert.equal(path.isAbsolute(filePath), false);
  assert.ok(!filePath.split(/[\\/]+/).includes('..'));
}

test('incident sample manifest keeps a valid V1.4 schema', () => {
  const manifest = readManifest();

  assert.equal(manifest.schemaVersion, 'incident-sample-manifest.v1');
  assert.equal(manifest.scope, 'feature-one-incident-analysis-only');
  assert.ok(Array.isArray(manifest.samples));
  assert.ok(manifest.samples.length >= 4);

  const ids = new Set();
  for (const sample of manifest.samples) {
    assert.equal(typeof sample.id, 'string');
    assert.ok(sample.id.length > 0);
    assert.equal(ids.has(sample.id), false);
    ids.add(sample.id);

    assert.equal(typeof sample.fileName, 'string');
    assert.equal(typeof sample.filePath, 'string');
    assert.equal(typeof sample.annotationFile, 'string');
    assert.equal(typeof sample.suitableForRegression, 'boolean');
    assert.ok(Array.isArray(sample.expectedTimelineCodes));
    assert.ok(VALID_SAMPLE_TYPES.has(sample.sampleType));
    assert.ok(VALID_STATUSES.has(sample.status));
    assert.ok(VALID_REGRESSION_USES.has(sample.regressionUse));
    assert.ok(VALID_ANOMALY_STATUSES.has(sample.expectedAnomalyStatus));

    if (sample.status === 'placeholder') {
      assert.equal(sample.suitableForRegression, false);
      continue;
    }

    assert.ok(sample.filePath);
    assert.ok(sample.annotationFile);
    assertRelativePathInsideDocs(sample.annotationFile);
    assert.ok(fs.existsSync(path.join(repoRoot, sample.annotationFile)));
  }
});
