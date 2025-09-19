import {useEffect, useMemo, useRef, useState} from 'react';
import type {PPGSample} from '../core/PPGTypes';

const fixture = require('./fixtures/mock_ppg_session.json') as {
  readonly name: string;
  readonly description?: string;
  readonly sampleRate: number;
  readonly samples: ReadonlyArray<PPGSample>;
};

export interface FixturePlayerOptions {
  readonly enabled: boolean;
  readonly onSample: (sample: PPGSample) => void;
  readonly loop?: boolean;
  readonly onFinished?: () => void;
  readonly log?: (event: string, data: Record<string, unknown>) => void;
}

export interface FixturePlayerState {
  readonly progress: number;
  readonly totalSamples: number;
  readonly durationMs: number;
}

const INTERVAL_EPSILON_MS = 1;

export function useFixturePlayer(
  options: FixturePlayerOptions,
): FixturePlayerState {
  const {enabled, onSample, loop = false, onFinished, log} = options;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const indexRef = useRef(0);
  const [progress, setProgress] = useState(0);

  const intervalMs = useMemo(() => {
    if (!fixture.sampleRate || fixture.sampleRate <= 0) {
      return 1000 / 30;
    }
    return Math.round(1000 / fixture.sampleRate);
  }, []);

  useEffect(() => {
    if (!enabled) {
      indexRef.current = 0;
      setProgress(0);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return undefined;
    }

    if (!fixture.samples || fixture.samples.length === 0) {
      log?.('simulation_fixture_empty', {name: fixture.name});
      return undefined;
    }

    log?.('simulation_started', {
      name: fixture.name,
      sampleRate: fixture.sampleRate,
      samples: fixture.samples.length,
    });

    timerRef.current = setInterval(() => {
      const idx = indexRef.current;
      if (idx >= fixture.samples.length) {
        if (loop) {
          indexRef.current = 0;
          setProgress(0);
          return;
        }
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        onFinished?.();
        log?.('simulation_finished', {name: fixture.name});
        return;
      }

      const entry = fixture.samples[idx];
      onSample(entry);
      indexRef.current = idx + 1;
      setProgress(indexRef.current / fixture.samples.length);
    }, Math.max(1, intervalMs - INTERVAL_EPSILON_MS));

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      indexRef.current = 0;
      setProgress(0);
    };
  }, [enabled, onSample, loop, onFinished, log, intervalMs]);

  return useMemo(
    () => ({
      progress: enabled ? progress : 0,
      totalSamples: fixture.samples.length,
      durationMs: Math.round(
        (fixture.samples.length / fixture.sampleRate) * 1000,
      ),
    }),
    [enabled, progress],
  );
}

export const MOCK_FIXTURE_META = {
  name: fixture.name,
  description: fixture.description,
  sampleRate: fixture.sampleRate,
  totalSamples: fixture.samples.length,
  durationMs: Math.round((fixture.samples.length / fixture.sampleRate) * 1000),
};
