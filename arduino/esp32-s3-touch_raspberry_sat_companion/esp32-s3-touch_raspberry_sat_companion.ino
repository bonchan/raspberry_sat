// raspberry_sat companion for the Waveshare ESP32-S3-Touch-LCD-2 (2" 240x320 ST7789 + CST816D touch),
// used in landscape (320x240).
//
//   Page 1: the next pass with a countdown, then the upcoming passes (drag up/down to scroll).
//   Page 2 (swipe left): the pass being received: progress, SNR, lock, sync, frames, signal chart.
//
// Everything comes from the raspberry_sat web app's API over Wi-Fi; the interface language and
// "show low passes" follow its settings.
//
// Libraries: "GFX Library for Arduino" (moononournation), "ArduinoJson" 7.x (bblanchon).
// Board: ESP32S3 Dev Module, PSRAM "OPI PSRAM", Flash 16MB.
// Wi-Fi: copy secrets.example.h to secrets.h and fill it in.

#include <Arduino_GFX_Library.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <Wire.h>
#include <math.h>
#include <time.h>

#include "secrets.h"
#include "types.h"

// ---------- settings ----------

const char *SERVER_HOST = "rpi4b.local";   // the Pi running raspberry_sat: a .local name or an IP address
const uint16_t SERVER_PORT = 8000;
const char *TIMEZONE = "<-03>3";           // POSIX TZ for local times: UTC-3 without daylight saving (Argentina)
const char *NTP_SERVER = "pool.ntp.org";

const uint32_t STATUS_EVERY_MS = 2000;     // status and live data
const uint32_t SCHEDULE_EVERY_MS = 600000; // upcoming passes and settings

// Waveshare ESP32-S3-Touch-LCD-2 (as in Waveshare's demo; check the board's wiki if the screen stays dark)
#define LCD_SCK 39
#define LCD_MOSI 38
#define LCD_MISO 40
#define LCD_DC 42
#define LCD_CS 45
#define LCD_RST GFX_NOT_DEFINED
#define LCD_BL 1
#define TOUCH_SDA 48
#define TOUCH_SCL 47
#define TOUCH_ADDR 0x15                    // CST816D

// The panel is 240x320 portrait; rotation 1 makes it 320x240 landscape. The touch chip reports portrait
// coordinates: if taps or swipes land in the wrong place, change these three.
#define LCD_ROTATION 1
#define TOUCH_SWAP_XY true
#define TOUCH_INVERT_X false
#define TOUCH_INVERT_Y true

const int W = 320, H = 240;

// pass quality by highest elevation, as on the web page
const float GOOD = 30, EXCELLENT = 60;

// ---------- colours (the web page's) ----------

constexpr uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}
const uint16_t C_BG = rgb(20, 22, 26), C_PANEL = rgb(30, 33, 39), C_LINE = rgb(46, 51, 60);
const uint16_t C_TEXT = rgb(230, 232, 235), C_DIM = rgb(139, 147, 161), C_ACCENT = rgb(77, 163, 255);
const uint16_t C_OK = rgb(62, 207, 142), C_DANGER = rgb(229, 72, 77), C_WARN = rgb(229, 184, 77);
const uint16_t C_FAIR = rgb(240, 136, 62), C_GOOD = rgb(242, 208, 59), C_EXCELLENT = C_OK, C_SAT = rgb(255, 210, 63);

#define DEG "~"                           // text() draws a '~' as a small degree circle

// ---------- texts ----------

const Texts EN = {
  "NEXT PASS", "RECEIVING", "OVERHEAD", "too low, not recorded", "No pass right now", "TODAY", "left", "in",
  "No upcoming passes", "Connecting to Wi-Fi...", "raspberry_sat not answering", "Waiting for the time...",
  "LAST PASS", "locked", "searching", "synced", "no sync", "FRAMES", "peak", "VITERBI", "DEFRAMER",
  {"SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"},
};
const Texts ES = {
  "PROXIMA PASADA", "RECIBIENDO", "PASANDO", "muy baja, sin grabar", "Ninguna pasada ahora", "HOY", "faltan", "en",
  "No hay pasadas", "Conectando al Wi-Fi...", "raspberry_sat no responde", "Esperando la hora...",
  "ULTIMA PASADA", "enganchado", "buscando", "sincroniz.", "sin sinc.", "TRAMAS", "pico", "VITERBI", "DEFRAMER",
  {"DOM", "LUN", "MAR", "MIE", "JUE", "VIE", "SAB"},
};

