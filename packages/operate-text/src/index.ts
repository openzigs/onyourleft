// SPDX-License-Identifier: Apache-2.0

/**
 * `@onyourleft/operate-text` (#2644, ADR 0069 D-7): the Operate sections'
 * wording and pure view models, in ONE place, so that the app's Operate
 * panels (`apps/web/src/views/Operate*.tsx`) and the instance's admin pages
 * (#2645 onwards) can never disagree.
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval.**
 */

export {
  MODERATORS_ALWAYS_JOIN,
  REGISTRATION_MODE_TEXT,
  type OperateRegistrationMode,
} from './accounts';
export {
  BACK_UP_NOW_CONFIRM_TEXT,
  BACKUP_FAILED_TEXT,
  BACKUP_NOT_ASKED_TEXT,
  BACKUP_OFF_BOX_TEXT,
  BACKUP_WAITING_TEXT,
  BACKUPS_LIST_TEXT,
  BACKUPS_UNREADABLE_TEXT,
  backupsStaleText,
  NO_BACKUP_TEXT,
  NO_SNAPSHOT_TO_RESTORE_TEXT,
  OFF_BOX_FAILED_TEXT,
  RESTORE_ONE_OFF_TEXT,
  RESTORE_PREFACE_TEXT,
  RESTORE_WHY_TEXT,
  snapshotPlace,
} from './backups';
export {
  END_ROOM_CONFIRM_TEXT,
  endRoomTypeText,
  NO_ROOM_TEXT,
  ROOM_END_REASON_TEXT,
  ROOM_END_REASONS,
  ROOM_KIND_TEXT,
  ROOM_NOT_ENDED_TEXT,
  ROOM_PHASE_TEXT,
  ridersText,
  ROOM_UNNAMED_RIDER,
  ROOMS_LIST_TEXT,
  ROOMS_NAMES_ONLY_TEXT,
  ROOMS_UNREADABLE_TEXT,
  type OperateRoomEndReason,
  type OperateRoomKind,
  type OperateRoomPhase,
} from './rooms';
export {
  COMPARE_WITH_MAIN_LABEL,
  compareWithMainUrl,
  DISK_HOLDS_TEXT,
  DISK_LOW_WARNING,
  diskRow,
  DOCKER_DESKTOP_DISK_TEXT,
  KEYS_TEXT,
  LAST_BACKUP_OFF_BOX_TEXT,
  lastBackupRow,
  MIGRATIONS_TEXT,
  NOT_RECORDED,
  STATUS_NOT_READY_TEXT,
  STATUS_PURPOSE_TEXT,
  STATUS_READY_TEXT,
  STATUS_UNREADABLE_TEXT,
  statusRows,
  TUNNEL_NOT_KNOWN,
  tunnelText,
  type OperateKeysWord,
  type OperateMigrationsWord,
  type OperateOffBox,
  type OperateRow,
  type OperateRowWarning,
  type OperateStatusAnswer,
  type OperateStatusDisk,
  type OperateStatusLastBackup,
  type OperateTunnel,
} from './status';
export { bytesText, countText, durationText, momentText } from './words';
