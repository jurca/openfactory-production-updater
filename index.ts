import {
  collectItemRequests,
  getGroupedUnsatisfiableMixedItemRequests,
  getSatisfiableMixedItemRequests,
  getSimpleItemRequests,
  ItemRequest,
} from './itemRequestCollector.js'

interface Recipe<I> {
  readonly ingredients: ReadonlyArray<{
    readonly item: I
    readonly amount: number
  }>
  readonly result: ReadonlyArray<{
    readonly item: I
    readonly amount: number
  }>
  readonly productionDuration: number // milliseconds
}

export interface RecipeProduction<I> {
  readonly recipe: Recipe<I>
  readonly totalProducers: number // number of producers configured to execute this recipe
  activeProducers: number // number of producers that obtained the ingredients and are producing
  productionProgress: number // 0 to 1. all producers share the progress to keep things simple(r)
}

interface RecipeProductionUpdateTracker<I> {
  recipeProduction: RecipeProduction<I>
  remainingTimeDelta: number
}

export interface ItemStorage<I> {
  getStoredAmount(item: I): number
  getFreeCapacity(item: I): number
  withdraw(item: I, amount: number): number
  deposit(item: I, amount: number): void
}

export default function update<I>(
  productions: Iterable<RecipeProduction<I>>,
  itemStorage: ItemStorage<I>,
  timeDelta: number,
  debug = false,
): void {
  // Collect the current item requests so that the available items can be provided as evenly as possible
  const itemRequests = collectItemRequests(productions, itemStorage)
  const simpleItemRequests = getSimpleItemRequests(itemRequests)
  const satisfiableMixedRequests = getSatisfiableMixedItemRequests(itemRequests, simpleItemRequests, itemStorage)
  const groupedUnsatisfiableMixedItemRequests = getGroupedUnsatisfiableMixedItemRequests(
    itemRequests,
    simpleItemRequests,
    satisfiableMixedRequests,
  )

  const updateTrackers: RecipeProductionUpdateTracker<I>[] = []
  for (const production of productions) {
    if (production.productionProgress || !production.recipe.ingredients.length) {
      updateTrackers.push({
        recipeProduction: production,
        remainingTimeDelta: timeDelta,
      })
    }
  }

  updateTrackers.push(...processSimpleItemRequests(simpleItemRequests, itemStorage, timeDelta, debug))
  updateTrackers.push(...processSatisfiableMixedItemRequests(satisfiableMixedRequests, itemStorage, timeDelta, debug))

  // Unsatisfiable mixed requests are related to productions that use multiple items, but at least one item cannot be
  // provided in full requested amount to all productions requesting it.
  for (const productionGroup of groupedUnsatisfiableMixedItemRequests) {
    updateTrackers.push(...processUnsatisfiableMixedItemRequestsGroup(productionGroup, itemStorage, timeDelta, debug))
  }

  // TODO: run update capping productionProgress at 1. If it reaches 1, reset it to 0 and store the production results
  // if the store is full, leave it at 1 until the next tick (and store only the part that fits, reducing the
  // activeProducers number?)

  // TODO: find min remaining delta where > 0, use update() to update productions that have remainig delta > 0, repeat
  // until done (keep filtering out productions that cannot have the next batch of items provided to them)
}

function processSimpleItemRequests<I>(
  simpleItemRequests: Map<I, ItemRequest<I>>,
  itemStorage: ItemStorage<I>,
  timeDelta: number,
  debug: boolean,
): RecipeProductionUpdateTracker<I>[] {
  // Simple item requests are item requests related to only a single production that requests only a single item

  const updateTrackers: RecipeProductionUpdateTracker<I>[] = []

  for (const [item, {productions, totalRequestedAmount}] of simpleItemRequests) {
    if (debug) {
      if (productions.length !== 1) {
        throw new Error(
          `Encountered an invalid simple item request - expected 1 related production, found ${productions.length} ` +
          'productions',
        )
      }
      if (productions[0].production.recipe.ingredients.length !== 1) {
        throw new Error(
          'Encountered an invalid simple item request - expected a single production requesting a single item, but ' +
          `the production uses a recipe with ${productions[0].production.recipe.ingredients.length} ingredients`,
        )
      }
      if (productions[0].requestedAmount !== totalRequestedAmount) {
        throw new Error(
          'Encountered an invalid simple item request - expected a single production requesting a single item of the ' +
          `same amount (${productions[0].requestedAmount}) as the total requested amount in the item request ` +
          `(${totalRequestedAmount})`
        )
      }
    }

    const [{production, requestedAmount, requestedProducers}] = productions
    const availableAmount = itemStorage.withdraw(item, requestedAmount)
    if (debug) {
      if (availableAmount !== requestedAmount) {
        throw new Error(
          `Encountered an incosistency in simple item request. Prepared a request requesting ${requestedAmount} ` +
          `amount, but the item storage was able to provide only ${availableAmount}`,
        )
      }
    }
    production.activeProducers = requestedProducers
    updateTrackers.push({
      recipeProduction: production,
      remainingTimeDelta: timeDelta,
    })
  }

  return updateTrackers
}

