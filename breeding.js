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

export const NATURES = [
  "Adamant", "Bashful", "Bold", "Brave", "Calm", "Careful", "Docile", "Gentle", "Hardy", "Hasty",
  "Impish", "Jolly", "Lax", "Lonely", "Mild", "Modest", "Naive", "Naughty", "Quiet", "Quirky",
  "Rash", "Relaxed", "Sassy", "Serious", "Timid",
];

export function canonicalNature(str) {
  const t = (str || "").trim();
  if (!t) return null;
  const hit = NATURES.find((n) => n.toLowerCase() === t.toLowerCase());
  if (!hit) throw new Error(`Unknown nature '${t}'. Pick one from the suggestions.`);
  return hit;
}

// "31/x/31/x/31/31" -> ['hp','def','spe',...]. Anything other than 31 means "don't care".
export function parseIVs(str) {
  const parts = String(str || "").split("/").map((p) => p.trim().toLowerCase());
  if (parts.length !== 6) throw new Error("IVs need 6 slots separated by '/', e.g. 31/x/31/x/31/31");
  return IV_STATS.filter((_, i) => parts[i] === "31");
}

export const Gender = { FEMALE: "Female", MALE: "Male" };
const GENDER_TEXT = { Female: "Female ♀", Male: "Male ♂" };
export const genderText = (g) => GENDER_TEXT[g] || "Any";

export const eggGroupName = (g) => EGG_GROUP_DISPLAY[g] || g.charAt(0).toUpperCase() + g.slice(1);

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
    this.owned = null;   // a Pokemon on hand that replaces this node (and its whole subtree)
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

// Structural walk: every node, ignoring anything on hand.
export function allNodesFull(root) {
  const out = [];
  (function walk(node) {
    if (!node.isLeaf) { walk(node.parent1); walk(node.parent2); }
    out.push(node);
  })(root);
  return out;
}

