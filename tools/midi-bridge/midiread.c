// midiread — CoreMIDI を直接使う最小の MIDI 入力リーダー（Mac / arm64）。
// なぜ存在するか:
//   Electron(Chromium) の Web MIDI(navigator.requestMIDIAccess) がこの版では
//   権限を許可しても解決せず、MIDI 入力が一切届かない。NDI と同じく、OS ネイティブの
//   CoreMIDI を直接叩く小さな部品を子プロセスとして起動し、受信した MIDI を stdout に
//   1 行ずつ出す。アプリ(main)はそれを読んで renderer へ渡す。
//
// 出力フォーマット（1行ずつ・行頭で種別）:
//   PORT <表示名>            … 接続した入力ポート名（起動時＋接続変化時）
//   READY <ポート数>
//   M <s> <d1> <d2>          … 受信した MIDI メッセージ（10進。ノート/CC 等の3バイト）
//
// ビルド: clang -arch arm64 -framework CoreMIDI -framework CoreFoundation -o midiread midiread.c
#include <CoreMIDI/CoreMIDI.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdio.h>

static MIDIClientRef g_client;
static MIDIPortRef g_inPort;

static void emitPortName(MIDIEndpointRef src) {
  CFStringRef name = NULL;
  if (MIDIObjectGetStringProperty(src, kMIDIPropertyDisplayName, &name) == noErr && name) {
    char buf[256] = "MIDI";
    CFStringGetCString(name, buf, sizeof(buf), kCFStringEncodingUTF8);
    CFRelease(name);
    printf("PORT %s\n", buf);
    fflush(stdout);
  }
}

// 受信コールバック（CoreMIDI のスレッドで呼ばれる）。パケットの先頭3バイトを1メッセージとして流す。
static void readProc(const MIDIPacketList *pl, void *a, void *b) {
  (void)a; (void)b;
  const MIDIPacket *p = &pl->packet[0];
  for (UInt32 i = 0; i < pl->numPackets; i++) {
    // チャンネルボイスメッセージは status(0x80-0xEF)+データ。先頭3バイトで note/CC を拾える。
    if (p->length >= 1) {
      unsigned s = p->data[0];
      unsigned d1 = p->length >= 2 ? p->data[1] : 0;
      unsigned d2 = p->length >= 3 ? p->data[2] : 0;
      printf("M %u %u %u\n", s, d1, d2);
      fflush(stdout);
    }
    p = MIDIPacketNext(p);
  }
}

// MIDI 構成が変わったら（機器の抜き差し）全ソースに繋ぎ直す。
static void connectAllSources(void) {
  ItemCount n = MIDIGetNumberOfSources();
  for (ItemCount i = 0; i < n; i++) {
    MIDIEndpointRef src = MIDIGetSource(i);
    if (!src) continue;
    emitPortName(src);
    MIDIPortConnectSource(g_inPort, src, NULL);
  }
  printf("READY %lu\n", (unsigned long)n);
  fflush(stdout);
}

static void notifyProc(const MIDINotification *msg, void *refCon) {
  (void)refCon;
  if (msg->messageID == kMIDIMsgSetupChanged) {
    connectAllSources(); // 抜き差しで再接続（重複接続は CoreMIDI 側で無害）
  }
}

int main(void) {
  if (MIDIClientCreate(CFSTR("LED STAGE IMAGER MIDI"), notifyProc, NULL, &g_client) != noErr) {
    fprintf(stderr, "[midi] MIDIClientCreate 失敗\n");
    return 1;
  }
  if (MIDIInputPortCreate(g_client, CFSTR("LSI In"), readProc, NULL, &g_inPort) != noErr) {
    fprintf(stderr, "[midi] MIDIInputPortCreate 失敗\n");
    return 1;
  }
  connectAllSources();
  CFRunLoopRun();
  return 0;
}
