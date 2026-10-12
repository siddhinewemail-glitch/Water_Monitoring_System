// ESP32 water quality node: TDS (analog) + DS18B20 temperature -> Supabase.
//
// Wiring
//   TDS module  : VCC -> 3V3, GND -> GND, A (signal) -> GPIO34
//   DS18B20     : VDD -> 3V3, GND -> GND, DQ -> GPIO4 with a 4.7k pull-up to 3V3
//
// Libraries: OneWire, DallasTemperature (Library Manager).

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include "secrets.h"

#define TDS_PIN      34   // ADC1 pin; ADC2 pins don't work while Wi-Fi is on
#define DS18B20_PIN  4

// Calibration factor: dip the probe in a known solution (e.g. 342 ppm NaCl)
// and set TDS_K = known_ppm / measured_ppm_with_K_1.
const float TDS_K = 1.0;

// Below this the probe is almost certainly dry, unpowered or disconnected.
const int ADC_FLOOR = 5;

const unsigned long UPLOAD_INTERVAL_MS = 10000;
const unsigned long WIFI_RETRY_MS = 15000;

OneWire oneWire(DS18B20_PIN);
DallasTemperature sensors(&oneWire);

unsigned long lastUpload = 0;
unsigned long lastWifiAttempt = 0;

struct Reading {
  int adc;
  float voltage;       // volts at the pin
  float temperature;   // deg C
  bool tempValid;
  bool tdsValid;
  float tdsPpm;
  const char* status;
};

// Median of 30 samples rejects the ESP32 ADC's spikes better than a mean.
int readAdcMedian(int pin, int samples, int* millivolts) {
  int raw[30];
  int mv[30];
  for (int i = 0; i < samples; i++) {
    raw[i] = analogRead(pin);
    mv[i] = analogReadMilliVolts(pin);  // uses the chip's eFuse calibration
    delay(10);
  }
  for (int i = 1; i < samples; i++) {
    for (int j = i; j > 0 && raw[j - 1] > raw[j]; j--) {
      int t = raw[j]; raw[j] = raw[j - 1]; raw[j - 1] = t;
    }
    for (int j = i; j > 0 && mv[j - 1] > mv[j]; j--) {
      int t = mv[j]; mv[j] = mv[j - 1]; mv[j - 1] = t;
    }
  }
  *millivolts = mv[samples / 2];
  return raw[samples / 2];
}

// DFRobot Gravity TDS conversion with temperature compensation to 25 C.
float voltageToPpm(float voltage, float temperature) {
  float comp = 1.0 + 0.02 * (temperature - 25.0);
  float v = voltage / comp;
  float ppm = (133.42 * v * v * v - 255.86 * v * v + 857.39 * v) * 0.5;
  return ppm * TDS_K;
}

const char* classify(const Reading& r) {
  if (!r.tempValid) return "TEMP_ERROR";
  if (!r.tdsValid)  return "TDS_SENSOR_ERROR";
  if (r.tdsPpm < 300)  return "EXCELLENT";
  if (r.tdsPpm < 600)  return "GOOD";
  if (r.tdsPpm < 900)  return "FAIR";
  if (r.tdsPpm < 1200) return "POOR";
  return "UNSAFE";
}

Reading takeReading() {
  Reading r;
  int mv = 0;
  r.adc = readAdcMedian(TDS_PIN, 30, &mv);
  if (mv > 0) {
    r.voltage = mv / 1000.0;
  } else {
    r.voltage = (r.adc / 4095.0) * 3.3;
  }

  sensors.requestTemperatures();
  r.temperature = sensors.getTempCByIndex(0);
  r.tempValid = r.temperature != DEVICE_DISCONNECTED_C &&
                r.temperature > -55.0 && r.temperature < 125.0;

  r.tdsValid = r.adc > ADC_FLOOR;
  float t = r.tempValid ? r.temperature : 25.0;
  r.tdsPpm = r.tdsValid ? voltageToPpm(r.voltage, t) : 0;
  r.status = classify(r);
  return r;
}

void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastWifiAttempt < WIFI_RETRY_MS && lastWifiAttempt != 0) return;
  lastWifiAttempt = millis();
  Serial.println("Wi-Fi: (re)connecting...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void sendToSupabase(const Reading& r) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi down; upload skipped");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();  // Prototype only: pin the Supabase root CA for production.

  HTTPClient http;
  String endpoint = String(SUPABASE_URL) + "/rest/v1/water_quality_data";
  if (!http.begin(client, endpoint)) {
    Serial.println("HTTPS setup failed");
    return;
  }

  http.setTimeout(15000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Prefer", "return=minimal");

  String p = "{";
  p += "\"device_id\":\"" DEVICE_ID "\",";
  p += "\"tds_adc\":" + String(r.adc) + ",";
  p += "\"tds_voltage\":" + String(r.voltage, 3) + ",";
  p += "\"tds_ppm\":" + (r.tdsValid ? String(r.tdsPpm, 1) : String("null")) + ",";
  p += "\"temperature\":" + (r.tempValid ? String(r.temperature, 2) : String("null")) + ",";
  p += "\"water_status\":\"" + String(r.status) + "\",";
  p += "\"rssi\":" + String(WiFi.RSSI());
  p += "}";

  int code = http.POST(p);
  if (code >= 200 && code < 300) {
    Serial.printf("Upload OK (HTTP %d)\n", code);
  } else {
    Serial.printf("Upload failed (HTTP %d): ", code);
    Serial.println(code > 0 ? http.getString() : http.errorToString(code));
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  analogSetPinAttenuation(TDS_PIN, ADC_11db);
  sensors.begin();
  Serial.printf("DS18B20 devices found: %d\n", sensors.getDeviceCount());

  WiFi.mode(WIFI_STA);
  ensureWifi();
}

void loop() {
  ensureWifi();

  if (millis() - lastUpload < UPLOAD_INTERVAL_MS) {
    delay(50);
    return;
  }
  lastUpload = millis();

  Reading r = takeReading();
  Serial.println("------------------------------");
  Serial.printf("TDS ADC: %d  (%.3f V)\n", r.adc, r.voltage);
  if (r.tdsValid) Serial.printf("TDS: %.1f ppm\n", r.tdsPpm);
  else            Serial.println("TDS: no signal - check probe wiring/power/immersion");
  if (r.tempValid) Serial.printf("Temperature: %.2f C\n", r.temperature);
  else             Serial.println("DS18B20 error - check 4.7k pull-up");
  Serial.printf("Status: %s\n", r.status);

  sendToSupabase(r);
}
