#ifndef CINDY_DSH_IMPLICIT_BOOKMARK_H
#define CINDY_DSH_IMPLICIT_BOOKMARK_H

#include <stdbool.h>
#include <stddef.h>
#include <limits.h>

/*
 * This is intentionally a private, one-process handoff contract. The input
 * must be an *implicit* NSURL bookmark freshly minted by Cindy Main after it
 * resolved its separately persisted app-scoped bookmark. A Helper.app has a
 * different signing identity and must never receive that persistent source
 * bookmark directly.
 */
typedef struct CindyDshImplicitBookmarkAccess {
  char directory[PATH_MAX];
  void *resolved_url;
  bool access_started;
} CindyDshImplicitBookmarkAccess;

bool cindy_dsh_resolve_implicit_bookmark(const char *base64,
                                         size_t base64_length,
                                         CindyDshImplicitBookmarkAccess *access);
void cindy_dsh_release_implicit_bookmark(
    CindyDshImplicitBookmarkAccess *access);

#endif
