// Constants & Lookups
export const IV_STATS = ["hp", "atk", "def", "spa", "spd", "spe"];
export const STAT_LABEL = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };
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

export const Gender = { FEMALE: "Female", MALE: "Male" };
const GENDER_TEXT = { Female: "Female ♀", Male: "Male ♂" };
export const genderText = (g) => GENDER_TEXT[g] || "Any";

const EGG_GROUP_DISPLAY = {
  ground: "Field", plant: "Grass", water1: "Water A", water2: "Water B", water3: "Water C",
  humanshape: "Humanoid", "no-eggs": "Undiscovered", monster: "Monster", dragon: "Dragon",
  bug: "Bug", flying: "Flying", fairy: "Fairy", mineral: "Mineral", indeterminate: "Chaos", ditto: "Ditto",
};

// Babies that only hatch with incense (the egg hatches as the next stage instead)
const INCENSE_BABIES = ["azurill", "wynaut", "mantyke", "munchlax", "mime-jr", "happiny", "chingling", "bonsly", "budew"];

// TreeNode Data Structure
export class TreeNode {
  constructor(traits, options = {}) {
    this.traits = traits;
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
  get isLeaf() { return this.parent1 === null; }
  traitString() { return IV_STATS.map((s) => (this.traits.includes(s) ? "31" : "x")).join("/"); }
}

function split(traits) {
  const a = traits[traits.length - 1];
  const b = traits[traits.length - 2];
  const overlap = traits.slice(0, -2);
  return { parent1Traits: [...overlap, a], parent2Traits: [...overlap, b], locked1: a, locked2: b };
}

function buildInternal(traits, counter) {
  if (traits.length === 1) {
    counter.value += 1;
    return new TreeNode(traits, { generation: 0, nodeId: counter.value });
  }
  const { parent1Traits, parent2Traits, locked1, locked2 } = split(traits);
  const parent1 = buildInternal(parent1Traits, counter);
  const parent2 = buildInternal(parent2Traits, counter);
  counter.value += 1;
  return new TreeNode(traits, {
    parent1, parent2, lockedByParent1: locked1, lockedByParent2: locked2,
    shared: traits.slice(0, -2),
    generation: Math.max(parent1.generation, parent2.generation) + 1,
    nodeId: counter.value,
  });
}

export function buildTree(ivStatsWanted, wantNature) {
  const wanted = IV_STATS.filter((stat) => ivStatsWanted.includes(stat));
  if (wanted.length === 0 && !wantNature) throw new Error("Nothing requested: pick at least one IV stat or a nature.");
  return buildInternal(wantNature ? [...wanted, NATURE] : wanted, { value: 0 });
}

export function allNodes(root) {
  const out = [];
  (function walk(node) {
    if (!node.isLeaf) { walk(node.parent1); walk(node.parent2); }
    out.push(node);
  })(root);
  return out;
}
export const leaves = (root) => allNodes(root).filter((n) => n.isLeaf);
export const breeds = (root) => allNodes(root).filter((n) => !n.isLeaf);

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
  const p = required === Gender.FEMALE ? species.femaleRatio : 1.0 - species.femaleRatio;
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
    if (cost === null) impossible.push(node.nodeId); else genderTotal += cost;
  }

  const everstones = itemCounts[ITEM_FOR_TRAIT[NATURE]] || 0;
  const power = Object.values(itemCounts).reduce((s, c) => s + c, 0) - everstones;
  const pCost = power * config.powerItemCost;
  const eCost = everstones * config.everstoneCost;

  return {
    power_items_count: power, power_items_cost: pCost,
    everstones_count: everstones, everstones_cost: eCost,
    gender_lock_cost: genderTotal, grand_total: pCost + eCost + genderTotal,
    item_counts: itemCounts, gender_costs: genderCosts, impossible,
  };
}

