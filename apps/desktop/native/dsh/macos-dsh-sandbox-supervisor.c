/**
 * Cindy's macOS DSH sandbox supervisor.
 *
 * This native Helper.app is intentionally the only binary that may launch
 * the DSH runtime after the F2 containment gate. It derives the runtime from
 * its own sealed app bundle instead of accepting an executable path from
 * Node, the Renderer, or an environment variable. The helper offers only the
 * two ACP bootstrap forms Cindy needs; it is not a command-line proxy.
 *
 * The supervisor is signed as an App Sandbox helper. Its DSH child is signed
 * with the App Sandbox inheritance entitlement, so macOS—not a POSIX process
 * group alone—carries the resource boundary to descendants. The process group
 * remains necessary for bounded normal shutdown. POSIX_SPAWN_CLOEXEC_DEFAULT
 * closes ordinary inherited descriptors without manually closing the macOS
 * launch state needed to carry App Sandbox inheritance into the child.
 */

#include <errno.h>
#include <fcntl.h>
#include <libgen.h>
#include <libproc.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#include "macos-dsh-implicit-bookmark.h"

extern char **environ;

#ifndef CINDY_DSH_RUNTIME_EXECUTABLE
#error "The packaged DSH executable name must be supplied by the verified build manifest."
#endif

static const char *const kSupervisorRelativePath =
    "/Contents/MacOS/cindy-dsh-sandbox-supervisor";
static const char *const kRuntimeRelativePath =
    "/Contents/Resources/dsh-runtime/" CINDY_DSH_RUNTIME_EXECUTABLE;
static const char *const kNativeAddonCacheRelativePath =
    "/Contents/Resources/dsh-native-addons";
static const char *const kPkgNativeCacheRelativePath =
    "/Contents/Resources/dsh-pkg-native-cache";
static const unsigned int kProcessGroupGraceAttempts = 100;
static const long kProcessGroupPollNanoseconds = 10L * 1000L * 1000L;
static const int kImplicitBookmarkDescriptor = 3;
static const size_t kMaxImplicitBookmarkBytes = 1024U * 1024U;
static const int kImplicitBookmarkReadTimeoutMilliseconds = 5000;
static volatile sig_atomic_t child_process_group = -1;
static volatile sig_atomic_t termination_signal = 0;

typedef enum ProcessGroupMemberState {
  PROCESS_GROUP_EMPTY,
  PROCESS_GROUP_LEADER_ONLY,
  PROCESS_GROUP_HAS_RUNTIME_MEMBERS,
  PROCESS_GROUP_MEMBERS_UNKNOWN,
} ProcessGroupMemberState;

static void report_error(const char *message) {
  (void)fprintf(stderr, "cindy-dsh-sandbox-supervisor: %s\n", message);
}

static bool is_allowed_environment_name(const char *name) {
  return strcmp(name, "HOME") == 0 || strcmp(name, "DSH_HOME") == 0 ||
      strcmp(name, "TMPDIR") == 0 || strcmp(name, "PATH") == 0 ||
      strcmp(name, "LANG") == 0 || strcmp(name, "LC_ALL") == 0 ||
      strcmp(name, "DSH_TELEMETRY_DISABLED") == 0 ||
      strcmp(name, "CINDY_DSH_PROVIDER_BASE_URL") == 0 ||
      strcmp(name, "CINDY_DSH_PROVIDER_API_KEY") == 0;
}

static const char *environment_value(char *const environment[], const char *name) {
  const size_t name_length = strlen(name);
  for (size_t index = 0; environment[index] != NULL; ++index) {
    if (strncmp(environment[index], name, name_length) == 0 &&
        environment[index][name_length] == '=') {
      return environment[index] + name_length + 1;
    }
  }
  return NULL;
}

static bool is_absolute_directory_value(const char *value) {
  if (value == NULL || value[0] != '/') {
    return false;
  }
  struct stat metadata;
  return lstat(value, &metadata) == 0 && S_ISDIR(metadata.st_mode) &&
      !S_ISLNK(metadata.st_mode);
}

