import type Database from 'better-sqlite3';

interface LegacyDshMigrationBridge {
  seq: number;
  legacyFileName: string;
  legacySqlHash: string;
  canonicalFileName: string;
  canonicalSqlHash: string;
  canonicalScriptFileName?: string;
}

const LEGACY_DSH_MIGRATION_BRIDGES: readonly LegacyDshMigrationBridge[] = [
  {
    seq: 100,
    legacyFileName: '0100_dsh-session-bindings.sql',
    legacySqlHash: '5d90b333fced1683326cb2e541fdd2bf4ac3e6eb0e36d700d429632d82448021',
    canonicalFileName: '0100_segment_messages_fts_cjk.sql',
    canonicalSqlHash: 'b4e0497804e46e0a0b0b8c31975b062152d551bac49c3c2e80932567b4085dcd',
    canonicalScriptFileName: '0100_segment_messages_fts_cjk.ts',
  },
  {
    seq: 101,
    legacyFileName: '0101_abnormal_solo.sql',
    legacySqlHash: '9c78dbca139861b7bcebd5177a42d39a290022359d15bea2ba08d86b04a144dc',
    canonicalFileName: '0101_repair_cjk_fts_missing_rows.sql',
    canonicalSqlHash: 'b4e0497804e46e0a0b0b8c31975b062152d551bac49c3c2e80932567b4085dcd',
    canonicalScriptFileName: '0101_repair_cjk_fts_missing_rows.ts',
  },
  {
    seq: 102,
    legacyFileName: '0102_conscious_iron_fist.sql',
    legacySqlHash: '014efd0177094fd001334746ef9a2498bcf1e1c6f424ed1a1dc468cc980b52be',
    canonicalFileName: '0102_optimal_ender_wiggin.sql',
    canonicalSqlHash: 'b4e0497804e46e0a0b0b8c31975b062152d551bac49c3c2e80932567b4085dcd',
    canonicalScriptFileName: '0102_optimal_ender_wiggin.ts',
  },
  {
    seq: 103,
    legacyFileName: '0103_stiff_captain_america.sql',
    legacySqlHash: 'ee55b68916f4e0a885a22a541003b6392ca1c385557da78e862909fa74190449',
    canonicalFileName: '0103_bot_mode.sql',
    canonicalSqlHash: '17f781990964f826f734710d40eebe8b3830571993c394db935f540062735985',
  },
  {
    seq: 104,
    legacyFileName: '0104_flat_slyde.sql',
    legacySqlHash: '495b4d98fddb40e89746053164122c6c76de6c52be8cae43b0a41d6a1693ceb7',
    canonicalFileName: '0104_schedule-model-harness.sql',
    canonicalSqlHash: 'b4e0497804e46e0a0b0b8c31975b062152d551bac49c3c2e80932567b4085dcd',
    canonicalScriptFileName: '0104_schedule-model-harness.ts',
  },
];

function tableHasColumns(
  db: Database.Database,
  tableName: string,
  expectedColumns: readonly string[],
): boolean {
  const actualColumns = new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  return expectedColumns.every((column) => actualColumns.has(column));
}

function verifyDshSchema(db: Database.Database): void {
  const requiredColumns: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['sessions', ['startup_state']],
    [
      'dsh_session_bindings',
      [
        'cindy_session_id',
        'runtime_session_id',
        'host_scope_id',
        'runtime_release_id',
        'runtime_version',
        'controller_api_version',
        'capability_fingerprint',
        'home_mode',
        'lifecycle_state',
        'last_projected_sequence',
        'revision',
        'created_at',
        'updated_at',
      ],
    ],
    ['dsh_projection_events', ['cindy_session_id', 'sequence', 'event_json', 'event_sha256', 'created_at']],
    ['dsh_prompt_receipts', ['receipt_id', 'cindy_session_id', 'state', 'stop_reason', 'created_at', 'resolved_at']],
    [
      'dsh_activity_snapshots',
      ['cindy_session_id', 'host_scope_id', 'activity_json', 'activity_sha256', 'sequence', 'created_at', 'updated_at'],
    ],
  ];
  for (const [tableName, columns] of requiredColumns) {
    if (!tableHasColumns(db, tableName, columns)) {
      throw new Error(`DSH migration bridge found incompatible ${tableName} schema`);
    }
  }
}

function readCanonicalMigrationSql(fileName: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path');
  return readFileSync(path.join(__dirname, '..', fileName), 'utf8');
}

function hashSql(sql: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

function runCanonicalCompanion(db: Database.Database, fileName: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const script = require(`./${fileName}`) as { run?: (database: Database.Database) => void };
  if (typeof script.run !== 'function') {
    throw new Error(`DSH migration bridge companion ${fileName} has no run()`);
  }
  script.run(db);
}

function bridgeLegacyDshMigration(db: Database.Database, bridge: LegacyDshMigrationBridge): void {
  const applied = db
    .prepare('SELECT file_name, content_hash FROM migration_history WHERE seq = ?')
    .get(bridge.seq) as { file_name: string; content_hash: string } | undefined;
  if (
    !applied ||
    applied.file_name !== bridge.legacyFileName ||
    applied.content_hash !== bridge.legacySqlHash
  ) {
    return;
  }

  const canonicalSql = readCanonicalMigrationSql(bridge.canonicalFileName);
  if (hashSql(canonicalSql) !== bridge.canonicalSqlHash) {
    throw new Error(`DSH migration bridge canonical SQL identity changed at seq ${bridge.seq}`);
  }
  db.exec(canonicalSql);
  if (bridge.canonicalScriptFileName) {
    runCanonicalCompanion(db, bridge.canonicalScriptFileName);
  }
  const result = db
    .prepare(
      `UPDATE migration_history
       SET file_name = ?, content_hash = ?, applied_at = ?
       WHERE seq = ? AND file_name = ? AND content_hash = ?`,
    )
    .run(
      bridge.canonicalFileName,
      bridge.canonicalSqlHash,
      Date.now(),
      bridge.seq,
      bridge.legacyFileName,
      bridge.legacySqlHash,
    );
  if (result.changes !== 1) {
    throw new Error(`DSH migration bridge lost lineage ownership at seq ${bridge.seq}`);
  }
}

function run(db: Database.Database): void {
  verifyDshSchema(db);
  for (const bridge of LEGACY_DSH_MIGRATION_BRIDGES) {
    bridgeLegacyDshMigration(db, bridge);
  }
}

module.exports = { run };
