const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hasUnlockedFlight,
  hasUnlockedFlightFromTopicCharts,
} = require('./unlockFlightService');

test('hasUnlockedFlight prefers parser unlock summary', () => {
  assert.equal(
    hasUnlockedFlight({
      unlockSummary: {
        hasUnlockedFlight: true,
        sources: [{ topic: 'actuator_armed', field: 'armed' }],
      },
      topicCharts: [],
    }),
    true,
  );
});

test('hasUnlockedFlightFromTopicCharts detects actuator_armed.armed', () => {
  assert.equal(
    hasUnlockedFlightFromTopicCharts([
      {
        topic: 'actuator_armed',
        title: 'actuator_armed',
        series: [{ name: 'armed', unit: '', points: [[0, 0], [1, 1]] }],
      },
    ]),
    true,
  );
});

test('hasUnlockedFlightFromTopicCharts detects PX4 vehicle_status armed state', () => {
  assert.equal(
    hasUnlockedFlightFromTopicCharts([
      {
        topic: 'vehicle_status',
        title: 'vehicle_status',
        series: [{ name: 'arming_state', unit: '', points: [[0, 1], [1, 2]] }],
      },
    ]),
    true,
  );
});

test('hasUnlockedFlight returns false when parsed log never arms', () => {
  assert.equal(
    hasUnlockedFlight({
      unlockSummary: {
        hasUnlockedFlight: false,
        sources: [],
      },
      topicCharts: [
        {
          topic: 'vehicle_status',
          title: 'vehicle_status',
          series: [{ name: 'arming_state', unit: '', points: [[0, 1], [1, 1]] }],
        },
      ],
    }),
    false,
  );
});