static bool descriptor_is_open(int descriptor, bool *is_open) {
  errno = 0;
  const int flags = fcntl(descriptor, F_GETFD);
  if (flags >= 0) {
    *is_open = true;
    return true;
  }
  if (errno == EBADF) {
    *is_open = false;
    return true;
  }
  return false;
}

static bool wait_for_descriptor_read(int descriptor) {
  struct pollfd poll_descriptor = {
      .fd = descriptor,
      .events = POLLIN | POLLHUP,
      .revents = 0,
  };
  int result = 0;
  do {
    result = poll(&poll_descriptor, 1, kImplicitBookmarkReadTimeoutMilliseconds);
  } while (result < 0 && errno == EINTR);
  return result > 0 && (poll_descriptor.revents & (POLLIN | POLLHUP)) != 0;
}

static bool read_descriptor_exact(int descriptor, unsigned char *destination,
                                  size_t length) {
  size_t offset = 0;
  while (offset < length) {
    if (!wait_for_descriptor_read(descriptor)) return false;
    ssize_t read_count = 0;
    do {
      read_count = read(descriptor, destination + offset, length - offset);
    } while (read_count < 0 && errno == EINTR);
    if (read_count <= 0) return false;
    offset += (size_t)read_count;
  }
  return true;
}

static bool is_base64_character(unsigned char value) {
  return (value >= 'A' && value <= 'Z') ||
      (value >= 'a' && value <= 'z') ||
      (value >= '0' && value <= '9') || value == '+' || value == '/' ||
      value == '=';
}

/**
 * This descriptor is a single, length-prefixed base64 bookmark and EOF. It
 * has no command field, pathname, environment fallback or reusable channel.
 * The strict end-of-stream check makes a descriptor with trailing data fail
 * closed rather than become an accidental extension protocol.
 */
static bool read_implicit_bookmark_descriptor(int descriptor, char **bookmark) {
  unsigned char length_bytes[4];
  if (!read_descriptor_exact(descriptor, length_bytes, sizeof(length_bytes))) {
    return false;
  }
  const size_t length = ((size_t)length_bytes[0] << 24) |
      ((size_t)length_bytes[1] << 16) |
      ((size_t)length_bytes[2] << 8) | (size_t)length_bytes[3];
  if (length == 0 || length > kMaxImplicitBookmarkBytes) return false;
  char *value = calloc(length + 1, sizeof(*value));
  if (value == NULL || !read_descriptor_exact(descriptor, (unsigned char *)value, length)) {
    free(value);
    return false;
  }
  for (size_t index = 0; index < length; ++index) {
    if (!is_base64_character((unsigned char)value[index])) {
      free(value);
      return false;
    }
  }
  if (!wait_for_descriptor_read(descriptor)) {
    free(value);
    return false;
  }
  unsigned char trailing = 0;
  ssize_t read_count = 0;
  do {
    read_count = read(descriptor, &trailing, sizeof(trailing));
  } while (read_count < 0 && errno == EINTR);
  if (read_count != 0) {
    free(value);
    return false;
  }
  *bookmark = value;
  return true;
}

/**
 * Build a private envp rather than mutating the supervisor's own environment.
 * App Sandbox launches can supply a managed environment table for their own
 * process; removing every item with unsetenv() can leave macOS libc without
 * a writable environment array and make its next setenv() crash. The trusted
 * Desktop Main has already constructed this allowlist, but this native
 * boundary repeats it before spawning the runtime.
 */
static bool reserve_environment_values(char ***values, size_t *capacity,
                                       size_t required_capacity) {
  if (*capacity >= required_capacity) return true;
  size_t next_capacity = *capacity == 0 ? 8 : *capacity;
  while (next_capacity < required_capacity) {
    next_capacity *= 2;
  }
  char **next = realloc(*values, next_capacity * sizeof(**values));
  if (next == NULL) return false;
  *values = next;
  *capacity = next_capacity;
  return true;
}

static bool append_environment_value(char ***values, size_t *count,
                                     size_t *capacity, const char *value) {
  if (!reserve_environment_values(values, capacity, *count + 1)) return false;
  (*values)[*count] = strdup(value);
  if ((*values)[*count] == NULL) return false;
  *count += 1;
  return true;
}

