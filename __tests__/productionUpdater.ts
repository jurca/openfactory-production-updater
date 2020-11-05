import updateProduction, {Recipe, RecipeProduction} from '../productionUpdater.js'
import {Item, RECIPES} from './data/data.js'
import ItemStorageImpl, {ItemStorage} from '../ItemStorage.js'
import StrictItemStorage from '../StrictItemStorage.js'

describe('production updater', () => {
  const DEFAULT_STORAGE_STATE: ReadonlyMap<Item, {readonly amount: number, readonly capacity: number}> = new Map([
    [Item.TREE_TRUNK, {amount: 32, capacity: 1024}],
    [Item.TREE_BARK, {amount: 64, capacity: 1024}],
    [Item.WOOD_PLANK, {amount: 6, capacity: 1024}],
    [Item.WOODEN_NAIL, {amount: 12, capacity: 1024}],
    [Item.TABLE, {amount: 1000, capacity: 1024}],
    [Item.HYDROGEN, {amount: 1024, capacity: 1024}],
    [Item.OXYGEN, {amount: 512, capacity: 512}],
    [Item.WATER, {amount: 2, capacity: 4096}],
  ])

  let storage: ItemStorage<Item> = new ItemStorageImpl(new Map())

  const productions: ReadonlyMap<Recipe<Item>, RecipeProduction<Item>> = new Map([
    [RECIPES.TREE_HARVEST, makeProduction(RECIPES.TREE_HARVEST, 4)],
  ])

  beforeEach(() => {
    // Reset storage
    storage = new StrictItemStorage(new ItemStorageImpl(new Map(Array.from(DEFAULT_STORAGE_STATE).map(
      ([item, {capacity}]) => [item, capacity],
    ))))
    for (const [item, {amount}] of DEFAULT_STORAGE_STATE) {
      storage.deposit(item, amount)
    }

    // Reset productions
    for (const production of productions.values()) {
      production.activeProducers = 0
      production.productionProgress = 0
    }
  })

  it('udpates the progress of no-ingredient productions', () => {
    runProductionUpdate(1)
    const treeHarvestProduction = productions.get(RECIPES.TREE_HARVEST)
    expect(treeHarvestProduction?.activeProducers).toBe(treeHarvestProduction?.totalProducers)
    expect(treeHarvestProduction?.productionProgress).toBe(1)
  })

  it('stores the result of no-ingredient productions when they complete their cycle', () => {
    const preCompletionTreeTrunksCount = storage.getStoredAmount(Item.TREE_TRUNK)
    runProductionUpdate(RECIPES.TREE_HARVEST.productionDuration - 1)
    expect(storage.getStoredAmount(Item.TREE_TRUNK)).toBe(preCompletionTreeTrunksCount)
    const activeProducers = productions.get(RECIPES.TREE_HARVEST)?.activeProducers ?? 0
    expect(activeProducers).toBeGreaterThan(0)
    expect(activeProducers).toBeLessThanOrEqual(productions.get(RECIPES.TREE_HARVEST)?.totalProducers ?? 0)
    runProductionUpdate(1)
    expect(storage.getStoredAmount(Item.TREE_TRUNK)).toBe(
      preCompletionTreeTrunksCount + RECIPES.TREE_HARVEST.result[0].amount * activeProducers,
    )
    expect(productions.get(RECIPES.TREE_HARVEST)?.productionProgress).toBe(0)
    expect(productions.get(RECIPES.TREE_HARVEST)?.activeProducers).toBe(0)
  })

  it('continues the production that is already in progress', () => {
    runProductionUpdate(1)
    expect(productions.get(RECIPES.TREE_HARVEST)?.productionProgress).toBe(1)
    runProductionUpdate(1)
    expect(productions.get(RECIPES.TREE_HARVEST)?.productionProgress).toBe(2)
    runProductionUpdate(1)
    expect(productions.get(RECIPES.TREE_HARVEST)?.productionProgress).toBe(3)
  })

  function runProductionUpdate(timeDelta: number): void {
    updateProduction([...productions.values()], storage, timeDelta, true)
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
