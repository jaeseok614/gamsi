type ZipEntry = {
  name: string;
  content: Buffer;
};

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function writeHeader(values: Array<{ value: number; bytes: 2 | 4 }>) {
  const size = values.reduce((sum, entry) => sum + entry.bytes, 0);
  const buffer = Buffer.alloc(size);
  let offset = 0;
  for (const entry of values) {
    if (entry.bytes === 2) {
      buffer.writeUInt16LE(entry.value, offset);
    } else {
      buffer.writeUInt32LE(entry.value >>> 0, offset);
    }
    offset += entry.bytes;
  }
  return buffer;
}

export function buildZip(entries: ZipEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const { dosDate, dosTime } = dosDateTime();

  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/^\/+/, ""), "utf8");
    const content = entry.content;
    const crc = crc32(content);
    const localHeader = writeHeader([
      { value: 0x04034b50, bytes: 4 },
      { value: 20, bytes: 2 },
      { value: 0x0800, bytes: 2 },
      { value: 0, bytes: 2 },
      { value: dosTime, bytes: 2 },
      { value: dosDate, bytes: 2 },
      { value: crc, bytes: 4 },
      { value: content.length, bytes: 4 },
      { value: content.length, bytes: 4 },
      { value: name.length, bytes: 2 },
      { value: 0, bytes: 2 }
    ]);
    localParts.push(localHeader, name, content);

    const centralHeader = writeHeader([
      { value: 0x02014b50, bytes: 4 },
      { value: 20, bytes: 2 },
      { value: 20, bytes: 2 },
      { value: 0x0800, bytes: 2 },
      { value: 0, bytes: 2 },
      { value: dosTime, bytes: 2 },
      { value: dosDate, bytes: 2 },
      { value: crc, bytes: 4 },
      { value: content.length, bytes: 4 },
      { value: content.length, bytes: 4 },
      { value: name.length, bytes: 2 },
      { value: 0, bytes: 2 },
      { value: 0, bytes: 2 },
      { value: 0, bytes: 2 },
      { value: 0, bytes: 2 },
      { value: 0, bytes: 4 },
      { value: offset, bytes: 4 }
    ]);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = writeHeader([
    { value: 0x06054b50, bytes: 4 },
    { value: 0, bytes: 2 },
    { value: 0, bytes: 2 },
    { value: entries.length, bytes: 2 },
    { value: entries.length, bytes: 2 },
    { value: centralDirectory.length, bytes: 4 },
    { value: offset, bytes: 4 },
    { value: 0, bytes: 2 }
  ]);

  return Buffer.concat([...localParts, centralDirectory, end]);
}