// ---------- data shared between the network task and the screen (types in types.h) ----------

Data shared;                               // written by the network task
Data view;                                 // the screen's copy, taken before each frame
SemaphoreHandle_t dataLock;

void lockData() { xSemaphoreTake(dataLock, portMAX_DELAY); }
void unlockData() { xSemaphoreGive(dataLock); }

// ---------- network (runs on core 0, so the screen never waits for it) ----------

String baseUrl;                            // "http://192.168.1.10:8000", empty until resolved

bool resolveServer() {
  if (baseUrl.length()) return true;
  String host = SERVER_HOST;
  IPAddress ip;
  if (host.endsWith(".local")) {
    static bool mdnsStarted = false;
    if (!mdnsStarted) mdnsStarted = MDNS.begin("sat-companion");
    String name = host.substring(0, host.length() - 6);
    ip = MDNS.queryHost(name.c_str(), 3000);
    if (ip == IPAddress()) return false;
  } else if (!ip.fromString(host) && !WiFi.hostByName(host.c_str(), ip)) {
    return false;
  }
  baseUrl = "http://" + ip.toString() + ":" + String(SERVER_PORT);
  Serial.printf("raspberry_sat at %s\n", baseUrl.c_str());
  return true;
}

bool getJson(const String &path, JsonDocument &doc, JsonDocument &filter) {
  WiFiClient client;
  HTTPClient http;
  http.useHTTP10(true);                    // no chunked replies, so ArduinoJson can read the stream directly
  http.setTimeout(6000);
  if (!http.begin(client, baseUrl + path)) return false;
  int code = http.GET();
  bool ok = false;
  if (code == HTTP_CODE_OK) {
    ok = !deserializeJson(doc, http.getStream(), DeserializationOption::Filter(filter));
  }
  http.end();
  if (code < 0) baseUrl = "";              // no connection: look the server up again next time
  return ok;
}

void fetchConfig() {
  JsonDocument filter, doc;
  filter["display"]["language"] = true;
  filter["display"]["show_low_passes"] = true;
  if (!getJson("/api/config", doc, filter)) return;
  lockData();
  shared.spanish = doc["display"]["language"] == "es";
  shared.showLow = doc["display"]["show_low_passes"] | true;
  unlockData();
}

bool fetchSchedule() {
  JsonDocument filter, doc;
  for (const char *field : {"name", "aos", "los", "max_el", "aos_az", "los_az", "scheduled"}) {
    filter["passes"][0][field] = true;
  }
  if (!getJson("/api/schedule?tracks=0", doc, filter)) return false;
  lockData();
  shared.passCount = 0;
  for (JsonObject p : doc["passes"].as<JsonArray>()) {
    if (shared.passCount >= MAX_PASSES) break;
    Pass &d = shared.passes[shared.passCount++];
    strlcpy(d.name, p["name"] | "?", sizeof(d.name));
    d.aos = (uint32_t)(p["aos"] | 0.0);
    d.los = (uint32_t)(p["los"] | 0.0);
    d.maxEl = p["max_el"] | 0.0f;
    d.aosAz = p["aos_az"] | 0.0f;
    d.losAz = p["los_az"] | 0.0f;
    d.scheduled = p["scheduled"] | false;
  }
  unlockData();
  return true;
}

void fetchStatus() {
  JsonDocument filter, doc;
  filter["receiving"] = true;
  filter["overhead"] = true;
  filter["tracker"]["frequency"] = true;
  for (const char *field : {"object_name", "next_aos_time", "next_los_time", "sat_current_pos", "sat_current_range"}) {
    filter["tracker"]["object_tracker"][field] = true;
  }
  bool ok = getJson("/api/status", doc, filter);
  lockData();
  shared.server = ok;
  if (ok) {
    shared.receiving = doc["receiving"] | false;
    shared.overhead = doc["overhead"] | false;
    JsonObject t = doc["tracker"]["object_tracker"].as<JsonObject>();
    shared.hasTracker = !t.isNull();
    if (shared.hasTracker) {
      strlcpy(shared.object, t["object_name"] | "", sizeof(shared.object));
      shared.nextAos = (uint32_t)(t["next_aos_time"] | 0.0);
      shared.nextLos = (uint32_t)(t["next_los_time"] | 0.0);
      shared.az = t["sat_current_pos"]["az"] | 0.0f;
      shared.el = t["sat_current_pos"]["el"] | 0.0f;
      shared.range = t["sat_current_range"] | -1.0f;
    }
    shared.freqMHz = (doc["tracker"]["frequency"] | 0.0) / 1e6;
  }
  unlockData();
}

