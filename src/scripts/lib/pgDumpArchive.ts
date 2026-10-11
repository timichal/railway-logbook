/**
 * Reads a pg_dump custom-format archive (`--format=custom`) far enough to say
 * which tables it carries data for and whether it is whole, with no Postgres
 * tools on the machine: a backup is only downloaded, and asking a local
 * `pg_restore` (i.e. the local database container) to check it made a backup
 * need Docker running.
 *
 * The layout is pg_backup_archiver.c's ReadHead/ReadToc and
 * pg_backup_custom.c's blocks. The table of contents comes first, so it alone
 * would pass a truncated file; what catches one is walking every data block's
 * length-prefixed chunks to the end and landing exactly on the end of the file.
 * The chunks are skipped, never decompressed — their framing is the same
 * whatever the compression.
 */

import * as fs from "node:fs";

/** Archive versions this reader knows the TOC layout of (PG 12 through 18). */
const MIN_VERSION = [1, 14];
const MAX_VERSION = [1, 16];

/** ReadOffset's flag for a TOC entry that has no data block. */
const K_OFFSET_NO_DATA = 3;
const BLK_DATA = 1;
const ARCHIVE_CUSTOM = 1;

export interface DumpContents {
  /** Tables with a TABLE DATA entry, unqualified. */
  tables: string[];
  /** e.g. "17.6" — the server the dump was taken from. */
  serverVersion: string;
}

class ArchiveReader {
  private position = 0;
  private readonly size: number;
  intSize = 4;
  offSize = 8;

  constructor(
    private readonly fd: number,
    private readonly name: string,
  ) {
    this.size = fs.fstatSync(fd).size;
  }

  fail(message: string): never {
    throw new Error(`${this.name}: ${message} (at byte ${this.position} of ${this.size})`);
  }

  get atEnd(): boolean {
    return this.position === this.size;
  }

  bytes(length: number): Buffer {
    if (length < 0 || this.position + length > this.size) this.fail("ends early");
    const buffer = Buffer.alloc(length);
    fs.readSync(this.fd, buffer, 0, length, this.position);
    this.position += length;
    return buffer;
  }

  skip(length: number): void {
    if (length < 0 || this.position + length > this.size) this.fail("ends early");
    this.position += length;
  }

  byte(): number {
    return this.bytes(1)[0];
  }

  /** A sign byte, then the magnitude in `intSize` little-endian bytes. */
  int(): number {
    const raw = this.bytes(1 + this.intSize);
    let value = 0;
    for (let i = this.intSize; i >= 1; i--) value = value * 256 + raw[i];
    return raw[0] ? -value : value;
  }

  /** A length (-1 for NULL), then that many bytes. */
  str(): string | null {
    const length = this.int();
    return length < 0 ? null : this.bytes(length).toString("utf-8");
  }

  /** A flag byte, then `offSize` bytes of position; only the flag matters here. */
  offsetFlag(): number {
    const flag = this.byte();
    this.skip(this.offSize);
    return flag;
  }
}

function compareVersion(a: number[], b: number[]): number {
  return a[0] - b[0] || a[1] - b[1];
}

export function readDumpContents(file: string, name: string): DumpContents {
  const fd = fs.openSync(file, "r");
  try {
    const reader = new ArchiveReader(fd, name);

    if (reader.bytes(5).toString("latin1") !== "PGDMP") reader.fail("not a pg_dump archive");
    const version = [reader.byte(), reader.byte()];
    reader.byte(); // revision
    if (compareVersion(version, MIN_VERSION) < 0 || compareVersion(version, MAX_VERSION) > 0) {
      reader.fail(
        `archive version ${version.join(".")} is not one this reader knows ` +
          `(${MIN_VERSION.join(".")}–${MAX_VERSION.join(".")}); see pgDumpArchive.ts`,
      );
    }
    const atLeast = (minor: number) => version[1] >= minor;

    reader.intSize = reader.byte();
    reader.offSize = reader.byte();
    if (reader.byte() !== ARCHIVE_CUSTOM) reader.fail("not a custom-format archive");
    // compression: an algorithm byte since 1.15, a level before
    if (atLeast(15)) reader.byte();
    else reader.int();
    for (let i = 0; i < 7; i++) reader.int(); // creation time, struct tm fields
    reader.str(); // database name
    const serverVersion = reader.str() ?? "unknown";
    reader.str(); // pg_dump version

    const tables: string[] = [];
    const withData = new Set<number>();
    const entries = reader.int();
    for (let entry = 0; entry < entries; entry++) {
      const dumpId = reader.int();
      reader.int(); // hadDumper
      reader.str(); // table oid
      reader.str(); // oid
      const tag = reader.str();
      const desc = reader.str();
      reader.int(); // section
      reader.str(); // definition
      reader.str(); // drop statement
      reader.str(); // copy statement
      reader.str(); // namespace
      reader.str(); // tablespace
      reader.str(); // table access method
      if (atLeast(16)) reader.int(); // relkind
      reader.str(); // owner
      reader.str(); // "with oids", always "false" since 1.9
      while (reader.str() !== null); // dependencies, NULL-terminated
      if (reader.offsetFlag() !== K_OFFSET_NO_DATA) withData.add(dumpId);
      if (desc === "TABLE DATA" && tag) tables.push(tag);
    }

    const blocks = new Set<number>();
    while (!reader.atEnd) {
      if (reader.byte() !== BLK_DATA) reader.fail("unexpected block type");
      const dumpId = reader.int();
      if (!withData.has(dumpId)) reader.fail(`data block for unknown entry ${dumpId}`);
      blocks.add(dumpId);
      for (let length = reader.int(); length !== 0; length = reader.int()) reader.skip(length);
    }
    const missing = [...withData].filter((id) => !blocks.has(id));
    if (missing.length > 0) reader.fail(`ends before the data of ${missing.length} entries`);

    return { tables, serverVersion };
  } finally {
    fs.closeSync(fd);
  }
}