static bool append_environment_terminator(char ***values, size_t count,
                                          size_t *capacity) {
  if (!reserve_environment_values(values, capacity, count + 1)) return false;
  (*values)[count] = NULL;
  return true;
}

static bool append_supervisor_environment(char ***values, size_t *count,
                                          size_t *capacity, const char *name,
                                          const char *value) {
  const size_t length = strlen(name) + 1 + strlen(value) + 1;
  char *entry = malloc(length);
  if (entry == NULL) return false;
  (void)snprintf(entry, length, "%s=%s", name, value);
  const bool appended =
      append_environment_value(values, count, capacity, entry);
  free(entry);
  return appended;
}

static void free_environment_values(char **values, size_t count) {
  for (size_t index = 0; index < count; ++index) free(values[index]);
  free(values);
}

static void free_environment(char **values) {
  if (values == NULL) return;
  size_t count = 0;
  while (values[count] != NULL) ++count;
  free_environment_values(values, count);
}

static bool environment_has_name(char *const values[], size_t count,
                                 const char *name) {
  const size_t name_length = strlen(name);
  for (size_t index = 0; index < count; ++index) {
    if (strncmp(values[index], name, name_length) == 0 &&
        values[index][name_length] == '=') {
      return true;
    }
  }
  return false;
}

static bool build_child_environment(const char *native_addon_cache,
                                    const char *pkg_native_cache,
                                    const char *implicit_dsh_home,
                                    char ***destination) {
  char **saved = NULL;
  size_t saved_count = 0;
  size_t saved_capacity = 0;
  for (char **entry = environ; entry != NULL && *entry != NULL; ++entry) {
    const char *equals = strchr(*entry, '=');
    if (equals == NULL || equals == *entry) {
      continue;
    }
    const size_t name_length = (size_t)(equals - *entry);
    char name[128];
    if (name_length >= sizeof(name)) {
      continue;
    }
    memcpy(name, *entry, name_length);
    name[name_length] = '\0';
    if (!is_allowed_environment_name(name)) {
      continue;
    }
    // Duplicate names make exec env lookup implementation-defined. Cindy Main
    // never emits them, so reject rather than choosing a secret by position.
    if (environment_has_name(saved, saved_count, name) ||
        !append_environment_value(&saved, &saved_count, &saved_capacity, *entry)) {
      free_environment_values(saved, saved_count);
      return false;
    }
  }
  if (!append_environment_terminator(&saved, saved_count, &saved_capacity)) {
    free_environment_values(saved, saved_count);
    return false;
  }
  const char *dsh_home = environment_value(saved, "DSH_HOME");
  if ((implicit_dsh_home == NULL &&
       !is_absolute_directory_value(dsh_home)) ||
      (implicit_dsh_home != NULL &&
       (dsh_home != NULL || !is_absolute_directory_value(implicit_dsh_home)))) {
    free_environment_values(saved, saved_count);
    return false;
  }
  if ((implicit_dsh_home != NULL &&
       !append_supervisor_environment(&saved, &saved_count, &saved_capacity,
                                      "DSH_HOME", implicit_dsh_home)) ||
      !append_supervisor_environment(&saved, &saved_count, &saved_capacity,
                                     "NARB_NATIVE_CACHE_DIR",
                                     native_addon_cache) ||
      !append_supervisor_environment(&saved, &saved_count, &saved_capacity,
                                     "CINDY_DSH_SEALED_NATIVE_CACHE", "1") ||
      !append_supervisor_environment(&saved, &saved_count, &saved_capacity,
                                     "CINDY_DSH_SEALED_PKG_CACHE_DIR",
                                     pkg_native_cache) ||
      !append_environment_terminator(&saved, saved_count, &saved_capacity)) {
    free_environment_values(saved, saved_count);
    return false;
  }
  const char *path = environment_value(saved, "PATH");
  const char *telemetry_disabled =
      environment_value(saved, "DSH_TELEMETRY_DISABLED");
  const char *provider_base_url =
      environment_value(saved, "CINDY_DSH_PROVIDER_BASE_URL");
  const char *provider_api_key =
      environment_value(saved, "CINDY_DSH_PROVIDER_API_KEY");
  if (path == NULL || strcmp(path, "/usr/bin:/bin") != 0 ||
      !is_absolute_directory_value(environment_value(saved, "HOME")) ||
      !is_absolute_directory_value(environment_value(saved, "DSH_HOME")) ||
      !is_absolute_directory_value(environment_value(saved, "TMPDIR")) ||
      !is_absolute_directory_value(
          environment_value(saved, "CINDY_DSH_SEALED_PKG_CACHE_DIR")) ||
      telemetry_disabled == NULL || strcmp(telemetry_disabled, "1") != 0 ||
      ((provider_base_url == NULL) != (provider_api_key == NULL)) ||
      (provider_base_url != NULL &&
       (provider_base_url[0] == '\0' || provider_api_key[0] == '\0'))) {
    free_environment(saved);
    return false;
  }
  *destination = saved;
  return true;
}