function processSatisfiableMixedItemRequests<I>(
  satisfiableMixedRequests: Map<I, ItemRequest<I>>,
  itemStorage: ItemStorage<I>,
  timeDelta: number,
  debug: boolean,
): RecipeProductionUpdateTracker<I>[] {
  // Satisfiable mixed requests are item requests by productions that are not simple requests, the productions requests
  // more than one item and all requests can be satisfied

  const updateTrackers: RecipeProductionUpdateTracker<I>[] = []

  const satisfiableMultiIngredientProductions = new Map<
    RecipeProduction<I>,
    {item: I, requestedAmount: number, requestedProducers: number}[]
  >()
  for (const [item, {productions}] of satisfiableMixedRequests) {
    for (const {production, requestedAmount, requestedProducers} of productions) {
      const itemRequests = satisfiableMultiIngredientProductions.get(production) || []
      itemRequests.push({item, requestedAmount, requestedProducers})
      satisfiableMultiIngredientProductions.set(production, itemRequests)
    }
  }
  for (const [production, itemRequests] of satisfiableMultiIngredientProductions) {
    for (const {item, requestedAmount} of itemRequests) {
      const availableAmount = itemStorage.withdraw(item, requestedAmount)
      if (debug) {
        if (availableAmount !== requestedAmount) {
          throw new Error(
            'Encountered an incosistency in satisfiable mixed item request. Prepared a request requesting ' +
            `${requestedAmount} amount, but the item storage was able to provide only ${availableAmount}`,
          )
        }
      }
    }
    production.activeProducers = itemRequests[0].requestedProducers
    updateTrackers.push({
      recipeProduction: production,
      remainingTimeDelta: timeDelta,
    })
  }

  return updateTrackers
}

function processUnsatisfiableMixedItemRequestsGroup<I>(
  unsatisfiableMixedRequestsGroup: Map<I, ItemRequest<I>>,
  itemStorage: ItemStorage<I>,
  timeDelta: number,
  debug: boolean,
): RecipeProductionUpdateTracker<I>[] {
  const updateTrackers: RecipeProductionUpdateTracker<I>[] = []

  const ratio = Math.min(...Array.from(unsatisfiableMixedRequestsGroup).map(
    ([item, request]) => itemStorage.getStoredAmount(item) / request.totalRequestedAmount
  ))

  const productions = new Map<RecipeProduction<I>, {producersToActivate: number}>()
  for (const [, {productions: productionRequests}] of unsatisfiableMixedRequestsGroup) {
    for (const {production, requestedProducers} of productionRequests) {
      productions.set(production, {producersToActivate: Math.floor(requestedProducers * ratio)})
    }
  }

  for (const [production, {producersToActivate}] of productions) {
    for (const {item, amount} of production.recipe.ingredients) {
      const availableAmount = itemStorage.withdraw(item, amount * producersToActivate)
      if (debug) {
        if (availableAmount !== amount * producersToActivate) {
          throw new Error(
            'Encountered an invalid unsatisfiable item request production group, requested ' +
            `${amount * producersToActivate} from storage, but the storage only had ${availableAmount}`
          )
        }
      }
    }
    production.activeProducers = producersToActivate
    updateTrackers.push({
      recipeProduction: production,
      remainingTimeDelta: timeDelta,
    })
  }

  return updateTrackers
}