double liveAfter = 0;                      // newest sample already fetched
double livePass = -1;                      // pass_started of the samples held

int8_t flag(JsonVariant v) {
  if (v.isNull()) return -1;
  return (v.is<bool>() ? v.as<bool>() : v.as<int>() != 0) ? 1 : 0;
}

void fetchLive() {
  JsonDocument filter, doc;
  for (const char *field : {"receiving", "pass_started", "last_los", "cadu_bytes"}) filter[field] = true;
  for (const char *field : {"t", "el", "snr", "peak_snr", "freq", "viterbi_ber", "viterbi_lock", "deframer_lock", "rs_avg"}) {
    filter["history"][0][field] = true;
  }
  if (!getJson("/api/live?after=" + String(liveAfter, 1), doc, filter)) return;

  double started = doc["pass_started"] | 0.0;
  lockData();
  if (started != livePass) {               // a new pass: start the chart over
    livePass = started;
    shared.sampleCount = 0;
  }
  shared.passStarted = (uint32_t)started;
  shared.lastLos = (uint32_t)(doc["last_los"] | 0.0);
  shared.caduBytes = doc["cadu_bytes"] | 0;
  for (JsonObject s : doc["history"].as<JsonArray>()) {
    double t = s["t"] | 0.0;
    if (t > liveAfter) liveAfter = t;
    if (shared.sampleCount == MAX_SAMPLES) {          // full: drop the older half
      memmove(shared.samples, shared.samples + MAX_SAMPLES / 2, sizeof(Sample) * (MAX_SAMPLES / 2));
      shared.sampleCount = MAX_SAMPLES / 2;
    }
    Sample &smp = shared.samples[shared.sampleCount++];
    smp.t = (uint32_t)t;
    smp.snr = s["snr"].isNull() ? NAN : s["snr"].as<float>();
    smp.el = s["el"].isNull() ? NAN : s["el"].as<float>();
    smp.sync = flag(s["deframer_lock"]);
    if (!s["snr"].isNull()) shared.snr = smp.snr;
    if (!s["peak_snr"].isNull()) shared.peakSnr = s["peak_snr"].as<float>();
    if (!s["viterbi_ber"].isNull()) shared.ber = s["viterbi_ber"].as<float>();
    if (!s["freq"].isNull()) shared.freqOffset = s["freq"].as<float>();
    if (!s["rs_avg"].isNull()) shared.rs = s["rs_avg"].as<float>();
    if (!s["viterbi_lock"].isNull()) shared.vit = flag(s["viterbi_lock"]);
    if (!s["deframer_lock"].isNull()) shared.dfr = smp.sync;
  }
  unlockData();
}

void networkTask(void *) {
  uint32_t lastSchedule = 0;
  bool haveSchedule = false;
  for (;;) {
    bool wifi = WiFi.status() == WL_CONNECTED;
    lockData();
    shared.wifi = wifi;
    if (!wifi) shared.server = false;
    unlockData();
    if (!wifi || !resolveServer()) {
      if (wifi) {
        lockData();
        shared.server = false;
        unlockData();
      }
      vTaskDelay(pdMS_TO_TICKS(3000));
      continue;
    }
    if (!haveSchedule || millis() - lastSchedule > SCHEDULE_EVERY_MS) {
      fetchConfig();
      haveSchedule = fetchSchedule();
      lastSchedule = millis();
    }
    fetchStatus();
    fetchLive();
    vTaskDelay(pdMS_TO_TICKS(STATUS_EVERY_MS));
  }
}

// ---------- display ----------

Arduino_DataBus *bus = new Arduino_ESP32SPI(LCD_DC, LCD_CS, LCD_SCK, LCD_MOSI, LCD_MISO);
Arduino_GFX *panel = new Arduino_ST7789(bus, LCD_RST, LCD_ROTATION, true /* IPS */, 240, 320);
Arduino_Canvas *gfx = new Arduino_Canvas(W, H, panel);   // draw a whole frame, then send it: no flicker

const Texts &T() { return view.spanish ? ES : EN; }

