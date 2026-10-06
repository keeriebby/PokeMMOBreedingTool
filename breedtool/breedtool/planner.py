"""
One entry point used by both the CLI and the web API, so they can't disagree.
"""
from dataclasses import dataclass, field
from typing import List, Optional

from .pricing import PricingConfig, cost_report, gender_lock_cost
from .report import render_plan, shopping_list
from .species_db import PlanError, Species, SpeciesDB
from .tree import IV_STATS, Gender, TreeNode, build_tree

DONT_CARE = {"x", "-", ".", "_", "0", "no", "none"}


def parse_target(s: str) -> List[str]:
    parts = [p.strip().lower() for p in s.split("/")]
    if len(parts) != 6:
        raise PlanError("IV target must have exactly 6 slots separated by '/', e.g. 31/x/31/x/31/31")
    return [stat for stat, val in zip(IV_STATS, parts) if val not in DONT_CARE]


def assign_species(root: TreeNode, hatch: Species, fodder: Species) -> None:
    """Target line = the parent1 chain (females, so the child hatches as the target).
    Every parent2 branch is a male from the fodder species; its own mothers are fodder females."""
    def tag(n, is_target, gender):
        n.is_target_line = is_target
        n.required_gender = gender
        n.species = hatch if is_target else fodder
        if n.parent1:
            tag(n.parent1, is_target, Gender.FEMALE)
        if n.parent2:
            tag(n.parent2, False, Gender.MALE)
    tag(root, True, None)


def species_warnings(target: Species, hatch: Species, fodder: Species) -> List[str]:
    w = []
    if target.genderless or target.male_only:
        w.append(f"{target.name} can't be a mother, so the female target-line breeds are impossible. "
                 f"It needs a Ditto-based tree, which this planner doesn't generate.")
    elif target.female_only:
        w.append(f"{target.name} is female-only: every breed needs a male from another species in its egg group.")
    elif target.female_ratio < 0.5:
        pct = target.female_ratio * 100
        cost = gender_lock_cost(Gender.FEMALE, hatch)
        w.append(f"{target.name} is only {pct:g}% female: every female target-line breed costs {cost:,} to gender-lock.")
    if hatch.identifier != target.identifier:
        if hatch.is_baby:
            w.append(f"Eggs from {target.name} hatch as baby {hatch.name} (no incense needed), so each one must be evolved.")
        else:
            w.append(f"Eggs from {target.name} hatch as {hatch.name}, which must be evolved.")
    if fodder.gender_rate != 4:
        w.append(f"Fodder species {fodder.name} isn't 50/50, so its gender locks may cost more.")
    return w


@dataclass
class Plan:
    target: Species
    hatch: Species
    fodder: Species
    nature: Optional[str]
    root: TreeNode
    steps: list
    shopping: list
    cost: dict
    fodder_label: str = ""
    warnings: List[str] = field(default_factory=list)


def build_plan(db: SpeciesDB, species: str, ivs: str, nature: Optional[str] = None,
               fodder: Optional[str] = None, config: Optional[PricingConfig] = None) -> Plan:
    config = config or PricingConfig()
    target = db.find(species)
    if not target.can_breed:
        raise PlanError(f"{target.name} is in the Undiscovered egg group and can't be bred.")

    wanted = parse_target(ivs)
    nature = nature if nature and nature.lower() not in ("none", "") else None
    root = build_tree(wanted, nature is not None)

    hatch = db.hatch_species(target)
    fodder_sp = db.find(fodder) if fodder else db.pick_fodder(target)
    db.check_fodder(target, fodder_sp)

    assign_species(root, hatch, fodder_sp)
    cost = cost_report(root, config)
    warnings = species_warnings(target, hatch, fodder_sp)
    if cost["impossible"]:
        warnings.append(f"{len(cost['impossible'])} breed(s) need a gender this species can't produce.")

    # Shown instead of a species name; fodder_sp is only used for pricing.
    fodder_label = f"Any ({'/'.join(target.egg_groups)})"
    return Plan(
        target=target, hatch=hatch, fodder=fodder_sp, nature=nature, root=root,
        steps=render_plan(root, target.name, nature, cost["gender_costs"], fodder_label),
        shopping=shopping_list(root, target.name, nature, fodder_label),
        cost=cost, fodder_label=fodder_label, warnings=warnings,
    )