static bool resolve_bundle_root(const char *argv0, char destination[PATH_MAX]) {
  char canonical[PATH_MAX];
  if (realpath(argv0, canonical) == NULL) {
    return false;
  }
  const size_t canonical_length = strlen(canonical);
  const size_t supervisor_length = strlen(kSupervisorRelativePath);
  if (canonical_length <= supervisor_length ||
      strcmp(canonical + canonical_length - supervisor_length,
             kSupervisorRelativePath) != 0) {
    return false;
  }
  const size_t bundle_length = canonical_length - supervisor_length;
  memcpy(destination, canonical, bundle_length);
  destination[bundle_length] = '\0';
  return true;
}

static bool resolve_bundle_resource_path(const char *bundle,
                                         const char *relative_path,
                                         bool executable,
                                         char destination[PATH_MAX]) {
  if (strlen(bundle) + strlen(relative_path) >= PATH_MAX) {
    return false;
  }
  (void)snprintf(destination, PATH_MAX, "%s%s", bundle, relative_path);

  struct stat metadata;
  if (lstat(destination, &metadata) != 0 || S_ISLNK(metadata.st_mode) ||
      (executable ? !S_ISREG(metadata.st_mode) ||
                        (metadata.st_mode & S_IXUSR) == 0
                  : !S_ISDIR(metadata.st_mode))) {
    return false;
  }
  char canonical_runtime[PATH_MAX];
  if (realpath(destination, canonical_runtime) == NULL ||
      strcmp(destination, canonical_runtime) != 0) {
    return false;
  }
  return true;
}

static void forward_termination_signal(int signal_number) {
  if (termination_signal == 0) {
    termination_signal = signal_number;
  }
  const pid_t group = (pid_t)child_process_group;
  if (group > 0) {
    (void)kill(-group, signal_number);
  }
}

/**
 * proc_listpgrppids() is a Darwin-native group membership probe. The fixed
 * capacity is intentionally a hard ceiling: an unexpectedly broad runtime
 * group is an unconfirmed cleanup failure, never a reason to heap-allocate an
 * unbounded list of untrusted process identifiers.
 */
static ProcessGroupMemberState process_group_member_state(pid_t group,
                                                           pid_t leader) {
  pid_t members[64];
  const int member_count =
      proc_listpgrppids(group, members, sizeof(members));
  if (member_count < 0 || member_count > (int)(sizeof(members) / sizeof(pid_t))) {
    return PROCESS_GROUP_MEMBERS_UNKNOWN;
  }
  bool leader_present = false;
  for (int index = 0; index < member_count; ++index) {
    if (members[index] == leader) {
      leader_present = true;
    } else {
      return PROCESS_GROUP_HAS_RUNTIME_MEMBERS;
    }
  }
  return leader_present ? PROCESS_GROUP_LEADER_ONLY : PROCESS_GROUP_EMPTY;
}

static bool signal_process_group(pid_t group, int signal_number) {
  if (kill(-group, signal_number) == 0) {
    return true;
  }
  // A concurrent exit is already the desired terminal state. Other failures
  // (notably EPERM) cannot prove that the untrusted tree is gone.
  return errno == ESRCH;
}

