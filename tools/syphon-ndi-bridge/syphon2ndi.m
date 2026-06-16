// syphon2ndi — arm64 ネイティブの Syphon → NDI ブリッジ
//
// なぜ存在するか:
//   既存の NDISyphon.app は Intel(x86_64)専用で、Apple Silicon 上の
//   arm64 ネイティブな Syphon ソース(LED STAGE IMAGER / Syphon v5)を拾えない。
//   このツールは Mac に既にある部品だけで同じ橋渡しを arm64 で行う:
//     - Syphon.framework v5 (LED STAGE IMAGER 同梱)
//     - libndi 6.x (Resolume 同梱)
//
// 動作:
//   指定名の Syphon サーバーに接続 → 毎フレーム MTLTexture を CPU に読み出し
//   → NDI で同名ソースとしてネットワークに送信。
//
// ビルド: build.sh を参照（clang で -framework Metal/Foundation、libndi/Syphon を dlopen）

#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#import <objc/message.h>
#import <dlfcn.h>

// ---------- NDI 最小宣言（公式 SDK のレイアウトに一致） ----------
typedef struct NDIlib_send_create_t {
  const char *p_ndi_name;
  const char *p_groups;
  bool clocked_video;
  bool clocked_audio;
} NDIlib_send_create_t;

typedef struct NDIlib_video_frame_v2_t {
  int xres, yres;
  int FourCC;
  int frame_rate_N, frame_rate_D;
  float picture_aspect_ratio;
  int frame_format_type;
  int64_t timecode;
  uint8_t *p_data;
  int line_stride_in_bytes;
  const char *p_metadata;
  int64_t timestamp;
} NDIlib_video_frame_v2_t;

#define NDI_FOURCC(a, b, c, d) \
  ((int)((uint32_t)(a) | ((uint32_t)(b) << 8) | ((uint32_t)(c) << 16) | ((uint32_t)(d) << 24)))
static const int kNDI_BGRA = NDI_FOURCC('B', 'G', 'R', 'A');
static const int kNDI_RGBA = NDI_FOURCC('R', 'G', 'B', 'A');
static const int kNDI_FORMAT_PROGRESSIVE = 1;

typedef bool (*NDIlib_initialize_t)(void);
typedef void *(*NDIlib_send_create_fn)(const NDIlib_send_create_t *);
typedef void (*NDIlib_send_send_video_v2_t)(void *, const NDIlib_video_frame_v2_t *);
typedef void (*NDIlib_send_destroy_t)(void *);
// 今この NDI 送信に何台の受け手(Resolume 等)がつながっているかを返す。timeout=0 で即時取得。
typedef int (*NDIlib_send_get_no_connections_t)(void *, uint32_t);

static NDIlib_send_send_video_v2_t g_ndi_send_video = NULL;
static NDIlib_send_get_no_connections_t g_ndi_get_conns = NULL;
static void *g_ndi_sender = NULL;

// ---------- Metal ----------
static id<MTLDevice> g_device = nil;
static id<MTLCommandQueue> g_queue = nil;
static id<MTLBuffer> g_buffer = nil;   // 読み出し用（サイズ変化時に作り直す）
static NSUInteger g_buffer_cap = 0;

// Syphon クライアント（id 型で動的に扱う）
static id g_client = nil;

static volatile int64_t g_frame_count = 0;

static void publishTexture(id<MTLTexture> tex) {
  if (tex == nil) return;
  NSUInteger w = tex.width, h = tex.height;
  if (w == 0 || h == 0) return;
  NSUInteger bytesPerRow = w * 4;
  NSUInteger needed = bytesPerRow * h;

  if (g_buffer == nil || g_buffer_cap < needed) {
    g_buffer = [g_device newBufferWithLength:needed options:MTLResourceStorageModeShared];
    g_buffer_cap = needed;
  }

  id<MTLCommandBuffer> cb = [g_queue commandBuffer];
  id<MTLBlitCommandEncoder> blit = [cb blitCommandEncoder];
  [blit copyFromTexture:tex
            sourceSlice:0
            sourceLevel:0
           sourceOrigin:MTLOriginMake(0, 0, 0)
             sourceSize:MTLSizeMake(w, h, 1)
               toBuffer:g_buffer
      destinationOffset:0
 destinationBytesPerRow:bytesPerRow
destinationBytesPerImage:needed];
  [blit endEncoding];
  [cb commit];
  [cb waitUntilCompleted];

  NDIlib_video_frame_v2_t frame;
  memset(&frame, 0, sizeof(frame));
  frame.xres = (int)w;
  frame.yres = (int)h;
  // Syphon の Metal テクスチャは通常 BGRA8Unorm。RGBA の場合だけ切り替え。
  frame.FourCC = (tex.pixelFormat == MTLPixelFormatRGBA8Unorm ||
                  tex.pixelFormat == MTLPixelFormatRGBA8Unorm_sRGB)
                     ? kNDI_RGBA
                     : kNDI_BGRA;
  frame.frame_rate_N = 60;
  frame.frame_rate_D = 1;
  frame.picture_aspect_ratio = 0.0f;  // xres/yres から自動
  frame.frame_format_type = kNDI_FORMAT_PROGRESSIVE;
  frame.p_data = (uint8_t *)g_buffer.contents;
  frame.line_stride_in_bytes = (int)bytesPerRow;

  g_ndi_send_video(g_ndi_sender, &frame);
  g_frame_count++;
}

