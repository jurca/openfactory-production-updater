import ItemStorageImpl from '../ItemStorage'
import StrictItemStorage from '../StrictItemStorage'

describe('StrictItemStorage', () => {
  it('rejects item capacities that are not safe integers', () => {
    new StrictItemStorage(new ItemStorageImpl(new Map([[1, Number.MAX_SAFE_INTEGER]])))
    const baseStorage = new ItemStorageImpl(new Map([[1, Number.MAX_SAFE_INTEGER + 1]]))
    expect(() => new StrictItemStorage(baseStorage)).toThrowError(TypeError)
  })

  it('exposes the item capacity settings of the wrapped storage', () => {
    const baseStorage = new ItemStorageImpl(new Map())
    expect(new StrictItemStorage(baseStorage).itemCapacitySettings).toBe(baseStorage.itemCapacitySettings)
  })

  it('calls the getStoredAmount method of the wrapped storage', () => {
    const baseStorage = new ItemStorageImpl(new Map([[1, 5]]))
    baseStorage.deposit(1, 3)
    spyOn(baseStorage, 'getStoredAmount').and.callThrough()
    const storage = new StrictItemStorage(baseStorage)
    expect(storage.getStoredAmount(1)).toBe(3)
    expect(baseStorage.getStoredAmount).toHaveBeenCalledTimes(1)
    expect(baseStorage.getStoredAmount).toHaveBeenCalledWith(1)
  })

  it('calls the getFreeCapacity method of the wrapped storage', () => {
    const baseStorage = new ItemStorageImpl(new Map([[1, 5]]))
    baseStorage.deposit(1, 3)
    spyOn(baseStorage, 'getFreeCapacity').and.callThrough()
    const storage = new StrictItemStorage(baseStorage)
    expect(storage.getFreeCapacity(1)).toBe(2)
    expect(baseStorage.getFreeCapacity).toHaveBeenCalledTimes(1)
    expect(baseStorage.getFreeCapacity).toHaveBeenCalledWith(1)
  })

  it('calls the withdraw method of the wrapped storage', () => {
    const baseStorage = new ItemStorageImpl(new Map([[1, 5]]))
    baseStorage.deposit(1, 3)
    spyOn(baseStorage, 'withdraw').and.callThrough()
    const storage = new StrictItemStorage(baseStorage)
    expect(storage.withdraw(1, 2)).toBe(2)
    expect(baseStorage.withdraw).toHaveBeenCalledTimes(1)
    expect(baseStorage.withdraw).toHaveBeenCalledWith(1, 2)
  })

  it('calls the deposit method of the wrapped storage', () => {
    const baseStorage = new ItemStorageImpl(new Map([[1, 5]]))
    spyOn(baseStorage, 'deposit').and.callThrough()
    const storage = new StrictItemStorage(baseStorage)
    expect(storage.deposit(1, 2)).toBe(2)
    expect(baseStorage.deposit).toHaveBeenCalledTimes(1)
    expect(baseStorage.deposit).toHaveBeenCalledWith(1, 2)
  })

  it('throws a TypeError if withdrawing an amount that is not a safe integer', () => {
    const storage = new StrictItemStorage(new ItemStorageImpl(new Map([[1, 5]])))
    storage.deposit(1, 5)
    expect(() => storage.withdraw(1, 2.5)).toThrowError(TypeError)
    expect(() => storage.withdraw(1, Number.MAX_SAFE_INTEGER + 1)).toThrowError(TypeError)
    expect(storage.getStoredAmount(1)).toBe(5)
    expect(storage.getFreeCapacity(1)).toBe(0)
  })

  it('throws a RangeError if withdrawing more than the stored amount', () => {
    const storage = new StrictItemStorage(new ItemStorageImpl(new Map([[1, 5]])))
    storage.deposit(1, 3)
    expect(() => storage.withdraw(1, 4)).toThrowError(RangeError)
    expect(storage.getStoredAmount(1)).toBe(3)
    expect(storage.getFreeCapacity(1)).toBe(2)
  })

  it('throws a TypeError if depositing an amount that is not a safe integer', () => {
    const storage = new StrictItemStorage(new ItemStorageImpl(new Map([[1, 5]])))
    expect(() => storage.deposit(1, 2.5)).toThrowError(TypeError)
    expect(() => storage.deposit(1, Number.MAX_SAFE_INTEGER + 1)).toThrowError(TypeError)
    expect(storage.getStoredAmount(1)).toBe(0)
    expect(storage.getFreeCapacity(1)).toBe(5)
  })

  it('throws a TypeError if depositing more than the free capacity', () => {
    const storage = new StrictItemStorage(new ItemStorageImpl(new Map([[1, 5], [2, 3]])))
    storage.deposit(1, 3)
    expect(() => storage.deposit(1, 3)).toThrowError(RangeError)
    expect(storage.getStoredAmount(1)).toBe(3)
    expect(storage.getFreeCapacity(1)).toBe(2)
  })

  // TODO: it throws error from every method for unknown items
})
