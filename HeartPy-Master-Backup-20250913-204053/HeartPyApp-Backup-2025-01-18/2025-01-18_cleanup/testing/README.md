# Testing & Simulation Utilities

This folder contains lightweight tooling to exercise the PPG pipeline without a live camera feed.

## Files

- `fixtures/mock_ppg_session.json` – synthetic 30 Hz contact-PPG samples plus canned HeartPy poll outputs.
- `FakeHeartPyWrapper.ts` – drop-in replacement for the native wrapper so that `PPGEngine` can be driven from fixtures.
- `useFixturePlayer.ts` – React hook that replays fixture samples at the configured sample rate.

## Running the engine test

```
cd HeartPyApp
npx jest __tests__/PPGEngine.test.ts --watchman=false
```

(The extra flag disables Watchman, which is not available in the sandbox.)

## Simulating the camera UI

In development builds (`__DEV__`), open **Real-time PPG Analiz** and tap **Simülasyonu Başlat**. The mock waveform and metrics come from `mock_ppg_session.json` and drive the full UI/engine loop without needing a camera/finger.
