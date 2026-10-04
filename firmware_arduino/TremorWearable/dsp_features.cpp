#include "dsp_features.h"
#include <math.h>

bool TremorFeatureExtractor::push(const TriaxialSample &raw, const TriaxialSample &tremor,
                                  const TriaxialSample &motion) {
  _rawX[_writeIndex] = raw.x;
  _rawY[_writeIndex] = raw.y;
  _rawZ[_writeIndex] = raw.z;
  _tremorSquares[_writeIndex] = tremor.x * tremor.x + tremor.y * tremor.y + tremor.z * tremor.z;
  _motionX[_writeIndex] = motion.x;
  _motionY[_writeIndex] = motion.y;
  _motionZ[_writeIndex] = motion.z;
  _writeIndex = (_writeIndex + 1) % WINDOW_SIZE;
  _totalPushed++;

  if (_totalPushed < WINDOW_SIZE) {
    return false;
  }
  return (_totalPushed - WINDOW_SIZE) % HOP_SIZE == 0;
}

float TremorFeatureExtractor::axisVariance(const float *axisBuffer) const {
  float sum = 0.0f;
  float sumSquares = 0.0f;
  for (int i = 0; i < WINDOW_SIZE; i++) {
    float sample = axisBuffer[i];
    sum += sample;
    sumSquares += sample * sample;
  }
  float mean = sum / WINDOW_SIZE;
  float variance = (sumSquares / WINDOW_SIZE) - (mean * mean);
  return variance > 0.0f ? variance : 0.0f;
}

void TremorFeatureExtractor::accumulateAxisSpectrum(const float *axisBuffer) {
  // Unwrap the circular buffer into chronological order (oldest -> newest).
  for (int i = 0; i < WINDOW_SIZE; i++) {
    _vReal[i] = axisBuffer[(_writeIndex + i) % WINDOW_SIZE];
    _vImag[i] = 0.0f;
  }

  // arduinoFFT 2.x: templated class + lowerCamelCase methods + enum classes
  // for window type/direction (the 1.x API used macros like FFT_FORWARD and
  // methods named DCRemoval/Windowing/Compute/ComplexToMagnitude instead).
  // dcRemoval() matters more here than it looks: these are the RAW axes, so
  // one of them carries the ~9.8 m/s^2 gravity offset.
  ArduinoFFT<float> fft(_vReal, _vImag, WINDOW_SIZE, SAMPLE_RATE_HZ);
  fft.dcRemoval();
  fft.windowing(FFTWindow::Hamming, FFTDirection::Forward);
  fft.compute(FFTDirection::Forward);
  fft.complexToMagnitude();

  // Single-sided periodogram PSD estimate: (2 / (Fs*N)) * |X[k]|^2.
  for (int k = 1; k < SPECTRUM_BINS; k++) {
    float magnitudeK = _vReal[k];
    _psdSum[k] += (2.0f / (SAMPLE_RATE_HZ * WINDOW_SIZE)) * magnitudeK * magnitudeK;
  }
}

void TremorFeatureExtractor::computeFeatures(float &rmsOut, float &psdMaxOut, float &motionRmsOut,
                                             float &spectralPurityOut) {
  // Tremor-band RMS: sqrt(mean(x^2 + y^2 + z^2)) of the bandpassed axes.
  float sumSquares = 0.0f;
  for (int i = 0; i < WINDOW_SIZE; i++) {
    sumSquares += _tremorSquares[i];
  }
  rmsOut = sqrtf(sumSquares / WINDOW_SIZE);

  // Variance around each axis' own mean (not around zero): the lowpassed
  // channel still carries the ~9.8 m/s^2 gravity DC offset, and what
  // distinguishes "arm actively moving" from "arm resting" is the
  // fluctuation around that baseline, not the baseline itself. Summing the
  // three variances keeps motion visible whatever its direction relative to
  // gravity (see header).
  float motionVariance = axisVariance(_motionX) + axisVariance(_motionY) + axisVariance(_motionZ);
  motionRmsOut = sqrtf(motionVariance);

  // One FFT per RAW axis, PSDs summed bin by bin (see header for why raw, and
  // why not the vector magnitude).
  for (int k = 0; k < SPECTRUM_BINS; k++) {
    _psdSum[k] = 0.0f;
  }
  accumulateAxisSpectrum(_rawX);
  accumulateAxisSpectrum(_rawY);
  accumulateAxisSpectrum(_rawZ);

  const float binResolutionHz = SAMPLE_RATE_HZ / WINDOW_SIZE;
  int binMin = (int)floorf(BAND_MIN_HZ / binResolutionHz);
  int binMax = (int)ceilf(BAND_MAX_HZ / binResolutionHz);
  if (binMin < 1) binMin = 1; // skip DC bin
  if (binMax > SPECTRUM_BINS - 1) binMax = SPECTRUM_BINS - 1;

  float psdMax = 0.0f;
  float referenceSum = 0.0f;
  int referenceCount = 0;
  for (int k = 1; k < SPECTRUM_BINS; k++) {
    float psd = _psdSum[k];

    if (k >= binMin && k <= binMax) {
      if (psd > psdMax) {
        psdMax = psd;
      }
    } else {
      // Reference floor: the rest of the movement spectrum, which is what the
      // tremor peak has to stand above to count as a rhythmic oscillation.
      referenceSum += psd;
      referenceCount++;
    }
  }
  psdMaxOut = psdMax;

  float referenceMean = referenceCount > 0 ? referenceSum / referenceCount : 0.0f;
  // Guard against div-by-~0 on a perfectly still window, which just caps the
  // ratio instead of exploding it.
  spectralPurityOut = psdMax / (referenceMean > 1e-12f ? referenceMean : 1e-12f);
}
