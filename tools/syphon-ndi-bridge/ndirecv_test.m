// ndirecv_test — 検証専用の最小 NDI 受信機。
// "LED STAGE IMAGER" という NDI ソースに接続して数秒つなぎっぱなしにする。
// これで送信側(ブリッジ)の get_no_connections が 1 になり、アプリのステータスバー
// の "RX" が ● 1 に変わるはず、という確認のためだけのもの。本番には同梱しない。
#import <Foundation/Foundation.h>
#import <dlfcn.h>

typedef struct NDIlib_source_t {
  const char *p_ndi_name;
  const char *p_url_address;  // 実際は union だが name だけ使う
} NDIlib_source_t;

typedef struct NDIlib_find_create_t {
  bool show_local_sources;
  const char *p_groups;
  const char *p_extra_ips;
} NDIlib_find_create_t;

typedef struct NDIlib_recv_create_v3_t {
  NDIlib_source_t source_to_connect_to;
  int color_format;
  int bandwidth;
  bool allow_video_fields;
  const char *p_ndi_recv_name;
} NDIlib_recv_create_v3_t;

typedef bool (*init_t)(void);
typedef void *(*find_create_t)(const NDIlib_find_create_t *);
typedef bool (*find_wait_t)(void *, uint32_t);
typedef const NDIlib_source_t *(*find_get_t)(void *, uint32_t *);
typedef void *(*recv_create_t)(const NDIlib_recv_create_v3_t *);
typedef int (*recv_capture_t)(void *, void *, void *, void *, uint32_t);

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    const char *ndiPath = (argc > 1) ? argv[1] : "/Applications/Resolume Arena/libndi.dylib";
    const char *want = (argc > 2) ? argv[2] : "LED STAGE IMAGER";
    void *ndi = dlopen(ndiPath, RTLD_NOW);
    if (!ndi) {
      fprintf(stderr, "libndi ロード失敗: %s\n", dlerror());
      return 1;
    }
    init_t ndi_init = (init_t)dlsym(ndi, "NDIlib_initialize");
    find_create_t f_create = (find_create_t)dlsym(ndi, "NDIlib_find_create_v2");
    find_wait_t f_wait = (find_wait_t)dlsym(ndi, "NDIlib_find_wait_for_sources");
    find_get_t f_get = (find_get_t)dlsym(ndi, "NDIlib_find_get_current_sources");
    recv_create_t r_create = (recv_create_t)dlsym(ndi, "NDIlib_recv_create_v3");
    recv_capture_t r_capture = (recv_capture_t)dlsym(ndi, "NDIlib_recv_capture_v2");
    if (!ndi_init || !f_create || !f_get || !r_create) {
      fprintf(stderr, "シンボル解決失敗\n");
      return 1;
    }
    ndi_init();

    NDIlib_find_create_t fc = {true, NULL, NULL};
    void *finder = f_create(&fc);
    if (!finder) { fprintf(stderr, "finder 作成失敗\n"); return 1; }

    NDIlib_source_t target;
    memset(&target, 0, sizeof(target));
    bool found = false;
    for (int i = 0; i < 20 && !found; i++) {
      if (f_wait) f_wait(finder, 1000);
      uint32_t n = 0;
      const NDIlib_source_t *srcs = f_get(finder, &n);
      for (uint32_t k = 0; k < n; k++) {
        const char *nm = srcs[k].p_ndi_name ? srcs[k].p_ndi_name : "";
        fprintf(stderr, "  source[%u]: %s\n", k, nm);
        if (strstr(nm, want)) {
          target = srcs[k];
          target.p_ndi_name = strdup(nm);
          found = true;
          break;
        }
      }
    }
    if (!found) { fprintf(stderr, "ソース \"%s\" が見つからない\n", want); return 2; }
    fprintf(stderr, "接続先: %s\n", target.p_ndi_name);

    NDIlib_recv_create_v3_t rc;
    memset(&rc, 0, sizeof(rc));
    rc.source_to_connect_to = target;
    rc.color_format = 100;  // fastest
    rc.bandwidth = 100;     // highest
    rc.allow_video_fields = true;
    rc.p_ndi_recv_name = "RX TEST";
    void *recv = r_create(&rc);
    if (!recv) { fprintf(stderr, "recv 作成失敗\n"); return 3; }
    fprintf(stderr, "受信機作成・接続中。10秒つなぎます…\n");

    int hold = (argc > 3) ? atoi(argv[3]) : 10;
    for (int i = 0; i < hold; i++) {
      if (r_capture) r_capture(recv, NULL, NULL, NULL, 1000);
      fprintf(stderr, "  ...接続維持 %d/%d\n", i + 1, hold);
    }
    fprintf(stderr, "完了。切断します。\n");
    return 0;
  }
}
