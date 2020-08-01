export interface ItemStorage<I> {
  readonly itemCapacitySettings: ReadonlyMap<I, number>
  getStoredAmount(item: I): number
  getFreeCapacity(item: I): number
  withdraw(item: I, amount: number): number
  deposit(item: I, amount: number): number
}

export default class ItemStorageImpl<I> implements ItemStorage<I> {
  private readonly storedAmounts: Map<I, number> = new Map()

  constructor(
    public readonly itemCapacitySettings: ReadonlyMap<I, number>,
  ) {
    for (const [item, capacity] of itemCapacitySettings) {
      if (capacity < 0) {
        throw new RangeError(
          `Each configured item capacity must be a non-negative number, but ${capacity} was provided for ${item}`,
        )
      }

      this.storedAmounts.set(item, 0)
    }
  }

  public getStoredAmount(item: I): number {
    return Math.min(this.storedAmounts.get(item) || 0, this.itemCapacitySettings.get(item) || 0)
  }

  public getFreeCapacity(item: I): number {
    return Math.max((this.itemCapacitySettings.get(item) || 0) - this.getStoredAmount(item), 0)
  }

  public withdraw(item: I, amount: number): number {
    if (amount <= 0) {
      throw new RangeError(`The amount must be a positive number, ${amount} was provided`)
    }

    const storedAmount = this.getStoredAmount(item)
    const withdrawnAmount = Math.min(amount, storedAmount)
    this.storedAmounts.set(item, storedAmount - withdrawnAmount)
    return withdrawnAmount
  }

  public deposit(item: I, amount: number): number {
    if (amount <= 0) {
      throw new RangeError(`The amount must be a positive number, ${amount} was provided`)
    }

    const freeCapacity = this.getFreeCapacity(item)
    const depositedAmount = Math.min(amount, freeCapacity)
    this.storedAmounts.set(item, this.getStoredAmount(item) + depositedAmount)
    return depositedAmount
  }
}