static void wait_for_process_group_poll(void) {
  const struct timespec interval = {
      .tv_sec = 0,
      .tv_nsec = kProcessGroupPollNanoseconds,
  };
  (void)nanosleep(&interval, NULL);
}

static bool wait_for_runtime_group_members_exit(pid_t group, pid_t leader) {
  for (unsigned int attempt = 0; attempt <= kProcessGroupGraceAttempts;
       ++attempt) {
    const ProcessGroupMemberState state =
        process_group_member_state(group, leader);
    if (state == PROCESS_GROUP_EMPTY || state == PROCESS_GROUP_LEADER_ONLY) {
      return true;
    }
    if (state == PROCESS_GROUP_MEMBERS_UNKNOWN) {
      return false;
    }
    if (attempt < kProcessGroupGraceAttempts) {
      wait_for_process_group_poll();
    }
  }
  return false;
}

static bool child_has_exited_without_reaping(pid_t child, bool *exited) {
  siginfo_t information;
  memset(&information, 0, sizeof(information));
  if (waitid(P_PID, (id_t)child, &information, WEXITED | WNOHANG | WNOWAIT) !=
      0) {
    return false;
  }
  *exited = information.si_pid == child;
  return true;
}

/**
 * Do not reap the group leader while the supervisor is still addressing its
 * process group. A reaped PID may be reused by an unrelated process group;
 * WNOWAIT retains the original leader's PID identity until the group has been
 * drained. macOS exposes this POSIX waitid flag in its native SDK.
 */
static bool wait_for_child_exit_without_reaping(pid_t child) {
  for (unsigned int attempt = 0; attempt <= kProcessGroupGraceAttempts;
       ++attempt) {
    bool exited = false;
    if (!child_has_exited_without_reaping(child, &exited)) {
      if (errno == EINTR) {
        continue;
      }
      return false;
    }
    if (exited) {
      return true;
    }
    if (attempt < kProcessGroupGraceAttempts) {
      wait_for_process_group_poll();
    }
  }
  return false;
}

static bool reap_child(pid_t child, int *status) {
  while (waitpid(child, status, 0) == -1) {
    if (errno != EINTR) {
      return false;
    }
  }
  return true;
}

/**
 * The runtime is a separate process group so normal cancellation reaches its
 * descendants. Once its direct root is reaped, that group can still contain
 * inherited credential/file-descriptor holders, so successful waitpid() is
 * insufficient evidence of cleanup. This is a bounded best-effort lifecycle
 * guard, not proof against setsid()/double-fork escape from the App Sandbox.
 */
static bool drain_child_process_group(pid_t group, pid_t leader) {
  const ProcessGroupMemberState initial_state =
      process_group_member_state(group, leader);
  if (initial_state == PROCESS_GROUP_EMPTY ||
      initial_state == PROCESS_GROUP_LEADER_ONLY) {
    return true;
  }
  if (initial_state != PROCESS_GROUP_HAS_RUNTIME_MEMBERS ||
      !signal_process_group(group, SIGTERM)) {
    return false;
  }
  if (wait_for_runtime_group_members_exit(group, leader)) {
    return true;
  }
  if (process_group_member_state(group, leader) !=
          PROCESS_GROUP_HAS_RUNTIME_MEMBERS ||
      !signal_process_group(group, SIGKILL)) {
    return false;
  }
  return wait_for_runtime_group_members_exit(group, leader);
}

static bool terminate_and_reap_child_process_group(pid_t child, int *status) {
  const pid_t group = (pid_t)child_process_group;
  if (group <= 0 || !signal_process_group(group, SIGTERM)) {
    return false;
  }
  if (!wait_for_child_exit_without_reaping(child)) {
    if (!signal_process_group(group, SIGKILL) ||
        !wait_for_child_exit_without_reaping(child)) {
      return false;
    }
  }
  const bool group_drained = drain_child_process_group(group, child);
  const bool child_reaped = reap_child(child, status);
  return group_drained && child_reaped;
}

