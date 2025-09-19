export class RingBuffer<T> {
  private readonly buffer: T[];
  private head = 0;
  private length = 0;

  constructor(private readonly capacity: number) {
    if (capacity <= 0) {
      throw new Error('RingBuffer capacity must be greater than zero');
    }
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[(this.head + this.length) % this.capacity] = item;
    if (this.length < this.capacity) {
      this.length += 1;
    } else {
      this.head = (this.head + 1) % this.capacity;
    }
  }

  getAll(): T[] {
    const items: T[] = [];
    for (let i = 0; i < this.length; i += 1) {
      items.push(this.buffer[(this.head + i) % this.capacity]);
    }
    return items;
  }

  clear(): void {
    this.head = 0;
    this.length = 0;
  }

  isFull(): boolean {
    return this.length === this.capacity;
  }

  getSize(): number {
    return this.length;
  }
}
