#pragma once
#include <arduinoFFT.h>

// One triaxial accelerometer sample, in m/s^2.
struct TriaxialSample {
  float x, y, z;
};

// Turns the continuous stream of accelerometer samples into the features the
// classifier needs: triaxial RMS and the peak spectral density inside the
// 4-6 Hz tremor band, plus two features used only by the movement gate
// (gross-motion RMS and spectral purity).
//
// Windowing: 256 samples (2.56 s @ 100 Hz) window, per the project spec.
// The hop is 32 samples (87.5% overlap, ~0.32 s between updates) instead of
// the "standard" 50% overlap, so the app feels closer to real time: the
// window length (and therefore frequency resolution) is unchanged, only how
// often a fresh window gets evaluated.
//
// Which signal feeds which feature, and why:
//
//   - RMS comes from the 4-6 Hz BANDPASSED axes, so it measures tremor-band
//     amplitude only. No FFT needed, just a running sum of squares.
//
//   - The spectrum is computed from the RAW, unfiltered axes: one FFT per
//     axis, the three single-sided PSDs summed bin by bin. Raw rather than
//     bandpassed because spectral purity has to compare the tremor band
//     against the rest of the spectrum; on a bandpassed signal everything
//     outside 4-6 Hz is just the filter's stopband, which made the ratio
//     meaningless (~3e5 for any input). The in-band peak is essentially
//     unchanged by this, since the bandpass has unity gain at 5 Hz.
//
//     Do NOT collapse the three FFTs into one over the vector magnitude
//     sqrt(x^2+y^2+z^2): that rectifies whatever is not aligned with gravity
//     and moves a 5 Hz tremor to 10 Hz, outside the band being measured
//     (bench: a 1.2 m/s^2 5 Hz tremor peaked at 10.16 Hz and left psd_max at
//     ~0). Summing per-axis PSDs preserves the tremor frequency whatever the
//     wrist orientation.
//
//   - Gross-motion RMS comes from the <=2 Hz LOWPASSED axes, per axis (see
//     computeFeatures).
//
// The FFT runs in single precision on purpose: the ESP32-C3 has no FPU, so
// double-precision arithmetic is emulated in software and costs several times
// more per operation. 256-point single precision is plenty here.
class TremorFeatureExtractor {
public:
  static constexpr int WINDOW_SIZE = 256;
  static constexpr int HOP_SIZE = 32;
  static constexpr float SAMPLE_RATE_HZ = 100.0f;
  static constexpr float BAND_MIN_HZ = 4.0f;
  static constexpr float BAND_MAX_HZ = 6.0f;

  // Feeds one new sample, in its three forms:
  //   raw     straight from the MPU6050 (still carries gravity) - spectrum
  //   tremor  after the 4-6 Hz bandpass                         - RMS
  //   motion  after the <=2 Hz lowpass                          - movement gate
  // Returns true when a full 2.56 s window is available and computeFeatures()
  // should be called.
  bool push(const TriaxialSample &raw, const TriaxialSample &tremor, const TriaxialSample &motion);

  // Computes, over the most recent 256-sample window:
  //   rmsOut          triaxial RMS of the tremor band [m/s^2]
  //   psdMaxOut       peak spectral density within 4-6 Hz [ (m/s^2)^2/Hz ],
  //                   summed across the three axes
  //   motionRmsOut    RMS of the <=2 Hz gross-motion channel [m/s^2], taken as
  //                   sqrt(varX + varY + varZ) with each axis' own mean
  //                   removed - high values mean the limb is actively moving,
  //                   not resting, so any 4-6 Hz energy is unlikely to be a
  //                   Parkinsonian rest tremor. Per-axis rather than on the
  //                   vector magnitude, because the magnitude is dominated by
  //                   the ~9.8 m/s^2 gravity term and barely responds to
  //                   motion perpendicular to it (a 3 m/s^2 sway across
  //                   gravity measured only 0.16 m/s^2 on the bench).
  //   spectralPurityOut  psdMax divided by the mean PSD outside the tremor
  //                   band. A real rhythmic tremor is a sharp peak standing
  //                   alone above the floor (bench: ~1e4 and up); broadband
  //                   noise from bumps, taps or handling is not (~4), and
  //                   voluntary movement puts so much energy at low frequency
  //                   that the ratio collapses (~0.01).
  // Only valid right after push() returned true.
  void computeFeatures(float &rmsOut, float &psdMaxOut, float &motionRmsOut, float &spectralPurityOut);

private:
  static constexpr int SPECTRUM_BINS = WINDOW_SIZE / 2;

  // Accumulates one raw axis' single-sided PSD into _psdSum.
  void accumulateAxisSpectrum(const float *axisBuffer);

  // Mean-removed variance of one axis over the current window.
  float axisVariance(const float *axisBuffer) const;

  float _rawX[WINDOW_SIZE] = {0};
  float _rawY[WINDOW_SIZE] = {0};
  float _rawZ[WINDOW_SIZE] = {0};
  // Instantaneous x^2+y^2+z^2 of the bandpassed sample, for the tremor RMS.
  float _tremorSquares[WINDOW_SIZE] = {0};
  float _motionX[WINDOW_SIZE] = {0};
  float _motionY[WINDOW_SIZE] = {0};
  float _motionZ[WINDOW_SIZE] = {0};
  int _writeIndex = 0;
  uint32_t _totalPushed = 0;

  float _psdSum[SPECTRUM_BINS];
  float _vReal[WINDOW_SIZE];
  float _vImag[WINDOW_SIZE];
};
