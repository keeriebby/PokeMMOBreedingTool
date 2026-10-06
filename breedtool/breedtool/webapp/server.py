"""FastAPI wrapper. All logic lives in breedtool.planner; this only serialises."""
import os
import sys

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from starlette.requests import Request

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from breedtool.planner import build_plan
from breedtool.pricing import PricingConfig
from breedtool.report import format_iv_string, node_label
from breedtool.species_db import PlanError, SpeciesDB, SpeciesNotFound
from breedtool.tree import ITEM_FOR_TRAIT, NATURE

app = FastAPI(title="BreedTool Web GUI")
templates = Jinja2Templates(directory=os.path.join(os.path.dirname(__file__), "templates"))
db = SpeciesDB()


def serialize_node(node, plan, held=None):
    """`held` = the item THIS Pokemon holds while breeding (decided by the breed it feeds into)."""
    label = node_label(node, plan.target.name, plan.fodder_label)
    ivs = format_iv_string(node.traits)
    has_nature = NATURE in node.traits

    if node.is_leaf:
        return {
            "id": node.node_id, "type": "leaf", "species": label, "ivs": ivs,
            "nature": f"Nature: {plan.nature or 'required'}" if has_nature else "No nature lock",
            "item": held or "None",
            "bought": False,
        }
    return {
        "id": node.node_id, "type": "breed", "species": label, "ivs": ivs,
        "nature": (plan.nature or "Nature locked") if has_nature else "Any nature",
        "held_item": held,          # None for the final Pokemon
        "bred": False,
        "parent1": serialize_node(node.parent1, plan, ITEM_FOR_TRAIT[node.locked_by_parent1]),
        "parent2": serialize_node(node.parent2, plan, ITEM_FOR_TRAIT[node.locked_by_parent2]),
    }


@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse(request, "index.html", {})


@app.get("/api/plan")
async def get_breeding_plan(species: str = "gastly", ivs: str = "31/x/31/x/31/31",
                            nature: str = "", fodder: str = "",
                            power: int = 10_000, everstone: int = 5_000):
    config = PricingConfig(power_item_cost=power, everstone_cost=everstone)
    try:
        plan = build_plan(db, species, ivs, nature or None, fodder or None, config)
    except SpeciesNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PlanError as e:
        raise HTTPException(status_code=400, detail=str(e))

    c = plan.cost
    return {
        "target": plan.target.name,
        "hatches_as": plan.hatch.name,
        "fodder": plan.fodder.name,
        "egg_groups": plan.target.egg_groups,
        "warnings": plan.warnings,
        "steps": plan.steps,
        "tree": serialize_node(plan.root, plan),
        "shopping_list": plan.shopping,
        "cost_breakdown": {
            "power_items_count": c["power_items_count"], "power_cost": c["power_items_cost"], "power_unit": power,
            "everstones_count": c["everstones_count"], "everstone_cost": c["everstones_cost"], "everstone_unit": everstone,
            "gender_lock_cost": c["gender_lock_cost"], "total_cost": c["grand_total"],
            "item_counts": c["item_counts"], "impossible_breeds": len(c["impossible"]),
        },
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)