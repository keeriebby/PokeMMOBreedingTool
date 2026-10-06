"""
Formatting only: turns a tagged tree into plan steps and a shopping list.
All pricing lives in pricing.py.
"""
from collections import Counter

from .tree import ITEM_FOR_TRAIT, NATURE, breeds, leaves

IV_ORDER = ["hp", "atk", "def", "spa", "spd", "spe"]


def format_iv_string(traits) -> str:
    return "/".join("31" if s in traits else "X" for s in IV_ORDER)


def node_label(node, target_name: str, fodder_label: str = None) -> str:
    """Target line shows the target's name; fodder shows e.g. 'Any (Bug)' if fodder_label is given."""
    name = target_name if node.is_target_line else (fodder_label or node.species.name)
    gender = node.required_gender.value if node.required_gender else "Any"
    return f"{name} ({gender})"


def render_plan(root, target_name, nature_name=None, gender_costs=None, fodder_label=None) -> list:
    gender_costs = gender_costs or {}
    # Parents always have fewer traits than their child, so this is a valid build order.
    nodes = sorted(breeds(root), key=lambda n: (len(n.traits), NATURE in n.traits, n.node_id))
    step_of = {n.node_id: i for i, n in enumerate(nodes, 1)}

    steps = []
    for n in nodes:
        p1, p2 = n.parent1, n.parent2
        uses = [step_of[p.node_id] for p in (p1, p2) if not p.is_leaf]
        steps.append({
            "step": step_of[n.node_id],
            "parent_1": node_label(p1, target_name, fodder_label),
            "parent_1_ivs": format_iv_string(p1.traits),
            "parent_1_src": "buy" if p1.is_leaf else f"step {step_of[p1.node_id]}",
            "item_p1": ITEM_FOR_TRAIT[n.locked_by_parent1],
            "parent_2": node_label(p2, target_name, fodder_label),
            "parent_2_ivs": format_iv_string(p2.traits),
            "parent_2_src": "buy" if p2.is_leaf else f"step {step_of[p2.node_id]}",
            "item_p2": ITEM_FOR_TRAIT[n.locked_by_parent2],
            "child_ivs": format_iv_string(n.traits),
            "child_nature": (nature_name or "Locked") if NATURE in n.traits else "Any",
            "child_gender": n.required_gender.value if n.required_gender else "Any",
            "gender_cost": gender_costs.get(n.node_id, 0),   # None = impossible
            "uses_steps": uses,
        })
    return steps


def shopping_list(root, target_name, nature_name=None, fodder_label=None) -> list:
    counts = Counter()
    for leaf in leaves(root):
        has_nature = NATURE in leaf.traits
        nature = (f"Required ({nature_name})" if nature_name else "Required") if has_nature else "Any"
        item = ITEM_FOR_TRAIT.get(leaf.traits[0], "None") if len(root.traits) > 1 else "None"
        name = target_name if leaf.is_target_line else (fodder_label or leaf.species.name)
        gender = leaf.required_gender.value if leaf.required_gender else "Any"
        counts[(name, gender, format_iv_string(leaf.traits), nature, item, leaf.is_target_line)] += 1

    rows = [{"count": c, "species": k[0], "gender": k[1], "ivs": k[2], "nature": k[3],
             "item": k[4], "target_line": k[5]} for k, c in counts.items()]
    rows.sort(key=lambda r: (not r["target_line"], r["species"], r["ivs"]))
    return rows