#pragma once
#include "ble_protocol.h"

// K-Means (k=3) classification against fixed centroids in (RMS, PSD_max)
// space, followed by a small FSM that debounces the label so it only
// changes after several consecutive windows agree — avoids flicker between
// adjacent severity classes on borderline signals.
//
// Before any of that runs, a "movement gate" rejects windows that don't
// look like genuine 4-6 Hz resting tremor at all:
//   - motionRms high  -> the limb is actively moving (walking, reaching,
//     gesturing). Parkinsonian rest tremor is defined clinically as tremor
//     that appears at rest and attenuates/disappears during voluntary
//     movement, so any 4-6 Hz energy seen while the arm is in gross motion
//     is treated as an artifact, not tremor.
//   - spectralPurity low -> the 4-6 Hz energy isn't a sharp rhythmic peak
//     standing above the rest of the spectrum, i.e. it looks like broadband
//     noise (taps, bumps, everyday handling) rather than a real oscillation.
// Gated windows are reported as SEVERITY_MILD (the app's "no significant
// tremor" / on-state class) instead of feeding the centroid classifier.
//
// KNOWN FALSE POSITIVE: a repeated short impulse at a tremor-band rate - tapping
// a finger ~5 times a second, an electric toothbrush, vehicle vibration - passes
// both conditions and reads as Severo (bench: rms 0.46, purity 43.8). It is
// periodic, in band, and the arm is not in gross motion, so neither gate has
// anything to object to. The discriminator that would catch it is harmonic
// content: a tremor is close to sinusoidal, while an impulse train puts
// comparable energy at 2x and 3x the fundamental. That test is deliberately NOT
// implemented here, because a real Parkinsonian tremor is not a pure sine
// either and setting a harmonic threshold without labeled recordings risks
// suppressing genuine tremor - the one failure mode this device must not have.
// Fit it on PhysioNet data together with the centroids.
//
// Both features are divided by a characteristic scale before the distance is
// taken. Without that, the Euclidean distance is meaningless: rms spans
// ~0.05-1.0 m/s^2 while psdMax spans ~0.002-0.5 (m/s^2)^2/Hz, so whichever
// feature happens to carry the larger numbers decides the label on its own and
// the other is decoration. Scaling both to O(1) is the standard prerequisite
// for k-means on features with different units, and it is what makes the
// centroids below mean what they look like.
//
// IMPORTANT: the centroid values and the two gate thresholds below are
// placeholders. Per the project's validation plan (PhysioNet Parkinson's
// tremor recordings replayed through MATLAB/Python, plus recordings of
// normal daily activity for the gate specifically), these must be re-fitted
// on real labeled data before this is used for anything beyond bench
// testing. What they are NOT any more is mutually inconsistent: for a tone
// inside the band the bench gives psdMax ~= 0.69 * rms^2 (measured at 0.691,
// 0.690 and 0.718 across three amplitudes), so each centroid's psdMax is now
// derived from its rms through that relation instead of being picked
// independently. Re-fitting on real data should keep them on a curve like
// this, since the two features are two views of the same amplitude.
class SeverityClassifier {
public:
  static constexpr int DEBOUNCE_WINDOWS = 2;

  // Gate thresholds - see class comment. Both are placeholders, but the
  // synthetic bench gives an idea of the margin they sit in:
  //   motionRms        0.02-0.13 at rest (tremor included), ~2.1 during a
  //                    3 m/s^2 voluntary sway  -> 1.0 splits them cleanly
  //   spectralPurity   ~1.1-1.3 for broadband noise and for voluntary motion,
  //                    ~1.5e3 for a realistic tremor (5 Hz + jitter + noise),
  //                    ~3e5 for a pure tone      -> 3.0 is deliberately near
  //                    the reject side, so a weak-but-real tremor is kept
  static constexpr float MOTION_GATE_RMS = 1.0f;      // m/s^2
  static constexpr float SPECTRAL_PURITY_GATE = 3.0f; // psdMax / reference band mean

  // Characteristic scale of each feature, used to make the two axes
  // comparable before measuring distance. Set to the severe centroid, so the
  // normalized space runs roughly 0..1 from "no tremor" to "severe".
  static constexpr float FEATURE_SCALE_RMS = 0.35f;     // m/s^2
  static constexpr float FEATURE_SCALE_PSD = 0.084525f; // (m/s^2)^2/Hz

  SeverityLevel classify(float rms, float psdMax, float motionRms, float spectralPurity);

private:
  struct Centroid {
    float rms;
    float psdMax;
  };

  // Defined out-of-line in the .cpp (kept as a plain static const, not
  // constexpr, so this compiles under the C++11/14 mode arduino-esp32 2.0.x
  // defaults to).
  static const Centroid CENTROIDS[3];

  SeverityLevel _stableLabel = SEVERITY_MILD;
  SeverityLevel _candidateLabel = SEVERITY_MILD;
  int _candidateStreak = 0;
};
