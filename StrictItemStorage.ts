import {ItemStorage} from './ItemStorage.js'

export default class StrictItemStorage<I> implements ItemStorage<I> {
  constructor(
    private readonly wrappedStorage: ItemStorage<I>,
  ) {
    for (const [item, capacity] of wrappedStorage.itemCapacitySettings) {
      if (!Number.isSafeInteger(capacity)) {
        throw new TypeError(`Item capacity must be a safe integer, ${capacity} was provided for ${item}`)
      }
    }
  }

  get itemCapacitySettings(): ReadonlyMap<I, number> {
    return this.wrappedStorage.itemCapacitySettings
  }

  public getStoredAmount(item: I): number {
    return this.wrappedStorage.getStoredAmount(item)
  }

  public getFreeCapacity(item: I): number {
    return this.wrappedStorage.getFreeCapacity(item)
  }

  public withdraw(item: I, amount: number): number {
    if (!Number.isSafeInteger(amount)) {
      throw new TypeError(`The amount must be a safe integer, ${amount} was provided`)
    }
    if (amount > this.getStoredAmount(item)) {
      throw new RangeError(
        `Unsafisfiable request: there is only ${this.getStoredAmount(item)} amount of the ${item} item in the ` +
        `storage, but ${amount} was requested`,
      )
    }
    return this.wrappedStorage.withdraw(item, amount)
  }

  public deposit(item: I, amount: number): number {
    if (!Number.isSafeInteger(amount)) {
      throw new TypeError(`The amount must be a safe integer, ${amount} was provided`)
    }
    if (amount > this.getFreeCapacity(item)) {
      throw new RangeError(
        `Unsatisfiable request: there is only ${this.getFreeCapacity(item)} free capacity for the ${item} item, but ` +
        `${amount} was requested`,
      )
    }
    return this.wrappedStorage.deposit(item, amount)
  }
}