// SyphonServerDirectory から目的のサーバー記述を取得（最大 ~3 秒待つ）
static NSDictionary *findServerDescription(NSString *appName) {
  Class dirClass = NSClassFromString(@"SyphonServerDirectory");
  id dir = ((id (*)(id, SEL))objc_msgSend)((id)dirClass, NSSelectorFromString(@"sharedDirectory"));

  // アナウンス要求を投げて応答を促す
  NSDistributedNotificationCenter *dnc = [NSDistributedNotificationCenter defaultCenter];
  [dnc postNotificationName:@"SyphonServerAnnounceRequest" object:nil userInfo:nil deliverImmediately:YES];

  for (int i = 0; i < 30; i++) {
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
    NSArray *servers = ((id (*)(id, SEL))objc_msgSend)(dir, NSSelectorFromString(@"servers"));
    for (NSDictionary *s in servers) {
      NSString *app = s[@"SyphonServerDescriptionAppNameKey"];
      NSString *name = s[@"SyphonServerDescriptionNameKey"];
      if ([app isEqualToString:appName] || [name isEqualToString:appName]) {
        return s;
      }
    }
  }
  return nil;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    // 引数: [1]=Syphonサーバー名 [2]=NDI送信名 [3]=Syphon framework パス [4]=libndi パス
    // [3][4] はアプリ(main)が同梱物の絶対パスを渡す。省略時は従来の既定（単体テスト用）。
    NSString *targetName = (argc > 1) ? [NSString stringWithUTF8String:argv[1]]
                                      : @"LED STAGE IMAGER";
    const char *ndiName = (argc > 2) ? argv[2] : [targetName UTF8String];
    const char *syphonPath =
        (argc > 3)
            ? argv[3]
            : "/Users/nomurayuuki/Desktop/LED STAGE IMAGER.app/Contents/Resources/"
              "app.asar.unpacked/node_modules/node-syphon/dist/Frameworks/Syphon.framework/Syphon";
    const char *ndiPath = (argc > 4) ? argv[4] : "/Applications/Resolume Arena/libndi.dylib";

    // --- Syphon framework（アプリ同梱の arm64 v5）を dlopen ---
    if (!dlopen(syphonPath, RTLD_NOW)) {
      fprintf(stderr, "[bridge] Syphon framework のロード失敗: %s\n", dlerror());
      return 1;
    }

    // --- libndi（アプリ同梱の arm64）を dlopen ---
    void *ndi = dlopen(ndiPath, RTLD_NOW);
    if (!ndi) {
      fprintf(stderr, "[bridge] libndi のロード失敗: %s\n", dlerror());
      return 1;
    }
    NDIlib_initialize_t ndi_init = (NDIlib_initialize_t)dlsym(ndi, "NDIlib_initialize");
    NDIlib_send_create_fn ndi_send_create = (NDIlib_send_create_fn)dlsym(ndi, "NDIlib_send_create");
    g_ndi_send_video = (NDIlib_send_send_video_v2_t)dlsym(ndi, "NDIlib_send_send_video_v2");
    // 接続数取得は必須ではない（古い libndi で無くてもブリッジは動く）。取れなければ -1 を返す。
    g_ndi_get_conns =
        (NDIlib_send_get_no_connections_t)dlsym(ndi, "NDIlib_send_get_no_connections");
    if (!ndi_init || !ndi_send_create || !g_ndi_send_video) {
      fprintf(stderr, "[bridge] NDI シンボル解決失敗\n");
      return 1;
    }
    if (!ndi_init()) {
      fprintf(stderr, "[bridge] NDIlib_initialize 失敗（CPU 非対応の可能性）\n");
      return 1;
    }

    NDIlib_send_create_t createDesc;
    memset(&createDesc, 0, sizeof(createDesc));
    createDesc.p_ndi_name = ndiName;
    createDesc.p_groups = NULL;
    createDesc.clocked_video = true;
    createDesc.clocked_audio = false;
    g_ndi_sender = ndi_send_create(&createDesc);
    if (!g_ndi_sender) {
      fprintf(stderr, "[bridge] NDI 送信機の作成失敗\n");
      return 1;
    }
    fprintf(stderr, "[bridge] NDI 送信機を作成: \"%s\"\n", ndiName);

    // --- Metal ---
    g_device = MTLCreateSystemDefaultDevice();
    g_queue = [g_device newCommandQueue];

    // --- Syphon サーバーを探す ---
    fprintf(stderr, "[bridge] Syphon サーバー \"%s\" を探索中...\n", [targetName UTF8String]);
    NSDictionary *desc = findServerDescription(targetName);
    if (!desc) {
      fprintf(stderr, "[bridge] サーバーが見つかりません。LED STAGE IMAGER が起動し、\n"
                      "         本番(PLAY)モードで出力しているか確認してください。\n");
      return 2;
    }
    fprintf(stderr, "[bridge] サーバー発見。接続します。\n");

    // --- SyphonMetalClient を生成（newFrameHandler で読み出し） ---
    Class clientClass = NSClassFromString(@"SyphonMetalClient");
    id client = [clientClass alloc];
    void (^handler)(id) = ^(id c) {
      @autoreleasepool {
        // newFrameImage は +1 で返る（ARC が解放）
        id<MTLTexture> tex = ((id (*)(id, SEL))objc_msgSend)(c, NSSelectorFromString(@"newFrameImage"));
        publishTexture(tex);
      }
    };
    SEL initSel = NSSelectorFromString(@"initWithServerDescription:device:options:newFrameHandler:");
    g_client = ((id (*)(id, SEL, id, id, id, void (^)(id)))objc_msgSend)(
        client, initSel, desc, g_device, nil, handler);
    if (!g_client) {
      fprintf(stderr, "[bridge] Syphon クライアント生成失敗\n");
      return 3;
    }

    fprintf(stderr, "[bridge] 接続完了。NDI 送信中… (Ctrl+C で停止)\n");

    // 監視タイマー。判定は「フレーム数」ではなく Syphon サーバーの生存(isValid)で行う。
    // 理由: 本番では暗転・静止保持でアプリが新フレームを出さない瞬間が普通にあり、フレーム
    // 停止で落とすと NDI が途切れる。サーバーが消えた(アプリ終了/切断=isValid:NO)ときだけ
    // 終了し、起動ラッパーが再起動して再探索する。
    __block id watchedClient = g_client;
    __block int invalidTicks = 0;
    [NSTimer scheduledTimerWithTimeInterval:2.0
                                    repeats:YES
                                      block:^(NSTimer *t) {
                                        BOOL valid = ((BOOL (*)(id, SEL))objc_msgSend)(
                                            watchedClient, NSSelectorFromString(@"isValid"));
                                        // 受け手(Resolume 等)の接続数を取得し、機械可読な1行を stdout へ。
                                        // アプリ(main)はこの "RX=<n>" を読んでステータスバーに出す。
                                        int rx = g_ndi_get_conns ? g_ndi_get_conns(g_ndi_sender, 0) : -1;
                                        fprintf(stdout, "RX=%d\n", rx);
                                        fflush(stdout);
                                        fprintf(stderr,
                                                "[bridge] 送信フレーム累計: %lld  接続: %s  受け手: %d\n",
                                                (long long)g_frame_count, valid ? "OK" : "切断", rx);
                                        if (!valid) {
                                          invalidTicks++;
                                          if (invalidTicks >= 2) {  // 約4秒 切断が続いたら
                                            fprintf(stderr,
                                                    "[bridge] Syphon ソースが消えました。再接続のため終了します。\n");
                                            exit(10);
                                          }
                                        } else {
                                          invalidTicks = 0;
                                        }
                                      }];

    [[NSRunLoop currentRunLoop] run];
  }
  return 0;
}
