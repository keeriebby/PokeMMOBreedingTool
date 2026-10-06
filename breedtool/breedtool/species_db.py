"""
Species lookups backed by data/species_db.json (no network access).

Unknown species raise SpeciesNotFound instead of silently falling back to
"Field, 50/50".
"""
import difflib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple


class PlanError(ValueError):
    """Anything that makes a plan impossible or invalid."""


class SpeciesNotFound(PlanError):
    pass


EGG_GROUP_DISPLAY = {
    "ground": "Field", "plant": "Grass", "water1": "Water A", "water2": "Water B",
    "water3": "Water C", "humanshape": "Humanoid", "no-eggs": "Undiscovered",
    "monster": "Monster", "dragon": "Dragon", "bug": "Bug", "flying": "Flying",
    "fairy": "Fairy", "mineral": "Mineral", "indeterminate": "Chaos", "ditto": "Ditto",
}

# Babies that only hatch if the mother holds an incense. Without it the egg
# hatches as the next stage up (Roserade -> Roselia, not Budew).
# Check these identifiers match the ones in your JSON.
INCENSE_BABIES = {
    "azurill", "wynaut", "mantyke", "munchlax", "mime-jr",
    "happiny", "chingling", "bonsly", "budew",
}


@dataclass(frozen=True)
class Species:
    id: int
    name: str
    identifier: str
    generation: int
    evolves_from_id: Optional[int]
    gender_rate: int                    # eighths female; -1 = genderless
    egg_groups_raw: Tuple[str, ...]
    is_baby: bool = False

    @property
    def egg_groups(self) -> List[str]:
        return [EGG_GROUP_DISPLAY.get(g, g.replace("-", " ").title()) for g in self.egg_groups_raw]

    @property
    def genderless(self) -> bool:
        return self.gender_rate == -1

    @property
    def female_ratio(self) -> float:
        return 0.0 if self.genderless else self.gender_rate / 8.0

    @property
    def male_only(self) -> bool:
        return self.gender_rate == 0

    @property
    def female_only(self) -> bool:
        return self.gender_rate == 8

    @property
    def can_breed(self) -> bool:
        return "no-eggs" not in self.egg_groups_raw


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


class SpeciesDB:
    def __init__(self, path: Optional[str] = None):
        path = Path(path) if path else self._default_path()
        raw = json.loads(path.read_text(encoding="utf-8"))
        entries = raw.get("species", raw) if isinstance(raw, dict) else raw
        if isinstance(entries, dict):
            entries = entries.values()

        self._by_id: Dict[int, Species] = {}
        self._index: Dict[str, Species] = {}
        for e in entries:
            s = Species(
                id=e["id"],
                name=e.get("name") or e["identifier"].title(),
                identifier=e["identifier"],
                generation=e.get("generation", 0),
                evolves_from_id=e.get("evolves_from_id"),
                gender_rate=e.get("gender_rate", 4),
                egg_groups_raw=tuple(e.get("egg_groups", [])),
                is_baby=bool(e.get("is_baby", False)),
            )
            self._by_id[s.id] = s
            self._index[_norm(s.identifier)] = s
            self._index.setdefault(_norm(s.name), s)

    @staticmethod
    def _default_path() -> Path:
        here = Path(__file__).resolve().parent
        candidates = [here / "data" / "species_db.json",
                      here.parent / "data" / "species_db.json",
                      Path.cwd() / "data" / "species_db.json"]
        for c in candidates:
            if c.exists():
                return c
        raise FileNotFoundError("species_db.json not found; looked in: " + ", ".join(map(str, candidates)))

    def all(self) -> List[Species]:
        return sorted(self._by_id.values(), key=lambda s: s.id)

    def find(self, name: str) -> Species:
        key = _norm(name)
        s = self._index.get(key)
        if s is None:
            close = difflib.get_close_matches(key, list(self._index), n=3)
            hint = f" Did you mean: {', '.join(self._index[c].name for c in close)}?" if close else ""
            raise SpeciesNotFound(f"Species '{name}' not found.{hint}")
        return s

    def chain(self, species: Species) -> List[Species]:
        """Evolution line from the lowest stage up to `species`."""
        out = [species]
        while out[0].evolves_from_id in self._by_id:
            out.insert(0, self._by_id[out[0].evolves_from_id])
        return out

    def lowest_evolution(self, species: Species) -> Species:
        return self.chain(species)[0]

    def hatch_species(self, species: Species) -> Species:
        """What an egg from a female `species` actually hatches as."""
        chain = self.chain(species)
        if chain[0].identifier in INCENSE_BABIES and len(chain) > 1:
            return chain[1]
        return chain[0]

    @staticmethod
    def egg_group_compatible(a: Species, b: Species) -> bool:
        if not (a.can_breed and b.can_breed):
            return False
        if "ditto" in a.egg_groups_raw or "ditto" in b.egg_groups_raw:
            return True
        return bool(set(a.egg_groups_raw) & set(b.egg_groups_raw))

    def check_fodder(self, target: Species, fodder: Species) -> None:
        if fodder.genderless or "ditto" in fodder.egg_groups_raw:
            raise PlanError("Fodder must be a gendered species. Ditto can't be the mother of a non-target breed.")
        if not self.egg_group_compatible(target, fodder):
            raise PlanError(f"{fodder.name} ({'/'.join(fodder.egg_groups)}) can't breed with "
                            f"{target.name} ({'/'.join(target.egg_groups)}).")

    def pick_fodder(self, target: Species) -> Species:
        """Cheapest-to-lock breeder: a base-stage, non-baby, 50/50 species sharing an egg group."""
        for s in self.all():
            if (s.evolves_from_id is None and not s.is_baby and s.gender_rate == 4
                    and s.generation <= 5 and set(s.egg_groups_raw) & set(target.egg_groups_raw)):
                return s
        raise PlanError(f"No 50/50 fodder species found for {target.name}; pass one with --fodder.")