// the built-in font is 6x8 per character (times size); a '~' (DEG) is drawn as a small degree circle.
// No default arguments in this file: the Arduino build would repeat them in its generated declarations.
void text(int x, int y, const char *s, uint16_t color, uint8_t size) {
  char plain[64];
  strlcpy(plain, s, sizeof(plain));
  for (char *c = plain; *c; c++) {
    if (*c == '~') *c = ' ';
  }
  gfx->setTextSize(size);
  gfx->setTextColor(color);
  gfx->setCursor(x, y);
  gfx->print(plain);
  for (int i = 0; s[i] && i < (int)sizeof(plain) - 1; i++) {
    if (s[i] == '~') gfx->drawCircle(x + i * 6 * size + 2 * size, y + 2 * size, size, color);
  }
}
void text(int x, int y, const char *s, uint16_t color) { text(x, y, s, color, 1); }
int textWidth(const char *s, uint8_t size) { return strlen(s) * 6 * size; }
void textRight(int right, int y, const char *s, uint16_t color, uint8_t size) {
  text(right - textWidth(s, size), y, s, color, size);
}
void textRight(int right, int y, const char *s, uint16_t color) { textRight(right, y, s, color, 1); }
void textCenter(int cx, int y, const char *s, uint16_t color, uint8_t size) {
  text(cx - textWidth(s, size) / 2, y, s, color, size);
}
void textCenter(int cx, int y, const char *s, uint16_t color) { textCenter(cx, y, s, color, 1); }
// the biggest size (up to `size`) at which `s` fits in `width`
uint8_t fitSize(const char *s, int width, uint8_t size) {
  while (size > 1 && textWidth(s, size) > width) size--;
  return size;
}

bool timeValid(time_t now) { return now > 1700000000; }

void clockText(uint32_t t, char *out, size_t n) {          // local "16:21"
  time_t tt = t;
  struct tm lt;
  localtime_r(&tt, &lt);
  snprintf(out, n, "%02d:%02d", lt.tm_hour, lt.tm_min);
}

void countdown(long s, char *out, size_t n) {
  if (s < 0) s = 0;
  long d = s / 86400, h = (s % 86400) / 3600, m = (s % 3600) / 60, sec = s % 60;
  if (d > 0) snprintf(out, n, "%ldd %02ldh", d, h);
  else if (h > 0) snprintf(out, n, "%ld:%02ld:%02ld", h, m, sec);
  else snprintf(out, n, "%02ld:%02ld", m, sec);
}

void shortDuration(long s, char *out, size_t n) {          // "2h05", "14m", "3d"
  if (s < 0) s = 0;
  if (s >= 86400) snprintf(out, n, "%ldd", s / 86400);
  else if (s >= 3600) snprintf(out, n, "%ldh%02ld", s / 3600, (s % 3600) / 60);
  else snprintf(out, n, "%ldm", s / 60);
}

const char *compass(float az) {
  static const char *en[] = {"N", "NE", "E", "SE", "S", "SW", "W", "NW"};
  static const char *es[] = {"N", "NE", "E", "SE", "S", "SO", "O", "NO"};
  int i = ((int)lroundf(az / 45.0f)) % 8;
  if (i < 0) i += 8;
  return (view.spanish ? es : en)[i];
}

uint16_t qualityColor(const Pass &p) {
  if (!p.scheduled) return C_LINE;
  return p.maxEl >= EXCELLENT ? C_EXCELLENT : p.maxEl >= GOOD ? C_GOOD : C_FAIR;
}

const Pass *findPass(uint32_t now, bool scheduledOnly, bool current) {
  for (int i = 0; i < view.passCount; i++) {
    const Pass &p = view.passes[i];
    if (scheduledOnly && !p.scheduled) continue;
    if (current ? (p.aos <= now + 60 && now <= p.los + 60) : p.aos > now) return &p;
  }
  return nullptr;
}

void drawTopBar(time_t now) {
  gfx->fillRect(0, 0, W, 18, C_PANEL);
  text(6, 5, "raspberry_sat", C_TEXT);
  uint16_t dot = !view.wifi ? C_DANGER : !view.server ? C_WARN : C_OK;
  gfx->fillCircle(W - 8, 9, 3, dot);
  if (timeValid(now)) {
    struct tm lt, ut;
    localtime_r(&now, &lt);
    gmtime_r(&now, &ut);
    char buf[32];
    snprintf(buf, sizeof(buf), "%02d:%02d:%02d  %02d:%02d UTC", lt.tm_hour, lt.tm_min, lt.tm_sec, ut.tm_hour, ut.tm_min);
    textRight(W - 16, 5, buf, C_DIM);
  }
}

