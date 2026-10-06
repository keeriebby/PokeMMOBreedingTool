import argparse
import sys

from .planner import build_plan
from .pricing import PricingConfig
from .species_db import PlanError, SpeciesDB
from .tree import breeds, leaves


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="breedtool", description="Plan a minimal, fully-locked PokeMMO breeding tree.")
    p.add_argument("species", help="Target species name, e.g. larvesta")
    p.add_argument("--ivs", required=True, help="Target IVs as HP/Atk/Def/SpA/SpD/Spe, e.g. '31/x/31/x/31/31'")
    p.add_argument("--nature", default=None, help="Desired nature (e.g. Modest). Omit for no nature lock.")
    p.add_argument("--power-item-cost", type=int, default=10_000)
    p.add_argument("--everstone-cost", type=int, default=5_000)
    p.add_argument("--fodder", default=None, help="Non-target breeder species (default: auto-picked 50/50 species in the egg group)")
    p.add_argument("--shopping-only", action="store_true")
    return p


def main(argv=None) -> int:
    args = build_arg_parser().parse_args(argv)
    config = PricingConfig(args.power_item_cost, args.everstone_cost)
    try:
        plan = build_plan(SpeciesDB(), args.species, args.ivs, args.nature, args.fodder, config)
    except (PlanError, FileNotFoundError) as e:
        print(e, file=sys.stderr)
        return 1

    t = plan.target
    print(f"Target: {t.name}  (hatches as {plan.hatch.name})")
    print(f"Egg groups: {', '.join(t.egg_groups) or 'none'}")
    print(f"Fodder: {plan.fodder_label} (priced as a 50/50 species like {plan.fodder.name})")
    print(f"Base Pokemon needed: {len(leaves(plan.root))}")
    print(f"Breeding steps needed: {len(breeds(plan.root))}\n")
    for w in plan.warnings:
        print(f"WARNING: {w}")
    if plan.warnings:
        print()

    if not args.shopping_only:
        for s in plan.steps:
            print(f"Step {s['step']:>2}: Breed {s['parent_1']} [{s['parent_1_ivs']}] ({s['item_p1']}) <{s['parent_1_src']}> "
                  f"+ {s['parent_2']} [{s['parent_2_ivs']}] ({s['item_p2']}) <{s['parent_2_src']}>")
            gc = s["gender_cost"]
            cost_str = " (IMPOSSIBLE)" if gc is None else (f" ({gc:,})" if gc else "")
            print(f"         -> Child IVs: {s['child_ivs']} | Nature: {s['child_nature']} "
                  f"| Gender Lock: {s['child_gender']}{cost_str}")
        print()

    print("=== Shopping list (base Pokemon to acquire) ===")
    for r in plan.shopping:
        print(f"  {r['count']}x {r['species']} ({r['gender']}) {r['ivs']} Nature: {r['nature']} holding {r['item']}")
    print()

    c = plan.cost
    print("=== Item Breakdown ===")
    for name, n in sorted(c["item_counts"].items()):
        print(f"  {n}x {name}")
    print()
    print("=== Cost estimate ===")
    print(f"Power Items used:  {c['power_items_count']:>4}  x {args.power_item_cost:>7,} = {c['power_items_cost']:>10,}")
    print(f"Everstones used:   {c['everstones_count']:>4}  x {args.everstone_cost:>7,} = {c['everstones_cost']:>10,}")
    print(f"Gender-lock costs:                         {c['gender_lock_cost']:>10,}")
    print("-" * 50)
    print(f"TOTAL ESTIMATED COST:                      {c['grand_total']:>10,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())