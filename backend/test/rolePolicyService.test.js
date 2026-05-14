const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  DEFAULT_ROLE_TOPIC_POLICY,
  loadRoleTopicPolicyFromFile,
} = require('../services/rolePolicyService');

test('role policy loader falls back when policy file is missing', () => {
  const missingPolicyPath = path.join(
    __dirname,
    'fixtures',
    'missing-role-topic-policy.txt',
  );

  assert.doesNotThrow(() => loadRoleTopicPolicyFromFile(missingPolicyPath));

  const policy = loadRoleTopicPolicyFromFile(missingPolicyPath);
  assert.deepEqual(policy, DEFAULT_ROLE_TOPIC_POLICY);
  assert.ok(Array.isArray(policy.customer));
  assert.ok(Array.isArray(policy.aftersales));
  assert.equal(policy.engineer, '*');
});
