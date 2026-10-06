// Constants & Lookups
export const IV_STATS = ["hp", "atk", "def", "spa", "spd", "spe"];
export const STAT_LABEL = {
  hp: "HP",
  atk: "Atk",
  def: "Def",
  spa: "SpA",
  spd: "SpD",
  spe: "Spe",
};
export const NATURE = "nature";

export const ITEM_FOR_TRAIT = {
  hp: "Power Weight",
  atk: "Power Bracer",
  def: "Power Belt",
  spa: "Power Lens",
  spd: "Power Band",
  spe: "Power Anklet",
  [NATURE]: "Everstone",
};

export const Gender = {
  FEMALE: "Female",
  MALE: "Male",
};

// TreeNode Data Structure
export class TreeNode {
  constructor(traits, options = {}) {
    this.traits = traits; // Array of trait strings
    this.parent1 = options.parent1 || null;
    this.parent2 = options.parent2 || null;
    this.lockedByParent1 = options.lockedByParent1 || null;
    this.lockedByParent2 = options.lockedByParent2 || null;
    this.shared = options.shared || [];
    this.nodeId = options.nodeId || 0;
    this.generation = options.generation || 0;
    this.isTargetLine = options.isTargetLine || false;
    this.requiredGender = options.requiredGender || null;
    this.species = options.species || null;
  }

  get isLeaf() {
    return this.parent1 === null;
  }

  traitString() {
    const parts = IV_STATS.map((stat) =>
      this.traits.includes(stat) ? "31" : "x"
    );
    return parts.join("/");
  }
}

// Internal Helper Functions
function split(traits) {
  const a = traits[traits.length - 1];
  const b = traits[traits.length - 2];
  const overlap = traits.slice(0, -2);
  const parent1Traits = [...overlap, a];
  const parent2Traits = [...overlap, b];
  return { parent1Traits, parent2Traits, locked1: a, locked2: b };
}

function buildInternal(traits, counter) {
  if (traits.length === 1) {
    counter.value += 1;
    return new TreeNode(traits, {
      generation: 0,
      nodeId: counter.value,
    });
  }

  const { parent1Traits, parent2Traits, locked1, locked2 } = split(traits);
  const parent1 = buildInternal(parent1Traits, counter);
  const parent2 = buildInternal(parent2Traits, counter);
  const overlap = traits.slice(0, -2);

  counter.value += 1;
  return new TreeNode(traits, {
    parent1,
    parent2,
    lockedByParent1: locked1,
    lockedByParent2: locked2,
    shared: overlap,
    generation: Math.max(parent1.generation, parent2.generation) + 1,
    nodeId: counter.value,
  });
}

// Public Tree Functions
export function buildTree(ivStatsWanted, wantNature) {
  const wanted = IV_STATS.filter((stat) => ivStatsWanted.includes(stat));
  if (wanted.length === 0 && !wantNature) {
    throw new Error(
      "Nothing requested: pick at least one IV stat or a nature."
    );
  }

  const traits = wantNature ? [...wanted, NATURE] : wanted;
  const counter = { value: 0 };
  return buildInternal(traits, counter);
}

export function allNodes(root) {
  const out = [];
  function walk(node) {
    if (!node.isLeaf) {
      walk(node.parent1);
      walk(node.parent2);
    }
    out.push(node);
  }
  walk(root);
  return out;
}

export function leaves(root) {
  return allNodes(root).filter((n) => n.isLeaf);
}

export function breeds(root) {
  return allNodes(root).filter((n) => !n.isLeaf);
}

// Pricing Logic
export class PricingConfig {
  constructor(powerItemCost = 10000, everstoneCost = 5000) {
    this.powerItemCost = powerItemCost;
    this.everstoneCost = everstoneCost;
  }
}

export function genderLockCost(required, species) {
  if (!required) return 0;
  if (!species || species.genderless) return null;

  const p =
    required === Gender.FEMALE
      ? species.female_ratio
      : 1.0 - species.female_ratio;

  if (p <= 0) return null;
  if (p >= 0.5) return 5000;
  if (p >= 0.25) return 9000;
  return 21000;
}

export function costReport(root, config = new PricingConfig()) {
  const itemCounts = {};
  const genderCosts = {};
  let genderTotal = 0;
  const impossible = [];

  for (const node of breeds(root)) {
    for (const trait of [node.lockedByParent1, node.lockedByParent2]) {
      const itemName = ITEM_FOR_TRAIT[trait];
      itemCounts[itemName] = (itemCounts[itemName] || 0) + 1;
    }

    const cost = genderLockCost(node.requiredGender, node.species);
    genderCosts[node.nodeId] = cost;

    if (cost === null) {
      impossible.push(node.nodeId);
    } else {
      genderTotal += cost;
    }
  }

  const everstoneName = ITEM_FOR_TRAIT[NATURE];
  const everstones = itemCounts[everstoneName] || 0;
  const totalItems = Object.values(itemCounts).reduce(
    (sum, count) => sum + count,
    0
  );
  const power = totalItems - everstones;

  const pCost = power * config.powerItemCost;
  const eCost = everstones * config.everstoneCost;

  return {
    power_items_count: power,
    power_items_cost: pCost,
    everstones_count: everstones,
    everstones_cost: eCost,
    gender_lock_cost: genderTotal,
    grand_total: pCost + eCost + genderTotal,
    item_counts: itemCounts,
    gender_costs: genderCosts,
    impossible: impossible,
  };
}