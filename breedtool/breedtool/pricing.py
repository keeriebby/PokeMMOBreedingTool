"""
Costs, computed straight from the tree (no string matching on rendered output).
"""
from collections import Counter
from dataclasses import dataclass
from typing import Optional

from .tree import Gender, ITEM_FOR_TRAIT, NATURE, breeds


@dataclass
class PricingConfig:
    power_item_cost: int = 10_000
    everstone_cost: int = 5_000


def gender_lock_cost(required: Optional[Gender], species) -> Optional[int]:
    """Cost to force `required` gender on a child of `species`.

    Keys off the probability of the *required* gender:
        >= 50% -> 5k,  25% -> 9k,  12.5% -> 21k,  0% / genderless -> None (impossible)
    """
    if required is None:
        return 0
    if species.genderless:
        return None
    p = species.female_ratio if required is Gender.FEMALE else 1.0 - species.female_ratio
    if p <= 0:
        return None
    if p >= 0.5:
        return 5_000
    if p >= 0.25:
        return 9_000
    return 21_000


def cost_report(root, config: PricingConfig) -> dict:
    item_counts = Counter()
    gender_costs = {}      # node_id -> cost, or None if impossible
    gender_total = 0
    impossible = []

    for node in breeds(root):
        for trait in (node.locked_by_parent1, node.locked_by_parent2):
            item_counts[ITEM_FOR_TRAIT[trait]] += 1
        cost = gender_lock_cost(node.required_gender, node.species)
        gender_costs[node.node_id] = cost
        if cost is None:
            impossible.append(node.node_id)
        else:
            gender_total += cost

    everstones = item_counts.get(ITEM_FOR_TRAIT[NATURE], 0)
    power = sum(item_counts.values()) - everstones
    p_cost = power * config.power_item_cost
    e_cost = everstones * config.everstone_cost
    return {
        "power_items_count": power,
        "power_items_cost": p_cost,
        "everstones_count": everstones,
        "everstones_cost": e_cost,
        "gender_lock_cost": gender_total,
        "grand_total": p_cost + e_cost + gender_total,
        "item_counts": dict(item_counts),
        "gender_costs": gender_costs,
        "impossible": impossible,
    }