import {PPGEngine} from '../core/PPGEngine';
import type {PPGMetrics, PPGSample} from '../core/PPGTypes';
import {PPG_CONFIG} from '../core/PPGTypes';
import {FakeHeartPyWrapper} from '../testing/FakeHeartPyWrapper';

describe('PPGEngine integration with fake HeartPy bridge', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('reaches running state and emits metrics for the mock session', async () => {
    const fixture = require('../testing/fixtures/mock_ppg_session.json') as {
      readonly sampleRate: number;
      readonly samples: ReadonlyArray<PPGSample>;
      readonly pollResults: any[];
    };

    const wrapper = new FakeHeartPyWrapper({
      sampleRate: fixture.sampleRate,
      pollResults: fixture.pollResults as any,
    });

    const captured: PPGMetrics[] = [];
    const engine = new PPGEngine(metrics => {
      captured.push(metrics);
    }, wrapper as any);

    jest.useFakeTimers();
    jest.setSystemTime(0);

    await engine.start();

    const chunkSize = 12;
    for (let index = 0; index < fixture.samples.length; index += chunkSize) {
      const chunk = fixture.samples.slice(index, index + chunkSize);
      chunk.forEach(sample => engine.addSample(sample));
      jest.advanceTimersByTime(PPG_CONFIG.analysis.pollMs);
      await Promise.resolve();
    }

    const snapshot = engine.getSnapshot();
    expect(snapshot.metrics).not.toBeNull();

    const latest = snapshot.metrics as PPGMetrics;
    const expected = fixture.pollResults[fixture.pollResults.length - 1];
    expect(latest.bpm).toBeCloseTo(expected.bpm, 1);
    expect(latest.confidence).toBeCloseTo(expected.confidence, 2);
    expect(latest.snrDb).toBeCloseTo(expected.snrDb, 1);
    expect(snapshot.state).toBe('running');

    await engine.stop();
  });
});
