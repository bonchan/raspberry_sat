// Types shared by the sketch. They live here because the Arduino build declares the sketch's functions
// at the top of the .ino, before anything defined in it, so types used in function signatures must
// come from a header.
#pragma once

#include <Arduino.h>

const int MAX_PASSES = 60;
const int MAX_SAMPLES = 1200;              // one per second: longer than any pass

struct Texts {
  const char *next, *receiving, *overhead, *notRecorded, *noPassNow, *today, *left, *in, *noPasses;
  const char *connecting, *noServer, *noTime, *lastPass, *locked, *searching, *synced, *noSync, *frames;
  const char *peak, *viterbi, *deframer, *days[7];
};

struct Pass {
  char name[24];
  uint32_t aos, los;
  float maxEl, aosAz, losAz;
  bool scheduled;
};

struct Sample {
  uint32_t t;
  float snr, el;
  int8_t sync;                             // 1 frames syncing, 0 no sync, -1 not reported
};

struct Data {
  bool wifi = false, server = false;
  bool spanish = false, showLow = true;
  Pass passes[MAX_PASSES];
  int passCount = 0;
  // status
  bool hasTracker = false, receiving = false, overhead = false;
  char object[24] = "";
  uint32_t nextAos = 0, nextLos = 0;
  float az = 0, el = 0, range = -1, freqMHz = 0;
  // live
  uint32_t passStarted = 0, lastLos = 0, caduBytes = 0;
  Sample samples[MAX_SAMPLES];
  int sampleCount = 0;
  float snr = NAN, peakSnr = NAN, ber = NAN, freqOffset = NAN, rs = NAN;
  int8_t vit = -1, dfr = -1;
};
