import {ItemStorage, RecipeProduction} from './index'

export interface ItemRequest<I> {
  readonly productions: {
    readonly production: RecipeProduction<I>
    readonly requestedAmount: number
    readonly requestedProducers: number
  }[]
  totalRequestedAmount: number
}

export function collectItemRequests<I>(
  productions: Iterable<RecipeProduction<I>>,
  itemStorage: ItemStorage<I>,
): Map<I, ItemRequest<I>> {
  const requestedItems = new Map<I, ItemRequest<I>>()
  for (const production of productions) {
    if (!production.productionProgress) {
      const {recipe: {ingredients, result}} = production
      const maxSustainableProducers = Math.min(
        ...ingredients.map(({item, amount}) => Math.floor(itemStorage.getStoredAmount(item) / amount)),
      )
      const maxResultHandleableProducers = Math.min(
        ...result.map(({item, amount}) => Math.floor(itemStorage.getFreeCapacity(item) / amount)),
      )
      const maxSafeProducers = Math.min(
        production.totalProducers,
        maxSustainableProducers,
        maxResultHandleableProducers,
      )

      if (!maxSafeProducers) {
        continue
      }

      for (const ingredient of ingredients) {
        let itemRequest = requestedItems.get(ingredient.item)
        if (!itemRequest) {
          itemRequest = {
            productions: [],
            totalRequestedAmount: 0,
          }
          requestedItems.set(ingredient.item, itemRequest)
        }

        const requestedAmount = ingredient.amount * maxSafeProducers
        itemRequest.productions.push({
          production,
          requestedAmount,
          requestedProducers: maxSafeProducers,
        })
        itemRequest.totalRequestedAmount += requestedAmount
      }
    }
  }
  return requestedItems
}

export function getSimpleItemRequests<I>(allItemRequests: ReadonlyMap<I, ItemRequest<I>>): Map<I, ItemRequest<I>> {
  // Items that are requested by only one production, that requests only the types of items that are requested only by
  // the same production, are easy to provide.

  const simpleRequests = new Map<I, ItemRequest<I>>()

  for (const [item, itemRequest] of allItemRequests) {
    if (itemRequest.productions.length === 1) {
      const currentProduction = itemRequest.productions[0].production
      const allIngredientsAreRequestedByByTheSameProduction = currentProduction.recipe.ingredients.every(({item}) => {
        const otherItemRequest = allItemRequests.get(item)
        return (
          otherItemRequest &&
          otherItemRequest.productions.length === 1 &&
          otherItemRequest.productions[0].production === currentProduction
        )
      })
      if (allIngredientsAreRequestedByByTheSameProduction) {
        simpleRequests.set(item, itemRequest)
      }
    }
  }

  return simpleRequests
}

export function getSatisfiableMixedItemRequests<I>(
  allItemRequests: ReadonlyMap<I, ItemRequest<I>>,
  simpleItemRequests: ReadonlyMap<I, ItemRequest<I>>,
  itemStorage: ItemStorage<I>,
): Map<I, ItemRequest<I>> {
  const satisfiableMixedRequests = new Map<I, ItemRequest<I>>()

  for (const [item, itemRequest] of allItemRequests) {
    if (!simpleItemRequests.has(item)) {
      const areAllProductionsSatisfiable = itemRequest.productions.every((productionRequest) => {
        return productionRequest.production.recipe.ingredients.every((ingredient) => {
          const ingredientRequest = allItemRequests.get(ingredient.item)
          return (
            ingredientRequest &&
            itemStorage.getStoredAmount(ingredient.item) >= ingredientRequest.totalRequestedAmount
          )
        })
      })
      if (areAllProductionsSatisfiable) {
        satisfiableMixedRequests.set(item, itemRequest)
      }
    }
  }

  return satisfiableMixedRequests
}

export function getGroupedUnsatisfiableMixedItemRequests<I>(
  allItemRequests: ReadonlyMap<I, ItemRequest<I>>,
  simpleItemRequests: ReadonlyMap<I, ItemRequest<I>>,
  satisfiableMixedItemRequests: ReadonlyMap<I, ItemRequest<I>>,
): Set<Map<I, ItemRequest<I>>> {
  const unsatisfiableMixedRequests = new Map<I, ItemRequest<I>>(
    Array
      .from(allItemRequests)
      .filter(([item]) => !simpleItemRequests.has(item) && !satisfiableMixedItemRequests.has(item))
  )

  const groupedRequests = new Set<Map<I, ItemRequest<I>>>()

  while (unsatisfiableMixedRequests.size) {
    const iteratorStep = unsatisfiableMixedRequests.entries().next()
    if (iteratorStep.done) {
      break
    }

    const [item] = iteratorStep.value
    const groupItems = new Set<I>([item])
    do {
      let addedItems = 0

      // We are going to modify the set while iterating, so, let's make a copy first
      for (const knownItem of Array.from(groupItems)) {
        const request = unsatisfiableMixedRequests.get(knownItem)
        if (request) {
          for (const {production: {recipe: {ingredients}}} of request.productions) {
            for (const {item} of ingredients) {
              if (!groupItems.has(item)) {
                groupItems.add(item)
                addedItems++
              }
            }
          }
        }
      }

      if (!addedItems) {
        break
      }
    } while (true) // eslint-disable-line no-constant-condition

    const group = new Map<I, ItemRequest<I>>()
    for (const item of groupItems) {
      const request = unsatisfiableMixedRequests.get(item)
      if (request) {
        group.set(item, request)
        unsatisfiableMixedRequests.delete(item)
      }
    }
    groupedRequests.add(group)
  }

  return groupedRequests
}