// Visible walk: stops at Pokemon on hand (their subtree isn't needed).
export function allNodes(root) {
  const out = [];
  (function walk(node) {
    if (!node.isLeaf && !node.owned) { walk(node.parent1); walk(node.parent2); }
    out.push(node);
  })(root);
  return out;
}
export const leaves = (root) => allNodes(root).filter((n) => n.isLeaf && !n.owned);
export const breeds = (root) => allNodes(root).filter((n) => !n.isLeaf && !n.owned);
export const ownedNodes = (root) => allNodes(root).filter((n) => n.owned);

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

  // group (optional): force the fodder into one specific egg group
  pickFodder(target, group = null) {
    for (const s of Object.values(this.byId)) {
      if (s.evolvesFromId || s.isBaby || s.genderRate !== 4 || !this.eggGroupCompatible(target, s)) continue;
      if (s.eggGroupsRaw.includes("ditto")) continue;
      if (group && !s.eggGroupsRaw.includes(group)) continue;
      return s;
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
  if (node.owned) {
    const p = node.owned;
    return {
      id: node.nodeId, type: "owned", species: p.name,
      gender: p.isDitto ? "Genderless" : genderText(p.gender),
      ivs: formatIVs(p.traits), nature: p.nature || "Any", item: held,
    };
  }
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
  const src = (p) => (p.owned ? "On hand" : p.isLeaf ? "Buy" : `Step ${stepOf.get(p.nodeId)}`);
  const label = (n) => (n.owned
    ? `${n.owned.name} (${n.owned.isDitto ? "Genderless" : genderText(n.owned.gender)}) · on hand`
    : `${speciesLabel(n, ctx)} (${genderText(n.requiredGender)})`);
  const ivsOf = (n) => formatIVs(n.owned ? n.owned.traits : n.traits);

  return nodes.map((n) => ({
    step: stepOf.get(n.nodeId),
    nodeId: n.nodeId,
    parent_1: label(n.parent1), parent_1_ivs: ivsOf(n.parent1),
    parent_1_src: src(n.parent1), item_p1: ITEM_FOR_TRAIT[n.lockedByParent1],
    parent_2: label(n.parent2), parent_2_ivs: ivsOf(n.parent2),
    parent_2_src: src(n.parent2), item_p2: ITEM_FOR_TRAIT[n.lockedByParent2],
    child_ivs: formatIVs(n.traits),
    child_nature: n.traits.includes(NATURE) ? ctx.natureName || "Locked" : "Any",
    child_gender: genderText(n.requiredGender),
    gender_cost: genderCosts[n.nodeId] ?? null,   // null = impossible
  }));
}


// ======================= Pokemon on hand =======================

// entries: [{ id, species, nature, ivs, gender, qty }] -> one unit per Pokemon, validated.
export function expandOnHand(db, entries) {
  const units = [];
  for (const e of entries) {
    const species = db.find(e.species);
    const isDitto = species.eggGroupsRaw.includes("ditto");
    if (!isDitto) {
      if (!species.canBreed) throw new Error(`${species.name} can't breed.`);
      if (species.genderless) throw new Error(`${species.name} is genderless and can only breed with Ditto, so it can't be used here.`);
      if (e.gender === Gender.FEMALE && species.maleOnly) throw new Error(`${species.name} is male-only.`);
      if (e.gender === Gender.MALE && species.femaleOnly) throw new Error(`${species.name} is female-only.`);
    }
    const nature = canonicalNature(e.nature);
    const traits = parseIVs(e.ivs);
    const qty = Math.max(1, parseInt(e.qty) || 1);
    for (let i = 0; i < qty; i++) {
      units.push({
        unitId: `${e.id}#${i}`, entryId: e.id, species, name: species.name, isDitto,
        gender: isDitto ? null : e.gender, nature, traits, placedNodeId: null,
      });
    }
  }
  return units;
}

// Can this Pokemon stand in for this node (and replace everything beneath it)?
function fits(node, u, rules) {
  if (u.isDitto) {
    // Ditto is genderless and can't be a mother: only a male-parent leaf outside the target line
    if (node.isTargetLine || !node.isLeaf || node.requiredGender !== Gender.MALE) return false;
  } else if (node.requiredGender && u.gender !== node.requiredGender) return false;
  for (const t of node.traits) {
    if (t === NATURE) {
      if (!u.nature || !rules.natureName || u.nature !== rules.natureName) return false;
    } else if (!u.traits.includes(t)) return false;
  }
  if (u.isDitto) return true;
  if (node.isTargetLine) return rules.sameLine(u.species);
  return u.species.canBreed && !u.species.genderless && u.species.eggGroupsRaw.includes(rules.group);
}

// Best-fit, biggest savings first: each Pokemon goes where it removes the most of the tree,
// and where several fit equally, the one with the fewest "wasted" extra IVs is used.
function placeOnHand(root, units, rules) {
  const nodes = allNodesFull(root);
  const size = new Map();
  const desc = new Map();
  (function calc(n) {
    if (n.isLeaf) { size.set(n.nodeId, 1); desc.set(n.nodeId, []); return; }
    calc(n.parent1); calc(n.parent2);
    size.set(n.nodeId, 1 + size.get(n.parent1.nodeId) + size.get(n.parent2.nodeId));
    desc.set(n.nodeId, [n.parent1.nodeId, n.parent2.nodeId, ...desc.get(n.parent1.nodeId), ...desc.get(n.parent2.nodeId)]);
  })(root);

  const pairs = [];
  for (const n of nodes) {
    const need = n.traits.filter((t) => t !== NATURE).length;
    for (const u of units) {
      if (!fits(n, u, rules)) continue;
      const wasted = u.traits.length - need + (u.nature && !n.traits.includes(NATURE) ? 1 : 0);
      pairs.push({ n, u, saving: size.get(n.nodeId), wasted });
    }
  }
  pairs.sort((a, b) => b.saving - a.saving || a.wasted - b.wasted || a.n.nodeId - b.n.nodeId);

  const used = new Set(), blocked = new Set(), taken = new Set();
  for (const { n, u } of pairs) {
    if (used.has(u.unitId) || blocked.has(n.nodeId) || taken.has(n.nodeId)) continue;
    if (desc.get(n.nodeId).some((id) => taken.has(id))) continue;
    n.owned = u;
    u.placedNodeId = n.nodeId;
    used.add(u.unitId);
    taken.add(n.nodeId);
    desc.get(n.nodeId).forEach((id) => blocked.add(id));
  }
}

// A bred fodder Pokemon hatches as its mother's species, so gender-lock prices follow the mother chain.
function propagateSpecies(n, db, hatch, fodder) {
  if (!n.isLeaf && !n.owned) { propagateSpecies(n.parent1, db, hatch, fodder); propagateSpecies(n.parent2, db, hatch, fodder); }
  if (n.isTargetLine) { n.species = hatch; return; }
  if (n.owned) { n.species = n.owned.isDitto ? n.owned.species : db.hatchSpecies(n.owned.species); return; }
  n.species = n.isLeaf ? fodder : n.parent1.species;
}

function attempt(db, o, units) {
  const root = buildTree(o.ivs, o.natureName !== null);
  assignSpecies(root, o.hatch, o.fodder);
  const lineRoot = db.chain(o.target)[0].identifier;
  placeOnHand(root, units, {
    group: o.group, natureName: o.natureName,
    sameLine: (sp) => db.chain(sp)[0].identifier === lineRoot,
  });
  propagateSpecies(root, db, o.hatch, o.fodder);
  const costs = costReport(root, o.config);
  return { root, costs, nodes: allNodes(root).length, buys: leaves(root).length, breedCount: breeds(root).length };
}

// o = { target, ivs: [stats], natureName|null, onHand: [entries], config }
export function buildFullPlan(db, o) {
  const hatch = db.hatchSpecies(o.target);
  const groups = o.target.eggGroupsRaw.filter((g) => g !== "ditto" && g !== "no-eggs");
  const units = expandOnHand(db, o.onHand || []);

  // All non-target Pokemon must share ONE egg group with the target (and so with each other).
  // Try each of the target's groups and keep whichever uses your Pokemon best.
  let best = null, lastErr = null;
  for (const group of groups) {
    let fodder;
    try { fodder = db.pickFodder(o.target, group); } catch (e) { lastErr = e; continue; }
    const args = { ...o, hatch, group, fodder };
    const fresh = units.map((u) => ({ ...u, placedNodeId: null }));
    const result = attempt(db, args, fresh);
    const better = !best || result.nodes < best.result.nodes ||
      (result.nodes === best.result.nodes && result.costs.grand_total < best.result.costs.grand_total);
    if (better) best = { result, group, fodder, units: fresh, args };
  }
  if (!best) throw lastErr || new Error(`No usable egg group found for ${o.target.name}.`);

  const baseline = attempt(db, best.args, []);
  const ctx = {
    targetName: o.target.name, natureName: o.natureName,
    fodderLabel: `Any (${eggGroupName(best.group)})`,
  };

  // Where did each Pokemon end up?
  const steps = renderPlan(best.result.root, ctx, best.result.costs.gender_costs);
  const held = heldItemMap(best.result.root);
  const parentStep = new Map();
  for (const st of steps) {
    const node = allNodes(best.result.root).find((n) => n.nodeId === st.nodeId);
    parentStep.set(node.parent1.nodeId, st.step);
    parentStep.set(node.parent2.nodeId, st.step);
  }
  const placements = best.units.map((u) => {
    if (u.placedNodeId === null) return { unitId: u.unitId, entryId: u.entryId, placed: false, where: "Doesn't fit anywhere in this plan" };
    const step = parentStep.get(u.placedNodeId);
    const item = held.get(u.placedNodeId);
    const where = step === undefined
      ? "Used as your final Pokémon"
      : `${u.isDitto ? "Male parent" : `${u.gender} parent`} in step ${step}${item ? `, holding ${item}` : ""}`;
    return { unitId: u.unitId, entryId: u.entryId, placed: true, where };
  });

  const notes = [`Every Pokémon that isn't ${o.target.name} must be in the ${eggGroupName(best.group)} egg group.`];
  const warnings = speciesWarnings(o.target, hatch, best.fodder);
  if (best.result.costs.impossible.length) warnings.push(`${best.result.costs.impossible.length} breed(s) need a gender this species can't produce.`);

  return {
    root: best.result.root, ctx, costs: best.result.costs, hatch, fodder: best.fodder, group: best.group,
    placements, notes, warnings,
    savings: {
      breeds: baseline.breedCount - best.result.breedCount,
      buys: baseline.buys - best.result.buys,
      cost: baseline.costs.grand_total - best.result.costs.grand_total,
    },
  };
}