void drawPageDots(int page) {
  for (int i = 0; i < 2; i++) {
    int x = W / 2 - 6 + i * 12;
    if (i == page) gfx->fillCircle(x, H - 5, 3, C_TEXT);
    else gfx->drawCircle(x, H - 5, 3, C_DIM);
  }
}

// a message in the middle of the screen when there is nothing to show yet
bool drawProblem(time_t now) {
  const char *msg = !view.wifi ? T().connecting : !view.server ? T().noServer : !timeValid(now) ? T().noTime : nullptr;
  if (!msg) return false;
  textCenter(W / 2, H / 2 - 8, msg, C_DIM, fitSize(msg, W - 20, 2));
  return true;
}

// ---------- page 1: next pass and upcoming passes ----------

const int LIST_TOP = 118, LIST_BOTTOM = 228, ROW_H = 24, DAY_H = 16;
int listScroll = 0;

void drawNextCard(uint32_t now) {
  const int x0 = 4, y0 = 22, w = W - 8, h = 92;
  gfx->fillRoundRect(x0, y0, w, h, 6, C_PANEL);

  const char *label = T().next;
  uint16_t labelColor = C_DIM, stripe = C_ACCENT, countColor = C_TEXT;
  const Pass *p = nullptr;
  uint32_t target = 0;
  char name[24] = "";
  if (view.receiving || view.overhead) {
    p = findPass(now, false, true);
    label = view.receiving ? T().receiving : T().overhead;
    labelColor = stripe = countColor = view.receiving ? C_OK : C_DIM;
    target = p ? p->los : view.nextLos;
    strlcpy(name, p ? p->name : view.object, sizeof(name));
  } else if ((p = findPass(now, true, false)) != nullptr) {
    stripe = qualityColor(*p);
    target = p->aos;
    strlcpy(name, p->name, sizeof(name));
  }
  if (!target) {
    textCenter(W / 2, y0 + h / 2 - 4, T().noPasses, C_DIM);
    return;
  }

  gfx->fillRect(x0, y0 + 4, 4, h - 8, stripe);
  text(x0 + 12, y0 + 7, label, labelColor);
  text(x0 + 12, y0 + 19, name, C_TEXT, 2);

  char buf[48], tmp[24];
  countdown((long)target - (long)now, tmp, sizeof(tmp));
  if (view.receiving || view.overhead) snprintf(buf, sizeof(buf), "%s %s", tmp, T().left);
  else strlcpy(buf, tmp, sizeof(buf));
  text(x0 + 12, y0 + 42, buf, countColor, fitSize(buf, w - 24, 4));

  if (p) {
    char aos[8], los[8];
    clockText(p->aos, aos, sizeof(aos));
    clockText(p->los, los, sizeof(los));
    snprintf(buf, sizeof(buf), "%s-%s  %d" DEG "  %s>%s", aos, los, (int)lroundf(p->maxEl),
             compass(p->aosAz), compass(p->losAz));
    text(x0 + 12, y0 + h - 14, buf, C_DIM);
  }
  if (view.overhead && !view.receiving) textRight(x0 + w - 8, y0 + 7, T().notRecorded, C_DIM);
}

void dayLabel(uint32_t t, uint32_t now, char *out, size_t n) {
  time_t a = t, b = now;
  struct tm lt, today;
  localtime_r(&a, &lt);
  localtime_r(&b, &today);
  if (lt.tm_year == today.tm_year && lt.tm_yday == today.tm_yday) strlcpy(out, T().today, n);
  else snprintf(out, n, "%s %d", T().days[lt.tm_wday], lt.tm_mday);
}

// the list's rows, with day headers, top to bottom; returns the total height
int layoutList(uint32_t now, int16_t *rowY, int8_t *rowKind, int16_t *rowPass, int maxRows, int &count) {
  count = 0;
  int y = 0;
  char day[16] = "", label[16];
  for (int i = 0; i < view.passCount && count < maxRows - 1; i++) {
    const Pass &p = view.passes[i];
    if (p.los < now || (!view.showLow && !p.scheduled)) continue;
    dayLabel(p.aos, now, label, sizeof(label));
    if (strcmp(label, day) != 0) {
      strlcpy(day, label, sizeof(day));
      rowY[count] = y; rowKind[count] = 0; rowPass[count] = i; count++;
      y += DAY_H;
    }
    rowY[count] = y; rowKind[count] = 1; rowPass[count] = i; count++;
    y += ROW_H;
  }
  return y;
}

