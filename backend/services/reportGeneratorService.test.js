const test = require('node:test');
const assert = require('node:assert/strict');
const { generateFlightSummaryMarkdown } = require('./reportGeneratorService');

test('flight-summary report generator emits fixed concise markdown without diagnosis claims', () => {
  const markdown = generateFlightSummaryMarkdown({
    fileName: 'demo.ulg',
    summary: {
      totalDurationS: 60,
      armedAtS: 8,
      takeoffAtS: 12,
      landingAtS: 52,
      failsafeTriggered: true,
    },
    phases: [
      {
        name: '地面待机',
        startS: 0,
        endS: 8,
        durationS: 8,
        modeChanges: [{ mode: 'MANUAL' }],
      },
    ],
    flightStatus: {
      failsafe: {
        triggered: true,
        events: [
          {
            startS: 20,
            endS: 25,
            phaseName: '正常飞行',
            mode: 'AUTO_RTL',
            activeFlags: ['local_position'],
          },
        ],
        mainChanges: ['vehicle.failsafe became active'],
      },
      estimator: {
        status: 'partial',
        localPositionValid: true,
        globalPositionValid: false,
        gpsStatus: '3D fix',
        heightSource: 'baro',
        changes: [{ signal: 'vehicle.globalPositionValid', timeS: 12, value: 0 }],
      },
    },
    dataGate: {
      missingRequired: [],
      missingOptional: ['battery_status'],
      limitations: ['battery_status missing; battery related analysis is limited.'],
    },
  });

  assert.match(markdown, /^# 飞行日志简短报告/);
  assert.match(markdown, /## 2\. 飞行阶段/);
  assert.match(markdown, /\| 地面待机 \| 0\.00 s \| 8\.00 s \| 8\.00 s \| MANUAL \|/);
  assert.match(markdown, /## 5\. 工程师备注/);
  assert.match(
    markdown,
    /不直接判断根因，不输出硬件故障结论，不提供 PID 参数建议/,
  );
  assert.doesNotMatch(markdown, /PID 推荐参数|硬件故障概率|复杂异常评分/);
});
