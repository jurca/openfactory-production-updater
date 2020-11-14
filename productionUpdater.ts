import {
  collectItemRequests,
  getGroupedUnsatisfiableMixedItemRequests,
  getSatisfiableMixedItemRequests,
  getSimpleItemRequests,
  ItemRequest,
} from './itemRequestCollector.js'
import {ItemStorage} from './ItemStorage.js'

export interface Recipe<I> {
  readonly ingredients: ReadonlyArray<{
    readonly item: I
    readonly amount: number
  }>
  readonly result: ReadonlyArray<{
    readonly item: I
    readonly amount: number
  }>
  readonly productionDuration: number // Can be any time unit the integrating code uses, e.g. millisecond, tick, ...
}

export interface RecipeProduction<I> {
  readonly recipe: Recipe<I>
  readonly totalProducers: number // number of producers configured to execute this recipe
  activeProducers: number // number of producers that obtained the ingredients and are producing
  productionProgress: number // 0 to recipe.productionDuration. all producers share the progress to keep things simple
}

interface RecipeProductionUpdateTracker<I> {
  recipeProduction: RecipeProduction<I>
  remainingTimeDelta: number
}

export default function update<I>(
  productions: readonly RecipeProduction<I>[],
  itemStorage: ItemStorage<I>,
  timeDelta: number, // Can be any time unit the integrating code uses, e.g. millisecond, tick, ...
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
    if (!production.activeProducers && !production.recipe.ingredients.length) {
      const maxUsefulProducers = Math.min(
        ...production.recipe.result.map(({amount, item}) => Math.floor(itemStorage.getFreeCapacity(item) / amount)),
      )
      production.activeProducers = Math.min(maxUsefulProducers, production.totalProducers)
    }

    if (production.activeProducers) {
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

  updateProductions(updateTrackers, itemStorage)

  let productionsToUpdate = updateTrackers.filter(({recipeProduction, remainingTimeDelta}) => (
    remainingTimeDelta ||
    recipeProduction.productionProgress === recipeProduction.recipe.productionDuration
  ))
  while (
    productionsToUpdate.length &&
    // Check there are productions that are not stalled on output, so that simulation can actually progress
    productionsToUpdate.some(({recipeProduction: {productionProgress, recipe: {productionDuration}}}) =>
      productionProgress < productionDuration,
    ) &&
    productionsToUpdate.some((updateTracker) => updateTracker.remainingTimeDelta)
  ) {
    const minRemainingTimeDelta = Math.min(
      ...productionsToUpdate
        .filter(updateTracker => updateTracker.remainingTimeDelta)
        .map((updateTracker) => updateTracker.remainingTimeDelta),
    )
    update(
      productionsToUpdate.map((updateTracker) => updateTracker.recipeProduction),
      itemStorage,
      minRemainingTimeDelta,
      debug,
    )
    // Note: It is likely that some productions will not be updated (either by not receiving ingredients or not being
    // able to store the results). This is fine, it's just another case when a production can be stalled.
    for (const updateTracker of productionsToUpdate) {
      updateTracker.remainingTimeDelta -= minRemainingTimeDelta
    }
    productionsToUpdate = productionsToUpdate.filter(({recipeProduction, remainingTimeDelta}) => (
      remainingTimeDelta ||
      recipeProduction.productionProgress === recipeProduction.recipe.productionDuration
    ))
  }

  // Give output-stalled productions one last chance to store their outputs
  updateProductions(productionsToUpdate, itemStorage)
}

function updateProductions<I>(updateTrackers: RecipeProductionUpdateTracker<I>[], itemStorage: ItemStorage<I>): void {
  for (const productionUpdate of updateTrackers) {
    const recipeDuration = productionUpdate.recipeProduction.recipe.productionDuration
    const timeToCompletion = recipeDuration - productionUpdate.recipeProduction.productionProgress

    const timeDeltaToApply = Math.min(productionUpdate.remainingTimeDelta, timeToCompletion)
    productionUpdate.recipeProduction.productionProgress += timeDeltaToApply
    productionUpdate.remainingTimeDelta -= timeDeltaToApply

    if (productionUpdate.recipeProduction.productionProgress === recipeDuration) {
      const productionResults = productionUpdate.recipeProduction.recipe.result
      const producersToDepositResults = Math.min(
        productionUpdate.recipeProduction.activeProducers,
        ...productionResults.map(
          ({item, amount}) => Math.floor(itemStorage.getFreeCapacity(item) / amount),
        ),
      )
      if (producersToDepositResults) {
        for (const {item, amount} of productionResults) {
          itemStorage.deposit(item, amount * producersToDepositResults)
        }
        productionUpdate.recipeProduction.activeProducers -= producersToDepositResults
        if (!productionUpdate.recipeProduction.activeProducers) {
          productionUpdate.recipeProduction.productionProgress = 0
        }
      }
    }
  }
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
          `(${totalRequestedAmount})`,
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
    ([item, request]) => itemStorage.getStoredAmount(item) / request.totalRequestedAmount,
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
            `${amount * producersToActivate} from storage, but the storage only had ${availableAmount}`,
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