void drawList(uint32_t now) {
  static int16_t rowY[MAX_PASSES * 2];
  static int8_t rowKind[MAX_PASSES * 2];
  static int16_t rowPass[MAX_PASSES * 2];
  int count;
  int total = layoutList(now, rowY, rowKind, rowPass, MAX_PASSES * 2, count);
  int maxScroll = max(0, total - (LIST_BOTTOM - LIST_TOP));
  listScroll = constrain(listScroll, 0, maxScroll);

  for (int r = 0; r < count; r++) {
    int h = rowKind[r] == 0 ? DAY_H : ROW_H;
    int y = LIST_TOP + rowY[r] - listScroll;
    if (y < LIST_TOP || y + h > LIST_BOTTOM) continue;           // only whole rows
    const Pass &p = view.passes[rowPass[r]];
    char buf[40];
    if (rowKind[r] == 0) {
      dayLabel(p.aos, now, buf, sizeof(buf));
      text(8, y + 5, buf, C_TEXT);
      gfx->drawFastHLine(4, y + h - 2, W - 8, C_DIM);
      continue;
    }
    bool live = p.aos <= now && now <= p.los;
    bool low = !p.scheduled;
    if (live) gfx->fillRect(4, y + 1, W - 8, h - 2, C_PANEL);
    gfx->fillRect(4, y + 3, 4, h - 6, qualityColor(p));
    clockText(p.aos, buf, sizeof(buf));
    text(14, y + 4, buf, low ? C_DIM : C_TEXT, 2);
    text(80, y + 3, p.name, low ? C_DIM : C_TEXT);
    char dur[12];
    shortDuration((long)p.los - (long)p.aos, dur, sizeof(dur));
    snprintf(buf, sizeof(buf), "%d" DEG "  %s  %s>%s", (int)lroundf(p.maxEl), dur, compass(p.aosAz), compass(p.losAz));
    text(80, y + 13, buf, C_DIM);
    if (live) strlcpy(buf, T().receiving, sizeof(buf));
    else {
      shortDuration((long)p.aos - (long)now, dur, sizeof(dur));
      snprintf(buf, sizeof(buf), "%s %s", T().in, dur);
    }
    textRight(W - 10, y + 8, buf, live ? C_OK : C_DIM);
  }
  if (maxScroll > 0) {                                           // scroll position
    int barH = max(12, (LIST_BOTTOM - LIST_TOP) * (LIST_BOTTOM - LIST_TOP) / total);
    int barY = LIST_TOP + (LIST_BOTTOM - LIST_TOP - barH) * listScroll / maxScroll;
    gfx->fillRect(W - 3, barY, 2, barH, C_LINE);
  }
}

void drawPassesPage(uint32_t now) {
  drawNextCard(now);
  drawList(now);
}

// ---------- page 2: live pass ----------

void tile(int x, int y, int w, int h, const char *label, const char *value, uint16_t color, const char *sub) {
  gfx->fillRoundRect(x, y, w, h, 4, C_PANEL);
  gfx->fillRect(x, y + 3, 3, h - 6, color);
  text(x + 7, y + 5, label, C_DIM);
  text(x + 7, y + 17, value, color, fitSize(value, w - 10, 2));
  if (sub && *sub) text(x + 7, y + h - 11, sub, C_DIM);
}

// SNR over the pass, elevation behind it (dashed), and a strip that is green while frames sync
void drawChart(int x, int y, int w, int h, uint32_t start, uint32_t end) {
  gfx->fillRoundRect(x, y, w, h, 4, C_PANEL);
  if (end <= start || view.sampleCount < 2) return;
  const int strip = 6, plotH = h - strip - 6;
  float top = 10;
  for (int i = 0; i < view.sampleCount; i++) {
    if (!isnan(view.samples[i].snr)) top = max(top, view.samples[i].snr + 1);
  }
  auto px = [&](uint32_t t) { return x + (int)((float)(t - start) * (w - 1) / (float)(end - start)); };
  int prevX = -1, prevS = -1, prevE = -1;
  for (int i = 0; i < view.sampleCount; i++) {
    const Sample &s = view.samples[i];
    if (s.t < start || s.t > end) continue;
    int cx = px(s.t);
    if (!isnan(s.el)) {
      int ey = y + 3 + plotH - (int)(max(0.0f, s.el) / 90.0f * plotH);
      if (prevE >= 0 && (i & 2)) gfx->drawLine(prevX, prevE, cx, ey, C_DIM);   // dashed
      prevE = ey;
    }
    if (!isnan(s.snr)) {
      int sy = y + 3 + plotH - (int)(max(0.0f, s.snr) / top * plotH);
      if (prevS >= 0) gfx->drawLine(prevX, prevS, cx, sy, C_ACCENT);
      prevS = sy;
    }
    if (s.sync >= 0) {
      int nx = i + 1 < view.sampleCount ? px(view.samples[i + 1].t) : cx + 1;
      gfx->fillRect(cx, y + h - strip - 2, max(1, nx - cx), strip, s.sync ? C_OK : C_DANGER);
    }
    prevX = cx;
  }
}

