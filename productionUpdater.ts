import {
  collectItemRequests,
  getGroupedUnsatisfiableMixedItemRequests,
  getSatisfiableMixedItemRequests,
  getSimpleItemRequests,
  ItemRequest,
} from './itemRequestCollector.js'
import {ItemStorage} from './ItemStorage.js'

const SIMULATION_STEP_DURATION = 1

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
): number {
  if (debug) {
    if (timeDelta <= 0 || !Number.isSafeInteger(timeDelta)) {
      throw new RangeError(`The time delta must be a positive safe integer, ${timeDelta} was provided`)
    }
  }

  const timeToSimulate = timeDelta - timeDelta % SIMULATION_STEP_DURATION
  for (let simulatedTime = 0; simulatedTime < timeToSimulate; simulatedTime += SIMULATION_STEP_DURATION) {
    // Activate no-input productions that are idle
    for (const production of productions) {
      if (!production.activeProducers && !production.recipe.ingredients.length) {
        const maxUsefulProducers = Math.min(
          ...production.recipe.result.map(({amount, item}) => Math.floor(itemStorage.getFreeCapacity(item) / amount)),
        )
        production.activeProducers = Math.min(maxUsefulProducers, production.totalProducers)
      }
    }

    // Activate input-requiring productions that are idle
    const itemRequests = collectItemRequests(productions, itemStorage)
    const simpleItemRequests = getSimpleItemRequests(itemRequests)
    processSimpleItemRequests(simpleItemRequests, itemStorage, timeDelta, debug)
    const satisfiableMixedRequests = getSatisfiableMixedItemRequests(itemRequests, simpleItemRequests, itemStorage)
    processSatisfiableMixedItemRequests(satisfiableMixedRequests, itemStorage, timeDelta, debug)
    const groupedUnsatisfiableMixedItemRequests = getGroupedUnsatisfiableMixedItemRequests(
      itemRequests,
      simpleItemRequests,
      satisfiableMixedRequests,
    )
    for (const productionGroup of groupedUnsatisfiableMixedItemRequests) {
      processUnsatisfiableMixedItemRequestsGroup(productionGroup, itemStorage, timeDelta, debug)
    }

    updateProductions(productions, itemStorage)
    const outputStalledProductions = productions.filter(
      production => production.productionProgress === production.recipe.productionDuration,
    )
    updateProductions(outputStalledProductions, itemStorage)
  }

  return timeDelta - timeToSimulate
}

function updateProductions<I>(productions: readonly RecipeProduction<I>[], itemStorage: ItemStorage<I>): void {
  for (const production of productions) {
    if (!production.activeProducers) {
      continue
    }

    const recipeDuration = production.recipe.productionDuration
    const timeToCompletion = recipeDuration - production.productionProgress

    const timeDeltaToApply = Math.min(timeToCompletion, SIMULATION_STEP_DURATION)
    production.productionProgress += timeDeltaToApply

    if (production.productionProgress === recipeDuration) {
      const productionResults = production.recipe.result
      const producersToDepositResults = Math.min(
        production.activeProducers,
        ...productionResults.map(
          ({item, amount}) => Math.floor(itemStorage.getFreeCapacity(item) / amount),
        ),
      )
      if (producersToDepositResults) {
        for (const {item, amount} of productionResults) {
          itemStorage.deposit(item, amount * producersToDepositResults)
        }
        production.activeProducers -= producersToDepositResults
        if (!production.activeProducers) {
          production.productionProgress = 0
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
    if (debug) {
      const availableAmount = itemStorage.withdraw(item, requestedAmount)
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
