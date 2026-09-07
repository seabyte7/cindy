/*
 * Main-process-only N-API bridge for F7 existing DSH Home authority.
 *
 * Electron's dialog supplies a persistent app-scoped bookmark. Apple binds
 * that authority to Cindy Main's code-signing identity, so it cannot be
 * passed to the separately signed DSH Helper.app. This module runs inside
 * Cindy Main, resolves the persistent bookmark, then creates a fresh
 * non-persistent implicit bookmark for one private child handoff. No pathname
 * is returned, persisted, or logged by this module.
 */

#include <node_api.h>

#import <Foundation/Foundation.h>

#include <stdlib.h>

static const size_t kMaximumBookmarkBytes = 1024U * 1024U;

static napi_value throw_failure(napi_env environment) {
  (void)napi_throw_error(environment, NULL,
                         "DSH existing Home bookmark handoff is unavailable");
  return NULL;
}

static bool get_base64_argument(napi_env environment, napi_callback_info info,
                                char **value, size_t *length) {
  size_t argc = 1;
  napi_value argument = NULL;
  if (napi_get_cb_info(environment, info, &argc, &argument, NULL, NULL) != napi_ok ||
      argc != 1) {
    return false;
  }
  napi_valuetype type;
  if (napi_typeof(environment, argument, &type) != napi_ok || type != napi_string ||
      napi_get_value_string_utf8(environment, argument, NULL, 0, length) != napi_ok ||
      *length == 0 || *length > kMaximumBookmarkBytes) {
    return false;
  }
  *value = (char *)calloc(*length + 1, sizeof(**value));
  if (*value == NULL) return false;
  size_t copied = 0;
  if (napi_get_value_string_utf8(environment, argument, *value, *length + 1,
                                 &copied) != napi_ok || copied != *length) {
    free(*value);
    *value = NULL;
    return false;
  }
  return true;
}

static napi_value create_implicit_bookmark(napi_env environment,
                                           napi_callback_info info) {
  char *encoded_input = NULL;
  size_t encoded_length = 0;
  if (!get_base64_argument(environment, info, &encoded_input, &encoded_length)) {
    return throw_failure(environment);
  }

  napi_value result = NULL;
  @autoreleasepool {
    NSString *encoded = [[NSString alloc] initWithBytes:encoded_input
                                                   length:encoded_length
                                                 encoding:NSASCIIStringEncoding];
    NSData *persistent = encoded == nil
        ? nil
        : [[NSData alloc] initWithBase64EncodedString:encoded options:0];
    BOOL stale = NO;
    NSError *error = nil;
    NSURL *location = persistent == nil ? nil : [NSURL
        URLByResolvingBookmarkData:persistent
        options:(NSURLBookmarkResolutionWithSecurityScope |
                 NSURLBookmarkResolutionWithoutUI |
                 NSURLBookmarkResolutionWithoutMounting |
                 NSURLBookmarkResolutionWithoutImplicitStartAccessing)
        relativeToURL:nil
        bookmarkDataIsStale:&stale
        error:&error];
    if (location == nil || stale || !location.isFileURL ||
        ![location startAccessingSecurityScopedResource]) {
      free(encoded_input);
      return throw_failure(environment);
    }

    NSError *bookmark_error = nil;
    NSData *implicit = [location bookmarkDataWithOptions:0
                               includingResourceValuesForKeys:nil
                                                relativeToURL:nil
                                                        error:&bookmark_error];
    [location stopAccessingSecurityScopedResource];
    if (implicit == nil || implicit.length == 0 ||
        implicit.length > kMaximumBookmarkBytes) {
      free(encoded_input);
      return throw_failure(environment);
    }
    NSString *output = [implicit base64EncodedStringWithOptions:0];
    if (output == nil || output.length == 0 ||
        output.length > kMaximumBookmarkBytes ||
        napi_create_string_utf8(environment, output.UTF8String, NAPI_AUTO_LENGTH,
                                &result) != napi_ok) {
      free(encoded_input);
      return throw_failure(environment);
    }
  }
  free(encoded_input);
  return result;
}

NAPI_MODULE_INIT() {
  napi_property_descriptor descriptor = {};
  descriptor.utf8name = "createImplicitBookmark";
  descriptor.method = create_implicit_bookmark;
  descriptor.attributes = napi_default;
  if (napi_define_properties(env, exports, 1, &descriptor) != napi_ok) {
    return throw_failure(env);
  }
  return exports;
}