void drawLivePage(uint32_t now) {
  char buf[48], sub[24];
  const Pass *cur = findPass(now, false, true);

  if (view.receiving && view.hasTracker) {
    text(8, 24, T().receiving, C_OK);
    text(8, 35, view.object, C_TEXT, 2);

    uint32_t aos = cur ? cur->aos : view.passStarted, los = cur ? cur->los : view.nextLos;
    float share = los > aos ? constrain((float)(now - aos) / (float)(los - aos), 0.0f, 1.0f) : 0;
    gfx->fillRoundRect(8, 56, W - 16, 8, 4, C_LINE);
    gfx->fillRoundRect(8, 56, max(8, (int)((W - 16) * share)), 8, 4, C_ACCENT);
    clockText(aos, buf, sizeof(buf));
    text(8, 68, buf, C_DIM);
    clockText(los, buf, sizeof(buf));
    textRight(W - 8, 68, buf, C_DIM);
    countdown((long)los - (long)now, sub, sizeof(sub));
    snprintf(buf, sizeof(buf), "%s %s", sub, T().left);
    textCenter(W / 2, 68, buf, C_TEXT);

    const int ty = 80, th = 46, tw = (W - 16 - 9) / 4;
    // SNR
    uint16_t c = isnan(view.snr) ? C_DIM : view.snr >= 4 ? C_OK : view.snr >= 2 ? C_WARN : C_DANGER;
    snprintf(buf, sizeof(buf), isnan(view.snr) ? "..." : "%.1f", view.snr);
    snprintf(sub, sizeof(sub), isnan(view.peakSnr) ? "" : "%s %.1f", T().peak, view.peakSnr);
    tile(8, ty, tw, th, "SNR dB", buf, c, sub);
    // Viterbi
    c = view.vit < 0 ? C_DIM : view.vit ? C_OK : C_DANGER;
    snprintf(sub, sizeof(sub), isnan(view.ber) ? "" : "BER %.3f", view.ber);
    tile(8 + (tw + 3), ty, tw, th, T().viterbi, view.vit < 0 ? "..." : view.vit ? T().locked : T().searching, c, sub);
    // deframer
    c = view.dfr < 0 ? C_DIM : view.dfr ? C_OK : C_DANGER;
    tile(8 + 2 * (tw + 3), ty, tw, th, T().deframer, view.dfr < 0 ? "..." : view.dfr ? T().synced : T().noSync, c, "");
    // frames
    snprintf(buf, sizeof(buf), "%lu", (unsigned long)(view.caduBytes / 1024));
    snprintf(sub, sizeof(sub), "%.1f MB", view.caduBytes / 1048576.0);
    tile(8 + 3 * (tw + 3), ty, tw, th, T().frames, buf, view.caduBytes ? C_OK : C_DIM, sub);

    drawChart(8, 132, W - 16, 86, aos, los);
    snprintf(buf, sizeof(buf), "el %d" DEG "  az %d" DEG "  %d km  %+d Hz", (int)lroundf(view.el), (int)lroundf(view.az),
             (int)lroundf(view.range), isnan(view.freqOffset) ? 0 : (int)lroundf(view.freqOffset));
    text(8, 222, buf, C_DIM);
    return;
  }

  // nothing being received
  int y = 26;
  if (view.overhead && view.hasTracker) {
    snprintf(buf, sizeof(buf), "%s %s", view.object, T().overhead);
    text(8, y, buf, C_TEXT, fitSize(buf, W - 16, 2));
    snprintf(buf, sizeof(buf), "%s  el %d" DEG "  az %d" DEG, T().notRecorded, (int)lroundf(view.el), (int)lroundf(view.az));
    text(8, y + 20, buf, C_DIM);
  } else {
    text(8, y, T().noPassNow, C_DIM, 2);
  }

  const Pass *next = findPass(now, true, false);
  if (next) {
    gfx->fillRoundRect(4, 64, W - 8, 52, 6, C_PANEL);
    gfx->fillRect(4, 68, 4, 44, qualityColor(*next));
    text(16, 70, T().next, C_DIM);
    text(16, 82, next->name, C_TEXT, 2);
    countdown((long)next->aos - (long)now, buf, sizeof(buf));
    textRight(W - 14, 76, buf, C_TEXT, fitSize(buf, 150, 3));
  }

  bool recent = view.lastLos && now - view.lastLos < 3600 && view.sampleCount > 1;
  if (recent) {
    char los[8];
    clockText(view.lastLos, los, sizeof(los));
    snprintf(buf, sizeof(buf), "%s  %s", T().lastPass, los);
    text(8, 124, buf, C_DIM);
    drawChart(8, 136, W - 16, 86, view.passStarted, view.lastLos);
  }
}