static bool install_signal_handlers(void) {
  struct sigaction action;
  memset(&action, 0, sizeof(action));
  action.sa_handler = forward_termination_signal;
  sigemptyset(&action.sa_mask);
  // A signal must interrupt waitpid() so this supervisor, rather than an
  // outer carrier that cannot reach the runtime's separate group, can perform
  // its bounded TERM -> KILL cleanup before it exits.
  action.sa_flags = 0;
  return sigaction(SIGTERM, &action, NULL) == 0 &&
      sigaction(SIGINT, &action, NULL) == 0 &&
      sigaction(SIGHUP, &action, NULL) == 0;
}

static int preserve_standard_streams(posix_spawn_file_actions_t *actions) {
  for (int descriptor = STDIN_FILENO; descriptor <= STDERR_FILENO;
       ++descriptor) {
    const int result =
        posix_spawn_file_actions_addinherit_np(actions, descriptor);
    if (result != 0) return result;
  }
  return 0;
}

static bool parse_runtime_arguments(int argc, char *const argv[], char *child_argv[]) {
  if (argc == 2 && strcmp(argv[1], "--version") == 0) {
    child_argv[0] = NULL;
    child_argv[1] = "--version";
    child_argv[2] = NULL;
    return true;
  }
  if (argc == 3 && strcmp(argv[1], "--profile") == 0 &&
      strcmp(argv[2], "acp") == 0) {
    child_argv[0] = NULL;
    child_argv[1] = "--profile";
    child_argv[2] = "acp";
    child_argv[3] = NULL;
    return true;
  }
  return false;
}

