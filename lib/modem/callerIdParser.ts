export interface CallerIdInfo {
  date?: string;   // MMDD
  time?: string;   // HHMM
  name?: string;
  number?: string;
}

/**
 * Parses caller ID lines from the modem serial stream.
 * Lines look like: "DATE=0315", "TIME=1423", "NAME=JOHN SMITH", "NMBR=8005551234"
 */
export class CallerIdParser {
  private buffer = '';
  private current: CallerIdInfo = {};
  private onCallerIdCallback?: (info: CallerIdInfo) => void;

  onCallerId(cb: (info: CallerIdInfo) => void): void {
    this.onCallerIdCallback = cb;
  }

  feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\r\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      this.parseLine(line.trim());
    }
  }

  private parseLine(line: string): void {
    const dateMatch = line.match(/^DATE\s*=\s*(\d+)/);
    const timeMatch = line.match(/^TIME\s*=\s*(\d+)/);
    const nameMatch = line.match(/^NAME\s*=\s*(.+)/);
    const numMatch = line.match(/^NMBR\s*=\s*(.+)/);

    if (dateMatch) {
      this.current.date = dateMatch[1]!;
    } else if (timeMatch) {
      this.current.time = timeMatch[1]!;
    } else if (nameMatch) {
      this.current.name = nameMatch[1]!.trim();
    } else if (numMatch) {
      this.current.number = numMatch[1]!.trim();
      // Number is the last field; emit
      this.onCallerIdCallback?.({ ...this.current });
      this.current = {};
    }
  }

  /** Format MMDD + HHMM into human-readable strings */
  static formatDate(mmdd: string): string {
    const month = mmdd.slice(0, 2);
    const day = mmdd.slice(2, 4);
    const year = new Date().getFullYear();
    return `${month}/${day}/${year}`;
  }

  static formatTime(hhmm: string): string {
    const hour = parseInt(hhmm.slice(0, 2), 10);
    const min = hhmm.slice(2, 4);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const h = hour % 12 || 12;
    return `${h}:${min} ${ampm}`;
  }
}
