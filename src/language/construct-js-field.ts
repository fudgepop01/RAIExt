import { Endian } from "construct-js";

const assert = (condition, message) => {
  if (!condition) {
      throw new Error(message);
  }
};

export default class FloatField {
  public width;
  public min;
  public max;
  public toBytesFn;
  public value;
  public endian;

  constructor(width, min: number, max: number, toBytesFn: (vals: number[], isLE: boolean) => Uint8Array, value: number, endian: Endian) {
      this.width = width;
      this.min = min;
      this.max = max;
      this.toBytesFn = toBytesFn;
      this.assertInvariants(value);
      this.value = value;
      this.endian = endian;
  }
  assertInvariants(value) {
      assert(value >= this.min && value <= this.max, `value must be an integer between ${this.min} and ${this.max}`);
  }
  computeBufferSize() { return this.width; }
  toUint8Array() {
      return this.toBytesFn([this.value], this.endian === Endian.Little);
  }
  set(value) {
      this.assertInvariants(value);
      this.value = value;
  }
  get() { return this.value; }
}