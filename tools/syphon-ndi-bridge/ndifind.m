// ndifind — ネットワーク上の NDI ソースを列挙して確認するだけのツール
#import <Foundation/Foundation.h>
#import <dlfcn.h>

typedef struct NDIlib_source_t {
  const char *p_ndi_name;
  const char *p_url_address;  // 実際の SDK は union だが先頭は文字列ポインタ
} NDIlib_source_t;

typedef struct NDIlib_find_create_t {
  bool show_local_sources;
  const char *p_groups;
  const char *p_extra_ips;
} NDIlib_find_create_t;

typedef bool (*ndi_init_t)(void);
typedef void *(*find_create_t)(const NDIlib_find_create_t *);
typedef const NDIlib_source_t *(*get_sources_t)(void *, uint32_t *, uint32_t);
typedef void (*find_destroy_t)(void *);

int main(void) {
  void *ndi = dlopen("/Applications/Resolume Arena/libndi.dylib", RTLD_NOW);
  if (!ndi) { fprintf(stderr, "libndi load fail: %s\n", dlerror()); return 1; }
  ndi_init_t ndi_init = (ndi_init_t)dlsym(ndi, "NDIlib_initialize");
  find_create_t find_create = (find_create_t)dlsym(ndi, "NDIlib_find_create_v2");
  get_sources_t get_sources = (get_sources_t)dlsym(ndi, "NDIlib_find_get_current_sources");
  find_destroy_t find_destroy = (find_destroy_t)dlsym(ndi, "NDIlib_find_destroy");
  if (!ndi_init || !find_create || !get_sources) { fprintf(stderr, "symbol fail\n"); return 1; }
  ndi_init();

  NDIlib_find_create_t fc = { true, NULL, NULL };  // show_local_sources=true
  void *finder = find_create(&fc);
  if (!finder) { fprintf(stderr, "find_create fail\n"); return 1; }

  // 4 秒間ポーリングしてソースを列挙
  for (int i = 0; i < 4; i++) {
    uint32_t n = 0;
    const NDIlib_source_t *srcs = get_sources(finder, &n, 1000 /*ms*/);
    fprintf(stderr, "[%ds] NDI ソース数: %u\n", i + 1, n);
    for (uint32_t j = 0; j < n; j++) {
      fprintf(stderr, "    - %s   (%s)\n",
              srcs[j].p_ndi_name ? srcs[j].p_ndi_name : "(no name)",
              srcs[j].p_url_address ? srcs[j].p_url_address : "?");
    }
  }
  if (find_destroy) find_destroy(finder);
  return 0;
}
