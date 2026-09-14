/*
 * The Foundation half of the fixed macOS DSH Helper handoff. It is isolated
 * from the C supervisor so that the only Foundation operation is resolving a
 * non-persistent implicit bookmark received over its private descriptor.
 */

#import <Foundation/Foundation.h>

#include <limits.h>
#include <stdbool.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "macos-dsh-implicit-bookmark.h"

static void clear_access(CindyDshImplicitBookmarkAccess *access) {
  if (access == NULL) return;
  access->directory[0] = '\0';
  access->resolved_url = NULL;
  access->access_started = false;
}

bool cindy_dsh_resolve_implicit_bookmark(const char *base64,
                                         size_t base64_length,
                                         CindyDshImplicitBookmarkAccess *access) {
  if (base64 == NULL || base64_length == 0 || access == NULL ||
      base64[base64_length] != '\0') {
    return false;
  }
  clear_access(access);

  @autoreleasepool {
    NSString *encoded = [[NSString alloc] initWithBytes:base64
                                                   length:base64_length
                                                 encoding:NSASCIIStringEncoding];
    if (encoded == nil) return false;
    NSData *bookmark = [[NSData alloc] initWithBase64EncodedString:encoded options:0];
    if (bookmark == nil || bookmark.length == 0) return false;

    BOOL stale = NO;
    NSError *error = nil;
    NSURL *url = [NSURL URLByResolvingBookmarkData:bookmark
                                           options:(NSURLBookmarkResolutionWithoutUI |
                                                    NSURLBookmarkResolutionWithoutMounting |
                                                    NSURLBookmarkResolutionWithoutImplicitStartAccessing)
                                     relativeToURL:nil
                               bookmarkDataIsStale:&stale
                                             error:&error];
    // Foundation's stale flag is a bookmark-metadata refresh advisory, not an
    // authorization verdict. Even a freshly minted Main bookmark can resolve
    // stale in this separately sandboxed Helper (while its scope is valid).
    // This private handoff is consumed once and never stored/reused, so there
    // is no persisted copy to refresh. Require the actual security scope and
    // directory validation below; do not reject solely on the advisory flag.
    // The Main-side persisted app-scoped bookmark policy is unchanged.
    if (url == nil || !url.isFileURL || ![url startAccessingSecurityScopedResource]) {
      return false;
    }

    const char *unresolved = url.fileSystemRepresentation;
    char resolved[PATH_MAX];
    struct stat metadata;
    if (unresolved == NULL || unresolved[0] != '/' ||
        realpath(unresolved, resolved) == NULL ||
        lstat(resolved, &metadata) != 0 || !S_ISDIR(metadata.st_mode) ||
        S_ISLNK(metadata.st_mode) || strlen(resolved) >= sizeof(access->directory)) {
      [url stopAccessingSecurityScopedResource];
      return false;
    }

    memcpy(access->directory, resolved, strlen(resolved) + 1);
    access->resolved_url = (__bridge_retained void *)url;
    access->access_started = true;
    return true;
  }
}

void cindy_dsh_release_implicit_bookmark(
    CindyDshImplicitBookmarkAccess *access) {
  if (access == NULL) return;
  @autoreleasepool {
    if (access->access_started && access->resolved_url != NULL) {
      NSURL *url = (__bridge_transfer NSURL *)access->resolved_url;
      [url stopAccessingSecurityScopedResource];
    }
  }
  clear_access(access);
}
