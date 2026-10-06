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

// --- ADDED: SpeciesDB and Planner Logic ---

export class SpeciesDB {
  constructor(data) {
    this.byId = {};
    this.index = {};
    const entries = data.species ? data.species : Object.values(data);
    
    for (const e of entries) {
      const s = {
        id: e.id,
        name: e.name || e.identifier.charAt(0).toUpperCase() + e.identifier.slice(1),
        identifier: e.identifier,
        evolvesFromId: e.evolves_from_id || null,
        genderRate: e.gender_rate ?? 4,
        eggGroupsRaw: e.egg_groups || [],
        isBaby: !!e.is_baby,
        get genderless() { return this.genderRate === -1; },
        get femaleRatio() { return this.genderless ? 0 : this.genderRate / 8; },
        get canBreed() { return !this.eggGroupsRaw.includes("no-eggs"); },
        get eggGroups() {
          const dict = { "ground": "Field", "plant": "Grass", "humanshape": "Humanoid", "indeterminate": "Chaos" };
          return this.eggGroupsRaw.map(g => dict[g] || g.charAt(0).toUpperCase() + g.slice(1));
        }
      };
      this.byId[s.id] = s;
      const key = s.identifier.toLowerCase().replace(/[^a-z0-9]/g, "");
      this.index[key] = s;
    }
  }

  find(name) {
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!this.index[key]) throw new Error(`Species '${name}' not found.`);
    return this.index[key];
  }

  chain(species) {
    const out = [species];
    while (out[0].evolvesFromId && this.byId[out[0].evolvesFromId]) {
      out.unshift(this.byId[out[0].evolvesFromId]);
    }
    return out;
  }

  hatchSpecies(species) {
    const c = this.chain(species);
    const incenseBabies = ["azurill", "wynaut", "mantyke", "munchlax", "mime-jr", "happiny", "chingling", "bonsly", "budew"];
    if (c.length > 1 && incenseBabies.includes(c[0].identifier)) return c[1];
    return c[0];
  }

  eggGroupCompatible(a, b) {
    if (!a.canBreed || !b.canBreed) return false;
    if (a.eggGroupsRaw.includes("ditto") || b.eggGroupsRaw.includes("ditto")) return true;
    return a.eggGroupsRaw.some(g => b.eggGroupsRaw.includes(g));
  }

  pickFodder(target) {
    for (const s of Object.values(this.byId)) {
      if (!s.evolvesFromId && !s.isBaby && s.genderRate === 4 && this.eggGroupCompatible(target, s)) {
        return s;
      }
    }
    throw new Error(`No 50/50 fodder species found for ${target.name}.`);
  }
}

export function assignSpecies(node, hatch, fodder, isTarget = true, reqGender = null) {
  node.isTargetLine = isTarget;
  node.requiredGender = reqGender;
  node.species = isTarget ? hatch : fodder;
  
  if (node.parent1) assignSpecies(node.parent1, hatch, fodder, isTarget, Gender.FEMALE);
  if (node.parent2) assignSpecies(node.parent2, hatch, fodder, false, Gender.MALE);
}

export function renderPlan(root, targetName, natureName, genderCosts, fodderLabel) {
  const formatIVs = traits => IV_STATS.map(s => traits.includes(s) ? "31" : "X").join("/");
  const nodeLabel = n => `${n.isTargetLine ? targetName : fodderLabel} (${n.requiredGender || "Any"})`;

  const breedNodes = breeds(root).sort((a, b) => a.traits.length - b.traits.length);
  const stepMap = new Map();
  breedNodes.forEach((n, i) => stepMap.set(n.nodeId, i + 1));

  return breedNodes.map(n => {
    return {
      step: stepMap.get(n.nodeId),
      parent_1: nodeLabel(n.parent1),
      parent_1_ivs: formatIVs(n.parent1.traits),
      parent_1_src: n.parent1.isLeaf ? "Buy" : `Step ${stepMap.get(n.parent1.nodeId)}`,
      item_p1: ITEM_FOR_TRAIT[n.lockedByParent1],
      parent_2: nodeLabel(n.parent2),
      parent_2_ivs: formatIVs(n.parent2.traits),
      parent_2_src: n.parent2.isLeaf ? "Buy" : `Step ${stepMap.get(n.parent2.nodeId)}`,
      item_p2: ITEM_FOR_TRAIT[n.lockedByParent2],
      child_ivs: formatIVs(n.traits),
      child_gender: n.requiredGender || "Any",
      gender_cost: genderCosts[n.nodeId] ?? null
    };
  });
}