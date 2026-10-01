#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <mbedtls/md.h>
#include "config.h"

WebServer server(80);
DNSServer dns;
static unsigned long lastReport = 0;
static unsigned long rateStart = 0;
static unsigned int rateCount = 0;

const char PORTAL[] PROGMEM = R"HTML(<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tech Pulse classroom proof</title><style>body{font:16px system-ui;background:#eff3e9;color:#183c35;max-width:540px;margin:30px auto;padding:20px}section{background:white;padding:24px;border-radius:14px}textarea{box-sizing:border-box;width:100%;min-height:120px;margin:12px 0;padding:12px;font:14px monospace;overflow-wrap:anywhere}button{background:#1e5145;color:white;padding:14px;border:0;border-radius:8px;width:100%}small{display:block;margin:12px 0;color:#647461}h1{font-size:26px}#result{display:none}</style></head><body><section><small>TECH PULSE · CLASSROOM COMPANION</small><h1>Get your classroom proof</h1><p>Paste the request code from your attendance attempt. Your photo, GPS and sign-in stay in the main app.</p><form id="form"><label for="request">Attendance request code</label><textarea id="request" required maxlength="250" autocapitalize="off" spellcheck="false"></textarea><button>Generate proof</button></form><p id="message" role="status"></p><div id="result"><label for="proof">Response code — select and copy</label><textarea id="proof" readonly onclick="this.select()"></textarea><p>Copy this response. Switch back to your normal Wi-Fi or mobile data, return to the same attendance tab, paste it, and submit before your attempt expires.</p></div><small>This Wi-Fi has no internet. Prefer Safari or Chrome over the captive mini-browser. This is proximity evidence, not exact room location or protection against live relaying.</small></section><script>document.getElementById('form').onsubmit=async e=>{e.preventDefault();const m=document.getElementById('message');document.getElementById('result').style.display='none';try{const r=await fetch('/proof',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'request='+encodeURIComponent(document.getElementById('request').value.trim())});const d=await r.json();if(!r.ok)throw Error(d.error);document.getElementById('proof').value=d.proof;document.getElementById('result').style.display='block';m.textContent='Proof generated. It is valid only for this attempt.';}catch(err){m.textContent=err.message;}};</script></body></html>)HTML";

String macFor(const String& message) {
  unsigned char hash[32];
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (!info || mbedtls_md_hmac(info, (const unsigned char*)PROOF_SECRET, strlen(PROOF_SECRET), (const unsigned char*)message.c_str(), message.length(), hash) != 0) return "";
  char hex[65];
  for (int i=0;i<32;i++) snprintf(hex+i*2,3,"%02x",hash[i]);
  hex[64]=0; return String(hex);
}
bool sameMac(const String& a,const String& b){
  if(a.length()!=64||b.length()!=64)return false;
  unsigned char diff=0;for(int i=0;i<64;i++)diff|=a[i]^b[i];return diff==0;
}
void jsonError(int code,const char* error){server.sendHeader("Cache-Control","no-store");server.send(code,"application/json",String("{\"error\":\"")+error+"\"}");}
void portal(){server.sendHeader("Cache-Control","no-store");server.send_P(200,"text/html",PORTAL);}
void setup(){
  Serial.begin(115200);
  WiFi.mode(WIFI_AP);
  WiFi.setSleep(false);
  if(strlen(AP_PASSWORD)<8 || strlen(AP_PASSWORD)>63 || strlen(PROOF_SECRET)!=64){Serial.println("Invalid generated config; run npm run esp32:prepare");return;}
  if(!WiFi.softAP(AP_SSID,AP_PASSWORD,1,false,8)){Serial.println("AP failed; restarting");delay(2000);ESP.restart();}
  dns.start(53,"*",WiFi.softAPIP());
  server.on("/",HTTP_GET,portal);
  server.on("/health",HTTP_GET,[]{server.sendHeader("Cache-Control","no-store");server.send(200,"application/json",String("{\"ready\":true,\"deviceId\":\"")+DEVICE_ID+"\",\"uptimeMs\":"+millis()+"}");});
  server.on("/proof",HTTP_POST,[]{
    const unsigned long now=millis();
    if(now-rateStart>1000){rateStart=now;rateCount=0;}
    if(++rateCount>20)return jsonError(429,"Busy; please retry shortly.");
    String request=server.arg("request");request.trim();
    if(request.length()<100||request.length()>250)return jsonError(400,"Invalid request length.");
    int separator=request.lastIndexOf('.');
    String payload=request.substring(0,separator), signature=request.substring(separator+1);
    int fields=0;for(unsigned int i=0;i<payload.length();i++){char c=payload[i];if(c=='.')fields++;else if(!isalnum(c)&&c!='-'&&c!='_')return jsonError(400,"Invalid request characters.");}
    if(fields!=3 || payload.substring(payload.lastIndexOf('.')+1)!=DEVICE_ID)return jsonError(400,"This request belongs to a different device.");
    if(!sameMac(signature,macFor("request|"+payload)))return jsonError(403,"Request signature is invalid.");
    String proof=payload+"."+macFor("proof|"+payload);
    server.sendHeader("Cache-Control","no-store");server.send(200,"application/json",String("{\"proof\":\"")+proof+"\"}");
  });
  server.onNotFound(portal);
  server.begin();
  Serial.println("Tech Pulse companion ready. Connect to configured Wi-Fi and open http://192.168.4.1");
}
void loop(){
  dns.processNextRequest();server.handleClient();
  if(millis()-lastReport>10000){lastReport=millis();Serial.printf("Ready | clients=%d | freeHeap=%u\n",WiFi.softAPgetStationNum(),ESP.getFreeHeap());}
  delay(2);
}