// SpeciesDB
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
        generation: e.generation ?? 0,
        evolvesFromId: e.evolves_from_id || null,
        genderRate: e.gender_rate ?? 4,
        eggGroupsRaw: e.egg_groups || [],
        isBaby: !!e.is_baby,
        get genderless() { return this.genderRate === -1; },
        get femaleRatio() { return this.genderless ? 0 : this.genderRate / 8; },
        get maleOnly() { return this.genderRate === 0; },
        get femaleOnly() { return this.genderRate === 8; },
        get canBreed() { return !this.eggGroupsRaw.includes("no-eggs"); },
        get eggGroups() {
          return this.eggGroupsRaw.map((g) => EGG_GROUP_DISPLAY[g] || g.charAt(0).toUpperCase() + g.slice(1));
        },
      };
      this.byId[s.id] = s;
      this.index[s.identifier.toLowerCase().replace(/[^a-z0-9]/g, "")] = s;
    }
    for (const s of Object.values(this.byId)) {
      const nameKey = s.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!this.index[nameKey]) this.index[nameKey] = s;
    }
  }

  // Names for the autocomplete list (breedable species only)
  names() {
    return Object.values(this.byId).filter((s) => s.canBreed).map((s) => s.name).sort();
  }

  find(name) {
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!this.index[key]) throw new Error(`Species '${name}' not found.`);
    return this.index[key];
  }

  chain(species) {
    const out = [species];
    while (out[0].evolvesFromId && this.byId[out[0].evolvesFromId]) out.unshift(this.byId[out[0].evolvesFromId]);
    return out;
  }

  hatchSpecies(species) {
    const c = this.chain(species);
    if (c.length > 1 && INCENSE_BABIES.includes(c[0].identifier)) return c[1];
    return c[0];
  }

  eggGroupCompatible(a, b) {
    if (!a.canBreed || !b.canBreed) return false;
    if (a.eggGroupsRaw.includes("ditto") || b.eggGroupsRaw.includes("ditto")) return true;
    return a.eggGroupsRaw.some((g) => b.eggGroupsRaw.includes(g));
  }

  pickFodder(target) {
    for (const s of Object.values(this.byId)) {
      if (!s.evolvesFromId && !s.isBaby && s.genderRate === 4 && this.eggGroupCompatible(target, s)) return s;
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

export function speciesWarnings(target, hatch, fodder) {
  const w = [];
  if (target.genderless || target.maleOnly) {
    w.push(`${target.name} can't be a mother, so the female target-line breeds are impossible (it needs a Ditto-based tree, which isn't supported).`);
  } else if (target.femaleOnly) {
    w.push(`${target.name} is female-only: every breed needs a male from another species in its egg group.`);
  } else if (target.femaleRatio < 0.5) {
    w.push(`${target.name} is only ${+(target.femaleRatio * 100).toFixed(1)}% female: every female target-line breed costs ${genderLockCost(Gender.FEMALE, hatch).toLocaleString()} to gender-lock.`);
  }
  if (hatch.identifier !== target.identifier) {
    w.push(hatch.isBaby
      ? `Eggs from ${target.name} hatch as baby ${hatch.name} (no incense needed), so each one must be evolved.`
      : `Eggs from ${target.name} hatch as ${hatch.name}, which must be evolved.`);
  }
  return w;
}

// ---- Presentation helpers (read the tree directly; no guessing) ----

export const formatIVs = (traits) => IV_STATS.map((s) => (traits.includes(s) ? "31" : "X")).join("/");

// nodeId -> the item THAT Pokemon holds while breeding (decided by the breed it feeds into)
export function heldItemMap(root) {
  const m = new Map();
  for (const n of breeds(root)) {
    m.set(n.parent1.nodeId, ITEM_FOR_TRAIT[n.lockedByParent1]);
    m.set(n.parent2.nodeId, ITEM_FOR_TRAIT[n.lockedByParent2]);
  }
  return m;
}

// ctx = { targetName, fodderLabel, natureName }
const speciesLabel = (n, ctx) => (n.isTargetLine ? ctx.targetName : ctx.fodderLabel);
const natureLabel = (n, ctx) => (n.traits.includes(NATURE) ? ctx.natureName || "Required" : "Any");

export function serializeTree(node, ctx, held = null) {
  const base = {
    id: node.nodeId,
    species: speciesLabel(node, ctx),
    gender: genderText(node.requiredGender),
    ivs: formatIVs(node.traits),
    nature: natureLabel(node, ctx),
  };
  if (node.isLeaf) return { ...base, type: "leaf", item: held || "None", bought: false };
  return {
    ...base, type: "breed", held_item: held, bred: false,
    parent1: serializeTree(node.parent1, ctx, ITEM_FOR_TRAIT[node.lockedByParent1]),
    parent2: serializeTree(node.parent2, ctx, ITEM_FOR_TRAIT[node.lockedByParent2]),
  };
}

export function buildShoppingList(root, ctx) {
  const held = heldItemMap(root);
  const groups = new Map();
  for (const leaf of leaves(root)) {
    const row = {
      species: speciesLabel(leaf, ctx),
      gender: genderText(leaf.requiredGender),
      ivs: formatIVs(leaf.traits),
      nature: leaf.traits.includes(NATURE) ? (ctx.natureName ? `Required (${ctx.natureName})` : "Required") : "Any",
      item: held.get(leaf.nodeId) || "None",
      targetLine: leaf.isTargetLine,
    };
    const key = [row.species, row.gender, row.ivs, row.nature, row.item].join("|");
    if (groups.has(key)) groups.get(key).count++; else groups.set(key, { ...row, count: 1 });
  }
  return [...groups.values()].sort((a, b) => (b.targetLine - a.targetLine) || a.ivs.localeCompare(b.ivs));
}

export function renderPlan(root, ctx, genderCosts) {
  // Parents always have fewer traits than their child, so this is a valid build order.
  const nodes = breeds(root).sort((a, b) =>
    a.traits.length - b.traits.length ||
    (a.traits.includes(NATURE) - b.traits.includes(NATURE)) || a.nodeId - b.nodeId);
  const stepOf = new Map(nodes.map((n, i) => [n.nodeId, i + 1]));
  const src = (p) => (p.isLeaf ? "Buy" : `Step ${stepOf.get(p.nodeId)}`);
  const label = (n) => `${speciesLabel(n, ctx)} (${genderText(n.requiredGender)})`;

  return nodes.map((n) => ({
    step: stepOf.get(n.nodeId),
    nodeId: n.nodeId,
    parent_1: label(n.parent1), parent_1_ivs: formatIVs(n.parent1.traits),
    parent_1_src: src(n.parent1), item_p1: ITEM_FOR_TRAIT[n.lockedByParent1],
    parent_2: label(n.parent2), parent_2_ivs: formatIVs(n.parent2.traits),
    parent_2_src: src(n.parent2), item_p2: ITEM_FOR_TRAIT[n.lockedByParent2],
    child_ivs: formatIVs(n.traits),
    child_nature: n.traits.includes(NATURE) ? ctx.natureName || "Locked" : "Any",
    child_gender: genderText(n.requiredGender),
    gender_cost: genderCosts[n.nodeId] ?? null,   // null = impossible
  }));
}