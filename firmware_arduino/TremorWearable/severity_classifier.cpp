#include "severity_classifier.h"
#include <math.h>

// psdMax of each centroid is derived from its rms as 0.69 * rms^2, the relation
// measured on the bench for a tone inside the tremor band (see the header).
const SeverityClassifier::Centroid SeverityClassifier::CENTROIDS[3] = {
    {0.05f, 0.001725f}, // SEVERITY_MILD
    {0.15f, 0.015525f}, // SEVERITY_MODERATE
    {0.35f, 0.084525f}, // SEVERITY_SEVERE
};

SeverityLevel SeverityClassifier::classify(float rms, float psdMax, float motionRms, float spectralPurity) {
  SeverityLevel candidate;

  bool isGrossMovement = motionRms > MOTION_GATE_RMS;
  bool isBroadbandNoise = spectralPurity < SPECTRAL_PURITY_GATE;

  if (isGrossMovement || isBroadbandNoise) {
    // Doesn't look like a genuine resting tremor - don't even run it
    // through the centroid classifier, just report the "nothing notable"
    // class so normal daily movement doesn't get flagged as tremor.
    candidate = SEVERITY_MILD;
  } else {
    int bestIndex = 0;
    float bestDistance = INFINITY;

    for (int i = 0; i < 3; i++) {
      // Both differences normalized by the feature's characteristic scale, so
      // neither axis dominates just because of its units (see header).
      float dRms = (rms - CENTROIDS[i].rms) / FEATURE_SCALE_RMS;
      float dPsd = (psdMax - CENTROIDS[i].psdMax) / FEATURE_SCALE_PSD;
      float distance = dRms * dRms + dPsd * dPsd; // squared Euclidean, monotonic-equivalent
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    candidate = (SeverityLevel)bestIndex;
  }

  if (candidate == _candidateLabel) {
    _candidateStreak++;
  } else {
    _candidateLabel = candidate;
    _candidateStreak = 1;
  }

  if (_candidateStreak >= DEBOUNCE_WINDOWS) {
    _stableLabel = _candidateLabel;
  }

  return _stableLabel;
}