// ---------- touch ----------

void touchWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(TOUCH_ADDR);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
}

bool readTouch(int &x, int &y) {
  Wire.beginTransmission(TOUCH_ADDR);
  Wire.write(0x02);                                 // finger count, then X high/low, Y high/low
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint16_t)TOUCH_ADDR, (size_t)5) != 5) return false;
  uint8_t fingers = Wire.read(), xh = Wire.read(), xl = Wire.read(), yh = Wire.read(), yl = Wire.read();
  if ((fingers & 0x0F) == 0) return false;
  int tx = ((xh & 0x0F) << 8) | xl, ty = ((yh & 0x0F) << 8) | yl;
  int sx = TOUCH_SWAP_XY ? ty : tx, sy = TOUCH_SWAP_XY ? tx : ty;
  if (TOUCH_INVERT_X) sx = W - 1 - sx;
  if (TOUCH_INVERT_Y) sy = H - 1 - sy;
  x = constrain(sx, 0, W - 1);
  y = constrain(sy, 0, H - 1);
  return true;
}

int page = 0;
bool dirty = true;

struct {
  bool down = false;
  int x0 = 0, y0 = 0, x = 0, y = 0, scroll0 = 0;
} touch;

void pollTouch() {
  int x, y;
  bool pressed = readTouch(x, y);
  if (pressed && !touch.down) {
    touch = {true, x, y, x, y, listScroll};
  } else if (pressed) {
    touch.x = x;
    touch.y = y;
    int dx = x - touch.x0, dy = y - touch.y0;
    if (page == 0 && touch.y0 >= LIST_TOP && abs(dy) > abs(dx)) {     // drag the list
      listScroll = touch.scroll0 - dy;
      dirty = true;
    }
  } else if (touch.down) {
    touch.down = false;
    int dx = touch.x - touch.x0, dy = touch.y - touch.y0;
    if (abs(dx) > 50 && abs(dx) > 2 * abs(dy)) {                      // horizontal swipe: change page
      page = constrain(page + (dx < 0 ? 1 : -1), 0, 1);
      dirty = true;
    }
  }
}

// ---------- main ----------

void draw() {
  lockData();
  view = shared;
  unlockData();
  time_t now = time(nullptr);
  gfx->fillScreen(C_BG);
  drawTopBar(now);
  if (!drawProblem(now)) {
    if (page == 0) drawPassesPage((uint32_t)now);
    else drawLivePage((uint32_t)now);
  }
  drawPageDots(page);
  gfx->flush();
}

void setup() {
  Serial.begin(115200);
  dataLock = xSemaphoreCreateMutex();

  pinMode(LCD_BL, OUTPUT);
  digitalWrite(LCD_BL, HIGH);
  if (!gfx->begin()) Serial.println("display init failed");
  gfx->fillScreen(C_BG);
  gfx->flush();

  Wire.begin(TOUCH_SDA, TOUCH_SCL, 400000);
  touchWrite(0xFE, 0x01);                           // CST816: no auto sleep, so it answers every poll

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  configTzTime(TIMEZONE, NTP_SERVER);

  xTaskCreatePinnedToCore(networkTask, "network", 12288, nullptr, 1, nullptr, 0);
}

uint32_t lastDraw = 0;

void loop() {
  pollTouch();
  if (dirty || millis() - lastDraw >= 250) {
    draw();
    lastDraw = millis();
    dirty = false;
  }
  delay(10);
}