int main(int argc, char *const argv[]) {
  char *child_argv[4] = {NULL, NULL, NULL, NULL};
  if (!parse_runtime_arguments(argc, argv, child_argv)) {
    report_error("only --version and --profile acp are supported");
    return 64;
  }
  bool has_implicit_bookmark_descriptor = false;
  if (!descriptor_is_open(kImplicitBookmarkDescriptor,
                          &has_implicit_bookmark_descriptor)) {
    report_error("could not inspect the private DSH Home descriptor");
    return 64;
  }
  if (has_implicit_bookmark_descriptor &&
      !(argc == 3 && strcmp(argv[1], "--profile") == 0 &&
        strcmp(argv[2], "acp") == 0)) {
    report_error("the private DSH Home descriptor is valid only for ACP");
    return 64;
  }
  CindyDshImplicitBookmarkAccess implicit_access = {0};
  if (has_implicit_bookmark_descriptor) {
    char *bookmark = NULL;
    const bool received = read_implicit_bookmark_descriptor(
        kImplicitBookmarkDescriptor, &bookmark);
    (void)close(kImplicitBookmarkDescriptor);
    const bool resolved = received && cindy_dsh_resolve_implicit_bookmark(
        bookmark, strlen(bookmark), &implicit_access);
    free(bookmark);
    if (!resolved) {
      cindy_dsh_release_implicit_bookmark(&implicit_access);
      report_error("the private DSH Home descriptor is invalid");
      return 68;
    }
  }
  char bundle[PATH_MAX];
  if (!resolve_bundle_root(argv[0], bundle)) {
    cindy_dsh_release_implicit_bookmark(&implicit_access);
    report_error("the supervisor is not running from a sealed app bundle");
    return 65;
  }
  char runtime[PATH_MAX];
  if (!resolve_bundle_resource_path(bundle, kRuntimeRelativePath, true, runtime)) {
    cindy_dsh_release_implicit_bookmark(&implicit_access);
    report_error("the bundled DSH runtime is invalid");
    return 66;
  }
  char native_addon_cache[PATH_MAX];
  if (!resolve_bundle_resource_path(bundle, kNativeAddonCacheRelativePath,
                                    false, native_addon_cache)) {
    cindy_dsh_release_implicit_bookmark(&implicit_access);
    report_error("the bundled native addon cache is invalid");
    return 67;
  }
  char pkg_native_cache[PATH_MAX];
  if (!resolve_bundle_resource_path(bundle, kPkgNativeCacheRelativePath,
                                    false, pkg_native_cache)) {
    cindy_dsh_release_implicit_bookmark(&implicit_access);
    report_error("the bundled pkg native cache is invalid");
    return 67;
  }
  char **child_environment = NULL;
  if (!build_child_environment(native_addon_cache, pkg_native_cache,
                               implicit_access.access_started
                                   ? implicit_access.directory
                                   : NULL,
                               &child_environment)) {
    cindy_dsh_release_implicit_bookmark(&implicit_access);
    report_error("the managed DSH environment is invalid");
    return 68;
  }
  child_argv[0] = runtime;

  posix_spawn_file_actions_t actions;
  posix_spawnattr_t attributes;
  const int actions_result = posix_spawn_file_actions_init(&actions);
  const int attributes_result = actions_result == 0 ? posix_spawnattr_init(&attributes) : -1;
  if (actions_result != 0 || attributes_result != 0) {
    if (actions_result == 0) (void)posix_spawn_file_actions_destroy(&actions);
    free_environment(child_environment);
    cindy_dsh_release_implicit_bookmark(&implicit_access);
    report_error("could not initialize the native launch boundary");
    return 69;
  }
  const short flags = POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT;
  if (posix_spawnattr_setflags(&attributes, flags) != 0 ||
      posix_spawnattr_setpgroup(&attributes, 0) != 0 ||
      preserve_standard_streams(&actions) != 0 || !install_signal_handlers()) {
    (void)posix_spawn_file_actions_destroy(&actions);
    (void)posix_spawnattr_destroy(&attributes);
    free_environment(child_environment);
    cindy_dsh_release_implicit_bookmark(&implicit_access);
    report_error("could not configure the native launch boundary");
    return 70;
  }
  pid_t child = -1;
  const int spawn_result = posix_spawn(&child, runtime, &actions, &attributes,
                                       child_argv, child_environment);
  (void)posix_spawn_file_actions_destroy(&actions);
  (void)posix_spawnattr_destroy(&attributes);
  free_environment(child_environment);
  if (spawn_result != 0) {
    cindy_dsh_release_implicit_bookmark(&implicit_access);
    report_error("could not launch the bundled DSH runtime");
    return 71;
  }
  child_process_group = (sig_atomic_t)child;

  int status = 0;
  bool child_reaped = false;
  bool group_drained = false;
  if (termination_signal != 0) {
    child_reaped = terminate_and_reap_child_process_group(child, &status);
    group_drained = child_reaped;
  } else {
    while (!child_reaped) {
      bool child_exited = false;
      if (!child_has_exited_without_reaping(child, &child_exited)) {
        if (errno == EINTR && termination_signal != 0) {
          child_reaped = terminate_and_reap_child_process_group(child, &status);
          group_drained = child_reaped;
          break;
        }
        break;
      }
      if (child_exited) {
        // The leader remains unreaped throughout drain_child_process_group(),
        // keeping its process-group identity from being reused mid-cleanup.
        group_drained =
            drain_child_process_group((pid_t)child_process_group, child);
        child_reaped = reap_child(child, &status);
        break;
      }
      if (termination_signal != 0) {
        child_reaped = terminate_and_reap_child_process_group(child, &status);
        group_drained = child_reaped;
        break;
      }
      wait_for_process_group_poll();
    }
  }
  const pid_t group = (pid_t)child_process_group;
  child_process_group = -1;
  if (!child_reaped) {
    (void)drain_child_process_group(group, child);
    cindy_dsh_release_implicit_bookmark(&implicit_access);
    report_error("could not wait for the bundled DSH runtime");
    return 72;
  }
  if (!group_drained) {
    cindy_dsh_release_implicit_bookmark(&implicit_access);
    report_error("could not confirm the bundled DSH runtime process group exited");
    return 73;
  }
  const int result = termination_signal != 0 ? 128 + (int)termination_signal
      : WIFEXITED(status) ? WEXITSTATUS(status)
      : WIFSIGNALED(status) ? 128 + WTERMSIG(status) : 74;
  cindy_dsh_release_implicit_bookmark(&implicit_access);
  return result;
}
