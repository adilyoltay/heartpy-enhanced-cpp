export class RingBuffer<T> {
  private readonly buffer: (T | undefined)[];
  private head = 0;
  private tail = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    if (capacity <= 0) {
      throw new Error('Capacity must be positive');
    }
    this.buffer = new Array<T | undefined>(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.isFull()) {
      this.tail = (this.tail + 1) % this.capacity;
    } else {
      this.count += 1;
    }
  }

  getAll(): T[] {
    const result: T[] = [];
    for (let index = 0; index < this.count; index += 1) {
      const pointer = (this.tail + index) % this.capacity;
      const value = this.buffer[pointer];
      if (value !== undefined) {
        result.push(value);
      }
    }
    return result;
  }

  clear(): void {
    this.buffer.fill(undefined);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  isFull(): boolean {
    return this.count === this.capacity;
  }
}
