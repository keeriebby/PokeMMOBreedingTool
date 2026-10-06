"""
Core breeding-tree algorithm.

Traits
------
A "trait" is anything that can be locked in with a held item during a
breed: one of the six IV stats (each locked with the matching Power
Item) or Nature (locked with an Everstone).

IV_STATS gives the canonical stat order used everywhere for the
X/X/X/X/X/X display format:  HP / Atk / Def / SpA / SpD / Spe

The algorithm
--------------
To build a Pokemon carrying a target trait set T (|T| = n > 1), breed
two parents:

    parent1 = T minus {b}
    parent2 = T minus {a}

where a, b are two distinct traits chosen from T (here: the last two
traits in the working order). Both parents share every trait in
T - {a, b} "for free" (both already have it fixed, no item needed --
PokeMMO will keep a stat at 31 with no item as long as *both* parents
are 31 there). parent1 still has trait `a`, so it holds the matching
item this breed to force it through; parent2 holds the item for `b`.
The child ends up with exactly T.

Recursing down, parent1 and parent2 are built the same way from their
own (n-1)-sized trait sets. This bottoms out at n == 1: a single-trait
"leaf" Pokemon, which must simply be bought/caught/bred elsewhere with
that one IV (or Nature) already at the desired value.

This is a full binary tree, so it always requires exactly 2^(n-1) leaf
Pokemon and 2^(n-1) - 1 breeding steps, and it can be shown that this
is optimal: every non-leaf breed can add at most the 2 traits its two
held items lock in, so >2x growth per generation is impossible, and
the two parents cannot be smaller than n-1 traits each without losing
a trait that isn't shared.

Trait ordering
--------------
Which two traits are dropped first (at the root) determines how many
times each trait needs to be "re-locked" deeper in the tree (traits
kept in the long-lived overlap get duplicated into both branches, and
so get relocked repeatedly). We deliberately put Nature LAST in the
working list so it is one of the two traits dropped at the very top
of the tree -- i.e. Nature is only ever locked ONCE, in the final
breed, exactly matching the "6-IV parent x 5-IV+Nature parent" final
step. IV stats are otherwise symmetric (same item cost), so their
internal order doesn't affect totals.
"""

from dataclasses import dataclass, field
from typing import List, Optional, Tuple
from enum import Enum

IV_STATS = ["hp", "atk", "def", "spa", "spd", "spe"]
STAT_LABEL = {"hp": "HP", "atk": "Atk", "def": "Def", "spa": "SpA", "spd": "SpD", "spe": "Spe"}
NATURE = "nature"

ITEM_FOR_TRAIT = {
    "hp": "Power Weight", "atk": "Power Bracer", "def": "Power Belt",
    "spa": "Power Lens", "spd": "Power Band", "spe": "Power Anklet",
    NATURE: "Everstone",
}

class Gender(str, Enum):
    FEMALE = "Female"
    MALE = "Male"


@dataclass
class TreeNode:
    """One Pokemon in the breeding plan (either a leaf you must acquire,
    or the result of breeding two child TreeNodes)."""

    traits: Tuple[str, ...]                  # all traits this Pokemon carries, fixed order
    parent1: Optional["TreeNode"] = None
    parent2: Optional["TreeNode"] = None
    locked_by_parent1: Optional[str] = None  # trait parent1 contributes via held item
    locked_by_parent2: Optional[str] = None  # trait parent2 contributes via held item
    shared: Tuple[str, ...] = field(default_factory=tuple)  # traits inherited free (both parents already have them)
    node_id: int = 0                         # assigned during a tree walk, for stable references
    generation: int = 0                      # 0 = leaf/base pokemon, increases toward the root
    is_target_line: bool = False
    required_gender: Optional[Gender] = None   # None = no gender needed (the root)
    species: Optional[object] = None

    @property
    def is_leaf(self) -> bool:
        return self.parent1 is None

    def trait_string(self) -> str:
        """Render this node's guaranteed IVs in HP/Atk/Def/SpA/SpD/Spe order,
        with 'x' for stats not locked, plus Nature name if present."""
        parts = []
        for s in IV_STATS:
            parts.append("31" if s in self.traits else "x")
        s = "/".join(parts)
        return s


def _split(traits: Tuple[str, ...]) -> Tuple[Tuple[str, ...], Tuple[str, ...], str, str]:
    """Return (parent1_traits, parent2_traits, locked_by_parent1, locked_by_parent2)."""
    a = traits[-1]   # dropped by parent2 -> parent2 lacks it -> parent1 must item-lock it
    b = traits[-2]   # dropped by parent1 -> parent1 lacks it -> parent2 must item-lock it
    overlap = traits[:-2]
    parent1_traits = overlap + (a,)
    parent2_traits = overlap + (b,)
    return parent1_traits, parent2_traits, a, b


def _build(traits: Tuple[str, ...], counter: List[int]) -> TreeNode:
    if len(traits) == 1:
        node = TreeNode(traits=traits, generation=0)
        counter[0] += 1
        node.node_id = counter[0]
        return node

    p1_traits, p2_traits, locked1, locked2 = _split(traits)
    parent1 = _build(p1_traits, counter)
    parent2 = _build(p2_traits, counter)
    overlap = traits[:-2]

    node = TreeNode(
        traits=traits,
        parent1=parent1,
        parent2=parent2,
        locked_by_parent1=locked1,
        locked_by_parent2=locked2,
        shared=overlap,
        generation=max(parent1.generation, parent2.generation) + 1,
    )
    counter[0] += 1
    node.node_id = counter[0]
    return node


def build_tree(iv_stats_wanted: List[str], want_nature: bool) -> TreeNode:
    """Build the minimal breeding tree for the requested traits.

    iv_stats_wanted: subset of IV_STATS, any order (will be normalized).
    want_nature: whether to also lock in a Nature.
    """
    wanted = [s for s in IV_STATS if s in set(iv_stats_wanted)]
    if not wanted and not want_nature:
        raise ValueError("Nothing requested: pick at least one IV stat or a nature.")
    traits = tuple(wanted) + ((NATURE,) if want_nature else ())
    counter = [0]
    root = _build(traits, counter)
    return root


def all_nodes(root: TreeNode) -> List[TreeNode]:
    """Return every node in the tree, leaves first (post-order), for reporting."""
    out: List[TreeNode] = []

    def walk(n: TreeNode):
        if not n.is_leaf:
            walk(n.parent1)
            walk(n.parent2)
        out.append(n)

    walk(root)
    return out


def leaves(root: TreeNode) -> List[TreeNode]:
    return [n for n in all_nodes(root) if n.is_leaf]


def breeds(root: TreeNode) -> List[TreeNode]:
    return [n for n in all_nodes(root) if not n.is_leaf]
