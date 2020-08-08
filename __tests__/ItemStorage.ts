import ItemStorageImpl from '../ItemStorage.js'

describe('ItemStorageImpl', () => {
  it('provides read-only access to the item capacity configuring map', () => {
    const itemCapacities = new Map([[1, 3], [2, 7], [6, 2]])
    const storage = new ItemStorageImpl(itemCapacities)
    expect(storage.itemCapacitySettings).toEqual(itemCapacities)
  })

  it('allows storing items up to capacity, reporting stored amount and remaining free capacity correctly', () => {
    const storage = new ItemStorageImpl(new Map([[1, 3], [2, 5]]))
    expect(storage.getStoredAmount(1)).toBe(0)
    expect(storage.getFreeCapacity(1)).toBe(3)
    expect(storage.getStoredAmount(2)).toBe(0)
    expect(storage.getFreeCapacity(2)).toBe(5)

    expect(storage.deposit(2, 1)).toBe(1)
    expect(storage.getStoredAmount(2)).toBe(1)
    expect(storage.getFreeCapacity(2)).toBe(4)

    expect(storage.deposit(2, 1)).toBe(1)
    expect(storage.getStoredAmount(2)).toBe(2)
    expect(storage.getFreeCapacity(2)).toBe(3)

    expect(storage.deposit(2, 5)).toBe(3)
    expect(storage.getStoredAmount(2)).toBe(5)
    expect(storage.getFreeCapacity(2)).toBe(0)

    expect(storage.getStoredAmount(1)).toBe(0)
    expect(storage.getFreeCapacity(1)).toBe(3)
  })

  it('allows withdrawing items up to stored amount, reporting withdrawn amount and remaning amount correctly', () => {
    const storage = new ItemStorageImpl(new Map([[1, 3], [2, 5]]))
    storage.deposit(1, storage.getFreeCapacity(1))
    storage.deposit(2, storage.getFreeCapacity(2))
    expect(storage.getStoredAmount(1)).toBe(3)
    expect(storage.getFreeCapacity(1)).toBe(0)
    expect(storage.getStoredAmount(2)).toBe(5)
    expect(storage.getFreeCapacity(2)).toBe(0)

    expect(storage.withdraw(2, 1)).toBe(1)
    expect(storage.getStoredAmount(2)).toBe(4)
    expect(storage.getFreeCapacity(2)).toBe(1)

    expect(storage.withdraw(2, 1)).toBe(1)
    expect(storage.getStoredAmount(2)).toBe(3)
    expect(storage.getFreeCapacity(2)).toBe(2)

    expect(storage.withdraw(2, 5)).toBe(3)
    expect(storage.getStoredAmount(2)).toBe(0)
    expect(storage.getFreeCapacity(2)).toBe(5)

    expect(storage.getStoredAmount(1)).toBe(3)
    expect(storage.getFreeCapacity(1)).toBe(0)
  })

  it('allows 0 as item capacity', () => {
    new ItemStorageImpl(new Map([[1, 0]]))
  })

  it('rejects negative item capacity', () => {
    expect(() => {
      new ItemStorageImpl(new Map([[1, -Number.EPSILON]]))
    }).toThrowError(RangeError)
  })

  it('rejects 0 or negative amounts of deposited items', () => {
    const storage = new ItemStorageImpl(new Map([[1, 1]]))
    expect(() => storage.deposit(1, 0)).toThrowError(RangeError)
    expect(() => storage.deposit(1, -1)).toThrowError(RangeError)
  })

  it('rejects 0 or negative amounts of withdrawn items', () => {
    const storage = new ItemStorageImpl(new Map([[1, 1]]))
    expect(() => storage.withdraw(1, 0)).toThrowError(RangeError)
    expect(() => storage.withdraw(1, -1)).toThrowError(RangeError)
  })

  it('reports 0 as available capacity for unknown items', () => {
    const storage = new ItemStorageImpl(new Map([]))
    expect(storage.getFreeCapacity('item')).toBe(0)
  })

  it('reports 0 as stored amount for unknown items', () => {
    const storage = new ItemStorageImpl(new Map([]))
    expect(storage.getStoredAmount('foo')).toBe(0)
  })

  it('reports 0 as available capacity if full storage has its capacity decreased', () => {
    const capacitySettings = new Map([[1, 5]])
    const storage = new ItemStorageImpl(capacitySettings)
    storage.deposit(1, 5)
    expect(storage.getFreeCapacity(1)).toBe(0)
    capacitySettings.set(1, 3)
    expect(storage.getFreeCapacity(1)).toBe(0)
  })

  it('reports only amount of up to stored capacity even it internaly stores more', () => {
    // It is up to the agent manipulating the capacity to adjust the stored amount, if so desired (anyone remember
    // Dune 2?)

    const capacitySettings = new Map([[1, 5]])
    const storage = new ItemStorageImpl(capacitySettings)
    storage.deposit(1, 5)
    expect(storage.getStoredAmount(1)).toBe(5)
    capacitySettings.set(1, 3)
    expect(storage.getStoredAmount(1)).toBe(3)
    capacitySettings.set(1, 7)
    expect(storage.getStoredAmount(1)).toBe(5)
  })

  it('deposition an unknown item has no effect', () => {
    const storage = new ItemStorageImpl(new Map([[1, 1]]))
    expect(storage.deposit(2, 1)).toBe(0)
    expect(storage.getStoredAmount(1)).toBe(0)
  })

  it('withdrawing an unknown item has no effect', () => {
    const storage = new ItemStorageImpl(new Map([[1, 1]]))
    storage.deposit(1, 1)
    expect(storage.withdraw(2, 1)).toBe(0)
    expect(storage.getStoredAmount(1)).toBe(1)
  })

  it('depositing and withdrawing items declared after initialization works the same as for pre-declared', () => {
    const capacitySettings = new Map([[1, 5]])
    const storage = new ItemStorageImpl(capacitySettings)
    capacitySettings.set(2, 7)
    expect(storage.getStoredAmount(2)).toBe(0)
    expect(storage.getFreeCapacity(2)).toBe(7)
    expect(storage.deposit(2, 10)).toBe(7)
    expect(storage.getStoredAmount(2)).toBe(7)
    expect(storage.getFreeCapacity(2)).toBe(0)
    capacitySettings.set(2, 5)
    expect(storage.getStoredAmount(2)).toBe(5)
    expect(storage.getFreeCapacity(2)).toBe(0)
    capacitySettings.set(2, 10)
    expect(storage.getStoredAmount(2)).toBe(7)
    expect(storage.getFreeCapacity(2)).toBe(3)
    expect(storage.withdraw(2, 3)).toBe(3)
    expect(storage.getStoredAmount(2)).toBe(4)
    expect(storage.getFreeCapacity(2)).toBe(6)
    expect(storage.withdraw(2, 16)).toBe(4)
    expect(storage.getStoredAmount(2)).toBe(0)
    expect(storage.getFreeCapacity(2)).toBe(10)
  })
})
