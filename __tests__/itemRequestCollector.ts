import {Recipe, RecipeProduction} from '../productionUpdater.js'
import {
  collectItemRequests,
  getGroupedUnsatisfiableMixedItemRequests,
  getSatisfiableMixedItemRequests,
  getSimpleItemRequests,
} from '../itemRequestCollector.js'
import ItemStorageImpl, {ItemStorage} from '../ItemStorage.js'
import StrictItemStorage from '../StrictItemStorage.js'
import {Item, RECIPES} from './data/data.js'

describe('itemRequestCollector', () => {
  type ResettableItemStorage<I> = ItemStorage<I> & {
    reset(): void
  }

  class TestItemStorage<I> extends StrictItemStorage<I> implements ResettableItemStorage<I> {
    constructor(
      private readonly initialSettings: ReadonlyMap<I, readonly [number, number]>,
    ) {
      super(new ItemStorageImpl(new Map(Array.from(initialSettings).map(([item, [, capacity]]) => [item, capacity]))))
      for (const [item, [amount, capacity]] of initialSettings) {
        if (amount > capacity) {
          throw new Error(
            `The ${item} is set to invalid amount of ${amount} which is greater than the specified capacity of ` +
            capacity,
          )
        }
        this.deposit(item, amount)
      }
    }

    public reset(): void {
      for (const item of this.itemCapacitySettings.keys()) {
        const storedAmount = this.getStoredAmount(item)
        if (storedAmount) {
          this.withdraw(item, storedAmount)
        }
      }
      for (const [item, [amount]] of this.initialSettings) {
        this.deposit(item, amount)
      }
    }
  }

  const itemStorage: ResettableItemStorage<Item> = createItemStorage(new Map([
    [Item.TREE_TRUNK, [32, 1024]],
    [Item.TREE_BARK, [64, 1024]],
    [Item.WOOD_PLANK, [6, 1024]],
    [Item.WOODEN_NAIL, [12, 1024]],
    [Item.TABLE, [1000, 1024]],
    [Item.HYDROGEN, [1024, 1024]],
    [Item.OXYGEN, [512, 512]],
    [Item.WATER, [2, 4096]],
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

    it('skips productions that are already in progress', () => {
      const productions = {
        processTreeTrunk: makeProduction(RECIPES.PROCESS_TREE_TRUNK, 128),
        woodenNail: makeProduction(RECIPES.WOODEN_NAIL, 128),
      }
      productions.processTreeTrunk.productionProgress = 1
      const requests = collectItemRequests([productions.processTreeTrunk, productions.woodenNail], itemStorage)
      expect(requests.size).toBe(1)
      expect(requests.keys().next().value).toBe(Item.WOOD_PLANK)
      expect(requests.values().next().value?.productions.length).toBe(1)
      expect(requests.values().next().value?.productions[0].production).toBe(productions.woodenNail)
    })

    it('skips productions that would not be able to store their results', () => {
      const productions = {
        processTreeTrunk: makeProduction(RECIPES.PROCESS_TREE_TRUNK, 128),
        woodenNail: makeProduction(RECIPES.WOODEN_NAIL, 128),
      }
      itemStorage.deposit(Item.WOODEN_NAIL, itemStorage.getFreeCapacity(Item.WOODEN_NAIL))
      const requests = collectItemRequests([productions.processTreeTrunk, productions.woodenNail], itemStorage)
      expect(requests.size).toBe(1)
      expect(requests.keys().next().value).toBe(Item.TREE_TRUNK)
      expect(requests.values().next().value?.productions.length).toBe(1)
      expect(requests.values().next().value?.productions[0].production).toBe(productions.processTreeTrunk)
    })
  })

  describe('getSimpleItemRequests', () => {
    const productions = {
      treeHarvest: makeProduction(RECIPES.TREE_HARVEST, 128),
      processTreeTrunk: makeProduction(RECIPES.PROCESS_TREE_TRUNK, 128),
      woodenNail: makeProduction(RECIPES.WOODEN_NAIL, 128),
      table: makeProduction(RECIPES.TABLE, 128),
      water: makeProduction(RECIPES.WATER, 32),
    }
    const requests = collectItemRequests(Object.values(productions), itemStorage)
    const simpleRequests = getSimpleItemRequests(requests)

    it('returns item requests where item is requested by only a single production', () => {
      expect(simpleRequests.size).toBe(3)
      expect(simpleRequests.has(Item.TREE_TRUNK)).toBe(true)
      expect(simpleRequests.has(Item.HYDROGEN)).toBe(true)
      expect(simpleRequests.has(Item.OXYGEN)).toBe(true)
      expect(simpleRequests.get(Item.TREE_TRUNK)?.productions.length).toBe(1)
      expect(simpleRequests.get(Item.HYDROGEN)?.productions.length).toBe(1)
      expect(simpleRequests.get(Item.OXYGEN)?.productions.length).toBe(1)
    })

    it('returns item requests where each production requests only items not requested by another production', () => {
      for (const request of simpleRequests.values()) {
        const {production} = request.productions[0]
        const {ingredients} = production.recipe
        for (const ingredient of ingredients) {
          expect(simpleRequests.has(ingredient.item)).toBe(true)
          expect(simpleRequests.get(ingredient.item)?.productions[0].production).toBe(production)
        }
      }
    })
  })

  describe('getSatisfiableMixedItemRequests', () => {
    const productions = {
      treeHarvest: makeProduction(RECIPES.TREE_HARVEST, 1),
      processTreeTrunk: makeProduction(RECIPES.PROCESS_TREE_TRUNK, 1),
      woodenNail: makeProduction(RECIPES.WOODEN_NAIL, 1),
      table: makeProduction(RECIPES.TABLE, 1),
      water: makeProduction(RECIPES.WATER, 1),
    }

    it('does not include item request for items requested by multiple productions, but are not satisfiable', () => {
      const requests = collectItemRequests(Object.values(productions), itemStorage)
      const simpleRequests = getSimpleItemRequests(requests)
      const mixedRequests = getSatisfiableMixedItemRequests(requests, simpleRequests, itemStorage)
      expect(mixedRequests.size).toBe(0)
    })

    it('returns item requests for items requested by multiple productions, but are satisfiable', () => {
      itemStorage.deposit(Item.WOOD_PLANK, 1) // to enable both wooden nail and table being made
      const requests = collectItemRequests(Object.values(productions), itemStorage)
      const simpleRequests = getSimpleItemRequests(requests)
      const mixedRequests = getSatisfiableMixedItemRequests(requests, simpleRequests, itemStorage)
      expect(mixedRequests.size).toBe(3)
      expect(mixedRequests.has(Item.WOOD_PLANK)).toBe(true)
      expect(mixedRequests.has(Item.WOODEN_NAIL)).toBe(true)
      expect(mixedRequests.has(Item.TREE_BARK)).toBe(true)
      expect(mixedRequests.get(Item.WOOD_PLANK)?.totalRequestedAmount).toBe(
        RECIPES.WOODEN_NAIL.ingredients[0].amount + RECIPES.TABLE.ingredients[0].amount,
      )
      expect(mixedRequests.get(Item.WOOD_PLANK)?.productions.length).toBe(2)
      const woodenNailProductionRequest = mixedRequests.get(Item.WOOD_PLANK)?.productions.find(
        productionRequest => productionRequest.production === productions.woodenNail,
      )
      const tableProductionRequest = mixedRequests.get(Item.WOOD_PLANK)?.productions.find(
        productionRequest => productionRequest.production === productions.table,
      )
      expect(woodenNailProductionRequest?.requestedProducers).toBe(1)
      expect(woodenNailProductionRequest?.requestedAmount).toBe(RECIPES.WOODEN_NAIL.ingredients[0].amount)
      expect(tableProductionRequest?.requestedProducers).toBe(1)
      expect(tableProductionRequest?.requestedAmount).toBe(RECIPES.TABLE.ingredients[0].amount)
    })
  })

  describe('getGroupedUnsatisfiableMixedItemRequests', () => {
    const productions = {
      treeHarvest: makeProduction(RECIPES.TREE_HARVEST, 1),
      processTreeTrunk: makeProduction(RECIPES.PROCESS_TREE_TRUNK, 1),
      woodenNail: makeProduction(RECIPES.WOODEN_NAIL, 1),
      table: makeProduction(RECIPES.TABLE, 1),
      water: makeProduction(RECIPES.WATER, 1),
    }
    const requests = collectItemRequests(Object.values(productions), itemStorage)
    const simpleRequests = getSimpleItemRequests(requests)
    const mixedRequests = getSatisfiableMixedItemRequests(requests, simpleRequests, itemStorage)
    const unsatisfiableRequests = getGroupedUnsatisfiableMixedItemRequests(requests, simpleRequests, mixedRequests)

    it('returns groups of unsatisfiable mixed requests', () => {
      expect(unsatisfiableRequests.size).toBe(1)
      const [groupRequests] = [...unsatisfiableRequests.values()]
      expect(groupRequests.size).toBe(3)
      expect(groupRequests.has(Item.WOOD_PLANK)).toBe(true)
      expect(groupRequests.has(Item.WOODEN_NAIL)).toBe(true)
      expect(groupRequests.has(Item.TREE_BARK)).toBe(true)
      expect(groupRequests.get(Item.WOOD_PLANK)?.totalRequestedAmount).toBe(
        RECIPES.WOODEN_NAIL.ingredients[0].amount + RECIPES.TABLE.ingredients[0].amount,
      )
      expect(groupRequests.get(Item.WOOD_PLANK)?.productions.length).toBe(2)
    })
  })

  afterEach(() => {
    itemStorage.reset()
  })

  function createItemStorage<I>(initialSettings: ReadonlyMap<I, readonly [number, number]>): ResettableItemStorage<I> {
    return new TestItemStorage(initialSettings)
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
