#pragma once

// 4th-order Butterworth bandpass filter (4-6 Hz @ fs=100 Hz), realized as a
// cascade of two Direct-Form-II biquad sections for numerical stability.
//
// Coefficients were derived with the standard analog-prototype -> lowpass-to-
// bandpass -> bilinear-transform pipeline (the same method used internally by
// scipy.signal.butter/lp2bp_zpk/bilinear_zpk) and verified numerically:
// |H(4Hz)| = |H(6Hz)| = -3.01 dB, |H(5Hz)| = 0.00 dB (unity gain at the
// tremor-band center), with fast roll-off outside the band. See the project
// README for the exact derivation notes if the sample rate or band ever
// changes and these need to be regenerated.
struct BiquadCoeffs {
  float b0, b1, b2;
  float a1, a2; // a0 is normalized to 1
};

constexpr BiquadCoeffs TREMOR_BANDPASS_STAGE1 = {
    0.0036216815f, -0.0072433630f, 0.0036216815f,
    -1.8585546464f, 0.9264283320f,
};

constexpr BiquadCoeffs TREMOR_BANDPASS_STAGE2 = {
    1.0f, 2.0f, 1.0f,
    -1.7842324803f, 0.9036658556f,
};

class Biquad {
public:
  explicit Biquad(const BiquadCoeffs &c) : _c(c) {}

  float process(float x) {
    // Direct Form II Transposed.
    float y = _c.b0 * x + _z1;
    _z1 = _c.b1 * x - _c.a1 * y + _z2;
    _z2 = _c.b2 * x - _c.a2 * y;
    return y;
  }

  void reset() { _z1 = _z2 = 0.0f; }

private:
  BiquadCoeffs _c;
  float _z1 = 0.0f;
  float _z2 = 0.0f;
};

class TremorBandpassFilter {
public:
  TremorBandpassFilter() : _stage1(TREMOR_BANDPASS_STAGE1), _stage2(TREMOR_BANDPASS_STAGE2) {}

  float process(float x) { return _stage2.process(_stage1.process(x)); }

  void reset() {
    _stage1.reset();
    _stage2.reset();
  }

private:
  Biquad _stage1;
  Biquad _stage2;
};

// 2nd-order Butterworth lowpass, fc=2 Hz @ fs=100 Hz (RBJ cookbook formula,
// Q=1/sqrt(2)). Used in parallel with TremorBandpassFilter to isolate gross,
// voluntary limb movement (walking arm-swing, reaching, gesturing) so it can
// be told apart from Parkinsonian rest tremor, which lives at 4-6 Hz and by
// clinical definition disappears once the limb starts moving voluntarily.
// See SeverityClassifier for how this feeds the movement gate.
constexpr BiquadCoeffs GROSS_MOTION_LOWPASS = {
    0.0036216815f, 0.0072433630f, 0.0036216815f,
    -1.8226949252f, 0.8371816513f,
};

class GrossMotionFilter {
public:
  GrossMotionFilter() : _stage(GROSS_MOTION_LOWPASS) {}

  float process(float x) { return _stage.process(x); }

  void reset() { _stage.reset(); }

private:
  Biquad _stage;
};
