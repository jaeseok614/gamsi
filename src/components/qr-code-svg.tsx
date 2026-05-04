const QR_ALPHANUMERIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

function qrGfTables() {
  const exp = new Array<number>(512).fill(0);
  const log = new Array<number>(256).fill(0);
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    exp[index] = value;
    log[value] = index;
    value <<= 1;
    if (value & 0x100) {
      value ^= 0x11d;
    }
  }
  for (let index = 255; index < 512; index += 1) {
    exp[index] = exp[index - 255];
  }
  return { exp, log };
}

const QR_GF = qrGfTables();

function qrGfMultiply(left: number, right: number) {
  return left === 0 || right === 0 ? 0 : QR_GF.exp[QR_GF.log[left] + QR_GF.log[right]];
}

function qrReedSolomonGenerator(degree: number) {
  const result = [1];
  for (let index = 0; index < degree; index += 1) {
    result.push(0);
    for (let cursor = 0; cursor < result.length - 1; cursor += 1) {
      result[cursor] = qrGfMultiply(result[cursor], QR_GF.exp[index]) ^ result[cursor + 1];
    }
  }
  return result.slice(0, degree);
}

function qrReedSolomonRemainder(data: number[], degree: number) {
  const generator = qrReedSolomonGenerator(degree);
  const result = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    for (let index = 0; index < degree; index += 1) {
      result[index] ^= qrGfMultiply(generator[index], factor);
    }
  }
  return result;
}

function qrAppendBits(bits: number[], value: number, length: number) {
  for (let index = length - 1; index >= 0; index -= 1) {
    bits.push((value >>> index) & 1);
  }
}

function qrFormatBits(mask: number) {
  const data = (1 << 3) | mask;
  let rem = data;
  for (let index = 0; index < 10; index += 1) {
    rem = (rem << 1) ^ (((rem >>> 9) & 1) ? 0x537 : 0);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function buildQrMatrix(rawValue: string) {
  const value = rawValue.toUpperCase();
  const version = 2;
  const size = 17 + version * 4;
  const dataCodewords = 34;
  const eccCodewords = 10;
  const matrix = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

  function setModule(x: number, y: number, dark: boolean, isFunction = true) {
    if (x < 0 || y < 0 || x >= size || y >= size) {
      return;
    }
    matrix[y][x] = dark;
    if (isFunction) {
      reserved[y][x] = true;
    }
  }

  function drawFinder(x: number, y: number) {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) {
        const distance = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        setModule(x + dx, y + dy, distance === 3 || distance <= 1);
      }
    }
  }

  function drawAlignment(cx: number, cy: number) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        setModule(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) === 2 || (dx === 0 && dy === 0));
      }
    }
  }

  function drawFormat(mask: number) {
    const bits = qrFormatBits(mask);
    const getBit = (index: number) => ((bits >>> index) & 1) !== 0;
    for (let index = 0; index <= 5; index += 1) setModule(8, index, getBit(index));
    setModule(8, 7, getBit(6));
    setModule(8, 8, getBit(7));
    setModule(7, 8, getBit(8));
    for (let index = 9; index < 15; index += 1) setModule(14 - index, 8, getBit(index));
    for (let index = 0; index < 8; index += 1) setModule(size - 1 - index, 8, getBit(index));
    for (let index = 8; index < 15; index += 1) setModule(8, size - 15 + index, getBit(index));
    setModule(8, size - 8, true);
  }

  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);
  drawAlignment(18, 18);
  for (let index = 8; index < size - 8; index += 1) {
    setModule(index, 6, index % 2 === 0);
    setModule(6, index, index % 2 === 0);
  }
  drawFormat(0);

  const bits: number[] = [];
  qrAppendBits(bits, 0b0010, 4);
  qrAppendBits(bits, value.length, 9);
  for (let index = 0; index < value.length; index += 2) {
    const first = QR_ALPHANUMERIC.indexOf(value[index]);
    const second = index + 1 < value.length ? QR_ALPHANUMERIC.indexOf(value[index + 1]) : -1;
    if (first < 0 || (index + 1 < value.length && second < 0)) {
      return null;
    }
    if (second >= 0) {
      qrAppendBits(bits, first * 45 + second, 11);
    } else {
      qrAppendBits(bits, first, 6);
    }
  }
  const capacityBits = dataCodewords * 8;
  qrAppendBits(bits, 0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }
  const data: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    data.push(bits.slice(index, index + 8).reduce((sum, bit) => (sum << 1) | bit, 0));
  }
  for (let pad = 0; data.length < dataCodewords; pad += 1) {
    data.push(pad % 2 === 0 ? 0xec : 0x11);
  }
  const codewords = [...data, ...qrReedSolomonRemainder(data, eccCodewords)];
  const codewordBits = codewords.flatMap((byte) => Array.from({ length: 8 }, (_, index) => (byte >>> (7 - index)) & 1));
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right -= 1;
    }
    for (let vertical = 0; vertical < size; vertical += 1) {
      const y = upward ? size - 1 - vertical : vertical;
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        if (reserved[y][x]) {
          continue;
        }
        const mask = (x + y) % 2 === 0;
        matrix[y][x] = Boolean((codewordBits[bitIndex] ?? 0) ^ (mask ? 1 : 0));
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
  drawFormat(0);

  return matrix;
}

export function QrCodeSvg({ value, className = "qr-token" }: { value: string; className?: string }) {
  const matrix = buildQrMatrix(value);
  if (!matrix) {
    return <div className="empty">QR로 표시할 수 없는 토큰입니다.</div>;
  }

  const quiet = 4;
  const size = matrix.length + quiet * 2;
  const cells = matrix.flatMap((row, y) =>
    row.map((dark, x) => (dark ? <rect key={`${x}-${y}`} x={x + quiet} y={y + quiet} width="1" height="1" /> : null))
  );

  return (
    <svg className={className} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="출퇴근 인증 QR">
      <rect width={size} height={size} fill="#fff" />
      <g fill="#111827">{cells}</g>
    </svg>
  );
}
