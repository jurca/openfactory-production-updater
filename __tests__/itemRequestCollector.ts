import {ItemStorage, Recipe, RecipeProduction} from '../index'
import {collectItemRequests} from '../itemRequestCollector'
import {Item, RECIPES} from './data/data'

describe('itemRequestCollector', () => {
  type ResettableItemStorage<I> = ItemStorage<I> & {
    reset(): void
  }

  const itemStorage: ResettableItemStorage<Item> = createItemStorage(new Map([
    [Item.TREE_TRUNK, [32, 1024]],
    [Item.TREE_BARK, [64, 1024]],
    [Item.WOOD_PLANK, [6, 1024]],
    [Item.WOODEN_NAIL, [12, 1024]],
    [Item.TABLE, [1000, 1024]],
  ]))

  describe('collectItemRequests', () => {
    it('collects all item requests from all productions, respecting available amounts of items', () => {
      const productions = {
        treeHarvest: makeProduction(RECIPES.TREE_HARVEST, 128),
        processTreeTrunk: makeProduction(RECIPES.PROCESS_TREE_TRUNK, 128),
        woodenNail: makeProduction(RECIPES.WOODEN_NAIL, 128),
        table: makeProduction(RECIPES.TABLE, 128),
      }
      const requests = collectItemRequests([
        productions.treeHarvest,
        productions.processTreeTrunk,
        productions.woodenNail,
        productions.table,
      ], itemStorage)
      expect(new Set(requests.keys())).toEqual(
        new Set([Item.TREE_BARK, Item.TREE_TRUNK, Item.WOODEN_NAIL, Item.WOOD_PLANK]),
      )

      const treeBarkRequest = requests.get(Item.TREE_BARK)
      expect(treeBarkRequest?.productions.length).toBe(1)
      expect(treeBarkRequest?.productions[0]).toEqual({
        production: productions.table,
        requestedProducers: 1, // limited by wooden nails in storage
        requestedAmount: 4,
      })
      expect(treeBarkRequest?.totalRequestedAmount).toBe(4)

      const treeTrunkRequest = requests.get(Item.TREE_TRUNK)
      expect(treeTrunkRequest?.productions.length).toBe(1)
      expect(treeTrunkRequest?.productions[0]).toEqual({
        production: productions.processTreeTrunk,
        requestedProducers: 32, // limited by tree trunks in storage
        requestedAmount: 32,
      })
      expect(treeTrunkRequest?.totalRequestedAmount).toBe(32)

      const woodenNailRequest = requests.get(Item.WOODEN_NAIL)
      expect(woodenNailRequest?.productions.length).toBe(1)
      expect(woodenNailRequest?.productions[0]).toEqual({
        production: productions.table,
        requestedProducers: 1, // limited by wooden nails in storage
        requestedAmount: 12,
      })
      expect(woodenNailRequest?.totalRequestedAmount).toBe(12)

      const woodPlankRequest = requests.get(Item.WOOD_PLANK)
      expect(woodPlankRequest?.productions).toEqual([
        {
          production: productions.woodenNail,
          requestedProducers: 6, // limited by wooden nails in storage
          requestedAmount: 6,
        },
        {
          production: productions.table,
          requestedProducers: 1, // limited by wooden nails in storage
          requestedAmount: 6,
        },
      ])
      expect(woodPlankRequest?.totalRequestedAmount).toBe(12)
    })

    it('respects the available storage capacity', () => {
      const production = makeProduction(RECIPES.WOODEN_NAIL, 128)
      itemStorage.deposit(Item.WOODEN_NAIL, 920)
      const requests = collectItemRequests([production], itemStorage)
      const trunkRequest = requests.get(Item.WOOD_PLANK)
      expect(trunkRequest?.productions).toEqual([{
        production,
        requestedProducers: 3,
        requestedAmount: 3,
      }])
      expect(trunkRequest?.totalRequestedAmount).toBe(3)
    })

    it('skips productions that do not have all ingredients available', () => {
      itemStorage.withdraw(Item.TREE_BARK, itemStorage.getStoredAmount(Item.TREE_BARK))
      const requests = collectItemRequests([makeProduction(RECIPES.TABLE, 128)], itemStorage)
      expect(requests.size).toBe(0)
    })
  })

  afterEach(() => {
    itemStorage.reset()
  })

  function createItemStorage<I>(initialSettings: ReadonlyMap<I, readonly [number, number]>): ResettableItemStorage<I> {
    for (const [item, [amount, capacity]] of initialSettings) {
      if (amount > capacity) {
        throw new Error(
          `The ${item} is set to invalid amount of ${amount} which is greater than the specified capacity of ` +
          capacity,
        )
      }
      if (amount < 0) {
        throw new Error(
          `The amount of ${item} is set to ${amount}, which is invalid, expected a non-negative number`,
        )
      }
      if (capacity < 0) {
        throw new Error(
          `The capacity of ${item} is set to ${capacity}, which is invalid, expected a non-negative number`,
        )
      }
    }

    const currentContents = new Map(Array.from(initialSettings).map(([item, [amount]]) => [item, amount]))

    return {
      deposit(item: I, amount: number): void {
        if (amount > this.getFreeCapacity(item)) {
          throw new Error(
            `Cannot store ${amount} amount of ${item}, there is only ${this.getFreeCapacity(item)} free capacity for ` +
            'the item',
          )
        }
        currentContents.set(item, this.getStoredAmount(item) + amount)
      },
      getFreeCapacity(item: I): number {
        return Math.max((initialSettings.get(item)?.[1] ?? 0) - this.getStoredAmount(item), 0)
      },
      getStoredAmount(item: I): number {
        return currentContents.get(item) || 0
      },
      withdraw(item: I, amount: number): number {
        if (amount > this.getStoredAmount(item)) {
          throw new Error(
            `Unable to withdraw ${amount} of ${item}, there is only ${this.getStoredAmount(item)} of the item in ` +
            'the storage',
          )
        }

        currentContents.set(item, this.getStoredAmount(item) - amount)
        return amount
      },
      reset(): void {
        currentContents.clear()
        for (const [item, [amount]] of initialSettings) {
          currentContents.set(item, amount)
        }
      },
    }
  }

  function makeProduction<I>(recipe: Recipe<I>, totalProducers: number): RecipeProduction<I> {
    return {
      activeProducers: 0,
      productionProgress: 0,
      recipe,
      totalProducers,
    }
  }
})
