# breedtool

A PokeMMO breeding-tree planner. Give it a species, a nature, and the
IVs you want locked in, and it builds the minimal *deterministic*
breeding tree (no RNG-and-hope), tells you exactly which Pokemon to
breed with which items at every step, and estimates the total cost.

## The rule this is built on

A parent can hold exactly **one** item per breed (a Power Item locking
one IV, or an Everstone locking Nature). Any stat that parent isn't
item-locking only survives into the offspring if the **other** parent
is *also* fixed at that value already — otherwise it's lost, even if
the parent "has" it. Because of this, every extra locked trait roughly
**doubles** the number of foundation Pokemon you need (2^(n-1) for n
total traits) — see `breedtool/tree.py` for the write-up and proof.

## Quick start

```bash
python3 main.py garchomp --ivs "31/31/31/31/31/31" --nature Jolly
```

`--ivs` is `HP/Atk/Def/SpA/SpD/Spe`, using `31` for a stat you want
locked and `x` (or `-`, `.`, `0`) for "don't care":

```bash
# Just Atk / SpD / Spe, no nature
python3 main.py tyranitar --ivs "x/31/x/x/31/31"

# Just the shopping list + cost, skip the full step-by-step plan
python3 main.py salamence --ivs "31/31/x/x/31/31" --nature Adamant --shopping-only
```

### Pricing flags

```bash
python3 main.py garchomp --ivs "31/31/31/31/31/31" --nature Jolly \
    --power-item-cost 10000 \
    --everstone-cost 12000 \
    --gender-base 2500
```

- `--power-item-cost` / `--everstone-cost`: straight per-item price
  (items are consumed every breed, per the PokeMMO rule you described).
- `--gender-base`: calibrates the gender-lock cost formula,
  `cost = round(gender-base / p)` where `p` is the probability of
  whichever gender is cheaper for that species. The default (2500)
  reproduces ~5,000 for a 50/50 species and ~20,000 for a 1/8 species.
  If you have real market prices, it's easy to swap in an exact table
  instead — see "Customizing gender costs" below.

### Fodder species

By default every "leaf" (single-trait base Pokemon) is bought as one
**Ditto** (genderless → free gender lock) paired against one
individual of the target's **lowest evolution stage** (Ditto can't
pair with Ditto, so every leaf pair needs a real species too). Every
Pokemon *above* leaf level in the tree must be a real, already-bred
individual (Ditto can't carry more than one accumulated trait across
a breed — see the tree.py docstring) — those default to the target's
lowest evolution stage as well.

Override the non-Ditto leaf species with `--fodder <species>` if you'd
rather use something else that shares an egg group with your target.

## Output

- **Step-by-step plan**, grouped by generation, in `HP/Atk/Def/SpA/SpD/Spe`
  notation (`31` = locked, `x` = don't care), naming both parents, which
  item each holds, which stats ride along for free (shared between both
  parents already), and the resulting offspring.
- **Shopping list**: exactly which base Pokemon (species + single IV or
  Nature) you need to acquire, with counts.
- **Cost estimate**: Power Items, Everstones, and gender-lock costs,
  broken down and totaled.

## Project layout

```
breedtool/
  tree.py         core algorithm: builds the minimal trait tree
  species_db.py   Gen 1-5 species data: egg groups, gender ratio, evolution line
  report.py       species assignment + human-readable plan rendering
  pricing.py      cost model
  cli.py          command-line interface
  data/species_db.json   pre-built database (see "Data source" below)
main.py           entry point
```

## Customizing gender costs

If you have real per-ratio prices instead of the formula, pass a
`PricingConfig` with `gender_cost_table` filled in (used instead of the
formula whenever a `gender_rate` key is present) — this isn't exposed
as a CLI flag yet, but it's one line in Python:

```python
from breedtool import PricingConfig
config = PricingConfig(
    power_item_cost=10_000,
    everstone_cost=10_000,
    gender_cost_table={
        4: 5_000,    # 50/50
        1: 21_000,   # 1/8 minority
        7: 21_000,
        2: 10_000,   # 1/4 minority
        6: 10_000,
        0: 0,        # single-gender species, no lock needed
        8: 0,
    },
)
```

## Data source

`data/species_db.json` was built from
[PokeAPI's public CSV dataset](https://github.com/PokeAPI/pokeapi)
(species, egg groups, gender rate, evolution links), filtered to
Generations 1–5 (National Dex #1–649). To rebuild it from scratch,
re-run the CSV-processing steps described in the repo history, or ask
for the build script.

## Using it as a library

```python
from breedtool import build_tree, SpeciesDB
from breedtool.report import assign_species, render_plan, shopping_list
from breedtool.pricing import PricingConfig, cost_report

db = SpeciesDB()
target = db.find("garchomp")
root = build_tree(["atk", "spe"], want_nature=True)
species_map = assign_species(root, db, target)
print(render_plan(root, species_map, nature_name="Jolly"))
print(cost_report(root, PricingConfig(), species_map))
```

## Not yet built (future work)

- **GUI.** This is CLI-only for now. The core (`tree.py`, `report.py`,
  `pricing.py`) has no CLI/print dependencies, so a Tkinter or web
  (Flask/FastAPI) front-end can sit on top of `build_tree()` +
  `render_plan()` without changes.
- **Exact PokeMMO market pricing** for gender-locking — the formula is
  a reasonable approximation of your two reference points, not scraped
  real prices.
- **Egg-move / ability inheritance** isn't modeled — this tool is IV +
  Nature only.
- **Gen 6+ species** aren't in the database (PokeMMO is Gen 1–5).
