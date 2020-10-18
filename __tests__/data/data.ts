import {Recipe} from '../../productionUpdater.js'

export enum Item {
  TREE_TRUNK = 'Item.TREE_TRUNK',
  TREE_BARK = 'Item.TREE_BARK',
  WOOD_PLANK = 'Item.WOOD_PLANK',
  WOODEN_NAIL = 'Item.WOODEN_NAIL',
  TABLE = 'Item.TABLE',
}

type RecipeType = 'TREE_HARVEST' | 'PROCESS_TREE_TRUNK' | 'WOODEN_NAIL' | 'TABLE'

export const RECIPES: {[key in RecipeType]: Recipe<Item>} = {
  TREE_HARVEST: {
    ingredients: [],
    result: [{
      item: Item.TREE_TRUNK,
      amount: 1,
    }],
    productionDuration: 16,
  },
  PROCESS_TREE_TRUNK: {
    ingredients: [{
      item: Item.TREE_TRUNK,
      amount: 1,
    }],
    result: [
      {
        item: Item.WOOD_PLANK,
        amount: 8,
      },
      {
        item: Item.TREE_BARK,
        amount: 16,
      },
    ],
    productionDuration: 4,
  },
  WOODEN_NAIL: {
    ingredients: [{
      item: Item.WOOD_PLANK,
      amount: 1,
    }],
    result: [{
      item: Item.WOODEN_NAIL,
      amount: 24,
    }],
    productionDuration: 1,
  },
  TABLE: {
    ingredients: [
      {
        item: Item.WOOD_PLANK,
        amount: 6,
      },
      {
        item: Item.WOODEN_NAIL,
        amount: 12,
      },
      {
        item: Item.TREE_BARK,
        amount: 4,
      },
    ],
    result: [{
      item: Item.TABLE,
      amount: 1,
    }],
    productionDuration: 16,
  },
}
